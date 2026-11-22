/*
 * Every number the game is tuned by, in one place: how big a chunk is, how far
 * the player can see, how fast they walk, how long a torch burns, how deep water
 * can push sideways before it stops. Nothing here knows about anything else;
 * every other module is allowed to read these, and none of them is allowed to
 * change one.
 */



export const CHUNK_SIZE = 16;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const WORLD_HEIGHT = 96;
export const SEA_LEVEL = 48;
export const CHUNK_VOLUME = CHUNK_AREA * WORLD_HEIGHT;

export const WORLD_SEED = 20261116;
export const RENDER_DISTANCE = 8;
export const DATA_RADIUS = RENDER_DISTANCE + 1;
export const UNLOAD_RADIUS = RENDER_DISTANCE + 3;
export const CHUNK_BUDGET_MS = 8;

export const ATLAS_TILE = 16;
export const ATLAS_GRID = 16;
export const ATLAS_SIZE = ATLAS_TILE * ATLAS_GRID;
const TILE_UV = 1 / ATLAS_GRID;
export const HALF_TEXEL = 0.5 / ATLAS_SIZE;

export const WATER_SURFACE_OFFSET = 0.12;
export const EYE_HEIGHT = 1.62;
const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2;
export const COLLISION_EPSILON = 1e-4;
export const WALK_SPEED = 4.6;
export const SPRINT_SPEED = 6.9;
export const WATER_SPEED_SCALE = 0.55;
export const GRAVITY = 30;
export const JUMP_SPEED = 9.0;
export const TERMINAL_VELOCITY = 55;
export const WATER_GRAVITY_SCALE = 0.25;
export const WATER_SWIM_ACCEL = 24;
export const WATER_MAX_SWIM_SPEED = 3.0;
export const WATER_TERMINAL_VELOCITY = 3.2;
export const WATER_MANTLE_HEIGHT = 1.5;
export const WATER_MANTLE_STEP = 0.05;
/**
 * How far a walking player rises over a step without jumping. Minecraft's
 * stair tread is half a block and its own step height is 0.6, which is what
 * makes a staircase something you walk up rather than jump up; the stair is
 * the only sub-block collider in this game, so that is all this ever climbs.
 */
export const PLAYER_STEP_HEIGHT = 0.6;
export const GROUND_ACCEL = 32;
export const AIR_ACCEL = 4.5;
export const WATER_ACCEL = 10;

/**
 * Ladders. A ladder hangs off the wall it is nailed to, and Minecraft's own
 * hitbox for one is a slab 3/16 of a block thick against that face. The plank
 * is drawn a sixteenth out from the wall, which is close enough to read as
 * leaning on it and far enough to catch its own edge.
 */
export const LADDER_PLANK = 1 / 16;
/**
 * Minecraft's climb is 2.3572 blocks a second, which is a hair slower than a
 * walk and a good deal faster than anything else that moves you up.
 */
export const LADDER_CLIMB_SPEED = 2.3572;

// Water flow. Only cells an edit disturbed ever get looked at, so an ocean is
// as cheap as a puddle: the sea is a wall of sources that never re-evaluate,
// and a hole dug beside it wakes up just enough of the coastline to fill in.
export const WATER_TICK_SECONDS = 0.15;
/** Cells resolved per tick. The queue drains eventually however big the flood. */
export const WATER_TICK_BUDGET = 512;
/** How far sideways a source can push water before the sheet goes too thin. */
export const WATER_MAX_FLOW = 7;
/**
 * Chunk meshes a single water tick will rebuild. Meshing is far more expensive
 * than flowing, so a flood that dirties a dozen chunks at once spreads that
 * work over the ticks that follow it.
 */
export const WATER_REMESH_BUDGET = 2;
/**
 * Milliseconds a tick will spend meshing before it leaves the rest of the
 * backlog for the next one. The chunk count alone cannot bound the cost: one
 * mesh is far dearer than another depending on how much water it holds.
 */
export const WATER_REMESH_MS = 4;
/**
 * Chunks to rebuild once the water has finished moving and only the backlog is
 * left. Nothing is flowing any more, so the frames can go into catching the
 * renderer up instead of rationing it out a tick at a time.
 */
export const WATER_REMESH_IDLE_BUDGET = 6;
/** The six cells whose answer changes when a cell changes. */
export const WATER_NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];
/** The four a sheet of water can creep across. */
export const WATER_SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** The four cells that meet at a corner of the grid, as offsets from it. */
export const WATER_CORNER_CELLS = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
/**
 * A flow cell only ever waits on a neighbour chunk this many ticks before it
 * stops holding its place in the queue. Long enough for the chunk to stream in
 * while the player stands at the border, short enough that a flood at the edge
 * of the loaded world cannot sit in the queue forever. It is parked rather than
 * forgotten, because water that simply gave up left the flood frozen in place
 * with nothing left to restart it.
 */
