/*
 * The player's hands. This is everything between a device and the world: the
 * keyboard's pressed set and the mouse's buttons, pointer lock and the fallback
 * controls for a browser that will not grant it, the sprint latch, the step up
 * stairs, the walk, the swim, the mantling and the camera glide, and the pad's
 * whole vocabulary — sticks, triggers, the menu buttons and the cursor it drives
 * through a screen.
 *
 * It is one layer because the two devices answer the same questions and must
 * give the same answers: both hold the mining button, both latch a sprint, both
 * step through a hotbar. `updatePlayer` is the walk; `updateGamepad` is the pad's
 * reading of itself; `readPlayerInput` is the one place the two are mixed into
 * the movement the world is asked to allow.
 *
 * It also owns the spawn: where a new world puts the player when it has to start
 * somewhere, and how to put them back there. A save hands its own position in
 * through `save.js`; nothing here reads storage.
 *
 * Everything outside this layer arrives through `inputView`: whether a screen
 * has the controls, and the few pictures and verbs a key or a pad button can
 * reach. Its verbs default to nothing happening, so a headless run has a player
 * who can walk without a document having a hint line to hide.
 */

import { hideTargetOutline, updateTarget } from './aim.js';
import { ensureAudio, playJumpSound } from './audio.js';
import { meshChunk, world } from './chunks.js';
import { isSolid, ladderHolding, playerCollidesAt, submergedAt } from './collision.js';
import { swingAtMob, updateMobTarget } from './combat.js';
import {
  AIR_ACCEL, CHUNK_SIZE, EYE_HEIGHT, GRAVITY, GROUND_ACCEL, JUMP_SPEED, LADDER_CLIMB_SPEED,
  MAX_MOVE_STEP, PLAYER_HALF_WIDTH, PLAYER_STEP_HEIGHT, SEA_LEVEL, SPRINT_SPEED,
  TERMINAL_VELOCITY, WALK_SPEED, WATER_ACCEL, WATER_GRAVITY_SCALE, WATER_MANTLE_HEIGHT,
  WATER_MANTLE_STEP, WATER_MAX_SWIM_SPEED, WATER_SPEED_SCALE, WATER_SWIM_ACCEL,
  WATER_TERMINAL_VELOCITY, clamp
} from './config.js';
import { damagePlayer, respawnPlayer, tryUseSelectedItem } from './health.js';
import { triggerHeldSwing } from './held.js';
import { hideMiningFeedback } from './interaction.js';
import { applyLook, exhaustForMovement, player, turnPlayer, view } from './player.js';
import { camera, renderer } from './render.js';
import { say } from './say.js';
import { caveCarvesAt, sampleColumn, terrainHeight, treeAt } from './worldgen.js';

export const canvas = renderer.domElement;

/* What the screens are doing, as the controller has to know it: whether one has
   the controls, and the handful of pictures and verbs a key or a pad button can
   move outside this layer. Every one of them defaults to nothing happening, so
   the keys and the pad can be wired up before the page has a screen at all. */
const inputView = {
  screenOpen: () => false,
  hint: () => {},
  paintSprint: () => {},
  paintSensitivity: () => {},
  paintPadStatus: () => {},
  screenTap: () => {},
  hotbarStep: () => {},
  togglePack: () => {},
  screenTick: () => {}
};

export function setInputView(verbs) {
  Object.assign(inputView, verbs);
}
export const overlayEl = document.getElementById('overlay');
export const pressedKeys = new Set();

let leftMouseDown = false;

/**
 * Forgets a held button. Something else has taken the controls away — a death,
 * a screen — and whatever the mouse is doing when they come back, the game
 * starts from a button that is up.
 */
export function releaseMiningButton() { leftMouseDown = false; }

/** Fallback controls for embedded browsers where pointer lock is blocked. */
export let fallbackControls = false;
let fallbackLooking = false;
let fallbackDragMoved = false;
let fallbackDragDistance = 0;
let fallbackRightDrag = false;
let lastFallbackMouseX = 0;
let lastFallbackMouseY = 0;

/**
 * Sprint is latched rather than held: one press of Shift, Ctrl or B starts the
 * run and the next one stops it, so neither a keyboard pinky nor a gamepad
 * thumb has to stay busy while the player covers ground. Anything that takes
 * the controls away drops the latch, so a sprint can never resume by surprise
 * after a pause, a screen, a death or a tab that lost focus.
 */
export let sprintLatched = false;

/** The world is on screen and the controls belong to the player. */
function controlsOwned() {
  return isPlayable() && !inputView.screenOpen() && !player.dead &&
    overlayEl.classList.contains('hidden');
}

export function setSprintLatch(on) {
  const next = !!on;
  if (next === sprintLatched) return;
  sprintLatched = next;
  renderSprintState();
}

export function toggleSprintLatch() {
  setSprintLatch(!sprintLatched);
}

export function clearSprintLatch() {
  setSprintLatch(false);
}

/** The HUD's single line of movement state, lit while the latch is set. */
export function renderSprintState() {
  inputView.paintSprint(sprintLatched);
}

