// 视频空间（v.sjtu.edu.cn）接入
// 认证链：Canvas Cookie → LTI 1.3 表单链 → jwt_token 里的 accessToken → Bearer 调 API
import { getSettings, setSettings } from '../db.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const API_BASE = 'https://v.sjtu.edu.cn/jy-application-resourcemanage';

// 各课程对应的 Canvas 视频入口（课堂视频新版 id=8329 / 旧版 id=18717）
const VIDEO_TOOL_NEW = 8329;
const VIDEO_TOOL_OLD = 18717;

function makeJar() {
  const jar = new Map();
  return {
    jar,
    absorb(res) {
      const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const line of raw) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    str() { return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '); },
    clear() { jar.clear(); },
  };
}

function parseHiddenForm(html, baseUrl) {
  const fm = html.match(/<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!fm) return null;
  const fields = {};
  for (const m of fm[2].matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi)) fields[m[1]] = m[2];
  for (const m of fm[2].matchAll(/<input[^>]*value=["']([^"']*)["'][^>]*name=["']([^"']+)["']/gi)) fields[m[2]] = m[1];
  return Object.keys(fields).length ? { action: new URL(fm[1] || baseUrl, baseUrl).href, fields } : null;
}

// 走完 LTI 链，拿 accessToken
export async function acquireVideoToken({ courseId, toolId = VIDEO_TOOL_NEW } = {}) {
  const s = getSettings();
  const canvasCookie = String(s.cookie_oc ?? '').trim();
  if (!canvasCookie) throw new Error('请先在「导入与设置」粘贴 Canvas Cookie（获取视频权限需要它）');

  // 选一门课（默认取第一门有 canvas_id 的课程）
  let cid = courseId;
  if (!cid) {
    const row = getSettings().videoCanvasCourseId;
    if (row) cid = Number(row);
  }
  if (!cid) {
    const { q } = await import('../db.js');
    const c = q("SELECT canvas_id FROM courses WHERE canvas_id != '' ORDER BY id LIMIT 1")[0];
    if (!c) throw new Error('本地还没有关联 Canvas 的课程，请先同步 Canvas');
    cid = Number(c.canvas_id);
  }

  const j = makeJar();
  let url = `https://oc.sjtu.edu.cn/courses/${cid}/external_tools/${toolId}?display=borderless`;
  let method = 'GET';
  let body;
  let jwt = null;
  let launchUrl = '';

  for (let hop = 1; hop <= 12; hop++) {
    const host = new URL(url).hostname;
    const headers = { 'User-Agent': UA, Accept: 'text/html,*/*' };
    headers.Cookie = host === 'oc.sjtu.edu.cn'
      ? canvasCookie + (j.jar.size ? '; ' + j.str() : '')
      : j.str();
    if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    j.absorb(res);
    const loc = res.headers.get('location');
    if (loc) {
      const m = loc.match(/jwt_token=([^&#]+)/);
      if (m) { jwt = decodeURIComponent(m[1]); launchUrl = new URL(loc, url).href; }
    }
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).href;
      method = 'GET';
      body = undefined;
      continue;
    }
    const text = await res.text();
    const form = parseHiddenForm(text, url);
    if (form) {
      url = form.action;
      method = 'POST';
      body = new URLSearchParams(form.fields).toString();
      continue;
    }
    break;
  }

  if (!jwt) throw new Error('LTI 启动失败：未取得 jwt_token（Canvas Cookie 可能已过期）');
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
  if (!payload.accessToken) throw new Error('jwt_token 里没有 accessToken');
  const info = {
    accessToken: payload.accessToken,
    exp: payload.exp,
    sub: payload.sub,
    scope: payload.defaultGrantScope,
    courseId: cid,
    launchUrl,
  };
  setSettings({ videoToken: payload.accessToken, videoTokenExp: payload.exp, videoCanvasCourseId: String(cid) });
  return info;
}

// 取可用 token（未过期直接用缓存）
export async function getVideoToken({ force = false } = {}) {
  const s = getSettings();
  const exp = Number(s.videoTokenExp ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!force && s.videoToken && exp > now + 120) {
    return { accessToken: s.videoToken, exp, cached: true };
  }
  return { ...(await acquireVideoToken()), cached: false };
}

export async function videoApi(path, token, method = 'GET', body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'User-Agent': UA, Accept: 'application/json', Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`视频空间接口失败 (HTTP ${res.status})`);
    err.detail = text.slice(0, 200);
    throw err;
  }
  return JSON.parse(text);
}

