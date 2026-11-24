/*
 * Item icons, drawn once at load onto their own canvases: the hotbar, the
 * inventory grid, a dropped item, and the held view model all share these, so
 * the same pickaxe looks the same in all four places. Blocks reuse their atlas
 * tiles upscaled; the things that are not blocks — ingots, food, tools — are
 * painted from scratch.
 */

import { ATLAS_GRID, ATLAS_SIZE, ATLAS_TILE } from './config.js';
import { BLOCKS, ITEMS } from './blocks.js';
import { TILES, atlasCanvas } from './atlas.js';

const atlasPixels = atlasCanvas
  .getContext('2d')
  .getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;

export function createCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function upscaleIcon(source, size = 64) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, size, size);
  return canvas;
}

function makePixelIcon(painter) {
  const canvas = createCanvas(16);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const px = (x, y, color, w = 1, h = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w, h);
  };
  painter(px);
  return upscaleIcon(canvas);
}

function paintIconLine(px, x0, y0, x1, y1, color) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 64; guard++) {
    px(x0, y0, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * Authentic Minecraft tool sprites at 16x16, replicated from the vanilla
 * textures. Legend: H/M/L/S are the wooden handle's dark, mid, light and
 * shadow tones; 1-6 are the head's shades from outline up to highlight,
 * recolored per material tier.
 */
const TOOL_SPRITES = {
  pickaxe: [
    '................',
    '................',
    '......22222.....',
    '.....2665562HM..',
    '......211155LS..',
    '..........H651..',
    '.........HMS561.',
    '........HLS.151.',
    '.......HMS..151.',
    '......HLS...161.',
    '.....HMS....161.',
    '....HLS......1..',
    '...HMS..........',
    '..HLS...........',
    '..SS............',
    '................'
  ],
  axe: [
    '................',
    '.........22.....',
    '........2662....',
    '.......26562....',
    '......26555HM...',
    '......166545S...',
    '.......11H5451..',
    '........HMS551..',
    '.......HLS.11...',
    '......HMS.......',
    '.....HMS........',
    '....HLS.........',
    '...HMS..........',
    '..HLS...........',
    '..SS............',
    '................'
  ],
  shovel: [
    '................',
    '................',
    '...........221..',
    '..........26651.',
    '.........266561.',
    '........2665661.',
    '.........H5661..',
    '........HLS61...',
    '.......HLS.1....',
    '......HMS.......',
    '.....HLS........',
    '....HMS.........',
    '..HHLS..........',
    '..HLS...........',
    '...SS...........',
    '................'
  ],
  // Same handle as the pickaxe, but the head is a single blade rather than two
  // prongs, which is what makes a hoe read as a hoe at 16 pixels.
  hoe: [
    '................',
    '................',
    '......22222.....',
    '.....2666662HM..',
    '......211155LS..',
    '..........H651..',
    '.........HMS11..',
    '........HLS.....',
    '.......HMS......',
    '......HLS.......',
    '.....HMS........',
    '....HLS.........',
    '...HMS..........',
    '..HLS...........',
    '..SS............',
    '................'
  ],
  sword: [
    '.............222',
    '............2661',
    '...........26561',
    '..........26561.',
    '.........26561..',
    '........26561...',
    '..22...26561....',
    '..232.26561.....',
    '...2416461......',
    '...244361.......',
    '....2321........',
    '...HM1221.......',
    '..HLS.1121......',
    '22MS....11......',
    '231.............',
    '111.............'
  ]
};

const TOOL_HANDLE_COLORS = ['#493615', '#684e1e', '#896727', '#281e0b'];

const TOOL_HEAD_PALETTES = {
  wood: ['#20180a', '#372910', '#594319', '#6b511f', '#755821', '#866526'],
  stone: ['#181818', '#494949', '#6c6c6c', '#7f7f7f', '#898989', '#9a9a9a'],
  iron: ['#181818', '#444444', '#969696', '#c1c1c1', '#d8d8d8', '#ffffff'],
  diamond: ['#0a4d57', '#12727f', '#1f97a6', '#3fc0cd', '#66dfe9', '#a6f2f7']
};

function makeToolIcon(item) {
  const heads = TOOL_HEAD_PALETTES[item.tier] || TOOL_HEAD_PALETTES.wood;
  const sprite = TOOL_SPRITES[item.tool] || TOOL_SPRITES.pickaxe;
  const canvas = createCanvas(16);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < sprite.length; y++) {
    const row = sprite[y];
    for (let x = 0; x < row.length; x++) {
      const sym = row[x];
      if (sym === '.') continue;
      const handleIndex = 'HMLS'.indexOf(sym);
      ctx.fillStyle = handleIndex >= 0
        ? TOOL_HANDLE_COLORS[handleIndex]
        : heads[Number(sym) - 1];
      ctx.fillRect(x, y, 1, 1);
    }
  }

  return upscaleIcon(canvas);
}

/**
 * Armour icons, drawn as flat silhouettes with 1-6 standing for outline, dark,
 * mid, body, highlight and shine, exactly like the tool heads. Every material
 * just swaps the palette, so one sprite serves helmet through boots.
 */
const ARMOR_SPRITES = {
  head: [
    '................',
    '................',
    '....22222222....',
    '...2544444442...',
    '..244444444442..',
    '..244555554442..',
    '..244555554442..',
    '..244444444442..',
    '..244444444442..',
    '..244444444442..',
    '..222222222222..',
    '................',
    '................',
    '................',
    '................',
    '................'
  ],
  chest: [
    '................',
    '.2222......2222.',
    '.24423333332442.',
    '.24424444442442.',
    '.24425555552442.',
    '.24424444442442.',
    '.24424444442442.',
    '.24424444442442.',
    '...2444444442...',
    '...2444444442...',
    '...2222222222...',
    '................',
    '................',
    '................',
    '................',
    '................'
  ],
  legs: [
    '................',
    '..222222222222..',
    '..244444444442..',
    '..244441144442..',
    '..2442....2442..',
    '..2542....2452..',
    '..2442....2442..',
    '..2442....2442..',
    '..2442....2442..',
    '..2442....2442..',
    '..2222....2222..',
    '................',
    '................',
    '................',
    '................',
    '................'
  ],
  feet: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..242......242..',
    '..2442....2442..',
    '..2442....2442..',
    '..24442..24442..',
    '..24442..24442..',
    '..22222..22222..',
    '................',
    '................',
    '................',
    '................'
  ]
};