/**
 * How far below the eyes the view is currently sitting, because the last stair
 * step has not been glided over yet. The foot lands on a tread in one frame —
 * that is what collision has to do — but a staircase read straight off the feet
 * is a strobe: measured walking up six stairs at 120 fps, the eye crossed half
 * a block in a single frame — sixty blocks a second, while travelling forwards
 * at four and a half. So the view keeps the eye where it was and spends each lift
 * over the frames that follow, arriving at the tread as a ramp. Going down has
 * never needed this: gravity carries the eye over the lip instead.
 */
export let cameraStepOffset = 0;

/**
 * Gives the stair glide nothing left to spend. A world that arrives under the
 * player — loaded, teleported — has no previous tread to have risen from, and
 * gliding down from an eye position invented by a save file is a swoop nobody
 * walked through.
 */
export function resetCameraStep() { cameraStepOffset = 0; }

/** The view gives the height back as an ease, not a fixed crawl: it arrives
 *  fast and settles onto the tread, so the eye keeps moving between steps
 *  instead of stopping and starting. Sweeping this against a measured six-stair
 *  climb, anything from 7 to 16 leaves the eye with no jump at all — how
 *  smooth it reads is set by the step, not by the rate — so the rate is chosen
 *  for how far behind it lets the view fall: at 13 the eye trails by 0.59 of a
 *  block at a walk and 0.75 at a sprint, and the fastest it ever moves is 8.2
 *  blocks a second, against the 60 a staircase reads off the feet. */
const CAMERA_STEP_GLIDE_RATE = 13;

/** How far the ease is ever allowed to fall behind. Measured up a six-stair
 *  flight, the view trails the eyes by 0.59 of a block at a walk and 0.75 at a
 *  sprint, so this is a guard against lifts piling up rather than a limit a walk
 *  or a sprint reaches. It sits above a single tread on purpose: a cap that
 *  binds hands the lift it refuses back to the eye as a jump, which is the very
 *  thing being smoothed away. */
const CAMERA_STEP_GLIDE_CAP = PLAYER_STEP_HEIGHT * 2;

export function syncCamera() {
  camera.position.set(
    player.pos.x,
    player.pos.y + EYE_HEIGHT - cameraStepOffset,
    player.pos.z
  );
}

/** Arrow-key look for embedded browsers without pointer lock. */
function updateKeyboardLook(dt) {
  if (!fallbackControls || inputView.screenOpen()) return;
  const speed = 1.6 * dt;
  let changed = false;
  if (pressedKeys.has('ArrowLeft')) { turnPlayer(speed, 0); changed = true; }
  if (pressedKeys.has('ArrowRight')) { turnPlayer(-speed, 0); changed = true; }
  if (pressedKeys.has('ArrowUp')) { turnPlayer(0, speed); changed = true; }
  if (pressedKeys.has('ArrowDown')) { turnPlayer(0, -speed); changed = true; }
  if (changed) applyLook();
}


/**
 * Move a single axis, sub-stepping so fast falls cannot tunnel through blocks.
 * On contact, a short binary search snaps the player flush against the first
 * blocking surface. Returns true when the movement was blocked.
 */
function movePlayerAxis(axis, delta) {
  if (delta === 0) return false;

  const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_MOVE_STEP));
  const step = delta / steps;

  for (let i = 0; i < steps; i++) {
    const start = player.pos[axis];
    player.pos[axis] = start + step;

    if (!playerCollidesAt(player.pos.x, player.pos.y, player.pos.z)) continue;

    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) * 0.5;
      player.pos[axis] = start + step * mid;
      if (playerCollidesAt(player.pos.x, player.pos.y, player.pos.z)) hi = mid;
      else lo = mid;
    }
    player.pos[axis] = start + step * lo;
    return true;
  }
  return false;
}

function blockAtPoint(x, y, z) {
  return world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
}

/**
 * Minecraft-style climb out of water: when a swimmer presses jump while pushing
 * against a ledge, lift the body just far enough to step onto the bank. The
 * maximum lift is one and a half blocks, so taller pool walls stay unclimbable.
 */
function tryWaterMantle(startX, startZ, dx, dz) {
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return false;

  // Push far enough past the ledge face that the body actually lands on the
  // bank; per-frame movement alone is far too small to clear it.
  const reach = Math.max(length, PLAYER_HALF_WIDTH + 0.4);
  const targetX = startX + (dx / length) * reach;
  const targetZ = startZ + (dz / length) * reach;
  const baseY = player.pos.y;
  const targetBlockX = Math.floor(targetX);
  const targetBlockZ = Math.floor(targetZ);

  for (let lift = 0.05; lift <= WATER_MANTLE_HEIGHT + 1e-6; lift += WATER_MANTLE_STEP) {
    const y = baseY + lift;
    if (playerCollidesAt(startX, y, startZ)) continue;
    if (playerCollidesAt(targetX, y, targetZ)) continue;
    if (!isSolid(world.getBlock(targetBlockX, Math.floor(y - 0.05), targetBlockZ))) continue;

    player.pos.set(targetX, y, targetZ);
    player.vel.y = 0;
    player.onGround = true;
    return true;
  }

  return false;
}

