/*
 * Every number the game is tuned by, in one place: how big a chunk is, how far
 * the player can see, how fast they walk, how long a torch burns, how deep water
 * can push sideways before it stops. Nothing here knows about anything else;
 * every other module is allowed to read these, and none of them is allowed to
 * change one. The seed is the one number that is not a constant: it is read
 * from whichever world this page was booted into (worlds.js), once, before
 * anything generates from it.
 */

import { activeWorld } from './worlds.js';

export const CHUNK_SIZE = 16;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const WORLD_HEIGHT = 96;
export const SEA_LEVEL = 48;
export const CHUNK_VOLUME = CHUNK_AREA * WORLD_HEIGHT;

export const WORLD_SEED = activeWorld().seed;
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

/**
 * Torches. A standing torch is two crossed planes TORCH_HEIGHT tall. A torch put on the side of a block keeps the standing torch's
 * stick and leans it out of the wall: the foot sits against the face it was
 * stuck to and the flame ends up a little out into the room and a little
 * higher, the way Minecraft hangs one. Each value is a fraction of a block
 * along the facing (negative is towards the wall) or up.
 */
export const TORCH_HEIGHT = 0.8;
export const WALL_TORCH_FOOT = -0.42;
export const WALL_TORCH_LEAN = 0.27;
export const WALL_TORCH_RISE = 0.2;

// Water flow. Only cells an edit disturbed ever get looked at, so an ocean is
// as cheap as a puddle: the sea is a wall of sources that never re-evaluate,
// and a hole dug beside it wakes up just enough of the coastline to fill in.
export const WATER_TICK_SECONDS = 0.15;
/** Cells resolved per tick. The queue drains eventually however big the flood. */
export const WATER_TICK_BUDGET = 512;
/** How far sideways a source can push water before the sheet goes too thin. */
export const WATER_MAX_FLOW = 7;
/**
 * Lava runs the same rules as water on a shorter, slower leash: three ranks
 * out from a source rather than seven, which is the four-block reach it has in
 * Minecraft's overworld, and one step for every six water ticks, the 30-tick
 * against 5-tick ratio Minecraft gives the two.
 */
export const LAVA_MAX_FLOW = 3;
export const LAVA_TICK_EVERY = 6;
/**
 * The deep lava level. In a dry region (see the aquifers below) every cave
 * cell the generator carves at or below this height is a lava source rather
 * than air, so the bottom of the world holds lava lakes right where the
 * diamonds run (y 4 to 26). Every carved cell under the line is filled, so no
 * source is born beside open air and the lakes lie settled until the player
 * breaks into one.
 */
export const LAVA_LEVEL = 10;
/**
 * Cave water. A coarse noise field splits the underground into regions about a
 * hundred blocks across. Below AQUIFER_DRY_BELOW a region is dry and keeps its
 * lava; above it the field is cut into bands AQUIFER_BAND wide, and each band
 * floods its caves up to one of AQUIFER_TABLES, shallow tables the commonest.
 * A wet region holds no lava. Banding is what makes a region share one level:
 * a table that varied column by column would need a wall between every pair.
 */
export const AQUIFER_SCALE = 0.01;
export const AQUIFER_DRY_BELOW = 0;
export const AQUIFER_BAND = 0.12;
export const AQUIFER_TABLES = [14, 20, 26, 32, 38];
/**
 * What lava does to a body in it. It is water's swim made thick: a slower
 * stroke and a slower wade, so wandering in is a mistake that takes a moment
 * to walk back out of. While anything of the body is in it, it burns four
 * points every half second, Minecraft's rate, and armour takes its share as it
 * does of a hit. Stepping out leaves the body on fire: a point a second for
 * eight seconds, put out the moment water touches it.
 */
