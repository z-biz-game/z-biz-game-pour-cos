// Canvas renderer + pointer handling. This file owns pixels and gestures and decides
// nothing about legality: on release it hands `main.js` an action object, and js/core/game.js
// applies it (or refuses it). The ghost water drawn while you drag is a preview computed with
// the same formula js/core/jug.js uses, which is why an illegal drag visibly refuses to move.
//
// Layout, per the spec: the buckets in a row, the faucet above them in the middle, the drain
// to the right below. Three drop zones and nothing else, so an over-drag can only leave the
// zone it was heading for — it can never cross into the other one.
//
// Three bitmaps come from assets/gen/gen_art.py: the bench tile (createPattern), the stage
// backdrop (drawn under everything) and the droplet sheet (particles). Everything else —
// buckets, water, graduation marks, faucet, grate — is still drawn here, and each bitmap has a
// vector fallback so a file:// open with a missing asset looks the same, only flatter.
//
// Time discipline (§3 of the polish brief):
//   * 唯一的动画时钟是 `animClock`（秒），由 frame() 用帧 dt 累加；暂停时既不累加也不重绘。
//     所有脉动/虚线流动/水滴寿命都读它，不再读 performance.now()。
//   * 水位补间用 `1 - exp(-dt/τ)`，在相同总时长下与切分方式无关（闭式解），所以 30/60/120Hz
//     对拍同一虚拟秒必须落在同一处。
//   * 粒子不积分：位置是 (出生时刻, 年龄) 的闭式函数，帧率翻倍不会让它跑得更远。

import { FILL, DUMP, POUR } from './core/jug.js';
import { legal } from './core/game.js';
import { rngFrom } from './core/rng.js';
import { prefs } from './prefs.js';

const PAD = 14;
const TAP = 78; // band above the buckets the faucet hangs in
const DRAIN = 58; // band below them the grate sits in
const TAP_W = 132;
const TAP_H = 52;
const DRAIN_W = 104;
const DRAIN_H = 50;

const WATER_TOP = 'rgba(96, 190, 232, 0.92)';
const WATER_BOT = 'rgba(30, 92, 142, 0.95)';
const GLASS = 'rgba(226, 232, 240, 0.34)';
const NEED_LINE = 'rgba(224, 166, 60, 0.9)';
const COPPER = '#b4763f';
const STEEL = '#8b95a5';
const INK = 'rgba(226, 232, 240, 0.5)';

const BENCH_TILE = 'assets/textures/bench-tile.png';
const BACKDROP = 'assets/textures/backdrop.png';
const DROPLET_SHEET = 'assets/sprites/droplet-sheet.png';
const SHEET_FRAME = 128; // droplet-sheet.png 是 4 帧 128x128，帧序见 assets/gen/gen_art.py
const PARTICLE_LIFE = 0.9; // 秒

function roundBottom(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h - rr);
  ctx.quadraticCurveTo(x, y + h, x + rr, y + h);
  ctx.lineTo(x + w - rr, y + h);
  ctx.quadraticCurveTo(x + w, y + h, x + w, y + h - rr);
  ctx.lineTo(x + w, y);
  ctx.closePath();
}

function rectHit(z, p) {
  return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
}

// 只在真实浏览器里建 Image；node vm 里 import 这个模块不许炸。
function loadImage(src, onReady) {
  if (typeof Image === 'undefined') return { img: null, ok: false };
  const img = new Image();
  img.onload = () => onReady(img);
  img.onerror = () => { /* 缺贴图就走矢量回落，不抛 */ };
  img.src = src;
  return { img, ok: false };
}

