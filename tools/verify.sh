#!/usr/bin/env bash
# One-shot verification for 倒水量 · POUR: the node suites first, then a real browser
# against a real server, driven over CDP with real mouse input. Everything the script starts
# exits with the script, including the Chrome it launched in a throwaway profile.
#
#   ./tools/verify.sh                        # node suites + @boot @play @routes @save @pointer
#   SCENARIOS="pointer" ./tools/verify.sh    # one browser suite while editing the view
#   SKIP_UNIT=1 ./tools/verify.sh            # browser only (what the CI browser job runs)
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterisation saturates the cores and, with no CDP client attached, Chrome does not exit on
# its own. This game draws with 2D canvas, so plain headless Chrome is enough.
#
# Screenshots land in /tmp, never in the repository: test/shape.test.mjs fails the build if a
# bitmap asset ever appears in the tree, and every pixel here is drawn by js/view.js.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
CDP_PORT=${CDP_PORT:-9341}; if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo ":$CDP_PORT is already LISTENING — a sibling gate or an orphan Chrome holds it; attaching there reads someone else's browser. Wait for it to finish, or rerun with CDP_PORT=<a free port>." >&2; lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >&2 || true; exit 6; fi  # 一机一台：撞在同一个默认口上时不报错的是 Chrome，报错的是绿——先让路再开闸
WEB_PORT=${WEB_PORT:-5190}
BASE=${BASE_URL:-http://127.0.0.1:$WEB_PORT/}
SHOT_DIR=${SHOT_DIR:-/tmp}
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

# A separate profile per run: this machine runs several repos' playtests and a shared
# --user-data-dir makes the second one attach to the first Chrome.
UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$CDP_PORT --user-data-dir=$UDD \
  --window-size=1280,900 --no-first-run --no-default-browser-check about:blank \
  >"$SHOT_DIR/pour-chrome.log" 2>&1 &
CPID=$!
node "$HERE/server.cjs" $WEB_PORT >"$SHOT_DIR/pour-server.log" 2>&1 &
SPID=$!
cleanup() {
  kill -9 $CPID $SPID 2>/dev/null
  wait $CPID 2>/dev/null
  wait $SPID 2>/dev/null
  rm -rf $UDD
}
trap cleanup EXIT
# The watchdog redirects its fds: a background subshell inherits the script's stdout, and
# inside a pipeline it would hold the write end open for the whole timeout, stalling the
# consumer long after the tests finished.
( sleep ${WD_TIMEOUT:-420}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools noticeably later than a warm profile, and the static
# server needs its own moment, so both endpoints are polled rather than guessed at.
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$CDP_PORT" >&2; exit 3; }
for i in $(seq 1 40); do
  curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS -m 2 "$BASE" >/dev/null 2>&1 || {
  echo "static server never answered on $BASE" >&2; exit 4; }

cd "$HERE"
FAILED=0
NODE_ROWS=0
NODE_ASSERTS=0

echo "=== node suites (rules, search, number theory, pool, save, shape) ==="
# SKIP_UNIT=1 for the browser job in CI, where the suites are their own job.
if [ -z "${SKIP_UNIT:-}" ]; then
  for f in test/*.test.mjs; do
    echo "--- $f"
    OUT=$(node "$f" 2>&1); RC=$?
    echo "$OUT" | grep -E '^(  ok|  FAIL|rows:)' || true
    R=$(echo "$OUT" | sed -n 's/^rows: \([0-9]*\) fail: \([0-9]*\) asserts: \([0-9]*\).*/\1/p')
    A=$(echo "$OUT" | sed -n 's/^rows: \([0-9]*\) fail: \([0-9]*\) asserts: \([0-9]*\).*/\3/p')
    NODE_ROWS=$((NODE_ROWS + ${R:-0}))
    NODE_ASSERTS=$((NODE_ASSERTS + ${A:-0}))
    [ $RC -eq 0 ] || FAILED=1
  done
  # 难度台架：与 ci.yml 的 Balance 步骤同一条命令。默认全量本机实测 20.5 秒，不开浏览器，
  # 所以本地与 CI 都跑全样本，不缩。
  echo "=== balance ==="
  npm run balance || FAILED=1
  # 部署集闸：ci.yml 跑这两步、本地整闸以前一次都不跑。缺这一步就是「本地全绿、线上 404 自己的
  # manifest / sw.js / 图标」这一整类坏法。它不碰 Chrome，也不读页面，纯查产物。
  echo "=== deploy-set ==="
  node tools/deploy-set.mjs || FAILED=1
  node tools/deploy-set-selftest.mjs || FAILED=1
  echo "node totals: rows $NODE_ROWS asserts $NODE_ASSERTS"
  # 文档行号对账：README / DESIGN / deliverable 里印着的每一条 `文件:行号` 都由这条腿读回来对账。
  # 它**不在**上面的 test/*.test.mjs 循环里：那 84 行 / 874 条是 README 印着的口径，把第九套混进
  # 那个循环而不动那句话就是文档说谎（同一条命令也住在 .github/workflows/ci.yml 与 npm run test 的链里）。
  echo "=== doctest ==="
  node tools/docs-test.mjs || FAILED=1
fi

# The two claims that need both layers: the daily puzzle and a share link have to be the same
# puzzle in the browser as in node, because both call the same pure picker over the same pool.
DAILY_ID=$(node --input-type=module -e "
import { dailyLot } from '$HERE/js/core/library.js';
import { todayKey } from '$HERE/js/core/rng.js';
process.stdout.write(dailyLot(todayKey()).id);
" 2>/dev/null)
RANDOM_BLEND_ID=$(node --input-type=module -e "
import { randomLot } from '$HERE/js/core/library.js';
process.stdout.write(randomLot('blend|fixed', 'blend').id);
" 2>/dev/null)
echo "cross-check ids: daily=$DAILY_ID random(blend|fixed)=$RANDOM_BLEND_ID"

export CDP_PORT
export BASE_URL=$BASE
export DAILY_ID
export RANDOM_BLEND_ID
node tools/playtest.mjs open "$BASE" | head -3
# Wait on the shell, not on a timer: the pool is tens of kilobytes of measurement and the
# route resolves before the page can report a state.
BOOT=""
for i in $(seq 1 60); do
  BOOT=$(node tools/playtest.mjs eval "window.pour?window.pour.state.id:'nope'" nonav 2>/dev/null | tr -d '\n" ')
  case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
done
echo "boot lot: $BOOT"
[ -n "$BOOT" ] && [ "$BOOT" != "nope" ] || { echo "window.pour never appeared at $BASE" >&2; exit 5; }
node tools/playtest.mjs shot "$SHOT_DIR/pour-boot.png" >/dev/null 2>&1

BROWSER_ROWS=0
BROWSER_ASSERTS=0
for s in ${SCENARIOS:-boot play routes save pointer}; do
  echo "=== @$s ==="
  BROWSERRAW=$(node tools/playtest.mjs eval "@$s" nonav 2>&1)
  OUT=$(printf '%s' "$BROWSERRAW" | node --input-type=commonjs -e '
const raw = require("node:fs").readFileSync(0, "utf8");
const start = raw.indexOf("{");
if (start < 0) { console.log("NO RESULT " + raw.slice(-500)); console.log("rows: 0 passed: 0"); process.exit(1); }
let depth = 0, end = -1;
for (let i = start; i < raw.length; i++) {
  if (raw[i] === "{") depth++;
  else if (raw[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
}
if (end < 0) { console.log("UNBALANCED JSON " + raw.slice(start, start + 200)); console.log("rows: 0 passed: 0"); process.exit(1); }
let d;
try { d = JSON.parse(raw.slice(start, end + 1)); }
catch (e) { console.log("BAD JSON " + e.message); console.log("rows: 0 passed: 0"); process.exit(1); }
const rows = d.rows || [];
const passed = rows.filter((r) => r.pass).length;
for (const r of rows) if (!r.pass) console.log("  FAIL " + r.test + "  " + JSON.stringify(r.detail).slice(0, 300));
console.log("rows: " + rows.length + " passed: " + passed + " fail: " + JSON.stringify(d.fail || []));
process.exit(d.fail && d.fail.length ? 1 : 0);
')
  RC=$?
  echo "$OUT"
  R=$(printf '%s' "$OUT" | sed -n 's/^rows: \([0-9]*\).*/\1/p' | tail -1)
  A=$(printf '%s' "$OUT" | sed -n 's/.*passed: \([0-9]*\).*/\1/p' | tail -1)
  BROWSER_ROWS=$((BROWSER_ROWS + ${R:-0}))
  BROWSER_ASSERTS=$((BROWSER_ASSERTS + ${A:-0}))
  [ $RC -eq 0 ] || FAILED=1
  node tools/playtest.mjs shot "$SHOT_DIR/pour-$s.png" >/dev/null 2>&1
done
echo "browser totals: rows $BROWSER_ROWS asserts $BROWSER_ASSERTS"

# The completion frame: play the certified route and shoot the win card.
echo "=== completion shot ==="
node tools/playtest.mjs eval "window.pour.load('#/c/1'); window.pour.store.reset(); window.pour.load('#/c/1'); window.pour.play(window.pour.route()); JSON.stringify({id: window.pour.state.id, moves: window.pour.state.moves, par: window.pour.state.par, done: window.pour.state.done})" nonav
node tools/playtest.mjs shot "$SHOT_DIR/pour-win.png" >/dev/null 2>&1
ls -l "$SHOT_DIR/pour-boot.png" "$SHOT_DIR/pour-win.png" 2>/dev/null

echo "=== console ==="
node tools/playtest.mjs logs
kill $WD 2>/dev/null
wait $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
