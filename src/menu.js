/*
 * The main menu: the start form and the pause panel in one card. A rail down
 * the left holds Start, Worlds, Journal, Waypoints, Co-op, Settings and Controls; the page for whichever
 * of them has the highlight fills the right. Start sits at the top of the rail
 * and never moves, and only the page scrolls.
 *
 * Every control in the card is reachable from every hand. The walker in
 * menu-nav.js moves one highlight for the arrow keys, the D-pad, the left stick
 * and the mouse; Enter, Space, A and a click all press. Going right (or A) from
 * the rail steps into the page, and going left off the page's edge (or Esc)
 * steps back to the rail. On the pad, B goes straight back into the game once
 * it has been entered, like Start; before that it steps back like Esc. Q and E, or LB and RB, turn the journal's pages
 * and otherwise walk the rail's pages. A line along the bottom says all this in
 * the words of the hand that last moved.
 *
 * The journal page mounts the same book the J screen shows (journal.js),
 * rebuilt each time the menu comes up so a fresh transmission is there to read.
 * Reset world asks before it erases, inside the card, where a pad can answer.
 *
 * The Worlds page lists the worlds this browser keeps (worlds.js), and goes to
 * one, makes one, renames, deletes, downloads or loads one from a file. Going
 * anywhere is a reload, which main.js does after saving; switching and deleting
 * ask first, in the card, like New world.
 *
 * The Start page is also the mission's: how many beacons are lit and what the
 * next one wants, without coordinates. The Waypoints page picks what the HUD
 * arrow follows and saves the spot the walker stands on under a name.
 *
 * Every pick answers with the same neutral click: the menu is allowed no other
 * voice, and a walker browsing it must never hear the world answer back.
 */

import { playMenuClickSound } from './audio.js';
import { beaconSites, beaconsActivatedCount, nextBeacon } from './beacons.js';
import { debugEnabled } from './debug.js';
import { essenceCount } from './essence.js';
import { buildJournalBody, journalTitle } from './journal.js';
import { PAD_BUTTON, gamepadState, overlayEl, startFromOverlay } from './input.js';
import { createNav, navDevice, onNavDevice } from './menu-nav.js';
import { coopName, fpsShown, setCoopName, setFpsShown } from './settings.js';
import { formatSavedAt } from './save.js';
import {
  deleteWaypoint, nextWaypointLabel, setActiveWaypoint, waypointTargets
} from './waypoints.js';
import { activeWorld, deleteWorld, listWorlds, renameWorld } from './worlds.js';

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
const missionStatusEl = document.getElementById('menu-mission-status');
const waypointListEl = document.getElementById('waypoint-list');
const waypointLabelInput = document.getElementById('waypoint-label');
const waypointSaveButton = document.getElementById('waypoint-save');
const fpsToggle = document.getElementById('fps-toggle');
const coopNameInput = document.getElementById('coop-name');
const coopOffEl = document.getElementById('coop-off');
const coopOnEl = document.getElementById('coop-on');
const coopHostButton = document.getElementById('coop-host');
const coopCodeInput = document.getElementById('coop-code');
const coopJoinButton = document.getElementById('coop-join');
const coopRoomEl = document.getElementById('coop-room');
const coopCopyButton = document.getElementById('coop-copy');
const coopLeaveButton = document.getElementById('coop-leave');
const coopPlayersEl = document.getElementById('coop-players');
const coopStatusEl = document.getElementById('coop-status');
const coopHostLabel = document.getElementById('coop-host-label');
const worldListEl = document.getElementById('world-list');
const worldConfirmRow = document.getElementById('world-confirm');
const worldConfirmText = document.getElementById('world-confirm-text');
const worldConfirmNo = document.getElementById('world-confirm-no');
const worldConfirmYes = document.getElementById('world-confirm-yes');
const worldThisEl = document.getElementById('world-this');
const worldNameInput = document.getElementById('world-name');
const worldRenameButton = document.getElementById('world-rename');
const worldSeedEl = document.getElementById('world-seed');
const worldDownloadButton = document.getElementById('world-download');
const newWorldNameInput = document.getElementById('new-world-name');
const newWorldSeedInput = document.getElementById('new-world-seed');
const newWorldCreateButton = document.getElementById('new-world-create');
const worldLoadButton = document.getElementById('world-load');
const worldFileInput = document.getElementById('world-file');
const worldStatusEl = document.getElementById('world-status');

