/*
 * Everything the player reads, and everything the player clicks: the hotbar and
 * its durability bars, the toast, the sprint line and the pad's row, the hearts
 * and the shield row and the food bar, the death screen, and the screens
 * themselves — inventory, crafting, furnace, chest, the journal and the give
 * shelf — with the cursor that carries a stack between them and the pad's own
 * way through a grid.
 *
 * This is the only file that holds an element. Everything else asks: the body
 * paints through `paintHealth` and `paintHunger`, the armour through
 * `paintArmorBar`, the pack through `paintPack`, the wash through
 * `setDamageFlash`, the cursor through `setCursorView`, the sleep fade and the
 * debug readout through `setInteractionView`, and the controller through
 * `setInputView`. The threat line is handed a number by `main.js` and never
 * asks the mission layer itself. Nothing outside this file needs to know a bar is a list of
 * spans or that a screen has a body div.
 *
 * It also owns which screen is open. `screen()` answers, `openScreen` and
 * `closeScreen` change it, and every layer that has to stop while a screen has
 * the controls asks through one of its seams rather than importing the binding.
 */

import { clearTarget, updateTarget } from './aim.js';
import {
  playChestCloseSound, playChestOpenSound, playKeyClickSound, playTransmissionHandshakeSound,
  playUiClickSound, playUiCloseSound, playUiOpenSound,
  toggleAudioMuted, TRANSMISSION_HANDSHAKE_MS
} from './audio.js';
import {
  ARMOR_BAR_SHIELDS, ARMOR_GLYPHS, ARMOR_MAX_DEFENSE, ARMOR_PIECES, CHEST_SLOTS, ITEMS,
  isChestBlock, isFurnaceBlock, makeStack, mergeStackInto, packedSlotCount, stackDurability,
  stacksMergeable
} from './blocks.js';
import { markWorldDirty, world } from './chunks.js';
import { CHUNK_SIZE, DIFFICULTY_MAX, HUNGER_MAX, clamp } from './config.js';
import {
  FURNACE_FUEL, FURNACE_FUELS, FURNACE_INPUT, FURNACE_OUTPUT, SMELTING_RECIPES, furnaceHasWork
} from './containers.js';
import {
  CRAFT2_SIZE, CRAFT3_SIZE, craft2, craft3, matchRecipe
} from './crafting.js';
import {
  clearCursorStack, craftCurrent, cursorCarried, dropEmptyCursorStack, returnCursorStack,
  setCursorStack
} from './cursor.js';
import { essenceCount, grantEssence } from './essence.js';
import { respawnPlayer } from './health.js';
import { ITEM_ICONS } from './icons.js';
import {
  PAD_BUTTON, canvas, fallbackControls, gamepadState, gpAxis, menuOpen, overlayEl,
  padMenuDirection, padMenuRepeat, pressedKeys,
  releaseMiningButton, releasePadMining, renderSprintState, requestLock
} from './input.js';
import { hideMiningFeedback } from './interaction.js';
import {
  HOTBAR_SIZE, INVENTORY_SIZE, addItemToInventory, armorDefense, armorSlots, currentSlot,
  equipSlotFor, inventory, selectSlot
} from './inventory.js';
import { mobs } from './mob.js';
import { player } from './player.js';
import { camera, renderer } from './render.js';
import { applyDayNight, clockHours, formatClock, isNight, nudgeDayTime } from './sky.js';
import { debugEnabled } from './debug.js';
import { fpsShown, onSettingsChanged } from './settings.js';
import { buildJournalBody, journalTitle } from './journal.js';
import { createNav } from './menu-nav.js';

const fpsEl = document.getElementById('fps');
const dayDialEl = document.getElementById('day-dial');
const dayDialFaceEl = dayDialEl.querySelector('.dial-face');
const debugEl = document.getElementById('debug');
const coordsEl = document.getElementById('coords');
const chunklineEl = document.getElementById('chunkline');
const waypointEl = document.getElementById('waypoint');
const waypointArrowEl = waypointEl.querySelector('.waypoint-arrow');
const waypointLabelEl = waypointEl.querySelector('.waypoint-label');
const waypointDistanceEl = waypointEl.querySelector('.waypoint-distance');
const hotbarEl = document.getElementById('hotbar');
const healthEl = document.getElementById('health');
const armorEl = document.getElementById('armor');
export const hungerBarEl = document.getElementById('hunger');
const essenceEl = document.getElementById('essence');
const essenceCountEl = document.getElementById('essence-count');
const toastEl = document.getElementById('item-toast');
const transmissionEl = document.getElementById('transmission');
const screenLayer = document.getElementById('screen-layer');
const screenTitle = document.getElementById('screen-title');
const screenBody = document.getElementById('screen-body');
const screenHint = document.getElementById('inv-hint');
const DEFAULT_SCREEN_HINT = screenHint.textContent;
const GIVE_SCREEN_HINT =
  'Mouse: left whole stack \u00b7 right one \u00b7 Pad: A whole \u00b7 X one \u00b7 B close';
const cursorStackEl = document.getElementById('cursor-stack');
const cursorIconEl = cursorStackEl.querySelector('.icon');
const cursorCountEl = cursorStackEl.querySelector('.count');
export const controlHintEl = document.getElementById('control-hint');
export const padStatusEl = document.getElementById('pad-status');
export const padSensitivityEl = document.getElementById('pad-sens-value');
export const sprintStateEl = document.getElementById('sprint-state');
const healthBarEl = document.getElementById('health');
const damageFlashEl = document.getElementById('damage-flash');
export const sleepFadeEl = document.getElementById('sleep-fade');
export const arrivalFadeEl = document.getElementById('arrival-fade');
export const deathScreenEl = document.getElementById('death-screen');
export const deathCauseEl = document.getElementById('death-cause');
const respawnButton = document.getElementById('respawn-button');

let damageFlashTimer = 0;
/* The red wash that follows a hit is not a wound, it is the screen's way of
   saying one landed. The body only says when to put one up, how much of it has
   drained away, and when to take it away — at a death, or at a new life. */
export function showDamageFlash() {
  damageFlashTimer = 0.5;
  damageFlashEl.style.opacity = '1';
}

export function fadeDamageFlash(dt) {
  if (damageFlashTimer <= 0) {
    damageFlashEl.style.opacity = '0';
    return;
  }
  damageFlashTimer = Math.max(0, damageFlashTimer - dt);
  damageFlashEl.style.opacity = String(clamp(damageFlashTimer * 2.4, 0, 1));
}

export function clearDamageFlash() {
  damageFlashTimer = 0;
  damageFlashEl.style.opacity = '0';
}

export function renderHealth() {
  const hearts = healthBarEl.children;
  const points = clamp(player.health, 0, player.maxHealth);
  const full = Math.floor(points / 2);
  // Armour leaves health with fractions on it, so a heart counts as half as
  // soon as a full point of it is left, rather than only on exact halves.
  const half = points % 2 >= 1;

  for (let i = 0; i < hearts.length; i++) {
    const heart = hearts[i];
    heart.classList.toggle('dark', i >= full + (half ? 1 : 0));
    heart.classList.toggle('half', half && i === full);
  }
}

/**
 * The carried essence, bubble and number: hidden entirely at zero, the way
 * the shield row hides when nothing is worn, so the HUD only speaks of
 * essence once the walker has any.
 */
export function renderEssence() {
  const total = essenceCount();
  essenceEl.classList.toggle('hidden', total <= 0);
  essenceCountEl.textContent = String(total);
}

/**
 * Draws the shield row above the hearts. Minecraft spends one shield per two
 * defence points and hides the whole row when nothing is worn.
 */
export function renderArmorBar() {
  const points = Math.min(ARMOR_MAX_DEFENSE, armorDefense());
  armorEl.classList.toggle('hidden', points <= 0);
  const shields = armorEl.children;
  const full = Math.floor(points / 2);
  const half = points % 2 === 1;

  for (let i = 0; i < shields.length; i++) {
    const shield = shields[i];
    shield.classList.toggle('dark', i >= full + (half ? 1 : 0));
    shield.classList.toggle('half', half && i === full);
  }
}

export function renderHunger() {
  const points = clamp(player.hunger, 0, HUNGER_MAX);
  const haunches = hungerBarEl.children;
  const full = Math.floor(points / 2);
  const half = points % 2 >= 1;

  for (let i = 0; i < haunches.length; i++) {
    const haunch = haunches[i];
    haunch.classList.toggle('dark', i >= full + (half ? 1 : 0));
    haunch.classList.toggle('half', half && i === full);
  }
  // The bar jitters while saturation is gone but there is still food to lose,
  // which is Minecraft's only tell for the hidden counter.
  hungerBarEl.classList.toggle(
    'jitter',
    !player.dead && player.hunger > 0 && player.saturation <= 0
  );
}

