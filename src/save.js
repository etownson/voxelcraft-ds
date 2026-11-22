/*
 * What the browser keeps: the world as a diff of only the blocks the player has
 * changed, plus the walk, the pack, the worn row, the held slot, the hour and the
 * spawn that turn that diff back into someone's afternoon. localStorage is written
 * synchronously, so the save fired as a tab hides always lands.
 *
 * A write reports itself rather than painting anyone: `onSaveWritten` takes
 * whoever wants to know, and `saveReport` answers for when it happened, how big
 * it came out, and whether storage refused. `setSaveSpawn` is handed the same
 * record a bed moves mid-session, because the save copies the spawn out but does
 * not own it, and a wipe asks for `stopAutosave` instead of reaching for a flag.
 *
 * Reading a save back is here, as far as a saved record reaches: the walk, the
 * look, the body's two counters and the worn row come out of it. What happens
 * after the numbers are written is not: whether the saved cell turns out to be
 * inside a tree, who makes the chunks around it, who catches the camera's glide
 * up and who repaints the two bars. Those four verbs arrive through
 * `setSaveArrival`, and the bars come through the painters the body and the pack
 * already keep, so a load that nothing is registered with still restores and
 * simply starts where the world says the player should be.
 */

import {
  ARMOR_SLOTS, BLOCKS, CHEST_SLOTS, ITEMS, createBlockEntity, isChestBlock, isFurnaceBlock,
  makeStack
} from './blocks.js';
import { clearWorldDirty, world } from './chunks.js';
import { playerCollidesAt } from './collision.js';
import {
  CHUNK_SIZE, EXHAUSTION_THRESHOLD, HUNGER_MAX, SATURATION_ON_RESPAWN, WORLD_HEIGHT,
  WORLD_SEED, clamp
} from './config.js';
import { syncHeldAngles } from './held.js';
import { INVENTORY_SIZE, armorSlots, currentSlot, inventory, paintArmorBar } from './inventory.js';
import { applyLook, paintHealth, paintHunger, player, restorePlayerLook, view } from './player.js';
import { dayTime } from './sky.js';

/**
 * The world is saved as a diff: only blocks the player has changed are stored,
 * as flat [blockIndex, blockId] pairs per chunk key. Player position, health,
 * inventory, selected slot and time of day ride along. localStorage keeps the
 * write synchronous, so the save fired on page hide is guaranteed to land.
 *
 * Schema 2 added the `dur` third element to inventory slots (tools and armour
 * now wear out). Schema 3 adds furnaces with their contents, plus the raw iron,
 * iron ingots, charcoal, glass and farmland that come with them. Schema 4 adds
 * saturation next to food: it is the counter exhaustion spends first, it has no
 * honest default for a stomach already half empty, and a whole world of food
 * values changes underneath it, so schema 3 saves are no longer readable.
 */
export const SAVE_KEY = 'voxelcraft:world:v4';
export const LEGACY_SAVE_KEYS = ['voxelcraft:world:v1', 'voxelcraft:world:v2', 'voxelcraft:world:v3'];
export const SAVE_SCHEMA = 4;
const AUTOSAVE_SECONDS = 25;

let lastSaveAt = 0;
let lastSaveBytes = 0;
let lastSaveError = null;
let saveDisabled = false;
let autosaveTimer = AUTOSAVE_SECONDS;
let saveNotice = null;
let saveSpawn = null;

/* What a save is worth telling anyone about: when the world now loaded was
   written, how big it was, whether it went wrong, and whether anything is still
   trying. Everything that changes those prospects is down here; the loop and
   the debug hook say what they have done rather than writing it themselves. */

/** The world that is loaded now was written at `at`, or never was. */
export function rememberSavedWorld(at) { lastSaveAt = at; }

/** A write was asked for, which re-arms the autosave a wipe turned off. */
export function resumeAutosave() { saveDisabled = false; }

/** A wipe ends the run: the unload hooks must not write the erased world back. */
export function stopAutosave() { saveDisabled = true; }

/** Whoever cares that a write landed or failed. The pause panel's row does. */
export function onSaveWritten(notice) { saveNotice = notice; }

/** Where the world claims its walker belongs. A bed moves it mid-session. */
export function setSaveSpawn(spawn) { saveSpawn = spawn; }

/** Everything the row and the debug hook are allowed to know about a write. */
export function saveReport() {
  return { at: lastSaveAt, bytes: lastSaveBytes, error: lastSaveError };
}

