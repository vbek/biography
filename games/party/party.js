/* Shared board-game table: menus, rooms, networking, dice, sound and effects.
   One device is always the authority. It runs the game's rules and sends the resulting state and
   events to everyone else, and same-board play runs through exactly the same path with no network.
   Rooms use the local host server when the page came from it (join by IP), and otherwise WebRTC
   through PeerJS (join by room code), which is the only option on a static site. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed()));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const newCode = () => Array.from({ length: 5 }, () => pick(CODE_CHARS.split(''))).join('');
  const HEARTBEAT_MS = 4000, SILENCE_MS = 14000, AUTOPLAY_AFTER_MS = 15000, GIVE_UP_MS = 180000;

  let backlog = 0;
  const speed = () => (reduced() ? 2.5 : 1) * (backlog > 1 ? 2 : 1);

  /* ---------- animation helpers ---------- */
  const ease = {
    inOut: (k) => (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
    out: (k) => 1 - Math.pow(1 - k, 3),
    in: (k) => k * k * k,
    linear: (k) => k,
    back: (k) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2),
  };
  // resolves even when the tab is hidden and animation frames stop, so a game never stalls in the background
  function tween(ms, fn, easing = ease.inOut) {
    const dur = Math.max(1, ms / speed());
    return new Promise((res) => {
      const t0 = performance.now();
      let done = false;
      const finish = () => { if (done) return; done = true; fn(1); res(); };
      const step = (now) => {
        if (done) return;
        const k = clamp((now - t0) / dur, 0, 1);
        if (k >= 1) { finish(); return; }
        fn(easing(k));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      setTimeout(finish, dur + 250);
    });
  }

  /* ---------- sound (synthesised, starts on first input) ---------- */
  const SOUND_KEY = 'party.sound';
  let ac = null, soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch {}
  function tone(freq, dur, { type = 'sine', vol = .13, slide = 0, delay = 0 } = {}) {
    if (!soundOn) return;
    try {
      ac ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(.0008, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + dur + .02);
    } catch {}
  }
  const notes = (list, gap, opts) => list.forEach((f, i) => tone(f, gap * 2.2, { ...opts, delay: i * gap }));
  const sfx = {
    tick: () => tone(620 + rng() * 120, .06, { type: 'triangle', vol: .09 }),
    rattle: () => { for (let i = 0; i < 7; i++) tone(180 + rng() * 300, .04, { type: 'square', vol: .035, delay: i * .08 }); },
    six: () => notes([660, 880, 1320], .07, { type: 'triangle' }),
    turn: () => notes([520, 780], .08),
    up: () => notes([392, 494, 587, 784, 988], .07, { type: 'triangle' }),
    down: () => { tone(760, .75, { type: 'sawtooth', vol: .07, slide: -640 }); tone(90, .3, { vol: .15, delay: .55 }); },
    hiss: () => { for (let i = 0; i < 9; i++) tone(2600 + rng() * 1800, .05, { type: 'sawtooth', vol: .012, delay: i * .05 }); },
    boom: () => { tone(130, .5, { type: 'sawtooth', vol: .16, slide: -95 }); tone(70, .6, { vol: .2 }); },
    zap: () => { for (let i = 0; i < 5; i++) tone(900 + rng() * 1800, .05, { type: 'square', vol: .05, delay: i * .04 }); },
    whoosh: () => tone(240, .5, { type: 'sawtooth', vol: .05, slide: 1100 }),
    win: () => notes([523, 659, 784, 1047, 784, 1047, 1319], .12, { type: 'triangle', vol: .15 }),
    pop: () => tone(240, .1, { vol: .14, slide: 480 }),
  };

  /* ---------- effects layer ---------- */
  const Fx = (() => {
    let canvas, ctx, W = 0, H = 0, running = false;
    const items = [];
    const palette = ['#22d3ee', '#818cf8', '#c084fc', '#fbbf24', '#f87171', '#34d399', '#f472b6'];
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function frame(now) {
      ctx.clearRect(0, 0, W, H);
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i], k = (now - it.t0) / it.life;
        if (k >= 1) { items.splice(i, 1); continue; }
        if (k >= 0) { ctx.save(); it.draw(ctx, k, now); ctx.restore(); }
      }
      if (items.length) requestAnimationFrame(frame);
      else { running = false; ctx.clearRect(0, 0, W, H); }
    }
    function add(life, draw, delay = 0) {
      if (document.hidden) return;
      items.push({ t0: performance.now() + delay, life: life / speed(), draw });
      if (!running) { running = true; requestAnimationFrame(frame); }
    }
    function burst(x, y, { n = 26, colors = palette, power = 150, life = 750, size = 4, gravity = 170 } = {}) {
      for (let i = 0; i < n; i++) {
        const a = rng() * 6.283, v = power * (.35 + rng() * .8), c = colors[i % colors.length], s = size * (.5 + rng());
        add(life * (.7 + rng() * .4), (g, k) => {
          g.globalAlpha = 1 - k;
          g.fillStyle = c;
          g.beginPath();
          g.arc(x + Math.cos(a) * v * k, y + Math.sin(a) * v * k + gravity * k * k, s * (1 - k * .6), 0, 6.283);
          g.fill();
        });
      }
    }
    function ring(x, y, { radius = 70, color = '#fff', life = 550, width = 5 } = {}) {
      add(life, (g, k) => {
        g.globalAlpha = 1 - k; g.strokeStyle = color; g.lineWidth = width * (1 - k) + .5;
        g.beginPath(); g.arc(x, y, radius * ease.out(k), 0, 6.283); g.stroke();
      });
    }
    function firework(x, y) {
      const c = pick(palette);
      add(320, (g, k) => {
        g.strokeStyle = c; g.lineWidth = 2; g.globalAlpha = 1 - k * .4;
        g.beginPath(); g.moveTo(x, H - (H - y) * k); g.lineTo(x, H - (H - y) * k + 26); g.stroke();
      });
      setTimeout(() => { burst(x, y, { n: 46, colors: [c, '#fff', pick(palette)], power: 190, life: 1000, gravity: 110 }); ring(x, y, { radius: 110, color: c }); }, 320 / speed());
    }
    function lightning(x, y, { life = 420, branches = 2, color = '#e0f2fe' } = {}) {
      const bolt = (bx, by, ex, ey) => {
        const pts = [[bx, by]], n = 9;
        for (let i = 1; i < n; i++) pts.push([bx + (ex - bx) * i / n + (rng() - .5) * 46, by + (ey - by) * i / n]);
        pts.push([ex, ey]);
        return pts;
      };
      const all = [bolt(x + (rng() - .5) * 90, 0, x, y)];
      for (let i = 0; i < branches; i++) all.push(bolt(x + (rng() - .5) * 240, y * rng() * .5, x, y));
      add(life, (g, k) => {
        if (k < .2) { g.fillStyle = `rgba(224, 242, 254, ${.3 * (1 - k * 5)})`; g.fillRect(0, 0, W, H); }
        if (Math.sin(k * 40) < -.5) return;
        g.globalAlpha = 1 - k; g.strokeStyle = color; g.lineWidth = 3; g.shadowColor = '#7dd3fc'; g.shadowBlur = 16; g.lineJoin = 'round';
        for (const pts of all) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); }
      });
    }
    const pieces = {
      confetti() {
        for (let i = 0; i < 110; i++) {
          const x = rng() * W, drift = (rng() - .5) * 110, c = pick(palette), spin = rng() * 20, w = 5 + rng() * 6;
          add(1200 + rng() * 800, (g, k) => {
            g.translate(x + drift * k, -20 + (H + 40) * k);
            g.rotate(spin * k);
            g.scale(Math.cos(spin * k * 1.6), 1);
            g.fillStyle = c; g.globalAlpha = k > .85 ? (1 - k) / .15 : 1;
            g.fillRect(-w / 2, -w / 3, w, w * .66);
          }, rng() * 350);
        }
        return 1500;
      },
      fireworks() {
        for (let i = 0; i < 4; i++) setTimeout(() => { firework(W * (.15 + rng() * .7), H * (.15 + rng() * .35)); sfx.pop(); }, i * 260 / speed());
        return 1500;
      },
    };
    return {
      palette, add, burst, ring, firework, lightning,
      init(el) { canvas = el; ctx = canvas.getContext('2d'); resize(); new ResizeObserver(resize).observe(canvas); },
      run: (name) => (document.hidden ? 0 : pieces[name]()),
      get width() { return W; }, get height() { return H; },
    };
  })();

  /* ---------- transports ---------- */
  const peerIdFor = (game, code) => `vbek-bio-${game}-${code}`.toLowerCase();

  function peerHost(game, code, h) {
    let peer, dead = false, n = 0, everReady = false;
    const conns = new Map();
    function open() {
      peer = new Peer(peerIdFor(game, code), { debug: 0 });
      peer.on('open', () => { everReady = true; h.ready(); });
      peer.on('connection', (c) => {
        const id = 'p' + ++n;
        c.on('open', () => { conns.set(id, c); h.open(id); });
        c.on('data', (d) => h.msg(id, d));
        const gone = () => { if (conns.delete(id)) h.close(id); };
        c.on('close', gone); c.on('error', gone);
      });
      peer.on('error', (e) => {
        if (dead) return;
        if (e.type === 'unavailable-id') { if (!everReady) h.fail('taken'); return; }
        if (e.type === 'browser-incompatible' || e.type === 'webrtc') h.fail('webrtc');
        else if (!everReady) h.fail('network');
      });
    }
    // live games keep flowing over WebRTC while the connection to the broker is repaired
    const repair = setInterval(() => {
      if (dead || !peer) return;
      if (peer.destroyed) open();
      else if (peer.disconnected) { try { peer.reconnect(); } catch {} }
    }, 4000);
    open();
    return {
      send(id, m) { const c = conns.get(id); if (c?.open) c.send(m); },
      all(m) { for (const c of conns.values()) if (c.open) c.send(m); },
      drop(id) { const c = conns.get(id); conns.delete(id); try { c?.close(); } catch {} },
      destroy() { dead = true; clearInterval(repair); try { peer.destroy(); } catch {} },
    };
  }

  function peerClient(game, code, h) {
    let conn = null, dead = false;
    const peer = new Peer({ debug: 0 });
    peer.on('open', () => {
      conn = peer.connect(peerIdFor(game, code), { reliable: true });
      conn.on('open', h.ready);
      conn.on('data', h.msg);
      conn.on('close', () => { if (!dead) h.close(); });
      conn.on('error', () => { if (!dead) h.close(); });
    });
    peer.on('error', (e) => { if (!dead) h.error(e.type === 'peer-unavailable' ? 'notfound' : e.type === 'browser-incompatible' ? 'webrtc' : 'network'); });
    return {
      send(m) { if (conn?.open) conn.send(m); },
      destroy() { dead = true; try { peer.destroy(); } catch {} },
    };
  }

  const wsUrl = (params) => `ws://${location.host}/__party/ws?${new URLSearchParams(params)}`;

  function wsHost(game, code, h) {
    let ws, dead = false, everReady = false;
    function open() {
      ws = new WebSocket(wsUrl({ role: 'host', room: code, game }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'ready') { everReady = true; h.ready(); }
        else if (m.t === 'open') h.open(m.id);
        else if (m.t === 'close') h.close(m.id);
        else if (m.t === 'msg') h.msg(m.id, m.data);
        else if (m.t === 'error') { dead = true; h.fail('taken'); }
      };
      ws.onclose = () => {
        if (dead) return;
        if (!everReady) { dead = true; h.fail('network'); return; }
        h.lost?.();
        setTimeout(() => { if (!dead) open(); }, 2000);
      };
    }
    open();
    const put = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
    return {
      send: (id, data) => put({ t: 'to', id, data }),
      all: (data) => put({ t: 'all', data }),
      drop: (id) => put({ t: 'drop', id }),
      destroy() { dead = true; ws.close(); },
    };
  }

  function wsClient(game, code, h) {
    let dead = false, failed = false;
    const ws = new WebSocket(wsUrl({ role: 'join', room: code, game }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'ready') h.ready();
      else if (m.t === 'msg') h.msg(m.data);
      else if (m.t === 'error') { failed = true; h.error(m.reason); }
      else if (m.t === 'hostgone') h.note?.('The host lost connection. Waiting for them to come back…');
      else if (m.t === 'hostback') h.note?.('');
    };
    ws.onclose = () => { if (!dead && !failed) h.close(); };
    return {
      send(m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
      destroy() { dead = true; ws.close(); },
    };
  }

  /* ---------- the table ---------- */
  function start({ rules, view, blurb, howTo }) {
    const SAVE_KEY = `party.${rules.id}.save`, CLIENT_KEY = `party.${rules.id}.client`, NAME_KEY = 'party.name', ID_KEY = 'party.clientId';
    const stage = $('#stage'), table = $('#table'), boardCanvas = $('#board'), wrap = $('#boardWrap');
    const seatsEl = $('#seats'), turnEl = $('#turnMsg'), diceBtn = $('#dice'), chip = $('#roomChip');
    const bctx = boardCanvas.getContext('2d');
    const store = {
      get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
      set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
      del(k) { try { sessionStorage.removeItem(k); } catch {} },
    };
    const myName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
    const rememberName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch {} };
    const clientId = (() => {
      let id = store.get(ID_KEY);
      if (!id) { id = newCode() + newCode() + newCode(); store.set(ID_KEY, id); }
      return id;
    })();

    let mode = null;          // 'local' | 'host' | 'client'
    let lan = null;           // { lan: [...ips], port } when served by the local host server
    let net = null, room = null, maxSeats = 0;
    let players = [];         // { id, name, online, lostAt }
    let mySeat = -1, state = null, shown = null, seq = 0, inGame = false;
    let queue = [], pumping = false, awaiting = false, awaitTimer = 0;
    let boardSize = 0, chosenIp = null, note = '', board3d = null, is3d = false;
    const PREFS_KEY = `party.${rules.id}.prefs`;
    const defaultPrefs = () => Object.fromEntries(rules.options.map((o) => [o.key, o.choices[0].value]));
    let prefs = (() => {
      try { return { ...defaultPrefs(), ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; } catch { return defaultPrefs(); }
    })();
    const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };
    const seatRange = () => rules.seatRange?.(prefs) ?? [rules.minPlayers, rules.maxPlayers];
    const minSeats = () => seatRange()[0];
    const prefsSummary = () => rules.options.map((o) => o.choices.find((c) => c.value === prefs[o.key])?.label).filter(Boolean).join(' · ');
    let hostPrefsText = '';

    /* ----- dice ----- */
    const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    const FACE_XF = { 1: 'rotateY(0deg)', 2: 'rotateX(90deg)', 3: 'rotateY(90deg)', 4: 'rotateY(-90deg)', 5: 'rotateX(-90deg)', 6: 'rotateY(180deg)' };
    const SHOW = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
    const cube = $('.cube', diceBtn), cubeWrap = $('.cube-wrap', diceBtn);
    function buildDice() {
      cube.innerHTML = Object.keys(PIPS).map((v) => `<div class="face" style="transform:${FACE_XF[v]} translateZ(var(--half))">${
        Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i) ? 'on' : ''}"></i>`).join('')}</div>`).join('');
      const sizeHalf = () => cubeWrap.getBoundingClientRect().width / 2 || 32;
      const apply = () => cube.style.setProperty('--half', Math.round(sizeHalf()) + 'px');
      apply();
      new ResizeObserver(apply).observe(cubeWrap);
    }
    let spinX = 0, spinY = 0;
    function setDie(v, ms) {
      // full turns are added on top so the die always spins forwards into its face
      const [x, y] = SHOW[v];
      const turnsX = ms ? 1 : 0, turnsY = ms ? 1 : 0;
      spinX = (Math.ceil(spinX / 360) + turnsX) * 360 + x;
      spinY = (Math.ceil(spinY / 360) + turnsY) * 360 + y;
      cube.style.transition = ms ? `transform ${ms / speed()}ms cubic-bezier(.2, .75, .3, 1)` : 'none';
      cube.style.transform = `rotateX(${spinX}deg) rotateY(${spinY}deg)`;
    }
    async function rollDice(ev) {
      diceBtn.classList.remove('ready');
      sfx.rattle();
      setDie(ev.value, 520);
      await sleep(560);
      sfx.tick();
    }

    /* ----- table rendering ----- */
    const isMine = (seat) => mode === 'local' || seat === mySeat;
    const seatName = (i) => shown?.players[i]?.name ?? '';
    function renderSeats() {
      if (!shown) return;
      seatsEl.innerHTML = shown.players.map((p, i) => {
        const off = mode !== 'local' && players[i] && !players[i].online;
        const you = mode !== 'local' && i === mySeat ? '<em>you</em>' : '';
        return `<div class="seat${shown.cur === i && shown.phase !== 'over' ? ' now' : ''}${off ? ' off' : ''}" style="--seat:${view.colorOf(shown, i)}">
          <span class="pip"></span><span class="who"><span class="nm">${esc(p.name)}${you}</span>
          <span class="inf">${off ? 'Disconnected' : esc(rules.seatInfo(shown, i))}</span></span></div>`;
      }).join('');
    }
    function refreshTurn() {
      if (!shown || !inGame) return;
      const color = view.colorOf(shown, shown.cur);
      diceBtn.style.setProperty('--seat', color);
      turnEl.style.setProperty('--seat', color);
      const mine = isMine(shown.cur) && !pumping && !awaiting && shown.phase !== 'over';
      const canRoll = mine && shown.phase === 'roll', canPick = mine && shown.phase === 'move';
      diceBtn.classList.toggle('ready', canRoll);
      diceBtn.setAttribute('aria-disabled', canRoll ? 'false' : 'true');
      view.setPick?.(canPick ? shown.moves : null);
      wrap.classList.toggle('pickable', canPick);
      const who = `<b>${esc(seatName(shown.cur))}</b>`;
      if (pumping || shown.phase === 'over') return;
      const youTurn = mode === 'local' ? who : shown.cur === mySeat ? '<b>Your turn</b>' : null;
      showTurn(youTurn ?? 'Waiting for', note ? esc(note) : youTurn ? (canPick ? 'Pick a token' : 'Tap the dice') : who);
    }
    // always two single lines, so that nothing here can change the size of the board
    const showTurn = (first, second = '') => { turnEl.innerHTML = `<span>${first}</span><span>${second}</span>`; };
    function act(action) {
      if (!inGame || pumping || awaiting || !shown || !isMine(shown.cur)) return;
      if (mode === 'client') {
        awaiting = true;
        clearTimeout(awaitTimer);
        awaitTimer = setTimeout(() => { awaiting = false; refreshTurn(); }, 5000);
        net?.send({ t: 'act', action });
        refreshTurn();
      } else hostApply(shown.cur, action);
    }
    function banner(html, ms = 1100) {
      const el = document.createElement('div');
      el.className = 'banner'; el.innerHTML = html;
      stage.appendChild(el);
      setTimeout(() => el.remove(), 1300 / speed());
      return sleep(ms);
    }
    const toast = (() => {
      let el = null;
      return (text) => {
        if (!text) { el?.remove(); el = null; return; }
        if (!el) { el = document.createElement('div'); el.className = 'toast'; stage.appendChild(el); }
        el.textContent = text;
      };
    })();
    const boardToStage = (x, y) => {
      const s = stage.getBoundingClientRect();
      if (is3d) { const [px, py] = board3d.project(x / boardSize, y / boardSize); return [px - s.left, py - s.top]; }
      const b = boardCanvas.getBoundingClientRect();
      return [b.left - s.left + x, b.top - s.top + y];
    };
    const shake = () => { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); };
    const api = { act, banner, note: (t) => { note = t; }, shake, sfx, fx: Fx, tween, ease, sleep, rng, boardToStage, pickFrom: (arr, i) => arr[i % arr.length], esc };

    /* ----- event playback ----- */
    async function playEvent(ev) {
      if (ev.type === 'roll') { await rollDice(ev); return; }
      if (ev.type === 'turn') {
        if (!ev.extra && isMine(ev.seat) && mode !== 'local') {
          sfx.turn();
          if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(60);
        }
        return;
      }
      if (ev.type === 'win') {
        sfx.win();
        Fx.run('fireworks'); Fx.run('confetti');
        await sleep(1300);
        return;
      }
      await view.play(ev, api);
    }
    async function pump() {
      if (pumping) return;
      pumping = true;
      refreshTurn();
      while (queue.length) {
        const batch = queue.shift();
        backlog = queue.length;
        note = '';
        if (batch.fresh) {
          shown = batch.state;
          view.setState(shown);
          renderSeats();
          setDie(1, 0);
        }
        showTurn(shown ? `<b>${esc(seatName(batch.actor ?? shown.cur))}</b>` : '');
        turnEl.style.setProperty('--seat', view.colorOf(shown, batch.actor ?? shown.cur));
        for (const ev of batch.events) await playEvent(ev);
        shown = batch.state;
        view.setState(shown);
        renderSeats();
      }
      backlog = 0;
      pumping = false;
      refreshTurn();
      if (shown?.phase === 'over' && inGame) showWin();
    }
    const enqueue = (batch) => { queue.push(batch); pump(); };

    /* ----- authority: applies actions, sends results ----- */
    function saveHost() {
      store.set(SAVE_KEY, { mode, room, maxSeats, prefs, players: players.map((p) => ({ id: p.id, name: p.name })), state, seq, inGame });
    }
    function hostApply(seat, action) {
      const r = rules.apply(state, { ...action, seat }, rng);
      if (!r) return;
      state = r.state; seq++;
      saveHost();
      lastAuto = Date.now();
      if (mode === 'host') net?.all({ t: 'ev', seq, actor: seat, events: r.events, state });
      enqueue({ events: r.events, state, actor: seat });
    }
    function beginGame() {
      const names = players.map((p) => p.name);
      state = rules.newGame(names, rng, prefs);
      seq++; inGame = true;
      saveHost();
      enterTable();
      const events = [];
      if (mode === 'host') net?.all({ t: 'start', seq, players: rosterMsg(), events, state });
      enqueue({ fresh: true, events, state });
    }
    let lastAuto = 0;
    // a player who has dropped off shouldn't freeze the game for everyone else
    setInterval(() => {
      if (mode !== 'host' || !inGame || !state || state.phase === 'over') return;
      const p = players[state.cur];
      if (!p || p.online || Date.now() - (p.lostAt || 0) < AUTOPLAY_AFTER_MS || Date.now() - lastAuto < 2000) return;
      const a = rules.autoAction(state);
      if (a) hostApply(state.cur, a);
    }, 1000);

    const rosterMsg = () => players.map((p) => ({ name: p.name, online: p.online }));
    function pushRoster() {
      if (mode !== 'host') return;
      net?.all({ t: 'roster', players: rosterMsg(), max: maxSeats, inGame, prefs: prefsSummary() });
      if (inGame) renderSeats(); else renderLobby();
    }

    /* ----- hosting ----- */
    const byConn = new Map(), lastSeen = new Map();
    let beat = 0;
    function dropConn(connId) {
      const id = byConn.get(connId);
      byConn.delete(connId); lastSeen.delete(connId);
      if (id == null) return;
      if ([...byConn.values()].includes(id)) return;
      const i = players.findIndex((p) => p.id === id);
      if (i < 0) return;
      if (!inGame) players.splice(i, 1);
      else { players[i].online = false; players[i].lostAt = Date.now(); }
      saveHost();
      pushRoster();
    }
    function onHostMsg(connId, m) {
      lastSeen.set(connId, Date.now());
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        const id = String(m.id || '').slice(0, 40), name = String(m.name || 'Player').trim().slice(0, 16) || 'Player';
        if (!id) return;
        let seat = players.findIndex((p) => p.id === id);
        if (seat < 0) {
          if (inGame) { net.send(connId, { t: 'reject', reason: 'started' }); return; }
          if (players.length >= maxSeats) { net.send(connId, { t: 'reject', reason: 'full' }); return; }
          players.push({ id, name, online: true });
          seat = players.length - 1;
          sfx.pop();
        } else {
          players[seat].online = true;
          players[seat].lostAt = 0;
          if (!inGame) players[seat].name = name;
        }
        byConn.set(connId, id);
        net.send(connId, { t: 'welcome', seat, room, prefs: prefsSummary(), max: maxSeats, players: rosterMsg(), inGame, seq, state: inGame ? state : null });
        saveHost();
        pushRoster();
      } else if (m.t === 'act') {
        const seat = players.findIndex((p) => p.id === byConn.get(connId));
        if (seat >= 0 && inGame && m.action && typeof m.action === 'object') {
          hostApply(seat, { type: String(m.action.type), token: Number(m.action.token) });
        }
      }
    }
    function openRoom(code, resumed) {
      room = code;
      const handlers = {
        ready() { renderChip(); if (!inGame) renderLobby(); toast(''); },
        open(id) { lastSeen.set(id, Date.now()); net?.send(id, { t: 'who' }); },
        msg: onHostMsg,
        close: dropConn,
        lost() { toast('Lost contact with the host server. Reconnecting…'); },
        fail(reason) {
          if (reason === 'taken' && !resumed) { net?.destroy(); openRoom(newCode(), false); return; }
          if (reason === 'taken') { toast('Waiting for your old room to free up…'); setTimeout(() => { net?.destroy(); openRoom(code, true); }, 5000); return; }
          net?.destroy(); net = null;
          showMenu(netFailure(reason));
        },
      };
      net = lan ? wsHost(rules.id, code, handlers) : peerHost(rules.id, code, handlers);
      clearInterval(beat);
      beat = setInterval(() => {
        net?.all({ t: 'ping' });
        const now = Date.now();
        for (const [id, seen] of lastSeen) if (now - seen > SILENCE_MS) { net?.drop(id); dropConn(id); }
      }, HEARTBEAT_MS);
    }
    function netFailure(reason) {
      if (reason === 'webrtc') return 'This browser can\'t make device-to-device connections. Try Chrome, Edge, Firefox or Safari.';
      if (reason === 'notfound') return 'No room with that code. Check the code, and that the host still has the room open.';
      if (reason === 'full') return 'That room is full.';
      if (reason === 'started') return 'That game has already started.';
      if (reason === 'closed') return 'The host closed the room.';
      if (reason === 'gone') return 'Lost the connection to the host for too long, so the game has ended on this device.';
      return 'Couldn\'t reach the room service. Check your internet connection, or join by IP using the local host (see the games README).';
    }

    /* ----- joining ----- */
    let clientGen = 0, reconnecting = false, heard = 0, contact = 0, welcomed = false;
    function connectClient(code, name) {
      const gen = ++clientGen;
      room = code; mode = 'client';
      net?.destroy();
      const retry = () => {
        if (gen !== clientGen) return;
        if (!welcomed) { net?.destroy(); net = null; mode = null; store.del(CLIENT_KEY); showMenu(netFailure('notfound')); return; }
        reconnecting = true;
        renderChip();
        toast('Connection lost. Reconnecting…');
        setTimeout(() => { if (gen === clientGen) connectClient(code, name); }, 2000);
      };
      const handlers = {
        ready() { if (gen !== clientGen) return; heard = Date.now(); net.send({ t: 'hello', id: clientId, name }); },
        msg(m) { if (gen === clientGen) onClientMsg(m); },
        close: retry,
        error(reason) {
          if (gen !== clientGen) return;
          if (welcomed) { retry(); return; }
          net?.destroy(); net = null; mode = null; store.del(CLIENT_KEY);
          showMenu(netFailure(reason));
        },
        note(text) { if (gen === clientGen) toast(text); },
      };
      net = lan ? wsClient(rules.id, code, handlers) : peerClient(rules.id, code, handlers);
      heard = Date.now();
      if (!welcomed) setTimeout(() => { if (gen === clientGen && !welcomed) handlers.error('notfound'); }, 15000);
    }
    setInterval(() => {
      if (mode !== 'client' || !welcomed) return;
      if (Date.now() - contact > GIVE_UP_MS) { leaveToMenu(netFailure('gone')); return; }
      if (Date.now() - heard > SILENCE_MS) {
        reconnecting = true;
        renderChip();
        toast('Connection lost. Reconnecting…');
        connectClient(room, store.get(CLIENT_KEY)?.name);
      }
    }, 2000);
    function onClientMsg(m) {
      heard = contact = Date.now();
      if (m.t === 'ping') { net.send({ t: 'pong' }); return; }
      if (m.t === 'who') { net.send({ t: 'hello', id: clientId, name: store.get(CLIENT_KEY)?.name }); return; }
      if (m.t === 'reject') {
        leaveToMenu(netFailure(m.reason));
        return;
      }
      if (m.t === 'welcome') {
        welcomed = true; reconnecting = false;
        mySeat = m.seat; maxSeats = m.max; room = m.room; players = m.players; hostPrefsText = m.prefs || '';
        toast('');
        renderChip();
        if (m.inGame && m.state) {
          if (m.seq !== seq || !inGame) {
            seq = m.seq; state = m.state; inGame = true; queue = [];
            enterTable();
            enqueue({ fresh: true, events: [], state });
          } else renderSeats();
        } else { inGame = false; renderLobby(); }
        return;
      }
      if (m.t === 'roster') {
        players = m.players; maxSeats = m.max; hostPrefsText = m.prefs || '';
        if (inGame) renderSeats(); else renderLobby();
        return;
      }
      if (m.t === 'start') {
        seq = m.seq; state = m.state; players = m.players; inGame = true;
        awaiting = false; queue = [];
        enterTable();
        enqueue({ fresh: true, events: m.events, state });
        return;
      }
      if (m.t === 'ev' && m.seq > seq) {
        seq = m.seq; state = m.state; awaiting = false;
        enqueue({ events: m.events, state, actor: m.actor });
      }
    }

    /* ----- cards ----- */
    const cards = $('#cards');
    const closeCard = () => { cards.innerHTML = ''; };
    function show(html) { cards.innerHTML = `<section class="card">${html}</section>`; return cards.firstElementChild; }
    const icon = (d) => `<svg class="ic" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
    const title = () => {
      const parts = rules.title.split(' ');
      return parts.length > 1 ? `${esc(parts.slice(0, -1).join(' '))} <span>${esc(parts[parts.length - 1])}</span>` : `<span>${esc(rules.title)}</span>`;
    };
    function countPicker(el, value, onChange) {
      const draw = (current) => {
        const [lo, hi] = seatRange(), opts = [];
        for (let n = lo; n <= hi; n++) opts.push(n);
        el.innerHTML = opts.map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === current}" aria-label="${n} players">${n}</button>`).join('');
      };
      draw(value);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        onChange(Number(b.dataset.n));
        sfx.tick();
      });
      return draw;
    }
    const clampCount = (n) => clamp(n, seatRange()[0], seatRange()[1]);
    const prefsHtml = () => `<details class="prefs"><summary>Preferences</summary>${rules.options.map((o) =>
      `<label class="field">${esc(o.label)}<select data-opt="${esc(o.key)}">${o.choices.map((c) =>
        `<option value="${esc(c.value)}" ${prefs[o.key] === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>`).join('')}</details>`;
    function bindPrefs(c, onChange) {
      c.querySelectorAll('select[data-opt]').forEach((sel) => {
        sel.onchange = () => { prefs[sel.dataset.opt] = sel.value; savePrefs(); onChange(); };
      });
    }

    function leaveToMenu(error) {
      clientGen++;
      if (mode === 'host') net?.all({ t: 'reject', reason: 'closed' });
      net?.destroy(); net = null;
      clearInterval(beat);
      mode = null; room = null; inGame = false; state = null; shown = null; queue = []; players = []; mySeat = -1; welcomed = false;
      byConn.clear(); lastSeen.clear();
      store.del(SAVE_KEY); store.del(CLIENT_KEY);
      table.hidden = true; chip.hidden = true;
      toast('');
      showMenu(typeof error === 'string' ? error : undefined);
    }

    function showMenu(error) {
      const saved = store.get(SAVE_KEY);
      const c = show(`
        <h1>${title()}</h1><p>${esc(blurb)}</p>
        <div class="stack">
          ${saved?.inGame ? `<button class="btn primary" id="mResume">Resume your game</button>` : ''}
          <button class="choice" id="mLocal">${icon('M4 5h16v14H4zM4 12h16M12 5v14')}<span><b>Same board</b><small>Pass one device around and take turns.</small></span></button>
          <button class="choice" id="mHost">${icon('M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01')}<span><b>Host on this network</b><small>Each player uses their own phone or laptop.</small></span></button>
          <button class="choice" id="mJoin">${icon('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2z')}<span><b>Join a room</b><small>Use a room code or the host's IP, or scan their QR.</small></span></button>
        </div>
        ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
        <p class="note">${esc(howTo)}</p>`);
      $('#mLocal', c).onclick = showLocalSetup;
      $('#mHost', c).onclick = showHostSetup;
      $('#mJoin', c).onclick = () => showJoin();
      const r = $('#mResume', c);
      if (r) r.onclick = () => resume(saved);
    }

    function showLocalSetup() {
      let count = clampCount(rules.defaultPlayers);
      const names = [];
      const c = show(`<h2>Who's playing?</h2><span class="label">Number of players</span><div class="count" id="cnt"></div>
        <div id="names"></div>${prefsHtml()}<div class="btns"><button class="btn" id="bk">Back</button><button class="btn primary" id="go">Start game</button></div>`);
      const box = $('#names', c);
      const draw = () => {
        box.querySelectorAll('input').forEach((inp, i) => { names[i] = inp.value; });
        box.innerHTML = Array.from({ length: count }, (_, i) =>
          `<label class="field">Player ${i + 1}<input maxlength="16" autocomplete="off" value="${esc(names[i] ?? `Player ${i + 1}`)}"></label>`).join('');
      };
      const drawCount = countPicker($('#cnt', c), count, (n) => { count = n; draw(); });
      draw();
      bindPrefs(c, () => { count = clampCount(count); drawCount(count); draw(); });
      $('#bk', c).onclick = () => showMenu();
      $('#go', c).onclick = () => {
        mode = 'local';
        players = [...box.querySelectorAll('input')].map((inp, i) => ({ id: 'L' + i, name: inp.value.trim().slice(0, 16) || `Player ${i + 1}`, online: true }));
        beginGame();
      };
    }

    function showHostSetup() {
      let count = clampCount(rules.defaultPlayers);
      const c = show(`<h2>Host a room</h2>
        <label class="field">Your name<input id="nm" maxlength="16" autocomplete="off" value="${esc(myName())}" placeholder="Your name"></label>
        <span class="label">Room size</span><div class="count" id="cnt"></div>
        ${prefsHtml()}
        <div class="btns"><button class="btn" id="bk">Back</button><button class="btn primary" id="go">Open room</button></div>
        <p class="note">${lan ? 'Running from your local host, so devices can join by IP with no internet.' : 'Devices join with a QR code or room code. Connecting needs internet for a moment, then play runs directly between devices.'}</p>`);
      const drawCount = countPicker($('#cnt', c), count, (n) => { count = n; });
      bindPrefs(c, () => { count = clampCount(count); drawCount(count); });
      $('#bk', c).onclick = () => showMenu();
      $('#go', c).onclick = () => {
        const name = $('#nm', c).value.trim().slice(0, 16) || 'Host';
        rememberName(name);
        mode = 'host'; maxSeats = count; seq = 0; inGame = false;
        players = [{ id: clientId, name, online: true }];
        mySeat = 0;
        show(`<h2>Opening your room…</h2><p>This takes a few seconds.</p>`);
        openRoom(newCode(), false);
      };
    }

    function joinUrl(code) {
      if (lan) return `http://${chosenIp || lan.lan[0] || location.hostname}:${lan.port}/games/${rules.id}/?room=${code}`;
      return `${location.origin}${location.pathname}?room=${code}`;
    }
    function qrImage(text) {
      const qr = qrcode(0, 'M');
      qr.addData(text); qr.make();
      const n = qr.getModuleCount(), c = document.createElement('canvas'), g = c.getContext('2d');
      const scale = 6, q = 2;
      c.width = c.height = (n + q * 2) * scale;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#0f172a';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect((x + q) * scale, (y + q) * scale, scale, scale);
      return c.toDataURL();
    }
    async function copyText(text, btn) {
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch {
        const t = document.createElement('textarea');
        t.value = text; document.body.appendChild(t); t.select();
        try { ok = document.execCommand('copy'); } catch {}
        t.remove();
      }
      if (btn) { const was = btn.textContent; btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { btn.textContent = was; }, 1400); }
    }
    function shareBlock() {
      const url = joinUrl(room);
      const ips = lan?.lan || [];
      const ipLine = lan ? `<p class="note">Or open <b>${esc(`${chosenIp || ips[0] || location.hostname}:${lan.port}`)}</b> in a browser on the same Wi-Fi and choose Join.</p>` : '';
      const picker = ips.length > 1 ? `<label class="field">Network address<select id="ipPick">${ips.map((ip) => `<option ${ip === (chosenIp || ips[0]) ? 'selected' : ''}>${esc(ip)}</option>`).join('')}</select></label>` : '';
      return `<img class="qr" id="qrImg" alt="QR code to join this room" src="${qrImage(url)}">
        <span class="label">Room code</span><span class="code" id="roomCode">${esc(room)}</span>
        <div class="addr"><span id="joinLink">${esc(url)}</span><button class="btn" id="copyLink">Copy</button></div>
        ${picker}${ipLine}`;
    }
    function bindShare(c, redraw) {
      $('#copyLink', c).onclick = (e) => copyText(joinUrl(room), e.currentTarget);
      const ip = $('#ipPick', c);
      if (ip) ip.onchange = () => { chosenIp = ip.value; redraw(); };
    }
    function rosterHtml() {
      const rows = players.map((p, i) => `<li><span>${esc(p.name)}</span><small>${i === 0 ? 'host' : i === mySeat ? 'you' : 'joined'}</small></li>`);
      for (let i = players.length; i < maxSeats; i++) rows.push('<li class="empty">Waiting for a player…</li>');
      return `<ul class="roster" id="roster">${rows.join('')}</ul>`;
    }
    function renderLobby() {
      if (inGame) return;
      if (mode === 'host') {
        const existing = $('#roster');
        if (existing) {
          existing.outerHTML = rosterHtml();
          refreshStartBtn();
          return;
        }
        const c = show(`<h2>Your room is open</h2>
          <div class="lobby">
            <div><p>Scan with a phone camera to join.</p>${shareBlock()}</div>
            <div>${rosterHtml()}
              <div class="btns"><button class="btn" id="bk">Close room</button><button class="btn primary" id="go" disabled>Need ${minSeats()} players</button></div>
              ${lan ? '' : '<p class="note">Joining by IP address needs the local host script, because a website can\'t accept connections itself. See the games README.</p>'}
            </div>
          </div>`);
        c.classList.add('wide');
        bindShare(c, () => { cards.innerHTML = ''; renderLobby(); });
        $('#bk', c).onclick = leaveToMenu;
        $('#go', c).onclick = () => { if (players.length >= minSeats()) beginGame(); };
        refreshStartBtn();
      } else if (mode === 'client') {
        const c = show(`<h2>You're in!</h2><p>Room <b>${esc(room)}</b>. Waiting for the host to start.</p>${rosterHtml()}
          ${hostPrefsText ? `<p class="note">${esc(hostPrefsText)}</p>` : ''}
          <div class="btns"><button class="btn" id="bk">Leave</button></div>`);
        $('#bk', c).onclick = leaveToMenu;
      }
    }
    function refreshStartBtn() {
      const go = $('#go');
      go.disabled = players.length < minSeats();
      go.textContent = players.length < minSeats() ? `Need ${minSeats()} players` : `Start with ${players.length} players`;
    }

    function parseAddress(text) {
      const t = text.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      const m = t.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/);
      return m ? `${m[1]}:${m[2] || 8787}` : null;
    }
    async function showJoin(presetCode = '', error = '', auto = false) {
      let rooms = [];
      if (lan) {
        try { rooms = (await (await fetch(`/__party/info?game=${encodeURIComponent(rules.id)}`, { cache: 'no-store' })).json()).rooms; } catch {}
        if (!presetCode && rooms.length === 1) presetCode = rooms[0].code;
      }
      const c = show(`<h2>Join a room</h2>
        <label class="field">Your name<input id="nm" maxlength="16" autocomplete="off" value="${esc(myName())}" placeholder="Your name"></label>
        <label class="field">${lan ? 'Room code' : 'Room code or host IP address'}<input id="code" maxlength="32" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(presetCode)}" placeholder="${lan ? 'ABC12' : 'ABC12 or 192.168.1.20'}"></label>
        ${lan && !rooms.length ? '<p class="note">No rooms are open on this host yet.</p>' : ''}
        ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
        <div class="btns"><button class="btn" id="bk">Back</button><button class="btn primary" id="go">Join</button></div>
        <p class="note">Scanned a QR code? You're already in the right place. Just add your name.</p>`);
      const nameIn = $('#nm', c), codeIn = $('#code', c);
      $('#bk', c).onclick = () => { history.replaceState(null, '', location.pathname); showMenu(); };
      const submit = () => {
        const raw = codeIn.value.trim();
        const name = nameIn.value.trim().slice(0, 16);
        if (!name) { nameIn.focus(); return; }
        rememberName(name);
        const addr = parseAddress(raw);
        if (addr && addr.split(':')[0] !== location.hostname) {
          // the host's page lives on the host's own address, so go there to join
          location.href = `http://${addr}/games/${rules.id}/?join=auto&name=${encodeURIComponent(name)}`;
          return;
        }
        const code = (addr ? presetCode : raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) { codeIn.focus(); return; }
        store.set(CLIENT_KEY, { room: code, name });
        welcomed = false;
        show(`<h2>Joining room ${esc(code)}…</h2><p>This takes a few seconds.</p>`);
        connectClient(code, name);
      };
      $('#go', c).onclick = submit;
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      if (auto && nameIn.value && codeIn.value) submit();
      else (nameIn.value ? codeIn : nameIn).focus();
    }

    function resume(saved) {
      if (saved.prefs) prefs = saved.prefs;
      mode = saved.mode; room = saved.room; maxSeats = saved.maxSeats; state = saved.state; seq = saved.seq; inGame = saved.inGame;
      players = saved.players.map((p, i) => ({ ...p, online: mode === 'local' || i === 0, lostAt: Date.now() }));
      mySeat = mode === 'host' ? 0 : -1;
      enterTable();
      enqueue({ fresh: true, events: [], state });
      if (mode === 'host') openRoom(room, true);
    }

    function renderChip() {
      chip.hidden = !room || mode === 'local';
      chip.classList.toggle('off', reconnecting);
      $('#roomChipText').textContent = room || '';
    }
    function showRoomInfo() {
      if (!inGame) return;
      const draw = () => {
        const c = show(`<h2>Room ${esc(room)}</h2><p>Reconnect a dropped device with this code.</p>${shareBlock()}
          <div class="btns"><button class="btn primary" id="cl">Back to game</button><button class="btn" id="lv">${mode === 'host' ? 'End game for everyone' : 'Leave game'}</button></div>`);
        bindShare(c, draw);
        $('#cl', c).onclick = closeCard;
        $('#lv', c).onclick = () => leaveToMenu();
      };
      draw();
    }
    function showWin() {
      const canRestart = mode !== 'client';
      const rows = () => shown.ranks.map((seat, i) => `<li><span class="seat-dot" style="color:${view.colorOf(shown, seat)}">●</span>${esc(shown.players[seat].name)}<small>${i < winners ? 'Winner' : '#' + (i + 1)}</small></li>`).join('');
      const winner = rules.winnerLabel?.(shown) ?? shown.players[shown.ranks[0]].name;
      const winners = rules.winnerCount?.(shown) ?? 1;
      const c = show(`<div class="trophy">🏆</div><h1><span>${esc(winner)}</span> wins!</h1>
        <ol class="ranks">${rows()}</ol>
        <div class="btns">${canRestart ? '<button class="btn primary" id="again">Play again</button>' : ''}<button class="btn" id="lv">${mode === 'local' ? 'Main menu' : 'Leave room'}</button></div>
        ${canRestart ? '' : '<p class="note">Waiting for the host to start another game…</p>'}`);
      const a = $('#again', c);
      if (a) a.onclick = () => { closeCard(); beginGame(); };
      $('#lv', c).onclick = leaveToMenu;
    }

    /* ----- board canvas ----- */
    function enterTable() {
      closeCard();
      table.hidden = false;
      renderChip();
      resizeBoard();
    }
    function resizeBoard() {
      const r = wrap.getBoundingClientRect();
      const S = Math.floor(Math.min(r.width, r.height));
      if (S <= 0 || S === boardSize) return;
      boardSize = S;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      boardCanvas.width = boardCanvas.height = S * dpr;
      boardCanvas.style.width = boardCanvas.style.height = S + 'px';
      view.resize(S, dpr);
    }
    function loop(now) {
      if (!table.hidden && shown && boardSize && is3d) board3d.render(view.scene3d(now), now);
      else if (!table.hidden && shown && boardSize) {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        view.draw(bctx, boardSize, now);
      }
      requestAnimationFrame(loop);
    }

    /* ----- 2D or 3D, chosen per device ----- */
    const VIEW_KEY = 'party.view', CAMERA_KEY = `party.${rules.id}.camera`;
    const viewBtn = $('#btnView');
    function markView() {
      viewBtn.textContent = is3d ? '2D' : '3D';
      viewBtn.title = is3d ? 'Switch to the 2D board' : 'Switch to the 3D board';
      viewBtn.setAttribute('aria-pressed', String(is3d));
      viewBtn.setAttribute('aria-label', viewBtn.title);
      boardCanvas.hidden = is3d;
      board3d?.show(is3d);
    }
    async function setView(want3d) {
      if (want3d && !board3d) {
        try {
          const { createBoard3D } = await import('./board3d.js');
          let saved;
          try { saved = JSON.parse(localStorage.getItem(CAMERA_KEY)) ?? undefined; } catch {}
          board3d = createBoard3D({
            wrap, saved,
            onTap: (x, y) => view.click?.(x * boardSize, y * boardSize),
            onCameraChange: (camera) => { try { localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)); } catch {} },
          });
        } catch (e) {
          console.warn('3D is unavailable', e);
          want3d = false;
          toast('3D isn\'t available on this device.');
          setTimeout(() => toast(''), 3000);
        }
      }
      is3d = want3d;
      try { localStorage.setItem(VIEW_KEY, is3d ? '3d' : '2d'); } catch {}
      markView();
    }
    viewBtn.addEventListener('click', () => setView(!is3d));
    markView();
    try { if (localStorage.getItem(VIEW_KEY) === '3d') setView(true); } catch {}

    /* ----- wiring ----- */
    buildDice();
    setDie(1, 0);
    Fx.init($('#fx'));
    new ResizeObserver(resizeBoard).observe(wrap);
    requestAnimationFrame(loop);
    const roll = () => { if (diceBtn.classList.contains('ready')) act({ type: 'roll' }); };
    diceBtn.addEventListener('click', roll);
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, select, textarea, button') || cards.firstElementChild) return;
      if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); roll(); }
      else if (/^[1-4]$/.test(e.key)) view.pickByKey?.(Number(e.key) - 1);
    });
    boardCanvas.addEventListener('click', (e) => {
      const r = boardCanvas.getBoundingClientRect();
      view.click?.(e.clientX - r.left, e.clientY - r.top);
    });
    chip.addEventListener('click', showRoomInfo);
    const soundBtn = $('#btnSound');
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      soundBtn.setAttribute('aria-pressed', String(soundOn));
      try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch {}
      if (soundOn) sfx.pop();
    });
    view.init?.(api, rules);

    (async () => {
      // the local host server answers this; on GitHub Pages or any other host it simply isn't there
      if (location.protocol === 'http:') {
        try {
          const ctl = new AbortController();
          setTimeout(() => ctl.abort(), 1200);
          const res = await fetch('/__party/info', { cache: 'no-store', signal: ctl.signal });
          if (res.ok) lan = await res.json();
        } catch {}
      }
      const q = new URLSearchParams(location.search);
      if (q.get('name')) rememberName(q.get('name').trim().slice(0, 16));
      const code = (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const saved = store.get(CLIENT_KEY);
      if (code && saved?.room === code) { showJoin(code, '', true); return; }
      if (code) { showJoin(code); return; }
      if (q.get('join') === 'auto') { showJoin('', '', true); return; }
      if (saved?.room) { showJoin(saved.room, '', true); return; }
      showMenu();
    })();
  }

  window.Party = { start, ease, tween, sfx, Fx };
})();
