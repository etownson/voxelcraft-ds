/*
 * The held item: a small scene drawn after the world with a cleared depth
 * buffer, so the stack in hand rides on top of everything and still occludes
 * itself. Cube geometry for block items is built here too, because a dropped
 * block in the world wears the same shape as one held up.
 *
 * The model never reads the game. The compositor hands it a frame — stack,
 * look, speed, hidden, mining — and every animation lives inside this file.
 */

import * as THREE from 'three';
import { atlasTexture, tileRect } from './atlas.js';
import { BLOCKS, ITEMS } from './blocks.js';
import { SPRINT_SPEED, clamp } from './config.js';
import { ITEM_ICONS } from './icons.js';
import { FACES, FACE_CORNERS } from './mesh.js';
import { camera } from './render.js';

// The view model lives in its own scene so it can be drawn after the world
// with a cleared depth buffer: always on top, yet still self-occluding.
export const heldScene = new THREE.Scene();
export const heldCamera = new THREE.PerspectiveCamera(
  camera.fov, camera.aspect, 0.01, 10
);
heldScene.add(heldCamera);

const HELD_REST_POSITION = new THREE.Vector3(0.42, -0.34, -0.72);
const HELD_REST_ROTATION = new THREE.Euler(-0.12, 0.52, 0.08);

export const heldRoot = new THREE.Group();
heldRoot.position.copy(HELD_REST_POSITION);
heldRoot.rotation.copy(HELD_REST_ROTATION);
heldRoot.frustumCulled = false;
heldCamera.add(heldRoot);

const heldCubeMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  fog: false
});
const heldCutoutMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  alphaTest: 0.45,
  side: THREE.DoubleSide,
  fog: false
});
const heldArmMaterial = new THREE.MeshBasicMaterial({
  color: 0xd7a06f,
  fog: false
});
const ITEM_CUBE_SIZE = 0.26;
const itemCubeGeometryCache = new Map();

export function buildItemCubeGeometry(block) {
  const cached = itemCubeGeometryCache.get(block.id);
  if (cached) return cached;

  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  let vertex = 0;

  for (const face of FACES) {
    const rect = tileRect(
      face.kind === 'top' ? block.tileTop :
      face.kind === 'bottom' ? block.tileBottom :
      block.tileSide
    );
    const faceUvs = [
      [rect.u0, rect.vBottom],
      [rect.u1, rect.vBottom],
      [rect.u1, rect.vTop],
      [rect.u0, rect.vTop]
    ];

    for (let i = 0; i < 4; i++) {
      const cu = FACE_CORNERS[i][0];
      const cv = FACE_CORNERS[i][1];
      positions.push(
        (face.n[0] * 0.5 + face.u[0] * cu * 0.5 + face.v[0] * cv * 0.5) * ITEM_CUBE_SIZE,
        (face.n[1] * 0.5 + face.u[1] * cu * 0.5 + face.v[1] * cv * 0.5) * ITEM_CUBE_SIZE,
        (face.n[2] * 0.5 + face.u[2] * cu * 0.5 + face.v[2] * cv * 0.5) * ITEM_CUBE_SIZE
      );
      uvs.push(faceUvs[i][0], faceUvs[i][1]);
      colors.push(face.shade * 0.9, face.shade * 0.9, face.shade * 0.9);
    }

    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
    vertex += 4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  itemCubeGeometryCache.set(block.id, geometry);
  return geometry;
}

const heldIconMaterialCache = new Map();
const heldIconGeometry = new THREE.PlaneGeometry(0.46, 0.46);
const heldArmGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.54);

function heldIconMaterial(itemId) {
  let material = heldIconMaterialCache.get(itemId);
  if (material) return material;
  const icon = ITEM_ICONS.get(itemId);
  if (!icon) return null;
  const texture = new THREE.CanvasTexture(icon.canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.05,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    fog: false
  });
  heldIconMaterialCache.set(itemId, material);
  return material;
}

export let heldModelKey = null;
let heldSwingTime = 1;
let heldSwingDuration = 0.34;
let heldBobPhase = 0;
let heldSwayX = 0;
let heldSwayY = 0;
let heldLastYaw = 0;
let heldLastPitch = 0;

/**
 * Tells the held item where the view is now pointing. Whenever the view moves
 * without being turned — a spawn, a load, being thrown by an explosion — this
 * runs, or the next frame reads the whole jump as one enormous flick of the
 * mouse and swings the arm to match.
 */
/**
 * Tells the held item where the view is now pointing, so the next frame does
 * not read a spawn or a load as one enormous flick of the mouse.
 */
export function syncHeldAngles(yaw, pitch) {
  heldLastYaw = yaw;
  heldLastPitch = pitch;
}

let heldMiningSwingTimer = 0;

function clearHeldModel() {
  for (let i = heldRoot.children.length - 1; i >= 0; i--) {
    heldRoot.remove(heldRoot.children[i]);
  }
}

