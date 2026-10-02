// The shell: hash routes in, canvas out, records in between. Nothing here knows the rules
// of the bench — those live in js/core — and nothing here draws — that is js/view.js.
//
// It also deliberately does not search. js/core/solve.js is imported by tools and by the
// node tests, never by this file: the numbers printed on screen (最少次数、解法数、可达局面)
// are measurements baked into js/data/lots.js, and a front end that recomputed them on tap
// would be a front end grading itself. The one exception is the arithmetic line below, which
// is a number-theory predicate, not a search — see js/core/theorem.js.

import { createGame, act, undo, reset, hint, grade, legal, onRoute } from './core/game.js';
import { describe, FILL, DUMP, POUR } from './core/jug.js';
import { gcdAll, reachableAmounts } from './core/theorem.js';
import { store } from './core/storage.js';
import {
  TIERS, ALL, byId, levelAt, lotsIn, randomLot, dailyLot, tierByKey, stats as poolStats,
} from './core/library.js';
import { todayKey } from './core/rng.js';
import { audio } from './audio.js';
import { prefs } from './prefs.js';
import { createView } from './view.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  caps: $('caps'), theorem: $('theorem'), log: $('log'), linkline: $('linkline'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), undo: $('undo'), hint: $('hint'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('bench'), wipe: $('wipe'),
  help: $('help'), pause: $('pause'), mute: $('mute'), fullscreen: $('fullscreen'),
  paused: $('paused-card'), resume: $('resume'), tutorial: $('tutorial'),
  tutorialTitle: $('tutorial-title'), tutorialGo: $('tutorial-go'),
};

const LEVELS = ALL.length;
const app = {
  mode: 'campaign',
  index: 1,
  route: null,
  lot: null,
  game: null,
  hints: 0,
  label: '',
  day: null,
  paused: false,
};

function clampIndex(n) {
  return Math.min(LEVELS, Math.max(1, Number(n) || 1));
}

// #/c/12 · #/daily · #/random/blend/4kq2 · #/lot/measure-03
// The id is in the URL, so a shared link resolves to the same bucket set on another device
// without the receiver needing the sender's save file.
function parseHash(hash = location.hash) {
  const p = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'daily') return { mode: 'daily' };
  if (p[0] === 'random') return { mode: 'random', tier: p[1] || TIERS[0].key, key: p[2] || null };
  if (p[0] === 'lot') return { mode: 'lot', id: p[1] };
  const n = p[0] === 'c' || p[0] === 'campaign' ? Number(p[1]) : Number(p[0]);
  return { mode: 'campaign', index: clampIndex(n) };
}

function linkFor(rt) {
  if (rt.mode === 'daily') return '#/daily';
  if (rt.mode === 'random') return `#/random/${rt.tier}/${rt.key}`;
  if (rt.mode === 'lot') return `#/lot/${rt.id}`;
  return `#/c/${rt.index}`;
}

function resolve(rt) {
  if (rt.mode === 'daily') {
    const day = todayKey();
    return { lot: dailyLot(day), label: `每日倒水 · ${day}`, note: day, day };
  }
  if (rt.mode === 'random') {
    const tier = tierByKey(rt.tier);
    return { lot: randomLot(`${tier.key}|${rt.key}`, tier.key), label: `随机 · ${tier.label}`, note: tier.blurb };
  }
  if (rt.mode === 'lot') {
    const lot = byId(rt.id) || ALL[0];
    return { lot, label: `题号 ${lot.id}`, note: tierByKey(lot.tier).blurb };
  }
  const lot = levelAt(rt.index - 1);
  return { lot, label: `第 ${rt.index} 题`, note: `共 ${LEVELS} 题 · ${tierByKey(lot.tier).label}` };
}

const view = createView(el.canvas, { onCommit: (a) => commit(a) });

function setGame(lot, label) {
  app.lot = lot;
  app.label = label || app.label;
  app.game = createGame(lot);
  app.hints = 0;
  setPaused(false); // 换题不许把上一题的暂停态带进新的一局
  view.attach(app.game);
  el.curtain.hidden = true;
  say('');
}

function say(html) {
  el.hintline.innerHTML = html;
}