/* The button on the death screen is the only way back into the world. */
respawnButton.addEventListener('click', (event) => {
  event.preventDefault();
  respawnPlayer();
});


let cursorX = window.innerWidth / 2;
let cursorY = window.innerHeight / 2;

for (let i = 0; i < player.maxHealth / 2; i++) {
  const heart = document.createElement('span');
  heart.className = 'heart';
  heart.textContent = '\u2665';
  healthEl.appendChild(heart);
}
renderHealth();

/** Ten shields, one per two defence points, filled from the right. */
for (let i = 0; i < ARMOR_BAR_SHIELDS; i++) {
  const shield = document.createElement('span');
  shield.className = 'shield';
  armorEl.appendChild(shield);
}
renderArmorBar();

/** Ten haunches, one per two food points, eaten from the right. */
for (let i = 0; i < HUNGER_MAX / 2; i++) {
  const haunch = document.createElement('span');
  haunch.className = 'haunch';
  hungerBarEl.appendChild(haunch);
}
renderHunger();
renderEssence();
renderSprintState();

const hotbarSlots = [];
const hotbarIcons = [];
const hotbarCounts = [];
for (let i = 0; i < HOTBAR_SIZE; i++) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  const icon = document.createElement('div');
  icon.className = 'icon';
  const count = document.createElement('span');
  count.className = 'count';
  const key = document.createElement('span');
  key.className = 'key';
  key.textContent = String(i + 1);
  slot.append(icon, count, key);
  hotbarEl.appendChild(slot);
  hotbarSlots.push(slot);
  hotbarIcons.push(icon);
  hotbarCounts.push(count);
}

let toastTimer = 0;

/**
 * Tooltip text for a stack: the name, a note on anything a furnace still owes
 * it, and the durability left on tools and armour.
 */
function stackTitle(stack) {
  if (!stack) return '';
  const item = ITEMS.get(stack.id);
  let name = item ? item.name : stack.id;
  if (item && item.needsCooking) name += ' — needs cooking in a furnace';
  const packed = packedSlotCount(stack);
  if (packed) name += ' — ' + packed + (packed === 1 ? ' stack' : ' stacks') + ' inside';
  const info = stackDurability(stack);
  return info ? name + ' — ' + info.current + '/' + info.max : name;
}

/**
 * Mounts, refreshes or removes the wear strip on a slot. Only damaged stacks
 * get one, so a pristine tool looks exactly like any other item.
 */
function updateSlotDurability(el, stack) {
  const info = stackDurability(stack);
  let bar = el.querySelector('.durbar');

  if (!info || info.ratio >= 1) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('span');
    bar.className = 'durbar';
    const fill = document.createElement('span');
    fill.className = 'durfill';
    bar.append(fill);
    el.append(bar);
  }

  const fill = bar.firstElementChild;
  fill.style.width = (info.ratio * 100).toFixed(1) + '%';
  // Green while nearly fresh, sliding to red as the item runs out.
  fill.style.background = 'hsl(' + Math.round(info.ratio * 105) + ', 78%, 45%)';
}

export function renderHotbar() {
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const stack = inventory[i];
    const icon = hotbarIcons[i];
    const count = hotbarCounts[i];

    if (stack) {
      const itemIcon = ITEM_ICONS.get(stack.id);
      icon.style.backgroundImage = itemIcon ? 'url("' + itemIcon.url + '")' : '';
      count.textContent = stack.count > 1 ? String(stack.count) : '';
      hotbarSlots[i].title = stackTitle(stack);
    } else {
      icon.style.backgroundImage = '';
      count.textContent = '';
      hotbarSlots[i].title = '';
    }
    updateSlotDurability(hotbarSlots[i], stack);
  }
}

function createScreenSlot(container, index, stack, options = {}) {
  const el = document.createElement('div');
  el.className = 'slot inv-slot';
  if (options.extraClass) {
    for (const name of options.extraClass.split(' ')) el.classList.add(name);
  }
  el.dataset.container = container;
  el.dataset.index = String(index);

  const icon = document.createElement('div');
  icon.className = 'icon';
  const count = document.createElement('span');
  count.className = 'count';

  if (stack) {
    const itemIcon = ITEM_ICONS.get(stack.id);
    if (itemIcon) icon.style.backgroundImage = 'url("' + itemIcon.url + '")';
    if (stack.count > 1) count.textContent = String(stack.count);
    el.title = stackTitle(stack);
  }

  el.append(icon, count);
  updateSlotDurability(el, stack);

  if (options.key) {
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = options.key;
    el.append(key);
  }
  if (options.selected) el.classList.add('selected');
  return el;
}

/* ---------- Debug give shelf ---------- */

/**
 * Every item the game knows, in definition order: placeable blocks first,
 * then materials, food, tools and armour. The debug shelf hands out any of
 * them, which is the whole point of it.
 */
export const GIVE_ITEMS = [...ITEMS.keys()];

/**
 * Adds one shelf item to the pack and reports it the way a hotbar announce
 * does. Right-click gives a single item; anything else hands out a whole
 * stack. A full pack swallows nothing, and the toast says so instead of
 * failing silently.
 */
function giveFromShelf(index, button) {
  const itemId = GIVE_ITEMS[Number(index)];
  if (!itemId) return;
  const def = ITEMS.get(itemId);
  const wanted = button === 2 ? 1 : (def ? def.stack : 1);
  const leftover = addItemToInventory(itemId, wanted);
  const added = wanted - leftover;
  if (added > 0) markWorldDirty();

  const name = def ? def.name : itemId;
  if (added <= 0) showToast('No room in your pack');
  else showToast(name + (added > 1 ? ' \u00d7' + added : '') +
    (leftover > 0 ? ' \u2014 pack full' : ''));
}

/** The shelf itself: one icon per item, no counts, no wear strips. */
function buildGiveColumn() {
  const column = document.createElement('div');
  column.className = 'craft-column';

  const grid = document.createElement('div');
  grid.className = 'inv-grid give-grid';
  GIVE_ITEMS.forEach((itemId, i) => {
    const item = ITEMS.get(itemId);
    const el = document.createElement('div');
    el.className = 'slot inv-slot give-slot';
    el.dataset.container = 'give';
    el.dataset.index = String(i);
    el.title = item ? item.name : itemId;

    const icon = document.createElement('div');
    icon.className = 'icon';
    const itemIcon = ITEM_ICONS.get(itemId);
    if (itemIcon) icon.style.backgroundImage = 'url("' + itemIcon.url + '")';
    el.append(icon);
    grid.append(el);
  });

  column.append(grid);
  return column;
}

/** Furnace state behind the open furnace screen, creating one if need be. */
function activeFurnace() {
  if (activeScreen !== 'furnace' || !activeScreenAt) return null;
  const at = activeScreenAt;
  if (!isFurnaceBlock(world.getBlock(at.x, at.y, at.z))) return null;
  return world.blockEntityAt(at.x, at.y, at.z, 'furnace');
}

/** Chest state behind the open chest screen, creating one if need be. */
function activeChest() {
  if (activeScreen !== 'chest' || !activeScreenAt) return null;
  const at = activeScreenAt;
  if (!isChestBlock(world.getBlock(at.x, at.y, at.z))) return null;
  return world.blockEntityAt(at.x, at.y, at.z, 'chest');
}

/** Gauge elements of the open furnace, refreshed without a full re-render. */
let furnaceGauges = null;

export function updateFurnaceGauges(state) {
  if (!furnaceGauges || !state) return;
  const input = state.slots[FURNACE_INPUT];
  const recipe = input ? SMELTING_RECIPES.get(input.id) : null;
  const cook = recipe ? clamp(state.cookTime / recipe.seconds, 0, 1) : 0;
  const burn = state.burnTotal > 0 ? clamp(state.burnTime / state.burnTotal, 0, 1) : 0;
  furnaceGauges.cook.style.width = (cook * 100).toFixed(1) + '%';
  furnaceGauges.flame.style.height = (burn * 100).toFixed(1) + '%';
  // The caption is part of the gauge: a furnace that runs out of coal or
  // finishes a batch should say so without opening and closing the screen.
  if (furnaceGauges.status) furnaceGauges.status.textContent = furnaceStatusText(state);
}

