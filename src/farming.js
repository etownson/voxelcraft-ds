/*
 * How a field gets anywhere: wheat advances on a clock of its own — one attempt
 * per second of game time, per crop — and only where there is light and only
 * where the soil is wet. Dry ground is not slow here, it simply waits, which is
 * the half of Minecraft's farming rule everyone remembers; `isFarmlandWet` is
 * the test, and `FARMLAND_WET_REACH` how far water counts as near, a number the
 * screen repeats to anyone told their field is too dry.
 *
 * Nothing in here draws anything. The growth table, the light threshold and the
 * clock belong to the crop, so the page asks for `updateCrops` once a frame and
 * for wetness when it means to plant; which cells are wheat is the world's
 * business, and this layer only reads it and writes the next stage back.
 */

import { BLOCKS, isWater } from './blocks.js';
import { world } from './chunks.js';
import { B, CHUNK_SIZE, chunkKey } from './config.js';

/* ---------- Crops ---------- */

/** One growth attempt per crop per second of game time. */
const CROP_TICK_SECONDS = 1;

/**
 * About one attempt in eighty-five lands, so a single stage takes some 83 s and
 * a freshly sown field turns gold in ten real minutes, which is the pace a wheat
 * farm keeps in Minecraft.
 */
const CROP_GROWTH_CHANCE = 0.012;

/** Crops need daylight or a nearby torch, the same threshold Minecraft uses. */
const CROP_LIGHT_MIN = 9;

/**
 * How far water soaks sideways into the soil around it. Minecraft's rule: a
 * furrow drinks from any water in the 9×9 square at its own level or one
 * above, so a single canal four blocks off keeps a whole field wet.
 */
export const FARMLAND_WET_REACH = 4;

/**
 * True when water is close enough to soak a farmland cell. Any water counts —
 * the sea, a bucket poured along the headland, even a sheet of flow crossing
 * the field. The answer is read from the world every time, so a furrow wets
 * and dries the moment the water moves and there is no moisture value to keep
 * in the save. An unloaded neighbour reads as air, hence dry: a field whose
 * water is off-screen simply waits, the same courtesy the growth tick already
 * extends to crops in chunks the player walked away from.
 */
export function isFarmlandWet(x, y, z) {
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = -FARMLAND_WET_REACH; dx <= FARMLAND_WET_REACH; dx++) {
      for (let dz = -FARMLAND_WET_REACH; dz <= FARMLAND_WET_REACH; dz++) {
        if (isWater(world.getBlock(x + dx, y + dy, z + dz))) return true;
      }
    }
  }
  return false;
}

let cropTimer = 0;

/**
 * Advances wheat one stage at a time. Only crops the world has actually
 * generated are touched, so an unloaded field simply waits until the player
 * comes back for it.
 */
export function updateCrops(dt) {
  if (!world || dt <= 0 || world.crops.size === 0) return;

  cropTimer += dt;
  if (cropTimer < CROP_TICK_SECONDS) return;
  const ticks = Math.floor(cropTimer / CROP_TICK_SECONDS);
  cropTimer -= ticks * CROP_TICK_SECONDS;

  for (const key of world.crops) {
    const parts = key.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);

    // Reading an unloaded chunk would answer "air", which would read as a dead
    // crop and wipe a field the player merely walked away from. Wait instead.
    const chunk = world.chunks.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    if (!chunk || !chunk.generated) continue;

    const id = world.getBlock(x, y, z);
    const block = BLOCKS[id];
    if (block.crop === null) {
      world.crops.delete(key);
      continue;
    }

    // A crop whose farmland has been dug away is lost, as it is in Minecraft.
    if (world.getBlock(x, y - 1, z) !== B.FARMLAND) {
      world.setBlock(x, y, z, B.AIR);
      continue;
    }
    if (block.crop >= 7) continue;

    const sky = world.getSkyLight(x, y, z);
    const lamp = world.getBlockLight(x, y, z);
    if (sky < CROP_LIGHT_MIN && lamp < CROP_LIGHT_MIN) continue;

    // A dry furrow waits for water rather than dying. Minecraft lets a
    // bone-dry field crawl along at a twenty-fifth of the speed; here the soil
    // simply stops until water comes within reach, which is the part of the
    // rule every farmer actually remembers.
    if (!isFarmlandWet(x, y - 1, z)) continue;

    let stage = block.crop;
    for (let i = 0; i < ticks && stage < 7; i++) {
      if (Math.random() >= CROP_GROWTH_CHANCE) continue;
      stage += 1;
      world.setBlock(x, y, z, B.WHEAT_0 + stage);
    }
  }
}
