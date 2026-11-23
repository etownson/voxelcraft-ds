/*
 * One way through a panel of controls, whatever is in the hand. The main menu
 * and the journal screen both hand this a root and mark what can be reached
 * with `data-nav`; from then on the arrow keys, the D-pad, the left stick and
 * the mouse all move the same highlight, and Enter, Space, A and a click all
 * press the same thing.
 *
 * Direction is read off the page itself: a move picks the nearest reachable
 * thing that lies that way, by where it is drawn, so a grid of recipe cards, a
 * column of sliders and the menu's rail all walk without any of them saying
 * who their neighbours are. A `data-nav-zone` fences a move in — the menu's
 * rail and its page are two zones — and a move that finds nothing in its own
 * zone is handed to the owner, which decides whether that means "go back to
 * the rail" or nothing at all.
 *
 * Focus is the real DOM focus, so Tab and Shift-Tab and a screen reader keep
 * working, and the highlight is a class the panel paints, so a pad user sees it
 * even when the browser decides the focus ring is not for them. Hovering a
 * control focuses it, so the mouse and the highlight can never disagree.
 *
 * A slider keeps its sideways keys: left and right step its value, up and down
 * leave it. Everything else on a slider is the same as anywhere.
 */

import {
  PAD_BUTTON, gamepadState, gpAxis, padMenuDirection, padMenuRepeat, pressedKeys
} from './input.js';

/* ---------- Which hand is on the controls ---------- */

/** 'keyboard', 'mouse' or 'pad': the last thing that moved the highlight. */
let device = 'keyboard';
const deviceListeners = new Set();

/** The hand the hints should be written for. */
export function navDevice() { return device; }

/** Hear about the hand changing, so a hint line can swap its glyphs. */
export function onNavDevice(listener) {
  deviceListeners.add(listener);
  return () => deviceListeners.delete(listener);
}

function setDevice(next) {
  if (next === device) return;
  device = next;
  for (const listener of deviceListeners) listener(device);
}

/* ---------- Geometry ---------- */

function reachable(el) {
  if (!el || !el.isConnected || el.disabled) return false;
  if (el.closest('.hidden, [hidden]')) return false;
  return el.getClientRects().length > 0;
}

/** A field the walker types into: its letters are words, not directions. */
function isTextField(el) {
  return !!el && ((el.tagName === 'INPUT' && /^(text|search)$/.test(el.type)) ||
    el.tagName === 'TEXTAREA');
}

function isSlider(el) {
  return !!el && el.tagName === 'INPUT' && el.type === 'range';
}

/** Gap between two spans on one axis: 0 when they overlap. */
function spanGap(a0, a1, b0, b1) {
  if (b1 < a0) return a0 - b1;
  if (b0 > a1) return b0 - a1;
  return 0;
}

/**
 * The nearest candidate lying in direction (dx, dy) from `from`. A candidate
 * has to lie past the current one's far edge, and a sideways move has to stay
 * on the same row; among those, distance along the move counts once and drift
 * across it counts three times, so a straight neighbour beats a diagonal one.
 */
