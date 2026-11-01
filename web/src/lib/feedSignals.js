import { useEffect, useRef } from 'react';
let tab;
function tabID() { if (tab) return tab; try { tab = sessionStorage.getItem('synkore:reading-tab') || crypto.randomUUID(); sessionStorage.setItem('synkore:reading-tab', tab); } catch { tab = crypto.randomUUID(); } return tab; }
export async function sendFeedSignal(postId, data, keepalive = false) {
  const response = await fetch(`/api/learning-feed/posts/${encodeURIComponent(postId)}/signals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), ...data }), keepalive });
  if (!response.ok) throw new Error('本次阅读反馈未保存'); return response.json();
}
export function useCardSignals(postId, ref) {
  const done = useRef(false);
  useEffect(() => {
    const element = ref.current; let timer;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (!done.current && entry.intersectionRatio >= .55) timer = setTimeout(() => {
        if (document.visibilityState !== 'visible' || document.querySelector('.feed-reader')) return;
        done.current = true; sendFeedSignal(postId, { type: 'impression', sessionId: tabID(), visibleMs: 1100 }).catch(() => {});
      }, 1100);
    }, { threshold: [.55] });
    observer.observe(element); return () => { observer.disconnect(); clearTimeout(timer); };
  }, [postId, ref]);
}
export function readingTick(state, now, visible, focused) {
  const delta = Math.max(0, Math.min(1500, now - state.previous));
  state.previous = now;
  if (visible && focused && now - state.lastActivity < 45000) state.activeMs += delta;
  return state.activeMs;
}
export function useReaderSignals(post, ref) {
  useEffect(() => {
    const element = ref.current, visitId = crypto.randomUUID(), now = performance.now();
    const state = { previous: now, lastActivity: now, activeMs: 0, scroll: 0 }, open = sendFeedSignal(post.id, { type: 'open', visitId }).then(() => true).catch(() => false);
    const tick = () => readingTick(state, performance.now(), document.visibilityState === 'visible', document.hasFocus());
    const interact = () => { state.lastActivity = performance.now(); };
    const depth = () => {
      for (const selector of ['.feed-reader-content', '.feed-reader-spread']) {
        const node = element.querySelector(selector); if (!node) continue;
        const distance = node.scrollHeight - node.clientHeight;
        if (distance > 10) state.scroll = Math.max(state.scroll, Math.min(1, node.scrollTop / distance));
      }
    };
    const flush = (keepalive = false) => { tick(); depth(); return open.then((ready) => ready ? sendFeedSignal(post.id, { type: 'read', visitId, activeMs: Math.round(state.activeMs), scroll: state.scroll }, keepalive) : undefined).catch(() => {}); };
    const visibility = () => { state.previous = performance.now(); if (document.visibilityState !== 'visible' || !document.hasFocus()) flush(true); else interact(); };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
    events.forEach((name) => element.addEventListener(name, interact, { passive: true }));
    element.addEventListener('scroll', depth, true); document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', visibility); window.addEventListener('focus', visibility);
    const timer = setInterval(tick, 1000), checkpoint = setInterval(() => flush(), 15000);
    return () => {
      clearInterval(timer); clearInterval(checkpoint); events.forEach((name) => element.removeEventListener(name, interact)); element.removeEventListener('scroll', depth, true);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', visibility); window.removeEventListener('focus', visibility);
      flush(true).finally(() => window.dispatchEvent(new CustomEvent('synkore:feed-changed')));
    };
  }, [post.id, post.interest, post.format, ref]);
}
export function readerBody(body, ...titles) {
  const key = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const known = new Set(titles.filter(Boolean).map(key)); let text = String(body || '').trim();
  for (let i = 0; i < 3; i++) { const first = text.split('\n')[0].replace(/^#{1,6}\s*/, '').trim(); if (!known.has(key(first))) break; const newline = text.indexOf('\n'); text = newline < 0 ? '' : text.slice(newline + 1).trim(); }
  return text;
}
