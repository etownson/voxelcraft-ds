/*
 * How a flood actually goes anywhere: water is seven depths thick rather than
 * one block, it pours straight down and spreads sideways into whatever will
 * take it, and it only ever moves from a cell something else has already fed.
 * Every rule lives in `desiredFluid`, which reads the eight cells around a
 * column and says what belongs there — full and source-shaped when an open
 * source is above it, shallower as the distance from that source grows, air
 * once nothing is left to refill it. `waterTick` applies that answer a budget of
 * cells at a time, with reads taken as the pass began and writes applied
 * together, because a flood that noticed its own first wave would spend the
 * whole afternoon chasing it.
 *
 * Lava runs on the very same rules with a shorter reach and a slower beat, and
 * the two fluids meet the way Minecraft's do: water reaching lava hardens it to
 * obsidian or cobblestone, and lava pouring onto water turns the water to stone.
 *
 * Cells are queued on the world, not here, so a chunk that unloads and returns
 * still knows what it was waiting for, and a cell whose neighbours are not
 * loaded yet is waited on rather than resolved against thin air — which is the
 * only reason water at a chunk border comes out the same on both sides. Meshes
 * are deferred through `flushFlowRemesh` for the same reason: the shape of the
 * surface is the renderer's business, and a flood that rebuilt every mesh it
 * touched would never finish flowing.
 */

import { BLOCKS, isLava, isWater, waterCanOccupy } from './blocks.js';
import { world } from './chunks.js';
import {
  B, CHUNK_SIZE, LAVA_MAX_FLOW, LAVA_TICK_EVERY, WATER_MAX_FLOW, WATER_NEIGHBORS,
  WATER_REMESH_IDLE_BUDGET, WATER_SIDES, WATER_TICK_BUDGET, WATER_TICK_SECONDS,
  WATER_WAIT_LIMIT, WORLD_HEIGHT, chunkKey
} from './config.js';

/* ---------- Water flow ---------- */

/**
 * The two fluids the one model runs. Each is a source id, its resting ranks
 * and the same ranks pouring downward, and how many ranks it reaches before it
 * gives out: seven for water, three for lava. Everything below reads its ids
 * from one of these, so a rule written for water is the same rule for lava.
 */
function fluidTable(name, source, prefix, maxFlow) {
  const flow = [];
  const fall = [];
  for (let level = 1; level <= maxFlow; level++) {
    flow.push(B[prefix + '_FLOW_' + level]);
    fall.push(B[prefix + '_FALL_' + level]);
  }
  return { name, source, flow, fall, maxFlow };
}
const WATER_FLUID = fluidTable('water', B.WATER, 'WATER', WATER_MAX_FLOW);
const LAVA_FLUID = fluidTable('lava', B.LAVA, 'LAVA', LAVA_MAX_FLOW);

/**
 * What a cell is worth to the neighbour beside it as a supply of this fluid: a
 * source can fill anything, a resting sheet hands over a reach exactly one step
 * thinner than its own, and anything that is not this fluid is worth nothing —
 * which the code reads as "no supply" rather than as level zero. Lava supplies
 * no water and water no lava. A column pouring past feeds nobody beside it,
 * which is what keeps a waterfall a column instead of a fan of water hanging in
 * mid air.
 */
function fluidSupply(fluid, id) {
  const block = BLOCKS[id];
  if (block.fluid !== fluid.name || block.falling) return Infinity;
  return block.fluidLevel;
}

/**
 * What the cell above is worth to the cell it is pouring into: its own depth,
 * whichever kind of this fluid it is. A fluid loses nothing by falling, which is
 * why a film pouring off a ledge arrives at the ground still a film, while a
 * waterfall that started at a source arrives with enough depth left to pool
 * outwards. Every step sideways costs a depth and every step down costs none, so
 * a cell can only ever be as deep as the shortest path from a source: nothing in
 * here can invent a fluid, and a flood cannot breathe in and out forever looking
 * for a level that finally satisfies it.
 */
function fluidSupplyFromAbove(fluid, id) {
  const block = BLOCKS[id];
  if (block.fluid !== fluid.name) return Infinity;
  return block.fluidLevel === 0 ? 1 : block.fluidLevel;
}

const isRestingOf = (fluid, id) =>
  BLOCKS[id].fluid === fluid.name && BLOCKS[id].fluidLevel > 0 && !BLOCKS[id].falling;
const isFallingOf = (fluid, id) => BLOCKS[id].fluid === fluid.name && BLOCKS[id].falling;

/**
 * Which rank of one fluid belongs in an empty or flowing cell, or air if none
 * reaches it. This is the whole of the flow model, and water and lava share it.
 */
