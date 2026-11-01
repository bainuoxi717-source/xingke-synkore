// One versioned note per lecture. Reading/importing never starts paid generation.
import { q, q1, run, nowISO, getSettings } from '../db.js';
import { askDeepSeek, DEFAULT_MODEL } from './ai.js';
import { NOTES_RECIPE_VERSION, NOTE_MIN_CHARACTERS, NOTE_MAX_OUTPUT_TOKENS,
  prepareLectureSource, chunkLectureSource, generateLectureNotes } from './notes-recipe.js';
export { notesToMarkdown, NOTES_RECIPE_VERSION } from './notes-recipe.js';

const LABELS = { pending: '待整理', ready: '已整理', stale: '需更新', error: '整理失败', waiting: '等待材料', running: '整理中' };
const inFlight = new Set();
const parseNote = (value) => { try { const note = JSON.parse(value || 'null'); return note && typeof note === 'object' && !Array.isArray(note) ? note : null; } catch { return null; } };

export function ensureDistillColumns() {
  const cols = q('PRAGMA table_info(lectures)').map((column) => column.name);
  for (const name of ['distill_json', 'distill_error', 'distill_attempt_hash']) {
    if (!cols.includes(name)) run(`ALTER TABLE lectures ADD COLUMN ${name} TEXT DEFAULT ''`);
  }
  run(`CREATE TABLE IF NOT EXISTS lecture_note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cour_id INTEGER NOT NULL,
    notes_json TEXT NOT NULL, source_hash TEXT DEFAULT '', recipe_version TEXT DEFAULT '',
    created_at TEXT DEFAULT '', archived_at TEXT NOT NULL
  )`);
}

export function noteTaskForRow(row) {
  const source = prepareLectureSource(row);
  const notes = parseNote(row.distill_json);
  const hasNotes = Boolean(notes);
  const legacy = hasNotes && !notes._meta?.sourceHash;
  const current = hasNotes && notes._meta?.sourceHash === source.sourceHash && notes._meta?.recipeVersion === NOTES_RECIPE_VERSION;
  const readyToGenerate = source.characters >= NOTE_MIN_CHARACTERS;
  const failedCurrent = Boolean(row.distill_error) && (!row.distill_attempt_hash || row.distill_attempt_hash === source.sourceHash);
  let status = current ? 'ready' : failedCurrent ? 'error' : hasNotes ? 'stale' : readyToGenerate ? 'pending' : 'waiting';
  if (inFlight.has(String(row.cour_id))) status = 'running';
  const chunks = chunkLectureSource(source);
  return {
    courId: row.cour_id, courseId: row.course_id, subject: row.subj_name || '', teacher: row.teacher || '',
    beginTime: row.begin_time || '', leti: row.leti_number, status, statusLabel: LABELS[status],
    hasNotes, legacy, readyToGenerate, sourceHash: source.sourceHash, recipeVersion: NOTES_RECIPE_VERSION,
    noteSourceHash: notes?._meta?.sourceHash || '', noteRecipeVersion: notes?._meta?.recipeVersion || '',
    distilledAt: row.distilled_at || notes?._meta?.distilledAt || '',
    chunkCount: chunks.length, inputCharacters: source.characters, estimatedCalls: chunks.length,
    maxCalls: chunks.length * 2, maxOutputTokensPerCall: NOTE_MAX_OUTPUT_TOKENS,
    error: failedCurrent ? String(row.distill_error) : '',
  };
}

// A derived queue: no INSERTs, model calls or source refreshes occur while reading it.
// Imported lectures appear as pending automatically; old notes remain readable as stale.
export function listNoteTasks({ teacher = '', subject = '', status = '', limit = 200, offset = 0 } = {}) {
  const conditions = [], args = [];
  if (teacher) { conditions.push('teacher = ?'); args.push(String(teacher)); }
  if (subject) { conditions.push('subj_name = ?'); args.push(String(subject)); }
  const rows = q(`SELECT * FROM lectures${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY begin_time DESC, cour_id DESC`, ...args);
  const all = rows.map(noteTaskForRow);
  const counts = Object.fromEntries(Object.keys(LABELS).map((key) => [key, all.filter((item) => item.status === key).length]));
  const filtered = status ? all.filter((item) => item.status === status) : all;
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const size = Math.min(1000, Math.max(1, Math.trunc(Number(limit) || 200)));
  return { items: filtered.slice(start, start + size), total: filtered.length, counts, recipeVersion: NOTES_RECIPE_VERSION,
    model: getSettings().aiModel || DEFAULT_MODEL,
    summary: { total: all.length, distillable: all.filter((item) => item.readyToGenerate).length,
      distilled: all.filter((item) => item.hasNotes).length,
      pending: all.filter((item) => item.readyToGenerate && !['ready', 'running'].includes(item.status)).length } };
}