/**
 * There is no save any more. Stops the loop writing the world straight back
 * over the top of the wipe, and clears every last trace of the one that went:
 * the pause panel would otherwise still be reporting a world nobody has.
 */
export function forgetSavedWorld() {
  saveDisabled = true;
  clearWorldDirty();
  lastSaveAt = 0;
  lastSaveBytes = 0;
  lastSaveError = null;
}

function serializeWorldSave() {
  const edits = {};
  for (const [key, map] of world.overridesByChunk) {
    if (!map.size) continue;
    const flat = [];
    for (const [index, id] of map) flat.push(index, id);
    edits[key] = flat;
  }
  return {
    v: SAVE_SCHEMA,
    seed: WORLD_SEED,
    savedAt: Date.now(),
    player: {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z,
      yaw: view.yaw,
      pitch: view.pitch,
      health: player.health,
      hunger: player.hunger,
      saturation: Number(player.saturation.toFixed(3)),
      exhaustion: Number(player.exhaustion.toFixed(3))
    },
    slot: currentSlot(),
    time: dayTime,
    // Where a bed last claimed the player, if anywhere: the respawn point
    // outlives both the session and the bed that set it.
    spawn: { x: saveSpawn.x, z: saveSpawn.z },
    inventory: inventory.map((slot) => stackRecord(slot)),
    armour: armorSlots.map((slot) => stackRecord(slot)),
    entities: serializeBlockEntities(),
    edits
  };
}

/**
 * Furnace and chest contents plus block orientations ride along with the block
 * diff, as flat records: [x, y, z, input id, input count, fuel id, fuel count,
 * output id, output count, burn, burn total, cook], [x, y, z, then twenty-seven
 * id and count pairs] and [x, y, z, dx, dz].
 */
function serializeBlockEntities() {
  const furnaces = [];
  const chests = [];
  const facings = [];

  for (const [key, state] of world.blockEntities) {
    if (state.kind !== 'furnace' && state.kind !== 'chest') continue;
    const at = key.split(',');
    const row = [Number(at[0]), Number(at[1]), Number(at[2])];
    for (const slot of state.slots) {
      row.push(slot ? slot.id : null, slot ? slot.count : null);
    }
    if (state.kind !== 'furnace') {
      chests.push(row);
      continue;
    }
    row.push(
      Math.round(state.burnTime * 10) / 10,
      Math.round(state.burnTotal * 10) / 10,
      Math.round(state.cookTime * 10) / 10
    );
    furnaces.push(row);
  }

  for (const [key, normal] of world.facings) {
    const at = key.split(',');
    facings.push(Number(at[0]), Number(at[1]), Number(at[2]), normal[0], normal[1]);
  }

  if (!furnaces.length && !chests.length && !facings.length) return null;
  return { furnaces, chests, facings };
}

export function saveWorld() {
  if (saveDisabled) return false;
  try {
    const json = JSON.stringify(serializeWorldSave());
    localStorage.setItem(SAVE_KEY, json);
    lastSaveAt = Date.now();
    lastSaveBytes = new Blob([json]).size;
    lastSaveError = null;
    clearWorldDirty();
    if (saveNotice) saveNotice();
    return true;
  } catch (err) {
    lastSaveError = err && err.name === 'QuotaExceededError'
      ? 'Saved world too large for browser storage'
      : 'Browser storage unavailable';
    console.warn('World save failed:', err);
    if (saveNotice) saveNotice();
    return false;
  }
}

/** Reads and validates the stored save, or returns null when absent or stale. */
export function readSavedWorld() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch (err) {
    console.warn('World save is unreadable:', err);
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || data.v !== SAVE_SCHEMA || data.seed !== WORLD_SEED) return null;
    return data;
  } catch (err) {
    console.warn('Discarding corrupt world save:', err);
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (unavailable) {}
    return null;
  }
}

export function applySavedEdits(world, save) {
  if (!save.edits || typeof save.edits !== 'object') return;
  const maxIndex = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
  for (const key in save.edits) {
    const flat = save.edits[key];
    if (!Array.isArray(flat)) continue;
    const comma = key.indexOf(',');
    if (comma < 0) continue;
    const cx = Number(key.slice(0, comma));
    const cz = Number(key.slice(comma + 1));
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const index = Math.trunc(Number(flat[i]));
      const id = Math.trunc(Number(flat[i + 1]));
      if (index < 0 || index >= maxIndex) continue;
      if (id < 0 || id >= BLOCKS.length) continue;
      world.loadSavedOverride(cx, cz, index, id);
    }
  }
}

