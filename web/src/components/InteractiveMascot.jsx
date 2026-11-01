import { useEffect, useRef, useState } from 'react';

export default function InteractiveMascot({ motion }) {
  const rootRef = useRef(null), controllerRef = useRef(null), motionRef = useRef(motion);
  const [status, setStatus] = useState('loading');
  motionRef.current = motion;
  useEffect(() => {
    let cancelled = false;
    import('../lib/mascot3d.js').then(({ mountMascot3D }) => {
      if (cancelled) return;
      try {
        controllerRef.current = mountMascot3D(rootRef.current, {
          motion: motionRef.current,
          onReady: () => !cancelled && setStatus('ready'),
          onError: () => !cancelled && setStatus('fallback'),
        });
      } catch { if (!cancelled) setStatus('fallback'); }
    }).catch(() => !cancelled && setStatus('fallback'));
    return () => { cancelled = true; controllerRef.current?.dispose(); controllerRef.current = null; };
  }, []);
  useEffect(() => { controllerRef.current?.setMotion(motion); }, [motion]);
  return <div ref={rootRef} className="mascot-3d" role="group" tabIndex={0} data-status={status}
    aria-label={status === 'fallback' ? '微笑的小幽灵' : '小幽灵，可拖动旋转。方向键旋转，Home 或双击回正。背面刻字：made by 闵交幼儿园'}
    aria-describedby="mascot-rotate-hint" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home">
    <div className="mascot-3d-viewport" aria-hidden="true" />
    {status !== 'ready' && <img className="mascot-3d-fallback" src="/assets/learning-mascot/mascot-smile.png" alt="" draggable="false" />}
    {status !== 'fallback' && <span className="mascot-rotate-hint" id="mascot-rotate-hint"><span aria-hidden="true">↔</span> 拖动旋转<span className="mascot-keyboard-hint"> · 方向键旋转，Home 回正</span></span>}
  </div>;
}
