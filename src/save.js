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
  BURN_SECONDS, CHUNK_SIZE, EXHAUSTION_THRESHOLD, HUNGER_MAX, SATURATION_ON_RESPAWN, WORLD_HEIGHT,
  WORLD_SEED, clamp
} from './config.js';
import { beaconsActivatedCount, restoreBeaconProgress, setSpawnPoint0, spawnPoint } from './beacons.js';
import { essenceCount, setEssence } from './essence.js';
import { syncHeldAngles } from './held.js';
import { INVENTORY_SIZE, armorSlots, currentSlot, inventory, paintArmorBar } from './inventory.js';
import { applyLook, paintHealth, paintHunger, player, restorePlayerLook, view } from './player.js';
import { dayTime } from './sky.js';
import { DEFAULT_WORLD_ID, activeWorld, registerWorldKey, worldKey } from './worlds.js';

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
 * Schema 5 adds the essence the walker carries: a running total that belongs
 * to nobody else's record, so a schema 4 world has none and is no longer
 * readable. Schema 6 adds the mission: SP0, the column the walker first landed
 * on, and how many beacons have been lit. The monuments and the difficulty of
 * the ground are both measured from SP0, and it has no default a mismatched
 * one could survive — a world whose SP0 moved would be a different world with
 * the same save in it. Schema 7 adds the packed chest: a stack record may carry
 * a fourth element, the packed chest's slots, each a record of its own, and a
 * chest row may end in a map from slot index to the full record of any slot
 * whose wear or contents the id and count pairs cannot hold. Before it a chest
 * forgot the wear on the tools stored in it, so a schema 6 world is no longer
 * readable.
 *
 * Wall torches ride schema 7 without a bump: a torch on a wall is a facings
 * row like a ladder's, and a torch with no row stands upright, which is how
 * every torch in a save written before them reads.
 *
 * Lava and obsidian ride schema 7 too: they are new block ids (55 to 62) and
 * nothing else, so a save written before them holds none and reads exactly as
 * it did. The lava bucket is a new item id on the same terms, and the player's
 * `fire`, the seconds left to burn, is written only while it is above zero, so
 * a save without it is a player who is not on fire.
 *
 * Co-op adds no field to this schema. A guest in someone else's world never
 * writes SAVE_KEY: its own walk, pack, purse and spawn go under a key of their
 * own, `voxelcraft:coop:<room code>`, in the same record shape minus the world
 * (no `edits`, no `entities`), because the world is the host's to keep. That
 * record is read only by a guest rejoining the same room.
 *
 * Worlds add no field either. The first world a browser had, `default`, keeps
 * its record under SAVE_KEY exactly as before; every other world keeps the
 * same record under `SAVE_KEY + ':' + its id` (`worldKey` in worlds.js), with
 * its own seed in `seed`. A save written before worlds is the default world's
 * and reads exactly as it did. A world downloaded as a file is this same
 * record, wrapped with the world's name.
 *
 * From schema 7 on, a save is never thrown away. SAVE_KEY is frozen: it keeps
 * the name it had at schema 7 for good, and the record's own `v` says which
 * schema wrote it. A change that only adds fields needs nothing. Any other
 * change bumps SAVE_SCHEMA and adds the step that upgrades the schema before
 * it to `MIGRATIONS` below, in the same commit, so every save already written
 * walks forward one schema at a time as it is read. The record as it was
 * before an upgrade is kept once under `voxelcraft:world:before-upgrade`, and a
 * record that cannot be read at all is moved aside under
 * `voxelcraft:world:unreadable` instead of being deleted (both per world). A
 * save written by a newer build than this one is left alone and never written
 * over: this page plays without saving until it is reloaded onto the new code.
 * Schemas 1 to 6 had a key each and were refused rather than upgraded; they
 * still sit under LEGACY_SAVE_KEYS.
 */
export const SAVE_KEY = 'voxelcraft:world:v7';
export const LEGACY_SAVE_KEYS = [
  'voxelcraft:world:v1', 'voxelcraft:world:v2', 'voxelcraft:world:v3',
  'voxelcraft:world:v4', 'voxelcraft:world:v5', 'voxelcraft:world:v6'
];
export const SAVE_SCHEMA = 7;
registerWorldKey(SAVE_KEY);
/** Where the world this page was booted into keeps its save. */
export const ACTIVE_SAVE_KEY = worldKey(SAVE_KEY);
const BEFORE_UPGRADE_BASE = 'voxelcraft:world:before-upgrade';
const UNREADABLE_BASE = 'voxelcraft:world:unreadable';
registerWorldKey(BEFORE_UPGRADE_BASE);
registerWorldKey(UNREADABLE_BASE);

