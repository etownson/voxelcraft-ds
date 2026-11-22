/*
 * The geometry for one chunk: which faces to emit, how to orient a stair or a
 * door or a bed, how to average the light across a corner so that a wall reads
 * as one surface instead of sixteen, and how to pack the result into the
 * attributes the terrain shader reads. A function of a world and a chunk, in and
 * out. It builds faces and stops — which is why the chunk manager, not the
 * mesher, is the one that says a chunk is solid enough to stand an animal on.
 */

import * as THREE from 'three';
import { TILES, tileRect } from './atlas.js';
import { BLOCKS, isWater, waterLevel, waterSurfaceHeight } from './blocks.js';
import {
  B, CHUNK_SIZE, LADDER_PLANK, WATER_CORNER_CELLS, WORLD_HEIGHT, blockIndex
} from './config.js';
import { cutoutMaterial, opaqueMaterial, waterMaterial } from './render.js';

export const FACES = [
  { n: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0], shade: 0.8, kind: 'side' },
  { n: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0], shade: 0.8, kind: 'side' },
  { n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1], shade: 1.0, kind: 'top' },
  { n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1], shade: 0.6, kind: 'bottom' },
  { n: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0], shade: 0.8, kind: 'side' },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.8, kind: 'side' }
];

export const FACE_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_LEVELS = [0.48, 0.66, 0.83, 1.0];

class MeshBuilder {
  constructor() {
    this.positions = [];
    this.uvs = [];
    this.skyLight = [];
    this.blockLight = [];
    this.shade = [];
    this.indices = [];
    this.vertexCount = 0;
  }

