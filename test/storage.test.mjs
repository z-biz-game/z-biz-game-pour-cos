// The save file is the only part of this game that talks to the browser, so it gets tested
// against a fake localStorage — and against the two ways the real one misbehaves: every call
// throwing (private windows, file://) and the property itself throwing on touch.
//
// Rules under test, all written down by hand from the documented contract rather than read
// back out of js/core/storage.js:
//   * one key, named pour.save.v1, holding plain JSON;
//   * best only ever goes down, plays only ever goes up, `perfect` sticks once earned;
//   * a hinted solve keeps its record but never counts as perfect in the stats;
//   * campaign unlocks only ever go up;
//   * the daily log is keyed by date, so two days never overwrite each other;
//   * a wipe clears memory *and* disk *and* the key;
//   * garbage on disk — malformed or wrong-shaped — degrades to a blank save, not a crash;
//   * storage being unavailable is normal operation: the session still works in memory.
//
// storage.js keeps its cache at module scope, so each row imports a fresh module instance
// (`?v=N`) under its own fake global. That is the only way to isolate a save file per row
// without adding a reset hook the app itself would never call.

import { test, ok, eq, run } from '../tools/harness.mjs';

const KEY_NAME = 'pour.save.v1';
const realDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const realValue = (() => {
  try { return globalThis.localStorage; } catch (err) { return undefined; }
})();

function restoreGlobal() {
  try { delete globalThis.localStorage; } catch (err) { /* not ours to keep */ }
  if (realDesc) {
    try {
      Object.defineProperty(globalThis, 'localStorage', { ...realDesc, configurable: true, enumerable: true });
      return;
    } catch (err) { /* fall through to a plain assignment */ }
  }
  try { globalThis.localStorage = realValue; } catch (err) { /* best effort */ }
}

// A recording fake: counts what the module asked for, so "reading must not dirty the disk"
// and "wipe really removes the key" are claims about calls, not about vibes.
function fakeDisk(seed = null) {
  const bag = new Map();
  const disk = {
    bag,
    gets: [],
    sets: 0,
    removes: 0,
    get lastWrite() { return bag.get(KEY_NAME) ?? null; },
    get(key) { this.gets.push(key); return bag.has(key) ? bag.get(key) : null; },
    getItem(key) { return this.get(key); },
    setItem(key, value) { this.sets++; bag.set(key, String(value)); },
    removeItem(key) { this.removes++; bag.delete(key); },
  };
  if (seed !== null) bag.set(KEY_NAME, seed);
  return disk;
}

// Every call throws, which is exactly what Safari in a private window does.
function hostileDisk() {
  const disk = { gets: 0, sets: 0, removes: 0 };
  const boom = (what) => {
    const err = new Error(`SecurityError: localStorage.${what} denied`);
    err.name = 'SecurityError';
    throw err;
  };
  disk.getItem = () => { disk.gets++; boom('getItem'); };
  disk.setItem = () => { disk.sets++; boom('setItem'); };
  disk.removeItem = () => { disk.removes++; boom('removeItem'); };
  return disk;
}

function envWith(disk) {
  return { apply() { globalThis.localStorage = disk; }, restore: restoreGlobal };
}

function envThrowsOnTouch() {
  return {
    apply() {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        enumerable: true,
        get() { const err = new Error('SecurityError: access denied'); err.name = 'SecurityError'; throw err; },
      });
    },
    restore: restoreGlobal,
  };
}

function envAbsent() {
  return { apply() { delete globalThis.localStorage; }, restore: restoreGlobal };
}

let instance = 0;

async function importFresh(where) {
  where.apply();
  try {
    return await import(`../js/core/storage.js?v=${++instance}`);
  } finally {
    where.restore();
  }
}

async function scenario(name, where, fn) {
  const mod = await importFresh(where);
  test(name, () => {
    where.apply();
    try { fn(mod); } finally { where.restore(); }
  });
}

// ---------- 1. the blank shape ----------

{
  await scenario('blank() is the shape a first-time player sees', envAbsent(), (mod) => {
    eq(mod.blank(), {
      v: 1,
      records: {},
      daily: {},
      unlocked: 1,
      stats: { solves: 0, perfect: 0, moves: 0, hints: 0 },
    }, 'one record bag, one daily bag, level 1 unlocked, four counters, and a format version');
    const a = mod.blank();
    a.records.p1 = { solved: true };
    a.stats.solves = 99;
    eq(mod.blank().records, {}, 'a save built after another one must not inherit its edits');
    eq(mod.blank().stats.solves, 0, 'counters are fresh objects, not a shared template');
  });
}

