/*
 * The main menu: the four choices that stand between the title and the world —
 * Controls, Settings, Journal, Start. The first three open one panel at a time
 * under the menu, and choosing an open one again closes it; Start hands control
 * back, the same as a click on the dark around the panel. The journal panel
 * borrows the recipe column the in-game journal paints, rebuilt on every open
 * so a fresh transmission shows up the next time the menu comes round.
 *
 * The pad walks the choices with the D-pad or the left stick and picks with A,
 * which is the menu the controls list promises. Start on the pad has always
 * meant "back to the game", so it still means that here.
 */

import { playMenuClickSound } from './audio.js';
import { buildJournalColumn } from './hud.js';
import {
  PAD_BUTTON, gamepadState, gpAxis, overlayEl, padMenuDirection, padMenuRepeat,
  pressedKeys, setGamepadSensitivity, startFromOverlay
} from './input.js';

const CHOICES = ['controls', 'settings', 'journal', 'start'];

const buttons = {};
const panels = {};
for (const name of CHOICES) buttons[name] = document.getElementById('menu-' + name);
for (const name of CHOICES) {
  if (name === 'start') continue;
  panels[name] = document.getElementById('menu-' + name + '-panel');
}
const journalBody = document.getElementById('journal-menu-body');

/** The choice the pad or the arrow keys are pointing at. */
let selection = 'start';

/* One pick, one answer. A controller can deliver the same choice twice — a pad
   button and the keyboard key a mapping sends alongside it, or a button that
   chatters across two polls — and two clicks for one press is exactly what the
   menu must never sound like. A repeat of the same choice inside this window is
   swallowed whole: no sound, no toggle. */
const CHOICE_REPEAT_MS = 120;
let lastChoice = '';
let lastChoiceAt = 0;

function paintSelection() {
  for (const name of CHOICES) {
    buttons[name].classList.toggle('selected', name === selection);
  }
}

function openPanel(name) {
  for (const key of Object.keys(panels)) {
    const open = key === name;
    panels[key].classList.toggle('hidden', !open);
    buttons[key].setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  // Rebuilt every time, because the beacons may have sent more recipes while
  // the panel was closed.
  if (name === 'journal') {
    journalBody.innerHTML = '';
    journalBody.append(buildJournalColumn());
  }
}

function choose(name, padResume = false) {
  const at = performance.now();
  if (name === lastChoice && at - lastChoiceAt < CHOICE_REPEAT_MS) return;
  lastChoice = name;
  lastChoiceAt = at;

  selection = name;
  paintSelection();
  // Every choice answers with the same neutral click: the menu is allowed no
  // other voice, and a walker browsing it must never hear the world answer
  // back.
  playMenuClickSound();
  if (name === 'start') {
    startFromOverlay(padResume);
    return;
  }
  const alreadyOpen = !panels[name].classList.contains('hidden');
  openPanel(alreadyOpen ? null : name);
}

function moveSelection(step) {
  const index = CHOICES.indexOf(selection);
  selection = CHOICES[(index + step + CHOICES.length) % CHOICES.length];
  paintSelection();
}

for (const name of CHOICES) {
  buttons[name].addEventListener('click', () => choose(name));
}

// A pad and the arrow keys need to see where they are from the first frame,
// not only after the first press.
paintSelection();

window.addEventListener('keydown', (event) => {
  if (overlayEl.classList.contains('hidden')) return;
  // A focused slider keeps its arrow keys, and a focused button answers Enter
  // with its own click.
  if (event.target && event.target.tagName === 'INPUT') return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    // The keys also live in the input layer's pressed set; a menu arrow must
    // not still be held down when the game comes back.
    pressedKeys.delete(event.code);
    moveSelection(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter' && (!event.target || event.target.tagName !== 'BUTTON')) {
    event.preventDefault();
    pressedKeys.delete(event.code);
    choose(selection);
  }
});

/** One frame of pad input while the overlay has the controls. */
export function padMenuTick(dt) {
  const pressed = gamepadState.pressed;
  const held = gamepadState.buttons;

  // Left/right keeps its old job from when the row sat on the pause panel:
  // nobody has to open Settings just to steady their aim.
  if (pressed[PAD_BUTTON.left]) setGamepadSensitivity(gamepadState.sensitivity - 0.1);
  if (pressed[PAD_BUTTON.right]) setGamepadSensitivity(gamepadState.sensitivity + 0.1);

  const dy = padMenuDirection(
    dt, padMenuRepeat.y,
    held[PAD_BUTTON.up], held[PAD_BUTTON.down], gpAxis(1)
  );
  if (dy) moveSelection(dy);

  if (pressed[PAD_BUTTON.b]) openPanel(null);
  if (pressed[PAD_BUTTON.a]) choose(selection, selection === 'start');
  if (pressed[PAD_BUTTON.start]) startFromOverlay(true);
}
