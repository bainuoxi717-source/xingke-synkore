import { useCallback, useEffect, useRef, useState } from 'react';
import { redactShowcaseText } from '../utils/showcasePrivacy.js';

const STORAGE = 'personal-agent:readout-voice';
export default function useVoiceReadout() {
  const [voice, setVoiceValue] = useState(() => { try { return localStorage.getItem(STORAGE) || ''; } catch { return ''; } });
  const [catalog, setCatalog] = useState(null), [error, setError] = useState('');
  const [active, setActive] = useState(null), [progress, setProgress] = useState('');
  const current = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/voices/status', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('音色列表暂时无法读取');
      setCatalog(await response.json());
    }).catch((e) => { if (!controller.signal.aborted) setCatalog({ teachers: [], error: e.message }); });
    return () => controller.abort();
  }, []);
  const stop = useCallback(() => {
    const run = current.current; current.current = null;
    if (run) {
      run.stopped = true; run.controller?.abort();
      if (run.audio) { run.audio.onended = null; run.audio.onerror = null; run.audio.pause(); }
      if (run.url) URL.revokeObjectURL(run.url);
      run.resolve?.();
    }
    try { window.speechSynthesis?.cancel(); } catch {}
    setActive(null); setProgress('');
  }, []);
  useEffect(() => () => stop(), [stop]);
  const setVoice = (value) => {
    stop(); setError(''); setVoiceValue(value);
    try { if (value) localStorage.setItem(STORAGE, value); else localStorage.removeItem(STORAGE); } catch {}
  };
  const read = async (text, key) => {
    if (current.current?.key === key) { stop(); return; }
    stop(); setError('');
    const clean = String(text || '').replace(/[#*`>|_~\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const run = { key, stopped: false }; current.current = run; setActive(key);
    try {
      if (voice && !catalog?.teachers?.some((item) => item.teacher === voice && item.hasVoice)) throw new Error('所选音色暂不可用，请重新选择');
      if (voice && !catalog.enabled) throw new Error('请在设置中开启老师音色');
      const chunks = clean.match(/[\s\S]{1,1000}/g) || [];
      for (let index = 0; index < chunks.length && !run.stopped; index++) {
        setProgress(`${index + 1}/${chunks.length} 段`);
        if (voice) {
          run.controller = new AbortController();
          const response = await fetch('/api/tts?' + new URLSearchParams({ teacher: voice, text: chunks[index] }), { signal: run.controller.signal });
          if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
            const detail = await response.json().catch(() => ({})); throw new Error(detail.error || '所选音色朗读失败');
          }
          const blob = await response.blob(); if (run.stopped) break;
          run.url = URL.createObjectURL(blob); run.audio = new Audio(run.url);
          await new Promise((resolve, reject) => {
            run.resolve = resolve; run.audio.onended = resolve;
            run.audio.onerror = () => reject(new Error('音频播放失败，请重新朗读'));
            run.audio.play().catch(reject);
          });
          if (run.url) { URL.revokeObjectURL(run.url); run.url = null; }
        } else {
          if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) throw new Error('当前浏览器不支持系统朗读，请选择已克隆音色');
          await new Promise((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(chunks[index]); utterance.lang = 'zh-CN'; utterance.rate = 1;
            run.resolve = resolve; utterance.onend = resolve;
            utterance.onerror = () => run.stopped ? resolve() : reject(new Error('系统朗读未完成'));
            window.speechSynthesis.speak(utterance);
          });
        }
      }
    } catch (e) {
      if (!run.stopped) {
        const message = /insufficient balance/i.test(e.message) ? 'MiniMax 余额不足，暂时无法生成克隆音色朗读。' : e.message;
        setError(redactShowcaseText(message, [voice, ...(catalog?.teachers || []).map((item) => item.teacher)]));
      }
    } finally { if (current.current === run) stop(); }
  };
  return { voice, setVoice, catalog, active, progress, error, read, stop };
}
