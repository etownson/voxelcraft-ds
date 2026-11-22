/*
 * Voxel light: how much sky reaches a cell, and how much a torch adds to it.
 * Both are a flood fill over the same byte arrays the chunks hold, spread over
 * frames so that no one pass can stall one, and recomputed only in the columns
 * where a block actually changed. Every function here is handed the world it is
 * to read, which is why this file can sit under the chunk manager without
 * knowing that a world singleton exists.
 */

import { BLOCKS } from './blocks.js';
import { CHUNK_SIZE, CHUNK_VOLUME, LIGHT_MAX, WORLD_HEIGHT, blockIndex } from './config.js';

const LIGHT_NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];

/** Flood fill inside a single chunk's typed light array. */
function floodLocalLight(light, blocks, queue) {
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const level = light[i];
    if (level <= 1) continue;

    const y = (i / (CHUNK_SIZE * CHUNK_SIZE)) | 0;
    const rem = i - y * CHUNK_SIZE * CHUNK_SIZE;
    const z = rem >> 4;
    const x = rem & 15;

    const tryNeighbor = (nx, ny, nz) => {
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE ||
          ny < 0 || ny >= WORLD_HEIGHT) return;
      const ni = blockIndex(nx, ny, nz);
      if (BLOCKS[blocks[ni]].opaque) return;
      if (light[ni] >= level - 1) return;
      light[ni] = level - 1;
      queue.push(ni);
    };

    tryNeighbor(x + 1, y, z);
    tryNeighbor(x - 1, y, z);
    tryNeighbor(x, y, z + 1);
    tryNeighbor(x, y, z - 1);
    tryNeighbor(x, y + 1, z);
    tryNeighbor(x, y - 1, z);
  }
}

/**
 * Seed both light channels for one freshly generated chunk. Cross-chunk
 * propagation happens later in World.spreadLightAround(), once neighbours exist.
 */
export function computeChunkLightLocal(chunk) {
  const blocks = chunk.blocks;
  const sky = chunk.skyLight;
  const block = chunk.blockLight;
  sky.fill(0);
  block.fill(0);

  const skyQueue = [];
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const i = blockIndex(x, y, z);
        if (BLOCKS[blocks[i]].opaque) break;
        sky[i] = LIGHT_MAX;
        skyQueue.push(i);
      }
    }
  }
  floodLocalLight(sky, blocks, skyQueue);

  const blockQueue = [];
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    const emission = BLOCKS[blocks[i]].light ?? 0;
    if (emission > 0) {
      block[i] = emission;
      blockQueue.push(i);
    }
  }
  floodLocalLight(block, blocks, blockQueue);

  chunk.lit = true;
  chunk.lightSettled = false;
}

function getLightLevel(world, kind, x, y, z) {
  return kind === 'sky'
    ? world.getSkyLight(x, y, z)
    : world.getBlockLight(x, y, z);
}

function setLightLevel(world, kind, x, y, z, level) {
  return kind === 'sky'
    ? world.setSkyLight(x, y, z, level)
    : world.setBlockLight(x, y, z, level);
}

/** Add light at one cell and flood it outward across loaded chunks. */
function addLightBFS(world, kind, x, y, z, level) {
  if (level <= 0) return;
  level = Math.min(level, LIGHT_MAX);
  if (getLightLevel(world, kind, x, y, z) >= level) return;
  if (!setLightLevel(world, kind, x, y, z, level)) return;

  const queue = [{ x, y, z, level }];
  let head = 0;
  while (head < queue.length) {
    const cell = queue[head++];
    if (cell.level <= 1) continue;
    const nextLevel = cell.level - 1;

    for (const [dx, dy, dz] of LIGHT_NEIGHBORS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      const nz = cell.z + dz;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      if (BLOCKS[world.getBlock(nx, ny, nz)].opaque) continue;
      if (getLightLevel(world, kind, nx, ny, nz) >= nextLevel) continue;
      if (!setLightLevel(world, kind, nx, ny, nz, nextLevel)) continue;
      queue.push({ x: nx, y: ny, z: nz, level: nextLevel });
    }
  }
}

/** Flood a whole list of already-lit border cells without re-setting the seeds. */
export function propagateSeeds(world, kind, seeds) {
  const queue = seeds;
  let head = 0;
  while (head < queue.length) {
    const cell = queue[head++];
    if (cell.level <= 1) continue;
    const nextLevel = cell.level - 1;

    for (const [dx, dy, dz] of LIGHT_NEIGHBORS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      const nz = cell.z + dz;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      if (BLOCKS[world.getBlock(nx, ny, nz)].opaque) continue;
      if (getLightLevel(world, kind, nx, ny, nz) >= nextLevel) continue;
      if (!setLightLevel(world, kind, nx, ny, nz, nextLevel)) continue;
      queue.push({ x: nx, y: ny, z: nz, level: nextLevel });
    }
  }
}

