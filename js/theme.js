// theme.js — light / dark palettes + a tiny pub/sub manager.
// Colors used by Three.js / the shader are plain hex numbers. The DOM is themed
// via CSS variables driven by the [data-theme] attribute on <html>.
//
// Dark is the headline experience — deep space, fire-bright accretion, glow +
// bloom. Light is an elegant "chalk on a blackboard turned inside out": a pale
// blueprint where the hole is drawn in ink. Both are first-class.

export const THEMES = {
  dark: {
    name: 'dark',
    bg: 0x02030a,
    fog: 0x02030a,
    star: 0xdfe8ff,
    starFaint: 0x6f80b5,
    dust: 0x7c92dc,
    // disc / fire
    primary: 0xff9a4d, // warm amber — the accretion fire, main accent
    hot: 0xfff3df, // white-hot inner disc
    warm: 0xffb14e,
    ember: 0xff5a1e,
    deep: 0x8a1d08, // cool outer disc
    // physics palette
    secondary: 0x6fd2ff, // relativity blue (smooth spacetime, lensing)
    quantum: 0xb98bff, // quantum violet
    accent: 0xffd27d, // gold — interaction hotspots
    whitehole: 0xdcecff, // brilliant blue-white
    exotic: 0x73ffce, // wormhole "other side" teal
    creature: 0x7dffc4,
    apple: 0xff647c,
    grid: 0x1b2a55,
    gridStrong: 0x33509c,
    paper: 0x0a0e1e,
    bloom: 0.8,
    bloomThreshold: 0.5,
    bloomRadius: 0.7,
    exposure: 1.02,
  },
  light: {
    name: 'light',
    bg: 0xeef2fb,
    fog: 0xeef2fb,
    star: 0x8a99c0,
    starFaint: 0xb9c4dd,
    dust: 0x7286c0,
    primary: 0xc2440f, // burnt-orange ink
    hot: 0xe8741a,
    warm: 0xd2640f,
    ember: 0xb83a0a,
    deep: 0x7a2207,
    secondary: 0x1f5fd0, // blueprint blue
    quantum: 0x7a3df0,
    accent: 0xb4560a, // amber
    whitehole: 0x1f5fd0,
    exotic: 0x0a8f6b,
    creature: 0x10a37f,
    apple: 0xe23a59,
    grid: 0xc4d0e8,
    gridStrong: 0x8ba2d6,
    paper: 0xf7faff,
    bloom: 0.0,
    bloomThreshold: 1.0,
    bloomRadius: 0.7,
    exposure: 1.0,
  },
};

export class ThemeManager {
  constructor(initial = 'dark') {
    this.listeners = new Set();
    this.current = initial;
  }
  get palette() {
    return THEMES[this.current];
  }
  apply() {
    document.documentElement.setAttribute('data-theme', this.current);
    this.listeners.forEach((fn) => fn(this.palette));
  }
  set(name) {
    if (!THEMES[name]) return;
    this.current = name;
    this.apply();
  }
  toggle() {
    this.set(this.current === 'dark' ? 'light' : 'dark');
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
