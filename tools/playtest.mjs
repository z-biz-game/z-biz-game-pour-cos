// Zero-dependency CDP playtest driver for 倒水量 · POUR.
//
//   node tools/playtest.mjs open  <url>
//   node tools/playtest.mjs nav   <url>
//   node tools/playtest.mjs eval  '@boot'         # | @play | @routes | @save
//   node tools/playtest.mjs eval  '@pointer'      # real Input.dispatchMouseEvent input
//   node tools/playtest.mjs shot  <path.png>
//   node tools/playtest.mjs logs
//
// env: CDP_PORT (default 9341), BASE_URL (default http://127.0.0.1:5190/),
//      VIEWPORT_W / VIEWPORT_H (default 1280x900),
//      DAILY_ID / RANDOM_BLEND_ID — the ids node's own js/core/library.js derives for
//      today's date and for the seed 'blend|fixed'. They are injected into @routes, which is
//      what turns "the same puzzle on any device" from a sentence into a tested claim: the
//      browser has to land on the id the node layer computed.
//
// Every suite returns { rows: [{test, pass, detail}] } in the shape tools/harness.mjs prints,
// so tools/verify.sh adds node asserts and browser asserts onto one line.
//
// @pointer is the suite that cannot be faked from in-page JS: it dispatches Chrome's own
// mouse events, so what gets graded is the wiring from a gesture through js/view.js's three
// drop zones into js/core/game.js's counter. Everything else here could be run with the view
// deleted; that is exactly why the view gets its own suite.

