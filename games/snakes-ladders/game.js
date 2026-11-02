/* Snakes & Ladders board: draws the dealt board and acts out every snake, ladder and step. */
(() => {
  'use strict';
  const COLORS = ['#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#a855f7', '#ec4899'];
  const CELLS = ['#fde68a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#ddd6fe', '#fed7aa'];
  const WOOD = [['#78350f', '#b45309'], ['#7c2d12', '#c2410c'], ['#713f12', '#a16207']];
  const lerp = (a, b, k) => a + (b - a) * k;

  let api, S = 0, cell = 0, dpr = 1, state = null, staticLayer = null;
  let tokens = [];              // what's on screen: { x, y, scale, rot, glow } in board units
  let snakeFx = [];             // per snake: { reveal, bulge, wiggle, open, lunge }
  let ladderFx = [];            // per ladder: { reveal, glow }
  let flying = null;            // an extra snake crossing the board during an interlude

  const center = (n) => {
    const i = Math.max(n, 1) - 1, row = Math.floor(i / 10), col = row % 2 ? 9 - i % 10 : i % 10;
    return [col + .5, 9 - row + .5];
  };

  function spot(seat, n) {
    // players sharing a square fan out so that each token stays visible
    const [x, y] = center(n);
    const here = state.players.map((p, i) => [p.pos, i]).filter(([p]) => p === n).map(([, i]) => i);
    const idx = Math.max(0, here.indexOf(seat)), many = Math.max(here.length, 1);
    if (many === 1) return [x, y];
    const a = idx / many * 6.283 - 1.57;
    return [x + Math.cos(a) * .22, y + Math.sin(a) * .22];
  }
  function settleTokens() {
    tokens = state.players.map((_, i) => {
      const [x, y] = spot(i, state.players[i].pos);
      return { x, y, scale: 1, rot: 0, glow: 0 };
    });
  }

  /* ---------- static squares ---------- */
  function buildStatic() {
    if (!S) return;
    staticLayer = document.createElement('canvas');
    staticLayer.width = staticLayer.height = S * dpr;
    const g = staticLayer.getContext('2d');
    g.scale(dpr, dpr);
    for (let n = 1; n <= 100; n++) {
      const [cx, cy] = center(n), x = (cx - .5) * cell, y = (cy - .5) * cell;
      g.fillStyle = CELLS[(n + Math.floor((n - 1) / 10)) % CELLS.length];
      g.fillRect(x, y, cell + .5, cell + .5);
      g.fillStyle = 'rgba(15, 23, 42, .1)';
      g.fillRect(x, y + cell - 1, cell, 1);
      g.fillRect(x + cell - 1, y, 1, cell);
      g.fillStyle = 'rgba(15, 23, 42, .62)';
      g.font = `700 ${Math.max(9, cell * .2)}px system-ui, sans-serif`;
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(n, x + cell * .07, y + cell * .06);
    }
    const [hx, hy] = center(100);
    g.font = `${cell * .5}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🏁', hx * cell, hy * cell + cell * .08);
  }

  /* ---------- ladders ---------- */
  function drawLadder(g, l, fx, t) {
    if (fx.reveal <= 0) return;
    const [ax, ay] = center(l.bottom), [bx, by] = center(l.top);
    const x0 = ax * cell, y0 = ay * cell, x1 = lerp(ax, bx, fx.reveal) * cell, y1 = lerp(ay, by, fx.reveal) * cell;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / len, ny = (x1 - x0) / len, w = cell * .17;
    const [rail, rung] = WOOD[l.tint % WOOD.length];
    g.save();
    g.lineCap = 'round';
    if (fx.glow > 0) { g.shadowColor = `hsl(${(t / 4) % 360} 100% 65%)`; g.shadowBlur = 22 * fx.glow; }
    const rungs = Math.max(2, Math.floor(len / (cell * .34)));
    g.strokeStyle = rung; g.lineWidth = Math.max(2.5, cell * .06);
    for (let i = 1; i < rungs; i++) {
      const k = i / rungs, x = lerp(x0, x1, k), y = lerp(y0, y1, k);
      g.beginPath(); g.moveTo(x - nx * w, y - ny * w); g.lineTo(x + nx * w, y + ny * w); g.stroke();
    }
    g.strokeStyle = fx.glow > 0 ? `hsl(${(t / 4) % 360} 90% 60%)` : rail; g.lineWidth = Math.max(2.5, cell * .07);
    for (const side of [-1, 1]) {
      g.beginPath(); g.moveTo(x0 + nx * w * side, y0 + ny * w * side); g.lineTo(x1 + nx * w * side, y1 + ny * w * side); g.stroke();
    }
    g.restore();
  }

  /* ---------- snakes ---------- */
  // the point at k along the body (0 at the head, 1 at the tail) in board units
  function spineAt(sn, fx, k, t) {
    const [ax, ay] = center(sn.head), [bx, by] = center(sn.tail);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    const envelope = Math.pow(Math.sin(Math.PI * Math.min(1, k + .03)), .6);
    const amp = .38 * (1 + fx.wiggle * 1.1) * envelope * sn.flip;
    const wave = Math.sin(k * 6.283 * sn.waves + sn.phase + t * (.0013 + fx.wiggle * .012));
    const off = amp * wave;
    return [ax + dx * k + nx * off, ay + dy * k + ny * off];
  }
  function drawSnake(g, sn, fx, t) {
    if (fx.reveal <= 0) return;
    const steps = 54, last = Math.floor(steps * fx.reveal), head = cell * .2;
    const radius = (k) => {
      let r = head * (k < .06 ? .78 + k * 3 : Math.pow(1 - k, .7)) + cell * .015;
      if (fx.bulge >= 0) r += cell * .2 * Math.exp(-Math.pow((k - fx.bulge) / .055, 2));
      return r;
    };
    const dark = `hsl(${sn.hue} 62% 22%)`, base = `hsl(${sn.hue} 72% 44%)`, band = `hsl(${(sn.hue + 45) % 360} 88% 62%)`;
    const pts = [];
    for (let i = 0; i <= last; i++) {
      const k = i / steps, [x, y] = spineAt(sn, fx, k, t);
      pts.push([x * cell, y * cell, radius(k), i]);
    }
    g.save();
    g.fillStyle = dark;
    for (const p of pts) { g.beginPath(); g.arc(p[0], p[1], p[2] + 1.6, 0, 6.283); g.fill(); }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      g.fillStyle = Math.floor(p[3] / 4) % 2 ? band : base;
      g.beginPath(); g.arc(p[0], p[1], p[2], 0, 6.283); g.fill();
    }
    // the head, drawn last and pointing away from the neck
    const [hx0, hy0] = spineAt(sn, fx, 0, t), [nx0, ny0] = spineAt(sn, fx, .05, t);
    const angle = Math.atan2(hy0 - ny0, hx0 - nx0);
    const lungeX = Math.cos(angle) * fx.lunge * cell * .3, lungeY = Math.sin(angle) * fx.lunge * cell * .3;
    g.translate(hx0 * cell + lungeX, hy0 * cell + lungeY);
    g.rotate(angle);
    const hl = head * 1.45 * (1 + fx.open * .25), hw = head * 1.08 * (1 + fx.open * .15);
    const flick = (t / 900 + sn.phase) % 1 < .22 || fx.open > .1;
    if (flick) {
      g.strokeStyle = '#ef4444'; g.lineWidth = Math.max(1.2, cell * .022); g.lineCap = 'round';
      const tip = hl + head * (.7 + fx.open * .4);
      g.beginPath(); g.moveTo(hl * .8, 0); g.lineTo(tip, 0);
      g.moveTo(tip, 0); g.lineTo(tip + head * .24, -head * .2);
      g.moveTo(tip, 0); g.lineTo(tip + head * .24, head * .2); g.stroke();
    }
    g.fillStyle = dark;
    g.beginPath(); g.ellipse(0, 0, hl + 1.6, hw + 1.6, 0, 0, 6.283); g.fill();
    g.fillStyle = base;
    g.beginPath(); g.ellipse(0, 0, hl, hw, 0, 0, 6.283); g.fill();
    if (fx.open > .02) {
      g.fillStyle = '#450a0a';
      g.beginPath(); g.moveTo(hl * .1, 0); g.lineTo(hl * 1.02, -hw * .75 * fx.open); g.lineTo(hl * 1.02, hw * .75 * fx.open); g.closePath(); g.fill();
      g.fillStyle = '#fff';
      for (const side of [-1, 1]) { g.beginPath(); g.moveTo(hl * .78, side * hw * .5 * fx.open); g.lineTo(hl * .9, side * hw * .05); g.lineTo(hl * .96, side * hw * .62 * fx.open); g.fill(); }
    }
    const blink = Math.sin(t / 1700 + sn.phase * 3) > .985 ? .15 : 1;
    for (const side of [-1, 1]) {
      g.fillStyle = '#fef9c3';
      g.beginPath(); g.ellipse(hl * .15, side * hw * .55, head * .3, head * .3 * blink, 0, 0, 6.283); g.fill();
      g.fillStyle = '#0f172a';
      g.beginPath(); g.ellipse(hl * .22, side * hw * .55, head * .1, head * .2 * blink, 0, 0, 6.283); g.fill();
    }
    g.restore();
  }

  /* ---------- tokens ---------- */
  function drawToken(g, seat, tk) {
    if (tk.scale <= .01) return;
    const r = cell * .23 * tk.scale, x = tk.x * cell, y = tk.y * cell, c = COLORS[seat % COLORS.length];
    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(0, 0, 0, .28)';
    g.beginPath(); g.ellipse(0, r * .95, r * .85, r * .3, 0, 0, 6.283); g.fill();
    g.rotate(tk.rot);
    if (tk.glow) { g.shadowColor = c; g.shadowBlur = 20 * tk.glow; }
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(0, 0, r + Math.max(1.5, r * .16), 0, 6.283); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = c;
    g.beginPath(); g.arc(0, 0, r, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(255, 255, 255, .3)';
    g.beginPath(); g.ellipse(0, -r * .5, r * .62, r * .34, 0, 0, 6.283); g.fill();
    g.fillStyle = '#fff'; g.font = `800 ${Math.max(9, r * 1.05)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(seat + 1, 0, r * .05);
    g.restore();
  }

  /* ---------- acting out events ---------- */
  const toStage = (bx, by) => api.boardToStage(bx * cell, by * cell);

  async function walk(ev) {
    const tk = tokens[ev.seat], dir = 1;
    for (let n = ev.from + dir; n <= ev.to; n++) {
      const [fx, fy] = [tk.x, tk.y], [tx, ty] = center(n);
      await api.tween(ev.to - ev.from > 4 ? 130 : 170, (k) => {
        tk.x = lerp(fx, tx, k); tk.y = lerp(fy, ty, k) - Math.sin(k * Math.PI) * .42; tk.scale = 1 + Math.sin(k * Math.PI) * .18;
      });
      api.sfx.tick();
    }
    tk.scale = 1;
  }

  async function snakeBite(ev) {
    const sn = state.board.snakes[ev.index], fx = snakeFx[ev.index], tk = tokens[ev.seat];
    const [hx, hy] = center(sn.head);
    api.sfx.hiss();
    api.banner(['Hisss!', 'Snake bite!', 'Sssurprise!', 'Down you go!'][Math.floor(sn.phase * 10) % 4]);
    await api.tween(320, (k) => { fx.open = k; fx.lunge = k * .6; fx.wiggle = k * .5; });
    api.shake();

    if (ev.fx === 'swallow') {
      // gulped whole, then a bulge travels down the body and the snake spits the token out at its tail
      await api.tween(230, (k) => { tk.x = lerp(tk.x, hx, k); tk.y = lerp(tk.y, hy, k); tk.scale = 1 - k; }, api.ease.in);
      api.sfx.down();
      fx.open = 0; fx.lunge = 0;
      await api.tween(1100, (k) => { fx.bulge = k; }, api.ease.linear);
      fx.bulge = -1;
      const [tx, ty] = center(sn.tail), [px, py] = toStage(tx, ty);
      tk.x = tx; tk.y = ty;
      await api.tween(280, (k) => { tk.scale = k; tk.rot = (1 - k) * 8; }, api.ease.back);
      api.fx.burst(px, py, { colors: [`hsl(${sn.hue} 80% 60%)`, '#fff'], n: 22, power: 110 });
    } else if (ev.fx === 'slide') {
      // rides the whole body like a water slide, spinning and throwing off sparks
      api.sfx.down();
      await api.tween(1200, (k) => {
        const [x, y] = spineAt(sn, fx, k, performance.now());
        tk.x = x; tk.y = y; tk.rot = k * 18; fx.wiggle = .5 + Math.sin(k * Math.PI);
        if (Math.random() < .3) { const [px, py] = toStage(x, y); api.fx.burst(px, py, { n: 2, power: 40, life: 400, colors: [`hsl(${sn.hue} 85% 65%)`] }); }
      }, api.ease.in);
    } else {
      // whipped into the air across the board by a thrashing tail
      await api.tween(420, (k) => { fx.wiggle = .5 + k * 1.6; tk.rot = k * 10; });
      api.sfx.down();
      const [x0, y0] = [tk.x, tk.y], [tx, ty] = center(sn.tail);
      await api.tween(800, (k) => {
        tk.x = lerp(x0, tx, k); tk.y = lerp(y0, ty, k) - Math.sin(k * Math.PI) * 2.6;
        tk.scale = 1 + Math.sin(k * Math.PI) * .9; tk.rot = 10 + k * 16;
      }, api.ease.linear);
      api.shake();
      const [px, py] = toStage(tx, ty);
      api.fx.burst(px, py, { n: 26, power: 150, colors: ['#fbbf24', '#f87171', '#fff'] });
      api.fx.ring(px, py, { color: '#f87171' });
      api.sfx.boom();
    }
    await api.tween(260, (k) => { fx.open = (1 - k) * fx.open; fx.lunge = (1 - k) * fx.lunge; fx.wiggle = (1 - k) * fx.wiggle; });
    Object.assign(fx, { open: 0, lunge: 0, wiggle: 0, bulge: -1 });
    tk.rot = 0; tk.scale = 1;
  }

  async function climb(ev) {
    const l = state.board.ladders[ev.index], fx = ladderFx[ev.index], tk = tokens[ev.seat];
    const [ax, ay] = center(l.bottom), [bx, by] = center(l.top);
    fx.glow = 1;
    api.banner(['Going up!', 'Ladder!', 'Sky high!', 'Lucky climb!'][l.bottom % 4]);
    if (ev.fx === 'climb') {
      // hops up rung by rung with a note for each step
      const rungs = Math.max(3, Math.round(Math.hypot(bx - ax, by - ay) * 1.7));
      for (let i = 1; i <= rungs; i++) {
        const k0 = (i - 1) / rungs, k1 = i / rungs;
        await api.tween(85, (k) => {
          const m = lerp(k0, k1, k);
          tk.x = lerp(ax, bx, m); tk.y = lerp(ay, by, m) - Math.sin(k * Math.PI) * .15;
        }, api.ease.linear);
        api.sfx.tick();
      }
      api.sfx.up();
    } else if (ev.fx === 'rocket') {
      // blasts off with a flame trail and shakes the board on the way out
      api.sfx.whoosh();
      api.shake();
      await api.tween(800, (k) => {
        tk.x = lerp(ax, bx, k); tk.y = lerp(ay, by, k); tk.scale = 1 + Math.sin(k * Math.PI) * .55;
        const [px, py] = toStage(tk.x, tk.y);
        api.fx.burst(px, py, { n: 3, power: 45, life: 460, size: 5, gravity: 60, colors: ['#fbbf24', '#f97316', '#ef4444'] });
      }, api.ease.in);
      api.sfx.up();
    } else {
      // floats up in a shower of sparkles
      api.sfx.up();
      await api.tween(1050, (k) => {
        tk.x = lerp(ax, bx, k) + Math.sin(k * 15) * .12; tk.y = lerp(ay, by, k); tk.glow = 1; tk.scale = 1 + Math.sin(k * Math.PI) * .3;
        if (Math.random() < .45) { const [px, py] = toStage(tk.x, tk.y); api.fx.burst(px, py, { n: 3, power: 55, life: 620, size: 3, gravity: 30, colors: ['#fde047', '#fff', '#67e8f9'] }); }
      });
      tk.glow = 0;
    }
    const [px, py] = toStage(bx, by);
    api.fx.ring(px, py, { color: '#fde047', radius: 60 });
    api.fx.burst(px, py, { n: 20, power: 110, colors: ['#fde047', '#34d399', '#fff'] });
    tk.scale = 1;
    fx.glow = 0;
  }

  // the board builds itself, in a different order every game
  async function dealIn() {
    const { snakes, ladders } = state.board;
    const order = [...snakes.map((_, i) => ['s', i]), ...ladders.map((_, i) => ['l', i])].sort(() => api.rng() - .5);
    snakeFx.forEach((f) => { f.reveal = 0; });
    ladderFx.forEach((f) => { f.reveal = 0; });
    api.banner('New board!', 200);
    api.sfx.whoosh();
    const anims = order.map(([kind, i], n) => api.sleep(n * 75).then(() => {
      const f = kind === 's' ? snakeFx[i] : ladderFx[i];
      if (kind === 's' && n % 3 === 0) api.sfx.hiss();
      return api.tween(kind === 's' ? 560 : 340, (k) => { f.reveal = k; });
    }));
    await Promise.all(anims);
  }

  /* ---------- view ---------- */
  const view = {
    interludes: ['loose'],
    colorOf: (_, i) => COLORS[i % COLORS.length],
    resize(size, ratio) { S = size; dpr = ratio; cell = S / 10; buildStatic(); },
    setState(next) {
      const boardChanged = !state || JSON.stringify(state.board) !== JSON.stringify(next.board);
      state = next;
      if (boardChanged) {
        snakeFx = next.board.snakes.map(() => ({ reveal: 1, bulge: -1, wiggle: 0, open: 0, lunge: 0 }));
        ladderFx = next.board.ladders.map(() => ({ reveal: 1, glow: 0 }));
      }
      settleTokens();
    },
    async play(ev) {
      if (ev.type === 'start') return dealIn();
      if (ev.type === 'walk') return walk(ev);
      if (ev.type === 'snake') return snakeBite(ev);
      if (ev.type === 'ladder') return climb(ev);
      if (ev.type === 'overshoot') {
        const tk = tokens[ev.seat], y0 = tk.y;
        api.banner(`Need exactly <b>${ev.need}</b>`, 500);
        await api.tween(420, (k) => { tk.y = y0 - Math.sin(k * Math.PI * 2) * .25; });
        tk.y = y0;
      }
    },
    // a stray snake races across the whole board
    interlude(name) {
      if (name !== 'loose') return false;
      const hue = api.rng() * 360, fromLeft = api.rng() < .5, row = 2 + api.rng() * 6;
      const sn = { head: 0, tail: 0, hue, waves: 1.7, phase: 0, flip: 1 };
      const fx = { reveal: 1, bulge: -1, wiggle: .45, open: .4, lunge: 0 };
      flying = { sn, fx, x: 0, y: row, dir: fromLeft ? 1 : -1 };
      api.sfx.hiss();
      api.banner('Snake on the loose!', 200);
      api.tween(1200, (k) => { flying.x = fromLeft ? lerp(-3, 13, k) : lerp(13, -3, k); }, api.ease.linear).then(() => { flying = null; });
      return true;
    },
    draw(g, size, t) {
      if (!staticLayer || !state) return;
      g.drawImage(staticLayer, 0, 0, size, size);
      state.board.ladders.forEach((l, i) => drawLadder(g, l, ladderFx[i], t));
      state.board.snakes.forEach((sn, i) => drawSnake(g, sn, snakeFx[i], t));
      if (flying) drawFlying(g, t);
      tokens.forEach((tk, i) => drawToken(g, i, tk));
    },
    init(a) { api = a; },
  };

  function drawFlying(g, t) {
    const { sn, x, y, dir } = flying, len = 3.2, N = 34;
    const dark = `hsl(${sn.hue} 62% 22%)`, base = `hsl(${sn.hue} 80% 48%)`, band = `hsl(${(sn.hue + 45) % 360} 90% 65%)`;
    const pos = (k) => [x - dir * len * k, y + Math.sin(k * 8 + t * .018) * .42];
    g.save();
    for (let i = N; i >= 0; i--) {
      const k = i / N, [px, py] = pos(k), r = cell * .2 * Math.pow(1 - k, .55) + 1;
      g.fillStyle = dark; g.beginPath(); g.arc(px * cell, py * cell, r + 1.4, 0, 6.283); g.fill();
      g.fillStyle = Math.floor(i / 3) % 2 ? band : base; g.beginPath(); g.arc(px * cell, py * cell, r, 0, 6.283); g.fill();
    }
    const [hx, hy] = pos(0);
    g.fillStyle = '#fef9c3';
    g.beginPath(); g.arc(hx * cell + dir * cell * .07, hy * cell - cell * .08, cell * .06, 0, 6.283); g.fill();
    g.fillStyle = '#0f172a';
    g.beginPath(); g.arc(hx * cell + dir * cell * .09, hy * cell - cell * .08, cell * .03, 0, 6.283); g.fill();
    g.restore();
  }

  Party.start({
    rules: GameRules,
    view,
    blurb: 'The classic race to 100, on a new random board every game. Land on a snake and watch out, because it might swallow you whole.',
    howTo: 'Land on 100 by exact roll to win. A 6 rolls again.',
  });
})();
