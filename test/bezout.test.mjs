// The external anchor. Everything else in this repo measures difficulty with a search, and a
// search can only tell you what it walked. This file is where the *other* kind of answer comes
// in: for two buckets with a tap and a drain, the amounts you can measure are exactly the
// multiples of gcd(a, b) — a theorem about arithmetic, with no enumeration in it, written in
// js/core/theorem.js and re-derived here with a hand-written Euclid.
//
// pour.md §0 records that the main agent brute-forced this over a, b ∈ 1..9 — 525 and 486
// cases under the two target definitions, 0 mismatches — and says that number has to stop
// being a sentence in a document. So it is a test now: both sweeps are run below at full
// width, the case counts are asserted to be those numbers, and a third, independent
// enumeration (this file's own, over state vectors with string keys) re-checks a sub-box
// so the BFS in js/core/solve.js is not the only search in the room either.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { solve, census } from '../js/core/solve.js';
import { canMeasureAny, canMeasureAt, gcdAll, gcd, reachableAmounts } from '../js/core/theorem.js';
import { validate, stateSpace, SPACE_LIMIT } from '../js/core/jug.js';

// Euclid, written out here rather than imported, so a wrong `gcd` in core cannot agree with
// itself. This one is the subtractive form from the textbook — no `%` anywhere in it, which is
// the point of writing a second copy — with the zero cases answered the way the identity
// gcd(0, n) = n wants them.
function myGcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (a && b && a !== b) {
    if (a > b) a -= b;
    else b -= a;
  }
  return a || b || 1;
}

// A search with no shared machinery with js/core/solve.js: plain vectors, string keys, and the
// question asked is only "is any goal state reachable at all", which is what the theorem is
// about. Bounded by the mixed-radix ceiling of the bucket pair.
function reachableGoal(spec) {
  const caps = spec.caps;
  const k = caps.length;
  const targets = Array.isArray(spec.target) ? spec.target : [spec.target];
  const need = spec.need;
  const at = (v) => v.join(',');
  const start = new Array(k).fill(0);
  const goal = (v) => targets.some((t) => v[t] === need);
  if (goal(start)) return true;
  const seen = new Set([at(start)]);
  const queue = [start];
  for (let h = 0; h < queue.length; h++) {
    const s = queue[h];
    const nexts = [];
    for (let i = 0; i < k; i++) {
      nexts.push(s.map((v, n) => (n === i ? caps[i] : v)));
      nexts.push(s.map((v, n) => (n === i ? 0 : v)));
      for (let j = 0; j < k; j++) {
        if (i === j) continue;
        const m = Math.min(s[i], caps[j] - s[j]);
        nexts.push(s.map((v, n) => (n === i ? v - m : n === j ? v + m : v)));
      }
    }
    for (const t of nexts) {
      if (goal(t)) return true;
      const key = at(t);
      if (!seen.has(key)) { seen.add(key); queue.push(t); }
    }
  }
  return false;
}

test('the gcd this file uses is the gcd core uses, on the numbers a human can check', () => {
  const table = [[5, 3, 1], [4, 6, 2], [9, 6, 3], [7, 7, 7], [1, 9, 1], [12, 18, 6], [13, 14, 1], [0, 5, 5], [8, 0, 8]];
  for (const [a, b, want] of table) {
    eq(gcd(a, b), want, `gcd(${a}, ${b})`);
    eq(myGcd(a, b), want, `the local Euclid agrees on (${a}, ${b})`);
  }
  eq(gcdAll([4, 6, 10]), 2, 'gcdAll folds: gcd(2, 10)');
  eq(gcdAll([5, 3]), 1, 'coprime pair');
  eq(gcdAll([6, 10, 15]), 1, 'no pair of them is coprime but the triple is');
});

