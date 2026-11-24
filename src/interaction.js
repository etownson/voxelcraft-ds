/*
 * Using the world with what is in hand: a pickaxe finding out how hard a block
 * is and wearing itself down as it goes, a bucket trading itself for water and
 * back again, a hoe opening soil for a seed, a door hung across two cells, a bed
 * that takes the respawn point with it and, after dark, ends the night.
 *
 * It is one layer because it is one decision — what a click does to whatever the
 * crosshair is resting on — and every part of it ends the same way: ask the aim
 * layer what is targeted, ask the world to change it, tell whoever is watching.
 * What the player is told is not this layer's business: the toast, the screens,
 * the sleep fade, the readout and the column a death returns you to all arrive as
 * one view at bootstrap. `blockIntersectsPlayer` is here rather than beside the
 * collision kernel because the only thing that asks is whether a block someone is
 * placing would be standing inside them, and that is a question about placing.
 */

import {
  currentTarget, hideCrack, rayDirection, raycastFluidSource, showCrack, updateTarget
} from './aim.js';
import {
  playBreakSound, playDoorSound, playFillBucketSound, playHoeTillSound, playMiningHitSound,
  playPlaceSound, playPourBucketSound, playToolBreakSound
} from './audio.js';
import {
  BLOCKS, ITEMS, consumeDurability, freshStack, isChestBlock, isFluid, isFurnaceBlock, isWater
} from './blocks.js';
import { markWorldDirty, world } from './chunks.js';
import {
  B, COLLISION_EPSILON, DAY_START, EXHAUSTION, FOCUS_REACH, PLAYER_HALF_WIDTH, PLAYER_HEIGHT,
  WATER_NEIGHBORS, WORLD_HEIGHT, clamp
} from './config.js';
import {
  packChestContents, spillBlockEntityContents, unpackChestContents
} from './containers.js';
import { spawnItemDrop } from './drops.js';
import { spawnEssenceBurst } from './essence.js';
import { FARMLAND_WET_REACH, isFarmlandWet } from './farming.js';
import { spawnBlockBreakParticles } from './fx.js';
import { triggerHeldSwing } from './held.js';
import {
  addItemToInventory, consumeSelectedItem, currentSlot, emptyHand, getSelectedStack, inventory,
  inventoryHasRoom, paintPack
} from './inventory.js';
import { addExhaustion, aimOrigin, player } from './player.js';
import { camera } from './render.js';
import { applyDayNight, isNight, setDayTime } from './sky.js';
import { tryLightBeacon } from './beacons.js';

/* The layer that uses a block with what is in hand is the one that has to say
   something back to the player, and everything it says belongs to whoever is
   showing the game: the toast above the hotbar, the screen a furnace or chest
   opens into, the black that covers a night of sleep, the readout the HUD keeps,
   and the column of ground a death returns you to. All five come down as one
   view at bootstrap. Until they do, a pickaxe still breaks and a bucket still
   pours, and nothing else notices. */
const interactionView = {
  toast: () => {},
  openScreen: () => {},
  placeSpawn: () => {},
  showSleepFade: () => {},
  hideSleepFade: () => {},
  paintReadout: () => {}
};

export function setInteractionView(shown) { Object.assign(interactionView, shown); }

function blockIntersectsPlayer(bx, by, bz) {
  const playerMinX = player.pos.x - PLAYER_HALF_WIDTH;
  const playerMaxX = player.pos.x + PLAYER_HALF_WIDTH;
  const playerMinY = player.pos.y;
  const playerMaxY = player.pos.y + PLAYER_HEIGHT;
  const playerMinZ = player.pos.z - PLAYER_HALF_WIDTH;
  const playerMaxZ = player.pos.z + PLAYER_HALF_WIDTH;
  return playerMaxX > bx + COLLISION_EPSILON &&
    playerMinX < bx + 1 - COLLISION_EPSILON &&
    playerMaxY > by + COLLISION_EPSILON &&
    playerMinY < by + 1 - COLLISION_EPSILON &&
    playerMaxZ > bz + COLLISION_EPSILON &&
    playerMinZ < bz + 1 - COLLISION_EPSILON;
}


