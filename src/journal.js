/*
 * The journal: the book the beacons write in. Its first page is the recipe
 * book — every recipe a beacon has transmitted, drawn on the grid it is folded
 * on, so a walker reads a shape instead of working one out from a list of
 * counts. Its second page is the transmissions, whole and in the order they
 * were heard (transmissions.js keeps those).
 *
 * The recipe page is two panes. On the left, a card per thing that can be made,
 * shelved under the beacon that sent it; recipes that make the same thing — the
 * coal and charcoal torches, the shears from either hand — share a card and
 * step through their variants. On the right, the card under the highlight:
 * its pattern laid out in a 2x2 or 3x3 grid exactly where the matcher will
 * accept it, an arrow, and what comes out. Once the furnace recipe has arrived
 * the furnace's own work is shelved too, input over flame to output.
 *
 * Beacons not yet lit are a single dim line each with a count and nothing
 * else: the journal tells the walker there is more out there without telling
 * them what, so it can never spoil a beacon.
 *
 * The menu and the in-game screen both mount this book, so they are the same
 * book. Neither reaches in: they get an element, and a `turned` call when the
 * page changes so they can retitle themselves and put the highlight back.
 */

import { ITEMS } from './blocks.js';
import { FURNACE_FUELS, SMELTING_RECIPES } from './containers.js';
import { RECIPES, receivedRecipes, recipesTransmitted } from './crafting.js';
import { ITEM_ICONS } from './icons.js';
import { buildTransmissionColumn } from './transmissions.js';

/* ---------- Pages ---------- */

/** The pages, in the order they are bound: recipes, then the mission's words. */
const JOURNAL_PAGES = [
  ['recipes', 'Recipes'],
  ['transmissions', 'Transmissions']
];
/** The page the journal last showed. */
let journalPage = 'recipes';

/** The panel's name for the page it is showing, for a title or a heading. */
export function journalTitle() {
  const shown = JOURNAL_PAGES.find(([id]) => id === journalPage) || JOURNAL_PAGES[0];
  return 'Journal · ' + shown[1];
}

/** Turns one page left or right, walking the pages around in a ring. */
export function stepJournalPage(step) {
  const at = JOURNAL_PAGES.findIndex(([id]) => id === journalPage);
  journalPage = JOURNAL_PAGES[(at + step + JOURNAL_PAGES.length) % JOURNAL_PAGES.length][0];
}

/* ---------- What the shelves hold ---------- */

/** What each beacon's package is called on the shelf. */
const BEACON_SHELVES = {
  1: 'Survival kit',
  2: 'Farming, building & stone',
  3: 'Iron',
  4: 'Diamond'
};

function itemName(id) {
  const def = ITEMS.get(id);
  return def ? def.name : id;
}

function iconEl(id, className = 'icon') {
  const icon = document.createElement('span');
  icon.className = className;
  const art = ITEM_ICONS.get(id);
  if (art) icon.style.backgroundImage = 'url("' + art.url + '")';
  return icon;
}

/** A pattern's box: the widest row, and how many rows. */
function patternSize(recipe) {
  if (recipe.shapeless) return { w: recipe.shapeless.length, h: 1 };
  return {
    w: Math.max(...recipe.pattern.map((row) => row.length)),
    h: recipe.pattern.length
  };
}

/** Anything three cells across or three tall wants the table's 3x3 grid. */
function needsTable(recipe) {
  if (recipe.shapeless) return recipe.shapeless.length > 4;
  const { w, h } = patternSize(recipe);
  return w >= 3 || h >= 3;
}

