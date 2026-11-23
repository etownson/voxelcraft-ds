/*
 * The main menu: the start form and the pause panel in one card. A rail down
 * the left holds Start, Journal, Settings and Controls; the page for whichever
 * of them has the highlight fills the right. Start sits at the top of the rail
 * and never moves, and only the page scrolls.
 *
 * Every control in the card is reachable from every hand. The walker in
 * menu-nav.js moves one highlight for the arrow keys, the D-pad, the left stick
 * and the mouse; Enter, Space, A and a click all press. Going right (or A) from
 * the rail steps into the page, and going left off the page's edge (or B, or
 * Esc) steps back to the rail. Q and E, or LB and RB, turn the journal's pages
 * and otherwise walk the rail's pages. A line along the bottom says all this in
 * the words of the hand that last moved.
 *
 * The journal page mounts the same book the J screen shows (journal.js),
 * rebuilt each time the menu comes up so a fresh transmission is there to read.
 * New world asks before it erases, inside the card, where a pad can answer.
 *
 * Every pick answers with the same neutral click: the menu is allowed no other
 * voice, and a walker browsing it must never hear the world answer back.
 */

import { playMenuClickSound } from './audio.js';
import { buildJournalBody, journalTitle } from './journal.js';
import { PAD_BUTTON, gamepadState, overlayEl, startFromOverlay } from './input.js';
import { createNav, navDevice, onNavDevice } from './menu-nav.js';

const card = overlayEl.querySelector('.menu-card');
const rail = overlayEl.querySelector('.menu-rail');
const pagesEl = overlayEl.querySelector('.menu-pages');
const hintsEl = document.getElementById('menu-hints');
const startButton = document.getElementById('menu-start');
const journalBody = document.getElementById('journal-menu-body');
const homeSaveEl = document.getElementById('menu-home-save');
const saveStatusEl = document.getElementById('save-status');
const newWorldButton = document.getElementById('new-world-button');
const confirmRow = document.getElementById('new-world-confirm');
const keepButton = document.getElementById('new-world-keep');
const eraseButton = document.getElementById('new-world-erase');
const controlsPanel = document.getElementById('menu-controls-panel');

const railButtons = Array.from(rail.querySelectorAll('[data-page]'));
const pages = {};
for (const section of pagesEl.querySelectorAll('.menu-panel[data-page]')) {
  pages[section.dataset.page] = section;
}

/* ---------- What the menu asks of the rest of the game ---------- */

const menuActions = {
  /** Erase the saved world and start a fresh one. */
  newWorld: () => {}
};

/** main.js hands the menu the verbs it cannot do itself. */
export function setMenuActions(verbs) {
  Object.assign(menuActions, verbs);
}

/* ---------- State ---------- */

/** The page on the right. */
let shownPage = 'home';
/** Where the highlight last was on each page, to come back to it. */
const lastFocus = {};
/** The journal mounted for this opening of the menu, or null until it is shown. */
let journalBook = null;
/** Whether the world has been stepped into yet: Start says Resume after. */
let played = false;

/* One pick, one answer. A controller can deliver the same choice twice — a pad
   button and the keyboard key a mapping sends alongside it, or a button that
   chatters across two polls — and two clicks for one press is exactly what the
   menu must never sound like. A repeat of the same pick inside this window is
   swallowed whole: no sound, no action. */
const CHOICE_REPEAT_MS = 120;
let lastChoice = null;
let lastChoiceAt = 0;

function freshPick(target) {
  const at = performance.now();
  if (target === lastChoice && at - lastChoiceAt < CHOICE_REPEAT_MS) return false;
  lastChoice = target;
  lastChoiceAt = at;
  return true;
}

/* ---------- Pages ---------- */

function zoneOf(el) {
  return el && rail.contains(el) ? 'rail' : 'page';
}

function mountJournal() {
  journalBody.innerHTML = '';
  journalBook = buildJournalBody(journalTurned);
  journalBody.append(journalBook);
  delete lastFocus.journal;
}

