/* Grave Mistake: drawing, sound, controls and saved progress. The rules live in rules.js. */
(() => {
  'use strict';
  const R = GraveRules, { T, W, H, PW, PH } = R;
  const SCREEN_W = W * T, SCREEN_H = H * T;
  const STEP = 1000 / 60, RESPAWN_FRAMES = 34;
  const SAVE_KEY = 'graveMistake.v1';
  const $ = (s) => document.querySelector(s);
  const canvas = $('#game'), g = canvas.getContext('2d'), cards = $('#cards');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----- saved progress ----- */
  let save = { reached: 0, deaths: 0, level: 0, best: null, done: 0 };
  try { save = { ...save, ...JSON.parse(localStorage.getItem(SAVE_KEY)) }; } catch {}
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };

  /* ----- sound ----- */
  let audio = null, soundOn = true;
  try { soundOn = localStorage.getItem('graveMistake.sound') !== 'off'; } catch {}
  function tone(freq, dur, type = 'square', vol = .05, slide = 0) {
    if (!soundOn || !audio) return;
    const o = audio.createOscillator(), a = audio.createGain(), t = audio.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    a.gain.setValueAtTime(vol, t); a.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(a).connect(audio.destination); o.start(t); o.stop(t + dur);
  }
  const SOUNDS = {
    jump: () => tone(330, .12, 'triangle', .08, 260),
    die: () => { tone(220, .35, 'sawtooth', .07, -170); tone(110, .3, 'square', .04, -60); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .16, 'triangle', .08), i * 80)),
    pop: () => tone(900, .07, 'square', .04, -500),
    bump: () => tone(160, .1, 'square', .07),
    spring: () => tone(240, .22, 'triangle', .09, 640),
    hop: () => tone(700, .16, 'sine', .08, 500),
    crack: () => tone(120, .08, 'sawtooth', .04),
    rumble: () => tone(70, .3, 'sawtooth', .07),
    thud: () => tone(60, .2, 'square', .1),
    saw: () => tone(500, .5, 'sawtooth', .03, 500),
    warp: () => tone(600, .4, 'sine', .08, -480),
  };
  function wakeAudio() {
    try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {}
  }
  const soundBtn = $('#btnSound');
  function markSound() { soundBtn.setAttribute('aria-pressed', String(soundOn)); }
  function toggleSound() { soundOn = !soundOn; try { localStorage.setItem('graveMistake.sound', soundOn ? 'on' : 'off'); } catch {} markSound(); }
  soundBtn.addEventListener('click', toggleSound);
  markSound();

  /* ----- input ----- */
  const held = { left: false, right: false, jump: false };
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump' };
  addEventListener('keydown', (e) => {
    wakeAudio();
    if (e.code === 'KeyM' && !e.repeat) toggleSound();
    if (e.code === 'KeyR' && !e.repeat && playing()) restart(true);
    if (KEYS[e.code]) {
      if (document.activeElement?.tagName === 'BUTTON' && !playing()) return;   // let space press the focused button
      held[KEYS[e.code]] = true; e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => { if (KEYS[e.code]) held[KEYS[e.code]] = false; });
  addEventListener('blur', () => { held.left = held.right = held.jump = false; });
  // on touch screens: a small left and right joystick, and a tap anywhere else is a jump
  const stick = $('#stick'), knob = $('#knob');
  const STICK_TRAVEL = 30, STICK_DEAD = 8;
  let stickId = null;
  function moveStick(e) {
    const r = stick.getBoundingClientRect();
    const dx = Math.max(-STICK_TRAVEL, Math.min(STICK_TRAVEL, e.clientX - (r.left + r.width / 2)));
    knob.style.transform = `translateX(${dx}px)`;
    held.left = dx < -STICK_DEAD; held.right = dx > STICK_DEAD;
  }
  function freeStick() {
    stickId = null; knob.style.transform = '';
    held.left = held.right = false;
  }
  stick.addEventListener('pointerdown', (e) => { e.preventDefault(); wakeAudio(); stickId = e.pointerId; stick.setPointerCapture?.(e.pointerId); moveStick(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  for (const type of ['pointerup', 'pointercancel']) stick.addEventListener(type, (e) => { if (e.pointerId === stickId) freeStick(); });
  const tappers = new Set();
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); wakeAudio(); tappers.add(e.pointerId); canvas.setPointerCapture?.(e.pointerId); held.jump = true; });
  for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (e) => { tappers.delete(e.pointerId); if (!tappers.size) held.jump = false; });
  for (const el of [stick, canvas]) el.addEventListener('contextmenu', (e) => e.preventDefault());

  let stickSide = 'left';
  try { if (localStorage.getItem('graveMistake.stick') === 'right') stickSide = 'right'; } catch {}
  function setStickSide(side) {
    stickSide = side;
    stick.classList.toggle('right', side === 'right');
    try { localStorage.setItem('graveMistake.stick', side); } catch {}
    document.querySelectorAll('[data-side]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === side)));
  }
  const stickChooser = () => `<div class="side-pick"><span>Joystick</span><button class="btn small" data-side="left" aria-pressed="${stickSide === 'left'}">Left</button><button class="btn small" data-side="right" aria-pressed="${stickSide === 'right'}">Right</button></div>`;
  cards.addEventListener('click', (e) => { const side = e.target.dataset?.side; if (side) setStickSide(side); });
  stick.classList.toggle('right', stickSide === 'right');

  /* ----- the living backdrop: a sky that turns from day to night, over a different scene each level ----- */
  const noise = (i, seed) => { const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; return v - Math.floor(v); };
  const SKY_MS = 120000;
  const SKY = [
    { at: 0, top: [32, 42, 96], mid: [214, 120, 130], low: [255, 190, 140], far: [122, 92, 122], near: [72, 56, 92], cloud: [255, 214, 200], stars: .15 },
    { at: .25, top: [52, 126, 218], mid: [125, 190, 240], low: [208, 234, 246], far: [116, 164, 172], near: [68, 122, 116], cloud: [255, 255, 255], stars: 0 },
    { at: .5, top: [50, 40, 112], mid: [226, 106, 96], low: [255, 172, 92], far: [136, 70, 96], near: [76, 40, 76], cloud: [255, 176, 140], stars: .2 },
    { at: .72, top: [8, 10, 34], mid: [22, 26, 66], low: [46, 46, 96], far: [28, 32, 66], near: [14, 16, 40], cloud: [58, 62, 104], stars: 1 },
    { at: 1, top: [32, 42, 96], mid: [214, 120, 130], low: [255, 190, 140], far: [122, 92, 122], near: [72, 56, 92], cloud: [255, 214, 200], stars: .15 },
  ];
  function skyAt(t) {
    const i = SKY.findIndex((k) => k.at > t) - 1, a = SKY[i], b = SKY[i + 1], k = (t - a.at) / (b.at - a.at);
    const out = { stars: a.stars + (b.stars - a.stars) * k };
    for (const name of ['top', 'mid', 'low', 'far', 'near', 'cloud']) out[name] = `rgb(${a[name].map((v, n) => Math.round(v + (b[name][n] - v) * k)).join()})`;
    return out;
  }
  const SCENES = ['hills', 'pines', 'city', 'dunes', 'peaks'];
  const LEFT = -700, RIGHT = 1660, DEEP = 3000;
  function ridgePath(height, seed, base, jag, tree) {
    const path = new Path2D();
    path.moveTo(LEFT, DEEP);
    for (let x = LEFT; x <= RIGHT; x += 12) {
      const y = base - (Math.sin(x * .007 + seed) + Math.sin(x * .019 + seed * 2) * .5 + 1.5) * height - noise(Math.floor(x / 12), seed) * jag;
      if (tree && Math.floor(x / 12) % 4 === 0) { path.lineTo(x, y); path.lineTo(x + 7, y - tree - noise(x, seed) * tree); path.lineTo(x + 14, y); } else path.lineTo(x, y);
    }
    path.lineTo(RIGHT, DEEP); path.closePath();
    return path;
  }
  function peaksPath(seed, base, size) {
    const path = new Path2D();
    path.moveTo(LEFT, DEEP); path.lineTo(LEFT, base);
    for (let x = LEFT, i = 0; x < RIGHT; i++) {
      const w = size * (.7 + noise(i, seed) * .8);
      path.lineTo(x + w / 2, base - size * (.6 + noise(i, seed + 2) * .9)); path.lineTo(x + w, base);
      x += w * .8;
    }
    path.lineTo(RIGHT, DEEP); path.closePath();
    return path;
  }
  function skylinePath(seed, base, tall, lights) {
    const path = new Path2D();
    path.moveTo(LEFT, DEEP);
    for (let x = LEFT, i = 0; x < RIGHT; i++) {
      const w = 34 + noise(i, seed) * 46, h = tall * (.45 + noise(i, seed + 3));
      path.lineTo(x, base - h); path.lineTo(x + w, base - h);
      if (lights) for (let wy = 10; wy < h - 6; wy += 15) for (let wx = 7; wx < w - 8; wx += 12) {
        if (noise(wx + i * 31, wy + seed) > .62) lights.push([x + wx, base - h + wy]);
      }
      x += w + 3;
    }
    path.lineTo(RIGHT, DEEP); path.closePath();
    return path;
  }
  function makeScene(lv) {
    const kind = SCENES[lv % SCENES.length], s1 = lv + 1, s2 = lv + 5, lights = [];
    if (kind === 'pines') return { far: ridgePath(30, s1, 400, 3, 16), near: ridgePath(22, s2, 462, 2, 28), lights };
    if (kind === 'city') return { far: skylinePath(s1, 440, 150), near: skylinePath(s2, 470, 90, lights), lights };
    if (kind === 'dunes') return { far: ridgePath(34, s1, 420, 0), near: ridgePath(24, s2, 470, 0), lights };
    if (kind === 'peaks') return { far: peaksPath(s1, 440, 230), near: peaksPath(s2, 480, 130), lights };
    return { far: ridgePath(46, s1, 410, 5), near: ridgePath(36, s2, 470, 5), lights };
  }
  const STARS = Array.from({ length: 90 }, (_, i) => [noise(i, 7), noise(i, 3), .3 + noise(i, 11) * .7, noise(i, 5) > .8 ? 2 : 1.3]);
  const CLOUDS = Array.from({ length: 7 }, (_, i) => [noise(i, 21), .08 + noise(i, 23) * .62, .7 + noise(i, 25) * .9, .6 + noise(i, 27)]);
  function puff(x, y, k) {
    g.beginPath();
    for (const [dx, dy, r] of [[-34, 5, 18], [-12, -7, 25], [16, -3, 22], [38, 6, 15]]) { g.moveTo(x + dx * k + r * k, y + dy * k); g.arc(x + dx * k, y + dy * k, r * k, 0, 7); }
    g.fill();
  }
  function drawSky(now, cw, ch, horizon) {
    const t = ((level * .37 + (reduced() ? 0 : now / SKY_MS)) % 1 + 1) % 1, sky = skyAt(t);
    const grad = g.createLinearGradient(0, 0, 0, horizon);
    grad.addColorStop(0, sky.top); grad.addColorStop(.65, sky.mid); grad.addColorStop(1, sky.low);
    g.fillStyle = grad; g.fillRect(0, 0, cw, ch);
    if (sky.stars > .02) for (const [x, y, a, r] of STARS) { g.fillStyle = `rgba(255, 255, 255, ${a * sky.stars})`; g.fillRect(x * cw, y * horizon * .8, r, r); }
    // the sun crosses during the first half of the cycle, and the moon during the second
    const isDay = t < .5, arc = (isDay ? t : t - .5) * 2 * Math.PI;
    const bx = cw * (.5 - .42 * Math.cos(arc)), by = horizon - Math.sin(arc) * horizon * .82 + 8, size = Math.max(20, Math.min(cw, ch) * .05);
    g.fillStyle = isDay ? 'rgba(255, 226, 150, .25)' : 'rgba(255, 244, 214, .14)';
    g.beginPath(); g.arc(bx, by, size * 1.7, 0, 7); g.fill();
    g.fillStyle = isDay ? '#fff1b8' : '#fff4d6';
    g.beginPath(); g.arc(bx, by, size, 0, 7); g.fill();
    g.fillStyle = sky.cloud; g.globalAlpha = .75;
    CLOUDS.forEach(([x, y, k, speed]) => {
      const span = cw + 240, drift = reduced() ? 0 : now * .004 * speed;
      puff((x * span + drift) % span - 120, y * horizon, k * Math.max(.7, Math.min(cw, ch) / 500));
    });
    g.globalAlpha = 1;
    return sky;
  }
  function paintTile(c, x, y, hue, open) {
    const px = x * T, py = y * T;
    c.fillStyle = `hsl(${hue} 34% 22%)`;
    c.fillRect(px, py, T + .5, T + .5);
    c.fillStyle = `hsl(${hue} 34% 27%)`;
    c.beginPath(); c.roundRect(px + 3, py + 3, T - 6, T - 6, 7); c.fill();
    c.fillStyle = `hsl(${hue} 30% 17%)`;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(px + 8 + noise(x * 3 + i, y) * 24, py + 10 + noise(x + i, y * 5) * 22, 1.6, 0, 7); c.fill(); }
    if (open.up) {
      c.fillStyle = `hsl(${(hue + 70) % 360} 70% 62%)`;
      c.fillRect(px, py, T + .5, 6);
      for (let i = 0; i < 4; i++) { const dx = 3 + i * 9 + noise(x, i) * 4, len = 3 + noise(x + i, y) * 7; c.beginPath(); c.roundRect(px + dx, py + 3, 4, len + 3, 2); c.fill(); }
    }
    if (open.down) { c.fillStyle = 'rgba(0, 0, 0, .28)'; c.fillRect(px, py + T - 4, T + .5, 4); }
  }
  const looksSolid = (ch) => ch === '#' || ch === 'f' || ch === 'c';
  // the tiles that never change, kept at twice the size so that they stay sharp when the camera moves in
  function paintTiles(lv) {
    const L = R.parse(lv), layer = document.createElement('canvas');
    layer.width = SCREEN_W * 2; layer.height = SCREEN_H * 2;
    const c = layer.getContext('2d');
    c.scale(2, 2);
    L.grid.forEach((row, y) => row.forEach((ch, x) => {
      if (ch !== '#' && ch !== 'f') return;
      paintTile(c, x, y, L.hue, { up: y > 0 && !looksSolid(L.grid[y - 1][x]), down: y < H - 1 && !looksSolid(L.grid[y + 1][x]) });
    }));
    return layer;
  }
  // the sides of the screen are walls and the ground goes on below, so that a tall or wide screen is never empty
  function drawSurround(L) {
    const rock = `hsl(${L.hue} 34% 22%)`, edge = `hsl(${L.hue} 34% 15%)`, far = 6000;
    g.fillStyle = rock;
    g.fillRect(-far, SCREEN_H, far * 2 + SCREEN_W, far);
    g.fillRect(-far, -far, far, far * 2);
    g.fillRect(SCREEN_W, -far, far, far * 2);
    for (let x = 0; x < W; x++) if (looksSolid(L.grid[0][x])) g.fillRect(x * T, -far, T + .5, far);
    g.fillStyle = edge;
    g.fillRect(-6, -far, 6, far * 2);
    g.fillRect(SCREEN_W, -far, 6, far * 2);
    g.fillRect(0, SCREEN_H, SCREEN_W, 5);
    g.fillStyle = `hsl(${L.hue} 30% 17%)`;
    for (let i = 0; i < 90; i++) { g.beginPath(); g.arc(noise(i, 31) * 1400 - 220, SCREEN_H + 14 + noise(i, 33) * 500, 1.5 + noise(i, 35) * 2.5, 0, 7); g.fill(); }
  }

  /* ----- pieces ----- */
  function crystal(x, y, h, flip = false) {
    // three shards rather than one spike, in a hot pink that reads against every sky
    const dir = flip ? 1 : -1;
    for (const [dx, w, k, col] of [[9, 7, .72, '#be123c'], [31, 7, .66, '#be123c'], [20, 9, 1, '#fb7185']]) {
      g.fillStyle = col;
      g.beginPath(); g.moveTo(x + dx - w, y); g.lineTo(x + dx, y + dir * h * k); g.lineTo(x + dx + w, y); g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(255, 255, 255, .75)';
    g.beginPath(); g.moveTo(x + 20, y + dir * h * .95); g.lineTo(x + 17, y + dir * h * .35); g.lineTo(x + 20, y + dir * h * .3); g.closePath(); g.fill();
  }
  function archDoor(x, y, down, time, teeth) {
    // a stone arch with a lantern-lit doorway; a door that bites looks just the same until it's too late
    const px = x * T + 4, py = (down ? y : y - 1) * T, w = T - 8, h = T * 2;
    g.save();
    if (down) { g.translate(0, py * 2 + h); g.scale(1, -1); }
    const glow = g.createRadialGradient(px + w / 2, py + h * .55, 3, px + w / 2, py + h * .55, 52);
    glow.addColorStop(0, `rgba(253, 224, 71, ${.42 + Math.sin(time / 300) * .08})`); glow.addColorStop(1, 'rgba(253, 224, 71, 0)');
    g.fillStyle = glow; g.fillRect(px - 40, py - 30, w + 80, h + 50);
    g.fillStyle = '#44403c';
    g.beginPath(); g.moveTo(px - 3, py + h); g.lineTo(px - 3, py + w / 2); g.arc(px + w / 2, py + w / 2 + 1, w / 2 + 3, Math.PI, 0); g.lineTo(px + w + 3, py + h); g.closePath(); g.fill();
    g.fillStyle = teeth ? '#450a0a' : '#fde68a';
    g.beginPath(); g.moveTo(px + 3, py + h); g.lineTo(px + 3, py + w / 2 + 2); g.arc(px + w / 2, py + w / 2 + 2, w / 2 - 3, Math.PI, 0); g.lineTo(px + w - 3, py + h); g.closePath(); g.fill();
    if (teeth) {
      g.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(px + 4 + i * 7, py + 22); g.lineTo(px + 7.5 + i * 7, py + 36); g.lineTo(px + 11 + i * 7, py + 22); g.fill();
        g.beginPath(); g.moveTo(px + 4 + i * 7, py + h); g.lineTo(px + 7.5 + i * 7, py + h - 14); g.lineTo(px + 11 + i * 7, py + h); g.fill();
      }
    } else {
      g.fillStyle = '#b45309'; g.beginPath(); g.arc(px + w - 9, py + h * .62, 2.5, 0, 7); g.fill();
    }
    g.restore();
  }
  function saw(x, y, r, spin) {
    g.save(); g.translate(x, y); g.rotate(spin);
    g.fillStyle = '#e2e8f0';
    g.beginPath();
    for (let i = 0; i < 20; i++) { const a = i / 20 * 6.283, q = i % 2 ? r : r * .76; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); }
    g.closePath(); g.fill();
    g.fillStyle = '#64748b'; g.beginPath(); g.arc(0, 0, r * .3, 0, 7); g.fill();
    g.restore();
  }
  function spring(x, y, squish) {
    const px = x * T, by = (y + 1) * T;
    g.strokeStyle = '#cbd5e1'; g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i <= 4; i++) g.lineTo(px + (i % 2 ? 28 : 12), by - i * (5 - squish));
    g.stroke();
    g.fillStyle = '#facc15';
    g.beginPath(); g.roundRect(px + 6, by - 24 + squish * 4, 28, 6, 3); g.fill();
  }
  function grave(x, y, up) {
    g.save(); g.translate(x, y); if (up) g.scale(1, -1);
    g.fillStyle = 'rgba(226, 232, 240, .62)';
    g.beginPath(); g.roundRect(-6, -15, 12, 15, [5, 5, 0, 0]); g.fill();
    g.fillStyle = 'rgba(30, 27, 75, .6)'; g.fillRect(-.8, -12, 1.6, 7); g.fillRect(-3, -10, 6, 1.6);
    g.restore();
  }
  // the hero: a small teal lantern-spirit with a scarf that trails behind
  function hero(p, time) {
    const air = !p.grounded, sx = air ? .94 : 1 + Math.abs(squash) * .3, sy = air ? 1.07 : 1 - Math.abs(squash) * .3;
    const cx = p.x + PW / 2, footY = p.g > 0 ? p.y + PH : p.y;
    g.save(); g.translate(cx, footY); g.scale(p.face * sx, p.g * sy);
    const wob = Math.sin(time / 90) * Math.min(1, Math.abs(p.vx) / 3);
    g.strokeStyle = '#f97316'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-6, -17); g.quadraticCurveTo(-15, -17 + wob * 3, -22 - Math.abs(p.vx), -13 + wob * 5 + p.vy * p.g * -.5); g.stroke();
    g.fillStyle = '#134e4a';
    g.fillRect(-9 + wob * 3, -5, 6, 5); g.fillRect(3 - wob * 3, -5, 6, 5);
    g.fillStyle = '#2dd4bf';
    g.beginPath(); g.roundRect(-12, -32, 24, 28, 11); g.fill();
    g.fillStyle = '#99f6e4';
    g.beginPath(); g.roundRect(-8, -30, 11, 5, 3); g.fill();
    g.fillStyle = '#f97316'; g.fillRect(-12, -17, 24, 4);
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(2, -24, 4.5, 0, 7); g.arc(10, -24, 3.6, 0, 7); g.fill();
    g.fillStyle = '#0f172a';
    g.beginPath(); g.arc(3.5, -24, 2.2, 0, 7); g.arc(11, -24, 1.9, 0, 7); g.fill();
    g.restore();
  }

  /* ----- particles and text ----- */
  let bits = [], shake = 0, squash = 0, graves = [], tileLayer = null, scene = null;
  let overview = 0, zoomK = 0, camP = SCREEN_W / 2, cw = 1, ch = 1, started = false;
  function burst(x, y, colors, n = 36, power = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = Math.random() * power + 1;
      bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 30 + Math.random() * 25, size: 2 + Math.random() * 4, color: colors[i % colors.length] });
    }
  }
  const QUIPS = {
    spike: ['Pointy.', 'That was there all along.', 'Ouch.'], fell: ['The floor had other plans.', 'Gravity works.', 'Trust issues.'],
    crushed: ['Lovely roof, though.', 'Flat.', 'Heads up, next time.'], saw: ['You could outrun that.', 'Sliced.', 'Should have left earlier.'],
    beam: ['Bad timing.', 'Zap.', 'It was blinking at you.'], mimic: ['Doors have teeth now.', 'Not that door.', 'It looked so friendly.'],
  };
  let quip = '';

  /* ----- playing ----- */
  let s = null, level = 0, deathsHere = 0, deadFor = 0, introFor = 0, finished = false;
  const playing = () => s && !cards.firstChild;
  function hud() {
    $('#hudLevel').textContent = `Level ${level + 1}/${R.LEVELS.length}`;
    $('#hudDeaths').textContent = save.deaths;
  }
  function loadLevel(i) {
    level = i;
    save.level = i;
    save.reached = Math.max(save.reached, i);
    persist();
    graves = []; bits = []; deathsHere = 0; introFor = 130;
    tileLayer = paintTiles(i); scene = makeScene(i);
    s = R.start(i);
    overview = 100; zoomK = 0; camP = s.x;   // a look at the whole level first
    deadFor = 0; quip = '';
    hud();
  }
  function restart(counted) {
    if (counted && !s.dead && !s.won && s.t > 20) noteDeath(s.x + PW / 2, s.y + PH, s.g < 0);
    s = R.start(level); deadFor = 0; quip = '';
  }
  function noteDeath(x, y, up) {
    save.deaths++; deathsHere++;
    persist(); hud();
    const gy = up ? Math.max(y - PH, 0) : Math.min(y, SCREEN_H - 2);
    graves.push({ x, y: gy, up });
    if (graves.length > 40) graves.shift();
  }
  function afterWin() {
    if (level + 1 < R.LEVELS.length) { loadLevel(level + 1); return; }
    finished = true;
    save.done++;
    save.best = save.best === null ? save.deaths : Math.min(save.best, save.deaths);
    save.reached = R.LEVELS.length - 1;
    persist();
    showFinish();
  }
  let winFor = 0;
  function tick() {
    if (introFor > 0) introFor--;
    if (overview > 0) overview--;
    zoomK += ((overview > 0 ? 0 : 1) - zoomK) * .07;
    if (s) camP += (s.x + PW / 2 - camP) * .12;
    squash *= .8;
    for (const b of bits) { b.x += b.vx; b.y += b.vy; b.vy += .22; b.life--; }
    bits = bits.filter((b) => b.life > 0);
    if (shake > 0) shake *= .84;
    if (!s) return;
    if (s.won) { if (--winFor <= 0) afterWin(); return; }
    if (s.dead) {
      if (--deadFor <= 0) restart(false);
      return;
    }
    const wasAir = !s.grounded;
    R.step(s, held);
    if (wasAir && s.grounded) squash = .5;
    for (const ev of s.ev) {
      SOUNDS[ev]?.();
      if (ev === 'hop') overview = 80;   // pull back to show where the door went
      if (ev === 'hop') burst(s.door.x * T + 20, s.door.y * T, ['#fde047', '#fff'], 18, 3);
      if (ev === 'thud' && !reduced()) shake = 5;
    }
    if (s.dead) {
      noteDeath(s.x + PW / 2, s.g > 0 ? s.y + PH : s.y, s.g < 0);
      burst(s.x + PW / 2, Math.min(SCREEN_H - 8, Math.max(8, s.y + PH / 2)), ['#2dd4bf', '#99f6e4', '#f97316', '#fff']);
      if (!reduced()) shake = 10;
      const pool = QUIPS[s.dead] ?? QUIPS.spike;
      quip = deathsHere >= 12 ? `Attempt ${deathsHere + 1}. You've got this. Probably.` : pool[deathsHere % pool.length];
      deadFor = RESPAWN_FRAMES;
    } else if (s.won) {
      burst(s.x + PW / 2, s.y + PH / 2, ['#fde047', '#fbbf24', '#fff'], 40, 5);
      winFor = 45;
    }
  }

  /* ----- drawing ----- */
  function draw(time) {
    if (!s) return;
    const L = R.parse(level);
    // the whole world fits a landscape screen; on a tall one the camera moves in and follows, with the sky above and the ground below
    const groundRoom = cw < ch ? Math.min(150, ch * .22) : 0;
    const fit = Math.min(cw / SCREEN_W, (ch - groundRoom) / SCREEN_H);
    const close = cw < ch ? Math.max(fit, Math.min((ch - groundRoom) / SCREEN_H, cw / (15 * T))) : fit;
    const zoom = fit + (close - fit) * zoomK;
    const viewW = cw / zoom;
    const camX = viewW >= SCREEN_W ? SCREEN_W / 2 : Math.max(viewW / 2, Math.min(SCREEN_W - viewW / 2, camP));
    const x0 = cw / 2 - camX * zoom, y0 = ch - groundRoom - SCREEN_H * zoom;
    const dpr = canvas.width / cw;
    const screenView = () => g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const layer = (depth) => g.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (cw / 2 - (SCREEN_W / 2 + (camX - SCREEN_W / 2) * depth) * zoom), dpr * y0);
    screenView();
    const sky = drawSky(time, cw, ch, y0 + SCREEN_H * zoom * .88);
    layer(.25); g.fillStyle = sky.far; g.fill(scene.far);
    layer(.55); g.fillStyle = sky.near; g.fill(scene.near);
    if (scene.lights.length && sky.stars > .15) {
      g.fillStyle = `rgba(253, 224, 120, ${Math.min(.9, sky.stars)})`;
      for (const [lx, ly] of scene.lights) g.fillRect(lx, ly, 5, 6);
    }
    const sx = shake > .3 ? (Math.random() - .5) * shake : 0, sy = shake > .3 ? (Math.random() - .5) * shake : 0;
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (x0 + sx), dpr * (y0 + sy));
    g.drawImage(tileLayer, 0, 0, SCREEN_W, SCREEN_H);

    // tiles that can change during an attempt
    L.grid.forEach((row, y) => row.forEach((ch, x) => {
      const k = R.key(x, y);
      if (ch === 'c' && !s.gone[k]) {
        const since = s.stood[k] ? s.t - s.stood[k] : 0;
        g.save();
        if (since) g.translate((Math.random() - .5) * 3, since * .25);
        paintTile(g, x, y, L.hue, { up: true, down: true });
        g.restore();
      } else if (ch === 'i' && s.shown[k]) paintTile(g, x, y, L.hue, { up: true, down: true });
      else if (ch === 'o') spring(x, y, 0);
    }));
    for (const k in s.extra) { const [x, y] = k.split(',').map(Number); paintTile(g, x, y, L.hue, { up: true, down: true }); }
    for (const f of s.falls) if (!f.settled) for (let i = 0; i < f.w; i++) paintTile(g, f.x + i, f.y / T, L.hue, { up: false, down: true });

    for (const [text, row, col] of (L.signs || []).map(([r, c, t]) => [t, r, c])) {
      g.font = '700 19px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      const w = g.measureText(text).width, x = col * T, y = row * T;
      g.fillStyle = 'rgba(15, 10, 32, .55)'; g.beginPath(); g.roundRect(x - 10, y - 16, w + 20, 32, 8); g.fill();
      g.fillStyle = '#fef3c7'; g.fillText(text, x, y);
    }
    for (const [x, y, ch] of L.spikes) ch === '^' ? crystal(x * T, (y + 1) * T, 28) : crystal(x * T, y * T, 28, true);
    for (const [x, y] of L.pops) {
      const k = R.key(x, y);
      if (s.pop[k] !== undefined) crystal(x * T, (y + 1) * T, 30 * R.popRise(s, k));
    }
    for (const [x, y] of L.mimics) archDoor(x, y, false, time, s.dead === 'mimic');
    archDoor(s.door.x, s.door.y, L.doorDown, time, false);

    (L.pulses || []).forEach((p) => {
      const on = R.pulseOn(p, s.t), soon = !on && R.pulseOn(p, s.t + 24), bx = p.x * T, bw = p.w * T;
      g.fillStyle = '#334155'; g.fillRect(bx - 5, 0, bw + 10, 8);
      if (on) {
        g.fillStyle = 'rgba(244, 63, 94, .3)'; g.fillRect(bx - 7, 8, bw + 14, 11 * T - 8);
        g.fillStyle = '#fecdd3'; g.fillRect(bx, 8, bw, 11 * T - 8);
      } else if (soon) {
        g.fillStyle = 'rgba(244, 63, 94, .45)'; g.fillRect(bx + bw / 2 - 1, 8, 2, 11 * T - 8);
      }
    });
    s.saws.forEach((m, i) => { if (m.on) saw(m.x, m.y, L.saws[i].r * T, time / 40); });
    for (const d of graves) grave(d.x, d.y, d.up);
    if (!s.dead) hero(s, time);
    drawSurround(L);
    for (const b of bits) { g.fillStyle = b.color; g.globalAlpha = Math.min(1, b.life / 20); g.fillRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size); }
    g.globalAlpha = 1;

    screenView();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const big = Math.max(20, Math.min(34, cw * .06));
    if (introFor > 0 && started) {
      g.globalAlpha = Math.min(1, introFor / 30);
      g.font = `800 ${big}px system-ui, sans-serif`; g.fillStyle = 'rgba(15, 10, 32, .6)';
      const w = g.measureText(L.name).width;
      g.beginPath(); g.roundRect(cw / 2 - w / 2 - 18, 14, w + 36, big + 20, 12); g.fill();
      g.fillStyle = '#fff'; g.fillText(L.name, cw / 2, 24 + big / 2);
      g.globalAlpha = 1;
    }
    if (s.rev && !s.dead) {
      const y = big + 50;
      g.font = '800 15px system-ui, sans-serif'; g.fillStyle = 'rgba(15, 10, 32, .6)';
      const text = '← controls swapped →', w = g.measureText(text).width;
      g.beginPath(); g.roundRect(cw / 2 - w / 2 - 10, y - 13, w + 20, 26, 8); g.fill();
      g.fillStyle = '#fda4af'; g.fillText(text, cw / 2, y);
    }
    if (quip && s.dead) {
      const y = Math.max(big + 60, y0 - 10 + SCREEN_H * zoom * .3);
      g.font = `800 ${Math.max(18, big * .8)}px system-ui, sans-serif`; g.lineWidth = 6; g.strokeStyle = 'rgba(15, 10, 32, .8)'; g.lineJoin = 'round';
      g.strokeText(quip, cw / 2, y, cw - 20); g.fillStyle = '#fff'; g.fillText(quip, cw / 2, y, cw - 20);
    }
  }

  /* ----- screens ----- */
  function card(html) {
    cards.innerHTML = `<div class="card">${html}</div>`;
    held.left = held.right = held.jump = false;
    return cards.firstChild;
  }
  const closeCards = () => { cards.innerHTML = ''; };
  function showStart() {
    const going = save.reached > 0 || save.deaths > 0, touch = matchMedia('(pointer: coarse)').matches;
    const c = card(`<h1>Grave Mistake</h1>
      <p>Reach the door. The floor lies, the signs lie, and sometimes the door runs away. You will die a lot, and every grave marks something you've learned.</p>
      <p>${touch ? '<b>Move:</b> slide the joystick · <b>Jump:</b> tap anywhere else' : '<b>Move:</b> arrows or A D · <b>Jump:</b> space, up or click · <b>Retry:</b> R'}</p>
      ${touch ? stickChooser() : ''}
      <div class="btns"><button class="btn primary" id="go">${going ? 'Continue' : 'Play'}</button>${going ? '<button class="btn" id="levels">Levels</button>' : ''}</div>`);
    c.querySelector('#go').addEventListener('click', () => { wakeAudio(); closeCards(); started = true; loadLevel(Math.min(save.level, save.reached)); });
    c.querySelector('#levels')?.addEventListener('click', showLevels);
    c.querySelector('#go').focus();
  }
  function showLevels() {
    const buttons = R.LEVELS.map((L, i) => `<button data-i="${i}" title="${L.name}" class="${i < save.reached || save.done ? 'done' : ''}" ${i > save.reached ? 'disabled' : ''}>${i + 1}</button>`).join('');
    const c = card(`<h1>Levels</h1><p>${save.deaths} deaths so far${save.best !== null ? ` · best full run: ${save.best}` : ''}</p>
      <div class="grid">${buttons}</div>
      ${matchMedia('(pointer: coarse)').matches ? stickChooser() : ''}
      <div class="btns">${started ? '<button class="btn primary" id="back">Keep playing</button>' : ''}<button class="btn" id="wipe">Reset progress</button></div>`);
    c.querySelector('.grid').addEventListener('click', (e) => {
      const i = e.target.dataset?.i;
      if (i !== undefined && !e.target.disabled) { wakeAudio(); closeCards(); started = true; loadLevel(Number(i)); }
    });
    c.querySelector('#back')?.addEventListener('click', closeCards);
    const wipe = c.querySelector('#wipe');
    wipe.addEventListener('click', () => {
      if (wipe.dataset.sure) {
        save = { reached: 0, deaths: 0, level: 0, best: null, done: 0 };
        persist(); started = false; loadLevel(0); showStart();
      } else { wipe.dataset.sure = '1'; wipe.textContent = 'Tap again to erase'; }
    });
  }
  function showFinish() {
    const c = card(`<h1>You escaped!</h1><p>It only took <b>${save.deaths}</b> ${save.deaths === 1 ? 'death' : 'deaths'}.${save.best === save.deaths && save.done > 1 ? ' A new best!' : ''} Think you can do better?</p>
      <div class="btns"><button class="btn primary" id="again">Play again</button><a class="btn" href="../index.html" style="color:inherit;text-decoration:none">More games</a></div>`);
    c.querySelector('#again').addEventListener('click', () => { save.deaths = 0; finished = false; persist(); closeCards(); loadLevel(0); });
  }
  $('#btnLevels').addEventListener('click', () => { if (cards.firstChild && started) closeCards(); else showLevels(); });

  /* ----- sharp on every screen ----- */
  function fit() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return;
    cw = r.width; ch = r.height;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  new ResizeObserver(fit).observe(canvas);
  fit();

  /* ----- fixed-step loop, so that the game plays the same at any frame rate ----- */
  let last = 0, spare = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    spare = Math.min(spare + (now - last), 100);
    last = now;
    if (document.hidden || !playing()) spare = 0;
    while (spare >= STEP) { tick(); spare -= STEP; }
    draw(now);
  }
  loadLevel(Math.min(save.level, save.reached));
  showStart();
  hud();
  requestAnimationFrame((now) => { last = now; frame(now); });
})();