/**
 * One step per schema bump: `MIGRATIONS[n]` takes a parsed record written at
 * schema n and returns it as schema n + 1 would have written it (it may change
 * the record in place). Fill in what the new schema needs from what the old
 * one had, and choose an honest default where it had nothing. Never delete a
 * step: a save written years ago walks through all of them.
 */
const MIGRATIONS = {
  // 7: (save) => { ...; return save; },
};

/** A record walked forward to SAVE_SCHEMA, or null when no path reaches it. */
export function migrateSave(record) {
  let save = record;
  while (save && Number.isInteger(save.v) && save.v < SAVE_SCHEMA) {
    const step = MIGRATIONS[save.v];
    if (!step) return null;
    const from = save.v;
    save = step(save);
    if (save) save.v = from + 1;
  }
  return save && save.v === SAVE_SCHEMA ? save : null;
}

/* Keys that hold a save from a newer build. Nothing on this page writes them. */
const newerSaveKeys = new Set();

/** Whether a save this page found was written by a newer build, and so left alone. */
export function newerSaveFound() { return newerSaveKeys.size > 0; }

/** Where `key`'s spare copies go: the per-world slots, or beside a co-op key. */
function asideKey(key, base) {
  return key === ACTIVE_SAVE_KEY ? worldKey(base) : key + ':' + base.split(':').pop();
}

function keepCopy(key, raw) {
  try { localStorage.setItem(key, raw); } catch (full) {
    console.warn('Could not keep a copy of the save under ' + key, full);
  }
}
const AUTOSAVE_SECONDS = 25;

let lastSaveAt = 0;
let lastSaveBytes = 0;
let lastSaveError = null;
let saveDisabled = false;
let autosaveTimer = AUTOSAVE_SECONDS;
let saveNotice = null;
let saveSpawn = null;
/* Where a write lands, and whether it carries the world. A guest's writes go
   to its own co-op key, without the world: see the schema note above. */
/* A visit writes nothing until the host's world has arrived and the guest's
   own co-op key is named: a join that fails must leave no record behind. */
let saveTarget = activeWorld().guest ? null : ACTIVE_SAVE_KEY;
let savePersonalOnly = false;

/** The storage key a guest in room `code` keeps its own player under. */
export function coopGuestKey(code) { return 'voxelcraft:coop:' + code; }

/** The key a write goes to now, or null while a visit has none yet. */
export function saveTargetKey() { return saveTarget; }

/** From now on, writes go to `key`; `personalOnly` leaves the world out. */
export function setSaveTarget(key, personalOnly = false) {
  saveTarget = key;
  savePersonalOnly = !!personalOnly;
}

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

function serializeEdits() {
  const edits = {};
  for (const [key, map] of world.overridesByChunk) {
    if (!map.size) continue;
    const flat = [];
    for (const [index, id] of map) flat.push(index, id);
    edits[key] = flat;
  }
  return edits;
}

/**
 * The world as a host hands it to a guest joining: everything a save says
 * about the ground and the mission, and nothing about the host's own body or
 * pack except where they stand, so the guest can arrive beside them.
 */
export function serializeSharedWorld() {
  return {
    v: SAVE_SCHEMA,
    seed: WORLD_SEED,
    time: dayTime,
    sp0: spawnPoint(),
    beacons: beaconsActivatedCount(),
    spawn: { x: saveSpawn.x, z: saveSpawn.z },
    host: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
    entities: serializeBlockEntities(),
    edits: serializeEdits()
  };
}

/** A stack as the compact record saves and co-op messages carry. */
export function stackToRecord(stack) { return stackRecord(stack); }

function serializeWorldSave() {
  const edits = savePersonalOnly ? null : serializeEdits();
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
      exhaustion: Number(player.exhaustion.toFixed(3)),
      // Seconds left to burn, written only while the player is on fire, so a
      // save from someone not burning reads exactly as it did before fire.
      ...(player.fireTime > 0 ? { fire: Number(player.fireTime.toFixed(2)) } : {})
    },
    slot: currentSlot(),
    time: dayTime,
    // What the walker carries in no slot at all: the essence total, kept by
    // the essence layer and ridden here as a bare number.
    essence: essenceCount(),
    // The mission's two numbers: SP0, the column the walker first landed on,
    // which every monument and every hostile is measured from, and how many
    // of the five beacons are already lit.
    sp0: spawnPoint(),
    beacons: beaconsActivatedCount(),
    // Where a bed last claimed the player, if anywhere: the respawn point
    // outlives both the session and the bed that set it.
    spawn: { x: saveSpawn.x, z: saveSpawn.z },
    inventory: inventory.map((slot) => stackRecord(slot)),
    armour: armorSlots.map((slot) => stackRecord(slot)),
    entities: savePersonalOnly ? null : serializeBlockEntities(),
    edits
  };
}

