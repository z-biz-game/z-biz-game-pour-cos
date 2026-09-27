// The generator. There is no hand-authored level file in this repo, and that is
// deliberate: a puzzle is only worth offering once the search says how long it takes.
//
// This runs at build time (tools/bake.mjs) — see that file and DESIGN.md §3 for the
// measured cost. Nothing in the shipped game imports it.
//
// Unlike a traffic-jam puzzle, water is cheap to search: the graph is ∏(c_i+1) and the
// state-space ceiling in js/core/jug.js keeps a full solve at well under a millisecond.
// So the generator here is honest rejection sampling: draw a bucket set, screen it with
// the number-theory predicate, measure it with BFS, and keep it only if the *measured*
// number lands in the band. Every rejection is tallied and test/balance.mjs prints the
// tallies, so the acceptance rate is a published number rather than a hope.

import { validate, stateSpace, SPACE_LIMIT, FILL, DUMP, POUR } from './jug.js';
import { solve, census } from './solve.js';
import { gcdAll } from './theorem.js';
import { rngFrom } from './rng.js';

// A puzzle whose optimal route is a handful of pure transfers with nothing lost down the
// drain is an arithmetic reading rather than a measurement problem, and one that finishes
// in two actions is not a puzzle at all. These are the features that say so, measured off
// the route the search returned — test/balance.mjs prints how often each one fires.
//
// The brief proposed "fill share > 80%". It cannot fire in this model: water taken from the
// tap has to be poured on or dumped away before the answer appears, so fills ≤ par/2 and
// the measured ceiling over 5 000 sampled puzzles is exactly 0.50 — `test/make.test.mjs`
// asserts that as a property of the model. fillShare therefore stays a printed
// measurement, and the family the 80% rule was reaching for is caught by `pureTransfer`,
// which does fire.
export const TRANSFER_PAR_MAX = 4;

export function routeFeatures(route) {
  let fills = 0;
  let dumps = 0;
  let pours = 0;
  for (const a of route) {
    if (a.op === FILL) fills++;
    else if (a.op === DUMP) dumps++;
    else pours++;
  }
  const par = route.length;
  return {
    par,
    fills,
    dumps,
    pours,
    fillShare: par ? fills / par : 0,
    transferOnly: dumps === 0,
  };
}

export const TRIVIAL = {
  needZero: 'need 是 0',
  needFullBucket: 'need 就是目标桶的容量',
  twoActions: '两步之内',
  pureTransfer: `不排水且 ${TRANSFER_PAR_MAX} 步以内的纯倒来倒去`,
};

// Reason code a measured puzzle is not publishable, or null when it is. The band check
// lives in the caller, because the same features are read on their own by the balance rig
// and by test/make.test.mjs.
export function trivialReason(spec, rating) {
  const targets = Array.isArray(spec.target) ? spec.target : [spec.target];
  if (spec.need === 0) return 'needZero';
  for (const t of targets) if (spec.need === spec.caps[t]) return 'needFullBucket';
  const f = routeFeatures(rating.path);
  if (f.par <= 2) return 'twoActions';
  if (f.transferOnly && f.par <= TRANSFER_PAR_MAX) return 'pureTransfer';
  return null;
}

// Draw one candidate. Returns null when the draw itself is structurally unusable
// (capacity product over the ceiling, duplicate capacities, a degenerate need).
// `why` collects the reason, so the caller can tally it.
function draw(rng, tier, why) {
  const k = rng.range(tier.buckets[0], tier.buckets[1]);
  const pool = [];
  for (let c = tier.caps[0]; c <= tier.caps[1]; c++) pool.push(c);
  if (pool.length < k) { why.r = 'notEnoughCapacities'; return null; }
  rng.shuffle(pool);
  const caps = pool.slice(0, k).sort((a, b) => a - b);
  if (stateSpace(caps) > SPACE_LIMIT) { why.r = 'spaceOverLimit'; return null; }
  const target = rng.int(k);
  // need never 0 and never the bucket's own capacity: both are excluded as trivial
  // before a search is ever run, so drawing them would only waste a sample.
  if (caps[target] < 2) { why.r = 'targetTooSmall'; return null; }
  const need = rng.range(1, caps[target] - 1);
  // Cheap structural screen: when `need` is one of the capacities, the answer is "fill
  // that bucket and tip it over", which no search is needed to call trivial.
  if (caps.includes(need)) { why.r = 'needIsACapacity'; return null; }
  const spec = { caps, target, need };
  if (validate(spec)) { why.r = 'invalid'; return null; }
  return spec;
}