/**
 * Minecraft walks a stair rather than jumping it: the step height clears a
 * tread by a hair, so the foot rises onto each step and the walk goes on.
 * Here that is a lift-and-replay: stand a little taller at the spot the frame
 * started from, redo the frame's movement there, and keep the first height at
 * which an axis that was blocked gets through. Half-block lifts land exactly on
 * a tread or a crest, so the feet end up standing on the step rather than
 * hovering over it; anything a lift cannot clear, the player still has to jump.
 *
 * One sweep for both axes, and the smallest height that frees either one wins,
 * so a climb never takes two steps in a frame and the other axis keeps whatever
 * it managed — that is what lets a walk up a staircase continue while the player
 * leans into a wall. Returns which blocked axes the step got past, and how far
 * the feet rose, so the view can be told to glide over it.
 */
function tryStepUp(startX, baseY, startZ, moveX, moveZ, blockedX, blockedZ) {
  const wasX = player.pos.x;
  const wasY = player.pos.y;
  const wasZ = player.pos.z;

  for (let lift = WATER_MANTLE_STEP; lift <= PLAYER_STEP_HEIGHT + 1e-6; lift += WATER_MANTLE_STEP) {
    const y = baseY + lift;
    if (playerCollidesAt(startX, y, startZ)) continue;

    player.pos.set(startX, y, startZ);
    const hitX = movePlayerAxis('x', moveX);
    const hitZ = movePlayerAxis('z', moveZ);
    const pastX = blockedX && !hitX;
    const pastZ = blockedZ && !hitZ;
    if (!pastX && !pastZ) continue;

    // The step is taken. Hand the rise to the view, so a walk up a staircase
    // reads as a slope; the cap only catches lifts that pile up faster than the
    // ease can spend them.
    cameraStepOffset = Math.min(cameraStepOffset + lift, CAMERA_STEP_GLIDE_CAP);
    return { pastX, pastZ, lift };
  }

  player.pos.set(wasX, wasY, wasZ);
  return { pastX: false, pastZ: false, lift: 0 };
}


function updatePlayerEnvironment() {
  player.inWater =
    submergedAt(player.pos.x, player.pos.y + 0.2, player.pos.z) ||
    submergedAt(player.pos.x, player.pos.y + 0.9, player.pos.z);
  player.headInWater =
    submergedAt(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
}

/** Generate the chunks the player's box can touch so collision never sees air. */
export function ensurePlayerChunks() {
  const minCx = Math.floor((player.pos.x - PLAYER_HALF_WIDTH) / CHUNK_SIZE);
  const maxCx = Math.floor((player.pos.x + PLAYER_HALF_WIDTH) / CHUNK_SIZE);
  const minCz = Math.floor((player.pos.z - PLAYER_HALF_WIDTH) / CHUNK_SIZE);
  const maxCz = Math.floor((player.pos.z + PLAYER_HALF_WIDTH) / CHUNK_SIZE);

  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const chunk = world.getChunk(cx, cz);
      if (!chunk || !chunk.generated) world.ensureGenerated(cx, cz);
    }
  }
}