/* ---------- Mining and placing ---------- */

const miningState = {
  active: false,
  x: 0,
  y: 0,
  z: 0,
  itemId: null,
  progress: 0,
  duration: 0,
  canHarvest: false,
  instantBreak: false,
  wearsTool: false
};

/** How often a swing lands while breaking; drives both the arm and its sound. */
export const MINING_SWING_INTERVAL = 0.3;
/** One Minecraft tick, the unit all its break times are counted in. */
const MINING_TICK = 1 / 20;
/**
 * The gap Minecraft leaves between two broken blocks: six ticks in which the
 * arm keeps swinging and nothing gives way. A block that shatters within a
 * single tick skips the gap, which is how a shovel tears through a snowfield.
 */
const MINING_BLOCK_DELAY = 6 * MINING_TICK;
let miningDelay = 0;
let miningHitTimer = 0;
let miningHitKey = '';

/**
 * What the loop is busy with, in one read: the block under the pickaxe, how far
 * it has gone, and the gap Minecraft leaves before the next one gives way.
 * Whoever is showing the mining asks, and is not handed the loop itself.
 */
export function miningReport() {
  return { ...miningState, delay: miningDelay };
}

/** True while a block is being broken right now. */
export function isMining() { return miningState.active; }

/** Repeated contact sound for the block under the crosshair, per swing. */
function updateMiningHitSound(dt, target) {
  const stack = getSelectedStack();
  const key = target.x + ',' + target.y + ',' + target.z + ',' + (stack ? stack.id : '');
  if (key !== miningHitKey) {
    miningHitKey = key;
    miningHitTimer = MINING_SWING_INTERVAL; // the first swing makes noise at once
  }

  miningHitTimer += dt;
  if (miningHitTimer < MINING_SWING_INTERVAL) return false;
  miningHitTimer = 0;
  return playMiningHitSound(
    target.id, target.x + 0.5, target.y + 0.5, target.z + 0.5
  );
}

export function hideMiningFeedback() {
  miningState.active = false;
  miningState.itemId = null;
  miningState.progress = 0;
  miningHitKey = '';
  miningHitTimer = 0;
  hideCrack();
}

/** Points the swing loop at a block, restarting progress when it changes. */
function startMiningOn(target) {
  const stack = getSelectedStack();
  const itemId = stack ? stack.id : null;

  if (miningState.active &&
      miningState.x === target.x &&
      miningState.y === target.y &&
      miningState.z === target.z &&
      miningState.itemId === itemId) {
    return;
  }

  const facts = miningFacts(target.id, stack);
  miningState.active = true;
  miningState.x = target.x;
  miningState.y = target.y;
  miningState.z = target.z;
  miningState.itemId = itemId;
  miningState.progress = 0;
  miningState.duration = facts.duration;
  miningState.canHarvest = facts.canHarvest;
  miningState.instantBreak = facts.instantBreak;
  miningState.wearsTool = facts.wearsTool;
}

/**
 * Minecraft's break math. Each tick the tool deals its speed as damage and the
 * block gives way at hardness x 30, which works out to `hardness x 1.5 / speed`
 * seconds. A tool that cannot harvest the block deals a fifth of that damage, so
 * the same block takes five times as long and drops nothing at all.
 */
export function miningFacts(blockId, stack) {
  const block = BLOCKS[blockId];
  if (!block.breakable || !isFinite(block.hardness)) {
    return {
      duration: Infinity, canHarvest: false,
      instantBreak: false, wearsTool: false
    };
  }

  const item = stack ? ITEMS.get(stack.id) : null;
  const tool = item && item.kind === 'tool' ? item : null;
  const correctTool = !!(tool && block.tool && tool.tool === block.tool);
  const canHarvest = !block.tier ||
    (correctTool && (tool.tierLevel || 0) >= block.tier);
  const speed = correctTool ? (tool.miningSpeed || 1) : 1;
  const raw = block.hardness * (canHarvest ? 1.5 : 5) / speed;

  return {
    duration: Math.max(MINING_TICK, raw),
    canHarvest,
    // One tick's damage settles the block outright, and Minecraft sees no gap
    // before the next one. The nudge keeps a hardness of 0.2 under an iron hoe,
    // which is exactly one tick, from reading as a hair over it.
    instantBreak: raw <= MINING_TICK * 1.000001,
    wearsTool: correctTool
  };
}

