/*
 * What a crafting grid means: the recipes as patterns, the two grids they get
 * laid out on, and the matcher that reads one against the other. A pattern is
 * trimmed to its occupied box, so a recipe is found wherever it sits in the
 * grid; a '.' is a cell that must stay empty; and the matcher is exact, which is
 * why both diagonals of the shears are written down. A shapeless recipe cares
 * only which items are present and how many of each.
 *
 * Tools and armour are generated rather than copied out: Minecraft's own heads
 * and rings once each, crossed with the tiers and pieces blocks.js already
 * keeps. The grids are this module's own arrays and the screens fill them, so
 * nothing else holds a grid; which of the two is in front of the player — the
 * pocket 2x2 or the table's 3x3 — is a screen's business, so the page names the
 * grid and its width and `matchRecipe` says what those items have become.
 */

import { ARMOR_MATERIALS, ARMOR_PIECES } from './blocks.js';

export const CRAFT2_SIZE = 2;
export const CRAFT3_SIZE = 3;
export const craft2 = new Array(CRAFT2_SIZE * CRAFT2_SIZE).fill(null);
export const craft3 = new Array(CRAFT3_SIZE * CRAFT3_SIZE).fill(null);

/**
 * Crafting recipes. Shaped patterns are matched anywhere inside the grid and
 * are trimmed to their occupied bounding box, so leading/trailing empty rows
 * and columns do not matter. A '.' means the cell must stay empty.
 */
export const RECIPES = [
  {
    id: 'planks', shapeless: ['log'],
    result: { id: 'planks', count: 4 }
  },
  {
    id: 'sticks', pattern: ['P', 'P'], key: { P: 'planks' },
    result: { id: 'stick', count: 4 }
  },
  {
    id: 'crafting_table', pattern: ['PP', 'PP'], key: { P: 'planks' },
    result: { id: 'crafting_table', count: 1 }
  },
  {
    id: 'torches', pattern: ['C', 'S'], key: { C: 'coal', S: 'stick' },
    result: { id: 'torch', count: 4 }
  },
  {
    id: 'torches_charcoal', pattern: ['C', 'S'],
    key: { C: 'charcoal', S: 'stick' },
    result: { id: 'torch', count: 4 }
  },
  {
    id: 'furnace', pattern: ['CCC', 'C.C', 'CCC'],
    key: { C: 'cobblestone' },
    result: { id: 'furnace', count: 1 }
  },
  {
    // Three ears laid side by side: bread needs the crafting table, not the
    // 2x2 grid carried in the inventory.
    id: 'bread', pattern: ['WWW'], key: { W: 'wheat' },
    result: { id: 'bread', count: 1 }
  },
  {
    // Six planks in two columns, three leaves tall: Minecraft's own door
    // pattern, and three doors out of it like the original gives.
    id: 'door', pattern: ['PP', 'PP', 'PP'], key: { P: 'planks' },
    result: { id: 'door', count: 3 }
  },
  {
    // Two ingots laid point to point: the shears glyph already carved into
    // the crafting table top finally earns its keep.
    id: 'shears', pattern: ['I.', '.I'], key: { I: 'iron_ingot' },
    result: { id: 'shears', count: 1 }
  },
  {
    // The same shears from the other hand: the matcher is exact, so both
    // diagonals need listing.
    id: 'shears_alt', pattern: ['.I', 'I.'], key: { I: 'iron_ingot' },
    result: { id: 'shears', count: 1 }
  },
  {
    // Blanket over boards: three wool laid across three planks, the table's
    // own pattern for a bed.
    id: 'bed', pattern: ['WWW', 'PPP'], key: { W: 'wool', P: 'planks' },
    result: { id: 'bed', count: 1 }
  },
  {
    // Three ingots in a V, which is the cup the finished bucket is drawn as.
    // Three ingots and no sticks: the pail is one bent sheet with a wire handle.
    // The V is three cells across, so like the bed it has to be folded at the
    // table rather than in the 2x2 grid carried in the inventory.
    id: 'bucket', pattern: ['I.I', '.I.'], key: { I: 'iron_ingot' },
    result: { id: 'bucket', count: 1 }
  },
  {
    // Eight boards around an empty middle: the box is all walls and a lid, and
    // the hollow centre is the gap things are put through. Needs the table, the
    // same as the bucket and the bed, because the ring is three cells wide.
    id: 'chest', pattern: ['PPP', 'P.P', 'PPP'], key: { P: 'planks' },
    result: { id: 'chest', count: 1 }
  },
  {
    // Six boards sawn into a staircase, and four stairs out of the six —
    // Minecraft's own pattern and its own numbers. The V is three cells
    // across, so the table folds this one too.
    id: 'oak_stairs', pattern: ['P..', 'PP.', 'PPP'], key: { P: 'planks' },
    result: { id: 'oak_stairs', count: 4 }
  },
  {
    // The same staircase cut in cobblestone.
    id: 'cobblestone_stairs', pattern: ['C..', 'CC.', 'CCC'],
    key: { C: 'cobblestone' },
    result: { id: 'cobblestone_stairs', count: 4 }
  },
  {
    // Seven sticks: two rails of three with a rung laid across each end and the
    // middle. Minecraft's pattern, and its own count of three ladders out of
    // the seven. Three cells wide, so it wants the table like the chest does.
    id: 'ladder', pattern: ['S.S', 'SSS', 'S.S'], key: { S: 'stick' },
    result: { id: 'ladder', count: 3 }
  }
];

