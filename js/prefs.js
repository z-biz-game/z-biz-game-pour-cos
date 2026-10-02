// One place decides whether anything is allowed to move. The stylesheet's
// @media (prefers-reduced-motion) block and the canvas particle code both read this, so a
// player who asked for calm never gets a still UI wrapped around a pulsing canvas.
//
// matchMedia is missing under file:// in some webviews and entirely absent in the node vm
// that loads js/core/* for tests, so the whole thing degrades to "motion allowed" rather
// than throwing at import time.

const QUERY = '(prefers-reduced-motion: reduce)';

const listeners = new Set();
let mq = null;
let reduced = false;

function emit() {
  for (const fn of listeners) {
    try {
      fn(reduced);
    } catch (err) {
      /* one bad subscriber must not mute the signal for the renderer */
    }
  }
}

function read() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !!mq && !!mq.matches;
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  mq = window.matchMedia(QUERY);
  reduced = read();
  const onChange = () => {
    reduced = read();
    emit();
  };
  // addEventListener is the current API; addListener only exists on older Safari, which is
  // exactly the population that needs this the most.
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange);
} else {
  reduced = false;
}

export const prefs = {
  get reducedMotion() { return reduced; },
  // Tests and the debug hook drive the same path the OS does, so the branch under test is
  // the branch that ships.
  setReducedMotion(on) {
    reduced = !!on;
    emit();
    return reduced;
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // Motion is allowed unless the player asked otherwise — but a paused bench stops the
  // clock regardless, which is why view.js multiplies this by its own paused flag.
  motionAllowed() { return !reduced; },
};
