// The search. Everything in this file is checked against something that is not the search:
// a hand-written route replayed through the model (an upper bound on par), a shallow layered
// enumeration written here in eleven lines (a lower bound), and a second path counter that
// uses plain arrays and string keys instead of mixed-radix codes. If js/core/solve.js is ever
// wrong about a number it prints, this file goes red.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { solve, census } from '../js/core/solve.js';
import {
  compile, apply, effective, isGoal, actionSet, stateSpace, validate, toSpec, SPACE_LIMIT,
} from '../js/core/jug.js';
import { LOTS } from '../js/data/lots.js';
import { CLASSIC, ODD_OUT, TOO_SMALL, EITHER, THREE_WAY } from './fixture.mjs';

// A second, dumber breadth-first search. Plain arrays, string keys, no encode/decode, no
// typed buffers — deliberately not sharing any machinery with the thing under test beyond the
// model itself. Returns { par, solutions, explored, layers } where `solutions` counts
// distinct shortest routes by layering the same way js/core/solve.js claims to.
function brute(spec, maxDepth) {
  const comp = compile(spec);
  const acts = actionSet(comp);
  const key = (a) => a.join(',');
  const start = Array.from(comp.start);
  const dist = new Map([[key(start), 0]]);
  const ways = new Map([[key(start), 1]]);
  let frontier = [start];
  for (let d = 1; d <= maxDepth; d++) {
    const seen = [];
    const next = [];
    for (const s of frontier) {
      const w = ways.get(key(s));
      const from = Uint16Array.from(s);
      for (const a of acts) {
        if (!effective(comp, from, a)) continue; // the same rule, asserted independently below
        const t = Array.from(apply(comp, from, a));
        const k = key(t);
        if (dist.has(k)) {
          if (dist.get(k) === d) seen.push([k, w]);
          continue;
        }
        dist.set(k, d);
        seen.push([k, w]);
        next.push(t);
      }
    }
    for (const [k, w] of seen) ways.set(k, (ways.get(k) || 0) + w);
    const goals = next.filter((t) => isGoal(comp, Uint16Array.from(t)));
    if (goals.length) {
      let total = 0;
      for (const t of goals) total += ways.get(key(t)) || 0;
      return { par: d, solutions: total, explored: dist.size, layers: d };
    }
    frontier = next;
  }
  return { par: null, solutions: 0, explored: dist.size, layers: maxDepth };
}

// How many states are reachable *at all*, and how deep each layer is. This is `brute` with the
// early exit removed — `brute` stops at the first layer containing a goal (that is exactly what
// makes it a lower bound on par), so it can never be asked for the size of the whole graph.
// Nothing here imports js/core/solve.js's census: same model, third implementation.
function reachAll(spec) {
  const comp = compile(spec);
  const acts = actionSet(comp);
  const key = (a) => a.join(',');
  const start = Array.from(comp.start);
  const byDepth = [1];
  const codes = new Set([key(start)]);
  let frontier = [start];
  for (let d = 1; d <= 400; d++) {
    const next = [];
    for (const s of frontier) {
      const from = Uint16Array.from(s);
      for (const a of actionSet(comp)) {
        if (!effective(comp, from, a)) continue;
        const t = Array.from(apply(comp, from, a));
        const k = key(t);
        if (codes.has(k)) continue;
        codes.add(k);
        next.push(t);
      }
    }
    if (!next.length) return { states: codes.size, depth: d - 1, byDepth, codes };
    byDepth.push(next.length);
    frontier = next;
  }
  throw new Error('reachAll ran past its own iteration ceiling');
}

// Replays a route through the model only. Used to turn "the solver says 6" into "6 moves are
// enough", which is half of a proof of optimality; `brute` supplies the other half.
function replay(spec, route) {
  const comp = compile(spec);
  let s = Uint16Array.from(comp.start);
  for (const a of route) {
    ok(effective(comp, s, a), `step ${JSON.stringify(a)} changes nothing, so it is not a legal move`);
    s = apply(comp, s, a);
  }
  ok(isGoal(comp, s), 'the replayed route does not reach the goal');
  return Array.from(s);
}

test('the 3-and-5 bench needs exactly six moves for 4, and six is not an opinion', () => {
  eq(validate(CLASSIC.spec), null);
  eq(replay(CLASSIC.spec, CLASSIC.route).slice(0, 1), [4], 'the hand-written route works');
  const r = solve(CLASSIC.spec, { limit: 60000 });
  eq([r.ok, r.par, r.solutions], [true, CLASSIC.par, CLASSIC.solutions], 'par 6, one shortest route');
  eq(r.path.length, 6);
  eq(replay(CLASSIC.spec, r.path), [4, 3], 'the search route is legal and lands on 4 in the 5-bucket');
});