for (const row of overlayEl.querySelectorAll('.debug-only')) {
  row.classList.toggle('hidden', !debugEnabled);
}

const railButtons = Array.from(rail.querySelectorAll('[data-page]'));
const pages = {};
for (const section of pagesEl.querySelectorAll('.menu-panel[data-page]')) {
  pages[section.dataset.page] = section;
}

/* ---------- What the menu asks of the rest of the game ---------- */

const menuActions = {
  /** Erase the saved world and start a fresh one. */
  newWorld: () => {},
  /** Save where the walker stands under this label; answers the saved spot. */
  saveSpot: () => null,
  /** Open this world as a co-op room. */
  hostCoop: () => {},
  /** Join somebody else's room by its code. */
  joinCoop: () => {},
  /** Leave the room: a host keeps playing alone, a guest goes home. */
  leaveCoop: () => {},
  /** The link a friend opens to join this room, or null outside one. */
  coopLink: () => null,
  /** Save this world and boot world `id`. */
  switchWorld: () => {},
  /** Make a world from a name and a typed seed and go there; answers an error line or null. */
  createWorld: () => null,
  /** Hand this world to the browser as a file; answers a status line. */
  downloadWorld: () => null,
  /** Read a downloaded world back in and go there; answers (a promise of) an error line or null. */
  loadWorldFile: async () => null
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
  if (name === 'worlds') paintWorlds();
  if (name === 'waypoints') paintWaypoints();
  if (name === 'settings') paintFpsToggle();
  if (name === 'coop') paintCoopName();
  pagesEl.scrollTop = 0;
  paintHints();
}

function paintHome() {
  if (missionLive) paintMenuMission();
  if (!homeSaveEl) return;
  const save = saveStatusEl ? saveStatusEl.textContent : '';
  homeSaveEl.textContent = activeWorld().name + (save ? ' \u00b7 ' + save : '');
}

/* ---------- The mission's progress ---------- */

/* The monuments are measured from SP0, which main.js only knows once the save
   has been read, and the menu comes up before that. So the list stays empty
   until the page says the mission is there to read. */
let missionLive = false;

/**
 * One line a beacon: lit, the one the transmission wants with its price and
 * the purse, or still dark. No coordinates: the arrow finds the way.
 */
export function paintMenuMission() {
  missionLive = true;
  if (!missionStatusEl) return;
  const lit = beaconsActivatedCount();
  const next = nextBeacon();
  const total = beaconSites().length;
  const lines = [];
  for (const site of beaconSites()) {
    const li = document.createElement('li');
    const name = 'Beacon ' + (site.index + 1) + ' of ' + total;
    if (site.index < lit) {
      li.className = 'lit';
      li.textContent = name + ' \u00b7 lit';
    } else if (next && site.index === next.index) {
      li.className = 'next';
      li.textContent = name + ' \u00b7 wants ' + site.cost + ' essence \u00b7 you carry ' +
        essenceCount();
    } else {
      li.className = 'dark';
      li.textContent = name + ' \u00b7 not found yet';
    }
    lines.push(li);
  }
  if (!next) {
    const li = document.createElement('li');
    li.className = 'lit';
    li.textContent = 'All ' + total + ' beacons lit';
    lines.push(li);
  }
  missionStatusEl.replaceChildren(...lines);
}

/* ---------- Waypoints ---------- */

function waypointRow(target) {
  const row = document.createElement('div');
  row.className = 'waypoint-row';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'waypoint-pick' + (target.active ? ' current' : '');
  pick.dataset.nav = '';
  pick.dataset.waypoint = target.key;
  pick.setAttribute('aria-pressed', target.active ? 'true' : 'false');
  const name = document.createElement('span');
  name.className = 'waypoint-name';
  name.textContent = target.label;
  pick.append(name);
  if (target.kind === 'saved') {
    const where = document.createElement('span');
    where.className = 'waypoint-where';
    where.textContent = target.x + ' / ' + target.y + ' / ' + target.z;
    pick.append(where);
  }
  pick.addEventListener('click', () => {
    if (!freshPick(pick)) return;
    setActiveWaypoint(target.key);
    paintWaypoints(target.key);
  });
  row.append(pick);

  if (target.kind === 'saved') {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'menu-button danger';
    remove.dataset.nav = '';
    remove.dataset.waypointDelete = target.key;
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', 'Delete ' + target.label);
    remove.addEventListener('click', () => {
      if (!freshPick(remove)) return;
      deleteWaypoint(target.id);
      paintWaypoints('next');
    });
    row.append(remove);
  }
  return row;
}

