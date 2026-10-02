// Sound. Deliberately synthesised — no audio files in this repo, same rule as the canvas
// art (js/view.js draws everything; assets/gen only produces the icons and the three
// textures/sprites it paints with).
//
// Two things this file is actually responsible for, both of which a "gain = 0" mute would
// fake:
//   * 静音 = AudioContext.suspend() + 每个发声入口在静音态直接 return，**一个振荡器都不建**
//     (`voices` 计数器就是给这条判据用的，test 与 window.pour 都能读到它停没停)。
//   * 暂停 = suspend()，恢复 = resume()，仿真与声音一起冻住，不会回来发现背景还在响。
//
// The context is created on the first real gesture (`unlock()`), because every engine that
// cares will start it in "suspended" state anyway if you construct it at import time.

let ctx = null;
let master = null;
let muted = false;
let voices = 0;      // 振荡器创建总数：静音态必须纹丝不动
let refused = 0;     // 静音态被挡掉的发声请求数（证明这道门真的被走到过）

function Ctor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function ensure() {
  if (muted) { refused++; return null; }
  const K = Ctor();
  if (!K) return null;
  if (!ctx) {
    try {
      ctx = new K();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (err) {
      ctx = null; // 没有音频设备/被策略拒绝：游戏照常玩
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function blip({ freq = 440, to = 0, dur = 0.12, type = 'sine', gain = 0.22, delay = 0 }) {
  const c = ensure();
  if (!c) return false;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.014);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  voices++;
  return true;
}

export const audio = {
  // 第一次 pointerdown / keydown 调它：让引擎在用户手势里起来，而不是在模块顶层。
  unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    return c ? c.state : 'none';
  },

  setMuted(on) {
    muted = !!on;
    if (muted) {
      // 真停：不是把 master 增益设 0。已经排队的包络随之冻结，且 ensure() 之后一律 return null。
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    } else if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return muted;
  },
  toggleMuted() { return audio.setMuted(!muted); },
  get muted() { return muted; },

  // 暂停用：与 view 的仿真冻结同时发生。静音态下不许把上下文叫醒。
  suspend() {
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    return audio.state();
  },
  resume() {
    if (!muted && ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return audio.state();
  },
  state() { return ctx ? ctx.state : 'none'; },
  stats() { return { muted, voices, refused, state: audio.state() }; },

  // 每个动作一个形状，音高走向就是它的物理含义：接满往上、倒空往下、互倒是一段扫频。
  fill() { return blip({ freq: 320, to: 720, dur: 0.16, type: 'triangle', gain: 0.16 }); },
  dump() { return blip({ freq: 520, to: 170, dur: 0.18, type: 'triangle', gain: 0.15 }); },
  pour() { return blip({ freq: 440, to: 300, dur: 0.22, type: 'sine', gain: 0.14 }); },
  refuse() { return blip({ freq: 150, to: 110, dur: 0.09, type: 'square', gain: 0.07 }); },
  win() {
    const notes = [523, 659, 784, 1046];
    let any = false;
    notes.forEach((f, i) => { any = blip({ freq: f, dur: 0.2, type: 'triangle', gain: 0.13, delay: i * 0.085 }) || any; });
    return any;
  },
};