function nearestToward(from, candidates, dx, dy) {
  const a = from.getBoundingClientRect();
  let best = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = (b.left + b.right) / 2;
    const by = (b.top + b.bottom) / 2;
    let along;
    let across;
    // A candidate counts only once its middle is past the far edge of the
    // current one: beside it, not merely nudged along inside it.
    if (dx > 0) {
      if (bx < a.right - 2) continue;
      along = Math.max(0, b.left - a.right);
      across = spanGap(a.top, a.bottom, b.top, b.bottom);
    } else if (dx < 0) {
      if (bx > a.left + 2) continue;
      along = Math.max(0, a.left - b.right);
      across = spanGap(a.top, a.bottom, b.top, b.bottom);
    } else if (dy > 0) {
      if (by < a.bottom - 2) continue;
      along = Math.max(0, b.top - a.bottom);
      across = spanGap(a.left, a.right, b.left, b.right);
    } else {
      if (by > a.top + 2) continue;
      along = Math.max(0, a.top - b.bottom);
      across = spanGap(a.left, a.right, b.left, b.right);
    }
    // Sideways stays on the row: a control a row up or down is never "to the
    // left", or leaving a page would land on the slider above instead.
    if (dx && across > 0) continue;
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** The nearest scrolling box around `el`, for the right stick to push. */
function scrollerFor(el, root) {
  for (let node = el; node && node !== root.parentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
  }
  return null;
}

/* ---------- One panel's walker ---------- */

/** How far the right stick scrolls a page, in pixels a second at full tilt. */
const STICK_SCROLL_SPEED = 900;

/**
 * A walker for everything marked `data-nav` under `root`.
 *
 * Hooks, all optional:
 * - `onFocus(el)` — the highlight landed on `el`.
 * - `onEdge(dx, dy, el)` — a move found nothing in `el`'s zone.
 * - `onBack(el)` — Esc, Backspace or B. Returns true if it was spent.
 * - `onTab(step)` — Q/E or LB/RB: the previous or next tab.
 * - `onAlt(el)` — R or X: the focused thing's second action.
 */
export function createNav(root, hooks = {}) {
  let current = null;

  function all(scope = root) {
    return Array.from(scope.querySelectorAll('[data-nav]')).filter(reachable);
  }

  function zoneOf(el) {
    return (el && el.closest('[data-nav-zone]')) || root;
  }

  function paint(el) {
    for (const lit of root.querySelectorAll('.nav-focus')) {
      if (lit !== el) lit.classList.remove('nav-focus');
    }
    if (el) el.classList.add('nav-focus');
  }

  /** Puts the highlight on `el`; `scroll` brings it into view. */
  function focus(el, scroll = true) {
    if (!el) return false;
    if (!el.hasAttribute('tabindex') && !/^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(el.tagName)) {
      el.setAttribute('tabindex', '-1');
    }
    el.focus({ preventScroll: true });
    // A window without focus moves activeElement but sends no focusin, and
    // focus can be refused outright; the highlight follows either way.
    adopt(el);
    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  function adopt(el) {
    if (el === current) return;
    current = el;
    paint(el);
    // What the highlight lands on hears about it even when the window has no
    // focus to give, so a pane that follows the highlight never falls behind.
    if (el) el.dispatchEvent(new CustomEvent('navfocus', { bubbles: true }));
    if (hooks.onFocus) hooks.onFocus(el);
  }

  /** The first reachable thing in `scope`, or under the root. */
  function first(scope = root) {
    return all(scope)[0] || null;
  }

  function currentEl() {
    return current && reachable(current) && root.contains(current) ? current : null;
  }

  function stepSlider(el, dir) {
    const step = Number(el.step) || 1;
    const min = Number(el.min);
    const max = Number(el.max);
    const at = Number(el.value);
    const next = Math.min(max, Math.max(min, Math.round((at + dir * step) / step) * step));
    if (next === at) return;
    el.value = String(next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** One step of the highlight; returns whether anything moved. */
  function move(dx, dy) {
    const from = currentEl();
    if (!from) return focus(first());
    if (dx && isSlider(from)) {
      stepSlider(from, dx);
      return true;
    }
    const target = nearestToward(from, all(zoneOf(from)), dx, dy);
    if (target) return focus(target);
    return hooks.onEdge ? !!hooks.onEdge(dx, dy, from) : false;
  }

  function activate() {
    const el = currentEl();
    if (!el || isSlider(el)) return false;
    el.click();
    return true;
  }

  function back() {
    return hooks.onBack ? !!hooks.onBack(currentEl()) : false;
  }

  function alt() {
    return hooks.onAlt ? !!hooks.onAlt(currentEl()) : false;
  }

  root.addEventListener('focusin', (event) => {
    const el = event.target && event.target.closest && event.target.closest('[data-nav]');
    if (el && root.contains(el)) adopt(el);
  });

  root.addEventListener('pointermove', (event) => {
    if (!event.movementX && !event.movementY) return;
    setDevice('mouse');
    const el = event.target && event.target.closest && event.target.closest('[data-nav]');
    if (el && root.contains(el) && el !== current && reachable(el)) focus(el, false);
  });

  /* A button pressed with Space clicks on the key's release, which would be a
     second press after the one handleKey already made. */
  root.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && event.target && event.target.tagName === 'BUTTON') {
      event.preventDefault();
    }
  });

  /**
   * A key, while this walker has the panel. Returns true when the key was
   * spent, in which case it has been taken out of the held set too, so nothing
   * behind the panel still thinks it is down when the panel goes away.
   */
  function handleKey(event) {
    const code = event.code;
    let spent = true;
    // Inside a text field only the keys that cannot be typed still walk: up
    // and down leave the field, Esc steps back. Everything else, WASD, Q, E,
    // Space and Backspace included, is the walker writing; the field's owner
    // answers Enter.
    if (isTextField(event.target) || isTextField(document.activeElement)) {
      if (code === 'ArrowUp') move(0, -1);
      else if (code === 'ArrowDown') move(0, 1);
      else if (code === 'Escape') {
        if (event.repeat) return true;
        spent = back();
      } else {
        return false;
      }
      if (spent) {
        event.preventDefault();
        pressedKeys.delete(code);
        setDevice('keyboard');
      }
      return spent;
    }
    if (code === 'ArrowUp' || code === 'KeyW') move(0, -1);
    else if (code === 'ArrowDown' || code === 'KeyS') move(0, 1);
    else if (code === 'ArrowLeft' || code === 'KeyA') move(-1, 0);
    else if (code === 'ArrowRight' || code === 'KeyD') move(1, 0);
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      if (event.repeat) return true;
      if (!activate()) spent = code !== 'Space';
    } else if (code === 'Escape' || code === 'Backspace') {
      if (event.repeat) return true;
      spent = back();
    } else if (code === 'KeyQ' || code === 'KeyE') {
      if (event.repeat || !hooks.onTab) return !!hooks.onTab;
      hooks.onTab(code === 'KeyE' ? 1 : -1);
    } else if (code === 'KeyR') {
      if (event.repeat) return true;
      spent = alt();
    } else {
      spent = false;
    }
    if (spent) {
      event.preventDefault();
      pressedKeys.delete(code);
      setDevice('keyboard');
    }
    return spent;
  }

  /**
   * One frame of pad while this walker has the panel. `skip` names buttons the
   * owner has already answered this frame.
   */
  function padTick(dt, skip = {}) {
    const pressed = gamepadState.pressed;
    const held = gamepadState.buttons;
    const scroll = gpAxis(3);
    // The hand is named before anything is pressed, so whatever a press sets
    // off (Start resuming the game, a hint line) already knows it was the pad.
    if (pressed.some(Boolean) || held.some(Boolean) || gpAxis(0) || gpAxis(1) || scroll) {
      setDevice('pad');
    }

    const dx = padMenuDirection(dt, padMenuRepeat.x,
      held[PAD_BUTTON.left], held[PAD_BUTTON.right], gpAxis(0));
    const dy = padMenuDirection(dt, padMenuRepeat.y,
      held[PAD_BUTTON.up], held[PAD_BUTTON.down], gpAxis(1));
    // One axis a step: a stick held on the diagonal walks down the rows rather
    // than skipping a cell every frame.
    if (dy) move(0, dy);
    else if (dx) move(dx, 0);

    if (pressed[PAD_BUTTON.a] && !skip.a) activate();
    if (pressed[PAD_BUTTON.b] && !skip.b) back();
    if (pressed[PAD_BUTTON.x] && !skip.x) alt();
    if (hooks.onTab && pressed[PAD_BUTTON.lb] && !skip.lb) hooks.onTab(-1);
    if (hooks.onTab && pressed[PAD_BUTTON.rb] && !skip.rb) hooks.onTab(1);

    if (scroll && dt > 0) {
      const box = scrollerFor(currentEl() || first() || root, root);
      if (box) box.scrollTop += scroll * STICK_SCROLL_SPEED * dt;
    }

  }

  return {
    focus, first, move, activate, back, alt, handleKey, padTick, all,
    get current() { return currentEl(); },
    /** Forget the highlight, e.g. when the panel is rebuilt underneath it. */
    clear() { current = null; paint(null); }
  };
}
