// The model: spec validation, the mixed-radix code, and the three operations. Nothing here
// searches, so nothing here can grade a difficulty — which is why this file gets to be the
// one that pins down what a "move" even means. The expectations are written by hand against
// test/fixture.mjs and the comment in js/core/jug.js, not read out of js/core/solve.js.

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  validate, compile, encode, decode, actionSet, apply, effective, eachSuccessor, successors,
  isGoal, describe, toSpec, stateSpace, SPACE_LIMIT, MAX_BUCKETS, MAX_CAP, FILL, DUMP, POUR,
} from '../js/core/jug.js';
import { CLASSIC, TOO_SMALL, ODD_OUT, EITHER, THREE_WAY, NO_OPS } from './fixture.mjs';

const vec = (comp, state) => Array.from(apply(comp, Uint16Array.from(state), { op: POUR, i: 0, j: 1 }));

test('the action set is what the brief says it is: two buckets give six actions', () => {
  const comp = compile({ caps: [5, 3], target: 0, need: 4 });
  const acts = actionSet(comp);
  eq(acts.length, 6, 'fill + dump per bucket, then every ordered pair');
  eq(acts.map((a) => `${a.op}:${a.i}${a.j === undefined ? '' : a.j}`).join(' '),
    'fill:0 dump:0 fill:1 dump:1 pour:01 pour:10', 'and the order is stable, because ids index it');
  eq(acts.every((a, i) => a.id === i), true, 'ids are the index into the list');
});

test('the action count grows with the buckets, and the state space grows faster', () => {
  // k buckets: 2k tap/drain actions plus k(k-1) ordered pours.
  for (const [k, want] of [[2, 6], [3, 12], [4, 20]]) {
    const caps = [2, 3, 5, 7].slice(0, k);
    const acts = actionSet(compile({ caps, target: 0, need: 1 }));
    eq(acts.length, want, `${k} buckets`);
    eq(stateSpace(caps), caps.reduce((n, c) => n * (c + 1), 1));
  }
});

test('validate turns each structural mistake into its own message', () => {
  const good = { caps: [5, 3], target: 0, need: 4 };
  eq(validate(good), null, 'the fixture spec is playable');
  const bad = [
    [{ caps: [], target: 0, need: 0 }, 'no buckets'],
    [null, 'no buckets'],
    [{ caps: [5, 3, 2, 7, 9], target: 0, need: 1 }, `more than ${MAX_BUCKETS} buckets`],
    [{ caps: [5, 5], target: 0, need: 1 }, 'two buckets of the same capacity'],
    [{ caps: [5, 0], target: 0, need: 1 }, 'a bucket with no capacity'],
    [{ caps: [5, MAX_CAP + 1], target: 0, need: 1 }, `capacity ${MAX_CAP + 1} above the ${MAX_CAP} ceiling`],
  ];
  for (const [spec, want] of bad) eq(validate(spec), want, JSON.stringify(spec));
});

test('validate catches the target and need mistakes separately', () => {
  eq(validate({ caps: [5, 3], target: 2, need: 1 }), 'target bucket outside the set');
  eq(validate({ caps: [5, 3], target: [0, 2], need: 1 }), 'target bucket outside the set');
  eq(validate({ caps: [5, 3], target: [], need: 1 }), 'no target bucket');
  eq(validate({ caps: [5, 3], target: 0, need: -1 }), 'negative need');
  eq(validate(TOO_SMALL.spec), TOO_SMALL.invalid, 'asking for 4 in the 3-bucket is a bad spec, not a hard one');
  eq(validate({ caps: [5, 3], target: [0, 1], need: 4 }), null, 'the same need is fine when a target can hold it');
});