/**
 * Spend durability on whatever is in hand and clear the slot when it snaps.
 * Only swings that actually used the tool should call this.
 */
export function wearHeldTool(amount = 1) {
  const stack = getSelectedStack();
  if (!stack || !consumeDurability(stack, amount)) return false;

  const item = ITEMS.get(stack.id);
  emptyHand();
  playToolBreakSound();
  interactionView.toast(((item && item.name) || 'Tool') + ' broke');
  hideMiningFeedback();
  paintPack();
  return true;
}

/**
 * @param canHarvest when false the block still breaks but yields nothing,
 *                   which is how a too-low pickaxe tier behaves.
 */
function breakBlockAt(x, y, z, id, canHarvest = true) {
  const block = BLOCKS[id];
  if (!block.breakable || !isFinite(block.hardness)) return false;

  // A chest with anything in it is picked up whole: its slots ride out on a
  // packed chest, so moving base never means hauling the box out a stack at a
  // time. A furnace, or a chest that comes away with no harvest, empties its
  // contents onto the ground first, so nothing kept inside is lost.
  const packed = canHarvest && isChestBlock(id) ? packChestContents(x, y, z) : null;
  if (block.blockEntity) spillBlockEntityContents(x, y, z);

  // Whichever half of a door the player broke, the far half comes away with
  // it, and the single door item drops from the half that was broken.
  if (block.door) world.clearDoorPartner(x, y, z, id);
  if (block.bed) world.clearBedPartner(x, y, z, id);

  world.setBlock(x, y, z, B.AIR);
  // A torch standing on the block, or stuck to one of its sides, has nothing
  // left to hold it and pops off as an item, whatever the tool was.
  for (const [tx, ty, tz] of world.torchesHeldBy(x, y, z)) {
    world.setBlock(tx, ty, tz, B.AIR);
    spawnItemDrop('torch', 1, tx + 0.5, ty + 0.3, tz + 0.5);
  }
  addExhaustion(EXHAUSTION.mine);
  if (packed) {
    // Straight into the pack when there is a slot for it. A packed chest left
    // lying on the ground is a whole base's worth of things one walk away
    // from vanishing, so it only drops when the pack is full.
    if (addItemToInventory('packed_chest', 1, undefined, packed) > 0) {
      spawnItemDrop('packed_chest', 1, x + 0.5, y + 0.5, z + 0.5, true, undefined, packed);
      interactionView.toast('Pack full \u2014 the packed chest fell at your feet');
    }
  } else if (canHarvest) {
    for (const drop of block.drops ?? []) {
      // Some drops are a roll rather than a certainty, like seeds in grass.
      if (drop.chance != null && Math.random() >= drop.chance) continue;
      const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
      spawnItemDrop(drop.item, count, x + 0.5, y + 0.5, z + 0.5);
    }
    // Ore also pays essence, the block's own half of the fuel economy. It
    // rides the same canHarvest gate as the item drops: a pickaxe below the
    // ore's tier breaks the block and gets nothing at all, essence included.
    // The bubbles land on the block's own spot rather than scattering, so
    // the reward reads as the block's and the player never has to go looking.
    if (block.essence) {
      spawnEssenceBurst(block.essence, x + 0.5, y + 0.5, z + 0.5, false);
    }
  }
  spawnBlockBreakParticles(x, y, z, id);
  playBreakSound(id, x + 0.5, y + 0.5, z + 0.5);
  return true;
}

