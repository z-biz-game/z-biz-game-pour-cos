// The generator: js/core/make.js. Two things are checked here — that the screens reject what
// they claim to reject, and that the one published claim about the *shape* of an optimal
// water route ("a fill can never be more than half of it") is a property of the model rather
// than of a sample. Every loop below has a ceiling and every sampler call has a wall clock,
// because this file is a test and not the bake.

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  TIERS, tierByKey, routeFeatures, trivialReason, TRIVIAL, TRANSFER_PAR_MAX, makePuzzle,
} from '../js/core/make.js';
import { validate, stateSpace, SPACE_LIMIT, FILL, DUMP, POUR } from '../js/core/jug.js';
import { solve } from '../js/core/solve.js';
import { gcdAll } from '../js/core/theorem.js';
import { CLASSIC } from './fixture.mjs';

// The exhaustive version of the two-bucket screen: every ordered pair of distinct capacities
// up to `max`, every target and every need. Bounded by construction — 2..9 gives 72 specs.
function everyTwoBucket(max = 9) {
  const out = [];
  for (let a = 2; a <= max; a++) {
    for (let b = a + 1; b <= max; b++) {
      for (const target of [0, 1]) {
        for (let need = 1; need <= (target ? b : a); need++) out.push({ caps: [a, b], target, need });
      }
    }
  }
  return out;
}

test('routeFeatures counts the three operations on a hand-written route', () => {
  // The classic: two fills, one drain, three pours, and no water lost is impossible in it.
  eq(routeFeatures(CLASSIC.route), {
    par: 6, fills: 2, dumps: 1, pours: 3, fillShare: 2 / 6, transferOnly: false,
  });
  eq(routeFeatures([]), { par: 0, fills: 0, dumps: 0, pours: 0, fillShare: 0, transferOnly: true }, 'no route, no water moved');
  eq(routeFeatures([{ op: FILL, i: 0 }]).fillShare, 1, 'a one-move answer is all tap');
  eq(routeFeatures([{ op: POUR, i: 0, j: 1 }, { op: POUR, i: 1, j: 0 }]), {
    par: 2, fills: 0, dumps: 0, pours: 2, fillShare: 0, transferOnly: true,
  }, 'two pours and nothing down the drain is the transfer-only family');
  eq(routeFeatures([{ op: DUMP, i: 0 }, { op: DUMP, i: 1 }, { op: POUR, i: 0, j: 1 }]).dumps, 2, 'two drains and one pour');
});

test('the brief\'s "fill share over 80%" cannot fire, and that is a property of the model', () => {
  // pour.md §3 suggests screening trivial puzzles by "解里 fill 占比 > 80%". Measured over
  // every two-bucket puzzle that the generator's own screens would let through, the share
  // never even reaches 0.5: water taken from the tap has to be poured on or dumped away
  // before the answer shows up, so a route of par n has at most n/2 fills. js/core/make.js
  // therefore publishes fillShare as a number and screens with `pureTransfer` instead — which
  // does fire. This test is the reason that comment is allowed to say so.
  const shares = [];
  let searched = 0;
  let screened = 0;
  let brokenInvariant = 0;
  for (const spec of everyTwoBucket()) {
    if (validate(spec)) continue;
    const r = solve(spec, { limit: 40000 });
    if (!r.ok) continue;
    // Necessity, checked on every solvable draw whatever the screens say: nothing off the tap
    // can leave the gcd class the empty bench started in.
    if (spec.need % gcdAll(spec.caps) !== 0) brokenInvariant++;
    if (trivialReason(spec, r)) { screened++; continue; }
    searched++;
    shares.push(routeFeatures(r.path).fillShare);
  }
  eq(brokenInvariant, 0, 'no solvable two-bucket puzzle was drawn with a need the theorem forbids');
  ok(screened > 100, `${screened} of the family are the trivia the screens turn down`);
  ok(searched > 100, `${searched} publishable two-bucket puzzles measured`);
  const worst = Math.max(...shares);
  ok(worst <= 0.5 + 1e-12, `the largest fill share in the whole family is ${worst.toFixed(3)}, not over a half`);
  ok(shares.filter((s) => Math.abs(s - 0.5) < 1e-12).length > 3, 'and a half is reached repeatedly, so the bound is not an artefact of the sample');
  eq(shares.every((s) => s < 0.8), true, 'which is why a > 0.8 screen would accept every puzzle ever generated');
});

