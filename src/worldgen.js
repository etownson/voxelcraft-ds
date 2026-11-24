/*
 * How a column of the world is decided from its coordinates alone: height, biome,
 * stone and ores, the trees on top, the bedrock underneath. All of it is a pure
 * function of x, z and the seed, which is the only reason a chunk rebuilds
 * identically after it is unloaded, after a reload, or on someone else's machine.
 * Nothing here talks to a chunk: world generation answers questions about a
 * column, and the chunk manager decides what to do with the answer.
 */

import { isWater } from './blocks.js';
import {
  AQUIFER_BAND, AQUIFER_DRY_BELOW, AQUIFER_SCALE, AQUIFER_TABLES,
  B, CHUNK_SIZE, LAVA_LEVEL, ORE_SALT_COAL, ORE_SALT_DIAMOND, ORE_SALT_IRON, SEA_LEVEL, TREE_MARGIN,
  TREE_SALT, WATER_SIDES, WORLD_HEIGHT, WORLD_SEED, blockIndex, clamp, lerp, smoothstep
} from './config.js';
import {
  aquiferNoise, caveNoiseA, caveNoiseB, cavernNoise, chunkRandom, detailNoise, hash3i, humidNoise,
  mountainNoise, mulberry32, riverNoise, tempNoise, terrainNoise
} from './noise.js';

function classifyBiome(height, temp, humid) {
  if (height < SEA_LEVEL - 1) return 'ocean';
  if (height <= SEA_LEVEL + 1) return 'beach';
  if (height > SEA_LEVEL + 38) return 'snowy_mountain';
  if (height > SEA_LEVEL + 30) {
    return temp < 0.12 ? 'snowy_mountain' : 'highlands';
  }
  if (temp > 0.12 && humid < -0.06) return 'desert';
  if (temp > 0.08 && humid > 0.1) return 'rainforest';
  if (humid > -0.02) return 'forest';
  return 'plains';
}

/**
 * Sample all terrain and climate values for one world column. Biome boundaries
 * only affect materials and tree density; height comes from continuous noise,
 * so neighbouring biomes always meet without walls or seams.
 */
export function sampleColumn(wx, wz) {
  const continent = terrainNoise.fbm2(wx * 0.0042, wz * 0.0042, 4, 2.0, 0.5);
  const detail = detailNoise.fbm2(wx * 0.021 + 417, wz * 0.021 - 913, 2, 2.0, 0.5);
  const ridge = terrainNoise.ridged2(wx * 0.0065 - 89, wz * 0.0065 + 271, 3);
  const mountainField = mountainNoise.fbm2(
    wx * 0.0035 + 1000, wz * 0.0035 - 2000, 3, 2.0, 0.5
  );
  const mountain = smoothstep(-0.05, 0.35, mountainField);

  let height = SEA_LEVEL + 4 + continent * 10 + detail * 2.5 +
    (ridge - 0.45) * 5 + mountain * (14 + ridge * 30);

  // Rivers cut winding channels toward sea level in low and mid terrain.
  const river = riverNoise.fbm2(wx * 0.0032, wz * 0.0032, 2, 2.0, 0.5);
  const riverMask = 1 - smoothstep(0.012, 0.045, Math.abs(river));
  const lowland = 1 - smoothstep(SEA_LEVEL + 6, SEA_LEVEL + 30, height);
  const riverCarve = riverMask * lowland;
  if (riverCarve > 0 && height > SEA_LEVEL - 2) {
    height = lerp(height, SEA_LEVEL - 2, riverCarve * 0.85);
  }

  height = clamp(Math.round(height), 5, WORLD_HEIGHT - 5);

  const temp = tempNoise.fbm2(wx * 0.0022 + 300, wz * 0.0022 - 700, 3, 2.0, 0.5);
  const humid = humidNoise.fbm2(wx * 0.0025 - 900, wz * 0.0025 + 400, 3, 2.0, 0.5);

  return {
    height,
    temp,
    humid,
    biome: classifyBiome(height, temp, humid)
  };
}

export function terrainHeight(wx, wz) {
  return sampleColumn(wx, wz).height;
}