export function updatePlayer(dt, input) {
  if (dt <= 0 || inputView.screenOpen() || player.dead) return;
  updateKeyboardLook(dt);

  ensurePlayerChunks();
  updatePlayerEnvironment();
  player.onLadder = ladderHolding(player.pos.x, player.pos.y, player.pos.z);

  // Desired horizontal direction relative to the camera view.yaw.
  const sin = Math.sin(view.yaw);
  const cos = Math.cos(view.yaw);
  let wishX = -sin * input.forward + cos * input.right;
  let wishZ = -cos * input.forward - sin * input.right;
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength > 1) {
    wishX /= wishLength;
    wishZ /= wishLength;
  }

  player.sprinting = !!input.sprint && wishLength > 0.01 && !player.inWater;
  const moveSpeed = (player.sprinting ? SPRINT_SPEED : WALK_SPEED) *
    (player.inWater ? WATER_SPEED_SCALE : 1);
  const accel = player.inWater ? WATER_ACCEL : (player.onGround ? GROUND_ACCEL : AIR_ACCEL);
  const blend = 1 - Math.exp(-accel * dt);

  player.vel.x += (wishX * moveSpeed - player.vel.x) * blend;
  player.vel.z += (wishZ * moveSpeed - player.vel.z) * blend;

  let jumped = false;
  // A ladder takes precedence over water: a plank nailed to the side of a well
  // exists to be climbed, and it would be a poor one that let go because
  // whatever stood at the bottom of it happened to be wet.
  if (player.onLadder) {
    // Gravity simply stops applying, which is the whole of hanging on: let go of
    // both keys and the climber stays exactly where they stopped, and Minecraft
    // asks no more of a ladder than that.
    player.vel.y = 0;
    if (input.jump) {
      player.vel.y = LADDER_CLIMB_SPEED;
    } else if (input.forward < 0) {
      player.vel.y = -LADDER_CLIMB_SPEED;
      // A rung holds the climber who is using it. Any speed carrying them off
      // the wall is taken away, which is what makes coming down a ladder a
      // descent rather than a way of falling off one: backing at a ladder you
      // are facing pulls you off it, and a climb down that turned into a drop
      // the moment it started would be no use to anyone.
      const nx = player.onLadder[0];
      const nz = player.onLadder[1];
      const away = player.vel.x * nx + player.vel.z * nz;
      if (away > 0) {
        player.vel.x -= away * nx;
        player.vel.z -= away * nz;
      }
    }
    player.fallPeakY = player.pos.y;
  } else if (player.inWater) {
    player.vel.y -= GRAVITY * WATER_GRAVITY_SCALE * dt;
    if (input.jump) {
      player.vel.y += WATER_SWIM_ACCEL * dt;
      if (player.onGround) player.vel.y = JUMP_SPEED * 0.65;
      jumped = player.onGround;
    }
    player.vel.y = clamp(player.vel.y, -WATER_TERMINAL_VELOCITY, WATER_MAX_SWIM_SPEED);
  } else {
    player.vel.y = Math.max(player.vel.y - GRAVITY * dt, -TERMINAL_VELOCITY);
    if (input.jump && player.onGround) {
      player.vel.y = JUMP_SPEED;
      player.onGround = false;
      jumped = true;
    }
  }

  const wasDescending = player.vel.y < 0;
  const hitY = movePlayerAxis('y', player.vel.y * dt);
  if (hitY) {
    if (wasDescending) {
      player.onGround = true;
      const fallDistance = player.fallPeakY - player.pos.y;
      if (fallDistance > 3.05 && !player.inWater) {
        damagePlayer(Math.floor(fallDistance - 3), 'fall');
      }
    }
    player.vel.y = 0;
    player.fallPeakY = player.pos.y;
  } else {
    player.onGround = player.vel.y <= 0 &&
      playerCollidesAt(player.pos.x, player.pos.y - 0.02, player.pos.z);
    if (!player.onGround && !player.inWater) {
      player.fallPeakY = Math.max(player.fallPeakY, player.pos.y);
    } else {
      player.fallPeakY = player.pos.y;
    }
  }

  const startX = player.pos.x;
  const startZ = player.pos.z;
  const moveX = player.vel.x * dt;
  const moveZ = player.vel.z * dt;
  let hitX = movePlayerAxis('x', moveX);
  let hitZ = movePlayerAxis('z', moveZ);

  // A step half a block tall is walked, not jumped: the foot rises onto the
  // tread and the walk carries on. Water has its own, taller version of this
  // trick below, and only ever runs when in water, so the two never compete.
  if ((hitX || hitZ) && player.onGround && !player.inWater) {
    const step = tryStepUp(startX, player.pos.y, startZ, moveX, moveZ, hitX, hitZ);
    if (step.pastX) hitX = false;
    if (step.pastZ) hitZ = false;
  }

  if ((hitX || hitZ) && player.inWater && input.jump) {
    if (tryWaterMantle(startX, startZ, moveX, moveZ)) {
      hitX = false;
      hitZ = false;
    }
  }

  if (hitX) player.vel.x = 0;
  if (hitZ) player.vel.z = 0;

  // Sprinting, swimming and jumping are what eat through food while exploring;
  // walking on two legs costs nothing at all.
  exhaustForMovement(Math.hypot(player.pos.x - startX, player.pos.z - startZ), jumped);
  if (jumped && !player.inWater) playJumpSound();

  // Keep the player out of the void if a chunk somehow fails to generate.
  if (player.pos.y < -4) {
    player.pos.y = safeGroundY(Math.floor(player.pos.x), Math.floor(player.pos.z));
    player.vel.set(0, 0, 0);
    cameraStepOffset = 0;
  }

  // The view catches up with the foot on an ease, so a staircase arrives as a
  // slope rather than as a series of jumps.
  if (cameraStepOffset > 0) {
    cameraStepOffset *= Math.exp(-dt * CAMERA_STEP_GLIDE_RATE);
    if (cameraStepOffset < 0.004) cameraStepOffset = 0;
  }

  syncCamera();
}

function isGoodSpawnColumn(x, z) {
  const column = sampleColumn(x, z);
  if (column.height <= SEA_LEVEL + 1) return false;
  if (column.biome !== 'plains' && column.biome !== 'forest' &&
      column.biome !== 'rainforest') return false;

  // Prefer a small flat clearing so the player does not spawn in a pit.
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const neighbor = sampleColumn(x + dx, z + dz);
      if (Math.abs(neighbor.height - column.height) > 1) return false;
    }
  }

  // Keep tree trunks and canopies away from the spawn point.
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (treeAt(x + dx, z + dz)) return false;
    }
  }

  // Do not spawn inside a cave entrance or a surface shaft.
  for (let y = column.height; y >= column.height - 4; y--) {
    if (caveCarvesAt(x, y, z)) return false;
  }

  return true;
}

