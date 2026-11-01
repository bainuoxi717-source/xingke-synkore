import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const HOME = { yaw: -.38, pitch: .08 };
const ENGRAVING = 'made by 闵交幼儿园';

function ghostShape() {
  const s = new THREE.Shape();
  s.moveTo(-1.02, -.67);
  s.lineTo(-1.02, .34);
  s.bezierCurveTo(-1.02, .85, -.69, 1.04, -.15, 1.04);
  s.lineTo(.18, 1.04);
  s.bezierCurveTo(.74, 1.04, 1.02, .82, 1.02, .32);
  s.lineTo(1.02, -.69);
  // Five soft scallops continue through the full depth of the shell.
  const step = 2.04 / 5;
  for (let i = 0; i < 5; i++) {
    const right = 1.02 - i * step, left = right - step;
    s.bezierCurveTo(right - .045, -1.015, left + .045, -1.015, left, -.69);
  }
  s.closePath(); return s;
}
function roundedShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function shellGeometry(depth, bevel = .1) {
  const g = new THREE.ExtrudeGeometry(ghostShape(), { depth, steps: 1, curveSegments: 28, bevelEnabled: true, bevelSegments: 8, bevelSize: bevel, bevelThickness: bevel });
  g.translate(0, 0, -depth / 2); return g;
}
function panelGeometry(width, height, radius, depth) {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(width, height, radius), { depth, steps: 1, curveSegments: 24, bevelEnabled: true, bevelSegments: 4, bevelSize: .012, bevelThickness: .012 });
  geometry.translate(0, 0, -depth / 2); return geometry;
}
function curveMesh(points, material, radius = .014) {
  const curve = new THREE.QuadraticBezierCurve3(...points.map((point) => new THREE.Vector3(...point)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 8, false), material);
}
function makeEngraving() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  const draw = () => {
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#d7dcd6'; context.fillRect(0, 0, 256, 128);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.font = '36px "Synkore Pixel", monospace';
    // The high and low edges plus a bump map read as recessed pixel lettering.
    for (const [text, y] of [['made by', 37], ['闵交幼儿园', 84]]) {
      context.fillStyle = '#fcfcf7'; context.fillText(text, 128, y + 2);
      context.fillStyle = '#4d5b52'; context.fillText(text, 128, y);
    }
    texture.needsUpdate = true;
  };
  draw(); return { texture, draw };
}
function makeCharacter() {
  const root = new THREE.Group(), ink = new THREE.MeshStandardMaterial({ color: '#303735', roughness: .6 });
  const porcelain = new THREE.MeshPhysicalMaterial({ color: '#f4f5f1', roughness: .45, metalness: .015, clearcoat: .22, clearcoatRoughness: .38 });
  const shell = new THREE.Mesh(shellGeometry(.51, .105), porcelain); root.add(shell);
  const rear = new THREE.Mesh(shellGeometry(.038, .095), new THREE.MeshStandardMaterial({ color: '#d7dcd6', roughness: .62 }));
  rear.position.z = -.261; rear.scale.set(.985, .985, 1); root.add(rear);
  const bezel = new THREE.Mesh(panelGeometry(1.69, 1.24, .21, .105), ink);
  bezel.position.set(0, .17, .38); root.add(bezel);
  const screen = new THREE.Mesh(panelGeometry(1.54, 1.09, .16, .065), new THREE.MeshStandardMaterial({ color: '#d8ddd7', roughness: .66 }));
  screen.position.set(0, .17, .445); root.add(screen);
  const face = new THREE.Group(); face.position.z = .491; root.add(face);
  const eyes = [-.29, .29].map((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), ink);
    eye.scale.set(.073, .118, .018); eye.position.set(x, .34, 0); face.add(eye); return eye;
  });
  const smile = curveMesh([[-.2, -.025, 0], [0, -.16, 0], [.2, -.025, 0]], ink, .012); face.add(smile);
  const happyEyes = [-.29, .29].map((x) => { const line = curveMesh([[x - .073, .31, .002], [x, .42, .002], [x + .073, .31, .002]], ink, .014); face.add(line); return line; });
  const wink = curveMesh([[.22, .34, .002], [.29, .29, .002], [.36, .34, .002]], ink, .014); face.add(wink);
  const grinShape = new THREE.Shape(); grinShape.moveTo(-.19, -.03); grinShape.quadraticCurveTo(0, -.14, .19, -.03); grinShape.quadraticCurveTo(0, -.33, -.19, -.03);
  const grin = new THREE.Mesh(new THREE.ShapeGeometry(grinShape, 24), ink); grin.position.z = .002; face.add(grin);
  for (const x of [-.115, 0, .115]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.018, 12, 8), ink); dot.scale.z = .35; dot.position.set(x, -.666, .362); root.add(dot);
  }
  const engraving = makeEngraving();
  const backMaterial = new THREE.MeshStandardMaterial({ map: engraving.texture, bumpMap: engraving.texture, bumpScale: .018, roughness: .62 });
  const back = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(1.67, .835, .07), 12), backMaterial);
  // ShapeGeometry's default UVs use world units; fit the complete pixel plate.
  const uv = back.geometry.attributes.uv, positions = back.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, positions.getX(i) / 1.67 + .5, positions.getY(i) / .835 + .5);
  back.rotation.y = Math.PI; back.position.set(0, .13, -.377); back.name = ENGRAVING; root.add(back);
  return { root, engraving, face, eyes, smile, happyEyes, wink, grin };
}

