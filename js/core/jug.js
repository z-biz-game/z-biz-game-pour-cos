// The water model — the whole game in one plain, JSON-serialisable spec.
//
//   { caps: [5, 3], target: 1, need: 4 }
//
// `caps` are the bucket capacities, `need` the amount to be measured out, and `target`
// either a bucket index (that bucket must hold it) or an array of indices (any one of
// them holding it wins). Starting state is empty unless `start` says otherwise.
//
// Three atomic actions, and only three: `fill i` at the tap, `dump i` down the drain,
// `pour i→j` tip one bucket into another until the source is empty or the destination is
// full. There is no half-pour: without a graduation mark on the bucket, "pour half of it"
// is not a state you can recognise, let alone encode — the moment it is allowed the state
// graph stops being the finite product ∏(c_i+1) that every number in this game is
// measured over. See DESIGN.md §2.2.
//
// Nothing in this file touches the DOM, and nothing in it searches: the search is
// js/core/solve.js, the number-theory verdict is js/core/theorem.js.

export const SPACE_LIMIT = 20000; // hard gate on ∏(c_i+1), see DESIGN.md §2.1
export const MAX_BUCKETS = 4;
export const MAX_CAP = 60;

export const FILL = 'fill';
export const DUMP = 'dump';
export const POUR = 'pour';

export function stateSpace(caps) {
  let n = 1;
  for (const c of caps) n *= (c + 1);
  return n;
}

function normaliseTargets(spec, k) {
  const raw = Array.isArray(spec.target) ? spec.target
    : spec.target === undefined || spec.target === null ? [0, 1, 2, 3].slice(0, k) : [spec.target];
  return raw;
}

// Pre-typed arrays so the search never re-reads objects inside its loop.
export function compile(spec) {
  const caps = spec.caps.map(Number);
  const k = caps.length;
  const targets = normaliseTargets(spec, k);
  const comp = {
    k,
    caps: new Uint16Array(k),
    // mult[i] is the mixed-radix weight of bucket i; space is the whole graph size.
    mult: new Uint32Array(k),
    goal: new Uint8Array(k),
    need: Number(spec.need) | 0,
    start: new Uint16Array(k),
    space: 1,
  };
  for (let i = 0; i < k; i++) {
    comp.caps[i] = caps[i];
    comp.mult[i] = comp.space;
    comp.space *= (caps[i] + 1);
    comp.goal[i] = targets.includes(i) ? 1 : 0;
    comp.start[i] = spec.start ? Number(spec.start[i]) | 0 : 0;
  }
  comp.acts = actionSet(comp);
  return comp;
}

// Mixed-radix index of a state — exact, dense, and cheap enough to be a Map key.
// Bucket 0 is the least significant digit, so `decode` unwraps in the same order.
export function encode(comp, state) {
  let code = 0;
  for (let i = 0; i < comp.k; i++) code += comp.mult[i] * state[i];
  return code;
}

export function decode(comp, code) {
  const out = new Uint16Array(comp.k);
  let rest = code;
  for (let i = 0; i < comp.k; i++) {
    out[i] = rest % (comp.caps[i] + 1);
    rest = Math.floor(rest / (comp.caps[i] + 1));
  }
  return out;
}

// Every action template the buckets admit: 2 per bucket (tap, drain) plus k(k-1) pours.
// Two buckets therefore give exactly 6, which is the action set the classic puzzle has.
// Ids are the index into this list, so a search can remember a move as one integer.
export function actionSet(comp) {
  const out = [];
  for (let i = 0; i < comp.k; i++) {
    out.push({ id: out.length, op: FILL, i });
    out.push({ id: out.length, op: DUMP, i });
  }
  for (let i = 0; i < comp.k; i++) {
    for (let j = 0; j < comp.k; j++) if (i !== j) out.push({ id: out.length, op: POUR, i, j });
  }
  return out;
}

// Apply an action without allocating: `into` is filled and returned (a fresh array when
// omitted). A 20k-state search must not allocate 20k arrays.
export function apply(comp, state, act, into) {
  const next = into || new Uint16Array(comp.k);
  if (act.op === FILL) {
    for (let i = 0; i < comp.k; i++) next[i] = state[i];
    next[act.i] = comp.caps[act.i];
  } else if (act.op === DUMP) {
    for (let i = 0; i < comp.k; i++) next[i] = state[i];
    next[act.i] = 0;
  } else {
    const moved = Math.min(state[act.i], comp.caps[act.j] - state[act.j]);
    for (let i = 0; i < comp.k; i++) next[i] = state[i];
    next[act.i] -= moved;
    next[act.j] += moved;
  }
  return next;
}