test('validate checks the start vector and the state-space ceiling', () => {
  eq(validate({ caps: [5, 3], target: 0, need: 1, start: [1, 1] }), null);
  eq(validate({ caps: [5, 3], target: 0, need: 1, start: [1] }), 'start vector the wrong length');
  eq(validate({ caps: [5, 3], target: 0, need: 1, start: [6, 0] }), 'start amount 6 outside bucket 0');
  // 30 × 31 × 32 = 29 760 codes: over the ceiling the whole design is sized around.
  const over = { caps: [29, 30, 31], target: 0, need: 1 };
  eq(stateSpace(over.caps), 29760);
  ok(stateSpace(over.caps) > SPACE_LIMIT, 'and that is above the limit');
  eq(validate(over), `state space 29760 over the ${SPACE_LIMIT} ceiling`);
  eq(SPACE_LIMIT, 20000, 'the ceiling is the number the brief names');
  // Just under it, and it is accepted: the gate is ∏(c+1) ≤ 20000, not "≤ 20000 for pairs".
  eq(stateSpace([25, 26, 27]), 26 * 27 * 28);
  eq(validate({ caps: [25, 26, 27], target: 0, need: 1 }), null);
});

test('encode and decode are exact inverses over the whole space', () => {
  for (const caps of [[5, 3], [2, 3, 10], [3, 4, 5, 6]]) {
    const comp = compile({ caps, target: 0, need: 1 });
    let n = 0;
    let bad = 0;
    const walk = (i, state) => {
      if (i === comp.k) {
        n++;
        const s = Uint16Array.from(state);
        const code = encode(comp, s);
        const back = decode(comp, code);
        if (Array.from(back).join(',') !== state.join(',')) bad++;
        if (code < 0 || code >= comp.space) bad++;
        return;
      }
      for (let v = 0; v <= caps[i]; v++) { state[i] = v; walk(i + 1, state); }
    };
    walk(0, new Array(caps.length).fill(0));
    eq(n, stateSpace(caps), `every combination enumerated for caps ${caps}`);
    eq(bad, 0, `decode ∘ encode is the identity for caps ${caps}`);
  }
});

test('the code is the mixed-radix number it is claimed to be', () => {
  // Bucket 0 is the least significant digit, base c_0 + 1.
  const comp = compile({ caps: [5, 3], target: 0, need: 4 });
  eq(encode(comp, Uint16Array.from([4, 2])), 4 + 2 * 6);
  eq(encode(comp, Uint16Array.from([0, 0])), 0);
  eq(encode(comp, Uint16Array.from([5, 3])), 23, 'the last code is space - 1');
  eq(comp.space, 6 * 4);
  const three = compile({ caps: [2, 3, 10], target: 0, need: 1 });
  eq(encode(three, Uint16Array.from([1, 2, 3])), 1 + 2 * 3 + 3 * 3 * 4);
});

test('a pour runs until the source is empty or the destination is full, whichever is first', () => {
  const comp = compile({ caps: [5, 3], target: 0, need: 4 });
  eq(vec(comp, [2, 0]), [0, 2], 'source empties first');
  eq(vec(comp, [2, 1]), [0, 3], 'still drains: 2 fits into the 2 of room');
  eq(vec(comp, [5, 0]), [2, 3], 'destination fills first');
  eq(vec(comp, [5, 2]), [4, 3], 'exactly the move the classic needs');
  eq(vec(comp, [0, 3]), [0, 3], 'nothing to give');
  eq(Array.from(apply(comp, Uint16Array.from([3, 1]), { op: FILL, i: 0 })), [5, 1], 'fill tops up to capacity');
  eq(Array.from(apply(comp, Uint16Array.from([3, 1]), { op: DUMP, i: 1 })), [3, 0], 'dump empties one bucket');
  eq(Array.from(apply(comp, Uint16Array.from([3, 1]), { op: FILL, i: 1 })), [3, 3], 'and stops at the rim, never overflows');
});

test('apply never writes through to the state it was handed', () => {
  const comp = compile({ caps: [5, 3], target: 0, need: 4 });
  const before = Uint16Array.from([2, 3]);
  const out = apply(comp, before, { op: POUR, i: 1, j: 0 });
  eq(Array.from(before), [2, 3], 'the input is untouched');
  eq(Array.from(out), [5, 0]);
  const scratch = new Uint16Array(2);
  apply(comp, before, { op: DUMP, i: 1 }, scratch);
  eq(Array.from(scratch), [2, 0], 'and the scratch buffer is where the result goes');
  eq(Array.from(before), [2, 3], 'still untouched');
});