test('counter-proof: no five-move answer exists, so the search is not reading its own homework', () => {
  const shallow = brute(CLASSIC.spec, 5);
  eq(shallow.par, null, 'the independent enumeration finds nothing within five moves');
  const exact = brute(CLASSIC.spec, 6);
  eq([exact.par, exact.solutions], [6, 1], 'and finds exactly one route at six, by a different path through the code');

  // The frontier itself, spelled out. Within five moves the 5-bucket only ever holds 0, 2, 3
  // or 5 — that is precisely why 4 needs a sixth move — while the full reachable set does
  // contain a 4, so this is a statement about depth and not about reachability.
  const comp = compile(CLASSIC.spec);
  const firsts = new Set();
  const seen = new Set(['0,0']);
  let frontier = [[0, 0]];
  for (let d = 0; d < 5; d++) {
    for (const s of frontier) firsts.add(s[0]);
    const next = [];
    for (const s of frontier) {
      const from = Uint16Array.from(s);
      for (const a of comp.acts) {
        if (!effective(comp, from, a)) continue;
        const t = Array.from(apply(comp, from, a));
        const k = t.join(',');
        if (!seen.has(k)) { seen.add(k); next.push(t); }
      }
    }
    frontier = next;
  }
  eq([...firsts].sort((a, b) => a - b), [0, 2, 3, 5], 'five moves of vocabulary, and 4 is not in it');
  eq([...seen].filter((k) => k.startsWith('4,')), [], 'no state with 4 in the 5-bucket is within five moves');

  // And the space really is bigger than five moves: exactly the 16 states with an empty or a
  // full bucket (2 ends × 4 fills, plus 4 middles × 2 ends), whose last layer is the seventh.
  //
  // That count is checked three ways, because "16" is also what js/core/solve.js's census
  // prints and two searches agreeing is not evidence:
  //   * the closed form, |(x ∈ {0,5}) ∪ (y ∈ {0,3})| = 8 + 12 − 4 = 16 codes out of the 24
  //     the bucket pair admits — a state is reachable exactly when one bucket is at an end,
  //     which is what fill/dump/pour can never undo;
  //   * `reachAll`, which is `brute` with the early exit taken out;
  //   * `census`, the shipped number.
  // `brute` itself cannot answer "how many states in total": it returns at the first goal
  // layer, which for this fixture is the sixth, and 14 of the 16 states are that close. The
  // two left over are the depth-7 pair — the seventh move is not wasted, it is the only way
  // round. (An earlier revision of this test asked `brute` for the 16 and was handed the 14
  // back, which was the test being wrong about its own instrument, not the search being wrong
  // about the puzzle.)
  const all = reachAll(CLASSIC.spec);
  const closed = [];
  for (let x = 0; x <= 5; x++) for (let y = 0; y <= 3; y++) if (x === 0 || x === 5 || y === 0 || y === 3) closed.push(`${x},${y}`);
  eq(closed.length, 16, 'the closed form counts sixteen boundary states out of the 24 codes');
  eq([...all.codes].sort(), closed.sort(), 'and the enumeration reaches exactly those states, neither more nor fewer');
  eq([all.states, all.depth], [16, 7], 'total states and the depth of the farthest one');
  eq(all.byDepth, [1, 2, 3, 2, 2, 2, 2, 2], 'layer by layer, two of them only reachable on the seventh move');
  eq(all.byDepth.reduce((a, b) => a + b, 0), all.states, 'and the layers partition the set');
  const c = census(CLASSIC.spec, 60000);
  eq([c.states, c.depth, c.truncated], [16, 7, false], 'census prints the same 16 and the same 7');
  eq(brute(CLASSIC.spec, 8).explored, all.states - all.byDepth[7],
    'the bounded search has seen fourteen of them: the two it is missing are exactly the depth-7 pair');
});

