// The content pipeline. This is where the game's puzzles come from — the browser never
// generates one, it only picks one.
//
// Why offline: `node test/balance.mjs` measures the sampler end to end. A single puzzle
// costs about a millisecond here, which is nothing on its own, but the *published* numbers
// — par and the number of optimal routes — are what the whole design rests on, and a page
// that recomputed them on tap would be a page that could silently print a different
// difficulty than the one the pool was curated against. So the generator runs here once,
// the solver certifies every puzzle it emits, and what ships is the measured set.
//
//   node tools/bake.mjs                 # js/data/lots.js
//   PER_TIER=24 node tools/bake.mjs
//
// A puzzle only enters the file if re-solving the *serialised* spec reproduces both the
// move count and the solution count the generator claimed. Nothing unmeasured ships.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIERS, makePuzzle } from '../js/core/make.js';
import { solve } from '../js/core/solve.js';
import { compile, validate, toSpec, stateSpace, SPACE_LIMIT } from '../js/core/jug.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PER_TIER = Number(process.env.PER_TIER || 16);
// Three nested brakes, because the generator is asked for one par value at a time and each
// question could in principle be unanswerable:
//   SEED_LIMIT  how many seeds one par value may try
//   PER_SEED_MS the wall clock one makePuzzle call gets (js/core/make.js polls it)
//   TIER_MS / BAKE_MS  the ceiling for one band / for the whole run
// The worst case is therefore arithmetic, not hope: 17 par values × min(SEED_LIMIT ×
// PER_SEED_MS, TIER_MS). Measured full run: see README / deliverable.md.
const SEED_LIMIT = Number(process.env.SEED_LIMIT || PER_TIER * 2);
const PER_SEED_MS = Number(process.env.PER_SEED_MS || 120);
const TIER_MS = Number(process.env.TIER_MS || 12000);
const BAKE_MS = Number(process.env.BAKE_MS || 90000);

// Two bucket sets that differ only in the order they were drawn are the same puzzle once
// the buckets are sorted, so compare the serialised face.
function signature(spec) {
  return `${spec.caps.join(',')}|${JSON.stringify(spec.target)}|${spec.need}`;
}

// The route as it ships: operations and bucket indices, nothing derived. `id` is an index
// into a list js/core/jug.js builds at compile time; baking it in would let a stale id
// silently mean a different action.
function serialiseRoute(route) {
  return route.map((a) => ({ op: a.op, i: a.i, j: a.j }));
}

const t0 = Date.now();
const out = [];
const report = [];

for (const tier of TIERS) {
  const stats = {};
  const seen = new Set();
  const pools = new Map(); // par -> candidates
  const tt0 = Date.now();
  const tierDeadline = Math.min(tt0 + TIER_MS, t0 + BAKE_MS);
  // How many candidates one par value is worth collecting: the round-robin below splits
  // PER_TIER across the values that answer, minus the ones the dedupe rejects, so keep a
  // couple in hand. Anything past this is never picked up.
  const perWanted = Math.max(3, Math.ceil(PER_TIER / (tier.max - tier.min + 1)) + 2);
  const short = [];

  // Fill one par value at a time, so the band that ships is a curve rather than the
  // single number the band happens to produce most often.
  for (let want = tier.min; want <= tier.max; want++) {
    const bucket = [];
    for (let s = 0; bucket.length < perWanted && s < SEED_LIMIT; s++) {
      if (Date.now() > tierDeadline) break;
      const puzzle = makePuzzle(
        `bake-${tier.key}-${want}-${s}`, tier, stats, want,
        Math.min(Date.now() + PER_SEED_MS, tierDeadline),
      );
      if (puzzle) bucket.push(puzzle);
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${tier.key} par ${want}: ${bucket.length}/${perWanted}  ${((Date.now() - tt0) / 1000).toFixed(1)}s   `);
      }
    }
    if (bucket.length) pools.set(want, bucket);
    else short.push(want);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  if (short.length) console.log(`note: ${tier.key} drew no puzzle for par ${short.join(',')}; band ships ${pools.size} of ${tier.max - tier.min + 1} values`);

  // Round-robin across the par values that actually produced puzzles, then order by par.
  const picked = [];
  const wanted = [...pools.keys()];
  const quota = Math.ceil(PER_TIER / wanted.length);
  for (const par of wanted) {
    for (const puzzle of pools.get(par).slice(0, quota)) {
      const spec = JSON.parse(JSON.stringify(puzzle.spec));
      const err = validate(spec);
      if (err) throw new Error(`${tier.key}: generator emitted an invalid puzzle: ${err}`);
      const space = stateSpace(spec.caps);
      if (space > SPACE_LIMIT) throw new Error(`${tier.key}: ${space} states, over the ${SPACE_LIMIT} ceiling`);
      const sig = signature(spec);
      if (seen.has(sig)) continue;
      // Serialise, then re-measure the serialised thing. This is the anti-hand-edit gate:
      // what ships must reproduce its own numbers from the JSON, not from live objects.
      const again = solve(spec, { limit: 60000 });
      if (!again.ok || again.par !== puzzle.rating.par || again.solutions !== puzzle.rating.solutions) {
        throw new Error(`${tier.key}: par ${puzzle.rating.par}/${puzzle.rating.solutions} solutions not reproducible from the spec (${again.par}/${again.solutions})`);
      }
      if (again.path.length !== again.par) throw new Error(`${tier.key}: route length ${again.path.length} disagrees with par ${again.par}`);
      seen.add(sig);
      picked.push({
        id: `${tier.key}-${String(picked.length + 1).padStart(2, '0')}`,
        tier: tier.key,
        par: again.par,
        solutions: again.solutions,
        states: puzzle.rating.states,
        depth: puzzle.rating.depth,
        spec: toSpec(compile(spec)),
        route: serialiseRoute(again.path),
      });
    }
  }
  if (picked.length < PER_TIER) {
    console.error(`warn: ${tier.key} only reached ${picked.length} puzzles across pars ${wanted.join(',')}`);
  }
  // A band is played as a curve, so order it by the one number that means something.
  picked.sort((a, b) => a.par - b.par || b.solutions - a.solutions || a.states - b.states);
  picked.forEach((p, i) => { p.id = `${tier.key}-${String(i + 1).padStart(2, '0')}`; });
  out.push(...picked);

  report.push({
    tier: tier.key,
    n: picked.length,
    pars: picked.map((p) => p.par),
    hist: picked.reduce((m, p) => { m[p.par] = (m[p.par] || 0) + 1; return m; }, {}),
    short,
    solutions: picked.reduce((a, p) => a + p.solutions, 0),
    maxStates: Math.max(0, ...picked.map((p) => p.states)),
    drawn: stats.drawn || 0,
    accepted: stats.accepted || 0,
    rejections: Object.entries(stats)
      .filter(([k, v]) => v && k !== 'accepted' && k !== 'drawn')
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`).join(', '),
    ms: Date.now() - tt0,
  });
}