/**
 * Rebuilds the list, and puts the highlight back on `focusKey` when it was in
 * the list before, so picking a row leaves the hand where it was.
 */
function paintWaypoints(focusKey = null) {
  if (!waypointListEl) return;
  const targets = waypointTargets();
  const anyActive = targets.some((t) => t.active);
  const rows = targets.map(waypointRow);
  rows.push(waypointRow({ key: 'none', kind: 'none', label: 'No arrow', active: !anyActive }));
  waypointListEl.replaceChildren(...rows);
  if (!targets.some((t) => t.kind === 'saved')) {
    const empty = document.createElement('div');
    empty.className = 'waypoint-empty';
    empty.textContent = 'No saved spots yet.';
    waypointListEl.append(empty);
  }
  waypointLabelInput.placeholder = nextWaypointLabel();
  delete lastFocus.waypoints;
  if (focusKey) {
    const again = waypointListEl.querySelector('[data-waypoint="' + focusKey + '"]');
    if (again) nav.focus(again);
  }
}

function saveSpotHere() {
  const saved = menuActions.saveSpot(waypointLabelInput.value);
  if (!saved) return;
  waypointLabelInput.value = '';
  setActiveWaypoint('saved:' + saved.id);
  paintWaypoints('saved:' + saved.id);
}

waypointSaveButton.addEventListener('click', () => {
  if (!freshPick(waypointSaveButton)) return;
  saveSpotHere();
});
waypointLabelInput.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
  if (event.repeat) return;
  event.preventDefault();
  playMenuClickSound();
  saveSpotHere();
});

/* ---------- Co-op ---------- */

/* The page is painted from whatever the co-op layer last said, which main.js
   hands over through paintMenuCoop; until then it is the offer to host or join. */
let coopView = { mode: 'off', code: null, players: [], status: '', error: false };

function paintCoopName() {
  if (document.activeElement !== coopNameInput) coopNameInput.value = coopName();
  if (coopHostLabel) coopHostLabel.textContent = 'Open \u201c' + activeWorld().name + '\u201d to friends';
}

/**
 * Paints the co-op page: `mode` is 'off', 'connecting', 'host' or 'guest',
 * `players` is a list of { name, role, self }, and `status` is one line of
 * what is going on, an error when `error` says so.
 */
export function paintMenuCoop(view) {
  coopView = { ...coopView, ...view };
  const live = coopView.mode !== 'off';
  const wasFocusedIn = (el) => el && el.contains(nav.current);
  const leavingOff = live && wasFocusedIn(coopOffEl);
  const leavingOn = !live && wasFocusedIn(coopOnEl);
  coopOffEl.classList.toggle('hidden', live);
  coopOnEl.classList.toggle('hidden', !live);
  coopRoomEl.textContent = coopView.code ? 'Room ' + coopView.code : 'Room ------';
  coopCopyButton.classList.toggle('hidden', !coopView.code);
  coopLeaveButton.textContent = coopView.mode === 'guest' ? 'Leave and go home' : 'Leave';
  const rows = coopView.players.map((p) => {
    const li = document.createElement('li');
    li.className = p.self ? 'next' : 'lit';
    li.textContent = p.name + (p.role === 'host' ? ' \u00b7 host' : '') + (p.self ? ' \u00b7 you' : '');
    return li;
  });
  coopPlayersEl.replaceChildren(...rows);
  coopStatusEl.textContent = coopView.status || '';
  coopStatusEl.classList.toggle('error', !!coopView.error);
  if (leavingOff) nav.focus(coopCopyButton.classList.contains('hidden') ? coopLeaveButton : coopCopyButton);
  if (leavingOn) nav.focus(coopHostButton);
}

function chosenName() {
  setCoopName(coopNameInput.value);
  return coopName() || 'Player';
}

coopNameInput.addEventListener('change', () => setCoopName(coopNameInput.value));

