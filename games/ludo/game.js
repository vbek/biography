/* Ludo board: draws the classic cross board and acts out every move and capture. */
(() => {
  'use strict';
  const R = GameRules;
  const COLORS = ['#ef4444', '#16a34a', '#eab308', '#2563eb'];
  const SOFT = ['#fecaca', '#bbf7d0', '#fef08a', '#bfdbfe'];
  const lerp = (a, b, k) => a + (b - a) * k;

  // the 52 shared squares clockwise from red's start, in 15×15 grid coordinates
  const TRACK = [];
  const run = (x0, y0, x1, y1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) TRACK.push([x0 + Math.sign(x1 - x0) * i, y0 + Math.sign(y1 - y0) * i]);
  };
  run(1, 6, 5, 6); run(6, 5, 6, 0); run(7, 0, 7, 0); run(8, 0, 8, 5); run(9, 6, 14, 6); run(14, 7, 14, 7);
  run(14, 8, 9, 8); run(8, 9, 8, 14); run(7, 14, 7, 14); run(6, 14, 6, 9); run(5, 8, 0, 8); run(0, 7, 0, 7); run(0, 6, 0, 6);

  const HOME_COL = [
    (i) => [1 + i, 7], (i) => [7, 1 + i], (i) => [13 - i, 7], (i) => [7, 13 - i],
  ];
  const YARD_AT = [[0, 0], [9, 0], [9, 9], [0, 9]];
  const FINISH = [[6.55, 7.5], [7.5, 6.55], [8.45, 7.5], [7.5, 8.45]];

  let api, S = 0, cell = 0, dpr = 1, state = null, staticLayer = null;
  let tokens = [];       // on screen, per seat and token: { x, y, scale, rot, glow }
  let pickable = null, starsOn = true, blockCells = [];

  // the centre of a position in grid units, before spreading out shared squares
  function basePoint(color, pos, tokenIdx) {
    if (pos === R.YARD) {
      const [ox, oy] = YARD_AT[color];
      return [ox + (tokenIdx % 2 ? 4 : 2), oy + (tokenIdx < 2 ? 2 : 4)];
    }
    if (pos <= R.LAST_TRACK) {
      const [x, y] = TRACK[R.trackIndex(color, pos)];
      return [x + .5, y + .5];
    }
    if (pos < R.HOME) {
      const [x, y] = HOME_COL[color](pos - R.LAST_TRACK - 1);
      return [x + .5, y + .5];
    }
    return FINISH[color];
  }
  function placeAll() {
    const groups = new Map();
    state.players.forEach((p, seat) => p.tokens.forEach((pos, ti) => {
      const key = basePoint(p.color, pos, ti).join();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([seat, ti]);
    }));
    blockCells = state.opts.blocks !== 'on' ? [] : [...groups.values()].flatMap((group) => {
      const [seat, ti] = group[0], pos = state.players[seat].tokens[ti];
      return group.length >= 2 && pos >= 0 && pos <= R.LAST_TRACK && group.filter(([s]) => s === seat).length >= 2
        ? [{ point: basePoint(state.players[seat].color, pos, ti), color: state.players[seat].color }] : [];
    });
    tokens = state.players.map((p, seat) => p.tokens.map((pos, ti) => {
      const [bx, by] = basePoint(p.color, pos, ti);
      const group = groups.get([bx, by].join());
      const i = group.findIndex(([s, t]) => s === seat && t === ti), n = group.length;
      const spread = n > 1 ? .2 : 0, a = i / n * 6.283 - .8;
      return { x: bx + Math.cos(a) * spread, y: by + Math.sin(a) * spread, scale: n > 1 ? .78 : 1, rot: 0, glow: 0 };
    }));
  }

  /* ---------- static board ---------- */
  function star(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * .45 : r;
      g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * q, y + Math.sin(a) * q);
    }
    g.closePath(); g.fill();
  }
  function buildStatic() {
    if (!S) return;
    staticLayer = document.createElement('canvas');
    staticLayer.width = staticLayer.height = S * dpr;
    const g = staticLayer.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#fbfdff';
    g.fillRect(0, 0, S, S);
    const box = (cx, cy, fill) => {
      g.fillStyle = fill; g.fillRect(cx * cell, cy * cell, cell, cell);
      g.strokeStyle = 'rgba(15, 23, 42, .28)'; g.lineWidth = 1; g.strokeRect(cx * cell + .5, cy * cell + .5, cell - 1, cell - 1);
    };
    TRACK.forEach(([x, y]) => box(x, y, '#fff'));
    R.START.forEach((idx, color) => { const [x, y] = TRACK[idx]; box(x, y, COLORS[color]); });
    for (let color = 0; color < 4; color++) for (let i = 0; i < 5; i++) { const [x, y] = HOME_COL[color](i); box(x, y, COLORS[color]); }
    if (starsOn) R.SAFE.forEach((idx) => {
      if (R.START.includes(idx)) return;
      const [x, y] = TRACK[idx];
      box(x, y, '#f1f5f9');
      star(g, (x + .5) * cell, (y + .5) * cell, cell * .34, '#94a3b8');
    });
    if (starsOn) R.START.forEach((idx) => { const [x, y] = TRACK[idx]; star(g, (x + .5) * cell, (y + .5) * cell, cell * .32, 'rgba(255, 255, 255, .9)'); });
    YARD_AT.forEach(([ox, oy], color) => {
      g.fillStyle = COLORS[color]; g.fillRect(ox * cell, oy * cell, 6 * cell, 6 * cell);
      g.fillStyle = '#fff';
      g.beginPath(); g.roundRect((ox + 1) * cell, (oy + 1) * cell, 4 * cell, 4 * cell, cell * .45); g.fill();
      for (let i = 0; i < 4; i++) {
        const [x, y] = basePoint(color, R.YARD, i);
        g.fillStyle = SOFT[color]; g.beginPath(); g.arc(x * cell, y * cell, cell * .62, 0, 6.283); g.fill();
        g.strokeStyle = COLORS[color]; g.lineWidth = Math.max(1.5, cell * .06); g.stroke();
      }
    });
    const c = 7.5 * cell;
    [[6, 6, 6, 9], [6, 6, 9, 6], [9, 6, 9, 9], [6, 9, 9, 9]].forEach(([x0, y0, x1, y1], color) => {
      g.fillStyle = COLORS[color];
      g.beginPath(); g.moveTo(x0 * cell, y0 * cell); g.lineTo(x1 * cell, y1 * cell); g.lineTo(c, c); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255, 255, 255, .8)'; g.lineWidth = 1.5; g.stroke();
    });
  }

  /* ---------- tokens ---------- */
  function drawPawn(g, color, tk, selectable) {
    if (tk.scale <= .01) return;
    const x = tk.x * cell, y = tk.y * cell, r = cell * .38 * tk.scale;
    g.save();
    if (selectable) {
      g.strokeStyle = '#0f172a'; g.lineWidth = Math.max(2, cell * .07);
      g.beginPath(); g.arc(x, y, r * 1.3, 0, 6.283); g.stroke();
    }
    g.translate(x, y);
    g.fillStyle = 'rgba(0, 0, 0, .28)';
    g.beginPath(); g.ellipse(0, r * .75, r * .78, r * .28, 0, 0, 6.283); g.fill();
    g.rotate(tk.rot);
    if (tk.glow) { g.shadowColor = COLORS[color]; g.shadowBlur = 22 * tk.glow; }
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(0, 0, r, 0, 6.283); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = COLORS[color];
    g.beginPath(); g.arc(0, 0, r * .8, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(15, 23, 42, .5)'; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, r, 0, 6.283); g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, .34)';
    g.beginPath(); g.ellipse(0, -r * .38, r * .5, r * .26, 0, 0, 6.283); g.fill();
    g.restore();
  }

  /* ---------- acting out events ---------- */
  const toStage = (x, y) => api.boardToStage(x * cell, y * cell);

  async function walkToken(tk, color, ev) {
    const path = [];
    if (ev.from === R.YARD) path.push(basePoint(color, 0, ev.token));
    else for (let p = ev.from + 1; p <= ev.to; p++) path.push(basePoint(color, p, ev.token));

    if (ev.from === R.YARD) {
      const [x0, y0] = [tk.x, tk.y], [x1, y1] = path[0];
      api.sfx.pop();
      await api.tween(260, (k) => { tk.x = lerp(x0, x1, k); tk.y = lerp(y0, y1, k); });
      return;
    }
    for (const [nx, ny] of path) {
      const [x0, y0] = [tk.x, tk.y];
      await api.tween(120, (k) => { tk.x = lerp(x0, nx, k); tk.y = lerp(y0, ny, k); });
      api.sfx.tick();
    }
  }

  async function capture(ev) {
    for (const c of ev.captured) {
      const tk = tokens[c.seat][c.token], victim = state.players[c.seat], [px, py] = toStage(tk.x, tk.y);
      const [yx, yy] = basePoint(victim.color, R.YARD, c.token), [x0, y0] = [tk.x, tk.y];
      if (ev.capFx === 'blast') {
        api.sfx.boom(); api.shake();
        api.fx.burst(px, py, { n: 44, power: 220, size: 5, colors: ['#fbbf24', '#f97316', '#ef4444', COLORS[victim.color]] });
        api.fx.ring(px, py, { radius: 110, color: '#fbbf24', width: 8 });
        await api.tween(640, (k) => { tk.x = lerp(x0, yx, k); tk.y = lerp(y0, yy, k) - Math.sin(k * Math.PI) * 3; tk.rot = k * 18; tk.scale = 1 + Math.sin(k * Math.PI) * .8; }, api.ease.out);
      } else if (ev.capFx === 'bolt') {
        api.sfx.zap();
        api.fx.lightning(px, py, { life: 500 });
        await api.tween(240, (k) => { tk.scale = 1 - k; tk.glow = 1; });
        api.fx.burst(px, py, { n: 22, power: 130, colors: ['#e0f2fe', '#7dd3fc', '#fff'] });
        tk.x = yx; tk.y = yy; tk.glow = 0;
        const [qx, qy] = toStage(yx, yy);
        await api.tween(300, (k) => { tk.scale = k; }, api.ease.back);
        api.fx.lightning(qx, qy, { life: 300, branches: 0 });
      } else {
        api.sfx.whoosh(); api.shake();
        await api.tween(800, (k) => {
          const swirl = k * 18, radius = Math.sin(k * Math.PI) * 1.4;
          tk.x = lerp(x0, yx, k) + Math.cos(swirl) * radius;
          tk.y = lerp(y0, yy, k) + Math.sin(swirl) * radius;
          tk.rot = swirl * 2; tk.scale = 1 - Math.sin(k * Math.PI) * .45;
          const [sx, sy] = toStage(tk.x, tk.y);
          api.fx.burst(sx, sy, { n: 1, power: 26, life: 360, gravity: 0, colors: ['#94a3b8', '#cbd5e1'] });
        }, api.ease.linear);
      }
      tk.rot = 0; tk.scale = 1;
    }
    if (ev.captured.length) await api.banner(`${api.esc(state.players[ev.seat].name)} <b>captured!</b>`, 650);
  }

  async function playMove(ev) {
    const color = state.players[ev.seat].color, tk = tokens[ev.seat][ev.token];
    await walkToken(tk, color, ev);
    if (ev.captured.length) await capture(ev);
    if (ev.star) {
      const [px, py] = toStage(tk.x, tk.y);
      api.sfx.six();
      api.fx.ring(px, py, { color: '#fbbf24', radius: cell * 1.5 });
      api.fx.burst(px, py, { n: 14, power: 70, size: 3, gravity: 30, colors: ['#fbbf24', '#fde68a', '#fff'] });
      await api.tween(420, (k) => { tk.scale = 1 + Math.sin(k * Math.PI) * .4; });
      tk.scale = 1;
    }
    if (ev.to === R.HOME) {
      const [px, py] = toStage(tk.x, tk.y);
      api.sfx.up();
      api.fx.firework(px, py);
      api.fx.burst(px, py, { n: 30, colors: [COLORS[color], '#fff', '#fbbf24'], power: 170 });
      await api.banner('Home <b>safe!</b>', 600);
    }
  }

  /* ---------- view ---------- */
  const view = {
    colorOf: (s, i) => COLORS[s.players[i].color],
    resize(size, ratio) { S = size; dpr = ratio; cell = S / 15; buildStatic(); },
    setState(next) {
      state = next;
      const stars = next.opts.safe === 'on';
      if (stars !== starsOn) { starsOn = stars; buildStatic(); }
      placeAll();
    },
    setPick(moves) { pickable = moves; },
    async play(ev) {
      if (ev.type === 'move') return playMove(ev);
      if (ev.type === 'noMove') { api.note('No moves with that roll'); return; }
      if (ev.type === 'threeSixes') {
        api.sfx.down();
        if (ev.sentBack !== null) {
          const tk = tokens[ev.seat][ev.sentBack], [x0, y0] = [tk.x, tk.y];
          const [yx, yy] = basePoint(state.players[ev.seat].color, R.YARD, ev.sentBack);
          api.banner('Three sixes: <b>token sent back!</b>', 100);
          await api.tween(650, (k) => { tk.x = lerp(x0, yx, k); tk.y = lerp(y0, yy, k) - Math.sin(k * Math.PI) * 2.4; tk.rot = k * 12; });
          tk.rot = 0;
          await api.sleep(350);
        } else await api.banner('Three sixes: <b>turn lost!</b>', 900);
      }
    },
    click(px, py) {
      if (!pickable || !state) return;
      const seat = state.mover, x = px / cell, y = py / cell;
      let best = -1, bestD = 1.15;
      pickable.forEach((ti) => {
        const tk = tokens[seat][ti], d = Math.hypot(tk.x - x, tk.y - y);
        if (d < bestD) { bestD = d; best = ti; }
      });
      if (best >= 0) api.act({ type: 'move', token: best });
    },
    pickByKey(i) { if (pickable?.includes(i)) api.act({ type: 'move', token: i }); },
    draw(g, size, t) {
      if (!staticLayer || !state) return;
      g.drawImage(staticLayer, 0, 0, size, size);
      // the player to move goes on top so that their tokens can always be tapped
      const order = state.players.map((_, i) => i).sort((a, b) => (a === state.mover ? 1 : b === state.mover ? -1 : 0));
      for (const { point: [bx, by], color } of blockCells) {
        g.strokeStyle = COLORS[color]; g.lineWidth = Math.max(2.5, cell * .1);
        g.strokeRect((bx - .46) * cell, (by - .46) * cell, cell * .92, cell * .92);
      }
      for (const seat of order) {
        tokens[seat]?.forEach((tk, ti) => drawPawn(g, state.players[seat].color, tk, seat === state.mover && pickable?.includes(ti)));
      }
    },
    init(a) { api = a; },
  };

  Party.start({
    rules: GameRules,
    view,
    blurb: 'The classic race home for 2 to 4 players. Leave the yard, capture your rivals and get your tokens home first.',
    howTo: 'A 6, a capture or reaching home earns another roll. Set your house rules and game mode when you start a game.',
  });
})();