export function updateMining(dt, held) {
  // The gap after a block gives way runs out whether or not the button is
  // still held, so letting go in the middle of it never banks free progress.
  if (miningDelay > 0) miningDelay = Math.max(0, miningDelay - dt);

  if (!held || !currentTarget) {
    hideMiningFeedback();
    return;
  }

  const target = currentTarget;
  const block = BLOCKS[target.id];
  if (!block.breakable || !isFinite(block.hardness)) {
    // Unbreakable blocks never crack, but swinging at them still thuds.
    startMiningOn(target);
    hideCrack();
    updateMiningHitSound(dt, target);
    return;
  }

  if (miningDelay > 0) {
    // Six ticks of swinging at nothing: the arm and its sound carry on, the
    // block under the crosshair stays uncracked and starts from scratch once
    // the gap is over.
    miningState.active = false;
    miningState.progress = 0;
    hideCrack();
    updateMiningHitSound(dt, target);
    return;
  }

  startMiningOn(target);

  miningState.progress += dt;
  const progress = clamp(miningState.progress / miningState.duration, 0, 1);
  const stage = Math.min(9, Math.floor(progress * 10));

  showCrack(target.x, target.y, target.z, stage);
  updateMiningHitSound(dt, target);

  if (miningState.progress >= miningState.duration) {
    const wearsTool = miningState.wearsTool;
    const instant = miningState.instantBreak;
    breakBlockAt(target.x, target.y, target.z, target.id, miningState.canHarvest);
    hideMiningFeedback();
    if (wearsTool) wearHeldTool(1);
    // Anything that took more than a tick to fell the block leaves the player
    // six ticks short of the next one.
    if (!instant) miningDelay = MINING_BLOCK_DELAY;
    updateTarget();
  }
}

export function tryPlaceSelectedBlock() {
  updateTarget();

  // A bucket is aimed at the water itself rather than at a block face, and the
  // crosshair walks straight through water, so standing in the sea leaves no
  // target at all. The bucket still gets its turn there, ahead of every check
  // below that needs a block under the crosshair to ask anything of.
  if (!currentTarget) return tryUseBucket();

  // Right-clicking a crafting table opens the 3x3 screen, whatever is held.
  if (currentTarget.id === B.CRAFTING_TABLE) {
    interactionView.openScreen('crafting');
    return false;
  }

  // So does a furnace, lit or not, which opens its smelting screen.
  if (isFurnaceBlock(currentTarget.id)) {
    interactionView.openScreen('furnace', currentTarget);
    return false;
  }

  // And a chest, which opens its box of stored things under the crosshair.
  if (isChestBlock(currentTarget.id)) {
    interactionView.openScreen('chest', currentTarget);
    return false;
  }

  // And a door swings open or shut under the crosshair, whatever is held.
  if (BLOCKS[currentTarget.id].door) {
    toggleDoor(currentTarget.x, currentTarget.y, currentTarget.z);
    return false;
  }

  // And a bed claims the spawn point and, after dark, ends the night.
  if (BLOCKS[currentTarget.id].bed) {
    useBed(currentTarget.x, currentTarget.y, currentTarget.z);
    return false;
  }

  // And a beacon answers a right click wherever it stands. Whether it lights
  // or refuses, the machine has been spoken to and the click is spent: held
  // blocks do not get placed against a transmitter's monument.
  if (BLOCKS[currentTarget.id].beacon) {
    tryLightBeacon(currentTarget.x, currentTarget.y, currentTarget.z);
    return false;
  }

  // And a hoe in hand tilling soil is a use, not a placement.
  if (useHoeOnTarget()) return true;

  // Seeds on farmland start a crop the same way.
  if (plantSeedsOnTarget()) return true;

  // And a bucket, which pours onto the face under the crosshair or drinks from
  // the water behind it. Like the hoe it loses to anything that opens on a
  // right click: a crafting table with the sea behind it opens, and does not
  // get flooded.
  if (tryUseBucket()) return true;

  const stack = getSelectedStack();
  if (!stack) return false;

  const item = ITEMS.get(stack.id);
  if (!item || item.kind !== 'block') return false;

  const block = BLOCKS[item.blockId];
  if (!block.placeable) return false;

  const px = currentTarget.x + currentTarget.normal.x;
  const py = currentTarget.y + currentTarget.normal.y;
  const pz = currentTarget.z + currentTarget.normal.z;

  if (py < 0 || py >= WORLD_HEIGHT) return false;
  // A fluid is the one thing a block can be set straight into, source or flow.
  // It is also what lets a plank dam a flood, or cap a lava spill, instead of
  // bouncing off it.
  const roomId = world.getBlock(px, py, pz);
  if (roomId !== B.AIR && !isFluid(roomId)) return false;

  // A torch clicked onto the side of a block leans off that face; anything
  // else that sits on top still has to be clicked onto a top face.
  let wallFacing = null;
  if (block.wallMount && currentTarget.normal.y === 0) {
    if (!BLOCKS[currentTarget.id].solid) return false;
    wallFacing = [currentTarget.normal.x, currentTarget.normal.z];
  } else if (block.placeOnTop) {
    if (currentTarget.normal.y !== 1) return false;
    if (!BLOCKS[world.getBlock(px, py - 1, pz)].solid) return false;
  }

  // A ladder hangs off a wall instead of standing on the ground, so the face it
  // was clicked on tells it which way to lean rather than the climber's gaze.
  let ladderFacing = null;
  if (block.ladder) {
    ladderFacing = ladderFacingFor(currentTarget, px, py, pz);
    if (!ladderFacing) {
      interactionView.toast('A ladder needs a wall to hang on');
      return false;
    }
  }

  // A door is a two-cell block and needs its own room check for both halves.
  if (block.door) return placeDoor(px, py, pz);
  if (block.bed) return placeBed(px, py, pz);

  if (block.solid && blockIntersectsPlayer(px, py, pz)) {
    interactionView.toast('Not enough room to place that');
    return false;
  }

  const facing = block.ladder ? ladderFacing
    : block.wallMount ? wallFacing
    : block.facings ? frontFacingTowardsPlayer(px, pz) : null;
  if (!world.setBlock(px, py, pz, block.id, facing)) return false;
  // A packed chest sets down with everything it was picked up with.
  if (stack.contents) unpackChestContents(px, py, pz, stack.contents);
  consumeSelectedItem();
  playPlaceSound(block.id, px + 0.5, py + 0.5, pz + 0.5);
  return true;
}