  quad(positions, rect, sky, blockLight, shades) {
    const base = this.vertexCount;
    const uvs = [
      [rect.u0, rect.vBottom],
      [rect.u1, rect.vBottom],
      [rect.u1, rect.vTop],
      [rect.u0, rect.vTop]
    ];
    for (let i = 0; i < 4; i++) {
      this.positions.push(positions[i][0], positions[i][1], positions[i][2]);
      this.uvs.push(uvs[i][0], uvs[i][1]);
      this.skyLight.push(sky);
      this.blockLight.push(blockLight);
      this.shade.push(shades[i]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.vertexCount += 4;
  }
}

function skyBrightness(level) {
  return level <= 0 ? 0 : Math.pow(level / 15, 1.32);
}

function blockBrightness(level) {
  return level <= 0 ? 0 : Math.pow(level / 15, 1.2);
}

function faceVisible(blockId, neighborId) {
  if (neighborId === B.AIR) return true;
  if (isWater(neighborId)) return !isWater(blockId);
  return !BLOCKS[neighborId].opaque;
}

export function buildChunkMesh(world, chunk) {
  for (const mesh of chunk.meshes) {
    chunk.group.remove(mesh);
    mesh.geometry.dispose();
  }
  chunk.meshes.length = 0;

  const opaque = new MeshBuilder();
  const cutout = new MeshBuilder();
  const water = new MeshBuilder();
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const blocks = chunk.blocks;

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = blocks[blockIndex(x, y, z)];
        if (id === B.AIR) continue;

        const wx = baseX + x;
        const wz = baseZ + z;

        if (id === B.TORCH) {
          appendTorch(cutout, world, x, y, z, wx, wz);
          continue;
        }
        if (isWater(id)) {
          appendWaterFaces(water, world, x, y, z, wx, wz, id);
          continue;
        }

        const block = BLOCKS[id];
        if (block.crop !== null) {
          appendCropQuads(cutout, world, x, y, z, wx, wz, block);
          continue;
        }
        if (block.door) {
          appendDoorPanel(cutout, world, x, y, z, wx, wz, block);
          continue;
        }
        if (block.bed) {
          appendBedBoxes(cutout, world, x, y, z, wx, wz, block);
          continue;
        }
        if (block.stairs) {
          appendStairBoxes(opaque, world, x, y, z, wx, wz, block);
          continue;
        }
        if (block.ladder) {
          appendLadderPlate(cutout, world, x, y, z, wx, wz, block);
          continue;
        }
        const target = block.cutout ? cutout : opaque;

        for (const face of FACES) {
          const nx = x + face.n[0];
          const ny = y + face.n[1];
          const nz = z + face.n[2];
          const neighborId = world.getBlock(wx + face.n[0], y + face.n[1], wz + face.n[2]);
          if (!faceVisible(id, neighborId)) continue;

          let tileIndex;
          if (face.kind === 'top') tileIndex = block.tileTop;
          else if (face.kind === 'bottom') tileIndex = block.tileBottom;
          else {
            tileIndex = block.tileSide;
            // Oriented blocks draw a special face towards their front normal.
            // Facings are stored as a two-cell [dx, dz] pair.
            if (block.tileFront !== undefined) {
              const facing = world.facingAt(wx, y, wz);
              if (facing && face.n[0] === facing[0] && face.n[2] === facing[1]) {
                tileIndex = block.tileFront;
              }
            }
          }

          const sky = skyBrightness(world.getSkyLight(wx + face.n[0], y + face.n[1], wz + face.n[2]));
          const blockLight = blockBrightness(world.getBlockLight(wx + face.n[0], y + face.n[1], wz + face.n[2]));

          const positions = [];
          const shades = [];
          for (let i = 0; i < 4; i++) {
            const cu = FACE_CORNERS[i][0];
            const cv = FACE_CORNERS[i][1];
            positions.push([
              x + 0.5 + face.n[0] * 0.5 + (face.u[0] * cu + face.v[0] * cv) * 0.5,
              y + 0.5 + face.n[1] * 0.5 + (face.u[1] * cu + face.v[1] * cv) * 0.5,
              z + 0.5 + face.n[2] * 0.5 + (face.u[2] * cu + face.v[2] * cv) * 0.5
            ]);
            const side1 = world.isOpaque(
              wx + face.n[0] + face.u[0] * cu,
              y + face.n[1] + face.u[1] * cu,
              wz + face.n[2] + face.u[2] * cu
            ) ? 1 : 0;
            const side2 = world.isOpaque(
              wx + face.n[0] + face.v[0] * cv,
              y + face.n[1] + face.v[1] * cv,
              wz + face.n[2] + face.v[2] * cv
            ) ? 1 : 0;
            const corner = world.isOpaque(
              wx + face.n[0] + face.u[0] * cu + face.v[0] * cv,
              y + face.n[1] + face.u[1] * cu + face.v[1] * cv,
              wz + face.n[2] + face.u[2] * cu + face.v[2] * cv
            ) ? 1 : 0;
            shades.push(face.shade * AO_LEVELS[side1 + side2 + corner]);
          }

          target.quad(positions, tileRect(tileIndex), sky, blockLight, shades);
        }
      }
    }
  }

  commitChunkMesh(chunk, opaque, opaqueMaterial, 'opaque');
  commitChunkMesh(chunk, cutout, cutoutMaterial, 'cutout');
  commitChunkMesh(chunk, water, waterMaterial, 'water');
  chunk.meshed = true;
}

/**
 * Whether the water overhead buries this cell in the body rather than leaving
 * it a surface. Water resting on top of water presses the cell under it up to
 * its ceiling, which is what makes a stack read as one surface instead of a
 * pile of layers. A stream pouring past is the one exception: a fall is not a
 * body, and a pool it lands in has a depth of its own to show. Without that
 * exception the cell at the foot of every waterfall swells to a full block.
 */
function waterBuriedAbove(id, aboveId) {
  return isWater(aboveId) && (BLOCKS[id].falling || !BLOCKS[aboveId].falling);
}

/**
 * How full a cell's share of the water surface is, or null if it holds none.
 * A buried cell is the whole cell: only the top of a body of water is a surface.
 */
function waterTopAt(world, wx, wy, wz) {
  const id = world.getBlock(wx, wy, wz);
  if (!isWater(id)) return null;
  if (waterBuriedAbove(id, world.getBlock(wx, wy + 1, wz))) return 1;
  return waterSurfaceHeight(waterLevel(id));
}

/**
 * The surface height at a corner of the grid, averaged over the water cells
 * that meet there. Every cell reads the same number for a corner they share, so
 * a deep cell and a shallow one slope into each other along their common edge
 * instead of leaving a step, which is what keeps a spreading sheet from looking
 * like a staircase. A corner no water touches stands at nothing.
 */