function recipeIngredients(recipe) {
  const counts = new Map();
  if (recipe.shapeless) {
    for (const id of recipe.shapeless) counts.set(id, (counts.get(id) || 0) + 1);
    return counts;
  }
  for (const row of recipe.pattern) {
    for (const symbol of row) {
      if (symbol === '.') continue;
      const id = recipe.key[symbol];
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}

/**
 * The received recipes as shelf entries: one per thing made, carrying every
 * recipe that makes it as a variant, grouped by beacon in table order.
 */
function craftingShelves() {
  const shelves = new Map();
  for (const recipe of receivedRecipes()) {
    const beacon = recipe.unlockedBy ?? 0;
    if (!shelves.has(beacon)) shelves.set(beacon, new Map());
    const entries = shelves.get(beacon);
    const key = 'craft:' + recipe.result.id;
    if (!entries.has(key)) {
      entries.set(key, { key, kind: 'craft', result: recipe.result, variants: [] });
    }
    entries.get(key).variants.push(recipe);
  }
  return [...shelves.entries()].sort((a, b) => a[0] - b[0])
    .map(([beacon, entries]) => ({ beacon, entries: [...entries.values()] }));
}

/** The furnace's work, shelved once the walker knows how to build one. */
function smeltingShelf() {
  if (!receivedRecipes().some((recipe) => recipe.result.id === 'furnace')) return null;
  const entries = [];
  for (const [input, recipe] of SMELTING_RECIPES) {
    entries.push({
      key: 'smelt:' + input, kind: 'smelt', input, seconds: recipe.seconds,
      result: { id: recipe.out, count: 1 }, variants: [null]
    });
  }
  return entries;
}

/** Beacons still dark that carry recipes, and how many things each will teach. */
function waitingShelves() {
  const lit = recipesTransmitted();
  const waiting = new Map();
  for (const recipe of RECIPES) {
    const beacon = recipe.unlockedBy ?? 0;
    if (beacon <= lit) continue;
    if (!waiting.has(beacon)) waiting.set(beacon, new Set());
    waiting.get(beacon).add(recipe.result.id);
  }
  return [...waiting.entries()].sort((a, b) => a[0] - b[0])
    .map(([beacon, made]) => ({ beacon, count: made.size }));
}

/* ---------- The open book's own state ---------- */

/** The card the detail pane is showing, kept across rebuilds. */
let shownKey = null;
/** Which variant each multi-recipe card is turned to. */
const variantAt = new Map();

/* ---------- Drawing ---------- */

function slotEl(id = null, count = 0, extraClass = '') {
  const slot = document.createElement('span');
  slot.className = 'slot book-slot' + (extraClass ? ' ' + extraClass : '');
  if (id) {
    slot.title = itemName(id);
    slot.append(iconEl(id));
    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'count';
      badge.textContent = String(count);
      slot.append(badge);
    }
  }
  return slot;
}

/** A recipe laid on its grid, centred where the matcher accepts it. */
function craftGrid(recipe) {
  const size = needsTable(recipe) ? 3 : 2;
  const grid = document.createElement('div');
  grid.className = 'book-grid size-' + size;
  const cells = new Array(size * size).fill(null);
  if (recipe.shapeless) {
    recipe.shapeless.forEach((id, i) => { cells[i] = id; });
  } else {
    const { w, h } = patternSize(recipe);
    const ox = Math.floor((size - w) / 2);
    const oy = Math.floor((size - h) / 2);
    recipe.pattern.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '.') cells[(oy + y) * size + ox + x] = recipe.key[row[x]];
      }
    });
  }
  for (const id of cells) grid.append(slotEl(id));
  return grid;
}

function arrowEl() {
  const arrow = document.createElement('span');
  arrow.className = 'book-arrow';
  arrow.textContent = '→';
  arrow.setAttribute('aria-hidden', 'true');
  return arrow;
}

function lineEl(className, text) {
  const line = document.createElement('div');
  line.className = className;
  line.textContent = text;
  return line;
}

function needsList(counts) {
  const list = document.createElement('div');
  list.className = 'book-needs';
  for (const [id, count] of counts) {
    const need = document.createElement('span');
    need.className = 'book-need';
    need.append(iconEl(id, 'book-need-icon'), document.createTextNode(itemName(id) + ' ×' + count));
    list.append(need);
  }
  return list;
}

