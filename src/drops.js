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
 *
 * A drop the player threw is shared: in co-op every browser in the room sees
 * it, and the browser that threw it decides who gets it. Here it is an
 * ordinary drop that tells `setDropShare` when it changes or goes; anywhere
 * else it is a picture, and touching a picture asks its owner for it instead
 * of filling the pack. The owner hands it to whoever asked first, so nothing
 * thrown is ever picked up twice.
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

/** How long a thrown stack is out of its thrower's reach, so it can leave them. */
export const TOSS_PICKUP_DELAY = 2;
/** A thrown stack nobody takes goes after five minutes, as Minecraft's do. */
const TOSS_LIFETIME = 300;
/** How long a picture waits on its owner's answer before asking again. */
const CLAIM_RETRY = 3;

/* Who hears about shared drops. With nothing registered a thrown stack is
   just a drop, and no picture is ever made. `claim` answers whether it asked. */
const dropShare = {
  tossed: (entity) => {},
  changed: (entity) => {},
  gone: (entity) => {},
  claim: (entity) => false
};


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

/**
 * A stack the player threw, with the velocity it left the hand at. It is
 * shared: in a co-op room everyone sees it and anyone may pick it up.
 */
export function tossItemDrop(itemId, count, dur, contents, x, y, z, vx, vy, vz) {
  const entity = spawnItemDrop(itemId, count, x, y, z, false, dur, contents);
  if (!entity) return null;
  entity.vel.set(vx, vy, vz);
  entity.pickupDelay = TOSS_PICKUP_DELAY;
  entity.thrown = true;
  entity.shared = true;
  dropShare.tossed(entity);
  return entity;
}

/** Another player's thrown stack, as this browser draws it. */
export function placeSharedDrop(owner, serial, stack, x, y, z, vx, vy, vz) {
  if (!stack || findPicture(owner, serial) >= 0) return null;
  const entity = spawnItemDrop(stack.id, stack.count, x, y, z, false, stack.dur, stack.contents);
  if (!entity) return null;
  entity.vel.set(vx, vy, vz);
  entity.thrown = true;
  entity.owner = owner;
  entity.ownerSerial = serial;
  entity.claimedAt = -Infinity;
  return entity;
}

function findPicture(owner, serial) {
  return itemEntities.findIndex((e) => e.owner === owner && e.ownerSerial === serial);
}

/** Another player's thrown stack was taken, or burnt, or ran out of time. */
export function forgetSharedDrop(owner, serial) {
  const index = findPicture(owner, serial);
  if (index >= 0) removeItemEntity(index);
}

/** Another player's thrown stack is smaller now: somebody took part of it. */
export function recountSharedDrop(owner, serial, count) {
  const index = findPicture(owner, serial);
  if (index < 0) return;
  if (count > 0) itemEntities[index].count = count;
  else removeItemEntity(index);
}

/** Lets go of every picture, or only those of one player who has left. */
export function forgetSharedDrops(owner = null) {
  for (let i = itemEntities.length - 1; i >= 0; i--) {
    const entity = itemEntities[i];
    if (entity.owner != null && (owner == null || entity.owner === owner)) removeItemEntity(i);
  }
}

/** The stacks this browser threw that are still lying about. */
export function ownSharedDrops() {
  return itemEntities.filter((e) => e.shared);
}

/**
 * Somebody else asked for a stack thrown here, standing at `near`. It is
 * theirs if it is still lying here and they are close enough to have
 * touched it; it leaves this world and is handed back as a stack.
 */
export function takeSharedDrop(serial, near) {
  const index = itemEntities.findIndex((e) => e.shared && e.serial === serial);
  if (index < 0) return null;
  const entity = itemEntities[index];
  if (near && Math.hypot(near.x - entity.pos.x, near.y - entity.pos.y, near.z - entity.pos.z) > 8) {
    return null;
  }
  const stack = { id: entity.itemId, count: entity.count, dur: entity.dur, contents: entity.contents };
  removeItemEntity(index);
  return stack;
}

function removeItemEntity(index) {
  const entity = itemEntities[index];
  if (!entity) return;
  scene.remove(entity.mesh);
  itemEntities.splice(index, 1);
  if (entity.shared) dropShare.gone(entity);
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

    // A shared stack lies where it was thrown however far away the thrower
    // walks, since somebody else may be coming for it; it only times out.
    const sharedAtAll = entity.shared || entity.owner != null;
    if (sharedAtAll ? entity.age > TOSS_LIFETIME : distance > 80 && entity.age > 8) {
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

      if (distance <= 0.6 && entity.owner != null) {
        // Somebody else's: ask them for it, and hold still until they answer.
        if (entity.age - entity.claimedAt > CLAIM_RETRY) {
          if (dropShare.claim(entity)) entity.claimedAt = entity.age;
          else entity.pickupDelay = entity.age + 1.2;
        }
      } else if (distance <= 0.6 && itemPickup) {
        const leftover = itemPickup(entity.itemId, entity.count, entity.dur, entity.contents);
        if (leftover <= 0) {
          playPickupSound();
          removeItemEntity(i);
          continue;
        }
        if (leftover !== entity.count) {
          entity.count = leftover;
          if (entity.shared) dropShare.changed(entity);
        }
        entity.pickupDelay = entity.age + 1.2;
      }
    } else {
      entity.vel.y -= 20 * dt;
      let nx = entity.pos.x + entity.vel.x * dt;
      let ny = entity.pos.y + entity.vel.y * dt;
      let nz = entity.pos.z + entity.vel.z * dt;

      // A thrown stack stops at a wall rather than going through it.
      if (entity.thrown) {
        const cy = Math.floor(entity.pos.y);
        if (BLOCKS[world.getBlock(Math.floor(nx), cy, Math.floor(entity.pos.z))].solid) {
          nx = entity.pos.x;
          entity.vel.x = 0;
        }
        if (BLOCKS[world.getBlock(Math.floor(nx), cy, Math.floor(nz))].solid) {
          nz = entity.pos.z;
          entity.vel.z = 0;
        }
      }

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

/** Handed once, at bootstrap, who hears about thrown stacks and asks for others'. */
export function setDropShare(share) { Object.assign(dropShare, share); }