/** One line of plain advice under the furnace slots. */
function furnaceStatusText(state) {
  const input = state.slots[FURNACE_INPUT];
  if (!input) return 'Put something to smelt on top';
  const recipe = SMELTING_RECIPES.get(input.id);
  if (!recipe) return 'That cannot be smelted';
  if (!furnaceHasWork(state)) {
    return 'Result slot is full \u2014 take what is in it';
  }
  if (state.burnTime <= 0) {
    return state.slots[FURNACE_FUEL]
      ? 'Out of fuel'
      : 'Needs fuel: coal, charcoal or planks';
  }
  const item = ITEMS.get(recipe.out);
  return 'Cooking ' + (item ? item.name : recipe.out);
}

/**
 * Storage and hotbar grids, shared by every screen. The chest screen asks
 * first for the box's own three rows of nine, which sit above the pack the
 * way they do in Minecraft's chest layout.
 */
function buildStorageColumn(withChest = false) {
  const left = document.createElement('div');
  left.className = 'inv-left';

  if (withChest) {
    const state = activeChest();
    const chestLabel = document.createElement('div');
    chestLabel.className = 'inv-section-label';
    chestLabel.textContent = 'Chest';
    const chestGrid = document.createElement('div');
    chestGrid.className = 'inv-grid';
    for (let i = 0; i < CHEST_SLOTS; i++) {
      chestGrid.append(createScreenSlot('chest', i, state.slots[i], {
        extraClass: 'chest-slot'
      }));
    }
    left.append(chestLabel, chestGrid);
  }

  const storageLabel = document.createElement('div');
  storageLabel.className = 'inv-section-label';
  storageLabel.textContent = 'Storage';
  const storageGrid = document.createElement('div');
  storageGrid.className = 'inv-grid';
  for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) {
    storageGrid.append(createScreenSlot('inventory', i, inventory[i]));
  }

  const hotbarLabel = document.createElement('div');
  hotbarLabel.className = 'inv-section-label';
  hotbarLabel.textContent = 'Hotbar';
  const hotbarGrid = document.createElement('div');
  hotbarGrid.className = 'inv-grid';
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    hotbarGrid.append(createScreenSlot('inventory', i, inventory[i], {
      key: String(i + 1),
      selected: i === currentSlot()
    }));
  }

  left.append(storageLabel, storageGrid, hotbarLabel, hotbarGrid);
  return left;
}

/**
 * Armour column: four slots stacked head to feet, with a faint glyph in each
 * empty slot so it is obvious what goes where, and a one-line readout of the
 * defence the set is currently worth.
 */
function buildArmorColumn() {
  const column = document.createElement('div');
  column.className = 'inv-armor';

  const label = document.createElement('div');
  label.className = 'inv-section-label';
  label.textContent = 'Armour';

  const grid = document.createElement('div');
  grid.className = 'armor-grid';
  for (let i = 0; i < armorSlots.length; i++) {
    const el = createScreenSlot('armor', i, armorSlots[i], {
      extraClass: 'armor-slot'
    });
    if (!armorSlots[i]) {
      const glyph = document.createElement('span');
      glyph.className = 'armor-glyph';
      glyph.textContent = ARMOR_GLYPHS[i];
      glyph.title = ARMOR_PIECES[i].label;
      el.append(glyph);
    }
    grid.append(el);
  }

  const summary = document.createElement('div');
  summary.className = 'armor-summary';
  const points = armorDefense();
  summary.textContent = points > 0 ? points + ' defence' : '';

  column.append(label, grid, summary);
  return column;
}

/** Crafting grid, arrow and result slot. */
function buildCraftingColumn() {
  const isTable = activeScreen === 'crafting';
  const grid = isTable ? craft3 : craft2;
  const size = isTable ? CRAFT3_SIZE : CRAFT2_SIZE;
  const recipe = matchRecipe(grid, size);

  const right = document.createElement('div');
  right.className = 'craft-column';

  const craftLabel = document.createElement('div');
  craftLabel.className = 'inv-section-label';
  craftLabel.textContent = isTable ? 'Crafting 3 \u00d7 3' : 'Crafting 2 \u00d7 2';

  const craftRow = document.createElement('div');
  craftRow.className = 'craft-row';

  const craftGrid = document.createElement('div');
  craftGrid.className = 'inv-grid ' + (isTable ? 'craft-3x3' : 'craft-2x2');
  for (let i = 0; i < grid.length; i++) {
    craftGrid.append(createScreenSlot(
      isTable ? 'craft3' : 'craft2', i, grid[i]
    ));
  }

  const arrow = document.createElement('div');
  arrow.className = 'craft-arrow';
  arrow.textContent = '\u2192';

  const resultEl = createScreenSlot('result', 0, recipe ? recipe.result : null, {
    extraClass: 'result-slot' + (recipe ? ' has-result' : '')
  });
  if (recipe) {
    const item = ITEMS.get(recipe.result.id);
    resultEl.title = 'Craft ' + (item ? item.name : recipe.result.id);
  } else {
    resultEl.title = 'No recipe';
  }

  craftRow.append(craftGrid, arrow, resultEl);

  const outputName = document.createElement('div');
  outputName.className = 'craft-output-name';
  if (recipe) {
    const item = ITEMS.get(recipe.result.id);
    outputName.textContent = (item ? item.name : recipe.result.id) +
      (recipe.result.count > 1 ? ' \u00d7 ' + recipe.result.count : '');
  } else {
    outputName.textContent = 'Add ingredients';
  }

  right.append(craftLabel, craftRow, outputName);
  return right;
}

/** Input, flame, fuel, progress and output for the furnace screen. */
function buildFurnaceColumn() {
  const state = activeFurnace();

  const column = document.createElement('div');
  column.className = 'craft-column';

  const label = document.createElement('div');
  label.className = 'inv-section-label';
  label.textContent = 'Smelting';

  const body = document.createElement('div');
  body.className = 'furnace-body';

  const feedStack = document.createElement('div');
  feedStack.className = 'furnace-stack';
  const inputEl = createScreenSlot('furnace', FURNACE_INPUT, state.slots[FURNACE_INPUT], {
    extraClass: 'furnace-in-slot'
  });
  inputEl.title = 'What to smelt';

  const flame = document.createElement('div');
  flame.className = 'furnace-flame';
  const flameFill = document.createElement('span');
  flameFill.className = 'flame-fill';
  flame.append(flameFill);

  const fuelEl = createScreenSlot('furnace', FURNACE_FUEL, state.slots[FURNACE_FUEL], {
    extraClass: 'furnace-fuel-slot'
  });
  fuelEl.title = 'Fuel: coal and charcoal burn for 80 seconds';

  feedStack.append(inputEl, flame, fuelEl);

  const resultStack = document.createElement('div');
  resultStack.className = 'furnace-stack';

  const progress = document.createElement('div');
  progress.className = 'furnace-progress';
  const progressFill = document.createElement('span');
  progressFill.className = 'progress-fill';
  const glyph = document.createElement('span');
  glyph.className = 'progress-glyph';
  glyph.textContent = '\u2192';
  progress.append(progressFill, glyph);

  const outputEl = createScreenSlot('furnace', FURNACE_OUTPUT, state.slots[FURNACE_OUTPUT], {
    extraClass: 'furnace-out-slot'
  });
  outputEl.title = 'Take the result out';

  resultStack.append(progress, outputEl);
  body.append(feedStack, resultStack);

  const status = document.createElement('div');
  status.className = 'craft-output-name';
  status.textContent = furnaceStatusText(state);

  column.append(label, body, status);

  furnaceGauges = { flame: flameFill, cook: progressFill, status };
  updateFurnaceGauges(state);
  return column;
}

/* The journal is its own book now (journal.js): the screen only gives it the
   panel, a title that follows its page, and a walker so the pad, the keys and
   the mouse all move one highlight across its cards. */
const JOURNAL_HINT =
  'Arrows / D-pad move \u00b7 Q E or LB RB turn the page \u00b7 ' +
  'R or X next way to make it \u00b7 J or B close';

/** The journal on the screen, and the walker that moves across it. */
let journalBook = null;
let journalNav = null;

/** The in-game journal's title follows its page. */
function paintJournalTitle() { screenTitle.textContent = journalTitle(); }

/** A page turned: retitle, and put the highlight on the new page. */
function journalTurned() {
  paintJournalTitle();
  if (journalNav && journalBook) journalNav.focus(journalBook.firstFocus());
}

