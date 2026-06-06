# INTO THE DARK — Black Holes, White Holes & Wormholes

An interactive, scroll-driven voyage into a black hole and out the other side of
physics. A single real-time **gravitational-lensing shader** is the sky for the
whole journey — it bends a procedural starfield into Einstein rings, wraps a
**simulated accretion disc** over and under the shadow (the *Interstellar* /
Gargantua look), and lets you **plunge through the horizon**. Every load is
scored by a unique generative ambient soundtrack, and it works in dark and light.

Inspired by the tesseract "Journey Through Dimensions" companion piece — same
engine, new abyss.

## The descent

16 chapters. ✦ = a draggable handle you can grab (mouse or touch).

| # | Chapter | What it shows |
|---|---------|---------------|
| 0 | Into the Dark | Opening on a lensed black hole; Chandrasekhar's words |
| 1 | The Fabric of Spacetime ✦ | Drag a mass; watch the grid curve and worlds follow the slope |
| 2 | Gravitational Lensing ✦ | Orbit a dark mass; starlight smears into arcs and an Einstein ring |
| 3 | The Event Horizon | The point of no return — the shadow appears; Wheeler's words |
| 4 | The Photon Sphere | Where light itself orbits; the photon ring |
| 5 | The Accretion Disc ✦ | Superheated gas, Doppler beaming, the disc lensed into a halo — drag to tilt & feed it |
| 6 | Spaghettification ✦ | Tidal forces stretch an infalling astronaut into a thread |
| 7 | The Plunge | Scroll to dive across the horizon — the universe crushed to a ring of light |
| 8 | The Singularity | Where curvature → ∞ and the equations confess their limit |
| 9 | Two Realms at War ✦ | Relativity (smooth) vs quantum (grainy) — drag the clashing seam |
| 10 | Hawking Radiation | Quantum pairs at the horizon; the hole evaporates |
| 11 | What Falls In ✦ | The information paradox, the firewall, and **ER = EPR** — drag the entangled bridge |
| 12 | White Holes ✦ | The time-reversed mirror — try to push matter in; it's expelled |
| 13 | Wormholes ✦ | The Einstein–Rosen bridge — drag to travel through the throat |
| 14 | Quantum Gravity | The black hole as the lab where the two theories must finally meet |
| 15 | A Way Out | Zoom back out; Hawking's hopeful close |

## Running it

The app uses native ES modules + an import map, so it must be served over HTTP
(opening `index.html` from `file://` will not work).

```bash
python3 serve.py
# then open http://localhost:4332
```

Any static server works too (e.g. `python3 -m http.server 4332`).

> Needs an internet connection on first load: Three.js is pulled from a CDN via
> the import map, and the display fonts from Google Fonts (both degrade to system
> fallbacks).

## Controls

- **Scroll** to fall through the journey.
- **Drag the glowing ✦ handles** — warp spacetime, orbit a lens, tilt the
  accretion disc, stretch an astronaut, slide the quantum/relativity seam, stretch
  an entanglement wormhole, fight a white hole, travel through a wormhole. Page
  scroll pauses only while you're actually dragging.
- **◐ / Dark·Light** — toggle theme (remembered across visits; dark by default).
- **♪ Sound** — the generative score is **on by default** and begins on your first
  interaction (scroll/tap); mute any time.

## The science (and where it bends for the screen)

- **Gravitational lensing** (`js/blackhole.js`) is computed honestly: for every
  pixel a light ray is integrated **backwards** through a Schwarzschild metric.
  Rays that cross the horizon (r < 1 Rₛ) form the **shadow**; rays that graze the
  **photon sphere** (1.5 Rₛ) pile into the **photon ring**; escaping rays sample
  the starfield in their *bent* direction, smearing it into **Einstein rings**.
  This is a simplified cousin of the **DNGR** renderer Kip Thorne and Double
  Negative built for *Interstellar*.
- **The accretion disc** is emissive gas in the equatorial plane: temperature
  falls outward (Shakura–Sunyaev ~ r⁻³ᐟ⁴), with **relativistic Doppler beaming**
  brightening the approaching side and **gravitational redshift** dimming the
  inner edge. Because light can cross the disc plane more than once, the far side
  is lensed up and over the hole — Gargantua's signature halo, emergent for free.
- **The plunge, singularity, white holes and wormholes** are necessarily
  artistic past the horizon — no observation or settled theory tells us what is
  truly there. The quantum/relativity conflict, Hawking radiation, the
  information paradox, the firewall and **ER = EPR** are real open physics,
  rendered as metaphor.

## How it's built

- **`index.html`** — the scrolling narrative (one `<section class="chapter">` each)
  over a single fixed WebGL canvas.
- **`css/styles.css`** — themable via CSS variables on `[data-theme]`; fluid type.
- **`js/blackhole.js`** — the centerpiece: a full-screen GLSL geodesic raytracer
  (lensing, accretion disc, photon ring, Doppler, redshift, plunge/throat).
- **`js/chapters.js`** — every scene, each with `update()`, a `camera()` pose and
  an optional `sky()` that targets the lensing shader's uniforms.
- **`js/main.js`** — renderer, bloom, the scroll→progress→camera choreography, and
  a per-frame **blend of every visible chapter's `sky()`** so the black hole fades
  in, the disc spins up, and the camera dives through — smoothly across chapters.
- **`js/audio.js`** — a Web Audio generative engine: a deep gravitational
  sub-drone, slow detuned pads, airy noise and rare distant bells; a fresh seed
  each load picks the key, mode and timing.
- **`js/theme.js`, `js/utils.js`** — palettes and small math helpers.

Dedicated to the people who taught us to see the dark: **Chandrasekhar, Wheeler,
Thorne, Hawking.**
