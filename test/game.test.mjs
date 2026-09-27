// The rules a player touches: js/core/game.js. No search in that file and none here either —
// every expectation below is either hand-written from test/fixture.mjs or read off the baked
// route, so what this suite proves is that the runtime counts the same moves the search
// counted, refuses the ones that change nothing, and never grades itself.

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  createGame, sameAction, legal, act, undo, reset, onRoute, hint, grade,
} from '../js/core/game.js';
import { compile, describe, FILL, DUMP, POUR } from '../js/core/jug.js';
import { CLASSIC, EITHER, THREE_WAY, ODD_OUT } from './fixture.mjs';

// A lot as js/data/lots.js ships one: spec, the measured numbers, and the certified route.
const lot = (extra = {}) => ({
  id: 'test-lot',
  tier: 'measure',
  spec: CLASSIC.spec,
  par: CLASSIC.par,
  solutions: CLASSIC.solutions,
  states: 16,
  route: CLASSIC.route,
  ...extra,
});

const vec = (g) => Array.from(g.pos);
const at = (caps, target, need, start = null) => createGame(lot({
  spec: { caps, target, need, ...(start ? { start } : {}) },
  route: [], par: 0, solutions: 0, states: 0,
}));

test('a new game is the empty bench plus the numbers it was shipped with', () => {
  const g = createGame(lot());
  eq([g.id, g.tier, g.par, g.solutions, g.states], ['test-lot', 'measure', 6, 1, 16], 'the printed numbers come from the file, not from a re-search');
  eq(vec(g), [0, 0], 'every shipped puzzle starts empty');
  eq([g.moves, g.done, g.history.length], [0, false, 0]);
  eq(g.route.length, 6, 'the baked route is carried through untouched');
  eq(g.start instanceof Uint16Array, true, 'positions are typed arrays, which is what keeps act() allocation-free');
  eq(Array.from(g.start), [0, 0]);
  eq(g.comp.k, 2, 'two buckets compiled');
  eq(Array.from(g.comp.caps), [5, 3]);
});

test('the classic route through the rules layer wins on exactly the sixth move', () => {
  // The vectors are the hand-written ones from test/fixture.mjs, step by step.
  const wants = [[5, 0], [2, 3], [2, 0], [0, 2], [5, 2], [4, 3]];
  const g = createGame(lot());
  for (let i = 0; i < CLASSIC.route.length; i++) {
    const res = act(g, CLASSIC.route[i]);
    eq(res.moved, true, `step ${i + 1} is a real move`);
    eq(vec(g), wants[i], `the bench reads ${wants[i]} after step ${i + 1}`);
    eq(g.moves, i + 1, 'one per step, however much water moved');
    eq(g.done, i === 5, `the win is noticed on step six only (${i + 1})`);
  }
  eq(onRoute(g), 6, 'and the whole route was on the certified path');
  eq(g.history[5].to, [4, 3], 'the history keeps the after-state of the winning move');
  eq(g.history[0].action, { op: FILL, i: 0 }, 'and the action that produced it');
});

test('an action that changes nothing is not a move and does not reach the counter', () => {
  const g = at([6, 2], 0, 4);
  eq(legal(g, { op: DUMP, i: 0 }), false, 'draining an empty bucket');
  eq(legal(g, { op: POUR, i: 0, j: 1 }), false, 'pouring from an empty bucket');
  eq(legal(g, { op: FILL, i: 0 }), true, 'filling it is a move');
  for (const a of [{ op: DUMP, i: 0 }, { op: POUR, i: 0, j: 1 }, { op: POUR, i: 1, j: 0 }, { op: DUMP, i: 1 }]) {
    const res = act(g, a);
    eq([res.moved, res.reason], [false, 'no change'], describe(g.comp, a));
  }
  eq([g.moves, g.history.length, vec(g)], [0, 0, [0, 0]], 'four refused gestures, zero counted');
  act(g, { op: FILL, i: 0 });
  eq(g.moves, 1, 'the first real one counts');
  eq(act(g, { op: FILL, i: 0 }).moved, false, 'filling an already full bucket does not');
  eq(g.moves, 1, 'still one');
  eq(act(g, { op: POUR, i: 1, j: 0 }).moved, false, 'and pouring from the empty one into the full one neither');
  eq(g.moves, 1);
});