// Is this action worth taking at all? Filling a full bucket, emptying an empty one, and
// pouring into a bucket that is already full (or from one that is already empty) change
// no state, so they are not moves — the player's count and the search's queue both skip
// them (rule in js/core/game.js, enqueue rule in js/core/solve.js).
export function effective(comp, state, act) {
  if (act.op === FILL) return state[act.i] < comp.caps[act.i];
  if (act.op === DUMP) return state[act.i] > 0;
  return state[act.i] > 0 && state[act.j] < comp.caps[act.j];
}

// Enumerate the one-action successors that actually change something: cb(action, next).
// `scratch` is reused instead of allocating per successor.
export function eachSuccessor(comp, state, cb, scratch) {
  const buf = scratch || new Uint16Array(comp.k);
  const acts = comp.acts || actionSet(comp);
  for (const act of acts) {
    if (!effective(comp, state, act)) continue;
    apply(comp, state, act, buf);
    cb(act, buf);
  }
}

export function successors(comp, state) {
  const out = [];
  eachSuccessor(comp, state, (act, next) => out.push({ act, state: Array.from(next) }));
  return out;
}

export function isGoal(comp, state) {
  for (let i = 0; i < comp.k; i++) {
    if (comp.goal[i] && state[i] === comp.need) return true;
  }
  return false;
}

// Human-readable action, used by the panel and by the hint line.
export function describe(comp, act) {
  const b = (i) => `${i + 1} 号桶（${comp.caps[i]}）`;
  if (act.op === FILL) return `给 ${b(act.i)} 接满`;
  if (act.op === DUMP) return `倒掉 ${b(act.i)}`;
  return `把 ${b(act.i)} 倒进 ${b(act.j)}`;
}

// The spec is also the save/share format, so it has to survive JSON and a device swap.
export function toSpec(comp) {
  const target = [];
  for (let i = 0; i < comp.k; i++) if (comp.goal[i]) target.push(i);
  return {
    caps: Array.from(comp.caps),
    target: target.length === 1 ? target[0] : target,
    need: comp.need,
    start: Array.from(comp.start),
  };
}

// Structural sanity, used by the generator, by the bake re-check and by the tests.
// Returns an error string, or null when the spec is playable.
export function validate(spec) {
  if (!spec || !Array.isArray(spec.caps) || !spec.caps.length) return 'no buckets';
  if (spec.caps.length > MAX_BUCKETS) return `more than ${MAX_BUCKETS} buckets`;
  const seen = new Set();
  for (const c of spec.caps) {
    if (!Number.isInteger(c) || c < 1) return 'a bucket with no capacity';
    if (c > MAX_CAP) return `capacity ${c} above the ${MAX_CAP} ceiling`;
    if (seen.has(c)) return 'two buckets of the same capacity';
    seen.add(c);
  }
  const k = spec.caps.length;
  const targets = Array.isArray(spec.target) ? spec.target : [spec.target];
  if (!targets.length) return 'no target bucket';
  for (const t of targets) {
    if (!Number.isInteger(t) || t < 0 || t >= k) return 'target bucket outside the set';
  }
  if (!Number.isInteger(spec.need) || spec.need < 0) return 'negative need';
  const maxTarget = Math.max(...targets.map((t) => spec.caps[t]));
  if (spec.need > maxTarget) return 'need larger than the target bucket can hold';
  if (spec.start) {
    if (!Array.isArray(spec.start) || spec.start.length !== k) return 'start vector the wrong length';
    for (let i = 0; i < k; i++) {
      if (!Number.isInteger(spec.start[i]) || spec.start[i] < 0 || spec.start[i] > spec.caps[i]) {
        return `start amount ${spec.start[i]} outside bucket ${i}`;
      }
    }
  }
  if (stateSpace(spec.caps) > SPACE_LIMIT) return `state space ${stateSpace(spec.caps)} over the ${SPACE_LIMIT} ceiling`;
  return null;
}