/** Clear light that depended on a removed source, then refill from boundaries. */
function propagateLightRemoval(world, kind, removeQueue) {
  const addSeeds = [];
  let head = 0;
  while (head < removeQueue.length) {
    const cell = removeQueue[head++];

    for (const [dx, dy, dz] of LIGHT_NEIGHBORS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      const nz = cell.z + dz;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;

      const neighborLevel = getLightLevel(world, kind, nx, ny, nz);
      if (neighborLevel === 0) continue;

      if (neighborLevel < cell.level) {
        setLightLevel(world, kind, nx, ny, nz, 0);
        removeQueue.push({ x: nx, y: ny, z: nz, level: neighborLevel });
      } else {
        addSeeds.push({ x: nx, y: ny, z: nz, level: neighborLevel });
      }
    }
  }

  propagateSeeds(world, kind, addSeeds);
}

function removeLightBFS(world, kind, x, y, z) {
  const oldLevel = getLightLevel(world, kind, x, y, z);
  if (oldLevel <= 0) return;
  setLightLevel(world, kind, x, y, z, 0);
  propagateLightRemoval(world, kind, [{ x, y, z, level: oldLevel }]);
}

/** True when no opaque block sits above this cell. */
function isSkyOpen(world, x, y, z) {
  for (let yy = y + 1; yy < WORLD_HEIGHT; yy++) {
    if (BLOCKS[world.getBlock(x, yy, z)].opaque) return false;
  }
  return true;
}

function maxNeighborLight(world, kind, x, y, z) {
  let max = 0;
  for (const [dx, dy, dz] of LIGHT_NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (ny < 0 || ny >= WORLD_HEIGHT) continue;
    const level = getLightLevel(world, kind, nx, ny, nz);
    if (level > max) max = level;
  }
  return max;
}

/**
 * Place an opaque block: direct-sky columns below it lose their sunlight at the
 * same time, otherwise the standard removal BFS would treat them as sources.
 */
function removeSkyLightForPlacement(world, x, y, z) {
  const cellLevel = world.getSkyLight(x, y, z);
  if (cellLevel <= 0) return;

  const removeQueue = [];
  world.setSkyLight(x, y, z, 0);
  removeQueue.push({ x, y, z, level: cellLevel });

  if (cellLevel === LIGHT_MAX) {
    for (let yy = y - 1; yy >= 0; yy--) {
      if (BLOCKS[world.getBlock(x, yy, z)].opaque) break;
      const level = world.getSkyLight(x, yy, z);
      if (level !== LIGHT_MAX) break;
      world.setSkyLight(x, yy, z, 0);
      removeQueue.push({ x, y: yy, z, level });
    }
  }

  propagateLightRemoval(world, 'sky', removeQueue);
}

/** Open a new direct-sky column and flood its light sideways. */
function addSkyLightColumn(world, x, y, z) {
  const seeds = [];
  for (let yy = y; yy >= 0; yy--) {
    if (BLOCKS[world.getBlock(x, yy, z)].opaque) break;
    if (world.getSkyLight(x, yy, z) < LIGHT_MAX) {
      world.setSkyLight(x, yy, z, LIGHT_MAX);
    }
    seeds.push({ x, y: yy, z, level: LIGHT_MAX });
  }
  propagateSeeds(world, 'sky', seeds);
}

/** Apply all light bookkeeping for a block edit. */
export function updateLightForEdit(world, x, y, z, oldId, newId) {
  const oldBlock = BLOCKS[oldId];
  const newBlock = BLOCKS[newId];
  const oldEmission = oldBlock.light ?? 0;
  const newEmission = newBlock.light ?? 0;

  if (oldEmission > 0 && newEmission === 0) {
    removeLightBFS(world, 'block', x, y, z);
  } else if (newEmission > 0 && oldEmission === 0) {
    addLightBFS(world, 'block', x, y, z, newEmission);
  } else if (newEmission > 0 && oldEmission > 0 && newEmission !== oldEmission) {
    removeLightBFS(world, 'block', x, y, z);
    addLightBFS(world, 'block', x, y, z, newEmission);
  }

  if (oldBlock.opaque === newBlock.opaque) return;

  if (newBlock.opaque) {
    removeLightBFS(world, 'block', x, y, z);
    removeSkyLightForPlacement(world, x, y, z);
    return;
  }

  const blockLevel = maxNeighborLight(world, 'block', x, y, z) - 1;
  if (blockLevel > 0) addLightBFS(world, 'block', x, y, z, blockLevel);

  if (isSkyOpen(world, x, y, z)) {
    addSkyLightColumn(world, x, y, z);
  } else {
    const skyLevel = maxNeighborLight(world, 'sky', x, y, z) - 1;
    if (skyLevel > 0) addLightBFS(world, 'sky', x, y, z, skyLevel);
  }
}
