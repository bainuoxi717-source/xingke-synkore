import { useEffect, useId, useRef, useState } from 'react';
import InteractiveMascot from './InteractiveMascot.jsx';
import '../learning-mascot.css';

// Coordinates are tied to the transparent 1254px character master. Keeping the
// face separate from the body gives every expression the same silhouette.
export const MASCOT_FACE_TRANSFORM = 'matrix(1 0.124 0 1 310 430)';

const STARS = [
  [17, 48, 2, 0], [26, 23, 1.4, -3], [38, 73, 1.5, -6],
  [68, 16, 1.5, -2], [79, 37, 2.2, -7], [86, 63, 1.3, -4],
  [23, 80, 1.1, -8], [72, 81, 1.8, -1], [52, 10, 1, -5],
];
const PLANETS = [['assistant', '个性化助手', 0], ['feed', '信息流学习', Math.PI], ['classroom', '随堂伴学', Math.PI / 3]];

function Orbit({ front = false, id }) {
  return <svg className={`mascot-orbit mascot-orbit-${front ? 'front' : 'back'}`} viewBox="0 0 600 300" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-light`} x1="70" y1="220" x2="530" y2="60" gradientUnits="userSpaceOnUse">
        <stop stopColor="#9abfce" stopOpacity=".12" />
        <stop offset=".28" stopColor="#cceba7" stopOpacity=".8" />
        <stop offset=".55" stopColor="#eee1a2" stopOpacity=".68" />
        <stop offset=".78" stopColor="#99c7de" stopOpacity=".85" />
        <stop offset="1" stopColor="#b7d5a2" stopOpacity=".12" />
      </linearGradient>
      <filter id={`${id}-bloom`} x="-100%" y="-400%" width="300%" height="900%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
    </defs>
    <g transform="rotate(-13 300 150)">
      <path className="mascot-orbit-glow" d={front ? 'M 66 150 A 234 72 0 0 0 534 150' : 'M 66 150 A 234 72 0 0 1 534 150'} stroke={`url(#${id}-light)`} strokeWidth="5" filter={`url(#${id}-bloom)`} />
      <path className="mascot-orbit-line" d={front ? 'M 66 150 A 234 72 0 0 0 534 150' : 'M 66 150 A 234 72 0 0 1 534 150'} stroke={`url(#${id}-light)`} strokeWidth="1.2" />
      <path className="mascot-orbit-dust" d={front ? 'M 66 150 A 234 72 0 0 0 534 150' : 'M 66 150 A 234 72 0 0 1 534 150'} stroke="#e5efd0" strokeWidth="1.6" strokeDasharray=".6 29 .9 17 1 41" strokeLinecap="round" />
      {front && <path className="mascot-orbit-inner" d="M 99 156 A 201 53 0 0 0 501 156" stroke={`url(#${id}-light)`} strokeWidth=".65" />}
    </g>
  </svg>;
}

export function MascotCharacter({ imageSrc = '/assets/learning-mascot/mascot-body.png', faceTransform = MASCOT_FACE_TRANSFORM, className = '' }) {
  return <div className={`mascot-character ${className}`} aria-hidden="true">
        <img className="mascot-body" src={imageSrc} alt="" width="1254" height="1254" draggable="false" decoding="async" fetchPriority="high" />
        <svg className="mascot-face" viewBox="0 0 1254 1254" fill="none" aria-hidden="true">
          <g transform={faceTransform}>
            <g className="mascot-gaze">
              <ellipse className="mascot-eye mascot-eye-left" cx="146" cy="110" rx="25" ry="44" />
              <ellipse className="mascot-eye mascot-eye-right" cx="324" cy="110" rx="25" ry="44" />
              <path className="mascot-wink" d="M 300 113 Q 324 130 348 113" />
              <g className="mascot-happy-eyes">
                <path d="M 121 113 Q 146 83 171 113" />
                <path d="M 299 113 Q 324 83 349 113" />
              </g>
              <path className="mascot-smile" d="M 180 220 Q 235 245 290 220" />
              <path className="mascot-grin" d="M 180 220 Q 235 245 290 220 Q 235 298 180 220 Z" />
            </g>
          </g>
        </svg>
    </div>;
}

export default function LearningMascot({ motion = true, onAssistant, onFeed, onClassroom }) {
  const unique = useId().replace(/:/g, '');
  const sceneRef = useRef(null), planetRefs = useRef([]), elapsed = useRef(0);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const orbiting = motion && !hovered && !focused;
  const planetActions = { assistant: onAssistant, feed: onFeed, classroom: onClassroom };
  useEffect(() => {
    const scene = sceneRef.current, orbit = scene.querySelector('.mascot-orbit-back');
    let frame = 0, previous = null, geometry;
    const place = () => {
      if (!geometry) return;
      const { x, y, rx, ry, width } = geometry, tilt = -13 * Math.PI / 180;
      planetRefs.current.forEach((planet, index) => {
        if (!planet) return;
        const angle = elapsed.current / 32000 * Math.PI * 2 + PLANETS[index][2];
        const px = x + rx * Math.cos(angle) * Math.cos(tilt) - ry * Math.sin(angle) * Math.sin(tilt);
        const py = y + rx * Math.cos(angle) * Math.sin(tilt) + ry * Math.sin(angle) * Math.cos(tilt);
        planet.style.transform = `translate3d(${px}px,${py}px,0)`;
        planet.style.visibility = 'visible';
        planet.style.zIndex = Math.sin(angle) >= 0 ? '4' : '1';
        planet.style.setProperty('--label-shift', `${Math.max(48, Math.min(width - 48, px)) - px}px`);
      });
    };
    const measure = () => {
      const bounds = scene.getBoundingClientRect(), ring = orbit.getBoundingClientRect();
      const scale = Math.min(ring.width / 600, ring.height / 300);
      geometry = { x: ring.left - bounds.left + ring.width / 2, y: ring.top - bounds.top + ring.height / 2, rx: 234 * scale, ry: 72 * scale, width: bounds.width };
      place();
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(scene); observer.observe(orbit);
    const animate = (time) => {
      if (previous !== null) elapsed.current += Math.min(100, time - previous);
      previous = time; place(); frame = requestAnimationFrame(animate);
    };
    if (orbiting) frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [orbiting]);
  return <div ref={sceneRef} className={`learning-mascot${motion ? ' is-animated' : ' is-paused'}`} data-motion={motion ? 'running' : 'paused'} role="group" aria-label="学习星球入口">
    <div className="mascot-ambience" />
    <div className="mascot-floor-glow" />
    <div className="mascot-shadow" />
    <Orbit id={`${unique}-back`} />
    <div className="mascot-stars" aria-hidden="true">{STARS.map(([x, y, size, delay], index) => <i key={index} style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, animationDelay: `${delay}s` }} />)}</div>
    <div className="mascot-character-frame"><InteractiveMascot motion={motion} /></div>
    <Orbit front id={`${unique}-front`} />
    {PLANETS.map(([kind, name], index) => <div key={kind} ref={(element) => { planetRefs.current[index] = element; }} className={`mascot-planet-carrier ${kind}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <button type="button" className="mascot-planet-button" aria-label={name} onClick={planetActions[kind]}>
        <span className="mascot-planet-system" aria-hidden="true">
          <span className="mascot-planet-halo" />
          <span className="mascot-planet-local-ring ring-back" />
          <span className="mascot-planet-globe"><span className="mascot-planet-map" /><span className="mascot-planet-meridians"><i /><i /><i /></span></span>
          <span className="mascot-planet-local-ring ring-front" />
          <span className="mascot-satellite-route"><i className="mascot-satellite satellite-one" /><i className="mascot-satellite satellite-two" /></span>
        </span>
        <span className="mascot-planet-label">{name}<span aria-hidden="true">↗</span></span>
      </button>
    </div>)}
  </div>;
}