export function renderScreen() {
  if (!activeScreen) return;

  // The give shelf shares the panel but nothing else: no pack, no crafting
  // grid, just the shelf and the hint under it.
  if (activeScreen === 'give') {
    screenTitle.textContent = 'Debug \u00b7 Give Items';
    screenHint.textContent = GIVE_SCREEN_HINT;
    screenBody.innerHTML = '';
    const giveLayout = document.createElement('div');
    giveLayout.className = 'inv-layout';
    giveLayout.append(buildGiveColumn());
    screenBody.append(giveLayout);
    if (gamepadState.active) applyPadCursorFocus(false);
    return;
  }

  // The journal shares the panel and also nothing else: no pack, no grid,
  // no cursor — recipes are learned whole and cannot be carried.
  if (activeScreen === 'journal') {
    screenHint.textContent = JOURNAL_HINT;
    screenBody.innerHTML = '';
    journalBook = buildJournalBody(journalTurned);
    screenBody.append(journalBook);
    paintJournalTitle();
    if (!journalNav) {
      journalNav = createNav(screenBody, {
        onTab: (step) => { if (journalBook) journalBook.turn(step); },
        onAlt: (el) => (journalBook ? journalBook.alt(el) : false)
      });
    }
    journalNav.clear();
    journalNav.focus(journalBook.firstFocus());
    return;
  }

  const isFurnace = activeScreen === 'furnace';
  const isChest = activeScreen === 'chest';
  furnaceGauges = null;
  if (isFurnace && !activeFurnace()) {
    closeScreen();
    return;
  }
  // A chest blown up or broken while its lid is open leaves nothing to show, so
  // the panel goes away instead of hanging over a box that is no longer there.
  if (isChest && !activeChest()) {
    closeScreen();
    return;
  }

  screenHint.textContent = DEFAULT_SCREEN_HINT;
  screenTitle.textContent = isFurnace
    ? 'Furnace'
    : isChest
      ? 'Chest'
      : (activeScreen === 'crafting' ? 'Crafting Table' : 'Inventory');
  screenBody.innerHTML = '';

  const layout = document.createElement('div');
  layout.className = 'inv-layout';
  layout.append(
    buildStorageColumn(isChest),
    buildArmorColumn(),
    isFurnace ? buildFurnaceColumn() : buildCraftingColumn()
  );
  screenBody.append(layout);
  renderArmorBar();

  if (gamepadState.active) applyPadCursorFocus(false);
}

/* ---------- Gamepad navigation for inventory/crafting ---------- */

export const padCursor = { section: 0, index: 0 };

/**
 * Logical slot groups in on-screen reading order. `column` mirrors the panel
 * layout: storage and hotbar stack in the left column, the crafting grid and
 * its result sit to the right, so the D-pad walks between them the way the
 * eye does.
 */
function padSections() {
  if (!activeScreen) return [];
  // The journal is a list of words, not a grid of slots: the pad can open it
  // and close it, but there is no cursor to park on it.
  if (activeScreen === 'journal') return [];
  if (activeScreen === 'give') {
    return [{
      container: 'give', start: 0,
      count: GIVE_ITEMS.length, cols: 9, column: 0
    }];
  }
  const storage = [
    {
      container: 'inventory', start: HOTBAR_SIZE,
      count: INVENTORY_SIZE - HOTBAR_SIZE, cols: 9, column: 0
    },
    {
      container: 'inventory', start: 0,
      count: HOTBAR_SIZE, cols: 9, column: 0
    }
  ];
  // The box's own three rows are stacked above Storage in the same left column,
  // so the D-pad starts at the lid and walks down into the pack from there.
  if (activeScreen === 'chest') {
    storage.unshift({
      container: 'chest', start: 0,
      count: CHEST_SLOTS, cols: 9, column: 0
    });
  }
  const armour = [
    {
      container: 'armor', start: 0,
      count: armorSlots.length, cols: 1, column: 1
    }
  ];
  if (activeScreen === 'furnace') {
    return storage.concat(armour).concat([
      {
        container: 'furnace', start: FURNACE_INPUT,
        count: 2, cols: 1, column: 2
      },
      {
        container: 'furnace', start: FURNACE_OUTPUT,
        count: 1, cols: 1, column: 3
      }
    ]);
  }

  const isTable = activeScreen === 'crafting';
  return storage.concat(armour).concat([
    {
      container: isTable ? 'craft3' : 'craft2', start: 0,
      count: (isTable ? CRAFT3_SIZE : CRAFT2_SIZE) ** 2,
      cols: isTable ? CRAFT3_SIZE : CRAFT2_SIZE, column: 2
    },
    { container: 'result', start: 0, count: 1, cols: 1, column: 3 }
  ]);
}

/** Other section indices sharing the current section's layout column. */
function columnSiblings(sections, index) {
  return sections
    .map((section, i) => (section.column === sections[index].column ? i : -1))
    .filter((i) => i >= 0);
}

/** Section the cursor lands on stepping sideways into an adjacent column. */
function sidewaysSection(sections, from, dir) {
  const targets = sections
    .map((section, i) => (section.column === sections[from].column + dir ? i : -1))
    .filter((i) => i >= 0);
  if (!targets.length) return -1;
  // Prefer the section at the same vertical position inside its column.
  const rank = columnSiblings(sections, from).indexOf(from);
  return targets[Math.min(rank, targets.length - 1)];
}

function resetPadCursor() {
  padCursor.section = 0;
  padCursor.index = 0;
}

function clampPadCursor() {
  const sections = padSections();
  if (!sections.length) {
    padCursor.section = 0;
    padCursor.index = 0;
    return;
  }
  padCursor.section = clamp(padCursor.section, 0, sections.length - 1);
  const section = sections[padCursor.section];
  padCursor.index = clamp(padCursor.index, 0, section.count - 1);
}

function movePadCursor(dx, dy) {
  const sections = padSections();
  if (!sections.length) return;
  clampPadCursor();

  let sectionIndex = padCursor.section;
  let index = padCursor.index;
  const section = sections[sectionIndex];
  const row = Math.floor(index / section.cols);
  const col = index % section.cols;
  const rows = Math.ceil(section.count / section.cols);

  if (dx) {
    const inRow = Math.min(section.cols, section.count - row * section.cols);
    const nextCol = col + dx;
    if (nextCol >= 0 && nextCol < inRow) {
      index = row * section.cols + nextCol;
    } else {
      // Walk out sideways into the neighbouring column, entering at its edge.
      const target = sidewaysSection(sections, sectionIndex, dx);
      if (target < 0) return;
      sectionIndex = target;
      const dest = sections[target];
      const destRow = Math.min(row, Math.ceil(dest.count / dest.cols) - 1);
      const destInRow = Math.min(dest.cols, dest.count - destRow * dest.cols);
      index = destRow * dest.cols + (dx > 0 ? 0 : destInRow - 1);
    }
  } else {
    const nextRow = row + dy;
    if (nextRow >= 0 && nextRow < rows) {
      const inRow = Math.min(section.cols, section.count - nextRow * section.cols);
      index = nextRow * section.cols + Math.min(col, inRow - 1);
    } else {
      // Wrap to the next section above or below inside the same column.
      const siblings = columnSiblings(sections, sectionIndex);
      if (siblings.length < 2) return;
      const target = siblings[
        (siblings.indexOf(sectionIndex) + dy + siblings.length) % siblings.length
      ];
      sectionIndex = target;
      const dest = sections[target];
      const destRow = dy > 0 ? 0 : Math.ceil(dest.count / dest.cols) - 1;
      const inRow = Math.min(dest.cols, dest.count - destRow * dest.cols);
      index = destRow * dest.cols + Math.min(col, inRow - 1);
    }
  }

  padCursor.section = sectionIndex;
  padCursor.index = index;
  applyPadCursorFocus(true);
}

function movePadSection(dir) {
  const sections = padSections();
  if (!sections.length) return;
  padCursor.section = (padCursor.section + dir + sections.length) % sections.length;
  padCursor.index = 0;
  applyPadCursorFocus(true);
}

function findPadFocusSlot(section) {
  const index = section.start + padCursor.index;
  return screenBody.querySelector(
    '.inv-slot[data-container="' + section.container +
    '"][data-index="' + index + '"]'
  );
}

/**
 * Highlight the pad cursor. `reposition` also parks the floating cursor stack
 * on that slot; mouse-driven renders leave the pointer where the user put it.
 */
function applyPadCursorFocus(reposition) {
  if (!activeScreen) return;
  clampPadCursor();
  const sections = padSections();
  const section = sections[padCursor.section];
  if (!section) return;

  for (const el of screenBody.querySelectorAll('.pad-focus')) {
    el.classList.remove('pad-focus');
  }

  const slot = findPadFocusSlot(section);
  if (!slot) return;
  slot.classList.add('pad-focus');

  if (reposition) {
    const rect = slot.getBoundingClientRect();
    cursorX = rect.left + rect.width / 2;
    cursorY = rect.top + rect.height / 2;
    updateCursorVisual();
  }
}