export function chooseSpawnColumn() {
  if (isGoodSpawnColumn(0, 0)) return { x: 0, z: 0 };

  for (let radius = 8; radius <= 192; radius += 8) {
    const samples = Math.max(12, Math.round(radius * 0.9));
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2 + radius * 0.37;
      const x = Math.round(Math.cos(angle) * radius);
      const z = Math.round(Math.sin(angle) * radius);
      if (isGoodSpawnColumn(x, z)) return { x, z };
    }
  }

  // Fall back to any dry column if no grassy, tree-free spot was found.
  for (let radius = 8; radius <= 192; radius += 8) {
    const samples = Math.max(12, Math.round(radius * 0.9));
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2 + radius * 0.37;
      const x = Math.round(Math.cos(angle) * radius);
      const z = Math.round(Math.sin(angle) * radius);
      if (terrainHeight(x, z) > SEA_LEVEL + 1) return { x, z };
    }
  }

  return { x: 0, z: 0 };
}

/** How far up to look for air when a chosen standing spot turns out to be worn. */
const MAX_UNSTUCK_LIFT = 16;

/**
 * The surface height the player should be dropped onto at a column, measured
 * honestly. Two traps make this more than a surfaceY call. An ungenerated chunk
 * reads as pure air, and surfaceY answers sea level for such a column, so a
 * spawn point on a hill resolves twenty-odd blocks *inside* that hill — where
 * collision has nowhere to push the player and they can never move again. And a
 * surface can be wearing something: a tree the player planted, a wall built over
 * the spawn point. So the patch around the column is generated first, and the
 * height is raised until the body fits.
 */
export function safeGroundY(gx, gz) {
  const cx = Math.floor(gx / CHUNK_SIZE);
  const cz = Math.floor(gz / CHUNK_SIZE);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) world.ensureGenerated(cx + dx, cz + dz);
  }

  let y = world.surfaceY(gx, gz) + 1;
  for (let lift = 0; lift < MAX_UNSTUCK_LIFT; lift++) {
    if (!playerCollidesAt(gx + 0.5, y, gz + 0.5)) break;
    y += 1;
  }
  return y;
}

/**
 * Generates a 3x3 patch and meshes the middle chunk with settled light, which
 * is the only way to hand the player ground they can see on the very first
 * frame after a teleport. Streaming fills the rest in behind it.
 */
export function prepareSpawnChunks(cx, cz) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) world.ensureGenerated(cx + dx, cz + dz);
  }
  world.spreadLightAround(cx, cz);

  const chunk = world.getChunk(cx, cz);
  chunk.lightSettled = true;
  meshChunk(world, chunk);
  chunk.group.visible = true;
}

export function spawnPlayer(column) {
  player.pos.set(column.x + 0.5, safeGroundY(column.x, column.z), column.z + 0.5);
  player.vel.set(0, 0, 0);
  player.onGround = true;
  cameraStepOffset = 0;
  view.yaw = -2.4;
  view.pitch = -0.18;
  applyLook();
  syncCamera();
}

export function readPlayerInput() {
  const canPlay = isPlayable();
  const overlayUp = !overlayEl.classList.contains('hidden');
  if (inputView.screenOpen() || overlayUp || !canPlay || player.dead) {
    dropPadResume();
    clearSprintLatch();
    return { forward: 0, right: 0, jump: false, sprint: false };
  }
  if (takePadResume()) {
    return { forward: 0, right: 0, jump: false, sprint: sprintLatched };
  }

  let forward = 0;
  let right = 0;
  if (pressedKeys.has('KeyW')) forward += 1;
  if (pressedKeys.has('KeyS')) forward -= 1;
  if (pressedKeys.has('KeyD')) right += 1;
  if (pressedKeys.has('KeyA')) right -= 1;

  if (gamepadState.active) {
    forward -= gpAxis(1);
    right += gpAxis(0);
  }

  const padJump = gamepadState.active && gpButton('a');

  // Sprint arrives through the latch: the Shift, Ctrl and B edges in the input
  // handlers set it, and holding the key down does nothing on its own.
  return {
    forward: clamp(forward, -1, 1),
    right: clamp(right, -1, 1),
    jump: pressedKeys.has('Space') || padJump,
    sprint: sprintLatched
  };
}

export function enableFallbackControls() {
  const wasFallback = fallbackControls;
  fallbackControls = true;
  fallbackLooking = false;
  fallbackRightDrag = false;
  overlayEl.classList.add('hidden');
  inputView.hint(true);
  document.body.classList.add('fallback-controls');
  if (!wasFallback) say('Mouse lock unavailable \u2014 right-drag to look');
}

export function requestLock() {
  if (player.dead) return;
  if (document.pointerLockElement === canvas) return;
  if (fallbackControls) return;

  let settled = false;
  try {
    const result = canvas.requestPointerLock();

    if (result && typeof result.then === 'function') {
      result.then(() => {
        settled = true;
        fallbackControls = false;
        overlayEl.classList.add('hidden');
        inputView.hint(false);
        document.body.classList.remove('fallback-controls');
      }).catch(() => {
        settled = true;
        enableFallbackControls();
      });
    }

    // Some embedded browsers never resolve or reject the promise.
    window.setTimeout(() => {
      if (!settled && document.pointerLockElement !== canvas && !inputView.screenOpen()) {
        enableFallbackControls();
      }
    }, 350);
  } catch (err) {
    console.warn('Pointer lock unavailable:', err);
    enableFallbackControls();
  }
}

