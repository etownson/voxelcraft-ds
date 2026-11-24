/*
 * Everything that answers to the crosshair's mob instead of its block: picking
 * one out of the ray with a slightly larger box than its body, choosing the
 * nearest when two are on the line, swinging at it with whatever the hand is
 * out with, and shearing a sheep with the one tool that never strikes.
 *
 * It asks the aim layer whether it is allowed to point at all — a screen or a
 * death takes that away — and takes the attack button's hold as a parameter, so
 * nothing here knows which device pressed it. `swingAtMob` is the whole of the
 * left button's meaning: snip with shears, otherwise hit what is aimed at.
 *
 * The mob being aimed at is this layer's own binding. `mobTarget` reports it and
 * `clearMobTarget` forgets it, so the frame loop, a death and a save can all ask
 * without one of them writing it.
 */

import { aimAllowed, currentTarget, rayDirection, updateTarget } from './aim.js';
import { playAnimalSound, playShearSound } from './audio.js';
import { ITEMS } from './blocks.js';
import { world } from './chunks.js';
import { EXHAUSTION, FOCUS_REACH } from './config.js';
import { spawnItemDrop } from './drops.js';
import { triggerHeldSwing } from './held.js';
import { wearHeldTool } from './interaction.js';
import { getSelectedStack } from './inventory.js';
import { damageMob, mobs, refitMobModel } from './mob.js';
import { addExhaustion, aimOrigin, player } from './player.js';
import { camera } from './render.js';
import { say } from './say.js';

let currentMobTarget = null;

/** The mob the crosshair is on, for the few callers outside this layer that
 *  want to strike it. */
export function mobTarget() {
  return currentMobTarget;
}

/** Forgets the mob the crosshair was on, at a death or a new life. */
export function clearMobTarget() {
  currentMobTarget = null;
}

/**
 * The attack button coming down, from either device: shears snip rather than
 * strike, and anything else hits whatever the crosshair is on.
 */
export function swingAtMob() {
  if (tryShearMob('swing')) {
    player.attackCooldown = 0.38;
    return true;
  }
  if (!currentMobTarget) return false;
  return attackMob(currentMobTarget);
}

/**
 * Picking uses a slightly larger box than the collision box. A zombie's
 * outstretched arms, ears and head all sit outside its 0.62-wide body, and at
 * arm's length they cover a big part of the screen. Without the padding a
 * point-blank click on what looks like the mob goes through it, and a mob
 * standing flush against a wall loses the tie with the block behind it.
 */
const MOB_PICK_PADDING = 0.12;

function mobBounds(mob, padding = 0) {
  const half = mob.def.width / 2 + padding;
  return {
    minX: mob.pos.x - half,
    maxX: mob.pos.x + half,
    minY: mob.pos.y - padding,
    maxY: mob.pos.y + mob.def.height + padding,
    minZ: mob.pos.z - half,
    maxZ: mob.pos.z + half
  };
}