export function mountMascot3D(host, { motion = true, onReady, onError }) {
  const viewport = host.querySelector('.mascot-3d-viewport');
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-hidden', 'true'); viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1.53, 1.53, 1.53, -1.53, .1, 30);
  camera.position.set(0, .02, 7); camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight('#f2f5f7', '#77827c', 1.35));
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(-3, 5, 6); scene.add(key);
  const fill = new THREE.DirectionalLight('#e2ede6', .6); fill.position.set(4, 1, 4); scene.add(fill);
  const rim = new THREE.DirectionalLight('#d5e8ee', 1.7); rim.position.set(3, 4, -5); scene.add(rim);
  const character = makeCharacter(); scene.add(character.root);
  const state = { yaw: HOME.yaw, pitch: HOME.pitch, shownYaw: HOME.yaw, shownPitch: HOME.pitch, velocity: 0, dragging: false, pointer: null, x: 0, y: 0, time: 0 };
  let disposed = false, lost = false, running = motion, inView = true, frame = 0, previous = null, elapsed = 0;
  const schedule = () => { if (!disposed && !lost && inView && !document.hidden && !frame) frame = requestAnimationFrame(render); };
  const render = (now) => {
    frame = 0;
    const dt = previous === null ? 1 / 60 : Math.min(.05, Math.max(0, (now - previous) / 1000)); previous = now;
    if (running) elapsed += dt;
    if (running && !state.dragging && Math.abs(state.velocity) > .003) { state.yaw += state.velocity * dt; state.velocity *= Math.exp(-7 * dt); }
    const blend = state.dragging ? 1 : 1 - Math.exp(-18 * dt);
    state.shownYaw += (state.yaw - state.shownYaw) * blend; state.shownPitch += (state.pitch - state.shownPitch) * blend;
    const phase = elapsed % 12, happy = phase > 7.7 && phase < 9, winking = phase > 4.8 && phase < 6.1;
    let blink = 1;
    for (const centre of [1.25, 10.5]) { const distance = Math.abs(phase - centre); if (distance < .14) blink = Math.max(.08, distance / .14); }
    character.eyes[0].visible = !happy; character.eyes[1].visible = !happy && !winking;
    character.eyes.forEach((eye) => { eye.scale.y = .118 * blink; });
    character.happyEyes.forEach((eye) => { eye.visible = happy; }); character.wink.visible = winking && !happy;
    character.smile.visible = !happy; character.grin.visible = happy;
    character.face.position.x = .018 * Math.sin(elapsed * .65);
    character.root.position.y = Math.sin(elapsed * Math.PI / 3) * .035;
    character.root.rotation.set(state.shownPitch, state.shownYaw, Math.sin(elapsed * .48) * .018);
    host.dataset.rotation = `${state.shownYaw.toFixed(3)},${state.shownPitch.toFixed(3)}`;
    host.dataset.facing = Math.cos(state.shownYaw) < 0 ? 'back' : 'front';
    host.dataset.expression = happy ? 'happy' : winking ? 'wink' : blink < .5 ? 'blink' : 'smile';
    renderer.render(scene, camera);
    const settling = Math.abs(state.shownYaw - state.yaw) + Math.abs(state.shownPitch - state.pitch) > .0005;
    if (running || state.dragging || settling) schedule();
  };
  const resize = () => {
    const { width, height } = viewport.getBoundingClientRect(); if (!width || !height) return;
    renderer.setSize(width, height, false); const aspect = width / height;
    camera.left = -1.53 * aspect; camera.right = 1.53 * aspect; camera.updateProjectionMatrix(); schedule();
  };
  const endDrag = (event) => {
    if (event && state.pointer !== event.pointerId) return;
    if (event?.type === 'pointercancel') state.velocity = 0;
    const pointer = state.pointer; state.dragging = false; state.pointer = null; host.classList.remove('is-dragging');
    if (pointer !== null && host.hasPointerCapture(pointer)) host.releasePointerCapture(pointer);
    schedule();
  };
  const down = (event) => {
    if (disposed || lost || !event.isPrimary || event.button !== 0 || state.pointer !== null) return;
    state.dragging = true; state.pointer = event.pointerId; state.x = event.clientX; state.y = event.clientY; state.time = event.timeStamp; state.velocity = 0;
    host.setPointerCapture(event.pointerId); host.classList.add('is-dragging'); host.dataset.interacted = 'true'; schedule();
  };
  const move = (event) => {
    if (!state.dragging || event.pointerId !== state.pointer) return;
    const dx = event.clientX - state.x, dy = event.clientY - state.y, seconds = Math.max(.008, (event.timeStamp - state.time) / 1000);
    state.yaw += dx * .018; state.pitch = clamp(state.pitch + dy * .009, -.6, .6);
    state.velocity = running ? clamp(dx * .018 / seconds, -1.7, 1.7) : 0;
    state.x = event.clientX; state.y = event.clientY; state.time = event.timeStamp; schedule();
  };
  const reset = () => { state.yaw = HOME.yaw; state.pitch = HOME.pitch; state.velocity = 0; schedule(); };
  const keyboard = (event) => {
    if (disposed || lost || event.altKey || event.ctrlKey || event.metaKey) return;
    const delta = Math.PI / 12;
    if (event.key === 'Home') reset();
    else if (event.key === 'ArrowLeft') state.yaw -= delta;
    else if (event.key === 'ArrowRight') state.yaw += delta;
    else if (event.key === 'ArrowUp') state.pitch = clamp(state.pitch - delta / 2, -.6, .6);
    else if (event.key === 'ArrowDown') state.pitch = clamp(state.pitch + delta / 2, -.6, .6);
    else return;
    event.preventDefault(); state.velocity = 0; host.dataset.interacted = 'true'; schedule();
  };
  const visibility = () => { previous = null; if (document.hidden) { cancelAnimationFrame(frame); frame = 0; endDrag(); } else schedule(); };
  const contextLost = (event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; endDrag(); onError?.(); };
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', endDrag], ['pointercancel', endDrag], ['lostpointercapture', endDrag], ['keydown', keyboard], ['dblclick', reset]];
  listeners.forEach(([name, handler]) => host.addEventListener(name, handler));
  renderer.domElement.addEventListener('webglcontextlost', contextLost); document.addEventListener('visibilitychange', visibility);
  const sizes = new ResizeObserver(resize); sizes.observe(viewport);
  const intersection = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; previous = null; if (inView) schedule(); else { cancelAnimationFrame(frame); frame = 0; } }); intersection.observe(host);
  resize(); onReady?.();
  document.fonts.load('24px "Synkore Pixel"', ENGRAVING).then(() => {
    if (disposed || lost) return; character.engraving.draw(); host.dataset.engraving = ENGRAVING; schedule();
  }).catch(() => { /* The shape and its controls still work when a font is unavailable. */ });
  return {
    setMotion(value) { running = value; state.velocity = 0; previous = null; if (!running) { cancelAnimationFrame(frame); frame = 0; } schedule(); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); sizes.disconnect(); intersection.disconnect();
      listeners.forEach(([name, handler]) => host.removeEventListener(name, handler)); document.removeEventListener('visibilitychange', visibility);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost); endDrag();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse((item) => { if (item.geometry) geometries.add(item.geometry); const mats = item.material ? (Array.isArray(item.material) ? item.material : [item.material]) : []; mats.forEach((mat) => { materials.add(mat); Object.values(mat).forEach((value) => { if (value?.isTexture) textures.add(value); }); }); });
      textures.forEach((texture) => texture.dispose()); materials.forEach((material) => material.dispose()); geometries.forEach((geometry) => geometry.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