export function applySavedBlockEntities(world, save) {
  const entities = save.entities;
  if (!entities || typeof entities !== 'object') return;

  if (Array.isArray(entities.furnaces)) {
    for (const row of entities.furnaces) {
      if (!Array.isArray(row) || row.length < 9) continue;
      const x = Math.trunc(Number(row[0]));
      const y = Math.trunc(Number(row[1]));
      const z = Math.trunc(Number(row[2]));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (y < 0 || y >= WORLD_HEIGHT) continue;
      // Blocks are not loaded yet at load time, so the saved diff is what says
      // whether a furnace really still stands here.
      const savedId = world.overrides.get(x + ',' + y + ',' + z);
      if (savedId === undefined || !isFurnaceBlock(savedId)) continue;

      const state = createBlockEntity('furnace');
      for (let slot = 0; slot < 3; slot++) {
        const id = row[3 + slot * 2];
        const count = Math.trunc(Number(row[4 + slot * 2]) || 0);
        if (typeof id !== 'string' || !ITEMS.has(id) || count <= 0) continue;
        state.slots[slot] = makeStack(id, Math.min(count, ITEMS.get(id).stack));
      }
      state.burnTime = Math.max(0, Number(row[9]) || 0);
      state.burnTotal = Math.max(0, Number(row[10]) || 0);
      state.cookTime = Math.max(0, Number(row[11]) || 0);
      world.blockEntities.set(x + ',' + y + ',' + z, state);
    }
  }

  if (Array.isArray(entities.chests)) {
    for (const row of entities.chests) {
      if (!Array.isArray(row) || row.length < 3 + CHEST_SLOTS * 2) continue;
      const x = Math.trunc(Number(row[0]));
      const y = Math.trunc(Number(row[1]));
      const z = Math.trunc(Number(row[2]));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (y < 0 || y >= WORLD_HEIGHT) continue;
      // Same reason as the furnace above: the saved diff is the only witness
      // that a chest still stands at this position when the record is read.
      const savedId = world.overrides.get(x + ',' + y + ',' + z);
      if (savedId === undefined || !isChestBlock(savedId)) continue;

      const state = createBlockEntity('chest');
      for (let slot = 0; slot < CHEST_SLOTS; slot++) {
        const id = row[3 + slot * 2];
        const count = Math.trunc(Number(row[4 + slot * 2]) || 0);
        if (typeof id !== 'string' || !ITEMS.has(id) || count <= 0) continue;
        state.slots[slot] = makeStack(id, Math.min(count, ITEMS.get(id).stack));
      }
      world.blockEntities.set(x + ',' + y + ',' + z, state);
    }
  }

  const facings = entities.facings;
  if (Array.isArray(facings)) {
    for (let i = 0; i + 4 < facings.length; i += 5) {
      const x = Math.trunc(Number(facings[i]));
      const y = Math.trunc(Number(facings[i + 1]));
      const z = Math.trunc(Number(facings[i + 2]));
      const dx = Math.trunc(Number(facings[i + 3])) || 0;
      const dz = Math.trunc(Number(facings[i + 4])) || 0;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const blockId = world.overrides.get(x + ',' + y + ',' + z);
      const block = blockId === undefined ? null : BLOCKS[blockId];
      if (!block || !block.facings) continue;
      world.facings.set(x + ',' + y + ',' + z, [dx, dz]);
    }
  }
}

/** A saved stack as a compact record: [id, count] plus durability if it has any. */
function stackRecord(stack) {
  if (!stack) return null;
  return stack.dur == null
    ? [stack.id, stack.count]
    : [stack.id, stack.count, stack.dur];
}

/** Reads one saved record back into a stack, or null if it no longer exists. */
export function stackFromRecord(record) {
  if (!Array.isArray(record) || !ITEMS.has(record[0])) return null;
  const count = Math.trunc(Number(record[1]) || 0);
  if (count <= 0) return null;
  const def = ITEMS.get(record[0]);
  const stack = makeStack(record[0], Math.min(count, def.stack));
  if (def.durability && record[2] != null) {
    stack.dur = clamp(Math.trunc(Number(record[2]) || 0), 0, def.durability);
  }
  return stack;
}