// ---------- 2. cold boot reads, never writes ----------

{
  const disk = fakeDisk();
  const where = envWith(disk);
  await scenario('a cold boot reports a complete save and leaves the disk untouched', where, (mod) => {
    const { store } = mod;
    eq(store.unlocked, 1, 'level one is the only thing unlocked before you play');
    eq(store.records, {}, 'no records yet');
    eq(store.record('lot-1'), null, 'asking for an unseen puzzle is null, not undefined and not a crash');
    eq(store.dailyDone('2026-09-27'), null, 'no daily played yet');
    eq(store.stats, { solves: 0, perfect: 0, moves: 0, hints: 0 }, 'counters start at zero');
    eq(disk.gets, [KEY_NAME], 'one key, read once — the module caches the parsed save');
    eq([disk.sets, disk.removes], [0, 0], 'reading a save must not write one');
  });
}

// ---------- 3. a solve reaches the disk ----------

{
  const disk = fakeDisk();
  await scenario('solving writes the record and lands on localStorage under one key', envWith(disk), (mod) => {
    const { store } = mod;
    const rec = store.solve('lot-7', { moves: 6, par: 6, hints: 0 });
    eq(rec, { solved: true, best: 6, plays: 1, perfect: true }, 'a par solve: six moves, one play, perfect');
    eq(disk.sets, 1, 'one write per mutation');
    eq([...disk.bag.keys()], [KEY_NAME], 'the whole save lives under pour.save.v1 and nowhere else');
    const onDisk = JSON.parse(disk.bag.get(KEY_NAME));
    eq(onDisk.records['lot-7'], rec, 'what the caller got back is what the disk holds');
    eq(onDisk.stats, { solves: 1, perfect: 1, moves: 6, hints: 0 }, 'stats travelled to the disk too');
    eq(onDisk.unlocked, 1, 'solving alone never unlocks the campaign — that is the shell call');
    eq(store.records['lot-7'], rec, 'and the live view agrees with it');
  });
}

// ---------- 4. best only goes down, perfect sticks ----------

{
  const disk = fakeDisk();
  await scenario('best only ever goes down and a later perfect solve is remembered', envWith(disk), (mod) => {
    const { store } = mod;
    const par = 6;
    eq(store.solve('p', { moves: 9, par, hints: 0 }).best, 9, 'the first score is the only score');
    eq(store.solve('p', { moves: 9, par, hints: 0 }).perfect, false, 'nine against a par of six is not perfect');
    const worse = store.solve('p', { moves: 12, par, hints: 0 });
    eq([worse.best, worse.plays], [9, 3], 'a sloppier replay cannot raise your best, but it is still a play');
    eq(worse.perfect, false, 'still not perfect');
    const better = store.solve('p', { moves: 5, par, hints: 0 });
    eq([better.best, better.plays, better.perfect], [5, 4, true], 'under par beats the record and earns the badge');
    const after = store.solve('p', { moves: 20, par, hints: 3 });
    eq([after.best, after.plays, after.perfect], [5, 5, true], 'the badge is permanent once earned');
    eq(store.stats, { solves: 5, perfect: 1, moves: 9 + 9 + 12 + 5 + 20, hints: 3 }, 'the counters add every play and bill every hint');
    eq(JSON.parse(disk.bag.get(KEY_NAME)).records.p, after, 'the disk shows the final state, not the first one');
  });
}

// ---------- 5. hints disqualify the badge in the stats ----------

{
  await scenario('a par solve bought with a hint keeps the record but not the perfect count', envWith(fakeDisk()), (mod) => {
    const { store } = mod;
    const rec = store.solve('given-away', { moves: 6, par: 6, hints: 2 });
    eq(rec.perfect, true, 'the record still says you matched par — the route was certified shortest');
    eq(store.stats.perfect, 0, 'the headline counter does not count a hinted solve');
    eq(store.stats, { solves: 1, perfect: 0, moves: 6, hints: 2 }, 'hints are billed to the hint counter instead');
    const clean = store.solve('earned', { moves: 6, par: 6, hints: 0 });
    eq(clean.perfect, true, 'an unhinted par solve');
    eq(store.stats.perfect, 1, 'and exactly one perfect solve on the books');
  });
}

// ---------- 6. unlocks are monotone ----------