export const WATER_WAIT_LIMIT = 12;
export const MAX_MOVE_STEP = 0.25;
export const FOG_NEAR = 48;
export const FOG_FAR = 132;
export const FOCUS_REACH = 5;
/** Block entities this far from the player are looked at; farther ones wait. */
export const BLOCK_ENTITY_TICK_RANGE = 32;
export const TREE_MARGIN = 4;
export const TREE_SALT = 0x51ED270B;
export const ORE_SALT_COAL = 0xC0A1;
export const ORE_SALT_IRON = 0x1F0E;
export const ORE_SALT_DIAMOND = 0xD1A40;

/**
 * Chance that a broken leaf block gives up the apple sitting in it. Minecraft's
 * own roll is 0.5%, which is one apple per two hundred leaves, so this game pays
 * out five times as often and makes felling a tree worth the trouble.
 */
export const APPLE_DROP_CHANCE = 0.025;

export const SKY_ZENITH = 0x4f8fd8;
export const SKY_HORIZON = 0xc3dbef;
export const FOG_COLOR = 0xc3dbef;

export const LIGHT_MAX = 15;

/**
 * The seven flow levels, and the same seven depths again for water that is
 * pouring downward. A falling column carries its own depth rather than being one
 * generic "falling" block, because that is the only way it can pass water on
 * down without inventing some: a film off the edge of a shelf has to arrive at
 * the ground as a film, not as a pool. They all share the water tile, the lack of
 * collision, and the fact that no pickaxe can pick any of them up.
 */
export function waterFlowBlockDefs() {
  const defs = [];
  for (let level = 1; level <= WATER_MAX_FLOW; level++) {
    defs.push({
      id: B['WATER_FLOW_' + level], key: 'water_flow_' + level,
      name: 'Water', tiles: { top: 'water', bottom: 'water', side: 'water' },
      solid: false, opaque: false, liquid: true, waterLevel: level,
      breakable: false, placeable: false
    });
  }
  for (let level = 1; level <= WATER_MAX_FLOW; level++) {
    defs.push({
      id: B['WATER_FALL_' + level], key: 'water_fall_' + level, name: 'Water',
      tiles: { top: 'water', bottom: 'water', side: 'water' },
      solid: false, opaque: false, liquid: true, waterLevel: level, falling: true,
      breakable: false, placeable: false
    });
  }
  return defs;
}
/** A full day is 20 real minutes, the same length Minecraft runs on. */
export const DAY_LENGTH_SECONDS = 1200;
export const DAY_START = 0.22;

export const B = Object.freeze({
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLESTONE: 4,
  COAL_ORE: 5, IRON_ORE: 6, SAND: 7, WATER: 8, LOG: 9,
  PLANKS: 10, LEAVES: 11, SNOW: 12, CRAFTING_TABLE: 13,
  TORCH: 14, BEDROCK: 15, DIAMOND_ORE: 16,
  FURNACE: 17, FURNACE_LIT: 18, GLASS: 19, FARMLAND: 20,
  // Wheat keeps eight growth stages in the block id itself, because a chunk
  // cell is one byte and has nowhere else to hold a growth value.
  WHEAT_0: 21, WHEAT_1: 22, WHEAT_2: 23, WHEAT_3: 24,
  WHEAT_4: 25, WHEAT_5: 26, WHEAT_6: 27, WHEAT_7: 28,
  // A door spans two cells and keeps its open and closed states in separate
  // ids, the same trick the lit furnace uses. The open ids are not solid,
  // which is what makes a doorway walk-through.
  DOOR: 29, DOOR_TOP: 30, DOOR_OPEN: 31, DOOR_OPEN_TOP: 32,
  // A bed spans two cells side by side, foot first along the facing it was
  // placed with. Like the door it is one item across two ids.
  BED: 33, BED_HEAD: 34,
  // Flowing water keeps its depth in the block id the same way wheat keeps its
  // growth stage: a chunk cell is one byte and has nowhere else to hold it.
  // WATER is a source, the seven WATER_FLOW levels thin from nearly full to a
  // film, and the seven WATER_FALL levels are those same depths pouring
  // downward, which is what lets a fall pass its own depth on to the cell below.
  WATER_FLOW_1: 35, WATER_FLOW_2: 36, WATER_FLOW_3: 37, WATER_FLOW_4: 38,
  WATER_FLOW_5: 39, WATER_FLOW_6: 40, WATER_FLOW_7: 41,
  WATER_FALL_1: 42, WATER_FALL_2: 43, WATER_FALL_3: 44, WATER_FALL_4: 45,
  WATER_FALL_5: 46, WATER_FALL_6: 47, WATER_FALL_7: 48,
  // A chest keeps its contents in a block entity rather than the chunk byte,
  // so it needs one id and nothing more: which way the latch faces lives in
  // the facings map, like the furnace's mouth.
  CHEST: 49,
  // Stairs keep their four directions in the facings map the same way, so
  // each family is one id and nothing more. The step itself is geometry,
  // not state: there is no upside-down half to store.
  OAK_STAIRS: 50, COBBLESTONE_STAIRS: 51,
  // A ladder is one id too: which wall it is nailed to is the facing, and the
  // plank that leans off that wall is geometry rather than state.
  LADDER: 52
});

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function blockIndex(x, y, z) {
  return x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
}

export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}