export function planLectureNotes(courId) {
  const row = q1('SELECT * FROM lectures WHERE cour_id = ?', Number(courId));
  if (!row) return { ok: false, error: '课次不存在', code: 'not_found' };
  const task = noteTaskForRow(row);
  const source = prepareLectureSource(row);
  return { ok: true, ...task, model: getSettings().aiModel || DEFAULT_MODEL, requiresConfirmation: task.readyToGenerate && task.status !== 'ready',
    sources: { transcriptSegments: source.units.filter((unit) => unit.kind === 'transcript').length,
      pptPages: source.units.filter((unit) => unit.kind === 'slide').length, textSource: source.textSource,
      availableTextCoverage: 'all', captureCompleteness: 'unknown' },
    billing: { provider: 'DeepSeek', estimatedCalls: task.estimatedCalls, maxCalls: task.maxCalls,
      maxOutputTokensPerCall: NOTE_MAX_OUTPUT_TOKENS, exactCostKnown: false,
      note: '按模型实际用量计费；每个材料分块仅在JSON格式无效时重试一次。' },
  };
}

export async function distillLecture(courId, { force = false, approved = false, expectedSourceHash,
  expectedRecipeVersion, expectedModel, onProgress = () => {} } = {}) {
  const row = q1('SELECT * FROM lectures WHERE cour_id = ?', Number(courId));
  if (!row) return { ok: false, error: '课次不存在', code: 'not_found' };
  const task = noteTaskForRow(row);
  const existing = parseNote(row.distill_json);
  if (!force && task.status === 'ready') return { ok: true, skipped: true, reason: '当前材料版本已整理', courId: row.cour_id, notes: existing };
  if (!task.readyToGenerate) return { ok: false, error: '可读取的课堂文字不足，等待字幕或课件材料', code: 'waiting_for_source', plan: planLectureNotes(courId) };
  if (!approved) return { ok: false, needsConfirmation: true, code: 'confirmation_required', error: '需要确认本次生成范围与模型用量后才能开始', plan: planLectureNotes(courId) };
  if (expectedSourceHash !== task.sourceHash || expectedRecipeVersion !== NOTES_RECIPE_VERSION) {
    return { ok: false, needsConfirmation: true, code: 'source_changed', error: '材料或整理规则版本已变化，请重新核对本次生成计划', plan: planLectureNotes(courId) };
  }
  if (inFlight.has(String(row.cour_id))) return { ok: false, code: 'already_running', error: '这节课正在整理中' };
  const settings = getSettings();
  if (expectedModel !== (settings.aiModel || DEFAULT_MODEL)) return { ok: false, needsConfirmation: true, code: 'model_changed', error: '模型配置已变化，请重新确认本次调用计划', plan: planLectureNotes(courId) };
  if (!settings.deepseekKey) return { ok: false, error: '未配置 AI Key', code: 'missing_key' };
  ensureDistillColumns();
  const source = prepareLectureSource(row);
  const key = String(row.cour_id);
  inFlight.add(key);
  try {
    run('UPDATE lectures SET distill_attempt_hash = ?, distill_error = ? WHERE cour_id = ?', source.sourceHash, '', row.cour_id);
    const notes = await generateLectureNotes(source, {
      model: settings.aiModel || DEFAULT_MODEL,
      ask: (system, user, options) => askDeepSeek(settings.deepseekKey, system, user, options), onProgress,
    });
    // Do not overwrite a newer source's notes if a sync changed the lecture mid-generation.
    const latest = q1('SELECT * FROM lectures WHERE cour_id = ?', row.cour_id);
    if (!latest || prepareLectureSource(latest).sourceHash !== source.sourceHash) {
      return { ok: false, code: 'source_changed_during_generation', error: '生成期间课堂材料发生变化，已保留现有笔记，请重新核对生成计划' };
    }
    run('BEGIN IMMEDIATE');
    try {
      if (latest.distill_json) {
        const old = parseNote(latest.distill_json);
        run('INSERT INTO lecture_note_versions (cour_id, notes_json, source_hash, recipe_version, created_at, archived_at) VALUES (?,?,?,?,?,?)',
          row.cour_id, latest.distill_json, old?._meta?.sourceHash || '', old?._meta?.recipeVersion || '', latest.distilled_at || '', nowISO());
      }
      run('UPDATE lectures SET distill_json = ?, distilled_at = ?, distill_error = ?, distill_attempt_hash = ? WHERE cour_id = ?',
        JSON.stringify(notes), notes._meta.distilledAt, '', source.sourceHash, row.cour_id);
      run('COMMIT');
    } catch (error) { run('ROLLBACK'); throw error; }
    return { ok: true, courId: row.cour_id, subject: row.subj_name, beginTime: row.begin_time, notes };
  } catch (error) {
    const message = String(error.message || '笔记整理失败').slice(0, 500);
    run('UPDATE lectures SET distill_error = ?, distill_attempt_hash = ? WHERE cour_id = ?', message, source.sourceHash, row.cour_id);
    const providerStatus = Number(error.status) || 0;
    const code = providerStatus === 401 ? 'provider_auth_failed' : providerStatus === 402 ? 'provider_quota_exhausted'
      : providerStatus === 429 ? 'provider_rate_limited' : providerStatus >= 500 || error.name === 'TypeError' ? 'provider_unavailable' : 'generation_failed';
    return { ok: false, error: message, code, hasPreviousNotes: Boolean(existing) };
  } finally { inFlight.delete(key); }
}