{
  const disk = fakeDisk();
  await scenario('campaign unlocks only ever move forward', envWith(disk), (mod) => {
    const { store } = mod;
    eq(store.unlocked, 1, 'start at level one');
    eq(store.unlock(3), 3, 'clearing level three opens four');
    eq(store.unlock(1), 3, 'replaying level one never hides level four again');
    eq(store.unlock(7), 7, 'progress sticks');
    eq(store.unlock(0), 7, 'a zero cannot reset the campaign');
    eq(JSON.parse(disk.bag.get(KEY_NAME)).unlocked, 7, 'the pointer is on disk, so a reload keeps it');
  });
}

// ---------- 7. the daily log is keyed by date ----------

{
  await scenario('the daily log is per date and overwrites only its own date', envWith(fakeDisk()), (mod) => {
    const { store } = mod;
    store.markDaily('2026-09-26', 'lot-a');
    store.markDaily('2026-09-27', 'lot-b');
    eq(store.dailyDone('2026-09-26').id, 'lot-a', 'yesterday remembers its own puzzle');
    eq(store.dailyDone('2026-09-27').id, 'lot-b', 'today is a separate slot');
    eq(store.dailyDone('2026-09-28'), null, 'a date nobody played has no entry');
    eq(typeof store.dailyDone('2026-09-27').at, 'number', 'the stamp is a timestamp');
    store.markDaily('2026-09-27', 'lot-b');
    eq(Object.keys(store.daily).length, 2, 'playing the same daily twice does not add a third day');
    eq(store.dailyDone('2026-09-26').id, 'lot-a', 'and it still cannot touch another date');
    eq(store.stats.solves, 0, 'marking a daily is not a solve; solve() is the one that counts');
  });
}

// ---------- 8. wipe ----------

{
  const disk = fakeDisk();
  await scenario('a wipe clears memory, the disk and the key itself', envWith(disk), (mod) => {
    const { store } = mod;
    store.solve('p1', { moves: 4, par: 4, hints: 0 });
    store.unlock(5);
    store.markDaily('2026-09-27', 'p1');
    disk.sets = 0;
    disk.removes = 0;
    store.reset();
    eq(store.records, {}, 'records gone from memory');
    eq(store.unlocked, 1, 'the campaign starts again');
    eq(store.stats, { solves: 0, perfect: 0, moves: 0, hints: 0 }, 'counters zeroed');
    eq(store.dailyDone('2026-09-27'), null, 'the daily log is empty');
    eq([disk.removes, disk.sets], [1, 0], 'reset removed the key and did not write it back');
    eq(disk.bag.size, 0, 'nothing is left on the disk');
    store.solve('p1', { moves: 8, par: 4, hints: 0 });
    eq(store.record('p1').best, 8, 'and the save can be built again from scratch');
    eq(store.record('p1').plays, 1, 'the old play count did not survive the wipe');
  });
}

// ---------- 9. garbage on disk ----------

{
  const corrupt = fakeDisk('{not json');
  await scenario('malformed JSON on disk degrades to a blank save instead of crashing', envWith(corrupt), (mod) => {
    const { store } = mod;
    eq(store.unlocked, 1, 'a corrupt file is read as no file');
    eq(store.records, {}, 'no records salvaged from garbage');
    eq(store.stats, { solves: 0, perfect: 0, moves: 0, hints: 0 }, 'counters rebuilt');
    store.solve('p', { moves: 3, par: 3, hints: 0 });
    eq(JSON.parse(corrupt.bag.get(KEY_NAME)).records.p.best, 3, 'and the shell can still save afterwards');
  });
}

// ---------- 10. wrong-shaped fields ----------

{
  const junk = JSON.stringify({
    records: 'nope',
    daily: null,
    unlocked: -3,
    stats: { perfect: 2 },
  });
  await scenario('a save whose fields are the wrong type is coerced, not trusted', envWith(fakeDisk(junk)), (mod) => {
    const { store } = mod;
    eq(store.records, {}, 'a string where the record bag belongs becomes an empty bag');
    eq(store.daily, {}, 'null daily log becomes an empty one');
    eq(store.unlocked, 1, 'a negative pointer is clamped to the first level');
    eq(store.stats, { solves: 0, perfect: 2, moves: 0, hints: 0 }, 'missing counters are filled in, present ones kept');
    eq(store.record('anything'), null, 'and reading through the salvaged bag is still safe');
  });
}

{
  const str = JSON.stringify({ unlocked: '4' });
  await scenario('a pointer stored as a string is still a pointer', envWith(fakeDisk(str)), (mod) => {
    const { store } = mod;
    eq(store.unlocked, 4, 'Number() coercion, so #/c/<n> can be built from it');
    eq(typeof store.unlocked, 'number', 'a string pointer would sort wrong in the table');
    eq(store.unlock(3), 4, 'comparing against it numerically means replaying level three keeps four unlocked');
    eq(store.unlock(9), 9, 'and a genuine advance still works');
  });
}

