// Tiny zero-dep test harness: every tools/../test/*.mjs suite prints the same shape so
// verify.sh can aggregate them.
//
// `rows` are the named claims; `asserts` counts every ok/eq that actually ran, including the
// ones inside the loops that walk all 63 baked puzzles. Both numbers are printed, because the
// contract asks for a count of assertions and a loop that silently ran zero iterations would
// otherwise look like a pass.

let asserts = 0;
const rows = [];

export function test(name, fn) {
  const before = asserts;
  let detail = null;
  try {
    fn();
  } catch (err) {
    detail = String((err && err.message) || err);
  }
  rows.push({ test: name, pass: !detail, asserts: asserts - before, ...(detail ? { detail } : {}) });
}

export function ok(cond, msg = 'expected truthy') {
  asserts++;
  if (!cond) throw new Error(msg);
}

export function eq(a, b, msg = 'not equal') {
  asserts++;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg}\n    got      ${sa}\n    expected ${sb}`);
}

export function fail(msg) {
  throw new Error(msg);
}

export function run() {
  const bad = rows.filter((r) => !r.pass);
  for (const r of rows) console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.test}${r.pass ? '' : '\n         ' + r.detail}`);
  console.log(`rows: ${rows.length} fail: ${bad.length} asserts: ${asserts}`);
  process.exit(bad.length ? 1 : 0);
}