test('trivialReason names each kind of non-puzzle it turns down', () => {
  const route = [{ op: FILL, i: 0 }, { op: POUR, i: 0, j: 1 }];
  const rating = (path) => ({ path });
  eq(trivialReason({ caps: [5, 3], target: 0, need: 0 }, rating([])), 'needZero');
  eq(trivialReason({ caps: [5, 3], target: 0, need: 5 }, rating(route)), 'needFullBucket', 'fill the target bucket and you are done: not a measurement');
  eq(trivialReason({ caps: [5, 3], target: [0, 1], need: 3 }, rating(route)), 'needFullBucket', 'and it is trivial against any of several targets too');
  eq(trivialReason({ caps: [5, 3], target: 0, need: 3 }, rating(route)), 'twoActions', 'two moves is not a puzzle');
  eq(trivialReason({ caps: [5, 3], target: 0, need: 2 }, rating([{ op: FILL, i: 0 }, { op: POUR, i: 0, j: 1 }])), 'twoActions');
  eq(trivialReason({ caps: [5, 3], target: 0, need: 2 },
    rating([{ op: FILL, i: 0 }, { op: POUR, i: 0, j: 1 }, { op: POUR, i: 1, j: 0 }, { op: FILL, i: 0 }])),
  'pureTransfer', `nothing down the drain inside ${TRANSFER_PAR_MAX} moves is reading arithmetic, not measuring`);
  eq(trivialReason({ caps: [5, 3], target: 0, need: 4 }, rating(CLASSIC.route)), null, 'the classic passes every screen');
  eq(Object.keys(TRIVIAL).sort(), ['needFullBucket', 'needZero', 'pureTransfer', 'twoActions'], 'the reason codes are exactly the ones the labels describe');
  eq(TRIVIAL.needZero, 'need 是 0');
});

test('the four bands are the measured histogram, they do not overlap, and they are ordered', () => {
  const shape = TIERS.map((t) => [t.key, t.min, t.max]);
  eq(shape, [['drip', 4, 5], ['measure', 6, 7], ['blend', 8, 11], ['decant', 12, 20]], 'the ladder as published');
  for (let i = 1; i < TIERS.length; i++) {
    ok(TIERS[i].min > TIERS[i - 1].max, `${TIERS[i].key} starts above ${TIERS[i - 1].key}'s ceiling`);
  }
  for (const t of TIERS) {
    ok(t.min >= 4, `${t.key} is above the two-move and transfer-only screens, so the band is not wallpapered with trivia`);
    ok(t.buckets[0] >= 2 && t.buckets[1] <= 4, `${t.key} draws ${t.buckets[0]}..${t.buckets[1]} buckets, within the four the model allows`);
    ok(t.caps[1] <= 60, `${t.key} caps stay under the capacity ceiling`);
    ok(t.tries > 0 && t.deadline > 0, `${t.key} has both brakes: ${t.tries} draws and ${t.deadline} ms`);
    ok(t.deadline <= 600, `${t.key}'s one-call budget is short enough to sit inside a click`);
  }
  eq(tierByKey('blend'), TIERS[2], 'tierByKey finds a band');
  eq(tierByKey('nope'), TIERS[0], 'and falls back to the easiest one rather than throwing');
});

test('makePuzzle is deterministic in its seed and honest about its number', () => {
  const drip = tierByKey('drip');
  const a = makePuzzle('det-seed', drip, {}, 4, Date.now() + 400);
  const b = makePuzzle('det-seed', drip, {}, 4, Date.now() + 400);
  ok(a && b, 'the dripper answers for par 4 within its budget');
  eq(JSON.stringify(a.spec), JSON.stringify(b.spec), 'same seed, same bucket set');
  eq(JSON.stringify(a.route), JSON.stringify(b.route), 'same route');
  eq(a.rating.par, 4, 'and the par asked for is the par measured');
  eq(a.seed, 'det-seed');
  eq(a.tier, 'drip');
  eq(validate(a.spec), null, 'which is a structurally legal puzzle');
  eq(stateSpace(a.spec.caps) <= SPACE_LIMIT, true, 'inside the state-space gate');
  eq(a.route.length, 4, 'the shipped route is exactly par long');
  const again = solve(a.spec, { limit: 40000 });
  eq([again.par, again.solutions], [a.rating.par, a.rating.solutions], 'the rating reproduces from the bare spec');
  eq(new Set(a.spec.caps).size, a.spec.caps.length, 'no two buckets of the same capacity');
  const c = makePuzzle('other-seed', drip, {}, 5, Date.now() + 400);
  ok(c, 'par 5 answers too');
  eq(c.rating.par, 5, 'and asking for a different number gets a different number');
  eq(JSON.stringify(c.spec) === JSON.stringify(a.spec), false, 'two seeds, two puzzles');
});

