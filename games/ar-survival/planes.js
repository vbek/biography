/* AR Survival — the player's aircraft. Each model is a small low-poly 3D mesh built once in code, then drawn every
   frame with flat lighting and perspective on the 2D canvas, so it can bank, pitch and turn with the player.
   Model space: x to the right wing, y up, z towards the nose. Units are roughly one half-wingspan. */
window.ARPlanes = (() => {
  'use strict';
  const TAU = Math.PI * 2;
  const CAM = 6; // camera distance in model units: enough perspective to read depth without distorting the shape

  /* ---------- mesh building ---------- */
  function newMesh() { return { v: [], f: [], glows: [], prop: null }; }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // adds a polygon, turning it so its normal points away from `ref` (a point inside the part it belongs to)
  function face(m, pts, mat, ref) {
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0]; cy += a[1]; cz += a[2];
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-7) return;
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    if (nx * (cx - ref[0]) + ny * (cy - ref[1]) + nz * (cz - ref[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const idx = pts.map((p) => { m.v.push(p[0], p[1], p[2]); return m.v.length / 3 - 1; });
    m.f.push({ idx, n: [nx / len, ny / len, nz / len], mat });
  }

  // a body of revolution-ish shape from cross-sections ordered nose to tail: {z, w, h, y?, x?}
  function loft(m, secs, mat, o = {}) {
    const N = o.n || 10, ex = 2 / (o.exp || 2.4);
    const ring = (s) => {
      const out = [];
      for (let k = 0; k < N; k++) {
        const a = (k / N) * TAU, c = Math.cos(a), sn = Math.sin(a);
        out.push([(s.x || 0) + s.w * Math.sign(c) * Math.abs(c) ** ex, (s.y || 0) + s.h * Math.sign(sn) * Math.abs(sn) ** ex, s.z]);
      }
      return out;
    };
    const rings = secs.map(ring);
    for (let i = 0; i < secs.length - 1; i++) {
      const A = rings[i], B = rings[i + 1], ref = [secs[i].x || 0, ((secs[i].y || 0) + (secs[i + 1].y || 0)) / 2, (secs[i].z + secs[i + 1].z) / 2];
      const segMat = o.mats ? o.mats[i] ?? mat : mat;
      for (let k = 0; k < N; k++) {
        const k2 = (k + 1) % N;
        face(m, [A[k], A[k2], B[k2], B[k]], segMat, ref);
      }
    }
    const first = secs[0], last = secs[secs.length - 1];
    if (first.w > 0) face(m, rings[0], o.capMat ?? mat, [first.x || 0, first.y || 0, first.z - 1]);
    if (last.w > 0) face(m, rings[rings.length - 1], o.capMat ?? mat, [last.x || 0, last.y || 0, last.z + 1]);
  }

  // a flat panel with thickness (wing, tailplane, fin) from four mid-surface corners: root LE, tip LE, tip TE, root TE
  function slab(m, P, t0, t1, mat, mirror = true) {
    const make = (Q) => {
      const n = norm(cross(sub(Q[1], Q[0]), sub(Q[3], Q[0]))), th = [t0, t1, t1, t0];
      const T = Q.map((p, i) => [p[0] + n[0] * th[i] / 2, p[1] + n[1] * th[i] / 2, p[2] + n[2] * th[i] / 2]);
      const B = Q.map((p, i) => [p[0] - n[0] * th[i] / 2, p[1] - n[1] * th[i] / 2, p[2] - n[2] * th[i] / 2]);
      const ref = [0, 1, 2].map((j) => (Q[0][j] + Q[1][j] + Q[2][j] + Q[3][j]) / 4);
      face(m, T, mat, ref);
      face(m, B, mat, ref);
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; face(m, [T[i], T[j], B[j], B[i]], mat, ref); }
    };
    make(P);
    if (mirror) make(P.map((p) => [-p[0], p[1], p[2]]).reverse());
  }
  const both = (fn) => { fn(1); fn(-1); };

  /* ---------- the hangar ---------- */
  // materials: c = base colour, s = shine
  const DEFS = {
    falcon: {
      name: 'Falcon', blurb: 'Agile single-engine fighter',
      mats: [{ c: [168, 180, 196], s: 0.35 }, { c: [70, 78, 92], s: 0.3 }, { c: [40, 120, 170], s: 1.4, glass: 1 }, { c: [235, 238, 242], s: 0.4 }, { c: [36, 38, 44], s: 0.2 }],
      build(m) {
        loft(m, [
          { z: 1.3, w: 0, h: 0 }, { z: 1.08, w: 0.06, h: 0.06 }, { z: 0.8, w: 0.12, h: 0.12, y: 0.01 }, { z: 0.45, w: 0.16, h: 0.16, y: 0.02 },
          { z: 0.05, w: 0.19, h: 0.16 }, { z: -0.5, w: 0.19, h: 0.15 }, { z: -0.92, w: 0.15, h: 0.13 }, { z: -1.05, w: 0.12, h: 0.11 },
        ], 0, { mats: [1, 0], capMat: 4 });
        loft(m, [{ z: 0.8, w: 0, h: 0, y: 0.12 }, { z: 0.62, w: 0.075, h: 0.08, y: 0.15 }, { z: 0.36, w: 0.095, h: 0.1, y: 0.17 }, { z: 0.08, w: 0.075, h: 0.075, y: 0.16 }, { z: -0.15, w: 0, h: 0, y: 0.13 }], 2, { n: 8 });
        loft(m, [{ z: 0.4, w: 0.0, h: 0.0, y: -0.14 }, { z: 0.25, w: 0.12, h: 0.06, y: -0.15 }, { z: -0.3, w: 0.12, h: 0.06, y: -0.14 }, { z: -0.5, w: 0, h: 0, y: -0.12 }], 1, { n: 8 });
        slab(m, [[0.16, 0, 0.32], [1.0, -0.03, -0.34], [1.0, -0.03, -0.52], [0.16, 0, -0.6]], 0.05, 0.02, 0);
        slab(m, [[0.13, -0.01, -0.66], [0.5, -0.04, -0.9], [0.5, -0.04, -1.02], [0.13, -0.01, -1.02]], 0.03, 0.012, 0);
        slab(m, [[0, 0.14, -0.38], [0, 0.66, -0.84], [0, 0.66, -0.98], [0, 0.13, -1.0]], 0.035, 0.015, 0, false);
        both((s) => loft(m, [{ z: 0.25, w: 0, h: 0, x: s * 1.02, y: -0.03 }, { z: 0.15, w: 0.028, h: 0.028, x: s * 1.02, y: -0.03 }, { z: -0.6, w: 0.028, h: 0.028, x: s * 1.02, y: -0.03 }], 3, { n: 6 }));
        m.glows.push({ p: [0, 0, -1.08], r: 0.2, col: 'fire' });
      },
    },
    talon: {
      name: 'Talon', blurb: 'Twin-engine heavy fighter',
      mats: [{ c: [112, 124, 138], s: 0.3 }, { c: [62, 70, 82], s: 0.3 }, { c: [196, 156, 60], s: 1.3, glass: 1 }, { c: [148, 160, 172], s: 0.3 }, { c: [34, 36, 42], s: 0.2 }],
      build(m) {
        loft(m, [
          { z: 1.35, w: 0, h: 0 }, { z: 1.12, w: 0.07, h: 0.06 }, { z: 0.8, w: 0.14, h: 0.12, y: 0.02 }, { z: 0.45, w: 0.2, h: 0.14, y: 0.03 },
          { z: 0.1, w: 0.3, h: 0.13 }, { z: -0.6, w: 0.32, h: 0.12 }, { z: -0.95, w: 0.28, h: 0.1 },
        ], 0, { mats: [1, 0], capMat: 4, exp: 3 });
        loft(m, [{ z: 0.85, w: 0, h: 0, y: 0.11 }, { z: 0.66, w: 0.08, h: 0.08, y: 0.14 }, { z: 0.38, w: 0.1, h: 0.1, y: 0.16 }, { z: 0.08, w: 0.07, h: 0.07, y: 0.14 }, { z: -0.12, w: 0, h: 0, y: 0.11 }], 2, { n: 8 });
        both((s) => loft(m, [{ z: -0.85, w: 0.1, h: 0.1, x: s * 0.15 }, { z: -1.08, w: 0.09, h: 0.09, x: s * 0.15 }], 4, { n: 8 }));
        slab(m, [[0.26, 0, 0.42], [1.12, -0.02, -0.42], [1.12, -0.02, -0.6], [0.3, 0, -0.66]], 0.06, 0.02, 0);
        slab(m, [[0.28, 0, -0.7], [0.68, -0.02, -0.92], [0.68, -0.02, -1.05], [0.28, 0, -1.05]], 0.03, 0.012, 3);
        slab(m, [[0.22, 0.1, -0.36], [0.4, 0.58, -0.76], [0.4, 0.58, -0.92], [0.24, 0.09, -0.95]], 0.035, 0.015, 3);
        both((s) => m.glows.push({ p: [s * 0.15, 0, -1.1], r: 0.17, col: 'fire' }));
      },
    },
    dart: {
      name: 'Dart', blurb: 'Delta-wing interceptor',
      mats: [{ c: [232, 234, 238], s: 0.45 }, { c: [200, 40, 48], s: 0.4 }, { c: [30, 40, 60], s: 1.5, glass: 1 }, { c: [150, 156, 166], s: 0.3 }, { c: [36, 38, 44], s: 0.2 }],
      build(m) {
        loft(m, [
          { z: 1.45, w: 0, h: 0 }, { z: 1.15, w: 0.06, h: 0.06 }, { z: 0.8, w: 0.11, h: 0.12, y: 0.01 }, { z: 0.35, w: 0.15, h: 0.15, y: 0.02 },
          { z: -0.3, w: 0.16, h: 0.15 }, { z: -0.95, w: 0.13, h: 0.12 },
        ], 0, { mats: [1], capMat: 4 });
        loft(m, [{ z: 0.92, w: 0, h: 0, y: 0.11 }, { z: 0.72, w: 0.07, h: 0.08, y: 0.14 }, { z: 0.42, w: 0.085, h: 0.1, y: 0.16 }, { z: 0.15, w: 0.06, h: 0.06, y: 0.14 }, { z: -0.05, w: 0, h: 0, y: 0.12 }], 2, { n: 8 });
        slab(m, [[0.12, -0.01, 0.3], [0.98, -0.05, -0.78], [0.98, -0.05, -0.9], [0.12, -0.01, -0.96]], 0.06, 0.015, 0);
        slab(m, [[0.12, 0.03, 0.72], [0.4, 0.04, 0.5], [0.4, 0.04, 0.43], [0.12, 0.03, 0.44]], 0.025, 0.01, 1);
        slab(m, [[0, 0.13, -0.3], [0, 0.72, -0.86], [0, 0.72, -1.0], [0, 0.12, -0.98]], 0.035, 0.015, 1, false);
        m.glows.push({ p: [0, 0, -0.98], r: 0.2, col: 'fire' });
      },
    },
    wraith: {
      name: 'Wraith', blurb: 'Stealth flying wing',
      mats: [{ c: [58, 62, 72], s: 0.25 }, { c: [44, 47, 55], s: 0.2 }, { c: [150, 120, 50], s: 1.5, glass: 1 }, { c: [80, 86, 98], s: 0.25 }, { c: [24, 25, 30], s: 0.1 }],
      build(m) {
        loft(m, [
          { z: 1.05, w: 0, h: 0 }, { z: 0.8, w: 0.14, h: 0.06, y: 0.02 }, { z: 0.4, w: 0.27, h: 0.1, y: 0.03 },
          { z: -0.2, w: 0.33, h: 0.1, y: 0.02 }, { z: -0.7, w: 0.26, h: 0.06 }, { z: -0.82, w: 0.2, h: 0.04 },
        ], 0, { exp: 3.2, capMat: 4 });
        loft(m, [{ z: 0.72, w: 0, h: 0, y: 0.06 }, { z: 0.55, w: 0.1, h: 0.05, y: 0.1 }, { z: 0.3, w: 0.11, h: 0.06, y: 0.12 }, { z: 0.1, w: 0, h: 0, y: 0.09 }], 2, { n: 8, exp: 3 });
        slab(m, [[0.22, 0.01, 0.68], [0.7, 0, 0.12], [0.7, 0, -0.36], [0.22, 0.01, -0.62]], 0.08, 0.04, 1);
        slab(m, [[0.7, 0, 0.12], [1.28, -0.03, -0.56], [1.2, -0.03, -0.72], [0.7, 0, -0.36]], 0.04, 0.012, 0);
        both((s) => m.glows.push({ p: [s * 0.14, 0.02, -0.84], r: 0.13, col: 'cyan' }));
      },
    },
    kestrel: {
      name: 'Kestrel', blurb: 'Propeller warbird',
      mats: [{ c: [104, 116, 72], s: 0.25 }, { c: [234, 186, 46], s: 0.5 }, { c: [130, 170, 190], s: 1.4, glass: 1 }, { c: [180, 186, 160], s: 0.2 }, { c: [40, 40, 40], s: 0.2 }],
      build(m) {
        loft(m, [{ z: 1.28, w: 0, h: 0, y: 0.01 }, { z: 1.2, w: 0.06, h: 0.06, y: 0.01 }, { z: 1.08, w: 0.1, h: 0.1, y: 0.01 }], 1, { n: 10, exp: 2 });
        loft(m, [
          { z: 1.08, w: 0.12, h: 0.12, y: 0.01 }, { z: 0.85, w: 0.17, h: 0.17, y: 0.01 }, { z: 0.35, w: 0.17, h: 0.19, y: 0.02 },
          { z: -0.3, w: 0.12, h: 0.14, y: 0.03 }, { z: -0.85, w: 0.06, h: 0.08, y: 0.04 }, { z: -1.08, w: 0, h: 0, y: 0.05 },
        ], 0, { n: 10, exp: 2, mats: [1] });
        loft(m, [{ z: 0.42, w: 0, h: 0, y: 0.15 }, { z: 0.3, w: 0.08, h: 0.09, y: 0.18 }, { z: 0.02, w: 0.08, h: 0.09, y: 0.19 }, { z: -0.25, w: 0, h: 0, y: 0.15 }], 2, { n: 8, exp: 2 });
        slab(m, [[0.14, -0.08, 0.6], [0.72, -0.02, 0.5], [0.72, -0.02, 0.12], [0.14, -0.08, 0.02]], 0.06, 0.04, 0);
        slab(m, [[0.72, -0.02, 0.5], [1.18, 0.05, 0.4], [1.18, 0.05, 0.24], [0.72, -0.02, 0.12]], 0.04, 0.015, 0);
        slab(m, [[0.04, 0.04, -0.72], [0.42, 0.05, -0.82], [0.42, 0.05, -0.96], [0.04, 0.04, -1.02]], 0.025, 0.01, 0);
        slab(m, [[0, 0.1, -0.62], [0, 0.46, -0.86], [0, 0.46, -0.98], [0, 0.08, -1.04]], 0.03, 0.012, 1, false);
        m.prop = { p: [0, 0.01, 1.22], r: 0.56 };
      },
    },
  };
  const ORDER = ['falcon', 'talon', 'dart', 'wraith', 'kestrel'];

  const models = {};
  function model(id) {
    if (!models[id]) {
      const def = DEFS[id] || DEFS.falcon, m = newMesh();
      def.build(m);
      m.verts = new Float32Array(m.v);
      m.tv = new Float32Array(m.v.length);
      m.order = new Uint16Array(m.f.length);
      m.depth = new Float32Array(m.f.length);
      m.shade = new Array(m.f.length);
      m.mats = def.mats;
      models[id] = m;
    }
    return models[id];
  }

  /* ---------- drawing ---------- */
  const glowCache = {};
  function glowSprite(col) {
    if (!glowCache[col]) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      const rgb = col === 'cyan' ? '120,230,255' : '255,170,70';
      gr.addColorStop(0, 'rgba(255,250,235,1)');
      gr.addColorStop(0.25, `rgba(${rgb},.9)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      glowCache[col] = c;
    }
    return glowCache[col];
  }

  // rotation = view elevation · view yaw · yaw · pitch · roll (roll is applied to the model first)
  function matrix(o) {
    const rot = (axis, a) => {
      const c = Math.cos(a), s = Math.sin(a);
      if (axis === 'z') return [c, s, 0, -s, c, 0, 0, 0, 1]; // positive roll drops the right wing
      if (axis === 'x') return [1, 0, 0, 0, c, s, 0, -s, c]; // positive pitch raises the nose
      return [c, 0, s, 0, 1, 0, -s, 0, c]; // positive yaw turns the nose right
    };
    const mul = (A, B) => {
      const r = new Array(9);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
      return r;
    };
    let M = rot('z', o.roll || 0);
    M = mul(rot('x', o.pitch || 0), M);
    M = mul(rot('y', o.yaw || 0), M);
    return mul(rot('x', o.elev ?? 0.3), M);
  }

  /* Draws `id` centred on (x, y); `scale` is pixels per model unit at the centre depth.
     o: roll, pitch, yaw (radians), elev (camera height angle), t (seconds, animates props and flames), throttle 0..1 */
  function draw(ctx, id, x, y, scale, o = {}) {
    const m = model(id), R = matrix(o), V = m.verts, T = m.tv, mats = m.mats;
    for (let i = 0; i < V.length; i += 3) {
      const a = V[i], b = V[i + 1], c = V[i + 2];
      T[i] = R[0] * a + R[1] * b + R[2] * c;
      T[i + 1] = R[3] * a + R[4] * b + R[5] * c;
      T[i + 2] = R[6] * a + R[7] * b + R[8] * c;
    }
    const px = (i) => x + T[i] * scale * CAM / (CAM + T[i + 2]);
    const py = (i) => y - T[i + 1] * scale * CAM / (CAM + T[i + 2]);
    // light from above, slightly left and in front of the aircraft
    const L = norm([-0.35, 0.85, -0.4]);
    let count = 0;
    for (let f = 0; f < m.f.length; f++) {
      const F = m.f[f], n = F.n;
      const nx = R[0] * n[0] + R[1] * n[1] + R[2] * n[2], ny = R[3] * n[0] + R[4] * n[1] + R[5] * n[2], nz = R[6] * n[0] + R[7] * n[1] + R[8] * n[2];
      let cx = 0, cy = 0, cz = 0;
      for (const i of F.idx) { cx += T[i * 3]; cy += T[i * 3 + 1]; cz += T[i * 3 + 2]; }
      const k = F.idx.length;
      cx /= k; cy /= k; cz /= k;
      const vx = cx, vy = cy, vz = cz + CAM;
      if (nx * vx + ny * vy + nz * vz >= 0) continue; // facing away from the camera
      const mat = mats[F.mat];
      const dif = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const vl = Math.hypot(vx, vy, vz);
      // half vector between the light and the viewer, for a highlight on canopies and curved panels
      const hx = L[0] - vx / vl, hy = L[1] - vy / vl, hz = L[2] - vz / vl, hl = Math.hypot(hx, hy, hz);
      const spec = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl) ** (mat.glass ? 40 : 18) * mat.s;
      const rim = (1 + (nx * vx + ny * vy + nz * vz) / vl) ** 3 * 0.18; // a faint edge light keeps dark planes readable
      const lum = 0.34 + dif * 0.72 + Math.max(0, ny) * 0.1;
      const add = (spec + rim) * 255;
      m.shade[f] = `rgb(${Math.min(255, mat.c[0] * lum + add) | 0},${Math.min(255, mat.c[1] * lum + add) | 0},${Math.min(255, mat.c[2] * lum + add) | 0})`;
      m.depth[f] = cz;
      m.order[count++] = f;
    }
    const order = Array.from(m.order.subarray(0, count)).sort((a, b) => m.depth[b] - m.depth[a]);

    // a spinning propeller sits in front of the nose; draw it before the body when the nose faces away from us
    const propBehind = m.prop && R[8] > 0;
    if (propBehind) drawProp(ctx, m.prop, R, x, y, scale, o.t || 0);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.6, scale * 0.012);
    for (const f of order) {
      const idx = m.f[f].idx;
      ctx.beginPath();
      ctx.moveTo(px(idx[0] * 3), py(idx[0] * 3));
      for (let j = 1; j < idx.length; j++) ctx.lineTo(px(idx[j] * 3), py(idx[j] * 3));
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle = m.shade[f];
      ctx.fill();
      ctx.stroke(); // the matching outline closes hairline seams between faces
    }
    if (m.prop && !propBehind) drawProp(ctx, m.prop, R, x, y, scale, o.t || 0);

    // engine flames are only visible when the tail points at least partly towards the camera
    if (m.glows.length && R[8] > -0.2) {
      const t = o.t || 0, throttle = o.throttle ?? 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const g of m.glows) {
        const [a, b, c] = g.p;
        const tx = R[0] * a + R[1] * b + R[2] * c, ty = R[3] * a + R[4] * b + R[5] * c, tz = R[6] * a + R[7] * b + R[8] * c;
        const k = scale * CAM / (CAM + tz), flick = 0.85 + Math.sin(t * 47 + a * 9) * 0.08 + Math.sin(t * 31) * 0.07;
        const r = g.r * k * (0.75 + throttle * 0.5) * flick;
        ctx.globalAlpha = Math.min(1, 0.55 + throttle * 0.45) * Math.min(1, (R[8] + 0.2) * 2);
        ctx.drawImage(glowSprite(g.col), x + tx * k - r, y - ty * k - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }

  function drawProp(ctx, prop, R, x, y, scale, t) {
    const [a, b, c] = prop.p, pts = [];
    const proj = (u, v, w) => {
      const tx = R[0] * u + R[1] * v + R[2] * w, ty = R[3] * u + R[4] * v + R[5] * w, tz = R[6] * u + R[7] * v + R[8] * w;
      const k = scale * CAM / (CAM + tz);
      return [x + tx * k, y - ty * k];
    };
    for (let i = 0; i < 20; i++) {
      const q = (i / 20) * TAU;
      pts.push(proj(a + Math.cos(q) * prop.r, b + Math.sin(q) * prop.r, c));
    }
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = 'rgba(210,215,220,.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,240,240,.22)';
    ctx.lineWidth = Math.max(0.6, scale * 0.01);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,30,30,.4)';
    ctx.lineWidth = Math.max(1, scale * 0.04);
    ctx.beginPath();
    for (let blade = 0; blade < 3; blade++) {
      const q = t * 37 + (blade * TAU) / 3, [ex, ey] = proj(a + Math.cos(q) * prop.r * 0.96, b + Math.sin(q) * prop.r * 0.96, c), [ox, oy] = proj(a, b, c);
      ctx.moveTo(ox, oy); ctx.lineTo(ex, ey);
    }
    ctx.stroke();
  }

  // a three-quarter view for the hangar picker
  function thumb(id, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), id, w * 0.47, h * 0.5, Math.min(w, h * 1.6) * 0.31, { yaw: 2.45, roll: -0.18, pitch: 0.05, elev: 0.5, throttle: 0.6 });
    return c;
  }

  return { ids: ORDER, info: (id) => DEFS[id], draw, thumb };
})();