function stars(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

// The arithmetic line. This is the repo's whole point stated in one sentence on screen: the
// number the search printed (par) and the verdict that an answer exists at all come from two
// different mechanisms. Nothing here enumerates states — it is gcd and a divisibility test.
function theoremLine(lot) {
  const caps = Array.from(lot.comp.caps);
  const g = gcdAll(caps);
  const r = reachableAmounts(caps);
  const ok = lot.spec.need % g === 0 && r.amounts.includes(lot.spec.need);
  return {
    gcd: g,
    amounts: r.amounts,
    html: `<b>数论判据</b>：gcd(${caps.join(', ')}) = ${g}，这组桶只能量出 ${r.amounts.join('、')} —— 要量的 ${lot.spec.need} ${ok ? '在其中' : '<span class="no">不在其中，量不出</span>'}。最少次数 ${lot.par} 由 <code>js/core/solve.js</code> 在 ${lot.states} 个可达局面上量出，两件事互不依赖。`,
  };
}

function renderCrumbs() {
  const tier = tierByKey(app.lot.tier);
  const rec = store.record(app.lot.id);
  const lot = app.lot;
  el.crumbs.innerHTML = `${app.label}<b>${tier.label}<span class="band"> ${tier.blurb}</span></b>`;
  el.readout.innerHTML = [
    field('已用', app.game.moves, '本次拖动'),
    field('最少', lot.par, '搜索量出', 'par'),
    field('最佳', rec && rec.best ? rec.best : '—', rec && rec.perfect ? '等于最少' : '你的纪录', 'best'),
    field('解法', lot.solutions, '并列最短'),
    field('局面', lot.states, '可达水量'),
    field('目标', `${lot.spec.need}`, targetsNote(lot.comp), 'need'),
  ].join('');
  const rows = [];
  for (let i = 0; i < lot.comp.k; i++) {
    rows.push(`<tr${lot.comp.goal[i] ? ' class="tgt"' : ''}><td>${i + 1}</td><td>${lot.comp.caps[i]}</td>`
      + `<td>${app.game.pos[i]}</td><td>${lot.comp.goal[i] ? (app.game.pos[i] === lot.spec.need ? '✓' : lot.spec.need) : '—'}</td></tr>`);
  }
  el.caps.querySelector('tbody').innerHTML = rows.join('');
  el.theorem.innerHTML = theoremLine(lot).html;
  el.linkline.innerHTML = `<code>#/lot/${lot.id}</code>`;
  renderLog();
  el.undo.disabled = !app.game.moves || app.game.done;
  el.hint.disabled = app.game.done;
}

function targetsNote(comp) {
  const t = [];
  for (let i = 0; i < comp.k; i++) if (comp.goal[i]) t.push(i + 1);
  return t.length === comp.k ? '任意桶' : `在 ${t.join('/')} 号桶`;
}

function renderLog() {
  const g = app.game;
  if (!g.history.length) {
    el.log.innerHTML = '<span class="off">空手 · 拖动一只桶开始</span>';
    return;
  }
  const on = onRoute(g);
  el.log.innerHTML = g.history.map((h, i) => {
    const cls = i === g.history.length - 1 ? 'now' : (on >= 0 && i < on ? '' : 'off');
    return `<span class="${cls}" title="${i + 1}">${describe(g.comp, h.action)}</span>`;
  }).join('') + (on < 0 ? '<span class="off">已偏离最短路线</span>' : '');
}

function field(label, value, note, cls = '') {
  return `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd><dt><small>${note}</small></dt></div>`;
}

function renderTotals() {
  const s = store.stats;
  el.totals.innerHTML = `已量出 <b>${Object.values(store.records).filter((r) => r.solved).length}</b>/${LEVELS}`
    + ` · 完美 <b>${Object.values(store.records).filter((r) => r.perfect).length}</b>`
    + ` · 提示 <b>${s.hints}</b>`;
}

function renderShelf() {
  if (app.mode === 'campaign') {
    const unlocked = store.unlocked;
    let html = '';
    for (const tier of TIERS) {
      html += `<p class="tier">${tier.label} · ${tier.blurb}</p>`;
      for (const lot of lotsIn(tier.key)) {
        const n = ALL.indexOf(lot) + 1;
        const rec = store.record(lot.id);
        const cls = [
          n === app.index ? 'here' : '',
          rec && rec.perfect ? 'perfect' : rec && rec.solved ? 'done' : '',
        ].filter(Boolean).join(' ');
        html += `<button type="button" data-index="${n}" class="${cls}" ${n > unlocked ? 'disabled' : ''}>${n}</button>`;
      }
    }
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-index]').forEach((b) => {
      b.addEventListener('click', () => go(`#/c/${b.dataset.index}`));
    });
    return;
  }
  if (app.mode === 'random') {
    let html = '<p class="tier">选一档难度</p>';
    for (const tier of TIERS) {
      const on = tier.key === app.route.tier ? 'here' : '';
      html += `<button type="button" class="${on}" data-tier="${tier.key}">${tier.label}<br><small>${tier.blurb}</small></button>`;
    }
    html += '<button type="button" class="wide" data-reroll="1">换一组桶</button>';
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-tier]').forEach((b) => {
      b.addEventListener('click', () => go(`#/random/${b.dataset.tier}/${token()}`));
    });
    el.shelf.querySelector('[data-reroll]').addEventListener('click', () => go(`#/random/${app.route.tier}/${token()}`));
    return;
  }
  if (app.mode === 'daily') {
    const done = app.day && store.dailyDone(app.day);
    el.shelf.innerHTML = `<p class="tier">今天这一题对所有人相同${done ? ' · 已通过' : ''}</p>`
      + `<button type="button" class="wide" data-back="1">回到闯关 第 ${store.unlocked} 题</button>`;
  } else {
    el.shelf.innerHTML = '<p class="tier">分享的题目</p>';
  }
  const back = el.shelf.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => go(`#/c/${store.unlocked}`));
}