function padActivateSlot(mode) {
  const sections = padSections();
  if (!sections.length) return;
  clampPadCursor();
  const section = sections[padCursor.section];
  const index = section.start + padCursor.index;

  // The shelf only ever hands items out, so A and Y take a whole stack, X
  // takes one, and there is nothing for quick move to move.
  if (section.container === 'give') {
    playUiClickSound();
    if (mode === 'primary' || mode === 'quick') giveFromShelf(index, 0);
    else if (mode === 'secondary') giveFromShelf(index, 2);
    clampPadCursor();
    applyPadCursorFocus(true);
    return;
  }

  if (section.container === 'result') {
    // The result pad answers with the crafting chime, not a pick click: it is
    // a confirmation, and the two together would double every craft.
    if (mode === 'quick') craftCurrent(true);
    else if (mode === 'primary') craftCurrent(false);
  } else if (mode === 'quick') {
    playUiClickSound();
    quickMoveStack(section.container, index);
    renderScreen();
    renderHotbar();
    updateCursorVisual();
  } else {
    playUiClickSound();
    handleScreenSlotClick(section.container, index, mode === 'secondary' ? 2 : 0, false);
  }

  clampPadCursor();
  applyPadCursorFocus(true);
}

export function handlePadScreenTap(name) {
  // The close keys answer wherever a screen is up, even the two that have no
  // grid to walk: the journal and the give shelf are lists of words and icons,
  // and a pad still has to be able to put them down.
  if (name === 'b' || name === 'start' || name === 'back') {
    if (activeScreen) closeScreen();
    return;
  }
  if (!padSections().length) return;

  if (name === 'lb') { movePadSection(-1); return; }
  if (name === 'rb') { movePadSection(1); return; }
  if (name === 'a') { padActivateSlot('primary'); return; }
  if (name === 'x') { padActivateSlot('secondary'); return; }
  if (name === 'y') { padActivateSlot('quick'); return; }

  if (name === 'left') movePadCursor(-1, 0);
  else if (name === 'right') movePadCursor(1, 0);
  else if (name === 'up') movePadCursor(0, -1);
  else if (name === 'down') movePadCursor(0, 1);
}

/** Held-direction repeat with an initial delay, for both D-pad and stick. */
export function updateGamepadScreen(dt) {
  if (!activeScreen) return;
  // The journal has no slot cursor: its walker moves the highlight over the
  // cards, A or X turns a card's variant, LB and RB turn the page. B was
  // already spent closing the screen by the tap above this tick.
  if (activeScreen === 'journal') {
    if (journalNav) journalNav.padTick(dt, { b: true });
    return;
  }
  const held = gamepadState.buttons;

  const dx = padMenuDirection(
    dt, padMenuRepeat.x,
    held[PAD_BUTTON.left], held[PAD_BUTTON.right], gpAxis(0)
  );
  const dy = padMenuDirection(
    dt, padMenuRepeat.y,
    held[PAD_BUTTON.up], held[PAD_BUTTON.down], gpAxis(1)
  );

  if (dx) movePadCursor(dx, 0);
  if (dy) movePadCursor(0, dy);
}

/* What a screen is: which one is up, the block it was opened at, and whether
   the mouse was captured when it opened. The inventory owns the rows of slots
   these screens show, and the stack that rides the cursor while one is open;
   these three belong to the screen itself, which is why they sit with the two
   functions that put one up and take it down. */
/** null, 'inventory' (2x2 grid) or 'crafting' (3x3 grid). */
export let activeScreen = null;
/** Furnace position while the furnace screen is open, else null. */
export let activeScreenAt = null;
/** Whether pointer lock was active when the current screen opened. */
let screenHadPointerLock = false;

export function openScreen(kind, at = null) {
  if (kind !== 'inventory' && kind !== 'crafting' && kind !== 'furnace' &&
      kind !== 'chest' && kind !== 'give' && kind !== 'journal') return;

  // A furnace screen only makes sense at a real furnace, so anything pointing
  // at air or a block that has since been broken is turned away here. The
  // chest screen holds to the same rule.
  if (kind === 'furnace') {
    if (!at || !isFurnaceBlock(world.getBlock(at.x, at.y, at.z))) return;
  }
  if (kind === 'chest') {
    if (!at || !isChestBlock(world.getBlock(at.x, at.y, at.z))) return;
  }

  screenHadPointerLock = document.pointerLockElement === canvas;
  if (screenHadPointerLock) document.exitPointerLock();

  activeScreen = kind;
  activeScreenAt = (kind === 'furnace' || kind === 'chest') && at
    ? { x: at.x, y: at.y, z: at.z }
    : null;
  pressedKeys.clear();
  releaseMiningButton();
  releasePadMining();
  resetPadCursor();
  hideMiningFeedback();
  clearTarget();
  overlayEl.classList.add('hidden');
  screenLayer.classList.remove('hidden');
  document.body.classList.add('screen-open');
  if (kind === 'chest') {
    playChestOpenSound(at.x + 0.5, at.y + 0.5, at.z + 0.5);
  } else {
    playUiOpenSound();
  }
  renderScreen();
  updateCursorVisual();
  renderHotbar();
}

export function closeScreen() {
  if (!activeScreen) return;

  // The lid that creaked open deserves a knock on the way out.
  if (activeScreen === 'chest' && activeScreenAt) {
    playChestCloseSound(
      activeScreenAt.x + 0.5, activeScreenAt.y + 0.5, activeScreenAt.z + 0.5
    );
  } else if (!player.dead) {
    playUiCloseSound();
  }

  returnCursorStack();
  activeScreen = null;
  activeScreenAt = null;
  furnaceGauges = null;
  screenLayer.classList.add('hidden');
  document.body.classList.remove('screen-open');
  updateCursorVisual();
  renderHotbar();
  updateTarget();

  if (fallbackControls) {
    overlayEl.classList.add('hidden');
    controlHintEl.classList.remove('hidden');
  } else if (!screenHadPointerLock && gamepadState.active) {
    // Pad play never needs pointer lock, so just resume.
    overlayEl.classList.add('hidden');
  } else {
    requestLock();
  }
}

export function toggleInventory() {
  if (activeScreen) {
    closeScreen();
  } else if (document.pointerLockElement === canvas || fallbackControls ||
      gamepadState.active) {
    openScreen('inventory');
  }
}

/** G opens the debug give shelf, or closes whatever screen is up. */
function toggleGiveScreen() {
  if (activeScreen) {
    closeScreen();
  } else if (document.pointerLockElement === canvas || fallbackControls ||
      gamepadState.active) {
    openScreen('give');
  }
}

/** J opens the journal — recipes, and transmissions when they are kept — or
 *  closes whatever screen is up. */
export function toggleJournal() {
  if (activeScreen) {
    closeScreen();
  } else if (document.pointerLockElement === canvas || fallbackControls ||
      gamepadState.active) {
    openScreen('journal');
  }
}

/**
 * The page owns the debug tour jump, because standing at a monument three
 * hundred blocks away means pulling that ground in under the walker and moving
 * the camera with it, and neither is the HUD's to do. The HUD only knows the
 * key exists and asks for the next stop.
 */
let beaconJumper = null;
export function setBeaconJumper(jump) { beaconJumper = jump; }

/*
 * How much one press of the debug essence key hands out. It is a hundred
 * because the prices are: the far monuments now ask for several hundred each,
 * and a grant of a few at a press would need two hundred presses to test the
 * last one.
 */
const DEBUG_ESSENCE_GRANT = 100;

/**
 * Shift+G grants essence. The give shelf has no tile for it because essence
 * never sits in a slot, so the shelf's own key, shifted, is where handing it
 * out lives.
 */
function grantDebugEssence() {
  const total = grantEssence(DEBUG_ESSENCE_GRANT);
  showToast('+' + DEBUG_ESSENCE_GRANT + ' Essence \u00b7 ' + total);
}

function screenGridFor(container) {
  if (container === 'inventory') return inventory;
  if (container === 'armor') return armorSlots;
  if (container === 'craft2') return craft2;
  if (container === 'craft3') return craft3;
  if (container === 'furnace') {
    const state = activeFurnace();
    return state ? state.slots : null;
  }
  if (container === 'chest') {
    const state = activeChest();
    return state ? state.slots : null;
  }
  return null;
}

/**
 * Shift-click destinations. Inside a furnace screen, smeltables go to the top
 * slot and fuels go to the bottom one, which is what a player reaching for the
 * shift key is trying to do.
 */
function furnaceSlotFor(stack) {
  if (!stack) return -1;
  if (SMELTING_RECIPES.has(stack.id)) return FURNACE_INPUT;
  if (FURNACE_FUELS.has(stack.id)) return FURNACE_FUEL;
  return -1;
}

