/*
 * Arrows: the bow in the walker's hands and everything that flies off a
 * string, theirs or a skeleton's. A held right button draws the bow over a
 * second, letting go looses an arrow as hard as it was drawn, and the arrow
 * flies under its own gravity until it finds a mob, the walker or a block.
 *
 * Arrows the walker looses come back as an item where they land, so a miss
 * costs a walk rather than an arrow; a hit spends it. A skeleton's arrow sticks
 * where it lands and is gone a few seconds later: what a skeleton pays out is
 * what it drops when it dies.
 *
 * The layer knows the mobs it can strike, as the swing does, but not the
 * walker's health: who an arrow hurts is handed over once, through
 * setArcheryWorld, and a layer with nothing registered still flies arrows
 * that hurt nobody.
 */

import * as THREE from 'three';
import { aimAllowed } from './aim.js';
import { playArrowHit, playBowShot } from './audio.js';
import { BLOCKS, ITEMS } from './blocks.js';
import { world } from './chunks.js';
import { EYE_HEIGHT, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './config.js';
import { spawnItemDrop } from './drops.js';
import { spawnBurstParticles } from './fx.js';
import { wearHeldTool } from './interaction.js';
import { countInventoryItem, getSelectedStack, removeInventoryItem } from './inventory.js';
import { damageMob, mobs } from './mob.js';
import { aimOrigin, player } from './player.js';
import { camera, scene } from './render.js';
import { say } from './say.js';

/** Seconds of holding the button that make a full draw: Minecraft's one second. */
export const BOW_DRAW_SECONDS = 1;
/** A draw shorter than this share of a full one lets go without loosing. */
const BOW_MIN_POWER = 0.1;
/** Blocks per second an arrow leaves a fully drawn bow at. */
const BOW_ARROW_SPEED = 42;
/**
 * A full draw's damage when the bow in hand somehow carries none of its own.
 * Every bow does: its `arrowDamage` in blocks.js, 10 for wood up to 21 for an
 * enchanted diamond bow.
 */
const BOW_DAMAGE = 10;
/** Minecraft's arrow falls at 20 blocks per second squared. */
const ARROW_GRAVITY = 20;
const ARROW_DRAG = 0.12;
/** An arrow that never lands anywhere is still gone after this many seconds. */
const ARROW_LIFETIME = 30;
/** How long a skeleton's arrow stays stuck where it landed. */
const STUCK_SECONDS = 4;
/** The longest step an arrow takes between hit tests, so none tunnels through a mob. */
const ARROW_STEP = 0.25;

let hurtWalker = null;
let arrowLoosed = null;

/** The page says who an arrow that hits the walker hurts, and how. In co-op it
 *  also hears of every arrow loosed here, so the other players see it fly. */
export function setArcheryWorld(host) {
  hurtWalker = host.hurt;
  arrowLoosed = host.loosed ?? null;
}

/* Arrows another browser loosed, flown here so they can be seen. One a player
   shot touches nothing: its owner's browser decides what it hit. One a mob
   shot finds this walker the way a skeleton's own does, because whether this
   walker was hit is this browser's to say. */
export const REMOTE_PLAYER_ARROW = 'remote';
export const REMOTE_MOB_ARROW = { remote: true };

export const arrows = [];

const shaftGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.62);
const tipGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.1);
const fletchGeometry = new THREE.BoxGeometry(0.16, 0.02, 0.14);
const shaftMaterial = new THREE.MeshLambertMaterial({ color: 0x8a6030 });
const tipMaterial = new THREE.MeshLambertMaterial({ color: 0x7c7c84 });
const fletchMaterial = new THREE.MeshLambertMaterial({ color: 0xe8ecf2 });
const FORWARD = new THREE.Vector3(0, 0, 1);

