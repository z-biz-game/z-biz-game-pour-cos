// Balance rig: the sampler measured, not the shipped pool.
//
//   node test/balance.mjs
//   PER_CALL_MS=60 CALLS=120 TIER_MS=8000 node test/balance.mjs
//
// Every call asks js/core/make.js for one puzzle at one par value inside a band and records
// what came back. The numbers this prints are the ones DESIGN.md quotes as the acceptance
// rates — they are *why* generation is a build-time step and never a click-time one. It
// reads the same tally object bake.mjs reads (the third argument to makePuzzle), so a change
// to the sampler shows up here before it shows up in js/data/lots.js.
//
// Nothing is written. This file is a measuring stick; tools/bake.mjs is the pipeline.

import { TIERS, makePuzzle } from '../js/core/make.js';
import { solve } from '../js/core/solve.js';
import { stateSpace, SPACE_LIMIT } from '../js/core/jug.js';

const CALLS = Number(process.env.CALLS || 80);          // draws per par value
const PER_CALL_MS = Number(process.env.PER_CALL_MS || 120); // clock per makePuzzle call
const TIER_MS = Number(process.env.TIER_MS || 20000);   // ceiling for one band
const RECHECK = Number(process.env.RECHECK || 20);      // how many accepted puzzles to re-solve

const rows = [];

for (const tier of TIERS) {
  const stats = {};
  const accepted = [];
  const pars = [];
  const perPar = [];
  let drawn = 0;
  const t0 = Date.now();
  const deadline = t0 + TIER_MS;

  for (let want = tier.min; want <= tier.max; want++) {
    let got = 0;
    for (let s = 0; s < CALLS; s++) {
      if (Date.now() > deadline) break;                 // band ceiling: never a runaway loop
      drawn++;
      const p = makePuzzle(`balance-${tier.key}-${want}-${s}`, tier, stats, want,
        Math.min(Date.now() + PER_CALL_MS, deadline));
      if (p) {
        got++;
        pars.push(p.rating.par);
        if (accepted.length < RECHECK) accepted.push(p);
      }
    }
    perPar.push(`${want}:${got}`);
  }

  const ms = Date.now() - t0;
  const cutByDeadline = Date.now() > deadline;
  const spaces = accepted.map((p) => stateSpace(p.spec.caps));
  rows.push({
    tier: tier.key,
    band: `${tier.min}-${tier.max}`,
    drawn,
    accepted: pars.length,
    rate: drawn ? `${((100 * pars.length) / drawn).toFixed(2)}%` : 'n/a',
    med: pars.length ? (pars.reduce((a, b) => a + b, 0) / pars.length).toFixed(1) : 'n/a',
    byPar: perPar.join(' '),
    rejections: Object.entries(stats)
      .filter(([k, v]) => v && k !== 'accepted' && k !== 'drawn')
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none',
    maxSpace: spaces.length ? Math.max(...spaces) : 0,
    overGate: spaces.filter((s) => s > SPACE_LIMIT).length,
    ms,
    cutByDeadline,
  });

  // Independent re-measure of a sample: the rating must reproduce from the bare spec.
  for (const p of accepted) {
    const again = solve(JSON.parse(JSON.stringify(p.spec)), { limit: 60000 });
    if (!again.ok || again.par !== p.rating.par || again.solutions !== p.rating.solutions) {
      console.error(`MISMATCH ${p.spec.caps.join(',')} need ${p.spec.need}: claimed ${p.rating.par}/${p.rating.solutions}, measured ${again.par}/${again.solutions}`);
      process.exitCode = 1;
    }
  }
}

const hist = rows.map((r) => r.byPar).join(' ');
console.log('tier      band    drawn  accepted  rate     median  maxStates  gate  ms     cut  rejections');
for (const r of rows) {
  console.log([
    r.tier.padEnd(9),
    r.band.padEnd(7),
    String(r.drawn).padEnd(6),
    String(r.accepted).padEnd(8),
    r.rate.padEnd(8),
    String(r.med).padEnd(7),
    String(r.maxSpace).padEnd(10),
    String(r.overGate).padEnd(5),
    String(r.ms).padEnd(6),
    (r.cutByDeadline ? 'yes' : 'no').padEnd(4),
    r.rejections,
  ].join(' '));
}
console.log(`\npar histogram per band (draw order): ${hist}`);
console.log(`totals: drawn ${rows.reduce((a, r) => a + r.drawn, 0)}, accepted ${rows.reduce((a, r) => a + r.accepted, 0)}, ${((rows.reduce((a, r) => a + r.ms, 0)) / 1000).toFixed(1)}s`);
console.log('gate: a candidate enters only if ∏(capacity+1) <= ' + SPACE_LIMIT + ' (js/core/jug.js SPACE_LIMIT).');