function quickMoveStack(container, index) {
  const sourceGrid = screenGridFor(container);
  if (!sourceGrid) return;
  const source = sourceGrid[index];
  if (!source) return;

  // Shift-clicking a piece of armour puts it on. Anything that was worn in that
  // slot goes back into the pack, and if the pack is full nothing moves at all.
  const wearInto = equipSlotFor(source);
  if (wearInto >= 0 && container !== 'armor') {
    const worn = armorSlots[wearInto];
    if (worn) {
      if (container === 'inventory') {
        armorSlots[wearInto] = source;
        sourceGrid[index] = worn;
      } else {
        const free = inventory.findIndex((slot) => !slot);
        if (free < 0) {
          showToast('No room in your pack to swap armour');
          return;
        }
        armorSlots[wearInto] = source;
        sourceGrid[index] = null;
        inventory[free] = worn;
      }
    } else {
      armorSlots[wearInto] = source;
      sourceGrid[index] = null;
    }
    if (container === 'furnace' || container === 'chest') markWorldDirty();
    return;
  }

  let targetArray;
  let targetStart;
  let targetEnd;
  let wantedFurnaceSlot = -1;

  if (container === 'furnace' || container === 'chest') {
    targetArray = inventory;
    targetStart = 0;
    targetEnd = INVENTORY_SIZE;
  } else if (container === 'inventory') {
    // Shift-clicking while a chest is open sends the stack into the box,
    // which is what reaching for the shift key means there. Anything the
    // chest cannot swallow stays put rather than trading hotbar rows.
    if (activeScreen === 'chest') {
      const state = activeChest();
      if (state) {
        const rest = mergeStackInto(source, state.slots, 0, CHEST_SLOTS);
        if (rest <= 0) sourceGrid[index] = null;
        else source.count = rest;
        markWorldDirty();
        return;
      }
    }
    wantedFurnaceSlot = activeScreen === 'furnace' ? furnaceSlotFor(source) : -1;
    if (wantedFurnaceSlot >= 0) {
      const state = activeFurnace();
      const rest = mergeStackInto(source, state.slots, wantedFurnaceSlot, wantedFurnaceSlot + 1);
      if (rest <= 0) sourceGrid[index] = null;
      else source.count = rest;
      markWorldDirty();
      return;
    }

    targetArray = inventory;
    if (index < HOTBAR_SIZE) {
      targetStart = HOTBAR_SIZE;
      targetEnd = INVENTORY_SIZE;
    } else {
      targetStart = 0;
      targetEnd = HOTBAR_SIZE;
    }
  } else {
    targetArray = inventory;
    targetStart = 0;
    targetEnd = INVENTORY_SIZE;
  }

  const remaining = mergeStackInto(source, targetArray, targetStart, targetEnd);
  if (remaining <= 0) sourceGrid[index] = null;
  else source.count = remaining;
  if (container === 'furnace' || container === 'chest') markWorldDirty();
}

function handleScreenSlotClick(container, index, button, shift) {
  const grid = screenGridFor(container);
  if (!grid) return;
  if (container === 'furnace') markWorldDirty();
  if (container === 'chest') markWorldDirty();
  if (container === 'armor') markWorldDirty();

  // Shift always quick-moves first, including out of the furnace result slot.
  if (button === 0 && shift) {
    quickMoveStack(container, index);
    renderScreen();
    renderHotbar();
    updateCursorVisual();
    return;
  }

  // The stack the cursor carries as this click begins. The branches below put it
  // down, split it, or trade it for the slot, and each reads it first.
  const held = cursorCarried();

  // A furnace result slot only ever gives items out; pushing one back in would
  // let a player smelt the same ingot forever.
  if (container === 'furnace' && index === FURNACE_OUTPUT) {
    const result = grid[index];
    if (result && !held) {
      if (button === 2) {
        const take = Math.ceil(result.count / 2);
        setCursorStack(makeStack(result.id, take, result.dur, result.contents));
        result.count -= take;
        if (result.count <= 0) grid[index] = null;
      } else {
        setCursorStack(result);
        grid[index] = null;
      }
    }
    renderScreen();
    renderHotbar();
    updateCursorVisual();
    return;
  }

  // An armour slot only takes the matching kind of armour. Dropping a pickaxe
  // on the chestplate slot should do nothing rather than hide it.
  if (container === 'armor' && held && equipSlotFor(held) !== index) {
    return;
  }

  const slot = grid[index];

  if (button === 2) {
    // Right click: split a stack, or place a single item.
    if (held) {
      if (!slot) {
        grid[index] = makeStack(held.id, 1, held.dur, held.contents);
        held.count -= 1;
      } else if (stacksMergeable(slot, held)) {
        const def = ITEMS.get(slot.id);
        if (slot.count < def.stack) {
          slot.count += 1;
          held.count -= 1;
        }
      }
      dropEmptyCursorStack();
    } else if (slot) {
      const take = Math.ceil(slot.count / 2);
      setCursorStack(makeStack(slot.id, take, slot.dur, slot.contents));
      slot.count -= take;
      if (slot.count <= 0) grid[index] = null;
    }
  } else if (held) {
    // Left click while holding a stack: drop, merge, or swap.
    if (!slot) {
      grid[index] = held;
      clearCursorStack();
    } else if (stacksMergeable(slot, held)) {
      const def = ITEMS.get(slot.id);
      const moved = Math.min(held.count, def.stack - slot.count);
      slot.count += moved;
      held.count -= moved;
      dropEmptyCursorStack();
    } else {
      const swapped = slot;
      grid[index] = held;
      setCursorStack(swapped);
    }
  } else if (slot) {
    // Left click with an empty hand: pick up the whole stack.
    setCursorStack(slot);
    grid[index] = null;
  }

  renderScreen();
  renderHotbar();
  updateCursorVisual();
}

export function updateCursorVisual() {
  const held = cursorCarried();
  if (!held) {
    cursorStackEl.classList.add('hidden');
    return;
  }

  cursorStackEl.classList.remove('hidden');
  const itemIcon = ITEM_ICONS.get(held.id);
  cursorIconEl.style.backgroundImage = itemIcon ? 'url("' + itemIcon.url + '")' : '';
  cursorCountEl.textContent = held.count > 1 ? String(held.count) : '';
  cursorStackEl.style.left = cursorX + 'px';
  cursorStackEl.style.top = cursorY + 'px';
}

screenBody.addEventListener('mousedown', (event) => {
  const slotEl = event.target.closest('.inv-slot');
  if (!slotEl || !screenBody.contains(slotEl)) return;
  event.preventDefault();

  const container = slotEl.dataset.container;
  const index = Number(slotEl.dataset.index);
  if (!container) return;

  if (container === 'result') {
    craftCurrent(event.shiftKey && event.button === 0);
    return;
  }

  // The shelf is not a grid the player trades with: a click there only ever
  // adds items to the pack and leaves the hand on the cursor untouched.
  if (container === 'give') {
    giveFromShelf(index, event.button);
    return;
  }

  handleScreenSlotClick(container, index, event.button, event.shiftKey);
});
screenLayer.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('mousemove', (event) => {
  cursorX = event.clientX;
  cursorY = event.clientY;
  if (activeScreen) updateCursorVisual();
});