function createArrowMesh() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(shaftGeometry, shaftMaterial));
  const tip = new THREE.Mesh(tipGeometry, tipMaterial);
  tip.position.z = 0.33;
  group.add(tip);
  const fletchA = new THREE.Mesh(fletchGeometry, fletchMaterial);
  fletchA.position.z = -0.25;
  const fletchB = fletchA.clone();
  fletchB.rotation.z = Math.PI / 2;
  group.add(fletchA, fletchB);
  return group;
}

/**
 * Puts one arrow in the air. `from` is 'walker' or a mob; the walker's arrows
 * strike mobs and the mobs' strike the walker, and neither ever hits the one
 * who loosed it.
 */
export function launchArrow(x, y, z, vx, vy, vz, damage, from = 'walker') {
  const mesh = createArrowMesh();
  const arrow = {
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(vx, vy, vz),
    damage,
    from,
    age: 0,
    stuck: false,
    stuckTime: 0,
    mesh
  };
  orientArrow(arrow);
  scene.add(mesh);
  arrows.push(arrow);
  if (arrowLoosed && from !== REMOTE_PLAYER_ARROW && from !== REMOTE_MOB_ARROW) {
    arrowLoosed(x, y, z, vx, vy, vz, damage, from === 'walker');
  }
  return arrow;
}

function orientArrow(arrow) {
  arrow.mesh.position.copy(arrow.pos);
  if (arrow.vel.lengthSq() > 1e-6) {
    arrow.mesh.quaternion.setFromUnitVectors(FORWARD, arrow.vel.clone().normalize());
  }
}

function removeArrow(index) {
  scene.remove(arrows[index].mesh);
  arrows.splice(index, 1);
}

/** Takes every arrow out of the air, for a new world or a test. */
export function clearArrows() {
  for (let i = arrows.length - 1; i >= 0; i--) removeArrow(i);
}

/** Slab test of the segment p → p + d (t in 0..1) against a box; entry t or null. */
function segmentBoxT(px, py, pz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tMin = 0;
  let tMax = 1;
  const origin = [px, py, pz];
  const delta = [dx, dy, dz];
  const lo = [minX, minY, minZ];
  const hi = [maxX, maxY, maxZ];
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(delta[axis]) < 1e-9) {
      if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return null;
      continue;
    }
    let t1 = (lo[axis] - origin[axis]) / delta[axis];
    let t2 = (hi[axis] - origin[axis]) / delta[axis];
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** The nearest mob along this step, other than the one who loosed the arrow. */
function mobAlong(arrow, dx, dy, dz) {
  let best = null;
  let bestT = Infinity;
  for (const mob of mobs) {
    if (mob.dead || mob === arrow.from) continue;
    const half = mob.def.width / 2 + 0.05;
    const t = segmentBoxT(
      arrow.pos.x, arrow.pos.y, arrow.pos.z, dx, dy, dz,
      mob.pos.x - half, mob.pos.y, mob.pos.z - half,
      mob.pos.x + half, mob.pos.y + mob.def.height, mob.pos.z + half
    );
    if (t !== null && t < bestT) { best = mob; bestT = t; }
  }
  return best ? { mob: best, t: bestT } : null;
}

function walkerAlong(arrow, dx, dy, dz) {
  if (player.dead) return null;
  const half = PLAYER_HALF_WIDTH + 0.05;
  const t = segmentBoxT(
    arrow.pos.x, arrow.pos.y, arrow.pos.z, dx, dy, dz,
    player.pos.x - half, player.pos.y, player.pos.z - half,
    player.pos.x + half, player.pos.y + PLAYER_HEIGHT, player.pos.z + half
  );
  return t === null ? null : { t };
}

/** Whether a point is inside something an arrow cannot pass: not water, not air. */
function arrowBlocked(x, y, z) {
  const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  const block = BLOCKS[id];
  return !!(block && block.solid && !block.liquid);
}