function paintDetail(detail, entry, onVariant) {
  detail.innerHTML = '';
  if (!entry) {
    detail.append(lineEl('book-where', 'Point at a recipe to see how it is laid out.'));
    return;
  }

  const name = document.createElement('div');
  name.className = 'book-name';
  name.textContent = itemName(entry.result.id) +
    (entry.result.count > 1 ? ' ×' + entry.result.count : '');
  detail.append(name);

  const craft = document.createElement('div');
  craft.className = 'book-craft';

  if (entry.kind === 'smelt') {
    const furnace = document.createElement('div');
    furnace.className = 'book-furnace';
    const flame = document.createElement('span');
    flame.className = 'book-flame';
    flame.textContent = '\u{1F525}';
    flame.title = 'Any fuel';
    furnace.append(slotEl(entry.input), flame);
    craft.append(furnace, arrowEl(), slotEl(entry.result.id, 1, 'book-out'));
    detail.append(craft);
    detail.append(lineEl('book-where', 'Furnace · ' + entry.seconds + ' s each'));
    const fuels = new Map([...FURNACE_FUELS.keys()].map((id) => [id, 1]));
    const fuelLine = needsList(fuels);
    fuelLine.classList.add('book-fuels');
    for (const need of fuelLine.querySelectorAll('.book-need')) {
      need.lastChild.textContent = need.lastChild.textContent.replace(/ ×1$/, '');
    }
    detail.append(lineEl('book-label', 'Burns'), fuelLine);
    return;
  }

  const at = Math.min(variantAt.get(entry.key) || 0, entry.variants.length - 1);
  const recipe = entry.variants[at];
  craft.append(craftGrid(recipe), arrowEl(),
    slotEl(recipe.result.id, recipe.result.count, 'book-out'));
  detail.append(craft);

  detail.append(lineEl('book-where', recipe.shapeless
    ? 'Any arrangement · pocket grid or table'
    : needsTable(recipe) ? 'Crafting table only' : 'Pocket grid or table'));
  detail.append(lineEl('book-label', 'Needs'), needsList(recipeIngredients(recipe)));

  if (entry.variants.length > 1) {
    const pips = document.createElement('div');
    pips.className = 'book-variants';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'book-variant-step';
    prev.textContent = '◂';
    prev.title = 'Previous way to make it';
    prev.dataset.nav = '';
    const next = prev.cloneNode(true);
    next.textContent = '▸';
    next.title = 'Next way to make it';
    const label = document.createElement('span');
    label.textContent = 'Way ' + (at + 1) + ' of ' + entry.variants.length;
    prev.addEventListener('click', () => onVariant(entry, -1, prev));
    next.addEventListener('click', () => onVariant(entry, 1, next));
    pips.append(prev, label, next);
    detail.append(pips);
  }
}

