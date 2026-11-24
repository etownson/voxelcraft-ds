/*
 * What a block that stores or transforms keeps doing when nobody is looking at
 * it: a furnace eats fuel, cooks one item at a time, and glows while it does; a
 * chest only holds, and owes this layer the sweep that clears a state whose
 * block was broken long ago. Chunks are only loaded near the player, so both
 * kinds of validity mean the same thing — a loaded column that says otherwise —
 * and an unloadable one is left alone rather than read as empty.
 *
 * The smelting table, the fuel table and the slot layout are the format: the
 * save writes them and a screen draws them, but neither decides here what cooks
 * or how long it takes. Which furnace the player is watching, and who draws it,
 * arrives through `setBlockEntityView`, a view with four answers the way the
 * camera and the mobs get theirs, so nothing in here mentions a screen, an
 * element, or an item falling.
 */

import { playFurnaceFinishSound, playFurnaceIgniteSound } from './audio.js';
import { ITEMS, isChestBlock, isFurnaceBlock, makeStack } from './blocks.js';
import { markWorldDirty, world } from './chunks.js';
import { BLOCK_ENTITY_TICK_RANGE, B, CHUNK_SIZE, LAVA_BUCKET_BURN } from './config.js';
import { player } from './player.js';

/* ---------- Smelting and furnaces ---------- */

/** What a furnace can transform, and how long one item takes. */
export const SMELTING_RECIPES = new Map([
  ['raw_iron', { out: 'iron_ingot', seconds: 10 }],
  ['raw_beef', { out: 'cooked_beef', seconds: 10 }],
  ['sand', { out: 'glass', seconds: 10 }],
  ['cobblestone', { out: 'stone', seconds: 10 }],
  ['log', { out: 'charcoal', seconds: 10 }]
]);

/**
 * Seconds of heat one unit of each fuel buys. Coal is the workhorse; a lava
 * bucket runs a furnace for a hundred smelts and leaves its pail behind.
 */
export const FURNACE_FUELS = new Map([
  ['coal', 80], ['charcoal', 80],
  ['planks', 15], ['log', 15], ['crafting_table', 15],
  ['stick', 5],
  ['lava_bucket', LAVA_BUCKET_BURN]
]);

/** Fuels that burn out of a container, and what the container is once empty. */
const FUEL_LEAVES = new Map([['lava_bucket', 'bucket']]);

/** Furnace slot layout, matching the order the screen draws them in. */
export const FURNACE_INPUT = 0;
export const FURNACE_FUEL = 1;
export const FURNACE_OUTPUT = 2;

/** True while something smelt-able is waiting and the output has room. */
export function furnaceHasWork(state) {
  const input = state.slots[FURNACE_INPUT];
  if (!input) return false;
  const recipe = SMELTING_RECIPES.get(input.id);
  if (!recipe) return false;

  const output = state.slots[FURNACE_OUTPUT];
  if (!output) return true;
  const def = ITEMS.get(recipe.out);
  return output.id === recipe.out && output.count < (def ? def.stack : 1);
}

/**
 * Advances one furnace by dt seconds, following Minecraft's rule: the item
 * only cooks while there is heat, and heat only exists while fuel is burning.
 * Returns true when a batch finished, which is when sounds and a re-render
 * are worth doing.
 */
function tickFurnace(state, dt) {
  if (state.burnTime > 0) state.burnTime = Math.max(0, state.burnTime - dt);

  const working = furnaceHasWork(state);
  if (!working) {
    state.cookTime = Math.max(0, state.cookTime - dt);
    return false;
  }

  const fuel = state.slots[FURNACE_FUEL];
  const burn = fuel ? FURNACE_FUELS.get(fuel.id) : null;
  if (state.burnTime <= 0 && burn) {
    state.burnTime = burn;
    state.burnTotal = burn;
    const left = FUEL_LEAVES.get(fuel.id);
    fuel.count -= 1;
    // A full bucket never stacks, so the one that burned is the whole slot, and
    // the empty pail it leaves takes the slot over.
    if (fuel.count <= 0) state.slots[FURNACE_FUEL] = left ? makeStack(left, 1) : null;
    markWorldDirty();
  }
  if (state.burnTime <= 0) {
    state.cookTime = Math.max(0, state.cookTime - dt);
    return false;
  }

  const recipe = SMELTING_RECIPES.get(state.slots[FURNACE_INPUT].id);
  state.cookTime += dt;
  if (state.cookTime < recipe.seconds) return false;

  state.cookTime = 0;
  const input = state.slots[FURNACE_INPUT];
  input.count -= 1;
  if (input.count <= 0) state.slots[FURNACE_INPUT] = null;

  const output = state.slots[FURNACE_OUTPUT];
  if (output && output.id === recipe.out) output.count += 1;
  else state.slots[FURNACE_OUTPUT] = makeStack(recipe.out, 1);
  return true;
}

/** Swaps a furnace for its lit variant, which is what makes it glow. */
function setFurnaceLit(x, y, z, lit) {
  const id = world.getBlock(x, y, z);
  const want = lit ? B.FURNACE_LIT : B.FURNACE;
  if (id === want) return false;
  if (!isFurnaceBlock(id)) return false;
  return world.setBlock(x, y, z, want);
}