/** Shared cave test so spawn selection and chunk carving agree exactly. */
export function caveCarvesAt(wx, y, wz) {
  const depth = clamp((SEA_LEVEL + 6 - y) / 45, 0, 1);
  const tunnelA = 0.004 + depth * 0.035;
  const tunnelB = (0.0035 + depth * 0.03) * 0.9;

  const n1 = caveNoiseA.noise3(wx * 0.045, y * 0.075, wz * 0.045);
  const n2 = caveNoiseB.noise3(wx * 0.062 + 100, y * 0.088, wz * 0.062 - 50);
  if (Math.abs(n1) < tunnelA || Math.abs(n2) < tunnelB) return true;

  if (y < SEA_LEVEL + 8) {
    const cavern = cavernNoise.noise3(wx * 0.019, y * 0.034, wz * 0.019);
    if (cavern > 0.5) return true;
  }

  return false;
}

/**
 * Would hollowing out this cell open the cave to the sea? Terrain generates
 * water in every column from its own surface up to sea level, so a cut touches
 * water if the cell overhead belongs to a flooded column, or if one of the four
 * neighbouring columns is flooded down to this height.
 *
 * Both cases have to be refused. One block of sand left between the sea and a
 * new cave is not enough, because the sea is nothing but sources and the flow
 * only ever starts where an edit reaches: leave a breach and the first dig near
 * the shore — or a flood from a bucket a hundred blocks away — sets the whole
 * ocean pouring into the underground. Caves are meant to stay as the generator
 * left them until the player breaks into the water himself.
 */
function cutOpensSea(chunk, x, z, y, h) {
  if (y > SEA_LEVEL) return false;
  // Overhead: the loop only ever cuts at or below the surface, so the cell
  // above is water exactly when this is the surface block of a flooded shore.
  if (y === h && y + 1 <= SEA_LEVEL) return true;

  const wx = chunk.cx * CHUNK_SIZE + x;
  const wz = chunk.cz * CHUNK_SIZE + z;
  for (const [dx, dz] of WATER_SIDES) {
    // A neighbour column holds water at this height once its own surface sits
    // below it. Queried from the terrain model rather than the chunk, since the
    // neighbouring column may well be in a chunk that is not generated yet.
    if (sampleColumn(wx + dx, wz + dz).height < y) return true;
  }
  return false;
}

/**
 * The water table under a column, or -1 where the region is dry. Every column
 * in one band of the aquifer field shares a table, so a region floods to a
 * single level.
 */
export function waterTableAt(wx, wz) {
  const n = aquiferNoise.noise2(wx * AQUIFER_SCALE + 31.7, wz * AQUIFER_SCALE - 12.3);
  if (n < AQUIFER_DRY_BELOW) return -1;
  const band = Math.floor((n - AQUIFER_DRY_BELOW) / AQUIFER_BAND);
  return AQUIFER_TABLES[Math.min(band, AQUIFER_TABLES.length - 1)];
}

/** What a cave cut at height y holds under a column with this table. */
function caveFill(table, y) {
  if (y <= table) return B.WATER;
  if (y <= LAVA_LEVEL) return B.LAVA;
  return B.AIR;
}

/**
 * Would this cut put a cave beside another region's cave holding something
 * else at the same height? Inside one region the pools are settled for the
 * same reason the lava level is: every cut under the table is filled. Across a
 * border they would not be — water beside air pours, water beside lava
 * hardens — so both sides refuse the cut and the border keeps a wall of stone.
 * The four sides are enough: a column shares its table top to bottom, and
 * fluid only moves sideways and down.
 */
function cutCrossesAquifer(tables, x, z, y, fill, wx, wz) {
  for (const [dx, dz] of WATER_SIDES) {
    const table = tables[(x + 1 + dx) + (z + 1 + dz) * (CHUNK_SIZE + 2)];
    if (caveFill(table, y) === fill) continue;
    if (caveCarvesAt(wx + dx, y, wz + dz)) return true;
  }
  return false;
}

/**
 * Carve connected spaghetti tunnels and occasional larger caverns. A cut fills
 * with what its region holds at that height: water up to the region's table,
 * lava at or below LAVA_LEVEL in a dry region, air everywhere else. The sea
 * test still applies, so no cave fluid is ever generated against the sea.
 */