function addHeldArm() {
  const arm = new THREE.Mesh(heldArmGeometry, heldArmMaterial);
  arm.position.set(-0.03, -0.05, 0.22);
  arm.rotation.set(-0.34, 0.12, -0.2);
  arm.renderOrder = 19;
  arm.frustumCulled = false;
  heldRoot.add(arm);
}

function updateHeldItemModel(stack) {
  const key = stack ? stack.id : 'hand';
  if (key === heldModelKey) return;
  heldModelKey = key;
  clearHeldModel();

  if (!stack) {
    addHeldArm();
    return;
  }
  const item = ITEMS.get(stack.id);
  if (!item) return;

  if (item.kind === 'block') {
    const block = BLOCKS[item.blockId];
    if (block.key !== 'torch' && !block.door && !block.bed && !block.ladder) {
      const mesh = new THREE.Mesh(
        buildItemCubeGeometry(block),
        block.cutout ? heldCutoutMaterial : heldCubeMaterial
      );
      mesh.scale.setScalar(1.28);
      mesh.rotation.set(0.12, 0.68, 0.05);
      mesh.position.set(0.0, -0.02, 0.06);
      mesh.renderOrder = 20;
      mesh.frustumCulled = false;
      heldRoot.add(mesh);
      return;
    }
  }

  const material = heldIconMaterial(stack.id);
  if (!material) return;
  const icon = new THREE.Mesh(heldIconGeometry, material);
  icon.position.set(0.01, 0.03, 0.1);
  // Cancel most of the root's yaw so flat item sprites still face the camera.
  icon.rotation.set(-0.12, -0.48, -0.14);
  icon.renderOrder = 20;
  icon.frustumCulled = false;
  heldRoot.add(icon);
}

export function triggerHeldSwing() {
  heldSwingTime = 0;
}

/**
 * One frame of the view, as the compositor describes it: which stack is in
 * hand, where the view points and how fast it moves, whether a screen hides
 * it, and whether the pickaxe is biting. The view model itself keeps every
 * animation in hand and never reaches for any of it.
 */
export function updateHeldItem(dt, frame) {
  if (dt <= 0) {
    heldLastYaw = frame.yaw;
    heldLastPitch = frame.pitch;
    return;
  }

  heldRoot.visible = !frame.hidden;
  if (!heldRoot.visible) {
    heldLastYaw = frame.yaw;
    heldLastPitch = frame.pitch;
    return;
  }

  updateHeldItemModel(frame.stack);

  // Turning the camera sways the held item slightly.
  const yawDelta = frame.yaw - heldLastYaw;
  const pitchDelta = frame.pitch - heldLastPitch;
  heldLastYaw = frame.yaw;
  heldLastPitch = frame.pitch;
  const swayTargetX = clamp(-yawDelta * 16, -0.11, 0.11);
  const swayTargetY = clamp(pitchDelta * 16, -0.09, 0.09);
  const swayBlend = 1 - Math.exp(-13 * dt);
  heldSwayX += (swayTargetX - heldSwayX) * swayBlend;
  heldSwayY += (swayTargetY - heldSwayY) * swayBlend;

  // Walk bob.
  const speed = frame.speed;
  const bobAmount = clamp(speed / SPRINT_SPEED, 0, 1) * (frame.onGround ? 1 : 0.35);
  heldBobPhase += dt * (4.2 + speed * 1.9);
  const bobX = Math.sin(heldBobPhase) * 0.016 * bobAmount;
  const bobY = Math.abs(Math.cos(heldBobPhase)) * 0.018 * bobAmount;

  // Swing animation (also repeats while mining).
  if (heldSwingTime < heldSwingDuration) {
    heldSwingTime = Math.min(heldSwingDuration, heldSwingTime + dt);
  }
  if (frame.mining) {
    heldMiningSwingTimer -= dt;
    if (heldMiningSwingTimer <= 0) {
      triggerHeldSwing();
      heldMiningSwingTimer = frame.swingInterval;
    }
  } else {
    heldMiningSwingTimer = 0;
  }

  const swingT = heldSwingTime < heldSwingDuration
    ? heldSwingTime / heldSwingDuration
    : 1;
  const swing = Math.sin(swingT * Math.PI);
  const idle = Math.sin(performance.now() * 0.0016) * 0.004;

  // A drawn bow comes in towards the middle of the view and back towards the
  // eye, trembling a little once the string is all the way back.
  const draw = frame.draw || 0;
  const strain = draw >= 1 ? Math.sin(performance.now() * 0.06) * 0.0035 : 0;

  heldRoot.position.set(
    HELD_REST_POSITION.x + bobX + heldSwayX - draw * 0.12 + strain,
    HELD_REST_POSITION.y + bobY + heldSwayY + idle - swing * 0.055 + draw * 0.04,
    HELD_REST_POSITION.z - swing * 0.16 + draw * 0.1
  );
  heldRoot.rotation.set(
    HELD_REST_ROTATION.x - swing * 1.02,
    HELD_REST_ROTATION.y + heldSwayX * 0.7 + draw * 0.3,
    HELD_REST_ROTATION.z - swing * 0.48
  );
}