const PORT = process.env.CDP_PORT || 9341;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5190/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const DAILY_ID = process.env.DAILY_ID || '';
const RANDOM_ID = process.env.RANDOM_BLEND_ID || '';
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch (err) { /* target already gone */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${(e.exception && e.exception.description) || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: Number(process.env.VIEWPORT_W || 1280), height: Number(process.env.VIEWPORT_H || 900),
    deviceScaleFactor: 1, mobile: false,
  }, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  // Poll the shell, never a fixed sleep: the page is a module graph fetched over the network,
  // and a sleep long enough for CI is short enough to make a working deploy look broken
  // (`window.pour` still undefined, canvas still the unstyled 300x150 default).
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.pour && window.pour.state && window.pour.state.id)');
      } catch (err) {
        /* no shell yet — the module graph is still loading, so keep polling */
        ready = false;
      }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS);
      } else if (SCENARIOS[name]) {
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// ---------------------------------------------------------------- real input

async function pointerScenario(cdp, sessionId, runJS) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0,
  }, sessionId);
  const key = (k) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', text: k, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  }, sessionId);
  const state = () => runJS('window.pour.state');
  const moves = async () => (await state()).moves;

  // A drag in several small steps, so the ghost-water preview is exercised and not only the
  // release. `steps` is a count, `path` the exact end point.
  async function dragTo(from, to, steps = 6) {
    await mouse('mousePressed', from.x, from.y, 1);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', Math.round(from.x + ((to.x - from.x) * i) / steps),
        Math.round(from.y + ((to.y - from.y) * i) / steps), 1);
    }
    await mouse('mouseReleased', to.x, to.y, 0);
    await sleep(90);
  }

  // Client-space geometry, the only coordinates an automated finger may know.
  const points = () => runJS(`(() => {
    const g = window.pour, out = { buckets: [], tap: g.faucetPoint(), drain: g.drainPoint() };
    for (let i = 0; i < g.state.caps.length; i++) out.buckets.push(g.bucketPoint(i));
    return out;
  })()`);

  await runJS(`window.pour.load('#/c/1'); 'ok'`);
  await sleep(320);

  const ids = ['bench', 'undo', 'hint', 'restart', 'share', 'curtain', 'stars', 'verdict', 'tally',
    'shelf', 'wipe', 'next', 'again', 'readout', 'theorem', 'log', 'caps', 'totals', 'crumbs', 'hintline', 'linkline', 'modes'];
  const present = await runJS(`[${ids.map((i) => `['${i}', !!document.getElementById('${i}')]`).join(',')}]`);
  rec('every control the shell reaches for exists', present.every(([, on]) => on), Object.fromEntries(present.filter(([, o]) => !o)));

  const start = await state();
  const route = await runJS('window.pour.route()');
  rec('a level loads with a certified par', !!start.id && start.par >= 1 && !!start.states, { id: start.id, par: start.par });
  rec('and the route on screen is exactly par steps long', route.length === start.par, { route: route.length, par: start.par });
  rec('the route is the shipped one, not a search: three operations and indices only',
    route.every((a) => ['fill', 'dump', 'pour'].includes(a.op) && Number.isInteger(a.i)), route.slice(0, 3));

  // Lift bucket 1 toward the faucet with 40 real mouse events and read the gesture in
  // mid-flight: the preview must know what it means before anything is committed. The assertion
  // is keyed on the *first step the view itself reports as being inside the faucet zone* rather
  // than on "halfway along the line": the faucet is the 78px band above a row of buckets that is
  // up to 414px tall, so the midpoint of the path is still standing in the bucket. Halfway was
  // the previous revision of this test — with 4 sampled steps the pointer never entered the band
  // at all, so `target` stayed on the source bucket (the view's zones are sticky precisely so a
  // gesture does not cancel in the gaps) and the drag had no action in it to grade.
  const p0 = await points();
  const LIFT_STEPS = 40;
  const liftPath = [];
  let lift = null;
  let liftStep = 0;
  await mouse('mousePressed', p0.buckets[0].x, p0.buckets[0].y, 1);
  for (let i = 1; i <= LIFT_STEPS; i++) {
    const x = Math.round(p0.buckets[0].x + ((p0.tap.x - p0.buckets[0].x) * i) / LIFT_STEPS);
    const y = Math.round(p0.buckets[0].y + ((p0.tap.y - p0.buckets[0].y) * i) / LIFT_STEPS);
    await mouse('mouseMoved', x, y, 1);
    const s = await runJS('window.pour.dragState()');
    const zone = s && s.target && s.target.z;
    if (i === 1 || (i & 7) === 0 || (zone === 'tap' && !lift)) {
      liftPath.push({ i, zone, op: s && s.action && s.action.op, progress: s && s.progress });
    }
    if (!lift && zone === 'tap' && s && s.action && s.action.op === 'fill') {
      lift = s;
      liftStep = i;
    }
  }
  const atTap = await runJS('window.pour.dragState()');
  await mouse('mouseReleased', p0.tap.x, p0.tap.y, 0);
  await sleep(120);
  rec('a bucket raised into the faucet zone reads as a fill of that bucket, not as a drag',
    !!lift && !!lift.action && lift.action.op === 'fill' && lift.action.i === 0 && lift.legal === true,
    { liftStep, liftPath, lift });
  rec('the preview is a fraction of the pour at the step the finger entered the zone',
    !!lift && lift.progress > 0 && lift.progress < 1, { liftStep, progress: lift && lift.progress });
  rec('and it is fully poured only once the pointer reaches the faucet itself',
    !!atTap && atTap.action && atTap.action.op === 'fill' && atTap.progress > 0.9, atTap);
  const lifted = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos(), cap: g.state.caps[0] }; })()`);
  rec('that one gesture cost exactly one move and filled the bucket',
    lifted.moves === 1 && lifted.pos[0] === lifted.cap, lifted);

  // Play the whole certified route with the mouse.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(220);
  const play = await points();
  const geom = (act) => (act.op === 'fill'
    ? { from: play.buckets[act.i], to: play.tap }
    : act.op === 'dump'
      ? { from: play.buckets[act.i], to: play.drain }
      : { from: play.buckets[act.i], to: play.buckets[act.j] });
  let played = 0;
  const trail = [];
  let broke = null;
  for (const act of route) {
    const w = geom(act);
    if (!w.from || !w.to) { broke = { act, w }; break; }
    const before = await moves();
    await dragTo(w.from, w.to);
    const after = await state();
    played++;
    trail.push({ op: act.op, i: act.i, j: act.j === undefined ? null : act.j, moves: after.moves });
    if (after.moves !== before + 1) { broke = { act, before, after: after.moves }; break; }
  }
  rec('the mouse plays the whole certified route, one move per drag', played === route.length && played > 0 && !broke, broke || trail);

  const end = await runJS(`(() => {
    const g = window.pour;
    return { state: g.state, pos: g.pos(), stars: document.getElementById('stars').textContent,
      verdict: document.getElementById('verdict').textContent, tally: document.getElementById('tally').textContent,
      curtain: !document.getElementById('curtain').hidden, record: g.store.record(g.state.id) };
  })()`);
  rec('the water lands on the number and the game says so',
    end.state.done === true && end.pos.some((v, i) => v === end.state.need), { pos: end.pos, need: end.state.need });
  rec('the win card goes up with three stars', end.curtain && end.stars === '★★★' && end.verdict === '分毫不差', `${end.stars} ${end.verdict}`);
  rec('the card prints the measured numbers, not a score',
    new RegExp(String(end.state.par)).test(end.tally) && /并列最短/.test(end.tally), end.tally);
  rec('a par run is on record as perfect', !!end.record && end.record.best === end.state.par && end.record.perfect === true, end.record);

  // A board that has measured out its number takes no further input.
  const p1 = await points();
  await dragTo(p1.buckets[0], p1.tap, 3);
  rec('the board refuses further drags once the water is measured', (await moves()) === end.state.par, await moves());

  await runJS(`document.getElementById('again').click(); 'ok'`);
  await sleep(220);
  rec('再来一次 clears the card as well as the count',
    await runJS('window.pour.state.moves === 0 && document.getElementById("curtain").hidden'), await state());

  const p2 = await points();
  await dragTo(p2.buckets[0], { x: p2.buckets[0].x + 1, y: p2.buckets[0].y + 1 }, 2);
  rec('pressing and releasing in place does nothing', (await moves()) === 0, await moves());

  // An empty bucket aimed at another changes nothing: refused before release, unbilled after.
  const p3 = await points();
  await mouse('mousePressed', p3.buckets[0].x, p3.buckets[0].y, 1);
  await mouse('mouseMoved', p3.buckets[1].x, p3.buckets[1].y, 1);
  const empty = await runJS('window.pour.dragState()');
  await mouse('mouseReleased', p3.buckets[1].x, p3.buckets[1].y, 0);
  await sleep(120);
  rec('an empty bucket poured into another is refused before it is released',
    !!empty && !!empty.action && empty.action.op === 'pour' && empty.legal === false && empty.progress === 0, empty);
  rec('and releasing that illegal drag does not spend a move', (await moves()) === 0, await moves());
  rec('the shell says out loud that nothing changed',
    /什么也没变/.test(await runJS('document.getElementById("hintline").textContent')),
    await runJS('document.getElementById("hintline").textContent'));

  // Filling a bucket that is already full: the same refusal at the other zone. The bucket is
  // filled by the mouse as well, so nothing in this block reaches the rules except through a
  // gesture — `pour.play()` here would only have proved that `commit()` refuses, which @play
  // already proves without a browser.
  const p35 = await points();
  await dragTo(p35.buckets[0], p35.tap);
  const p4 = await points();
  await mouse('mousePressed', p4.buckets[0].x, p4.buckets[0].y, 1);
  await mouse('mouseMoved', p4.tap.x, p4.tap.y, 1);
  const full = await runJS('window.pour.dragState()');
  await mouse('mouseReleased', p4.tap.x, p4.tap.y, 0);
  await sleep(120);
  rec('a full bucket under the faucet is not a move either',
    !!full && full.legal === false && (await moves()) === 1, { full, moves: await moves() });

  // A press outside every zone is ignored: three drop zones and nothing else.
  const dead = await runJS(`(() => {
    const r = document.getElementById('bench').getBoundingClientRect();
    return { x: Math.round(r.left + 2), y: Math.round(r.top + 24), moves: window.pour.state.moves };
  })()`);
  await mouse('mousePressed', dead.x, dead.y, 1);
  await mouse('mouseMoved', dead.x + 40, dead.y + 40, 1);
  const noZone = await runJS('window.pour.dragState()');
  await mouse('mouseReleased', dead.x + 40, dead.y + 40, 0);
  await sleep(120);
  rec('a press outside every drop zone starts nothing', noZone === null, noZone);
  rec('and it leaves the count where it was', (await moves()) === dead.moves, { dead, after: await moves() });

  // Over-drag, the assertion the whole suite exists for. Bucket 1 is filled *with the mouse*,
  // so pouring it into the last bucket is legal; the pointer is then walked into the target
  // bucket and on past its rim towards the right edge of the canvas.
  //
  // The walk through the target is not decoration: the view's zones are narrow rectangles and a
  // single pointer event from the source straight to a point outside every zone never registers
  // the intended destination at all (the sticky target is still the bucket under the finger), so
  // the previous revision of this block graded a drag that had no action in it and asserted a
  // move count of 1 for a gesture sequence that spends two. `want` is the projection computed
  // here from the pixels asked for — it is not read back from the implementation — so the clamp
  // is graded, not described.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(200);
  const p45 = await points();
  await dragTo(p45.buckets[0], p45.tap); // a real fill, so the pour that follows is legal
  const afterFill = await moves();
  const p5 = await points();
  const rect = await runJS(`(() => { const r = document.getElementById('bench').getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; })()`);
  const last = p5.buckets.length - 1;
  const src = p5.buckets[0];
  const dst = p5.buckets[last];
  const vx = dst.x - src.x;
  const vy = dst.y - src.y;
  const way = {
    x: Math.min(Math.round(rect.r - 3), Math.round(dst.x + vx)),
    y: Math.round(Math.min(rect.b - 3, Math.max(rect.t + 3, dst.y + vy))),
  };
  const want = ((way.x - src.x) * vx + (way.y - src.y) * vy) / (vx * vx + vy * vy);
  await mouse('mousePressed', src.x, src.y, 1);
  await mouse('mouseMoved', dst.x, dst.y, 1);
  const aimed = await runJS('window.pour.dragState()');
  await mouse('mouseMoved', way.x, way.y, 1);
  const over = await runJS('window.pour.dragState()');
  await mouse('mouseReleased', way.x, way.y, 0);
  await sleep(140);
  rec('aimed at a bucket the drag reads as a legal pour of exactly that pair',
    !!aimed && aimed.action && aimed.action.op === 'pour' && aimed.action.i === 0 && aimed.action.j === last
    && aimed.legal === true && aimed.progress === 1, aimed);
  rec('the pointer really went past the rim it was aimed at',
    want > 1.2 && way.x > dst.x + dst.bw / 2 + 8 && !!over && Math.abs(over.over - want) < 0.06,
    { want, beyondRimBy: way.x - (dst.x + dst.bw / 2), over, way, src, dst, rect });
  rec('an over-drag keeps its intent and previews a clamped pour',
    !!over && over.progress === 1 && over.over > 1 && !!over.action && over.action.op === 'pour'
    && over.action.j === last && !!over.target && over.target.i === last, over);
  const clamped = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos(), caps: g.state.caps }; })()`);
  const shouldMove = Math.min(clamped.caps[0], clamped.caps[last]);
  rec('and the water still stops at the rim: one more move, exactly the amount the rules allow',
    clamped.moves === afterFill + 1 && clamped.pos[last] === shouldMove
    && clamped.pos[0] === clamped.caps[0] - shouldMove, { afterFill, want: shouldMove, ...clamped });
  rec('no bucket is ever asked to hold more than its capacity',
    clamped.pos.every((v, i) => v >= 0 && v <= clamped.caps[i]), clamped);

  // The two refusals the model shares with the tap and the drain, done with the mouse rather
  // than with the object: a pour into a bucket that is already full (the amount would have
  // nowhere to go) and a drain on a bucket that is already empty. Both are set up by dragging,
  // so the only thing page-side JS is used for here is reading the result back.
  await runJS(`window.pour.load('#/c/1'); 'ok'`);
  await sleep(240);
  const q0 = await points();
  await dragTo(q0.buckets[0], q0.tap); // fill the source
  const q1 = await points();
  await dragTo(q1.buckets[last], q1.tap); // fill the would-be destination
  const before = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos(), caps: g.state.caps }; })()`);
  const dry = before.pos.findIndex((v, i) => v === 0 && i !== 0 && i !== last);
  const qs = await points();
  await mouse('mousePressed', qs.buckets[0].x, qs.buckets[0].y, 1);
  await mouse('mouseMoved', qs.buckets[last].x, qs.buckets[last].y, 1);
  const intoFull = await runJS('window.pour.dragState()');
  await mouse('mouseReleased', qs.buckets[last].x, qs.buckets[last].y, 0);
  await sleep(130);
  rec('a pour into a full bucket is refused while the finger is still down',
    !!intoFull && !!intoFull.action && intoFull.action.op === 'pour' && intoFull.action.j === last
    && intoFull.legal === false && intoFull.progress === 0, { intoFull, before });
  const afterFull = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos() }; })()`);
  rec('and releasing it neither spends a move nor moves a drop',
    afterFull.moves === before.moves && String(afterFull.pos) === String(before.pos), { before, after: afterFull });
  if (dry < 0) {
    rec('there is a dry bucket left on this bench to waste a drain on', false, before);
  } else {
    const qd = await points();
    await mouse('mousePressed', qd.buckets[dry].x, qd.buckets[dry].y, 1);
    await mouse('mouseMoved', qd.drain.x, qd.drain.y, 1);
    const emptyDrain = await runJS('window.pour.dragState()');
    await mouse('mouseReleased', qd.drain.x, qd.drain.y, 0);
    await sleep(130);
    rec('draining an empty bucket is refused the same way',
      !!emptyDrain && !!emptyDrain.action && emptyDrain.action.op === 'dump'
      && emptyDrain.action.i === dry && emptyDrain.legal === false, { dry, emptyDrain });
    const afterDry = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos() }; })()`);
    rec('and it is not billed either', afterDry.moves === before.moves && String(afterDry.pos) === String(before.pos),
      { before, after: afterDry });
  }

  // Dragging back onto the bucket the gesture started from has to mean *nothing*: the view
  // answers a cancel rather than a self-pour, so releasing must be free. That is a requirement
  // of the brief (§4 "松手前可以拖回原桶取消") and until now nothing in the suite touched it —
  // the illegal-drag rows above only prove refusals the *rules* make, not the one the gesture
  // itself makes. Aimed first, so the cancel is a change of mind and not a missed click.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(200);
  const c0 = await points();
  await dragTo(c0.buckets[0], c0.tap);
  const beforeCancel = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos() }; })()`);
  const cp = await points();
  await mouse('mousePressed', cp.buckets[0].x, cp.buckets[0].y, 1);
  await mouse('mouseMoved', cp.buckets[last].x, cp.buckets[last].y, 1);
  const aimedPour = await runJS('window.pour.dragState()');
  await mouse('mouseMoved', cp.buckets[0].x, cp.buckets[0].y, 1);
  const cancelled = await runJS('window.pour.dragState()');
  await mouse('mouseReleased', cp.buckets[0].x, cp.buckets[0].y, 0);
  await sleep(140);
  rec('walking the drag back onto its own bucket turns it into a cancel',
    !!aimedPour && !!aimedPour.action && aimedPour.action.op === 'pour' && aimedPour.legal === true
    && !!cancelled && cancelled.action === null && cancelled.progress === 0
    && !!cancelled.target && cancelled.target.i === cancelled.bucket && cancelled.bucket === 0,
    { aimedPour, cancelled });
  const afterCancel = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos() }; })()`);
  rec('and releasing that cancel neither spends a move nor spills a drop',
    afterCancel.moves === beforeCancel.moves && String(afterCancel.pos) === String(beforeCancel.pos),
    { beforeCancel, afterCancel });

  // The reverse gesture: faucet down onto a bucket means the same fill.
  await runJS(`window.pour.load('#/c/1'); 'ok'`);
  await sleep(240);
  const p6 = await points();
  await dragTo(p6.tap, p6.buckets[1]);
  const rev = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos(), cap: g.state.caps[1] }; })()`);
  rec('dragging from the faucet down onto a bucket fills that bucket',
    rev.moves === 1 && rev.pos[1] === rev.cap, rev);

  // The drain is below the row, so a bucket dropped there empties.
  const p7 = await points();
  await dragTo(p7.buckets[1], p7.drain);
  const drained = await runJS(`(() => { const g = window.pour; return { moves: g.state.moves, pos: g.pos() }; })()`);
  rec('and a bucket dragged to the drain empties for one move',
    drained.moves === 2 && drained.pos[1] === 0, drained);

  // Keyboard shortcuts the panel advertises.
  await key('u');
  await sleep(180);
  rec('the u key undoes', (await moves()) === 1, await moves());
  await key('u');
  await sleep(180);
  rec('twice brings the board back to dry', (await moves()) === 0 && (await runJS('window.pour.pos()')).every((v) => v === 0), await runJS('window.pour.pos()'));
  await runJS(`window.pour.play(window.pour.route().slice(0, 1)); 'ok'`);
  await key('h');
  await sleep(180);
  const hinted = await state();
  rec('the h key asks for a hint and bills it', hinted.hints === 1, { hints: hinted.hints });
  rec('and the hint names the next certified action',
    /号桶/.test(await runJS('document.getElementById("hintline").textContent')),
    await runJS('document.getElementById("hintline").textContent'));
  await key('r');
  await sleep(180);
  rec('the r key restarts', (await state()).moves === 0, await state());

  return { rows };
}