export const LAVA_SPEED_SCALE = 0.3;
export const LAVA_SWIM_SCALE = 0.45;
export const LAVA_DAMAGE = 4;
export const LAVA_DAMAGE_INTERVAL = 0.5;
export const BURN_SECONDS = 8;
export const BURN_DAMAGE = 1;
export const BURN_INTERVAL = 1;
/** Seconds a furnace runs on one lava bucket: a hundred smelts, as in Minecraft. */
export const LAVA_BUCKET_BURN = 1000;
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
      fluid: 'water', fluidLevel: level, breakable: false, placeable: false
    });
  }
  for (let level = 1; level <= WATER_MAX_FLOW; level++) {
    defs.push({
      id: B['WATER_FALL_' + level], key: 'water_fall_' + level, name: 'Water',
      tiles: { top: 'water', bottom: 'water', side: 'water' },
      solid: false, opaque: false, liquid: true, waterLevel: level, falling: true,
      fluid: 'water', fluidLevel: level, breakable: false, placeable: false
    });
  }
  return defs;
}

/**
 * Lava's resting and falling ranks, built the way water's are. Every rank glows
 * as brightly as the source does, the way Minecraft's flowing lava does, so a
 * spill lights the cave it runs into the moment it gets there.
 */
export function lavaFlowBlockDefs() {
  const defs = [];
  for (const falling of [false, true]) {
    for (let level = 1; level <= LAVA_MAX_FLOW; level++) {
      const kind = falling ? 'FALL' : 'FLOW';
      defs.push({
        id: B['LAVA_' + kind + '_' + level], key: 'lava_' + kind.toLowerCase() + '_' + level,
        name: 'Lava', tiles: { top: 'lava', bottom: 'lava', side: 'lava' },
        solid: false, opaque: false, liquid: true, fluid: 'lava', fluidLevel: level,
        falling, light: 15, breakable: false, placeable: false
      });
    }
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
  LADDER: 52,
  // The beacon monument stands in the world in two states, unlit and lit, the
  // same way the furnace does: activation swaps the id, and lighting follows
  // the block table on its own. It is transmitter equipment, so there is no
  // third state and no item that carries it.
  BEACON: 53, BEACON_ACTIVE: 54,
  // Lava keeps its depth in the id exactly the way water does: a source, three
  // resting ranks and the same three pouring downward. Obsidian is what a lava
  // source turns into when water reaches it.
  LAVA: 55,
  LAVA_FLOW_1: 56, LAVA_FLOW_2: 57, LAVA_FLOW_3: 58,
  LAVA_FALL_1: 59, LAVA_FALL_2: 60, LAVA_FALL_3: 61,
  OBSIDIAN: 62
});

/* ---------- Beacons and the walk out from SP0 ---------- */

/** The five monuments the mission runs between, beacon 1 nearest the spawn. */
export const BEACON_COUNT = 5;
/**
 * How far each monument stands from the one before it, in blocks: the mission
 * is a chain of legs, 40 out to 600, rather than a set of rings around the
 * spawn. Beacon 1 keeps its small first hop so the walker learns the machine
 * before they leave home ground. The chain runs outward from SP0, so the sum
 * of these is roughly how far the last monument stands from where they fell,
 * and the price follows that distance.
 */
export const BEACON_TARGET_HOPS = [40, 200, 300, 400, 600];
/**
 * The monuments march outward: each beacon's bearing is the direction the
 * chain is already travelling, wobbling by no more than this either side. Kept
 * narrow on purpose. Wide enough and the chain curls back on itself, so a late
 * beacon sits closer to the spawn than an early one and the price curve folds;
 * narrow enough and the far end of the mission is genuinely the far end of the
 * world.
 */
export const BEACON_OUTWARD_BEARING = (26 * Math.PI) / 180;
/**
 * Beacon 1's price: one essence per this many blocks from SP0. The purse
 * opens holding exactly that, so the first beacon is a walk, not a hunt.
 */
export const BEACON_ESSENCE_PER_BLOCK = 1.5;
/**
 * Every later beacon is priced in kills: about this many hostile kills on the
 * ground of the beacon lit before it. Enough that the walker has to live in
 * the zone they have already unlocked — farm it, fortify it, learn it —
 * before the next monument will answer.
 */