test('undo gives the water back, the count with it, and the chance to win again', () => {
  const g = createGame(lot());
  eq(undo(g), false, 'nothing to undo on an empty history');
  act(g, CLASSIC.route[0]);
  act(g, CLASSIC.route[1]);
  act(g, CLASSIC.route[2]);
  eq([g.moves, vec(g)], [3, [2, 0]]);
  eq(undo(g), true);
  eq([g.moves, vec(g)], [2, [2, 3]], 'the level goes back as well as the number');
  eq(g.history.length, 2);
  undo(g);
  undo(g);
  eq([g.moves, vec(g), g.history.length], [0, [0, 0], 0], 'undo all the way home');
  eq(undo(g), false, 'and there is no negative move count');
  // Winning locks the bench; undoing the win must unlock it.
  for (const a of CLASSIC.route) act(g, a);
  eq([g.done, g.moves], [true, 6]);
  eq(undo(g), true);
  eq([g.done, g.moves, vec(g)], [false, 5, [5, 2]], 'one step off the win, and the game is live again');
});

test('reset clears the board, the count and the card', () => {
  const g = createGame(lot());
  for (const a of CLASSIC.route.slice(0, 3)) act(g, a);
  reset(g);
  eq([g.moves, vec(g), g.history.length, g.done], [0, [0, 0], 0, false]);
  eq(Array.from(g.start), [0, 0], 'the start vector is not consumed by playing');
  // A start that is not empty goes back to *that*, not to zero.
  const s = at([5, 3], 0, 4, [5, 3]);
  act(s, { op: DUMP, i: 1 });
  eq(vec(s), [5, 0]);
  reset(s);
  eq(vec(s), [5, 3], 'reset returns to the spec start, not to the origin');
});

test('once the number is measured, the game is over', () => {
  const g = createGame(lot());
  for (const a of CLASSIC.route) act(g, a);
  eq(g.done, true);
  const res = act(g, { op: DUMP, i: 0 });
  eq([res.moved, res.reason], [false, 'done'], 'a legal-looking move after the win is refused as finished');
  eq([g.moves, vec(g)], [6, [4, 3]], 'and the winning state stands');
  eq(legal(g, { op: FILL, i: 1 }), false, 'nothing is live on a finished bench');
  eq(hint(g), null, 'and there is nothing left to hint');
});

test('onRoute counts the prefix still on the certified answer', () => {
  const g = createGame(lot());
  eq(onRoute(g), 0, 'no moves, no deviation');
  act(g, CLASSIC.route[0]);
  act(g, CLASSIC.route[1]);
  eq(onRoute(g), 2, 'two steps on the route');
  act(g, { op: FILL, i: 0 });
  eq(onRoute(g), -1, 'one step off it and the answer is no longer a prefix');
  undo(g);
  eq(onRoute(g), 2, 'undoing the deviation puts it back');
  const blind = at([5, 3], 0, 4);
  eq(onRoute(blind), 0, 'a game with no baked route starts consistent');
  act(blind, { op: FILL, i: 0 });
  eq(onRoute(blind), -1, 'and any move is off a route that was never measured');
});

test('hint walks the baked route and refuses to invent one', () => {
  const g = createGame(lot());
  const h0 = hint(g);
  eq(h0.action, { op: FILL, i: 0, j: undefined }, 'the first step of the answer, exactly as baked');
  eq([h0.left, h0.index], [6, 0], 'with six to go including it');
  act(g, CLASSIC.route[0]);
  eq(hint(g).left, 5, 'after playing it, five');
  act(g, { op: FILL, i: 1 });
  eq(hint(g), { off: true }, 'off the route: the hint says so rather than searching for a new one');
  const blind = at([5, 3], 0, 4);
  eq(hint(blind), { off: true }, 'a game shipped without a route has no hint to give');
});

test('grade is three hand-written bands over the measured par', () => {
  eq(grade({ moves: 6, par: 6 }), { key: 'perfect', label: '分毫不差', stars: 3 }, 'matching par is the top band');
  eq(grade({ moves: 3, par: 6 }), { key: 'perfect', label: '分毫不差', stars: 3 }, 'and so, impossibly, is beating it');
  eq(grade({ moves: 7, par: 6 }), { key: 'clean', label: '尚有余量', stars: 2 }, 'one over');
  eq(grade({ moves: 9, par: 6 }), { key: 'clean', label: '尚有余量', stars: 2 }, 'three over is still clean');
  eq(grade({ moves: 10, par: 6 }), { key: 'out', label: '总算量出', stars: 1 }, 'four over is not');
  eq(grade({ moves: 60, par: 6 }).stars, 1, 'and it never goes below one star for a finished puzzle');
  const stars = [5, 6, 7, 9, 10, 12].map((m) => grade({ moves: m, par: 6 }).stars);
  eq(stars, [3, 3, 2, 2, 1, 1], 'the whole ladder in one line: par and under is three, +1..+3 two, past that one');
});

