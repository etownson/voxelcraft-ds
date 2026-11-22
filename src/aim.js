/*
 * What the crosshair is on. The traversal is Amanatides & Woo walked with two
 * questions rather than one — which cell to stop on, which cells to walk
 * through — because a bucket has to be aimed at a cell the block ray cannot
 * even see: water is transparent to a crosshair, so pointing at the sea means
 * walking the same cells again asking a different question.
 *
 * Two things are drawn here and both are private to their own purposes: the
 * outline around whatever is aimed at, and the crack overlay the mining layer
 * puts on and takes off through `showCrack` and `hideCrack` — the only way
 * either the mesh or its stage moves, which is why `shownCrackStage` is how
 * anything else finds out what is being broken. Whether the aim is in use at all
 * is not this layer's business either, and comes in through `setAimBlocked` as a
 * question asked once a frame.
 */

import * as THREE from 'three';
import { TILES, atlasTexture, tileRect } from './atlas.js';
import { isWater, isWaterSource } from './blocks.js';
import { world } from './chunks.js';
import { B, FOCUS_REACH, clamp } from './config.js';
import { aimOrigin } from './player.js';
import { camera, scene } from './render.js';

/* ---------- Voxel raycast and target outline ---------- */

export const rayDirection = new THREE.Vector3();
export let currentTarget = null;

const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
const outlineMaterial = new THREE.LineBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.55,
  depthWrite: false
});
export const targetOutline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
targetOutline.visible = false;
targetOutline.frustumCulled = false;
scene.add(targetOutline);

const crackGeometry = new THREE.BoxGeometry(1.008, 1.008, 1.008);
const crackMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2
});
export const crackMesh = new THREE.Mesh(crackGeometry, crackMaterial);
crackMesh.visible = false;
crackMesh.frustumCulled = false;
crackMesh.renderOrder = 3;
scene.add(crackMesh);

let crackStage = -1;

function setCrackStage(stage) {
  if (stage === crackStage) return;
  crackStage = stage;
  const rect = tileRect(TILES['crack_' + clamp(stage, 0, 9)]);
  const uv = crackGeometry.attributes.uv;
  for (let face = 0; face < 6; face++) {
    const offset = face * 4;
    uv.setXY(offset, rect.u0, rect.vBottom);
    uv.setXY(offset + 1, rect.u1, rect.vBottom);
    uv.setXY(offset + 2, rect.u1, rect.vTop);
    uv.setXY(offset + 3, rect.u0, rect.vTop);
  }
  uv.needsUpdate = true;
}

/** Puts the crack overlay on a cell at one of its ten stages. */
export function showCrack(x, y, z, stage) {
  crackMesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  crackMesh.visible = true;
  setCrackStage(stage);
}

/** Takes the crack overlay off the world. */
export function hideCrack() {
  crackMesh.visible = false;
  crackStage = -1;
}

/** The cells an ordinary right click can land on. Water is transparent to it. */
const isRayTargetable = (id) => id !== B.AIR && !isWater(id);
/** What a ray may keep walking through on its way to what it is looking for. */
const isRaySeeThrough = (id) => id === B.AIR || isWater(id);

/**
 * Amanatides & Woo voxel traversal. `accept` names the cell to stop on and
 * `pass` the cells the ray is allowed to walk through; anything else is in the
 * way and the ray gives up rather than reaching past it.
 *
 * Two questions rather than one because a bucket has to be aimed at a cell the
 * block ray below cannot even see. Water is transparent to a crosshair, so the
 * only way to point at the sea is to walk the same cells again asking a
 * different question — and to stop at exactly the solid things the ordinary
 * crosshair stops at, or a bucket would drink from the pond behind a wall.
 */
function raycastCell(origin, direction, maxDistance, accept, pass) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = direction.x > 0 ? 1 : direction.x < 0 ? -1 : 0;
  const stepY = direction.y > 0 ? 1 : direction.y < 0 ? -1 : 0;
  const stepZ = direction.z > 0 ? 1 : direction.z < 0 ? -1 : 0;

  const tDeltaX = stepX ? Math.abs(1 / direction.x) : Infinity;
  const tDeltaY = stepY ? Math.abs(1 / direction.y) : Infinity;
  const tDeltaZ = stepZ ? Math.abs(1 / direction.z) : Infinity;

  let tMaxX = stepX > 0 ? (x + 1 - origin.x) / direction.x :
    stepX < 0 ? (origin.x - x) / -direction.x : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) / direction.y :
    stepY < 0 ? (origin.y - y) / -direction.y : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) / direction.z :
    stepZ < 0 ? (origin.z - z) / -direction.z : Infinity;

  let normal = { x: 0, y: 0, z: 0 };
  let distance = 0;

  for (let guard = 0; guard < 128; guard++) {
    const id = world.getBlock(x, y, z);
    if (accept(id)) return { x, y, z, id, normal, distance };
    if (!pass(id)) return null;

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      distance = tMaxX;
      tMaxX += tDeltaX;
      normal = { x: -stepX, y: 0, z: 0 };
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      distance = tMaxY;
      tMaxY += tDeltaY;
      normal = { x: 0, y: -stepY, z: 0 };
    } else {
      z += stepZ;
      distance = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = { x: 0, y: 0, z: -stepZ };
    }

    if (distance > maxDistance) break;
  }

  return null;
}

function raycastBlock(origin, direction, maxDistance) {
  return raycastCell(origin, direction, maxDistance, isRayTargetable, () => true);
}

/**
 * The water the crosshair is on, with line of sight held to air and water.
 * Flow is walked through rather than refused, so a source sitting under the
 * thin sheet of a wave still reads as the source underneath it.
 */
export function raycastWater(origin, direction, maxDistance) {
  return raycastCell(origin, direction, maxDistance, isWaterSource, isRaySeeThrough);
}

/** Nothing is being pointed at: nothing to break, nothing to place against. */
export function clearTarget() {
  currentTarget = null;
  targetOutline.visible = false;
}

/** Stops drawing the outline without forgetting what was pointed at: whoever
 *  has taken the controls away does not care what was aimed at a moment ago,
 *  and the next frame works it out again by itself. */
export function hideTargetOutline() {
  targetOutline.visible = false;
}

/** Which of the ten crack stages is drawn, or -1 when nothing is breaking. */
export function shownCrackStage() { return crackStage; }

/** Whether the crosshair is the player's to aim with. A screen in the way or a
 *  death is above this layer's business, so the answer is handed in and asked
 *  once a frame. */
let aimBlocked = () => false;

/** Handed once, at bootstrap, who says the aim is not in use. */
export function setAimBlocked(test) { aimBlocked = test; }

export function updateTarget() {
  if (aimBlocked()) {
    clearTarget();
    return null;
  }

  camera.getWorldDirection(rayDirection);
  currentTarget = raycastBlock(aimOrigin(), rayDirection, FOCUS_REACH);

  if (currentTarget) {
    targetOutline.position.set(
      currentTarget.x + 0.5,
      currentTarget.y + 0.5,
      currentTarget.z + 0.5
    );
    targetOutline.visible = true;
  } else {
    targetOutline.visible = false;
  }
  return currentTarget;
}