test('effective is false for exactly the zero-change actions', () => {
  const comp = compile({ caps: [5, 3], target: 0, need: 4 });
  const at = (v) => Uint16Array.from(v);
  eq(effective(comp, at(NO_OPS.empty), { op: DUMP, i: 0 }), false, 'draining an empty bucket');
  eq(effective(comp, at(NO_OPS.empty), { op: POUR, i: 0, j: 1 }), false, 'pouring from an empty bucket');
  eq(effective(comp, at(NO_OPS.full), { op: FILL, i: 0 }), false, 'filling a full bucket');
  eq(effective(comp, at([5, 3]), { op: POUR, i: 0, j: 1 }), false, 'pouring into a full bucket');
  eq(effective(comp, at([0, 3]), { op: POUR, i: 1, j: 0 }), true, 'and that same pair is a real move the moment there is room');
  eq(effective(comp, at([2, 3]), { op: DUMP, i: 1 }), true);
  eq(effective(comp, at([2, 3]), { op: FILL, i: 1 }), false);
});

test('successors enumerates only the moves that change something', () => {
  const comp = compile({ caps: [5, 3], target: 0, need: 4 });
  eq(successors(comp, Uint16Array.from([0, 0])).map((s) => s.act.op), [FILL, FILL], 'from empty: fill 0 and fill 1, nothing else');
  eq(successors(comp, Uint16Array.from([0, 0])).map((s) => s.state.join(',')), ['5,0', '0,3']);
  const mid = successors(comp, Uint16Array.from([2, 0]));
  eq(mid.map((s) => `${s.act.op}${s.act.i}${s.act.j === undefined ? '' : s.act.j}`), ['fill0', 'dump0', 'fill1', 'pour01'], 'in action-set order, and dump1 / pour10 are skipped for changing nothing');
  eq(mid.map((s) => s.state.join(',')), ['5,0', '0,0', '2,3', '0,2']);
  let seen = 0;
  eachSuccessor(comp, Uint16Array.from([2, 0]), () => { seen++; });
  eq(seen, 4, 'eachSuccessor and successors agree');
});

test('isGoal is the multi-target predicate, not a fixed bucket', () => {
  const any = compile(EITHER.spec);
  eq(isGoal(any, Uint16Array.from([3, 0])), true, '3 in the 7-bucket counts');
  eq(isGoal(any, Uint16Array.from([0, 3])), true, '3 in the 5-bucket counts too');
  eq(isGoal(any, Uint16Array.from([3, 3])), true, 'in both at once, still a win');
  eq(isGoal(any, Uint16Array.from([4, 2])), false, 'and with the number in neither bucket, not yet');
  const one = compile({ caps: [5, 3], target: 0, need: 4 });
  eq(isGoal(one, Uint16Array.from([0, 4])), false, 'a bucket that is not the target does not win');
  eq(isGoal(one, Uint16Array.from([4, 0])), true);
  eq(isGoal(one, Uint16Array.from([4, 3])), true, 'the other bucket is free');
});

test('toSpec round-trips a compiled spec through JSON', () => {
  for (const spec of [CLASSIC.spec, EITHER.spec, ODD_OUT.spec, THREE_WAY.spec]) {
    const once = toSpec(compile(spec));
    const twice = toSpec(compile(JSON.parse(JSON.stringify(once))));
    eq(twice, once, `stable for ${JSON.stringify(spec)}`);
    eq(twice.caps, spec.caps);
    eq(twice.need, spec.need);
    eq(twice.start, [0, 0, 0].slice(0, spec.caps.length));
  }
  const started = toSpec(compile({ caps: [2, 3], target: 0, need: 1, start: [1, 2] }));
  eq(started.start, [1, 2], 'a non-empty start survives');
});

test('describe names the buckets it touches, which is what the panel prints', () => {
  const comp = compile({ caps: [5, 3], target: 0, need: 4 });
  ok(describe(comp, { op: FILL, i: 0 }).includes('1 号桶'), 'fill mentions the bucket');
  ok(describe(comp, { op: DUMP, i: 1 }).includes('2 号桶'));
  const both = describe(comp, { op: POUR, i: 0, j: 1 });
  ok(both.includes('1 号桶') && both.includes('2 号桶'), `a pour names both: ${both}`);
});

run();