function token() {
  return Math.random().toString(36).slice(2, 8);
}

function render() {
  el.modes.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.mode === app.mode));
  });
  renderCrumbs();
  renderTotals();
  renderShelf();
}

// The one place a move happens: the drag from the view, the replay from a test link and the
// hint's own suggestion all arrive here. A zero-change action is refused by js/core/game.js
// and must not touch the counter — that refusal is a browser assertion, not a UI detail.
function commit(action) {
  const res = act(app.game, action);
  if (!res.moved) {
    view.redraw();
    renderCrumbs();
    audio.refuse();
    say(`${describe(app.game.comp, action)} —— <b>什么也没变</b>，不计步（${res.reason}）`);
    return false;
  }
  // 一次真的水位变化：水花落在动作的目的地，音色按动作含义走（接满上扬、倒空下行、互倒扫频）。
  view.splash(view.landing(action), action.op === DUMP ? 'dump' : 'pour');
  if (action.op === FILL) audio.fill();
  else if (action.op === DUMP) audio.dump();
  else audio.pour();
  if (app.game.done) finish();
  else {
    view.redraw();
    renderCrumbs();
    say(`${describe(app.game.comp, action)} · 已用 ${app.game.moves} 次，最少 ${app.lot.par} 次`);
  }
  return true;
}

function finish() {
  const lot = app.lot;
  const g = app.game;
  const rec = store.solve(lot.id, { moves: g.moves, par: lot.par, hints: app.hints });
  const goal = Array.from(lot.comp.goal).findIndex((x) => x);
  view.splash(view.landing({ op: POUR, i: 0, j: goal < 0 ? 0 : goal }), 'win');
  audio.win();
  if (app.day) store.markDaily(app.day, lot.id);
  let nextIndex = 0;
  if (app.mode === 'campaign') {
    store.unlock(Math.max(store.unlocked, app.index + 1));
    nextIndex = app.index < LEVELS ? app.index + 1 : 0;
  }
  const gr = grade(g);
  el.stars.textContent = stars(gr.stars);
  el.verdict.textContent = gr.label;
  el.tally.innerHTML = `你用了 <b>${g.moves}</b> 次 · 搜索最少 <b>${lot.par}</b> 次 · 提示 <b>${app.hints}</b>`
    + `<br>这道题并列最短的走法有 <b>${lot.solutions}</b> 条`
    + (rec.best === g.moves ? '<br>这是这一题的最好成绩' : '');
  el.next.hidden = !nextIndex;
  el.curtain.hidden = false;
  render();
}

