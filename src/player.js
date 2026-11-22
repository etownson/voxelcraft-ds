/*
 * The walker: one mutable record of where the body is, how fast it is going,
 * what it stands on, and how much of it is left, plus the two angles the view
 * looks through.
 *
 * Nothing up the file imports this to find out what the player did: it is
 * handed the same record, or asks for a look and is given one. Turning is a
 * verb, not an assignment — the tilt limit is written once, here, next to the
 * angles it protects — and `view` lets every other layer read the heading
 * without rebinding a module's own name.
 *
 * The record's other half is what it costs to be alive in a world: exhaustion
 * spent by digging and swimming and jumping, the saturation that cushions it,
 * the food that runs out underneath. All three are fields here, so spending
 * them is here too, and the food bar is handed in as a painter rather than
 * reached for.
 */

import * as THREE from 'three';
import { EYE_HEIGHT, EXHAUSTION, EXHAUSTION_THRESHOLD, clamp } from './config.js';
import { camera } from './render.js';

export const player = {
  /** Feet position at the centre of the collision box. */
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  onGround: false,
  inWater: false,
  headInWater: false,
  sprinting: false,
  health: 20,
  maxHealth: 20,
  /** Food points, 0 to 20. Half a point is never shown, just like Minecraft. */
  hunger: 20,
  /**
   * Minecraft's hidden saturation counter, on the same 0-20 scale and never above
   * the food it sits on. Exhaustion spends this before it touches food, which is
   * what lets a good meal carry a busy day, and the food bar jitters the moment
   * it runs out.
   */
  saturation: 5,
  /** Invisible counter that spends one point of saturation or food every 4.0. */
  exhaustion: 0,
  dead: false,
  hurtCooldown: 0,
  regenDelay: 0,
  /**
   * The wall-facing of the ladder whose cell the player's feet are in, or null
   * when nothing is holding them. This is the whole of what it means to be
   * climbing: there is no mode to enter. The facing is kept because a rung holds
   * a climber against the wall it hangs on.
   */
  onLadder: null,
  fallPeakY: 0
};

/* The controller owns the view. Everything else asks for a look in one of two
   ways — turn by this much, or point here — so the tilt limit is written once
   and lives where the camera it protects does. */


export const view = { yaw: 0.7, pitch: -0.2 };

/** How far the view may tilt, up or down: just short of straight overhead. */
export const PITCH_LIMIT = 1.55;

/** Turns the view by a delta: a thumb on a stick, a mouse, an arrow key. */
export function turnPlayer(dYaw, dPitch) {
  view.yaw += dYaw;
  view.pitch = clamp(view.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
}

/** Points the view at absolute angles, as absolute as a save file leaves them. */
export function aimPlayer(nextYaw, nextPitch) {
  view.yaw = nextYaw;
  view.pitch = clamp(nextPitch, -PITCH_LIMIT, PITCH_LIMIT);
}

/**
 * Puts the view back where a save left it. Either angle may be missing, and
 * then that one stays where the game had already put it.
 */
export function restorePlayerLook(saved) {
  if (!saved) return;
  if (Number.isFinite(saved.yaw)) view.yaw = saved.yaw;
  if (Number.isFinite(saved.pitch)) {
    view.pitch = clamp(saved.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }
}

export function applyLook() {
  camera.rotation.y = view.yaw;
  camera.rotation.x = view.pitch;
}

const aimPoint = new THREE.Vector3();

/**
 * Where the crosshair aims from. After a step up the view sits below the eyes
 * for a fifth of a second — half a block at a walk — and a pickaxe should not
 * follow it down into the stair itself, so everything that hits the world uses
 * the real eye instead.
 */
export function aimOrigin() {
  return aimPoint.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
}

/* The food bar belongs to whoever is showing it, and this is the only way the
   body can tell it to redraw. The page hands one over at bootstrap; until then
   spending exhaustion moves the counters and nobody hears. */
let paintHunger = () => {};

export function setHungerPainter(paint) { paintHunger = paint; }

/**
 * Spends exhaustion the way Minecraft does: every full 4.0 points takes one point
 * of saturation if there is any left, and only then one point of food. That order
 * is what makes food worth eating before the bar drops rather than after.
 */
export function addExhaustion(amount) {
  if (player.dead || !Number.isFinite(amount) || amount <= 0) return;
  player.exhaustion += amount;
  let spent = false;
  while (player.exhaustion >= EXHAUSTION_THRESHOLD) {
    player.exhaustion -= EXHAUSTION_THRESHOLD;
    if (player.saturation > 0) {
      player.saturation = Math.max(0, player.saturation - 1);
    } else if (player.hunger > 0) {
      player.hunger -= 1;
    } else {
      // Nothing left to pay with, so the debt stops here instead of stacking up
      // behind an empty stomach and spending food the instant something is eaten.
      player.exhaustion = 0;
      break;
    }
    spent = true;
  }
  // Saturation leaving the picture is worth showing: Minecraft jitters the bar.
  if (spent) paintHunger();
}

/** Tracks how far the player has travelled and charges food for it. */
export function exhaustForMovement(distance, jumping) {
  if (distance > 0) {
    // Walking is free, exactly like Minecraft: exploring costs nothing and a meal
    // buys work rather than footsteps. Water is dearer than land on purpose, and
    // this game has no sprint-swimming, so a swim always pays the swim rate.
    if (player.inWater) addExhaustion(distance * EXHAUSTION.swim);
    else if (player.sprinting) addExhaustion(distance * EXHAUSTION.sprint);
  }
  // A jump spent its energy even when the player was shoved up against a wall.
  if (jumping) addExhaustion(player.sprinting ? EXHAUSTION.sprintJump : EXHAUSTION.jump);
}