window.addEventListener('keydown', (event) => {
  // With the menu up, E, G, J and the rest belong to the menu: none of them
  // reaches the game through the start form or the pause panel.
  if (menuOpen()) return;
  // The journal's walker takes the keys it knows first — arrows, WASD, Enter,
  // Q and E for the pages, R for a card's next variant — held arrows included.
  // J and Esc fall through and close it like any screen.
  if (activeScreen === 'journal' && journalNav && journalNav.handleKey(event)) return;
  if (event.repeat) return;

  const isInventoryKey = event.code === 'KeyE' ||
    (event.key && event.key.toLowerCase() === 'e');
  const isGiveKey = event.code === 'KeyG' ||
    (event.key && event.key.toLowerCase() === 'g');
  const isJournalKey = event.code === 'KeyJ' ||
    (event.key && event.key.toLowerCase() === 'j');
  // The shelf and the tour are debug tools: without ?debug the keys are
  // nobody's, and fall through like any other letter.
  const isTourKey = debugEnabled && (event.code === 'KeyB' ||
    (event.key && event.key.toLowerCase() === 'b'));
  const isEscape = event.code === 'Escape' || event.key === 'Escape';

  if (isInventoryKey) {
    event.preventDefault();
    toggleInventory();
  } else if (isGiveKey && debugEnabled) {
    event.preventDefault();
    // Shift+G is the shelf's own key shifted: it hands out essence, which has
    // no shelf tile because it never sits in a slot.
    if (event.shiftKey) grantDebugEssence();
    else toggleGiveScreen();
  } else if (isJournalKey) {
    event.preventDefault();
    toggleJournal();
  } else if (isTourKey) {
    event.preventDefault();
    // B walks the debug tour one stop forward — SP0, then the five monuments,
    // then home — and Shift+B walks it back. Only while the walker is standing
    // in the world with no screen up, so the key cannot fire through the start
    // overlay, the pause panel or the give shelf.
    if (beaconJumper && !activeScreen && !player.dead &&
        (document.pointerLockElement === canvas || fallbackControls ||
        gamepadState.active)) {
      beaconJumper(event.shiftKey ? -1 : 1);
    }
  } else if (isEscape && activeScreen) {
    event.preventDefault();
    closeScreen();
  } else if (isEscape && transmissionIsUp()) {
    // The transmitter is still talking over the world, so this Esc is spent on
    // the panel; the pause menu, if there is one to open, waits for the next.
    event.preventDefault();
    dismissTransmission();
  } else if (isEscape && fallbackControls && !player.dead &&
      overlayEl.classList.contains('hidden')) {
    // No pointer lock to release in fallback mode, so Esc opens the pause menu.
    event.preventDefault();
    overlayEl.classList.remove('hidden');
  }
});

export function selectHotbarSlot(index, announce = false) {
  if (selectSlot(index)) playUiClickSound();
  hotbarSlots.forEach((slot, i) => slot.classList.toggle('selected', i === currentSlot()));

  if (announce) {
    const stack = inventory[currentSlot()];
    if (stack) {
      const item = ITEMS.get(stack.id);
      showToast(item ? item.name : stack.id);
    }
  }
}

export function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1400);
}

/* A transmission is not a toast: it is the transmitter talking, several lines
   long, arriving a sentence at a time because the line is bad. The panel sits
   above the hotbar and stays there: the walker is meant to be able to read the
   whole of it, even the part that lands while they are running, so nothing
   unspeaks it on a timer. The player ends it — Esc, or B on the pad — and a
   newer transmission supersedes an older one mid-sentence, the token being what
   drops the lines of the old one that had not landed yet.

   The line is dialled before it is spoken: three womps of carrier and a burst of
   modem over the connect line, and only then does the transmitter start typing.
   The words come one keystroke at a time, slow and with the keys audible, so the
   panel reads as somebody at a keyboard at the far end rather than a caption. */

/** How long a keystroke takes, and how much it varies. Deliberately slow: the
   transmitter is working a machine, not thinking at the speed of the page. */
const TRANSMISSION_CHAR_MS = 26;
const TRANSMISSION_CHAR_JITTER_MS = 22;
/** The breath taken after a full stop, and between one line and the next. */
const TRANSMISSION_STOP_MS = 240;
const TRANSMISSION_LINE_MS = 900;
let transmissionToken = 0;

/* The page sometimes needs to know the transmitter has stopped talking: the
   arrival sequence, for one, waits for the line to be spoken — or closed —
   before its song starts. The finisher answers once per transmission, when
   the last line has been typed out or the walker has shut the panel, and
   never for a transmission that a newer one has already replaced. */
let transmissionFinisher = null;
export function setTransmissionFinisher(finisher) {
  transmissionFinisher = finisher || null;
}

function finishTransmission(token) {
  if (token !== transmissionToken || !transmissionFinisher) return;
  transmissionFinisher();
}

export function showTransmission(lines) {
  const token = ++transmissionToken;
  let linesLeft = lines.length;
  transmissionEl.innerHTML = '';
  const from = document.createElement('div');
  from.className = 'transmission-from';
  from.textContent = 'Dialing \u2014 carrier only';
  /* A spinner while there is only a carrier tone: the panel would otherwise be
     one line of text floating over nothing, which reads as a caption rather
     than as a machine working. It is a child of the connect line, so writing
     that line's text out again is also what stops it. */
  const spinner = document.createElement('span');
  spinner.className = 'transmission-spinner';
  from.append(spinner);
  const said = document.createElement('div');
  said.className = 'transmission-lines';
  const waiting = document.createElement('div');
  waiting.className = 'transmission-waiting';
  waiting.textContent = '\u00b7 \u00b7 \u00b7';
  said.append(waiting);
  const hint = document.createElement('div');
  hint.className = 'transmission-hint';
  hint.textContent = 'Esc or B closes';
  transmissionEl.append(from, said, hint);
  transmissionEl.classList.add('active');
  playTransmissionHandshakeSound();

  window.setTimeout(() => {
    if (token !== transmissionToken) return;
    // The line is up: the spinner goes with the dialing words, and the waiting
    // dots go with them both, because the transmitter is at the keyboard now.
    from.textContent = 'Connected 14.4k \u2014 the line is spotty';
    waiting.remove();
  }, TRANSMISSION_HANDSHAKE_MS);

  let at = TRANSMISSION_HANDSHAKE_MS;
  for (const line of lines) {
    // Spotted and cut into keystrokes once, up here, so the breath allotted to
    // the next line is the breath the words actually spoken will take.
    const spoken = transmissionClusters(spotTransmissionLine(line));
    window.setTimeout(() => {
      if (token !== transmissionToken) return;
      typeTransmissionLine(said, spoken, token, () => {
        linesLeft--;
        if (linesLeft === 0) finishTransmission(token);
      });
    }, at);
    at += TRANSMISSION_LINE_MS +
      spoken.length * (TRANSMISSION_CHAR_MS + TRANSMISSION_CHAR_JITTER_MS / 2);
  }
}

/* One keystroke per thing a reader sees, not per slot in the string. The
   transmitter signs some lines with an emoji, and an emoji is two halves of one
   character in a JavaScript string: typed a half at a time, each half lands as a
   box of noise that has nothing to do with the line being bad. So a line is cut
   into clusters before it is typed — a grapheme cluster where the page can name
   one, which also keeps an emoji with a skin tone or a variation selector to
   itself, and a whole code point where it cannot. */
const clusterReader = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'grapheme' })
  : null;

function transmissionClusters(line) {
  if (clusterReader) return Array.from(clusterReader.segment(line), (part) => part.segment);
  return Array.from(line);
}

/**
 * The line noise that makes a transmission spotty: some of the words arrive
 * with one letter lost and a printable character in its place. Never more than
 * one per word, never in a word too short to survive losing one, never at the
 * start or the end of it — a word keeps its first and last letter and a reader
 * still holds its shape. The swap keeps the line exactly as long as it was, so
 * nothing re-wraps halfway through being typed.
 *
 * It also only ever looks at runs of plain letters, which is what keeps the
 * emoji whole: the noise has no way to reach one, let alone bite a piece out of
 * it, so the sender's feelings arrive exactly as sent even on a bad line.
 */
const TRANSMISSION_GLITCH_CHARS = '#%&*+?@~^$![]{}=<>|/';
const TRANSMISSION_GLITCH_ODDS = 0.18;
const TRANSMISSION_GLITCH_MAX_PER_LINE = 3;

function spotTransmissionLine(line) {
  let lost = 0;
  return line.replace(/[A-Za-z]{4,}/g, (word) => {
    if (lost >= TRANSMISSION_GLITCH_MAX_PER_LINE) return word;
    if (Math.random() >= TRANSMISSION_GLITCH_ODDS) return word;
    lost++;
    const at = 1 + ((Math.random() * (word.length - 2)) | 0);
    const noise = TRANSMISSION_GLITCH_CHARS[(Math.random() * TRANSMISSION_GLITCH_CHARS.length) | 0];
    return word.slice(0, at) + noise + word.slice(at + 1);
  });
}

/**
 * Types one line into the panel, a keystroke at a time, until the transmission
 * it belongs to is superseded or closed. The line arrives already cut into
 * clusters, so an emoji is one keystroke and one click like any other letter.
 * Spaces are silent — nothing clicks when the thumb hits the space bar — and a
 * full stop costs the typist a beat.
 */
function typeTransmissionLine(said, clusters, token, done) {
  const p = document.createElement('p');
  const caret = document.createElement('span');
  caret.className = 'transmission-caret';
  caret.textContent = '\u258b';
  p.append(caret);
  said.append(p);

  let i = 0;
  const keystroke = () => {
    if (token !== transmissionToken) return;
    if (i >= clusters.length) {
      caret.remove();
      if (done) done();
      return;
    }
    const char = clusters[i++];
    caret.before(document.createTextNode(char));
    if (char !== ' ') playKeyClickSound();
    let wait = TRANSMISSION_CHAR_MS + Math.random() * TRANSMISSION_CHAR_JITTER_MS;
    if ('.!?'.includes(char)) wait += TRANSMISSION_STOP_MS;
    window.setTimeout(keystroke, wait);
  };
  keystroke();
}