function waterCornerHeight(world, wx, wy, wz) {
  let sum = 0;
  let count = 0;
  for (const [dx, dz] of WATER_CORNER_CELLS) {
    const height = waterTopAt(world, wx + dx, wy, wz + dz);
    if (height === null) continue;
    sum += height;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Water renders as a body with a surface, not as a stack of cubes. The top face
 * bends to the blended corner heights of the sheet, and the side faces skirt
 * down from that surface to the floor of the cell — or, for a stream, to the
 * surface of the pool it is falling into. Neighbouring water cells need no face
 * between them at all: sharing corner heights means their surfaces meet exactly
 * along the edge they have in common, and each body draws one surface at its
 * own top, which is what keeps a stack from being seen through.
 */
function appendWaterFaces(builder, world, x, y, z, wx, wz, id) {
  const rect = tileRect(BLOCKS[id].tileSide);
  const buried = waterBuriedAbove(id, world.getBlock(wx, y + 1, wz));

  // Corners of the cell, in the order the top face and the light sampling use.
  const h00 = buried ? 1 : waterCornerHeight(world, wx, y, wz);
  const h10 = buried ? 1 : waterCornerHeight(world, wx + 1, y, wz);
  const h01 = buried ? 1 : waterCornerHeight(world, wx, y, wz + 1);
  const h11 = buried ? 1 : waterCornerHeight(world, wx + 1, y, wz + 1);
  const cornerHeight = (cx, cz) => (cx === 0
    ? (cz === 0 ? h00 : h01)
    : (cz === 0 ? h10 : h11));
  // A stream is drawn down to the surface it falls into. Water landing on water
  // keeps the depth it arrived with, which can sit well below the floor of the
  // cell the stream ends in, so the skirt starts there instead and the pour reads
  // as one ribbon into the pool rather than stopping a block short of it. Water
  // resting on a full body gets nothing: its surface is already the ceiling.
  let f00 = 0;
  let f10 = 0;
  let f01 = 0;
  let f11 = 0;
  if (BLOCKS[id].falling && isWater(world.getBlock(wx, y - 1, wz))) {
    f00 = waterCornerHeight(world, wx, y - 1, wz) - 1;
    f10 = waterCornerHeight(world, wx + 1, y - 1, wz) - 1;
    f01 = waterCornerHeight(world, wx, y - 1, wz + 1) - 1;
    f11 = waterCornerHeight(world, wx + 1, y - 1, wz + 1) - 1;
  }
  const floorHeight = (cx, cz) => (cx === 0
    ? (cz === 0 ? f00 : f01)
    : (cz === 0 ? f10 : f11));

  for (const face of FACES) {
    const neighborId = world.getBlock(wx + face.n[0], y + face.n[1], wz + face.n[2]);
    // Water against water needs no face, with one exception: the surface. The
    // cell under a stream is not buried in the body, so it still has a surface
    // of its own to draw, and without it the pool a waterfall lands in reads as
    // a hole the seabed shows through.
    if (isWater(neighborId) && face.kind !== 'top') continue;
    if (BLOCKS[neighborId].opaque) continue;

    const sky = skyBrightness(world.getSkyLight(wx + face.n[0], y + face.n[1], wz + face.n[2]));
    const blockLight = blockBrightness(world.getBlockLight(wx + face.n[0], y + face.n[1], wz + face.n[2]));
    const shades = [face.shade * 0.94, face.shade * 0.94, face.shade * 0.94, face.shade * 0.94];
    let positions;

    if (face.kind === 'top') {
      // A buried cell is filled to its ceiling and sealed by the water above it,
      // so it has no surface: only the top of a body of water ever draws one.
      if (buried) continue;
      positions = [
        [x, y + h01, z + 1],
        [x + 1, y + h11, z + 1],
        [x + 1, y + h10, z],
        [x, y + h00, z]
      ];
    } else if (face.kind === 'bottom') {
      positions = [
        [x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]
      ];
    } else {
      // The two ends of the edge this face owns, and how high the surface runs
      // at each of them. The skirt starts at the floor of the cell, so a thin
      // sheet still shows a side wherever the ground under it drops away, and at
      // the foot of a pour it starts on the surface below instead.
      const ax = x + 0.5 + face.n[0] * 0.5 - face.u[0] * 0.5;
      const az = z + 0.5 + face.n[2] * 0.5 - face.u[2] * 0.5;
      const bx = x + 0.5 + face.n[0] * 0.5 + face.u[0] * 0.5;
      const bz = z + 0.5 + face.n[2] * 0.5 + face.u[2] * 0.5;
      positions = [
        [ax, y + floorHeight(Math.round(ax - x), Math.round(az - z)), az],
        [bx, y + floorHeight(Math.round(bx - x), Math.round(bz - z)), bz],
        [bx, y + cornerHeight(Math.round(bx - x), Math.round(bz - z)), bz],
        [ax, y + cornerHeight(Math.round(ax - x), Math.round(az - z)), az]
      ];
    }

    builder.quad(positions, rect, sky, blockLight, shades);
  }
}

function appendTorch(builder, world, x, y, z, wx, wz) {
  const block = BLOCKS[B.TORCH];
  const rect = tileRect(block.tileSide);
  const sky = skyBrightness(world.getSkyLight(wx, y, wz));
  const blockLight = blockBrightness(world.getBlockLight(wx, y, wz));
  const height = 0.8;
  const shades = [1, 1, 1, 1];

  const planeA = [
    [x + 0.15, y, z + 0.85],
    [x + 0.85, y, z + 0.15],
    [x + 0.85, y + height, z + 0.15],
    [x + 0.15, y + height, z + 0.85]
  ];
  const planeB = [
    [x + 0.15, y, z + 0.15],
    [x + 0.85, y, z + 0.85],
    [x + 0.85, y + height, z + 0.85],
    [x + 0.15, y + height, z + 0.15]
  ];
  builder.quad(planeA, rect, sky, blockLight, shades);
  builder.quad(planeB, rect, sky, blockLight, shades);
}

/**
 * A wheat crop is two crossing quads, the same trick the torch uses. The tile
 * art decides how tall the plant stands, so every growth stage shares this
 * geometry, and the planes sit just inside the cell so neighbouring crops do
 * not fight over the same pixels.
 */
function appendCropQuads(builder, world, x, y, z, wx, wz, block) {
  const rect = tileRect(block.tileSide);
  const sky = skyBrightness(world.getSkyLight(wx, y, wz));
  const blockLight = blockBrightness(world.getBlockLight(wx, y, wz));
  const shades = [1, 1, 1, 1];

  const planeA = [
    [x + 0.18, y, z + 0.82],
    [x + 0.82, y, z + 0.18],
    [x + 0.82, y + 1, z + 0.18],
    [x + 0.18, y + 1, z + 0.82]
  ];
  const planeB = [
    [x + 0.18, y, z + 0.18],
    [x + 0.82, y, z + 0.82],
    [x + 0.82, y + 1, z + 0.82],
    [x + 0.18, y + 1, z + 0.18]
  ];
  builder.quad(planeA, rect, sky, blockLight, shades);
  builder.quad(planeB, rect, sky, blockLight, shades);
}

/**
 * A door leaf is a thin wood panel in its cell, textured on both broad faces
 * so it reads the same from inside and out. Closed it spans the doorway;
 * open it lies flat against the jamb its hinge is on. The upper half draws
 * the same box one cell up, so two cells read as one tall door.
 */
function appendDoorPanel(builder, world, x, y, z, wx, wz, block) {
  const rect = tileRect(block.tileSide);
  const capRect = tileRect(TILES.planks);
  const sky = skyBrightness(world.getSkyLight(wx, y, wz));
  const blockLight = blockBrightness(world.getBlockLight(wx, y, wz));

  const facing = world.facingAt(wx, y, wz) ?? [0, 1];
  const nx = facing[0];
  const nz = facing[1];
  // Across the doorway, hinge end first: a runs along the leaf's width and
  // b along the facing normal, both in 0..1 cell coordinates.
  const hx = -nz;
  const hz = nx;
  const T = 0.18;

  let aMin = 0;
  let aMax = 1;
  let bMin = 0.5 - T / 2;
  let bMax = 0.5 + T / 2;
  if (block.doorOpen) {
    aMax = T;
    bMin = 0;
    bMax = 1;
  }

  const corner = (a, b, py) => [
    x + 0.5 + (a - 0.5) * hx + (b - 0.5) * nx,
    py,
    z + 0.5 + (a - 0.5) * hz + (b - 0.5) * nz
  ];
  const flat = (shade) => [shade, shade, shade, shade];

  // Both broad faces, then the thin edges: jambs, top and bottom.
  builder.quad([
    corner(aMin, bMin, y), corner(aMax, bMin, y),
    corner(aMax, bMin, y + 1), corner(aMin, bMin, y + 1)
  ], rect, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMin, bMax, y), corner(aMax, bMax, y),
    corner(aMax, bMax, y + 1), corner(aMin, bMax, y + 1)
  ], rect, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMin, bMin, y), corner(aMin, bMax, y),
    corner(aMin, bMax, y + 1), corner(aMin, bMin, y + 1)
  ], capRect, sky, blockLight, flat(0.62));
  builder.quad([
    corner(aMax, bMin, y), corner(aMax, bMax, y),
    corner(aMax, bMax, y + 1), corner(aMax, bMin, y + 1)
  ], capRect, sky, blockLight, flat(0.62));
  builder.quad([
    corner(aMin, bMin, y + 1), corner(aMax, bMin, y + 1),
    corner(aMax, bMax, y + 1), corner(aMin, bMax, y + 1)
  ], capRect, sky, blockLight, flat(1));
  builder.quad([
    corner(aMin, bMin, y), corner(aMax, bMin, y),
    corner(aMax, bMax, y), corner(aMin, bMax, y)
  ], capRect, sky, blockLight, flat(0.55));
}