/**
 * True when a furnace state still belongs where it is saved. Chunks are only
 * loaded near the player, so an unloadable column is left alone rather than
 * treated as empty.
 */
function furnaceEntityValid(x, y, z) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  if (!world.getChunk(cx, cz)) return true;
  return isFurnaceBlock(world.getBlock(x, y, z));
}

/* The few things about the rest of the page a container cannot see, so they are
   handed to it instead of reached for. `at` names the one furnace a screen is
   showing — no screen, no watched block. `paint(state)` moves its gauges and
   `redraw()` rebuilds its slots, so the tick never has to ask what is open or
   know what a gauge is. `spill(slots, x, y, z)` scatters a broken container's
   contents, because making an item fall is not a container's business either. */
export const BLOCK_ENTITY_NONE = '';
let blockEntityView = null;

/**
 * Keeps nearby furnaces burning, and sweeps up chest states an old save left
 * behind. Only block entities within a chunk or so of the player, plus the
 * furnace whose screen is open, are looked at, which is the same range-limited
 * idea Minecraft uses for block entities. A chest holds nothing that ticks, so
 * all it owes here is that sweep.
 */
export function updateBlockEntities(dt) {
  if (!world || dt <= 0 || !world.blockEntities.size) return;

  const openKey = blockEntityView ? blockEntityView.at() : BLOCK_ENTITY_NONE;

  for (const [key, state] of world.blockEntities) {
    const isFurnace = state.kind === 'furnace';
    if (!isFurnace && state.kind !== 'chest') continue;
    const parts = key.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (key !== openKey) {
      const dx = x + 0.5 - player.pos.x;
      const dy = y + 0.5 - player.pos.y;
      const dz = z + 0.5 - player.pos.z;
      if (dx * dx + dy * dy + dz * dz > BLOCK_ENTITY_TICK_RANGE * BLOCK_ENTITY_TICK_RANGE) {
        continue;
      }
      // A block that has since been broken leaves its state behind in an old
      // save; while we are close enough to see that, clear it out.
      const stillThere = isFurnace
        ? furnaceEntityValid(x, y, z)
        : chestEntityValid(x, y, z);
      if (!stillThere) {
        world.blockEntities.delete(key);
        world.facings.delete(key);
        markWorldDirty();
        continue;
      }
    }
    if (!isFurnace) continue;

    const wasLit = state.burnTime > 0;
    const finished = tickFurnace(state, dt);
    const isLit = state.burnTime > 0;
    if (wasLit !== isLit) {
      setFurnaceLit(x, y, z, isLit);
      if (isLit) playFurnaceIgniteSound(x + 0.5, y + 0.5, z + 0.5);
    }
    if (finished) {
      playFurnaceFinishSound(x + 0.5, y + 0.5, z + 0.5);
      markWorldDirty();
      if (key === openKey && blockEntityView) blockEntityView.redraw();
    }
    if (key === openKey && blockEntityView) blockEntityView.paint(state);
  }
}

/**
 * Drops whatever a chest or furnace was holding when it is broken. Slot order
 * means nothing here, so one spill serves every kind of stored inventory, and
 * the asking is all the container layer does: making the items fall belongs to
 * whoever is willing to hold them.
 */
export function spillBlockEntityContents(x, y, z) {
  const state = world.blockEntities.get(x + ',' + y + ',' + z);
  if (!state || !blockEntityView) return;
  blockEntityView.spill(state.slots, x, y, z);
}

/* ---------- Chests ---------- */

/**
 * Empties a chest into a list its packed item can carry, for a chest that is
 * being picked up rather than smashed. Null when there is nothing inside,
 * which leaves the plain chest item to drop as it always has. The state is
 * cleared, so a spill asked for afterwards finds nothing to throw.
 */
export function packChestContents(x, y, z) {
  const state = world.blockEntities.get(x + ',' + y + ',' + z);
  if (!state || state.kind !== 'chest' || !state.slots.some(Boolean)) return null;
  const contents = state.slots.slice();
  state.slots.fill(null);
  return contents;
}

/** Puts a packed chest's slots back into the chest just placed from it. */
export function unpackChestContents(x, y, z, contents) {
  if (!contents || !isChestBlock(world.getBlock(x, y, z))) return;
  const state = world.blockEntityAt(x, y, z, 'chest');
  for (let i = 0; i < state.slots.length; i++) state.slots[i] = contents[i] ?? null;
  markWorldDirty();
}

/**
 * True when a chest state still belongs where it is saved. The same rule as
 * furnaceEntityValid: an unloadable column is left alone, and only a loaded
 * chunk that says otherwise can clear a state an old save left behind.
 */
function chestEntityValid(x, y, z) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  if (!world.getChunk(cx, cz)) return true;
  return isChestBlock(world.getBlock(x, y, z));
}

/** Handed once, at bootstrap, the way the camera and the mobs are handed their
 *  view of a world they cannot see. */
export function setBlockEntityView(view) { blockEntityView = view; }