const ARMOR_PALETTES = {
  leather: ['#241408', '#4b2f18', '#7c5227', '#96682f', '#b58548', '#d3a766'],
  iron: ['#1c1c1c', '#4a4a4a', '#8f8f8f', '#bcbcbc', '#d9d9d9', '#f2f2f2'],
  diamond: ['#083b45', '#0f6270', '#1a8b9c', '#2fb4c3', '#5fd9e4', '#9beef5']
};

function makeArmorIcon(item) {
  const shades = ARMOR_PALETTES[item.tier] || ARMOR_PALETTES.leather;
  const sprite = ARMOR_SPRITES[item.armorSlot] || ARMOR_SPRITES.head;
  const canvas = createCanvas(16);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < sprite.length; y++) {
    const row = sprite[y];
    for (let x = 0; x < row.length; x++) {
      const sym = row[x];
      if (sym === '.' || sym < '1' || sym > '6') continue;
      ctx.fillStyle = shades[Number(sym) - 1];
      ctx.fillRect(x, y, 1, 1);
    }
  }

  return upscaleIcon(canvas);
}

function drawBlockFace(ctx, tileIndex, ox, oy, ux, uy, vx, vy, tint) {
  const sx = (tileIndex % ATLAS_GRID) * ATLAS_TILE;
  const sy = ((tileIndex / ATLAS_GRID) | 0) * ATLAS_TILE;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + ux, oy + uy);
  ctx.lineTo(ox + ux + vx, oy + uy + vy);
  ctx.lineTo(ox + vx, oy + vy);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(
    ux / ATLAS_TILE, uy / ATLAS_TILE,
    vx / ATLAS_TILE, vy / ATLAS_TILE,
    ox, oy
  );
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    atlasCanvas, sx, sy, ATLAS_TILE, ATLAS_TILE,
    0, 0, ATLAS_TILE, ATLAS_TILE
  );
  if (tint) {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.restore();
}