test('the two searches agree on every baked puzzle, including the number of shortest routes', () => {
  // A sample wide enough to catch an off-by-one in the layering: every par value the pool
  // ships, plus the two-bucket and three-bucket shapes side by side.
  const picked = [];
  const byPar = new Map();
  for (const row of LOTS) {
    if (!byPar.has(row.par)) byPar.set(row.par, row.spec);
  }
  picked.push(...byPar.values());
  picked.push(ODD_OUT.spec, EITHER.spec, THREE_WAY.spec);
  for (const spec of picked) {
    const mine = solve(spec, { limit: 400000 });
    const theirs = brute(spec, mine.ok ? mine.par : 8);
    const s = toSpec(compile(spec));
    eq([mine.ok, mine.par, mine.solutions], [theirs.par !== null, theirs.par === null ? -1 : theirs.par, theirs.solutions],
      `searches disagree on ${JSON.stringify(s)}`);
    ok(stateSpace(spec.caps) <= SPACE_LIMIT, `${JSON.stringify(spec.caps)} is inside the ceiling the gate enforces`);
  }
  ok(picked.length >= 10, `cross-checked ${picked.length} specs across every par the pool ships`);
});

test('unsolvable is answered as unsolvable, and the theorem says why', () => {
  const r = solve(ODD_OUT.spec, { limit: 60000 });
  eq([r.ok, r.par, r.solutions, r.truncated], [false, -1, 0, false], 'a clean no, not a timeout');
  eq(r.explored, ODD_OUT.reachable, 'it walked the whole reachable set and stopped');
  eq(stateSpace(ODD_OUT.spec.caps), ODD_OUT.space);
  ok(r.explored < ODD_OUT.space, 'and the reachable set is smaller than the code space');
  const c = census(ODD_OUT.spec, 60000);
  eq([c.states, c.depth, c.truncated], [r.explored, 4, false], 'census agrees with the search about what is reachable');
  eq(solve(TOO_SMALL.spec, { limit: 60000 }).ok, false, '4 in the 3-bucket: also no');
});

test('multi-target par is the minimum over the targets, hand-derived for both single targets', () => {
  const any = solve(EITHER.spec, { limit: 60000 });
  const second = solve(EITHER.asSecond.spec, { limit: 60000 });
  const first = solve(EITHER.asFirst.spec, { limit: 60000 });
  eq([any.par, second.par, first.par], [EITHER.par, EITHER.asSecond.par, EITHER.asFirst.par], '4, 4 and 6');
  eq(any.par, Math.min(first.par, second.par), 'the multi-target answer is the cheaper of the two');
  ok(first.par > any.par, 'and asking for a specific bucket really is harder — the predicate matters');
  const land = replay(EITHER.spec, any.path);
  eq(land[1], 3, 'the four-move answer puts the 3 in the 5-bucket, the one that pays for it');
  eq(replay(EITHER.asFirst.spec, first.path)[0], 3, 'the six-move answer puts it in the 7-bucket');
  eq(brute(EITHER.spec, 3).par, null, 'and three moves provably do not, which is the floor on 4');
});

test('three buckets search, and the mixed-radix code covers them', () => {
  eq(THREE_WAY.space, stateSpace(THREE_WAY.spec.caps));
  const r = solve(THREE_WAY.spec, { limit: 60000 });
  eq([r.ok, r.par], [true, THREE_WAY.par], 'par 3, as argued by hand in test/fixture.mjs');
  eq(replay(THREE_WAY.spec, r.path)[2], 1, 'the 1 lands in the 10-bucket');
  const b = brute(THREE_WAY.spec, 4);
  eq([b.par, b.solutions], [r.par, r.solutions], 'and the dumb search agrees, including on two ways to do it');
  eq(census(THREE_WAY.spec, 60000).truncated, false);
});

test('zero-change actions are never enqueued, which is the only way BFS terminates here', () => {
  // One bucket: fill and dump are each other's inverse and both are no-ops at the wrong end.
  // A search that enqueued "fill an already full bucket" would be adding a self-loop at every
  // node and would never answer.
  const one = solve({ caps: [2], target: 0, need: 2 }, { limit: 60000 });
  eq([one.ok, one.par, one.solutions, one.explored], [true, 1, 1, 2], 'fill once: two states, one move');
  eq(Array.from(compile({ caps: [2], target: 0, need: 2 }).acts).length, 2, 'and a single bucket has exactly two actions');
  const none = solve({ caps: [3], target: 0, need: 1 }, { limit: 60000 });
  eq([none.ok, none.explored], [false, 2], 'a lone 3-bucket measures 0 or 3, and the search stops after both');
  // The self-loop claim, checked against the model directly.
  const comp = compile({ caps: [2], target: 0, need: 2 });
  const full = Uint16Array.from([2]);
  eq(effective(comp, full, { op: 'fill', i: 0 }), false, 'filling a full bucket changes nothing');
  eq(effective(comp, Uint16Array.from([0]), { op: 'dump', i: 0 }), false, 'so does emptying an empty one');
});