export const BEACON_KILLS_TO_LIGHT = 30;
/**
 * The middle of a hostile's base essence roll (zombie and creeper both pay
 * 3–5 in `src/mob.js`), before the ground's difficulty scales it. Keep it in
 * step with those rolls, or the kill count above drifts.
 */
export const HOSTILE_ESSENCE_AVERAGE = 4;
/**
 * The colour each monument wears once it runs, in mission order: the walk out
 * from SP0 steps through the spectrum, so a lit beacon says which one it is
 * from the far side of the world. The beam and the burst an activation throws
 * both wear it; the machine's own shell stays cast metal either way.
 */
export const BEACON_COLORS = Object.freeze([
  0xff8a2e, 0xffd23b, 0x4bd06a, 0x3d8bff, 0x6a5cff
]);

/**
 * Enemy difficulty reads three axes off the ground a mob spawns on: its X and
 * Z distance from SP0 always, and its depth below sea level on top of that,
 * because the design only charges for the dark once the player has left the
 * surface. One unit of difficulty per this many blocks of travel. The step is
 * wide because the mission now runs a long way out: at 300 the ramp is still
 * climbing when the walker reaches the last monument, rather than saturating
 * halfway to the second one.
 */
export const DIFFICULTY_XZ_STEP = 300;
export const DIFFICULTY_Y_STEP = 48;
/**
 * A ceiling on the total, so the far corners stay survivable rather than absurd.
 * It is set to be reached out past the last monument, which leaves the far end
 * of the chain the harshest ground in the world rather than the same ground as
 * the band before it.
 */
export const DIFFICULTY_MAX = 6;
/** Health, attack and essence multiply by 1 + this times the difficulty. */
export const DIFFICULTY_HEALTH_SCALE = 0.6;
export const DIFFICULTY_DAMAGE_SCALE = 0.5;
export const DIFFICULTY_ESSENCE_SCALE = 0.5;
/** Hostiles show up this much more often at a difficulty, interval divided. */
export const DIFFICULTY_SPAWN_SCALE = 0.4;

/* ---------- Hunger ---------- */

/**
 * Food on Minecraft's 0-20 scale, plus Minecraft's hidden saturation counter.
 * Saturation sits on top of food, never above it, and is what exhaustion spends
 * first, so a good meal carries a busy day. Healing needs a nearly full stomach,
 * and an empty one kills: this game is Minecraft's Hard difficulty on purpose.
 */
export const HUNGER_MAX = 20;
export const HUNGER_REGEN_MIN = 18;
/** Saturation a new world or a respawned player starts with. Minecraft's own value. */
export const SATURATION_ON_RESPAWN = 5;
/** Seconds between starvation hits once the stomach is empty. */
export const STARVE_INTERVAL = 4;
/** Seconds between the points of health a full stomach mends. */
export const REGEN_INTERVAL = 4;
/** A completely full bar burns this much saturation for a point of health... */
export const SATURATION_BOOST_COST = 1.5;
/** ...and does it this often, which is eight times faster than the slow heal. */
export const SATURATION_BOOST_INTERVAL = 0.5;

/**
 * What each activity costs, in exhaustion points: Minecraft Java 1.21's values,
 * kept exactly as they are there. They look enormous next to a 20-point bar until
 * you remember the counter has to reach 4.0 before it spends anything, and that
 * saturation takes those hits first. Walking is missing because Minecraft charges
 * nothing for it: exploring is free and a meal buys work, not footsteps.
 */
export const EXHAUSTION = {
  sprint: 0.1, swim: 0.01,
  jump: 0.05, sprintJump: 0.2,
  mine: 0.005, attack: 0.1, hurt: 0.1, regen: 6.0
};
/** Exhaustion is spent in whole points of saturation or food, four at a time. */
export const EXHAUSTION_THRESHOLD = 4;

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