function makeBlockItemIcon(block) {
  const canvas = createCanvas(64);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  if (block.key === 'torch') {
    const sx = (block.tileSide % ATLAS_GRID) * ATLAS_TILE;
    const sy = ((block.tileSide / ATLAS_GRID) | 0) * ATLAS_TILE;
    ctx.drawImage(atlasCanvas, sx, sy, ATLAS_TILE, ATLAS_TILE, 8, 4, 48, 56);
    return canvas;
  }

  // A door item shows the leaf itself rather than a cube wearing it, so the
  // knob and stiles stay readable in the hotbar.
  if (block.door) {
    const sx = (block.tileSide % ATLAS_GRID) * ATLAS_TILE;
    const sy = ((block.tileSide / ATLAS_GRID) | 0) * ATLAS_TILE;
    ctx.drawImage(atlasCanvas, sx, sy, ATLAS_TILE, ATLAS_TILE, 14, 3, 36, 58);
    return canvas;
  }

  // A ladder item is the plank itself, tall and narrow the way it hangs: a cube
  // wearing this tile would be all rails and no wall to lean on.
  if (block.ladder) {
    const sx = (block.tileSide % ATLAS_GRID) * ATLAS_TILE;
    const sy = ((block.tileSide / ATLAS_GRID) | 0) * ATLAS_TILE;
    ctx.drawImage(atlasCanvas, sx, sy, ATLAS_TILE, ATLAS_TILE, 16, 2, 32, 60);
    return canvas;
  }

  // A bed item is a little side elevation: the blanket along the length, the
  // top edge above it, and a pillow riding the head end.
  if (block.bed) {
    const tile = (name) => [
      (TILES[name] % ATLAS_GRID) * ATLAS_TILE,
      ((TILES[name] / ATLAS_GRID) | 0) * ATLAS_TILE
    ];
    let [sx, sy] = tile('bed_side');
    ctx.drawImage(atlasCanvas, sx, sy, ATLAS_TILE, ATLAS_TILE, 4, 30, 56, 22);
    [sx, sy] = tile('bed_top');
    ctx.drawImage(atlasCanvas, sx, sy, ATLAS_TILE, ATLAS_TILE, 4, 22, 56, 10);
    [sx, sy] = tile('bed_pillow');
    ctx.drawImage(atlasCanvas, sx, sy, ATLAS_TILE, ATLAS_TILE, 38, 12, 20, 12);
    return canvas;
  }

  // A stairs item is the step itself in side elevation: the lower half of
  // the family's tile across the tread and the upper half over half of it,
  // so the icon is the same sliced block the world draws.
  if (block.stairs) {
    const sx = (block.tileSide % ATLAS_GRID) * ATLAS_TILE;
    const sy = ((block.tileSide / ATLAS_GRID) | 0) * ATLAS_TILE;
    const half = ATLAS_TILE / 2;
    ctx.drawImage(atlasCanvas, sx, sy + half, ATLAS_TILE, half, 4, 36, 56, 22);
    ctx.drawImage(atlasCanvas, sx, sy, ATLAS_TILE, half, 4, 14, 28, 22);
    return canvas;
  }

  drawBlockFace(ctx, block.tileSide, 3, 20, 29, 14, 0, 25, 'rgba(0,0,0,0.18)');
  drawBlockFace(ctx, block.tileSide, 32, 34, 29, -14, 0, 25, 'rgba(0,0,0,0.32)');
  drawBlockFace(ctx, block.tileTop, 3, 20, 29, -14, 29, 14, 'rgba(255,255,255,0.08)');
  return canvas;
}