// ---------------------------------------------------------------- in-page suites

const PRELUDE = `(() => {
  const g = window.pour;
  const rows = [];
  const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
  window.__lastRows = rows;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const D = (id) => document.getElementById(id);
  const KEY = 'pour.save.v1';
  return { g, rows, rec, sleep, D, KEY };
})()`;

const SCENARIOS = {
  // The page as a player meets it first: something painted, numbers printed, no searching.
  boot: `(async () => {
    const { g, rows, rec, D } = ${PRELUDE};
    rec('the shell boots straight into the campaign', g && g.version === 1 && g.state.mode === 'campaign' && !!g.state.id, g && g.state);
    const c = D('bench');
    const box = c.getBoundingClientRect();
    rec('the canvas has a real box, not the 300x150 default',
      box.width > 260 && box.height > 260 && c.width > 260 && c.height > 260,
      { css: [Math.round(box.width), Math.round(box.height)], backing: [c.width, c.height] });
    rec('the backing store is scaled by the device pixel ratio', c.width >= Math.round(box.width), { css: box.width, px: c.width });
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0, copper = 0;
    for (let i = 3; i < d.length; i += 212) { if (d[i] > 0) lit++; }
    for (let i = 0; i + 2 < d.length; i += 212) { if (d[i] > d[i + 2] + 20) copper++; }
    rec('the bench was actually painted', lit > 40, { litSamples: lit, size: [c.width, c.height] });
    rec('and the copper faucet is among what got painted', copper > 0, { warmSamples: copper });
    const pool = g.pool;
    rec('the shipped pool loaded', !!pool && pool.lots >= 40, pool && pool.lots);
    rec('every band reports a measured range, buckets and positions included',
      Object.values(pool.byTier).every((t) => t.n > 0 && t.min <= t.max && t.bucketsMin >= 2 && t.statesMin > 0), pool.byTier);
    rec('four bands, in order, all populated', Object.keys(pool.byTier).join(',') === 'drip,measure,blend,decant', Object.keys(pool.byTier));
    rec('the browser does not search: the solver and the generator were never fetched',
      performance.getEntriesByType('resource').every((e) => !/(solve|make)\\.js$/.test(e.name)),
      performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()));
    rec('while the baked pool itself is a fetched module',
      performance.getEntriesByType('resource').some((e) => /data\\/lots\\.js$/.test(e.name)), 'lots.js');
    const gate = g.state.caps.reduce((a, x) => a * (x + 1), 1);
    rec('the state space on screen is inside the shipped gate', gate <= 20000 && g.state.states <= gate, { space: gate, reachable: g.state.states });
    const readout = D('readout').textContent;
    rec('the panel prints moves, par, record, routes and positions',
      [/已用/, /最少/, /最佳/, /解法/, /局面/, /目标/].every((re) => re.test(readout)), readout);
    rec('the printed par is the baked route length and there is more than one route class on show',
      g.state.par === g.route().length && g.state.solutions >= 1, { par: g.state.par, route: g.route().length, solutions: g.state.solutions });
    const th = D('theorem').textContent;
    rec('the number-theory line is arithmetic and agrees with the state',
      /gcd/.test(th) && /量出/.test(th) && g.state.theoremGcd >= 1 && g.state.theoremAmounts > 0
      && g.state.need % g.state.theoremGcd === 0,
      { gcd: g.state.theoremGcd, amountCount: g.state.theoremAmounts, need: g.state.need });
    rec('the caps table lists one row per bucket with the target marked',
      D('caps').querySelectorAll('tbody tr').length === g.state.caps.length && !!D('caps').querySelector('tr.tgt'),
      { rows: D('caps').querySelectorAll('tbody tr').length, caps: g.state.caps.length });
    rec('the board starts dry and the log says so', g.pos().every((v) => v === 0) && /空手/.test(D('log').textContent), g.pos());
    rec('the share line carries the id in the URL shape', D('linkline').textContent.indexOf('#/lot/' + g.state.id) >= 0, D('linkline').textContent);
    rec('the mode bar has three modes and marks the current one',
      D('modes').querySelectorAll('button').length === 3 && !!D('modes').querySelector('button[aria-current="true"]'), D('modes').textContent);
    return { rows };
  })()`,

  // Playing: the counter, the refusals, the grades, the records, the hint.
  play: `(async () => {
    const { g, rows, rec, sleep, D } = ${PRELUDE};
    g.store.reset();
    g.load('#/c/1'); await sleep(160);
    const par = g.state.par, route = g.route(), caps = g.state.caps, id = g.state.id;
    rec('the baked route is exactly par steps long', route.length === par, { route: route.length, par });

    g.play(route.slice(0, 1));
    rec('one action, one move, and the route counter agrees', g.state.moves === 1 && g.state.onRoute === 1,
      { moves: g.state.moves, onRoute: g.state.onRoute });
    const a0 = route[0];
    const expect = a0.op === 'fill' ? caps[a0.i] : (a0.op === 'dump' ? 0 : null);
    rec('the first action leaves the water where the rules put it', expect === null || g.pos()[a0.i] === expect, { action: a0, pos: g.pos() });

    // A no-change action: dumping an empty bucket is not a move.
    const dryMoves = g.state.moves;
    const dryPos = g.pos();
    const empty = dryPos.findIndex((v, i) => v === 0 && i !== a0.i);
    if (empty < 0) rec('there is an empty bucket to waste a dump on', false, dryPos);
    else {
      g.play([{ op: 'dump', i: empty }]);
      rec('an action that changes nothing is refused: count unmoved, water unmoved',
        g.state.moves === dryMoves && String(g.pos()) === String(dryPos), { dump: empty, moves: g.state.moves, pos: g.pos() });
    }

    g.play(route.slice(1));
    await sleep(180);
    rec('playing the rest of the route wins at par', g.state.done && g.state.moves === par, { moves: g.state.moves, par });
    rec('three stars and the honest wording at par',
      D('stars').textContent === '★★★' && D('verdict').textContent === '分毫不差',
      { stars: D('stars').textContent, verdict: D('verdict').textContent });
    const perfect = g.store.record(id);
    rec('a par run is recorded as perfect', !!perfect && perfect.best === par && perfect.perfect === true && perfect.plays === 1, perfect);
    rec('the campaign unlocked the next level', g.store.unlocked === 2 && g.state.index === 1, { unlocked: g.store.unlocked, index: g.state.index });
    rec('the win card offers 下一关', !D('next').hidden, D('next').hidden);
    D('next').click(); await sleep(200);
    rec('下一关 advances to level two with a dry board',
      g.state.index === 2 && g.state.moves === 0 && g.pos().every((v) => v === 0), g.state);

    g.load('#/c/1'); await sleep(160);
    const home = g.pos();
    // A detour that is legal but not on the measured route: fill a bucket the first step of
    // the route does not fill, then empty it again.
    const r0 = route[0];
    const waste = { op: 'fill', i: r0.op === 'fill' ? (r0.i + 1) % caps.length : r0.i };
    g.play([waste, { op: 'dump', i: waste.i }]);
    rec('a wasted round trip costs two moves and changes nothing',
      g.state.moves === 2 && String(g.pos()) === String(home) && g.state.onRoute === -1,
      { waste, moves: g.state.moves, pos: g.pos(), home, onRoute: g.state.onRoute });
    rec('and the log says the route was left', /偏离最短路线/.test(D('log').textContent), D('log').textContent);
    const midMoves = g.undoOnce();
    const midOn = g.state.onRoute;
    const backToDry = g.undoOnce();
    rec('撤销 twice erases the detour: the deviation is real until the first step goes too',
      midMoves === 1 && midOn === -1 && backToDry === 0 && g.state.onRoute === 0 && g.pos().every((v) => v === 0),
      { midMoves, midOn, backToDry, onRoute: g.state.onRoute, pos: g.pos() });

    D('restart').click(); await sleep(160);
    rec('重开 clears the count and the card', g.state.moves === 0 && D('curtain').hidden, g.state);

    const billed = g.store.stats.hints, flawless = g.store.stats.perfect;
    const h = g.hintOnce();
    rec('the hint names a bucket and how many moves are left',
      h.hints === 1 && /号桶/.test(h.line) && /之后还需/.test(h.line), h);
    rec('a hint is a suggestion, not a move', g.state.moves === 0, g.state.moves);
    g.play(g.route()); await sleep(180);
    rec('a hinted par run bills the hint but not the perfect tally',
      g.store.stats.hints === billed + 1 && g.store.stats.perfect === flawless && g.store.record(id).perfect === true,
      { hints: g.store.stats.hints, perfect: g.store.stats.perfect, record: g.store.record(id) });
    rec('and its play count went up', g.store.record(id).plays === 2, g.store.record(id));

    D('restart').click(); await sleep(160);
    g.play([{ op: 'fill', i: 0 }, { op: 'dump', i: 0 }, { op: 'fill', i: 0 }, { op: 'dump', i: 0 }]);
    g.play(g.route()); await sleep(180);
    rec('four moves wasted past par still wins, one star and no medal',
      g.state.done && g.state.moves === par + 4 && D('stars').textContent === '★☆☆' && D('verdict').textContent === '总算量出',
      { moves: g.state.moves, par, stars: D('stars').textContent, verdict: D('verdict').textContent });
    const sloppy = g.store.record(id);
    rec('a run over par cannot take the record down or lose the flag',
      sloppy.best === par && sloppy.perfect === true && sloppy.plays === 3, sloppy);
    rec('and the totals line has been counting all along', /已量出/.test(D('totals').textContent) && /提示/.test(D('totals').textContent), D('totals').textContent);

    // The blue pixels are the proof that the rules reached the screen.
    g.load('#/c/1'); await sleep(160);
    g.play([{ op: 'fill', i: 0 }]);
    await sleep(320);
    const wet = await (async () => {
      const c = D('bench');
      const box = c.getBoundingClientRect();
      const k = c.width / box.width;
      const p = g.bucketPoint(0);
      const x = Math.round((p.x - box.left) * k), y = Math.round((p.y - box.top) * k);
      const w = Math.max(4, Math.round(p.bw * k * 0.6));
      const strip = c.getContext('2d').getImageData(Math.max(0, x - w / 2), Math.max(0, y), w, Math.max(4, Math.round(p.scale * k * 0.5))).data;
      let blue = 0;
      for (let i = 0; i + 2 < strip.length; i += 4) if (strip[i + 2] > strip[i] + 20) blue++;
      return { blue, at: [x, y] };
    })();
    rec('a filled bucket is drawn with water, not with a number alone', wet.blue > 3, wet);
    return { rows };
  })()`,

  // Routing: hashes, clamps, the daily, the share link, cross-checked against node.
  routes: `(async () => {
    const { g, rows, rec, sleep } = ${PRELUDE};
    const DAILY_ID = ${JSON.stringify(DAILY_ID)};
    const RANDOM_ID = ${JSON.stringify(RANDOM_ID)};
    g.load('#/c/7'); await sleep(160);
    rec('#/c/7 is level seven', g.state.index === 7 && g.state.mode === 'campaign', g.state);
    rec('and the URL agrees', location.hash === '#/c/7', location.hash);
    g.load('#/c/99999'); await sleep(160);
    rec('a huge index clamps to the last level', g.state.index === g.pool.lots, { index: g.state.index, lots: g.pool.lots });
    g.load('#/c/0'); await sleep(160);
    rec('index zero clamps up to one', g.state.index === 1, g.state.index);
    g.load('#/c/-4'); await sleep(160);
    rec('a negative index cannot walk off the front', g.state.index === 1, g.state.index);
    g.load('#/c/not-a-number'); await sleep(160);
    rec('junk in the hash still lands on a playable level', g.state.index === 1 && !!g.state.id && g.route().length === g.state.par, g.state);
    g.load('#/c/12'); await sleep(160);
    rec('a mid-pool level is a real puzzle with a real band', g.state.index === 12 && !!g.state.tier && g.state.states > 0, g.state);

    g.load('#/daily'); await sleep(160);
    const daily = g.state.id;
    g.load('#/c/1'); await sleep(160);
    g.load('#/daily'); await sleep(160);
    rec('the daily route is the same puzzle twice', g.state.mode === 'daily' && g.state.id === daily, { first: daily, again: g.state.id });
    rec('the daily label carries the date', /^每日倒水 · \\d{4}-\\d{2}-\\d{2}$/.test(g.state.label), g.state.label);
    rec("and it is the puzzle node's library picked for today", !DAILY_ID || g.state.id === DAILY_ID, { browser: g.state.id, node: DAILY_ID });
    rec('the daily board is playable: its route matches its par', g.route().length === g.state.par, { route: g.route().length, par: g.state.par });
    rec('the daily does not consume the campaign pointer', g.state.mode === 'daily' && g.store.unlocked >= 1, { unlocked: g.store.unlocked });

    for (const tier of Object.keys(g.pool.byTier)) {
      g.load('#/random/' + tier + '/fixedseed'); await sleep(150);
      const first = g.state.id;
      g.load('#/c/1'); await sleep(150);
      g.load('#/random/' + tier + '/fixedseed'); await sleep(150);
      rec('#/random/' + tier + ' stays in its band and repeats itself',
        g.state.tier === tier && g.state.id === first, { tier: g.state.tier, id: g.state.id, first });
    }
    g.load('#/random/blend/fixed'); await sleep(160);
    rec('a share link resolves to the id node derived from the same seed',
      !RANDOM_ID || g.state.id === RANDOM_ID, { browser: g.state.id, node: RANDOM_ID });
    g.load('#/random/drip/aaa'); await sleep(150);
    const other = g.state.id;
    g.load('#/random/drip/bbb'); await sleep(150);
    rec('a different token can mean a different puzzle', g.state.id !== other || g.pool.byTier.drip.n === 1, { aaa: other, bbb: g.state.id });
    g.load('#/random'); await sleep(260);
    rec('a bare #/random mints a token into the URL', /^#\\/random\\/[a-z]+\\/[a-z0-9]+$/.test(location.hash), location.hash);

    g.load('#/c/5'); await sleep(150);
    const sample = g.state.id;
    g.load('#/c/1'); await sleep(150);
    g.load('#/lot/' + sample); await sleep(150);
    rec('#/lot/<id> opens that lot', g.state.id === sample && g.state.mode === 'lot', { want: sample, got: g.state.id });
    rec('a shared lot shows its own band and its own numbers',
      g.state.par >= 1 && g.state.states > 0 && !!g.state.tier && g.route().length === g.state.par, g.state);
    g.load('#/lot/not-a-real-lot'); await sleep(150);
    rec('an unknown id falls back instead of blanking the board', !!g.state.id && g.state.mode === 'lot' && g.state.par >= 1, g.state);

    g.load('#/c/1'); await sleep(180);
    const shelfButtons = [...document.querySelectorAll('#shelf button[data-index]')];
    rec('the campaign shelf lists the whole pool as buttons', shelfButtons.length === g.pool.lots, { shelf: shelfButtons.length, lots: g.pool.lots });
    rec('unplayed levels past the unlock pointer are disabled', shelfButtons.some((b) => b.disabled) && !shelfButtons[0].disabled,
      { disabled: shelfButtons.filter((b) => b.disabled).length, unlocked: g.store.unlocked });
    const enabled = shelfButtons.filter((b) => !b.disabled);
    const locked = shelfButtons.find((b) => b.disabled);
    if (locked) { locked.click(); await sleep(160); }
    rec('a locked shelf button cannot be clicked through',
      !!locked && g.state.index === 1, { tried: locked && Number(locked.dataset.index), index: g.state.index });
    const target = enabled[enabled.length - 1];
    const wantIndex = Number(target && target.dataset.index);
    if (target) { target.click(); await sleep(180); }
    rec('clicking an unlocked shelf button routes there',
      !!target && g.state.index === wantIndex && !!g.state.id && g.route().length === g.state.par,
      { want: wantIndex, got: g.state.index, unlocked: g.store.unlocked });
    return { rows };
  })()`,

  // The save file, in a browser that really has localStorage.
  save: `(async () => {
    const { g, rows, rec, sleep, D, KEY } = ${PRELUDE};
    g.store.reset();
    g.load('#/c/1'); await sleep(160);
    rec('a wiped save is empty', Object.keys(g.store.records).length === 0 && g.store.unlocked === 1, { unlocked: g.store.unlocked });
    rec('and the disk key is gone with it', localStorage.getItem(KEY) === null, localStorage.getItem(KEY));

    g.play(g.route());
    await sleep(180);
    const id = g.state.id, par = g.state.par;
    const raw = JSON.parse(localStorage.getItem(KEY));
    rec('the solve reaches localStorage, not only memory', !!(raw && raw.records[id] && raw.records[id].best === par), raw && Object.keys(raw.records || {}));
    // 盘上那一份的键集合：dfdde13 起 blank() 多带一位格式版本（test/storage.test.mjs:122 那句
    // "and a format version" 是这一形状的出处），所以这里少一个名字就是这条腿在吃旧形状。
    rec('one key holds the whole save', Object.keys(JSON.parse(localStorage.getItem(KEY))).sort().join(',') === 'daily,records,stats,unlocked,v', Object.keys(JSON.parse(localStorage.getItem(KEY))));
    rec('the save stamps its own format version', JSON.parse(localStorage.getItem(KEY)).v === 1, JSON.parse(localStorage.getItem(KEY)).v);
    rec('clearing the first level unlocks the second', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked });
    rec('the totals line counts it', /已量出/.test(D('totals').textContent) && /1/.test(D('totals').textContent), D('totals').textContent);
    const shelf2 = document.querySelector("#shelf button[data-index='2']");
    rec('the shelf lets level two be clicked', !!shelf2 && !shelf2.disabled, shelf2 && shelf2.outerHTML);
    if (shelf2) { shelf2.click(); await sleep(200); }
    rec('and clicking it takes you there', g.state.index === 2 && g.state.mode === 'campaign', g.state);

    g.load('#/c/1'); await sleep(160);
    g.play([{ op: 'fill', i: 0 }, { op: 'dump', i: 0 }].concat(g.route()));
    await sleep(180);
    const worse = g.store.record(id);
    rec('a worse replay cannot raise your best but does count as a play',
      worse.best === par && worse.plays === 2 && worse.perfect === true, worse);
    rec('the panel prints the record next to par', D('readout').textContent.indexOf(String(par)) >= 0, D('readout').textContent);

    g.load('#/daily'); await sleep(180);
    const day = g.state.label.split(' · ')[1];
    g.play(g.route()); await sleep(180);
    const mark = g.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.id === g.state.id, { day, mark });
    rec('the shelf says today is done', /已通过/.test(D('shelf').textContent), D('shelf').textContent);
    rec('the daily mark is on disk under the same key',
      JSON.parse(localStorage.getItem(KEY)).daily[day].id === g.state.id, JSON.parse(localStorage.getItem(KEY)).daily);

    await new Promise((res) => { window.addEventListener('hashchange', res, { once: true }); location.hash = '#/c/3'; });
    await sleep(180);
    rec('records survive a route change', !!g.store.record(id) && g.store.unlocked >= 2, { unlocked: g.store.unlocked });

    // A save from an earlier bake, and a hostile one: a fresh document has to read the disk
    // for real, which is why this runs in an iframe rather than on this page's cache.
    const frameWith = async (payload, label) => {
      if (payload === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, payload);
      const f = document.createElement('iframe');
      f.setAttribute('style', 'position:fixed;left:0;top:0;width:900px;height:820px;border:0');
      f.src = location.pathname + '#/c/1';
      document.body.appendChild(f);
      const deadline = Date.now() + 10000;
      while (!(f.contentWindow && f.contentWindow.pour && f.contentWindow.pour.state && f.contentWindow.pour.state.id)) {
        if (Date.now() > deadline) { f.remove(); return null; }
        await sleep(120);
      }
      const seen = { p: f.contentWindow.pour, el: f };
      seen.rows = () => ({ id: seen.p.state.id, moves: seen.p.state.moves, records: Object.keys(seen.p.store.records).length, unlocked: seen.p.store.unlocked, stats: seen.p.store.stats });
      return seen;
    };

    const junk = await frameWith(JSON.stringify({ records: 'nope', daily: null, unlocked: -5, stats: { perfect: 7 } }));
    rec('a wrong-shaped save boots a playable board', !!junk && !!junk.rows().id && junk.rows().moves === 0, junk && junk.rows());
    rec('junk in the record bag is read as no records', !!junk && junk.rows().records === 0, junk && junk.rows());
    rec('a negative unlock pointer is clamped to one', !!junk && junk.rows().unlocked === 1, junk && junk.rows());
    rec('and saving on top of the junk produces a real record',
      !!junk && (junk.p.play(junk.p.route()), true) && await (async () => { await sleep(200); return !!JSON.parse(localStorage.getItem(KEY)).records[junk.p.state.id]; })(),
      junk && localStorage.getItem(KEY) && JSON.parse(localStorage.getItem(KEY)).records);
    if (junk) junk.el.remove();

    const broken = await frameWith('{not json at all');
    rec('malformed JSON on disk does not brick the page', !!broken && !!broken.rows().id && broken.rows().records === 0, broken && broken.rows());
    if (broken) broken.el.remove();

    const old = await frameWith(JSON.stringify({
      records: { 'ghost-01': { solved: true, best: 3, plays: 4, perfect: true } },
      daily: {}, unlocked: 9, stats: { solves: 8, perfect: 3, moves: 51, hints: 2 },
    }));
    rec('a save from an older bake keeps what it recognises',
      !!old && old.rows().unlocked === 9 && old.rows().records === 1 && old.rows().stats.moves === 51, old && old.rows());
    if (old) old.el.remove();

    const clean = await frameWith(null);
    rec('with no key at all the fresh page starts at level one', !!clean && clean.rows().unlocked === 1 && clean.rows().records === 0, clean && clean.rows());
    if (clean) clean.el.remove();

    // The wipe is the only destructive control, so it arms on the first click.
    g.load('#/c/1'); await sleep(160);
    g.play(g.route()); await sleep(180);
    const before = { records: Object.keys(g.store.records).length, disk: !!localStorage.getItem(KEY) };
    D('wipe').click(); await sleep(90);
    rec('the first click only arms it and says so',
      before.disk && before.records > 0 && Object.keys(g.store.records).length === before.records
      && !!localStorage.getItem(KEY) && /再点一次/.test(D('toast').textContent),
      { before, after: Object.keys(g.store.records).length, toast: D('toast').textContent });
    D('wipe').click(); await sleep(240);
    rec('清空存档 takes two clicks and clears everything',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { records: Object.keys(g.store.records), unlocked: g.store.unlocked, key: localStorage.getItem(KEY) });
    rec('the page is still playable after the wipe', g.state.par >= 1 && g.state.moves === 0, g.state);
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