/**
 * Furnace and chest contents plus block orientations ride along with the block
 * diff, as flat records: [x, y, z, input id, input count, fuel id, fuel count,
 * output id, output count, burn, burn total, cook], [x, y, z, then twenty-seven
 * id and count pairs, then, only when some slot wears or packs, a map from slot
 * index to that slot's full stack record] and [x, y, z, dx, dz].
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
      // The pairs above know nothing of wear or of a packed chest's slots, so
      // any slot that carries either is written again in full, by index.
      const full = {};
      state.slots.forEach((slot, i) => {
        if (slot && (slot.dur != null || slot.contents)) full[i] = stackRecord(slot);
      });
      if (Object.keys(full).length) row.push(full);
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
  if (saveDisabled || !saveTarget) return false;
  if (newerSaveKeys.has(saveTarget)) {
    lastSaveError = 'Saved by a newer version \u2014 reload to update. Not saving until then.';
    if (saveNotice) saveNotice();
    return false;
  }
  try {
    const json = JSON.stringify(serializeWorldSave());
    localStorage.setItem(saveTarget, json);
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

/**
 * Reads the stored save, upgraded to this schema, or null when there is none
 * this page can play. Nothing that was stored is ever lost here: an older
 * record is upgraded (its original kept once), a newer one is left alone and
 * shielded from writes, and one that cannot be read is moved aside.
 */
export function readSavedWorld(key = ACTIVE_SAVE_KEY) {
  let raw = null;
  try {
    raw = localStorage.getItem(key);
  } catch (err) {
    console.warn('World save is unreadable:', err);
    return null;
  }
  if (!raw) return null;
  let data = null;
  try { data = JSON.parse(raw); } catch (broken) { data = null; }
  if (data && Number.isInteger(data.v) && data.v > SAVE_SCHEMA) {
    newerSaveKeys.add(key);
    lastSaveError = 'Saved by a newer version \u2014 reload to update. Not saving until then.';
    return null;
  }
  const writtenAt = data ? data.v : null;
  const upgraded = data && data.seed === WORLD_SEED ? migrateSave(data) : null;
  if (!upgraded) {
    console.warn('World save could not be read; kept under ' + asideKey(key, UNREADABLE_BASE));
    keepCopy(asideKey(key, UNREADABLE_BASE), raw);
    return null;
  }
  if (writtenAt !== SAVE_SCHEMA) keepCopy(asideKey(key, BEFORE_UPGRADE_BASE), raw);
  return upgraded;
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
      const full = row[3 + CHEST_SLOTS * 2];
      if (full && typeof full === 'object' && !Array.isArray(full)) {
        for (const index in full) {
          const slot = Math.trunc(Number(index));
          if (slot < 0 || slot >= CHEST_SLOTS) continue;
          const restored = stackFromRecord(full[index]);
          if (restored) state.slots[slot] = restored;
        }
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
      if (!block || !(block.facings || block.wallMount)) continue;
      world.facings.set(x + ',' + y + ',' + z, [dx, dz]);
    }
  }
}

/**
 * A saved stack as a compact record: [id, count] plus durability if it has any,
 * and a packed chest's slots, each a record of its own, as a fourth element.
 */
function stackRecord(stack) {
  if (!stack) return null;
  if (stack.contents) {
    return [stack.id, stack.count, stack.dur ?? null, stack.contents.map(stackRecord)];
  }
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
  if (def.packs === 'chest' && Array.isArray(record[3])) {
    stack.contents = new Array(CHEST_SLOTS).fill(null);
    for (let i = 0; i < CHEST_SLOTS; i++) stack.contents[i] = stackFromRecord(record[3][i]);
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

/** Puts the carried essence back. A missing number is a fresh walker. */
export function restoreSavedEssence(save) {
  setEssence(Math.max(0, Math.trunc(Number(save.essence) || 0)));
}

/**
 * Puts the mission back: SP0 first, because the monuments, the essence
 * prices and the difficulty of the ground are all measured from it, then the
 * count of lit beacons with its beams. The lit blocks themselves come back
 * with the saved edits.
 */
export function restoreSavedBeacons(save) {
  const sp0 = save.sp0;
  if (sp0 && Number.isFinite(sp0.x) && Number.isFinite(sp0.z)) setSpawnPoint0(sp0);
  restoreBeaconProgress(save.beacons);
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
  // Only the first world was ever written under the older schemas.
  if (activeWorld().id !== DEFAULT_WORLD_ID) return false;
  try {
    return LEGACY_SAVE_KEYS.some((key) => localStorage.getItem(key) != null);
  } catch (unavailable) {
    return false;
  }
}

/** True when this build has written its own world yet, readable or not. */
export function hasCurrentSave() {
  try {
    return localStorage.getItem(ACTIVE_SAVE_KEY) != null;
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
  // A missing fire is no fire: every save before lava, and every save written
  // while nobody was burning.
  player.fireTime = clamp(Number(p.fire) || 0, 0, BURN_SECONDS);
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
