/* Snakes & Ladders rules — pure game logic with no DOM, run by whichever device is hosting.
   Every new game deals a fresh random board. Position 0 is off the board; 100 wins, by exact roll. */
(function (root) {
  'use strict';
  const SNAKE_FX = ['swallow', 'slide', 'whip'];
  const LADDER_FX = ['climb', 'rocket', 'lift'];
  const rowOf = (n) => Math.floor((n - 1) / 10);
  const between = (a, b, rng) => a + Math.floor(rng() * (b - a + 1)) % (b - a + 1);
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

  const gridPoint = (n) => {
    const i = n - 1, row = Math.floor(i / 10);
    return [row % 2 ? 9 - i % 10 : i % 10, row];
  };
  // whether two straight runs between squares cross, so that the board stays readable
  function crosses(a0, a1, b0, b1) {
    const [p, q, r, s] = [a0, a1, b0, b1].map(gridPoint);
    const side = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    return side(p, q, r) * side(p, q, s) <= 0 && side(r, s, p) * side(r, s, q) <= 0;
  }

  // shortest number of rolls from the start to 100, or Infinity when 100 can't be reached
  function shortestRolls(jump) {
    const dist = new Map([[0, 0]]), queue = [0];
    while (queue.length) {
      const at = queue.shift();
      for (let d = 1; d <= 6; d++) {
        if (at + d > 100) continue;
        const to = jump.get(at + d) ?? at + d;
        if (dist.has(to)) continue;
        dist.set(to, dist.get(at) + 1);
        if (to === 100) return dist.get(to);
        queue.push(to);
      }
    }
    return Infinity;
  }

  function dealBoard(rng) {
    for (;;) {
      const used = new Set([1, 100]), starts = new Map(), snakes = [], ladders = [];
      const free = (...cells) => cells.every((c) => !used.has(c));
      const crowded = (cell) => (starts.get(rowOf(cell)) || 0) >= 2;   // spreads them across the board
      const claim = (start, end) => {
        used.add(start); used.add(end);
        starts.set(rowOf(start), (starts.get(rowOf(start)) || 0) + 1);
      };
      const wantLadders = between(5, 7, rng), wantSnakes = between(6, 8, rng);
      for (let i = 0; ladders.length < wantLadders && i < 400; i++) {
        const bottom = between(2, 85, rng), top = Math.min(99, bottom + between(9, 38, rng));
        if (rowOf(top) === rowOf(bottom) || !free(bottom, top) || crowded(bottom)) continue;
        if (ladders.some((l) => crosses(bottom, top, l.bottom, l.top))) continue;
        claim(bottom, top);
        ladders.push({ bottom, top, tint: between(0, 2, rng) });
      }
      for (let i = 0; snakes.length < wantSnakes && i < 400; i++) {
        const head = between(14, 99, rng), tail = Math.max(2, head - between(9, 48, rng));
        if (rowOf(head) === rowOf(tail) || !free(head, tail) || crowded(head)) continue;
        if (snakes.some((x) => crosses(head, tail, x.head, x.tail))) continue;
        claim(head, tail);
        snakes.push({ head, tail, hue: between(0, 360, rng), waves: 1 + rng() * 1.4, phase: rng() * 6.28, flip: rng() < .5 ? 1 : -1 });
      }
      if (snakes.length < wantSnakes || ladders.length < wantLadders) continue;
      const jump = new Map([...snakes.map((s) => [s.head, s.tail]), ...ladders.map((l) => [l.bottom, l.top])]);
      const rolls = shortestRolls(jump);
      if (rolls >= 6 && rolls !== Infinity) return { snakes, ladders };
    }
  }

  function newGame(names, rng) {
    return {
      players: names.map((name, i) => ({ name, color: i, pos: 0 })),
      cur: 0, phase: 'roll', die: 0, ranks: [], board: dealBoard(rng),
    };
  }

  function apply(prev, action, rng) {
    if (!action || action.seat !== prev.cur || action.type !== 'roll' || prev.phase !== 'roll') return null;
    const s = JSON.parse(JSON.stringify(prev)), events = [], seat = s.cur, p = s.players[seat];
    s.die = 1 + Math.floor(rng() * 6) % 6;
    events.push({ type: 'roll', seat, value: s.die, fx: Math.floor(rng() * 3) });
    const landed = p.pos + s.die;
    if (landed > 100) {
      events.push({ type: 'overshoot', seat, from: p.pos, need: 100 - p.pos });
    } else {
      events.push({ type: 'walk', seat, from: p.pos, to: landed });
      p.pos = landed;
      const snake = s.board.snakes.findIndex((x) => x.head === landed);
      const ladder = s.board.ladders.findIndex((x) => x.bottom === landed);
      if (snake >= 0) {
        p.pos = s.board.snakes[snake].tail;
        events.push({ type: 'snake', seat, index: snake, from: landed, to: p.pos, fx: pick(SNAKE_FX, rng) });
      } else if (ladder >= 0) {
        p.pos = s.board.ladders[ladder].top;
        events.push({ type: 'ladder', seat, index: ladder, from: landed, to: p.pos, fx: pick(LADDER_FX, rng) });
      }
    }
    if (p.pos === 100) {
      s.phase = 'over';
      s.ranks = s.players.map((_, i) => i).sort((a, b) => (a === seat ? -1 : b === seat ? 1 : s.players[b].pos - s.players[a].pos));
      events.push({ type: 'win', seat });
    } else if (s.die === 6) {
      events.push({ type: 'turn', seat, extra: true, why: 'six' });
    } else {
      s.cur = (s.cur + 1) % s.players.length;
      events.push({ type: 'turn', seat: s.cur, extra: false });
    }
    return { state: s, events };
  }

  const api = {
    id: 'snakes-ladders', title: 'Snakes & Ladders', minPlayers: 2, maxPlayers: 6, defaultPlayers: 2,
    newGame, apply, dealBoard, shortestRolls,
    autoAction: (s) => (s.phase === 'roll' ? { type: 'roll' } : null),
    seatInfo: (s, i) => (s.players[i].pos ? 'Square ' + s.players[i].pos : 'Not started'),
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameRules = api;
})(globalThis);