coopHostButton.addEventListener('click', () => {
  if (!freshPick(coopHostButton)) return;
  menuActions.hostCoop(chosenName());
});

function joinTyped() {
  menuActions.joinCoop(coopCodeInput.value, chosenName());
}

coopJoinButton.addEventListener('click', () => {
  if (!freshPick(coopJoinButton)) return;
  joinTyped();
});
coopCodeInput.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
  if (event.repeat) return;
  event.preventDefault();
  playMenuClickSound();
  joinTyped();
});

coopCopyButton.addEventListener('click', () => {
  if (!freshPick(coopCopyButton)) return;
  const link = menuActions.coopLink();
  if (!link) return;
  const said = (words) => paintMenuCoop({ status: words, error: false });
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(
      () => said('Link copied. Send it to a friend.'),
      () => said('Share this link: ' + link)
    );
  } else {
    said('Share this link: ' + link);
  }
});

coopLeaveButton.addEventListener('click', () => {
  if (!freshPick(coopLeaveButton)) return;
  menuActions.leaveCoop();
});

/* ---------- Worlds ---------- */

/** What the confirm row will do when it hears yes, or null while it is shut. */
let worldPending = null;

function worldStatus(line, error = false) {
  worldStatusEl.textContent = line || '';
  worldStatusEl.classList.toggle('error', !!error);
}

function worldRow(world) {
  const row = document.createElement('div');
  row.className = 'waypoint-row';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'waypoint-pick' + (world.current ? ' current' : '');
  pick.dataset.nav = '';
  pick.dataset.world = world.id;
  pick.setAttribute('aria-pressed', world.current ? 'true' : 'false');
  const name = document.createElement('span');
  name.className = 'waypoint-name';
  name.textContent = world.name;
  const when = document.createElement('span');
  when.className = 'waypoint-where';
  when.textContent = world.current
    ? 'playing now'
    : (world.lastPlayedAt ? 'played ' + formatSavedAt(world.lastPlayedAt) : 'not played yet');
  pick.append(name, when);
  pick.addEventListener('click', () => {
    if (!freshPick(pick) || world.current) return;
    askWorld('Go to \u201c' + world.name + '\u201d?', 'Go', false, () => menuActions.switchWorld(world.id));
  });
  row.append(pick);

  if (!world.current) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'menu-button danger';
    remove.dataset.nav = '';
    remove.dataset.worldDelete = world.id;
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', 'Delete ' + world.name);
    remove.addEventListener('click', () => {
      if (!freshPick(remove)) return;
      askWorld('Delete \u201c' + world.name + '\u201d for good? Download it first to keep a copy.', 'Delete', true, () => {
        deleteWorld(world.id);
        closeWorldConfirm();
        paintWorlds();
        worldStatus('Deleted \u201c' + world.name + '\u201d.');
      });
    });
    row.append(remove);
  }
  return row;
}

function paintWorlds(focusId = null) {
  const here = activeWorld();
  worldListEl.replaceChildren(...listWorlds().map(worldRow));
  if (here.guest) {
    const visiting = document.createElement('div');
    visiting.className = 'waypoint-empty';
    visiting.textContent = 'You are visiting a friend\u2019s world. Going to one of yours leaves the room.';
    worldListEl.prepend(visiting);
  }
  worldThisEl.classList.toggle('hidden', here.guest);
  if (document.activeElement !== worldNameInput) worldNameInput.value = here.name;
  worldSeedEl.textContent = 'Seed ' + here.seed;
  delete lastFocus.worlds;
  if (focusId) {
    const again = worldListEl.querySelector('[data-world="' + focusId + '"]');
    if (again) nav.focus(again);
  }
}

function askWorld(question, yes, danger, action) {
  worldPending = action;
  worldConfirmText.textContent = question;
  worldConfirmYes.textContent = yes;
  worldConfirmYes.classList.toggle('danger', danger);
  worldConfirmRow.classList.remove('hidden');
  nav.focus(worldConfirmNo);
}

function closeWorldConfirm() {
  const wasOpen = !worldConfirmRow.classList.contains('hidden');
  worldPending = null;
  worldConfirmRow.classList.add('hidden');
  if (wasOpen) {
    const first = nav.first(worldListEl);
    if (first) nav.focus(first);
  }
}

