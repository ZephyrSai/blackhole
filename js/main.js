// main.js — orchestrates the renderer, post-processing, the lensing-shader sky,
// the scroll timeline, theme, audio and the per-frame camera + sky choreography.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildJourney } from './chapters.js';
import { buildBlackHole } from './blackhole.js';
import { AudioEngine } from './audio.js';
import { ThemeManager } from './theme.js';
import { clamp, smoothstep, damp } from './utils.js';

const MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;

// ---------------- renderer / scene ----------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 0, 11);

// ---------------- theme ----------------
const themeMgr = new ThemeManager(localStorage.getItem('bh-theme') || 'dark');

// ---------------- the lensing sky (centerpiece) ----------------
const bh = buildBlackHole(themeMgr.palette);
scene.add(bh.mesh);

// ---------------- journey ----------------
const journey = buildJourney(themeMgr.palette);
scene.add(journey.root);

// ---------------- post-processing ----------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.05, 0.8, 0.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function applyTheme3D(p) {
  renderer.setClearColor(p.bg, 1);
  renderer.toneMappingExposure = p.exposure;
  bloom.strength = p.bloom;
  bloom.threshold = p.bloomThreshold;
  bloom.radius = p.bloomRadius;
  bh.recolor(p);
  journey.recolor(p);
}
themeMgr.onChange(applyTheme3D);
themeMgr.apply();

// ---------------- audio ----------------
const audio = new AudioEngine();

// ---------------- DOM / controls ----------------
const sections = [...document.querySelectorAll('.chapter')];
const contents = sections.map((s) => s.querySelector('.chapter__content'));
const progressFill = document.getElementById('progressFill');
const hint = document.getElementById('hint');
const soundBtn = document.getElementById('soundBtn');
const themeBtn = document.getElementById('themeBtn');
const chapterLabel = document.getElementById('chapterLabel');

function setSoundUI(on) {
  soundBtn.classList.toggle('is-on', on);
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.querySelector('.ctrl__label').textContent = on ? 'Sound on' : 'Sound off';
}
audio.onState(setSoundUI);
setSoundUI(true);

soundBtn.classList.add('is-pending');
const _soundPoll = setInterval(() => {
  if (audio.ctx && audio.ctx.state === 'running') {
    soundBtn.classList.remove('is-pending');
    clearInterval(_soundPoll);
  }
}, 350);

soundBtn.addEventListener('click', () => { hideHint(); audio.toggle(); });
themeBtn.addEventListener('click', () => {
  themeMgr.toggle();
  localStorage.setItem('bh-theme', themeMgr.current);
  themeBtn.querySelector('.ctrl__label').textContent = themeMgr.current === 'dark' ? 'Dark' : 'Light';
});
themeBtn.querySelector('.ctrl__label').textContent = themeMgr.current === 'dark' ? 'Dark' : 'Light';

function hideHint() { if (hint) hint.classList.add('hidden'); }

const enterBtn = document.getElementById('enterBtn');
if (enterBtn) {
  enterBtn.addEventListener('click', () => {
    audio.play();
    soundBtn.classList.remove('is-pending');
    enterBtn.classList.add('hidden');
    const s1 = sections[1];
    if (s1) {
      const top = s1.getBoundingClientRect().top + window.scrollY;
      const travel = s1.getBoundingClientRect().height - innerHeight;
      window.scrollTo({ top: Math.round(top + travel * 0.4), behavior: 'smooth' });
    }
  });
}
function firstGesture(e) {
  if (audio.ctx && audio.ctx.state === 'running') return;
  if (e && e.target && e.target.closest && e.target.closest('.ui')) return;
  audio.play();
  hideHint();
}
['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown', 'wheel', 'scroll'].forEach((ev) =>
  window.addEventListener(ev, firstGesture, { passive: true })
);

document.querySelectorAll('[data-scroll-top]').forEach((b) =>
  b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))
);