/**
 * Which way a ladder put at x,y,z would lean, or null when nothing there would
 * hold one. The side of a solid block is the plain answer, since that is the
 * wall the plank gets nailed to. Clicking the top or bottom of a ladder already
 * hanging there borrows that ladder's facing instead, provided the wall carries
 * on past it: without that, a crosshair aimed at the next course of stone has
 * to thread past the ladder below it to find the wall, and a climb could never
 * be built one cell taller than an outstretched arm.
 */
function ladderFacingFor(target, x, y, z) {
  if (target.normal.y === 0) {
    return BLOCKS[target.id].solid ? [target.normal.x, target.normal.z] : null;
  }
  if (!BLOCKS[target.id].ladder) return null;
  const facing = world.facingAt(target.x, target.y, target.z);
  if (!facing) return null;
  // The wall lies behind the ladder, on the side its facing points away from.
  return BLOCKS[world.getBlock(x - facing[0], y, z - facing[1])].solid ? facing : null;
}

/**
 * Horizontal normal a placed block should point along: towards whoever is
 * placing it, which is how Minecraft aims a furnace front.
 */
function frontFacingTowardsPlayer(x, z) {
  const dx = player.pos.x - (x + 0.5);
  const dz = player.pos.z - (z + 0.5);
  if (Math.abs(dx) >= Math.abs(dz)) return [dx >= 0 ? 1 : -1, 0];
  return [0, dz >= 0 ? 1 : -1];
}

/** The dirt family a hoe can break up into farmland. */
const HOE_TILLABLE = new Set([B.DIRT, B.GRASS]);

/**
 * Right-clicking soil with a hoe tills it into farmland, the first step of
 * farming. Nothing is consumed but one use of the hoe, and the soil only gives
 * way when there is open air above it for crops to stand in.
 */