overlayEl.addEventListener('click', (event) => {
  // The volume slider lives in the pause panel, but a click on it is not a
  // request to resume the game.
  if (event.target && event.target.closest && event.target.closest('#audio-settings')) return;
  if (player.dead) return;
  ensureAudio();
  if (fallbackControls) {
    overlayEl.classList.add('hidden');
    inputView.hint(true);
  } else {
    requestLock();
  }
});

document.getElementById('pad-sens-down').addEventListener('click', (event) => {
  event.stopPropagation();
  setGamepadSensitivity(gamepadState.sensitivity - 0.1);
});
document.getElementById('pad-sens-up').addEventListener('click', (event) => {
  event.stopPropagation();
  setGamepadSensitivity(gamepadState.sensitivity + 0.1);
});

window.addEventListener('gamepadconnected', (event) => {
  gamepadState.index = event.gamepad.index;
  gamepadState.name = String(event.gamepad.id || 'Gamepad').slice(0, 48);
  gamepadState.connected = true;
  updatePadStatus();
  say('Gamepad connected');
});

canvas.addEventListener('click', () => {
  if (player.dead) return;
  ensureAudio();
  if (document.pointerLockElement !== canvas) requestLock();
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

document.addEventListener('mousedown', (event) => {
  const canPlay = document.pointerLockElement === canvas ||
    (fallbackControls && !inputView.screenOpen());
  if (!canPlay || player.dead) return;
  ensureAudio();

  if (event.button === 0) {
    leftMouseDown = true;
    triggerHeldSwing();
    updateTarget();
    updateMobTarget();
    // Shears snip rather than strike, and the attack button is no exception:
    // a player who means to hit an animal has anything else in hand.
    swingAtMob();
    if (fallbackControls) {
      fallbackLooking = true;
      fallbackDragMoved = false;
      fallbackDragDistance = 0;
      lastFallbackMouseX = event.clientX;
      lastFallbackMouseY = event.clientY;
    }
  } else if (event.button === 2) {
    if (fallbackControls) {
      // Right-drag looks around; a right-click without movement places.
      fallbackLooking = true;
      fallbackRightDrag = true;
      fallbackDragMoved = false;
      fallbackDragDistance = 0;
      lastFallbackMouseX = event.clientX;
      lastFallbackMouseY = event.clientY;
    } else {
      tryUseSelectedItem();
    }
  }
});

document.addEventListener('mouseup', (event) => {
  if (event.button === 0) {
    leftMouseDown = false;
    fallbackLooking = false;
    hideMiningFeedback();
  } else if (event.button === 2 && fallbackControls && fallbackRightDrag) {
    fallbackRightDrag = false;
    fallbackLooking = false;
    if (!fallbackDragMoved) tryUseSelectedItem();
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    fallbackControls = false;
    fallbackLooking = false;
    fallbackRightDrag = false;
    document.body.classList.remove('fallback-controls');
    inputView.hint(false);
    overlayEl.classList.add('hidden');
  } else {
    if (!inputView.screenOpen() && !fallbackControls && !player.dead) {
      overlayEl.classList.remove('hidden');
    }
    pressedKeys.clear();
    leftMouseDown = false;
    fallbackLooking = false;
    fallbackRightDrag = false;
    hideMiningFeedback();
    hideTargetOutline();
    clearSprintLatch();
  }
});

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement === canvas) {
    turnPlayer(-event.movementX * 0.0022, -event.movementY * 0.0022);
    applyLook();
    return;
  }

  if (fallbackControls && fallbackLooking && !inputView.screenOpen()) {
    const dx = event.clientX - lastFallbackMouseX;
    const dy = event.clientY - lastFallbackMouseY;
    fallbackDragDistance += Math.abs(dx) + Math.abs(dy);
    // The drag still turns the camera from the first pixel; this only decides
    // whether the press counts as a use when it comes up. Four pixels was tight
    // enough that a hand tremor swallowed every right click, and a swallowed
    // use is silent, which reads as the held item doing nothing at all.
    if (fallbackDragDistance > 10) fallbackDragMoved = true;
    lastFallbackMouseX = event.clientX;
    lastFallbackMouseY = event.clientY;
    turnPlayer(-dx * 0.0032, -dy * 0.0032);
    applyLook();
  }
});

const SPRINT_KEYS = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'];

window.addEventListener('keydown', (event) => {
  pressedKeys.add(event.code);
  if (SPRINT_KEYS.includes(event.code) && !event.repeat && controlsOwned()) {
    // Shift and Ctrl latch sprint: pressed once they start the run, pressed
    // again they end it, so nothing about sprinting depends on holding a key.
    toggleSprintLatch();
  }
  if (event.code === 'Space') event.preventDefault();
  if (fallbackControls && event.code.startsWith('Arrow')) event.preventDefault();
});
window.addEventListener('keyup', (event) => {
  pressedKeys.delete(event.code);
});
window.addEventListener('blur', () => {
  pressedKeys.clear();
  leftMouseDown = false;
  fallbackLooking = false;
  fallbackRightDrag = false;
  releasePadMining();
  hideMiningFeedback();
  clearSprintLatch();
});

/* ============================================================
   11b. GAMEPAD INPUT (Web Gamepad API)
   ============================================================ */