// Exact batch scope must be provided by the approving UI. New lectures never join a running batch.
export async function distillPending({ limit = 3, courIds = [], approved = false, expectedHashes = {},
  expectedRecipeVersion, expectedModel, force = false, onProgress = () => {} } = {}) {
  const pending = listNoteTasks({ limit: 1000 }).items.filter((item) => item.readyToGenerate && item.status !== 'ready' && item.status !== 'running');
  if (!approved) return { ok: false, needsConfirmation: true, code: 'confirmation_required', pending: pending.length,
    done: 0, failed: 0, items: pending.slice(0, Math.min(1000, Math.max(1, Number(limit) || 3))) };
  const ids = [...new Set(Array.isArray(courIds) ? courIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : [])];
  if (!ids.length || ids.length > 1000) return { ok: false, code: 'invalid_batch', error: '请提供本次明确批准的课次列表' };
  const plans = ids.map(planLectureNotes);
  if (expectedRecipeVersion !== NOTES_RECIPE_VERSION || plans.some((plan) => !plan.ok || expectedHashes[String(plan.courId)] !== plan.sourceHash)) {
    return { ok: false, needsConfirmation: true, code: 'source_changed', error: '批次材料或规则版本发生变化，请重新确认', items: plans };
  }
  if (expectedModel !== (getSettings().aiModel || DEFAULT_MODEL)) return { ok: false, needsConfirmation: true, code: 'model_changed', error: '模型配置已变化，请重新确认本批次计划' };
  const report = { ok: true, pending: ids.length, done: 0, failed: 0, skipped: 0, items: [] };
  for (const id of ids) {
    const result = await distillLecture(id, { approved: true, force, expectedSourceHash: expectedHashes[String(id)], expectedRecipeVersion, expectedModel });
    if (result.ok) { result.skipped ? report.skipped++ : report.done++; } else { report.failed++; }
    const item = { courId: id, subject: result.subject || plans.find((plan) => plan.courId === id)?.subject || '',
      ok: result.ok, skipped: Boolean(result.skipped), summary: result.notes?.summary || '', error: result.error || '', code: result.code };
    report.items.push(item); report.pending--;
    onProgress(item);
    // Credential/quota errors should not cause repeated paid work across the batch.
    if (['missing_key', 'source_changed', 'model_changed', 'confirmation_required', 'provider_auth_failed',
      'provider_quota_exhausted', 'provider_rate_limited', 'provider_unavailable'].includes(result.code)) break;
  }
  return report;
}

export function distillStatus() {
  const queue = listNoteTasks({ limit: 1000 });
  return { ...queue.summary,
    errors: queue.counts.error, stale: queue.counts.stale, ready: queue.counts.ready,
    waiting: queue.counts.waiting, running: queue.counts.running, recipeVersion: NOTES_RECIPE_VERSION };
}