export function useHoeOnTarget() {
  const stack = getSelectedStack();
  if (!stack) return false;

  const item = ITEMS.get(stack.id);
  if (!item || item.kind !== 'tool' || item.tool !== 'hoe') return false;
  if (!HOE_TILLABLE.has(currentTarget.id)) return false;

  const x = currentTarget.x;
  const y = currentTarget.y;
  const z = currentTarget.z;
  if (world.getBlock(x, y + 1, z) !== B.AIR) {
    interactionView.toast('Needs air above it to till');
    return false;
  }

  world.setBlock(x, y, z, B.FARMLAND);
  wearHeldTool(1);
  playHoeTillSound(x + 0.5, y + 0.5, z + 0.5);
  return true;
}

/**
 * Right-clicking farmland with seeds plants them at stage 0. Seeds are the one
 * item that turns into a block on use rather than being placed like a brick.
 */
export function plantSeedsOnTarget() {
  const stack = getSelectedStack();
  if (!stack) return false;

  const item = ITEMS.get(stack.id);
  if (!item || item.kind !== 'seed') return false;
  if (currentTarget.id !== B.FARMLAND) return false;

  const x = currentTarget.x;
  const y = currentTarget.y + 1;
  const z = currentTarget.z;
  if (y >= WORLD_HEIGHT || world.getBlock(x, y, z) !== B.AIR) return false;

  world.setBlock(x, y, z, item.plants);
  consumeSelectedItem();
  playHoeTillSound(x + 0.5, y + 0.5, z + 0.5);
  // Sowing dry soil is allowed — Minecraft does not stop it either — but a
  // player who has just learned wheat can also wait for water, so say which.
  if (!isFarmlandWet(x, y - 1, z)) {
    interactionView.toast(`Dry soil — crops wait for water within ${FARMLAND_WET_REACH} blocks`);
  }
  return true;
}

/* ---------- Buckets ---------- */

/**
 * Trades the stack in hand for another item id without either half of the trade
 * going anywhere near the ground: pouring a full bucket leaves the empty one
 * behind, and filling an empty one leaves the full one. A stack that was holding
 * more than one hands over the single item the action needs and keeps holding
 * the rest — which is why a full bucket, never stacked and one to a slot, needs
 * a slot of its own before a stack of empties can be dipped.
 */
function swapHeldFor(itemId) {
  const stack = getSelectedStack();
  if (!stack) return false;

  if (stack.count > 1) {
    // addItemToInventory reports what it could not fit, and one item either
    // fits or does not, so a refusal here leaves the trade untouched.
    if (addItemToInventory(itemId, 1) > 0) return false;
    stack.count -= 1;
  } else {
    inventory[currentSlot()] = freshStack(itemId);
  }
  paintPack();
  markWorldDirty();
  return true;
}

/**
 * Whether any of the six cells touching this one holds water. Those six are
 * exactly the neighbours the flow code reads beside a cell, which makes them
 * the honest test for whether a source is part of a body of water rather than
 * a body all on its own.
 */
