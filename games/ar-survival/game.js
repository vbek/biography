/* AR Survival — dodge with your face, push with your hands. Canvas 2D with a simple perspective model:
   every approaching object flies from depth z≈9 to the player's plane at z=1, where it can collide. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const canvas = $('#game'), ctx = canvas.getContext('2d', { alpha: true }), stage = $('#stage');
  const Tracker = window.ARTracker, Sfx = window.ARAudio, { sprites: SPR, glows: GLOW, paintBackdrop } = window.ARArt;
  const KEY = 'arSurvival.v1';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const TAU = Math.PI * 2;

  /* ---------- content ---------- */
  const THEMES = {
    space: {
      name: 'Space', thumb: 'rock0', vp: 0.5, label: 'SECTOR',
      backdrops: [['nebula', 'Nebula'], ['deep', 'Deep field'], ['ringed', 'Ringed planet']],
      spawns: [['asteroid', 5, 1], ['meteor', 2.4, 1], ['craft', 2.2, 2]],
    },
    air: {
      name: 'Air combat', thumb: 'jet', vp: 0.44, label: 'WAVE',
      backdrops: [['dusk', 'Dusk'], ['blue', 'Clear sky'], ['storm', 'Storm front']],
      spawns: [['jet', 4, 1], ['missile', 3.2, 1], ['bomber', 1.6, 3]],
    },
    naval: {
      name: 'Naval combat', thumb: 'warship', vp: 0.34, label: 'BATTLE',
      backdrops: [['open', 'Open sea'], ['night', 'Night watch'], ['gale', 'Gale']],
      spawns: [['torpedo', 5, 1], ['warship', 2, 1], ['shell', 1.8, 2]],
    },
  };
  // sizes are fractions of the short screen edge; speed is depth units per second
  const KINDS = {
    asteroid: { sprite: ['rock0', 'rock1', 'rock2'], rx: 0.115, ry: 0.115, size: [0.85, 1.25], speed: 2.9, spin: 1.3, label: 'Asteroid' },
    meteor: { sprite: ['hot'], rx: 0.075, ry: 0.075, fall: 1, speed: 0.42, gravity: 0.42, spin: 3, trail: 'fire', big: 0, label: 'Meteor' },
    craft: { sprite: ['craft'], rx: 0.15, ry: 0.075, speed: 2.5, weave: 0.42, weaveRate: 2.2, bank: 1, fires: 'bolt', label: 'Spacecraft' },
    bolt: { sprite: ['bolt'], rx: 0.055, ry: 0.055, speed: 4.2, trail: 'green', label: 'Plasma bolt', small: 1 },
    jet: { sprite: ['jet'], rx: 0.15, ry: 0.07, speed: 3.5, weave: 0.34, weaveRate: 2.8, bank: 1, label: 'Fighter jet' },
    missile: { sprite: ['missile'], rx: 0.062, ry: 0.062, speed: 2.5, accel: 2.6, home: 0.7, spin: 2.2, trail: 'smoke', label: 'Missile', small: 1 },
    bomber: { sprite: ['bomber'], rx: 0.24, ry: 0.08, speed: 1.8, heavy: 1, fires: 'bomb', bank: 0.4, weave: 0.1, weaveRate: 1, label: 'Warplane' },
    bomb: { sprite: ['bomb'], rx: 0.042, ry: 0.082, fall: 1, speed: 0.28, gravity: 0.5, label: 'Bomb', small: 1, aspectH: 1 },
    warship: { sprite: ['warship'], rx: 0.17, ry: 0.14, speed: 1.65, heavy: 1, fires: 'shell', weave: 0.05, weaveRate: 0.8, label: 'Warship' },
    torpedo: { sprite: ['torpedo'], rx: 0.06, ry: 0.06, speed: 2.8, accel: 1.5, trail: 'water', spin: 0.6, label: 'Torpedo', small: 1 },
    shell: { sprite: ['shell'], rx: 0.038, ry: 0.078, fall: 1, speed: 0.34, gravity: 0.5, label: 'Shell', small: 1, aspectH: 1 },
  };
  const VIEWS = [['ar', 'Camera'], ['blend', 'Blend'], ['scene', 'Scene']];
  const Z_FAR = 9, LEVEL_TIME = 18, LIVES = 3, MAX_LIVES = 5, ONE_UP_EVERY = 6000;
  const INVULN = 1.7, FACE_LOST_AFTER = 650, HAND_LOST_AFTER = 240, HAND_REACQUIRE = 600;
  const SWIPE_MIN = 0.38, SWIPE_HARD = 1.15, SWIPE_DECAY = 3, MAX_HAND_SPEED = 7; // hand speed in screen short-edges per second
  const PTS = { second: 10, dodge: 50, near: 40, push: 150, heavy: 300, chain: 250, kill: 100, heavyKill: 350 };
  const MAX_AMMO = 3, RELOAD_TIME = 2.4, FIRE_GAP = 0.18, MAX_LOCK_Z = 7.5;

  /* ---------- records and settings ---------- */
  const blank = () => ({ best: 0, bestTime: 0, games: 0, dodges: 0, pushes: 0, byTheme: {}, theme: 'space', backdrop: {}, view: 'ar' });
  let rec = blank();
  try { rec = { ...rec, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch {} };
  if (!THEMES[rec.theme]) rec.theme = 'space';
  if (!VIEWS.some((v) => v[0] === rec.view)) rec.view = 'ar';
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  /* ---------- world state ---------- */
  let W = 1, H = 1, U = 1, dpr = 1, vpY = 0, lastBackdropKey = '', backdrop = null, quality = 1;
  let state = 'menu', usingCamera = false;
  let objects = [], score = 0, displayScore = 0, lives = LIVES, runTime = 0, level = 1, combo = 0, bestCombo = 0;
  let spawnTimer = 0, salvoTimer = 0, invuln = 0, shake = 0, dodges = 0, pushes = 0, chains = 0, nextOneUp = ONE_UP_EVERY, runTheme = 'space';
  let missiles = [], ammo = MAX_AMMO, reload = 0, fireCooldown = 0, kills = 0;
  let scoreCarry = 0, pushCooldown = 0, manualUntil = 0, lastFaceAt = -1e9, lastHandAt = -1e9, faceSeen = false, handSeen = false;
  const player = { x: 0, y: 0, tx: 0, ty: 0, r: 40, tr: 40, ang: 0 };
  const hands = [newHand(), newHand()];
  const keys = new Set();
  const floaters = [];
  const debug = new URLSearchParams(location.search).has('debug');

  function newHand() {
    return { active: false, x: 0, y: 0, px: 0, py: 0, tx: 0, ty: 0, vx: 0, vy: 0, peak: 0, r: 40, seen: -1e9, pts: new Float32Array(42) };
  }

  /* ---------- particles: a fixed pool, so long runs allocate nothing ---------- */
  const POOL = 520;
  const parts = Array.from({ length: POOL }, () => ({ life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, size: 1, grow: 0, drag: 0, g: 0, glow: null, add: true, a: 1 }));
  let partCursor = 0;
  function emit(x, y, vx, vy, life, size, glow, opt) {
    const p = parts[partCursor];
    partCursor = (partCursor + 1) % Math.floor(POOL * quality);
    p.life = p.max = life;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.size = size;
    p.glow = GLOW[glow];
    p.grow = opt?.grow || 0; p.drag = opt?.drag ?? 1.2; p.g = opt?.g || 0;
    p.add = opt?.add ?? true; p.a = opt?.a ?? 1;
  }
  function burst(x, y, n, speed, life, size, glow, opt) {
    n = Math.ceil(n * quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = speed * rand(0.2, 1);
      emit(x, y, Math.cos(a) * v, Math.sin(a) * v, life * rand(0.5, 1), size * rand(0.5, 1.2), glow, opt);
    }
  }
  function explosion(x, y, r, big) {
    const k = big ? 1.5 : 1;
    burst(x, y, 6, r * 1.2, 0.34, r * 2.3 * k, 'hot', { grow: r * 2, drag: 3 });
    burst(x, y, 26 * k, r * 7, 0.72, r * 0.85, 'fire', { drag: 2.1, g: U * 0.25 });
    burst(x, y, 12 * k, r * 2.5, 1.3, r * 1.7, 'dark', { add: false, a: 0.55, grow: r * 1.6, drag: 1.5 });
    burst(x, y, 16 * k, r * 10, 0.5, r * 0.24, 'white', { drag: 1.4, g: U * 0.5 });
  }
  function splash(x, y, r) {
    burst(x, y, 24, r * 6, 0.8, r * 0.7, 'water', { g: U * 1.2, drag: 0.8 });
  }
  function floater(x, y, text, color, size) {
    if (floaters.length > 14) floaters.shift();
    floaters.push({ x, y, text, color, size: size || 18, life: 1 });
  }

  /* ---------- layout ---------- */
  function resize() {
    W = window.innerWidth; H = window.innerHeight; U = Math.min(W, H);
    dpr = Math.min(1.75, window.devicePixelRatio || 1) * (quality < 1 ? 0.72 : 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    vpY = H * THEMES[rec.theme].vp;
    lastBackdropKey = '';
    if (!usingCamera || state === 'menu') {
      player.tx = clamp(player.tx || W / 2, 0, W);
      player.ty = clamp(player.ty || H * 0.58, 0, H);
    }
    player.tr = U * 0.085;
    initDecor();
  }
  const backdropId = () => rec.backdrop[rec.theme] || THEMES[rec.theme].backdrops[0][0];
  function refreshBackdrop() {
    const k = `${backdropId()}|${W}x${H}`;
    if (k !== lastBackdropKey) {
      backdrop = paintBackdrop(backdropId(), W, H);
      lastBackdropKey = k;
    }
  }
  function viewMode() {
    return usingCamera ? rec.view : 'scene';
  }
  function applyView() {
    document.body.classList.toggle('no-cam', !Tracker.cameraOn);
    document.body.classList.toggle('view-scene', viewMode() === 'scene');
  }

  /* ---------- moving scenery ---------- */
  let stars = [], clouds = [];
  function initDecor() {
    stars = Array.from({ length: 120 }, () => ({ x: rand(-1.3, 1.3) * W, y: rand(-1.3, 1.3) * H, z: rand(0.15, 1) }));
    clouds = Array.from({ length: 9 }, () => ({ x: rand(-1.1, 1.1) * W, y: rand(-0.6, 0.15) * H, z: rand(0.4, 3) }));
  }
  function drawDecor(dt, opacity) {
    const speed = state === 'play' ? 1 + level * 0.08 : 0.45;
    const theme = rec.theme, cx = W / 2;
    if (theme === 'space') {
      ctx.strokeStyle = `rgba(215,235,255,${0.75 * opacity})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const count = quality < 1 ? 70 : stars.length;
      for (let i = 0; i < count; i++) {
        const s = stars[i];
        const z0 = s.z;
        s.z -= dt * 0.28 * speed;
        if (s.z < 0.05) { s.x = rand(-1.3, 1.3) * W; s.y = rand(-1.3, 1.3) * H; s.z = 1; continue; }
        ctx.moveTo(cx + (s.x * 0.2) / z0, vpY + (s.y * 0.2) / z0);
        ctx.lineTo(cx + (s.x * 0.2) / s.z, vpY + (s.y * 0.2) / s.z);
      }
      ctx.stroke();
    } else if (theme === 'air') {
      const img = SPR.cloud;
      for (const c of clouds) {
        c.z -= dt * 0.55 * speed;
        if (c.z < 0.35) { c.x = rand(-1.1, 1.1) * W; c.y = rand(-0.6, 0.15) * H; c.z = 3; }
        const s = 1 / c.z, w = U * 0.85 * s, h = w / 2;
        ctx.globalAlpha = opacity * clamp((3 - c.z) * 1.1, 0, 0.9) * clamp((c.z - 0.35) * 2.5, 0, 1);
        ctx.drawImage(img, cx + c.x * s - w / 2, vpY + c.y * s - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
    } else {
      const t = performance.now() / 1000;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(230,250,255,${0.26 * opacity})`;
      ctx.beginPath();
      const seg = W / 18;
      for (let i = 0; i < 11; i++) {
        const k = ((i / 11 + t * 0.07 * speed) % 1) ** 2;
        const y = vpY + (H - vpY) * k, amp = 1 + k * 11;
        for (let j = 0; j <= 18; j++) {
          const x = j * seg, yy = y + Math.sin(j * 1.25 + t * 2 + i * 2.1) * amp;
          if (j) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
        }
      }
      ctx.stroke();
    }
  }

  /* ---------- tracking: mirror the camera image and fit it the way the video is displayed ---------- */
  function camToScreen(nx, ny) {
    const vw = Tracker.videoW || 4, vh = Tracker.videoH || 3;
    const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s;
    return [(W - dw) / 2 + (1 - nx) * dw, (H - dh) / 2 + ny * dh];
  }
  // One Euro filter: steady when the head is still, responsive when it moves quickly
  function oneEuro(minCut, beta) {
    let last = null, dLast = 0, tLast = 0;
    const alpha = (dt, cut) => 1 / (1 + 1 / (TAU * cut * dt));
    return (v, t) => {
      if (last === null || t - tLast > 500) { last = v; dLast = 0; tLast = t; return v; }
      const dt = Math.max(0.001, (t - tLast) / 1000);
      dLast += alpha(dt, 1) * ((v - last) / dt - dLast);
      last += alpha(dt, minCut + beta * Math.abs(dLast)) * (v - last);
      tLast = t;
      return last;
    };
  }
  const faceX = oneEuro(1.6, 0.012), faceY = oneEuro(1.6, 0.012);

  Tracker.onResult = (m) => {
    const now = performance.now();
    if (m.face) {
      const [sx, sy] = camToScreen(m.face[0], m.face[1]);
      const s = Math.max(W / (Tracker.videoW || 4), H / (Tracker.videoH || 3));
      const fw = m.face[2] * (Tracker.videoW || 4) * s;
      lastFaceAt = now;
      faceSeen = true;
      if (now > manualUntil) {
        player.tx = clamp(faceX(sx, now), 0, W);
        player.ty = clamp(faceY(sy, now), 0, H);
      }
      player.tr = clamp(fw * 0.58, U * 0.07, U * 0.13);
    }
    if (m.hands) updateHands(m.hands, now);
    updateChecks();
  };

  const PALM = [0, 5, 9, 13, 17];
  function updateHands(detected, now) {
    const used = [false, false];
    for (const pts of detected) {
      let cx = 0, cy = 0;
      for (const i of PALM) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
      const [sx, sy] = camToScreen(cx / 5, cy / 5);
      // keep each physical hand in the same slot so its velocity stays meaningful. That includes a hand the model
      // missed for a frame or two, which is exactly what happens during a fast swipe.
      let slot = -1, bestD = U * 0.95;
      for (let i = 0; i < 2; i++) {
        const h = hands[i];
        if (used[i] || now - h.seen > HAND_REACQUIRE) continue;
        const d = Math.hypot(h.tx - sx, h.ty - sy);
        if (d < bestD) { bestD = d; slot = i; }
      }
      if (slot < 0) slot = used[0] ? 1 : used[1] ? 0 : hands[0].seen <= hands[1].seen ? 0 : 1;
      if (used[slot]) continue;
      used[slot] = true;
      const h = hands[slot];
      if (now - h.seen <= HAND_REACQUIRE) {
        const dt = Math.max(0.012, (now - h.seen) / 1000), limit = U * MAX_HAND_SPEED;
        h.vx = clamp(h.vx * 0.3 + ((sx - h.tx) / dt) * 0.7, -limit, limit);
        h.vy = clamp(h.vy * 0.3 + ((sy - h.ty) / dt) * 0.7, -limit, limit);
      } else {
        h.x = h.px = sx; h.y = h.py = sy; h.vx = h.vy = h.peak = 0;
      }
      h.active = true;
      h.tx = sx; h.ty = sy; h.seen = now;
      let [ax, ay] = camToScreen(pts[0], pts[1]);
      const [bx, by] = camToScreen(pts[18], pts[19]);
      h.r = clamp(Math.hypot(ax - bx, ay - by) * 0.62, U * 0.055, U * 0.15);
      for (let i = 0; i < 21; i++) {
        [ax, ay] = camToScreen(pts[i * 2], pts[i * 2 + 1]);
        h.pts[i * 2] = ax; h.pts[i * 2 + 1] = ay;
      }
      lastHandAt = now;
      handSeen = true;
    }
  }
  function stepHands(dt, now) {
    const k = 1 - Math.exp(-dt * 34);
    // slow devices report hands less often, so a hand has to go unseen for longer before it counts as gone
    const lostAfter = clamp(Tracker.handMs * 3.5, HAND_LOST_AFTER, HAND_REACQUIRE);
    for (const h of hands) {
      if (!h.active) continue;
      if (now - h.seen > lostAfter) { h.active = false; h.peak = 0; continue; }
      // the swipe stays "live" briefly after its fastest moment, so contact doesn't depend on one speed reading
      h.peak = Math.max(Math.hypot(h.vx, h.vy) / U, h.peak - dt * SWIPE_DECAY);
      h.px = h.x; h.py = h.y;
      h.x += (h.tx - h.x) * k;
      h.y += (h.ty - h.y) * k;
    }
  }

  /* ---------- spawning ---------- */
  function speedMul() { return Math.min(2.25, 1 + (level - 1) * 0.085); }
  function spawnInterval() { return Math.max(0.42, 1.55 * 0.91 ** (level - 1)); }

  function spawn(kindId, opts = {}) {
    const k = KINDS[kindId], size = k.size ? rand(k.size[0], k.size[1]) : 1;
    const o = {
      kind: k, id: kindId, sprite: SPR[pick(k.sprite)],
      rx: k.rx * size, ry: k.ry * size,
      rot: rand(0, TAU), spin: (k.spin || 0) * rand(0.5, 1.2) * (Math.random() < 0.5 ? -1 : 1),
      hp: k.heavy ? 2 : 1,
      state: 'live', passed: false, whoosh: false, fired: false, born: runTime, trailT: 0,
      sx: 0, sy: 0, s: 1, vx: 0, vy: 0,
    };
    const spread = opts.spread ?? U * 0.12;
    const tx = clamp((opts.tx ?? player.x) + rand(-spread, spread), U * 0.05, W - U * 0.05);
    const ty = clamp((opts.ty ?? player.y) + rand(-spread, spread) * 0.8, U * 0.08, H - U * 0.05);
    o.tx = tx; o.ty = ty;
    if (k.fall) {
      // falling objects hold off-screen while their warning shows, then land exactly where it pointed
      const startX = clamp(tx + rand(-0.3, 0.3) * U, U * 0.05, W - U * 0.05), startY = -k.ry * U * 2;
      const fallMul = Math.min(1.6, speedMul());
      const v = k.speed * U * fallMul, g = k.gravity * U * fallMul;
      o.warn = Math.max(0.75, 1.2 - level * 0.03);
      Sfx.alarm(panOf(startX));
      const dist = ty - startY, t = (-v + Math.sqrt(v * v + 2 * g * dist)) / g;
      o.fall = true;
      o.sx = startX; o.sy = startY; o.z = 1; o.s = 1;
      o.vx = (tx - startX) / t; o.vy = v; o.g = g;
      if (!k.spin) o.rot = 0;
    } else {
      o.z = opts.z ?? Z_FAR;
      o.z0 = o.z;
      o.vz = k.speed * speedMul();
      o.ix = opts.ix ?? W / 2 + rand(-0.5, 0.5) * W * 0.4;
      o.iy = opts.iy ?? H / 2 + rand(-0.5, 0.5) * H * 0.4;
      o.i0x = o.ix; o.i0y = o.iy;
      o.phase = rand(0, TAU);
      o.fireZ = rand(4.4, 6.2);
      if (!k.spin) o.rot = 0;
    }
    objects.push(o);
    return o;
  }
  function pickKind() {
    const table = THEMES[rec.theme].spawns.filter((e) => level >= e[2]);
    let w = 0;
    for (const e of table) w += e[1];
    let r = Math.random() * w;
    for (const e of table) if ((r -= e[1]) <= 0) return e[0];
    return table[0][0];
  }
  function spawnSalvo() {
    const table = THEMES[rec.theme].spawns.map((e) => e[0]).filter((id) => !KINDS[id].fall && !KINDS[id].heavy);
    const id = table[Math.min(1, table.length - 1)], gap = U * 0.46;
    const horizontal = Math.random() < 0.72;
    [-1, 0, 1].forEach((n) => {
      spawn(id, { spread: U * 0.02,
        tx: player.x + (horizontal ? n * gap : 0),
        ty: player.y + (horizontal ? 0 : n * gap) });
    });
    showBig('INCOMING!', 0.8);
  }

  /* ---------- scoring ---------- */
  const multiplier = () => Math.min(5, 1 + Math.floor(combo / 6));
  function addScore(base, x, y, label, color, size) {
    const m = multiplier(), pts = base * m;
    score += pts;
    if (x !== undefined) floater(x, y, `${label ? label + ' ' : ''}+${pts}`, color || '#fff', size);
    if (score >= nextOneUp) {
      nextOneUp += ONE_UP_EVERY;
      if (lives < MAX_LIVES) {
        lives++;
        renderLives(true);
        floater(player.x, player.y - U * 0.15, 'EXTRA LIFE', '#4ade80', 25);
        Sfx.oneUp();
      }
    }
  }
  function raiseCombo() {
    const before = multiplier();
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    if (multiplier() > before) {
      floater(W / 2, H * 0.24, `×${multiplier()} MULTIPLIER`, '#fbbf24', 26);
    }
  }

  /* ---------- hits and pushes ---------- */
  const panOf = (x) => (x / W) * 2 - 1;
  function removeObject(o) { o.state = 'dead'; }
  function destroyWithFx(o) {
    const r = Math.max(o.rx, o.ry) * U * o.s;
    if (rec.theme === 'naval' && !o.fall) splash(o.sx, o.sy, r);
    explosion(o.sx, o.sy, r, o.kind.heavy);
    Sfx.explode(!!o.kind.heavy, panOf(o.sx));
    removeObject(o);
  }
  function hitPlayer(o) {
    destroyWithFx(o);
    if (invuln > 0) return;
    lives--;
    invuln = INVULN;
    combo = 0;
    shake = reduceMotion ? 0 : U * 0.055;
    renderLives();
    Sfx.hit();
    try { navigator.vibrate?.([70, 40, 110]); } catch {}
    const f = $('#flash');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
    floater(player.x, player.y - player.r * 1.5, o.kind.label.toUpperCase() + ' HIT', '#fb4e5e', 21);
    if (lives <= 0) gameOver();
  }
  function launchPushed(o, side, handVy, power) {
    o.state = 'pushed';
    o.vx = side * U * (1.8 + power * 1.1);
    o.vy = clamp(handVy * 0.35, -U, U);
    o.spin = side * rand(6, 11);
    pushes++;
    raiseCombo();
    const heavy = !!o.kind.heavy;
    addScore(heavy ? PTS.heavy : PTS.push, o.sx, o.sy - U * 0.05, heavy ? 'HEAVY PUSH' : 'PUSHED', '#22d3ee', heavy ? 24 : 21);
    const r = Math.max(o.rx, o.ry) * U * o.s;
    burst(o.sx - side * r * 0.5, o.sy, 16, U * 0.65, 0.48, U * 0.03, 'cyan', { drag: 2 });
    shake = Math.max(shake, reduceMotion ? 0 : U * 0.012);
    Sfx.push(panOf(o.sx));
    try { navigator.vibrate?.(20); } catch {}
  }
  // shortest distance from a circle's centre to the hand's path this frame, so fast swipes can't skip through objects
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function handContacts() {
    for (const h of hands) {
      if (!h.active) continue;
      const speed = h.peak;
      if (speed < SWIPE_MIN) continue;
      for (const o of objects) {
        if (o.state !== 'live' || (!o.fall && o.z > 3.1) || o.pushLock > 0) continue;
        const reach = Math.max(o.rx, o.ry) * U * o.s * 0.95 + h.r;
        if (distToSegment(o.sx, o.sy, h.px, h.py, h.x, h.y) > reach) continue;
        const side = Math.abs(h.vx) > Math.abs(h.vy) * 0.35 ? Math.sign(h.vx) : Math.sign(o.sx - h.x) || 1;
        if (o.kind.heavy && speed < SWIPE_HARD) {
          // too heavy for a soft swipe: it gets nudged off course and the player gets told to hit harder
          o.pushLock = 0.4;
          if (o.fall) o.vx += side * U * 0.4;
          else { o.tx = clamp(o.tx + side * U * 0.14, 0, W); }
          burst(o.sx, o.sy, 8, U * 0.35, 0.3, U * 0.018, 'white', { drag: 2 });
          floater(o.sx, o.sy - U * 0.05, 'SWIPE HARDER!', '#fbbf24', 18);
          Sfx.clang(panOf(o.sx));
        } else {
          launchPushed(o, side, h.vy, clamp(speed / 2, 0.4, 1.6));
        }
      }
    }
  }
  // keyboard and touch fallback: a short-range blast that shoves the nearest threat
  function manualPush(side) {
    if (state !== 'play' || pushCooldown > 0) return;
    pushCooldown = 0.42;
    let best = null, bestD = U * 0.5;
    for (const o of objects) {
      if (o.state !== 'live' || (!o.fall && o.z > 2.6)) continue;
      const d = Math.hypot(o.sx - player.x, o.sy - player.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    for (let i = 0; i < 14; i++) {
      emit(player.x + side * player.r, player.y + rand(-1, 1) * player.r, side * U * rand(0.7, 1.7), rand(-1, 1) * U * 0.25, 0.3, U * 0.03, 'cyan', { drag: 3 });
    }
    if (best) launchPushed(best, side, 0, 1.2);
    else Sfx.clang(panOf(player.x));
  }

  /* ---------- our missiles: limited ammo that reloads, homing on one target each ---------- */
  const lockedOn = (o) => missiles.reduce((n, m) => n + (m.target === o ? 1 : 0), 0);
  // nearest to the tapped point when aiming by hand, otherwise whatever will arrive soonest
  function pickTarget(px, py) {
    let best = null, bestV = Infinity;
    for (const o of objects) {
      if (o.state !== 'live' || o.passed || lockedOn(o) >= o.hp) continue;
      if (o.fall ? o.warn > 0 || o.sy < 0 : o.z > MAX_LOCK_Z) continue;
      const v = px !== undefined
        ? Math.hypot(o.sx - px, o.sy - py)
        : o.fall ? (o.ty - o.sy) / Math.max(o.vy, 1) : (o.z - 1) / o.vz;
      if (v < bestV) { bestV = v; best = o; }
    }
    return best;
  }
  function fireMissile(px, py) {
    if (state !== 'play' || fireCooldown > 0) return;
    if (ammo <= 0) {
      floater(player.x, player.y - player.r * 1.5, 'RELOADING', '#fbbf24', 16);
      Sfx.clang(panOf(player.x));
      return;
    }
    const target = pickTarget(px, py);
    if (!target) {
      floater(player.x, player.y - player.r * 1.5, 'NO TARGET', '#a3b1c8', 15);
      return;
    }
    ammo--;
    fireCooldown = FIRE_GAP;
    renderAmmo();
    missiles.push({ x: player.x, y: player.y - player.r, ang: -Math.PI / 2 + rand(-0.35, 0.35), speed: U * 0.9, age: 0, target, trailT: 0 });
    burst(player.x, player.y - player.r, 8, U * 0.3, 0.25, U * 0.02, 'cyan', { drag: 3 });
    Sfx.launch(panOf(player.x));
    try { navigator.vibrate?.(15); } catch {}
  }
  function missileHit(m) {
    const o = m.target, r = Math.max(o.rx, o.ry) * U * o.s;
    if (--o.hp > 0) {
      burst(m.x, m.y, 16, U * 0.5, 0.45, U * 0.025, 'fire', { drag: 2 });
      floater(o.sx, o.sy - r, 'ARMOR HIT', '#fbbf24', 18);
      Sfx.clang(panOf(o.sx));
      return;
    }
    kills++;
    raiseCombo();
    addScore(o.kind.heavy ? PTS.heavyKill : PTS.kill, o.sx, o.sy - r, 'DESTROYED', '#fb923c', o.kind.heavy ? 25 : 20);
    destroyWithFx(o);
  }
  function stepMissiles(dt) {
    fireCooldown = Math.max(0, fireCooldown - dt);
    if (ammo < MAX_AMMO) {
      reload += dt;
      if (reload >= RELOAD_TIME) {
        reload = 0;
        ammo++;
        renderAmmo();
      }
    }
    for (const m of missiles) {
      m.age += dt;
      if (m.target?.state !== 'live') m.target = pickTarget();
      m.speed = Math.min(U * 3.4, m.speed + U * 6 * dt);
      if (m.target) {
        // turning sharpens with age, so a missile can't end up circling its target
        const want = Math.atan2(m.target.sy - m.y, m.target.sx - m.x);
        const diff = Math.atan2(Math.sin(want - m.ang), Math.cos(want - m.ang)), turn = (7 + m.age * 40) * dt;
        m.ang += clamp(diff, -turn, turn);
      }
      m.x += Math.cos(m.ang) * m.speed * dt;
      m.y += Math.sin(m.ang) * m.speed * dt;
      m.trailT -= dt;
      if (m.trailT <= 0) {
        m.trailT = quality < 1 ? 0.04 : 0.02;
        emit(m.x, m.y, rand(-12, 12), rand(-12, 12), 0.42, U * 0.016, 'smoke', { add: false, a: 0.45, grow: U * 0.022 });
        emit(m.x, m.y, 0, 0, 0.12, U * 0.018, 'fire');
      }
      const t = m.target;
      if (t && Math.hypot(t.sx - m.x, t.sy - m.y) < Math.max(t.rx, t.ry) * U * t.s * 0.9 + U * 0.025) {
        missileHit(m);
        m.done = true;
      } else if (m.age > 2.5 || m.x < -U || m.x > W + U || m.y < -U || m.y > H + U) {
        m.done = true;
      }
    }
    missiles = missiles.filter((m) => !m.done);
  }

  /* ---------- simulation ---------- */
  function step(dt, now) {
    runTime += dt;
    invuln = Math.max(0, invuln - dt);
    pushCooldown = Math.max(0, pushCooldown - dt);
    stepMissiles(dt);

    const newLevel = 1 + Math.floor(runTime / LEVEL_TIME);
    if (newLevel !== level) {
      level = newLevel;
      showBig(`${THEMES[rec.theme].label} ${level}`, 1);
      Sfx.level();
      salvoTimer = Math.min(salvoTimer, 3);
    }
    scoreCarry += dt * PTS.second * multiplier();
    if (scoreCarry >= 1) { const n = Math.floor(scoreCarry); score += n; scoreCarry -= n; }

    // manual controls take over for a moment whenever they are used, and permanently without tracking
    let mx = 0, my = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) mx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) mx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) my -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) my += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my), v = U * 1.25 * dt;
      player.tx = clamp(player.tx + (mx / len) * v, 0, W);
      player.ty = clamp(player.ty + (my / len) * v, 0, H);
      manualUntil = now + 900;
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0 && objects.length < 5 + level) {
      spawn(pickKind());
      spawnTimer = spawnInterval() * rand(0.75, 1.25);
    }
    if (level >= 3) {
      salvoTimer -= dt;
      if (salvoTimer <= 0) {
        spawnSalvo();
        salvoTimer = rand(13, 19);
      }
    }

    handContacts();

    for (const o of objects) {
      if (o.state === 'dead') continue;
      o.rot += o.spin * dt;
      o.pushLock = Math.max(0, (o.pushLock || 0) - dt);
      if (o.state === 'pushed') stepPushed(o, dt);
      else if (o.fall) stepFalling(o, dt);
      else stepApproach(o, dt);
      if (state !== 'play') return;
    }
    objects = objects.filter((o) => o.state !== 'dead');
    if (shake > 0) shake = Math.max(0, shake - U * 0.11 * dt);
  }

  function stepApproach(o, dt) {
    const k = o.kind;
    if (k.accel) o.vz += k.accel * dt;
    const prevZ = o.z;
    o.z -= o.vz * dt;
    // missiles keep correcting course until late, which leaves time to see the final path and move
    if (k.home && o.z > 3) {
      const rate = k.home * dt;
      o.tx += (player.x - o.tx) * rate;
      o.ty += (player.y - o.ty) * rate;
    }
    const prog = clamp((o.z0 - o.z) / (o.z0 - 1), 0, 1.4);
    let ix = o.i0x + (o.tx - o.i0x) * prog, iy = o.i0y + (o.ty - o.i0y) * prog;
    if (k.weave) {
      const fade = clamp((o.z - 1) / 2.5, 0, 1);
      const w = Math.sin(runTime * k.weaveRate + o.phase);
      ix += w * k.weave * U * fade;
      if (k.bank) o.rot = Math.cos(runTime * k.weaveRate + o.phase) * -0.42 * k.bank * fade;
    }
    o.s = 1 / Math.max(o.z, 0.22);
    o.sx = W / 2 + (ix - W / 2) * o.s;
    o.sy = vpY + (iy - vpY) * o.s;

    if (k.fires && !o.fired && o.z < o.fireZ && level >= 2) {
      o.fired = true;
      fire(o);
    }
    trail(o, dt);

    if (!o.whoosh && o.z < 1.9) {
      o.whoosh = true;
      Sfx.whoosh(panOf(o.sx));
    }
    if (!o.passed && o.z <= 1.14 && prevZ > 0) {
      if (overlap(o)) { hitPlayer(o); return; }
      if (o.z < 0.92) {
        o.passed = true;
        awardDodge(o);
      }
    }
    if (o.z < 0.34) removeObject(o);
  }
  function stepFalling(o, dt) {
    if (o.warn > 0) {
      o.warn -= dt;
      return;
    }
    o.vy += o.g * dt;
    o.sx += o.vx * dt;
    o.sy += o.vy * dt;
    if (o.kind.spin === undefined) o.rot = -Math.atan2(o.vx, o.vy);
    trail(o, dt);
    if (!o.passed) {
      if (overlap(o)) { hitPlayer(o); return; }
      if (o.sy > player.y + player.r + o.ry * U) {
        o.passed = true;
        awardDodge(o);
      }
    }
    if (o.sy > H + U * 0.2) {
      if (rec.theme === 'naval') splash(o.sx, H - 6, U * 0.04);
      removeObject(o);
    }
  }
  function stepPushed(o, dt) {
    o.sx += o.vx * dt;
    o.sy += o.vy * dt;
    if (!o.fall) { o.z = Math.max(0.65, o.z - o.vz * 0.18 * dt); o.s = 1 / o.z; }
    if (Math.random() < 45 * dt * quality) {
      emit(o.sx, o.sy, -o.vx * 0.08, -o.vy * 0.08, 0.38, U * 0.035, 'cyan', { drag: 2 });
    }
    // a pushed object is a projectile: anything it meets explodes for a chain bonus
    const rA = Math.max(o.rx, o.ry) * U * o.s;
    for (const b of objects) {
      if (b === o || b.state !== 'live') continue;
      if (!b.fall && !o.fall && Math.abs(b.z - o.z) > 1.3) continue;
      if (!b.fall && b.z > 3.6) continue;
      const rB = Math.max(b.rx, b.ry) * U * b.s;
      if (Math.hypot(o.sx - b.sx, o.sy - b.sy) < rA * 0.85 + rB * 0.85) {
        chains++;
        raiseCombo();
        addScore(PTS.chain, b.sx, b.sy, 'CHAIN', '#fbbf24', 25);
        destroyWithFx(b);
        destroyWithFx(o);
        return;
      }
    }
    const m = U * 0.35;
    if (o.sx < -m || o.sx > W + m || o.sy < -m || o.sy > H + m) removeObject(o);
  }
  function overlap(o) {
    const nx = (o.sx - player.x) / (o.rx * U * o.s * 0.8 + player.r), ny = (o.sy - player.y) / (o.ry * U * o.s * 0.8 + player.r);
    o.nearDist = Math.sqrt(nx * nx + ny * ny);
    return o.nearDist < 1;
  }
  function awardDodge(o) {
    dodges++;
    raiseCombo();
    if (o.nearDist < 1.65) {
      addScore(PTS.dodge + PTS.near, player.x, player.y - player.r * 1.45, 'NEAR MISS', '#a5f3fc', 20);
      Sfx.near();
    } else {
      addScore(PTS.dodge, player.x, player.y - player.r * 1.35, 'DODGE', '#d9f99d', 15);
      Sfx.dodge(combo);
    }
  }
  function fire(o) {
    const k = o.kind.fires;
    const flash = U * 0.06 * o.s + U * 0.01;
    burst(o.sx, o.sy, 7, flash * 3, 0.26, flash, 'fire', { drag: 3 });
    Sfx.clang(panOf(o.sx));
    if (KINDS[k].fall) spawn(k);
    else {
      const ix = W / 2 + (o.sx - W / 2) * o.z, iy = vpY + (o.sy - vpY) * o.z;
      spawn(k, { z: o.z, ix, iy });
    }
  }
  function trail(o, dt) {
    const t = o.kind.trail;
    if (!t) return;
    o.trailT -= dt;
    if (o.trailT > 0) return;
    o.trailT = (quality < 1 ? 0.05 : 0.026);
    const size = Math.max(o.rx, o.ry) * U * o.s;
    if (t === 'fire') {
      emit(o.sx + rand(-0.4, 0.4) * size, o.sy + rand(-0.4, 0.4) * size, -o.vx * 0.12, -o.vy * 0.12, 0.42, size * 1.5, 'fire', { drag: 2.2, grow: -size });
      if (Math.random() < 0.3) emit(o.sx, o.sy, -o.vx * 0.05, -o.vy * 0.05, 0.9, size * 1.1, 'dark', { add: false, a: 0.45, grow: size * 1.5 });
    } else if (t === 'smoke') {
      emit(o.sx, o.sy, rand(-14, 14), rand(-14, 14), 0.75, size * 0.9, 'smoke', { add: false, a: 0.4, grow: size * 1.7 });
      emit(o.sx, o.sy, 0, 0, 0.14, size * 1.3, 'fire');
    } else if (t === 'water') {
      emit(o.sx + rand(-0.5, 0.5) * size, o.sy + size * 0.4, rand(-22, 22), rand(-8, 22), 0.75, size * 0.7, 'water', { add: false, a: 0.6, grow: size });
    } else {
      emit(o.sx, o.sy, 0, 0, 0.28, size * 1.2, 'green');
    }
  }

  /* ---------- rendering ---------- */
  function drawObject(o) {
    const k = o.kind, img = o.sprite, s = o.s;
    const scale = k.aspectH ? (o.ry * U * s * 2.2) / img.height : (o.rx * U * s * 2.2) / img.width;
    const w = img.width * scale, h = img.height * scale;
    let alpha = 1;
    if (!o.fall) {
      alpha = clamp((Z_FAR - o.z) * 1.1 + 0.12, 0, 1);
      if (o.z < 0.72) alpha *= clamp((o.z - 0.34) / 0.38, 0, 1);
    }
    ctx.globalAlpha = alpha;
    const c = Math.cos(o.rot), sn = Math.sin(o.rot);
    ctx.setTransform(c * dpr, sn * dpr, -sn * dpr, c * dpr, (o.sx + shakeX) * dpr, (o.sy + shakeY) * dpr);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
    if (o.state === 'live' && (o.fall || o.z < 3.1) && hasHands()) {
      // a faint ring marks objects that are close enough to swipe
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = k.heavy ? '#fbbf24' : '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(o.sx, o.sy, Math.max(o.rx, o.ry) * U * s * 1.12, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawWarnings() {
    for (const o of objects) {
      if (o.state !== 'live' || o.passed) continue;
      let x, y, urgency;
      if (o.fall) {
        if (o.sy > player.y) continue;
        x = o.tx; y = o.ty;
        urgency = clamp(1 - (o.ty - o.sy) / Math.max(1, o.ty + U * 0.2), 0, 1);
      } else {
        if (o.z > 4.4) continue;
        x = o.tx; y = o.ty;
        urgency = clamp((4.4 - o.z) / 3.4, 0, 1);
      }
      const r = Math.max(o.rx, o.ry) * U * (1.6 - urgency * 0.6);
      const danger = Math.hypot(x - player.x, y - player.y) < r + player.r;
      ctx.strokeStyle = danger ? '#ff4557' : 'rgba(255,190,70,.8)';
      ctx.globalAlpha = 0.18 + urgency * 0.62;
      ctx.lineWidth = danger ? 3 : 1.8;
      const a = runTime * 2.6;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x, y, r, a + (i * Math.PI) / 2, a + (i * Math.PI) / 2 + 0.75);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  const hasHands = () => usingCamera && Tracker.handReady;

  // caution marker at the top edge plus the predicted path, from before a falling object appears until it lands
  function drawFallWarnings() {
    const markerY = 92, pulse = 0.65 + 0.35 * Math.sin(runTime * 14);
    ctx.textAlign = 'center';
    for (const o of objects) {
      if (!o.fall || o.state !== 'live' || o.passed) continue;
      const sx = clamp(o.warn > 0 ? o.sx : o.sx, U * 0.07, W - U * 0.07);
      ctx.strokeStyle = '#ff4557';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([10, 9]);
      ctx.lineDashOffset = -runTime * 60;
      ctx.beginPath();
      ctx.moveTo(o.warn > 0 ? sx : o.sx, o.warn > 0 ? 0 : o.sy);
      ctx.lineTo(o.tx, o.ty);
      ctx.stroke();
      ctx.setLineDash([]);
      if (o.warn <= 0 && o.sy > markerY) continue;
      const s = clamp(U * 0.045, 20, 34);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ff2d42';
      ctx.beginPath();
      ctx.moveTo(sx, markerY - s * 0.6);
      ctx.lineTo(sx + s * 0.75, markerY + s * 0.65);
      ctx.lineTo(sx - s * 0.75, markerY + s * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(s * 0.8)}px Orbitron, "Segoe UI", sans-serif`;
      ctx.fillText('!', sx, markerY + s * 0.5);
      ctx.font = `800 ${Math.round(s * 0.5)}px Orbitron, "Segoe UI", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      const label = o.kind.label.toUpperCase() + ' ABOVE';
      ctx.strokeText(label, sx, markerY + s * 1.3);
      ctx.fillStyle = '#ffd5d9';
      ctx.fillText(label, sx, markerY + s * 1.3);
    }
    ctx.globalAlpha = 1;
  }
  function drawLock() {
    if (ammo <= 0) return;
    const o = pickTarget();
    if (!o) return;
    const r = Math.max(o.rx, o.ry) * U * o.s * 1.25 + 6, c = r * 0.4;
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = o.sx + dx * r, y = o.sy + dy * r;
      ctx.moveTo(x - dx * c, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - dy * c);
    }
    ctx.stroke();
  }
  function drawMissiles() {
    const img = SPR.ourMissile;
    for (const m of missiles) {
      const h = U * 0.1, w = h / 3, a = m.ang + Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, (m.x + shakeX) * dpr, (m.y + shakeY) * dpr);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
  }

  function drawPlayer(dt, now) {
    const k = 1 - Math.exp(-dt * (usingCamera && now > manualUntil ? 26 : 22));
    player.x += (player.tx - player.x) * k;
    player.y += (player.ty - player.y) * k;
    player.r += (player.tr - player.r) * (1 - Math.exp(-dt * 6));
    player.ang += dt * 1.7;
    const { x, y, r } = player;
    const lost = usingCamera && now - lastFaceAt > FACE_LOST_AFTER;
    if (!usingCamera || viewMode() === 'scene') {
      const sz = r * 1.75;
      ctx.drawImage(SPR.pod, x - sz / 2, y - sz / 2, sz, sz);
    }
    if (invuln > 0 && Math.floor(now / 90) % 2) ctx.globalAlpha = 0.28;
    const col = lost ? '#fbbf24' : invuln > 0 ? '#fda4af' : '#22d3ee';
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, U * 0.005);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.lineWidth = Math.max(3, U * 0.009);
    for (let i = 0; i < 3; i++) {
      const a = player.ang + (i * TAU) / 3;
      ctx.beginPath(); ctx.arc(x, y, r * 1.18, a, a + 0.8); ctx.stroke();
    }
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  function drawHands() {
    for (const h of hands) {
      if (!h.active) continue;
      const armed = h.peak >= SWIPE_MIN, hard = h.peak >= SWIPE_HARD;
      const col = hard ? '#fbbf24' : armed ? '#67e8f9' : '#c7d2fe';
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(1.5, U * 0.004);
      ctx.beginPath();
      // the skeleton follows the smoothed palm so it does not lag behind the push ring
      const ox = h.x - h.tx, oy = h.y - h.ty;
      for (const [a, b] of BONES) {
        ctx.moveTo(h.pts[a * 2] + ox, h.pts[a * 2 + 1] + oy);
        ctx.lineTo(h.pts[b * 2] + ox, h.pts[b * 2 + 1] + oy);
      }
      ctx.stroke();
      ctx.globalAlpha = armed ? 1 : 0.5;
      ctx.lineWidth = armed ? Math.max(3, U * 0.007) : 1.5;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      if (armed && state === 'play' && Math.random() < 0.6 * quality) {
        emit(h.x + rand(-1, 1) * h.r * 0.6, h.y + rand(-1, 1) * h.r * 0.6, -h.vx * 0.1, -h.vy * 0.1, 0.28, U * 0.025, hard ? 'fire' : 'cyan', { drag: 2 });
      }
    }
  }
  function drawParticles(dt) {
    const n = Math.floor(POOL * quality);
    for (let pass = 0; pass < 2; pass++) {
      const add = pass === 1;
      ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      for (let i = 0; i < n; i++) {
        const p = parts[i];
        if (p.life <= 0 || p.add !== add) continue;
        const a = p.life / p.max, sz = Math.max(0.5, p.size + p.grow * (1 - a));
        ctx.globalAlpha = a * p.a;
        ctx.drawImage(p.glow, p.x - sz, p.y - sz, sz * 2, sz * 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (state === 'pause') return;
    for (let i = 0; i < POOL; i++) {
      const p = parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  function drawFloaters(dt) {
    ctx.textAlign = 'center';
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt * 0.95;
      f.y -= dt * U * 0.09;
      if (f.life <= 0) { floaters.splice(i, 1); continue; }
      ctx.globalAlpha = clamp(f.life * 2, 0, 1);
      const px = Math.round(f.size * clamp(U / 600, 0.75, 1.3));
      ctx.font = `800 ${px}px Orbitron, "Segoe UI", sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.72)';
      const x = clamp(f.x, px * 3.2, W - px * 3.2);
      ctx.strokeText(f.text, x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, f.y);
    }
    ctx.globalAlpha = 1;
  }
  let shakeX = 0, shakeY = 0, tintKey = '', tint = null;
  function edgeTint() {
    const k = `${rec.theme}|${W}x${H}`;
    if (k !== tintKey) {
      const rgb = { space: '60,25,130', air: '150,60,40', naval: '10,85,125' }[rec.theme];
      tint = ctx.createRadialGradient(W / 2, H / 2, U * 0.42, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      tint.addColorStop(0, `rgba(${rgb},0)`);
      tint.addColorStop(1, `rgba(${rgb},.5)`);
      tintKey = k;
    }
    return tint;
  }
  function render(dt, now) {
    shakeX = shake ? rand(-shake, shake) : 0;
    shakeY = shake ? rand(-shake, shake) : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const mode = viewMode();
    refreshBackdrop();
    if (mode !== 'ar') {
      ctx.globalAlpha = mode === 'blend' ? 0.56 : 1;
      ctx.drawImage(backdrop, 0, 0, W, H);
      ctx.globalAlpha = 1;
    } else {
      // keep the camera readable but give it the battlefield's colour along the edges
      ctx.fillStyle = edgeTint();
      ctx.fillRect(0, 0, W, H);
    }
    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
    drawDecor(state === 'pause' ? 0 : dt, mode === 'scene' ? 1 : 0.65);
    if (state === 'play' || state === 'pause') {
      drawWarnings();
      drawFallWarnings();
      drawLock();
    }
    objects.sort((a, b) => (b.z || 1) - (a.z || 1));
    let playerDrawn = false;
    for (const o of objects) {
      if (!playerDrawn && (o.fall || o.z < 1)) {
        drawPlayer(state === 'pause' ? 0 : dt, now);
        playerDrawn = true;
      }
      drawObject(o);
    }
    if (!playerDrawn) drawPlayer(state === 'pause' ? 0 : dt, now);
    drawMissiles();
    drawHands();
    drawParticles(dt);
    drawFloaters(state === 'pause' ? 0 : dt);
    if (debug) {
      ctx.fillStyle = '#0f0';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`fps ${fps | 0} face ${Tracker.faceMs | 0}ms hand ${Tracker.handMs | 0}ms ${Tracker.delegate} obj ${objects.length} q ${quality}`, 8, H - 8);
    }
  }

  /* ---------- HUD ---------- */
  const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21C5 15.5 2 12 2 8a5 5 0 0 1 10-1.3A5 5 0 0 1 22 8c0 4-3 7.5-10 13z"/></svg>';
  function renderLives(pop) {
    const el = $('#lives');
    el.innerHTML = HEART.repeat(Math.max(0, lives));
    el.setAttribute('aria-label', `${lives} lives left`);
    if (pop) el.lastElementChild?.classList.add('pop');
  }
  function renderAmmo() {
    const el = $('#ammo');
    el.innerHTML = '<i class="full"></i>'.repeat(ammo) + '<i></i>'.repeat(MAX_AMMO - ammo);
    el.setAttribute('aria-label', `${ammo} missiles ready`);
    $('#fireCount').textContent = ammo;
    $('#btnFire').classList.toggle('empty', ammo === 0);
  }
  let hudScoreShown = -1, hudSec = -1, hudMultShown = -1, hudLevelShown = -1;
  function updateHud(now) {
    const scoreEl = $('#hudScore');
    displayScore += (score - displayScore) * 0.22;
    const shown = Math.round(score - displayScore < 1 ? score : displayScore);
    if (shown !== hudScoreShown) {
      if (score - hudScoreShown >= 40 && hudScoreShown >= 0) {
        scoreEl.classList.remove('bump');
        void scoreEl.offsetWidth;
        scoreEl.classList.add('bump');
      }
      scoreEl.textContent = shown.toLocaleString();
      hudScoreShown = shown;
    }
    const sec = Math.floor(runTime);
    if (sec !== hudSec) { $('#hudTime').textContent = fmtTime(sec); hudSec = sec; }
    if (level !== hudLevelShown) { $('#hudLevel').textContent = `LV ${level}`; hudLevelShown = level; }
    const m = multiplier();
    if (m !== hudMultShown) { $('#hudMult').textContent = m > 1 ? `×${m}` : ''; hudMultShown = m; }

    $('#btnFire').style.setProperty('--reload', ammo < MAX_AMMO ? `${Math.round((reload / RELOAD_TIME) * 100)}%` : '100%');

    const chips = $('#trackChips');
    chips.hidden = !usingCamera;
    if (usingCamera) {
      const faceOn = now - lastFaceAt < FACE_LOST_AFTER, handOn = hands[0].active || hands[1].active;
      $('#chipFace').className = faceOn ? 'on' : 'lost';
      $('#chipHand').className = handOn ? 'on' : '';
      setBanner(state === 'play' && !faceOn && now > manualUntil && runTime > 0.5
        ? 'Face lost. Move back into view, or steer with the keys or a drag'
        : '');
    } else setBanner('');
  }
  function setBanner(text) {
    const el = $('#banner');
    if (el.dataset.t === text) return;
    el.dataset.t = text;
    if (text) el.textContent = text;
    el.classList.toggle('on', !!text);
  }
  function showBig(text, dur) {
    const el = $('#big');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.style.animationDuration = `${dur}s`;
    el.classList.add('show');
  }

  /* ---------- game flow ---------- */
  let countdownTimer = 0;
  function showOnly(id) {
    for (const c of ['#menu', '#pauseCard', '#overCard']) $(c).hidden = c !== id;
  }
  function resetRun() {
    objects = [];
    missiles = []; ammo = MAX_AMMO; reload = 0; fireCooldown = 0; kills = 0;
    renderAmmo();
    score = 0; displayScore = 0; lives = LIVES; runTime = 0; level = 1; combo = 0; bestCombo = 0;
    spawnTimer = 0.2; salvoTimer = 8; invuln = 0; shake = 0; dodges = 0; pushes = 0; chains = 0; scoreCarry = 0; pushCooldown = 0;
    nextOneUp = ONE_UP_EVERY;
    runTheme = rec.theme;
    hudScoreShown = hudSec = hudMultShown = hudLevelShown = -1;
    floaters.length = 0;
    for (const p of parts) p.life = 0;
    renderLives();
    if (!usingCamera) { player.tx = W / 2; player.ty = H * 0.58; }
  }
  function goFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || !(el.requestFullscreen || el.webkitRequestFullscreen)) return;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen();
      p?.catch?.(() => {});
    } catch {}
  }
  function beginRun() {
    Sfx.unlock();
    goFullscreen();
    resetRun();
    showOnly(null);
    $('#hud').hidden = false;
    document.body.classList.add('playing');
    updatePushButtons();
    applyView();
    state = 'countdown';
    clearTimeout(countdownTimer);
    let n = 3;
    const tick = () => {
      if (state !== 'countdown') return;
      if (n > 0) {
        showBig(String(n), 0.85);
        Sfx.beep(false);
        n--;
        countdownTimer = setTimeout(tick, 760);
      } else {
        showBig('SURVIVE!', 0.85);
        Sfx.beep(true);
        Sfx.music(rec.theme);
        state = 'play';
      }
    };
    tick();
  }
  function pauseGame() {
    if (state !== 'play') return;
    state = 'pause';
    keys.clear();
    Sfx.music(null);
    showOnly('#pauseCard');
    renderPicks();
    $('#btnResume').focus({ preventScroll: true });
  }
  function resumeGame() {
    if (state !== 'pause') return;
    Sfx.unlock();
    showOnly(null);
    state = 'play';
    Sfx.music(rec.theme);
    lastT = performance.now();
  }
  function gameOver() {
    if (state !== 'play') return;
    state = 'over';
    missiles = [];
    Sfx.music(null);
    Sfx.over();
    explosion(player.x, player.y, U * 0.09, true);
    const isBest = score > rec.best;
    if (isBest) { rec.best = score; Sfx.best(); }
    rec.bestTime = Math.max(rec.bestTime, Math.floor(runTime));
    rec.games++;
    rec.dodges += dodges;
    rec.pushes += pushes;
    rec.byTheme[runTheme] = Math.max(rec.byTheme[runTheme] || 0, score);
    save();
    $('#newBest').hidden = !isBest;
    $('#overTitle').textContent = isBest ? 'Legendary run' : 'Destroyed';
    $('#finalScore').textContent = score.toLocaleString();
    $('#overStats').innerHTML = [
      ['Survived', fmtTime(runTime)], ['Dodged', dodges], ['Destroyed', kills],
      ['Pushed', pushes], ['Best streak', bestCombo], ['High score', rec.best.toLocaleString()],
    ].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
    setBanner('');
    setTimeout(() => { if (state === 'over') { showOnly('#overCard'); $('#btnAgain').focus({ preventScroll: true }); } }, 750);
  }
  function toMenu() {
    state = 'menu';
    objects = [];
    Sfx.music(null);
    $('#hud').hidden = true;
    document.body.classList.remove('playing');
    updatePushButtons();
    setBanner('');
    showOnly('#menu');
    renderPicks();
    renderBest();
    updateChecks();
  }
  function endRunEarly() {
    if (state === 'pause') {
      state = 'play';
      gameOver();
    }
  }
  function updatePushButtons() {
    const show = document.body.classList.contains('playing') && (!usingCamera || matchMedia('(pointer: coarse)').matches);
    $('#pushL').hidden = $('#pushR').hidden = !show;
    $('#btnFire').hidden = !document.body.classList.contains('playing');
  }

  /* ---------- menu ---------- */
  function radio(host, items, current, onPick) {
    host.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = it.className || 'chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(it.id === current));
      if (it.disabled) b.disabled = true;
      if (it.thumb) {
        const im = document.createElement('img');
        im.src = it.thumb;
        im.alt = '';
        b.append(im);
      }
      b.append(it.label);
      b.onclick = () => { Sfx.unlock(); Sfx.dodge(2); onPick(it.id); };
      host.append(b);
    }
  }
  const thumbs = {};
  function thumbOf(name) {
    if (!thumbs[name]) {
      const c = document.createElement('canvas'), img = SPR[name], s = Math.min(104 / img.width, 68 / img.height);
      c.width = 104; c.height = 68;
      c.getContext('2d').drawImage(img, (104 - img.width * s) / 2, (68 - img.height * s) / 2, img.width * s, img.height * s);
      thumbs[name] = c.toDataURL();
    }
    return thumbs[name];
  }
  function renderPicks() {
    const themeItems = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.name, className: 'theme', thumb: thumbOf(t.thumb) }));
    const bgItems = THEMES[rec.theme].backdrops.map(([id, label]) => ({ id, label }));
    const viewItems = VIEWS.map(([id, label]) => ({ id, label, disabled: !usingCamera && id !== 'scene' }));
    const pickTheme = (id) => {
      rec.theme = id;
      vpY = H * THEMES[id].vp;
      save();
      renderPicks();
      renderBest();
    };
    const pickBg = (id) => { rec.backdrop[rec.theme] = id; save(); renderPicks(); };
    const pickView = (id) => { rec.view = id; save(); applyView(); renderPicks(); };
    radio($('#themePicks'), themeItems, rec.theme, pickTheme);
    radio($('#themePicks2'), themeItems, rec.theme, pickTheme);
    radio($('#bgPicks'), bgItems, backdropId(), pickBg);
    radio($('#bgPicks2'), bgItems, backdropId(), pickBg);
    radio($('#viewPicks'), viewItems, viewMode(), pickView);
    radio($('#viewPicks2'), viewItems, viewMode(), pickView);
  }
  function renderBest() {
    const best = rec.byTheme[rec.theme] || 0;
    $('#bestLine').textContent = rec.best
      ? `High score ${rec.best.toLocaleString()} · ${THEMES[rec.theme].name} ${best.toLocaleString()} · Longest ${fmtTime(rec.bestTime)}`
      : '';
  }

  /* ---------- camera + AI setup ---------- */
  const fmtMB = (b) => `${(b / 1048576).toFixed(1)} MB`;
  function updateChecks() {
    $('#ckCam').classList.toggle('ok', Tracker.cameraOn);
    $('#ckFace').classList.toggle('ok', faceSeen && performance.now() - lastFaceAt < 1500);
    $('#ckHand').classList.toggle('ok', handSeen && performance.now() - lastHandAt < 1500);
    if (usingCamera && state === 'menu') {
      const main = $('#btnMain');
      if (Tracker.faceReady) {
        main.disabled = false;
        main.textContent = 'Start game';
      }
    }
  }
  Tracker.onProgress = (m) => {
    const pct = Math.round((m.done / m.total) * 100);
    $('#progressBar').style.width = `${pct}%`;
    $('#progressText').textContent = m.networkBytes
      ? `Downloading AI models once: ${fmtMB(m.done)} of ${fmtMB(m.total)}. Next time they load from this device.`
      : `Loading AI models from this device: ${pct}%`;
  };
  Tracker.onStatus = () => {
    if (Tracker.aiFailed) {
      $('#progress').hidden = true;
      if (Tracker.failedRole === 'hand' && Tracker.faceReady) $('#setupMsg').textContent = 'Hand tracking could not load. Face dodging still works, and you can push with Q and E or the arrow buttons.';
      else failToManual(`The AI models could not load (${Tracker.error}). You can still play with the keyboard or touch.`, true);
    } else if (Tracker.handReady) {
      $('#progress').hidden = true;
      $('#setupMsg').textContent = 'Tracking ready. Line up your face, then raise a hand to test it.';
    } else if (Tracker.faceReady && !Tracker.handsEnabled) {
      $('#progress').hidden = true;
      $('#setupMsg').textContent = 'Tracking ready. Line up your face, then start.';
    } else if (Tracker.faceReady) {
      $('#setupMsg').textContent = 'Face tracking ready. You can start now; hand tracking joins when it finishes loading.';
    } else if (!Tracker.cameraOn && usingCamera) {
      failToManual('The camera stopped. Reopen the page or play with the keyboard or touch.', true);
    }
    updateChecks();
    applyView();
  };
  function failToManual(message, drop) {
    $('#setupMsg').textContent = message;
    if (drop) {
      usingCamera = false;
      Tracker.closeCamera();
      $('#checks').hidden = true;
      const main = $('#btnMain');
      main.disabled = false;
      main.textContent = 'Try camera again';
      applyView();
      renderPicks();
    }
  }
  const CAMERA_ERRORS = {
    NotAllowedError: 'Camera access was blocked. Allow it in your browser settings, or play with the keyboard or touch.',
    SecurityError: 'Camera access was blocked. Allow it in your browser settings, or play with the keyboard or touch.',
    NotFoundError: 'No camera was found on this device. You can play with the keyboard or touch.',
    OverconstrainedError: 'No camera was found on this device. You can play with the keyboard or touch.',
    NotReadableError: 'Another app is using the camera. Close it and try again, or play with the keyboard or touch.',
    InsecureContext: 'The camera needs a secure (https) page. You can play with the keyboard or touch.',
    NotSupportedError: 'This browser cannot open the camera. You can play with the keyboard or touch.',
  };
  async function enableCamera() {
    const main = $('#btnMain');
    main.disabled = true;
    main.textContent = 'Waiting for camera…';
    $('#setupMsg').textContent = '';
    try {
      await Tracker.openCamera();
    } catch (err) {
      failToManual(CAMERA_ERRORS[err.name] || `The camera could not start (${err.name}). You can play with the keyboard or touch.`, true);
      return;
    }
    usingCamera = true;
    manualUntil = 0;
    $('#checks').hidden = false;
    applyView();
    renderPicks();
    updateChecks();
    if (Tracker.faceReady) { Tracker.onStatus(); return; }
    main.textContent = 'Loading AI…';
    $('#progress').hidden = false;
    Tracker.startAI();
  }

  /* ---------- input ---------- */
  $('#btnMain').onclick = () => {
    Sfx.unlock();
    if (usingCamera && Tracker.faceReady) beginRun();
    else enableCamera();
  };
  $('#btnManual').onclick = () => {
    Sfx.unlock();
    usingCamera = false;
    Tracker.closeCamera();
    $('#checks').hidden = true;
    applyView();
    beginRun();
  };
  $('#btnResume').onclick = resumeGame;
  $('#btnQuit').onclick = endRunEarly;
  $('#btnAgain').onclick = beginRun;
  $('#btnMenu').onclick = toMenu;
  $('#btnPause').onclick = pauseGame;
  $('#btnReset').onclick = () => {
    const { theme, backdrop: b, view } = rec;
    rec = { ...blank(), theme, backdrop: b, view };
    save();
    $('#newBest').hidden = true;
    $('#overStats').lastElementChild.firstElementChild.textContent = '0';
  };
  function syncSoundButtons() {
    for (const id of ['#btnSound', '#btnSound2']) {
      $(id).classList.toggle('muted', !Sfx.on);
      $(id).setAttribute('aria-pressed', String(Sfx.on));
    }
  }
  const toggleSound = () => {
    Sfx.unlock();
    Sfx.toggle();
    syncSoundButtons();
    if (Sfx.on && state === 'play') Sfx.music(rec.theme);
  };
  $('#btnSound').onclick = toggleSound;
  $('#btnSound2').onclick = toggleSound;
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else goFullscreen();
  }
  $('#btnFull').onclick = toggleFullscreen;
  if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) $('#btnFull').hidden = true;

  const pushButton = (el, side) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); Sfx.unlock(); manualPush(side); });
  };
  pushButton($('#pushL'), -1);
  pushButton($('#pushR'), 1);
  $('#btnFire').addEventListener('pointerdown', (e) => { e.preventDefault(); Sfx.unlock(); fireMissile(); });

  // a quick tap or click fires at the object under it; pressing and moving steers instead
  let dragId = null, dragX = 0, dragY = 0, downX = 0, downY = 0, downAt = 0, dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play' && state !== 'countdown') return;
    dragId = e.pointerId; dragX = downX = e.clientX; dragY = downY = e.clientY;
    downAt = performance.now();
    dragging = false;
    try { canvas.setPointerCapture(dragId); } catch {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) < 12) return;
    dragging = true;
    player.tx = clamp(player.tx + (e.clientX - dragX) * 1.3, 0, W);
    player.ty = clamp(player.ty + (e.clientY - dragY) * 1.3, 0, H);
    dragX = e.clientX; dragY = e.clientY;
    manualUntil = performance.now() + 1100;
  });
  const endDrag = (e) => { if (e.pointerId === dragId) dragId = null; };
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerId === dragId && !dragging && performance.now() - downAt < 350) fireMissile(e.clientX, e.clientY);
    endDrag(e);
  });
  canvas.addEventListener('pointercancel', endDrag);

  const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement || e.target?.tagName === 'SUMMARY';
    if (GAME_KEYS.has(e.code) && !(onButton && state !== 'play')) e.preventDefault();
    if (e.repeat) return;
    if (state === 'play' || state === 'countdown') keys.add(e.code);
    switch (e.code) {
      case 'KeyQ': manualPush(-1); break;
      case 'KeyE': manualPush(1); break;
      case 'KeyM': toggleSound(); break;
      case 'KeyF': toggleFullscreen(); break;
      case 'KeyP': case 'Escape':
        if (state === 'play') pauseGame();
        else if (state === 'pause') resumeGame();
        break;
      case 'Space':
        if (state === 'play') { fireMissile(); break; }
        if (onButton) break;
        if (state === 'pause') resumeGame();
        else if (state === 'over' && !$('#overCard').hidden) beginRun();
        break;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  /* ---------- main loop ---------- */
  let lastT = performance.now(), fps = 60, slowFor = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - lastT) / 1000;
    lastT = now;
    const dt = Math.min(raw, 0.05);
    fps = fps * 0.95 + (1 / Math.max(raw, 0.001)) * 0.05;
    Tracker.pump();
    stepHands(dt, now);
    if (state === 'play') step(dt, now);
    else if (state === 'over') {
      for (const o of objects) { if (o.state !== 'dead' && !o.fall) { o.z -= o.vz * dt; o.s = 1 / Math.max(o.z, 0.22); } }
      objects = objects.filter((o) => o.fall || o.z > 0.34);
      shake = Math.max(0, shake - U * 0.11 * dt);
    }
    render(dt, now);
    if (state !== 'menu') updateHud(now);
    if (state === 'menu' && Math.floor(now / 300) !== Math.floor((now - raw * 1000) / 300)) updateChecks();
    // drop rendering detail once, if this device stays well under 40 frames a second during play
    if (state === 'play' && quality === 1) {
      slowFor = fps < 40 ? slowFor + raw : 0;
      if (slowFor > 2.5) { quality = 0.55; resize(); }
    }
  }

  /* ---------- start up ---------- */
  syncSoundButtons();
  if (!Tracker.handsEnabled) $('#chipHand').hidden = $('#ckHand').hidden = true;
  resize();
  player.x = player.tx; player.y = player.ty; player.r = player.tr;
  renderPicks();
  renderBest();
  applyView();
  if (debug) {
    window.__ars = {
      get state() { return state; }, get score() { return score; }, get lives() { return lives; },
      get pushes() { return pushes; }, get dodges() { return dodges; }, get level() { return level; },
      get objects() { return objects; }, get runTime() { return runTime; }, set runTime(v) { runTime = v; },
      get kills() { return kills; }, get ammo() { return ammo; }, get missiles() { return missiles; },
      player, hands, spawn, Tracker, setInvuln(v) { invuln = v; }, stopSpawns() { spawnTimer = 1e9; salvoTimer = 1e9; },
    };
  }
  requestAnimationFrame(frame);
})();
