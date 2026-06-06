// utils.js — tiny math + helpers, no dependencies.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const invlerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

export const remap = (v, inMin, inMax, outMin, outMax) =>
  lerp(outMin, outMax, clamp(invlerp(inMin, inMax, v)));

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function smootherstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Frame-rate independent exponential damping toward a target.
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

// Ease helpers
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// Deterministic, fast PRNG (Mulberry32). Returns a function -> [0,1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng, min, max) => min + (max - min) * rng();
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// fract
export const fract = (x) => x - Math.floor(x);

// A pulse that fades in then out across [0,1]: 0 at edges, 1 in the middle.
export function window01(t, fadeIn = 0.12, fadeOut = 0.12) {
  return smoothstep(0, fadeIn, t) * (1 - smoothstep(1 - fadeOut, 1, t));
}
