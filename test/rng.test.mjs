// js/core/rng.js had no test of its own: every other module in js/core is re-measured by
// some suite, and this one was only reached indirectly through the puzzle generator. That is
// how a missing method survived — js/view.js's splash calls `rng.span(...)`, which the stream
// never defined, so the very first drag threw `jitter.span is not a function` and the bench
// froze. `node --check` cannot see it (the call is valid syntax) and no node suite reached it
// (the view is browser-side). So: pin the whole surface, including the one that was missing.

import { test, ok, eq, run } from '../tools/harness.mjs';
import { hashSeed, mulberry32, rngFrom, todayKey } from '../js/core/rng.js';

test('the seed hash is 32-bit, stable and text-sensitive', () => {
  eq(hashSeed('pour'), hashSeed('pour'), 'same string, same number, every time');
  ok(Number.isInteger(hashSeed('pour')) && hashSeed('pour') >= 0 && hashSeed('pour') <= 0xffffffff,
    `unsigned 32-bit, got ${hashSeed('pour')}`);
  eq(hashSeed('pour') === hashSeed('Pour'), false, 'case is not folded — a shared link is exact');
  ok(hashSeed('measure-03') !== hashSeed('measure-04'), 'one character moves the whole stream');
  eq(hashSeed(''), 0x811c9dc5, 'the FNV offset basis is the empty-string value');
  eq(hashSeed('☯'), hashSeed('\u262f'), 'non-ASCII is hashed by both bytes, not by whichever charCode fits');
});

test('mulberry32 is a pure function of the seed', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  eq([a(), a(), a()], [b(), b(), b()], 'two streams from one seed agree step for step');
  const c = mulberry32(12346);
  eq(a() === c(), false, 'a neighbouring seed is not a neighbouring stream');
  for (let i = 0; i < 2000; i++) {
    const v = a();
    ok(v >= 0 && v < 1, `every draw is in [0,1), saw ${v}`);
  }
});

test('the helpers do what their names say', () => {
  const rng = rngFrom('blend|fixed');
  for (let i = 0; i < 400; i++) {
    const n = rng.int(7);
    ok(Number.isInteger(n) && n >= 0 && n < 7, `int(7) escaped to ${n}`);
    const r = rng.range(3, 5);
    ok(Number.isInteger(r) && r >= 3 && r <= 5, `range(3,5) escaped to ${r}`);
    const p = rng.pick(['a', 'b', 'c']);
    ok(['a', 'b', 'c'].includes(p), `pick() returned ${p}`);
    ok(typeof rng.chance(0.5) === 'boolean', 'chance is a verdict, not a number');
  }
  eq(rng.chance(0), false, 'a zero probability never fires');
  eq(rng.chance(1), true, 'a certain probability always fires');
  const shuffled = rng.shuffle([1, 2, 3, 4, 5]);
  eq(shuffled.slice().sort((x, y) => x - y), [1, 2, 3, 4, 5], 'shuffle permutes, it does not sample with replacement');
});

test('span is the continuous sibling of range and stays inside its bounds', () => {
  const rng = rngFrom('pour.splash');
  eq(typeof rng.span, 'function', 'js/view.js 的水花靠这一个方法取连续抖动');
  let sawFloat = false;
  for (let i = 0; i < 500; i++) {
    const v = rng.span(-2.9, -0.1);
    ok(v >= -2.9 && v < -0.1, `span escaped to ${v}`);
    if (!Number.isInteger(v)) sawFloat = true;
  }
  ok(sawFloat, 'angle/size/life jitter must not be quantised to integers');
  const draw2 = () => { const r = rngFrom('pour.splash'); return [r.span(0, 1), r.span(0, 1)]; };
  eq(draw2(), draw2(), 'the same seed replays the same splash — that is what makes a 30/60/120Hz comparison legal');
});

test('rngFrom accepts a seed of every shape the shell hands it', () => {
  eq(rngFrom(7)() === rngFrom(7)(), true, 'a number seed is used as-is');
  eq(rngFrom('abc')() === rngFrom('abc')(), true, 'a string seed goes through the hash');
  const made = rngFrom('x');
  eq(rngFrom(made) === made, true, 'an existing stream is passed through, not re-seeded');
  eq(rngFrom(null)() === rngFrom('null')(), true, 'null becomes the text "null" rather than a crash');
});

test('todayKey is local dates, zero-padded', () => {
  eq(todayKey(new Date(2026, 8, 27)), '2026-09-27', 'month is 0-based in Date, 1-based in the key');
  eq(todayKey(new Date(2026, 0, 1)), '2026-01-01', 'single digits are padded');
});

run();
