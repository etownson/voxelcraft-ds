/*
 * What a dropped item is: a mesh — the block itself when it has faces, a
 * billboard of its own icon when it does not — with a little scatter of
 * velocity, a short delay before it can be claimed, and a bob to remind anyone
 * passing that it is there. It falls, it lands on whatever is solid, it stops
 * being a problem once it is far enough behind the player to have been missed,
 * it burns up in a puff the moment it is in lava, and within reach it comes to
 * them.
 *
 * Two things it cannot know, so they are handed in: whose pack it is filling
 * arrives through `setItemPickup`, and the number that comes back is how much
 * did not fit, which is why a full pack costs nothing but the moment; the rest
 * of what it reads is the world and the one body walking about in it.
 */

import * as THREE from 'three';
import { playPickupSound } from './audio.js';
import { atlasTexture } from './atlas.js';
import { BLOCKS, ITEMS, isLava } from './blocks.js';
import { world } from './chunks.js';
import { spawnBurstParticles } from './fx.js';
import { buildItemCubeGeometry } from './held.js';
import { ITEM_ICONS } from './icons.js';
import { player } from './player.js';
import { scene } from './render.js';

/* ---------- Item entities ---------- */

const itemCubeMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true
});
const itemSpriteMaterials = new Map();
export const itemEntities = [];
let itemEntitySerial = 0;

/* Whose pack a touched drop goes into, and the only way this layer can fill
   anything: it asks, and is told back how much did not fit. */
let itemPickup = null;


function itemSpriteMaterial(itemId) {
  let material = itemSpriteMaterials.get(itemId);
  if (material) return material;
  const icon = ITEM_ICONS.get(itemId);
  if (!icon) return null;
  const texture = new THREE.CanvasTexture(icon.canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  itemSpriteMaterials.set(itemId, material);
  return material;
}

function createItemDropMesh(itemId) {
  const def = ITEMS.get(itemId);
  if (def && def.kind === 'block' && !BLOCKS[def.blockId].cutout) {
    const block = BLOCKS[def.blockId];
    return new THREE.Mesh(buildItemCubeGeometry(block), itemCubeMaterial);
  }
  const material = itemSpriteMaterial(itemId);
  if (!material) return null;
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.36, 0.36, 1);
  return sprite;
}

export function spawnItemDrop(itemId, count, x, y, z, scatter = true, dur, contents) {
  if (!ITEMS.has(itemId) || count <= 0) return null;
  const mesh = createItemDropMesh(itemId);
  if (!mesh) return null;

  const entity = {
    serial: itemEntitySerial++,
    itemId,
    count,
    dur,
    contents,
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(
      scatter ? (Math.random() - 0.5) * 1.8 : 0,
      scatter ? 1.8 + Math.random() * 1.6 : 0,
      scatter ? (Math.random() - 0.5) * 1.8 : 0
    ),
    age: 0,
    pickupDelay: 0.45,
    phase: Math.random() * Math.PI * 2,
    mesh
  };
  mesh.position.copy(entity.pos);
  scene.add(mesh);
  itemEntities.push(entity);
  return entity;
}

function removeItemEntity(index) {
  const entity = itemEntities[index];
  if (!entity) return;
  scene.remove(entity.mesh);
  itemEntities.splice(index, 1);
}

export function updateItemEntities(dt) {
  if (dt <= 0) return;
  const targetX = player.pos.x;
  const targetY = player.pos.y + 0.9;
  const targetZ = player.pos.z;
  const now = performance.now() * 0.003;

  for (let i = itemEntities.length - 1; i >= 0; i--) {
    const entity = itemEntities[i];
    entity.age += dt;

    const dx = targetX - entity.pos.x;
    const dy = targetY - entity.pos.y;
    const dz = targetZ - entity.pos.z;
    const distance = Math.hypot(dx, dy, dz);

    if (distance > 80 && entity.age > 8) {
      removeItemEntity(i);
      continue;
    }

    // Lava takes whatever falls into it, the way Minecraft's does: the whole
    // stack goes at once, before the player's pull can save it.
    if (isLava(world.getBlock(
      Math.floor(entity.pos.x), Math.floor(entity.pos.y), Math.floor(entity.pos.z)
    ))) {
      spawnBurstParticles(entity.pos.x, entity.pos.y + 0.2, entity.pos.z, 0xffa040, 6, 1.6);
      removeItemEntity(i);
      continue;
    }

    if (entity.age > entity.pickupDelay && distance < 2.5) {
      const speed = 3.5 + (2.5 - distance) * 4.5;
      if (distance > 0.55) {
        const step = Math.min(distance, speed * dt);
        entity.pos.x += (dx / distance) * step;
        entity.pos.y += (dy / distance) * step;
        entity.pos.z += (dz / distance) * step;
      }
      entity.vel.set(0, 0, 0);

      if (distance <= 0.6 && itemPickup) {
        const leftover = itemPickup(entity.itemId, entity.count, entity.dur, entity.contents);
        if (leftover <= 0) {
          playPickupSound();
          removeItemEntity(i);
          continue;
        }
        entity.count = leftover;
        entity.pickupDelay = entity.age + 1.2;
      }
    } else {
      entity.vel.y -= 20 * dt;
      let nx = entity.pos.x + entity.vel.x * dt;
      let ny = entity.pos.y + entity.vel.y * dt;
      let nz = entity.pos.z + entity.vel.z * dt;

      if (BLOCKS[world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))].solid) {
        if (entity.vel.y < 0) {
          ny = Math.floor(ny) + 1.01;
          entity.vel.y = 0;
          entity.vel.x *= 0.55;
          entity.vel.z *= 0.55;
        } else {
          entity.vel.y = 0;
        }
      }

      entity.pos.set(nx, ny, nz);
      if (entity.pos.y < 1) entity.pos.y = 1;
    }

    if (entity.count <= 0) {
      removeItemEntity(i);
      continue;
    }

    entity.mesh.position.set(
      entity.pos.x,
      entity.pos.y + 0.18 + Math.sin(now + entity.phase) * 0.04,
      entity.pos.z
    );
    entity.mesh.rotation.y += dt * 2.6;
  }
}

/** Handed once, at bootstrap, whose pack a touched drop empties itself into. */
export function setItemPickup(sink) { itemPickup = sink; }
