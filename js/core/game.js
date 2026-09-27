// A game in progress: pure state plus the rules that touch it. No DOM anywhere in here,
// which is what lets test/game.test.mjs and tools/playtest.mjs drive the same object the
// screen does.
//
// This file is also the whole of the runtime's authority over the puzzle: it checks that
// an action changes something, applies it, counts it, and notices when `need` has been
// measured out. It never searches. The route the hint walks is the one the solver found
// at build time and baked into js/data/lots.js — see DESIGN.md §2.1.

import { compile, apply, effective, isGoal, FILL, DUMP, POUR } from './jug.js';

export function createGame(lot) {
  const comp = lot.comp || compile(lot.spec);
  return {
    id: lot.id,
    tier: lot.tier,
    par: lot.par,
    solutions: lot.solutions,
    states: lot.states,
    comp,
    route: lot.route || [],
    start: Uint16Array.from(comp.start),
    pos: Uint16Array.from(comp.start),
    moves: 0,
    history: [],
    done: false,
  };
}

// Two actions are the same move when they are the same operation on the same buckets —
// compared on the fields that mean something, not on object identity or on the `id` the
// search attaches, which is an index into a list this game does not build.
export function sameAction(a, b) {
  if (!a || !b || a.op !== b.op) return false;
  if (a.op === FILL || a.op === DUMP) return a.i === b.i;
  if (a.op === POUR) return a.i === b.i && a.j === b.j;
  return false;
}

// How far a bucket can be pushed at all: the three operations are always well defined,
// so the only question is whether they would change anything. Filling a full bucket,
// emptying an empty one and pouring into one that is already full are not moves, and the
// count must not move for them (the panel greys them out with this).
export function legal(game, action) {
  return !game.done && effective(game.comp, game.pos, action);
}

// Take one action. Returns { moved, reason } — `moved` is true only when the state
// actually changed and the count went up by exactly one.
export function act(game, action) {
  if (game.done) return { moved: false, reason: 'done' };
  if (!effective(game.comp, game.pos, action)) return { moved: false, reason: 'no change' };
  const from = Array.from(game.pos);
  apply(game.comp, game.pos, action, game.pos);
  game.history.push({ action: { op: action.op, i: action.i, j: action.j }, from, to: Array.from(game.pos) });
  game.moves++;
  if (isGoal(game.comp, game.pos)) game.done = true;
  return { moved: true, reason: game.done ? 'measured' : 'ok', action: game.history[game.history.length - 1].action };
}

export function undo(game) {
  const last = game.history.pop();
  if (!last) return false;
  game.pos = Uint16Array.from(last.from);
  game.moves--;
  game.done = false;
  return true;
}

export function reset(game) {
  game.pos = Uint16Array.from(game.start);
  game.moves = 0;
  game.history = [];
  game.done = false;
}

// How many of the player's steps still sit on the baked shortest route, counted from the
// front. Everything the hint can promise comes out of this.
export function onRoute(game) {
  const route = game.route || [];
  let i = 0;
  while (i < game.history.length && i < route.length && sameAction(game.history[i].action, route[i])) i++;
  return i === game.history.length ? i : -1;
}

// The next action of the baked route, and how many are left after it. `off` is honest
// rather than helpful: once the player has left the measured route, this game does not
// re-search the graph on their click, so there is no second opinion to offer — undo back
// onto the route or start again.
export function hint(game) {
  if (game.done) return null;
  const at = onRoute(game);
  if (at < 0) return { off: true };
  if (at >= (game.route || []).length) return { off: true };
  const action = game.route[at];
  return { action, left: (game.route.length - at), index: at };
}

// Actions used against the certified shortest route. The three grades the win screen
// prints are defined here rather than in the markup so the tests can assert them.
export function grade(game) {
  const over = game.moves - game.par;
  if (over <= 0) return { key: 'perfect', label: '分毫不差', stars: 3 };
  if (over <= 3) return { key: 'clean', label: '尚有余量', stars: 2 };
  return { key: 'out', label: '总算量出', stars: 1 };
}