export function createView(canvas, { onCommit } = {}) {
  const ctx = canvas.getContext('2d');
  let game = null;
  // shown[] chases pos[] so a pour reads as water travelling rather than as two screenshots.
  let shown = [];
  let drag = null; // { i, z0, target, now, action, ok, progress, over }
  let hint = null; // { action, until }  —— until 是 animClock 上的秒
  let raf = 0;
  let last = 0;
  let paused = false;
  let animClock = 0; // 秒：唯一可动的东西都读它，暂停即冻结
  let particles = [];
  let pattern = null;
  let backdrop = null;
  let sheet = null;
  const jitter = rngFrom('pour.splash');
  let geom = {
    vw: 320, vh: 320, boxes: [], x0: 0, bw: 40, gap: 24, scale: 10,
    bottom: 200, tap: { x: 94, y: 14, w: TAP_W, h: TAP_H }, drain: { x: 200, y: 210, w: DRAIN_W, h: DRAIN_H },
  };

  function caps() {
    return game ? Array.from(game.comp.caps) : [];
  }

  function measure() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = Math.max(260, Math.round(box.width));
    const H = Math.max(260, Math.round(box.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = caps();
    const k = c.length || 2;
    const availH = Math.max(96, H - PAD * 2 - TAP - DRAIN);
    const availW = W - PAD * 2;
    const gap = Math.max(24, Math.min(58, Math.round(availW * 0.06)));
    const bw = Math.max(36, Math.min(118, Math.floor((availW - gap * (k - 1)) / k)));
    const maxCap = c.length ? Math.max(...c) : 4;
    const scale = Math.max(7, Math.min(46, availH / maxCap));
    const bottom = Math.round(PAD + TAP + availH);
    const x0 = Math.round((W - (bw * k + gap * (k - 1))) / 2);
    const boxes = [];
    for (let i = 0; i < k; i++) {
      const h = Math.max(8, Math.round(scale * c[i]));
      boxes.push({ x: x0 + i * (bw + gap), y: bottom - h, w: bw, h });
    }
    geom = {
      vw: W, vh: H, boxes, x0, bw, gap, scale, bottom,
      tap: { x: Math.round(W / 2 - TAP_W / 2), y: PAD, w: TAP_W, h: TAP_H },
      drain: { x: Math.round(W - PAD - DRAIN_W), y: bottom + 6, w: DRAIN_W, h: DRAIN_H },
    };
    if (game && shown.length !== k) shown = Array.from(game.pos);
    draw();
  }

  function columnAt(x) {
    if (!geom.boxes.length) return 0;
    const first = geom.boxes[0].x - geom.gap / 2;
    const step = geom.bw + geom.gap;
    return Math.max(0, Math.min(geom.boxes.length - 1, Math.floor((x - first) / step)));
  }

  // Which of the four zones a point falls in: the faucet, the grate, a bucket, or nothing.
  // Buckets are only their own bodies, so the row of buckets and the two icons cannot overlap.
  function zoneAt(p) {
    const g = geom;
    if (rectHit(g.tap, p)) return { z: 'tap', i: columnAt(p.x) };
    if (rectHit(g.drain, p)) return { z: 'drain', i: columnAt(p.x) };
    for (let i = 0; i < g.boxes.length; i++) {
      const b = g.boxes[i];
      if (p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 8 && p.y <= g.bottom + 4) {
        return { z: 'bucket', i };
      }
    }
    return { z: 'none', i: columnAt(p.x) };
  }

  function centre(z, i) {
    const g = geom;
    if (z === 'tap') return { x: g.tap.x + g.tap.w / 2, y: g.tap.y + g.tap.h / 2 };
    if (z === 'drain') return { x: g.drain.x + g.drain.w / 2, y: g.drain.y + g.drain.h / 2 };
    const b = g.boxes[i] || { x: g.x0, y: g.bottom - 40, w: g.bw };
    return { x: b.x + b.w / 2, y: b.y + (g.bottom - b.y) / 2 };
  }

  function localPoint(ev) {
    // 一律按 getBoundingClientRect + clientX 换算：CSS 缩放或页面有滚动时，
    // offsetX/layerX 会把手机上点 A 打成 B。
    const box = canvas.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }

  // Client-space pixels: what an automated finger presses, and the only geometry the
  // playtest is allowed to know about.
  function toClient(p) {
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.round(box.left + p.x),
      y: Math.round(box.top + p.y),
      scale: geom.scale,
      bw: geom.bw,
    };
  }

  // The action a drag means, or null for a cancel. Which bucket is acted on is decided by
  // where the drag *started*, never by which column the pointer happens to be over — that
  // is what lets an over-drag leave the faucet without changing the answer.
  function actionOf(d) {
    const t = d.target;
    if (!t) return null;
    if (d.z0 === 'bucket') {
      if (t.z === 'tap') return { op: FILL, i: d.i };
      if (t.z === 'drain') return { op: DUMP, i: d.i };
      if (t.z === 'bucket' && t.i !== d.i) return { op: POUR, i: d.i, j: t.i };
      return null; // back onto itself, or onto nothing
    }
    if (d.z0 === 'tap' && t.z === 'bucket') return { op: FILL, i: t.i };
    if (d.z0 === 'drain' && t.z === 'bucket') return { op: DUMP, i: t.i };
    return null;
  }

  function track(d) {
    const act = actionOf(d);
    d.action = act;
    d.ok = !!act && legal(game, act);
    if (!act) { d.progress = 0; d.over = 0; return; }
    const a = centre(d.z0, d.i);
    // `centre` ignores the index for the two icons, so this is the target bucket for a pour
    // and the icon itself for a fill or a dump.
    const b = centre(d.target.z, d.target.i);
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    // Project the pointer onto the start→target line. `over` is the raw projection, so a
    // test can see the gesture went past the rim; `progress` is that projection clamped to
    // [0,1], which is what the ghost water uses. Illegal drags preview nothing at all.
    d.over = ((d.now.x - a.x) * vx + (d.now.y - a.y) * vy) / len2;
    d.progress = d.ok ? Math.max(0, Math.min(1, d.over)) : 0;
  }

  function down(ev) {
    if (!game || game.done || paused) return;
    const p = localPoint(ev);
    const z = zoneAt(p);
    if (z.z === 'none') return;
    drag = { i: z.i, z0: z.z, target: z, now: p, from: p, progress: 0, over: 0, action: null, ok: false };
    if (hint && (hint.action.i === z.i || hint.action.j === z.i)) hint = null;
    try {
      if (canvas.setPointerCapture && ev.pointerId !== undefined) {
        canvas.setPointerCapture(ev.pointerId);
      }
    } catch (err) {
      /* a browser that refuses capture still drags fine inside the canvas */
    }
    track(drag);
    draw();
    ev.preventDefault();
  }

  function move(ev) {
    if (!drag) return;
    const p = localPoint(ev);
    const z = zoneAt(p);
    drag.now = p;
    // Sticky: the last real zone the pointer entered is the intent, so passing over the gap
    // between two buckets on the way to the second one does not cancel the pour.
    if (z.z !== 'none') drag.target = z;
    track(drag);
    ev.preventDefault();
  }

  function up(ev) {
    if (!drag) return;
    const act = drag.action;
    drag = null;
    if (ev && ev.preventDefault) ev.preventDefault();
    if (act && onCommit) onCommit(act);
    else draw();
  }

  // Levels to draw: the tweened state, or the drag's preview on top of it.
  function levels() {
    const pos = game.pos;
    const out = [];
    for (let i = 0; i < pos.length; i++) out.push(shown[i] === undefined ? pos[i] : shown[i]);
    if (!drag || !drag.action || !drag.progress) return out;
    const a = drag.action;
    const p = drag.progress;
    if (a.op === FILL) out[a.i] = pos[a.i] + (game.comp.caps[a.i] - pos[a.i]) * p;
    else if (a.op === DUMP) out[a.i] = pos[a.i] * (1 - p);
    else {
      const moved = Math.min(pos[a.i], game.comp.caps[a.j] - pos[a.j]);
      out[a.i] = pos[a.i] - moved * p;
      out[a.j] = pos[a.j] + moved * p;
    }
    return out;
  }

  function drawStream(from, to) {
    ctx.save();
    ctx.strokeStyle = 'rgba(96, 190, 232, 0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    // 虚线流动读 animClock：暂停即停住，且不再依赖 performance.now()
    ctx.lineDashOffset = -(animClock * 26) % 11;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo((from.x + to.x) / 2, Math.min(from.y, to.y) + 10, to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  // 0..1 的周期相位。reduceMotion 下取一个固定值：图案仍在（否则水龙头会看起来像坏了），
  // 但不再动。
  function phase(period) {
    if (!prefs.motionAllowed()) return 0.32;
    return (animClock % period) / period;
  }

  function drawFaucet() {
    const { x, y, w, h } = geom.tap;
    const cx = x + w / 2;
    const spout = y + h - 16;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.font = '10px monospace';
    ctx.fillText('水源 · 把桶拖上来接满', cx, y + 8);
    // wall pipe + elbow + nozzle
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 34, y + 16);
    ctx.lineTo(cx + 6, y + 16);
    ctx.lineTo(cx + 6, spout - 6);
    ctx.stroke();
    ctx.fillStyle = COPPER;
    ctx.fillRect(cx - 2, spout - 8, 20, 9);
    ctx.fillStyle = 'rgba(226,232,240,0.22)';
    ctx.fillRect(cx - 2, spout - 8, 20, 3);
    // handle
    ctx.strokeStyle = '#c8d2e0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + 20, y + 16);
    ctx.lineTo(cx + 20, y + 6);
    ctx.stroke();
    // a drip so the zone reads as "water comes out of here"
    const t = phase(1.6);
    ctx.fillStyle = `rgba(120, 200, 240, ${(0.7 - t * 0.5).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx + 8, spout + 4 + t * 20, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // the drop zone, dashed until you aim at it
    const aimed = drag && drag.action && drag.action.op === FILL;
    ctx.strokeStyle = aimed ? 'rgba(120, 220, 255, 0.8)' : 'rgba(226,232,240,0.16)';
    ctx.setLineDash([4, 5]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  function drawDrain() {
    const { x, y, w, h } = geom.drain;
    ctx.save();
    ctx.fillStyle = 'rgba(226,232,240,0.06)';
    roundBottom(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,232,240,0.28)';
    ctx.lineWidth = 2;
    ctx.setLineDash(drag && drag.action && drag.action.op === DUMP ? [] : [4, 5]);
    roundBottom(ctx, x, y, w, h, 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(226,232,240,0.35)';
    ctx.lineWidth = 3;
    for (let i = 1; i <= 5; i++) {
      const bx = x + 12 + i * ((w - 24) / 6);
      ctx.beginPath();
      ctx.moveTo(bx, y + 12);
      ctx.lineTo(bx - 6, y + h - 8);
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('下水口', x + w / 2, y + h - 1);
    ctx.restore();
  }

  function drawBucket(i, lvl) {
    const g = geom;
    const b = g.boxes[i];
    const comp = game.comp;
    const cap = comp.caps[i];
    const r = Math.max(4, Math.round(b.w * 0.12));

    ctx.save();
    roundBottom(ctx, b.x, b.y, b.w, b.h, r);
    const grad = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y);
    grad.addColorStop(0, 'rgba(255,255,255,0.05)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.015)');
    grad.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.clip();
    const wh = Math.max(0, g.scale * lvl);
    const wy = g.bottom - wh;
    const wg = ctx.createLinearGradient(0, wy, 0, g.bottom);
    wg.addColorStop(0, WATER_TOP);
    wg.addColorStop(1, WATER_BOT);
    ctx.fillStyle = wg;
    ctx.fillRect(b.x, wy, b.w, wh);
    ctx.fillStyle = 'rgba(190, 232, 255, 0.55)';
    ctx.fillRect(b.x, wy, b.w, 2);
    ctx.restore();

    // graduation marks — the only ones on the bucket, which is the whole puzzle
    ctx.save();
    ctx.strokeStyle = 'rgba(226,232,240,0.22)';
    ctx.lineWidth = 1;
    for (let t = 1; t < cap; t++) {
      const y = g.bottom - g.scale * t;
      const long = t === cap / 2;
      ctx.beginPath();
      ctx.moveTo(b.x + 2, y);
      ctx.lineTo(b.x + (long ? b.w * 0.32 : b.w * 0.15), y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = GLASS;
    ctx.lineWidth = 2;
    roundBottom(ctx, b.x, b.y, b.w, b.h, r);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226,232,240,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x - 5, b.y);
    ctx.lineTo(b.x + b.w + 5, b.y);
    ctx.stroke();

    // the need line, on target buckets only: this is the number being measured out
    if (comp.goal[i] && comp.need <= cap) {
      const y = g.bottom - g.scale * comp.need;
      ctx.save();
      ctx.strokeStyle = NEED_LINE;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(b.x - 6, y);
      ctx.lineTo(b.x + b.w + 6, y);
      ctx.stroke();
      ctx.fillStyle = NEED_LINE;
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(String(comp.need), b.x + b.w + 8, y + 3);
      ctx.restore();
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.font = '12px monospace';
    ctx.fillText(`${i + 1} 号 · ${cap}`, b.x + b.w / 2, g.bottom + 18);
    ctx.fillStyle = lvl > 0.5 ? 'rgba(240, 250, 255, 0.96)' : 'rgba(226,232,240,0.4)';
    ctx.font = `600 ${Math.max(15, Math.round(b.w * 0.34))}px monospace`;
    ctx.fillText(String(Math.round(lvl)), b.x + b.w / 2,
      Math.min(g.bottom - 6, Math.max(b.y + 22, g.bottom - Math.max(0, g.scale * lvl) + 24)));

    if (game.done && comp.goal[i] && game.pos[i] === comp.need) {
      const t = phase(1.1);
      ctx.strokeStyle = `rgba(120, 220, 255, ${(0.9 - t * 0.6).toFixed(3)})`;
      ctx.lineWidth = 3 + t * 3;
      roundBottom(ctx, b.x - 5 - t * 5, b.y - 5 - t * 5, b.w + 10 + t * 10, b.h + 10 + t * 5, r + 6);
      ctx.stroke();
    }
    if (drag && (drag.i === i || (drag.action && drag.action.j === i))) {
      ctx.strokeStyle = drag.ok ? 'rgba(120, 220, 255, 0.85)' : 'rgba(224, 92, 92, 0.9)';
      ctx.lineWidth = 2;
      roundBottom(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, r + 3);
      ctx.stroke();
    }
    if (hint && hint.action && (hint.action.i === i || hint.action.j === i)) {
      const t = phase(0.9);
      ctx.strokeStyle = `rgba(224, 166, 60, ${(0.9 - t * 0.55).toFixed(3)})`;
      ctx.lineWidth = 2 + t * 4;
      roundBottom(ctx, b.x - 4 - t * 6, b.y - 4 - t * 6, b.w + 8 + t * 12, b.h + 8 + t * 6, r + 6);
      ctx.stroke();
    }
  }

  // 粒子位置是出生参数与年龄的闭式函数（不逐步积分），所以帧率翻倍不会让它跑得更远。
  function stepParticles() {
    if (!particles.length) return;
    particles = particles.filter((p) => animClock - p.born < p.life);
  }

  function drawParticles() {
    if (!particles.length || !prefs.motionAllowed()) return;
    ctx.save();
    for (const p of particles) {
      const age = animClock - p.born;
      const t = age / p.life;
      const x = p.x + p.vx * age;
      const y = p.y + p.vy * age + 0.5 * p.g * age * age;
      const alpha = Math.max(0, 0.9 * (1 - t));
      if (sheet) {
        const frame = Math.min(3, Math.floor(t * 4));
        const s = p.size * (0.7 + t * 0.8);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sheet, frame * SHEET_FRAME, 0, SHEET_FRAME, SHEET_FRAME, x - s / 2, y - s / 2, s, s);
      } else {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(120, 200, 240, 0.9)';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, p.size * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function draw() {
    const g = geom;
    ctx.clearRect(0, 0, g.vw, g.vh);
    if (!game) return;
    // 场地贴图：cover 裁切（不许拉变形），压暗到几乎只是氛围，桶身仍是矢量画的
    if (backdrop) {
      const s = Math.max(g.vw / backdrop.width, g.vh / backdrop.height);
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.drawImage(
        backdrop,
        (backdrop.width - g.vw / s) / 2, (backdrop.height - g.vh / s) / 2, g.vw / s, g.vh / s,
        0, 0, g.vw, g.vh,
      );
      ctx.restore();
    }
    // 工作台：有贴图就平铺，没有就退回原来那层极淡的纯色
    ctx.save();
    if (pattern) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pattern;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.015)';
    }
    ctx.fillRect(PAD, PAD + TAP - 10, g.vw - PAD * 2, g.bottom - PAD - TAP + 14);
    ctx.restore();
    drawFaucet();
    drawDrain();
    const lv = levels();
    for (let i = 0; i < lv.length; i++) drawBucket(i, lv[i]);
    drawParticles();

    if (drag && drag.action && drag.progress > 0.02) {
      const a = drag.action;
      if (a.op === FILL) {
        const b = g.boxes[a.i];
        drawStream({ x: g.tap.x + g.tap.w / 2 + 8, y: g.tap.y + g.tap.h - 12 },
          { x: b.x + b.w / 2, y: g.bottom - g.scale * lv[a.i] });
      } else if (a.op === DUMP) {
        const b = g.boxes[a.i];
        drawStream({ x: b.x + b.w / 2, y: g.bottom - g.scale * lv[a.i] },
          { x: g.drain.x + g.drain.w / 2, y: g.drain.y + 10 });
      } else {
        const s = g.boxes[a.i];
        const d = g.boxes[a.j];
        drawStream({ x: s.x + s.w / 2, y: s.y + 8 },
          { x: d.x + d.w / 2, y: g.bottom - g.scale * lv[a.j] });
      }
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, now - (last || now));
    last = now;
    // 暂停：时钟不累加、补间不推进、粒子不寿命递减，也不重绘 —— 仿真真的停住。
    if (paused) return;
    const s = dt / 1000;
    animClock += s;
    let busy = !!drag;
    if (game) {
      const tau = 1 - Math.exp(-dt / 90);
      for (let i = 0; i < game.pos.length; i++) {
        if (shown[i] === undefined) shown[i] = game.pos[i];
        const d = game.pos[i] - shown[i];
        if (Math.abs(d) > 0.004) {
          shown[i] += d * tau;
          busy = true;
        } else if (shown[i] !== game.pos[i]) {
          shown[i] = game.pos[i];
          busy = true;
        }
      }
    }
    if (hint && animClock >= hint.until) {
      hint = null;
      busy = true;
    }
    stepParticles();
    if (particles.length) busy = true;
    if (game && game.done) busy = true; // the winning ring keeps pulsing
    if (busy) draw();
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  // 回落：pointer 事件不存在时（老 Safari / iOS < 13）用 touch 与 mouse 走同一条 down/move/up，
  // 坐标仍由 localPoint 按 rect+client 换算，所以两条路径不会点出两个不同的结果。
  if (!('onpointerdown' in canvas)) {
    const touch = (get) => (ev) => {
      const t = get(ev);
      if (!t) return;
      const fake = { clientX: t.clientX, clientY: t.clientY, pointerId: 0, preventDefault: () => ev.preventDefault() };
      return fake;
    };
    const first = (ev) => (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]) || null;
    canvas.addEventListener('touchstart', (ev) => down(touch(first)(ev)), { passive: false });
    canvas.addEventListener('touchmove', (ev) => move(touch(first)(ev)), { passive: false });
    canvas.addEventListener('touchend', (ev) => up(touch(first)(ev)), { passive: false });
    canvas.addEventListener('touchcancel', (ev) => up(touch(first)(ev)), { passive: false });
    canvas.addEventListener('mousedown', (ev) => down({ ...ev, pointerId: 0 }));
    canvas.addEventListener('mousemove', (ev) => move(ev));
    canvas.addEventListener('mouseup', (ev) => up(ev));
  }

  loadImage(BENCH_TILE, (img) => {
    try {
      pattern = ctx.createPattern(img, 'repeat');
      draw();
    } catch (err) {
      pattern = null;
    }
  });
  loadImage(BACKDROP, (img) => {
    backdrop = img;
    draw();
  });
  loadImage(DROPLET_SHEET, (img) => {
    sheet = img;
  });

  // 减动效不是「下次别再生成」就完事：开关拨下的那一刻，在飞的粒子必须一起落地。
  // drawParticles() 在减动效下直接 return，所以旧粒子既看不见又还在把 `busy` 吊着空转，
  // 而 animClock 还在给它们计龄 —— 画面静止了，循环却没停。这里补上那一下清除。
  prefs.onChange((reduced) => {
    if (reduced) {
      particles = [];
      hint = null;
    }
    draw();
  });

  return {
    attach(next) {
      game = next;
      drag = null;
      hint = null;
      particles = [];
      shown = Array.from(next.pos);
      measure();
    },
    detach() {
      game = null;
    },
    measure,
    redraw: draw,
    setPaused(on) {
      paused = !!on;
      if (!paused) last = 0; // 下一帧重新取基准，暂停期间攒下的墙钟差不许一次补回来
      return paused;
    },
    // 重开要还回一个"刚开机"的动画侧：时钟、粒子、提示高亮全清。只调 game 的 reset()
    // 会留下上一题的脉动相位与在飞水滴（BRIEF_COS §2 点名的那类漏项）。
    resetClock() {
      animClock = 0;
      particles = [];
      hint = null;
      last = 0;
      draw();
    },
    get paused() { return paused; },
    // 一次动作落地时溅一小片水花。reduceMotion 下直接不产生活跃粒子。
    splash(at, kind = 'pour', n = 7) {
      if (!at || !prefs.motionAllowed() || paused) return 0;
      const count = kind === 'win' ? n * 2 : n;
      for (let i = 0; i < count; i++) {
        const ang = jitter.span(-Math.PI * 0.9, -Math.PI * 0.1);
        const spd = jitter.span(28, 96);
        particles.push({
          x: at.x, y: at.y,
          vx: Math.cos(ang) * spd * (kind === 'dump' ? -0.6 : 1),
          vy: Math.sin(ang) * spd,
          g: 190,
          born: animClock,
          life: PARTICLE_LIFE * jitter.span(0.7, 1.25),
          size: jitter.span(14, 26),
        });
      }
      return particles.length;
    },
    // 动作落地点（canvas 局部坐标，不是 client 像素）：FILL→水龙头，DUMP→下水口，POUR→被倒进的那只桶。
    // 调用方只给 action，换算留在这里，免得 main.js 猜出一套两套坐标。
    landing(action) {
      if (!game || !action) return null;
      if (action.op === FILL) return centre('tap');
      if (action.op === DUMP) return centre('drain');
      return centre('bucket', action.j);
    },
    // Where an automated finger should press, in client pixels.
    bucketPoint(i) {
      if (!game || !geom.boxes[i]) return null;
      return toClient(centre('bucket', i));
    },
    faucetPoint() {
      if (!game) return null;
      return toClient(centre('tap'));
    },
    drainPoint() {
      if (!game) return null;
      return toClient(centre('drain'));
    },
    // Live view of the drag in flight, for the pointer test: what the gesture means, how far
    // the ghost has moved, and whether the rules allow it at all.
    dragState() {
      if (!drag) return null;
      return {
        from: drag.z0,
        bucket: drag.i,
        target: drag.target && drag.target.z !== 'none' ? { z: drag.target.z, i: drag.target.i } : null,
        action: drag.action,
        legal: drag.ok,
        progress: Math.round(drag.progress * 1000) / 1000,
        over: Math.round(drag.over * 1000) / 1000,
      };
    },
    showHint(action) {
      hint = { action, until: animClock + 2.6 };
      draw();
    },
    // 对拍口径（BRIEF_COS §3）：把这三样挂到 window.pour.state 上，帧率对拍才有可比字段。
    animTime() { return Math.round(animClock * 1e6) / 1e6; },
    shownLevels() { return shown.map((v) => Math.round(v * 1e4) / 1e4); },
    particleCount() { return particles.length; },
    assetsReady() { return { benchTile: !!pattern, backdrop: !!backdrop, dropletSheet: !!sheet }; },
    start() {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