/** Whether the transmitter is still talking on the page. */
export function transmissionIsUp() {
  return transmissionEl.classList.contains('active');
}

/**
 * Esc, or B on the pad: the walker has read it, and the panel leaves. The words
 * stay where they are so the panel fades out instead of blanking itself, and the
 * token is what stops the lines that had not landed yet. Answers whether there
 * was anything to close, so whoever asked knows whether the press was spent.
 */
export function dismissTransmission() {
  if (!transmissionIsUp()) return false;
  transmissionToken++;
  transmissionEl.classList.remove('active');
  // Closing the panel is the walker saying they have read it: the line is
  // finished, half-typed words and all, and whoever is waiting on the
  // transmission hears that now rather than never.
  finishTransmission(transmissionToken);
  return true;
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyM' || event.repeat) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (menuOpen()) return;
  event.preventDefault();
  showToast(toggleAudioMuted());
});

window.addEventListener('keydown', (event) => {
  if (activeScreen || menuOpen()) return;
  const digit = /^Digit([1-9])$/.exec(event.code) || /^([1-9])$/.exec(event.key || '');
  if (digit) {
    selectHotbarSlot(Number(digit[1]) - 1, true);
    return;
  }

  // Time only stops behind a screen or the menu now; the brackets that push it
  // about are a debug tool.
  if (debugEnabled && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
    const delta = event.code === 'BracketLeft' ? -0.02 : 0.02;
    nudgeDayTime(delta);
    applyDayNight();
    updateDebug();
  }
});

window.addEventListener('wheel', (event) => {
  if (activeScreen || menuOpen()) return;
  if (document.pointerLockElement !== canvas && !fallbackControls) return;
  selectHotbarSlot(currentSlot() + (event.deltaY > 0 ? 1 : -1), true);
}, { passive: true });

/* The frame rate the readout prints. The loop hands over every frame's length
   and this does the averaging, so the number is the pace of the last half
   second rather than the twitch of one frame — and the hud, which is the only
   thing that shows it, is the only thing that counts it. */
export let fps = 0;
let fpsFrames = 0;
let fpsWindow = 0;

/** Counts a frame; true once the window is full and `fps` says something new. */
export function sampleFrameRate(seconds) {
  fpsFrames++;
  fpsWindow += seconds;
  if (fpsWindow < 0.5) return false;
  fps = Math.round(fpsFrames / fpsWindow);
  fpsFrames = 0;
  fpsWindow = 0;
  return true;
}

/* The readout. The day dial and the frame rate are the player's; the position
   and the chunk line are the builder's and only show with ?debug. */
debugEl.classList.toggle('hidden', !debugEnabled);
fpsEl.classList.toggle('hidden', !fpsShown());
onSettingsChanged(() => {
  fpsEl.classList.toggle('hidden', !fpsShown());
  updateDebug();
});

let dialAngle = null;
let dialLabel = '';

/**
 * The day dial: a disc, half day and half night, turned so the hour now sits
 * under the notch at the top. Noon puts the sun's middle there and midnight
 * the moon's; dawn and dusk are where the two halves meet.
 */
function paintDayDial() {
  const angle = Math.round((clockHours() / 24) * 360 * 2) / 2;
  if (angle !== dialAngle) {
    dialAngle = angle;
    // The face is drawn with noon at the top, so the turn is measured from
    // noon: half a turn at midnight, a quarter either way at dawn and dusk.
    dayDialFaceEl.style.transform = 'rotate(' + (180 - angle) + 'deg)';
  }
  const label = formatClock() + ' · ' + (isNight() ? 'Night' : 'Day');
  if (label !== dialLabel) {
    dialLabel = label;
    dayDialEl.title = label;
    dayDialEl.setAttribute('aria-label', label);
    dayDialEl.classList.toggle('night', isNight());
  }
}

export function updateDebug() {
  paintDayDial();
  if (fpsShown()) fpsEl.textContent = 'FPS ' + fps;
  if (!debugEnabled) return;
  const pos = camera.position;
  const cx = Math.floor(pos.x / CHUNK_SIZE);
  const cz = Math.floor(pos.z / CHUNK_SIZE);
  coordsEl.textContent =
    'XYZ ' + pos.x.toFixed(1) + ' / ' + pos.y.toFixed(1) + ' / ' + pos.z.toFixed(1);
  chunklineEl.textContent =
    'Chunk ' + cx + ', ' + cz + ' · ' + world.chunks.size + ' loaded · ' +
    mobs.length + ' mobs · ' + renderer.info.render.triangles + ' tris';
}

/* ---------- The waypoint arrow ---------- */

let waypointShown = false;
let waypointAngle = null;
let waypointText = '';
let waypointDistance = '';

/**
 * Points the arrow at `target` from `pos`, for a walker facing `yaw`. Up on
 * the screen is straight ahead. Yaw follows the camera's convention: facing
 * the point (dx, dz) away is yaw = atan2(-dx, -dz), and a larger yaw has turned
 * the walker to the left, so the arrow turns the other way.
 *
 * The page is only written when something it shows has moved, because this
 * runs every frame.
 */
export function paintWaypoint(target, pos, yaw) {
  const show = !!target && !activeScreen && !player.dead;
  if (show !== waypointShown) {
    waypointShown = show;
    waypointEl.classList.toggle('hidden', !show);
  }
  if (!show) return;

  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const dy = target.y - pos.y;
  const flat = Math.hypot(dx, dz);
  let turn = 0;
  if (flat > 0.5) {
    const targetYaw = Math.atan2(-dx, -dz);
    turn = yaw - targetYaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  }
  const degrees = Math.round(turn * 180 / Math.PI);
  if (degrees !== waypointAngle) {
    waypointAngle = degrees;
    waypointArrowEl.style.transform = 'rotate(' + degrees + 'deg)';
  }
  waypointEl.classList.toggle('here', flat <= 2.5);

  if (target.label !== waypointText) {
    waypointText = target.label;
    waypointLabelEl.textContent = target.label;
  }
  const rise = Math.abs(dy) > 4 ? (dy > 0 ? ' ▲' : ' ▼') : '';
  const distance = Math.round(Math.hypot(flat, dy)) + ' m' + rise;
  if (distance !== waypointDistance) {
    waypointDistance = distance;
    waypointDistanceEl.textContent = distance;
  }
}

/* ---------- The threat line ---------- */

/* One name per whole step of difficulty, SP0's calm out to the capped edge. */
const THREAT_NAMES = ['Calm', 'Uneasy', 'Wary', 'Hostile', 'Perilous', 'Deadly', 'Lethal'];

const threatEl = document.getElementById('threat');
const threatLabelEl = threatEl.querySelector('.threat-label');
const threatPipsEl = threatEl.querySelector('.threat-pips');
for (let i = 0; i < DIFFICULTY_MAX; i++) {
  threatPipsEl.appendChild(document.createElement('i'));
}

let threatShown = false;
let threatTier = -1;
let threatTitle = '';

/**
 * Names how hard the ground underfoot makes its creatures: the same
 * difficulty the mobs are bred with, so depth below sea level counts too.
 * The name and the pips move in whole steps; hovering gives the tenth.
 * Like the arrow, it stands aside while a screen is open or the walker is down,
 * and it only writes the page when something it shows has changed.
 */
export function paintThreat(difficulty) {
  const show = !activeScreen && !player.dead && Number.isFinite(difficulty);
  if (show !== threatShown) {
    threatShown = show;
    threatEl.classList.toggle('hidden', !show);
  }
  if (!show) return;

  const level = clamp(difficulty, 0, DIFFICULTY_MAX);
  const tier = Math.min(THREAT_NAMES.length - 1, Math.floor(level));
  if (tier !== threatTier) {
    threatEl.classList.remove('threat-' + threatTier);
    threatTier = tier;
    threatEl.classList.add('threat-' + tier);
    threatLabelEl.textContent = 'Threat: ' + THREAT_NAMES[tier];
    const pips = threatPipsEl.children;
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('lit', i < tier);
  }
  const title = 'Threat: ' + THREAT_NAMES[tier] + ' (' + level.toFixed(1) + ' of ' + DIFFICULTY_MAX + ')';
  if (title !== threatTitle) {
    threatTitle = title;
    threatEl.title = title;
    threatEl.setAttribute('aria-label', title);
  }
}