function strikeMob(arrow, mob) {
  const speed = Math.hypot(arrow.vel.x, arrow.vel.z) || 1;
  damageMob(mob, arrow.damage, (arrow.vel.x / speed) * 3, (arrow.vel.z / speed) * 3);
  playArrowHit(arrow.pos.x, arrow.pos.y, arrow.pos.z);
}

function strikeWalker(arrow) {
  const speed = Math.hypot(arrow.vel.x, arrow.vel.z) || 1;
  if (hurtWalker && hurtWalker(arrow.damage, 'skeleton')) {
    player.vel.x += (arrow.vel.x / speed) * 2.4;
    player.vel.z += (arrow.vel.z / speed) * 2.4;
  }
  playArrowHit(arrow.pos.x, arrow.pos.y, arrow.pos.z);
}

/** One arrow's flight for one frame. Returns false once it is spent. */
function flyArrow(arrow, dt) {
  arrow.age += dt;
  if (arrow.age > ARROW_LIFETIME || arrow.pos.y < -4) return false;

  if (arrow.stuck) {
    arrow.stuckTime += dt;
    return arrow.stuckTime < STUCK_SECONDS;
  }

  const travel = arrow.vel.length() * dt;
  const steps = Math.max(1, Math.ceil(travel / ARROW_STEP));
  const step = dt / steps;

  for (let i = 0; i < steps; i++) {
    arrow.vel.y -= ARROW_GRAVITY * step;
    arrow.vel.multiplyScalar(Math.exp(-ARROW_DRAG * step));
    const dx = arrow.vel.x * step;
    const dy = arrow.vel.y * step;
    const dz = arrow.vel.z * step;

    const hit = arrow.from === REMOTE_PLAYER_ARROW
      ? null
      : arrow.from === 'walker'
        ? mobAlong(arrow, dx, dy, dz)
        : walkerAlong(arrow, dx, dy, dz);
    if (hit) {
      arrow.pos.set(arrow.pos.x + dx * hit.t, arrow.pos.y + dy * hit.t, arrow.pos.z + dz * hit.t);
      if (hit.mob) strikeMob(arrow, hit.mob);
      else strikeWalker(arrow);
      return false;
    }

    const nx = arrow.pos.x + dx;
    const ny = arrow.pos.y + dy;
    const nz = arrow.pos.z + dz;
    if (arrowBlocked(nx, ny, nz)) {
      landArrow(arrow);
      return arrow.from !== 'walker';
    }
    arrow.pos.set(nx, ny, nz);
  }

  orientArrow(arrow);
  return true;
}

/**
 * The arrow meets a block. A skeleton's stays stuck in it for a moment; the
 * walker's comes back as an arrow to pick up, backed out of the block so it
 * lies on the near face rather than inside the wall.
 */
function landArrow(arrow) {
  playArrowHit(arrow.pos.x, arrow.pos.y, arrow.pos.z);
  spawnBurstParticles(arrow.pos.x, arrow.pos.y, arrow.pos.z, 0x9a7a52, 3, 1.2);
  if (arrow.from === 'walker') {
    const back = arrow.vel.clone().normalize().multiplyScalar(0.3);
    spawnItemDrop(
      'arrow', 1, arrow.pos.x - back.x, arrow.pos.y - back.y, arrow.pos.z - back.z, false
    );
    return;
  }
  arrow.stuck = true;
  arrow.stuckTime = 0;
  orientArrow(arrow);
}

/* ---------- The walker's bow ---------- */

/* Seconds the bow has been drawn for, or -1 while it is not drawn. */
let drawTime = -1;

/* The bow in hand, wood, iron or diamond and enchanted or not, or null. */
function heldBow() {
  const stack = getSelectedStack();
  const item = stack ? ITEMS.get(stack.id) : null;
  return item && item.kind === 'tool' && item.tool === 'bow' ? item : null;
}

function holdingBow() {
  return heldBow() !== null;
}