export function restoreSavedInventory(save) {
  if (!Array.isArray(save.inventory)) return;
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const restored = stackFromRecord(save.inventory[i]);
    if (restored) inventory[i] = restored;
  }
}

export function formatSavedAt(timestamp) {
  if (!timestamp) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return seconds + 's ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + ' h ago';
  return new Date(timestamp).toLocaleDateString();
}

/** True when an unreadable older-schema world is still sitting in storage. */
export function hasLegacySave() {
  try {
    return LEGACY_SAVE_KEYS.some((key) => localStorage.getItem(key) != null);
  } catch (unavailable) {
    return false;
  }
}

/** True when this build has written its own world yet, readable or not. */
export function hasCurrentSave() {
  try {
    return localStorage.getItem(SAVE_KEY) != null;
  } catch (unavailable) {
    return false;
  }
}

export function updateSaveLoop(dt) {
  autosaveTimer -= dt;
  if (autosaveTimer > 0) return;
  autosaveTimer = AUTOSAVE_SECONDS;
  saveWorld();
}

/* Putting a saved body back into a world that has not been built yet is nobody
   in the save's business to know: which chunks to make before anything around the
   player can be trusted, what height to fall to when the saved cell turns out to
   be inside solid ground, how the camera's glide is caught up, and where the view
   is set. Whoever is walking the player hands all four over at bootstrap. Until
   they do, a save still loads its edits, its furnaces and its pack, and the
   player simply starts where the world says they should. */
const saveArrival = {
  makeChunks: () => {},
  groundUnder: () => 0,
  resetStep: () => {},
  placeCamera: () => {}
};

export function setSaveArrival(coming) { Object.assign(saveArrival, coming); }

export function restoreSavedPlayer(save) {
  const p = save.player;
  if (!p) return false;
  player.pos.set(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
  player.vel.set(0, 0, 0);
  player.onGround = false;
  // Wherever the view was left mid-glide, the world it was gliding over is gone.
  saveArrival.resetStep();
  // Nothing around a restored position exists yet, so nothing can be trusted
  // until its chunks are made: an older build could write the player into solid
  // ground, and a read that sees only air would keep them buried there.
  saveArrival.makeChunks();
  if (playerCollidesAt(player.pos.x, player.pos.y, player.pos.z)) {
    player.pos.y = saveArrival.groundUnder(Math.floor(player.pos.x), Math.floor(player.pos.z));
    player.onGround = true;
  }
  restorePlayerLook(p);
  player.health = clamp(Number(p.health) || player.maxHealth, 1, player.maxHealth);
  player.hunger = clamp(Number(p.hunger ?? HUNGER_MAX), 0, HUNGER_MAX);
  // Saturation rides along from schema 4. A missing value cannot survive the
  // schema check, so the fallback is Minecraft's own starting cushion rather
  // than nothing, and both counters are pulled back inside their invariants:
  // saturation never sits above the food it cushions, and exhaustion never
  // reaches the point where it would spend a bite the instant the world loads.
  player.saturation = clamp(Number(p.saturation ?? SATURATION_ON_RESPAWN), 0, player.hunger);
  player.exhaustion = clamp(Number(p.exhaustion) || 0, 0, EXHAUSTION_THRESHOLD);
  // A counter that has already reached a whole bite cannot be trusted: it would
  // spend a point the instant the world opened, so it starts over instead.
  if (player.exhaustion >= EXHAUSTION_THRESHOLD) player.exhaustion = 0;
  // Both bars are repainted here rather than left to the world's first frame:
  // the pictures were drawn when the page was still holding a whole, fed player,
  // and a save is allowed to hold a wounded one.
  paintHealth();
  paintHunger();
  applyLook();
  saveArrival.placeCamera();
  syncHeldAngles(view.yaw, view.pitch);
  return true;
}

/**
 * Worn armour, put back only if it is still the right kind of armour for the
 * slot it is stored in.
 */
export function restoreSavedArmour(save) {
  if (!Array.isArray(save.armour)) return;
  for (let i = 0; i < armorSlots.length; i++) {
    const restored = stackFromRecord(save.armour[i]);
    if (!restored) continue;
    const item = ITEMS.get(restored.id);
    if (item.kind !== 'armor' || item.armorSlot !== ARMOR_SLOTS[i]) continue;
    armorSlots[i] = restored;
  }
  paintArmorBar();
}