test('sameAction compares what a move means, not the bookkeeping on it', () => {
  eq(sameAction({ op: FILL, i: 1 }, { op: FILL, i: 1 }), true, 'identical');
  eq(sameAction({ op: FILL, i: 1, id: 3 }, { op: FILL, i: 1, id: 7 }), true, 'ids are search indexes and are ignored');
  eq(sameAction({ op: FILL, i: 1 }, { op: FILL, i: 0 }), false, 'a different bucket is a different move');
  eq(sameAction({ op: POUR, i: 0, j: 1 }, { op: POUR, i: 1, j: 0 }), false, 'a pour is not its own reverse');
  eq(sameAction({ op: POUR, i: 0, j: 1 }, { op: POUR, i: 0, j: 1 }), true);
  eq(sameAction({ op: DUMP, i: 0 }, { op: FILL, i: 0 }), false, 'nor is it the same bucket drained');
  eq(sameAction(null, { op: FILL, i: 0 }), false, 'and a missing action matches nothing');
  eq(sameAction({ op: 'spin', i: 0 }, { op: 'spin', i: 0 }), false, 'an operation this game does not have matches nothing');
});

test('the rules layer does not edit what it is handed', () => {
  const g = createGame(lot());
  const action = { op: POUR, i: 0, j: 1 };
  const before = JSON.stringify(action);
  act(g, action);
  eq(JSON.stringify(action), before, 'the caller object is untouched by a refused move');
  act(g, { op: FILL, i: 0 });
  act(g, action);
  eq(g.history[1].action, { op: POUR, i: 0, j: 1 }, 'history stores op and buckets only, never a stale search id');
  eq(Object.keys(g.history[0].action).sort(), ['i', 'j', 'op']);
  eq(JSON.stringify(g.route), JSON.stringify(CLASSIC.route), 'the baked route is not consumed by playing it');
  const spec = JSON.parse(JSON.stringify(CLASSIC.spec));
  const g2 = createGame(lot({ spec }));
  for (const a of CLASSIC.route) act(g2, a);
  eq(JSON.stringify(spec), JSON.stringify(CLASSIC.spec), 'and the spec the game was compiled from is untouched');
});

test('multi-target and three-bucket games finish on the right bucket', () => {
  const any = createGame(lot({ spec: EITHER.spec, route: [], par: 4, solutions: 1, states: 0 }));
  act(any, { op: FILL, i: 1 });
  act(any, { op: POUR, i: 1, j: 0 });
  act(any, { op: FILL, i: 1 });
  eq(any.done, false, 'three moves in and the 3 is nowhere yet');
  act(any, { op: POUR, i: 1, j: 0 });
  eq([any.done, vec(any), any.moves], [true, [7, 3], 4], 'the fourth puts it in the 5-bucket, which counts');
  const first = createGame(lot({ spec: { caps: [7, 5], target: 0, need: 3 }, route: [], par: 6 }));
  for (const a of [{ op: FILL, i: 1 }, { op: POUR, i: 1, j: 0 }, { op: FILL, i: 1 }, { op: POUR, i: 1, j: 0 }]) act(first, a);
  eq([first.done, vec(first)], [false, [7, 3]], 'named to the other bucket, the same position is not a win');
  const three = createGame(lot({ spec: THREE_WAY.spec, route: [], par: THREE_WAY.par }));
  for (const a of [{ op: FILL, i: 1 }, { op: POUR, i: 1, j: 0 }, { op: POUR, i: 1, j: 2 }]) act(three, a);
  eq([three.done, vec(three), three.moves], [true, [2, 0, 1], 3], 'three buckets: the 1 lands in the 10-bucket on move three');
});

test('a game nobody can win is still a well-behaved game', () => {
  const g = createGame(lot({ spec: ODD_OUT.spec, route: [], par: -1, solutions: 0, states: ODD_OUT.reachable }));
  eq(vec(g), [0, 0]);
  let moves = 0;
  // Walk every action from every state the bench can hold, with a hard iteration ceiling:
  // this is a termination check on the rules layer, not a search for anything.
  for (let i = 0; i < 40 && moves < 12; i++) {
    const a = g.comp.acts[i % g.comp.acts.length];
    if (act(g, a).moved) moves++;
    if (g.moves >= 6) reset(g);
  }
  eq(g.done, false, '4 and 6 with a target of 3 never wins, however it is shoved');
  eq(hint(g), { off: true }, 'and it has no route to hint');
  eq(legal(g, { op: FILL, i: 0 }), true, 'the bench is not stuck, the goal just is not on it');
});

run();
