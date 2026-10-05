// Save file. One localStorage key, plain JSON, and a versioned shape so an old save can
// be recognised rather than mistaken for a new one.
//
// Records are keyed by puzzle id (the ids in js/data/lots.js are stable across bakes only
// in the sense that a re-bake is a new game — see README), plus a daily log and a
// campaign unlock pointer. Everything here degrades to memory when localStorage is
// denied, which it is under file:// and in private windows.

const KEY = 'pour.save.v1';

// The browser never hands us a polite null: under file://, in a private window, or with
// cookies blocked, touching localStorage *throws*. So the probe and each call are guarded
// separately — reading a property that throws only fails on the property, while Chrome in a
// third-party-cookie-blocked tab exposes the property and throws inside getItem itself.
// `globalThis` rather than `window` is deliberate — js/core/* must stay free of any
// DOM-global reference so it can be imported by node's test runner (test/storage.test.mjs)
// and by the build-time tools without a shim.
function available() {
  try {
    const ls = globalThis.localStorage;
    return !!ls && typeof ls.getItem === 'function';
  } catch (err) {
    return false;
  }
}

function readRaw() {
  if (!available()) return null;
  try {
    return localStorage.getItem(KEY);
  } catch (err) {
    return null; // some engines only fail on getItem, not on the property lookup
  }
}

function writeRaw(value) {
  if (!available()) return;
  try {
    localStorage.setItem(KEY, value);
  } catch (err) {
    /* quota or a locked-down profile: this session is memory-only */
  }
}

function dropRaw() {
  if (!available()) return;
  try {
    localStorage.removeItem(KEY);
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

// Stage 2 of decoding. Stage 1 (`JSON.parse`) can only fail on the whole file, but the way a
// save actually gets damaged is one field inside it: a truncated write leaves a record that is
// `null`, an old bake left a counter as a string, someone edited the JSON and put `-3` in the
// campaign pointer. The shell reads these blind (`Object.values(store.records).filter(r =>
// r.solved)`), so one bad record used to be able to throw and freeze the whole game. Here each
// record and each daily entry is validated on its own and dropped by itself — a damaged save
// loses the damaged part, never the player's afternoon.
const COUNTER_MAX = 1e9;

// The campaign pointer needs an upper bound as well as a lower one. `blank()` starts at level
// one and the pool has a fixed length, so `unlocked: 999999` is not a save a player can have
// earned — it is a hand-edited or future-written file, and left alone it lights up every locked
// shelf button. The shell knows how many puzzles were baked and calls `setUnlockCap(LEVELS)`
// once at boot; core stays pool-agnostic (no import of js/data/lots.js) so node tools and the
// suites can still decode a save with no cap in sight.
let unlockCap = COUNTER_MAX;

function count(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= COUNTER_MAX ? n : fallback;
}

// The campaign pointer is a level number, so it is the one counter with a lower bound —
// and with the cap in place, an upper one.
function levelPointer(value) {
  const n = count(value, 0);
  return n >= 1 ? Math.min(n, unlockCap) : blank().unlocked;
}

// Returns null for "this record is not a record". A missing `best` is fatal: the whole point of
// a record is the score, and there is no safe default for a puzzle the player may not have
// solved at all.
function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const best = count(raw.best, 0);
  const plays = count(raw.plays, 0);
  if (best < 1 || plays < 1) return null;
  return { solved: !!raw.solved, best, plays, perfect: !!raw.perfect };
}

function cleanRecords(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, rec] of Object.entries(raw)) {
    const kept = cleanRecord(rec);
    if (kept) out[id] = kept;
  }
  return out;
}

function cleanDaily(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [day, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (typeof entry.id !== 'string' || !entry.id) continue;
    const at = Number(entry.at);
    out[day] = { id: entry.id, at: Number.isFinite(at) && at >= 0 ? at : 0 };
  }
  return out;
}

function cleanStats(raw) {
  const base = blank().stats;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  for (const key of Object.keys(base)) base[key] = count(raw[key], 0);
  return base;
}

// null means "this is not a save file" — malformed text, or valid JSON that is not an object.
function decode(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return {
    records: cleanRecords(parsed.records),
    daily: cleanDaily(parsed.daily),
    unlocked: levelPointer(parsed.unlocked),
    stats: cleanStats(parsed.stats),
  };
}

function load() {
  if (cache) return cache;
  const raw = readRaw();
  cache = (raw && decode(raw)) || blank();
  return cache;
}

function persist() {
  writeRaw(JSON.stringify(cache));
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  // Clamped on the way out as well as on the way in: the decode happens once and caches, so a
  // cap set after the first read must still be the bound the shell sees (js/main.js reads this
  // getter on every render to decide which shelf buttons are disabled).
  get unlocked() { return Math.min(load().unlocked, unlockCap); },

  record(id) {
    return load().records[id] || null;
  },

  // Unlocking is monotone: the campaign never goes backwards, because re-solving an
  // earlier puzzle must not be able to hide a later one. And it never runs past the pool:
  // solving the last baked puzzle asks for LEVELS + 1, which is not a level that exists.
  unlock(n) {
    const s = load();
    const cur = Math.min(s.unlocked, unlockCap);
    const want = Math.min(n, unlockCap);
    // 赋值而不是条件写：越界指针在这里被顺手修回盘上，否则 999999 会一直躺在存档里，
    // 只靠读的时候夹 —— 下一次 bake 数对了它还是一颗雷。
    s.unlocked = want > cur ? want : cur;
    persist();
    return s.unlocked;
  },

  // The shell owns the pool length; core only learns it here. Returns the cap in force so a
  // caller (and test/storage.test.mjs) can check that a nonsense argument was refused rather
  // than silently removing the bound.
  setUnlockCap(n) {
    const k = Math.floor(Number(n));
    if (k >= 1 && k <= COUNTER_MAX) unlockCap = k;
    return unlockCap;
  },
  get unlockCap() { return unlockCap; },

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