// 录播课程列表（我参与的课堂）
export async function listVodCourses(pageSize = 50) {
  const { accessToken } = await getVideoToken();
  const j = await videoApi(`/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=${pageSize}`, accessToken);
  const records = j.data?.records ?? [];
  return records.map((r) => ({
    acteId: r.acteId,
    subjCode: r.subjCode,
    subjName: r.subjName,
    teachers: Array.isArray(r.teacNames) ? r.teacNames.join('、') : (r.teacNames ?? ''),
    teclId: r.teclId,
    subjId: r.subjId,
    lectureCount: r.courTimes ?? 0,
    pptSlices: r.coursePptSliceCount ?? 0,
    room: r.clroName ?? '',
    org: (r.orgaNames ?? []).join('、'),
    playCount: Number(r.courPlayCount ?? 0) || 0,
    cover: r.teclImgUrl ?? '',
    id: r.id,
  }));
}

export async function videoAuthority() {
  const { accessToken } = await getVideoToken();
  const j = await videoApi('/authority/me', accessToken);
  return j.result ?? j;
}

// ============ 课次列表（真实课堂记录）============
export async function listLectures(teclId) {
  const { accessToken } = await getVideoToken();
  const path = `/v1/subject_vod_list_new?page.pageIndex=1&page.pageSize=1000&teclIds=${teclId}`
    + '&page.orders%5B0%5D.asc=false&page.orders%5B0%5D.field=courBeginTime&schoolOpenStatusFlag=false';
  const j = await videoApi(path, accessToken);
  const recs = j.data?.records ?? (Array.isArray(j.data) ? j.data : []);
  return recs.map((r) => ({
    courId: r.id,
    teclId: r.teclId ?? Number(teclId),
    subjCode: r.subjCode ?? '',
    subjName: r.subjName ?? '',
    teacher: Array.isArray(r.teclTeacNames) ? r.teclTeacNames.join('、') : (Array.isArray(r.teacNames) ? r.teacNames.join('、') : (r.teacNames ?? '')),
    weekNo: r.weekNo ?? r.weekNumber ?? null,
    letiNumber: r.letiNumber ?? null,
    room: r.clroName ?? '',
    beginTime: r.courBeginTime ?? '',
    endTime: r.courEndTime ?? '',
    durationSec: Math.round((r.videPlayTime ?? 0) || 0) || null,
    shotUrl: r.shotImgUrl ? `https://live.sjtu.edu.cn${r.shotImgUrl.startsWith('http') ? '' : ''}${r.shotImgUrl}` : '',
    watchedPercent: r.watchPercent ?? 0,
    pptStatus: r.coursePptSliceStatus ?? null,
    transcriptStatus: r.transcriptOptimizeTaskStatus ?? null,
    vodStatus: r.vodStatus ?? null,
  }));
}

// 取某课次的播放地址（mp4 直链，带时效签名）
// 来源：播放器调用的 /v1/course_vod_urls_new，返回 courseVodViewList[].url
export async function getVodUrls(courId) {
  const { accessToken } = await getVideoToken();
  const j = await videoApi(`/v1/course_vod_urls_new?courseId=${courId}`, accessToken);
  const list = j?.data?.courseVodViewList ?? [];
  return list
    .filter((x) => x && typeof x.url === 'string' && /^https?:\/\//.test(x.url))
    .map((x) => ({
      url: x.url,
      message: x.message ?? '',
      vodTime: x.vodTime ?? null,
      viewNum: x.viewNum ?? 0,
    }));
}

// AI 功能开关（该课次平台提供了哪些 AI 能力）
export async function aiCapabilities(courId) {
  const { accessToken } = await getVideoToken();
  try {
    const j = await videoApi('/v1/course/ai/getAiFunctionShow', accessToken, 'POST', { courseId: Number(courId) });
    return j.data ?? {};
  } catch { return {}; }
}

// 字幕（带时间轴）：平台 AI 转写结果
export async function getTranscript(courId) {
  const { accessToken } = await getVideoToken();
  try {
    const j = await videoApi(`/v1/course/ai/translate/${courId}?useOriginal=true`, accessToken);
    const list = j.data?.afterAssemblyList ?? [];
    const segs = list.map((s) => ({ start: Number(s.bg ?? 0), end: Number(s.ed ?? 0), text: String(s.res ?? s.zh ?? '').trim() }))
      .filter((s) => s.text);
    return { segments: segs, text: segs.map((s) => s.text).join('') };
  } catch (e) {
    return { segments: [], text: '', error: e.message };
  }
}

// AI 总结 / 思维导图
export async function getSummary(courId) {
  const { accessToken } = await getVideoToken();
  try {
    const j = await videoApi(`/v1/course/ai/textSummary/${courId}`, accessToken);
    return j.data ?? null;
  } catch (e) {
    return { error: e.message };
  }
}

// PPT 切片（图片 + OCR 文本）
export async function getPptSlices(courId) {
  const { accessToken } = await getVideoToken();
  try {
    const j = await videoApi(`/v1/course/ai/ppt?courseId=${courId}`, accessToken);
    const list = j.data?.docList ?? [];
    return list.map((d) => ({
      imageId: d.imageId,
      seek: d.imageSeekTime,
      url: d.imageUrl,
      ocr: (d.ocrText ?? '').replace(/\u0000/g, '').trim(),
    }));
  } catch (e) {
    return [];
  }
}
