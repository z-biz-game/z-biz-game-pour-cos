// The shipped puzzle pool. The game picks puzzles from here; it never generates them, and
// that is a measured decision — see tools/bake.mjs for why the generator lives at build
// time instead of on tap.
//
// Everything below is a pure lookup over js/data/lots.js, which is why the daily puzzle
// and a shared link are reproducible without any state: the pool is fixed, and the seed
// only chooses an index.

import { LOTS, TIERS_META } from '../data/lots.js';
import { compile } from './jug.js';
import { hashSeed } from './rng.js';

// Display-side tier list (label / blurb / band). The generation-side ladder with its
// search budgets lives in make.js and is not needed once the puzzles are baked.
export const TIERS = TIERS_META;

const prepared = LOTS.map((row) => ({
  id: row.id,
  tier: row.tier,
  par: row.par,
  solutions: row.solutions,
  states: row.states,
  spec: row.spec,
  route: row.route,
  comp: compile(row.spec),
}));

export const ALL = prepared;

function pick(list, seed, salt) {
  if (!list.length) return null;
  return list[hashSeed(`${salt}|${seed}`) % list.length];
}

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}

export function lotsIn(key) {
  return prepared.filter((l) => l.tier === key);
}

export function byId(id) {
  return prepared.find((l) => l.id === id) || null;
}

// The campaign: every baked puzzle, lowest band first and within a band easiest first —
// which is exactly the order tools/bake.mjs wrote them in.
export function campaign() {
  return prepared;
}

export function levelAt(index) {
  return prepared[((index % prepared.length) + prepared.length) % prepared.length];
}

// Endless play in one band. A seed picks, so `#/random/blend/4kq2` stays honest.
export function randomLot(seed, tierKey) {
  const list = tierKey ? lotsIn(tierKey) : prepared;
  return pick(list, seed, 'random');
}

// One puzzle per calendar day, the same for everyone.
export function dailyLot(dateKey) {
  return pick(prepared, dateKey, 'daily');
}

// What the shipped pool actually contains, measured rather than claimed: the harness
// prints this so a re-bake that quietly loses difficulty shows up as a changed band.
// `med` is there for the same reason — a tier where every puzzle lands on the same number
// is one puzzle wearing four costumes, and min/max alone cannot see that.
function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

export function stats() {
  const byTier = {};
  for (const l of prepared) {
    const s = byTier[l.tier]
      || (byTier[l.tier] = {
        n: 0, min: Infinity, max: 0,
        bucketsMin: Infinity, bucketsMax: 0,
        solMin: Infinity, solMax: 0,
        statesMin: Infinity, statesMax: 0,
        pars: [], states: [],
      });
    s.n++;
    if (l.par < s.min) s.min = l.par;
    if (l.par > s.max) s.max = l.par;
    const b = l.spec.caps.length;
    if (b < s.bucketsMin) s.bucketsMin = b;
    if (b > s.bucketsMax) s.bucketsMax = b;
    if (l.solutions < s.solMin) s.solMin = l.solutions;
    if (l.solutions > s.solMax) s.solMax = l.solutions;
    if (l.states < s.statesMin) s.statesMin = l.states;
    if (l.states > s.statesMax) s.statesMax = l.states;
    s.pars.push(l.par);
    s.states.push(l.states);
  }
  for (const s of Object.values(byTier)) {
    s.pars.sort((a, b) => a - b);
    s.states.sort((a, b) => a - b);
    s.parMed = median(s.pars);
    s.statesMed = median(s.states);
    delete s.pars;
    delete s.states;
  }
  return { lots: prepared.length, byTier };
}
