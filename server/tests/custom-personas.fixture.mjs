import { DatabaseSync } from 'node:sqlite';
import { createCustomPersonaService } from '../src/services/custom-personas.js';
export const materialOne = '解释一个新概念时，先找学生熟悉的例子。然后让学生指出条件为什么成立，再用一个反例说明边界。不要把结论背下来就当作理解。';
export const materialTwo = '写一段说明时，先想读者知道什么，再从一个具体场景出发。讲完以后换一个条件，看看原来的说法还是否成立。表达清楚也需要交代不知道什么。';
export const fixtureInput = () => ({ name: '测试讲师', goal: '从具体例子出发，讲清课程条件。', manual: [
  { label: '数学课堂原文', text: materialOne.repeat(3), context: '数学教学', attribution: 'target', url: 'https://example.com/original-math' },
  { label: '写作访谈原文', text: materialTwo.repeat(3), context: '写作', attribution: 'target', url: 'https://example.com/original-writing' },
], attachmentIds: [], annotations: {} });
export function profileResponse(sources) {
  return { summary: '先从熟悉的例子入手，再用条件和反例检验理解。', methods: [{ name: '例子与条件来回核对', trigger: '学生第一次遇到抽象概念时', steps: ['找一个学生熟悉的具体情境。', '指出成立条件，再换一个条件检验。'], output: '给出带边界的解释。', limits: ['陌生例子可能增加理解负担。'], validation: { crossContext: true, generative: true, distinctive: true }, evidence: sources.slice(0, 2).map((s) => ({ sourceId: s.id, quote: s.text.slice(0, 16), kind: 'pattern' })) }],
    heuristics: [{ when: '结论听起来顺', then: '换一个条件重新判断', unless: '原材料没有给出该条件', evidence: [{ sourceId: sources[0].id, quote: sources[0].text.slice(0, 16), kind: 'direct' }] }],
    expression: [{ rule: '先具体后抽象，用一个问题检验条件。', evidence: [{ sourceId: sources[0].id, quote: sources[0].text.slice(0, 16), kind: 'pattern' }] }], sequence: ['从熟悉的例子开始。', '列条件并提一个反例。'], boundaries: ['资料没有覆盖这位讲师的全部课程。'], tensions: [], gaps: ['缺少最近一年资料。'], tryQuestions: ['什么情况下不能把一个例子推广为规律？', '如何向新同学解释一个陌生概念？', '怎样反驳省略条件的结论？', '对于未讨论的领域应如何保留不确定性？', '用100字解释一个条件的作用。'] };
}
export function customFixture(overrides = {}) {
  const db = new DatabaseSync(':memory:'), q = (sql, ...args) => db.prepare(sql).all(...args), q1 = (sql, ...args) => db.prepare(sql).get(...args) || null, run = (sql, ...args) => db.prepare(sql).run(...args);
  const settings = { deepseekKey: 'fake-custom-key', aiModel: 'fake-custom-model' }, calls = { model: [], search: [], fetch: [], read: [] }, attachments = new Map();
  let now = '2026-11-01T04:00:00Z', duringModel = null;
  const service = createCustomPersonaService({ q, q1, run, getSettings: () => settings, nowISO: () => now,
    readAttachments: async (ids) => { calls.read.push(ids); return ids.map((id) => attachments.get(id) || { id, name: '未解析资料', text: '', status: 'unsupported', notice: '尚未接入内容解析' }); },
    askDeepSeek: async (...args) => { calls.model.push(args); await duringModel?.(); const input = JSON.parse(args[2]); return JSON.stringify(input.results ? { people: input.results.slice(0, 2).map((hit) => ({ name: input.name, quote: hit.summary, resultIds: [hit.id] })) } : profileResponse(input.sources)); },
    search: async (key, query) => { calls.search.push({ key, query }); if (query.includes('人物 身份')) return [{ title: '测试讲师 · 数学教师', summary: '测试讲师，在中学教授数学，常用例子说明条件。', url: 'https://example.com/math-teacher' }, { title: '测试讲师 · 作家', summary: '测试讲师，小说作家，关注写作与表达。', url: 'https://example.com/writer' }]; const dimension = query.includes('深度访谈') ? 'dialogue' : query.includes('原始发言') ? 'expression' : query.includes('论文') ? 'research' : query.includes('案例') ? 'practice' : query.includes('早期') ? 'evolution' : 'writings'; return Array.from({ length: 5 }, (_, i) => ({ title: `测试原文 ${dimension} ${i}`, url: `https://example.com/${dimension}/${i}`, summary: '此摘要仅用于测试，不充当原文。', site_name: '原文站点' })); },
    fetchPage: async (key, url) => { calls.fetch.push({ key, url }); return { title: `已读取的测试原文 ${calls.fetch.length}`, content: (calls.fetch.length % 2 ? materialOne : materialTwo).repeat(8) }; }, ...overrides });
  service.initialize();
  const id = 'd-11111111-1111-4111-8111-111111111111';
  const save = (input = fixtureInput()) => service.save(id, input);
  const approve = async (action = 'generate', candidateIds) => ({ ...(await service.plan(id, { action, candidateIds })).plan, approved: true });
  const execute = (plan) => service.execute(id, { planId: plan.id, approvalHash: plan.approvalHash, approved: plan.approved });
  return { db, q, q1, run, settings, calls, attachments, service, id, save, approve, execute, setNow: (value) => { now = value; }, setDuringModel: (fn) => { duringModel = fn; } };
}