/** Slab ray/AABB intersection; returns the entry distance or null. */
function rayMobDistance(origin, direction, mob, maxDistance) {
  const box = mobBounds(mob, MOB_PICK_PADDING);
  let tMin = 0;
  let tMax = maxDistance;

  const axes = [
    ['x', box.minX, box.maxX],
    ['y', box.minY, box.maxY],
    ['z', box.minZ, box.maxZ]
  ];

  for (const [axis, min, max] of axes) {
    const originValue = origin[axis];
    const directionValue = direction[axis];
    if (Math.abs(directionValue) < 1e-8) {
      if (originValue < min || originValue > max) return null;
      continue;
    }
    const inv = 1 / directionValue;
    let t1 = (min - originValue) * inv;
    let t2 = (max - originValue) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return tMin;
}

function raycastMob(origin, direction, maxDistance) {
  let best = null;
  let bestDistance = maxDistance;
  for (const mob of mobs) {
    if (mob.dead) continue;
    const distance = rayMobDistance(origin, direction, mob, bestDistance);
    if (distance === null) continue;
    best = mob;
    bestDistance = distance;
  }
  return best ? { mob: best, distance: bestDistance } : null;
}

export function updateMobTarget() {
  if (!aimAllowed()) {
    currentMobTarget = null;
    return null;
  }
  camera.getWorldDirection(rayDirection);
  const hit = raycastMob(aimOrigin(), rayDirection, FOCUS_REACH);
  if (hit && (!currentTarget || hit.distance < currentTarget.distance - 0.04)) {
    currentMobTarget = hit.mob;
  } else {
    currentMobTarget = null;
  }
  return currentMobTarget;
}

function heldAttackDamage() {
  const stack = getSelectedStack();
  const item = stack ? ITEMS.get(stack.id) : null;
  if (!item || item.kind !== 'tool') return 1;
  if (item.tool === 'sword') {
    return { wood: 4, stone: 6, iron: 8, diamond: 10 }[item.tier] || 3;
  }
  return Math.max(2, Math.round((item.damage || 2) * 0.7));
}

export function attackMob(mob) {
  if (!mob || mob.dead || player.dead) return false;
  if (player.attackCooldown > 0) return false;

  player.attackCooldown = 0.38;
  triggerHeldSwing();
  const dx = mob.pos.x - player.pos.x;
  const dz = mob.pos.z - player.pos.z;
  const length = Math.hypot(dx, dz) || 1;
  const knockX = (dx / length) * 4.5;
  const knockZ = (dz / length) * 4.5;
  damageMob(mob, heldAttackDamage(), knockX, knockZ);
  addExhaustion(EXHAUSTION.attack);

  // A sword costs 1 durability per swing, any other improvised weapon costs 2.
  const stack = getSelectedStack();
  const item = stack ? ITEMS.get(stack.id) : null;
  if (item && item.kind === 'tool') wearHeldTool(item.tool === 'sword' ? 1 : 2);
  return true;
}

/* ---------- Shearing ---------- */

/**
 * Takes a sheep's fleece off in one go: the model is rebuilt bare, wool
 * bounces out of it, and the animal trots away unharmed. Sheep never grow
 * it back, so a fleecy hillside is worth protecting.
 */
function shearMob(mob) {
  mob.sheared = true;
  refitMobModel(mob);

  const count = 1 + Math.floor(Math.random() * 3);
  spawnItemDrop('wool', count, mob.pos.x, mob.pos.y + mob.def.height * 0.45, mob.pos.z);

  playShearSound(mob.pos.x, mob.pos.y + 0.8, mob.pos.z);
  playAnimalSound('sheep', mob.pos.x, mob.pos.y + mob.def.height * 0.6, mob.pos.z);
}

/**
 * Steps the crosshair ray and reports whether anything solid gets in the way
 * of a mob that the mob ray already said it touched.
 */
function airClearTo(distance) {
  const step = 0.12;
  const origin = aimOrigin();
  for (let t = step; t < distance - step; t += step) {
    if (world.isOpaque(
      Math.floor(origin.x + rayDirection.x * t),
      Math.floor(origin.y + rayDirection.y * t),
      Math.floor(origin.z + rayDirection.z * t)
    )) return false;
  }
  return true;
}

/**
 * The mob the crosshair is on, ignoring which target the mining pass would
 * prefer. updateMobTarget gives up on an animal as soon as a block face is
 * nearer than it, which is right for a pickaxe — the ore behind the cow is the
 * better target — and wrong for a pair of shears. Aiming low at a sheep on a
 * slope puts the ground in front of it nearer than the animal's own box, so
 * every one of those shots was a snip that failed without even a sound.
 *
 * Clear air still has to reach the animal, so a sheep on the other side of a
 * wall stays out of reach until the player walks in.
 */
function mobUnderCrosshair() {
  if (!aimAllowed()) return null;
  camera.getWorldDirection(rayDirection);
  const hit = raycastMob(aimOrigin(), rayDirection, FOCUS_REACH);
  if (!hit || !airClearTo(hit.distance)) return null;
  return hit;
}

/**
 * Shears on a sheep: the one interaction that answers to a mob rather than a
 * block, and the one tool that never strikes an animal, on either button.
 *
 * @param mode 'use' for a right click, 'swing' for the left button coming down,
 *             and 'held' for the left button staying down. Only 'held' keeps
 *             quiet, because it would otherwise repeat one refusal several
 *             times a second.
 */
export function tryShearMob(mode = 'use') {
  const stack = getSelectedStack();
  if (!stack || stack.id !== 'shears') return false;

  updateTarget();
  const hit = mobUnderCrosshair();
  if (!hit) return false;

  const mob = hit.mob;
  if (mob.dead || mob.type !== 'sheep') {
    // A block in front still wins, so a crafting table with a cow behind it
    // opens rather than being told what it is not.
    if (mode !== 'use') return false;
    if (currentTarget && hit.distance >= currentTarget.distance - 0.04) return false;
    say('Nothing to shear here');
    return true;
  }

  triggerHeldSwing();
  if (mob.sheared) {
    if (mode !== 'held') say('That sheep is already sheared');
    return true;
  }
  shearMob(mob);
  wearHeldTool(1);
  addExhaustion(EXHAUSTION.mine);
  if (mode !== 'held') say('Sheared');
  return true;
}

export function updateCombat(dt, held) {
  if (dt <= 0) return;
  if (player.attackCooldown > 0) player.attackCooldown -= dt;
  if (!aimAllowed() || !held) return;

  updateMobTarget();
  // 'held', so holding the button on a sheep already shorn costs nothing but a
  // swing rather than filling the screen with the same refusal.
  if (tryShearMob('held')) {
    player.attackCooldown = 0.38;
    return;
  }
  if (currentMobTarget) attackMob(currentMobTarget);
}