/**
 * A bed is a low mattress slab across both cells, half a block tall, with a
 * pillow riding the far end of the head cell. Along the length the blanket
 * tile shows (wooden rail along its bottom edge), the two ends read as plain
 * boards, and the cutout material is double-sided like the door's, so a bed
 * seen from the foot and from the head is the same bed.
 */
function appendBedBoxes(builder, world, x, y, z, wx, wz, block) {
  const sideRect = tileRect(TILES.bed_side);
  const topRect = tileRect(TILES.bed_top);
  const endRect = tileRect(TILES.bed_end);
  const pillowRect = tileRect(TILES.bed_pillow);
  const capRect = tileRect(TILES.planks);
  const sky = skyBrightness(world.getSkyLight(wx, y, wz));
  const blockLight = blockBrightness(world.getBlockLight(wx, y, wz));

  const facing = world.facingAt(wx, y, wz) ?? [0, 1];
  const nx = facing[0];
  const nz = facing[1];
  // b runs along the bed towards the head, a across it.
  const hx = -nz;
  const hz = nx;
  const corner = (a, b, py) => [
    x + 0.5 + (a - 0.5) * hx + (b - 0.5) * nx,
    py,
    z + 0.5 + (a - 0.5) * hz + (b - 0.5) * nz
  ];
  const flat = (shade) => [shade, shade, shade, shade];

  const aMin = 0.03;
  const aMax = 0.97;
  const bMin = 0.02;
  const bMax = 0.98;
  const top = y + 0.5;

  // Mattress slab: blanket on top and along the length, boards at the ends.
  builder.quad([
    corner(aMin, bMin, top), corner(aMax, bMin, top),
    corner(aMax, bMax, top), corner(aMin, bMax, top)
  ], topRect, sky, blockLight, flat(1));
  builder.quad([
    corner(aMin, bMin, y), corner(aMax, bMin, y),
    corner(aMax, bMax, y), corner(aMin, bMax, y)
  ], capRect, sky, blockLight, flat(0.55));
  builder.quad([
    corner(aMin, bMin, y), corner(aMax, bMin, y),
    corner(aMax, bMin, top), corner(aMin, bMin, top)
  ], sideRect, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMin, bMax, y), corner(aMax, bMax, y),
    corner(aMax, bMax, top), corner(aMin, bMax, top)
  ], sideRect, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMin, bMin, y), corner(aMin, bMax, y),
    corner(aMin, bMax, top), corner(aMin, bMin, top)
  ], endRect, sky, blockLight, flat(0.62));
  builder.quad([
    corner(aMax, bMin, y), corner(aMax, bMax, y),
    corner(aMax, bMax, top), corner(aMax, bMin, top)
  ], endRect, sky, blockLight, flat(0.62));

  // The pillow sits only on the head cell, pushed to the far end of it.
  if (block.bed === 'head') {
    const pMin = 0.18;
    const pMax = 0.82;
    const qMin = 0.6;
    const pillowTop = y + 0.66;
    builder.quad([
      corner(pMin, qMin, pillowTop), corner(pMax, qMin, pillowTop),
      corner(pMax, bMax, pillowTop), corner(pMin, bMax, pillowTop)
    ], pillowRect, sky, blockLight, flat(1));
    builder.quad([
      corner(pMin, qMin, top), corner(pMax, qMin, top),
      corner(pMax, qMin, pillowTop), corner(pMin, qMin, pillowTop)
    ], pillowRect, sky, blockLight, flat(0.85));
    builder.quad([
      corner(pMin, qMin, top), corner(pMin, bMax, top),
      corner(pMin, bMax, pillowTop), corner(pMin, qMin, pillowTop)
    ], pillowRect, sky, blockLight, flat(0.62));
    builder.quad([
      corner(pMax, qMin, top), corner(pMax, bMax, top),
      corner(pMax, bMax, pillowTop), corner(pMax, qMin, pillowTop)
    ], pillowRect, sky, blockLight, flat(0.62));
  }
}

