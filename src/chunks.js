/*
 * Chunk storage and the chunk manager: one byte array per 16x96x16 column, the
 * world that owns those columns, and the decision about which columns are in
 * memory, which are waiting their turn to be built, and which are far enough
 * away to let go. It also remembers every block the player changed, so that an
 * endless world can still be the same world tomorrow.
 *
 * This is the floor the rest of the game stands on. It asks world generation for
 * a column, the lighting engine to relight one, and the mesher for geometry, and
 * it never reaches the other way: the seams at the top of the file are how
 * anything above it gets a say in what happens down here.
 */

import * as THREE from 'three';
import { BLOCKS, createBlockEntity, isWater } from './blocks.js';
import {
  B, CHUNK_AREA, CHUNK_BUDGET_MS, CHUNK_SIZE, CHUNK_VOLUME, DATA_RADIUS, LIGHT_MAX,
  RENDER_DISTANCE, SEA_LEVEL, UNLOAD_RADIUS, WATER_NEIGHBORS, WATER_REMESH_BUDGET,
  WATER_REMESH_MS, WORLD_HEIGHT, WORLD_SEED, blockIndex, chunkKey
} from './config.js';
import { computeChunkLightLocal, propagateSeeds, updateLightForEdit } from './lighting.js';
import { buildChunkMesh } from './mesh.js';
import { scene } from './render.js';
import { generateChunk } from './worldgen.js';

/* Four things that let the chunk layer stop reaching up.

   Generation fills this layer, lighting and the mesher read it, and a block
   edit has to be remembered by persistence — but all three of those sit above
   it, and a bottom layer that calls the top is an import cycle with no bundler
   around to untangle it. So nothing above is named here: the first three are
   ways for a higher layer to leave something down here for a lower one to use,
   and the last is a call that was pointing the wrong way. */

/**
 * Whether the world differs from what was last written to storage. Everything
 * that changes what a save would contain — a block placed, a chest's contents,
 * a crop that grew — says so here, and persistence reads it from up there.
 */
let worldDirty = false;
export function markWorldDirty() { worldDirty = true; }
export function isWorldDirty() { return worldDirty; }
export function clearWorldDirty() { worldDirty = false; }

/**
 * Who wants to hear that a chunk has just been meshed. The mob layer gives a
 * freshly meshed chunk its herd, and the mesher has no business knowing that
 * animals are a thing.
 */
const chunkMeshedListeners = new Set();
export function onChunkMeshed(listener) { chunkMeshedListeners.add(listener); }
function notifyChunkMeshed(chunk) {
  for (const listener of chunkMeshedListeners) listener(chunk);
}

/**
 * The one way a chunk is given its geometry. The mesher is a function of a
 * world and a chunk and nothing else — it builds faces and stops — so the
 * announcement that there is now something solid to stand on belongs out here,
 * with whoever had to ask for the mesh in the first place.
 */
export function meshChunk(world, chunk) {
  buildChunkMesh(world, chunk);
  notifyChunkMeshed(chunk);
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOLUME);
    this.skyLight = new Uint8Array(CHUNK_VOLUME);
    this.blockLight = new Uint8Array(CHUNK_VOLUME);
    this.heightMap = new Uint8Array(CHUNK_AREA);
    this.generated = false;
    this.lit = false;
    this.lightSettled = false;
    this.meshed = false;
    this.meshes = [];
    /**
     * Set once this chunk's passive-mob spawn roll has been spent while the
     * player was close enough to see it. Unloading a chunk clears the flag, so
     * a grass field the player walks back over is free to be stocked again.
     */
    this.mobSpawnChecked = false;
    this.group = new THREE.Group();
    this.group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.group.name = 'chunk-' + cx + '-' + cz;
  }

  index(x, y, z) {
    return x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
  }

  getBlock(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE ||
        y < 0 || y >= WORLD_HEIGHT) return B.AIR;
    return this.blocks[this.index(x, y, z)];
  }

  setBlock(x, y, z, id) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE ||
        y < 0 || y >= WORLD_HEIGHT) return;
    this.blocks[this.index(x, y, z)] = id;
  }
}

