/*
 * The collision kernel: what a box hits. Which cells are solid, how a stair
 * cell leaves half of itself walkable, the one cell a body can stand inside
 * and still be held by, where the player's own box would overlap something,
 * and whether a point sits under a sheet of water or of lava.
 *
 * It reads the world through the chunk manager and nothing else, so it sits
 * beside the floor of the game rather than inside the player: mobs path by
 * the same rules, and a save has to know where the ground it wrote is solid.
 */

import { BLOCKS, fluidSurfaceHeight, isLava, isWater } from './blocks.js';
import { COLLISION_EPSILON, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './config.js';
import { world } from './chunks.js';

export const isSolid = (id) => BLOCKS[id].solid;

/**
 * True when the solid part of one cell intersects the world-space box given.
 * Every block is its whole cell except stairs, which are the one shape a
 * player can walk up: a half-tall box across the cell and the tall half
 * over the side away from the facing, the same two boxes that get drawn.
 */
export function cellCollidesAt(bx, by, bz, minX, maxX, minY, maxY, minZ, maxZ) {
  const id = world.getBlock(bx, by, bz);
  if (!isSolid(id)) return false;
  if (!BLOCKS[id].stairs) return true;
  if (minY < by + 0.5 && maxY > by) return true;
  if (minY < by + 1 && maxY > by + 0.5) {
    // The tall half lies on the far side of the facing. Project the box
    // onto the facing axis and see whether it reaches past the mid line:
    // the facings are axis-aligned, so this is exact.
    const facing = world.facingAt(bx, by, bz) ?? [0, 1];
    const centre = ((minX + maxX) * 0.5 - (bx + 0.5)) * facing[0] +
      ((minZ + maxZ) * 0.5 - (bz + 0.5)) * facing[1];
    const reach = Math.abs((maxX - minX) * 0.5 * facing[0]) +
      Math.abs((maxZ - minZ) * 0.5 * facing[1]);
    if (centre - reach < 0) return true;
  }
  return false;
}

/**
 * The wall-facing of the ladder holding a climber whose feet are at (x, y, z),
 * or null when nothing is. Minecraft carves a ladder out of the whole cell even
 * though its slab is a 3/16 plank against one wall: the block is what you climb,
 * not the plank. So a fall down a ladder shaft is caught wherever in the shaft
 * it happens, and a ladder is a way down as well as a way up.
 *
 * The feet decide, as they do in the game, with a hair of slack upwards so that
 * standing on the block at the foot of a ladder counts as standing in the cell
 * above it: collision leaves the feet a ten-thousandth under the surface.
 *
 * Deliberately not part of cellCollidesAt: a ladder stops nothing, and is the
 * one thing in the game a player can stand inside of.
 */
export function ladderHolding(x, y, z) {
  const bx = Math.floor(x);
  const by = Math.floor(y + 0.01);
  const bz = Math.floor(z);
  if (!BLOCKS[world.getBlock(bx, by, bz)].ladder) return null;
  // The facing is kept because a rung holds a climber against the wall it hangs
  // on: it is the axis the plank lies along.
  return world.facingAt(bx, by, bz) ?? [0, 1];
}

/**
 * True when the player's collision box would intersect a solid block with its
 * feet at (x, y, z). The box is shrunk by a tiny epsilon so standing exactly on
 * a block surface (or flush against a wall) does not count as a collision.
 */
export function playerCollidesAt(x, y, z) {
  const boxMinX = x - PLAYER_HALF_WIDTH + COLLISION_EPSILON;
  const boxMaxX = x + PLAYER_HALF_WIDTH - COLLISION_EPSILON;
  const boxMinY = y + COLLISION_EPSILON;
  const boxMaxY = y + PLAYER_HEIGHT - COLLISION_EPSILON;
  const boxMinZ = z - PLAYER_HALF_WIDTH + COLLISION_EPSILON;
  const boxMaxZ = z + PLAYER_HALF_WIDTH - COLLISION_EPSILON;
  const minX = Math.floor(boxMinX);
  const maxX = Math.floor(boxMaxX);
  const minY = Math.floor(boxMinY);
  const maxY = Math.floor(boxMaxY);
  const minZ = Math.floor(boxMinZ);
  const maxZ = Math.floor(boxMaxZ);

  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        if (cellCollidesAt(bx, by, bz, boxMinX, boxMaxX, boxMinY, boxMaxY, boxMinZ, boxMaxZ)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Whether a point sits inside a fluid that passes `test`, respecting how deep
 * the sheet actually is. Wading through a finger of runoff wetting the boots is
 * not the same as being under, which is what keeps the screen clear while the
 * head is in the air.
 */
function insideFluidAt(x, y, z, test) {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  const id = world.getBlock(bx, by, bz);
  if (!test(id)) return false;
  // The same fluid above means this cell is buried in the body, so it is full.
  if (test(world.getBlock(bx, by + 1, bz))) return true;
  return y < by + fluidSurfaceHeight(id);
}

/** Whether a point sits under water. */
export function submergedAt(x, y, z) {
  return insideFluidAt(x, y, z, isWater);
}

/** Whether a point sits in lava, by the same depth rule as water. */
export function inLavaAt(x, y, z) {
  return insideFluidAt(x, y, z, isLava);
}