test('the search is a function: same in, same out, inputs untouched', () => {
  const spec = JSON.parse(JSON.stringify(CLASSIC.spec));
  const frozen = JSON.stringify(spec);
  const a = solve(spec, { limit: 60000 });
  eq(JSON.stringify(spec), frozen, 'solve did not edit the spec it was handed');
  const b = solve(spec, { limit: 60000 });
  eq([a.par, a.solutions, a.explored], [b.par, b.solutions, b.explored], 'deterministic');
  eq(a.path, b.path, 'the same route, not merely the same length');
  // (5,0) is the first state of the six-move classic, so five moves must be enough from it;
  // and if four were, prepending one fill would make the classic five, which the counter-proof
  // above just disproved by enumeration. par = 5 is a consequence of the fixture, not a
  // number read back out of the solver.
  const onRoute = { caps: [5, 3], target: 0, need: 4, start: [5, 0] };
  eq(solve(onRoute, { limit: 60000 }).par, 5, 'one move down the classic route, one move off the answer');
  eq(JSON.stringify(onRoute), JSON.stringify({ caps: [5, 3], target: 0, need: 4, start: [5, 0] }), 'the start vector survived the call');
  // A start that is not on any shortest route costs more: (0,3) has to waste a move getting
  // the 3 out of the way before the six-move dance can begin, so 7 = 1 + 6 exactly.
  eq(solve({ caps: [5, 3], target: 0, need: 4, start: [0, 3] }, { limit: 60000 }).par, 7);
  eq(solve({ caps: [5, 3], target: 0, need: 4, start: [4, 0] }, { limit: 60000 }).par, 0, 'already measured: no search at all');
});

test('budgets are honoured instead of the machine being eaten', () => {
  // The node budget is tested on the fixture, not on a big capacity product. A 3 360-code
  // space is no obstacle at all — {13,14,15} measures 1 in the 13-bucket in three moves, and
  // the 32 nodes that takes fit inside any budget, so the previous revision of this test
  // asked for a stop that this spec never needs and was handed back an answer. The fixture
  // graph is the one whose shape is known independently: 16 states, answer at depth 6, so a
  // budget of 8 nodes is *asked* to give up before the goal, and the same spec at 14 answers.
  const starved = solve(CLASSIC.spec, { limit: 8 });
  eq([starved.ok, starved.truncated], [false, true], 'an 8-node budget on a 16-node graph stops early and says so');
  eq([starved.par, starved.solutions, starved.path.length], [-1, 0, 0], 'a truncated search prints no difficulty');
  ok(starved.explored <= 8, `it stayed inside the budget it was given (${starved.explored} nodes)`);
  const answered = solve(CLASSIC.spec, { limit: 14 });
  eq([answered.ok, answered.truncated, answered.par, answered.solutions], [true, false, 6, 1], 'the same spec at its own size answers');
  eq(answered.explored, 14, 'and needs every one of those fourteen nodes: the two depth-7 states are never touched');
  eq(census(CLASSIC.spec, 8), { states: 8, depth: 2, truncated: true }, 'census is capped by the same limit');

  // The wall clock. `solve` polls it every 256 visited nodes, so the spec here is one whose
  // answer genuinely costs more than a poll: {13,14,15} asking for 7 in the 15-bucket is a
  // 1 176-state graph and a thirteen-move answer, and an expired deadline now stops it at the
  // first step rather than letting it finish and reporting the answer as if the budget had
  // never been mentioned. (It used to: the poll sat below the layer skip in the loop, so a
  // search that had found its goal and was only walking the tail never looked at the clock.)
  const deep = { caps: [13, 14, 15], target: 2, need: 7 };
  eq(stateSpace(deep.caps), 14 * 15 * 16, 'a big code space');
  ok(census(deep, 400000).states > 512, 'and a reachable set bigger than one poll of the clock');
  const dead = solve(deep, { limit: 400000, deadline: Date.now() - 1 });
  eq([dead.ok, dead.par, dead.truncated], [false, -1, true], 'an expired deadline stops it before the first expansion');
  const room = solve(deep, { limit: 400000, deadline: Date.now() + 5000 });
  eq([room.ok, room.truncated, room.par], [true, false, 13], 'a deadline with room to spare answers the same question');
  ok(room.explored > 256, `and the answer is past the first poll (${room.explored} nodes)`);
  eq([solve(deep, { limit: 40 }).ok, solve(deep, { limit: 40 }).truncated], [false, true], 'the node budget binds on the same spec');
});

run();
