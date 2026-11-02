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
  const MOVE_FX = ['hop', 'dash', 'spin'];

  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];
  const trackIndex = (color, pos) => (pos + START[color]) % 52;

  function newGame(names) {
    const colors = COLORS_FOR[names.length];
    return {
      players: names.map((name, i) => ({ name, color: colors[i], tokens: [YARD, YARD, YARD, YARD] })),
      cur: 0, phase: 'roll', die: 0, sixes: 0, moves: [], ranks: [],
    };
  }

  const canMove = (pos, die) => pos === YARD ? die === 6 : pos !== HOME && pos + die <= HOME;
  const isDone = (p) => p.tokens.every((t) => t === HOME);

  function nextTurn(s, events) {
    s.sixes = 0; s.moves = []; s.phase = 'roll';
    do { s.cur = (s.cur + 1) % s.players.length; } while (s.ranks.includes(s.cur));
    events.push({ type: 'turn', seat: s.cur, extra: false });
  }

  function doMove(s, tokenIdx, rng, events) {
    const seat = s.cur, p = s.players[seat], from = p.tokens[tokenIdx];
    const to = from === YARD ? 0 : from + s.die;
    p.tokens[tokenIdx] = to;
    const captured = [];
    if (to <= LAST_TRACK) {
      const idx = trackIndex(p.color, to);
      if (!SAFE.has(idx)) s.players.forEach((other, os) => {
        if (os === seat) return;
        other.tokens.forEach((t, ti) => {
          if (t >= 0 && t <= LAST_TRACK && trackIndex(other.color, t) === idx) {
            captured.push({ seat: os, token: ti, from: t });
            other.tokens[ti] = YARD;
          }
        });
      });
    }
    events.push({ type: 'move', seat, token: tokenIdx, from, to, captured, fx: pick(MOVE_FX, rng), capFx: pick(CAPTURE_FX, rng) });

    const reachedHome = to === HOME;
    if (isDone(p) && !s.ranks.includes(seat)) {
      s.ranks.push(seat);
      events.push({ type: 'finished', seat, place: s.ranks.length });
      const left = s.players.map((_, i) => i).filter((i) => !s.ranks.includes(i));
      if (left.length <= 1) {
        s.ranks.push(...left);
        s.phase = 'over'; s.moves = [];
        events.push({ type: 'win', seat: s.ranks[0] });
        return;
      }
      nextTurn(s, events);
      return;
    }
    if (s.die === 6 || captured.length || reachedHome) {
      s.phase = 'roll'; s.moves = [];
      events.push({ type: 'turn', seat, extra: true, why: captured.length ? 'capture' : reachedHome ? 'home' : 'six' });
    } else nextTurn(s, events);
  }

  function apply(prev, action, rng) {
    if (!action || action.seat !== prev.cur) return null;
    const s = JSON.parse(JSON.stringify(prev)), events = [], p = s.players[s.cur];
    if (action.type === 'roll' && s.phase === 'roll') {
      s.die = 1 + Math.floor(rng() * 6) % 6;
      s.sixes = s.die === 6 ? s.sixes + 1 : 0;
      events.push({ type: 'roll', seat: s.cur, value: s.die, fx: Math.floor(rng() * 3) });
      if (s.sixes === 3) {
        events.push({ type: 'threeSixes', seat: s.cur });
        nextTurn(s, events);
        return { state: s, events };
      }
      s.moves = p.tokens.map((t, i) => (canMove(t, s.die) ? i : -1)).filter((i) => i >= 0);
      if (!s.moves.length) {
        events.push({ type: 'noMove', seat: s.cur });
        if (s.die === 6) {
          s.phase = 'roll';
          events.push({ type: 'turn', seat: s.cur, extra: true, why: 'six' });
        } else nextTurn(s, events);
      } else if (new Set(s.moves.map((i) => p.tokens[i])).size === 1) {
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

  const api = {
    id: 'ludo', title: 'Ludo', minPlayers: 2, maxPlayers: 4, defaultPlayers: 4,
    newGame, apply, autoAction, canMove,
    seatInfo: (s, i) => s.players[i].tokens.filter((t) => t === HOME).length + ' / 4 home',
    START, SAFE, YARD, LAST_TRACK, HOME, trackIndex,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameRules = api;
})(globalThis);
