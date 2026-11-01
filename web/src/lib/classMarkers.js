const PREFIX = 'synkore:pending-class-mark:';
export function pendingClassMarks() {
  try { return Object.keys(localStorage).filter((key) => key.startsWith(PREFIX)).map((key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
export async function sendClassMark(mark) {
  let backedUp = false;
  try { localStorage.setItem(PREFIX + mark.id, JSON.stringify(mark)); backedUp = true; } catch { /* Server remains the primary durable store. */ }
  try {
    const response = await fetch('/api/learning-feed/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mark) });
    const result = await response.json();
    if (!response.ok) {
      const permanent = [400, 404, 409, 422].includes(response.status);
      if (permanent) { try { localStorage.removeItem(PREFIX + mark.id); } catch {} backedUp = false; }
      throw Object.assign(new Error(result.error || '标记暂时未同步'), { permanent });
    }
    try { localStorage.removeItem(PREFIX + mark.id); } catch {}
    window.dispatchEvent(new CustomEvent('synkore:feed-changed'));
    return result.mark;
  } catch (error) { error.pending = backedUp; throw error; }
}
export async function syncPendingClassMarks() {
  const results = [];
  for (const mark of pendingClassMarks().slice(0, 100)) {
    try { results.push(await sendClassMark(mark)); } catch (error) { if (!error.permanent) break; }
  }
  return results;
}
