// Canvas renderer + pointer handling. This file owns pixels and gestures and decides
// nothing about legality: on release it hands `main.js` an action object, and js/core/game.js
// applies it (or refuses it). The ghost water drawn while you drag is a preview computed with
// the same formula js/core/jug.js uses, which is why an illegal drag visibly refuses to move.
//
// Layout, per the spec: the buckets in a row, the faucet above them in the middle, the drain
// to the right below. Three drop zones and nothing else, so an over-drag can only leave the
// zone it was heading for — it can never cross into the other one.
//
// No image files anywhere in this repo: buckets, water, graduation marks, faucet and grate
// are all drawn here. Device-pixel ratio is folded into the transform; everything else is in
// CSS pixels.

import { FILL, DUMP, POUR } from './core/jug.js';
import { legal } from './core/game.js';

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

export function createView(canvas, { onCommit } = {}) {
  const ctx = canvas.getContext('2d');
  let game = null;
  // shown[] chases pos[] so a pour reads as water travelling rather than as two screenshots.
  let shown = [];
  let drag = null; // { i, z0, target, now, action, ok, progress, over }
  let hint = null; // { action, until }
  let raf = 0;

  // ---- 减弱动效（prefers-reduced-motion）----
  // 本仓有四处随时间走的装饰：① 水流虚线 lineDashOffset 每秒推进 25px（流动的"活水"）；
  // ② 壶嘴那滴下落的水 t=(now%1600)/1600；③ 通关后达标瓶的呼吸环（1100ms）；
  // ④ 提示环（900ms）。四处都只改相位，不承载任何状态 —— 指向哪一步由 hint.action
  // 决定、瓶到没到由 game.pos === comp.need 决定。
  // 减弱动效下四处相位统统钉成固定值：水线还是水线、壶嘴还是那滴水、环还在、达标环还在，
  // 只是不再流动。与 ferry-cos / hashi / nine-rings 同口径：相位是装饰，形状是反馈。
  let reduceMotion = false;
  const flowOffset = () => (reduceMotion ? -4 : -(performance.now() / 40) % 11);
  const dripPhase = () => (reduceMotion ? 0.5 : (performance.now() % 1600) / 1600);
  const goalPhase = () => (reduceMotion ? 0.5 : (performance.now() % 1100) / 1100);
  const hintPhase = () => (reduceMotion ? 0.5 : (performance.now() % 900) / 900);
  let last = 0;
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
    if (rectHit(geom.tap, p)) return { z: 'tap', i: columnAt(p.x) };
    if (rectHit(geom.drain, p)) return { z: 'drain', i: columnAt(p.x) };
    for (let i = 0; i < geom.boxes.length; i++) {
      const b = geom.boxes[i];
      if (p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 8 && p.y <= geom.bottom + 4) {
        return { z: 'bucket', i };
      }
    }
    return { z: 'none', i: columnAt(p.x) };
  }

  function centre(z, i) {
    if (z === 'tap') return { x: geom.tap.x + geom.tap.w / 2, y: geom.tap.y + geom.tap.h / 2 };
    if (z === 'drain') return { x: geom.drain.x + geom.drain.w / 2, y: geom.drain.y + geom.drain.h / 2 };
    const b = geom.boxes[i] || { x: geom.x0, y: geom.bottom - 40, w: geom.bw };
    return { x: b.x + b.w / 2, y: b.y + (geom.bottom - b.y) / 2 };
  }

  function localPoint(ev) {
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
    if (!game || game.done) return;
    const p = localPoint(ev);
    const z = zoneAt(p);
    if (z.z === 'none') return;
    drag = { i: z.i, z0: z.z, target: z, now: p, from: p, progress: 0, over: 0, action: null, ok: false };
    if (hint && (hint.action.i === z.i || hint.action.j === z.i)) hint = null;
    try {
      if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
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
    ctx.lineDashOffset = flowOffset();
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo((from.x + to.x) / 2, Math.min(from.y, to.y) + 10, to.x, to.y);
    ctx.stroke();
    ctx.restore();
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
    const t = dripPhase();
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
    const b = geom.boxes[i];
    const comp = game.comp;
    const cap = comp.caps[i];
    const r = Math.max(4, Math.round(b.w * 0.12));

    ctx.save();
    roundBottom(ctx, b.x, b.y, b.w, b.h, r);
    const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.015)');
    g.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    const wh = Math.max(0, geom.scale * lvl);
    const wy = geom.bottom - wh;
    const wg = ctx.createLinearGradient(0, wy, 0, geom.bottom);
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
      const y = geom.bottom - geom.scale * t;
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
      const y = geom.bottom - geom.scale * comp.need;
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
    ctx.fillText(`${i + 1} 号 · ${cap}`, b.x + b.w / 2, geom.bottom + 18);
    ctx.fillStyle = lvl > 0.5 ? 'rgba(240, 250, 255, 0.96)' : 'rgba(226,232,240,0.4)';
    ctx.font = `600 ${Math.max(15, Math.round(b.w * 0.34))}px monospace`;
    ctx.fillText(String(Math.round(lvl)), b.x + b.w / 2,
      Math.min(geom.bottom - 6, Math.max(b.y + 22, geom.bottom - Math.max(0, geom.scale * lvl) + 24)));

    if (game.done && comp.goal[i] && game.pos[i] === comp.need) {
      const t = goalPhase();
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
      const t = hintPhase();
      ctx.strokeStyle = `rgba(224, 166, 60, ${(0.9 - t * 0.55).toFixed(3)})`;
      ctx.lineWidth = 2 + t * 4;
      roundBottom(ctx, b.x - 4 - t * 6, b.y - 4 - t * 6, b.w + 8 + t * 12, b.h + 8 + t * 6, r + 6);
      ctx.stroke();
    }
  }

  function draw() {
    const { vw, bottom } = geom;
    ctx.clearRect(0, 0, geom.vw, geom.vh);
    if (!game) return;
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.fillRect(PAD, PAD + TAP - 10, vw - PAD * 2, bottom - PAD - TAP + 14);
    drawFaucet();
    drawDrain();
    const lv = levels();
    for (let i = 0; i < lv.length; i++) drawBucket(i, lv[i]);

    if (drag && drag.action && drag.progress > 0.02) {
      const a = drag.action;
      if (a.op === FILL) {
        const b = geom.boxes[a.i];
        drawStream({ x: geom.tap.x + geom.tap.w / 2 + 8, y: geom.tap.y + geom.tap.h - 12 },
          { x: b.x + b.w / 2, y: geom.bottom - geom.scale * lv[a.i] });
      } else if (a.op === DUMP) {
        const b = geom.boxes[a.i];
        drawStream({ x: b.x + b.w / 2, y: geom.bottom - geom.scale * lv[a.i] },
          { x: geom.drain.x + geom.drain.w / 2, y: geom.drain.y + 10 });
      } else {
        const s = geom.boxes[a.i];
        const d = geom.boxes[a.j];
        drawStream({ x: s.x + s.w / 2, y: s.y + 8 },
          { x: d.x + d.w / 2, y: geom.bottom - geom.scale * lv[a.j] });
      }
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, now - (last || now));
    last = now;
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
    if (hint && now >= hint.until) {
      hint = null;
      busy = true;
    }
    if (game && game.done) busy = true; // the winning ring keeps pulsing
    if (busy) draw();
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    // The gate the runtime pref flip lands on: idempotent, repaints so the water settles on the
    // same frame the setting changes rather than at the next repaint.
    setReduceMotion(v) {
      const on = !!v;
      if (on === reduceMotion) return reduceMotion;
      reduceMotion = on;
      if (reduceMotion) draw();
      return reduceMotion;
    },
    isReducedMotion: () => reduceMotion,
    attach(next) {
      game = next;
      drag = null;
      hint = null;
      shown = Array.from(next.pos);
      measure();
    },
    detach() {
      game = null;
    },
    measure,
    redraw: draw,
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
      hint = { action, until: performance.now() + 2600 };
      draw();
    },
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