// makePuzzle(seed, tier, stats?, want?, deadlineAt?) -> { spec, rating, route, seed, tier } | null.
// Deterministic in the seed: the same string always draws, measures and rejects the same.
//
// `want` pins the accepted par to a single value inside the band. tools/bake.mjs uses it
// because a plain band filter fills every band with its most common number: measured over
// 16 picks the 量取 band came out `6 6 6 6 …`, which is one puzzle wearing sixteen
// costumes. Aiming at each value in turn is what keeps a band a curve.
export function makePuzzle(seed, tier, stats, want, deadlineAt) {
  const rng = rngFrom(`${tier.key}|${want === undefined ? 'band' : want}|${seed}`);
  const hit = (k) => { if (stats) stats[k] = (stats[k] || 0) + 1; };
  const now = Date.now();
  // The caller owns the wall clock: a sampler that only carries its own per-call budget can
  // still be asked for nine par values in a row and quietly take a minute per band.
  const deadline = deadlineAt === undefined ? now + (tier.deadline || 400) : Math.max(deadlineAt, now + 25);
  const lo = want === undefined ? tier.min : want;
  const hi = want === undefined ? tier.max : want;
  let maxExplored = 0;

  for (let i = 0; i < (tier.tries || 6000); i++) {
    if ((i & 63) === 0 && Date.now() > deadline) { hit('timeout'); break; }
    hit('drawn');
    const why = {};
    const spec = draw(rng, tier, why);
    if (!spec) { hit(why.r || 'drawRejected'); continue; }
    // The number-theory screen: cheap, and provably sound as a *necessary* condition.
    // Two-bucket draws never need the search to be told they are impossible.
    if (spec.need % gcdAll(spec.caps) !== 0) { hit('gcdReject'); continue; }
    const rating = solve(spec, { limit: tier.search || 60000, deadline });
    if (!rating.ok) { hit(rating.truncated ? 'truncated' : 'unsolvable'); continue; }
    if (rating.explored > maxExplored) maxExplored = rating.explored;
    if (rating.par < lo) { hit('bandLow'); continue; }
    if (rating.par > hi) { hit('bandHigh'); continue; }
    const trivial = trivialReason(spec, rating);
    if (trivial) { hit(trivial); continue; }
    const c = census(spec, tier.search || 60000);
    hit('accepted');
    return {
      spec,
      rating: {
        par: rating.par,
        solutions: rating.solutions,
        states: c.states,
        depth: c.depth,
        buckets: spec.caps.length,
        explored: rating.explored,
        maxExplored,
        fillShare: routeFeatures(rating.path).fillShare,
      },
      route: rating.path,
      seed,
      tier: tier.key,
    };
  }
  if (stats) stats.gaveUp = (stats.gaveUp || 0) + 1;
  return null;
}

// The generation ladder. `min`/`max` are the band the sampler is allowed to publish in;
// what players see is the band measured off the baked puzzles (TIERS_META in
// js/data/lots.js), so there is only one place that claims a difficulty range.
//
// The bands are read off the 5 000-puzzle histogram in test/balance.mjs (README reproduces
// the command), not decided in advance: two-bucket puzzles only ever come out even, three
// and four buckets fill in the odd numbers, and the top band is reachable only once the
// capacities grow.
//
// `tries` and `deadline` are the two brakes on one call. They are deliberately small: the
// sampler accepts one puzzle per 8-17 draws at these band widths (measured, ~0.2 ms per
// accepted draw), so a few hundred draws is already ten times the expected wait, and a band
// that asks for nine par values in a row must not be able to turn `npm run bake` into a
// minute-long mystery.
export const TIERS = [
  {
    key: 'drip', label: '滴量',
    buckets: [2, 3], caps: [2, 10], min: 4, max: 5, tries: 1200, deadline: 250,
  },
  {
    key: 'measure', label: '量取',
    buckets: [2, 4], caps: [2, 12], min: 6, max: 7, tries: 1500, deadline: 300,
  },
  {
    key: 'blend', label: '勾兑',
    buckets: [2, 4], caps: [2, 12], min: 8, max: 11, tries: 2000, deadline: 400,
  },
  {
    key: 'decant', label: '分注',
    buckets: [2, 4], caps: [3, 14], min: 12, max: 20, tries: 2500, deadline: 600,
  },
];

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}
