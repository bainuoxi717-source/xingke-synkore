// Canvas REST API 同步引擎
// 文档: https://canvas.instructure.com/doc/api/

const COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

async function canvasFetch(base, auth, path, page = 1, per = 100) {
  const u = new URL(base + '/api/v1' + path);
  u.searchParams.set('per_page', String(per));
  u.searchParams.set('page', String(page));
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.cookie) headers.Cookie = auth.cookie;
  const res = await fetch(u, { headers });
  if (!res.ok) {
    const err = new Error(`Canvas 请求失败 (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  const link = res.headers.get('link') || '';
  const hasNext = /<[^>]+>;\s*rel="next"/.test(link) ? page + 1 : null;
  return { data: await res.json(), next: hasNext };
}

export async function listCanvasCourses(auth) {
  let page = 1;
  const out = [];
  while (page && page <= 20) {
    const { data, next } = await canvasFetch(auth.base, auth, '/courses', page);
    out.push(...data);
    page = next;
  }
  return out;
}

export async function listCanvasAssignments(auth, courseId) {
  let page = 1;
  const out = [];
  while (page && page <= 20) {
    // 注意：不用 bucket=upcoming —— 交大老师多数不填截止时间，
    // upcoming 会把「无 DDL」和「已过期」的作业全部过滤掉
    const { data, next } = await canvasFetch(
      auth.base, auth,
      `/courses/${courseId}/assignments?order_by=due_at`,
      page
    );
    out.push(...data);
    page = next;
  }
  return out;
}

// 学生待办（Canvas 已判定「未提交」的作业）
export async function listCanvasTodo(auth) {
  let page = 1;
  const out = [];
  while (page && page <= 10) {
    const { data, next } = await canvasFetch(auth.base, auth, '/users/self/todo', page);
    out.push(...data);
    page = next;
  }
  return out;
}

// 课程公告（含已读/未读状态）
export async function listCanvasAnnouncements(auth, courseId) {
  let page = 1;
  const out = [];
  while (page && page <= 10) {
    const { data, next } = await canvasFetch(
      auth.base, auth,
      `/courses/${courseId}/discussion_topics?only_announcements=true`,
      page
    );
    out.push(...data);
    page = next;
  }
  return out;
}

// 课程文件（老师的 PPT / PDF 等资料）
export async function listCanvasFiles(auth, courseId) {
  let page = 1;
  const out = [];
  while (page && page <= 20) {
    const { data, next } = await canvasFetch(auth.base, auth, `/courses/${courseId}/files`, page);
    out.push(...data);
    page = next;
  }
  return out;
}

// 下载文件内容（浏览器外的直连下载）
export async function downloadCanvasFile(auth, fileId) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.cookie) headers.Cookie = auth.cookie;
  const res = await fetch(`${auth.base}/files/${fileId}/download?download_frd=1`, { headers });
  if (!res.ok) throw new Error(`Canvas 文件下载失败 (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export function parseCanvasDate(d) {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

export function courseColorFor(index) {
  return COLORS[index % COLORS.length];
}