// ---------------- grab & drag interaction ----------------
const raycaster = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let drag = null;

function setPtr(e) { ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); }
function hitActive() {
  const ch = journey.chapters[activeIndex];
  if (!ch || !ch.interactive) return null;
  raycaster.setFromCamera(ptr, camera);
  const objs = ch.interactive.objects.map((o) => o.mesh);
  const hits = raycaster.intersectObjects(objs, false);
  if (!hits.length) return null;
  const entry = ch.interactive.objects.find((o) => o.mesh === hits[0].object);
  return entry ? { ch, id: entry.id } : null;
}

window.addEventListener('pointerdown', (e) => {
  if (e.target && e.target.closest && e.target.closest('.ui')) return;
  setPtr(e);
  const h = hitActive();
  if (!h) return;
  drag = { ch: h.ch, id: h.id, lx: ptr.x, ly: ptr.y };
  h.ch.interactive.grab && h.ch.interactive.grab(h.id);
  document.documentElement.classList.add('is-dragging');
  e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
  if (drag) {
    setPtr(e);
    const dx = ptr.x - drag.lx, dy = ptr.y - drag.ly;
    drag.lx = ptr.x; drag.ly = ptr.y;
    drag.ch.interactive.drag && drag.ch.interactive.drag(drag.id, { x: ptr.x, y: ptr.y }, { x: dx, y: dy });
  } else {
    if (e.target && e.target.closest && e.target.closest('.ui')) { document.body.style.cursor = ''; return; }
    setPtr(e);
    document.body.style.cursor = hitActive() ? 'grab' : '';
  }
});
function endDrag() {
  if (!drag) return;
  drag.ch.interactive.release && drag.ch.interactive.release(drag.id);
  drag = null;
  document.documentElement.classList.remove('is-dragging');
  document.body.style.cursor = '';
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
window.addEventListener('wheel', (e) => { if (drag) e.preventDefault(); }, { passive: false });

// ---------------- camera choreography ----------------
const camPos = new THREE.Vector3(0, 0, 11);
const camTarget = new THREE.Vector3(0, 0, 0);
const desiredPos = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
let activeIndex = 0;

const ROMAN = ['DARK', 'SPACETIME', 'LENSING', 'HORIZON', 'PHOTON SPHERE', 'ACCRETION', 'TIDES',
  'PLUNGE', 'SINGULARITY', 'TWO REALMS', 'HAWKING', 'ER = EPR', 'WHITE HOLE', 'WORMHOLE', 'FRONTIER', 'A WAY OUT'];

// ---------------- sky blending ----------------
const DEFAULT_SKY = { presence: 0, lens: 0, camDist: 11, incl: 0.16, yaw: null, fov: 0.62,
  disc: 0, discInner: 2.4, discOuter: 13, doppler: 0.35, throat: 0 };
const sky = { ...DEFAULT_SKY, yaw: 0 }; // damped current state

function blendSky(states, time, dt) {
  let tw = 0;
  const acc = { presence: 0, lens: 0, camDist: 0, incl: 0, yaw: 0, fov: 0, disc: 0, discInner: 0, discOuter: 0, doppler: 0, throat: 0 };
  journey.chapters.forEach((ch, i) => {
    const w = states[i].weight;
    if (w <= 0.004) return;
    const s = ch.sky ? { ...DEFAULT_SKY, ...ch.sky(states[i].lp, time) } : DEFAULT_SKY;
    const yaw = s.yaw == null ? time * 0.02 : s.yaw;
    tw += w;
    acc.presence += s.presence * w; acc.lens += s.lens * w; acc.camDist += s.camDist * w;
    acc.incl += s.incl * w; acc.yaw += yaw * w; acc.fov += s.fov * w; acc.disc += s.disc * w;
    acc.discInner += s.discInner * w; acc.discOuter += s.discOuter * w;
    acc.doppler += s.doppler * w; acc.throat += s.throat * w;
  });
  if (tw <= 0) return;
  for (const k in acc) acc[k] /= tw;
  const f = 1 - Math.exp(-6 * dt);
  for (const k in acc) sky[k] = sky[k] + (acc[k] - sky[k]) * f;
  const u = bh.uniforms;
  u.uPresence.value = sky.presence; u.uLens.value = sky.lens; u.uCamDist.value = sky.camDist;
  u.uIncl.value = sky.incl; u.uYaw.value = sky.yaw; u.uFov.value = sky.fov; u.uDisc.value = sky.disc;
  u.uDiscInner.value = sky.discInner; u.uDiscOuter.value = sky.discOuter;
  u.uDoppler.value = sky.doppler; u.uThroat.value = sky.throat;
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
let time = 0;
let running = true;

function computeStates() {
  const vh = innerHeight;
  let active = 0, best = -1;
  const states = sections.map((s, i) => {
    const r = s.getBoundingClientRect();
    const travel = Math.max(1, r.height - vh);
    const raw = -r.top / travel;
    const weight = smoothstep(-0.35, 0.1, raw) * (1 - smoothstep(0.9, 1.2, raw));
    if (weight > best) { best = weight; active = i; }
    return { raw, lp: clamp(raw, 0, 1), weight };
  });
  return { states, active };
}

function setOpacity(group, w) {
  group.traverse((o) => {
    const m = o.material;
    if (!m) return;
    const arr = Array.isArray(m) ? m : [m];
    arr.forEach((mm) => {
      if (mm.userData.baseOpacity === undefined) mm.userData.baseOpacity = mm.opacity ?? 1;
      mm.transparent = true;
      mm.opacity = mm.userData.baseOpacity * w;
    });
  });
}

function frame() {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  bh.uniforms.uTime.value = time;

  const { states, active } = computeStates();
  activeIndex = active;

  journey.chapters.forEach((ch, i) => {
    const st = states[i];
    if (st.weight <= 0.004) {
      if (ch.group.visible) ch.group.visible = false;
      return;
    }
    ch.group.visible = true;
    ch.update(st.lp, time, st.weight, dt);
    setOpacity(ch.group, st.weight);
  });

  blendSky(states, time, dt);

  contents.forEach((el, i) => {
    if (!el) return;
    const raw = states[i].raw;
    const o = smoothstep(-0.35, 0.06, raw) * (1 - smoothstep(0.78, 1.0, raw));
    el.style.opacity = o.toFixed(3);
    el.style.transform = `translate3d(0, ${(-raw + 0.5) * 26}px, 0)`;
  });

  const act = journey.chapters[active];
  const pose = act.camera(states[active].lp, time);
  const aspect = innerWidth / Math.max(1, innerHeight);
  const fit = aspect < 1 ? 1 + (1 - aspect) * 1.15 : 1;
  desiredPos.copy(pose.pos).sub(pose.target).multiplyScalar(fit).add(pose.target);
  desiredTarget.copy(pose.target);
  const f = 1 - Math.exp(-2.6 * dt);
  camPos.lerp(desiredPos, f);
  camTarget.lerp(desiredTarget, f);
  camera.position.copy(camPos);
  camera.lookAt(camTarget);

  const scrollMax = document.documentElement.scrollHeight - innerHeight;
  const prog = scrollMax > 0 ? clamp(window.scrollY / scrollMax) : 0;
  progressFill.style.transform = `scaleX(${prog})`;
  if (chapterLabel) chapterLabel.textContent = ROMAN[active] || '';

  composer.render();
}

// ---------------- resize / visibility ----------------
function onResize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  bh.setResolution(w, h);
  journey.resize(w, h);
}
window.addEventListener('resize', onResize);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) running = false;
  else if (!running) { running = true; clock.getDelta(); frame(); }
});

onResize();
frame();

window.__bh = { themeMgr, audio, journey, bh };
