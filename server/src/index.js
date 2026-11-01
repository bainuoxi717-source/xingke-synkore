// 学习工作台 · 后端服务入口
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { q, q1, run, nowISO, getSettings, setSettings } from './db.js';
import { listCanvasCourses, listCanvasAssignments, listCanvasTodo, listCanvasFiles, listCanvasAnnouncements, downloadCanvasFile, parseCanvasDate, courseColorFor } from './services/canvas.js';
import { askDeepSeek, askDeepSeekStream } from './services/ai.js';
import { fetchPage, extractArticles, extractArticleContent, extractTitle, rankItems, buildDigest, inferDate, inferDateFromHtml } from './services/feed.js';
import { acquireVideoToken, getVideoToken, listVodCourses, videoAuthority, getVodUrls } from './services/video.js';
import { SERVICES, matchServices, suggestByCategory } from './services/guide.js';
import { getFreshness, runRefresh, catchUpIfStale, DOMAINS } from './services/refresh.js';
import { retrieveSegments, retrieveSlides, buildSystemPrompt, buildUserContent, mmss, parseLooseJson } from './services/qa.js';
import { runTeacher, gatherForTeacher, evidenceOf, citationsOf, slidesOf, buildSynthesisPrompt } from './services/roundtable.js';
import { voiceStatus, ensureVoiceTable, ensureVoiceDirs, pickTeacherSpan, extractSample, normalizeAudio, cloneToProvider, synthesize } from './services/voice.js';
import { restyleScopes, lecturesOf, buildStyle, restyleStream, cacheGet, cachePut, batchStatus, startBatch, stopBatch } from './services/restyle.js';
import { ingestNewLectures, ingestStatus, endedTodaySubjects } from './services/ingest.js';
import { distillLecture, distillPending, distillStatus, listNoteTasks, planLectureNotes, ensureDistillColumns } from './services/distill.js';
import { notesToMarkdown } from './services/notes-recipe.js';
import { listPersonas, getPersona, personaPrompt } from './services/personas.js';
import { createLearningSourcesRouter, resolveLearningSourceMetadata, readSelectedSources, selectedSourcesPrompt, selectedSourceScope } from './services/learning-sources.js';
import { listBrowserProfiles, importFromBrowser, openUrlsInBrowser } from './services/browser-import.js';
import { ensureBrowser, readAllCookies, keepAlive, sessionStatus, summarizeHosts, openPages, ensureSessions } from './services/live-session.js';
import { healthReport } from './services/session-health.js';
import { parseScheduleFile, SECTION_START, CLASS_MIN } from './services/import.js';
import {
  fetchSchedule, mapScheduleToData, fetchGrades, parseGradeItems,
  fetchMyAccount, fetchCalendarToday, fetchUnreadJwb, fetchTodoProcesses,
  fetchStudyProgress, buildPlanTree, fetchExams, mapExams,
  fetchLibraryRooms, fetchLibraryPunish, fetchElectricity, fetchDekt, fetchLibrarySeats,
  canvasAuth,
} from './services/sjtu.js';
import { FILES_DIR, DATA_DIR } from './db.js';
import { createAttachmentsRouter, resolveAttachmentMetadata } from './services/attachments.js';
import { createLearningFeedService, createLearningFeedRouter } from './services/learning-feed.js';
import { createCustomPersonaService, createCustomPersonasRouter } from './services/custom-personas.js';
import { createPersonaMedia } from './services/custom-persona-media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3930);
const app = express();
const isAttachmentUpload = (req) => req.method === 'POST' && /^\/api\/attachments\/upload\/?$/i.test(req.path);
const jsonParser = express.json({ limit: '50mb' });
app.use((req, res, next) => isAttachmentUpload(req) ? next() : jsonParser(req, res, next));

// 外键字段规范化：前端下拉框未选择时传 ''，直接入库会触发外键约束错误
const fk = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// ================= 访问控制（对外部署用） =================
// 本机（127.0.0.1）始终免密；局域网/外网访问走「登录页 + Cookie」。
// 为什么不用 HTTP Basic Auth：嵌入式 webview（微信/飞书/App 内置浏览器）不弹密码框，
// 只会显示一段 401 文字 —— 所以改成真正的登录页面。
const formParser = express.urlencoded({ extended: false });
app.use((req, res, next) => isAttachmentUpload(req) ? next() : formParser(req, res, next));

const authCookieOf = (pw) => createHash('sha256').update('wb-auth:' + pw).digest('hex').slice(0, 32);
const isLocalIp = (ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(ip ?? ''));

function readCookie(req, name) {
  const raw = String(req.headers.cookie ?? '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

// 登录页（自包含，不依赖前端 bundle）
const LOGIN_HTML = (err = '') => `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>学习工作台 · 登录</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
 background:linear-gradient(135deg,#eef2ff,#f0fdfa);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:20px}
.card{background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(15,23,42,.12);padding:34px 30px;width:100%;max-width:380px}
.logo{font-size:38px;text-align:center;margin-bottom:6px}
h1{font-size:19px;text-align:center;margin:0 0 4px;color:#0f172a}
.sub{font-size:12.5px;text-align:center;color:#64748b;margin-bottom:22px}
label{display:block;font-size:12.5px;color:#475569;margin-bottom:6px}
input{width:100%;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:11px;font-size:15px;outline:none;transition:border-color .15s}
input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
button{width:100%;margin-top:16px;padding:12px;border:none;border-radius:11px;background:#2563eb;color:#fff;
 font-size:15px;font-weight:600;cursor:pointer;transition:background .15s}
button:hover{background:#1d4ed8}
.hint{font-weight:400;color:#94a3b8;font-size:11.5px}
.pw-wrap{position:relative}
.masked{-webkit-text-security:disc;text-security:disc;letter-spacing:.08em}
#pw{padding-right:60px}
.eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:auto;min-width:46px;height:32px;
 margin:0;padding:0 8px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:12px;
 line-height:1;cursor:pointer;border-radius:8px;transition:all .15s;font-family:inherit}
.eye:hover{background:#eef2ff;color:#2563eb;border-color:#c7d2fe}
.err{background:#fef2f2;color:#b91c1c;font-size:13px;padding:9px 12px;border-radius:9px;margin-bottom:14px;text-align:center}
.foot{margin-top:18px;font-size:11.5px;color:#94a3b8;text-align:center;line-height:1.7}
</style></head><body>
<div class="card">
  <div class="logo">🎓</div>
  <h1>学习工作台</h1>
  <div class="sub">请输入访问密码</div>
  ${err ? `<div class="err">${err}</div>` : ''}
  <form method="post" action="/login">
    <label>访问密码<span class="hint">（支持中文，可用输入法）</span></label>
    <div class="pw-wrap">
      <input type="text" id="pw" name="password" class="masked" autofocus autocomplete="off"
             autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="输入密码后回车">
      <button type="button" class="eye" id="eye" title="显示/隐藏密码">显示</button>
    </div>
    <button type="submit">进入工作台</button>
  </form>
  <div class="foot">仅限本人使用 · 登录状态保持 30 天<br>忘记密码可在工作台「导入与设置」里修改</div>
</div>
<script>
(function(){
  var pw = document.getElementById('pw'), eye = document.getElementById('eye');
  if (eye && pw) eye.addEventListener('click', function(){
    var masked = pw.classList.toggle('masked');
    eye.textContent = masked ? '显示' : '隐藏';
    pw.focus();
  });
})();
</script>
</div></body></html>`;

app.get('/login', (req, res) => {
  const pw = getSettings().accessPassword ?? '';
  if (!pw || isLocalIp(req.socket?.remoteAddress ?? req.ip)) return res.redirect('/');
  if (readCookie(req, 'wb_auth') === authCookieOf(pw)) return res.redirect('/');
  res.type('html').send(LOGIN_HTML());
});

app.post('/login', (req, res) => {
  const pw = getSettings().accessPassword ?? '';
  const input = String(req.body?.password ?? '');
  if (!pw || input === pw) {
    const val = authCookieOf(pw || 'open');
    res.setHeader('Set-Cookie', `wb_auth=${val}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`);
    return res.redirect('/');
  }
  res.status(401).type('html').send(LOGIN_HTML('密码不对，请重试'));
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'wb_auth=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use((req, res, next) => {
  let pw = '';
  try { pw = getSettings().accessPassword ?? ''; } catch { pw = ''; }
  if (!pw) return next();                                        // 没设密码 → 不拦
  if (isLocalIp(req.socket?.remoteAddress ?? req.ip)) return next();  // 本机放行
  if (req.path === '/login' || req.path === '/api/logout') return next();
  if (readCookie(req, 'wb_auth') === authCookieOf(pw)) return next(); // 已登录

  // 未登录：页面请求 → 跳登录页；接口请求 → 401 JSON
  const wantsHtml = String(req.headers.accept ?? '').includes('text/html');
  if (wantsHtml && !req.path.startsWith('/api/')) return res.redirect('/login');
  return res.status(401).json({ ok: false, error: '需要登录', loginUrl: '/login' });
});

// Binary attachments inherit the same access control as the rest of the API.
app.use('/api/attachments', createAttachmentsRouter({ filesDir: FILES_DIR, q1, run, nowISO }));
const learningFeed = createLearningFeedService({ q, q1, run, getSettings, askDeepSeek, nowISO, getVodUrls });
learningFeed.initialize();
learningFeed.topics.start();
app.use('/api/learning-feed', createLearningFeedRouter(learningFeed));
ensureDistillColumns();
const learningSourcesDeps = { filesDir: FILES_DIR, q, q1, notesToMarkdown, listNoteTasks };
app.use('/api/learning-sources', createLearningSourcesRouter(learningSourcesDeps));
const personaMedia = createPersonaMedia({ q1, filesDir: FILES_DIR, readSources: (ids) => readSelectedSources(ids, learningSourcesDeps) });
app.use('/api/custom-personas/media', personaMedia.router);
const customPersonas = createCustomPersonaService({ q, q1, run, getSettings, askDeepSeek, nowISO, readAttachments: personaMedia.read });
customPersonas.initialize();
app.use('/api/custom-personas', createCustomPersonasRouter(customPersonas));
app.get('/api/personas', (req, res) => res.json({ ok: true, personas: listPersonas() }));
app.get('/api/personas/:id', (req, res) => {
  const persona = getPersona(req.params.id);
  if (!persona) return res.status(404).json({ error: '人物讲法不存在' });
  res.json({ ok: true, persona });
});
const attachmentMetaForMessage = (ids) => {
  const attachments = [...resolveAttachmentMetadata(ids, { filesDir: FILES_DIR, q1 }), ...resolveLearningSourceMetadata(ids, learningSourcesDeps)];
  return attachments.length ? { attachments } : {};
};
const sourceReadSummary = (items) => items.map(({ text, ...metadata }) => ({ ...metadata, charsRead: text.length }));
const conversationContext = (sessionId) => {
  if (!Number.isSafeInteger(Number(sessionId)) || Number(sessionId) <= 0) return '';
  const messages = q('SELECT role,content FROM qa_messages WHERE session_id=? ORDER BY id DESC LIMIT 6', Number(sessionId)).reverse();
  if (!messages.length) return '';
  return '\n\n## 最近对话（仅用于理解追问；当前资料优先，历史回答不视为原始证据）\n' + messages.map((message) => `${message.role === 'user' ? '学生' : '之前的回答'}：${String(message.content).slice(0, 1600)}`).join('\n\n');
};

// ================= 健康检查 =================
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: '学习工作台', version: '0.1.0', time: new Date().toISOString() });
});

// ================= 设置 =================
// 局域网访问信息（供设置页显示可用的访问地址）
app.get('/api/lan-info', (req, res) => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] ?? []) {
      if (n.family === 'IPv4' && !n.internal && !/^169\.254\./.test(n.address)) {
        ips.push({ ip: n.address, iface: name });
      }
    }
  }
  res.json({ ok: true, port: PORT, ips: ips.map((x) => x.ip), detail: ips });
});
app.get('/api/settings', (req, res) => res.json(getSettings()));
app.put('/api/settings', (req, res) => res.json(setSettings(req.body || {})));

// ================= 课程 =================
app.get('/api/courses', (req, res) => {
  const rows = q(
    `SELECT c.*,
       (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id AND a.status != 'done') AS open_tasks,
       (SELECT COUNT(*) FROM schedule_slots s WHERE s.course_id = c.id) AS slot_count
     FROM courses c ORDER BY c.name COLLATE NOCASE`
  );
  res.json(rows);
});

