// Isolated test database. Never imports the application's database or model provider.
import { DatabaseSync } from 'node:sqlite';
import { createLearningFeedService } from '../src/services/learning-feed.js';
export const fixturePeriods = [{ number: 3, start: 600, end: 645 }, { number: 4, start: 655, end: 700 }];
export function fixture(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE courses(id INTEGER PRIMARY KEY,name TEXT,canvas_id TEXT);
    CREATE TABLE schedule_slots(id INTEGER PRIMARY KEY,course_id INTEGER,day_of_week INTEGER,start_min INTEGER,end_min INTEGER,weeks TEXT,week_parity INTEGER);
    CREATE TABLE lectures(cour_id INTEGER PRIMARY KEY,course_id INTEGER,subj_name TEXT,teacher TEXT,begin_time TEXT,end_time TEXT,duration_sec INTEGER,transcript_json TEXT,ppt_json TEXT);
    CREATE TABLE materials(id INTEGER PRIMARY KEY,course_id INTEGER,name TEXT,canvas_url TEXT,downloaded INTEGER,source TEXT,updated_at TEXT);
    CREATE TABLE qa_messages(id INTEGER PRIMARY KEY,session_id INTEGER,role TEXT,content TEXT,meta TEXT,created_at TEXT);`);
  const q = (sql, ...params) => db.prepare(sql).all(...params);
  const q1 = (sql, ...params) => db.prepare(sql).get(...params) || null;
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const settings = { termStart: '2026-10-19', termWeeks: '18', termName: '示例秋季学期', canvasUrl: 'https://canvas.example.edu', deepseekKey: 'fake-test-key', aiModel: 'fake-test-model' };
  run('INSERT INTO courses VALUES(1,?,?)', '微积分基础', '101');
  run('INSERT INTO courses VALUES(2,?,?)', '传播与社会', '102');
  run('INSERT INTO schedule_slots VALUES(1,1,1,600,700,?,1)', '1-16');
  run('INSERT INTO schedule_slots VALUES(2,2,1,840,940,?,1)', '1-16');
  const segments = [{ start: 0, end: 20000, text: '这是另一个知识点，与极限没有关系。' },
    { start: 1060000, end: 1100000, text: '极限关心自变量趋近时函数值的变化。' },
    { start: 1100000, end: 1120000, text: '函数在这个点没有定义，也可能存在极限。' },
    { start: 3000000, end: 3020000, text: '这个片段远离标记，不应被关联。' }];
  run('INSERT INTO lectures VALUES (501,1,?,?,?,?,?,?,?)', '微积分基础', '测试教师', '2026-11-02 10:02:00', '2026-11-02 11:40:00', 5880, JSON.stringify(segments), JSON.stringify([{ seek: 1070000, ocr: '极限的存在与函数定义是两个问题', url: 'https://live.sjtu.edu.cn/example/ppt.jpg' }]));
  // Another course at the same time must never provide context for course 1.
  run('INSERT INTO lectures VALUES (502,2,?,?,?,?,?,?,?)', '传播与社会', '示例教师', '2026-11-02 10:00:00', '2026-11-02 11:40:00', 6000, JSON.stringify([{ start: 1180000, end: 1220000, text: '另一门课的内容，绝不能混入极限课程。' }]), '[]');
  run('INSERT INTO materials VALUES(1,1,?,?,?,?,?)', '极限学习讲义.pdf', 'https://canvas.example.edu/files/1', 0, 'canvas', '2026-11-02');
  run('INSERT INTO materials VALUES(2,2,?,?,?,?,?)', '另一门课的讲义.pdf', 'https://canvas.example.edu/files/2', 0, 'canvas', '2026-11-02');
  const questions = ['极限存在，为什么函数不一定有定义？', '自我披露怎样促进人际关系？', '算法的递归该怎么理解？', '英语从句应该怎样分析？'];
  const answers = ['极限描述的是自变量趋近某一点时，函数值趋近的状态。函数在该点没有定义，仍然可能在趋近过程中接近确定的数值。例如，约分前后的表达式只在分母不为零的范围内相等。不能直接把约分结果当作原函数在该点的定义。', '自我披露是向他人分享个人信息、感受或经历的过程。适当的披露能够帮助双方理解彼此。披露的深度应当与关系发展和情境相适应，需要尊重边界，并留意对方是否愿意回应。', '递归是把一个问题转成同类的更小问题。先明确停止条件，再明确如何缩小问题规模。执行时会保留当前状态，等更小问题得到答案后再回来处理。可以先从最简单的输入开始跟踪。', '分析从句时，先找主句的主语和谓语，再辨认从句的连接词。连接词承担的成分和从句在主句中的位置，能够帮助判断其作用。先厘清句子结构，再尝试解释语义，避免只按单词顺序猜测。'];
  for (let index = 0; index < questions.length; index++) {
    run('INSERT INTO qa_messages VALUES(?,?,?,?,?,?)', index * 2 + 1, index + 1, 'user', questions[index], '{}', '2026-11-01T01:00:00Z');
    run('INSERT INTO qa_messages VALUES(?,?,?,?,?,?)', index * 2 + 2, index + 1, 'assistant', answers[index], JSON.stringify({ subjName: index ? '通识学习' : '微积分基础', teacher: '测试教师' }), '2026-11-01T01:00:01Z');
  }
  const calls = [];
  let duringAI = null;
  const service = createLearningFeedService({ q, q1, run, getSettings: () => settings, nowISO: () => '2026-11-02T02:30:00Z',
    getVodUrls: async () => [{ url: 'https://video.example.edu/mock.mp4', message: '教师画面' }],
    askDeepSeek: async (...args) => {
      calls.push(args); await duringAI?.();
      const user = JSON.parse(args[2]);
      if (user.userComment) return JSON.stringify({ text: '你指出了一个值得核对的条件。请把它放回文章的原材料里：如果删掉这个条件，你的判断还会成立吗？给一个具体反例试试。', sourceIds: [user.sources[0].id], assessment: { stage: '概念联系待核对', observation: '这条回复提出了立场，还需要把依据说具体。', evidenceQuote: user.userComment.slice(0, 30), nextStep: '从原材料选一句话，解释它怎样支持你的判断。' } });
      return JSON.stringify({ title: '那句没回的消息，真值得你替他作答吗？', dek: '把没说出口的话，放到另一边想一想。', body: '极限描述的是自变量趋近某一点时函数值趋近的状态。'.repeat(8), replies: [], myth: { statement: '存在极限就代表该点有定义。', answer: false, explanation: '来源材料区分了极限与定义。', sourceIds: [user.sources[0].id] }, sourceIds: user.sources.map((item) => item.id), seedComments: ['我先站反方：这个条件改变之后，原来的结论也要重新核对。', '我支持继续讨论，但请把论据对应到原材料里的具体一句。', '换一个情境来想，给一个会让原结论失效的反例怎么样？'].map((text) => ({ text, sourceIds: [user.sources[0].id] })) });
    }, ...overrides });
  service.initialize();
  const schedule = { ok: true, slots: q('SELECT s.*,c.name AS course_name FROM schedule_slots s JOIN courses c ON c.id=s.course_id'), semester: { name: settings.termName, firstWeekMonday: settings.termStart, totalWeeks: 18 }, periods: fixturePeriods };
  const addMark = (changes = {}) => service.addMark({ id: 'marker-one', kind: 'unclear', slotId: 1, date: '2026-11-02', at: Date.parse('2026-11-02T10:20:00+08:00'), ...changes });
  return { db, q, q1, run, service, settings, calls, schedule, addMark, setDuringAI: (callback) => { duringAI = callback; } };
}