// The band the UI prints is measured off the puzzles that actually shipped, not copied
// from the generator's wish list — so a re-bake that lands lighter or heavier says so.
const meta = TIERS.map((t) => {
  const mine = out.filter((l) => l.tier === t.key);
  const pars = mine.map((l) => l.par);
  const lo = Math.min(...pars);
  const hi = Math.max(...pars);
  const buckets = mine.map((l) => l.spec.caps.length);
  const bLo = Math.min(...buckets);
  const bHi = Math.max(...buckets);
  return {
    key: t.key, label: t.label, min: lo, max: hi,
    blurb: `${bLo === bHi ? `${bLo} 只桶` : `${bLo}-${bHi} 只桶`} · ${lo === hi ? lo : `${lo}-${hi}`} 次`,
  };
});

const lines = [
  '// Generated by tools/bake.mjs — the puzzles in this game are measurements, not opinions.',
  '// `par` is the BFS-shortest action count for the spec on the same line, `solutions`',
  '// how many distinct routes of that length exist, and `states` how many positions are',
  '// reachable at all. Re-run `node tools/bake.mjs` instead of hand-editing, and',
  '// `node test/library.test.mjs` fails if a line and its numbers ever disagree.',
  `export const TIERS_META = ${JSON.stringify(meta)};`,
  'export const LOTS = [',
  ...out.map((l) => `  ${JSON.stringify(l)},`),
  '];',
  '',
];
const path = join(root, 'js', 'data', 'lots.js');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, lines.join('\n'));

const byTier = {};
for (const l of out) byTier[l.tier] = (byTier[l.tier] || 0) + 1;
console.log(`wrote ${out.length} puzzles (${Object.entries(byTier).map(([k, n]) => `${k}:${n}`).join(' ')}) -> js/data/lots.js in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('tier      n   par          per-par                              solutions           states   drawn  accept    rejections');
for (const r of report) {
  const pars = r.pars.slice().sort((a, b) => a - b);
  const med = pars.length ? Math.round((pars.reduce((a, b) => a + b, 0) / pars.length) * 10) / 10 : 0;
  const hist = Object.entries(r.hist).map(([k, v]) => `${k}x${v}`).join(' ');
  console.log([
    r.tier.padEnd(9),
    String(r.n).padEnd(3),
    `${pars[0]}-${pars[pars.length - 1]} med=${med}`.padEnd(12),
    hist.padEnd(32),
    `sum=${r.solutions} avg=${(r.solutions / (r.n || 1)).toFixed(1)}`.padEnd(17),
    String(r.maxStates).padEnd(8),
    String(r.drawn).padEnd(6),
    `${((100 * r.accepted) / (r.drawn || 1)).toFixed(2)}%`.padEnd(9),
    r.rejections,
  ].join(' '));
}
