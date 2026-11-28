/*
 * Camera assist: the view turning itself for a pad player who steers with the
 * left stick and finds the right one hard to work at the same time. It is a
 * setting (`cameraAssist()` in `settings.js`), off unless asked for, and the
 * right stick always wins: the assist waits while the thumb is on it and for a
 * moment after it lets go.
 *
 * It does three things, each an ease rather than a snap:
 *
 * - It follows the walk. A stick pushed partly sideways turns the view toward
 *   where the walker is going, faster the further over it is, the way a
 *   third-person camera swings round behind its runner. Backing up leaves the
 *   view alone, so walking backwards never spins it.
 * - It levels the tilt. Two seconds after the right stick lets go, the pitch
 *   drifts back to an easy eye line. It holds still while the walker stands
 *   mining, on a ladder, or with something to aim at.
 * - It leans onto a hostile close ahead, nearest first, so a swing lands
 *   without fine aiming.
 *
 * Where the hostiles are is not this layer's business: it asks whoever
 * registered through `setAssistTargets`, and with nobody registered it simply
 * does not aim.
 */

import { aimOrigin, applyLook, player, turnPlayer, view } from './player.js';

/** How long the right stick must rest before the assist turns the view. */
export const ASSIST_LOOK_IDLE_SECONDS = 0.8;
/** Radians per second the view follows a stick pushed fully sideways. */
export const ASSIST_FOLLOW_RATE = 1.7;
/* How far sideways the left stick must lean before the view follows it. A
   thumb walking straight ahead is never quite straight, and without this the
   view wandered with it; past the band the turn ramps up from nothing, so it
   still starts gently. */
export const ASSIST_FOLLOW_DEADZONE = 0.25;
/** The resting tilt: a little below level, as the spawn view stands. */
export const ASSIST_REST_PITCH = -0.18;
/** How quickly the tilt drifts back to rest (exponential, per second). */
export const ASSIST_LEVEL_RATE = 1.6;
/* How long the tilt is left alone before it starts to level, counted from the
   right stick's release or from whatever last held it still (a ladder, mining
   on the spot, a hostile to aim at), so a look up or down stays put a while. */
export const ASSIST_LEVEL_DELAY_SECONDS = 2;
/** How far and how far off the crosshair a hostile can be to draw the aim. */
export const ASSIST_AIM_RANGE = 6;
export const ASSIST_AIM_CONE = 0.61; // ~35 degrees
/** How quickly the aim leans onto a hostile (exponential, per second). */
export const ASSIST_AIM_RATE = 5;

let assistTargets = () => [];
/** Seconds since the levelling was last held, toward `ASSIST_LEVEL_DELAY_SECONDS`. */
let levelWait = 0;

/**
 * Registers where the hostiles are: a function returning points to aim at,
 * each `{ x, y, z }` at the body's middle.
 */
export function setAssistTargets(fn) {
  assistTargets = typeof fn === 'function' ? fn : () => [];
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function ease(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

/** The nearest target inside the aim cone, as the yaw and pitch facing it. */
function aimTarget() {
  const eye = aimOrigin();
  let best = null;
  let bestDistance = Infinity;
  for (const point of assistTargets() || []) {
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const flat = Math.hypot(dx, dz);
    const distance = Math.hypot(flat, dy);
    if (distance > ASSIST_AIM_RANGE || distance < 0.3 || distance >= bestDistance) continue;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, flat);
    const yawOff = wrapAngle(yaw - view.yaw);
    const pitchOff = pitch - view.pitch;
    if (Math.hypot(yawOff, pitchOff) > ASSIST_AIM_CONE) continue;
    best = { yawOff, pitchOff };
    bestDistance = distance;
  }
  return best;
}

/**
 * One frame of the assist. `moveX` and `moveForward` are the left stick
 * (right and forward positive), `lookIdleFor` the seconds since the right
 * stick last moved, `mining` whether the mining trigger is held.
 *
 * Answers whether the stick's sideways lean went into steering this frame.
 * When it did, the walk must not also strafe on it: a walker sliding sideways
 * while the view turns traces a circle five blocks across, so pushing the
 * stick hard over from a standstill swung them round a ring instead of
 * turning them on the spot.
 */
export function updateCameraAssist(dt, { moveX = 0, moveForward = 0, lookIdleFor = 0, mining = false } = {}) {
  if (dt <= 0) return false;
  if (lookIdleFor < ASSIST_LOOK_IDLE_SECONDS) {
    levelWait = lookIdleFor;
    return false;
  }

  let dYaw = 0;
  let dPitch = 0;
  let steering = false;
  const target = aimTarget();

  if (target) {
    const blend = ease(ASSIST_AIM_RATE, dt);
    dYaw = target.yawOff * blend;
    dPitch = target.pitchOff * blend;
    levelWait = 0;
  } else {
    const lean = Math.abs(moveX) - ASSIST_FOLLOW_DEADZONE;
    if (moveForward > -0.3 && lean > 0) {
      steering = true;
      const push = Math.sign(moveX) * lean / (1 - ASSIST_FOLLOW_DEADZONE);
      dYaw = -push * ASSIST_FOLLOW_RATE * dt;
    }
    const walking = Math.hypot(moveX, moveForward) > 0.2;
    if (player.onLadder || (mining && !walking)) {
      levelWait = 0;
    } else {
      levelWait += dt;
      if (levelWait >= ASSIST_LEVEL_DELAY_SECONDS) {
        dPitch = (ASSIST_REST_PITCH - view.pitch) * ease(ASSIST_LEVEL_RATE, dt);
      }
    }
  }

  if (dYaw || dPitch) {
    turnPlayer(dYaw, dPitch);
    applyLook();
  }
  return steering;
}
