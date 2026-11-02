/* Grave Mistake: levels and physics, with no drawing, so that a level can be proven beatable outside the browser.
   Runs at a fixed 60 steps a second. Positions are in pixels, and level data is in tiles.
   Map cells: # solid, f looks solid but isn't, c crumbles underfoot, i invisible until you bump it from below,
   ^ v spikes, p spike that pops up when you come close, o spring, M door that bites, D the real door, S start. */
(function (root) {
  'use strict';
  const T = 40, W = 24, H = 13;
  const PW = 24, PH = 32;
  const ACCEL = .9, FRICTION = .75, MAX_RUN = 4.4, GRAVITY = .55, MAX_FALL = 12, JUMP = 10.4, SPRING = 15;
  const COYOTE = 6, BUFFER = 6, CRUMBLE = 14, POP_FRAMES = 5, POP_NEAR = 1.6;

  const floor = (a, b) => [[11, a, '#'.repeat(b - a + 1)], [12, a, '#'.repeat(b - a + 1)]];
  const rep = (ch, n) => ch.repeat(n);

  const LEVELS = [
    { name: 'Just Walk', hue: 262,
      signs: [[8, 7, 'Just walk to the door.']],
      cells: [...floor(0, 23), [10, 2, 'S'], [10, 15, 'pp'], [10, 21, 'D']] },
    { name: 'Solid Ground', hue: 205,
      signs: [[8, 3, 'Nice, flat, trustworthy.']],
      cells: [...floor(0, 8), ...floor(12, 23), [11, 9, 'fff'], [12, 9, 'fff'], [10, 2, 'S'], [10, 16, '^'], [10, 18, 'p'], [10, 21, 'D']] },
    { name: 'Look Up', hue: 165,
      signs: [[5, 12, 'Nothing above you.']],
      cells: [...floor(0, 8), ...floor(13, 23), [12, 9, '####'], [11, 9, '^^^^'], [10, 2, 'S'], [10, 5, '#'], [8, 7, 'ii'], [10, 20, 'D']] },
    { name: 'Heavy Weather', hue: 30,
      signs: [[3, 8, 'Lovely roof. Very stable.']],
      cells: [...floor(0, 23), [5, 6, rep('#', 15)], [10, 2, 'S'], [10, 14, 'p'], [10, 21, 'D']],
      trig: [{ x0: 8.5, x1: 9.5, do: 'fall', x: 10, y: 6, w: 3 }, { x0: 15, x1: 15.6, do: 'fall', x: 16, y: 6, w: 2 }] },
    { name: 'Shy Door', hue: 325,
      signs: [[8, 12, 'Almost there!']],
      cells: [...floor(0, 23), [10, 2, 'S'], [10, 12, '^^'], [10, 20, 'D'], [10, 17, 'o'], [9, 7, '###'], [7, 1, rep('#', 5)], [6, 19, rep('#', 5)]],
      hops: [{ near: 2.5, to: [2, 6] }, { near: 2.2, to: [21, 5] }] },
    { name: 'Exit This Way', hue: 120,
      signs: [[8, 13, 'EXIT  →  →  →']],
      cells: [...floor(0, 23), [10, 5, 'S'], [10, 3, 'p'], [10, 1, 'D'], [10, 20, 'M']] },
    { name: 'Hurry Up', hue: 350,
      signs: [[7, 8, "Don't stop to admire it."]],
      cells: [...floor(0, 4), ...floor(19, 23), [12, 5, rep('^', 14)], [11, 5, rep('c', 6)], [11, 13, 'cc'], [11, 15, 'f'], [11, 16, 'ccc'], [10, 2, 'S'], [10, 21, 'D']] },
    { name: 'Wrong Way', hue: 280,
      signs: [[8, 3, 'Your controls feel fine?']],
      cells: [...floor(0, 23), [10, 2, 'S'], [10, 11, '^'], [10, 15, '^'], [10, 19, '^'], [10, 22, 'D']],
      trig: [{ x0: 7, x1: 8, do: 'rev' }] },
    { name: 'Run', hue: 15,
      signs: [[7, 2, 'Take your time.']],
      cells: [...floor(0, 8), ...floor(12, 23), [12, 9, '###'], [11, 9, '^^^'], [10, 2, 'S'], [10, 16, '^'], [10, 22, 'D']],
      saws: [{ path: [[-1, 10.2], [25, 10.2]], r: .8, speed: 3.6, hidden: true }],
      trig: [{ x0: 5, x1: 6, do: 'saw', i: 0 }] },
    { name: 'Upside Down', hue: 190,
      signs: [[5, 2, 'The door is right there.']],
      cells: [...floor(0, 23), [0, 0, rep('#', 24)], [1, 0, rep('#', 24)], [10, 2, 'S'], [10, 21, 'M'], [2, 13, 'v'], [2, 17, 'v'], [2, 21, 'D']],
      doorDown: true,
      trig: [{ x0: 8, x1: 9, do: 'grav' }] },
    { name: 'Bad Timing', hue: 240,
      signs: [[2, 2, 'Watch the rhythm.']],
      cells: [...floor(0, 18), ...floor(21, 23), [11, 19, 'ff'], [10, 2, 'S'], [10, 22, 'D']],
      pulses: [{ x: 7, w: .5, period: 120, on: 60, phase: 0 }, { x: 11, w: .5, period: 120, on: 60, phase: 40 }, { x: 15, w: .5, period: 120, on: 60, phase: 80 }] },
    { name: 'Last One, Promise', hue: 45,
      signs: [[8, 16, 'Finally. The real door.']],
      cells: [...floor(0, 23), [10, 2, 'S'], [10, 5, 'pp'], [9, 8, '##'], [10, 13, 'M'], [7, 1, rep('#', 4)], [5, 9, rep('#', 5)], [10, 20, 'D']],
      trig: [{ x0: 9.5, x1: 10.5, do: 'fall', x: 11, y: 6, w: 1 }],
      hops: [{ near: 2.5, to: [2, 6] }] },
    { name: 'Stairway', hue: 95,
      signs: [[5, 3, 'One step at a time.']],
      cells: [...floor(0, 23), [10, 2, 'S'], [10, 6, '###'], [9, 9, '###'], [8, 12, 'fff'], [10, 12, '^^^'], [8, 15, '###'], [10, 18, 'p'], [10, 21, 'D']] },
    { name: 'Night Shift', hue: 215,
      signs: [[4, 3, "He's only doing his job."]],
      cells: [...floor(0, 23), [10, 2, 'S'], [8, 9, '##'], [8, 14, 'cc'], [10, 21, 'D']],
      saws: [{ path: [[5.5, 10.2], [18.5, 10.2], [5.5, 10.2]], r: .8, speed: 3, auto: true, loop: true }] },
    { name: 'Second Thoughts', hue: 300,
      signs: [[5, 2, 'Up is up. Probably.']],
      cells: [...floor(0, 23), [0, 0, rep('#', 24)], [1, 0, rep('#', 24)], [10, 2, 'S'], [2, 11, 'v'], [10, 18, '^'], [10, 21, 'D']],
      trig: [{ x0: 7, x1: 8, do: 'grav' }, { x0: 14, x1: 15, do: 'grav' }] },
    { name: 'Leap of Faith', hue: 175,
      signs: [[4, 7, 'Pick the honest stones.']],
      cells: [...floor(0, 5), ...floor(19, 23), [12, 6, rep('^', 13)], [10, 2, 'S'], [11, 8, 'ff'], [9, 8, '##'], [11, 12, '##'], [9, 12, 'ff'], [9, 16, '##'], [10, 21, 'D']] },
    { name: 'Spring Cleaning', hue: 60,
      signs: [[8, 13, 'Boing is mandatory.']],
      cells: [...floor(0, 23), [10, 2, 'S'], [10, 4, 'o'], [10, 7, rep('^', 14)], [5, 4, 'v'], [6, 6, 'ff'], [6, 8, '##'], [5, 9, 'o'], [3, 13, rep('#', 5)], [2, 14, 'M'], [2, 16, 'D']] },
    { name: 'Pick One', hue: 10,
      signs: [[8, 9, 'Choose wisely.']],
      cells: [...floor(0, 23), [10, 12, 'S'], [10, 2, 'M'], [10, 21, 'M'], [9, 7, '##'], [7, 10, rep('#', 5)], [6, 12, 'D']] },
    { name: 'There and Back', hue: 255,
      signs: [[2, 15, 'Mind the beams. Twice.']],
      cells: [...floor(0, 23), [10, 2, 'S'], [10, 14, '^'], [10, 21, 'D']],
      pulses: [{ x: 6, w: .5, period: 90, on: 40, phase: 0 }, { x: 10, w: .5, period: 90, on: 40, phase: 30 }],
      hops: [{ near: 2, to: [1, 10] }] },
    { name: 'Reverse Psychology', hue: 140,
      signs: [[6, 4, 'Go left to go right.']],
      cells: [...floor(0, 5), ...floor(15, 23), [12, 6, rep('^', 9)], [11, 6, rep('c', 7)], [10, 2, 'S'], [10, 18, '^'], [10, 21, 'D']],
      trig: [{ x0: 0, x1: 24, do: 'rev' }] },
    { name: 'Rush Hour', hue: 355,
      signs: [[6, 2, 'No rush.']],
      cells: [...floor(0, 7), ...floor(13, 23), [12, 8, rep('^', 5)], [11, 8, rep('c', 5)], [10, 2, 'S'], [10, 16, '^'], [10, 19, 'p'], [10, 22, 'D']],
      saws: [{ path: [[-1, 10.2], [25, 10.2]], r: .8, speed: 3.6, hidden: true }],
      trig: [{ x0: 4, x1: 5, do: 'saw', i: 0 }] },
    { name: 'Ceiling Run', hue: 200,
      signs: [[6, 8, 'Mind your head.']],
      cells: [...floor(0, 23), [0, 0, rep('#', 9)], [1, 0, rep('#', 9)], [0, 11, rep('#', 3)], [1, 11, rep('#', 3)], [1, 14, rep('c', 3)], [0, 17, rep('#', 7)], [1, 17, rep('#', 7)], [2, 19, 'v'], [10, 2, 'S'], [10, 22, 'M'], [2, 22, 'D']],
      doorDown: true,
      trig: [{ x0: 4, x1: 5, do: 'grav' }] },
    { name: 'Falling Behind', hue: 25,
      signs: [[3, 7, 'Keep moving. Or not.']],
      cells: [...floor(0, 23), [5, 5, rep('#', 16)], [10, 2, 'S'], [10, 21, 'D']],
      trig: [{ x0: 7, x1: 7.6, do: 'fall', x: 8, y: 6, w: 2 }, { x0: 11, x1: 11.6, do: 'fall', x: 12, y: 6, w: 2 }, { x0: 15, x1: 16, do: 'fall', x: 17, y: 6, w: 3 }] },
    { name: 'The Grave Mistake', hue: 280,
      signs: [[8, 15, 'Go on. Trust me.']],
      cells: [...floor(0, 5), ...floor(9, 23), [11, 6, 'fff'], [12, 6, 'fff'], [10, 2, 'S'], [10, 12, 'p'], [10, 14, 'M'], [10, 20, 'D'], [10, 17, 'o'], [9, 10, '##'], [8, 7, '##'], [7, 1, rep('#', 4)], [6, 19, rep('#', 5)]],
      hops: [{ near: 2.5, to: [2, 6] }, { near: 2.2, to: [21, 5] }],
      trig: [{ x0: 1, x1: 5, y0: 4, y1: 7, do: 'rev' }] },
  ];

  /* ----- parsing ----- */
  const parsed = [];
  function parse(lv) {
    if (parsed[lv]) return parsed[lv];
    const def = LEVELS[lv], grid = Array.from({ length: H }, () => Array(W).fill(' '));
    for (const [r, c, s] of def.cells) [...s].forEach((ch, i) => { grid[r][c + i] = ch; });
    const info = { ...def, grid, start: null, door: null, pops: [], mimics: [], spikes: [] };
    grid.forEach((row, y) => row.forEach((ch, x) => {
      if (ch === 'S') info.start = [x, y];
      else if (ch === 'D') info.door = [x, y];
      else if (ch === 'p') info.pops.push([x, y]);
      else if (ch === 'M') info.mimics.push([x, y]);
      else if (ch === '^' || ch === 'v') info.spikes.push([x, y, ch]);
    }));
    return parsed[lv] = info;
  }

  function start(lv) {
    const L = parse(lv);
    return {
      lv, t: 0,
      x: (L.start[0] + .5) * T - PW / 2, y: (L.start[1] + 1) * T - PH,
      vx: 0, vy: 0, g: 1, face: 1, grounded: false, coyote: 0, buffer: 0, prevJump: false, rev: false,
      gone: {}, stood: {}, shown: {}, extra: {}, pop: {}, fired: {}, falls: [],
      saws: (L.saws || []).map((w) => ({ on: Boolean(w.auto), seg: 0, x: w.path[0][0] * T, y: w.path[0][1] * T })),
      door: { x: L.door[0], y: L.door[1], hop: 0 },
      dead: null, won: false, ev: [],
    };
  }

  /* ----- the world ----- */
  const key = (x, y) => x + ',' + y;
  function solid(s, cx, cy) {
    if (cx < 0 || cx >= W) return true;     // the sides of the screen are walls
    if (cy < 0 || cy >= H) return false;    // but you can fall out of the top and bottom
    const k = key(cx, cy), ch = parse(s.lv).grid[cy][cx];
    if (s.extra[k] || s.shown[k]) return true;
    return ch === '#' || (ch === 'c' && !s.gone[k]);
  }
  const doorRect = (s) => {
    const down = parse(s.lv).doorDown;
    return { x: s.door.x * T, y: (down ? s.door.y : s.door.y - 1) * T, w: T, h: T * 2 };
  };
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const popRise = (s, k) => Math.min(1, (s.pop[k] || 0) / POP_FRAMES);
  function pulseOn(p, t) { return (t + p.phase) % p.period < p.on; }

  function cells(s, fn) {
    const x0 = Math.floor(s.x / T), x1 = Math.floor((s.x + PW - .01) / T), y0 = Math.floor(s.y / T), y1 = Math.floor((s.y + PH - .01) / T);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fn(x, y)) return true;
    return false;
  }

  function moveX(s) {
    s.x += s.vx;
    cells(s, (cx, cy) => {
      if (!solid(s, cx, cy)) return false;
      s.x = s.vx > 0 ? cx * T - PW : (cx + 1) * T;
      s.vx = 0;
      return true;
    });
  }
  function moveY(s) {
    s.y += s.vy;
    s.grounded = false;
    const L = parse(s.lv), rising = s.vy * s.g < 0;
    cells(s, (cx, cy) => {
      const inside = cy >= 0 && cy < H && cx >= 0 && cx < W;
      // a hidden block only appears when your head meets it
      if (inside && rising && L.grid[cy][cx] === 'i' && !s.shown[key(cx, cy)]) { s.shown[key(cx, cy)] = 1; s.ev.push('bump'); }
      if (!solid(s, cx, cy)) return false;
      s.y = s.vy > 0 ? cy * T - PH : (cy + 1) * T;
      if (s.vy * s.g > 0) s.grounded = true;
      s.vy = 0;
      return true;
    });
  }

  function fire(s, tr, i) {
    s.fired[i] = 1;
    if (tr.do === 'fall') { s.falls.push({ x: tr.x, w: tr.w, y: tr.y * T, vy: 0, settled: false }); s.ev.push('rumble'); }
    else if (tr.do === 'saw') { s.saws[tr.i].on = true; s.ev.push('saw'); }
    else if (tr.do === 'rev') { s.rev = true; s.ev.push('warp'); }
    else if (tr.do === 'grav') { s.g = -s.g; s.grounded = false; s.ev.push('warp'); }
  }

  function step(s, input) {
    if (s.dead || s.won) return s;
    s.t++; s.ev = [];
    const L = parse(s.lv);
    const dir = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * (s.rev ? -1 : 1);

    if (dir) { s.vx = Math.max(-MAX_RUN, Math.min(MAX_RUN, s.vx + dir * ACCEL)); s.face = dir; }
    else s.vx = Math.abs(s.vx) < .3 ? 0 : s.vx * FRICTION;

    if (input.jump && !s.prevJump) s.buffer = BUFFER;
    else if (s.buffer > 0) s.buffer--;
    s.coyote = s.grounded ? COYOTE : Math.max(0, s.coyote - 1);
    if (s.buffer > 0 && s.coyote > 0) { s.vy = -JUMP * s.g; s.buffer = 0; s.coyote = 0; s.grounded = false; s.ev.push('jump'); }
    // letting go early makes a shorter hop
    if (!input.jump && s.prevJump && s.vy * s.g < -3) s.vy *= .5;
    s.prevJump = input.jump;

    s.vy = s.g > 0 ? Math.min(MAX_FALL, s.vy + GRAVITY) : Math.max(-MAX_FALL, s.vy - GRAVITY);
    moveX(s);
    moveY(s);

    const cxp = (s.x + PW / 2) / T, cyp = (s.y + PH / 2) / T;

    // crumbling tiles start their count when stood on
    if (s.grounded) {
      const cy = s.g > 0 ? Math.floor((s.y + PH + 1) / T) : Math.floor((s.y - 1) / T);
      for (const cx of [Math.floor(s.x / T), Math.floor((s.x + PW - .01) / T)]) {
        if (cy >= 0 && cy < H && L.grid[cy][cx] === 'c' && !s.stood[key(cx, cy)]) { s.stood[key(cx, cy)] = s.t; s.ev.push('crack'); }
      }
    }
    for (const k in s.stood) if (!s.gone[k] && s.t - s.stood[k] >= CRUMBLE) s.gone[k] = 1;

    // springs
    if (s.vy * s.g >= 0 && cells(s, (cx, cy) => cy >= 0 && cy < H && cx >= 0 && cx < W && L.grid[cy][cx] === 'o')) {
      s.vy = -SPRING * s.g; s.grounded = false; s.coyote = 0; s.ev.push('spring');
    }

    (L.trig || []).forEach((tr, i) => {
      if (!s.fired[i] && cxp >= tr.x0 && cxp < tr.x1 && (tr.y0 === undefined || (cyp >= tr.y0 && cyp < tr.y1))) fire(s, tr, i);
    });

    const me = { x: s.x, y: s.y, w: PW, h: PH };

    // falling ceilings
    for (const f of s.falls) {
      if (f.settled) continue;
      f.vy = Math.min(16, f.vy + .9);
      f.y += f.vy;
      const row = Math.floor((f.y + T) / T);
      let lands = false;
      for (let i = 0; i < f.w; i++) if (solid(s, f.x + i, row)) lands = true;
      if (lands) {
        f.settled = true;
        f.y = (row - 1) * T;
        for (let i = 0; i < f.w; i++) s.extra[key(f.x + i, row - 1)] = 1;
        s.ev.push('thud');
      }
      if (overlap(me, { x: f.x * T, y: f.y, w: f.w * T, h: T })) return die(s, 'crushed');
    }

    // spikes that wait for you
    for (const [x, y] of L.pops) {
      const k = key(x, y);
      if (s.pop[k] === undefined && Math.abs(cxp - (x + .5)) < POP_NEAR && Math.abs(cyp - (y + .5)) < 2.5) { s.pop[k] = 0; s.ev.push('pop'); }
      if (s.pop[k] !== undefined) {
        s.pop[k]++;
        const h = 30 * popRise(s, k);
        if (overlap(me, { x: x * T + 6, y: (y + 1) * T - h, w: T - 12, h })) return die(s, 'spike');
      }
    }
    for (const [x, y, ch] of L.spikes) {
      const box = ch === '^' ? { x: x * T + 6, y: y * T + 12, w: T - 12, h: T - 12 } : { x: x * T + 6, y: y * T, w: T - 12, h: T - 12 };
      if (overlap(me, box)) return die(s, 'spike');
    }

    // saws
    for (let i = 0; i < s.saws.length; i++) {
      const w = L.saws[i], m = s.saws[i];
      if (!m.on) continue;
      const to = w.path[m.seg + 1];
      if (to) {
        const dx = to[0] * T - m.x, dy = to[1] * T - m.y, d = Math.hypot(dx, dy);
        if (d <= w.speed) { m.x = to[0] * T; m.y = to[1] * T; m.seg++; } else { m.x += dx / d * w.speed; m.y += dy / d * w.speed; }
      } else if (w.loop) m.seg = 0;
      const r = w.r * T * .85;
      const nx = Math.max(s.x, Math.min(m.x, s.x + PW)), ny = Math.max(s.y, Math.min(m.y, s.y + PH));
      if (Math.hypot(nx - m.x, ny - m.y) < r) return die(s, 'saw');
    }

    // beams
    for (const p of L.pulses || []) {
      if (pulseOn(p, s.t) && overlap(me, { x: p.x * T, y: 0, w: p.w * T, h: 11 * T })) return die(s, 'beam');
    }

    // doors
    for (const [x, y] of L.mimics) {
      if (overlap(me, { x: x * T + 6, y: (y - 1) * T + 6, w: T - 12, h: T * 2 - 6 })) return die(s, 'mimic');
    }
    const hop = (L.hops || [])[s.door.hop];
    if (hop && Math.hypot(cxp - (s.door.x + .5), cyp - s.door.y) < hop.near) {
      s.door.x = hop.to[0]; s.door.y = hop.to[1]; s.door.hop++;
      s.ev.push('hop');
    } else {
      const d = doorRect(s);
      if (cxp * T > d.x + 8 && cxp * T < d.x + d.w - 8 && overlap(me, d)) { s.won = true; s.ev.push('win'); return s; }
    }

    if (s.y > H * T + 60 || s.y < -60 - PH) return die(s, 'fell');
    return s;
  }
  function die(s, cause) { s.dead = cause; s.ev.push('die'); return s; }

  const api = { T, W, H, PW, PH, LEVELS, parse, start, step, solid, key, doorRect, popRise, pulseOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GraveRules = api;
})(this);
