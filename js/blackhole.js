// blackhole.js — the centerpiece.
//
// A full-screen background that renders a Schwarzschild black hole by tracing
// the path of light backwards from the camera through curved spacetime — the
// same idea (vastly simplified) behind the DNGR renderer Kip Thorne and Double
// Negative built for *Interstellar*'s Gargantua.
//
// For every pixel we shoot a ray and integrate its geodesic step by step:
//   • if it spirals across the horizon (r < 1 Rs) → it is captured → the SHADOW
//   • if it crosses the equatorial plane inside the disc → it glows (ACCRETION)
//   • otherwise it escapes and we sample the procedural STARFIELD in its final,
//     bent direction → the bend is what smears stars into the EINSTEIN RING.
// Light can cross the disc plane more than once, so the far side of the disc is
// lensed up and over the hole — Gargantua's signature halo, emergent for free.
//
// Distances are in Schwarzschild radii (Rs = 1, horizon at r = 1, photon sphere
// at r = 1.5, ISCO at r = 3). One persistent instance is the sky for the whole
// journey; uniforms fade the hole in, spin the disc, and dive through the throat.

import * as THREE from 'three';

const hexToRGB = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // fill clip space, ignore camera
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  #define MAXSTEPS 320

  varying vec2 vUv;

  uniform vec2  uRes;
  uniform float uTime;
  uniform float uCamDist;    // camera distance from hole, in Rs
  uniform float uIncl;       // camera elevation above the equatorial plane (rad)
  uniform float uYaw;        // slow azimuthal orbit (rad)
  uniform float uFov;        // half vertical field of view (rad)
  uniform int   uSteps;      // integration steps (quality)

  uniform float uPresence;   // 0 = empty sky, 1 = full black hole
  uniform float uLens;       // light-bending strength (0..1+)
  uniform float uDisc;       // accretion disc brightness (0..1+)
  uniform float uDiscInner;  // disc inner radius (Rs)
  uniform float uDiscOuter;  // disc outer radius (Rs)
  uniform float uDoppler;    // relativistic beaming amount (0..1)
  uniform float uThroat;     // 0 = none, 1 = full plunge/wormhole tunnel
  uniform float uLight;      // 0 = dark glow, 1 = pale blueprint

  uniform vec3  uColHot;     // inner disc (white-hot)
  uniform vec3  uColWarm;    // mid disc
  uniform vec3  uColDeep;    // outer disc (cool)
  uniform vec3  uStarCol;    // star tint
  uniform vec3  uBgTint;     // deep-space / paper tint
  uniform vec3  uTunnelCol;  // plunge tunnel tint
  uniform float uSeed;

  // ---------- hashing / noise ----------
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0,0,0)), n100 = hash31(i + vec3(1,0,0));
    float n010 = hash31(i + vec3(0,1,0)), n110 = hash31(i + vec3(1,1,0));
    float n001 = hash31(i + vec3(0,0,1)), n101 = hash31(i + vec3(1,0,1));
    float n011 = hash31(i + vec3(0,1,1)), n111 = hash31(i + vec3(1,1,1));
    return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
               mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
  }

  // ---------- background: stars + nebula by ray direction ----------
  vec3 sampleStars(vec3 dir) {
    // equirectangular cells -> crisp star points across a few density layers
    float lon = atan(dir.z, dir.x);
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    vec2 uv = vec2(lon, lat);
    vec3 col = vec3(0.0);
    for (int L = 0; L < 3; L++) {
      float scale = 26.0 + float(L) * 47.0;
      vec2 g = uv * scale + uSeed * 13.0;
      vec2 cell = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = hash21(cell + float(L) * 7.0);
      // only some cells host a star
      if (h > 0.86) {
        vec2 off = (vec2(hash21(cell + 3.1), hash21(cell + 6.7)) - 0.5) * 0.7;
        float d = length(f - off);
        float tw = 0.7 + 0.3 * sin(uTime * (1.0 + h * 3.0) + h * 30.0);
        float bright = smoothstep(0.07, 0.0, d) * (h - 0.86) / 0.14 * tw;
        vec3 tint = mix(uStarCol, vec3(1.0, 0.85, 0.7), step(0.95, hash21(cell + 9.3)));
        tint = mix(tint, vec3(0.7, 0.82, 1.0), step(0.97, hash21(cell + 2.2)));
        col += tint * bright * (1.0 - float(L) * 0.22);
      }
    }
    return col;
  }
  vec3 sampleNebula(vec3 dir) {
    float n = fbm(dir * 2.3 + vec3(uSeed * 4.0));
    float n2 = fbm(dir * 5.1 - vec3(uSeed * 2.0, 0.0, uSeed));
    float c = smoothstep(0.55, 1.0, n) * 0.5 + smoothstep(0.6, 1.0, n2) * 0.35;
    vec3 neb = mix(uBgTint * 1.4, uStarCol * 0.5, n2) * c;
    return neb * 0.6;
  }
  vec3 background(vec3 dir) {
    return sampleStars(dir) + sampleNebula(dir) + uBgTint * 0.35;
  }

  // ---------- accretion disc emission at a plane-crossing point ----------
  vec3 discColor(vec3 p, float r, vec3 rayDir) {
    float u = clamp((r - uDiscInner) / max(0.001, uDiscOuter - uDiscInner), 0.0, 1.0);

    // temperature falls outward (Shakura–Sunyaev ~ r^-3/4): inner = white hot
    vec3 c = mix(uColHot, uColWarm, smoothstep(0.0, 0.32, u));
    c = mix(c, uColDeep, smoothstep(0.32, 1.0, u));

    // turbulent spiralling gas
    float ang = atan(p.z, p.x);
    float swirl = ang * 2.0 + r * 0.9 - uTime * (1.4 / sqrt(max(r, 1.0)));
    float gas = fbm(vec3(cos(swirl) * r, sin(swirl) * r, r * 0.5 - uTime * 0.2) * 0.7);
    float bright = pow(1.0 - u, 1.7) * 1.5 + 0.08;
    bright *= 0.6 + 0.9 * gas;

    // soft inner & outer falloff so edges aren't hard rings
    bright *= smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.86, u);

    // gravitational redshift: light from deep in the well climbs out dimmer/redder
    float gz = sqrt(clamp(1.0 - 1.0 / r, 0.04, 1.0));
    bright *= gz;
    c = mix(c * vec3(1.2, 0.7, 0.5), c, gz); // deeper -> redder

    // relativistic Doppler beaming: the side sweeping toward us brightens
    vec3 vel = normalize(cross(vec3(0.0, 1.0, 0.0), p)); // prograde orbit
    float beta = clamp(0.46 / sqrt(max(r, 1.0)), 0.0, 0.85);
    float gamma = 1.0 / sqrt(1.0 - beta * beta);
    float los = dot(vel, -normalize(rayDir));
    float D = 1.0 / max(0.2, gamma * (1.0 - beta * los));
    float boost = clamp(pow(D, 2.0), 0.25, 3.0);
    bright *= mix(1.0, boost, uDoppler);
    c = mix(c, c * vec3(0.8, 0.9, 1.25), uDoppler * clamp(los, 0.0, 1.0) * 0.6); // approaching = bluer

    return c * bright;
  }

  // ---------- plunge / wormhole tunnel ----------
  vec3 tunnel(vec2 q, out float cover) {
    float rad = length(q);
    float ang = atan(q.y, q.x);
    float streak = fbm(vec3(ang * 3.0, log(rad + 0.02) * 4.0 - uTime * 5.0, uSeed));
    streak = pow(smoothstep(0.35, 1.0, streak), 1.4);
    vec3 col = uTunnelCol * streak * smoothstep(0.0, 0.5, rad) * 2.2;
    col += mix(uColWarm, uColHot, streak) * streak * 0.5;
    // the universe ahead, squeezed into a shrinking bright eye
    float eye = smoothstep(0.22, 0.0, rad);
    col += uColHot * eye * 1.6;
    cover = clamp(streak + eye, 0.0, 1.0);
    return col;
  }

  void main() {
    float aspect = uRes.x / max(1.0, uRes.y);
    // frame by the SHORTER side so the hole never overflows on tall phone screens
    vec2 q = (aspect >= 1.0)
      ? (vUv - 0.5) * vec2(aspect, 1.0)        // landscape: fit by height
      : (vUv - 0.5) * vec2(1.0, 1.0 / aspect); // portrait: fit by width
    vec2 uvScreen = q;

    // camera basis from distance + inclination + slow yaw
    float ci = cos(uIncl), si = sin(uIncl), cy = cos(uYaw), sy = sin(uYaw);
    vec3 camPos = uCamDist * vec3(ci * sy, si, ci * cy);
    vec3 fwd = normalize(-camPos);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rayDir = normalize(fwd + (q.x * right + q.y * up) * tan(uFov));
    vec3 straight = rayDir;

    // ---- integrate the geodesic ----
    vec3 pos = camPos;
    vec3 vel = rayDir;
    vec3 angMom = cross(pos, vel);
    float h2 = dot(angMom, angMom);   // conserved angular momentum (computed once)
    vec3 disc = vec3(0.0);
    bool captured = false;
    float minR = 1e9;
    float prevY = pos.y;
    vec3 prevPos = pos;

    for (int i = 0; i < MAXSTEPS; i++) {
      if (i >= uSteps) break;
      float r2 = dot(pos, pos);
      float r = sqrt(r2);
      minR = min(minR, r);
      if (r2 < 1.0) { captured = true; break; }
      if (r > 32.0) break;

      float dt = (0.16 + 0.13 * r) * 0.9;
      vec3 acc = -1.5 * h2 * pos / pow(r2, 2.5) * uLens;
      prevPos = pos; prevY = pos.y;
      vel += acc * dt;
      pos += vel * dt;

      if (uDisc > 0.001 && prevY * pos.y < 0.0) {
        float tt = prevY / (prevY - pos.y);
        vec3 cp = mix(prevPos, pos, tt);
        float rr = length(cp.xz);
        if (rr > uDiscInner && rr < uDiscOuter) disc += discColor(cp, rr, vel) * 0.6;
      }
    }
    disc = min(disc, vec3(3.0));
    vec3 finalDir = normalize(vel);

    // ---- compose ----
    vec3 bentBg = background(finalDir);
    vec3 straightBg = background(straight);
    // when the hole is absent we want the un-bent sky; blend by presence
    vec3 sky = mix(straightBg, bentBg, clamp(uPresence, 0.0, 1.0));

    vec3 discCol = disc * uDisc;

    // photon ring: rays that grazed the photon sphere (~1.5 Rs) and escaped
    float ring = smoothstep(2.1, 1.5, minR) * step(1.0, minR);
    vec3 ringCol = mix(uColHot, uStarCol, 0.3) * ring * 0.5 * uPresence;

    vec3 col;
    if (uLight < 0.5) {
      // -------- dark: additive glow (bloom downstream) --------
      col = sky;
      if (captured) col = mix(sky, vec3(0.0), uPresence); // the shadow
      col += discCol + ringCol;
    } else {
      // -------- light: pale blueprint, hole drawn in ink --------
      vec3 paper = uBgTint;
      float starInk = clamp(dot(sky - uBgTint * 0.35, vec3(0.5)), 0.0, 1.0);
      float discInk = clamp(dot(discCol, vec3(0.45)), 0.0, 1.0);
      col = paper;
      col = mix(col, vec3(0.10, 0.13, 0.22), starInk * 0.8); // stars as dark specks
      col = mix(col, uColWarm, clamp(discInk, 0.0, 1.0));     // disc as warm ink
      col = mix(col, mix(uColHot, vec3(0.1), 0.2), ring * 0.7); // photon ring ink
      if (captured) col = mix(col, vec3(0.07, 0.09, 0.16), uPresence); // shadow ink
    }

    // ---- plunge / wormhole tunnel overlay ----
    if (uThroat > 0.001) {
      float cover;
      vec3 tcol = tunnel(uvScreen, cover);
      if (uLight > 0.5) tcol = mix(uBgTint, uColWarm, cover);
      col = mix(col, tcol, clamp(uThroat, 0.0, 1.0));
    }

    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export function buildBlackHole(palette) {
  const uniforms = {
    uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uTime: { value: 0 },
    uCamDist: { value: 9.0 },
    uIncl: { value: 0.16 },
    uYaw: { value: 0 },
    uFov: { value: 0.62 },
    uSteps: { value: 150 },
    uPresence: { value: 0 },
    uLens: { value: 0 },
    uDisc: { value: 0 },
    uDiscInner: { value: 2.4 },
    uDiscOuter: { value: 13.0 },
    uDoppler: { value: 0.35 },
    uThroat: { value: 0 },
    uLight: { value: palette.name === 'light' ? 1 : 0 },
    uColHot: { value: new THREE.Vector3(...hexToRGB(palette.hot)) },
    uColWarm: { value: new THREE.Vector3(...hexToRGB(palette.warm)) },
    uColDeep: { value: new THREE.Vector3(...hexToRGB(palette.deep)) },
    uStarCol: { value: new THREE.Vector3(...hexToRGB(palette.star)) },
    uBgTint: { value: new THREE.Vector3(...hexToRGB(palette.bg)) },
    uTunnelCol: { value: new THREE.Vector3(...hexToRGB(palette.secondary)) },
    uSeed: { value: Math.random() * 10 },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10; // draw first, behind everything

  // fewer integration steps on smaller screens, to keep the raytracer smooth
  const stepsFor = (w, h) => { const m = Math.min(w, h); return m < 500 ? 64 : m < 700 ? 100 : 150; };
  uniforms.uSteps.value = stepsFor(window.innerWidth, window.innerHeight);

  function recolor(p) {
    uniforms.uLight.value = p.name === 'light' ? 1 : 0;
    uniforms.uColHot.value.set(...hexToRGB(p.hot));
    uniforms.uColWarm.value.set(...hexToRGB(p.warm));
    uniforms.uColDeep.value.set(...hexToRGB(p.deep));
    uniforms.uStarCol.value.set(...hexToRGB(p.star));
    uniforms.uBgTint.value.set(...hexToRGB(p.bg));
    uniforms.uTunnelCol.value.set(...hexToRGB(p.secondary));
  }

  function setResolution(w, h) {
    uniforms.uRes.value.set(w, h);
    uniforms.uSteps.value = stepsFor(w, h);
  }

  return { mesh, uniforms, recolor, setResolution };
}