test('Bézout against the search: 量得出 in some bucket ⟺ gcd(a,b) | t, over every pair 1..9', () => {
  // Target definition 1: the number may appear in either bucket — the plain reading of "can
  // this be measured out at all". t runs 0..max(a,b): 0 is the empty bench (a goal at par 0),
  // and everything past max(a,b) is structurally impossible because no bucket holds it.
  //
  // The sweep deliberately covers the a = b diagonal, because that is the box pour.md counted
  // 525 and 486 cases in, and because the theorem has an opinion about it (gcd(a,a) = a, so
  // only 0 and a itself). js/core/jug.js's `validate` refuses two buckets of the same
  // capacity — they are a wasted slot, not a puzzle — so that diagonal is asserted as the
  // validator's business rather than the search's: the same 54 cases, tagged below.
  let cases = 0;
  let nonTrivial = 0;
  const mismatches = [];
  const rejected = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      const err = validate({ caps: [a, b], target: [0, 1], need: 0 });
      for (let t = 0; t <= Math.max(a, b); t++) {
        cases++;
        if (t > 0) nonTrivial++;
        if (err) rejected.push(`${a},${b},${t}`);
        const spec = { caps: [a, b], target: [0, 1], need: t };
        const bySearch = solve(spec, { limit: 5000 }).ok;
        const byTheorem = canMeasureAny([a, b], t);
        const byHand = t % myGcd(a, b) === 0 && t <= Math.max(a, b);
        if (!(bySearch === byTheorem && byTheorem === byHand)) {
          mismatches.push(`${a},${b},${t}: search ${bySearch} theorem ${byTheorem} hand ${byHand}`);
        }
      }
    }
  }
  eq(cases, 606, 'a,b ∈ 1..9 with t ∈ 0..max(a,b) is 606 questions');
  eq(nonTrivial, 525, 'and 525 of them are not the trivial t = 0 — the number pour.md quotes');
  eq(mismatches, [], 'search, theorem and hand-written Euclid agree on all 606');
  eq(rejected.length, 54, 'the a=b diagonal is 54 of them');
  eq([...new Set(rejected.map((r) => r.split(',')[0]))].length, 9, 'which is the nine pairs where the validator says "two buckets of the same capacity"');
});

test('Bézout against the search: 量得出 in bucket 1 specifically, the same 486 cases', () => {
  // Target definition 2: a *named* bucket has to hold it, which is where the theorem needs
  // the extra clause — nothing above caps[0] can ever sit in bucket 0, whatever it is a
  // multiple of. t runs 0..a, which is the 486 cases pour.md counts for this definition.
  let cases = 0;
  const mismatches = [];
  const beyondReach = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      for (let t = 0; t <= a; t++) {
        cases++;
        const spec = { caps: [a, b], target: 0, need: t };
        const bySearch = solve(spec, { limit: 5000 }).ok;
        const byTheorem = canMeasureAt([a, b], t, 0);
        const byHand = t % myGcd(a, b) === 0 && t <= a;
        if (!(bySearch === byTheorem && byTheorem === byHand)) {
          mismatches.push(`${a},${b},${t}: search ${bySearch} theorem ${byTheorem} hand ${byHand}`);
        }
        if (t > b && t % myGcd(a, b) === 0) beyondReach.push(`${a},${b},${t}`);
      }
    }
  }
  eq(cases, 486, 'the named-bucket sweep is the second number in the spec');
  eq(mismatches, [], '0 mismatches out of 486, on the stricter question too');
  ok(beyondReach.length > 0, 'the sweep really does cover needs larger than the second bucket');
});

test('a third engine agrees: the independent enumeration matches the theorem on a,b ∈ 1..6', () => {
  // js/core/solve.js is the thing that prints the difficulty, so it is not allowed to be the
  // only search consulted here. reachAll-style, string keys, no typed buffers, no core import.
  let cases = 0;
  let nonTrivial = 0;
  const mismatches = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      for (let t = 0; t <= Math.max(a, b); t++) {
        cases++;
        if (t > 0) nonTrivial++;
        const spec = { caps: [a, b], target: [0, 1], need: t };
        const naive = reachableGoal(spec);
        const bfs = solve(spec, { limit: 5000 }).ok;
        const theorem = canMeasureAny([a, b], t);
        if (!(naive === bfs && bfs === theorem)) {
          mismatches.push(`${a},${b},${t}: naive ${naive} bfs ${bfs} theorem ${theorem}`);
        }
      }
    }
  }
  eq(cases, 197, 'six-by-six, either bucket named: Σ(max(a,b)+1) over 36 pairs is 197 questions');
  eq(nonTrivial, 161, 'of which 161 ask for something other than zero');
  eq(mismatches, [], 'three separate mechanisms, one answer');
});