function journalTurned() {
  journalBody.setAttribute('aria-label', journalTitle());
  if (zoneOf(nav.current) === 'page') nav.focus(journalBook.firstFocus());
}

function showPage(name) {
  if (!pages[name]) return;
  shownPage = name;
  for (const [key, section] of Object.entries(pages)) {
    section.classList.toggle('hidden', key !== name);
  }
  for (const button of railButtons) {
    const here = button.dataset.page === name;
    button.classList.toggle('current', here);
    if (button.getAttribute('aria-controls')) {
      button.setAttribute('aria-expanded', here ? 'true' : 'false');
    }
  }
  if (name === 'journal' && !journalBook) mountJournal();
  if (name === 'home') paintHome();
  pagesEl.scrollTop = 0;
  paintHints();
}

function paintHome() {
  if (!homeSaveEl) return;
  homeSaveEl.textContent = saveStatusEl ? saveStatusEl.textContent : '';
}

/** Steps from the rail into the shown page, back where the highlight left it. */
function enterPage(name = shownPage) {
  showPage(name);
  const page = pages[name];
  const remembered = lastFocus[name];
  const target = (remembered && page.contains(remembered) && nav.all(page).includes(remembered))
    ? remembered
    : (name === 'journal' && journalBook ? journalBook.firstFocus() : nav.first(page));
  if (target) nav.focus(target);
}

function focusRail(name = shownPage) {
  const button = railButtons.find((b) => b.dataset.page === name) || startButton;
  nav.focus(button);
}

/** Q/E or LB/RB: the journal's pages inside it, otherwise the rail's pages. */
function turnTab(step) {
  if (shownPage === 'journal' && zoneOf(nav.current) === 'page' && journalBook) {
    journalBook.turn(step);
    return;
  }
  const at = railButtons.findIndex((b) => b.dataset.page === shownPage);
  const next = railButtons[(at + step + railButtons.length) % railButtons.length];
  if (zoneOf(nav.current) === 'page' && next.dataset.page !== 'home') {
    enterPage(next.dataset.page);
  } else {
    nav.focus(next);
  }
}

/* ---------- New world, asked inside the card ---------- */

function openConfirm() {
  confirmRow.classList.remove('hidden');
  newWorldButton.classList.add('hidden');
  nav.focus(keepButton);
}

function closeConfirm() {
  confirmRow.classList.add('hidden');
  newWorldButton.classList.remove('hidden');
  nav.focus(newWorldButton);
}

/* ---------- The walker ---------- */

const nav = createNav(card, {
  onFocus(el) {
    if (zoneOf(el) === 'rail') {
      showPage(el.dataset.page);
    } else {
      lastFocus[shownPage] = el;
      paintHints();
    }
  },
  onEdge(dx, dy, el) {
    if (zoneOf(el) === 'rail') {
      if (dx > 0) {
        if (el.dataset.page !== 'home') enterPage(el.dataset.page);
        return true;
      }
      if (dy) {
        // The rail is a ring: off the bottom comes round to Start.
        nav.focus(dy > 0 ? railButtons[0] : railButtons[railButtons.length - 1]);
        return true;
      }
      return false;
    }
    if (dx < 0) {
      focusRail();
      return true;
    }
    return false;
  },
  onBack(el) {
    if (!confirmRow.classList.contains('hidden')) {
      closeConfirm();
      return true;
    }
    if (zoneOf(el) === 'page') {
      focusRail();
      return true;
    }
    // On the rail there is nowhere further back to go. The browser will not
    // hand the mouse back on the same Esc that freed it, so this is not Start.
    return true;
  },
  onTab: turnTab,
  onAlt(el) {
    return shownPage === 'journal' && journalBook ? journalBook.alt(el) : false;
  }
});

/* ---------- Picks ---------- */

for (const button of railButtons) {
  button.addEventListener('click', () => {
    if (!freshPick(button)) return;
    if (button === startButton) {
      startFromOverlay(navDevice() === 'pad');
      return;
    }
    enterPage(button.dataset.page);
  });
}