function waterBeside(x, y, z) {
  for (const [dx, dy, dz] of WATER_NEIGHBORS) {
    if (isWater(world.getBlock(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}

/**
 * Scooping a bucketful out of the water the crosshair is on. Minecraft lets a
 * bucket drink only from a full source, and this keeps to that: the skin of a
 * wave that has run out from the shore stays where it is, because taking one of
 * those up would empty the wrong cell and leave the sheet hanging behind it.
 * Drinking from a body leaves the body itself alone — Minecraft takes a
 * bucketful out of a lake and the lake does not notice — so a source with water
 * beside it keeps its cell and fills the next bucket just as happily. Only a
 * source with no water beside it at all is the whole body, a puddle that fits
 * in one bucket, and that one cell is the only thing a scoop lifts out of the
 * world. Lifting a feeding source used to drain whatever it stood in: nothing
 * beside the hole can hold the sheet to its rank once its source is gone, the
 * flow code deepens the ranks a step a tick looking for supply that no longer
 * exists, and a whole pond vanished for the price of one bucket.
 */
function fillBucket() {
  camera.getWorldDirection(rayDirection);
  const hit = raycastFluidSource(aimOrigin(), rayDirection, FOCUS_REACH);
  if (!hit) {
    interactionView.toast('No source to fill from');
    return false;
  }

  // Lava is scooped on the same terms, with one difference: a lava source is
  // always lifted out of the world. Minecraft's lava does not make more of
  // itself the way a lake does, so the pool shrinks by the bucket every time.
  const lava = hit.id === B.LAVA;
  const full = lava ? 'lava_bucket' : 'water_bucket';
  const stack = getSelectedStack();
  if (stack.count > 1 && !inventoryHasRoom(full, 1)) {
    interactionView.toast(lava ? 'Nowhere to put the lava' : 'Nowhere to put the water');
    return false;
  }
  if (!swapHeldFor(full)) return false;

  if (lava || !waterBeside(hit.x, hit.y, hit.z)) world.setBlock(hit.x, hit.y, hit.z, B.AIR);
  triggerHeldSwing();
  playFillBucketSound(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  interactionView.toast(lava ? 'Bucket filled with lava' : 'Bucket filled');
  return true;
}

/**
 * Emptying a bucket onto the face under the crosshair. It keeps to the same room
 * rule as any other placement — the cell has to be air or fluid already — and a
 * full source is what lands there, so a poured bucket refills the very hole it
 * was scooped from instead of starting a fresh wave somewhere down the slope.
 * Pouring one fluid into the other is allowed, and the flow code settles what
 * meets: water poured onto lava hardens the lava around it.
 */
function pourBucket(sourceId, noun) {
  if (!currentTarget) return false;

  const x = currentTarget.x + currentTarget.normal.x;
  const y = currentTarget.y + currentTarget.normal.y;
  const z = currentTarget.z + currentTarget.normal.z;
  if (y < 0 || y >= WORLD_HEIGHT) return false;

  const roomId = world.getBlock(x, y, z);
  if (roomId !== B.AIR && !isFluid(roomId)) {
    interactionView.toast('Nowhere for the ' + noun + ' to go');
    return false;
  }
  if (!world.setBlock(x, y, z, sourceId)) return false;

  // The swap's return is ignored on purpose: a bucket emptied over your own head
  // still empties, even when there is no room left to keep the empty one.
  swapHeldFor('bucket');
  triggerHeldSwing();
  playPourBucketSound(x + 0.5, y + 0.5, z + 0.5);
  return true;
}

/**
 * A right click with a bucket in hand, which means one of two opposite things
 * depending on which of the states happens to be held.
 */
function tryUseBucket() {
  const stack = getSelectedStack();
  if (!stack) return false;
  if (stack.id === 'bucket') return fillBucket();
  if (stack.id === 'water_bucket') return pourBucket(B.WATER, 'water');
  if (stack.id === 'lava_bucket') return pourBucket(B.LAVA, 'lava');
  return false;
}

/* ---------- Doors ---------- */

/** The id a door half swaps to when the leaf swings. */
const DOOR_SWINGS = {
  [B.DOOR]: B.DOOR_OPEN, [B.DOOR_OPEN]: B.DOOR,
  [B.DOOR_TOP]: B.DOOR_OPEN_TOP, [B.DOOR_OPEN_TOP]: B.DOOR_TOP
};

/** True when a block id belongs to any half of a door. */
function isDoorBlock(blockId) {
  const block = BLOCKS[blockId];
  return !!block && !!block.door;
}

/**
 * Places one door across two cells: the leaf's foot at (x, y, z) and its top
 * directly above. Both halves share the facing the placer stood behind, so
 * the leaf always hangs against the same jamb when it swings.
 */
function placeDoor(x, y, z) {
  if (!BLOCKS[world.getBlock(x, y - 1, z)].solid) {
    interactionView.toast('Doors need solid ground beneath them');
    return false;
  }
  if (y + 1 >= WORLD_HEIGHT || world.getBlock(x, y + 1, z) !== B.AIR) {
    interactionView.toast('Needs a clear block above for the door');
    return false;
  }
  if (blockIntersectsPlayer(x, y, z) || blockIntersectsPlayer(x, y + 1, z)) {
    interactionView.toast('Not enough room to place that');
    return false;
  }

  const facing = frontFacingTowardsPlayer(x, z);
  if (!world.setBlock(x, y, z, B.DOOR, facing)) return false;
  world.setBlock(x, y + 1, z, B.DOOR_TOP, facing);
  consumeSelectedItem();
  playPlaceSound(B.DOOR, x + 0.5, y + 0.5, z + 0.5);
  return true;
}

/**
 * Swings the door whose half is at this position. Both halves change id
 * together and keep the facing they were placed with, which is the jamb the
 * leaf rests against. A half standing alone still swings on its own.
 */
function toggleDoor(x, y, z) {
  const id = world.getBlock(x, y, z);
  const block = BLOCKS[id];
  if (!block.door) return false;

  const otherY = block.door === 'lower' ? y + 1 : y - 1;
  const otherId = world.getBlock(x, otherY, z);
  const facing = world.facingAt(x, y, z) ?? world.facingAt(x, otherY, z);

  world.setBlock(x, y, z, DOOR_SWINGS[id], facing);
  if (BLOCKS[otherId].door) world.setBlock(x, otherY, z, DOOR_SWINGS[otherId], facing);
  playDoorSound(x + 0.5, y + 0.5, z + 0.5);
  return true;
}

/* ---------- Beds ---------- */

/**
 * Lays a bed across two cells: the foot at (x, y, z) and the head one step
 * along the facing, which points away from whoever places it so the pillow
 * always lands at the far end from the door they walked in through.
 */
function placeBed(x, y, z) {
  if (!BLOCKS[world.getBlock(x, y - 1, z)].solid) {
    interactionView.toast('Beds need solid ground beneath them');
    return false;
  }
  const towards = frontFacingTowardsPlayer(x, z);
  const facing = [-towards[0], -towards[1]];
  const headX = x + facing[0];
  const headZ = z + facing[1];

  if (world.getBlock(headX, y, headZ) !== B.AIR) {
    interactionView.toast('Needs a clear cell beside for the bed');
    return false;
  }
  if (!BLOCKS[world.getBlock(headX, y - 1, headZ)].solid) {
    interactionView.toast('Beds need solid ground beneath them');
    return false;
  }
  if (blockIntersectsPlayer(x, y, z) || blockIntersectsPlayer(headX, y, headZ)) {
    interactionView.toast('Not enough room to place that');
    return false;
  }

  if (!world.setBlock(x, y, z, B.BED, facing)) return false;
  world.setBlock(headX, y, headZ, B.BED_HEAD, facing);
  consumeSelectedItem();
  playPlaceSound(B.BED, x + 0.5, y + 0.5, z + 0.5);
  return true;
}

/**
 * Right-clicking either cell of a bed moves the respawn point onto it.
 * After dark it also ends the night: the screen goes black, and the world
 * wakes with the sun back up. Only the sky is skipped, so anything that was
 * outside when the player lay down is still outside when they get up.
 */
function useBed(x, y, z) {
  const id = world.getBlock(x, y, z);
  const block = BLOCKS[id];
  if (!block.bed) return false;

  // The spawn point is the foot cell, so the player wakes at the end they
  // got in from even when they clicked the pillow.
  const facing = world.facingAt(x, y, z) ?? [0, 1];
  let footX = x;
  let footZ = z;
  if (block.bed === 'head') {
    const backX = x - facing[0];
    const backZ = z - facing[1];
    if (BLOCKS[world.getBlock(backX, y, backZ)].bed === 'foot') {
      footX = backX;
      footZ = backZ;
    }
  }

  interactionView.placeSpawn(footX, footZ);
  playDoorSound(x + 0.5, y + 0.5, z + 0.5);

  if (isNight() && !sleeping) {
    sleepThroughNight();
  } else {
    interactionView.toast('Spawn point set');
  }
  return true;
}

/** Set while the night is skipping, so a second click moves the spawn but does not skip twice. */
let sleeping = false;

function sleepThroughNight() {
  sleeping = true;
  interactionView.showSleepFade();
  interactionView.toast('You fall asleep...');
  setTimeout(() => {
    setDayTime(DAY_START);
    applyDayNight();
    interactionView.paintReadout();
    sleeping = false;
    interactionView.hideSleepFade();
    interactionView.toast('Good morning');
  }, 1400);
}
