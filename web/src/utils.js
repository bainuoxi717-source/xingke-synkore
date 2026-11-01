export const pad = (n) => String(n).padStart(2, '0');

// PPT 图片走工作台代理：学校服务器并发加载会自动断连（net::ERR_CONNECTION_CLOSED），
// 由后端代取 + 本地缓存后，前端只请求本机 → 稳定且秒开。
export function pptSrc(url) {
  if (!url) return '';
  if (url.startsWith('/api/')) return url;
  return '/api/ppt/image?u=' + encodeURIComponent(url);
}

export const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtTime(min) {
  if (min == null) return '—';
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

// 相对截止描述：今天 / 明天 / x天后 / 已逾期x天
export function dueLabel(iso) {
  if (!iso) return '未设截止';
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  const diff = Math.round((dayStart - todayStart) / 86400000);
  if (diff < 0) return `已逾期 ${-diff} 天`;
  if (diff === 0) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())} 截止`;
  if (diff === 1) return '明天截止';
  if (diff <= 7) return `${diff} 天后截止`;
  return fmtDateTime(iso);
}

export const TYPE_COLORS = {
  作业: '#6366f1',
  测验: '#f59e0b',
  考试: '#ef4444',
  项目: '#10b981',
  阅读: '#8b5cf6',
  其他: '#64748b',
};
