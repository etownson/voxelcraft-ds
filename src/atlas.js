/*
 * The texture atlas, painted once at load into a 256x256 canvas of 16x16 tiles.
 * Every surface in the world is a tile out of here, drawn procedurally so the
 * download stays small and the pixels stay crisp when magnified. Painting a tile
 * also records its index, which is what a block's tile number means.
 */

import * as THREE from 'three';
import { ATLAS_GRID, ATLAS_SIZE, ATLAS_TILE, clamp } from './config.js';
import { BLOCKS } from './blocks.js';
import { hashString, mulberry32 } from './noise.js';

const TILE_ORDER = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone',
  'coal_ore', 'iron_ore', 'diamond_ore', 'sand', 'water', 'log_side', 'log_top',
  'planks', 'leaves', 'snow', 'crafting_table_top',
  'crafting_table_side', 'torch', 'bedrock',
  'furnace_top', 'furnace_side', 'furnace_front', 'furnace_front_lit',
  'glass', 'farmland_top', 'door_upper', 'door_lower',
  'bed_top', 'bed_side', 'bed_end', 'bed_pillow',
  'chest_top', 'chest_side', 'chest_front', 'ladder'
];
for (let stage = 0; stage < 10; stage++) TILE_ORDER.push('crack_' + stage);
// One tile per wheat growth stage, painted in a loop like the crack stages.
for (let stage = 0; stage < 8; stage++) TILE_ORDER.push('wheat_' + stage);

export const TILES = Object.create(null);
TILE_ORDER.forEach((name, index) => { TILES[name] = index; });

function generateAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  const data = image.data;

  function vary(rand, color, amount) {
    const d = (rand() * 2 - 1) * amount;
    return [
      clamp(Math.round(color[0] + d), 0, 255),
      clamp(Math.round(color[1] + d), 0, 255),
      clamp(Math.round(color[2] + d), 0, 255)
    ];
  }

  function pixelNoise(paint, rand, color, amount) {
    for (let y = 0; y < ATLAS_TILE; y++) {
      for (let x = 0; x < ATLAS_TILE; x++) {
        paint(x, y, vary(rand, color, amount));
      }
    }
  }

  function paintDirtBase(paint, rand) {
    pixelNoise(paint, rand, [134, 96, 66], 9);
    for (let i = 0; i < 14; i++) {
      const x = (rand() * 16) | 0;
      const y = (rand() * 16) | 0;
      paint(x, y, vary(rand, [111, 77, 51], 7));
      if (rand() < 0.5) paint(x + 1, y, vary(rand, [111, 77, 51], 7));
    }
    for (let i = 0; i < 7; i++) {
      const x = (rand() * 15) | 0;
      const y = (rand() * 15) | 0;
      paint(x, y, vary(rand, [151, 142, 126], 8));
      if (rand() < 0.4) paint(x + 1, y + 1, vary(rand, [139, 130, 116], 6));
    }
  }

  function paintStoneBase(paint, rand) {
    pixelNoise(paint, rand, [128, 128, 128], 7);
    for (let i = 0; i < 18; i++) {
      const x = (rand() * 15) | 0;
      const y = (rand() * 15) | 0;
      const c = vary(rand, rand() < 0.5 ? [112, 112, 112] : [144, 144, 144], 5);
      paint(x, y, c);
      if (rand() < 0.55) paint(x + 1, y, c);
      if (rand() < 0.35) paint(x, y + 1, c);
    }
    for (let i = 0; i < 5; i++) {
      let x = (rand() * 11) | 0;
      let y = (rand() * 11) | 0;
      const len = 3 + ((rand() * 4) | 0);
      for (let s = 0; s < len; s++) {
        paint(x, y, vary(rand, [100, 100, 100], 4));
        if (rand() < 0.7) x++;
        if (rand() < 0.7) y++;
      }
    }
  }

  function paintStoneBlob(paint, rand, x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || x > 15 || y < 0 || y > 15) continue;
        if ((x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1)) continue;
        let shade = 0;
        if (y === y0) shade += 9;
        if (x === x0) shade += 4;
        if (y === y0 + h - 1) shade -= 12;
        if (x === x0 + w - 1) shade -= 7;
        paint(x, y, vary(rand, [131 + shade, 131 + shade, 131 + shade], 6));
      }
    }
  }

  /** Stone casing shared by the lit and unlit furnace faces. */
  function paintCasingBase(paint, rand) {
    pixelNoise(paint, rand, [124, 124, 126], 6);
    for (let i = 0; i < 14; i++) {
      paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [100, 100, 102], 6));
    }
    for (let i = 0; i < 16; i++) {
      const shade = vary(rand, [84, 84, 86], 4);
      paint(i, 0, shade);
      paint(i, 15, shade);
      paint(0, i, shade);
      paint(15, i, shade);
    }
  }

  function paintOreCluster(paint, rand, cx, cy, colors, size) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (dx === 0 && dy === size - 1 && rand() < 0.35) continue;
        paint(cx + dx, cy + dy, vary(rand, colors[(rand() * colors.length) | 0], 8));
      }
    }
    paint(cx, cy, colors[colors.length - 1]);
    paint(cx + size - 1, cy + size - 1, colors[0]);
  }

  const painters = {
    grass_top(paint, rand) {
      pixelNoise(paint, rand, [92, 155, 58], 11);
      for (let i = 0; i < 30; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [118, 186, 80], 9));
      }
      for (let i = 0; i < 18; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [70, 122, 44], 8));
      }
      for (let i = 0; i < 9; i++) {
        const x = (rand() * 16) | 0;
        const y = (rand() * 13) | 0;
        const len = 2 + ((rand() * 3) | 0);
        for (let s = 0; s < len; s++) paint(x, y + s, vary(rand, [108, 176, 72], 7));
      }
    },

    grass_side(paint, rand) {
      paintDirtBase(paint, rand);
      for (let x = 0; x < 16; x++) {
        const depth = 3 + (rand() < 0.4 ? 1 : 0) + (rand() < 0.2 ? 1 : 0);
        for (let y = 0; y < depth; y++) {
          paint(x, y, vary(rand, [87, 148, 55], 10));
        }
        if (rand() < 0.5) paint(x, depth, vary(rand, [75, 130, 47], 8));
        if (rand() < 0.14 && depth < 6) paint(x, depth + 1, vary(rand, [66, 116, 42], 6));
      }
    },

    dirt(paint, rand) {
      paintDirtBase(paint, rand);
    },

    stone(paint, rand) {
      paintStoneBase(paint, rand);
    },

    cobblestone(paint, rand) {
      pixelNoise(paint, rand, [76, 76, 76], 5);
      paintStoneBlob(paint, rand, 1, 1, 6, 5);
      paintStoneBlob(paint, rand, 8, 1, 7, 5);
      paintStoneBlob(paint, rand, 1, 7, 4, 4);
      paintStoneBlob(paint, rand, 6, 7, 5, 4);
      paintStoneBlob(paint, rand, 12, 7, 3, 4);
      paintStoneBlob(paint, rand, 1, 12, 7, 3);
      paintStoneBlob(paint, rand, 9, 12, 6, 3);
    },

    coal_ore(paint, rand) {
      paintStoneBase(paint, rand);
      paintOreCluster(paint, rand, 3, 3, [[38, 38, 42], [58, 58, 64], [24, 24, 27]], 2);
      paintOreCluster(paint, rand, 10, 2, [[38, 38, 42], [58, 58, 64], [24, 24, 27]], 3);
      paintOreCluster(paint, rand, 5, 10, [[38, 38, 42], [58, 58, 64], [24, 24, 27]], 2);
      paintOreCluster(paint, rand, 12, 11, [[38, 38, 42], [58, 58, 64], [24, 24, 27]], 2);
    },

    iron_ore(paint, rand) {
      paintStoneBase(paint, rand);
      const ironColors = [[150, 104, 62], [188, 140, 92], [210, 166, 112], [224, 196, 148]];
      paintOreCluster(paint, rand, 3, 4, ironColors, 2);
      paintOreCluster(paint, rand, 9, 2, ironColors, 3);
      paintOreCluster(paint, rand, 6, 11, ironColors, 2);
      paintOreCluster(paint, rand, 12, 10, ironColors, 2);
    },

    diamond_ore(paint, rand) {
      paintStoneBase(paint, rand);
      const diamondColors = [[58, 190, 202], [98, 224, 232], [150, 242, 246], [34, 152, 172]];
      paintOreCluster(paint, rand, 3, 3, diamondColors, 2);
      paintOreCluster(paint, rand, 10, 2, diamondColors, 3);
      paintOreCluster(paint, rand, 5, 10, diamondColors, 2);
      paintOreCluster(paint, rand, 12, 11, diamondColors, 2);
    },

    sand(paint, rand) {
      pixelNoise(paint, rand, [222, 208, 150], 8);
      for (let i = 0; i < 22; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [199, 183, 124], 6));
      }
      for (let i = 0; i < 12; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [238, 228, 178], 5));
      }
    },

    water(paint, rand) {
      pixelNoise(paint, rand, [58, 112, 190], 6);
      for (const row of [3, 8, 13]) {
        for (let x = 0; x < 16; x++) {
          if (rand() < 0.72) paint(x, row, vary(rand, [88, 148, 222], 7));
        }
      }
      for (let i = 0; i < 10; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [44, 92, 166], 6));
      }
    },

    log_side(paint, rand) {
      pixelNoise(paint, rand, [102, 72, 42], 7);
      for (let i = 0; i < 12; i++) {
        const x = (rand() * 16) | 0;
        const y0 = (rand() * 10) | 0;
        const tone = vary(rand, [81, 56, 32], 5);
        for (let y = y0; y < 16; y++) {
          if (rand() < 0.8) paint(x, y, tone);
        }
      }
      for (let i = 0; i < 8; i++) {
        const x = (rand() * 16) | 0;
        const y0 = (rand() * 12) | 0;
        const tone = vary(rand, [120, 88, 54], 6);
        for (let y = y0; y < 16; y++) {
          if (rand() < 0.55) paint(x, y, tone);
        }
      }
      for (let i = 0; i < 4; i++) {
        const y = (rand() * 16) | 0;
        for (let x = 0; x < 16; x++) {
          if (rand() < 0.18) paint(x, y, vary(rand, [74, 50, 28], 4));
        }
      }
    },

    log_top(paint, rand) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const dx = x - 7.5;
          const dy = y - 7.5;
          const d = Math.sqrt(dx * dx + dy * dy);
          let color;
          if (d > 7.3) color = [92, 66, 40];
          else if (d < 1.1) color = [112, 82, 48];
          else if (Math.floor(d) % 2 === 0) color = [176, 138, 88];
          else color = [151, 116, 70];
          paint(x, y, vary(rand, color, 7));
        }
      }
      paint(7, 7, [96, 70, 44]);
      paint(8, 8, [96, 70, 44]);
    },

    planks(paint, rand) {
      for (let y = 0; y < 16; y++) {
        const board = y >> 2;
        const boardTone = [4, -4, 2, -7][board];
        for (let x = 0; x < 16; x++) {
          paint(x, y, vary(rand, [176 + boardTone, 138 + boardTone, 86 + boardTone], 6));
        }
      }
      for (const y of [3, 7, 11, 15]) {
        for (let x = 0; x < 16; x++) {
          paint(x, y, vary(rand, [124, 94, 56], 5));
        }
      }
      for (let i = 0; i < 14; i++) {
        const x = (rand() * 16) | 0;
        const y = (rand() * 16) | 0;
        if (y % 4 === 3) continue;
        paint(x, y, vary(rand, [158, 122, 74], 5));
      }
    },

    leaves(paint, rand) {
      const palette = [[48, 100, 34], [60, 118, 42], [74, 136, 52], [86, 150, 60]];
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (rand() < 0.84) {
            paint(x, y, vary(rand, palette[(rand() * palette.length) | 0], 8));
          }
        }
      }
      for (let i = 0; i < 14; i++) {
        const x = (rand() * 16) | 0;
        const y = (rand() * 16) | 0;
        paint(x, y, vary(rand, [40, 84, 30], 5));
      }
    },

    snow(paint, rand) {
      pixelNoise(paint, rand, [244, 248, 252], 4);
      for (let i = 0; i < 16; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [219, 231, 243], 5));
      }
    },

    crafting_table_top(paint, rand) {
      pixelNoise(paint, rand, [162, 126, 78], 5);
      for (let i = 0; i < 16; i++) {
        paint(i, 0, vary(rand, [96, 70, 40], 4));
        paint(i, 15, vary(rand, [96, 70, 40], 4));
        paint(0, i, vary(rand, [96, 70, 40], 4));
        paint(15, i, vary(rand, [96, 70, 40], 4));
        paint(5, i, vary(rand, [112, 82, 48], 4));
        paint(10, i, vary(rand, [112, 82, 48], 4));
        paint(i, 5, vary(rand, [112, 82, 48], 4));
        paint(i, 10, vary(rand, [112, 82, 48], 4));
      }
      // Hammer glyph
      paint(2, 2, [92, 92, 96]);
      paint(3, 2, [92, 92, 96]);
      paint(4, 2, [112, 112, 116]);
      paint(3, 3, [110, 80, 46]);
      paint(3, 4, [110, 80, 46]);
      // Saw glyph
      paint(7, 7, [176, 176, 182]);
      paint(8, 7, [176, 176, 182]);
      paint(8, 8, [160, 160, 166]);
      paint(9, 8, [160, 160, 166]);
      // Shears glyph
      paint(12, 12, [188, 188, 194]);
      paint(13, 13, [188, 188, 194]);
      paint(13, 12, [150, 150, 156]);
      paint(12, 13, [150, 150, 156]);
    },

    crafting_table_side(paint, rand) {
      pixelNoise(paint, rand, [152, 118, 72], 5);
      for (let i = 0; i < 16; i++) {
        paint(i, 0, vary(rand, [92, 66, 38], 4));
        paint(i, 1, vary(rand, [108, 78, 44], 4));
        paint(i, 15, vary(rand, [92, 66, 38], 4));
        paint(0, i, vary(rand, [98, 72, 42], 4));
        paint(15, i, vary(rand, [98, 72, 42], 4));
      }
      for (let y = 3; y < 14; y++) {
        paint(4, y, vary(rand, [106, 78, 46], 4));
        paint(11, y, vary(rand, [106, 78, 46], 4));
      }
      // Saw blade
      for (let i = 0; i < 5; i++) paint(5 + i, 5 + i, vary(rand, [180, 180, 186], 5));
      // Hammer
      paint(4, 10, [96, 70, 42]);
      paint(4, 11, [96, 70, 42]);
      paint(3, 12, [128, 128, 132]);
      paint(4, 12, [128, 128, 132]);
      paint(5, 12, [144, 144, 148]);
    },

    torch(paint, rand) {
      // Transparent background; only the handle and flame are painted.
      for (let y = 7; y < 16; y++) {
        paint(7, y, vary(rand, [108, 76, 42], 6));
        paint(8, y, vary(rand, [126, 90, 50], 6));
      }
      for (let y = 3; y < 7; y++) {
        for (let x = 6; x < 10; x++) {
          paint(x, y, vary(rand, [244, 178, 64], 10));
        }
      }
      for (let y = 2; y < 7; y++) {
        for (let x = 7; x < 9; x++) {
          paint(x, y, vary(rand, [255, 238, 160], 8));
        }
      }
      paint(7, 1, [255, 246, 190]);
      paint(8, 1, [255, 246, 190]);
      paint(6, 4, [255, 220, 110]);
      paint(9, 4, [255, 220, 110]);
      paint(7, 7, [255, 250, 220]);
      paint(8, 7, [255, 244, 190]);
    },

    furnace_top(paint, rand) {
      pixelNoise(paint, rand, [122, 122, 124], 7);
      for (let i = 0; i < 26; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [96, 96, 98], 6));
      }
      // The cast-iron rim Minecraft draws around the top face.
      for (let i = 0; i < 16; i++) {
        const shade = vary(rand, [78, 78, 80], 5);
        paint(i, 0, shade);
        paint(i, 15, shade);
        paint(0, i, shade);
        paint(15, i, shade);
      }
    },

    furnace_side(paint, rand) {
      pixelNoise(paint, rand, [124, 124, 126], 6);
      for (let i = 0; i < 18; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [100, 100, 102], 6));
      }
      for (let i = 0; i < 16; i++) {
        const shade = vary(rand, [84, 84, 86], 4);
        paint(i, 0, shade);
        paint(i, 15, shade);
        paint(0, i, shade);
        paint(15, i, shade);
      }
      // Rivet row along the bottom, the tell of a furnace casing.
      for (let x = 2; x < 15; x += 3) {
        paint(x, 13, vary(rand, [88, 88, 90], 4));
        paint(x, 12, vary(rand, [148, 148, 150], 5));
      }
    },

    furnace_front(paint, rand) {
      paintCasingBase(paint, rand);
      // Dark arched opening, cold until the furnace is lit.
      for (let y = 7; y < 14; y++) {
        const inset = y < 9 ? 2 : 1;
        for (let x = 4 + inset; x < 12 - inset; x++) {
          paint(x, y, vary(rand, [38, 38, 40], 4));
        }
      }
      for (let x = 5; x < 11; x++) paint(x, 6, vary(rand, [70, 70, 72], 4));
      for (let x = 4; x < 12; x++) paint(x, 14, vary(rand, [86, 86, 88], 4));
    },

    furnace_front_lit(paint, rand) {
      paintCasingBase(paint, rand);
      // Same arch, but the fire inside lights the opening and the rim.
      for (let y = 7; y < 14; y++) {
        const inset = y < 9 ? 2 : 1;
        for (let x = 4 + inset; x < 12 - inset; x++) {
          const heat = (y - 6) / 8;
          const base = [
            40 + Math.round(190 * heat),
            36 + Math.round(110 * heat),
            34 + Math.round(20 * heat)
          ];
          paint(x, y, vary(rand, base, 10));
        }
      }
      for (let x = 5; x < 11; x++) {
        paint(x, 6, vary(rand, [150, 92, 40], 12));
      }
      for (let x = 4; x < 12; x++) paint(x, 14, vary(rand, [210, 150, 62], 14));
      for (let y = 8; y < 13; y += 2) {
        paint(4, y, vary(rand, [240, 186, 82], 12));
        paint(11, y, vary(rand, [240, 186, 82], 12));
      }
    },

    glass(paint, rand) {
      // Cutout material: the middle stays clear and only the frame plus a
      // couple of highlight streaks are painted, the way Minecraft draws glass.
      for (let i = 0; i < 16; i++) {
        const edge = vary(rand, [190, 220, 232], 7);
        paint(i, 0, edge);
        paint(i, 15, edge);
        paint(0, i, edge);
        paint(15, i, edge);
      }
      // A faint inner lip on the top and left only, which is what gives the
      // pane its sense of thickness.
      for (let i = 1; i < 15; i++) {
        paint(i, 1, vary(rand, [206, 232, 240], 6));
        paint(1, i, vary(rand, [206, 232, 240], 6));
      }
      // The two highlight streaks, drawn as clean diagonals rather than noise.
      for (let i = 0; i < 9; i++) {
        paint(3 + i, 13 - i, vary(rand, [234, 246, 250], 5));
      }
      for (let i = 0; i < 5; i++) {
        paint(9 + i, 6 - i, vary(rand, [242, 250, 252], 4));
      }
      for (let i = 0; i < 4; i++) {
        paint(2 + i, 3, vary(rand, [220, 238, 244], 6));
      }
    },

    farmland_top(paint, rand) {
      paintDirtBase(paint, rand);
      // Four dry furrows running across the tile, drawn darker and drier than
      // plain dirt so a tilled field reads from the air.
      for (let row = 0; row < 4; row++) {
        const y = 2 + row * 4;
        for (let x = 0; x < 16; x++) {
          paint(x, y, vary(rand, [86, 58, 36], 7));
          if (x % 3 === 0) paint(x, y + 1, vary(rand, [104, 72, 46], 7));
        }
      }
      for (let i = 0; i < 12; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [122, 88, 58], 6));
      }
    },

    bedrock(paint, rand) {
      pixelNoise(paint, rand, [74, 74, 76], 10);
      for (let i = 0; i < 6; i++) {
        const x = (rand() * 14) | 0;
        const y = (rand() * 14) | 0;
        paint(x, y, vary(rand, [30, 30, 33], 6));
        paint(x + 1, y, vary(rand, [30, 30, 33], 6));
        if (rand() < 0.6) paint(x, y + 1, vary(rand, [30, 30, 33], 6));
        if (rand() < 0.5) paint(x + 1, y + 1, vary(rand, [38, 38, 41], 6));
      }
      for (let i = 0; i < 12; i++) {
        paint((rand() * 16) | 0, (rand() * 16) | 0, vary(rand, [104, 104, 108], 6));
      }
    }
  };

  for (let stage = 0; stage < 10; stage++) {
    painters['crack_' + stage] = (paint, rand) => {
      if (stage === 0) return;
      const rays = 2 + stage;
      for (let i = 0; i < rays; i++) {
        const angle = i * 2.399963 + 0.35;
        const len = 2 + stage * 0.85 + (i % 3);
        for (let t = 1; t <= len; t++) {
          const x = Math.round(7.5 + Math.cos(angle) * t);
          const y = Math.round(7.5 + Math.sin(angle) * t);
          if (x >= 0 && x < 16 && y >= 0 && y < 16) {
            paint(x, y, vary(rand, [22, 22, 24], 6), 200);
          }
        }
        if (stage > 5 && i % 2 === 0) {
          const bx = Math.round(7.5 + Math.cos(angle) * (len - 1));
          const by = Math.round(7.5 + Math.sin(angle) * (len - 1));
          paint(bx + 1, by, [22, 22, 24], 160);
          paint(bx, by + 1, [22, 22, 24], 160);
        }
      }
    };
  }

  // Wheat is drawn on crossed quads, so only the plant itself is painted and
  // the rest of each tile stays clear. Four thin shoots grow taller, lean over
  // and fill out a golden ear as the stages run on, topping out around three
  // quarters of the block so a ripe field still shows sky between the ears.
  const WHEAT_HEIGHTS = [2, 4, 5, 7, 8, 10, 11, 12];
  for (let stage = 0; stage < 8; stage++) {
    painters['wheat_' + stage] = (paint, rand) => {
      const height = WHEAT_HEIGHTS[stage];
      const top = 15 - height;
      const ripening = stage >= 5;
      const stalk = ripening ? [188, 170, 92] : [76, 142, 62];
      const leaf = ripening ? [156, 140, 70] : [56, 116, 48];
      const grain = [228, 208, 122];

      for (const base of [2, 6, 10, 14]) {
        const lean = stage >= 4 && rand() < 0.45 ? (rand() < 0.5 ? -1 : 1) : 0;
        for (let y = 0; y < height; y++) {
          const x = base + (y >= height - 3 ? lean : 0);
          paint(x, 15 - y, vary(rand, stalk, 12));
        }
        if (stage >= 2) {
          // A pair of leaves branching off the upper stalk.
          paint(base - 1, top + 3, vary(rand, leaf, 10));
          paint(base + 1, top + 2, vary(rand, leaf, 10));
        }
        if (stage >= 5) {
          // The ear: two pixels of grain wide, tapering to a point at the tip.
          for (let y = height - 1; y >= height - 5; y--) {
            const x = base + (y >= height - 2 ? lean : 0);
            paint(x, 15 - y, vary(rand, grain, 10));
            if (y < height - 1) paint(x + 1, 15 - y, vary(rand, grain, 8));
          }
        }
        if (stage >= 6 && top - 1 >= 0) {
          // A single awn reaching up from the ear.
          paint(base + lean, top - 1, vary(rand, grain, 6));
        }
      }
    };
  }

  // A door leaf painted across two tiles that meet at the cell boundary:
  // upright stiles down the sides, a rail across the top, a planked panel,
  // and a brass knob on the lower leaf. The wood runs a shade darker than
  // planks so a door does not merge into the wall beside it.
  function paintDoorLeaf(paint, rand, isTop) {
    const frame = [110, 80, 46];
    const base = [162, 124, 76];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        paint(x, y, vary(rand, base, 5));
      }
    }
    // Vertical planking through the middle of the leaf, a thin seam every
    // four pixels. The upper leaf leaves room for the top rail to return.
    for (let y = isTop ? 2 : 0; y < 16; y++) {
      for (let x = 2; x < 14; x++) {
        if (x % 4 === 3) paint(x, y, vary(rand, [130, 98, 58], 4));
      }
    }
    for (let y = 0; y < 16; y++) {
      for (const x of [0, 1, 14, 15]) paint(x, y, vary(rand, frame, 4));
    }
    if (isTop) {
      for (let x = 0; x < 16; x++) paint(x, 0, vary(rand, frame, 4));
      paint(3, 1, vary(rand, frame, 4));
      paint(12, 1, vary(rand, frame, 4));
    } else {
      // A bottom rail and the knob sitting at mid-door height.
      for (let y = 13; y < 16; y++) {
        for (let x = 0; x < 16; x++) paint(x, y, vary(rand, frame, 4));
      }
      for (let y = 4; y < 7; y++) {
        paint(12, y, [210, 172, 84]);
        paint(13, y, [186, 148, 68]);
      }
      paint(12, 4, [240, 210, 130]);
    }
  }
  painters.door_lower = (paint, rand) => paintDoorLeaf(paint, rand, false);
  painters.door_upper = (paint, rand) => paintDoorLeaf(paint, rand, true);

  // A bed reads in three tiles: a red blanket for the top and long sides,
  // a plain wooden board for the foot and head ends, and a white pillow for
  // the head cell. The blanket keeps a fold line so the slab has a grain.
  const BED_BLANKET = [178, 46, 46];
  const BED_WOOD = [122, 90, 54];
  function paintBedSide(paint, rand) {
    // Wooden rail along the bottom, blanket over the rest.
    for (let y = 12; y < 16; y++) {
      for (let x = 0; x < 16; x++) paint(x, y, vary(rand, BED_WOOD, 5));
    }
    for (let y = 1; y < 12; y++) {
      for (let x = 0; x < 16; x++) paint(x, y, vary(rand, BED_BLANKET, 7));
    }
    for (let x = 0; x < 16; x++) paint(x, 12, vary(rand, [142, 106, 64], 4));
    // A hem where the blanket hangs over the frame, and one fold seam.
    for (let x = 0; x < 16; x++) paint(x, 11, vary(rand, [152, 36, 38], 4));
    for (let y = 1; y < 11; y++) paint(11, y, vary(rand, [156, 38, 40], 4));
    for (let x = 0; x < 16; x++) paint(x, 0, vary(rand, BED_WOOD, 5));
  }
  painters.bed_side = paintBedSide;

  function paintBedTop(paint, rand) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) paint(x, y, vary(rand, BED_BLANKET, 7));
    }
    // Wooden rims at the two ends of the cell, fold across the middle.
    for (let x = 0; x < 16; x++) {
      paint(x, 0, vary(rand, BED_WOOD, 5));
      paint(x, 15, vary(rand, BED_WOOD, 5));
    }
    for (let y = 1; y < 15; y++) paint(11, y, vary(rand, [156, 38, 40], 4));
    for (let y = 1; y < 15; y++) paint(3, y, vary(rand, [196, 60, 56], 5));
  }
  painters.bed_top = paintBedTop;

  function paintBedEnd(paint, rand) {
    // Vertical plank boards with a rail across the top, like a small fence.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) paint(x, y, vary(rand, BED_WOOD, 5));
    }
    for (let x = 3; x < 16; x += 4) {
      for (let y = 0; y < 16; y++) paint(x, y, vary(rand, [100, 72, 42], 4));
    }
    for (let x = 0; x < 16; x++) {
      paint(x, 0, vary(rand, [142, 106, 64], 4));
      paint(x, 1, vary(rand, [142, 106, 64], 4));
    }
  }
  painters.bed_end = paintBedEnd;

  function paintBedPillow(paint, rand) {
    // A plump white pillow: pale centre, soft grey edges, a seam near the top.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) paint(x, y, vary(rand, [214, 216, 222], 6));
    }
    for (let x = 0; x < 16; x++) {
      paint(x, 0, vary(rand, [188, 190, 198], 5));
      paint(x, 1, vary(rand, [232, 234, 240], 5));
    }
    for (let y = 0; y < 16; y++) {
      paint(0, y, vary(rand, [188, 190, 198], 5));
      paint(15, y, vary(rand, [188, 190, 198], 5));
    }
    for (let x = 2; x < 14; x++) paint(x, 5, vary(rand, [240, 242, 246], 4));
  }
  painters.bed_pillow = paintBedPillow;

  // A chest reads as a banded crate: planks ringed with a dark rim at the
  // edges, a lid held shut across the top quarter of the box, and an iron
  // hasp over the seam on the face turned towards you. The wood sits a shade
  // lighter than a door's so the box never merges into a plank wall.
  const CHEST_WOOD = [176, 138, 84];
  const CHEST_SEAM = [140, 106, 60];
  const CHEST_RIM = [104, 74, 40];

  /** Body shared by the chest's side and front: lid above, planks below. */
  function paintChestBody(paint, rand) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) paint(x, y, vary(rand, CHEST_WOOD, 6));
    }
    // The lid's boards lie flat, then a dark seam divides them from the
    // upright planking of the body below.
    for (let x = 0; x < 16; x++) {
      if (x % 5 === 2) {
        for (let y = 0; y < 4; y++) paint(x, y, vary(rand, CHEST_SEAM, 4));
      }
      paint(x, 4, vary(rand, CHEST_RIM, 4));
    }
    for (let y = 5; y < 15; y++) {
      for (let x = 2; x < 14; x++) {
        if (x % 4 === 3) paint(x, y, vary(rand, CHEST_SEAM, 4));
      }
    }
    // Rim down both edges and along the foot, the corner battens of the crate.
    for (let y = 0; y < 16; y++) {
      paint(0, y, vary(rand, CHEST_RIM, 4));
      paint(15, y, vary(rand, CHEST_RIM, 4));
    }
    for (let x = 0; x < 16; x++) paint(x, 15, vary(rand, CHEST_RIM, 4));
  }

  painters.chest_side = paintChestBody;

  painters.chest_front = (paint, rand) => {
    paintChestBody(paint, rand);
    // Iron strap down from the lid's edge into a lock plate straddling the
    // seam, with a dark keyhole punched through the plate.
    for (let y = 0; y < 7; y++) {
      paint(7, y, vary(rand, [118, 120, 128], 6));
      paint(8, y, vary(rand, [92, 94, 102], 6));
    }
    for (let x = 6; x < 10; x++) {
      for (let y = 6; y < 11; y++) paint(x, y, vary(rand, [108, 110, 118], 6));
    }
    for (const x of [6, 9]) {
      for (const y of [6, 10]) paint(x, y, vary(rand, [70, 72, 80], 5));
    }
    paint(7, 8, vary(rand, [36, 36, 42], 3));
    paint(8, 8, vary(rand, [36, 36, 42], 3));
    paint(7, 9, vary(rand, [36, 36, 42], 3));
    paint(8, 9, vary(rand, [36, 36, 42], 3));
    paint(7, 7, vary(rand, [168, 170, 180], 8));
  };

  painters.chest_top = (paint, rand) => {
    // The lid seen from above: boards across the middle, dark battens along
    // the edges, the same palette as the box below it.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) paint(x, y, vary(rand, CHEST_WOOD, 6));
    }
    for (let y = 0; y < 16; y++) {
      if (y % 5 === 2) {
        for (let x = 1; x < 15; x++) paint(x, y, vary(rand, CHEST_SEAM, 4));
      }
    }
    for (let i = 0; i < 16; i++) {
      const rim = vary(rand, CHEST_RIM, 4);
      paint(i, 0, rim);
      paint(i, 15, rim);
      paint(0, i, rim);
      paint(15, i, rim);
    }
    // The hasp's strap crosses the lid's front edge, lining itself up with
    // the one drawn down the chest's face.
    paint(7, 15, vary(rand, [118, 120, 128], 6));
    paint(8, 15, vary(rand, [92, 94, 102], 6));
  };

  // A ladder is two rails and four rungs, and nothing else: whatever sits
  // between them has to stay clear so the wall behind shows through the cutout
  // pass. The rungs fall a quarter of a block apart, which is how far apart
  // Minecraft puts them and what makes a climb read as four even steps.
  const LADDER_RAIL = [118, 86, 48];
  const LADDER_RAIL_EDGE = [92, 66, 36];
  const LADDER_RUNG = [168, 132, 78];
  const LADDER_RUNG_EDGE = [126, 96, 54];
  painters.ladder = (paint, rand) => {
    // The shaded half of each rail is the side further from the sun, which is
    // what keeps a ladder on a south wall from reading as one flat brown line.
    for (let y = 0; y < 16; y++) {
      paint(0, y, vary(rand, LADDER_RAIL, 8));
      paint(1, y, vary(rand, LADDER_RAIL_EDGE, 8));
      paint(14, y, vary(rand, LADDER_RAIL, 8));
      paint(15, y, vary(rand, LADDER_RAIL_EDGE, 8));
    }
    // Rungs over the rails, the way a real one is built: the uprights run
    // behind the steps rather than the other way round.
    for (const row of [1, 5, 9, 13]) {
      for (let x = 0; x < 16; x++) {
        paint(x, row, vary(rand, LADDER_RUNG, 8));
        paint(x, row + 1, vary(rand, LADDER_RUNG_EDGE, 8));
      }
    }
  };

  for (const name of TILE_ORDER) {
    const index = TILES[name];
    const tx = index % ATLAS_GRID;
    const ty = (index / ATLAS_GRID) | 0;
    const rand = mulberry32(hashString('voxelcraft:tile:' + name));

    const paint = (x, y, color, alpha = 255) => {
      if (x < 0 || x >= ATLAS_TILE || y < 0 || y >= ATLAS_TILE) return;
      const px = ((ty * ATLAS_TILE + y) * ATLAS_SIZE + tx * ATLAS_TILE + x) * 4;
      data[px] = color[0];
      data[px + 1] = color[1];
      data[px + 2] = color[2];
      data[px + 3] = alpha;
    };

    painters[name](paint, rand);
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

export const atlasCanvas = generateAtlas();
export const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
atlasTexture.colorSpace = THREE.SRGBColorSpace;
atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
atlasTexture.needsUpdate = true;

for (const block of BLOCKS) {
  if (!block.tiles) continue;
  block.tileTop = TILES[block.tiles.top];
  block.tileBottom = TILES[block.tiles.bottom];
  block.tileSide = TILES[block.tiles.side];
  if (block.tiles.front !== undefined) {
    block.tileFront = TILES[block.tiles.front];
  }
}

const TILE_RECT_CACHE = new Array(TILE_ORDER.length);
export function tileRect(index) {
  let rect = TILE_RECT_CACHE[index];
  if (rect) return rect;
  const tx = index % ATLAS_GRID;
  const ty = (index / ATLAS_GRID) | 0;
  rect = {
    u0: (tx * ATLAS_TILE + 0.5) / ATLAS_SIZE,
    u1: ((tx + 1) * ATLAS_TILE - 0.5) / ATLAS_SIZE,
    vTop: 1 - (ty * ATLAS_TILE + 0.5) / ATLAS_SIZE,
    vBottom: 1 - ((ty + 1) * ATLAS_TILE - 0.5) / ATLAS_SIZE
  };
  TILE_RECT_CACHE[index] = rect;
  return rect;
}
