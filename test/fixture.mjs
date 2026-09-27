// Hand-built fixtures. These are the puzzles in the repo whose difficulty a human wrote
// down, because a test needs an expected number that did not come from the same code that
// produced the answer. Each number below is argued in the comment above it, and
// test/solve.test.mjs then proves it twice more without asking the solver: once by replaying
// the written route through js/core/jug.js (an upper bound), once with a shallow exhaustive
// search over state vectors written in the test file (a lower bound).

// The classic. Two buckets, 5 and 3, an unlimited tap and an unlimited drain, and the task
// is 4 units in the 5-bucket. Everyone who has seen Die Hard writes down six pours, and the
// argument is short:
//
//   fill 5        (5,0)
//   5 -> 3        (2,3)   the 5 is left with 2, the only useful amount under 3
//   empty 3       (2,0)
//   5 -> 3        (0,2)   the 2 moves across
//   fill 5        (5,2)
//   5 -> 3        (4,3)   the 5 gives away exactly 1 and is left with 4  <- done
//
// Nothing shorter exists. One move puts 5 or 3 on the bench; two moves can only split a full
// bucket into (2,3), fill both, or empty one again; three moves add (2,0) and (0,2) to that
// vocabulary; four and five moves still only ever show 0, 2, 3 or 5 in the first bucket,
// because a 4 in the 5-bucket needs the 2 to have been parked in the *other* bucket first,
// and that parking plus the refill plus the top-up is exactly what the six moves above do.
// The exhaustive version of that sentence lives in test/solve.test.mjs, which enumerates the
// depth-5 frontier over state vectors with its own search and asserts no `4` appears anywhere
// in the first bucket — that is the counter-proof, and it does not import js/core/solve.js.
export const CLASSIC = {
  spec: { caps: [5, 3], target: 0, need: 4 },
  par: 6,
  solutions: 1,
  route: [
    { op: 'fill', i: 0 },
    { op: 'pour', i: 0, j: 1 },
    { op: 'dump', i: 1 },
    { op: 'pour', i: 0, j: 1 },
    { op: 'fill', i: 0 },
    { op: 'pour', i: 0, j: 1 },
  ],
};

// Not a puzzle at all: asking for 4 in the bucket that holds 3. js/core/jug.js rejects the
// spec structurally, before anybody searches, which is what makes it a validator negative
// rather than a solver negative.
export const TOO_SMALL = {
  spec: { caps: [5, 3], target: 1, need: 4 },
  invalid: 'need larger than the target bucket can hold',
};

// A puzzle with no answer for the reason the theorem is about: gcd(4,6) = 2 and the target is
// 3. Every reachable state has even water in every bucket, so the search must walk the whole
// reachable set and answer "no" — a solver that never answers no is not a solver. The set is
// small: 10 states out of the 35 mixed-radix codes the bucket pair admits, which is itself a
// nice demonstration of how much the divisibility invariant prunes.
export const ODD_OUT = {
  spec: { caps: [4, 6], target: 0, need: 3 },
  par: null,
  space: 35,
  reachable: 10,
};

// Multi-target, and the case where "either bucket counts" changes the printed number.
// Buckets 7 and 5, want 3, either bucket may hold it.
//
//   in the 5-bucket (index 1), four moves:
//   fill 5   (0,5) → 5->7 (5,0) → fill 5 (5,5) → 5->7 (7,3)
//
//   in the 7-bucket (index 0), six moves — and the route is a nice little recursion:
//   fill 5 (0,5) → 5->7 (5,0) → fill 5 (5,5) → 5->7 (7,3) → empty 7 (0,3) → 5->7 (3,0)
//
// Four is the floor for the multi-target question, because with ≤ 3 moves the reachable
// states are exactly (7,0), (0,5), (2,5), (7,5), (5,0), (2,0), (5,5) and (0,0) — no 3 in
// either place — while (7,3) is a four-move state. So par([0,1]) = par([1]) = 4 < par([0]) =
// 6: the multi-target answer is the minimum over the targets, not the answer for whichever
// bucket happens to be listed first. Both numbers are hand-derived above, not read back.
export const EITHER = {
  spec: { caps: [7, 5], target: [0, 1], need: 3 },
  par: 4,
  asSecond: { spec: { caps: [7, 5], target: 1, need: 3 }, par: 4 },
  asFirst: { spec: { caps: [7, 5], target: 0, need: 3 }, par: 6 },
};

// Three buckets, small enough to be certain about. Buckets 2, 3 and 10; the task is 1 in the
// 10-bucket.
//
//   fill 3  (0,3,0) → 3->2 (2,1,0) → 3->10 (2,0,1)     three moves
//
// Two moves is provably not enough: after one move the only amounts on the bench are 2, 3 and
// 10; a second move is either another fill (same three numbers), a dump (back to one filled
// bucket), or a pour whose destination is empty, which therefore drains the source completely
// and leaves 2, 3 or 10 in the other bucket. So the reachable pairs are made of 0, 2, 3, 10
// and never a 1. This fixture exists mostly to prove the mixed-radix encoding and the search
// work for k = 3 and not only for the two-bucket cases every toy implementation demos.
export const THREE_WAY = {
  spec: { caps: [2, 3, 10], target: 2, need: 1 },
  par: 3,
  space: 3 * 4 * 11,
};

// A zero-change move, hand-picked: on any bench at (0,0), `dump 0` and `pour 0→1` change
// nothing, and with bucket 0 already full `fill 0` changes nothing. The counter must not move
// for them (rule in js/core/game.js) and the queue must not grow for them (enqueue rule in
// js/core/solve.js) — otherwise "par" would be counting gestures rather than pours.
export const NO_OPS = {
  spec: { caps: [6, 2], target: 0, need: 4 },
  empty: [0, 0],
  full: [6, 0],
};