// ---------- 11. hostile storage ----------

{
  await scenario('a localStorage that throws on every call still gives a working session', envWith(hostileDisk()), (mod) => {
    const { store } = mod;
    const rec = store.solve('hard-mode', { moves: 7, par: 7, hints: 0 });
    eq(rec, { solved: true, best: 7, plays: 1, perfect: true }, 'the solve itself is unaffected');
    eq(store.record('hard-mode').plays, 1, 'the record is readable in the same session');
    store.solve('hard-mode', { moves: 2, par: 7, hints: 0 });
    eq(store.record('hard-mode').best, 2, 'the monotone best still applies without a disk');
    eq(store.unlock(4), 4, 'unlocks work');
    store.markDaily('2026-09-27', 'hard-mode');
    eq(store.dailyDone('2026-09-27').id, 'hard-mode', 'the daily log works');
    eq(store.stats, { solves: 2, perfect: 2, moves: 9, hints: 0 }, 'counters work: both solves beat or match par');
    eq(store.stats.perfect, 2, 'seven against a par of seven and two against a par of seven are both perfect');
    store.reset();
    eq(store.unlocked, 1, 'and the wipe works even though removeItem threw');
  });
}

{
  await scenario('even touching the localStorage property is survivable', envThrowsOnTouch(), (mod) => {
    const { store } = mod;
    eq(store.unlocked, 1, 'load() cannot read a property that throws');
    store.solve('p', { moves: 5, par: 6, hints: 1 });
    eq(store.record('p').best, 5, 'writes go nowhere but the session keeps its numbers');
    eq(store.stats.moves, 5, 'and reports them');
    eq(store.unlock(2), 2, 'progress holds for the session');
  });
}

{
  await scenario('no localStorage at all — the node/CI case — degrades to memory', envAbsent(), (mod) => {
    const { store } = mod;
    eq(store.records, {}, 'blank save');
    store.solve('p', { moves: 4, par: 4, hints: 0 });
    eq(store.record('p').perfect, true, 'still plays correctly');
    eq(mod.blank().unlocked, 1, 'blank() is exported for the shell and hands back a fresh shape');
    store.reset();
    eq(store.stats.solves, 0, 'wipe works');
  });
}

// ---------- 12. the disk is the source of truth across module instances ----------

{
  const shared = fakeDisk();
  const where = envWith(shared);
  const before = await importFresh(where);
  const after = await importFresh(where);
  test('a save written by one page load is read back by the next', () => {
    where.apply();
    try {
      before.store.solve('p1', { moves: 6, par: 5, hints: 0 });
      before.store.unlock(4);
      before.store.markDaily('2026-09-27', 'p1');
      eq(Object.keys(after.store.records), ['p1'], 'the second module wrote nothing itself — it read the disk');
      eq(after.store.records.p1, { solved: true, best: 6, plays: 1, perfect: false }, 'the fresh module sees the record');
      eq(after.store.unlocked, 4, 'the pointer came back');
      eq(after.store.dailyDone('2026-09-27').id, 'p1', 'the daily log came back');
      eq(after.store.stats, { solves: 1, perfect: 0, moves: 6, hints: 0 }, 'the counters came back');
      after.store.solve('p1', { moves: 5, par: 5, hints: 0 });
      eq(after.store.record('p1').plays, 2, 'and the new module continues the history instead of restarting it');
      eq(after.store.record('p1').best, 5, 'best still only goes down');
    } finally {
      where.restore();
    }
  });
}

// ---------- 13. an old save from an earlier bake ----------

{
  const old = JSON.stringify({
    records: { 'old-1': { solved: true, best: 3, plays: 4, perfect: true } },
    daily: {},
    unlocked: 9,
    stats: { solves: 8, perfect: 3, moves: 51, hints: 2 },
    future: { nobody: 'read this' },
  });
  await scenario('a save from an older bake keeps what it recognises', envWith(fakeDisk(old)), (mod) => {
    const { store } = mod;
    eq(store.record('old-1'), { solved: true, best: 3, plays: 4, perfect: true }, 'unknown puzzle ids are kept as they were');
    eq(store.unlocked, 9, 'the campaign pointer survives');
    eq(store.stats, { solves: 8, perfect: 3, moves: 51, hints: 2 }, 'counters survive');
    eq('future' in store.records, false, 'a field the shell does not know is not mistaken for a record');
    eq(store.solve('old-1', { moves: 4, par: 3, hints: 0 }).best, 3, 'and replaying it on a new bake still respects the old best');
  });
}

run();