function go(hash) {
  if (location.hash === hash) apply();
  else location.hash = hash;
}

function apply() {
  const rt = parseHash();
  app.route = rt;
  app.mode = rt.mode;
  if (rt.mode === 'random' && !rt.key) {
    // A bare #/random/blend would mean a different puzzle on every visit and an
    // unreproducible link, so the token is minted once and written back into the URL.
    location.replace(`${location.pathname}${location.search}#/random/${rt.tier}/${token()}`);
    return;
  }
  const r = resolve(rt);
  if (!r.lot) {
    say('这一档还没有烤好的题目');
    return;
  }
  app.day = r.day || null;
  app.index = rt.mode === 'campaign' ? rt.index : ALL.indexOf(r.lot) + 1;
  setGame(r.lot, r.label);
  render();
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#/lot/${app.lot.id}`;
  const done = () => toast('链接已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => toast(url));
  } else {
    toast(url);
  }
}

// ---------- HUD：暂停 / 静音 / 全屏 / 玩法说明 ----------

// 声音开关与「看过说明」不放进成绩存档：js/core/storage.js 的字段形状由 test/storage.test.mjs
// 钉死，而且「清空存档」不该顺手把玩家的声音设置也清掉。所以是另一个 key，坏了就当没设过。
const PREF_KEY = 'pour.prefs.v1';

function readPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch (err) {
    return {}; // file:// 与隐私模式下这里必炸，偏好缺省即可
  }
}

let userPrefs = readPrefs();

function savePrefs(patch) {
  userPrefs = { ...userPrefs, ...patch };
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(userPrefs));
  } catch (err) {
    /* 这一局只在内存里记住 */
  }
}

function setPaused(on) {
  const wanted = !!on;
  if (wanted && !app.game) return app.paused;
  app.paused = wanted && view.setPaused(true);
  if (!app.paused) view.setPaused(false);
  el.pause.setAttribute('aria-pressed', String(app.paused));
  el.pause.textContent = app.paused ? '▶' : '❙❙';
  el.pause.setAttribute('aria-label', app.paused ? '继续' : '暂停');
  el.paused.hidden = !app.paused;
  if (app.paused) audio.suspend();
  else audio.resume(); // 静音态下 resume() 自己会把上下文叫醒，所以这里可以直接调
  return app.paused;
}

function setMuted(on) {
  const muted = audio.setMuted(on);
  el.mute.setAttribute('aria-pressed', String(muted));
  el.mute.textContent = muted ? '静' : '♪';
  el.mute.setAttribute('aria-label', muted ? '取消静音' : '静音');
  el.mute.title = muted ? '音效已关（M）' : '音效已开（M）';
  savePrefs({ muted });
  return muted;
}

function toggleFullscreen() {
  const node = document.documentElement;
  if (document.fullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    return false;
  }
  if (!node.requestFullscreen) {
    toast('这个浏览器没有全屏接口');
    return false;
  }
  const req = node.requestFullscreen();
  if (req && req.catch) req.catch(() => toast('系统不答应全屏'));
  return true;
}

function syncFullscreen() {
  const on = !!document.fullscreenElement;
  el.fullscreen.setAttribute('aria-pressed', String(on));
  el.fullscreen.setAttribute('aria-label', on ? '退出全屏' : '全屏');
  view.measure(); // 全屏改的是视口，量桶几何必须跟着重算
  return on;
}

function openTutorial() {
  el.tutorial.hidden = false;
  if (el.tutorialGo.focus) el.tutorialGo.focus();
  return true;
}

function closeTutorial() {
  el.tutorial.hidden = true;
  savePrefs({ taught: true });
  return false;
}

el.pause.addEventListener('click', () => setPaused(!app.paused));
el.resume.addEventListener('click', () => setPaused(false));
el.mute.addEventListener('click', () => setMuted(!audio.muted));
el.fullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreen);
el.help.addEventListener('click', () => openTutorial());
el.tutorialGo.addEventListener('click', closeTutorial);
el.tutorial.addEventListener('click', (ev) => {
  if (ev.target === el.tutorial) closeTutorial(); // 点遮罩关闭，点卡片内容不关
});