const MATERIAL_ICON_PAINTERS = {
  coal(px) {
    px(4, 4, '#2b2b31', 3, 3);
    px(8, 3, '#3b3b42', 3, 2);
    px(8, 8, '#323238', 4, 3);
    px(4, 9, '#232328', 3, 2);
    px(5, 4, '#55555e', 1, 1);
    px(9, 3, '#5d5d66', 1, 1);
    px(10, 9, '#47474f', 1, 1);
  },
  raw_iron(px) {
    px(3, 5, '#9f7447', 3, 3);
    px(6, 3, '#c79a62', 2, 2);
    px(8, 6, '#b98b55', 4, 3);
    px(5, 9, '#cfa66f', 3, 2);
    px(10, 4, '#8a623c', 2, 2);
    px(9, 7, '#e0bc86', 1, 1);
  },
  iron_ingot(px) {
    // Smelted bar: flat top face, bevelled ends.
    px(3, 6, '#8b8b93', 10, 4);
    px(4, 5, '#c9c9d1', 8, 1);
    px(3, 5, '#a7a7af', 1, 1);
    px(12, 5, '#a7a7af', 1, 1);
    px(4, 6, '#e4e4ea', 5, 1);
    px(4, 9, '#6f6f77', 8, 1);
    px(5, 7, '#d8d8e0', 3, 1);
  },
  leather(px) {
    // A cured hide: tan panel, lighter belly, dark lower edge.
    px(3, 4, '#7c5228', 10, 8);
    px(4, 3, '#96682f', 8, 1);
    px(2, 5, '#96682f', 1, 6);
    px(13, 5, '#96682f', 1, 6);
    px(4, 5, '#b58548', 8, 6);
    px(5, 6, '#d3a766', 4, 2);
    px(4, 11, '#5c3c1c', 9, 1);
  },
  charcoal(px) {
    px(4, 4, '#2b2823', 3, 3);
    px(8, 3, '#38352e', 3, 3);
    px(8, 8, '#2f2c26', 4, 3);
    px(4, 9, '#23211c', 3, 2);
    px(5, 4, '#4d4a41', 1, 1);
    px(9, 4, '#57534a', 1, 1);
    px(10, 9, '#3e3b34', 1, 1);
    px(6, 6, '#1b1a16', 1, 1);
  },
  cooked_beef(px) {
    // Seared outside with a pink seam, the classic steak look.
    px(4, 4, '#8f4a26', 6, 5);
    px(3, 5, '#a15a2e', 2, 3);
    px(9, 3, '#7c3f20', 3, 2);
    px(6, 9, '#8a4523', 5, 3);
    px(8, 10, '#6f3719', 2, 1);
    px(5, 5, '#c9784a', 2, 1);
    px(5, 6, '#b35f34', 4, 1);
    px(10, 4, '#d08a5c', 1, 1);
    px(7, 8, '#99522d', 3, 1);
  },
  stick(px) {
    paintIconLine(px, 3, 12, 12, 3, '#6d4d29');
    paintIconLine(px, 4, 12, 13, 3, '#9a7040');
    paintIconLine(px, 5, 11, 11, 4, '#b88a52');
  },
  raw_beef(px) {
    px(4, 4, '#b34a4f', 6, 5);
    px(3, 5, '#c95c5e', 2, 3);
    px(9, 3, '#d36b6c', 3, 2);
    px(6, 9, '#a43f45', 5, 3);
    px(8, 10, '#c55b5d', 2, 1);
    px(5, 5, '#e08a86', 2, 1);
    px(10, 4, '#e38f8b', 1, 1);
  },
  feather(px) {
    paintIconLine(px, 3, 13, 11, 3, '#d7dde6');
    paintIconLine(px, 4, 13, 12, 3, '#f3f6fa');
    paintIconLine(px, 5, 12, 11, 4, '#ffffff');
    paintIconLine(px, 3, 13, 6, 10, '#aab4c2');
    px(10, 2, '#ffffff', 2, 2);
    px(9, 5, '#e4e9f0');
    px(7, 7, '#e4e9f0');
  },
  wheat_seeds(px) {
    // A scatter of pale grains, each with a darker seam down one side.
    const seeds = [[3, 4], [8, 3], [11, 6], [4, 9], [9, 10], [6, 12]];
    for (const [x, y] of seeds) {
      px(x, y, '#d8c478', 2, 3);
      px(x, y + 1, '#a8904a', 1, 2);
      px(x + 1, y, '#efe0a4', 1, 1);
    }
  },
  wheat(px) {
    // A single ear: stalk below, rows of grain leaning out above it.
    paintIconLine(px, 8, 15, 8, 6, '#b99a4a');
    for (let y = 2; y <= 8; y++) {
      px(7, y, '#e3cd6e');
      px(9, y, '#e3cd6e');
      px(8, y, '#c8ab54');
      if (y % 2 === 0) {
        px(6, y, '#f0e091');
        px(10, y, '#f0e091');
      }
    }
    px(8, 1, '#f0e091');
    px(6, 1, '#c8ab54');
    px(10, 1, '#c8ab54');
    px(7, 10, '#a8873c');
    px(9, 12, '#a8873c');
  },
  bread(px) {
    // A crusty loaf, pale across the top and dark along the bottom edge.
    px(3, 5, '#c98a43', 10, 6);
    px(2, 6, '#c98a43', 1, 4);
    px(13, 6, '#c98a43', 1, 4);
    px(3, 4, '#e0ab63', 10, 1);
    px(4, 3, '#e9bd7c', 8, 1);
    px(4, 5, '#e6b771', 3, 1);
    px(9, 5, '#e6b771', 3, 1);
    px(3, 11, '#8f5b26', 10, 1);
    px(5, 10, '#a96f30', 6, 1);
    px(6, 6, '#a96f30', 1, 4);
    px(10, 6, '#a96f30', 1, 4);
  },
  apple(px) {
    // A round red body with a notch at the top for the stem, one leaf leaning
    // off to the right, and the pale corner that always catches the light.
    px(4, 6, '#c8352f', 8, 6);
    px(3, 7, '#c8352f', 1, 4);
    px(12, 7, '#c8352f', 1, 4);
    px(5, 5, '#c8352f', 2, 1);
    px(9, 5, '#c8352f', 2, 1);
    px(4, 12, '#8e2020', 8, 1);
    px(5, 13, '#8e2020', 6, 1);
    px(5, 6, '#e0605a', 2, 4);
    px(6, 7, '#f08d84', 1, 2);
    px(10, 7, '#a8282a', 2, 4);
    px(8, 3, '#6d4d29', 1, 3);
    px(9, 2, '#6d4d29', 1, 1);
    px(10, 3, '#4f8f3a', 3, 1);
    px(11, 4, '#6fb04a', 2, 1);
  },
  diamond(px) {
    px(6, 3, '#c6f7fb', 4, 1);
    px(5, 4, '#8ce8f2', 6, 1);
    px(4, 5, '#5fd3e2', 8, 2);
    px(5, 7, '#3cb8cd', 6, 2);
    px(6, 9, '#2897ad', 4, 1);
    px(7, 10, '#1c7d94', 2, 1);
    px(6, 4, '#eafdff', 2, 1);
    px(5, 5, '#c6f7fb', 1, 1);
    px(9, 6, '#9ceef8', 1, 1);
  },
  wool(px) {
    // A fluffy ball of raw fleece: pale body, grey belly, a few locks.
    px(5, 3, '#f2f0e6', 6, 1);
    px(3, 4, '#f2f0e6', 10, 6);
    px(4, 10, '#e4e1d4', 8, 2);
    px(5, 12, '#cfccbe', 6, 1);
    px(5, 5, '#ffffff', 3, 2);
    px(6, 7, '#d8d5c8', 2, 1);
    px(9, 8, '#d8d5c8', 2, 1);
    px(4, 4, '#c9c6b8', 1, 1);
    px(11, 6, '#c9c6b8', 1, 1);
  },
  shears(px) {
    // Two steel blades crossing over looped finger rings, the same glyph
    // doodled into the crafting table top.
    paintIconLine(px, 3, 3, 10, 10, '#b9b9c2');
    paintIconLine(px, 4, 3, 11, 10, '#e0e0e8');
    paintIconLine(px, 12, 3, 5, 10, '#b9b9c2');
    paintIconLine(px, 11, 3, 4, 10, '#e0e0e8');
    px(7, 7, '#8b8b93', 2, 2);
    px(3, 11, '#7d7d86', 3, 3);
    px(4, 12, '#c9ccd4', 1, 1);
    px(11, 11, '#7d7d86', 3, 3);
    px(12, 12, '#c9ccd4', 1, 1);
  },
  bucket(px) {
    // An iron pail: a wire handle arched over the rim, the body easing in
    // towards a narrower foot, shine down the left where the light lands.
    paintIconLine(px, 4, 7, 8, 2, '#a7a7af');
    paintIconLine(px, 12, 7, 8, 2, '#a7a7af');
    px(3, 7, '#c9c9d1', 10, 1);
    px(3, 8, '#8b8b93', 10, 1);
    px(3, 9, '#9a9aa2', 10, 2);
    px(4, 11, '#91919a', 8, 2);
    px(5, 13, '#8b8b93', 6, 1);
    px(5, 14, '#6f6f77', 6, 1);
    px(4, 9, '#d8d8e0', 2, 4);
    px(11, 9, '#71717a', 2, 2);
  },
  water_bucket(px) {
    // The same pail brimful: iron still round the rim, the sea in the body,
    // and a lighter line where the water's own surface catches the light.
    paintIconLine(px, 4, 7, 8, 2, '#a7a7af');
    paintIconLine(px, 12, 7, 8, 2, '#a7a7af');
    px(3, 7, '#c9c9d1', 10, 1);
    px(3, 9, '#2a67c6', 10, 2);
    px(4, 11, '#255cba', 8, 2);
    px(5, 13, '#1f4fa8', 6, 2);
    px(3, 8, '#5b9cf5', 10, 1);
    px(4, 9, '#4285e8', 2, 4);
    px(11, 9, '#1a4290', 2, 2);
  },
  lava_bucket(px) {
    // The same pail full of lava: orange in the body, a yellow skin where the
    // surface is hottest, and a dark crust in the shaded corner.
    paintIconLine(px, 4, 7, 8, 2, '#a7a7af');
    paintIconLine(px, 12, 7, 8, 2, '#a7a7af');
    px(3, 7, '#c9c9d1', 10, 1);
    px(3, 9, '#e0581a', 10, 2);
    px(4, 11, '#cf4a14', 8, 2);
    px(5, 13, '#b23d10', 6, 2);
    px(3, 8, '#ffd04a', 10, 1);
    px(4, 9, '#ff9a2e', 2, 4);
    px(11, 9, '#7a2a0c', 2, 2);
  }
};

