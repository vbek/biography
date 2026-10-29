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
      debris.push({ x: mx, y, w: mover.w, h: bh, vx: (mx < top.x ? -1 : 1) * 60, vy: 0, rot: 0, vr: (mx < top.x ? -1 : 1) * 2.4, hue: mover.hue, i });
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
      debris.push({ x: cx, y, w: cw, h: bh, vx: (cutLeft ? -1 : 1) * (40 + cw), vy: 40, rot: 0, vr: (cutLeft ? -1 : 1) * (1.5 + Math.random() * 2), hue: mover.hue, i });
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
    $('#startCard').hidden = true; $('#overCard').hidden = true; $('#scoresCard').hidden = true; $('#lookCard').hidden = true;
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
    $('#startCard').hidden = true; $('#overCard').hidden = true; $('#lookCard').hidden = true;
    $('#scoresCard').hidden = false;
    $('#btnCloseScores').focus({ preventScroll: true });
  }
  function openLook() {
    renderLook();
    $('#startCard').hidden = true; $('#overCard').hidden = true; $('#scoresCard').hidden = true;
    $('#lookCard').hidden = false;
    $('#btnCloseLook').focus({ preventScroll: true });
  }
  function closeLook() {
    $('#lookCard').hidden = true;
    (state === 'over' ? $('#overCard') : $('#startCard')).hidden = false;
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

  /* ---------- looks: block (tile) styles and backgrounds ---------- */
  const TILES = {
    classic: { name: 'Classic', fill: (h) => `hsl(${h} 72% ${light() ? 56 : 58}%)`, hi: (h) => `hsl(${h} 85% 76% / .55)` },
    pastel: { name: 'Pastel', fill: (h) => `hsl(${h} 70% 80%)`, hi: () => 'rgba(255, 255, 255, .5)', shade: 0.07 },
    neon: { name: 'Neon', neon: true },
    mono: { name: 'Ice', fill: (h, i) => `hsl(195 75% ${38 + (i % 6) * 6}%)`, hi: () => 'rgba(255, 255, 255, .28)' },
    wood: { name: 'Wood', fill: (h, i) => `hsl(${26 + (i % 3) * 4} 52% ${36 + (i % 2) * 7}%)`, hi: () => 'rgba(255, 230, 190, .22)', grain: true },
    brick: { name: 'Brick', fill: (h, i) => `hsl(${6 + (i % 3) * 3} 58% ${42 + (i % 2) * 4}%)`, hi: () => 'rgba(255, 200, 180, .2)', brick: true },
    glass: { name: 'Glass', glass: true },
  };
  const BGS = {
    auto: { name: 'Shifting' },
    sunset: { name: 'Sunset', stops: ['#1f1147', '#a8336b', '#f7a072'], dots: 'rgba(255, 255, 255, .12)', deco: 'sun' },
    ocean: { name: 'Ocean', stops: ['#04152d', '#0a3d62', '#0b6e8a'], dots: 'rgba(160, 230, 255, .3)', deco: 'bubbles' },
    forest: { name: 'Forest', stops: ['#0d2214', '#1f4425', '#3f6b35'], dots: 'rgba(220, 255, 170, .16)', deco: 'hills' },
    night: { name: 'Night sky', stops: ['#02030a', '#0b1030', '#1b2450'], dots: '#fff', deco: 'stars' },
    candy: { name: 'Candy', stops: ['#ffd6f5', '#e8d4ff', '#bde4ff'], dots: 'rgba(255, 255, 255, .7)' },
    plain: { name: 'Plain', plain: true },
    photo: { name: 'Your photo', photo: true },
  };
  let look = { bg: 'auto', tile: 'classic', fit: 'auto', dim: 25 };
  try { look = { ...look, ...JSON.parse(localStorage.getItem(KEY + '.look') || '{}') }; } catch {}
  if (!TILES[look.tile]) look.tile = 'classic';
  if (!BGS[look.bg]) look.bg = 'auto';

  /* ---------- your photo as the background ---------- */
  let photo = null, photoThumb = '', photoCache = null, photoKey = '';
  const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  function thumbOf(img) {
    const c = document.createElement('canvas'), s = 140 / Math.max(img.naturalWidth, img.naturalHeight);
    c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }
  async function restorePhoto() {
    let data = null;
    try { data = localStorage.getItem(KEY + '.photo'); } catch {}
    if (!data) { if (look.bg === 'photo') look.bg = 'auto'; return; }
    try { photo = await loadImg(data); photoThumb = thumbOf(photo); photoKey = ''; } catch { photo = null; }
    if (!photo && look.bg === 'photo') look.bg = 'auto';
  }
  // Shrink the upload so it fits in browser storage, then keep it for next time.
  async function usePhoto(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadImg(url); } catch { URL.revokeObjectURL(url); photoNote('That image could not be opened.'); return; }
    URL.revokeObjectURL(url);
    let saved = false, data = '';
    for (const [max, q] of [[1920, 0.85], [1440, 0.78], [1024, 0.7]]) {
      const c = document.createElement('canvas'), s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      data = c.toDataURL('image/jpeg', q);
      try { localStorage.setItem(KEY + '.photo', data); saved = true; break; } catch {}
    }
    photo = await loadImg(data);
    photoThumb = thumbOf(photo);
    photoKey = '';
    setLook('bg', 'photo');
    photoNote(saved ? '' : 'Your browser’s storage is full, so this photo will only last until you close the page.');
  }
  function removePhoto() {
    try { localStorage.removeItem(KEY + '.photo'); } catch {}
    photo = null; photoThumb = ''; photoCache = null;
    setLook('bg', 'auto');
  }
  function photoNote(msg) { const el = $('#photoNote'); el.textContent = msg; el.hidden = !msg; }

  // Render the photo once per size/setting into an offscreen canvas; frames just copy it.
  function photoLayer() {
    const key = [W, H, dpr, look.fit, look.dim, photo.src.length].join();
    if (photoCache && key === photoKey) return photoCache;
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const x = c.getContext('2d'), iw = photo.naturalWidth, ih = photo.naturalHeight;
    x.scale(dpr, dpr);
    x.imageSmoothingQuality = 'high';
    const mismatch = Math.max((iw / ih) / (W / H), (W / H) / (iw / ih));
    const mode = look.fit === 'auto' ? (mismatch > 1.6 ? 'contain' : 'cover') : look.fit;
    const cover = Math.max(W / iw, H / ih);
    if (mode === 'cover') {
      x.drawImage(photo, (W - iw * cover) / 2, (H - ih * cover) / 2, iw * cover, ih * cover);
    } else {
      // too different in shape to crop: show the whole photo over a blurred, enlarged copy of itself
      const t = document.createElement('canvas'), tw = 40, th = Math.max(1, Math.round(40 * H / W)), tc = t.getContext('2d');
      t.width = tw; t.height = th;
      const k = Math.max(tw / iw, th / ih);
      tc.drawImage(photo, (tw - iw * k) / 2, (th - ih * k) / 2, iw * k, ih * k);
      x.drawImage(t, 0, 0, W, H);
      x.fillStyle = 'rgba(0, 0, 0, .25)';
      x.fillRect(0, 0, W, H);
      const fit = Math.min(W / iw, H / ih);
      x.save();
      x.shadowColor = 'rgba(0, 0, 0, .45)'; x.shadowBlur = 30;
      x.drawImage(photo, (W - iw * fit) / 2, (H - ih * fit) / 2, iw * fit, ih * fit);
      x.restore();
    }
    x.fillStyle = `rgba(0, 0, 0, ${look.dim / 100})`; // dim so the blocks stand out
    x.fillRect(0, 0, W, H);
    photoCache = c; photoKey = key;
    return c;
  }

  function block(x, y, w, h, hue, alpha = 1, i = 0) {
    const X = sx(x), Y = sy(y + h), Wd = w * zoom, Hd = h * zoom, r = Math.min(5, Hd / 4, Wd / 2), t = TILES[look.tile];
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.roundRect(X, Y, Wd, Hd, r);
    if (t.neon) {
      ctx.fillStyle = `hsl(${hue} 90% 12% / .85)`;
      ctx.fill();
      ctx.save();
      ctx.shadowColor = `hsl(${hue} 100% 60%)`; ctx.shadowBlur = 12 * zoom;
      ctx.strokeStyle = `hsl(${hue} 100% 65%)`; ctx.lineWidth = Math.max(1.5, 2 * zoom);
      ctx.stroke();
      ctx.restore();
    } else if (t.glass) {
      ctx.fillStyle = `hsl(${hue} 80% 80% / .22)`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, .55)'; ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, .3)';
      ctx.beginPath(); ctx.roundRect(X + 3, Y + 2, Math.max(0, Wd - 6), Math.max(1.5, Hd * 0.18), r); ctx.fill();
    } else {
      ctx.fillStyle = t.fill(hue, i);
      ctx.fill();
      if (t.grain || t.brick) { // wood grain or brick joints, clipped to the block
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(0, 0, 0, .22)';
        ctx.beginPath();
        if (t.grain) {
          ctx.lineWidth = 1;
          for (let k = 1; k < 4; k++) {
            const gy = Y + Hd * k / 4 + Math.sin(i * 3 + k) * 2;
            ctx.moveTo(X, gy);
            ctx.bezierCurveTo(X + Wd * 0.3, gy - 3, X + Wd * 0.6, gy + 3, X + Wd, gy);
          }
        } else {
          const bw = 44 * zoom, x0 = sx(0) + (i % 2) * bw / 2; // joints line up across rows like real brickwork
          ctx.lineWidth = 1.5;
          for (let bx = x0 + Math.ceil((X - x0) / bw) * bw; bx < X + Wd; bx += bw) { ctx.moveTo(bx, Y); ctx.lineTo(bx, Y + Hd); }
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = t.hi(hue, i); // top highlight
      ctx.beginPath(); ctx.roundRect(X, Y, Wd, Math.max(2, Hd * 0.24), [r, r, 0, 0]); ctx.fill();
      ctx.fillStyle = `rgba(0, 0, 0, ${t.shade ?? 0.14})`; // bottom shade
      ctx.fillRect(X, Y + Hd * 0.78, Wd, Hd * 0.22);
    }
    ctx.globalAlpha = 1;
  }

  function background() {
    const b = BGS[look.bg], g = ctx.createLinearGradient(0, 0, 0, H);
    if (b.photo && photo) { ctx.drawImage(photoLayer(), 0, 0, W, H); return; }
    let dots;
    if (b.stops) {
      b.stops.forEach((c, k) => g.addColorStop(k / (b.stops.length - 1), c));
      dots = b.dots;
    } else if (b.plain) {
      const c = light() ? '#eef2fa' : '#070b14';
      g.addColorStop(0, c); g.addColorStop(1, c);
      dots = light() ? 'rgba(15, 23, 42, .06)' : 'rgba(255, 255, 255, .06)';
    } else { // colours shift as the tower grows
      const h1 = hueOf(stack.length), h2 = (h1 + 40) % 360;
      if (light()) { g.addColorStop(0, `hsl(${h2} 60% 94%)`); g.addColorStop(1, `hsl(${h1} 55% 86%)`); }
      else { g.addColorStop(0, `hsl(${h2} 45% 9%)`); g.addColorStop(1, `hsl(${h1} 40% 17%)`); }
      dots = light() ? 'rgba(15, 23, 42, .07)' : 'rgba(255, 255, 255, .08)';
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (b.deco === 'sun') {
      const cx = W * 0.72, cy = H * 0.72 + cam * 0.15, sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 120);
      sg.addColorStop(0, 'rgba(255, 214, 140, .85)'); sg.addColorStop(0.5, 'rgba(255, 170, 110, .35)'); sg.addColorStop(1, 'rgba(255, 150, 100, 0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    } else if (b.deco === 'hills') { // two layers that sink as the camera climbs
      for (const [k, col] of [[0.25, 'rgba(10, 30, 15, .55)'], [0.45, 'rgba(6, 20, 10, .75)']]) {
        const base = H * (0.78 + k * 0.2) + cam * k;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, base - 40 * Math.sin(x / (120 + k * 200) + k * 5) - 25);
        ctx.lineTo(W, H); ctx.fill();
      }
    }
    // drifting dots give a sense of height; stars twinkle and bubbles rise
    ctx.fillStyle = dots; ctx.strokeStyle = dots; ctx.lineWidth = 1;
    for (let k = 0; k < 40; k++) {
      const bub = b.deco === 'bubbles', rise = bub ? clock * (14 + (k % 4) * 6) : 0;
      const px = ((k * 97.3 + (bub ? Math.sin(clock + k) * 6 : 0)) % W + W) % W;
      const py = (((k * 151.7 + cam * (0.2 + (k % 3) * 0.15) - rise) % (H + 20)) + H + 20) % (H + 20) - 10;
      if (b.deco === 'stars') ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(clock * (0.8 + (k % 5) * 0.3) + k));
      ctx.beginPath(); ctx.arc(px, py, (bub ? 2 : 1) + (k % 3) * 0.6, 0, 7);
      if (bub) ctx.stroke(); else ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // swatches in the Customize card
  function renderLook() {
    const pick = (obj, cur, kind) => Object.entries(obj).map(([k, v]) => k === 'photo'
      ? `<button class="swatch" data-${kind}="${k}" aria-pressed="${k === cur}" title="${photo ? 'Use your photo' : 'Upload a photo from your phone or computer'}">` +
        (photoThumb ? `<i class="sw" style="background:url(${photoThumb}) center/cover"></i>` : '<i class="sw sw-bg-photo">+</i>') +
        `<span>${photo ? v.name : 'Upload photo'}</span></button>`
      : `<button class="swatch" data-${kind}="${k}" aria-pressed="${k === cur}"><i class="sw sw-${kind}-${k}"></i><span>${v.name}</span></button>`).join('');
    $('#bgPicks').innerHTML = pick(BGS, look.bg, 'bg');
    $('#tilePicks').innerHTML = pick(TILES, look.tile, 'tile');
    $('#photoOpts').hidden = look.bg !== 'photo' || !photo;
    $('#photoFit').value = look.fit;
    $('#photoDim').value = look.dim;
    $('#photoDimV').textContent = look.dim + '%';
  }
  function setLook(part, val) {
    look[part] = val;
    try { localStorage.setItem(KEY + '.look', JSON.stringify(look)); } catch {}
    renderLook();
  }

  let last = performance.now(), clock = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    clock = now / 1000;
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
      block(b.x, y, b.w, bh, b.hue, 1, i);
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
      block(mover.cx - mover.w / 2, y, mover.w, bh, mover.hue, 1, stack.length);
    }
    for (const d of debris) {
      ctx.save();
      ctx.translate(sx(d.x + d.w / 2), sy(d.y + d.h / 2));
      ctx.rotate(d.rot);
      ctx.translate(-sx(d.x + d.w / 2), -sy(d.y + d.h / 2));
      block(d.x, d.y, d.w, d.h, d.hue, 0.9, d.i);
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
    if (!$('#scoresCard').hidden || !$('#lookCard').hidden) return;
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
    else if (k === 'Escape' && !$('#lookCard').hidden) closeLook();
  });
  $('#btnPlay').onclick = start;
  $('#btnAgain').onclick = start;
  $('#btnScores').onclick = () => { if (state !== 'play') openScores(); };
  $('#btnScores2').onclick = openScores;
  $('#btnCloseScores').onclick = closeScores;
  $('#btnLook').onclick = () => { if (state !== 'play') openLook(); };
  $('#btnLook2').onclick = openLook;
  $('#btnCloseLook').onclick = closeLook;
  $('#btnLookDone').onclick = closeLook;
  $('#photoFile').onchange = (e) => { usePhoto(e.target.files[0]); e.target.value = ''; };
  $('#btnPhotoChange').onclick = () => $('#photoFile').click();
  $('#btnPhotoRemove').onclick = removePhoto;
  $('#photoFit').onchange = () => setLook('fit', $('#photoFit').value);
  $('#photoDim').oninput = () => setLook('dim', +$('#photoDim').value);
  $('#lookCard').addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (b?.dataset.bg === 'photo' && !photo) $('#photoFile').click();
    else if (b?.dataset.bg) setLook('bg', b.dataset.bg);
    else if (b?.dataset.tile) setLook('tile', b.dataset.tile);
  });
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
  restorePhoto();
  hud();
  requestAnimationFrame(frame);
})();