// 声音引擎只能在用户手势里起来；只试一次，之后每个动作直接走 audio.*。
function unlockAudio() {
  audio.unlock();
  window.removeEventListener('pointerdown', unlockAudio, true);
  window.removeEventListener('keydown', unlockAudio, true);
}
window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

// 减动效是系统开关，玩家随时可改：改了要立刻把画面重画一次，不然静止的水面还留着上一秒的脉动相位。
prefs.onChange(() => view.redraw());

if (userPrefs.muted) setMuted(true);
if (!userPrefs.taught) openTutorial();

el.modes.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  if (b.dataset.mode === 'campaign') go(`#/c/${clampIndex(store.unlocked)}`);
  else if (b.dataset.mode === 'daily') go('#/daily');
  else go(`#/random/${TIERS[0].key}/${token()}`);
});

el.undo.addEventListener('click', () => {
  if (undo(app.game)) {
    el.curtain.hidden = true;
    view.redraw();
    renderCrumbs();
    if (app.game.moves === 0) say('回到起点');
    else say('撤回一步');
  } else {
    say('没有可撤的步');
  }
});

// The hint walks the baked route and says so plainly. It never re-searches: once the player
// has stepped off the measured path there is no second opinion to offer on this device.
el.hint.addEventListener('click', () => {
  const h = hint(app.game);
  if (!h) {
    say('这一题已经量完了');
    return;
  }
  if (h.off) {
    say('你已经偏离了最短路线 —— 撤销到亮起的步，或者重开。前端不重新搜索，所以这里只报烘焙的那条路');
    return;
  }
  app.hints++;
  view.showHint(h.action);
  const a = h.action;
  say(a.op === POUR
    ? `提示：<b>${a.i + 1} 号桶</b> 拖到 <b>${a.j + 1} 号桶</b> —— 之后还需 <b>${h.left - 1}</b> 次`
    : `<b>${a.i + 1} 号桶</b> 拖到 <b>${a.op === FILL ? '水龙头' : '下水口'}</b> —— 之后还需 <b>${h.left - 1}</b> 次`);
  renderCrumbs();
});

function restart() {
  reset(app.game);
  app.hints = 0;
  el.curtain.hidden = true;
  setPaused(false);
  view.attach(app.game); // resets the water tween as well as the levels
  view.resetClock(); // 时钟归零、在飞的水滴与提示脉动一起清掉，否则新题带着旧相位开跑
  render();
  say('回到起点');
}

el.restart.addEventListener('click', restart);
el.share.addEventListener('click', shareLink);
el.again.addEventListener('click', restart);
el.next.addEventListener('click', () => go(`#/c/${Math.min(LEVELS, app.index + 1)}`));

// Wiping the save is the one destructive thing this game can do, so it asks twice
// instead of firing on a stray click.
let wipeArmed = false;
el.wipe.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = true;
    toast('再点一次会清空本机全部成绩');
    setTimeout(() => { wipeArmed = false; }, 4000);
    return;
  }
  store.reset();
  wipeArmed = false;
  toast('存档已清空');
  apply();
});

window.addEventListener('hashchange', apply);
window.addEventListener('resize', () => view.measure());
// 键位就是玩法说明里那一行，两边必须是同一份实现：这里只调 HUD 的那几个函数，不另写一套状态。
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  const focused = ev.target && ev.target.closest && ev.target.closest('button, [role="dialog"]');
  if (k === '?' || k === '/') { ev.preventDefault(); openTutorial(); return; }
  if (k === 'escape') {
    if (!el.tutorial.hidden) closeTutorial();
    else if (app.paused) setPaused(false);
    else if (!el.curtain.hidden) el.curtain.hidden = true;
    return;
  }
  // 焦点在按钮上时，Enter/Space 是浏览器自己的「按下这个按钮」，这里再动一次就是双重切换。
  if ((k === ' ' || k === 'spacebar' || k === 'enter') && focused) return;
  if (k === 'enter') {
    if (!el.tutorial.hidden) closeTutorial();
    else if (app.paused) setPaused(false);
    return;
  }
  if (k === ' ' || k === 'spacebar' || k === 'p') { ev.preventDefault(); setPaused(!app.paused); return; }
  if (k === 'r') el.restart.click();
  else if (k === 'u') el.undo.click();
  else if (k === 'h') el.hint.click();
  else if (k === 'm') setMuted(!audio.muted);
  else if (k === 'f') toggleFullscreen();
});