test('the theorem says no and the search says no, on the pairs that are out of reach', () => {
  const dead = [[4, 6, 3], [4, 6, 1], [6, 10, 5], [8, 12, 2], [2, 8, 3], [6, 9, 4]];
  for (const [a, b, t] of dead) {
    eq(canMeasureAny([a, b], t), false, `${a},${b} can never show ${t}`);
    const r = solve({ caps: [a, b], target: [0, 1], need: t }, { limit: 5000 });
    eq([r.ok, r.par, r.solutions, r.truncated], [false, -1, 0, false], `and the search walks the graph and agrees: ${a},${b},${t}`);
  }
  eq(canMeasureAt([5, 3], 4, 1), false, '4 in the 3-bucket: the target clause bites');
  eq(canMeasureAt([5, 3], 4, 0), true, '4 in the 5-bucket: the classic is measurable');
  eq(canMeasureAny([5, 3], 6), false, 'nothing above both capacities is measurable in anything');
  eq(canMeasureAny([5, 3], -1), false, 'nor is a negative amount');
  eq(canMeasureAny([], 1), false, 'no buckets, no verdict');
  eq(canMeasureAt([5, 3], 1, 7), false, 'a target outside the bench');
});

test('reachableAmounts is the arithmetic the panel quotes', () => {
  eq(reachableAmounts([4, 6]), { gcd: 2, amounts: [0, 2, 4, 6] }, 'the odd ones out: only the even numbers');
  eq(reachableAmounts([5, 3]), { gcd: 1, amounts: [0, 1, 2, 3, 4, 5] }, 'coprime: everything up to the bigger bucket');
  eq(reachableAmounts([6, 10, 15]), { gcd: 1, amounts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }, 'three buckets, gcd 1, ceiling 15');
  eq(reachableAmounts([2, 4]).amounts, [0, 2, 4]);
});

test('for three buckets the predicate is necessary, and that is all it claims', () => {
  // gcd | need is a sound *screen* for any number of buckets (the same invariant: every amount
  // ever on the bench is a multiple of g). Sufficiency is only proven for two, so this asserts
  // the direction the code relies on, and measures the other one instead of asserting it.
  const triples = [[2, 4, 6], [2, 4, 9], [3, 6, 10], [4, 8, 11], [5, 10, 15], [6, 9, 12], [2, 6, 10]];
  let refused = 0;
  let dividesButUnsolvable = [];
  for (const caps of triples) {
    for (let target = 0; target < caps.length; target++) {
      for (let t = 0; t <= caps[target]; t++) {
        const spec = { caps, target, need: t };
        if (validate(spec)) continue;
        const g = gcdAll(caps);
        const bySearch = solve(spec, { limit: SPACE_LIMIT * 2 }).ok;
        if (t % g !== 0) {
          refused++;
          eq(canMeasureAny(caps, t), false, `${caps} gcd ${g} refuses ${t}`);
          eq(bySearch, false, `and the search agrees it is unreachable: ${caps}/${target}/${t}`);
        } else if (!bySearch) {
          dividesButUnsolvable.push(`${caps.join('/')}:${t}`);
        }
      }
    }
  }
  ok(refused > 40, `${refused} indivisible (need, bucket set) pairs checked, every one of them unsolvable`);
  console.log(`    note: k=3 cases where gcd | need yet the search found nothing: ${dividesButUnsolvable.length ? dividesButUnsolvable.join(' ') : 'none at this size'}`);
});

test('the whole two-bucket sweep stays inside the state-space ceiling it is searched under', () => {
  // The 525/486 cross-check is only meaningful if the search that answered it was never
  // truncated. Every pair 1..9 is at most 100 codes.
  let worst = 0;
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      const space = stateSpace([a, b]);
      if (space > worst) worst = space;
      const c = census({ caps: [a, b], target: [0, 1], need: 1 }, 400000);
      eq([c.truncated, space <= SPACE_LIMIT], [false, true], `${a}×${b} censused to completion`);
    }
  }
  eq(worst, 100, 'the largest pair is 10 codes squared');
});

run();