/** How far the bow is drawn, 0 to 1, for the view model. */
export function bowDraw() {
  return drawTime < 0 ? 0 : Math.min(1, drawTime / BOW_DRAW_SECONDS);
}

/**
 * The use button coming down. With a bow in hand and an arrow in the pack it
 * starts the draw; with a bow and no arrows it says so. Anything else in hand
 * is not this layer's business, and the answer is false.
 */
export function beginBowDraw() {
  if (!holdingBow()) return false;
  if (player.dead || !aimAllowed()) return true;
  if (countInventoryItem('arrow') <= 0) {
    say('No arrows');
    return true;
  }
  if (drawTime < 0) drawTime = 0;
  return true;
}

/** Lets the string go without loosing, when the hand or the view is taken away. */
export function cancelBowDraw() {
  drawTime = -1;
}

/**
 * The use button coming up: looses an arrow as hard as the bow was drawn.
 * `full` draws it all the way at once, for a click with no hold behind it.
 */
export function releaseBowDraw(options = {}) {
  if (drawTime < 0) return false;
  const power = options.full ? 1 : bowDraw();
  drawTime = -1;
  if (power < BOW_MIN_POWER || !holdingBow() || player.dead || !aimAllowed()) return false;
  return loose(power);
}

function loose(power) {
  const bow = heldBow();
  if (removeInventoryItem('arrow', 1) <= 0) return false;
  const fullDamage = (bow && bow.arrowDamage) || BOW_DAMAGE;
  const origin = aimOrigin();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const speed = BOW_ARROW_SPEED * power;
  launchArrow(
    origin.x + direction.x * 0.4, origin.y + direction.y * 0.4 - 0.08, origin.z + direction.z * 0.4,
    direction.x * speed, direction.y * speed, direction.z * speed,
    Math.max(1, Math.round(fullDamage * power)),
    'walker'
  );
  playBowShot(origin.x, origin.y, origin.z, power, true);
  wearHeldTool(1);
  return true;
}

/**
 * A mob looses an arrow at the walker's chest. It aims high by the drop the
 * flight will take and wobbles a little, so standing still is not safety but
 * a skeleton at range is no sniper either.
 */
export function mobShootsWalker(mob, speed, damage, spread = 0.035, target = player) {
  const fromX = mob.pos.x;
  const fromY = mob.pos.y + mob.def.height * 0.82;
  const fromZ = mob.pos.z;
  const toX = target.pos.x;
  const toY = target.pos.y + EYE_HEIGHT * 0.7;
  const toZ = target.pos.z;
  const flat = Math.hypot(toX - fromX, toZ - fromZ);
  const time = flat / speed;
  const lift = 0.5 * ARROW_GRAVITY * time * time;
  const aim = new THREE.Vector3(toX - fromX, toY - fromY + lift, toZ - fromZ).normalize();
  aim.x += (Math.random() - 0.5) * 2 * spread;
  aim.y += (Math.random() - 0.5) * 2 * spread;
  aim.z += (Math.random() - 0.5) * 2 * spread;
  aim.normalize().multiplyScalar(speed);
  const start = mob.def.width * 0.5 + 0.1;
  const flatAim = Math.hypot(aim.x, aim.z) || 1;
  launchArrow(
    fromX + (aim.x / flatAim) * start, fromY, fromZ + (aim.z / flatAim) * start,
    aim.x, aim.y, aim.z, damage, mob
  );
  playBowShot(fromX, fromY, fromZ, 0.8);
}

/** One frame of archery: the draw keeps drawing and every arrow flies. */
export function updateArchery(dt) {
  if (dt <= 0) return;
  if (drawTime >= 0) {
    if (!holdingBow() || player.dead || !aimAllowed()) drawTime = -1;
    else drawTime += dt;
  }
  for (let i = arrows.length - 1; i >= 0; i--) {
    if (!flyArrow(arrows[i], dt)) removeArrow(i);
  }
}