export class World {
  constructor(seed) {
    this.seed = seed;
    this.chunks = new Map();
    this.centerX = null;
    this.centerZ = null;
    this.pendingGeneration = [];
    this.meshCandidates = [];
    this.generatedThisFrame = 0;
    this.meshedThisFrame = 0;
    /** Chunks whose baked light changed and need a mesh rebuild. */
    this.lightDirty = new Set();
    /** "x,y,z" -> block id. Survives chunk unload/regeneration. */
    this.overrides = new Map();
    /** chunk key -> Map(local block index -> block id). */
    this.overridesByChunk = new Map();
    /** World-space positions of placed torches, used for ember particles. */
    this.torches = new Set();
    /**
     * "x,y,z" -> state for the few blocks that hold things: furnaces keep an
     * input, fuel, output and their burn timers. Torch-style flags live in the
     * block id itself, so only real inventories need this.
     */
    this.blockEntities = new Map();
    /** "x,y,z" -> [dx, dz] front normal for blocks that have an orientation. */
    this.facings = new Map();
    /**
     * "x,y,z" -> every cell holding a wheat crop. Growth only ever needs to
     * look at this short list, and the stage itself lives in the block id.
     */
    this.crops = new Set();
    /**
     * "x,y,z" -> every water cell an edit disturbed. Only cells in here are
     * ever looked at, which is what keeps a sea as cheap as a puddle: the
     * ocean is a wall of sources that never re-evaluate on their own.
     */
    this.waterQueue = new Set();
    /** Same keys, counting ticks spent waiting on a chunk that is not loaded. */
    this.waterWait = new Map();
    /**
     * Cells that used up their wait on a chunk, keyed by the chunk they live in.
     * They are held here instead of dropped, so a chunk arriving later picks the
     * flood back up. That covers the two ways water can outlive its wake-up: the
     * player runs off mid-pour and the chunks unload, and a world quit mid-pour
     * and reloaded, which starts with an empty queue either way.
     */
    this.waterParked = new Map();
    /** Chunks the flow changed, waiting their turn at a mesh rebuild. */
    this.flowRemesh = new Set();
  }

  /**
   * Wakes the water that could care about an edit: the edited cell and its six
   * neighbours. Nothing else in the world is examined, so digging one block
   * beside a lake costs seven queue inserts and a handful of reads.
   */
  queueWaterAround(gx, gy, gz) {
    const queue = this.waterQueue;
    queue.add(gx + ',' + gy + ',' + gz);
    for (const [dx, dy, dz] of WATER_NEIGHBORS) {
      const ny = gy + dy;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      queue.add((gx + dx) + ',' + ny + ',' + (gz + dz));
    }
  }

  /** Whether any of the six cells beside this one holds water. */
  hasWaterNeighbour(gx, gy, gz) {
    for (const [dx, dy, dz] of WATER_NEIGHBORS) {
      const ny = gy + dy;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      if (isWater(this.getBlock(gx + dx, ny, gz + dz))) return true;
    }
    return false;
  }

  /**
   * Wakes the water a chunk arriving from the save can still act on, which is
   * bounded by the save and not by the world: sheets the simulation left
   * mid-pour, and emptied cells water has been waiting to fall into. Chunks
   * generated without a single saved edit are left asleep on purpose, so pure
   * worldgen still never moves on its own and a generated sea cave stays dry.
   */
  wakeSavedWater(cx, cz) {
    const overrides = this.overridesForChunk(cx, cz);
    if (!overrides) return 0;

    let woken = 0;
    for (const [index, id] of overrides) {
      const lx = index % CHUNK_SIZE;
      const row = (index - lx) / CHUNK_SIZE;
      const lz = row % CHUNK_SIZE;
      const y = (row - lz) / CHUNK_SIZE;
      if (y >= WORLD_HEIGHT) continue;
      const gx = cx * CHUNK_SIZE + lx;
      const gz = cz * CHUNK_SIZE + lz;
      if (!isWater(id) && !this.hasWaterNeighbour(gx, y, gz)) continue;
      this.queueWaterAround(gx, y, gz);
      woken++;
    }
    return woken;
  }

  /**
   * Holds a cell that ran out its wait, against the chunk it lives in. It costs
   * nothing to wait here, which is the whole point: the alternative was to
   * forget the cell and leave the flood frozen at the edge of the loaded world.
   */
  parkWater(gx, gy, gz) {
    const key = chunkKey(Math.floor(gx / CHUNK_SIZE), Math.floor(gz / CHUNK_SIZE));
    let parked = this.waterParked.get(key);
    if (!parked) {
      parked = new Set();
      this.waterParked.set(key, parked);
    }
    parked.add(gx + ',' + gy + ',' + gz);
  }