/**
 * Minecraft's tool shapes: a head of two or three material cells over a stick
 * handle. Generated for every tier rather than written out twenty times.
 */
const TOOL_SHAPES = {
  pickaxe: ['XXX', '.S.', '.S.'],
  sword: ['X', 'X', 'S'],
  axe: ['XX', 'XS', '.S'],
  shovel: ['X', 'S', 'S'],
  hoe: ['XX', '.S', '.S']
};
const TOOL_MATERIALS = {
  wood: 'planks', stone: 'cobblestone', iron: 'iron_ingot', diamond: 'diamond'
};

for (const [tier, material] of Object.entries(TOOL_MATERIALS)) {
  for (const [kind, shape] of Object.entries(TOOL_SHAPES)) {
    RECIPES.push({
      id: tier + '_' + kind,
      pattern: shape.slice(),
      key: { X: material, S: 'stick' },
      result: { id: tier + '_' + kind, count: 1 }
    });
  }
}

/**
 * Armour patterns, borrowed straight from Minecraft: eight cells ring a
 * chestplate, five make a helmet, seven make leggings, four make boots.
 */
const ARMOR_SHAPES = {
  helmet: ['XXX', 'X.X'],
  chestplate: ['X.X', 'XXX', 'XXX'],
  leggings: ['XXX', 'X.X', 'X.X'],
  boots: ['X.X', 'X.X']
};

for (const [tier, stats] of Object.entries(ARMOR_MATERIALS)) {
  for (const piece of ARMOR_PIECES) {
    RECIPES.push({
      id: tier + '_' + piece.piece,
      pattern: ARMOR_SHAPES[piece.piece].slice(),
      key: { X: stats.material },
      result: { id: tier + '_' + piece.piece, count: 1 }
    });
  }
}

/** Trim a pattern to its non-empty bounding box. */
function trimPattern(pattern) {
  const width = Math.max(...pattern.map((row) => row.length));
  const padded = pattern.map((row) => row.padEnd(width, '.'));
  let minRow = padded.length;
  let maxRow = -1;
  let minCol = width;
  let maxCol = -1;

  for (let row = 0; row < padded.length; row++) {
    for (let col = 0; col < width; col++) {
      if (padded[row][col] === '.') continue;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
  }

  if (maxRow < 0) return [];
  return padded
    .slice(minRow, maxRow + 1)
    .map((row) => row.slice(minCol, maxCol + 1));
}

for (const recipe of RECIPES) {
  if (recipe.pattern) recipe.pattern = trimPattern(recipe.pattern);
}

function gridBounds(grid, size) {
  let minRow = size;
  let maxRow = -1;
  let minCol = size;
  let maxCol = -1;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!grid[row * size + col]) continue;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
  }

  if (maxRow < 0) return null;
  return {
    minRow, maxRow, minCol, maxCol,
    width: maxCol - minCol + 1,
    height: maxRow - minRow + 1
  };
}

/** Return the first recipe matching the grid, or null. */
export function matchRecipe(grid, size) {
  const bounds = gridBounds(grid, size);
  if (!bounds) return null;

  for (const recipe of RECIPES) {
    if (recipe.shapeless) {
      const counts = new Map();
      for (const slot of grid) {
        if (!slot) continue;
        counts.set(slot.id, (counts.get(slot.id) || 0) + slot.count);
      }
      if (counts.size !== recipe.shapeless.length) continue;
      let matches = true;
      for (const itemId of recipe.shapeless) {
        if (!counts.get(itemId)) {
          matches = false;
          break;
        }
      }
      if (matches) return recipe;
      continue;
    }

    const pattern = recipe.pattern;
    if (pattern.length !== bounds.height) continue;
    if (pattern[0].length !== bounds.width) continue;

    let matches = true;
    for (let row = 0; row < bounds.height && matches; row++) {
      for (let col = 0; col < bounds.width; col++) {
        const symbol = pattern[row][col];
        const slot = grid[(bounds.minRow + row) * size + (bounds.minCol + col)];
        if (symbol === '.') {
          if (slot) {
            matches = false;
            break;
          }
        } else if (!slot || slot.id !== recipe.key[symbol]) {
          matches = false;
          break;
        }
      }
    }

    if (matches) return recipe;
  }

  return null;
}

export function consumeCraftIngredients(grid) {
  for (let i = 0; i < grid.length; i++) {
    const slot = grid[i];
    if (!slot) continue;
    slot.count -= 1;
    if (slot.count <= 0) grid[i] = null;
  }
}