/** A vertical slice of a tile rect, for a face that wears only part of it. */
function tileRectSlice(rect, fromBottom, toBottom) {
  return {
    u0: rect.u0,
    u1: rect.u1,
    vBottom: rect.vBottom + (rect.vTop - rect.vBottom) * fromBottom,
    vTop: rect.vBottom + (rect.vTop - rect.vBottom) * toBottom
  };
}

/**
 * A stair is the block it is sawn from cut along the step: a half-tall box
 * across the cell and the upper half of the block over the far half of it,
 * wearing the lower and upper halves of the family's tile so the two read
 * as one sliced block. The facing points at the low step — at whoever
 * placed it — the way the chest's latch does, and the tall half sits away
 * from it, so a line of stairs climbs away from the placer. These are the
 * same two boxes the collision uses, which is what makes a staircase
 * walkable. Wound outward on the opaque pass: the step is a closed solid,
 * not a leaf that has to read the same from behind.
 */
function appendStairBoxes(builder, world, x, y, z, wx, wz, block) {
  const sideRect = tileRect(block.tileSide);
  const topRect = tileRect(block.tileTop);
  const lowerSide = tileRectSlice(sideRect, 0, 0.5);
  const upperSide = tileRectSlice(sideRect, 0.5, 1);
  const sky = skyBrightness(world.getSkyLight(wx, y, wz));
  const blockLight = blockBrightness(world.getBlockLight(wx, y, wz));

  const facing = world.facingAt(wx, y, wz) ?? [0, 1];
  const nx = facing[0];
  const nz = facing[1];
  // b runs towards the low step, a across the tread.
  const hx = -nz;
  const hz = nx;
  const corner = (a, b, py) => [
    x + 0.5 + (a - 0.5) * hx + (b - 0.5) * nx,
    py,
    z + 0.5 + (a - 0.5) * hz + (b - 0.5) * nz
  ];
  const flat = (shade) => [shade, shade, shade, shade];

  const aMin = 0;
  const aMax = 1;
  const bMin = 0;
  const bMax = 1;
  const bMid = 0.5;
  const base = y;
  const step = y + 0.5;
  const crest = y + 1;

  // The half-tall box: tread, base, and the four walls under the step. The
  // tread is only the half the tall block does not already stand on.
  builder.quad([
    corner(aMin, bMid, step), corner(aMax, bMid, step),
    corner(aMax, bMax, step), corner(aMin, bMax, step)
  ], topRect, sky, blockLight, flat(1));
  builder.quad([
    corner(aMin, bMin, base), corner(aMin, bMax, base),
    corner(aMax, bMax, base), corner(aMax, bMin, base)
  ], sideRect, sky, blockLight, flat(0.55));
  builder.quad([
    corner(aMax, bMax, base), corner(aMin, bMax, base),
    corner(aMin, bMax, step), corner(aMax, bMax, step)
  ], lowerSide, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMin, bMin, base), corner(aMax, bMin, base),
    corner(aMax, bMin, step), corner(aMin, bMin, step)
  ], lowerSide, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMax, bMin, base), corner(aMax, bMax, base),
    corner(aMax, bMax, step), corner(aMax, bMin, step)
  ], lowerSide, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMin, bMax, base), corner(aMin, bMin, base),
    corner(aMin, bMin, step), corner(aMin, bMax, step)
  ], lowerSide, sky, blockLight, flat(0.85));

  // The tall half over the far side of the cell: crest, riser, back and
  // both ends. Its base is the tread it stands on, so it draws no floor.
  builder.quad([
    corner(aMin, bMin, crest), corner(aMax, bMin, crest),
    corner(aMax, bMid, crest), corner(aMin, bMid, crest)
  ], topRect, sky, blockLight, flat(1));
  builder.quad([
    corner(aMax, bMid, step), corner(aMin, bMid, step),
    corner(aMin, bMid, crest), corner(aMax, bMid, crest)
  ], upperSide, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMin, bMin, step), corner(aMax, bMin, step),
    corner(aMax, bMin, crest), corner(aMin, bMin, crest)
  ], upperSide, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMax, bMin, step), corner(aMax, bMid, step),
    corner(aMax, bMid, crest), corner(aMax, bMin, crest)
  ], upperSide, sky, blockLight, flat(0.85));
  builder.quad([
    corner(aMin, bMid, step), corner(aMin, bMin, step),
    corner(aMin, bMin, crest), corner(aMin, bMid, crest)
  ], upperSide, sky, blockLight, flat(0.85));
}