  /** Drops a parked cell now that something else is looking after it. */
  unparkWater(gx, gy, gz) {
    const key = chunkKey(Math.floor(gx / CHUNK_SIZE), Math.floor(gz / CHUNK_SIZE));
    const parked = this.waterParked.get(key);
    if (!parked) return;
    parked.delete(gx + ',' + gy + ',' + gz);
    if (parked.size === 0) this.waterParked.delete(key);
  }

  /** How many cells are waiting out a chunk that has not arrived. */
  parkedWaterCount() {
    let count = 0;
    for (const parked of this.waterParked.values()) count += parked.size;
    return count;
  }

  /**
   * Puts back every cell that gave up waiting on a chunk. A cell only ever
   * waits on its own chunk or one of the four beside it, which is why the
   * diagonals cannot be holding anything this arrival unblocks.
   */
  wakeParkedWater(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx !== 0 && dz !== 0) continue;
        const key = chunkKey(cx + dx, cz + dz);
        const parked = this.waterParked.get(key);
        if (!parked) continue;
        this.waterParked.delete(key);
        for (const cell of parked) this.waterQueue.add(cell);
      }
    }
  }

  /**
   * A chunk has just been generated. Everything the save left mid-flow gets
   * another look, and so does everything that had given up waiting on it. Both
   * the streaming path and the synchronous one call this, so a chunk cannot
   * arrive by one route and miss the wake the other would have given it.
   */
  wakeWaterOnArrival(cx, cz) {
    this.wakeParkedWater(cx, cz);
    return this.wakeSavedWater(cx, cz);
  }

  trackTorch(gx, gy, gz, oldId, newId) {
    const key = gx + ',' + gy + ',' + gz;
    if (newId === B.TORCH) this.torches.add(key);
    else if (oldId === B.TORCH) this.torches.delete(key);
  }

  /** Keeps the list of growing crops in step with block edits. */
  trackCrop(gx, gy, gz, oldId, newId) {
    if (BLOCKS[newId].crop === null && BLOCKS[oldId].crop === null) return;
    const key = gx + ',' + gy + ',' + gz;
    if (BLOCKS[newId].crop !== null) this.crops.add(key);
    else this.crops.delete(key);
  }

  /**
   * Keeps block entities and orientations in step with block edits. Swapping
   * a furnace for its lit variant keeps the same state, which is how burning
   * furnaces survive being redrawn. Doors keep an orientation without being
   * block entities, so facings outlive the blockEntity check here.
   */
  trackBlockEntity(gx, gy, gz, oldId, newId, facing = null) {
    const key = gx + ',' + gy + ',' + gz;
    const oldBlock = BLOCKS[oldId];
    const newBlock = BLOCKS[newId];

    if (!newBlock.blockEntity && !newBlock.facings) {
      if (oldBlock.blockEntity) this.blockEntities.delete(key);
      this.facings.delete(key);
      return;
    }
    if (!newBlock.blockEntity) {
      if (oldBlock.blockEntity) this.blockEntities.delete(key);
    } else {
      if (oldBlock.blockEntity !== newBlock.blockEntity) this.blockEntities.delete(key);
      if (!this.blockEntities.has(key)) {
        this.blockEntities.set(key, createBlockEntity(newBlock.blockEntity));
      }
    }
    if (facing) this.facings.set(key, facing);
    else if (!this.facings.has(key)) this.facings.set(key, [0, 1]);
  }

  /**
   * A door is one item across two cells. Whenever one half is destroyed by
   * something that bypasses normal breaking (an explosion), the far half
   * goes with it rather than hanging in the air.
   */
  clearDoorPartner(gx, gy, gz, id) {
    const half = BLOCKS[id].door;
    if (!half) return;
    const otherY = half === 'lower' ? gy + 1 : gy - 1;
    const other = this.getBlock(gx, otherY, gz);
    if (BLOCKS[other].door) this.setBlock(gx, otherY, gz, B.AIR);
  }

  /**
   * The bed's counterpart to clearDoorPartner: the far cell lies along the
   * facing rather than above, but a bed destroyed by an explosion loses
   * both cells all the same.
   */
  clearBedPartner(gx, gy, gz, id) {
    const part = BLOCKS[id].bed;
    if (!part) return;
    const facing = this.facings.get(gx + ',' + gy + ',' + gz) ?? [0, 1];
    const sign = part === 'foot' ? 1 : -1;
    const otherX = gx + sign * facing[0];
    const otherZ = gz + sign * facing[1];
    const other = this.getBlock(otherX, gy, otherZ);
    if (BLOCKS[other].bed) this.setBlock(otherX, gy, otherZ, B.AIR);
  }

  /** Furnace state at a position, creating an empty one if it is missing. */
  blockEntityAt(gx, gy, gz, kind = null) {
    const key = gx + ',' + gy + ',' + gz;
    let entity = this.blockEntities.get(key);
    if (!entity && kind) {
      entity = createBlockEntity(kind);
      this.blockEntities.set(key, entity);
    }
    return entity ?? null;
  }

  facingAt(gx, gy, gz) {
    return this.facings.get(gx + ',' + gy + ',' + gz) ?? null;
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  overridesForChunk(cx, cz) {
    return this.overridesByChunk.get(chunkKey(cx, cz));
  }

  recordOverride(gx, gy, gz, id) {
    this.overrides.set(gx + ',' + gy + ',' + gz, id);
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    let chunkOverrides = this.overridesByChunk.get(key);
    if (!chunkOverrides) {
      chunkOverrides = new Map();
      this.overridesByChunk.set(key, chunkOverrides);
    }
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    chunkOverrides.set(blockIndex(lx, gy, lz), id);
    markWorldDirty();
  }

  /**
   * Re-insert one saved block edit during load. Chunks are not generated yet
   * at this point, so this only refills the override tables and torch set.
   */
  loadSavedOverride(cx, cz, index, id) {
    const lx = index % CHUNK_SIZE;
    const row = (index - lx) / CHUNK_SIZE;
    const lz = row % CHUNK_SIZE;
    const y = (row - lz) / CHUNK_SIZE;
    const key = chunkKey(cx, cz);
    let chunkOverrides = this.overridesByChunk.get(key);
    if (!chunkOverrides) {
      chunkOverrides = new Map();
      this.overridesByChunk.set(key, chunkOverrides);
    }
    chunkOverrides.set(index, id);
    const gx = cx * CHUNK_SIZE + lx;
    const gz = cz * CHUNK_SIZE + lz;
    this.overrides.set(gx + ',' + y + ',' + gz, id);
    this.trackTorch(gx, y, gz, B.AIR, id);
    this.trackBlockEntity(gx, y, gz, B.AIR, id);
    this.trackCrop(gx, y, gz, B.AIR, id);
  }

  /**
   * Edit a block in the world and remember the change. Recomputes lighting and
   * rebuilds this chunk's mesh plus any meshed neighbour across an edited border.
   * `facing` is the [dx, dz] front normal for blocks that have an orientation.
   */
  setBlock(gx, gy, gz, id, facing = null) {
    if (gy < 0 || gy >= WORLD_HEIGHT) return false;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const oldId = this.getBlock(gx, gy, gz);
    this.recordOverride(gx, gy, gz, id);
    this.trackTorch(gx, gy, gz, oldId, id);
    this.trackBlockEntity(gx, gy, gz, oldId, id, facing);
    this.trackCrop(gx, gy, gz, oldId, id);

    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.generated) return true;

    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    chunk.blocks[blockIndex(lx, gy, lz)] = id;
    if (oldId !== id) updateLightForEdit(this, gx, gy, gz, oldId, id);
    this.rebuildAround(cx, cz, lx, lz);
    if (oldId !== id) this.queueWaterAround(gx, gy, gz);
    return true;
  }

  /**
   * Apply many block edits at once (explosions, large structures). Lighting is
   * updated per block, but each affected chunk is only re-meshed once at the end.
   */
  setBlocksBatch(edits) {
    const dirty = new Set();

    for (const edit of edits) {
      const { x: gx, y: gy, z: gz, id } = edit;
      if (gy < 0 || gy >= WORLD_HEIGHT) continue;
      const cx = Math.floor(gx / CHUNK_SIZE);
      const cz = Math.floor(gz / CHUNK_SIZE);
      const oldId = this.getBlock(gx, gy, gz);
      this.recordOverride(gx, gy, gz, id);
      this.trackTorch(gx, gy, gz, oldId, id);
      this.trackBlockEntity(gx, gy, gz, oldId, id);
      this.trackCrop(gx, gy, gz, oldId, id);
      if (oldId !== id && BLOCKS[oldId].door && !BLOCKS[id].door) {
        this.clearDoorPartner(gx, gy, gz, oldId);
      }
      if (oldId !== id && BLOCKS[oldId].bed && !BLOCKS[id].bed) {
        this.clearBedPartner(gx, gy, gz, oldId);
      }
      const chunk = this.chunks.get(chunkKey(cx, cz));
      if (!chunk || !chunk.generated) continue;

      const lx = gx - cx * CHUNK_SIZE;
      const lz = gz - cz * CHUNK_SIZE;
      chunk.blocks[blockIndex(lx, gy, lz)] = id;
      if (oldId !== id) updateLightForEdit(this, gx, gy, gz, oldId, id);

      dirty.add(chunkKey(cx, cz));
      if (lx === 0) dirty.add(chunkKey(cx - 1, cz));
      if (lx === CHUNK_SIZE - 1) dirty.add(chunkKey(cx + 1, cz));
      if (lz === 0) dirty.add(chunkKey(cx, cz - 1));
      if (lz === CHUNK_SIZE - 1) dirty.add(chunkKey(cx, cz + 1));
      if (oldId !== id) this.queueWaterAround(gx, gy, gz);
    }

    for (const key of dirty) {
      const chunk = this.chunks.get(key);
      if (!chunk || !chunk.generated || !chunk.meshed) continue;
      meshChunk(this, chunk);
      this.lightDirty.delete(key);
    }
    return dirty.size;
  }

  /**
   * Writes the outcome of one water tick. Shaped like setBlocksBatch, minus
   * everything flowing water cannot touch: it only ever replaces air, so there
   * are no drops, torches, crops, doors or block entities to unwind. It also
   * skips the light engine on purpose, because air and water are both
   * non-opaque and neither glows, so updateLightForEdit would return
   * immediately for every single cell.
   */
  applyFlowEdits(edits) {
    if (edits.length === 0) return 0;
    const dirty = new Set();

    for (const edit of edits) {
      const { x: gx, y: gy, z: gz, id } = edit;
      if (gy < 0 || gy >= WORLD_HEIGHT) continue;
      const cx = Math.floor(gx / CHUNK_SIZE);
      const cz = Math.floor(gz / CHUNK_SIZE);
      const key = chunkKey(cx, cz);
      const chunk = this.chunks.get(key);
      // An unloaded chunk holds nothing to change, and the saved override
      // would resurrect water the simulation never actually moved.
      if (!chunk || !chunk.generated) continue;

      const lx = gx - cx * CHUNK_SIZE;
      const lz = gz - cz * CHUNK_SIZE;
      const index = blockIndex(lx, gy, lz);
      if (chunk.blocks[index] === id) continue;
      chunk.blocks[index] = id;
      this.recordOverride(gx, gy, gz, id);

      dirty.add(key);
      if (lx === 0) dirty.add(chunkKey(cx - 1, cz));
      if (lx === CHUNK_SIZE - 1) dirty.add(chunkKey(cx + 1, cz));
      if (lz === 0) dirty.add(chunkKey(cx, cz - 1));
      if (lz === CHUNK_SIZE - 1) dirty.add(chunkKey(cx, cz + 1));
      // A water surface is averaged over the four cells that meet at each of its
      // corners, so a cell in the corner of a chunk also moves the corner of the
      // chunk diagonally beside it. Solid faces only ever care about the six
      // neighbours, which is why the edits above stop at the edges.
      if (lx === 0 && lz === 0) dirty.add(chunkKey(cx - 1, cz - 1));
      if (lx === 0 && lz === CHUNK_SIZE - 1) dirty.add(chunkKey(cx - 1, cz + 1));
      if (lx === CHUNK_SIZE - 1 && lz === 0) dirty.add(chunkKey(cx + 1, cz - 1));
      if (lx === CHUNK_SIZE - 1 && lz === CHUNK_SIZE - 1) dirty.add(chunkKey(cx + 1, cz + 1));
    }

    for (const key of dirty) this.flowRemesh.add(key);
    return edits.length;
  }

  /**
   * Rebuilds chunks waiting on the water, at most `budget` of them or until
   * `msBudget` milliseconds have gone by. A spreading flood can dirty a dozen
   * chunks a tick, and one mesh costs more than the whole simulation does, so
   * the backlog works off over the next few ticks instead of turning one dig
   * into a stutter. A chunk that goes away meanwhile simply drops off the list.
   */
  flushFlowRemesh(budget = WATER_REMESH_BUDGET, msBudget = WATER_REMESH_MS) {
    const started = performance.now();
    let built = 0;
    for (const key of this.flowRemesh) {
      this.flowRemesh.delete(key);
      const chunk = this.chunks.get(key);
      if (!chunk || !chunk.generated || !chunk.meshed) continue;
      meshChunk(this, chunk);
      this.lightDirty.delete(key);
      built++;
      // Checking the clock only after a mesh keeps it honest: the loop cannot
      // decide to quit before it has spent any time at all.
      if (built >= budget || performance.now() - started >= msBudget) break;
    }
    return built;
  }

  rebuildAround(cx, cz, lx, lz) {
    const dirty = new Set([chunkKey(cx, cz)]);
    if (lx === 0) dirty.add(chunkKey(cx - 1, cz));
    if (lx === CHUNK_SIZE - 1) dirty.add(chunkKey(cx + 1, cz));
    if (lz === 0) dirty.add(chunkKey(cx, cz - 1));
    if (lz === CHUNK_SIZE - 1) dirty.add(chunkKey(cx, cz + 1));

    for (const key of dirty) {
      const chunk = this.chunks.get(key);
      if (!chunk || !chunk.generated || !chunk.meshed) continue;
      meshChunk(this, chunk);
      this.lightDirty.delete(key);
    }
  }

  ensureGenerated(cx, cz) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;

    chunk = new Chunk(cx, cz);
    this.chunks.set(key, chunk);
    generateChunk(chunk, this.overridesForChunk(cx, cz));
    chunk.generated = true;
    computeChunkLightLocal(chunk);
    chunk.lit = true;
    this.wakeWaterOnArrival(cx, cz);
    scene.add(chunk.group);
    chunk.group.visible = false;
    return chunk;
  }

  rebuildStreamingSets(pcx, pcz) {
    this.pendingGeneration.length = 0;
    this.meshCandidates.length = 0;

    for (let dz = -DATA_RADIUS; dz <= DATA_RADIUS; dz++) {
      for (let dx = -DATA_RADIUS; dx <= DATA_RADIUS; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const d2 = dx * dx + dz * dz;
        const chunk = this.chunks.get(chunkKey(cx, cz));

        if (!chunk || !chunk.generated) {
          this.pendingGeneration.push({ cx, cz, d2 });
        }

        if (Math.abs(dx) <= RENDER_DISTANCE && Math.abs(dz) <= RENDER_DISTANCE &&
            (!chunk || !chunk.meshed)) {
          this.meshCandidates.push({ cx, cz, d2 });
        }
      }
    }

    this.pendingGeneration.sort((a, b) => a.d2 - b.d2);
    this.meshCandidates.sort((a, b) => a.d2 - b.d2);
  }

  unloadFar(pcx, pcz) {
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - pcx) <= UNLOAD_RADIUS &&
          Math.abs(chunk.cz - pcz) <= UNLOAD_RADIUS) continue;

      for (const mesh of chunk.meshes) {
        chunk.group.remove(mesh);
        mesh.geometry.dispose();
      }
      chunk.meshes.length = 0;
      chunk.meshed = false;
      scene.remove(chunk.group);
      this.chunks.delete(key);
      this.lightDirty.delete(key);
    }
  }

  updateVisibility(pcx, pcz) {
    for (const chunk of this.chunks.values()) {
      const within = Math.abs(chunk.cx - pcx) <= RENDER_DISTANCE &&
        Math.abs(chunk.cz - pcz) <= RENDER_DISTANCE;
      chunk.group.visible = within && chunk.meshed;
    }
  }

  canMesh(chunk) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const neighbor = this.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
        if (!neighbor || !neighbor.generated) return false;
      }
    }
    return true;
  }

  processGeneration(budgetMs = CHUNK_BUDGET_MS) {
    const start = performance.now();
    this.generatedThisFrame = 0;

    while (this.pendingGeneration.length) {
      const job = this.pendingGeneration[0];
      const key = chunkKey(job.cx, job.cz);
      let chunk = this.chunks.get(key);

      if (!chunk || !chunk.generated) {
        if (!chunk) {
          chunk = new Chunk(job.cx, job.cz);
          this.chunks.set(key, chunk);
          scene.add(chunk.group);
        }
        generateChunk(chunk, this.overridesForChunk(job.cx, job.cz));
        chunk.generated = true;
        computeChunkLightLocal(chunk);
        chunk.lit = true;
        this.wakeWaterOnArrival(job.cx, job.cz);
        chunk.group.visible = false;
        this.generatedThisFrame++;
      }

      this.pendingGeneration.shift();
      if (performance.now() - start >= budgetMs) break;
    }
    return this.generatedThisFrame;
  }

  processMeshing(budgetMs = CHUNK_BUDGET_MS) {
    const start = performance.now();
    this.meshedThisFrame = 0;

    for (const job of this.meshCandidates) {
      const chunk = this.chunks.get(chunkKey(job.cx, job.cz));
      if (!chunk || !chunk.generated || chunk.meshed) continue;
      if (!this.canMesh(chunk)) continue;

      if (!chunk.lightSettled) {
        this.spreadLightAround(chunk.cx, chunk.cz);
        chunk.lightSettled = true;
      }
      meshChunk(this, chunk);
      chunk.group.visible = true;
      this.lightDirty.delete(chunkKey(chunk.cx, chunk.cz));
      this.meshedThisFrame++;
      if (performance.now() - start >= budgetMs) break;
    }
    return this.meshedThisFrame;
  }

  /** Rebuild meshes whose baked light changed, nearest work first. */
  processLightDirty(budgetMs = CHUNK_BUDGET_MS) {
    if (this.lightDirty.size === 0) return 0;
    const start = performance.now();
    let rebuilt = 0;

    for (const key of this.lightDirty) {
      const chunk = this.chunks.get(key);
      this.lightDirty.delete(key);
      if (!chunk || !chunk.generated || !chunk.meshed) continue;
      meshChunk(this, chunk);
      rebuilt++;
      if (performance.now() - start >= budgetMs) break;
    }
    return rebuilt;
  }

  /**
   * Pull light across chunk borders. Only border cells whose neighbour is
   * actually darker are seeded, so a freshly generated chunk costs little when
   * its sky light already matches the surrounding terrain.
   */
  spreadLightAround(cx, cz) {
    const skySeeds = [];
    const blockSeeds = [];

    const consider = (seeds, level, neighborLevel, wx, y, wz) => {
      if (level > 1 && neighborLevel < level - 1) {
        seeds.push({ x: wx, y, z: wz, level });
      }
    };

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (!chunk || !chunk.generated) continue;

        const west = this.chunks.get(chunkKey(cx + dx - 1, cz + dz));
        const east = this.chunks.get(chunkKey(cx + dx + 1, cz + dz));
        const north = this.chunks.get(chunkKey(cx + dx, cz + dz + 1));
        const south = this.chunks.get(chunkKey(cx + dx, cz + dz - 1));
        const baseX = (cx + dx) * CHUNK_SIZE;
        const baseZ = (cz + dz) * CHUNK_SIZE;
        const sky = chunk.skyLight;
        const block = chunk.blockLight;

        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const rowBase = y * CHUNK_SIZE * CHUNK_SIZE;
          const opposite = CHUNK_SIZE - 1;

          for (let i = 0; i < CHUNK_SIZE; i++) {
            const southIndex = i + rowBase;
            const northIndex = i + opposite * CHUNK_SIZE + rowBase;
            const westIndex = i * CHUNK_SIZE + rowBase;
            const eastIndex = opposite + i * CHUNK_SIZE + rowBase;

            if (south) {
              const skyLevel = sky[southIndex];
              const blockLevel = block[southIndex];
              const wx = baseX + i;
              consider(skySeeds, skyLevel, south.skyLight[i + opposite * CHUNK_SIZE + rowBase], wx, y, baseZ);
              consider(blockSeeds, blockLevel, south.blockLight[i + opposite * CHUNK_SIZE + rowBase], wx, y, baseZ);
            }
            if (north) {
              const skyLevel = sky[northIndex];
              const blockLevel = block[northIndex];
              const wx = baseX + i;
              const wz = baseZ + opposite;
              consider(skySeeds, skyLevel, north.skyLight[i + rowBase], wx, y, wz);
              consider(blockSeeds, blockLevel, north.blockLight[i + rowBase], wx, y, wz);
            }
            if (west) {
              const skyLevel = sky[westIndex];
              const blockLevel = block[westIndex];
              const wz = baseZ + i;
              consider(skySeeds, skyLevel, west.skyLight[opposite + i * CHUNK_SIZE + rowBase], baseX, y, wz);
              consider(blockSeeds, blockLevel, west.blockLight[opposite + i * CHUNK_SIZE + rowBase], baseX, y, wz);
            }
            if (east) {
              const skyLevel = sky[eastIndex];
              const blockLevel = block[eastIndex];
              const wz = baseZ + i;
              const wx = baseX + opposite;
              consider(skySeeds, skyLevel, east.skyLight[i * CHUNK_SIZE + rowBase], wx, y, wz);
              consider(blockSeeds, blockLevel, east.blockLight[i * CHUNK_SIZE + rowBase], wx, y, wz);
            }
          }
        }
      }
    }

    propagateSeeds(this, 'sky', skySeeds);
    propagateSeeds(this, 'block', blockSeeds);
  }

  updateStreaming(px, pz) {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);

    if (pcx !== this.centerX || pcz !== this.centerZ) {
      this.centerX = pcx;
      this.centerZ = pcz;
      this.rebuildStreamingSets(pcx, pcz);
      this.unloadFar(pcx, pcz);
      this.updateVisibility(pcx, pcz);
    }

    const start = performance.now();
    this.processGeneration(CHUNK_BUDGET_MS - (performance.now() - start));
    this.processMeshing(CHUNK_BUDGET_MS - (performance.now() - start));
    this.processLightDirty(CHUNK_BUDGET_MS - (performance.now() - start));
  }

  flushStreaming(px, pz) {
    this.centerX = null;
    this.updateStreaming(px, pz);
    const savedPending = this.pendingGeneration.length;
    const savedCandidates = this.meshCandidates.length;
    this.processGeneration(Infinity);
    this.processMeshing(Infinity);
    this.processLightDirty(Infinity);
    this.updateVisibility(this.centerX, this.centerZ);
    return { generated: savedPending, candidates: savedCandidates };
  }

  getBlock(gx, gy, gz) {
    if (gy < 0) return B.BEDROCK;
    if (gy >= WORLD_HEIGHT) return B.AIR;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return B.AIR;
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    return chunk.blocks[lx + CHUNK_SIZE * (lz + CHUNK_SIZE * gy)];
  }

  isOpaque(gx, gy, gz) {
    return BLOCKS[this.getBlock(gx, gy, gz)].opaque;
  }

  getSkyLight(gx, gy, gz) {
    if (gy >= WORLD_HEIGHT) return LIGHT_MAX;
    if (gy < 0) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return 0;
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    return chunk.skyLight[lx + CHUNK_SIZE * (lz + CHUNK_SIZE * gy)];
  }

  setSkyLight(gx, gy, gz, level) {
    if (gy < 0 || gy >= WORLD_HEIGHT) return false;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    const index = lx + CHUNK_SIZE * (lz + CHUNK_SIZE * gy);
    if (chunk.skyLight[index] === level) return false;
    chunk.skyLight[index] = level;
    this.lightDirty.add(chunkKey(cx, cz));
    return true;
  }

  getBlockLight(gx, gy, gz) {
    if (gy < 0 || gy >= WORLD_HEIGHT) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return 0;
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    return chunk.blockLight[lx + CHUNK_SIZE * (lz + CHUNK_SIZE * gy)];
  }

  setBlockLight(gx, gy, gz, level) {
    if (gy < 0 || gy >= WORLD_HEIGHT) return false;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    const index = lx + CHUNK_SIZE * (lz + CHUNK_SIZE * gy);
    if (chunk.blockLight[index] === level) return false;
    chunk.blockLight[index] = level;
    this.lightDirty.add(chunkKey(cx, cz));
    return true;
  }

  surfaceY(gx, gz) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(gx, y, gz);
      if (id !== B.AIR && !isWater(id) && id !== B.LEAVES) return y;
    }
    return SEA_LEVEL;
  }
}

/**
 * The one world. Every function in this file is a function of a world, in and
 * out, and none of them reads this line — but the layers above need the very
 * object those functions get handed, and used to keep it up there and pass it
 * back down. A world is decided by its seed alone, and the seed is configured,
 * so the decision belongs down here beside the class rather than up there:
 * nothing in a constructor but empty maps and counters, so nothing happens at
 * load beyond deciding which world the game is standing on.
 */
export const world = new World(WORLD_SEED);