function buildRecipePage() {
  const page = document.createElement('div');
  page.className = 'book';

  const list = document.createElement('div');
  list.className = 'book-list';

  const detail = document.createElement('div');
  detail.className = 'book-detail';
  detail.setAttribute('aria-live', 'polite');

  const entries = new Map();

  function show(key) {
    if (!entries.has(key)) return;
    shownKey = key;
    for (const card of list.querySelectorAll('.book-card')) {
      card.classList.toggle('shown', card.dataset.recipe === key);
    }
    paintDetail(detail, entries.get(key), turnVariant);
  }

  function turnVariant(entry, step, from = null) {
    const count = entry.variants.length;
    if (count < 2) return false;
    variantAt.set(entry.key, ((variantAt.get(entry.key) || 0) + step + count) % count);
    paintDetail(detail, entry, turnVariant);
    // The button that was pressed was just redrawn; the highlight goes to its
    // replacement so a pad can keep pressing it.
    if (from) {
      const again = detail.querySelectorAll('.book-variant-step')[step < 0 ? 0 : 1];
      if (again) again.focus({ preventScroll: true });
    }
    return true;
  }

  function shelf(title, items, waiting = false) {
    const heading = lineEl('book-shelf' + (waiting ? ' waiting' : ''), title);
    list.append(heading);
    if (!items) return;
    const row = document.createElement('div');
    row.className = 'book-cards';
    for (const entry of items) {
      entries.set(entry.key, entry);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'book-card';
      card.dataset.nav = '';
      card.dataset.recipe = entry.key;
      card.title = itemName(entry.result.id);
      card.setAttribute('aria-label', itemName(entry.result.id));
      card.append(iconEl(entry.result.id));
      if (entry.result.count > 1) {
        const badge = document.createElement('span');
        badge.className = 'count';
        badge.textContent = String(entry.result.count);
        card.append(badge);
      }
      if (entry.variants.length > 1) {
        const more = document.createElement('span');
        more.className = 'book-card-more';
        more.textContent = entry.variants.length;
        more.title = entry.variants.length + ' ways to make it';
        card.append(more);
      }
      card.addEventListener('navfocus', () => show(entry.key));
      card.addEventListener('focus', () => show(entry.key));
      card.addEventListener('pointerenter', () => show(entry.key));
      // A press on a card turns it to its next way of being made, when it has one.
      card.addEventListener('click', () => {
        show(entry.key);
        turnVariant(entry, 1);
      });
      row.append(card);
    }
    list.append(row);
  }

  const crafting = craftingShelves();
  if (!crafting.length) {
    list.append(lineEl('journal-none',
      'Nothing received yet. Find the beacon the transmission wants, ' +
      'and the recipes will come through with it.'));
  }
  for (const { beacon, entries: items } of crafting) {
    shelf('Beacon ' + beacon + ' · ' + (BEACON_SHELVES[beacon] || 'Recipes'), items);
  }
  const smelting = smeltingShelf();
  if (smelting) shelf('Furnace · smelting', smelting);
  for (const { beacon, count } of waitingShelves()) {
    shelf('Beacon ' + beacon + ' · not yet lit · ' + count +
      (count === 1 ? ' recipe' : ' recipes') + ' waiting', null, true);
  }

  page.append(list, detail);
  page.alt = (el) => {
    const key = el && el.dataset && el.dataset.recipe ? el.dataset.recipe : shownKey;
    return entries.has(key) ? turnVariant(entries.get(key), 1) : false;
  };

  if (!entries.has(shownKey)) shownKey = entries.size ? entries.keys().next().value : null;
  if (shownKey) show(shownKey);
  else paintDetail(detail, null, turnVariant);
  return page;
}

function buildTransmissionPage() {
  const column = buildTransmissionColumn();
  for (const entry of column.querySelectorAll('.transcript-entry')) {
    entry.dataset.nav = '';
    entry.tabIndex = -1;
  }
  return column;
}

/**
 * Puts the page tabs and the page itself into a journal already on the page.
 * `turned` answers after the page changes, so whoever holds the journal can
 * retitle itself and put the highlight back.
 */
function fillJournal(wrap, turned) {
  wrap.innerHTML = '';

  const tabs = document.createElement('div');
  tabs.className = 'journal-tabs';
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of JOURNAL_PAGES) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'journal-tab';
    tab.dataset.nav = '';
    tab.dataset.page = id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', id === journalPage ? 'true' : 'false');
    tab.textContent = label;
    tab.classList.toggle('selected', id === journalPage);
    tab.addEventListener('click', () => {
      if (id === journalPage) return;
      journalPage = id;
      fillJournal(wrap, turned);
      if (turned) turned();
    });
    tabs.append(tab);
  }
  wrap.append(tabs);

  const page = journalPage === 'transmissions' ? buildTransmissionPage() : buildRecipePage();
  wrap.append(page);
  wrap.alt = page.alt || (() => false);
}

/**
 * The journal as the walker reads it. The returned element also answers:
 * - `turn(step)` — the previous or next page;
 * - `alt(el)` — the focused card's next variant;
 * - `firstFocus()` — where a highlight should land on a fresh page.
 */
export function buildJournalBody(turned = null) {
  const wrap = document.createElement('div');
  wrap.className = 'journal-pages';
  fillJournal(wrap, turned);
  wrap.turn = (step) => {
    stepJournalPage(step);
    fillJournal(wrap, turned);
    if (turned) turned();
  };
  wrap.firstFocus = () =>
    wrap.querySelector('.book-card.shown') ||
    wrap.querySelector('.book-card, .transcript-entry') ||
    wrap.querySelector('.journal-tab.selected');
  return wrap;
}
