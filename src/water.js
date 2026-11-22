/*
 * How a flood actually goes anywhere: water is seven depths thick rather than
 * one block, it pours straight down and spreads sideways into whatever will
 * take it, and it only ever moves from a cell something else has already fed.
 * Every rule lives in `desiredWaterLevel`, which reads the eight cells around a
 * column and says what belongs there — full and source-shaped when an open
 * source is above it, shallower as the distance from that source grows, air
 * once nothing is left to refill it. `waterTick` applies that answer a budget of
 * cells at a time, with reads taken as the pass began and writes applied
 * together, because a flood that noticed its own first wave would spend the
 * whole afternoon chasing it.
 *
 * Cells are queued on the world, not here, so a chunk that unloads and returns
 * still knows what it was waiting for, and a cell whose neighbours are not
 * loaded yet is waited on rather than resolved against thin air — which is the
 * only reason water at a chunk border comes out the same on both sides. Meshes
 * are deferred through `flushFlowRemesh` for the same reason: the shape of the
 * surface is the renderer's business, and a flood that rebuilt every mesh it
 * touched would never finish flowing.
 */

import { BLOCKS, isFallingWater, isFlowWater, isWater, waterCanOccupy } from './blocks.js';
import { world } from './chunks.js';
import {
  B, CHUNK_SIZE, WATER_MAX_FLOW, WATER_NEIGHBORS, WATER_REMESH_IDLE_BUDGET,
  WATER_SIDES, WATER_TICK_BUDGET, WATER_TICK_SECONDS, WATER_WAIT_LIMIT, WORLD_HEIGHT,
  chunkKey
} from './config.js';

/* ---------- Water flow ---------- */

/**
 * Block ids for each of the seven depths, twice over: resting water in one
 * table, water pouring downward in the other.
 */
const WATER_FLOW_IDS = [];
const WATER_FALL_IDS = [];
for (let level = 1; level <= WATER_MAX_FLOW; level++) {
  WATER_FLOW_IDS.push(B['WATER_FLOW_' + level]);
  WATER_FALL_IDS.push(B['WATER_FALL_' + level]);
}

/**
 * What a cell is worth to the neighbour beside it as a supply of water: a source
 * can fill anything, a resting sheet hands over a reach exactly one step thinner
 * than its own, and anything that is not water is worth nothing — which the code
 * reads as "no supply" rather than as level zero. A column pouring past feeds
 * nobody beside it, which is what keeps a waterfall a column instead of a fan of
 * water hanging in mid air.
 */
function waterSupply(id) {
  if (BLOCKS[id].falling) return Infinity;
  const level = BLOCKS[id].waterLevel;
  return level < 0 ? Infinity : level;
}

/**
 * What the cell above is worth to the cell it is pouring into: its own depth,
 * whichever kind of water it is. Water loses nothing by falling, which is why a
 * film pouring off a ledge arrives at the ground still a film, while a waterfall
 * that started at a source arrives with enough depth left to pool outwards. Every
 * step sideways costs a depth and every step down costs none, so a cell can only
 * ever be as deep as the shortest path from a source: nothing in here can invent
 * water, and a flood cannot breathe in and out forever looking for a level that
 * finally satisfies it.
 */
function waterSupplyFromAbove(id) {
  const level = BLOCKS[id].waterLevel;
  if (level < 0) return Infinity;
  return level === 0 ? 1 : level;
}

/**
 * Which block a cell wants to be, given the water around it. Everything here
 * reads the world as it stood when the tick began — the writes are applied
 * together afterwards — so the order the queue happens to come out in cannot
 * change how the water settles.
 */
export function desiredWaterLevel(x, y, z) {
  const id = world.getBlock(x, y, z);
  // A source is where the water comes from. It never thins, moves or dries,
  // which is why an ocean can sit there for free until something digs. Nothing
  // down here ever makes a new one either: Minecraft lets two sources breed a
  // third, and here that would let a sea print sources along its own coast, one
  // dig at a time, until the land was under water.
  if (id === B.WATER) return B.WATER;
  // The queue holds every neighbour an edit touched, solid ground among them,
  // and only empty cells and water itself take part in the flow: a wall is
  // never the thing a flood turns into, and a shore does not dissolve.
  if (!isWater(id) && !waterCanOccupy(id)) return id;

  const below = world.getBlock(x, y - 1, z);
  const above = world.getBlock(x, y + 1, z);

  // What the four neighbours are worth: a source fills the cell outright, a
  // sheet hands over a reach one step thinner than its own, and a column
  // pouring past hands over nothing at all.
  let side = Infinity;
  for (const [dx, dz] of WATER_SIDES) {
    const supply = waterSupply(world.getBlock(x + dx, y, z + dz));
    if (supply + 1 < side) side = supply + 1;
  }

  // What the cell overhead is worth, and the two ways a cell can be held up:
  // ground or a source underneath it, or the body of a sheet that has itself
  // come to rest.
  const overhead = waterSupplyFromAbove(above);
  const best = Math.min(side, overhead);
  const lands = BLOCKS[below].solid || below === B.WATER;
  const rests = isFlowWater(below);
  // Overhead is pouring in whenever it is water on its way down: a fall, or the
  // source a fall came from. The source has to count here. A dig two blocks deep
  // under the sea leaves a neck of air with a sheet below it and nothing beside
  // it, which no other rule in here claims — so without this the neck dries, the
  // orphaned sheet thins away a rank at a time, and the recreated fall starts the
  // whole cycle again, forever.
  const fallsIn = isFallingWater(above) || above === B.WATER;

  // A sheet settles where the body can hold it up and a neighbour can feed it.
  if ((lands || rests) && side <= WATER_MAX_FLOW) return WATER_FLOW_IDS[best - 1];
  // The foot of a fall: ground stops the water here, so it pools out from here.
  if (lands && overhead <= WATER_MAX_FLOW) return WATER_FLOW_IDS[best - 1];
  // Nothing underneath at all, so keep dropping for as long as anything reaches
  // this cell. That is what makes a sheet running off the edge of a ledge pour
  // down instead of hanging there, and where a fall stops being one: water thin
  // as a film has no strength left to pour with, so a film simply ends.
  if (!lands && !rests && best <= WATER_MAX_FLOW) return WATER_FALL_IDS[best - 1];
  // A fall landing on water carries on down through it to the body below.
  if (rests && fallsIn && overhead <= WATER_MAX_FLOW) return WATER_FALL_IDS[overhead - 1];

  // Nothing reaches here: a sheet that was left behind runs off, air stays air.
  return B.AIR;
}