app.post('/api/courses', (req, res) => {
  const b = req.body || {};
  const r = run(
    `INSERT INTO courses (code, name, teacher, room, color, credits, category, term, canvas_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    b.code ?? '', b.name ?? '', b.teacher ?? '', b.room ?? '',
    b.color ?? '#6366f1', b.credits ?? 0, b.category ?? '', b.term ?? '', b.canvas_id ?? ''
  );
  res.json(q1('SELECT * FROM courses WHERE id = ?', r.lastInsertRowid));
});

app.put('/api/courses/:id', (req, res) => {
  const b = req.body || {};
  run(
    `UPDATE courses SET code=?, name=?, teacher=?, room=?, color=?, credits=?, category=?, term=? WHERE id=?`,
    b.code ?? '', b.name ?? '', b.teacher ?? '', b.room ?? '',
    b.color ?? '#6366f1', b.credits ?? 0, b.category ?? '', b.term ?? '', Number(req.params.id)
  );
  res.json(q1('SELECT * FROM courses WHERE id = ?', Number(req.params.id)));
});

app.delete('/api/courses/:id', (req, res) => {
  run('DELETE FROM courses WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ================= DDL / 任务 =================
app.get('/api/assignments', (req, res) => {
  const rows = q(
    `SELECT a.*, c.name AS course_name, c.color AS course_color
     FROM assignments a LEFT JOIN courses c ON c.id = a.course_id
     ORDER BY (a.due_at IS NULL), a.due_at ASC, a.id DESC`
  );
  res.json(rows);
});

app.post('/api/assignments', (req, res) => {
  const b = req.body || {};
  const r = run(
    `INSERT INTO assignments (course_id, title, type, due_at, description, points, status, source, external_id, external_url, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    fk(b.course_id), b.title ?? '', b.type ?? '作业', b.due_at ?? null,
    b.description ?? '', b.points ?? 0, b.status ?? 'todo', b.source ?? 'manual',
    b.external_id ?? '', b.external_url ?? '', nowISO()
  );
  res.json(q1('SELECT * FROM assignments WHERE id = ?', r.lastInsertRowid));
});

const ASSIGNMENT_FIELDS = ['course_id', 'title', 'type', 'due_at', 'description', 'points', 'status', 'external_url'];
app.patch('/api/assignments/:id', (req, res) => {
  const b = req.body || {};
  const sets = [];
  const vals = [];
  for (const f of ASSIGNMENT_FIELDS) {
    if (f in b) {
      sets.push(`${f} = ?`);
      vals.push(b[f] === '' && f !== 'description' ? null : b[f]);
    }
  }
  if (!sets.length) return res.json({ ok: false, error: '无可更新字段' });
  vals.push(Number(req.params.id));
  run(`UPDATE assignments SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  res.json(q1('SELECT * FROM assignments WHERE id = ?', Number(req.params.id)));
});

app.delete('/api/assignments/:id', (req, res) => {
  run('DELETE FROM assignments WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ================= 课表 =================
// Minimal read-only data for the listening panel; excludes the personal profile and credentials.
app.get('/api/listening/schedule', (req, res) => {
  const settings = getSettings();
  const slots = q(`SELECT s.id, s.course_id, s.day_of_week, s.start_min, s.end_min, s.weeks, s.week_parity,
                          c.name AS course_name FROM schedule_slots s LEFT JOIN courses c ON c.id=s.course_id
                   ORDER BY s.day_of_week, s.start_min`);
  res.json({ ok: true, slots,
    semester: { name: settings.termName || '', firstWeekMonday: settings.termStart || '', totalWeeks: Number(settings.termWeeks) || 18 },
    periods: Object.entries(SECTION_START).map(([number, start]) => ({ number: Number(number), start, end: start + CLASS_MIN })),
    periodSource: 'schedule-import-config',
  });
});
app.get('/api/schedule', (req, res) => {
  const rows = q(
    `SELECT s.*, c.name AS course_name, c.color AS course_color, c.teacher AS teacher
     FROM schedule_slots s LEFT JOIN courses c ON c.id = s.course_id
     ORDER BY s.day_of_week, s.start_min`
  );
  res.json(rows);
});

app.post('/api/schedule', (req, res) => {
  const b = req.body || {};
  const r = run(
    `INSERT INTO schedule_slots (course_id, day_of_week, start_min, end_min, weeks, week_parity, location)
     VALUES (?,?,?,?,?,?,?)`,
    fk(b.course_id), b.day_of_week ?? 1, b.start_min ?? 480, b.end_min ?? 570,
    b.weeks ?? '', b.week_parity ?? 0, b.location ?? ''
  );
  res.json(q1('SELECT * FROM schedule_slots WHERE id = ?', r.lastInsertRowid));
});

app.delete('/api/schedule/:id', (req, res) => {
  run('DELETE FROM schedule_slots WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ================= 仪表盘 =================
app.get('/api/dashboard', (req, res) => {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const d7 = new Date(todayStart);
  d7.setDate(d7.getDate() + 7);

  const open = q(
    `SELECT a.*, c.name AS course_name, c.color AS course_color
     FROM assignments a LEFT JOIN courses c ON c.id = a.course_id
     WHERE a.status != 'done'
     ORDER BY (a.due_at IS NULL), a.due_at ASC`
  );
  const overdue = [], today = [], upcoming7 = [], undated = [];
  for (const a of open) {
    if (!a.due_at) { undated.push(a); continue; }
    const d = new Date(a.due_at);
    if (d < todayStart) overdue.push(a);
    else if (d < todayEnd) today.push(a);
    else if (d < d7) upcoming7.push(a);
  }
  const reviewDue = q1(
    `SELECT COUNT(*) AS n FROM review_items WHERE due_at IS NOT NULL AND due_at <= ?`,
    now.toISOString()
  ).n;
  const counts = {
    courses: q1('SELECT COUNT(*) AS n FROM courses').n,
    open: open.length,
    overdue: overdue.length,
    undated: undated.length,
    reviewDue,
    announcements: q1("SELECT COUNT(*) AS n FROM announcements WHERE local_read = 0 AND read_state != 'read'").n,
  };
  res.json({ now: now.toISOString(), overdue, today, upcoming7, undated, counts });
});

// ================= 笔记 =================
app.get('/api/notes', (req, res) => {
  const rows = q(
    `SELECT n.*, c.name AS course_name, c.color AS course_color
     FROM notes n LEFT JOIN courses c ON c.id = n.course_id
     ORDER BY n.updated_at DESC`
  );
  res.json(rows);
});

app.post('/api/notes', (req, res) => {
  const b = req.body || {};
  const ts = nowISO();
  const r = run(
    `INSERT INTO notes (course_id, title, content, tags, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    fk(b.course_id), b.title ?? '无标题', b.content ?? '', b.tags ?? '', ts, ts
  );
  res.json(q1('SELECT * FROM notes WHERE id = ?', r.lastInsertRowid));
});

app.put('/api/notes/:id', (req, res) => {
  const b = req.body || {};
  run(
    `UPDATE notes SET course_id=?, title=?, content=?, tags=?, updated_at=? WHERE id=?`,
    fk(b.course_id), b.title ?? '无标题', b.content ?? '', b.tags ?? '',
    nowISO(), Number(req.params.id)
  );
  res.json(q1('SELECT * FROM notes WHERE id = ?', Number(req.params.id)));
});

app.delete('/api/notes/:id', (req, res) => {
  run('DELETE FROM notes WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ================= Canvas 同步（Token 或 jAccount Cookie 双模式） =================
app.post('/api/canvas/sync', async (req, res) => {
  const auth = canvasAuth();
  if (!auth.token && !auth.cookie) {
    return res.status(400).json({ ok: false, error: '请先在「导入与设置」填写 Canvas 访问令牌，或粘贴 oc.sjtu.edu.cn 的 Cookie' });
  }
  try {
    const canvasCourses = await listCanvasCourses(auth);
    // Canvas「待办」= 系统判定未提交的作业，用于判断过期作业是否已完成
    const todo = await listCanvasTodo(auth).catch(() => []);
    const todoIds = new Set(todo.map((t) => t.assignment?.id).filter(Boolean));
    let created = 0, linked = 0, added = 0, updated = 0, skipped = 0, markedDone = 0;
    for (const cc of canvasCourses) {
      // 映射本地课程：优先 canvas_id，其次同名未绑定的课程
      let local = q1('SELECT * FROM courses WHERE canvas_id = ?', String(cc.id));
      if (!local) {
        local = q1("SELECT * FROM courses WHERE name = ? AND canvas_id = ''", cc.name ?? '');
      }
      if (!local) {
        const r = run(
          'INSERT INTO courses (code, name, color, category, term, canvas_id) VALUES (?,?,?,?,?,?)',
          cc.course_code ?? '', cc.name ?? '', courseColorFor(created), '', cc.term?.name ?? '', String(cc.id)
        );
        local = q1('SELECT * FROM courses WHERE id = ?', r.lastInsertRowid);
        created++;
      } else if (!local.canvas_id) {
        run('UPDATE courses SET canvas_id = ? WHERE id = ?', String(cc.id), local.id);
        linked++;
      }
      // 拉取该课程全部作业（含无截止时间的）
      const items = await listCanvasAssignments(auth, cc.id);
      for (const a of items) {
        const due = parseCanvasDate(a.due_at);
        const ext = `canvas-${a.id}`;
        const submittable = (a.submission_types || []).some((t) =>
          ['online_upload', 'online_text_entry', 'online_url', 'online_quiz', 'media_recording'].includes(t)
        );
        const isPast = due ? new Date(due) < new Date() : false;
        const type = (a.submission_types || []).includes('online_quiz') ? '测验' : '作业';
        const exists = q1('SELECT * FROM assignments WHERE external_id = ?', ext);
        if (exists) {
          // 只更新内容字段，不覆盖用户手动设置的状态
          run(
            'UPDATE assignments SET title=?, due_at=?, points=?, external_url=?, course_id=? WHERE id=?',
            a.name ?? '未命名', due, a.points_possible ?? 0, a.html_url ?? '', local.id, exists.id
          );
          updated++;
        } else {
          // 无 DDL 的作业照样导入；已过期且不在 Canvas 待办中 → 视为已提交
          let status = 'todo';
          let desc = '';
          if (isPast && submittable && !todoIds.has(a.id)) {
            status = 'done';
            desc = 'Canvas 自动同步：已过截止且不在待办中，按已提交处理（可改回未完成）';
            markedDone++;
          } else if (!due) {
            desc = 'Canvas 未设置截止时间';
          }
          run(
            `INSERT INTO assignments (course_id, title, type, due_at, description, points, status, source, external_id, external_url, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            local.id, a.name ?? '未命名', type, due, desc, a.points_possible ?? 0,
            status, 'canvas', ext, a.html_url ?? '', nowISO()
          );
          added++;
        }
      }
    }
    res.json({
      ok: true, courses: canvasCourses.length, created, linked, added, updated, skipped, markedDone,
      canvasTodo: todoIds.size,
    });
  } catch (e) {
    const status = e.status === 401 || e.status === 403 ? 401 : 502;
    res.status(status).json({
      ok: false,
      error: e.status === 401 || e.status === 403
        ? '鉴权失败：Canvas 令牌或 Cookie 已过期，请到「导入与设置」更新'
        : `同步失败: ${e.message}`,
    });
  }
});

// ================= 上海交通大学系统接入 =================
// 课程+时段入库（课表导入与教务同步共用）
function applyCoursesAndSlots(courses, slots, { replace = false } = {}) {
  let cAdded = 0, cMatched = 0, sAdded = 0, sCleared = 0;
  if (replace) {
    sCleared = q1('SELECT COUNT(*) AS n FROM schedule_slots').n;
    run('DELETE FROM schedule_slots');
  }
  const nameToId = new Map();
  for (const c of courses) {
    if (!c.name) continue;
    let local = q1('SELECT * FROM courses WHERE name = ?', c.name);
    if (!local) {
      const r = run(
        'INSERT INTO courses (code, name, teacher, color, credits) VALUES (?,?,?,?,?)',
        '', c.name, c.teacher ?? '', c.color ?? courseColorFor(cAdded), c.credits ?? 0
      );
      local = q1('SELECT * FROM courses WHERE id = ?', r.lastInsertRowid);
      cAdded++;
    } else {
      if (c.teacher && !local.teacher) run('UPDATE courses SET teacher = ? WHERE id = ?', c.teacher, local.id);
      if (c.credits && !local.credits) run('UPDATE courses SET credits = ? WHERE id = ?', c.credits, local.id);
      cMatched++;
    }
    nameToId.set(c.name, local.id);
  }
  for (const s of slots) {
    if (!s.course_name) continue;
    const cid = nameToId.get(s.course_name) ?? q1('SELECT id FROM courses WHERE name = ?', s.course_name)?.id ?? null;
    run(
      `INSERT INTO schedule_slots (course_id, day_of_week, start_min, end_min, weeks, week_parity, location)
       VALUES (?,?,?,?,?,?,?)`,
      cid, s.day_of_week ?? 1, s.start_min ?? 480, s.end_min ?? 570,
      s.weeks ?? '', s.week_parity ?? 0, s.location ?? ''
    );
    sAdded++;
  }
  return { cAdded, cMatched, sAdded, sCleared };
}

// 从 cURL 命令 / 请求头 / 裸 Cookie 串中智能提取 Cookie
function extractCookieFromText(input) {
  const t = String(input || '');
  // 1) -H 'cookie: xxx' 或独立的 Cookie: 行
  let m =
    t.match(/-H\s+["']cookie:\s*([^"']+)["']/i) ||
    t.match(/^\s*cookie:\s*(.+)$/im);
  if (m) return m[1].trim();
  // 2) -b 'xxx' / --cookie 'xxx'
  m = t.match(/(?:^|\s)-b\s+["']([^"']+)["']/i) || t.match(/--cookie\s+["']([^"']+)["']/i);
  if (m) return m[1].trim();
  // 3) 裸 Cookie 串（单行、含 = 和 ;）
  const single = t.trim();
  if (single && !/\s{2,}/.test(single) && single.includes('=') && single.length > 8 && !/[\r\n]/.test(single)) {
    return single;
  }
  return '';
}

function inferHostKey(text) {
  const t = String(text || '');
  if (/my\.sjtu\.edu\.cn/.test(t)) return 'my';
  if (/oc\.sjtu\.edu\.cn/.test(t)) return 'oc';
  if (/v\.sjtu\.edu\.cn/.test(t)) return 'v';
  if (/libspace\.sjtu\.edu\.cn|libseat\.sjtu\.edu\.cn/.test(t)) return 'lib';
  if (/elec\.sjtu\.edu\.cn/.test(t)) return 'elec';
  if (/dektcjd\.sjtu\.edu\.cn/.test(t)) return 'dekt';
  if (/pan\.sjtu\.edu\.cn/.test(t)) return 'pan';
  if (/i\.sjtu\.edu\.cn/.test(t)) return 'i';
  return '';
}

const HOST_LABEL = {
  i: '教务系统 i.sjtu.edu.cn',
  my: '交我办 my.sjtu.edu.cn',
  oc: 'Canvas oc.sjtu.edu.cn',
  v: '视频空间 v.sjtu.edu.cn',
  lib: '图书馆 libspace.sjtu.edu.cn',
  elec: '宿舍电费 elec.sjtu.edu.cn',
  dekt: '第二课堂 dektcjd.sjtu.edu.cn',
  pan: '交大云盘 pan.sjtu.edu.cn',
};

app.post('/api/sjtu/extract-cookie', (req, res) => {
  const text = req.body?.text ?? '';
  const cookie = extractCookieFromText(text);
  if (!cookie) {
    return res.status(400).json({
      error: '没能识别出 Cookie。请用 DevTools 里对请求「右键 → Copy → Copy as cURL」，把整段贴进来。',
    });
  }
  const hostKey = inferHostKey(text);
  if (hostKey) {
    setSettings({ [`cookie_${hostKey}`]: cookie });
  }
  res.json({
    ok: true,
    hostKey,
    hostLabel: HOST_LABEL[hostKey] || '',
    saved: !!hostKey,
    length: cookie.length,
    preview: cookie.slice(0, 40) + (cookie.length > 40 ? '…' : ''),
  });
});

// 连接状态：交我办个人资料 + 教务消息
app.get('/api/sjtu/status', async (req, res) => {
  const out = { my: null, unread: null, errors: [] };
  try {
    out.my = await fetchMyAccount();
  } catch (e) {
    out.errors.push(`交我办: ${e.message}`);
  }
  try {
    out.unread = await fetchUnreadJwb();
  } catch (e) {
    out.errors.push(`教务消息: ${e.message}`);
  }
  if (!out.my && !out.unread) {
    return res.status(400).json({ ...out, ok: false, error: '未配置交我办 Cookie，或 Cookie 已过期' });
  }
  res.json({ ...out, ok: true });
});

// 教务课表同步
app.post('/api/sjtu/sync/schedule', async (req, res) => {
  try {
    const data = await fetchSchedule();
    const mapped = mapScheduleToData(data);
    // 教务数据是权威全量：覆盖式同步，避免重复点击造成课表叠加
    const counts = applyCoursesAndSlots(mapped.courses, mapped.slots, { replace: true });
    res.json({
      ok: true,
      student: data.xsxx ?? {},
      courses: mapped.courses.length,
      slots: mapped.slots.length,
      warnings: mapped.warnings,
      ...counts,
    });
  } catch (e) {
    res.status(e.status === 401 || e.status === 403 ? 401 : 502).json({ ok: false, error: e.message });
  }
});

// 需要同步的学期列表：从入学年到当前学期（跳过未来学期）
function semesterList() {
  const s = getSettings();
  const curXnm = Number(s.sjtu_xnm || new Date().getFullYear());
  const curXqm = Number(s.sjtu_xqm || 3);
  const enroll = Number(s.sjtu_enrollYear || curXnm);
  const order = [3, 12, 16]; // 秋 / 春 / 夏
  const list = [];
  for (let y = enroll; y <= curXnm; y++) {
    for (const q of order) {
      if (y === curXnm && order.indexOf(q) > order.indexOf(curXqm)) continue;
      list.push({ xnm: String(y), xqm: String(q) });
    }
  }
  return list;
}

// 教务成绩同步（JSON 接口 + 等级制识别）
app.post('/api/sjtu/sync/grades', async (req, res) => {
  try {
    const terms = semesterList();
    const seen = new Set();
    const all = [];
    for (const t of terms) {
      let r;
      try {
        r = await fetchGrades(t);
      } catch (e) {
        if (terms.length === 1) throw e;
        continue; // 某个学期查不到就跳过
      }
      for (const g of parseGradeItems(r.items)) {
        const key = `${g.name}|${g.term}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(g);
      }
    }
    let cAdded = 0, gAdded = 0, gUpdated = 0;
    for (const g of all) {
      let local = q1('SELECT * FROM courses WHERE name = ?', g.name);
      if (!local) {
        const r = run(
          'INSERT INTO courses (code, name, color, credits) VALUES (?,?,?,?)',
          g.code || '', g.name, courseColorFor(cAdded), g.credit ?? 0
        );
        local = q1('SELECT * FROM courses WHERE id = ?', r.lastInsertRowid);
        cAdded++;
      } else if (g.code && !local.code) {
        run('UPDATE courses SET code = ? WHERE id = ?', g.code, local.id);
      }
      const exists = q1('SELECT * FROM grades WHERE course_id = ? AND term = ?', local.id, g.term || '');
      if (exists) {
        run('UPDATE grades SET score = ?, credit = ?, note = ? WHERE id = ?',
          g.score, g.credit ?? exists.credit, g.note, exists.id);
        gUpdated++;
      } else {
        run('INSERT INTO grades (course_id, term, score, credit, note) VALUES (?,?,?,?,?)',
          local.id, g.term || '', g.score, g.credit ?? null, g.note);
        gAdded++;
      }
    }
    res.json({
      ok: true,
      parsed: all.length,
      termsQueried: terms.length,
      cAdded, gAdded, gUpdated,
      message: all.length === 0 ? '这些学期暂时没有成绩记录' : '',
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// 交我办：今日日程 + 在办流程 + 未读消息（一次拿全，仪表盘用）
app.get('/api/sjtu/today', async (req, res) => {
  const out = { ok: false, calendar: null, todo: [], unread: 0, errors: [] };
  try {
    out.calendar = await fetchCalendarToday();
    out.ok = true;
  } catch (e) {
    out.errors.push(`日程: ${e.message}`);
  }
  try {
    out.todo = await fetchTodoProcesses();
    out.ok = true;
  } catch (e) {
    out.errors.push(`待办: ${e.message}`);
  }
  try {
    const u = await fetchUnreadJwb();
    out.unread = Number(u?.total ?? 0) || 0;
    out.ok = true;
  } catch (e) {
    out.errors.push(`消息: ${e.message}`);
  }
  if (!out.ok) return res.status(502).json(out);
  res.json(out);
});

// ================= 提醒（未来 24 小时 + 逾期） =================
app.get('/api/reminders', (req, res) => {
  const now = new Date();
  const t24 = new Date(now);
  t24.setDate(t24.getDate() + 1);
  const rows = q(
    `SELECT a.id, a.title, a.due_at, c.name AS course_name, c.color AS course_color
     FROM assignments a LEFT JOIN courses c ON c.id = a.course_id
     WHERE a.status != 'done' AND a.due_at IS NOT NULL AND a.due_at < ?
     ORDER BY a.due_at ASC LIMIT 50`,
    t24.toISOString()
  );
  res.json(rows.map((a) => ({ ...a, overdue: new Date(a.due_at) < now })));
});

// ================= 成绩与 GPA =================
app.get('/api/grades', (req, res) => {
  res.json(q(
    `SELECT g.*, c.name AS course_name, c.color AS course_color, c.credits AS course_credits
     FROM grades g LEFT JOIN courses c ON c.id = g.course_id
     ORDER BY g.id DESC`
  ));
});

app.post('/api/grades', (req, res) => {
  const b = req.body || {};
  const r = run(
    'INSERT INTO grades (course_id, term, score, credit, note) VALUES (?,?,?,?,?)',
    fk(b.course_id), b.term ?? '', b.score ?? null, b.credit ?? null, b.note ?? ''
  );
  res.json(q1('SELECT * FROM grades WHERE id = ?', r.lastInsertRowid));
});

app.put('/api/grades/:id', (req, res) => {
  const b = req.body || {};
  run(
    'UPDATE grades SET course_id=?, term=?, score=?, credit=?, note=? WHERE id=?',
    fk(b.course_id), b.term ?? '', b.score ?? null, b.credit ?? null, b.note ?? '',
    Number(req.params.id)
  );
  res.json(q1('SELECT * FROM grades WHERE id = ?', Number(req.params.id)));
});

app.delete('/api/grades/:id', (req, res) => {
  run('DELETE FROM grades WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// 4.0 制绩点换算（常用标准）
function scoreToGpa(s) {
  if (s == null) return 0;
  if (s >= 90) return 4.0;
  if (s >= 85) return 3.7;
  if (s >= 82) return 3.3;
  if (s >= 78) return 3.0;
  if (s >= 75) return 2.7;
  if (s >= 72) return 2.3;
  if (s >= 68) return 2.0;
  if (s >= 64) return 1.5;
  if (s >= 60) return 1.0;
  return 0;
}

app.get('/api/grades/summary', (req, res) => {
  const rows = q(
    `SELECT g.*, c.name AS course_name, c.color AS course_color, c.credits AS course_credits
     FROM grades g LEFT JOIN courses c ON c.id = g.course_id`
  );
  const plan = q1('SELECT * FROM training_plan ORDER BY id DESC LIMIT 1');
  let totalCredit = 0, earned = 0, weighted = 0, weightedCredit = 0, failed = 0, pending = 0, passFail = 0;
  for (const r of rows) {
    const credit = r.credit ?? r.course_credits ?? 0;
    if (r.score == null) {
      const m = /^等级制:([^\s·]+)/.exec(r.note || '');
      if (m) {
        // 等级制课程（P/通过/优秀…）：计学分，不计 GPA
        totalCredit += credit;
        const g = m[1].toUpperCase();
        const isFail = /不通过|不合格|不及格|^F$/.test(g);
        const isPass = !isFail && (/^(P|A|B|C|D)$/.test(g) || /通过|合格|优|良|中|及格/.test(g));
        if (isPass) { earned += credit; passFail++; } else { failed++; }
      } else {
        pending++;
      }
      continue;
    }
    totalCredit += credit;
    if (r.score >= 60) earned += credit;
    else failed++;
    weighted += scoreToGpa(r.score) * credit;
    weightedCredit += credit;
  }
  res.json({
    gpa: weightedCredit ? Math.round((weighted / weightedCredit) * 100) / 100 : null,
    totalCredit,
    earned,
    failed,
    pending,
    passFail,
    planTotal: plan?.total_credits ?? 0,
    major: plan?.major ?? '',
  });
});

// ================= 培养计划（原始数据暂存，解析功能后续接入） =================
app.get('/api/training-plan', (req, res) => {
  res.json(q1('SELECT * FROM training_plan ORDER BY id DESC LIMIT 1'));
});

app.put('/api/training-plan', (req, res) => {
  const b = req.body || {};
  run(
    'INSERT INTO training_plan (major, degree, total_credits, raw, created_at) VALUES (?,?,?,?,?)',
    b.major ?? '', b.degree ?? '', b.total_credits ?? 0, b.raw ?? '', nowISO()
  );
  res.json(q1('SELECT * FROM training_plan ORDER BY id DESC LIMIT 1'));
});

// ================= 学习问答 =================
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WD = ['一', '二', '三', '四', '五', '六', '日'];

function ruleBasedAnswer(question) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const d7 = new Date(todayStart);
  d7.setDate(d7.getDate() + 7);

  const open = q(
    `SELECT a.*, c.name AS cn FROM assignments a LEFT JOIN courses c ON c.id = a.course_id
     WHERE a.status != 'done' ORDER BY a.due_at ASC`
  );
  const fmtTask = (a) => {
    const d = a.due_at ? new Date(a.due_at) : null;
    const t = d
      ? `${d.getMonth() + 1}月${d.getDate()}日${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      : '未设时间';
    return `· ${a.cn ? `【${a.cn}】` : ''}${a.title}（${t}截止）`;
  };

  if (/逾期|过期|overdue/i.test(question)) {
    const ov = open.filter((a) => a.due_at && new Date(a.due_at) < todayStart);
    return `已逾期任务共 ${ov.length} 项：\n${ov.map(fmtTask).join('\n') || '没有逾期任务 👍'}`;
  }
  if (/今天|今日/.test(question) && /任务|作业|交|ddl|deadline|截止/i.test(question)) {
    const td = open.filter((a) => a.due_at && new Date(a.due_at) >= todayStart && new Date(a.due_at) < todayEnd);
    return `今天截止的任务共 ${td.length} 项：\n${td.map(fmtTask).join('\n') || '今天没有截止的任务。'}`;
  }
  if (/这周|本周|最近|未来/.test(question) && /任务|作业|交|ddl|deadline|截止/i.test(question)) {
    const wk = open.filter((a) => a.due_at && new Date(a.due_at) >= todayStart && new Date(a.due_at) < d7);
    return `未来 7 天截止的任务共 ${wk.length} 项：\n${wk.map(fmtTask).join('\n') || '未来 7 天没有截止的任务。'}`;
  }
  if (/课程|上课|哪门|什么课/.test(question)) {
    const cs = q('SELECT * FROM courses');
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    const slots = q(
      `SELECT s.*, c.name AS cn FROM schedule_slots s LEFT JOIN courses c ON c.id = s.course_id
       WHERE s.day_of_week = ? ORDER BY s.start_min`,
      dow
    );
    let out = `共有 ${cs.length} 门课程：${cs.map((c) => c.name).join('、') || '（还没有导入课程）'}`;
    if (slots.length) {
      out += `\n\n今天（周${WD[dow - 1]}）的课：\n${slots
        .map((x) => `· ${x.cn} ${fmtMin(x.start_min)}-${fmtMin(x.end_min)}${x.location ? ' @' + x.location : ''}`)
        .join('\n')}`;
    } else {
      out += '\n\n今天没有排课。';
    }
    return out;
  }
  return null;
}

function buildContext() {
  const courses = q('SELECT id, name, code, teacher, credits, category, term FROM courses');
  const open = q(
    `SELECT a.title, a.type, a.due_at, a.status, c.name AS course
     FROM assignments a LEFT JOIN courses c ON c.id = a.course_id
     WHERE a.status != 'done' ORDER BY a.due_at ASC LIMIT 100`
  );
  const schedule = q(
    `SELECT s.day_of_week, s.start_min, s.end_min, s.weeks, s.location, c.name AS course
     FROM schedule_slots s LEFT JOIN courses c ON c.id = s.course_id ORDER BY s.day_of_week, s.start_min`
  );
  const notes = q(
    `SELECT n.title, n.content, n.tags, c.name AS course
     FROM notes n LEFT JOIN courses c ON c.id = n.course_id ORDER BY n.updated_at DESC LIMIT 60`
  );
  return JSON.stringify({ 课程: courses, 未完成任务: open, 课表: schedule, 笔记: notes }, null, 1);
}

app.post('/api/qa', async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) return res.status(400).json({ error: '问题不能为空' });

  // 复杂/分析类问题交给 AI；只有简单查询才走本地规则（省钱、秒回）
  const complex = /分析|建议|为什么|为何|怎么|如何|帮我|规划|评价|总结|解释|区别|推荐|比较|优缺点|方法|安排|计划|提[高升]|复习|学不[会动]/.test(question);
  const local = complex ? null : ruleBasedAnswer(question);
  if (local) return res.json({ answer: local, source: 'local' });

  const s = getSettings();
  if (!s.deepseekKey) {
    return res.json({
      answer:
        '这个问题需要 AI 才能回答。在「导入与设置」里填好 DeepSeek API Key 后，我就能基于你的课表、DDL 和笔记回答任意问题。\n\n' +
        '不需要 AI 就能直接问的问题：\n' +
        '· 今天有什么任务\n· 这周要交什么\n· 有哪些逾期任务\n· 有哪些课程 / 今天有什么课',
      source: 'hint',
    });
  }
  try {
    const answer = await askDeepSeek(
      s.deepseekKey,
      '你是「学习工作台」的学习助理。请仅依据用户提供的数据回答问题，用简洁的中文回答，适当使用换行和列表。数据中没有的信息要如实说明。',
      `问题：${question}\n\n以下是学习工作台里的数据（JSON）：\n${buildContext()}`,
      { thinking: 'off', maxTokens: 1500, model: s.aiModel }
    );
    res.json({ answer, source: 'ai' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ================= 课表导入（Excel/CSV 解析 → 预览 → 入库） =================
app.post('/api/import/schedule', (req, res) => {
  const b = req.body || {};
  if (!b.dataBase64) return res.status(400).json({ error: '缺少文件内容' });
  try {
    const parsed = parseScheduleFile(b.fileName || '课表.xlsx', b.dataBase64);
    res.json({ ok: true, ...parsed });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/import/schedule/apply', (req, res) => {
  const b = req.body || {};
  const courses = Array.isArray(b.courses) ? b.courses : [];
  const slots = Array.isArray(b.slots) ? b.slots : [];
  res.json({ ok: true, ...applyCoursesAndSlots(courses, slots, { replace: !!b.replace }) });
});

// ================= 学习计划（规则生成） =================
function currentWeekNumber() {
  const s = getSettings();
  if (!s.termStart) return 1;
  const start = new Date(s.termStart + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return 1;
  const diff = Math.floor((Date.now() - start.getTime()) / 86400000);
  return diff < 0 ? 1 : Math.floor(diff / 7) + 1;
}

// 指定日期属于第几教学周（0 = 开学前）
function weekNumberForDate(dateStr) {
  const s = getSettings();
  if (!s.termStart) return null;
  const start = new Date(s.termStart + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.floor((d - start) / 86400000);
  return diff < 0 ? 0 : Math.floor(diff / 7) + 1;
}

function weeksMatch(slot, week) {
  if (!slot.weeks) return true;
  let matched = false;
  for (const p of String(slot.weeks).split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = p.match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if (m && week >= Number(m[1]) && week <= Number(m[2])) matched = true;
    else if (/^\d+$/.test(p) && Number(p) === week) matched = true;
  }
  if (!matched) return false;
  if (slot.week_parity === 1 && week % 2 === 0) return false;
  if (slot.week_parity === 2 && week % 2 === 1) return false;
  return true;
}

app.get('/api/plan', (req, res) => {
  const daysN = Math.min(14, Math.max(1, Number(req.query.days) || 7));
  const week = currentWeekNumber();
  const allSlots = q('SELECT * FROM schedule_slots');
  const open = q(
    `SELECT a.*, c.name AS cn, c.color AS cc FROM assignments a
     LEFT JOIN courses c ON c.id = a.course_id
     WHERE a.status != 'done' ORDER BY (a.due_at IS NULL), a.due_at ASC`
  );

  const now = new Date();
  const days = [];
  for (let i = 0; i < daysN; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // 按「这一天属于第几周」过滤课表，单双周/指定周课程才准确
    const dayWeek = weekNumberForDate(dateStr) || week;
    days.push({
      date: dateStr,
      dow,
      week: dayWeek,
      busy: allSlots
        .filter((s) => s.day_of_week === dow && weeksMatch(s, dayWeek))
        .sort((a, b) => a.start_min - b.start_min)
        .map((s) => ({ s: s.start_min, e: s.end_min, course: s.course_name, color: s.course_color })),
    });
  }

  const tasks = open.map((a) => ({
    id: a.id, title: a.title, course: a.cn, color: a.cc,
    due: a.due_at ? new Date(a.due_at) : null,
    minutes: a.type === '考试' ? 120 : 90,
    placed: false,
  }));

  const plan = days.map((d) => {
    const free = [];
    let cur = 480;
    const END = 1320;
    for (const b of d.busy) {
      if (b.s > cur + 15) free.push({ s: cur, e: b.s });
      cur = Math.max(cur, b.e);
    }
    if (cur < END - 15) free.push({ s: cur, e: END });
    return { ...d, free, items: [] };
  });

  for (const t of tasks) {
    for (const day of plan) {
      const dayDate = new Date(day.date + 'T00:00:00');
      if (t.due && dayDate > t.due) break;
      for (const f of day.free) {
        if (f.e - f.s >= t.minutes) {
          day.items.push({
            key: `t${t.id}`, start: f.s, end: f.s + t.minutes,
            task: t.title, course: t.course, color: t.color, done: false, task_id: t.id,
          });
          f.s += t.minutes;
          t.placed = true;
          break;
        }
      }
      if (t.placed) break;
    }
  }

  // 合并已保存的完成状态
  const saved = new Map();
  for (const row of q('SELECT date, items FROM study_plans')) {
    try {
      saved.set(row.date, new Map(JSON.parse(row.items).map((x) => [x.key, x.done])));
    } catch { /* 忽略损坏数据 */ }
  }
  for (const day of plan) {
    const st = saved.get(day.date);
    if (st) for (const it of day.items) if (st.has(it.key)) it.done = st.get(it.key);
  }

  res.json({
    week,
    generatedAt: now.toISOString(),
    plan,
    unplaced: tasks.filter((t) => !t.placed).map((t) => ({ id: t.id, title: t.title, course: t.course })),
  });
});

app.put('/api/plan/:date', (req, res) => {
  const date = String(req.params.date);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  run(
    `INSERT INTO study_plans (date, items, created_at) VALUES (?,?,?)
     ON CONFLICT(date) DO UPDATE SET items = excluded.items`,
    date, JSON.stringify(items), nowISO()
  );
  res.json({ ok: true });
});

// ================= 视频内化 =================
function parseTranscript(raw) {
  const lines = raw.replace(/\r/g, '').split('\n');
  const out = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (/^WEBVTT/.test(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (/-->/.test(t)) continue;
    if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}/.test(t)) continue;
    out.push(t);
  }
  return out.join('\n');
}

app.get('/api/videos', (req, res) => {
  res.json(q(
    `SELECT v.*, c.name AS course_name, c.color AS course_color
     FROM videos v LEFT JOIN courses c ON c.id = v.course_id
     ORDER BY v.id DESC`
  ));
});

app.post('/api/videos', (req, res) => {
  const b = req.body || {};
  const name = b.fileName || '未命名';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const isText = ['srt', 'vtt', 'txt', 'md'].includes(ext);
  let transcript = '';
  let status = 'uploaded';
  let filePath = '';
  if (b.dataBase64) {
    const buf = Buffer.from(b.dataBase64, 'base64');
    const safe = `${Date.now()}-${name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')}`;
    const fp = path.join(FILES_DIR, safe);
    fs.writeFileSync(fp, buf);
    filePath = fp;
    if (isText) {
      transcript = parseTranscript(buf.toString('utf8'));
      status = 'transcribed';
    }
  }
  const r = run(
    'INSERT INTO videos (course_id, title, file_path, transcript, status, created_at) VALUES (?,?,?,?,?,?)',
    fk(b.course_id), b.title || name, filePath, transcript, status, nowISO()
  );
  res.json(q1('SELECT * FROM videos WHERE id = ?', r.lastInsertRowid));
});

app.get('/api/videos/:id', (req, res) => {
  const v = q1('SELECT * FROM videos WHERE id = ?', Number(req.params.id));
  if (!v) return res.status(404).json({ error: '记录不存在' });
  res.json(v);
});

app.delete('/api/videos/:id', (req, res) => {
  const v = q1('SELECT file_path FROM videos WHERE id = ?', Number(req.params.id));
  if (v?.file_path) { try { fs.unlinkSync(v.file_path); } catch { /* 忽略 */ } }
  run('DELETE FROM videos WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/videos/:id/internalize', async (req, res) => {
  const v = q1('SELECT * FROM videos WHERE id = ?', Number(req.params.id));
  if (!v) return res.status(404).json({ error: '记录不存在' });
  if (!v.transcript) {
    return res.status(400).json({ error: '该视频还没有文字稿：请先上传字幕（SRT/VTT）或文字稿文件' });
  }
  const s = getSettings();
  if (!s.deepseekKey) {
    return res.status(400).json({ error: '需要 DeepSeek API Key：请到「导入与设置」填写后再试' });
  }
  const text = v.transcript;
  // v4 模型 1M 上下文，长文字稿也不用截断（上限 8 万字仅作成本保护）
  const LIMIT = 80000;
  const chunk = text.length > LIMIT ? text.slice(0, LIMIT) : text;
  const note = text.length > LIMIT ? `\n（注：文字稿过长，以下基于前 ${LIMIT} 字整理）` : '';
  try {
    const summary = await askDeepSeek(
      s.deepseekKey,
      '你是学习助理。把课堂文字稿整理成结构化中文笔记（Markdown），包含：本节要点、核心概念、公式、易错点。语言精炼。',
      `课程：${v.title}\n文字稿：\n${chunk}${note}`,
      { thinking: 'auto', maxTokens: 6000, model: s.aiModel }
    );
    const quizRaw = await askDeepSeek(
      s.deepseekKey,
      '你是学习助理。根据课堂文字稿生成 8 道自测题。严格只输出 JSON 数组：[{"q":"问题","a":"答案"}]，不要输出任何其他文字。',
      `文字稿：\n${chunk}`,
      { thinking: 'off', maxTokens: 3000, model: s.aiModel }
    );
    let quizArr = [];
    try {
      quizArr = JSON.parse(quizRaw.replace(/```json|```/g, '').trim());
      if (!Array.isArray(quizArr)) quizArr = [];
    } catch { quizArr = []; }
    run('UPDATE videos SET summary = ?, quiz = ?, status = ? WHERE id = ?', summary, JSON.stringify(quizArr), 'internalized', v.id);
    res.json({ ok: true, summary, quiz: quizArr });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ================= 教务：培养方案（修业情况） =================
app.post('/api/sjtu/sync/progress', async (req, res) => {
  try {
    const items = await fetchStudyProgress();
    if (items.length === 0) return res.json({ ok: true, modules: 0, message: '教务未返回培养方案数据' });
    const tree = buildPlanTree(items);
    const student = q1("SELECT value FROM settings WHERE key = 'sjtu_major'");
    run(
      'INSERT INTO training_plan (major, degree, total_credits, raw, parsed, created_at) VALUES (?,?,?,?,?,?)',
      student?.value ?? '传播学', '本科', tree.totalRequired,
      JSON.stringify(items), JSON.stringify(tree), nowISO()
    );
    res.json({ ok: true, ...tree, moduleCount: tree.modules.length, entries: items.length });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/training-plan/tree', (req, res) => {
  const row = q1('SELECT * FROM training_plan ORDER BY id DESC LIMIT 1');
  if (!row) return res.json({ ok: false, error: '还没有同步培养方案' });
  let tree = null;
  try { tree = JSON.parse(row.parsed); } catch { /* 忽略 */ }
  res.json({ ok: true, syncedAt: row.created_at, tree });
});

// ================= 教务：考试安排（导入为任务，自动提醒） =================
function parseExamTime(dateStr, timeStr) {
  const iso = String(dateStr).match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})/);
  let d = null;
  if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  if (!d || Number.isNaN(d.getTime())) {
    const t = new Date(dateStr);
    if (!Number.isNaN(t.getTime())) d = t;
  }
  if (!d) return null;
  const tm = String(timeStr).match(/(\d{1,2})[:：](\d{2})/);
  if (tm) d.setHours(Number(tm[1]), Number(tm[2]), 0, 0);
  else d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

app.post('/api/sjtu/sync/exams', async (req, res) => {
  try {
    const items = await fetchExams();
    const exams = mapExams(items);
    let added = 0, updated = 0, skipped = 0;
    for (const e of exams) {
      const due = parseExamTime(e.date, e.time);
      if (!due) { skipped++; continue; }
      const ext = `jw-exam-${e.course}-${e.date}`.slice(0, 120);
      let local = q1('SELECT * FROM courses WHERE name = ?', e.course);
      if (!local && e.course) {
        const r = run('INSERT INTO courses (code, name, color) VALUES (?,?,?)', '', e.course, courseColorFor(added));
        local = q1('SELECT * FROM courses WHERE id = ?', r.lastInsertRowid);
      }
      const desc = [e.place && `地点：${e.place}`, e.time && `时间：${e.time}`, '来源：教务考试信息'].filter(Boolean).join(' · ');
      const exists = q1('SELECT * FROM assignments WHERE external_id = ?', ext);
      if (exists) {
        run('UPDATE assignments SET title=?, due_at=?, description=? WHERE id=?', e.title, due, desc, exists.id);
        updated++;
      } else {
        run(
          `INSERT INTO assignments (course_id, title, type, due_at, description, status, source, external_id, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          local?.id ?? null, e.title, '考试', due, desc, 'todo', 'jw-exam', ext, nowISO()
        );
        added++;
      }
    }
    res.json({ ok: true, total: exams.length, added, updated, skipped, message: exams.length === 0 ? '教务暂无考试安排（可能还没到考试周）' : '' });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ================= 图书馆 / 电费 / 第二课堂 =================
app.get('/api/sjtu/library', async (req, res) => {
  const out = { ok: false, rooms: null, punish: null, errors: [] };
  try {
    out.rooms = await fetchLibraryRooms();
    out.ok = true;
  } catch (e) { out.errors.push(e.message); }
  try {
    out.punish = await fetchLibraryPunish();
    out.ok = true;
  } catch (e) { out.errors.push(e.message); }
  if (!out.ok) return res.status(502).json(out);
  res.json(out);
});

// 图书馆座位空位（无需登录）
app.get('/api/library/seats', async (req, res) => {
  try {
    res.json({ ok: true, ...(await fetchLibrarySeats()) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/sjtu/electricity', async (req, res) => {
  try {
    res.json({ ok: true, ...(await fetchElectricity()) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/sjtu/dekt', async (req, res) => {
  try {
    res.json({ ok: true, ...(await fetchDekt()) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ================= Canvas 课程公告 =================
app.post('/api/canvas/sync/announcements', async (req, res) => {
  const auth = canvasAuth();
  if (!auth.token && !auth.cookie) {
    return res.status(400).json({ ok: false, error: '请先配置 Canvas 令牌或 Cookie' });
  }
  try {
    const courses = await listCanvasCourses(auth);
    let added = 0, updated = 0, errors = 0;
    for (const cc of courses) {
      const local = q1('SELECT * FROM courses WHERE canvas_id = ?', String(cc.id))
        ?? q1('SELECT * FROM courses WHERE name = ?', cc.name ?? '');
      let list;
      try {
        list = await listCanvasAnnouncements(auth, cc.id);
      } catch (e) {
        errors++;
        continue;
      }
      for (const a of list) {
        const exists = q1('SELECT * FROM announcements WHERE canvas_id = ?', String(a.id));
        const posted = a.posted_at || a.delayed_post_at || a.created_at || '';
        const url = a.html_url || `${auth.base}/courses/${cc.id}/discussion_topics/${a.id}`;
        if (exists) {
          run('UPDATE announcements SET title=?, message=?, author=?, posted_at=?, url=?, read_state=? WHERE id=?',
            a.title ?? '公告', a.message ?? '', a.user_name ?? '', posted, url, a.read_state ?? 'unread', exists.id);
          updated++;
        } else {
          run(
            `INSERT INTO announcements (course_id, canvas_id, title, message, author, posted_at, url, read_state, fetched_at)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            local?.id ?? null, String(a.id), a.title ?? '公告', a.message ?? '', a.user_name ?? '',
            posted, url, a.read_state ?? 'unread', nowISO()
          );
          added++;
        }
      }
    }
    res.json({ ok: true, added, updated, errors });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/announcements', (req, res) => {
  const onlyUnread = req.query.unread === '1';
  res.json(q(
    `SELECT a.*, c.name AS course_name, c.color AS course_color
     FROM announcements a LEFT JOIN courses c ON c.id = a.course_id
     ${onlyUnread ? "WHERE a.local_read = 0 AND a.read_state != 'read'" : ''}
     ORDER BY (a.posted_at = ''), a.posted_at DESC, a.id DESC LIMIT 100`
  ));
});

app.patch('/api/announcements/:id', (req, res) => {
  const b = req.body || {};
  if ('local_read' in b) run('UPDATE announcements SET local_read = ? WHERE id = ?', b.local_read ? 1 : 0, Number(req.params.id));
  res.json(q1('SELECT * FROM announcements WHERE id = ?', Number(req.params.id)));
});

// ================= 信息源（官网通知 / 公众号 / 任意文章） =================
const DEFAULT_SOURCES = [
  { name: '教务处 · 通知通告', url: 'https://www.jwc.sjtu.edu.cn/xwtg/tztg.htm' },
  { name: '教务处 · 新闻（含公众号）', url: 'https://www.jwc.sjtu.edu.cn/xwtg/xwzx.htm' },
  { name: '交大新闻网', url: 'https://news.sjtu.edu.cn/' },
  { name: '图书馆 · 公告', url: 'libnews://ic-web/news' },
];
if (q1('SELECT COUNT(*) AS n FROM sources').n === 0) {
  for (const s of DEFAULT_SOURCES) {
    run('INSERT INTO sources (name, url, kind, created_at) VALUES (?,?,?,?)', s.name, s.url, 'web', nowISO());
  }
}

app.get('/api/sources', (req, res) => {
  res.json(q(`SELECT s.*, (SELECT COUNT(*) FROM feed_items f WHERE f.source_id = s.id) AS item_count
              FROM sources s ORDER BY s.id`));
});

app.post('/api/sources', (req, res) => {
  const b = req.body || {};
  if (!b.url) return res.status(400).json({ error: '缺少网址' });
  const r = run('INSERT INTO sources (name, url, kind, created_at) VALUES (?,?,?,?)',
    b.name || b.url, b.url, b.kind || 'web', nowISO());
  res.json(q1('SELECT * FROM sources WHERE id = ?', r.lastInsertRowid));
});

app.delete('/api/sources/:id', (req, res) => {
  run('DELETE FROM sources WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// 抓取某个源的文章列表
async function fetchSource(source) {
  const ts = nowISO();

  // 特殊源：图书馆公告（ic-web 接口，无需登录）
  if (source.url.startsWith('libnews://')) {
    const res = await fetch('https://libspace.sjtu.edu.cn/ic-web/news', {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/150' },
    });
    const j = await res.json();
    const news = j.data ?? [];
    let added = 0;
    for (const n of news) {
      const url = `libnews://${n.uuid ?? n.title}`;
      if (q1('SELECT id FROM feed_items WHERE url = ?', url)) continue;
      run(
        `INSERT INTO feed_items (source_id, title, url, summary, fetched_at) VALUES (?,?,?,?,?)`,
        source.id, n.title ?? '图书馆公告', url, '', ts
      );
      added++;
    }
    run('UPDATE sources SET last_fetched = ? WHERE id = ?', ts, source.id);
    return { name: source.name, total: news.length, added };
  }

  const { html, finalUrl } = await fetchPage(source.url);
  const articles = extractArticles(html, finalUrl).slice(0, 40);
  let added = 0;
  for (const a of articles) {
    const exists = q1('SELECT id FROM feed_items WHERE url = ?', a.url);
    if (exists) {
      // 补齐发布时间（老条目可能没存）
      if (a.published_at && !exists.published_at) {
        run('UPDATE feed_items SET published_at = ? WHERE id = ?', a.published_at, exists.id);
      }
      continue;
    }
    run(
      `INSERT INTO feed_items (source_id, title, url, summary, published_at, fetched_at)
       VALUES (?,?,?,?,?,?)`,
      source.id, a.title, a.url, '', a.published_at ?? '', ts
    );
    added++;
  }
  run('UPDATE sources SET last_fetched = ? WHERE id = ?', ts, source.id);
  return { name: source.name, total: articles.length, added };
}

app.post('/api/sources/:id/fetch', async (req, res) => {
  const source = q1('SELECT * FROM sources WHERE id = ?', Number(req.params.id));
  if (!source) return res.status(404).json({ error: '信息源不存在' });
  try {
    res.json({ ok: true, ...(await fetchSource(source)) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.post('/api/feed/fetch-all', async (req, res) => {
  const sources = q('SELECT * FROM sources WHERE enabled = 1');
  const results = [];
  for (const s of sources) {
    try {
      results.push({ ok: true, ...(await fetchSource(s)) });
    } catch (e) {
      results.push({ ok: false, name: s.name, error: e.message });
    }
  }
  res.json({ ok: true, results, added: results.reduce((n, r) => n + (r.added ?? 0), 0) });
});

// 单篇文章（公众号 / 任意链接）→ 抓正文入库
app.post('/api/feed/from-url', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!url) return res.status(400).json({ error: '请提供文章链接' });
  try {
    const { html, finalUrl } = await fetchPage(url);
    const title = extractTitle(html) || url;
    const content = extractArticleContent(html);
    // 顺手补发布/发布日期（用于时效性判断）
    const publishedAt = inferDate(finalUrl, title) || inferDateFromHtml(html);
    const ts = nowISO();
    const exists = q1('SELECT * FROM feed_items WHERE url = ?', finalUrl);
    if (exists) {
      run(
        `UPDATE feed_items SET title = ?, content = ?,
           published_at = CASE WHEN ? != '' THEN ? ELSE published_at END
         WHERE id = ?`,
        title, content, publishedAt, publishedAt, exists.id
      );
      return res.json({ ok: true, already: true, item: q1('SELECT * FROM feed_items WHERE id = ?', exists.id), chars: content.length, published_at: publishedAt });
    }
    const r = run(
      `INSERT INTO feed_items (source_id, title, url, summary, content, published_at, fetched_at)
       VALUES (?,?,?,?,?,?,?)`,
      null, title, finalUrl, content.slice(0, 200), content, publishedAt, ts
    );
    res.json({ ok: true, item: q1('SELECT * FROM feed_items WHERE id = ?', r.lastInsertRowid), chars: content.length, published_at: publishedAt });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// 手动粘贴文本（微信里复制的内容）
app.post('/api/feed/manual', (req, res) => {
  const b = req.body || {};
  if (!b.content) return res.status(400).json({ error: '缺少内容' });
  const r = run(
    `INSERT INTO feed_items (source_id, title, url, summary, content, fetched_at)
     VALUES (?,?,?,?,?,?)`,
    null, b.title || '手动添加的信息', b.url || '', String(b.content).slice(0, 200), String(b.content), nowISO()
  );
  res.json(q1('SELECT * FROM feed_items WHERE id = ?', r.lastInsertRowid));
});

app.get('/api/feed', (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 60);
  const onlyStarred = req.query.starred === '1';
  res.json(q(
    `SELECT f.*, s.name AS source_name FROM feed_items f
     LEFT JOIN sources s ON s.id = f.source_id
     ${onlyStarred ? 'WHERE f.starred = 1' : ''}
     ORDER BY (f.ai_score IS NULL), f.ai_score DESC, f.id DESC LIMIT ?`,
    limit
  ));
});

app.patch('/api/feed/:id', (req, res) => {
  const b = req.body || {};
  if ('starred' in b) run('UPDATE feed_items SET starred = ? WHERE id = ?', b.starred ? 1 : 0, Number(req.params.id));
  res.json(q1('SELECT * FROM feed_items WHERE id = ?', Number(req.params.id)));
});

app.delete('/api/feed/:id', (req, res) => {
  run('DELETE FROM feed_items WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// AI 筛选：给未打分的条目评重要性 + 写摘要
app.post('/api/feed/rank', async (req, res) => {
  const s = getSettings();
  if (!s.deepseekKey) return res.status(400).json({ error: '需要 DeepSeek API Key：请到「导入与设置」填写' });
  const limit = Math.min(30, Number(req.body?.limit) || 15);
  const items = q(
    `SELECT f.*, s.name AS source_name FROM feed_items f LEFT JOIN sources s ON s.id = f.source_id
     WHERE f.ai_score IS NULL ORDER BY f.id DESC LIMIT ?`, limit
  );
  if (items.length === 0) return res.json({ ok: true, ranked: 0, message: '没有待筛选的新条目' });
  try {
    const arr = await rankItems(s.deepseekKey, items, { model: s.aiModel });
    let n = 0;
    for (const r of arr) {
      const it = items[r.i];
      if (!it) continue;
      run('UPDATE feed_items SET ai_score = ?, ai_tags = ?, ai_digest = ? WHERE id = ?',
        Number(r.score) || 0, JSON.stringify(r.tags ?? []), String(r.digest ?? ''), it.id);
      n++;
    }
    res.json({ ok: true, ranked: n, total: items.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// AI 今日简报
app.post('/api/feed/digest', async (req, res) => {
  const s = getSettings();
  if (!s.deepseekKey) return res.status(400).json({ error: '需要 DeepSeek API Key' });
  const items = q(
    `SELECT f.*, s.name AS source_name FROM feed_items f LEFT JOIN sources s ON s.id = f.source_id
     WHERE f.ai_score IS NOT NULL ORDER BY f.ai_score DESC, f.id DESC LIMIT 20`
  );
  if (items.length === 0) return res.json({ ok: true, digest: '', message: '还没有已筛选的条目，先点「AI 筛选」' });
  try {
    const digest = await buildDigest(s.deepseekKey, items, { model: s.aiModel });
    res.json({ ok: true, digest, basedOn: items.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ================= 课程资料（Canvas 课件 + 微信/手动上传） =================
const MATERIALS_DIR = path.join(FILES_DIR, 'materials');
fs.mkdirSync(MATERIALS_DIR, { recursive: true });

// 从 Canvas 同步各课程文件清单（只存元数据，按需下载）
app.post('/api/canvas/sync/files', async (req, res) => {
  const auth = canvasAuth();
  if (!auth.token && !auth.cookie) {
    return res.status(400).json({ ok: false, error: '请先配置 Canvas 令牌或 Cookie' });
  }
  try {
    const canvasCourses = await listCanvasCourses(auth);
    let added = 0, updated = 0, skipped = 0;
    const perCourse = [];
    for (const cc of canvasCourses) {
      const local = q1('SELECT * FROM courses WHERE canvas_id = ?', String(cc.id))
        ?? q1('SELECT * FROM courses WHERE name = ?', cc.name ?? '');
      let files;
      try {
        files = await listCanvasFiles(auth, cc.id);
      } catch (e) {
        perCourse.push({ course: cc.name, files: 0, error: `HTTP ${e.status ?? '?'}` });
        continue;
      }
      let n = 0;
      for (const f of files) {
        const name = f.display_name || f.filename || '未命名文件';
        const ext = (name.split('.').pop() || '').toLowerCase();
        // 只收文档/课件类，跳过图片等杂项（可后续放开）
        if (!['pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'md', 'zip'].includes(ext)) { skipped++; continue; }
        const ts = nowISO();
        const exists = q1('SELECT * FROM materials WHERE canvas_file_id = ? AND course_id = ?', String(f.id), local?.id ?? null);
        if (exists) {
          run('UPDATE materials SET name=?, content_type=?, size=?, folder=?, canvas_url=?, updated_at=? WHERE id=?',
            name, f['content-type'] ?? '', f.size ?? 0, f.folder ?? '', f.url ?? '', ts, exists.id);
          updated++;
        } else {
          run(
            `INSERT INTO materials (course_id, canvas_file_id, name, content_type, size, folder, source, canvas_url, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            local?.id ?? null, String(f.id), name, f['content-type'] ?? '', f.size ?? 0,
            f.folder ?? '', 'canvas', f.url ?? '', ts, ts
          );
          added++;
        }
        n++;
      }
      perCourse.push({ course: cc.name, files: n });
    }
    res.json({ ok: true, added, updated, skipped, perCourse });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/materials', (req, res) => {
  res.json(q(
    `SELECT m.*, c.name AS course_name, c.color AS course_color
     FROM materials m LEFT JOIN courses c ON c.id = m.course_id
     ORDER BY c.name COLLATE NOCASE, m.name COLLATE NOCASE`
  ));
});

// 下载到本地（Canvas 课件），供离线打开
app.post('/api/materials/:id/download', async (req, res) => {
  const m = q1('SELECT * FROM materials WHERE id = ?', Number(req.params.id));
  if (!m) return res.status(404).json({ error: '资料不存在' });
  if (m.downloaded && m.local_path && fs.existsSync(m.local_path)) {
    return res.json({ ok: true, already: true, path: m.local_path });
  }
  try {
    let buf;
    if (m.source === 'canvas' && m.canvas_file_id) {
      buf = await downloadCanvasFile(canvasAuth(), m.canvas_file_id);
    } else if (m.local_path && fs.existsSync(m.local_path)) {
      return res.json({ ok: true, already: true, path: m.local_path });
    } else {
      return res.status(400).json({ error: '该资料没有可下载的来源（可能只在 Canvas 网页上）' });
    }
    const safe = m.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
    const fp = path.join(MATERIALS_DIR, `${m.id}-${safe}`);
    fs.writeFileSync(fp, buf);
    run('UPDATE materials SET local_path = ?, downloaded = 1, size = ?, updated_at = ? WHERE id = ?',
      fp, buf.length, nowISO(), m.id);
    res.json({ ok: true, path: fp, size: buf.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 打开/下载本地文件
app.get('/api/materials/:id/file', (req, res) => {
  const m = q1('SELECT * FROM materials WHERE id = ?', Number(req.params.id));
  if (!m) return res.status(404).json({ error: '资料不存在' });
  if (!m.local_path || !fs.existsSync(m.local_path)) {
    return res.status(404).json({ error: '本地还没有这个文件，请先点击「下载到本地」' });
  }
  res.download(m.local_path, m.name);
});

// 手动上传（微信里收到的资料）
app.post('/api/materials/upload', (req, res) => {
  const b = req.body || {};
  if (!b.dataBase64) return res.status(400).json({ error: '缺少文件内容' });
  const name = b.name || b.fileName || '未命名资料';
  const courseId = fk(b.course_id);
  const buf = Buffer.from(b.dataBase64, 'base64');
  const safe = name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  const fp = path.join(MATERIALS_DIR, `${Date.now()}-${safe}`);
  fs.writeFileSync(fp, buf);
  const ts = nowISO();
  const r = run(
    `INSERT INTO materials (course_id, name, content_type, size, source, local_path, downloaded, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    courseId, name, b.contentType ?? '', buf.length, b.source || 'wechat', fp, 1, ts, ts
  );
  res.json(q1('SELECT * FROM materials WHERE id = ?', r.lastInsertRowid));
});

app.delete('/api/materials/:id', (req, res) => {
  const m = q1('SELECT * FROM materials WHERE id = ?', Number(req.params.id));
  if (m?.local_path) { try { fs.unlinkSync(m.local_path); } catch { /* 忽略 */ } }
  run('DELETE FROM materials WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// 在浏览器里打开需要登录的页面（引导用户登录 Chrome，以便一键导入）
const LOGIN_PAGES = ['https://oc.sjtu.edu.cn/', 'https://i.sjtu.edu.cn/', 'https://my.sjtu.edu.cn/'];
app.post('/api/sjtu/open-login-pages', (req, res) => {
  const browser = req.body?.browser === 'edge' ? 'edge' : 'chrome';
  const r = openUrlsInBrowser(LOGIN_PAGES, browser);
  res.status(r.ok ? 200 : 500).json(r);
});
// ================= 专用浏览器会话（根治登录过期） =================
const SESSION_LOGIN_URLS = ['https://oc.sjtu.edu.cn/', 'https://i.sjtu.edu.cn/', 'https://my.sjtu.edu.cn/'];

// 打开/复用专用浏览器窗口（用户在里面登录一次）
app.post('/api/session/open', async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) && req.body.urls.length ? req.body.urls : SESSION_LOGIN_URLS;
    const r = await ensureBrowser({ openUrls: urls });
    res.json({ ok: true, ...r, urls });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 从专用浏览器读取登录态 → 写入设置（浏览器自己解密，不受 app-bound 影响）
app.post('/api/session/pull', async (req, res) => {
  try {
    await ensureBrowser();
    // 先静默恢复各系统登录态（jAccount 会话活着时自动完成）
    let sso = null;
    try { sso = await ensureSessions(); } catch { /* 忽略 */ }
    const cookies = await readAllCookies();
    const hosts = summarizeHosts(cookies);
    const HOST_FIELD = [
      [/(^|\.)i\.sjtu\.edu\.cn$/, 'cookie_i', '教务'],
      [/(^|\.)my\.sjtu\.edu\.cn$/, 'cookie_my', '交我办'],
      [/(^|\.)oc\.sjtu\.edu\.cn$/, 'cookie_oc', 'Canvas'],
      [/(^|\.)v\.sjtu\.edu\.cn$/, 'cookie_v', '视频空间'],
      [/libspace\.sjtu\.edu\.cn$/, 'cookie_lib', '图书馆'],
      [/(^|\.)elec\.sjtu\.edu\.cn$/, 'cookie_elec', '电费'],
      [/dektcjd\.sjtu\.edu\.cn$/, 'cookie_dekt', '第二课堂'],
    ];
    const byHost = {};
    for (const c of cookies) {
      const h = c.domain.replace(/^\./, '');
      if (h === 'jaccount.sjtu.edu.cn') continue;   // 登录门户本身不需要
      (byHost[h] = byHost[h] ?? []).push(c.name + '=' + c.value);
    }
    const fields = {};
    const found = [];
    for (const [host, pairs] of Object.entries(byHost)) {
      const rule = HOST_FIELD.find(([re]) => re.test(host));
      if (!rule) continue;
      const str = pairs.join('; ');
      fields[rule[1]] = fields[rule[1]] ? (fields[rule[1]] + '; ' + str) : str;
      found.push({ key: rule[1], name: rule[2], host, cookies: pairs.length, chars: str.length });
    }
    if (Object.keys(fields).length) setSettings(fields);
    res.json({
      ok: Object.keys(fields).length > 0,
      found, hosts: Object.keys(hosts), cookieCount: cookies.length,
      saved: Object.keys(fields),
      hint: Object.keys(fields).length ? '' : '专用浏览器里还没有登录态。请在弹出的窗口里登录，再点一次。',
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 登录态健康度：会话寿命学习 + 过期预测 + 提前预警
app.get('/api/session/health', (req, res) => {
  try { res.json({ ok: true, ...healthReport() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/session/status', async (req, res) => {
  try { res.json({ ok: true, ...(await sessionStatus()) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 保活：定期访问各站，延长会话寿命
app.post('/api/session/keepalive', async (req, res) => {
  try { res.json({ ok: true, ...(await keepAlive(SESSION_LOGIN_URLS)) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ================= 从浏览器一键导入登录态 =================
app.get('/api/sjtu/browser-profiles', (req, res) => {
  try {
    res.json({ ok: true, profiles: listBrowserProfiles() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sjtu/import-from-browser', async (req, res) => {
  try {
    const r = await importFromBrowser(req.body?.profileId, { closeBrowser: !!req.body?.closeBrowser });
    if (Object.keys(r.fields).length === 0) {
      const msg = r.appBoundSkipped > 0
        ? `${r.browser} 里确实有你的交大登录（${r.appBoundSkipped} 条 Cookie），但它用的是**新版 app-bound 加密**，浏览器之外无法解密（需要系统级权限）。\n\n两条可行路径：\n① 在 Chrome 里登录一次这些系统（Chrome 用旧版加密，我能直接读）→ 回来点「一键导入」，自动搞定；\n② 用下面的「⚡快速接入」：打开目标网站按 F12 → Network → 刷新 → 右键请求 → Copy as cURL → 粘贴到下面识别。`
        : `没在 ${r.browser} 里找到交大相关 Cookie。请先在浏览器登录相应系统，再导入。` + (r.hosts?.length ? `\n\n（诊断：sjtu 相关 Cookie ${r.totalSJTU} 条，域名：${r.hosts.join('、')}）` : `\n\n（诊断：库里没有 sjtu 相关 Cookie）`);
      return res.json({ ok: false, error: msg, detail: r });
    }
    setSettings(r.fields);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(e.code === 'BROWSER_RUNNING' ? 409 : 500).json({ ok: false, error: e.message, code: e.code ?? '', browser: e.browser ?? '' });
  }
});

// ================= 办事导航（Agent 入口：说要做什么 → 跳到能办事的地方） =================
app.get('/api/guide/services', (req, res) => res.json({ ok: true, categories: suggestByCategory(), total: SERVICES.length }));

app.post('/api/guide/ask', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ ok: false, error: '说说你想做什么' });
  const matches = matchServices(query);

  // 命中关键词：直接给答案，不花 AI 钱（中文 2 字关键词命中即 3 分）
  if (matches.length > 0 && matches[0].score >= 3) {
    return res.json({ ok: true, source: 'local', matches });
  }

  // 命中弱或有 AI：让 AI 在服务目录里挑并给步骤
  const s = getSettings();
  if (!s.deepseekKey) {
    return res.json({ ok: true, source: 'local', matches, note: '没找到很匹配的入口，可以换个说法，或到「导入与设置」填 DeepSeek Key 让 AI 帮你判断' });
  }
  try {
    const catalog = SERVICES.map((x) => `${x.id}｜${x.cat}｜${x.name}｜${x.url}｜${x.tip}`).join('\n');
    const raw = await askDeepSeek(
      s.deepseekKey,
      '你是上海交通大学学生的事务助理。学生说一件想做的事，你要判断该用哪个校内系统，并给出简明步骤。严格只输出 JSON：{"ids":["服务id"],"steps":["步骤1","步骤2"],"note":"一句话提醒"}。只能从给定目录里选 id；目录里没有合适的就返回空数组。',
      `学生的需求：${query}\n\n可用服务目录（id｜分类｜名称｜URL｜说明）：\n${catalog}`,
      { thinking: 'off', maxTokens: 800, temperature: 0.3, model: s.aiModel }
    );
    let parsed = { ids: [], steps: [], note: '' };
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* 忽略 */ } }
    }
    const picked = (parsed.ids ?? []).map((id) => SERVICES.find((x) => x.id === id)).filter(Boolean);
    const finalMatches = picked.length ? picked.map((p) => ({ ...p, score: 9, reasons: ['AI 推荐'] })) : matches;
    res.json({ ok: true, source: 'ai', matches: finalMatches, steps: parsed.steps ?? [], note: parsed.note ?? '' });
  } catch (e) {
    res.json({ ok: true, source: 'local', matches, note: `AI 判断失败（${e.message}），已给你最接近的入口` });
  }
});

// ================= 学习问答（多模态 · 老师视角） =================
// 依据：课堂字幕检索 + PPT OCR 检索 → AI 用老师口吻作答 → 返回引用/PPT图片/图表
app.get('/api/qa/call-plan', (req, res) => {
  const settings = getSettings();
  res.json({ ok: true, configured: !!settings.deepseekKey, model: settings.aiModel || 'deepseek-v4-flash', calls: 1 });
});
app.post('/api/qa/lecture', async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (Array.isArray(req.body?.attachmentIds) && req.body.attachmentIds.length > 20) return res.status(400).json({ error: '每次最多添加20份资料，请移除部分资料后再发送' });
  const selectedSources = await readSelectedSources(req.body?.attachmentIds, learningSourcesDeps);
  const scope = selectedSourceScope(req.body?.sourceScope ?? req.body?.scope ?? {}, selectedSources);
  const persona = req.body?.personaId ? getPersona(String(req.body.personaId)) : null;
  if (req.body?.personaId && !persona?.ready) return res.status(400).json({ error: '所选人物讲法尚未准备好' });
  const mode = req.body?.mode ?? 'teacher';
  if (!question) return res.status(400).json({ ok: false, error: '请输入问题' });

  const s = getSettings();
  if (s.deepseekKey && req.body?.approved !== true) return res.status(409).json({ error: '需要确认本次模型调用后发送问题' });
  const segments = retrieveSegments(question, scope, 24);
  const slideRows = retrieveSlides(question, scope, 6);

  // 老师名（用于人设）
  let teacher = scope.teacher ?? '';
  let subjName = '';
  if (segments[0]) { teacher = teacher || segments[0].teacher; subjName = segments[0].subj_name; }
  if (!segments.length && !slideRows.length && !selectedSources.some((item) => item.text)) {
    return res.json({
      ok: true, coverage: 'none', teacher, subjName,
      answer: '这个范围里我没找到相关的课堂内容。换个说法，或者把范围放宽到全部课程试试。',
      citations: [], slides: [], chart: null, followups: [], evidence: [],
    });
  }

  const slides = slideRows.map((x, i) => ({
    idx: `P${i + 1}`,
    url: x.url,
    ocr: x.ocr,
    subj: x.subj_name,
    date: String(x.begin_time).slice(0, 10),
    leti: x.leti_number,
    seek: x.seek,
    comment: '',
  }));

  if (!s.deepseekKey) {
    return res.json({
      ok: true, coverage: 'partial', teacher, subjName,
      answer: '**已找到相关课堂材料，但没配置 AI Key，无法生成解读。**\n\n下面是命中的课堂原话与 PPT，你可以先自己看：',
      citations: [], slides, chart: null, followups: [],
      evidence: segments.map((x) => ({ date: String(x.begin_time).slice(0, 10), leti: x.leti_number, time: mmss(x.start), text: x.text, subj: x.subj_name })),
    });
  }

  try {
    const raw = await askDeepSeek(
      s.deepseekKey,
      buildSystemPrompt({ teacher, subjName, mode, teachingStyle: personaPrompt(persona) }),
      buildUserContent(question, { segments, slides: slideRows }) + selectedSourcesPrompt(selectedSources) + conversationContext(req.body?.sessionId),
      { thinking: 'off', maxTokens: 4000, temperature: 0.5, model: s.aiModel }
    );
    const parsed = parseLooseJson(raw);
    const answer = parsed?.answer ?? raw;

    // 引用兜底：AI 没给 citations 时，用检索到的真实片段自动生成（保证可追溯）
    const aiCites = Array.isArray(parsed?.citations) ? parsed.citations.filter((c) => c && c.quote) : [];
    const citations = aiCites.length ? aiCites : segments.slice(0, 4).map((x, i) => ({
      n: i + 1,
      date: String(x.begin_time).slice(0, 10),
      leti: x.leti_number,
      time: mmss(x.start),
      quote: String(x.text).slice(0, 90),
      speaker: x.speaker === 'T' ? '老师' : x.speaker === 'S' ? '同学' : '未识别',
    }));

    // 把 AI 对 PPT 的点评贴回图片上
    const slideComments = new Map((parsed?.slides ?? []).map((x) => [String(x.idx).toUpperCase(), x.comment]));
    const finalSlides = slides.map((x) => ({
      ...x,
      comment: slideComments.get(x.idx.toUpperCase()) ?? '',
      // 只保留 AI 引用过的 PPT；若它没引用，则给相关度最高的前 3 张
      _used: slideComments.has(x.idx.toUpperCase()),
    }));
    const used = finalSlides.filter((x) => x._used);
    const keep = used.length ? used : finalSlides.slice(0, 3);

    const evidence = segments.map((x) => ({
      courId: x.cour_id, date: String(x.begin_time).slice(0, 10), leti: x.leti_number,
      time: mmss(x.start), subj: x.subj_name, text: x.text,
      speaker: x.speaker === 'T' ? '老师' : x.speaker === 'S' ? '同学' : '未识别',
    }));

    // ── 自动存档：没有会话就新建（用首问做标题），然后写入两轮消息 ──
    // 会话归属记录「用户选的问答范围」，而不是推断出的来源老师
    const sessionTeacher = scope?.teacher ?? '';
    let sessionId = Number(req.body?.sessionId) || 0;
    const ts = nowISO();
    if (!sessionId || !q1('SELECT id FROM qa_sessions WHERE id = ?', sessionId)) {
      const title = question.length > 24 ? question.slice(0, 24) + '…' : question;
      const r = run(
        'INSERT INTO qa_sessions (title, teacher, subj_name, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)',
        title, sessionTeacher, '', mode, ts, ts
      );
      sessionId = Number(r.lastInsertRowid);
    }
    run('INSERT INTO qa_messages (session_id, role, content, meta, created_at) VALUES (?,?,?,?,?)',
      sessionId, 'user', question, JSON.stringify({ scope, ...attachmentMetaForMessage(req.body?.attachmentIds) }), ts);
    const meta = {
      teacher, subjName, mode, personaId: persona?.id || '', personaName: persona?.name || '', sources: sourceReadSummary(selectedSources),
      coverage: parsed?.coverage ?? 'partial',
      citations, chart: parsed?.chart ?? null,
      followups: parsed?.followups ?? [],
      slides: keep, evidence,
      retrieved: { segments: segments.length, slides: slideRows.length },
    };
    const msgRow = run('INSERT INTO qa_messages (session_id, role, content, meta, created_at) VALUES (?,?,?,?,?)',
      sessionId, 'assistant', answer, JSON.stringify(meta), nowISO());
    run('UPDATE qa_sessions SET updated_at = ? WHERE id = ?', nowISO(), sessionId);

    res.json({
      ok: true,
      sessionId,
      messageId: Number(msgRow.lastInsertRowid),
      teacher, subjName, mode,
      coverage: meta.coverage,
      answer,
      citations,
      chart: meta.chart,
      followups: meta.followups,
      slides: keep,
      evidence,
      retrieved: meta.retrieved,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'AI 调用失败：' + e.message });
  }
});

// ================= 学习问答 · 流式（感知速度优化） =================
// 设计：① 本地检索只要 ~20ms → 先推 evidence（PPT/引用立刻可见）
//       ② 再流式吐 AI 回答（首字 ~1s 可见，不必等整段生成）
//       ③ 结束时存档并推送 sessionId
app.post('/api/qa/lecture/stream', async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (Array.isArray(req.body?.attachmentIds) && req.body.attachmentIds.length > 20) return res.status(400).json({ error: '每次最多添加20份资料，请移除部分资料后再发送' });
  const selectedSources = await readSelectedSources(req.body?.attachmentIds, learningSourcesDeps);
  const scope = selectedSourceScope(req.body?.sourceScope ?? req.body?.scope ?? {}, selectedSources);
  const persona = req.body?.personaId ? getPersona(String(req.body.personaId)) : null;
  if (req.body?.personaId && !persona?.ready) return res.status(400).json({ error: '所选人物讲法尚未准备好' });
  const mode = req.body?.mode ?? 'teacher';
  if (!question) return res.status(400).json({ ok: false, error: '请输入问题' });
  if (getSettings().deepseekKey && req.body?.approved !== true) return res.status(409).json({ error: '需要确认本次模型调用后发送问题' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const segments = retrieveSegments(question, scope, 24);
    const slideRows = retrieveSlides(question, scope, 6);
    let teacher = scope.teacher ?? '';
    let subjName = '';
    if (segments[0]) { teacher = teacher || segments[0].teacher; subjName = segments[0].subj_name; }

    const slides = slideRows.map((x, i) => ({
      idx: `P${i + 1}`, url: x.url, ocr: x.ocr, subj: x.subj_name,
      date: String(x.begin_time).slice(0, 10), leti: x.leti_number, seek: x.seek, comment: '',
    }));
    const citations = segments.slice(0, 4).map((x, i) => ({
      n: i + 1, date: String(x.begin_time).slice(0, 10),
      leti: x.leti_number, time: mmss(x.start), quote: String(x.text).slice(0, 90),
      speaker: x.speaker === 'T' ? '老师' : x.speaker === 'S' ? '同学' : '未识别',
    }));
    const evidence = segments.map((x) => ({
      courId: x.cour_id, date: String(x.begin_time).slice(0, 10), leti: x.leti_number,
      time: mmss(x.start), subj: x.subj_name, text: x.text,
      speaker: x.speaker === 'T' ? '老师' : x.speaker === 'S' ? '同学' : '未识别',
    }));

    // ① 立刻推证据（前端马上能显示 PPT 与原话）
    if (!segments.length && !slideRows.length && !selectedSources.some((item) => item.text)) {
      const message = selectedSources.length ? '所选资料目前没有可读取的文字。请添加课程笔记或文本内容后再提问；本次没有调用模型。' : '没有找到相关课堂材料。可以添加某节课的课程笔记，或换一种问法；本次没有调用模型。';
      send('evidence', { teacher, subjName, mode, personaName: persona?.name || '', sources: sourceReadSummary(selectedSources), coverage: 'none', citations: [], slides: [], evidence: [] });
      send('done', { ok: true, sessionId: 0, full: message, coverage: 'none', citations: [], slides: [], evidence: [] });
      return res.end();
    }
    send('evidence', { teacher, subjName, mode, personaId: persona?.id || '', personaName: persona?.name || '', sources: sourceReadSummary(selectedSources), coverage: 'partial', slides, citations, evidence, retrieved: { segments: segments.length, slides: slideRows.length } });
    send('status', { text: '正在生成回答…' });

    const s = getSettings();
    if (!s.deepseekKey) {
      send('delta', { text: '**已找到相关课堂材料，但没配置 AI Key。**\n\n下面是命中的课堂原话与 PPT，你可以先自己看。' });
      send('done', { ok: true, sessionId: 0, full: '', teacher, subjName, citations, slides, evidence, coverage: 'partial' });
      return res.end();
    }

    // ② 流式生成（要求纯 markdown，省掉 JSON 包装 → 首字更快）
    const streamSystem = buildSystemPrompt({ teacher, subjName, mode, teachingStyle: personaPrompt(persona) })
      .replace(/\*\*严格只输出 JSON\*\*[\s\S]*$/, '')
      + `

**输出要求（重要）**：
- 直接输出 markdown 正文，**不要输出 JSON、不要包代码块**。
- 引用课堂原话时写成 _【日期 第N节 mm:ss】_ 的形式。
- 需要图表时，单独输出一个 fenced 块：
  \`\`\`chart
  {"type":"bar","title":"标题","labels":["A","B"],"values":[1,2]}
  \`\`\`
- **控制在 1200 字以内**，直接给结论与要点，不要客套。`;

    const started = Date.now();
    let firstDeltaAt = 0;
    const full = await askDeepSeekStream(
      s.deepseekKey, streamSystem, buildUserContent(question, { segments, slides: slideRows }) + selectedSourcesPrompt(selectedSources) + conversationContext(req.body?.sessionId),
      { thinking: 'off', maxTokens: 2200, temperature: 0.5, model: s.aiModel },
      (piece) => {
        if (!firstDeltaAt) firstDeltaAt = Date.now();
        send('delta', { text: piece });
      }
    );

    // ③ 存档
    const sessionTeacher = scope?.teacher ?? '';
    let sessionId = Number(req.body?.sessionId) || 0;
    const ts = nowISO();
    if (!sessionId || !q1('SELECT id FROM qa_sessions WHERE id = ?', sessionId)) {
      const title = question.length > 24 ? question.slice(0, 24) + '…' : question;
      const r2 = run('INSERT INTO qa_sessions (title, teacher, subj_name, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)',
        title, sessionTeacher, '', mode, ts, ts);
      sessionId = Number(r2.lastInsertRowid);
    }
    run('INSERT INTO qa_messages (session_id, role, content, meta, created_at) VALUES (?,?,?,?,?)',
      sessionId, 'user', question, JSON.stringify({ scope, ...attachmentMetaForMessage(req.body?.attachmentIds) }), ts);
    const meta = { teacher, subjName, mode, personaId: persona?.id || '', personaName: persona?.name || '', sources: sourceReadSummary(selectedSources), coverage: 'partial', citations, chart: null, followups: [], slides, evidence };
    run('INSERT INTO qa_messages (session_id, role, content, meta, created_at) VALUES (?,?,?,?,?)',
      sessionId, 'assistant', full, JSON.stringify(meta), nowISO());
    run('UPDATE qa_sessions SET updated_at = ? WHERE id = ?', nowISO(), sessionId);

    send('done', {
      ok: true, sessionId, full, teacher, subjName, citations, slides, evidence, coverage: 'partial',
      timing: { firstTokenMs: firstDeltaAt ? firstDeltaAt - started : null, totalMs: Date.now() - started, chars: full.length },
    });
    res.end();
  } catch (e) {
    try { send('error', { message: e.message }); res.end(); } catch { /* 已断开 */ }
  }
});
// ================= 老师圆桌：多师并答 / 互相对话 / 跨学科融合 =================
app.post('/api/qa/roundtable/stream', async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  const teachers = (Array.isArray(req.body?.teachers) ? req.body.teachers : []).filter(Boolean).slice(0, 5);
  const debate = req.body?.debate !== false;
  const synthesize = req.body?.synthesize !== false;
  if (!question) return res.status(400).json({ ok: false, error: '请输入问题' });
  if (teachers.length < 2) return res.status(400).json({ ok: false, error: '圆桌模式至少选 2 位老师' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const s = getSettings();
  if (!s.deepseekKey) { send('error', { message: '没配置 AI Key，请到「导入与设置」填写' }); return res.end(); }

  const subjOf = {};
  for (const t of teachers) {
    subjOf[t] = q1(`SELECT subj_name FROM lectures WHERE teacher = ? AND subj_name != '' LIMIT 1`, t)?.subj_name ?? '';
  }

  const started = Date.now();
  const r1 = {}, r2 = {}, evi = {};
  try {
    // ① 第一轮：并行并答（每位老师用自己的口吻独立回答）
    send('plan', { teachers: teachers.map((t) => ({ teacher: t, subjName: subjOf[t] })), debate, synthesize, startedAt: nowISO() });
    await Promise.all(teachers.map(async (t) => {
      const { segments, slides } = gatherForTeacher(question, t);
      evi[t] = { citations: citationsOf(segments), slides: slidesOf(slides), evidence: evidenceOf(segments),
                 retrieved: { segments: segments.length, slides: slides.length } };
      send('teacher_begin', { teacher: t, subjName: subjOf[t], phase: 'answer', ...evi[t] });
      const r = await runTeacher({
        apiKey: s.deepseekKey, model: s.aiModel, question, teacher: t, subjName: subjOf[t],
        phase: 'answer', peers: teachers,
        onDelta: (piece) => send('delta', { teacher: t, phase: 'answer', text: piece }),
      });
      r1[t] = r.text;
      send('teacher_done', { teacher: t, phase: 'answer', text: r.text });
    }));

    // ② 第二轮：圆桌对话（每位老师看到别人的观点后回应）
    if (debate) {
      const transcripts = teachers.map((t) => ({ teacher: t, subjName: subjOf[t], text: r1[t] || '' }));
      send('debate_begin', { round: 2 });
      await Promise.all(teachers.map(async (t) => {
        send('teacher_begin', { teacher: t, subjName: subjOf[t], phase: 'respond' });
        const r = await runTeacher({
          apiKey: s.deepseekKey, model: s.aiModel, question, teacher: t, subjName: subjOf[t],
          phase: 'respond', peers: teachers, transcripts,
          onDelta: (piece) => send('delta', { teacher: t, phase: 'respond', text: piece }),
        });
        r2[t] = r.text;
        send('teacher_done', { teacher: t, phase: 'respond', text: r.text });
      }));
    }

    // ③ 跨学科融合：合成一份完整讲解
    let synthesis = '';
    if (synthesize) {
      const answers = teachers.map((t) => ({
        teacher: t, subjName: subjOf[t],
        text: [r1[t], r2[t] ? `\n\n【对他人观点的回应】${r2[t]}` : ''].join(''),
      }));
      send('synthesis_begin', {});
      synthesis = await askDeepSeekStream(
        s.deepseekKey, buildSynthesisPrompt({ question, answers }), question,
        { thinking: 'off', maxTokens: 2400, temperature: 0.5, model: s.aiModel },
        (piece) => send('synthesis_delta', { text: piece })
      );
      send('synthesis_done', { text: synthesis });
    }

    // ④ 存档（按「圆桌」形式记录，恢复时能看到每位老师的回答）
    const ts = nowISO();
    let sessionId = Number(req.body?.sessionId) || 0;
    if (!sessionId || !q1('SELECT id FROM qa_sessions WHERE id = ?', sessionId)) {
      const title = `【圆桌】${question.length > 20 ? question.slice(0, 20) + '…' : question}`;
      const r = run('INSERT INTO qa_sessions (title, teacher, subj_name, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)',
        title, teachers.join('、').slice(0, 60), '圆桌', 'roundtable', ts, ts);
      sessionId = Number(r.lastInsertRowid);
    }
    run('INSERT INTO qa_messages (session_id, role, content, meta, created_at) VALUES (?,?,?,?,?)',
      sessionId, 'user', question, JSON.stringify({ teachers, ...attachmentMetaForMessage(req.body?.attachmentIds) }), ts);
    run('INSERT INTO qa_messages (session_id, role, content, meta, created_at) VALUES (?,?,?,?,?)',
      sessionId, 'assistant', synthesis || teachers.map((t) => `## ${t}\n${r1[t]}`).join('\n\n'),
      JSON.stringify({
        roundtable: true, teachers,
        panels: teachers.map((t) => ({ teacher: t, subjName: subjOf[t], answer: r1[t] || '', respond: r2[t] || '', ...evi[t] })),
        synthesis,
      }), nowISO());
    run('UPDATE qa_sessions SET updated_at = ? WHERE id = ?', nowISO(), sessionId);

    send('done', {
      ok: true, sessionId, synthesis,
      timing: { totalMs: Date.now() - started, teachers: teachers.length, debate, synthesize },
    });
    res.end();
  } catch (e) {
    try { send('error', { message: e.message }); res.end(); } catch { /* 已断开 */ }
  }
});
// ================= 学习问答 · 对话存档 =================
app.get('/api/qa/sessions', (req, res) => {
  const rows = q(
    `SELECT s.*, (SELECT COUNT(*) FROM qa_messages m WHERE m.session_id = s.id) AS message_count,
            (SELECT substr(m.content, 1, 80) FROM qa_messages m
              WHERE m.session_id = s.id AND m.role = 'assistant' ORDER BY m.id DESC LIMIT 1) AS last_answer
     FROM qa_sessions s ORDER BY s.pinned DESC, s.updated_at DESC LIMIT 200`
  );
  res.json({ ok: true, count: rows.length, sessions: rows });
});

app.post('/api/qa/sessions', (req, res) => {
  const ts = nowISO();
  const r = run(
    'INSERT INTO qa_sessions (title, teacher, subj_name, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    String(req.body?.title ?? '新对话').slice(0, 80), req.body?.teacher ?? '', req.body?.subjName ?? '',
    req.body?.mode ?? 'teacher', ts, ts
  );
  res.json({ ok: true, session: q1('SELECT * FROM qa_sessions WHERE id = ?', r.lastInsertRowid) });
});

app.get('/api/qa/sessions/:id', (req, res) => {
  const s = q1('SELECT * FROM qa_sessions WHERE id = ?', Number(req.params.id));
  if (!s) return res.status(404).json({ ok: false, error: '会话不存在' });
  const msgs = q('SELECT * FROM qa_messages WHERE session_id = ? ORDER BY id ASC', s.id).map((m) => {
    let meta = {};
    try { meta = JSON.parse(m.meta || '{}'); } catch { /* 忽略 */ }
    return { id: m.id, role: m.role, text: m.content, createdAt: m.created_at, ...meta };
  });
  res.json({ ok: true, session: s, messages: msgs });
});

app.patch('/api/qa/sessions/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = q1('SELECT * FROM qa_sessions WHERE id = ?', id);
  if (!s) return res.status(404).json({ ok: false, error: '会话不存在' });
  if (req.body?.title != null) run('UPDATE qa_sessions SET title = ?, updated_at = ? WHERE id = ?', String(req.body.title).slice(0, 80), nowISO(), id);
  if (req.body?.pinned != null) run('UPDATE qa_sessions SET pinned = ? WHERE id = ?', req.body.pinned ? 1 : 0, id);
  res.json({ ok: true, session: q1('SELECT * FROM qa_sessions WHERE id = ?', id) });
});

app.delete('/api/qa/sessions/:id', (req, res) => {
  const id = Number(req.params.id);
  run('DELETE FROM qa_messages WHERE session_id = ?', id);
  run('DELETE FROM qa_sessions WHERE id = ?', id);
  res.json({ ok: true });
});

// 可选择的问答范围（老师 / 课程 / 课次）
app.get('/api/qa/scopes', (req, res) => {
  const teachers = q(`SELECT teacher, COUNT(*) AS lectures, GROUP_CONCAT(DISTINCT subj_name) AS courses
                      FROM lectures WHERE teacher != '' GROUP BY teacher ORDER BY lectures DESC`);
  const courses = q(`SELECT DISTINCT subj_name, teacher, COUNT(*) AS lectures FROM lectures GROUP BY subj_name ORDER BY subj_name`);
  const lectures = q(`SELECT cour_id, subj_name, teacher, begin_time, leti_number, room, LENGTH(transcript) AS chars
                      FROM lectures ORDER BY begin_time DESC LIMIT 100`);
  // 实时统计（前端文案用它，避免写死数字越用越不准）
  const stats = q1(`SELECT COUNT(*) AS lectures,
                           SUM(CASE WHEN LENGTH(transcript) > 50 THEN 1 ELSE 0 END) AS withTranscript,
                           SUM(LENGTH(transcript)) AS totalChars,
                           MAX(begin_time) AS latest
                    FROM lectures`);
  res.json({
    ok: true, teachers, courses, lectures,
    stats: {
      lectures: stats?.lectures ?? 0,
      ready: stats?.withTranscript ?? 0,
      totalChars: stats?.totalChars ?? 0,
      totalWan: Math.round((stats?.totalChars ?? 0) / 1000) / 10,
      teachers: teachers.length,
      courses: courses.length,
      latest: stats?.latest ?? '',
    },
  });
});

// ================= 课次自动内化（课后自动读取 PPT + 回放） =================
// 内化状态：已抓/待抓/最新课次/今天该抓哪些
app.get('/api/lectures/ingest-status', (req, res) => {
  try { res.json({ ok: true, status: ingestStatus(), today: endedTodaySubjects() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 手动触发抓取（可选只抓某几门课）
app.post('/api/lectures/ingest', async (req, res) => {
  try {
    const r = await ingestNewLectures({
      sinceDays: Number(req.body?.sinceDays) || 30,
      force: !!req.body?.force,
      onlySubjects: Array.isArray(req.body?.subjects) ? req.body.subjects : [],
    });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// ================= PPT 图片代理 + 本地缓存 =================
// 问题：浏览器直接加载 live.sjtu.edu.cn 的 PPT 图，并发多张时服务器会断连接
//       （实测 6 张里 5 张 net::ERR_CONNECTION_CLOSED）
// 方案：由工作台服务器代取并存本地缓存，前端只请求 localhost → 稳定 + 秒开
const PPT_CACHE_DIR = path.join(DATA_DIR, 'ppt-cache');
const PPT_CACHE_MAX_MB = 400;

function pptCacheFile(u) {
  const h = createHash('sha1').update(u).digest('hex').slice(0, 24);
  return path.join(PPT_CACHE_DIR, h + '.jpg');
}

async function fetchPpt(u, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 400 * (i + 1)));
    }
  }
}

// 缓存过大时清掉最旧的一半
function trimPptCache() {
  try {
    const files = fs.readdirSync(PPT_CACHE_DIR).map((n) => {
      const p = path.join(PPT_CACHE_DIR, n);
      const st = fs.statSync(p);
      return { p, size: st.size, mtime: st.mtimeMs };
    });
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total <= PPT_CACHE_MAX_MB * 1024 * 1024) return;
    files.sort((a, b) => a.mtime - b.mtime);
    let freed = 0;
    for (const f of files) {
      if (total - freed <= PPT_CACHE_MAX_MB * 1024 * 1024 * 0.6) break;
      try { fs.unlinkSync(f.p); freed += f.size; } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
}

app.get('/api/ppt/image', async (req, res) => {
  const u = String(req.query.u ?? '');
  if (!/^https:\/\/live\.sjtu\.edu\.cn\//i.test(u)) return res.status(400).json({ ok: false, error: '非法地址' });
  try {
    fs.mkdirSync(PPT_CACHE_DIR, { recursive: true });
    const file = pptCacheFile(u);
    if (fs.existsSync(file)) {
      res.set('Cache-Control', 'public, max-age=31536000');
      return res.sendFile(file);
    }
    const buf = await fetchPpt(u);
    fs.writeFileSync(file, buf);
    trimPptCache();
    res.set('Cache-Control', 'public, max-age=31536000');
    res.type('image/jpeg').send(buf);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ================= 老师音色克隆 =================
// 链路：课堂录播截取老师声音 → 上传克隆服务 → 得到 voice_id → 朗读用老师本人的声音
app.get('/api/voices/status', (req, res) => {
  try { res.json({ ok: true, ...voiceStatus() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 诊断：视频平台的录播 API 到底返回哪些字段、有没有播放地址
// 用途：登录态正常时跑一次，确认「能不能自动拿到课堂音频」
app.get('/api/voices/probe', async (req, res) => {
  const out = { ok: true, listFields: null, urlFields: [], candidates: [] };
  try {
    const { acquireVideoToken, listVodCourses, listLectures, videoApi } = await import('./services/video.js');
    await acquireVideoToken();
    const courses = await listVodCourses();
    out.courses = courses.length;
    if (courses.length) {
      const c = courses[0];
      out.sampleCourse = { subjName: c.subjName, teclId: c.teclId };
      const lects = await listLectures(c.teclId);
      out.lectures = lects.length;
      // 直接打原始接口，dump 第一条记录的所有字段
      const { accessToken } = await (await import('./services/video.js')).getVideoToken();
      const raw = await videoApi(`/v1/subject_vod_list_new?page.pageIndex=1&page.pageSize=1&teclIds=${c.teclId}`
        + '&page.orders%5B0%5D.asc=false&page.orders%5B0%5D.field=courBeginTime&schoolOpenStatusFlag=false', accessToken);
      const rec = raw?.data?.records?.[0] ?? (Array.isArray(raw?.data) ? raw.data[0] : null);
      if (rec) {
        out.listFields = Object.keys(rec);
        for (const [k, v] of Object.entries(rec)) {
          const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
          if (/\.mp4|\.m3u8|http.*\/\/|url|path|video|media|play/i.test(k) || /\.mp4|\.m3u8/i.test(s)) {
            out.urlFields.push({ field: k, sample: String(s).slice(0, 160) });
          }
        }
      }
      // 试探常见的「取播放地址」接口
      const courId = lects[0]?.courId;
      if (courId) {
        out.sampleCourId = courId;
        const tries = [
          `/v1/course/play/${courId}`,
          `/v1/course/vod/${courId}`,
          `/v1/course/video/${courId}`,
          `/v1/course/playUrl?courseId=${courId}`,
          `/v1/course/vodUrl?courseId=${courId}`,
        ];
        for (const p of tries) {
          try {
            const j = await videoApi(p, accessToken);
            const s = JSON.stringify(j).slice(0, 200);
            out.candidates.push({ path: p, ok: true, sample: s });
            if (/\.mp4|\.m3u8/i.test(s)) break;
          } catch (e) { out.candidates.push({ path: p, ok: false, error: String(e.message).slice(0, 80) }); }
        }
      }
    }
  } catch (e) {
    out.ok = false; out.error = e.message;
  }
  res.json(out);
});

// 为某位老师克隆音色
// body: { teacher, courId?, videoUrl?, audioBase64? }
//   给了 audioBase64 → 直接用（手动上传兜底）
//   给了 videoUrl    → ffmpeg 截取（需已确认能拿到 mp4 地址）
//   只给 courId      → 目前拿不到播放地址，返回明确提示
app.post('/api/voices/build', async (req, res) => {
  const teacher = String(req.body?.teacher ?? '').trim();
  if (!teacher) return res.status(400).json({ ok: false, error: '缺少 teacher' });
  ensureVoiceTable();
  const mark = (status, extra = {}) => run(
    `INSERT INTO teacher_voices (teacher, status, error, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(teacher) DO UPDATE SET status=excluded.status, error=excluded.error, updated_at=excluded.updated_at`,
    teacher, status, extra.error ?? '', nowISO());

  try {
    mark('sampling');
    let samplePath = null, seconds = 0, srcRange = '';

    if (req.body?.audioBase64) {
      // 用户直接上传一小段音频（30~60 秒即可，不必用整段录播）
      ensureVoiceDirs();
      const raw = Buffer.from(String(req.body.audioBase64).split(',').pop(), 'base64');
      if (raw.length < 8 * 1024) throw new Error('音频文件太小，请提供 20 秒以上');
      const ext = String(req.body?.audioName ?? '').match(/\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4)$/i)?.[1] ?? 'bin';
      const tmpIn = path.join(DATA_DIR, 'voices', 'samples', '_upload_' + Date.now() + '.' + ext);
      fs.writeFileSync(tmpIn, raw);
      try {
        const n = await normalizeAudio(tmpIn, teacher);
        samplePath = n.file; seconds = n.seconds; srcRange = '手动上传音频';
      } finally { try { fs.unlinkSync(tmpIn); } catch { /* 忽略 */ } }
    } else if (req.body?.videoUrl) {
      const span = pickTeacherSpan(Number(req.body?.courId), 40, 90);
      const r = await extractSample({ source: req.body.videoUrl, start: span?.start ?? 0, duration: span?.duration ?? 60, teacher });
      samplePath = r.file; seconds = r.seconds;
      srcRange = `录播 ${Math.round(span?.start ?? 0)}s 起 ${span?.duration ?? 60}s（${span?.text ?? ''}）`;
    } else if (req.body?.courId) {
      // 自动从课堂录播取地址（ffmpeg 只读需要的片段，不下载整段视频）
      const cid = Number(req.body.courId);
      const urls = await getVodUrls(cid);
      if (!urls.length) throw new Error('该课次没有可用播放地址');
      const span = pickTeacherSpan(cid, 45, 90);
      const r = await extractSample({ source: urls[0].url, start: span?.start ?? 0, duration: span?.duration ?? 60, teacher });
      samplePath = r.file; seconds = r.seconds;
      srcRange = Math.round(span?.start ?? 0) + 's 起 ' + (span?.duration ?? 60) + 's（' + (span?.text ?? '') + '）';
      req.body.courId = cid;
    } else {
      throw new Error('请提供以下任一：audioBase64（上传一段 30~60 秒老师讲话）、courId（自动从课堂录播截取）、videoUrl（直接给 mp4 地址）');
    }

    mark('sampling', { error: '' });
    const { provider, voiceId } = await cloneToProvider({ teacher, file: samplePath });
    run(`UPDATE teacher_voices SET provider=?, voice_id=?, sample_path=?, sample_seconds=?, source_cour_id=?,
           source_range=?, status='ready', error='', created_at=COALESCE(NULLIF(created_at,''), ?), updated_at=?
         WHERE teacher=?`,
      provider, voiceId, samplePath, seconds, Number(req.body?.courId) || null, srcRange, nowISO(), nowISO(), teacher);
    res.json({ ok: true, teacher, provider, voiceId, seconds, source: srcRange });
  } catch (e) {
    run(`UPDATE teacher_voices SET status='error', error=?, updated_at=? WHERE teacher=?`,
      String(e.message).slice(0, 300), nowISO(), teacher);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// 合成朗读音频（返回 mp3 流；同样文本命中缓存）
app.get('/api/tts', async (req, res) => {
  const teacher = String(req.query.teacher ?? '');
  const text = String(req.query.text ?? '');
  if (!text) return res.status(400).json({ ok: false, error: '缺少 text' });
  try {
    const r = await synthesize({ teacher, text });
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('audio/mpeg');
    fs.createReadStream(r.file).pipe(res);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message, fallback: true });
  }
});

// 删除某位老师的音色
app.delete('/api/voices/:teacher', (req, res) => {
  ensureVoiceTable();
  run('DELETE FROM teacher_voices WHERE teacher = ?', decodeURIComponent(req.params.teacher));
  res.json({ ok: true });
});

// ================= 换讲法（用另一位老师的讲法，重讲必须学的课） =================
// 思路：内容来自源课程（保义、可追溯），讲法来自另一位老师的真实课堂画像
app.get('/api/restyle/scopes', (req, res) => {
  try { res.json({ ok: true, ...restyleScopes() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/restyle/lectures', (req, res) => {
  try {
    const subject = String(req.query.subject ?? '');
    const teacher = String(req.query.teacher ?? '');
    if (!subject || !teacher) return res.status(400).json({ ok: false, error: '需要 subject 与 teacher' });
    res.json({ ok: true, lectures: lecturesOf(subject, teacher) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 生成/刷新某位老师的讲法画像
app.post('/api/restyle/style', async (req, res) => {
  const teacher = String(req.body?.teacher ?? '').trim();
  if (!teacher) return res.status(400).json({ ok: false, error: '缺少 teacher' });
  try {
    const style = await buildStyle(teacher, { force: !!req.body?.force });
    res.json({ ok: true, teacher, style });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// 换讲法（SSE 流式）
app.post('/api/restyle/stream', async (req, res) => {
  const courId = Number(req.body?.courId);
  const styleTeacher = String(req.body?.styleTeacher ?? '').trim();
  const personaId = String(req.body?.personaId ?? '');
  const mode = req.body?.mode === 'key' ? 'key' : 'full';
  if (!courId) return res.status(400).json({ ok: false, error: '缺少 courId' });
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 断开 */ } };
  try {
    send('status', { text: styleTeacher ? `正在用「${styleTeacher}」的讲法重讲…` : '正在重讲…' });
    const t0 = Date.now();
    let firstAt = 0;
    const r = await restyleStream({
      courId, styleTeacher, mode, personaId, signal: controller.signal,
      onStatus: (data) => send('status', data),
      onDelta: (piece) => {
        if (!firstAt) { firstAt = Date.now(); send('status', { text: `已开始输出（${((firstAt - t0) / 1000).toFixed(1)}s）` }); }
        send('delta', { text: piece });
      },
    });
    send('done', {
      ok: true, ...r,
      timing: { firstTokenMs: firstAt ? firstAt - t0 : null, totalMs: Date.now() - t0, chars: r.markdown.length },
    });
    // 存一份，下次秒开
    try { cachePut(courId, styleTeacher, mode, r.markdown, personaId, r.cacheFingerprint); } catch { /* 缓存失败不影响主流程 */ }
    res.end();
  } catch (e) {
    try { send('error', { message: e.message }); res.end(); } catch { /* 断开 */ }
  }
});

// 取缓存的换讲法结果
app.get('/api/restyle/cached', (req, res) => {
  try {
    const row = cacheGet(Number(req.query.courId), String(req.query.styleTeacher ?? ''), String(req.query.mode ?? 'full'), String(req.query.personaId ?? ''));
    res.json({ ok: true, cached: !!row, markdown: row?.markdown ?? '', createdAt: row?.createdAt ?? '' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 整门课批量换讲法
app.post('/api/restyle/batch', (req, res) => {
  try {
    const subject = String(req.body?.subject ?? '');
    const sourceTeacher = String(req.body?.sourceTeacher ?? '');
    const styleTeacher = String(req.body?.styleTeacher ?? '');
    const mode = req.body?.mode === 'key' ? 'key' : 'full';
    if (!subject || !sourceTeacher) return res.status(400).json({ ok: false, error: '需要 subject 与 sourceTeacher' });
    const r = startBatch({ subject, sourceTeacher, styleTeacher, mode, personaId: String(req.body?.personaId ?? '') });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.get('/api/restyle/batch/status', (req, res) => {
  res.json({ ok: true, ...batchStatus() });
});
app.post('/api/restyle/batch/stop', (req, res) => {
  res.json({ ok: true, stopped: stopBatch() });
});

// 朗读用：把换讲法结果切成适合 TTS 的小段（前端逐段取音频，边下边播）
app.post('/api/restyle/speech-chunks', (req, res) => {
  const md = String(req.body?.markdown ?? '');
  const clean = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\[源\d+\]/g, '')
    .replace(/[*_`>|#]/g, '')
    .replace(/（此处原课[^）]*）/g, '')
    .replace(/\(此处原课[^)]*\)/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  // 按句子切，每段 ≤ 350 字（TTS 更稳、首段更快出声）
  const chunks = [];
  let cur = '';
  for (const sent of clean.split(/(?<=[。！？；\n])/)) {
    const s = sent.trim();
    if (!s) continue;
    if ((cur + s).length > 350 && cur) { chunks.push(cur); cur = s; }
    else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  res.json({ ok: true, count: chunks.length, totalChars: clean.length, chunks });
});

// ================= 课次蒸馏（课次笔记） =================
app.get('/api/lectures/distill-status', (req, res) => {
  try { res.json({ ok: true, ...distillStatus() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 蒸馏单节课（或强制重蒸）
app.get('/api/lectures/note-tasks', (req, res) => res.json({ ok: true, ...listNoteTasks(req.query) }));
app.get('/api/lectures/:courId/notes-plan', (req, res) => {
  const plan = planLectureNotes(Number(req.params.courId));
  if (!plan.ok) return res.status(404).json(plan);
  res.json({ ok: true, plan: { ...plan, configured: !!getSettings().deepseekKey } });
});
app.post('/api/lectures/:courId/distill', async (req, res) => {
  try {
    const r = await distillLecture(Number(req.params.courId), { force: !!req.body?.force, approved: req.body?.approved === true, expectedSourceHash: req.body?.expectedSourceHash, expectedRecipeVersion: req.body?.expectedRecipeVersion, expectedModel: req.body?.expectedModel });
    res.status(r.ok ? 200 : r.needsConfirmation ? 409 : r.code === 'missing_key' ? 400 : 502).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 批量蒸馏待处理课次
app.post('/api/lectures/distill-pending', async (req, res) => {
  try {
    const r = await distillPending({ limit: Math.min(Number(req.body?.limit) || 2, 10), approved: req.body?.approved === true, courIds: req.body?.courIds, expectedHashes: req.body?.expectedHashes, expectedRecipeVersion: req.body?.expectedRecipeVersion, expectedModel: req.body?.expectedModel });
    res.status(r.needsConfirmation ? 409 : 200).json(r);
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// 取某节课的笔记
app.get('/api/lectures/:courId/notes', (req, res) => {
  const row = q1('SELECT cour_id, subj_name, teacher, begin_time, leti_number, distill_json, distilled_at FROM lectures WHERE cour_id = ?', Number(req.params.courId));
  if (!row) return res.status(404).json({ ok: false, error: '课次不存在' });
  let notes = null;
  try { notes = JSON.parse(row.distill_json || 'null'); } catch { /* 忽略 */ }
  res.json({ ok: true, courId: row.cour_id, subjName: row.subj_name, teacher: row.teacher,
             beginTime: row.begin_time, leti: row.leti_number, distilledAt: row.distilled_at, notes });
});


// ================= 课堂录播 / 老师蒸馏 =================
app.get('/api/lectures', (req, res) => {
  const courseId = req.query.course_id ? Number(req.query.course_id) : null;
  const teacher = req.query.teacher ? String(req.query.teacher) : null;
  let sql = `SELECT l.cour_id, l.tecl_id, l.subj_code, l.subj_name, l.teacher, l.week_no, l.leti_number, l.room,
                    l.begin_time, l.end_time, l.watched_percent, l.course_id,
                    LENGTH(l.transcript) AS transcript_chars,
                    LENGTH(l.summary_json) AS summary_chars,
                    json_array_length(CASE WHEN json_valid(l.ppt_json) THEN l.ppt_json ELSE '[]' END) AS ppt_count,
                    CASE WHEN l.distilled_at != '' THEN 1 ELSE 0 END AS distilled,
                    c.name AS course_name, c.color
             FROM lectures l LEFT JOIN courses c ON c.id = l.course_id WHERE 1=1`;
  const params = [];
  if (courseId) { sql += ' AND l.course_id = ?'; params.push(courseId); }
  if (teacher) { sql += ' AND l.teacher LIKE ?'; params.push(`%${teacher}%`); }
  sql += ' ORDER BY l.begin_time DESC';
  const rows = q(sql, ...params);
  const teachers = q(`SELECT teacher, COUNT(*) AS lectures, SUM(LENGTH(transcript)) AS chars
                      FROM lectures WHERE teacher != '' GROUP BY teacher ORDER BY lectures DESC`);
  res.json({ ok: true, count: rows.length, totalChars: rows.reduce((s, r) => s + (r.transcript_chars ?? 0), 0), lectures: rows, teachers });
});

app.get('/api/lectures/:courId', (req, res) => {
  const l = q1('SELECT * FROM lectures WHERE cour_id = ?', Number(req.params.courId));
  if (!l) return res.status(404).json({ ok: false, error: '没有这节课' });
  res.json({
    ok: true,
    lecture: {
      ...l,
      transcript_json: undefined,
      segments: (() => { try { return JSON.parse(l.transcript_json || '[]'); } catch { return []; } })(),
      summary: (() => { try { return JSON.parse(l.summary_json || 'null'); } catch { return null; } })(),
      ppt: (() => { try { return JSON.parse(l.ppt_json || '[]'); } catch { return []; } })(),
    },
  });
});

// 修正某门课的「实际授课老师」（视频平台记的是排课教师，常与实际授课者不符）
app.post('/api/lectures/teacher', (req, res) => {
  const subjName = String(req.body?.subjName ?? '').trim();
  const teacher = String(req.body?.teacher ?? '').trim();
  if (!subjName) return res.status(400).json({ ok: false, error: '缺少课程名' });
  const before = q1('SELECT DISTINCT teacher FROM lectures WHERE subj_name = ? LIMIT 1', subjName)?.teacher ?? '';
  const r = run('UPDATE lectures SET teacher = ? WHERE subj_name = ?', teacher, subjName);
  res.json({ ok: true, subjName, before, after: teacher, updated: r.changes ?? 0 });
});

// 课程老师一览（供修正界面使用）：教务记录 vs 实际授课
app.get('/api/lecture-teachers', (req, res) => {
  const lectureTeachers = q(`SELECT subj_name, teacher, COUNT(*) AS lectures FROM lectures
                             WHERE subj_name != '' GROUP BY subj_name ORDER BY subj_name`);
  const courseTeachers = q(`SELECT name, teacher FROM courses WHERE teacher != ''`);
  const cmap = Object.fromEntries(courseTeachers.map((c) => [c.name, c.teacher]));
  res.json({
    ok: true,
    items: lectureTeachers.map((x) => ({
      subjName: x.subj_name,
      lectureTeacher: x.teacher,          // 实际授课（问答用的就是它）
      courseTeacher: cmap[x.subj_name] ?? '',  // 教务记录（排课教师）
      lectures: x.lectures,
      differs: !!cmap[x.subj_name] && cmap[x.subj_name] !== x.teacher,
    })),
  });
});

// 老师维度汇总（蒸馏的入口）
app.get('/api/teachers', (req, res) => {
  const rows = q(
    `SELECT teacher,
            COUNT(*) AS lectures,
            COUNT(DISTINCT subj_name) AS courses,
            GROUP_CONCAT(DISTINCT subj_name) AS course_names,
            SUM(LENGTH(transcript)) AS chars,
            MIN(begin_time) AS first_lecture,
            MAX(begin_time) AS last_lecture,
            SUM(CASE WHEN distilled_at != '' THEN 1 ELSE 0 END) AS distilled
     FROM lectures WHERE teacher != '' GROUP BY teacher ORDER BY lectures DESC`
  );
  res.json({ ok: true, count: rows.length, teachers: rows });
});

// ================= 视频空间（v.sjtu.edu.cn）录播接入 =================
app.get('/api/video/status', (req, res) => {
  const s = getSettings();
  const exp = Number(s.videoTokenExp ?? 0);
  const now = Math.floor(Date.now() / 1000);
  res.json({
    ok: true,
    hasToken: !!s.videoToken,
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
    valid: exp > now,
    canvasBound: !!s.videoCanvasCourseId,
  });
});

app.post('/api/video/connect', async (req, res) => {
  try {
    const info = await acquireVideoToken({ force: true });
    res.json({ ok: true, sub: info.sub, scope: info.scope, expiresAt: new Date(info.exp * 1000).toISOString() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/video/courses', async (req, res) => {
  try {
    const courses = await listVodCourses();
    res.json({ ok: true, count: courses.length, courses });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/video/authority', async (req, res) => {
  try {
    res.json({ ok: true, authority: await videoAuthority() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ================= 刷新调度（分层 + 过期才刷） =================
app.get('/api/freshness', (req, res) => res.json({ ok: true, ...getFreshness() }));

app.post('/api/refresh', async (req, res) => {
  const b = req.body || {};
  try {
    const report = await runRefresh({
      domains: Array.isArray(b.domains) ? b.domains : undefined,
      force: !!b.force,
      reason: b.reason || 'manual',
    });
    res.json({ ok: true, ...report });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 开机/登录后的补刷（计划任务调用）
app.post('/api/refresh/catchup', async (req, res) => {
  try {
    res.json({ ok: true, ...(await catchUpIfStale()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================= 学业上下文快照（给 AI / Agent 用的统一入口） =================
function buildContextData() {
  const settings = getSettings();
  const week = currentWeekNumber();
  const slots = q(
    `SELECT s.*, c.name AS course_name, c.teacher, c.color FROM schedule_slots s
     LEFT JOIN courses c ON c.id = s.course_id ORDER BY s.day_of_week, s.start_min`
  ).filter((s) => weeksMatch(s, week));
  const open = q(
    `SELECT a.*, c.name AS course_name FROM assignments a LEFT JOIN courses c ON c.id = a.course_id
     WHERE a.status != 'done' ORDER BY (a.due_at IS NULL), a.due_at ASC`
  );
  const done = q1('SELECT COUNT(*) AS n FROM assignments WHERE status = ?', 'done').n;
  const grades = q(
    `SELECT g.*, c.name AS course_name, c.credits AS course_credits FROM grades g
     LEFT JOIN courses c ON c.id = g.course_id ORDER BY g.id DESC`
  );
  const planRow = q1('SELECT * FROM training_plan ORDER BY id DESC LIMIT 1');
  let plan = null;
  try { plan = planRow ? JSON.parse(planRow.parsed) : null; } catch { plan = null; }
  const anns = q(
    `SELECT a.*, c.name AS course_name FROM announcements a LEFT JOIN courses c ON c.id = a.course_id
     WHERE a.local_read = 0 AND a.read_state != 'read' ORDER BY a.id DESC`
  );
  const courses = q(
    `SELECT c.*, (SELECT COUNT(*) FROM schedule_slots s WHERE s.course_id = c.id) AS slot_count,
            (SELECT COUNT(*) FROM materials m WHERE m.course_id = c.id) AS material_count
     FROM courses c ORDER BY c.name COLLATE NOCASE`
  );
  return {
    generatedAt: nowISO(),
    profile: {
      name: settings.sjtu_name || '汪锦凡',
      studentId: settings.sjtu_code || '526201910019',
      classNo: settings.sjtu_class || '媒传2611',
      college: settings.sjtu_org || '媒体与传播学院',
      major: settings.sjtu_major || '传播学',
      school: settings.schoolName || '上海交通大学',
    },
    semester: {
      name: settings.termName || '',
      firstWeekMonday: settings.termStart || '',
      totalWeeks: Number(settings.termWeeks) || 18,
      currentWeek: week,
    },
    courses: courses.map((c) => ({
      name: c.name, code: c.code, teacher: c.teacher, credits: c.credits,
      category: c.category, slots: c.slot_count, materials: c.material_count,
      canvasId: c.canvas_id || '',
    })),
    scheduleThisWeek: slots.map((s) => ({
      day: s.day_of_week, start: s.start_min, end: s.end_min,
      course: s.course_name, teacher: s.teacher, room: s.location, weeks: s.weeks,
    })),
    assignments: {
      openCount: open.length, doneCount: done,
      open: open.map((a) => ({ title: a.title, course: a.course_name, type: a.type, due: a.due_at, source: a.source })),
    },
    grades: {
      records: grades.map((g) => ({ course: g.course_name, term: g.term, score: g.score, credit: g.credit, note: g.note })),
    },
    trainingPlan: plan,
    unreadAnnouncements: anns.map((a) => ({ course: a.course_name, title: a.title, posted: a.posted_at })),
    counts: {
      courses: courses.length,
      materials: q1('SELECT COUNT(*) AS n FROM materials').n,
      notes: q1('SELECT COUNT(*) AS n FROM notes').n,
      videos: q1('SELECT COUNT(*) AS n FROM videos').n,
      feedItems: q1('SELECT COUNT(*) AS n FROM feed_items').n,
      sources: q1('SELECT COUNT(*) AS n FROM sources').n,
    },
  };
}

app.get('/api/context', (req, res) => res.json(buildContextData()));

app.get('/api/context.md', (req, res) => {
  const d = buildContextData();
  const DAY = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const lines = [];
  lines.push(`# 凡子 · 学业档案（交大数据源）`);
  lines.push('');
  lines.push(`> **最后更新**：${d.generatedAt.slice(0, 10)}（自动生成，每次刷新覆盖）`);
  lines.push('>');
  lines.push('> **这份档案是什么**：从上海交通大学教务系统 / Canvas / 交我办**自动同步**的当前学业状态 ——');
  lines.push('> 在修课程与授课教师、本周课表、作业与 DDL、成绩与 GPA、培养方案学分进度、未读公告。');
  lines.push('>');
  lines.push('> **与另两份档案的分工**（三份配合使用）：');
  lines.push('>');
  lines.push('> | 档案 | 回答什么 | 数据来源 |');
  lines.push('> |---|---|---|');
  lines.push('> | 《个人档案.md》 | **我是谁** —— 经历、技能、荣誉 | 本人填写 |');
  lines.push('> | 《协作认知档案.md》 | **我怎么判断、怎么做事** —— 审美、标准、个性 | 协作沉淀 |');
  lines.push('> | **本档案** | **我现在的学业状态** —— 上什么课、哪些老师、有哪些任务 | 交大系统自动同步 |');
  lines.push('>');
  lines.push('> **给读档的 Agent**：涉及具体课业（排计划、复习、催 DDL、写作业相关）时**先读本档案**，');
  lines.push('> 用真实课程名与教师名说话，不要凭印象。涉及"我是谁"读《个人档案》，涉及做事方式读《协作认知档案》。');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 一、基本信息与学期');
  lines.push(`- ${d.profile.school} · ${d.profile.college} · ${d.profile.major} · ${d.profile.classNo}`);
  lines.push(`- 学号 ${d.profile.studentId}`);
  lines.push(`- ${d.semester.name}｜**第 ${d.semester.currentWeek} 周** / 共 ${d.semester.totalWeeks} 周｜第 1 周周一：${d.semester.firstWeekMonday}`);
  lines.push('');
  lines.push(`## 二、本学期课程与授课教师（${d.courses.length} 门）`);
  lines.push('| 课程 | 授课教师 | 学分 | 周课时段 | 已有课件 |');
  lines.push('|---|---|---|---|---|');
  for (const c of d.courses) lines.push(`| ${c.name} | ${c.teacher || '—'} | ${c.credits} | ${c.slots} | ${c.materials} |`);
  lines.push('');
  lines.push(`## 三、本周课表（第 ${d.semester.currentWeek} 周，${d.scheduleThisWeek.length} 个时段）`);
  for (const s of d.scheduleThisWeek) lines.push(`- ${DAY[s.day]} ${hm(s.start)}-${hm(s.end)}　**${s.course}**（${s.teacher || '—'}）@ ${s.room}`);
  lines.push('');
  lines.push(`## 四、作业与任务（${d.assignments.openCount} 项未完成 / ${d.assignments.doneCount} 项已完成）`);
  for (const a of d.assignments.open) {
    const due = a.due ? new Date(a.due).toLocaleString('zh-CN') : '**无截止时间**';
    lines.push(`- [${a.course || '未关联'}] ${a.title}　截止：${due}`);
  }
  lines.push('');
  lines.push('## 五、成绩与 GPA');
  if (d.grades.records.length === 0) lines.push('- （暂无成绩记录）');
  for (const g of d.grades.records) {
    lines.push(`- ${g.course}｜${g.term}｜成绩 **${g.score ?? '—'}**｜学分 ${g.credit ?? '—'}｜${g.note || ''}`);
  }
  lines.push('');
  if (d.trainingPlan) {
    lines.push(`## 六、培养方案进度（毕业要求 **${d.trainingPlan.totalRequired}** 学分 / 已获 **${d.trainingPlan.totalEarned}**）`);
    for (const m of d.trainingPlan.modules) {
      lines.push(`- **${m.name}**：${m.earned ?? 0} / ${m.required ?? '—'}`);
      for (const g of m.groups ?? []) lines.push(`  - ${g.name}：${g.earned ?? 0} / ${g.required ?? '—'}`);
    }
    lines.push('');
  }
  if (d.unreadAnnouncements.length) {
    lines.push(`## 七、未读课程公告（${d.unreadAnnouncements.length} 条）`);
    for (const a of d.unreadAnnouncements) lines.push(`- [${a.course || '未关联'}] ${a.title}`);
    lines.push('');
  }
  lines.push('## 八、工作台已接入的数据');
  lines.push(`- 课件资料 ${d.counts.materials} 份｜笔记 ${d.counts.notes} 篇｜视频 ${d.counts.videos} 个｜信息源 ${d.counts.sources} 个 / 条目 ${d.counts.feedItems} 条`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 九、数据来源与刷新');
  lines.push('- 来源：交大教务（课表/成绩/培养方案）、Canvas（作业/课件/公告）、交我办（日程/待办）');
  lines.push('- 刷新：双击工作区里的 **`刷新学业档案.bat`**（需学习工作台服务在运行）');
  lines.push('- 原始接口：`GET http://localhost:3910/api/context`（JSON）/ `/api/context.md`（本文件）');
  lines.push('- 视频空间录播（真实课堂录像与 PPT 切片）另有接口：`/api/video/courses`');
  res.type('text/markdown; charset=utf-8').send(lines.join('\n'));
});

// ================= API 兜底 =================
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在: ' + req.path }));

// ================= 静态资源（生产模式：web/dist） =================
const dist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ================= 课后自动内化：服务内定时器 =================
// 上课日每 20 分钟检查一次：今天有课已下课、且有课次还没抓 → 自动抓取
// 只在 8:00-23:00 运行，避免半夜打学校服务器
function startClassWatcher() {
  const TICK_MIN = 20;
  let running = false;
  const tick = async () => {
    if (running) return;
    const now = new Date();
    const hour = now.getHours();
    if (hour < 8 || hour >= 23) return;
    try {
      const today = endedTodaySubjects();
      // 今天没有已下课的课 → 不用查（周末/假期自然跳过）
      if (!today.endedCount) return;
      running = true;
      const r = await ingestNewLectures({ sinceDays: 14 });
      const msg = r.ready === 0
        ? `今天 ${today.endedCount} 节已下课，无新课次待抓`
        : `扫描 ${r.scanned} · 新增 ${r.added} · 更新 ${r.updated} · ${r.chars} 字`;
      run(`INSERT INTO sync_state (domain, last_run, last_ok, status, message) VALUES ('lectures',?,?,?,?)
           ON CONFLICT(domain) DO UPDATE SET last_run=excluded.last_run, last_ok=excluded.last_ok,
             status=excluded.status, message=excluded.message`,
        nowISO(), nowISO(), r.failed > 0 ? 'error' : 'ok', msg);
      if (r.added || r.updated) console.log(`[课次内化] ${msg}`);
    } catch (e) {
      // 会话过期等错误：记下来，等自愈/登录后再跑
      run(`INSERT INTO sync_state (domain, last_run, status, message) VALUES ('lectures',?,?,?)
           ON CONFLICT(domain) DO UPDATE SET last_run=excluded.last_run, status=excluded.status, message=excluded.message`,
        nowISO(), 'error', String(e.message).slice(0, 160));
    } finally { running = false; }
  };
  setTimeout(tick, 60 * 1000);                    // 启动 1 分钟后先跑一次
  setInterval(tick, TICK_MIN * 60 * 1000);
}
try { startClassWatcher(); } catch (e) { console.log('课次监听器启动失败:', e.message); }

app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`[学习工作台] 服务已启动: http://localhost:${PORT}`);
});
