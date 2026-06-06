// chapters.js — every scene in the descent. Each chapter is a Three.js group with
//   update(localProgress, time, weight, dt)
//   camera(localProgress, time)         -> { pos, target } for the 3D meshes
//   sky(localProgress, time)  (optional)-> target uniforms for the lensing shader
//   interactive (optional): { objects:[{id,mesh}], grab(id), drag(id,ndc,d), release(id) }
//
// The black hole itself is the SHADER background (blackhole.js). Diagram chapters
// keep the sky empty (presence 0) and draw glowing wireframe meshes in front; the
// immersive chapters hand the stage to the shader. Dark = additive glow; light =
// "blueprint on paper".

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { clamp, lerp, smoothstep, smootherstep, TAU } from './utils.js';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0)');
  grd.addColorStop(0.68, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.8, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function buildJourney(palette) {
  const root = new THREE.Group();
  const TEX = glowTexture();
  const RING = ringTexture();
  const themed = [];
  const onResize = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  function themeMat(m, role, glow) {
    themed.push((p) => {
      if (role) m.color.setHex(p[role]);
      if (glow) {
        m.blending = p.name === 'dark' ? THREE.AdditiveBlending : THREE.NormalBlending;
        m.needsUpdate = true;
      }
    });
  }

  // ---------- primitive helpers ----------
  function sprite(role, size, opacity = 1, tex = TEX) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity });
    m.userData.baseOpacity = opacity;
    themeMat(m, role, true);
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    return s;
  }
  function fatLine(flat, role, width = 3, opacity = 1) {
    const g = new LineGeometry();
    g.setPositions(flat);
    const m = new LineMaterial({ linewidth: width, transparent: true, opacity, depthWrite: false });
    m.userData.baseOpacity = opacity;
    m.resolution.set(window.innerWidth, window.innerHeight);
    themeMat(m, role, true);
    onResize.push((w, h) => m.resolution.set(w, h));
    const l = new Line2(g, m);
    l.frustumCulled = false;
    return l;
  }
  function basicLines(flat, role, opacity = 0.6) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    const m = new THREE.LineBasicMaterial({ transparent: true, opacity });
    m.userData.baseOpacity = opacity;
    themeMat(m, role, true);
    return new THREE.LineSegments(g, m);
  }
  function circleFlat(r, seg, axis) {
    const a = [];
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * TAU;
      const c = Math.cos(th) * r, s = Math.sin(th) * r;
      if (axis === 'xy') a.push(c, s, 0);
      else if (axis === 'xz') a.push(c, 0, s);
      else a.push(0, c, s);
    }
    return a;
  }
  function points(count, role, size, opacity, tex = TEX) {
    const pos = new Float32Array(count * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: tex, size, transparent: true, depthWrite: false, opacity, sizeAttenuation: true });
    m.userData.baseOpacity = opacity;
    themeMat(m, role, true);
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    return { points: p, pos, geo: g };
  }
  // invisible raycast proxy + a visible pulsing grab ring
  function hotspot(proxyR = 0.8, ringSize = 1.3) {
    const grp = new THREE.Group();
    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(proxyR, 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false })
    );
    proxy.userData.baseOpacity = 0;
    proxy.renderOrder = 20;
    const ring = ringSize > 0 ? sprite('accent', ringSize, 0.85, RING) : null;
    grp.add(proxy);
    if (ring) grp.add(ring);
    grp.userData.proxy = proxy;
    grp.userData.ring = ring;
    return grp;
  }

  // a warped spacetime grid (XZ plane displaced down by gravity wells)
  function warpGrid(size, div, role, opacity = 0.5) {
    const half = size / 2, step = size / div;
    const segs = [];
    const baseXZ = [];
    for (let i = 0; i <= div; i++) {
      for (let j = 0; j < div; j++) {
        const x0 = -half + i * step, z0 = -half + j * step, z1 = z0 + step;
        segs.push([x0, z0, x0, z1]); // line along Z
        baseXZ.push([x0, z0, x0, z1]);
        const a0 = -half + j * step, a1 = a0 + step, b0 = -half + i * step;
        segs.push([a0, b0, a1, b0]); // line along X
        baseXZ.push([a0, b0, a1, b0]);
      }
    }
    const pos = new Float32Array(segs.length * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({ transparent: true, opacity });
    m.userData.baseOpacity = opacity;
    themeMat(m, role, true);
    const mesh = new THREE.LineSegments(geo, m);
    mesh.frustumCulled = false;
    let wells = [{ x: 0, z: 0, m: 2.4 }];
    function depthAt(x, z) {
      let y = 0;
      for (const w of wells) {
        const d = Math.hypot(x - w.x, z - w.z);
        y += -w.m / (1 + (d / 1.6) * (d / 1.6));
      }
      return y;
    }
    function refresh() {
      for (let s = 0; s < baseXZ.length; s++) {
        const [ax, az, bx, bz] = baseXZ[s];
        const o = s * 6;
        pos[o] = ax; pos[o + 1] = depthAt(ax, az); pos[o + 2] = az;
        pos[o + 3] = bx; pos[o + 4] = depthAt(bx, bz); pos[o + 5] = bz;
      }
      geo.attributes.position.needsUpdate = true;
    }
    refresh();
    return { mesh, setWells: (w) => { wells = w; refresh(); }, refresh, depthAt };
  }

  // ---------- chapter registry ----------
  const chapters = [];
  function chapter(builder) {
    const c = builder();
    root.add(c.group);
    chapters.push(c);
    return c;
  }

  // ============ CH0 — Into the Dark (hero) ============
  chapter(() => {
    const group = new THREE.Group();
    return {
      group,
      update() {},
      camera(lp, t) { return { pos: V(Math.sin(t * 0.03) * 0.5, 0.1, 11), target: V(0, 0, 0) }; },
      sky(lp, t) {
        return { presence: 0.9, lens: 1, camDist: lerp(13, 11.5, lp), incl: 0.22, disc: 0.55,
          discInner: 2.6, discOuter: 9.5, doppler: 0.45, yaw: t * 0.03 };
      },
    };
  });

  // ============ CH1 — The Fabric of Spacetime (drag the mass) ============
  chapter(() => {
    const group = new THREE.Group();
    const grid = warpGrid(16, 30, 'gridStrong', 0.55);
    group.add(grid.mesh);
    const mass = sprite('secondary', 1.0, 1);
    const massCore = sprite('hot', 0.4, 1);
    const grab = hotspot(0.9, 1.4);
    group.add(mass, massCore, grab);
    // test particles orbiting the well
    const orb = [];
    for (let i = 0; i < 5; i++) {
      const s = sprite('accent', 0.32, 0.9);
      orb.push({ s, a: (i / 5) * TAU, r: 2.4 + i * 0.7, sp: 0.5 + i * 0.12 });
      group.add(s);
    }
    let mx = 0, mz = 0, grabbed = false;
    return {
      group,
      update(lp, t, w, dt = 0.016) {
        const g = smootherstep(0, 0.3, lp);
        grid.mesh.scale.setScalar(g + 0.001);
        if (!grabbed) {
          mx += (Math.sin(t * 0.3) * 2.2 - mx) * (1 - Math.exp(-1.4 * dt));
          mz += (Math.cos(t * 0.24) * 1.8 - mz) * (1 - Math.exp(-1.4 * dt));
        }
        const yy = grid.depthAt(mx, mz);
        grid.setWells([{ x: mx, z: mz, m: 2.6 }]);
        mass.position.set(mx, yy + 0.4, mz);
        massCore.position.set(mx, yy + 0.4, mz);
        grab.position.set(mx, yy + 0.6, mz);
        grab.userData.ring.scale.setScalar(1.3 + Math.sin(t * 3) * 0.12);
        orb.forEach((o) => {
          o.a += dt * o.sp;
          const x = mx + Math.cos(o.a) * o.r, z = mz + Math.sin(o.a) * o.r;
          o.s.position.set(x, grid.depthAt(x, z) + 0.25, z);
        });
      },
      camera(lp, t) {
        const a = t * 0.05;
        return { pos: V(Math.sin(a) * 3.2, lerp(8.5, 6, lp), Math.cos(a) * 3.2 + 8.5), target: V(0, -1.2, 0) };
      },
      interactive: {
        objects: [{ id: 'mass', mesh: grab.userData.proxy }],
        grab() { grabbed = true; },
        drag(id, ndc, d) { mx = clamp(mx + d.x * 8, -6, 6); mz = clamp(mz - d.y * 8, -5, 5); },
        release() { grabbed = false; },
      },
    };
  });

  // ============ CH2 — Gravitational Lensing (drag to orbit) ============
  chapter(() => {
    const group = new THREE.Group();
    const grab = hotspot(2.6, 0); // whole-view grab, no ring
    group.add(grab);
    let yaw = 0, incl = 0.1, grabbed = false, vy = 0;
    return {
      group,
      update(lp, t, w, dt = 0.016) {
        if (!grabbed) { yaw += dt * (0.12 + vy); vy *= 0.94; }
      },
      camera() { return { pos: V(0, 0, 11), target: V(0, 0, 0) }; },
      sky(lp, t) {
        return { presence: smoothstep(0.0, 0.4, lp) * 0.55 + 0.0, lens: 1.0, camDist: 9.5,
          incl, yaw, disc: 0.0, doppler: 0.0 };
      },
      interactive: {
        objects: [{ id: 'view', mesh: grab.userData.proxy }],
        grab() { grabbed = true; vy = 0; },
        drag(id, ndc, d) { yaw -= d.x * 2.2; incl = clamp(incl + d.y * 1.6, -0.5, 0.5); vy = -d.x * 1.5; },
        release() { grabbed = false; },
      },
    };
  });

  // ============ CH3 — The Point of No Return (event horizon reveal) ============
  chapter(() => {
    const group = new THREE.Group();
    // an infalling probe that streaks toward the shadow and winks out
    const probe = sprite('accent', 0.4, 1);
    const trail = fatLine([0, 0, 0, 0, 0, 0], 'accent', 2, 0.5);
    group.add(trail, probe);
    return {
      group,
      update(lp, t) {
        const cyc = (t * 0.22) % 1;
        const ang = -0.6 + cyc * 2.2;
        const r = lerp(5.5, 0.2, smootherstep(0, 1, cyc));
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r * 0.5 - 0.4;
        probe.position.set(x, y, 1.2);
        const op = (1 - smoothstep(0.78, 1.0, cyc)) * smoothstep(0, 0.06, cyc);
        probe.material.opacity = op;
        trail.geometry.setPositions([Math.cos(-0.6) * 5.5, Math.sin(-0.6) * 5.5 * 0.5 - 0.4, 1.2, x, y, 1.2]);
        trail.material.opacity = op * 0.4;
      },
      camera() { return { pos: V(0, 0, 11), target: V(0, 0, 0) }; },
      sky(lp, t) {
        return { presence: smoothstep(0.0, 0.35, lp), lens: 1.0, camDist: lerp(8.5, 6.5, lp),
          incl: 0.16, disc: 0.12, discInner: 2.6, discOuter: 11, doppler: 0.3, yaw: t * 0.04 };
      },
    };
  });

  // ============ CH4 — The Photon Sphere (light orbits) ============
  chapter(() => {
    const group = new THREE.Group();
    // a photon looping around at the photon-sphere radius (illustrative, in front)
    const photon = sprite('hot', 0.34, 1);
    const ph2 = sprite('warm', 0.28, 0.9);
    group.add(photon, ph2);
    return {
      group,
      update(lp, t) {
        const a = t * 1.1;
        const r = 2.5;
        photon.position.set(Math.cos(a) * r, Math.sin(a * 0.5) * 0.3, Math.sin(a) * r);
        ph2.position.set(Math.cos(-a * 0.8 + 2) * (r + 0.4), Math.sin(a * 0.4) * 0.3, Math.sin(-a * 0.8 + 2) * (r + 0.4));
      },
      camera(lp, t) { const a = t * 0.06; return { pos: V(Math.sin(a) * 2, 1.0, 9), target: V(0, 0, 0) }; },
      sky(lp, t) {
        return { presence: 1, lens: 1.0, camDist: lerp(6.0, 4.8, lp), incl: 0.12, disc: 0.18,
          discInner: 2.6, discOuter: 10, doppler: 0.4, yaw: t * 0.05 };
      },
    };
  });

  // ============ CH5 — The Accretion Disc (drag: tilt + accretion rate) ============
  chapter(() => {
    const group = new THREE.Group();
    const grab = hotspot(2.6, 1.8);
    grab.position.set(0, 0, 2.5);
    group.add(grab);
    let incl = 0.26, rate = 0.7, grabbed = false;
    return {
      group,
      update(lp, t) {
        grab.userData.ring.scale.setScalar(1.7 + Math.sin(t * 3) * 0.14);
      },
      camera() { return { pos: V(0, 0, 11), target: V(0, 0, 0) }; },
      sky(lp, t) {
        return { presence: 1, lens: 1.0, camDist: lerp(9.5, 8.0, lp), incl,
          disc: 0.45 + rate * 0.45, discInner: 2.5, discOuter: 10.5, doppler: 0.55, yaw: t * 0.03 };
      },
      interactive: {
        objects: [{ id: 'disc', mesh: grab.userData.proxy }],
        grab() { grabbed = true; },
        drag(id, ndc, d) {
          incl = clamp(incl - d.y * 1.4, -0.02, 1.3);   // tilt edge-on -> top-down
          rate = clamp(rate + d.x * 1.6, 0.0, 1.0);     // accretion brightness
        },
        release() { grabbed = false; },
      },
    };
  });

  // ============ CH6 — Spaghettification (drag the astronaut in) ============
  chapter(() => {
    const group = new THREE.Group();
    const fig = new THREE.Group();
    const head = sprite('creature', 0.46, 1);
    head.position.set(0, 1.0, 0);
    const body = fatLine([0, 0.7, 0, 0, -0.5, 0], 'creature', 3, 1);
    const arms = fatLine([-0.5, 0.4, 0, 0.5, 0.4, 0], 'creature', 2.6, 1);
    const legL = fatLine([0, -0.5, 0, -0.32, -1.2, 0], 'creature', 2.6, 1);
    const legR = fatLine([0, -0.5, 0, 0.32, -1.2, 0], 'creature', 2.6, 1);
    const foot = sprite('apple', 0.34, 1); // leading point, reddens
    foot.position.set(0, -1.25, 0);
    fig.add(head, body, arms, legL, legR, foot);
    const grab = hotspot(1.0, 1.4);
    group.add(fig, grab);
    let fall = 0, grabbed = false; // 0 = far, 1 = at horizon
    return {
      group,
      update(lp, t, w, dt = 0.016) {
        if (!grabbed) fall += (((Math.sin(t * 0.4) * 0.5 + 0.5) * 0.85) - fall) * (1 - Math.exp(-1.2 * dt));
        fall = clamp(fall, 0, 1);
        const dist = lerp(4.6, 0.9, fall);     // distance above the hole (hole below)
        const stretch = 1 + Math.pow(fall, 1.6) * 6.5;
        const squeeze = 1 / (1 + Math.pow(fall, 1.6) * 2.0);
        fig.position.set(0, dist, 1.5);
        fig.scale.set(squeeze, stretch, 1);
        fig.rotation.z = 0; // pointing toward the hole (down)
        const redden = Math.pow(fall, 1.5);
        foot.material.opacity = 1;
        head.material.opacity = 1 - redden * 0.4;
        grab.position.set(0, dist + 1.0 * stretch * 0.3, 1.6);
        grab.userData.ring.scale.setScalar(1.3 + Math.sin(t * 3) * 0.12);
      },
      camera(lp, t) { return { pos: V(Math.sin(t * 0.05) * 1.0, 0.6, 9.5), target: V(0, 0.2, 0) }; },
      sky(lp, t) {
        return { presence: 1, lens: 1.0, camDist: 7.5, incl: 0.5, disc: 0.25,
          discInner: 2.6, discOuter: 10, doppler: 0.4, yaw: t * 0.02 };
      },
      interactive: {
        objects: [{ id: 'astro', mesh: grab.userData.proxy }],
        grab() { grabbed = true; },
        drag(id, ndc, d) { fall = clamp(fall - d.y * 1.3, 0, 1); },
        release() { grabbed = false; },
      },
    };
  });

  // ============ CH7 — The Plunge (scroll = dive through the horizon) ============
  chapter(() => {
    const group = new THREE.Group();
    return {
      group,
      update() {},
      camera() { return { pos: V(0, 0, 11), target: V(0, 0, 0) }; },
      sky(lp, t) {
        // dive toward the photon sphere: lensing intensifies and the disc + stars
        // smear into a bright shrinking ring; then the throat tunnel carries you
        // through. We hold just outside the horizon (the sky would go all-black
        // inside) and let the tunnel do the "crossing over".
        const dive = smootherstep(0, 0.72, lp);
        const camDist = lerp(8.0, 3.1, dive);
        const fov = lerp(0.6, 1.05, dive);
        const throat = smoothstep(0.58, 1.0, lp);
        return { presence: 1, lens: lerp(1.0, 1.55, dive), camDist, incl: lerp(0.2, 0.06, dive),
          fov, disc: lerp(1.0, 1.35, dive), discInner: 2.4, discOuter: 12, doppler: 0.6,
          throat, yaw: t * 0.06 };
      },
    };
  });

  // ============ CH8 — The Singularity (where the equations break) ============
  chapter(() => {
    const group = new THREE.Group();
    // worldlines / grid lines all crashing into a single point
    const N = 26;
    const lines = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const r = 5.0;
      const l = fatLine([Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 3, 0, 0, 0], i % 3 === 0 ? 'quantum' : 'secondary', 2, 0.7);
      lines.push({ l, a });
      group.add(l);
    }
    const core = sprite('hot', 0.7, 1);
    const coreDark = sprite('secondary', 1.4, 0.0);
    group.add(coreDark, core);
    return {
      group,
      update(lp, t) {
        const conv = smootherstep(0, 0.6, lp);
        lines.forEach((o, i) => {
          const r = lerp(5.0, 0.05, conv) * (0.7 + 0.3 * Math.sin(t * 0.5 + i));
          const jitter = conv * 0.4 * Math.sin(t * 9 + i * 2);
          o.l.geometry.setPositions([
            Math.cos(o.a) * r + jitter, Math.sin(o.a) * r - jitter, Math.sin(t + i) * 2 * (1 - conv),
            0, 0, 0,
          ]);
        });
        const p = 0.5 + Math.sin(t * 6) * 0.2 * lp + lp * 0.8;
        core.scale.setScalar(p);
        core.material.opacity = 0.6 + lp * 0.4;
        group.rotation.z = t * 0.1;
      },
      camera(lp, t) { return { pos: V(Math.sin(t * 0.06) * 0.6, 0, lerp(10, 6.5, lp)), target: V(0, 0, 0) }; },
      sky(lp, t) { return { presence: 0, throat: 1 - smoothstep(0.0, 0.25, lp) }; },
    };
  });

  // ============ CH9 — Two Realms in Conflict (drag the seam) ============
  chapter(() => {
    const group = new THREE.Group();
    // LEFT: smooth relativity grid (warped). RIGHT: quantum foam (jittering points).
    const relGrid = warpGrid(9, 18, 'secondary', 0.6);
    relGrid.mesh.position.set(-5, 0, 0);
    relGrid.setWells([{ x: 0, z: 0, m: 1.6 }]);
    group.add(relGrid.mesh);
    const foam = points(420, 'quantum', 0.18, 0.9);
    group.add(foam.points);
    const foamBase = [];
    for (let i = 0; i < 420; i++) {
      foamBase.push([(Math.random() * 4.2) , (Math.random() - 0.5) * 5.0, (Math.random() - 0.5) * 5.0]);
    }
    // the clashing seam
    const seam = fatLine([0, -3, 0, 0, 3, 0], 'hot', 3, 0.9);
    const spark = sprite('hot', 0.7, 1);
    const grab = hotspot(0.9, 1.4);
    group.add(seam, spark, grab);
    let split = 0.0, grabbed = false; // -1 .. 1 seam position
    return {
      group,
      update(lp, t, w, dt = 0.016) {
        if (!grabbed) split += ((Math.sin(t * 0.3) * 0.6) - split) * (1 - Math.exp(-1.2 * dt));
        const sx = split * 2.6;
        relGrid.mesh.position.x = -4.6 + sx;
        // foam jitter, only the cells right of the seam
        for (let i = 0; i < foamBase.length; i++) {
          const [bx, by, bz] = foamBase[i];
          const x = sx + 0.4 + bx;
          const jx = Math.sin(t * 11 + i) * 0.12;
          const jy = Math.cos(t * 13 + i * 1.3) * 0.12;
          foam.pos[i * 3] = x + jx;
          foam.pos[i * 3 + 1] = by + jy;
          foam.pos[i * 3 + 2] = bz + Math.sin(t * 9 + i * 0.7) * 0.12;
        }
        foam.geo.attributes.position.needsUpdate = true;
        seam.position.x = sx;
        spark.position.set(sx, Math.sin(t * 2) * 1.5, 0);
        const sp = 0.5 + Math.abs(Math.sin(t * 6)) * 0.5;
        spark.scale.set(sp, sp, 1);
        grab.position.set(sx, 2.4, 0.3);
        grab.userData.ring.scale.setScalar(1.3 + Math.sin(t * 3) * 0.12);
      },
      camera(lp, t) { return { pos: V(0, 0.4, 10.5), target: V(0, 0, 0) }; },
      interactive: {
        objects: [{ id: 'seam', mesh: grab.userData.proxy }],
        grab() { grabbed = true; },
        drag(id, ndc, d) { split = clamp(split + d.x * 2.4, -1, 1); },
        release() { grabbed = false; },
      },
    };
  });

  // ============ CH10 — Hawking Radiation (the hole evaporates) ============
  chapter(() => {
    const group = new THREE.Group();
    // virtual pairs at the horizon: one escapes, one falls in
    const pairs = [];
    for (let i = 0; i < 9; i++) {
      const out = sprite('whitehole', 0.3, 0);
      const inn = sprite('quantum', 0.3, 0);
      pairs.push({ out, inn, ph: Math.random(), a: Math.random() * TAU, sp: 0.18 + Math.random() * 0.12 });
      group.add(out, inn);
    }
    return {
      group,
      update(lp, t, w, dt = 0.016) {
        pairs.forEach((p) => {
          p.ph += dt * p.sp;
          if (p.ph > 1) { p.ph -= 1; p.a = Math.random() * TAU; }
          const R = 2.2;
          const bx = Math.cos(p.a) * R, by = Math.sin(p.a) * R;
          const e = p.ph;
          // escaping partner drifts outward & fades in then out
          const er = R + e * 3.2;
          p.out.position.set(Math.cos(p.a) * er, Math.sin(p.a) * er, 0.6);
          p.out.material.opacity = smoothstep(0, 0.15, e) * (1 - smoothstep(0.7, 1, e));
          // infalling partner spirals in
          const ir = R - e * R * 0.95;
          p.inn.position.set(Math.cos(p.a + e) * ir, Math.sin(p.a + e) * ir, 0.6);
          p.inn.material.opacity = smoothstep(0, 0.15, e) * (1 - smoothstep(0.6, 0.95, e));
        });
      },
      camera(lp, t) { const a = t * 0.05; return { pos: V(Math.sin(a) * 1.2, 0.3, 9), target: V(0, 0, 0) }; },
      sky(lp, t) {
        // the hole shrinks as it evaporates across the chapter
        const shrink = 1 - smoothstep(0.3, 1.0, lp) * 0.55;
        return { presence: 1, lens: shrink, camDist: 6.2, incl: 0.2, disc: 0.12 * shrink,
          discInner: 2.6, discOuter: 9, doppler: 0.3, yaw: t * 0.05 };
      },
    };
  });

  // ============ CH11 — Information Paradox / ER=EPR (drag the entangled pair) ============
  chapter(() => {
    const group = new THREE.Group();
    const a = sprite('quantum', 0.5, 1);
    const b = sprite('secondary', 0.5, 1);
    a.position.set(-3, 0.5, 0);
    b.position.set(3, -0.5, 0);
    // the entanglement bridge: a tube that bows like a little wormhole throat
    const bridge = fatLine([0, 0, 0, 0, 0, 0], 'exotic', 2.5, 0.85);
    const rings = [];
    for (let i = 0; i < 5; i++) { const r = fatLine(circleFlat(0.3, 24, 'xy'), 'exotic', 1.6, 0.6); rings.push(r); group.add(r); }
    const grab = hotspot(0.8, 1.3);
    group.add(bridge, a, b, grab);
    let ax = -3, ay = 0.5, grabbed = false;
    function rebuild(t) {
      const pa = new THREE.Vector3(ax, ay, 0), pb = b.position;
      const flat = [];
      const seg = 40;
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      const dist = pa.distanceTo(pb);
      mid.z = -Math.min(2.4, dist * 0.5); // bow away -> throat
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        // quadratic bezier through mid
        const x = (1 - u) * (1 - u) * pa.x + 2 * (1 - u) * u * mid.x + u * u * pb.x;
        const y = (1 - u) * (1 - u) * pa.y + 2 * (1 - u) * u * mid.y + u * u * pb.y;
        const z = (1 - u) * (1 - u) * pa.z + 2 * (1 - u) * u * mid.z + u * u * pb.z;
        flat.push(x, y, z);
      }
      bridge.geometry.setPositions(flat);
      // a few throat rings near the middle
      rings.forEach((r, i) => {
        const u = 0.5 + (i - 2) * 0.08;
        const x = (1 - u) * (1 - u) * pa.x + 2 * (1 - u) * u * mid.x + u * u * pb.x;
        const y = (1 - u) * (1 - u) * pa.y + 2 * (1 - u) * u * mid.y + u * u * pb.y;
        const z = (1 - u) * (1 - u) * pa.z + 2 * (1 - u) * u * mid.z + u * u * pb.z;
        r.position.set(x, y, z);
        const rs = 0.5 + Math.abs(i - 2) * 0.25;
        r.scale.setScalar(rs);
        r.lookAt(pb);
      });
    }
    return {
      group,
      update(lp, t, w, dt = 0.016) {
        if (!grabbed) { ax += ((-3 + Math.sin(t * 0.5) * 1.5) - ax) * (1 - Math.exp(-1.4 * dt)); ay += ((0.5 + Math.cos(t * 0.4)) - ay) * (1 - Math.exp(-1.4 * dt)); }
        a.position.set(ax, ay, 0);
        b.position.set(3, -0.5 + Math.sin(t * 0.3) * 0.4, 0);
        rebuild(t);
        grab.position.set(ax, ay, 0.2);
        grab.userData.ring.scale.setScalar(1.2 + Math.sin(t * 3) * 0.12);
      },
      camera(lp, t) { return { pos: V(Math.sin(t * 0.05) * 0.8, 0.3, 9.5), target: V(0, 0, 0) }; },
      interactive: {
        objects: [{ id: 'ent', mesh: grab.userData.proxy }],
        grab() { grabbed = true; },
        drag(id, ndc, d) { ax = clamp(ax + d.x * 7, -5.5, 1.5); ay = clamp(ay + d.y * 7, -3, 3.5); },
        release() { grabbed = false; },
      },
    };
  });

  // ============ CH12 — White Holes (matter can only leave) ============
  chapter(() => {
    const group = new THREE.Group();
    const C = V(2.6, 1.2, 0); // offset to the right, clear of the left-aligned text
    const core = sprite('whitehole', 2.2, 1);
    const coreHot = sprite('hot', 1.0, 1);
    const flare = sprite('whitehole', 3.4, 0.5);
    core.position.copy(C); coreHot.position.copy(C); flare.position.copy(C);
    group.add(flare, core, coreHot);
    const ej = points(320, 'whitehole', 0.24, 0.95);
    group.add(ej.points);
    const part = [];
    for (let i = 0; i < 320; i++) {
      const a = Math.random() * TAU, ph = Math.acos(2 * Math.random() - 1);
      part.push({ a, ph, r: Math.random() * 8, sp: 0.8 + Math.random() * 1.6 });
    }
    // draggable matter that gets repelled
    const matter = sprite('apple', 0.5, 1);
    const grab = hotspot(0.8, 1.3);
    group.add(matter, grab);
    let mr = 5.5, ma = 0.6, grabbed = false, push = 0;
    return {
      group,
      update(lp, t, w, dt = 0.016) {
        const cp = 2.0 + Math.sin(t * 2) * 0.18;
        core.scale.setScalar(cp); coreHot.scale.setScalar(1.0 + Math.sin(t * 3) * 0.12);
        flare.scale.setScalar(3.2 + Math.sin(t * 1.3) * 0.4);
        for (let i = 0; i < part.length; i++) {
          const p = part[i];
          p.r += dt * p.sp;
          if (p.r > 8.5) { p.r = 0.5; p.a = Math.random() * TAU; p.ph = Math.acos(2 * Math.random() - 1); }
          const sx = Math.sin(p.ph) * Math.cos(p.a), sy = Math.sin(p.ph) * Math.sin(p.a), sz = Math.cos(p.ph);
          ej.pos[i * 3] = C.x + sx * p.r; ej.pos[i * 3 + 1] = C.y + sy * p.r; ej.pos[i * 3 + 2] = C.z + sz * p.r;
        }
        ej.geo.attributes.position.needsUpdate = true;
        // matter: pushed outward, can never get closer than ~2
        if (!grabbed) { push *= 0.92; mr = clamp(mr + push + dt * 0.4, 2.2, 7); }
        if (mr < 2.6) push = Math.max(push, (2.6 - mr) * 4); // repel
        matter.position.set(C.x + Math.cos(ma) * mr, C.y + Math.sin(ma) * mr * 0.6, 1.0);
        grab.position.copy(matter.position);
        grab.userData.ring.scale.setScalar(1.2 + Math.sin(t * 3) * 0.12);
        group.rotation.y = 0;
      },
      camera(lp, t) { const a = t * 0.06; return { pos: V(Math.sin(a) * 1.2, 0.5, 9.0), target: V(0.5, 0.3, 0) }; },
      interactive: {
        objects: [{ id: 'matter', mesh: grab.userData.proxy }],
        grab() { grabbed = true; },
        drag(id, ndc, d) {
          const nr = clamp(mr - d.y * 6, 2.0, 7); // try to drag inward
          if (nr < 2.4) push = 3.5;               // bounce back
          mr = nr; ma += d.x * 0.8;
        },
        release() { grabbed = false; },
      },
    };
  });

  // ============ CH13 — Wormholes / Einstein-Rosen Bridge (drag to travel) ============
  chapter(() => {
    const group = new THREE.Group();
    // embedding diagram: two funnels meeting at a throat, drawn as stacked rings
    const rings = [];
    const RN = 22, b = 1.0;
    for (let i = 0; i < RN; i++) {
      const u = (i / (RN - 1)) * 2 - 1;          // -1..1
      const z = u * 4.2;
      const r = Math.sqrt(b * b + (u * 3.0) * (u * 3.0)); // wormhole profile
      const role = i < RN / 2 ? 'secondary' : 'exotic';
      const c = fatLine(circleFlat(r, 48, 'xy'), role, 1.8, 0.7);
      c.position.z = z;
      rings.push(c);
      group.add(c);
    }
    // longitudinal lines
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      const flat = [];
      for (let i = 0; i < RN; i++) {
        const u = (i / (RN - 1)) * 2 - 1;
        const z = u * 4.2;
        const r = Math.sqrt(b * b + (u * 3.0) * (u * 3.0));
        flat.push(Math.cos(a) * r, Math.sin(a) * r, z);
      }
      group.add(fatLine(flat, k % 2 ? 'secondary' : 'exotic', 1.2, 0.4));
    }
    const grab = hotspot(2.4, 1.6);
    group.add(grab);
    let travel = 0, grabbed = false; // 0..1 journey through the throat
    return {
      group,
      update(lp, t, w, dt = 0.016) {
        if (!grabbed) travel += (((Math.sin(t * 0.25) * 0.5 + 0.5) * 0.4) - travel) * (1 - Math.exp(-1.0 * dt));
        travel = clamp(travel, 0, 1);
        group.rotation.y = t * 0.18;
        group.rotation.x = 0.5 + Math.sin(t * 0.1) * 0.1;
        grab.position.set(0, 0, 0);
        grab.userData.ring.scale.setScalar(1.6 + Math.sin(t * 3) * 0.12);
      },
      camera(lp, t) { return { pos: V(0, 1.5, lerp(11, 8, lp)), target: V(0, 0, 0) }; },
      sky(lp, t) {
        return { presence: 0, throat: travel, };
      },
      interactive: {
        objects: [{ id: 'worm', mesh: grab.userData.proxy }],
        grab() { grabbed = true; },
        drag(id, ndc, d) { travel = clamp(travel + d.y * 1.2, 0, 1); },
        release() { grabbed = false; },
      },
    };
  });

  // ============ CH14 — The Unfinished Map (quantum gravity) ============
  chapter(() => {
    const group = new THREE.Group();
    // a shimmering lattice where the smooth and the grainy try to become one
    const lat = [];
    const S = 4, D = 5;
    for (let i = 0; i <= D; i++)
      for (let j = 0; j <= D; j++)
        for (let k = 0; k <= D; k++) {
          if ((i + j + k) % 2) continue;
          const s = sprite(k % 2 ? 'secondary' : 'quantum', 0.16, 0.8);
          const base = V((i / D - 0.5) * S, (j / D - 0.5) * S, (k / D - 0.5) * S);
          s.userData.base = base;
          lat.push(s);
          group.add(s);
        }
    const edges = fatLine([0, 0, 0, 0, 0, 0], 'accent', 1.2, 0.0);
    group.add(edges);
    return {
      group,
      update(lp, t) {
        lat.forEach((s, i) => {
          const b = s.userData.base;
          const j = 0.12 * Math.sin(t * 2 + i);
          s.position.set(b.x + j, b.y + Math.cos(t * 1.7 + i) * 0.12, b.z + Math.sin(t * 1.3 + i) * 0.12);
        });
        group.rotation.y = t * 0.12;
        group.rotation.x = Math.sin(t * 0.1) * 0.2;
      },
      camera(lp, t) { return { pos: V(Math.sin(t * 0.05) * 1.5, 0.5, lerp(9, 7.5, lp)), target: V(0, 0, 0) }; },
      sky(lp, t) { return { presence: 0.25 * (1 - lp), lens: 1, camDist: 13, incl: 0.2, disc: 0.1, yaw: t * 0.04 }; },
    };
  });

  // ============ CH15 — There's a Way Out (outro) ============
  chapter(() => {
    const group = new THREE.Group();
    return {
      group,
      update() {},
      camera() { return { pos: V(0, 0, 11), target: V(0, 0, 0) }; },
      sky(lp, t) {
        // pull back: the hole becomes a distant point of light
        const out = smootherstep(0, 1, lp);
        return { presence: lerp(1, 0.5, out), lens: 1, camDist: lerp(6.5, 24, out), incl: 0.14,
          disc: lerp(0.7, 0.25, out), discInner: 2.6, discOuter: 13, doppler: 0.4, yaw: t * 0.04 };
      },
    };
  });

  function recolor(p) { themed.forEach((fn) => fn(p)); }
  function resize(w, h) { onResize.forEach((fn) => fn(w, h)); }
  recolor(palette);

  return { root, chapters, recolor, resize };
}