/**
 * Whether every cell this one reads is loaded. An unloaded chunk answers "air",
 * and taking that at face value would let the sea pour off the edge of the
 * loaded world, so such a cell waits instead.
 */
function waterNeighboursLoaded(x, y, z) {
  for (const [dx, dy, dz] of WATER_NEIGHBORS) {
    const ny = y + dy;
    if (ny < 0 || ny >= WORLD_HEIGHT) continue;
    const cx = Math.floor((x + dx) / CHUNK_SIZE);
    const cz = Math.floor((z + dz) / CHUNK_SIZE);
    const chunk = world.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.generated) return false;
  }
  return true;
}

let waterTimer = 0;

/**
 * Resolves one step of the queued water and writes it in a single batch.
 * Returns how many cells actually changed.
 */
export function waterTick() {
  const queue = world.waterQueue;
  if (queue.size === 0) {
    // Nothing is flowing, but a flood that just finished can still owe the
    // renderer a few chunks. Any caller that ticks the water is spending frames
    // on it, so this is where those frames pay off the debt.
    world.flushFlowRemesh(WATER_REMESH_IDLE_BUDGET);
    return 0;
  }

  // Swapping the queue out means water this pass wakes goes on next tick's
  // list, instead of a breach cascading across the world inside one pass.
  const cells = Array.from(queue);
  queue.clear();

  const edits = [];
  const moved = [];
  let looked = 0;

  for (const key of cells) {
    if (looked >= WATER_TICK_BUDGET) {
      // Over budget: the rest of the flood simply waits for the next tick.
      queue.add(key);
      continue;
    }
    const parts = key.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);

    if (!waterNeighboursLoaded(x, y, z)) {
      // Hold the cell on the list until the chunk arrives, which is what stops
      // the sea pouring off the edge of the loaded world. Past the limit it
      // leaves the queue but not the simulation: it is parked against its own
      // chunk, and the chunk turning up later is the wake-up call.
      const waited = (world.waterWait.get(key) ?? 0) + 1;
      if (waited < WATER_WAIT_LIMIT) {
        world.waterWait.set(key, waited);
        queue.add(key);
      } else {
        world.waterWait.delete(key);
        world.parkWater(x, y, z);
      }
      continue;
    }
    world.waterWait.delete(key);
    world.unparkWater(x, y, z);

    looked++;
    const id = world.getBlock(x, y, z);
    const next = desiredWaterLevel(x, y, z);
    if (next === id) continue;
    edits.push({ x, y, z, id: next });
    moved.push(x, y, z);
  }

  world.applyFlowEdits(edits);
  world.flushFlowRemesh();

  // Whatever changed is worth a neighbour's attention, and those neighbours
  // are cells the next tick should look at.
  for (let i = 0; i < moved.length; i += 3) {
    world.queueWaterAround(moved[i], moved[i + 1], moved[i + 2]);
  }
  return edits.length;
}

/**
 * The water clock. Only cells an edit disturbed are ever queued, so the cost
 * tracks how much water is moving and not how much water there is.
 */
export function updateWater(dt) {
  if (!world || dt <= 0) return 0;
  // A finished flood still owes the renderer a few meshes, so the clock keeps
  // running until that backlog is clear even though nothing is flowing.
  if (world.waterQueue.size === 0 && world.flowRemesh.size === 0) {
    waterTimer = 0;
    return 0;
  }

  waterTimer += dt;
  if (waterTimer < WATER_TICK_SECONDS) return 0;
  let ticks = Math.floor(waterTimer / WATER_TICK_SECONDS);
  waterTimer -= ticks * WATER_TICK_SECONDS;
  // A tab hidden for a minute should not spend that minute replaying water.
  if (ticks > 4) ticks = 4;

  let changed = 0;
  for (let i = 0; i < ticks; i++) {
    if (world.waterQueue.size > 0) changed += waterTick();
    else world.flushFlowRemesh(WATER_REMESH_IDLE_BUDGET);
    if (world.waterQueue.size === 0 && world.flowRemesh.size === 0) {
      waterTimer = 0;
      break;
    }
  }
  return changed;
}
