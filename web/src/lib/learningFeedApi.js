export async function feedRequest(url, body, signal) {
  const response = await fetch(`/api/learning-feed${url}`, { signal, ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw Object.assign(new Error(result.error || (result.needsConfirmation ? '请先确认本次模型调用' : '学习流暂时未连接')), { result });
  return result;
}