const GP_DEADZONE = 0.16;
const GP_LOOK_SPEED = 2.3;            // radians per second at sensitivity 1
export const GP_MENU_AXIS_THRESHOLD = 0.55;
export const GP_MENU_REPEAT_DELAY = 0.34;
export const GP_MENU_REPEAT_RATE = 0.11;

/** Standard-mapping face/button order; names match the debug API. */
export const PAD_BUTTON = {
  a: 0, b: 1, x: 2, y: 3,
  lb: 4, rb: 5, lt: 6, rt: 7,
  back: 8, start: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
  home: 16
};

export const gamepadState = {
  index: null,
  name: '',
  connected: false,
  active: false,
  sensitivity: 1,
  axes: [0, 0, 0, 0],
  buttons: new Array(17).fill(false),
  pressed: new Array(17).fill(false),
  prev: new Array(17).fill(false)
};

/** Synthetic pad used by the debug API when no physical controller exists. */
export const virtualPad = {
  active: false,
  axes: [0, 0, 0, 0],
  buttons: new Array(17).fill(false)
};
export const padMenuRepeat = { x: { dir: 0, timer: 0 }, y: { dir: 0, timer: 0 } };

export let padMiningDown = false;
/** True for the single frame where a pad press dismissed the overlay. */
let padResumeFrame = false;

/**
 * Whether this is the frame right after control came back, in which case the
 * stick is read as centred: a pad that was pushed on the way out of a menu must
 * not turn anyone the moment they can be turned. Clears it — one frame only.
 */
function takePadResume() {
  if (!padResumeFrame) return false;
  padResumeFrame = false;
  return true;
}

/** Control was taken away again before any frame came round: nothing owed. */
function dropPadResume() { padResumeFrame = false; }

export function gpAxis(index) {
  const value = gamepadState.axes[index] || 0;
  return Math.abs(value) < GP_DEADZONE ? 0 : value;
}

function gpButton(name) {
  return !!gamepadState.buttons[PAD_BUTTON[name]];
}

export function isPlayable() {
  return document.pointerLockElement === canvas || fallbackControls ||
    gamepadState.active;
}

/** Mouse and pad mining share one hold state so either input keeps breaking. */
export function isMiningHeld() {
  return leftMouseDown || padMiningDown;
}

export function setGamepadSensitivity(value) {
  const next = Math.round(clamp(Number(value) || 1, 0.3, 3) * 10) / 10;
  gamepadState.sensitivity = next;
  inputView.paintSensitivity(next);
  return next;
}

export function updatePadStatus() {
  const on = gamepadState.connected;
  inputView.paintPadStatus(
    on ? 'Gamepad: ' + (gamepadState.name || 'connected') : 'Gamepad: not detected',
    on
  );
}

function activeGamepad() {
  if (virtualPad.active) return null;
  if (!navigator.getGamepads) return null;

  let pads;
  try {
    pads = navigator.getGamepads();
  } catch (err) {
    return null;
  }
  if (!pads) return null;

  if (gamepadState.index != null) {
    const current = pads[gamepadState.index];
    if (current && current.connected) return current;
  }
  for (const pad of pads) {
    if (pad && pad.connected) return pad;
  }
  return null;
}

export function releasePadMining() {
  if (!padMiningDown) return;
  padMiningDown = false;
  hideMiningFeedback();
}

/**
 * Read the pad once per frame, tracking edges. Runs even while the overlay is
 * up so the first button press can dismiss it without pointer lock.
 */
function pollGamepad(dt) {
  const pad = activeGamepad();
  const connected = !!pad || virtualPad.active;
  const wasConnected = gamepadState.connected;

  if (!connected) {
    if (wasConnected) {
      gamepadState.connected = false;
      gamepadState.active = false;
      gamepadState.index = null;
      gamepadState.name = '';
      gamepadState.axes = [0, 0, 0, 0];
      gamepadState.buttons.fill(false);
      gamepadState.prev.fill(false);
      gamepadState.pressed.fill(false);
      releasePadMining();
      clearSprintLatch();
      say('Gamepad disconnected');
      updatePadStatus();
    }
    return;
  }

  let axes;
  let rawButtons;

  if (virtualPad.active) {
    axes = virtualPad.axes;
    rawButtons = virtualPad.buttons;
  } else {
    if (pad.index !== gamepadState.index) {
      gamepadState.index = pad.index;
      gamepadState.name = String(pad.id || 'Gamepad').slice(0, 48);
      gamepadState.prev.fill(false);
      say('Gamepad connected');
    }
    axes = pad.axes || [];
    rawButtons = Array.prototype.map.call(pad.buttons || [], (button) => {
      if (!button) return 0;
      if (typeof button === 'number') return button;
      if (button.pressed) return 1;
      return button.value > 0.5 ? 1 : 0;
    });
  }

  gamepadState.connected = true;
  gamepadState.axes = [
    Number(axes[0]) || 0,
    Number(axes[1]) || 0,
    Number(axes[2]) || 0,
    Number(axes[3]) || 0
  ];

  const normalized = new Array(17).fill(false);
  for (let i = 0; i < normalized.length; i++) normalized[i] = !!rawButtons[i];

  gamepadState.pressed = normalized.map((down, i) => down && !gamepadState.prev[i]);
  gamepadState.prev = normalized;
  gamepadState.buttons = normalized;

  if (!wasConnected) updatePadStatus();

  const anyInput = gamepadState.pressed.some(Boolean) ||
    Math.hypot(gamepadState.axes[0], gamepadState.axes[1]) > GP_DEADZONE ||
    Math.hypot(gamepadState.axes[2], gamepadState.axes[3]) > GP_DEADZONE ||
    gamepadState.buttons.some(Boolean);

  if (anyInput && !gamepadState.active) {
    gamepadState.active = true;
    ensureAudio();
    say('Gamepad active');
    updatePadStatus();
  }

  if (gamepadState.active) applyGamepadLook(dt);
}

