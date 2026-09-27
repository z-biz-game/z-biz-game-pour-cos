// Layered breadth-first search over the state graph ∏(c_i+1). This is not a convenience:
// it is what lets the game print "this takes exactly N moves" and "there are M shortest
// ways to do it" as measurements rather than opinions.
//
// Both numbers are computed here and nowhere else, and both are computed at build time
// (tools/bake.mjs) — the shipped page only checks the player's step for legality and
// counts it. See DESIGN.md §2.1 for why that split is the point of the repo.
//
// The search deliberately does not stop at the first goal it sees: it finishes the layer
// the goal was found in, because the number of optimal solutions is a sum over that layer.

import { compile, encode, decode, isGoal, eachSuccessor } from './jug.js';

// solve(spec) -> { ok, par, path, solutions, explored, truncated }
//   path: the ordered list of actions that measures `need`, shortest.
//   solutions: how many distinct action sequences of length `par` reach a goal.
// opts: { limit = 400000, deadline, pos, comp }
//   `deadline` is an absolute epoch in milliseconds (the same unit js/core/make.js and
//   tools/bake.mjs keep their budgets in), polled every 256 visited nodes, and `pos` overrides
//   the spec's start. Either brake answers `truncated: true` with `par: -1`: a search that ran
//   out of budget never prints a difficulty number, it says it did not finish.
export function solve(spec, opts = {}) {
  const limit = opts.limit || 400000;
  const deadline = opts.deadline || 0;
  const comp = spec.comp || compile(spec);
  const buf = new Uint16Array(comp.k);
  const start = opts.pos ? Uint16Array.from(opts.pos) : Uint16Array.from(comp.start);
  const startCode = encode(comp, start);

  if (isGoal(comp, start)) {
    return { ok: true, par: 0, path: [], solutions: 1, explored: 1 };
  }

  // Parallel arrays over a Map of code -> index: dist for the layering, prev/via for
  // walking a route back out, ways for the same-layer path count.
  const seen = new Map([[startCode, 0]]);
  const codes = [startCode];
  const dist = [0];
  const prev = [-1];
  const via = [-1];
  const ways = [1];
  let head = 0;
  let par = -1;
  let found = -1;
  let truncated = false;

  while (head < codes.length) {
    const gi = head++;
    // The wall clock is polled at the top of the iteration, before the layer skip below.
    // Polling it at the bottom instead meant a search that had already found its answer —
    // and was only walking the tail of the last layer — could run to completion without ever
    // looking at the clock, so the deadline the caller set was silently ignored. `Date.now()`
    // once every 256 pops is free; a budget that is not honoured is not a budget.
    if (deadline && (gi & 255) === 0 && Date.now() > deadline) { truncated = true; break; }
    if (par >= 0 && dist[gi] >= par) continue; // this layer cannot improve on par
    const state = decode(comp, codes[gi]);
    eachSuccessor(comp, state, (act, next) => {
      const code = encode(comp, next);
      const hit = seen.get(code);
      if (hit === undefined) {
        const ni = codes.length;
        if (ni >= limit) { truncated = true; return; }
        seen.set(code, ni);
        codes.push(code);
        dist.push(dist[gi] + 1);
        prev.push(gi);
        via.push(act.id);
        // ways[start] = 1, so a successor of the start already carries its one route.
        ways.push(ways[gi]);
        if (par < 0 && isGoal(comp, next)) { par = dist[ni]; found = ni; }
      } else if (dist[hit] === dist[gi] + 1) {
        ways[hit] += ways[gi]; // same layer reached again: another optimal route
      }
    }, buf);
    if (truncated) break;
  }

  if (par < 0) {
    return { ok: false, par: -1, path: [], solutions: 0, explored: codes.length, truncated };
  }

  let solutions = 0;
  for (let i = 0; i < codes.length; i++) {
    if (dist[i] === par && isGoal(comp, decode(comp, codes[i]))) solutions += ways[i];
  }

  const path = [];
  for (let i = found; i > 0; i = prev[i]) path.push(comp.acts[via[i]]);
  path.reverse();
  return { ok: true, par, path, solutions, explored: codes.length, truncated: false };
}

// How deep the reachable part of the graph is, and how much of it a player can wander
// around in. Alongside `par` this is the second measured number on the panel: a 6-move
// puzzle whose whole graph is 12 states is an exercise, the same 6 moves through 2 000
// states is a puzzle.
export function census(spec, limit = 400000) {
  const comp = spec.comp || compile(spec);
  const buf = new Uint16Array(comp.k);
  const seen = new Set([encode(comp, comp.start)]);
  const queue = [Uint16Array.from(comp.start)];
  let depth = 0;
  let frontier = queue.length;
  for (let head = 0; head < queue.length; head++) {
    if (queue.length >= limit) return { states: seen.size, depth, truncated: true };
    if (head === frontier) { depth++; frontier = queue.length; }
    const state = queue[head];
    eachSuccessor(comp, state, (act, next) => {
      const code = encode(comp, next);
      if (seen.has(code)) return;
      seen.add(code);
      queue.push(Uint16Array.from(next));
    }, buf);
  }
  return { states: seen.size, depth, truncated: false };
}
