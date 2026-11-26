/*
 * The block and item tables. A block says what it is called, how hard it is, what
 * tool digs it, what it drops, which tiles paint it, and whether you can stand on
 * it; an item says what it is called and what it can do. The atlas module fills
 * in the tile numbers later, because tiles do not exist until the atlas is
 * painted.
 */

import {
  APPLE_DROP_CHANCE, B, LAVA_MAX_FLOW, WATER_MAX_FLOW, WATER_SURFACE_OFFSET, capital, clamp,
  lavaFlowBlockDefs, waterFlowBlockDefs
} from './config.js';

export const BLOCKS = [
  { id: B.AIR, key: 'air', name: 'Air' },
  {
    id: B.GRASS, key: 'grass', name: 'Grass Block',
    tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
    solid: true, opaque: true, hardness: 0.6, tool: 'shovel',
    // One grass block in fifty hides a seed, which is how a player with no farm
    // at all gets the first crop planted. It is kept rare on purpose: a shovel
    // strips grass fast, and a richer roll filled the pack with seeds.
    drops: [
      { item: 'dirt', min: 1, max: 1 },
      { item: 'wheat_seeds', min: 1, max: 1, chance: 0.02 }
    ],
    placeable: true
  },
  {
    id: B.DIRT, key: 'dirt', name: 'Dirt',
    tiles: { top: 'dirt', bottom: 'dirt', side: 'dirt' },
    solid: true, opaque: true, hardness: 0.5, tool: 'shovel',
    drops: [{ item: 'dirt', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.STONE, key: 'stone', name: 'Stone',
    tiles: { top: 'stone', bottom: 'stone', side: 'stone' },
    solid: true, opaque: true, hardness: 1.5, tool: 'pickaxe', tier: 1,
    drops: [{ item: 'cobblestone', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.COBBLESTONE, key: 'cobblestone', name: 'Cobblestone',
    tiles: { top: 'cobblestone', bottom: 'cobblestone', side: 'cobblestone' },
    solid: true, opaque: true, hardness: 2.0, tool: 'pickaxe', tier: 1,
    drops: [{ item: 'cobblestone', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.COAL_ORE, key: 'coal_ore', name: 'Coal Ore',
    tiles: { top: 'coal_ore', bottom: 'coal_ore', side: 'coal_ore' },
    solid: true, opaque: true, hardness: 3.0, tool: 'pickaxe', tier: 1,
    drops: [{ item: 'coal', min: 1, max: 2 }],
    // Broken ore also pays essence, the safe half of the fuel economy. One
    // per coal is the base rung of the ladder: a kill still pays more, three
    // to five before difficulty, so fighting stays the fast road and mining
    // the patient one.
    essence: 1, placeable: true
  },
  {
    id: B.IRON_ORE, key: 'iron_ore', name: 'Iron Ore',
    tiles: { top: 'iron_ore', bottom: 'iron_ore', side: 'iron_ore' },
    solid: true, opaque: true, hardness: 3.0, tool: 'pickaxe', tier: 2,
    drops: [{ item: 'raw_iron', min: 1, max: 1 }],
    // Two: the middle rung of the ore essence ladder above.
    essence: 2, placeable: true
  },
  {
    id: B.SAND, key: 'sand', name: 'Sand',
    tiles: { top: 'sand', bottom: 'sand', side: 'sand' },
    solid: true, opaque: true, hardness: 0.5, tool: 'shovel',
    drops: [{ item: 'sand', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.WATER, key: 'water', name: 'Water',
    tiles: { top: 'water', bottom: 'water', side: 'water' },
    solid: false, opaque: false, liquid: true, waterLevel: 0,
    fluid: 'water', fluidLevel: 0, breakable: false, placeable: false
  },
  {
    id: B.LOG, key: 'log', name: 'Oak Log',
    tiles: { top: 'log_top', bottom: 'log_top', side: 'log_side' },
    solid: true, opaque: true, hardness: 2.0, tool: 'axe',
    drops: [{ item: 'log', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.PLANKS, key: 'planks', name: 'Oak Planks',
    tiles: { top: 'planks', bottom: 'planks', side: 'planks' },
    solid: true, opaque: true, hardness: 2.0, tool: 'axe',
    drops: [{ item: 'planks', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.LEAVES, key: 'leaves', name: 'Oak Leaves',
    tiles: { top: 'leaves', bottom: 'leaves', side: 'leaves' },
    // A hoe is the tool Minecraft speeds leaves up with, and no tier is needed
    // to keep whatever the canopy hands over, so punching still finds apples.
    // Shears would take the leaves themselves, and this game has no shears.
    solid: true, opaque: false, cutout: true, hardness: 0.2, tool: 'hoe',
    // Leaves give up no leaf block, which is how Minecraft treats them too; the
    // only thing they hand over is the occasional apple hiding in the canopy.
    drops: [{ item: 'apple', min: 1, max: 1, chance: APPLE_DROP_CHANCE }],
    placeable: true
  },
  {
    id: B.SNOW, key: 'snow', name: 'Snow Block',
    tiles: { top: 'snow', bottom: 'snow', side: 'snow' },
    solid: true, opaque: true, hardness: 0.2, tool: 'shovel',
    drops: [{ item: 'snow', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.CRAFTING_TABLE, key: 'crafting_table', name: 'Crafting Table',
    tiles: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side' },
    solid: true, opaque: true, hardness: 2.5, tool: 'axe',
    drops: [{ item: 'crafting_table', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.TORCH, key: 'torch', name: 'Torch',
    tiles: { top: 'torch', bottom: 'torch', side: 'torch' },
    solid: false, opaque: false, cutout: true, hardness: 0,
    // A torch stands on a top face or leans off a side one. Standing torches
    // keep no facing at all; one on a wall keeps the face it is stuck to in
    // the facings map, which is the whole of the difference.
    light: 14, placeOnTop: true, wallMount: true,
    drops: [{ item: 'torch', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.BEDROCK, key: 'bedrock', name: 'Bedrock',
    tiles: { top: 'bedrock', bottom: 'bedrock', side: 'bedrock' },
    solid: true, opaque: true, hardness: Infinity, unbreakable: true,
    drops: [], placeable: false
  },
  // New blocks are appended here and their ids added at the end of B, because
  // everything from the chunk arrays to the light engine looks blocks up as
  // BLOCKS[id]. Never insert one in the middle: it would silently renumber the
  // world and break every saved edit.
  {
    id: B.DIAMOND_ORE, key: 'diamond_ore', name: 'Diamond Ore',
    tiles: { top: 'diamond_ore', bottom: 'diamond_ore', side: 'diamond_ore' },
    solid: true, opaque: true, hardness: 3.0, tool: 'pickaxe', tier: 3,
    drops: [{ item: 'diamond', min: 1, max: 1 }],
    // Four: the deep, rare end of the ladder — a single diamond block is
    // worth nearly a full low-difficulty kill.
    essence: 4, placeable: true
  },
  {
    id: B.FURNACE, key: 'furnace', name: 'Furnace',
    tiles: {
      top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side',
      front: 'furnace_front'
    },
    solid: true, opaque: true, hardness: 3.5, tool: 'pickaxe', tier: 1,
    facings: true, blockEntity: 'furnace',
    drops: [{ item: 'furnace', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.FURNACE_LIT, key: 'furnace_lit', name: 'Furnace',
    tiles: {
      top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side',
      front: 'furnace_front_lit'
    },
    solid: true, opaque: true, hardness: 3.5, tool: 'pickaxe', tier: 1,
    facings: true, light: 13, blockEntity: 'furnace',
    drops: [{ item: 'furnace', min: 1, max: 1 }], placeable: false
  },
  {
    id: B.GLASS, key: 'glass', name: 'Glass',
    tiles: { top: 'glass', bottom: 'glass', side: 'glass' },
    // Minecraft gives glass no tool at all, so no pickaxe makes it quicker. It
    // still hands over the block here, since this game has no Silk Touch to
    // withhold the drop behind.
    solid: true, opaque: false, cutout: true, hardness: 0.3,
    drops: [{ item: 'glass', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.FARMLAND, key: 'farmland', name: 'Farmland',
    tiles: { top: 'farmland_top', bottom: 'dirt', side: 'dirt' },
    solid: true, opaque: true, hardness: 0.6, tool: 'shovel',
    drops: [{ item: 'dirt', min: 1, max: 1 }], placeable: false
  }
];

/**
 * A wheat crop is one block id per growth stage rather than a value in a
 * metadata array: the chunk array holds a single id per cell, so eight ids is
 * what lets a growing field survive chunk saves for free.
 */
for (let stage = 0; stage < 8; stage++) {
  const ripe = stage === 7;
  BLOCKS.push({
    id: B['WHEAT_' + stage], key: 'wheat_' + stage,
    name: ripe ? 'Wheat' : 'Wheat Crop',
    tiles: {
      top: 'wheat_' + stage, bottom: 'wheat_' + stage, side: 'wheat_' + stage
    },
    solid: false, opaque: false, cutout: true, hardness: 0,
    crop: stage,
    drops: ripe
      // A ripe crop gives back its own seed and, one time in ten, a second:
      // a field grows slowly from what it yields rather than flooding the pack.
      ? [
          { item: 'wheat', min: 1, max: 1 },
          { item: 'wheat_seeds', min: 1, max: 1 },
          { item: 'wheat_seeds', min: 1, max: 1, chance: 0.1 }
        ]
      : [{ item: 'wheat_seeds', min: 1, max: 1 }],
    placeable: false
  });
}

/**
 * A door is one item across two cells, and the open pair are separate ids
 * so collision sees them as air, the same trick the lit furnace uses. Which
 * way the leaf hangs is its facing, stored per position just like a
 * furnace's front. Appended after the wheat stages, which already own the
 * ids before them. All four carry Minecraft's own numbers for a wooden door:
 * a hardness of 3, with an axe to speed it up.
 */
BLOCKS.push(
  {
    id: B.DOOR, key: 'door', name: 'Wooden Door',
    tiles: { top: 'planks', bottom: 'planks', side: 'door_lower' },
    solid: true, opaque: false, cutout: true, hardness: 3.0, tool: 'axe',
    facings: true, door: 'lower',
    drops: [{ item: 'door', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.DOOR_TOP, key: 'door_top', name: 'Wooden Door',
    tiles: { top: 'planks', bottom: 'planks', side: 'door_upper' },
    solid: true, opaque: false, cutout: true, hardness: 3.0, tool: 'axe',
    facings: true, door: 'upper',
    drops: [{ item: 'door', min: 1, max: 1 }], placeable: false
  },
  {
    id: B.DOOR_OPEN, key: 'door_open', name: 'Wooden Door',
    tiles: { top: 'planks', bottom: 'planks', side: 'door_lower' },
    solid: false, opaque: false, cutout: true, hardness: 3.0, tool: 'axe',
    facings: true, door: 'lower', doorOpen: true,
    drops: [{ item: 'door', min: 1, max: 1 }], placeable: false
  },
  {
    id: B.DOOR_OPEN_TOP, key: 'door_open_top', name: 'Wooden Door',
    tiles: { top: 'planks', bottom: 'planks', side: 'door_upper' },
    solid: false, opaque: false, cutout: true, hardness: 3.0, tool: 'axe',
    facings: true, door: 'upper', doorOpen: true,
    drops: [{ item: 'door', min: 1, max: 1 }], placeable: false
  },
  // A bed is one item across two cells: the foot where it is placed and a
  // head cell one step along the facing. Either half pays the item out, and
  // the half that is not broken is cleared outright rather than mined, so a
  // bed never yields two beds. Same arrangement as the door, but Minecraft
  // gives a bed no tool at all: it goes as fast as a bare hand can swing.
  {
    id: B.BED, key: 'bed', name: 'Red Bed',
    tiles: { top: 'bed_top', bottom: 'planks', side: 'bed_side' },
    solid: true, opaque: false, cutout: true, hardness: 0.2,
    facings: true, bed: 'foot',
    drops: [{ item: 'bed', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.BED_HEAD, key: 'bed_head', name: 'Red Bed',
    tiles: { top: 'bed_top', bottom: 'planks', side: 'bed_side' },
    solid: true, opaque: false, cutout: true, hardness: 0.2,
    facings: true, bed: 'head',
    drops: [{ item: 'bed', min: 1, max: 1 }], placeable: false
  },
  // Flowing water is appended for the same reason as every other block here:
  // ids are storage, so nothing may shift.
  ...waterFlowBlockDefs()
);

// The chest joins last, same rule as above. It rides in a block entity the way
// a furnace rides in one, and turns its latch towards whoever placed it, like
// the furnace turns its mouth. Minecraft gives a chest a hardness of 2.5 with
// an axe to speed it up.
BLOCKS.push({
  id: B.CHEST, key: 'chest', name: 'Chest',
  tiles: {
    top: 'chest_top', bottom: 'chest_top', side: 'chest_side',
    front: 'chest_front'
  },
  solid: true, opaque: true, hardness: 2.5, tool: 'axe',
  facings: true, blockEntity: 'chest',
  drops: [{ item: 'chest', min: 1, max: 1 }], placeable: true
});

// Stairs join last, same rule as above. They turn their low step towards
// whoever placed them the way the chest turns its latch, and they are the
// one block in the game whose collision is not the whole cell: the step is
// drawn from two boxes and collided with those same two boxes, which is
// what lets a staircase be walked up instead of jumped. Minecraft saws both
// families out of a hardness of 2 — planks asks for an axe, cobblestone for
// a pickaxe — and pays four stairs for the six boards each one costs.
BLOCKS.push(
  {
    id: B.OAK_STAIRS, key: 'oak_stairs', name: 'Oak Stairs',
    tiles: { top: 'planks', bottom: 'planks', side: 'planks' },
    // Not opaque: the empty upper corner of the cell is open to the neighbour
    // beside it, exactly as a bed's or a door's is, and light agrees.
    solid: true, opaque: false, hardness: 2.0, tool: 'axe',
    facings: true, stairs: true,
    drops: [{ item: 'oak_stairs', min: 1, max: 1 }], placeable: true
  },
  {
    id: B.COBBLESTONE_STAIRS, key: 'cobblestone_stairs', name: 'Cobblestone Stairs',
    tiles: { top: 'cobblestone', bottom: 'cobblestone', side: 'cobblestone' },
    solid: true, opaque: false, hardness: 2.0, tool: 'pickaxe', tier: 1,
    facings: true, stairs: true,
    drops: [{ item: 'cobblestone_stairs', min: 1, max: 1 }], placeable: true
  }
);

// The ladder is the other half of being sub-block: the stairs take up part of a
// cell, and this one takes up none of it at all. It hangs off whichever wall it
// was nailed to, so its facing is the direction of that wall rather than the way
// the player was looking — the only facing block here that points where it
// points because of what it is standing against. Minecraft milled it to a
// hardness of 0.4 and asked for an axe, which is less effort than a plank of
// anything, and seven sticks make three ladders.
BLOCKS.push({
  id: B.LADDER, key: 'ladder', name: 'Ladder',
  // Only the side is ever drawn: the plank leans against a wall, so there is no
  // top or bottom of a ladder to see.
  tiles: { top: 'ladder', bottom: 'ladder', side: 'ladder' },
  // Neither solid nor opaque: you stand inside a ladder the way you stand in a
  // doorway, and light comes through it as though it were not there.
  solid: false, opaque: false, cutout: true, hardness: 0.4, tool: 'axe',
  facings: true, ladder: true,
  drops: [{ item: 'ladder', min: 1, max: 1 }], placeable: true
});

// The beacon monuments join last, same rule as above. They are transmitter
// equipment rather than something the player builds: the mission needs them
// standing, so no tool takes one down, nothing is dropped, and no recipe or
// give shelf can carry one. Activation swaps the unlit id for the lit one the
// way the furnace lights itself, and the light engine reads the new number
// from the table with no extra hooks. Which beacon of the five a monument is,
// and whether it has been lit, lives in the progression layer, not here.
BLOCKS.push(
  {
    id: B.BEACON, key: 'beacon', name: 'Beacon',
    tiles: { top: 'beacon_top', bottom: 'beacon_top', side: 'beacon_side' },
    solid: true, opaque: true, hardness: Infinity, unbreakable: true,
    beacon: 'idle', drops: [], placeable: false
  },
  {
    id: B.BEACON_ACTIVE, key: 'beacon_active', name: 'Beacon',
    tiles: {
      top: 'beacon_top_lit', bottom: 'beacon_top_lit',
      side: 'beacon_side_lit'
    },
    solid: true, opaque: true, hardness: Infinity, unbreakable: true,
    light: 15, beacon: 'active', drops: [], placeable: false
  }
);

// Lava and obsidian come after the beacons for the same reason. Lava is water's
// twin in the table: a source and its ranks, no collision, no tool that takes
// it, and the brightest light a block can give. Obsidian is what a source
// hardens into when water reaches it, and like Minecraft's it waits for a
// diamond pickaxe.
BLOCKS.push(
  {
    id: B.LAVA, key: 'lava', name: 'Lava',
    tiles: { top: 'lava', bottom: 'lava', side: 'lava' },
    solid: false, opaque: false, liquid: true, fluid: 'lava', fluidLevel: 0,
    light: 15, breakable: false, placeable: false
  },
  ...lavaFlowBlockDefs(),
  {
    id: B.OBSIDIAN, key: 'obsidian', name: 'Obsidian',
    tiles: { top: 'obsidian', bottom: 'obsidian', side: 'obsidian' },
    solid: true, opaque: true, hardness: 50, tool: 'pickaxe', tier: 4,
    drops: [{ item: 'obsidian', min: 1, max: 1 }], placeable: true
  }
);

// The enchanting table joins last, same rule as above. It is cobblestone and
// planks round a lump of coal, so it breaks like cobblestone does and wants a
// pickaxe to come away. Its one slot lives in a block entity; what it does to
// the item in that slot is enchanting.js's business.
BLOCKS.push({
  id: B.ENCHANTING_TABLE, key: 'enchanting_table', name: 'Enchanting Table',
  tiles: { top: 'enchanting_top', bottom: 'cobblestone', side: 'enchanting_side' },
  solid: true, opaque: true, hardness: 2.5, tool: 'pickaxe', tier: 1,
  blockEntity: 'enchanter',
  drops: [{ item: 'enchanting_table', min: 1, max: 1 }], placeable: true
});

/**
 * How much of a blast each block soaks up, Minecraft's own blast resistance
 * numbers. Every ray of an explosion pays `(resistance + 0.3) * 0.3` for each
 * 0.3-block step it takes through a block, so a creeper chews through dirt and
 * planks, barely scars stone, and cannot touch obsidian. A block not listed
 * here takes the fallback in the loop below: unbreakable blocks shrug off
 * anything, fluids take 100 (which is why a blast in water breaks nothing),
 * and the rest (torches, crops) take nothing at all.
 */
const BLAST_RESISTANCE = {
  grass: 0.6, dirt: 0.5, sand: 0.5, snow: 0.2, farmland: 0.6,
  leaves: 0.2, glass: 0.3, bed: 0.2, bed_head: 0.2, ladder: 0.4,
  log: 2, planks: 3, oak_stairs: 3, crafting_table: 2.5, chest: 2.5,
  door: 3, door_top: 3, door_open: 3, door_open_top: 3,
  coal_ore: 3, iron_ore: 3, diamond_ore: 3, furnace: 3.5, furnace_lit: 3.5,
  stone: 6, cobblestone: 6, cobblestone_stairs: 6,
  obsidian: 1200, enchanting_table: 1200
};

export const BLOCK_BY_KEY = new Map();
for (const block of BLOCKS) {
  block.solid ??= false;
  block.opaque ??= false;
  block.cutout ??= false;
  block.liquid ??= false;
  block.placeable ??= false;
  block.breakable ??= !block.unbreakable;
  block.facings ??= false;
  block.blockEntity ??= null;
  block.crop ??= null;
  block.door ??= null;
  block.doorOpen ??= false;
  block.bed ??= null;
  block.stairs ??= false;
  block.ladder ??= false;
  block.wallMount ??= false;
  block.beacon ??= null;
  // Only water carries a depth; everything else sits at -1 so isWater(id) can
  // be a single comparison against the block table.
  block.waterLevel ??= -1;
  // Which fluid a block is, if any, and its rank within that fluid: water and
  // lava both count 0 for a source and up from there, so the one flow model in
  // water.js can run either of them.
  block.fluid ??= null;
  block.fluidLevel ??= -1;
  block.falling ??= false;
  block.blastResistance ??= BLAST_RESISTANCE[block.key]
    ?? (block.unbreakable ? 3600000 : block.fluid ? 100 : 0);
  if (BLOCKS[block.id] !== block) {
    throw new Error('Block ' + block.key + ' must sit at index ' + block.id);
  }
  BLOCK_BY_KEY.set(block.key, block);
}

/**
 * Water in all its depths. Anything that used to ask `id === B.WATER` has to
 * ask this instead, or a spreading sheet of water stops being water the moment
 * it thins out: the raycast would pass through it, swimming would fail, and
 * meshing would try to draw faces into it.
 */
export const isWater = (id) => BLOCKS[id].waterLevel >= 0;
export const waterLevel = (id) => BLOCKS[id].waterLevel;
/** Water pouring downward, as opposed to a sheet resting somewhere. */
export const isFallingWater = (id) => BLOCKS[id].falling && BLOCKS[id].waterLevel >= 0;
/** Lava in any of its ranks, source, sheet or fall. */
export const isLava = (id) => BLOCKS[id].fluid === 'lava';
/**
 * Water or lava. The places that ask this are the ones where a fluid is simply
 * not a block: a ray passes through it, a placed block replaces it, and the
 * flow code has to wake up beside it.
 */
export const isFluid = (id) => BLOCKS[id].fluid !== null;
/** A sheet of water that has come to rest, at any of its seven depths. */
export const isFlowWater = (id) => {
  const level = BLOCKS[id].waterLevel;
  return level > 0 && !BLOCKS[id].falling;
};
/**
 * A full source, which is the only water a bucket will drink from. Every depth
 * below it is water that has already left a source on its way somewhere, and
 * scooping one of those up would take the wrong cell out of the flood.
 */
export const isWaterSource = (id) => BLOCKS[id].waterLevel === 0;
/** Water only ever moves into empty cells, so crops, torches and plants stay. */
export const waterCanOccupy = (id) => id === B.AIR;

/**
 * How high the surface sits in a water cell. A source keeps the shallow lip
 * water has always had; each flow level thins by an eighth of a block, so a
 * sheet spreading away from a shore steps down instead of stacking staircases.
 * A falling column wears the same face as the sheet it came from, which is what
 * makes a thin curtain over a ledge look thin.
 */
export function waterSurfaceHeight(level, maxFlow = WATER_MAX_FLOW) {
  if (level <= 0) return 1 - WATER_SURFACE_OFFSET;
  return (maxFlow + 1 - level) / (maxFlow + 1);
}

/**
 * The same surface for any fluid cell, by id. Lava has three ranks rather than
 * seven, so each of its steps down is a quarter of a block instead of an eighth.
 */
export function fluidSurfaceHeight(id) {
  const block = BLOCKS[id];
  return waterSurfaceHeight(block.fluidLevel,
    block.fluid === 'lava' ? LAVA_MAX_FLOW : WATER_MAX_FLOW);
}

export const ITEMS = new Map();

function defineItem(item) {
  item.stack ??= 64;
  item.kind ??= 'material';
  ITEMS.set(item.id, item);
  return item;
}

for (const block of BLOCKS) {
  if (!block.placeable) continue;
  defineItem({
    id: block.key, name: block.name, kind: 'block',
    blockId: block.id, stack: 64
  });
}

// A chest broken with anything inside comes away as a packed chest: the same
// block on placing, but one to a slot, carrying its twenty-seven slots on the
// stack as `contents`. It is its own item id rather than a flag on the chest
// for the reason the full bucket is: an empty chest still stacks sixty-four,
// and nothing that only compares ids can mistake one for the other.
defineItem({
  id: 'packed_chest', name: 'Packed Chest', kind: 'block',
  blockId: B.CHEST, stack: 1, packs: 'chest'
});

defineItem({ id: 'coal', name: 'Coal', kind: 'material', stack: 64 });
defineItem({ id: 'charcoal', name: 'Charcoal', kind: 'material', stack: 64 });
defineItem({ id: 'raw_iron', name: 'Raw Iron', kind: 'material', stack: 64 });
defineItem({ id: 'iron_ingot', name: 'Iron Ingot', kind: 'material', stack: 64 });
defineItem({ id: 'leather', name: 'Leather', kind: 'material', stack: 64 });
defineItem({ id: 'diamond', name: 'Diamond', kind: 'material', stack: 64 });
defineItem({ id: 'stick', name: 'Stick', kind: 'material', stack: 64 });
// Raw meat is food in name only: it carries no hunger value of its own, because
// a furnace has to turn it into steak before anyone can eat it. Minecraft gives
// it 3 food and 1.8 saturation; withholding both is what makes the furnace the
// only road past it.
defineItem({ id: 'raw_beef', name: 'Raw Beef', kind: 'food', stack: 64, needsCooking: true });
// Food values are Minecraft's, saturation included. Wheat is the one exception:
// Minecraft does not let you eat wheat at all, so 2 food is this game's own
// stopgap and its saturation borrows Minecraft's 2-food tier (a melon slice).
defineItem({ id: 'cooked_beef', name: 'Steak', kind: 'food', stack: 64, hunger: 8, saturation: 12.8 });
defineItem({ id: 'wheat', name: 'Wheat', kind: 'food', stack: 64, hunger: 2, saturation: 1.2 });
defineItem({ id: 'bread', name: 'Bread', kind: 'food', stack: 64, hunger: 5, saturation: 6 });
// The apple's food values are Minecraft's to the decimal. Where it comes from is
// the divergence: Minecraft rolls an apple on 0.5% of broken leaves, one every two
// hundred, which is effectively invisible, so this game rolls at 2.5% and makes
// clearing a forest worth the pause.
defineItem({ id: 'apple', name: 'Apple', kind: 'food', stack: 64, hunger: 4, saturation: 2.4 });
// Seeds are the one item that turns into a block on right click, so they carry
// the stage they plant as rather than a block id of their own.
defineItem({ id: 'wheat_seeds', name: 'Wheat Seeds', kind: 'seed', stack: 64, plants: B.WHEAT_0 });
defineItem({ id: 'feather', name: 'Feather', kind: 'material', stack: 64 });
defineItem({ id: 'wool', name: 'Wool', kind: 'material', stack: 64 });
// Shears are the one tool with no tier: they mine nothing, swing for next to
// nothing, and exist to take wool off a sheep without hurting it.
defineItem({ id: 'shears', name: 'Shears', kind: 'tool', tool: 'shears', stack: 1, durability: 64, damage: 1 });
// Archery arrives with beacon 2. String is what a spider leaves behind and the
// bow's only use for it. A bow mines nothing and swings for next to nothing,
// like the shears; one use is spent on every arrow loosed. The wood bow keeps
// the id `bow` it had before there were three, because saves hold it, and its
// 384 uses are Minecraft's. Iron (beacon 3) doubles that and diamond (beacon
// 4) doubles it again. `arrowDamage` is a full draw's hit, the sword ladder's
// own steps: 10, 14, 18. The bow's tier is for the icon and the enchanted
// table; it gates no block, so the bows carry no `tierLevel`.
defineItem({ id: 'string', name: 'String', kind: 'material', stack: 64 });
export const BOW_TIERS = {
  wood: { id: 'bow', name: 'Wood Bow', durability: 384, arrowDamage: 10 },
  iron: { id: 'iron_bow', name: 'Iron Bow', durability: 768, arrowDamage: 14 },
  diamond: { id: 'diamond_bow', name: 'Diamond Bow', durability: 1536, arrowDamage: 18 }
};
for (const [tier, bow] of Object.entries(BOW_TIERS)) {
  defineItem({
    id: bow.id, name: bow.name, kind: 'tool', tool: 'bow', tier, stack: 1,
    durability: bow.durability, damage: 1, arrowDamage: bow.arrowDamage
  });
}
defineItem({ id: 'arrow', name: 'Arrow', kind: 'material', stack: 64 });

// A bucket is the one item that carries something with it. Minecraft stacks
// empty buckets sixteen and never stacks a full one, so the two states are two
// item ids rather than one item wearing a flag. That is also the only way the
// save record, the dropped-item entities and the slot-merge rule, which all
// know about nothing on a stack but its id and its durability, can tell a full
// bucket from an empty one.
defineItem({ id: 'bucket', name: 'Bucket', kind: 'material', stack: 16 });
defineItem({ id: 'water_bucket', name: 'Water Bucket', kind: 'material', stack: 1 });
// Lava goes in the same pail on the same terms. It is the hottest fuel a
// furnace can burn, and the furnace hands the empty bucket back.
defineItem({ id: 'lava_bucket', name: 'Lava Bucket', kind: 'material', stack: 1 });

/* ---------- Item stacks ---------- */

/**
 * Stacks are plain { id, count } objects, plus an optional `dur` on tools and
 * armour holding the durability left in that specific item, and an optional
 * `contents` on a packed chest holding the slots it was broken with. Keeping
 * both optional means every material stack stays exactly as compact as it was.
 */
export function makeStack(id, count, dur, contents) {
  const stack = { id, count };
  if (dur != null) stack.dur = dur;
  if (contents) stack.contents = contents;
  return stack;
}

/**
 * A damaged tool never merges with a fresh one, so slots must agree on `dur`.
 * A stack that carries contents never merges at all: there is no adding two
 * chests' worth of things together into one slot.
 */
export function stacksMergeable(a, b) {
  if (a.contents || b.contents) return false;
  return a.id === b.id && (a.dur == null ? b.dur == null : b.dur === a.dur);
}

/** True when a packed chest's contents hold anything at all. */
export function packedSlotCount(stack) {
  if (!stack || !stack.contents) return 0;
  return stack.contents.reduce((n, slot) => n + (slot ? 1 : 0), 0);
}

/** Maximum durability of an item definition, or 0 when it cannot wear down. */
export function maxDurability(itemId) {
  const def = ITEMS.get(itemId);
  return def && def.durability ? def.durability : 0;
}

/** A brand new stack of an item id, at full durability. */
export function freshStack(id, count = 1) {
  const max = maxDurability(id);
  return makeStack(id, count, max || undefined);
}

/** Current/max durability for a stack, or null when the item never wears out. */
export function stackDurability(stack) {
  if (!stack) return null;
  const max = maxDurability(stack.id);
  if (!max) return null;
  const current = stack.dur == null ? max : clamp(stack.dur, 0, max);
  return { current, max, ratio: clamp(current / max, 0, 1) };
}

/**
 * Spend durability on a stack and report whether it just broke. Callers own the
 * job of clearing the slot it lived in, because stacks are referenced all over.
 */
export function consumeDurability(stack, amount = 1) {
  const info = stackDurability(stack);
  if (!info) return false;
  stack.dur = Math.max(0, info.current - amount);
  return stack.dur <= 0;
}

/* ---------- Containers ---------- */

/* A container's state object belongs to the block that says it has one: how
 * many slots it has, whether anything is burning inside it. The chunk layer
 * has to make room for one the moment such a block is placed, so it reaches
 * the shape here rather than having it handed down from the inventory's side
 * of the game. */

/** Slots in a chest: three rows of nine, the box Minecraft stores things in. */
export function mergeStackInto(source, targetArray, start, end) {
  const def = ITEMS.get(source.id);
  const maxStack = def.stack;
  let remaining = source.count;

  for (let i = start; i < end && remaining > 0; i++) {
    const slot = targetArray[i];
    if (!slot || !stacksMergeable(source, slot) || slot.count >= maxStack) continue;
    const moved = Math.min(remaining, maxStack - slot.count);
    slot.count += moved;
    remaining -= moved;
  }

  for (let i = start; i < end && remaining > 0; i++) {
    if (targetArray[i]) continue;
    const moved = Math.min(remaining, maxStack);
    targetArray[i] = makeStack(source.id, moved, source.dur, source.contents);
    remaining -= moved;
  }

  return remaining;
}

/** Plain readable snapshot of a stack, used by the debug hooks. */
export function slotInfo(stack) {
  if (!stack) return null;
  return {
    id: stack.id,
    count: stack.count,
    dur: stack.dur == null ? null : stack.dur,
    max: maxDurability(stack.id) || null
  };
}


export const CHEST_SLOTS = 27;

export function createBlockEntity(kind) {
  if (kind === 'furnace') {
    return {
      kind, slots: [null, null, null],
      cookTime: 0, burnTime: 0, burnTotal: 0
    };
  }
  if (kind === 'chest') {
    return { kind, slots: new Array(CHEST_SLOTS).fill(null) };
  }
  if (kind === 'enchanter') {
    return { kind, slots: [null] };
  }
  return { kind, slots: [null, null, null] };
}

export function isFurnaceBlock(blockId) {
  const block = BLOCKS[blockId];
  return !!block && block.blockEntity === 'furnace';
}

export function isChestBlock(blockId) {
  const block = BLOCKS[blockId];
  return !!block && block.blockEntity === 'chest';
}

export function isEnchanterBlock(blockId) {
  const block = BLOCKS[blockId];
  return !!block && block.blockEntity === 'enchanter';
}

/** Either state of a beacon monument, lit or waiting. */
export function isBeaconBlock(blockId) {
  return !!BLOCKS[blockId] && BLOCKS[blockId].beacon !== null;
}

const TOOL_TIERS = {
  wood:  { level: 1, speed: 2.0, durability: 60,  damage: 2.5 },
  stone: { level: 2, speed: 4.0, durability: 132, damage: 3.5 },
  iron:  { level: 3, speed: 6.0, durability: 251, damage: 5.0 },
  diamond: { level: 4, speed: 8.0, durability: 1561, damage: 7.0 }
};
/** The same tiers enchanted: faster to mine with and harder to be hit by. */
const ENCHANTED_TOOL_TIERS = {
  wood:  { speed: 3.0, damage: 3.0 },
  stone: { speed: 5.0, damage: 4.0 },
  iron:  { speed: 7.0, damage: 6.0 },
  diamond: { speed: 10.0, damage: 8.0 }
};
const TOOL_KINDS = {
  pickaxe: 'Pickaxe', sword: 'Sword', axe: 'Axe', shovel: 'Shovel', hoe: 'Hoe'
};

for (const [tier, stats] of Object.entries(TOOL_TIERS)) {
  for (const [tool, label] of Object.entries(TOOL_KINDS)) {
    defineItem({
      id: tier + '_' + tool,
      name: capital(tier) + ' ' + label,
      kind: 'tool', tool, tier, tierLevel: stats.level,
      stack: 1, durability: stats.durability,
      damage: stats.damage, miningSpeed: stats.speed,
      icon: tier + '_' + tool
    });
  }
}

/**
 * Armour, in the order the inventory panel draws it: head down to feet. The
 * durability columns are Minecraft's own numbers, listed helmet, chestplate,
 * leggings, boots. The defence columns are this game's own and run about
 * twice Minecraft's, so that the enchanted sets have room above them; the
 * absorption formula scales the points back down (see `armorDefenseScaled`).
 */
export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'];
export const ARMOR_PIECES = [
  { slot: 'head', label: 'Helmet', piece: 'helmet', glyph: 'H' },
  { slot: 'chest', label: 'Chestplate', piece: 'chestplate', glyph: 'C' },
  { slot: 'legs', label: 'Leggings', piece: 'leggings', glyph: 'L' },
  { slot: 'feet', label: 'Boots', piece: 'boots', glyph: 'B' }
];
/** Hint letter drawn in an empty armour slot, head down to feet. */
export const ARMOR_GLYPHS = ARMOR_PIECES.map((piece) => piece.glyph);
/**
 * The most defence a body can wear: a full enchanted diamond set. Minecraft's
 * formula is written for 20 points, so worn points are scaled by 20 / 42
 * before it reads them, and full enchanted diamond blocks what full diamond
 * blocks in Minecraft. The bar still draws ten shields across the whole range.
 */
export const ARMOR_MAX_DEFENSE = 42;
/** The defence scale Minecraft's absorption formula was written for. */
export const ARMOR_FORMULA_POINTS = 20;
/** Worn points on the 20-point scale the absorption formula and the bar use. */
export function armorDefenseScaled(points) {
  return Math.min(ARMOR_MAX_DEFENSE, Math.max(0, points)) * ARMOR_FORMULA_POINTS / ARMOR_MAX_DEFENSE;
}
export const ARMOR_BAR_SHIELDS = 10;
export const ARMOR_MATERIALS = {
  leather: {
    material: 'leather',
    defense: [2, 6, 4, 2], durability: [55, 80, 75, 65]
  },
  iron: {
    material: 'iron_ingot',
    defense: [4, 10, 6, 4], durability: [165, 240, 225, 195]
  },
  diamond: {
    material: 'diamond',
    defense: [6, 14, 10, 6], durability: [363, 528, 495, 429]
  }
};

for (const [tier, stats] of Object.entries(ARMOR_MATERIALS)) {
  ARMOR_PIECES.forEach((piece, index) => {
    defineItem({
      id: tier + '_' + piece.piece,
      name: capital(tier) + ' ' + piece.label,
      kind: 'armor', armorSlot: piece.slot, tier,
      stack: 1, durability: stats.durability[index],
      defense: stats.defense[index]
    });
  });
}

/* ---------- Enchanted gear ---------- */

/**
 * Every enchanted item is an item of its own, `enchanted_<base id>`, for the
 * reason a full bucket is: merge rules, saves and dropped items know a stack
 * by its id and its wear and by nothing else. An enchanted item is its base
 * with better numbers and half as many uses again; the swords' and bows'
 * blows come from combat.js and the `arrowDamage` here, the tools' from their
 * tier's enchanted row, the armour's from these columns (helmet, chestplate,
 * leggings, boots). Shears are not enchantable.
 */
export const ENCHANTED_DURABILITY_SCALE = 1.5;
const ENCHANTED_ARMOR_DEFENSE = {
  leather: [3, 8, 5, 3],
  iron: [5, 12, 8, 5],
  diamond: [7, 16, 12, 7]
};
const ENCHANTED_ARROW_DAMAGE = { wood: 12, iron: 16, diamond: 20 };
const ENCHANTED_PREFIX = 'enchanted_';

/** The enchanted twin of an item id, whether or not it exists. */
export function enchantedIdFor(itemId) {
  return ENCHANTED_PREFIX + itemId;
}

function defineEnchanted(base, stats) {
  defineItem({
    ...base,
    ...stats,
    id: enchantedIdFor(base.id),
    name: 'Enchanted ' + base.name,
    durability: Math.round(base.durability * ENCHANTED_DURABILITY_SCALE),
    enchanted: true,
    base: base.id
  });
}

for (const tier of Object.keys(TOOL_TIERS)) {
  for (const tool of Object.keys(TOOL_KINDS)) {
    const enchanted = ENCHANTED_TOOL_TIERS[tier];
    defineEnchanted(ITEMS.get(tier + '_' + tool), {
      damage: enchanted.damage, miningSpeed: enchanted.speed
    });
  }
}
for (const [tier, bow] of Object.entries(BOW_TIERS)) {
  defineEnchanted(ITEMS.get(bow.id), { arrowDamage: ENCHANTED_ARROW_DAMAGE[tier] });
}
for (const tier of Object.keys(ARMOR_MATERIALS)) {
  ARMOR_PIECES.forEach((piece, index) => {
    defineEnchanted(ITEMS.get(tier + '_' + piece.piece), {
      defense: ENCHANTED_ARMOR_DEFENSE[tier][index]
    });
  });
}

/** True for an item the enchanting table can work on: enchant it, or repair it. */
export function isEnchantable(itemId) {
  const item = ITEMS.get(itemId);
  if (!item) return false;
  if (item.enchanted) return true;
  return ITEMS.has(enchantedIdFor(itemId));
}