/**
 * A ladder is one plank standing off the wall it was nailed to, by a sixteenth
 * of a block: close enough that the wall reads as the thing behind it rather
 * than a gap, far enough that the plank catches its own edge light. The cutout
 * material is double-sided, so the same four corners serve a climber looking
 * up at the rungs and one looking down through them, and the tile leaves the
 * space between the rails clear for the wall to show through.
 */
function appendLadderPlate(builder, world, x, y, z, wx, wz, block) {
  const rect = tileRect(block.tileSide);
  const sky = skyBrightness(world.getSkyLight(wx, y, wz));
  const blockLight = blockBrightness(world.getBlockLight(wx, y, wz));

  const facing = world.facingAt(wx, y, wz) ?? [0, 1];
  const nx = facing[0];
  const nz = facing[1];
  // b runs from the wall out into the room, a across the ladder's width.
  const hx = -nz;
  const hz = nx;
  const corner = (a, b, py) => [
    x + 0.5 + (a - 0.5) * hx + (b - 0.5) * nx,
    py,
    z + 0.5 + (a - 0.5) * hz + (b - 0.5) * nz
  ];
  const flat = (shade) => [shade, shade, shade, shade];

  // Full width, full height, held off the wall by LADDER_PLANK.
  builder.quad([
    corner(0, LADDER_PLANK, y), corner(1, LADDER_PLANK, y),
    corner(1, LADDER_PLANK, y + 1), corner(0, LADDER_PLANK, y + 1)
  ], rect, sky, blockLight, flat(0.85));
}

function commitChunkMesh(chunk, builder, material, name) {
  if (builder.vertexCount === 0) return;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(builder.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(builder.uvs, 2));
  geometry.setAttribute('aSky', new THREE.Float32BufferAttribute(builder.skyLight, 1));
  geometry.setAttribute('aBlock', new THREE.Float32BufferAttribute(builder.blockLight, 1));
  geometry.setAttribute('aShade', new THREE.Float32BufferAttribute(builder.shade, 1));
  geometry.setIndex(builder.indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = chunk.group.name + '-' + name;
  mesh.frustumCulled = true;
  chunk.group.add(mesh);
  chunk.meshes.push(mesh);
}