function carveCaves(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const blocks = chunk.blocks;

  // Tables for this chunk's columns and the ring around it, so the border test
  // never asks the noise twice for one column.
  const tables = new Int8Array((CHUNK_SIZE + 2) * (CHUNK_SIZE + 2));
  for (let z = -1; z <= CHUNK_SIZE; z++) {
    for (let x = -1; x <= CHUNK_SIZE; x++) {
      tables[(x + 1) + (z + 1) * (CHUNK_SIZE + 2)] = waterTableAt(baseX + x, baseZ + z);
    }
  }

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const h = chunk.heightMap[x + z * CHUNK_SIZE];
      const wx = baseX + x;
      const wz = baseZ + z;
      const table = tables[(x + 1) + (z + 1) * (CHUNK_SIZE + 2)];

      for (let y = 4; y <= h; y++) {
        const index = blockIndex(x, y, z);
        const id = blocks[index];
        if (id === B.AIR || isWater(id) || id === B.BEDROCK) continue;
        if (!caveCarvesAt(wx, y, wz)) continue;
        // A cave that starts out touching the sea is a cave the simulation then
        // has to flood, so no cut here may reach the water.
        if (cutOpensSea(chunk, x, z, y, h)) continue;
        const fill = caveFill(table, y);
        if (cutCrossesAquifer(tables, x, z, y, fill, wx, wz)) continue;
        blocks[index] = fill;
      }
    }
  }
}

/** Fill a small random-walk vein, replacing only stone. */
function carveOreVein(chunk, rand, blockId, size, minY, maxY, deepBias = false) {
  let x = Math.floor(rand() * CHUNK_SIZE);
  let z = Math.floor(rand() * CHUNK_SIZE);
  let y = deepBias
    ? minY + Math.floor(Math.pow(rand(), 1.7) * (maxY - minY))
    : minY + Math.floor(rand() * (maxY - minY));

  for (let step = 0; step < size; step++) {
    const index = blockIndex(x, y, z);
    if (chunk.blocks[index] === B.STONE) chunk.blocks[index] = blockId;

    const direction = Math.floor(rand() * 6);
    if (direction === 0) x++;
    else if (direction === 1) x--;
    else if (direction === 2) y++;
    else if (direction === 3) y--;
    else if (direction === 4) z++;
    else z--;

    x = clamp(x, 0, CHUNK_SIZE - 1);
    z = clamp(z, 0, CHUNK_SIZE - 1);
    y = clamp(y, minY, maxY);
  }
}

function generateOres(chunk) {
  const coalRand = chunkRandom(chunk.cx, chunk.cz, ORE_SALT_COAL);
  for (let vein = 0; vein < 14; vein++) {
    const size = 3 + Math.floor(coalRand() * 6);
    carveOreVein(chunk, coalRand, B.COAL_ORE, size, 4, WORLD_HEIGHT - 8);
  }

  const ironRand = chunkRandom(chunk.cx, chunk.cz, ORE_SALT_IRON);
  for (let vein = 0; vein < 8; vein++) {
    const size = 2 + Math.floor(ironRand() * 5);
    carveOreVein(chunk, ironRand, B.IRON_ORE, size, 4, WORLD_HEIGHT - 8, true);
  }

  // Diamonds only form in the deep rock, and the bias keeps most veins near
  // the bottom of the world so they stay a reward for digging.
  const diamondRand = chunkRandom(chunk.cx, chunk.cz, ORE_SALT_DIAMOND);
  for (let vein = 0; vein < 6; vein++) {
    const size = 2 + Math.floor(diamondRand() * 4);
    carveOreVein(chunk, diamondRand, B.DIAMOND_ORE, size, 4, 26, true);
  }
}

/** Deterministic tree lookup for a single world column. */
export function treeAt(wx, wz, column = null) {
  column ??= sampleColumn(wx, wz);
  if (column.height <= SEA_LEVEL + 1) return null;

  let density;
  let type = 'oak';
  if (column.biome === 'forest') {
    density = 0.035;
  } else if (column.biome === 'rainforest') {
    density = 0.055;
    type = 'jungle';
  } else if (column.biome === 'plains') {
    density = 0.012;
  } else {
    return null;
  }

  const roll = hash3i(wx, 0, wz, (WORLD_SEED ^ TREE_SALT) >>> 0) / 4294967296;
  if (roll >= density) return null;

  const rand = mulberry32(hash3i(wx, 1, wz, (WORLD_SEED ^ TREE_SALT) >>> 0));
  const trunkHeight = type === 'jungle'
    ? 8 + Math.floor(rand() * 4)
    : 5 + Math.floor(rand() * 3);

  return {
    x: wx,
    y: column.height + 1,
    z: wz,
    type,
    trunkHeight
  };
}

