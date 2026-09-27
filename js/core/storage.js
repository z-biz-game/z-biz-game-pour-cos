// Save file. One localStorage key, plain JSON, and a versioned shape so an old save can
// be recognised rather than mistaken for a new one.
//
// Records are keyed by puzzle id (the ids in js/data/lots.js are stable across bakes only
// in the sense that a re-bake is a new game — see README), plus a daily log and a
// campaign unlock pointer. Everything here degrades to memory when localStorage is
// denied, which it is under file:// and in private windows.

const KEY = 'pour.save.v1';

// The browser never hands us a polite null: under file://, in a private window, or with
// cookies blocked, touching localStorage *throws*. So the handle is fetched behind a try,
// and every call on it is wrapped again, because some engines only fail on getItem.
// `globalThis` rather than `window` is deliberate — js/core/* must stay free of any
// DOM-global reference so it can be imported by node's test runner (test/storage.test.mjs)
// and by the build-time tools without a shim.
function disk() {
  try {
    return globalThis.localStorage || null;
  } catch (err) {
    return null;
  }
}

function readRaw() {
  const ls = disk();
  if (!ls) return null;
  try {
    return ls.getItem(KEY);
  } catch (err) {
    return null;
  }
}

function writeRaw(value) {
  const ls = disk();
  if (!ls) return;
  try {
    ls.setItem(KEY, value);
  } catch (err) {
    /* quota or a locked-down profile: this session is memory-only */
  }
}

function dropRaw() {
  const ls = disk();
  if (!ls) return;
  try {
    ls.removeItem(KEY);
  } catch (err) {
    /* nothing was ever persisted */
  }
}

export function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, perfect: 0, moves: 0, hints: 0 },
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  const raw = readRaw();
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        cache = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
          stats: { ...base.stats, ...(p.stats || {}) },
        };
        return cache;
      }
    } catch (err) {
      // A corrupt save is not worth keeping; start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  writeRaw(JSON.stringify(cache));
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  get unlocked() { return load().unlocked; },

  record(id) {
    return load().records[id] || null;
  },

  // Unlocking is monotone: the campaign never goes backwards, because re-solving an
  // earlier puzzle must not be able to hide a later one.
  unlock(n) {
    const s = load();
    if (n > s.unlocked) s.unlocked = n;
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id) {
    const s = load();
    s.daily[dateKey] = { id, at: Date.now() };
    persist();
  },

  dailyDone(dateKey) {
    return load().daily[dateKey] || null;
  },

  // `par` is the certified shortest route, so "perfect" is a fact about this puzzle
  // rather than a feeling: you matched the solver.
  solve(id, { moves, par, hints }) {
    const s = load();
    const prev = s.records[id];
    const cur = {
      solved: true,
      best: !prev || !prev.best || moves < prev.best ? moves : prev.best,
      plays: (prev && prev.plays ? prev.plays : 0) + 1,
      perfect: moves <= par || !!(prev && prev.perfect),
    };
    s.records[id] = cur;
    s.stats.solves += 1;
    s.stats.moves += moves;
    s.stats.hints += hints || 0;
    if (moves <= par && !hints) s.stats.perfect += 1;
    persist();
    return cur;
  },

  reset() {
    cache = blank();
    dropRaw();
  },
};