function fluidReach(fluid, x, y, z, below, above) {
  const max = fluid.maxFlow;

  // What the four neighbours are worth: a source fills the cell outright, a
  // sheet hands over a reach one step thinner than its own, and a column
  // pouring past hands over nothing at all.
  let side = Infinity;
  for (const [dx, dz] of WATER_SIDES) {
    const supply = fluidSupply(fluid, world.getBlock(x + dx, y, z + dz));
    if (supply + 1 < side) side = supply + 1;
  }

  // What the cell overhead is worth, and the two ways a cell can be held up:
  // ground or a source underneath it, or the body of a sheet that has itself
  // come to rest. The other fluid holds nothing up: water falling onto lava
  // keeps falling into it, and the lava it lands in is what gives way.
  const overhead = fluidSupplyFromAbove(fluid, above);
  const best = Math.min(side, overhead);
  const lands = BLOCKS[below].solid || below === fluid.source;
  const rests = isRestingOf(fluid, below);
  // Overhead is pouring in whenever it is this fluid on its way down: a fall, or
  // the source a fall came from. The source has to count here. A dig two blocks
  // deep under the sea leaves a neck of air with a sheet below it and nothing
  // beside it, which no other rule in here claims — so without this the neck
  // dries, the orphaned sheet thins away a rank at a time, and the recreated
  // fall starts the whole cycle again, forever.
  const fallsIn = isFallingOf(fluid, above) || above === fluid.source;

  // A sheet settles where the body can hold it up and a neighbour can feed it.
  if ((lands || rests) && side <= max) return fluid.flow[best - 1];
  // The foot of a fall: ground stops the fluid here, so it pools out from here.
  if (lands && overhead <= max) return fluid.flow[best - 1];
  // Nothing underneath at all, so keep dropping for as long as anything reaches
  // this cell. That is what makes a sheet running off the edge of a ledge pour
  // down instead of hanging there, and where a fall stops being one: a film has
  // no strength left to pour with, so a film simply ends.
  if (!lands && !rests && best <= max) return fluid.fall[best - 1];
  // A fall landing on its own fluid carries on down through it to the body below.
  if (rests && fallsIn && overhead <= max) return fluid.fall[overhead - 1];

  // Nothing reaches here: a sheet that was left behind runs off, air stays air.
  return B.AIR;
}

/**
 * What lava becomes when water reaches it, or water when lava pours onto it,
 * given what this cell would otherwise be. Minecraft's three meetings, and the
 * only way either fluid ever turns into something solid:
 *
 * - lava with water beside it or on top of it hardens: a source into obsidian,
 *   any rank of flowing lava into cobblestone
 * - water with lava pouring in from overhead turns to stone, so a lavafall
 *   landing in a lake builds itself a plug instead of boiling the lake away
 *
 * Water below lava does nothing to the lava, which is Minecraft's rule too: the
 * lava pours down into it, and that is the water cell's meeting, not the lava's.
 * A solid never turns back into a fluid here, so every meeting is final and
 * the flood still has a fixed point to reach.
 */
function fluidsMeet(next, x, y, z, above) {
  if (isLava(next)) {
    let wet = isWater(above);
    for (const [dx, dz] of WATER_SIDES) {
      if (wet) break;
      wet = isWater(world.getBlock(x + dx, y, z + dz));
    }
    if (wet) return next === B.LAVA ? B.OBSIDIAN : B.COBBLESTONE;
  } else if (isWater(next) && isLava(above)) {
    return B.STONE;
  }
  return next;
}

/**
 * Which block a cell wants to be, given the fluids around it. Everything here
 * reads the world as it stood when the tick began — the writes are applied
 * together afterwards — so the order the queue happens to come out in cannot
 * change how a flood settles.
 */
export function desiredFluid(x, y, z) {
  const id = world.getBlock(x, y, z);
  const above = world.getBlock(x, y + 1, z);
  // A source is where a fluid comes from. It never thins, moves or dries, which
  // is why an ocean can sit there for free until something digs. Nothing down
  // here ever makes a new one either: Minecraft lets two water sources breed a
  // third, and here that would let a sea print sources along its own coast, one
  // dig at a time, until the land was under water. The one thing that happens
  // to a source is the other fluid arriving.
  if (id === B.WATER) return fluidsMeet(id, x, y, z, above);
  // Lava of any rank that water has reached hardens where it stands, before
  // anything asks whether water would flow in: water does not wash lava away.
  if (isLava(id)) {
    const met = fluidsMeet(id, x, y, z, above);
    if (met !== id || id === B.LAVA) return met;
  }
  // The queue holds every neighbour an edit touched, solid ground among them,
  // and only empty cells and fluid itself take part in the flow: a wall is
  // never the thing a flood turns into, and a shore does not dissolve.
  if (BLOCKS[id].fluid === null && !waterCanOccupy(id)) return id;

  const below = world.getBlock(x, y - 1, z);
  // Water is asked first, so a cell both fluids reach holds water — and the
  // lava beside it is the cell that hardens, on its own turn.
  let next = fluidReach(WATER_FLUID, x, y, z, below, above);
  if (next === B.AIR) next = fluidReach(LAVA_FLUID, x, y, z, below, above);
  return fluidsMeet(next, x, y, z, above);
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
/** Counts water ticks, so lava can move on every LAVA_TICK_EVERY-th of them. */
let fluidTicks = 0;

/**
 * Whether a change is lava moving, as opposed to lava hardening or water doing
 * anything at all. Only those changes wait for lava's slower beat: water
 * arriving must quench lava the tick it gets there, or a bucket poured on a
 * spill would find the spill still spreading under it.
 */
const isLavaMove = (id, next) => isLava(next) ||
  (isLava(id) && next === B.AIR) ||
  // Lava arriving beside water lands already hardened, but it is still lava
  // arriving, so it keeps lava's time.
  (BLOCKS[id].fluid === null && next === B.COBBLESTONE);

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
  fluidTicks++;
  const lavaBeat = fluidTicks % LAVA_TICK_EVERY === 0;

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
    const next = desiredFluid(x, y, z);
    if (next === id) continue;
    if (!lavaBeat && isLavaMove(id, next)) {
      // Lava keeps the cell on the list and waits for its own beat. Waiting
      // changes when it moves, never what it settles into.
      queue.add(key);
      continue;
    }
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
