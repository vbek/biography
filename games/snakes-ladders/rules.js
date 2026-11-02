/* Snakes & Ladders rules — pure game logic with no DOM, run by whichever device is hosting.
   Every new game deals a fresh random board. Position 0 is off the board and 100 is the finish. */
(function (root) {
  'use strict';
  const options = [
    { key: 'board', label: 'Board style', choices: [
      { value: 'card', label: 'Traditional cardboard' },
      { value: 'wood', label: 'Deluxe wood' },
      { value: 'raised', label: '3D raised tiles' },
    ] },
    { key: 'overshoot', label: 'Reaching 100', choices: [
      { value: 'exact', label: 'Exact roll: otherwise stay put' },
      { value: 'bounce', label: 'Bounce back the extra spaces' },
    ] },
    { key: 'capture', label: 'Landing on another piece', choices: [
      { value: 'off', label: 'Nothing happens: share the square' },
      { value: 'start', label: 'Capture: send them back to the start' },
      { value: 'swap', label: 'Capture: swap places with them' },
    ] },
    { key: 'entry', label: 'Getting on the board', choices: [
      { value: 'any', label: 'Any roll' },
      { value: 'six', label: 'Roll a 6 to start on square 1' },
      { value: 'oneOrSix', label: 'Roll a 1 or a 6 to start on square 1' },
    ] },
    { key: 'sixes', label: 'Rolling a 6', choices: [
      { value: 'again', label: 'Roll again' },
      { value: 'cancel', label: 'Roll again, but three 6s in a row cancels the turn' },
      { value: 'none', label: 'No extra roll' },
    ] },
    { key: 'layout', label: 'Snakes and ladders on the board', choices: [
      { value: 'classic', label: 'Balanced' },
      { value: 'snakes', label: 'Snake pit: many snakes, few ladders' },
      { value: 'ladders', label: 'Easy climb: many ladders, few snakes' },
      { value: 'sparse', label: 'Open board: few of each' },
    ] },
    { key: 'finish', label: 'Ending the game', choices: [
      { value: 'first', label: 'First to 100 wins' },
      { value: 'all', label: 'Play on for 2nd, 3rd and so on' },
    ] },
  ];
  const withDefaults = (opts = {}) => Object.fromEntries(options.map((o) => [o.key,
    o.choices.some((c) => c.value === opts[o.key]) ? opts[o.key] : o.choices[0].value]));

  const SNAKE_FX = ['swallow', 'slide', 'whip'];
  const LADDER_FX = ['climb', 'rocket', 'lift'];
  const CAPTURE_FX = ['blast', 'bolt', 'tornado'];
  // [fewest, most] of each for every board layout
  const LAYOUTS = {
    classic: { snakes: [6, 8], ladders: [5, 7] },
    snakes: { snakes: [9, 11], ladders: [3, 4] },
    ladders: { snakes: [3, 4], ladders: [9, 11] },
    sparse: { snakes: [3, 4], ladders: [3, 4] },
  };
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

  function dealBoard(rng, layout = 'classic') {
    const counts = LAYOUTS[layout];
    for (;;) {
      const used = new Set([1, 100]), starts = new Map(), snakes = [], ladders = [];
      const free = (...cells) => cells.every((c) => !used.has(c));
      const crowded = (cell) => (starts.get(rowOf(cell)) || 0) >= 2;   // spreads them across the board
      const claim = (start, end) => {
        used.add(start); used.add(end);
        starts.set(rowOf(start), (starts.get(rowOf(start)) || 0) + 1);
      };
      const wantLadders = between(...counts.ladders, rng), wantSnakes = between(...counts.snakes, rng);
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

  function newGame(names, rng, chosen) {
    const opts = withDefaults(chosen);
    return {
      opts,
      players: names.map((name, i) => ({ name, color: i, pos: 0 })),
      cur: 0, phase: 'roll', die: 0, sixes: 0, ranks: [], board: dealBoard(rng, opts.layout),
    };
  }

  function nextTurn(s, events) {
    s.sixes = 0;
    do { s.cur = (s.cur + 1) % s.players.length; } while (s.ranks.includes(s.cur));
    events.push({ type: 'turn', seat: s.cur, extra: false });
  }

  const opensBoard = (opts, die) => opts.entry === 'any' || die === 6 || (opts.entry === 'oneOrSix' && die === 1);

  // only where a piece comes to rest counts, after any snake or ladder
  function captureAt(s, seat, startedAt, rng, events) {
    const here = s.players[seat].pos, mode = s.opts.capture;
    if (mode === 'off' || here === startedAt || here === 100) return;
    const to = mode === 'swap' ? startedAt : 0;
    const victims = [];
    s.players.forEach((other, os) => {
      if (os === seat || other.pos !== here) return;
      other.pos = to;
      victims.push({ seat: os, from: here, to });
    });
    if (victims.length) events.push({ type: 'capture', seat, victims, swap: mode === 'swap', fx: pick(CAPTURE_FX, rng) });
  }

  function finishPlayer(s, seat, events) {
    if (s.opts.finish === 'all') {
      s.ranks.push(seat);
      const left = s.players.map((_, i) => i).filter((i) => !s.ranks.includes(i)).sort((a, b) => s.players[b].pos - s.players[a].pos);
      if (left.length > 1) {
        events.push({ type: 'finished', seat, place: s.ranks.length });
        nextTurn(s, events);
        return;
      }
      s.ranks.push(...left);
    } else {
      s.ranks = s.players.map((_, i) => i).sort((a, b) => (a === seat ? -1 : b === seat ? 1 : s.players[b].pos - s.players[a].pos));
    }
    s.phase = 'over';
    events.push({ type: 'win', seat: s.ranks[0] });
  }

  function apply(prev, action, rng) {
    if (!action || action.seat !== prev.cur || action.type !== 'roll' || prev.phase !== 'roll') return null;
    const s = JSON.parse(JSON.stringify(prev)), events = [], seat = s.cur, p = s.players[seat];
    s.die = 1 + Math.floor(rng() * 6) % 6;
    s.sixes = s.die === 6 ? (s.sixes || 0) + 1 : 0;
    events.push({ type: 'roll', seat, value: s.die });
    if (s.opts.sixes === 'cancel' && s.sixes === 3) {
      events.push({ type: 'threeSixes', seat });
      nextTurn(s, events);
      return { state: s, events };
    }
    const startedAt = p.pos;
    const entering = startedAt === 0 && s.opts.entry !== 'any';
    if (startedAt === 0 && !opensBoard(s.opts, s.die)) {
      events.push({ type: 'noEntry', seat, need: s.opts.entry === 'six' ? 'a 6' : 'a 1 or a 6' });
      nextTurn(s, events);
      return { state: s, events };
    }
    let landed = entering ? 1 : startedAt + s.die;
    const over = landed > 100;
    if (over && s.opts.overshoot !== 'bounce') {
      events.push({ type: 'overshoot', seat, from: p.pos, need: 100 - p.pos });
    } else {
      if (over) landed = 200 - landed;
      events.push({ type: 'walk', seat, from: p.pos, to: landed, bounce: over });
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
      captureAt(s, seat, startedAt, rng, events);
    }
    if (p.pos === 100) finishPlayer(s, seat, events);
    else if (s.die === 6 && s.opts.sixes !== 'none') events.push({ type: 'turn', seat, extra: true, why: 'six' });
    else nextTurn(s, events);
    return { state: s, events };
  }

  const api = {
    id: 'snakes-ladders', title: 'Snakes & Ladders', minPlayers: 2, maxPlayers: 6, defaultPlayers: 2,
    options, newGame, apply, dealBoard, shortestRolls,
    autoAction: (s) => (s.phase === 'roll' ? { type: 'roll' } : null),
    seatInfo: (s, i) => (s.players[i].pos === 100 ? 'Finished' : s.players[i].pos ? 'Square ' + s.players[i].pos : 'Not started'),
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameRules = api;
})(globalThis);