function placeTree(chunk, baseX, baseZ, tree) {
  const setTreeBlock = (wx, wy, wz, id) => {
    const lx = wx - baseX;
    const lz = wz - baseZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE ||
        wy < 1 || wy >= WORLD_HEIGHT) return;

    const index = blockIndex(lx, wy, lz);
    const current = chunk.blocks[index];

    if (id === B.LOG) {
      if (current === B.AIR || current === B.LEAVES) chunk.blocks[index] = B.LOG;
    } else if (current === B.AIR || current === B.LEAVES) {
      chunk.blocks[index] = B.LEAVES;
    }
  };

  for (let i = 0; i < tree.trunkHeight; i++) {
    setTreeBlock(tree.x, tree.y + i, tree.z, B.LOG);
  }

  const top = tree.y + tree.trunkHeight - 1;

  if (tree.type === 'jungle') {
    for (let dy = -1; dy <= 2; dy++) {
      const radius = dy <= 0 ? 3 : dy === 1 ? 2 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
          setTreeBlock(tree.x + dx, top + dy, tree.z + dz, B.LEAVES);
        }
      }
    }
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
        setTreeBlock(tree.x + dx, top - 2, tree.z + dz, B.LEAVES);
      }
    }
  } else {
    for (let dy = -2; dy <= 1; dy++) {
      const radius = dy < 1 ? 2 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
          setTreeBlock(tree.x + dx, top + dy, tree.z + dz, B.LEAVES);
        }
      }
    }
  }
}

/** Place trees whose trunks or canopies overlap this chunk. */
function generateTrees(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let wz = baseZ - TREE_MARGIN; wz < baseZ + CHUNK_SIZE + TREE_MARGIN; wz++) {
    for (let wx = baseX - TREE_MARGIN; wx < baseX + CHUNK_SIZE + TREE_MARGIN; wx++) {
      const tree = treeAt(wx, wz);
      if (!tree) continue;

      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
        if (chunk.blocks[blockIndex(lx, tree.y - 1, lz)] !== B.GRASS) continue;
      }

      placeTree(chunk, baseX, baseZ, tree);
    }
  }
}

export function generateChunk(chunk, overrides) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const blocks = chunk.blocks;

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const wx = baseX + x;
      const wz = baseZ + z;
      const column = sampleColumn(wx, wz);
      const h = column.height;
      chunk.heightMap[x + z * CHUNK_SIZE] = h;

      const sandy = column.biome === 'desert' || column.biome === 'beach' ||
        column.biome === 'ocean' || h <= SEA_LEVEL + 1;
      const rocky = column.biome === 'highlands';
      const snowy = column.biome === 'snowy_mountain';

      for (let y = 0; y < WORLD_HEIGHT; y++) {
        let id = B.AIR;
        if (y === 0) {
          id = B.BEDROCK;
        } else if (y <= 3) {
          const chance = [0, 80, 55, 30][y];
          id = hash3i(wx, y, wz, WORLD_SEED) % 100 < chance ? B.BEDROCK : B.STONE;
        } else if (y < h - 3) {
          id = B.STONE;
        } else if (y < h) {
          if (sandy) id = B.SAND;
          else if (rocky || snowy) id = B.STONE;
          else id = B.DIRT;
        } else if (y === h) {
          if (snowy) id = B.SNOW;
          else if (rocky) id = B.STONE;
          else if (sandy) id = B.SAND;
          else id = B.GRASS;
        } else if (y <= SEA_LEVEL) {
          id = B.WATER;
        }
        blocks[blockIndex(x, y, z)] = id;
      }
    }
  }

  carveCaves(chunk);
  generateOres(chunk);
  generateTrees(chunk);

  // Stored edits always win over procedural terrain, caves, ores, and trees.
  if (overrides) {
    for (const [index, id] of overrides) {
      blocks[index] = id;
    }
  }

  // Keep the height map useful after caves, trees, and edits.
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      let top = 0;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const id = blocks[blockIndex(x, y, z)];
        if (id !== B.AIR && !isWater(id) &&
            id !== B.LEAVES && id !== B.LOG) {
          top = y;
          break;
        }
      }
      chunk.heightMap[x + z * CHUNK_SIZE] = top;
    }
  }
}