function makeMaterialIcon(itemId) {
  const painter = MATERIAL_ICON_PAINTERS[itemId];
  if (!painter) {
    return makePixelIcon((px) => {
      px(3, 3, '#b8b8c0', 10, 10);
      px(4, 4, '#d8d8de', 8, 2);
    });
  }
  return makePixelIcon(painter);
}

export const ITEM_ICONS = new Map();

for (const [itemId, item] of ITEMS) {
  let canvas;
  if (item.kind === 'block') {
    canvas = makeBlockItemIcon(BLOCKS[item.blockId]);
  } else if (item.kind === 'tool' && MATERIAL_ICON_PAINTERS[itemId]) {
    // Tierless tools like shears carry their own painter instead of a
    // sprite wearing a tier palette.
    canvas = makePixelIcon(MATERIAL_ICON_PAINTERS[itemId]);
  } else if (item.kind === 'tool') {
    canvas = makeToolIcon(item);
  } else if (item.kind === 'armor') {
    canvas = makeArmorIcon(item);
  } else {
    canvas = makeMaterialIcon(itemId);
  }
  ITEM_ICONS.set(itemId, { canvas, url: canvas.toDataURL() });
}

function averageTileColor(tileIndex) {
  const tx = (tileIndex % ATLAS_GRID) * ATLAS_TILE;
  const ty = ((tileIndex / ATLAS_GRID) | 0) * ATLAS_TILE;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      const p = ((ty + y) * ATLAS_SIZE + tx + x) * 4;
      if (atlasPixels[p + 3] < 32) continue;
      r += atlasPixels[p];
      g += atlasPixels[p + 1];
      b += atlasPixels[p + 2];
      n++;
    }
  }
  if (!n) return 0x9a9a9a;
  return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n));
}

for (const block of BLOCKS) {
  if (!block.tiles) continue;
  block.particleColor = averageTileColor(block.tileSide);
}