newWorldButton.addEventListener('click', openConfirm);
keepButton.addEventListener('click', closeConfirm);
eraseButton.addEventListener('click', () => menuActions.newWorld());

// Every press in the card is answered by the one click, and only once.
card.addEventListener('click', (event) => {
  const pressed = event.target && event.target.closest && event.target.closest('button');
  if (pressed && card.contains(pressed)) playMenuClickSound();
});

window.addEventListener('keydown', (event) => {
  if (overlayEl.classList.contains('hidden')) return;
  nav.handleKey(event);
});

/* ---------- The hint line ---------- */

function hint(keys, words) {
  const item = document.createElement('span');
  item.className = 'menu-hint';
  for (const key of keys) {
    const k = document.createElement('kbd');
    k.textContent = key;
    item.append(k);
  }
  item.append(document.createTextNode(' ' + words));
  return item;
}

function paintHints() {
  if (!hintsEl) return;
  const pad = navDevice() === 'pad';
  const inPage = zoneOf(nav.current) === 'page';
  const journal = shownPage === 'journal';
  const items = [];
  if (pad) {
    items.push(hint(['D-pad'], 'Move'));
    items.push(hint(['A'], inPage ? 'Select' : 'Open'));
    if (inPage) items.push(hint(['B'], 'Back'));
    items.push(hint(['LB', 'RB'], journal && inPage ? 'Journal page' : 'Page'));
    if (journal && inPage) items.push(hint(['X'], 'Next way'));
    if (inPage) items.push(hint(['R stick'], 'Scroll'));
    items.push(hint(['Start'], played ? 'Resume' : 'Start'));
  } else {
    items.push(hint(['↑', '↓', '←', '→'], 'Move'));
    items.push(hint(['Enter'], inPage ? 'Select' : 'Open'));
    if (inPage) items.push(hint(['Esc'], 'Back'));
    items.push(hint(['Q', 'E'], journal && inPage ? 'Journal page' : 'Page'));
    if (journal && inPage) items.push(hint(['R'], 'Next way'));
  }
  hintsEl.replaceChildren(...items);
  card.dataset.device = pad ? 'pad' : 'keyboard';
  if (controlsPanel) controlsPanel.dataset.device = pad ? 'pad' : 'keyboard';
}

onNavDevice(paintHints);

/* ---------- Coming up and going down ---------- */

function menuOpened() {
  startButton.textContent = played ? 'Resume' : 'Start';
  journalBook = null;
  confirmRow.classList.add('hidden');
  newWorldButton.classList.remove('hidden');
  nav.clear();
  showPage('home');
  nav.focus(startButton);
}

function menuClosed() {
  played = true;
  nav.clear();
  if (card.contains(document.activeElement)) document.activeElement.blur();
}

let wasOpen = !overlayEl.classList.contains('hidden');
new MutationObserver(() => {
  const open = !overlayEl.classList.contains('hidden');
  if (open === wasOpen) return;
  wasOpen = open;
  if (open) menuOpened();
  else menuClosed();
}).observe(overlayEl, { attributes: true, attributeFilter: ['class'] });

if (wasOpen) menuOpened();

/** One frame of pad input while the overlay has the controls. */
export function padMenuTick(dt) {
  // Start on the pad has always meant "back to the game", wherever the
  // highlight is.
  if (gamepadState.pressed[PAD_BUTTON.start]) {
    startFromOverlay(true);
    return;
  }
  nav.padTick(dt);
}

/** Where the menu is, for the debug surface and the checks that drive it. */
export function menuState() {
  const focused = nav.current;
  return {
    open: !overlayEl.classList.contains('hidden'),
    page: shownPage,
    zone: focused ? zoneOf(focused) : null,
    focus: focused
      ? (focused.id || focused.dataset.recipe || focused.dataset.page ||
        focused.textContent.trim().slice(0, 40))
      : null,
    device: navDevice(),
    confirming: !confirmRow.classList.contains('hidden'),
    journal: journalBook ? journalTitle() : null
  };
}
