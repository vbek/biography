/* Ludo rules — pure game logic with no DOM, run by whichever device is hosting.
   Token positions are relative to the token's colour:
   -1 yard · 0..50 main track · 51..55 home column · 56 home. */
(function (root) {
  'use strict';
  const YARD = -1, LAST_TRACK = 50, HOME = 56;
  const START = [0, 13, 26, 39];                 // track index of each colour's start square
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const COLORS_FOR = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };   // two players sit opposite each other
  const CAPTURE_FX = ['blast', 'bolt', 'tornado'];
  const TEAM_NAMES = ['Team A', 'Team B'];

  const options = [
    { key: 'mode', label: 'Game mode', choices: [
      { value: 'classic', label: 'Classic: all 4 tokens home' },
      { value: 'quick', label: 'Quick: first 2 tokens home, one starts out' },
      { value: 'team', label: 'Team: 2 vs 2, partners sit opposite' },
    ] },
    { key: 'start', label: 'Leaving the yard', choices: [
      { value: 'six', label: 'Roll a 6' },
      { value: 'oneOrSix', label: 'Roll a 1 or a 6' },
    ] },
    { key: 'sixes', label: 'Bonus rolls for 6s', choices: [
      { value: 'cancel', label: 'Three 6s in a row cancels the turn' },
      { value: 'sendBack', label: 'Three 6s sends the last moved token back' },
      { value: 'unlimited', label: 'No limit on 6s' },
    ] },
    { key: 'safe', label: 'Star squares', choices: [
      { value: 'on', label: 'Safe from capture' },
      { value: 'off', label: 'Not safe: captures happen anywhere' },
    ] },
    { key: 'blocks', label: 'Blocks', choices: [
      { value: 'off', label: 'Off: rivals can pass and capture' },
      { value: 'on', label: 'On: 2 tokens together stop rivals (a 6 jumps over)' },
    ] },
  ];
  const withDefaults = (opts = {}) => Object.fromEntries(options.map((o) => [o.key,
    o.choices.some((c) => c.value === opts[o.key]) ? opts[o.key] : o.choices[0].value]));

  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];
  const trackIndex = (color, pos) => (pos + START[color]) % 52;
  const isTeam = (s) => s.opts.mode === 'team';
  const partnerOf = (seat) => (seat + 2) % 4;
  const allied = (s, a, b) => a === b || (isTeam(s) && partnerOf(a) === b);
  const isDone = (s, seat) => s.players[seat].tokens.filter((t) => t === HOME).length >= s.need;
  // in team mode a player whose tokens are all home rolls for their partner
  const moverFor = (s, seat) => (isTeam(s) && isDone(s, seat) ? partnerOf(seat) : seat);

  function newGame(names, rng, chosen) {
    const opts = withDefaults(chosen), colors = COLORS_FOR[names.length];
    const first = opts.mode === 'quick' ? 0 : YARD;
    return {
      opts, need: opts.mode === 'quick' ? 2 : 4,
      players: names.map((name, i) => ({ name, color: colors[i], tokens: [first, YARD, YARD, YARD] })),
      cur: 0, mover: 0, phase: 'roll', die: 0, sixes: 0, lastToken: null, moves: [], ranks: [],
    };
  }

  // a square held by two or more tokens of one rival colour, when blocks are on
  function rivalBlockAt(s, seat, idx) {
    if (s.opts.blocks !== 'on') return false;
    return s.players.some((other, os) => !allied(s, seat, os) &&
      other.tokens.filter((t) => t >= 0 && t <= LAST_TRACK && trackIndex(other.color, t) === idx).length >= 2);
  }

  function canMove(s, seat, tokenIdx, die) {
    const { tokens, color } = s.players[seat], pos = tokens[tokenIdx];
    if (pos === HOME) return false;
    if (pos === YARD) {
      const opens = die === 6 || (s.opts.start === 'oneOrSix' && die === 1);
      return opens && !rivalBlockAt(s, seat, trackIndex(color, 0));
    }
    if (pos + die > HOME) return false;
    // a 6 jumps over blocks but can't land on one, or two blocks facing each other would never end the game
    const firstChecked = die === 6 ? pos + die : pos + 1;
    for (let p = firstChecked; p <= Math.min(pos + die, LAST_TRACK); p++) {
      if (rivalBlockAt(s, seat, trackIndex(color, p))) return false;
    }
    return true;
  }

  function nextTurn(s, events) {
    s.sixes = 0; s.moves = []; s.phase = 'roll'; s.lastToken = null;
    do { s.cur = (s.cur + 1) % s.players.length; } while (s.ranks.includes(s.cur));
    s.mover = moverFor(s, s.cur);
    events.push({ type: 'turn', seat: s.cur, extra: false });
  }

  function finishGame(s, events) {
    s.phase = 'over'; s.moves = [];
    events.push({ type: 'win', seat: s.ranks[0] });
  }

  function doMove(s, tokenIdx, rng, events) {
    const seat = s.mover, p = s.players[seat], from = p.tokens[tokenIdx];
    const to = from === YARD ? 0 : from + s.die;
    p.tokens[tokenIdx] = to;
    s.lastToken = tokenIdx;
    const captured = [];
    let star = false;
    if (to <= LAST_TRACK) {
      const idx = trackIndex(p.color, to), safe = s.opts.safe === 'on' && SAFE.has(idx);
      star = safe && from !== YARD;
      if (!safe) s.players.forEach((other, os) => {
        if (allied(s, seat, os)) return;
        other.tokens.forEach((t, ti) => {
          if (t >= 0 && t <= LAST_TRACK && trackIndex(other.color, t) === idx) {
            captured.push({ seat: os, token: ti, from: t });
            other.tokens[ti] = YARD;
          }
        });
      });
    }
    events.push({ type: 'move', seat, token: tokenIdx, from, to, captured, star, capFx: pick(CAPTURE_FX, rng) });

    const reachedHome = to === HOME;
    if (isTeam(s)) {
      if (isDone(s, seat) && isDone(s, partnerOf(seat))) {
        const a = Math.min(seat, partnerOf(seat));
        s.ranks = [a, partnerOf(a), (a + 1) % 4, (a + 3) % 4];
        finishGame(s, events);
        return;
      }
      s.mover = moverFor(s, s.cur);
    } else if (isDone(s, seat) && !s.ranks.includes(seat)) {
      s.ranks.push(seat);
      events.push({ type: 'finished', seat, place: s.ranks.length });
      const left = s.players.map((_, i) => i).filter((i) => !s.ranks.includes(i));
      if (left.length <= 1) {
        s.ranks.push(...left);
        finishGame(s, events);
        return;
      }
      nextTurn(s, events);
      return;
    }
    if (s.die === 6 || captured.length || reachedHome) {
      s.phase = 'roll'; s.moves = [];
      events.push({ type: 'turn', seat: s.cur, extra: true, why: captured.length ? 'capture' : reachedHome ? 'home' : 'six' });
    } else nextTurn(s, events);
  }

  function apply(prev, action, rng) {
    if (!action || action.seat !== prev.cur) return null;
    const s = JSON.parse(JSON.stringify(prev)), events = [];
    if (action.type === 'roll' && s.phase === 'roll') {
      s.die = 1 + Math.floor(rng() * 6) % 6;
      s.sixes = s.die === 6 ? s.sixes + 1 : 0;
      events.push({ type: 'roll', seat: s.cur, value: s.die });
      if (s.sixes === 3 && s.opts.sixes !== 'unlimited') {
        const ev = { type: 'threeSixes', seat: s.mover, sentBack: null };
        const tokens = s.players[s.mover].tokens;
        // a token that has already reached home is out of reach
        if (s.opts.sixes === 'sendBack' && s.lastToken !== null && tokens[s.lastToken] >= 0 && tokens[s.lastToken] < HOME) {
          ev.sentBack = s.lastToken;
          tokens[s.lastToken] = YARD;
        }
        events.push(ev);
        nextTurn(s, events);
        return { state: s, events };
      }
      s.moves = s.players[s.mover].tokens.map((_, i) => (canMove(s, s.mover, i, s.die) ? i : -1)).filter((i) => i >= 0);
      const tokens = s.players[s.mover].tokens;
      if (!s.moves.length) {
        events.push({ type: 'noMove', seat: s.cur });
        if (s.die === 6) {
          s.phase = 'roll';
          events.push({ type: 'turn', seat: s.cur, extra: true, why: 'six' });
        } else nextTurn(s, events);
      } else if (new Set(s.moves.map((i) => tokens[i])).size === 1) {
        doMove(s, s.moves[0], rng, events);       // only one real choice, so play it
      } else s.phase = 'move';
      return { state: s, events };
    }
    if (action.type === 'move' && s.phase === 'move') {
      if (!s.moves.includes(action.token)) return null;
      doMove(s, action.token, rng, events);
      return { state: s, events };
    }
    return null;
  }

  // used by the host to keep the game moving when a player has dropped off the network
  function autoAction(s) {
    if (s.phase === 'roll') return { type: 'roll' };
    if (s.phase === 'move') return { type: 'move', token: s.moves[0] };
    return null;
  }

  const teamOf = (seat) => TEAM_NAMES[seat % 2];

  const api = {
    id: 'ludo', title: 'Ludo', minPlayers: 2, maxPlayers: 4, defaultPlayers: 4,
    options, newGame, apply, autoAction, canMove,
    seatRange: (opts) => (opts.mode === 'team' ? [4, 4] : [2, 4]),
    seatInfo(s, i) {
      const home = s.players[i].tokens.filter((t) => t === HOME).length + ' / ' + s.need + ' home';
      return isTeam(s) ? teamOf(i) + ' · ' + home : home;
    },
    winnerLabel: (s) => (isTeam(s) ? `${teamOf(s.ranks[0])}: ${s.players[s.ranks[0]].name} & ${s.players[s.ranks[1]].name}` : s.players[s.ranks[0]].name),
    winnerCount: (s) => (isTeam(s) ? 2 : 1),
    START, SAFE, YARD, LAST_TRACK, HOME, trackIndex,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameRules = api;
})(globalThis);