test('the generator is bounded: a band that cannot answer gives up on the clock, not forever', () => {
  // A band that can never be satisfied, with deliberately small brakes. The point is that it
  // returns at all, says null, and tallies what it tried.
  const impossible = { key: 'impossible', label: '不可能', buckets: [2, 2], caps: [4, 6], min: 400, max: 401, tries: 40, deadline: 200 };
  const stats = {};
  const t0 = Date.now();
  const got = makePuzzle('bounded', impossible, stats, 400, t0 + 200);
  ok(got === null, 'nothing is published from a band that has no puzzles in it');
  eq(stats.gaveUp, 1, 'and the give-up is tallied');
  ok((stats.drawn || 0) <= impossible.tries, `it drew at most its ${impossible.tries} tries (${stats.drawn})`);
  ok(stats.bandLow > 0, `everything it found was below the ask: bandLow ${stats.bandLow}`);
  ok(Date.now() - t0 < 5000, `and came back in ${Date.now() - t0} ms`);
  // The other brake: an enormous try count must still stop when the clock says so.
  const forever = { ...impossible, tries: 4000000 };
  const s2 = {};
  const t1 = Date.now();
  eq(makePuzzle('on-the-clock', forever, s2, 400, t1 + 30), null, 'the wall clock outruns the try count');
  ok(s2.timeout > 0, `timeout tallied ${s2.timeout} after ${s2.drawn} draws`);
  ok(s2.drawn < 4000000, `it stopped at ${s2.drawn} draws rather than exhausting ${forever.tries}`);
  const took = Date.now() - t1;
  ok(took < 3000, `and returned in ${took} ms`);
});

test('the ∏(cᵢ+1) gate and the draw screens are enforced by the sampler, not only by validate', () => {
  // Three buckets between 40 and 60 is 74 046 codes at best: over the 20 000 the whole design
  // is sized around. The draw has to refuse them before a search is ever run.
  const wide = { key: 'wide', label: '宽', buckets: [3, 3], caps: [40, 60], min: 4, max: 20, tries: 60, deadline: 300 };
  const stats = {};
  eq(makePuzzle('over-gate', wide, stats, 8, Date.now() + 300), null, 'nothing ships from it');
  ok(stats.spaceOverLimit > 0, `spaceOverLimit fired ${stats.spaceOverLimit} times before any search ran`);
  eq(stats.drawn, stats.spaceOverLimit, 'every single draw was refused on size, so no search was paid for');
  eq(stats.bandLow || 0, 0, 'and the band was never consulted about a puzzle that was too big to draw');
  // The pool of capacities has to be big enough to serve the band's bucket count.
  const thin = { key: 'thin', label: '窄', buckets: [4, 4], caps: [3, 4], min: 4, max: 8, tries: 30, deadline: 200 };
  const s3 = {};
  eq(makePuzzle('not-enough', thin, s3, 6, Date.now() + 200), null);
  ok(s3.notEnoughCapacities > 0, `four distinct buckets cannot be drawn from capacities 3..4 (${s3.notEnoughCapacities} refusals)`);
  eq(s3.drawn, s3.notEnoughCapacities, 'which is the first thing the draw checks');
});

test('an accepted puzzle is one the search certifies, with the trivial ones screened out', () => {
  // Twenty drips, each asked for its own par, checked against everything the model promises.
  const stats = {};
  let n = 0;
  const bad = [];
  for (const want of [4, 5]) {
    for (let s = 0; s < 10 && n < 20; s++) {
      const p = makePuzzle(`sweep-${want}-${s}`, tierByKey('drip'), stats, want, Date.now() + 400);
      n++;
      if (!p) continue;
      if (p.rating.par !== want) bad.push(`${p.seed}: asked ${want}, got ${p.rating.par}`);
      if (validate(p.spec)) bad.push(`${p.seed}: invalid ${validate(p.spec)}`);
      const screen = trivialReason(p.spec, { path: p.route });
      if (screen) bad.push(`${p.seed}: shipped as ${JSON.stringify(p.spec)} is trivial (${screen})`);
      if (p.route.length !== p.rating.par) bad.push(`${p.seed}: route ${p.route.length} vs par ${p.rating.par}`);
      if (p.rating.states > stateSpace(p.spec.caps)) bad.push(`${p.seed}: ${p.rating.states} reachable of ${stateSpace(p.spec.caps)} codes`);
      if (p.spec.need === 0 || p.spec.caps[p.spec.target] === p.spec.need) bad.push(`${p.seed}: trivial need slipped through`);
    }
  }
  eq(bad, [], `${n} sampler calls, every accepted puzzle certified and non-trivial`);
  ok(stats.accepted > 0 && stats.drawn > stats.accepted, `acceptance measured: ${stats.accepted}/${stats.drawn} draws`);
  ok(Object.keys(stats).every((k) => typeof stats[k] === 'number'), 'the tallies are counts, so the bake can print them');
});

run();