view.start();
// Deliberately not paused on visibilitychange: the water tween and the win card are driven
// from the same loop, and a tab that reports itself hidden (headless Chrome does) must still
// be able to finish a puzzle.
apply();

window.pour = {
  version: 1,
  get state() {
    return {
      mode: app.mode,
      label: app.label,
      id: app.lot && app.lot.id,
      tier: app.lot && app.lot.tier,
      index: app.index,
      moves: app.game && app.game.moves,
      par: app.lot && app.lot.par,
      solutions: app.lot && app.lot.solutions,
      states: app.lot && app.lot.states,
      need: app.lot && app.lot.spec.need,
      caps: app.lot ? Array.from(app.lot.comp.caps) : [],
      water: app.game ? Array.from(app.game.pos) : [],
      hints: app.hints,
      done: !!(app.game && app.game.done),
      onRoute: app.game ? onRoute(app.game) : -1,
      legal: app.game ? app.game.comp.acts.filter((a) => legal(app.game, a)).length : 0,
      unlocked: store.unlocked,
      solved: Object.values(store.records).filter((r) => r.solved).length,
      curtain: !el.curtain.hidden,
      hash: location.hash,
      // 对拍字段（BRIEF_COS §3）：30/60/120Hz 三档只有比这些才有意义，全部取自 view/audio 的真值。
      paused: app.paused,
      tutorial: !el.tutorial.hidden,
      muted: audio.muted,
      audio: audio.stats(),
      reducedMotion: prefs.reducedMotion,
      fullscreen: !!document.fullscreenElement,
      animClock: view.animTime(),
      shown: view.shownLevels(),
      particles: view.particleCount(),
      assets: view.assetsReady(),
      theoremGcd: app.lot ? theoremLine(app.lot).gcd : 0,
      theoremAmounts: app.lot ? theoremLine(app.lot).amounts.length : 0,
    };
  },
  get pool() { return poolStats(); },
  load(hash) { go(hash); return app.lot && app.lot.id; },
  // Client-space coordinates an automated finger needs: one bucket, the faucet, the drain.
  bucketPoint(i) { return view.bucketPoint(i); },
  faucetPoint() { return view.faucetPoint(); },
  drainPoint() { return view.drainPoint(); },
  dragState() { return view.dragState(); },
  lot() { return app.lot ? app.lot.spec : null; },
  route() { return app.lot ? app.lot.route : null; },
  pos() { return app.game ? Array.from(app.game.pos) : null; },
  // Play a baked route through the same commit() a finger uses. `acts` here are the
  // {op,i,j} triples baked into js/data/lots.js — no search on this side of the boundary.
  play(acts) {
    for (const a of acts || []) commit(a);
    return app.game.moves;
  },
  // The six actions of a two-bucket bench, and which of them currently change nothing.
  actions() {
    if (!app.game) return [];
    return app.game.comp.acts.map((a) => ({
      op: a.op, i: a.i, j: a.j, text: describe(app.game.comp, a), live: legal(app.game, a),
    }));
  },
  hintOnce() { el.hint.click(); return { hints: app.hints, line: el.hintline.textContent }; },
  undoOnce() { el.undo.click(); return app.game.moves; },
  // HUD 的控制面：测试要能「按下暂停」而不是「读到 paused:true」。
  setPaused(on) { return setPaused(on === undefined ? !app.paused : !!on); },
  setMuted(on) { return setMuted(on === undefined ? !audio.muted : !!on); },
  setReducedMotion(on) { return prefs.setReducedMotion(!!on); },
  fullscreenOnce() { return toggleFullscreen(); },
  showTutorial() { return openTutorial(); },
  hideTutorial() { return closeTutorial(); },
  splashCount(at, kind) { return view.splash(at || view.landing({ op: POUR, i: 0, j: 0 }), kind || 'pour'); },
  store,
  ops: { FILL, DUMP, POUR },
};
