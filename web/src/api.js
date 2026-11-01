// 后端 API 封装
const j = (r) => {
  if (!r.ok) throw new Error(`请求失败: ${r.status}`);
  return r.json();
};

export const api = {
  get: (u) => fetch('/api' + u).then(j),
  post: (u, b) =>
    fetch('/api' + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then(j),
  put: (u, b) =>
    fetch('/api' + u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then(j),
  patch: (u, b) =>
    fetch('/api' + u, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then(j),
  del: (u) => fetch('/api' + u, { method: 'DELETE' }).then(j),
};
