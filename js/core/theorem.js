// The number-theory verdict. This file exists so that "does this puzzle have an answer
// at all?" is decided by something other than the search that also prints the difficulty:
// the two mechanisms agree because a test says so, not because they are the same code.
//
// Theorem (the classic two-jug result, Bézout). With an unlimited tap and an unlimited
// drain, every amount ever present in any bucket is a multiple of g = gcd(a, b):
//   - 0 and c_i are multiples of g;
//   - a pour moves `m = min(v_i, c_j - v_j)` between buckets, and both candidates for m
//     are multiples of g whenever the current contents are.
// So `need` is measurable only if g | need. For two buckets the converse holds as well —
// repeatedly filling one bucket and draining through the other walks its neighbour around
// the circle modulo g, so every multiple of g up to max(a, b) can be produced, and up to
// c_i in bucket i specifically.
//
// Necessity holds for any number of buckets (same invariant, g = gcd of all capacities).
// Sufficiency is only *claimed* here for two buckets, and `test/bezout.test.mjs` is what
// backs the claim by brute force over a,b ∈ 1..9. Three- and four-bucket puzzles are
// still gated by this predicate as a cheap necessary screen, and then decided by the
// search in js/core/solve.js.

export function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function gcdAll(caps) {
  return caps.reduce((g, c) => gcd(g, c), 0);
}

// Is `need` measurable in *some* bucket? For two buckets this is the theorem, so it is
// exact. For three and four it is a necessary condition only: a `true` here means "nothing
// in the arithmetic forbids it", never "it can be done" — that verdict belongs to the
// search in js/core/solve.js, which is why this file returns a plain boolean and marks no
// provisional flag of its own.
export function canMeasureAny(caps, need) {
  if (!Array.isArray(caps) || !caps.length) return false;
  if (need < 0) return false;
  if (need % gcdAll(caps) !== 0) return false;
  return need <= Math.max(...caps);
}

// Is `need` measurable in bucket `target` specifically?
export function canMeasureAt(caps, need, target) {
  if (!Array.isArray(caps) || !Number.isInteger(target) || target < 0 || target >= caps.length) return false;
  if (need < 0) return false;
  if (need % gcdAll(caps) !== 0) return false;
  return need <= caps[target];
}

// The arithmetic the UI quotes when a puzzle is out of reach: which amounts this bucket
// set can ever show. Used by the panel's "量不出" line, so the explanation is the same
// theorem the tests assert rather than a hand-written string.
export function reachableAmounts(caps) {
  const g = gcdAll(caps);
  const out = [];
  for (let t = 0; t <= Math.max(...caps); t++) if (t % g === 0) out.push(t);
  return { gcd: g, amounts: out };
}