function applyGamepadLook(dt) {
  if (!gamepadState.active || inputView.screenOpen() || player.dead || dt <= 0) return;
  if (!overlayEl.classList.contains('hidden')) return;

  const lookX = gpAxis(2);
  const lookY = gpAxis(3);
  if (!lookX && !lookY) return;

  const speed = GP_LOOK_SPEED * gamepadState.sensitivity * dt;
  turnPlayer(-lookX * speed, -lookY * speed);
  applyLook();
}

function beginPadMining() {
  if (player.dead || inputView.screenOpen()) return;
  padMiningDown = true;
  triggerHeldSwing();
  updateTarget();
  updateMobTarget();
  swingAtMob();
}

/** Shared dispatch so real presses and the debug API behave identically. */
export function handlePadTap(name) {
  if (inputView.screenOpen()) {
    inputView.screenTap(name);
    return;
  }
  if (player.dead) {
    if (name === 'a') respawnPlayer();
    return;
  }

  switch (name) {
    case 'y':
      inputView.togglePack();
      break;
    case 'start':
      overlayEl.classList.remove('hidden');
      setGamepadSensitivity(gamepadState.sensitivity);
      break;
    case 'lb':
      inputView.hotbarStep(-1);
      break;
    case 'rb':
      inputView.hotbarStep(1);
      break;
    case 'lt':
      tryUseSelectedItem();
      break;
    case 'rt':
      beginPadMining();
      break;
    case 'b':
    case 'l3':
      if (controlsOwned()) toggleSprintLatch();
      break;
    default:
      break;
  }
}

/** Per-frame pad update: polling, look, and in-world actions. */
export function updateGamepad(dt) {
  pollGamepad(dt);

  if (!gamepadState.connected || !gamepadState.active) {
    releasePadMining();
    return;
  }

  // Trigger release, or losing focus, stops the mining hold.
  if (!gpButton('rt')) releasePadMining();

  // The overlay doubles as the pause/settings screen: D-pad left/right tunes
  // look sensitivity, any other pad input resumes.
  if (!inputView.screenOpen() && !overlayEl.classList.contains('hidden')) {
    releasePadMining();
    const left = gamepadState.pressed[PAD_BUTTON.left];
    const right = gamepadState.pressed[PAD_BUTTON.right];
    if (left) setGamepadSensitivity(gamepadState.sensitivity - 0.1);
    if (right) setGamepadSensitivity(gamepadState.sensitivity + 0.1);

    const otherEdge = gamepadState.pressed.some(
      (down, index) => down && index !== PAD_BUTTON.left && index !== PAD_BUTTON.right
    );
    const stickMoved = Math.abs(gpAxis(0)) + Math.abs(gpAxis(1)) +
      Math.abs(gpAxis(2)) + Math.abs(gpAxis(3)) > 0;
    if (otherEdge || stickMoved) {
      overlayEl.classList.add('hidden');
      padResumeFrame = true;
    }
    return;
  }

  if (player.dead) {
    if (gamepadState.pressed[PAD_BUTTON.a]) respawnPlayer();
    return;
  }

  if (inputView.screenOpen()) {
    const taps = ['a', 'b', 'x', 'y', 'lb', 'rb', 'start', 'back'];
    for (const name of taps) {
      if (gamepadState.pressed[PAD_BUTTON[name]]) handlePadTap(name);
      if (!inputView.screenOpen()) return;
    }
    inputView.screenTick(dt);
    return;
  }

  if (gamepadState.pressed[PAD_BUTTON.y]) {
    inputView.togglePack();
    return;
  }
  if (gamepadState.pressed[PAD_BUTTON.start]) {
    overlayEl.classList.remove('hidden');
    releasePadMining();
    return;
  }
  if (gamepadState.pressed[PAD_BUTTON.b] || gamepadState.pressed[PAD_BUTTON.l3]) {
    toggleSprintLatch();
  }
  if (gamepadState.pressed[PAD_BUTTON.lb]) {
    inputView.hotbarStep(-1);
  }
  if (gamepadState.pressed[PAD_BUTTON.rb]) {
    inputView.hotbarStep(1);
  }
  if (gamepadState.pressed[PAD_BUTTON.lt]) tryUseSelectedItem();
  if (gamepadState.pressed[PAD_BUTTON.rt]) beginPadMining();
}
