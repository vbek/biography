/* Stack Tower — a one-button stacking game on a 2D canvas. No dependencies; scores live in localStorage. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const canvas = $('#game'), ctx = canvas.getContext('2d'), stage = $('#stage');
  const KEY = 'stackTower.v1';

  /* ---------- records ---------- */
  const blank = () => ({ best: 0, games: 0, blocks: 0, perfects: 0, bestCombo: 0, history: [] });
  function loadRec() {
    try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return blank(); }
  }
  function saveRec() {
    try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch {}
  }
  let rec = loadRec();

  /* ---------- sound (synthesised, starts on first input) ---------- */
  let ac = null, soundOn = true;
  try { soundOn = localStorage.getItem(KEY + '.sound') !== 'off'; } catch {}
  function tone(freq, dur, { type = 'sine', vol = 0.15, slide = 0, delay = 0 } = {}) {
    if (!soundOn) return;
    try {
      ac ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch {}
  }
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
  const note = (i) => 392 * 2 ** (SCALE[Math.min(i, SCALE.length - 1)] / 12);
  const buzz = (p) => { try { navigator.vibrate?.(p); } catch {} };

  /* ---------- layout ---------- */
  let W = 0, H = 0, dpr = 1, bh = 30, baseW = 300, WW = 0;
  function resize() {
    const r = stage.getBoundingClientRect();
    W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (state !== 'play') layout();
  }
  function layout() {
    WW = W;
    bh = Math.max(22, Math.min(40, H / 18));
    baseW = Math.min(W * 0.62, 340);
  }

  /* ---------- game state ---------- */
  let state = 'ready', stack = [], mover = null, debris = [], sparks = [], rings = [];
  let combo = 0, runPerfects = 0, runBestCombo = 0, hue0 = 0, side = 1;
  let cam = 0, camT = 0, zoom = 1, zoomT = 1, shake = 0, overAt = 0, flash = 0;

  const hueOf = (i) => (hue0 + i * 7) % 360;
  const score = () => stack.length - 1;

  function reset() {
    layout();
    hue0 = Math.random() * 360;
    stack = [{ x: WW / 2 - baseW / 2, w: baseW, hue: hueOf(0) }];
    debris = []; sparks = []; rings = [];
    combo = 0; runPerfects = 0; runBestCombo = 0; side = Math.random() < 0.5 ? 1 : -1;
    cam = camT = 0; zoom = zoomT = 1; shake = 0;
    spawn();
    hud();
  }

  function spawn() {
    const top = stack[stack.length - 1], i = stack.length;
    const range = Math.max(baseW * 0.9, top.w * 1.1) + 24; // far enough to clear the tower completely
    side = -side;
    mover = {
      w: top.w, cx: WW / 2 + side * range, dir: -side, range,
      speed: Math.min(560, 170 + i * 7.5) * (baseW / 340),
      hue: hueOf(i),
    };
  }

  function drop() {
    if (state !== 'play' || !mover) return;
    const top = stack[stack.length - 1], i = stack.length;
    const mx = mover.cx - mover.w / 2;
    const L = Math.max(mx, top.x), R = Math.min(mx + mover.w, top.x + top.w), ov = R - L;
    const y = i * bh;
    if (ov <= 0) { // missed completely
      debris.push({ x: mx, y, w: mover.w, h: bh, vx: (mx < top.x ? -1 : 1) * 60, vy: 0, rot: 0, vr: (mx < top.x ? -1 : 1) * 2.4, hue: mover.hue });
      mover = null;
      gameOver();
      return;
    }
    const tol = Math.max(3, bh * 0.14);
    if (Math.abs(mx - top.x) <= tol) { // perfect
      combo++; runPerfects++; runBestCombo = Math.max(runBestCombo, combo);
      let x = top.x, w = top.w;
      if (combo >= 3 && w < baseW) { const g = Math.min(bh * 0.6, baseW - w); x -= g / 2; w += g; }
      stack.push({ x, w, hue: mover.hue });
      rings.push({ x, y, w, t: 0 });
      for (let k = 0; k < 14; k++) sparks.push({ x: x + Math.random() * w, y: y + bh, vx: (Math.random() - 0.5) * 220, vy: 120 + Math.random() * 220, t: 0, life: 0.6 + Math.random() * 0.4, hue: mover.hue });
      tone(note(combo - 1), 0.35, { type: 'triangle', vol: 0.18 });
      if (combo >= 3) tone(note(combo + 1), 0.3, { type: 'sine', vol: 0.1, delay: 0.06 });
      buzz(12);
      showCombo(combo === 1 ? 'Perfect!' : `Perfect ×${combo}${combo >= 3 ? ' · growing' : ''}`);
    } else { // slice off the overhang
      combo = 0;
      stack.push({ x: L, w: ov, hue: mover.hue });
      const cutLeft = mx < top.x, cx = cutLeft ? mx : R, cw = mover.w - ov;
      debris.push({ x: cx, y, w: cw, h: bh, vx: (cutLeft ? -1 : 1) * (40 + cw), vy: 40, rot: 0, vr: (cutLeft ? -1 : 1) * (1.5 + Math.random() * 2), hue: mover.hue });
      tone(150 + Math.min(300, ov), 0.12, { type: 'square', vol: 0.06, slide: -60 });
      buzz(8);
    }
    camT = Math.max(0, (stack.length + 1) * bh - H * 0.5);
    spawn();
    hud();
  }

  function start() {
    reset();
    state = 'play';
    $('#startCard').hidden = true; $('#overCard').hidden = true; $('#scoresCard').hidden = true;
    tone(523, 0.12, { type: 'triangle', vol: 0.12 });
    tone(784, 0.18, { type: 'triangle', vol: 0.12, delay: 0.08 });
    canvas.focus({ preventScroll: true });
  }

  function gameOver() {
    state = 'over';
    overAt = performance.now();
    shake = 14; flash = 1;
    tone(220, 0.6, { type: 'sawtooth', vol: 0.1, slide: -170 });
    buzz([30, 40, 60]);
    // pull the camera back so the whole tower is in view
    const towerH = (stack.length + 1) * bh;
    zoomT = Math.min(1, (H * 0.62) / towerH);
    camT = 0;

    const s = score(), prevBest = rec.best, isBest = s > prevBest && s > 0;
    rec.games++; rec.blocks += s; rec.perfects += runPerfects;
    rec.bestCombo = Math.max(rec.bestCombo, runBestCombo);
    rec.best = Math.max(rec.best, s);
    rec.history.unshift({ s, p: runPerfects, c: runBestCombo, t: Date.now(), b: isBest });
    rec.history = rec.history.slice(0, 20);
    saveRec();

    setTimeout(() => {
      $('#finalScore').textContent = s;
      $('#newBest').hidden = !isBest;
      $('#overStats').innerHTML = stat(isBest ? prevBest : rec.best, isBest ? 'Old best' : 'Best') + stat(runPerfects, 'Perfect') + stat(runBestCombo, 'Top combo');
      $('#overCard').hidden = false;
      if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); // a held Space mustn't hit "Play again"
      if (isBest) { celebrate(); [0, 4, 7, 12].forEach((n, k) => tone(523 * 2 ** (n / 12), 0.25, { type: 'triangle', vol: 0.12, delay: k * 0.09 })); }
      hud();
    }, 750);
  }

  function celebrate() {
    for (let k = 0; k < 90; k++) {
      sparks.push({ screen: true, x: W / 2 + (Math.random() - 0.5) * 80, y: H * 0.35, vx: (Math.random() - 0.5) * 700, vy: -(200 + Math.random() * 500), t: 0, life: 1.4 + Math.random(), hue: Math.random() * 360 });
    }
  }

  function showCombo(text) {
    const el = $('#combo');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /* ---------- UI ---------- */
  const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  const avg = () => rec.games ? (rec.blocks / rec.games).toFixed(1) : '0';
  function hud() {
    $('#hudScore').textContent = state === 'ready' ? '0' : score();
    $('#hudBest').textContent = rec.best;
    $('#startStats').innerHTML = rec.games ? stat(rec.best, 'Best') + stat(rec.games, 'Games') + stat(avg(), 'Average') : '';
  }
  function fmtDate(t) {
    const d = new Date(t), now = new Date();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'Today ' + time;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
  }
  function openScores() {
    $('#statGrid').innerHTML = [
      [rec.best, 'Best score'], [rec.games, 'Games played'], [avg(), 'Average'], [rec.bestCombo, 'Best perfect combo'],
      [rec.perfects, 'Perfect drops'], [rec.blocks, 'Blocks stacked'],
    ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    const max = Math.max(1, ...rec.history.map((h) => h.s));
    $('#history').innerHTML = rec.history.length ? rec.history.slice(0, 10).map((h) =>
      `<li><span class="s">${h.s}</span><span class="bar-mini"><i style="width:${h.s / max * 100}%"></i></span>${h.b ? '<span class="tag">BEST</span>' : ''}<span class="d">${fmtDate(h.t)}</span></li>`).join('')
      : '<li class="empty">No games yet — go stack something!</li>';
    $('#startCard').hidden = true; $('#overCard').hidden = true;
    $('#scoresCard').hidden = false;
    $('#btnCloseScores').focus({ preventScroll: true });
  }
  function closeScores() {
    $('#scoresCard').hidden = true;
    (state === 'over' ? $('#overCard') : $('#startCard')).hidden = false;
    hud();
  }
  function setSound(on) {
    soundOn = on;
    $('#btnSound').setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(KEY + '.sound', on ? 'on' : 'off'); } catch {}
  }

  /* ---------- drawing ---------- */
  const light = () => document.documentElement.getAttribute('data-theme') === 'light';
  const sx = (x) => W / 2 + (x - WW / 2) * zoom;
  const sy = (y) => H * 0.86 - (y - cam) * zoom; // world y grows upwards from the base

  function block(x, y, w, h, hue, alpha = 1) {
    const X = sx(x), Y = sy(y + h), Wd = w * zoom, Hd = h * zoom, r = Math.min(5, Hd / 4, Wd / 2);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `hsl(${hue} 72% ${light() ? 56 : 58}%)`;
    ctx.beginPath(); ctx.roundRect(X, Y, Wd, Hd, r); ctx.fill();
    ctx.fillStyle = `hsl(${hue} 85% 76% / .55)`; // top highlight
    ctx.beginPath(); ctx.roundRect(X, Y, Wd, Math.max(2, Hd * 0.24), [r, r, 0, 0]); ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, .14)'; // bottom shade
    ctx.fillRect(X, Y + Hd * 0.78, Wd, Hd * 0.22);
    ctx.globalAlpha = 1;
  }

  function background() {
    const top = stack.length, h1 = hueOf(top), h2 = (h1 + 40) % 360;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (light()) { g.addColorStop(0, `hsl(${h2} 60% 94%)`); g.addColorStop(1, `hsl(${h1} 55% 86%)`); }
    else { g.addColorStop(0, `hsl(${h2} 45% 9%)`); g.addColorStop(1, `hsl(${h1} 40% 17%)`); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // drifting dots give a sense of height
    ctx.fillStyle = light() ? 'rgba(15, 23, 42, .07)' : 'rgba(255, 255, 255, .08)';
    for (let k = 0; k < 40; k++) {
      const px = (k * 97.3) % W, py = ((k * 151.7 + cam * (0.2 + (k % 3) * 0.15)) % (H + 20)) - 10;
      ctx.beginPath(); ctx.arc(px, py, 1 + (k % 3) * 0.6, 0, 7); ctx.fill();
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // update
    if (mover) {
      mover.cx += mover.dir * mover.speed * dt;
      const lo = WW / 2 - mover.range, hi = WW / 2 + mover.range;
      if (mover.cx < lo) { mover.cx = lo; mover.dir = 1; }
      if (mover.cx > hi) { mover.cx = hi; mover.dir = -1; }
    }
    cam += (camT - cam) * Math.min(1, dt * 6);
    zoom += (zoomT - zoom) * Math.min(1, dt * 3);
    shake = Math.max(0, shake - dt * 40);
    flash = Math.max(0, flash - dt * 3);
    for (const d of debris) { d.vy -= 1500 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt; }
    debris = debris.filter((d) => sy(d.y) < H + 300);
    for (const s of sparks) { s.t += dt; s.x += s.vx * dt; s.vy += (s.screen ? 900 : -900) * dt; s.y += s.vy * dt; }
    sparks = sparks.filter((s) => s.t < s.life);
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < 0.5);

    // draw
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    background();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    // ground shadow under the base
    ctx.fillStyle = 'rgba(0, 0, 0, .18)';
    ctx.beginPath(); ctx.ellipse(sx(WW / 2), sy(0) + 6, baseW * zoom * 0.62, 8 * zoom, 0, 0, 7); ctx.fill();
    for (let i = 0; i < stack.length; i++) {
      const b = stack[i], y = i * bh;
      if (sy(y + bh) > H + 10 || sy(y) < -bh * 2) continue;
      block(b.x, y, b.w, bh, b.hue);
    }
    for (const r of rings) {
      const k = r.t / 0.5, pad = 4 + k * 18;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - k)})`;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.roundRect(sx(r.x) - pad, sy(r.y + bh) - pad, r.w * zoom + pad * 2, bh * zoom + pad * 2, 8); ctx.stroke();
    }
    if (mover) {
      const y = stack.length * bh;
      // faint guide showing where the tower top is
      const top = stack[stack.length - 1];
      ctx.fillStyle = light() ? 'rgba(15, 23, 42, .06)' : 'rgba(255, 255, 255, .05)';
      ctx.fillRect(sx(top.x), sy(y + bh), top.w * zoom, bh * zoom);
      block(mover.cx - mover.w / 2, y, mover.w, bh, mover.hue);
    }
    for (const d of debris) {
      ctx.save();
      ctx.translate(sx(d.x + d.w / 2), sy(d.y + d.h / 2));
      ctx.rotate(d.rot);
      ctx.translate(-sx(d.x + d.w / 2), -sy(d.y + d.h / 2));
      block(d.x, d.y, d.w, d.h, d.hue, 0.9);
      ctx.restore();
    }
    for (const s of sparks) {
      const a = 1 - s.t / s.life, X = s.screen ? s.x : sx(s.x), Y = s.screen ? s.y : sy(s.y);
      ctx.fillStyle = `hsl(${s.hue} 90% 70% / ${a})`;
      if (s.screen) { ctx.save(); ctx.translate(X, Y); ctx.rotate(s.t * 8); ctx.fillRect(-4, -2, 8, 4); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(X, Y, 2.5 * a + 0.5, 0, 7); ctx.fill(); }
    }
    if (flash) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = `rgba(248, 113, 113, ${flash * 0.25})`; ctx.fillRect(0, 0, W, H); }
    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function primary() {
    if (!$('#scoresCard').hidden) return;
    if (state === 'play') drop();
    else if (state === 'ready') start();
    else if (state === 'over' && performance.now() - overAt > 900) start();
  }
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) { e.preventDefault(); primary(); } });
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key;
    if (k === ' ' || k === 'Enter' || k === 'ArrowDown') {
      if (e.target.closest?.('button') && k === 'Enter') return; // let focused buttons handle Enter
      e.preventDefault();
      primary();
    } else if (k === 'm' || k === 'M') setSound(!soundOn);
    else if (k === 'Escape' && !$('#scoresCard').hidden) closeScores();
  });
  $('#btnPlay').onclick = start;
  $('#btnAgain').onclick = start;
  $('#btnScores').onclick = () => { if (state !== 'play') openScores(); };
  $('#btnScores2').onclick = openScores;
  $('#btnCloseScores').onclick = closeScores;
  $('#btnSound').onclick = () => setSound(!soundOn);
  $('#btnReset').onclick = () => {
    if (!confirm('Reset all your Stack Tower scores on this device?')) return;
    rec = blank();
    saveRec();
    openScores();
    hud();
  };
  // buttons shouldn't also count as a drop via the space key
  for (const b of document.querySelectorAll('button')) b.addEventListener('keydown', (e) => { if (e.key === ' ') e.stopPropagation(); });

  new ResizeObserver(resize).observe(stage);
  resize();
  reset();
  setSound(soundOn);
  hud();
  requestAnimationFrame(frame);
})();