worldConfirmNo.addEventListener('click', () => {
  if (!freshPick(worldConfirmNo)) return;
  closeWorldConfirm();
});
worldConfirmYes.addEventListener('click', () => {
  if (!freshPick(worldConfirmYes) || !worldPending) return;
  worldPending();
});

function renameHere() {
  if (!renameWorld(activeWorld().id, worldNameInput.value)) {
    worldStatus('Browser storage refused the new name.', true);
    return;
  }
  worldNameInput.value = activeWorld().name;
  paintWorlds();
  paintCoopName();
  worldStatus('Renamed to \u201c' + activeWorld().name + '\u201d.');
}

function createTyped() {
  worldStatus('Making the world\u2026');
  const error = menuActions.createWorld(newWorldNameInput.value, newWorldSeedInput.value);
  if (error) worldStatus(error, true);
}

/** Enter in a text field presses the button beside it. */
function enterPresses(input, press) {
  input.addEventListener('keydown', (event) => {
    if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
    if (event.repeat) return;
    event.preventDefault();
    playMenuClickSound();
    press();
  });
}

worldRenameButton.addEventListener('click', () => {
  if (!freshPick(worldRenameButton)) return;
  renameHere();
});
enterPresses(worldNameInput, renameHere);

newWorldCreateButton.addEventListener('click', () => {
  if (!freshPick(newWorldCreateButton)) return;
  createTyped();
});
enterPresses(newWorldNameInput, () => nav.focus(newWorldSeedInput));
enterPresses(newWorldSeedInput, createTyped);

worldDownloadButton.addEventListener('click', () => {
  if (!freshPick(worldDownloadButton)) return;
  worldStatus(menuActions.downloadWorld());
});

worldLoadButton.addEventListener('click', () => {
  if (!freshPick(worldLoadButton)) return;
  worldFileInput.value = '';
  worldFileInput.click();
});
worldFileInput.addEventListener('change', async () => {
  const file = worldFileInput.files && worldFileInput.files[0];
  if (!file) return;
  worldStatus('Reading ' + file.name + '\u2026');
  const error = await menuActions.loadWorldFile(file);
  if (error) worldStatus(error, true);
});

/* ---------- Display settings ---------- */

function paintFpsToggle() {
  const on = fpsShown();
  fpsToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  fpsToggle.textContent = on ? 'On' : 'Off';
}

fpsToggle.addEventListener('click', () => {
  if (!freshPick(fpsToggle)) return;
  setFpsShown(!fpsShown());
  paintFpsToggle();
});
paintFpsToggle();

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
  onFocus(el, { hover } = {}) {
    if (zoneOf(el) === 'rail') {
      // Passing the mouse over a tab only lights it; a click opens the page.
      if (!hover) showPage(el.dataset.page);
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
    if (!worldConfirmRow.classList.contains('hidden')) {
      closeWorldConfirm();
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
    if (inPage && !padBResumes()) items.push(hint(['B'], 'Back'));
    items.push(hint(['LB', 'RB'], journal && inPage ? 'Journal page' : 'Page'));
    if (journal && inPage) items.push(hint(['X'], 'Next way'));
    if (inPage) items.push(hint(['R stick'], 'Scroll'));
    items.push(padBResumes() ? hint(['B', 'Start'], 'Resume') : hint(['Start'], played ? 'Resume' : 'Start'));
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
  worldPending = null;
  worldConfirmRow.classList.add('hidden');
  worldStatus('');
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

/** Whether the pad's B leaves the menu for the world rather than stepping back. */
function padBResumes() {
  // Not before the world has been entered: B is not a way to start a game.
  // And not while New world is asking: there B is "keep it".
  return played && confirmRow.classList.contains('hidden') &&
    worldConfirmRow.classList.contains('hidden');
}

/** One frame of pad input while the overlay has the controls. */
export function padMenuTick(dt) {
  // Start on the pad has always meant "back to the game", wherever the
  // highlight is, and once the world has been entered B means it too: the
  // button that closes every other panel closes this one.
  if (gamepadState.pressed[PAD_BUTTON.start] ||
      (gamepadState.pressed[PAD_BUTTON.b] && padBResumes())) {
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
    confirming: !confirmRow.classList.contains('hidden') || !worldConfirmRow.classList.contains('hidden'),
    journal: journalBook ? journalTitle() : null
  };
}
