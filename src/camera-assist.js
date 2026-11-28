/*
 * Camera assist: the view turning itself for a pad player who steers with the
 * left stick and finds the right one hard to work at the same time. It is two
 * settings in `settings.js`, each off unless asked for and each working
 * without the other: `cameraAssist()` follows the walk and levels the tilt,
 * `lockOnAssist()` leans onto a hostile. The right stick always wins: the
 * assist waits while the thumb is on it and for a moment after it lets go.
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
 *   without fine aiming (the lock-on, its own setting). With a bow drawn it
 *   reaches much further, only to a hostile in plain sight, and aims high by
 *   the drop the arrow will take on the way, as a skeleton does.
 *
 * Where the hostiles are, how a drawn bow would loose and what blocks a sight
 * line are not this layer's business: it asks whoever registered through
 * `setAssistTargets`, `setAssistBow` and `setAssistSight`. With nobody
 * registered it does not aim, aims every bow as a sword, and sees everywhere.
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
/* How far a hostile can be to draw the aim while a bow is drawn. A full draw
   drops about four blocks over this, which the aim allows for; a weak draw
   that cannot carry so far reaches no one out there. */
export const ASSIST_BOW_AIM_RANGE = 24;

let assistTargets = () => [];
let assistBow = () => null;
let assistSight = () => true;
/** Seconds since the levelling was last held, toward `ASSIST_LEVEL_DELAY_SECONDS`. */
let levelWait = 0;

/**
 * Registers where the hostiles are: a function returning points to aim at,
 * each `{ x, y, z }` at the body's middle.
 */
export function setAssistTargets(fn) {
  assistTargets = typeof fn === 'function' ? fn : () => [];
}

/**
 * Registers how a drawn bow would loose: a function returning
 * `{ speed, gravity, drag }` for the arrow, or null while no bow is drawn.
 */
export function setAssistBow(fn) {
  assistBow = typeof fn === 'function' ? fn : () => null;
}

/** Registers what a sight line hits: a function of two points, true when clear. */
export function setAssistSight(fn) {
  assistSight = typeof fn === 'function' ? fn : () => true;
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function ease(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

/* The steepest a drawn bow is aimed for a shot out level, about the angle of
   its longest; a target well above takes the search higher, never past
   BOW_STEEPEST_UP, just short of straight up. */
const BOW_STEEPEST = 0.8;
const BOW_STEEPEST_UP = 1.45;

/*
 * Where an arrow loosed at `angle` above level is when it has come `flat`
 * blocks out: how high above the bow, or null if it slows to nothing first.
 * Drag takes the whole velocity down as e^(-drag t) while gravity pulls, so
 *   out(t)  = speed cos(angle) (1 - e^(-drag t)) / drag
 *   up(t)   = (speed sin(angle) + g/drag) (1 - e^(-drag t)) / drag - g t / drag
 */
function arrowHeightAt(flat, angle, { speed, gravity, drag }) {
  const along = speed * Math.cos(angle);
  if (!(drag > 0)) {
    const time = flat / along;
    return speed * Math.sin(angle) * time - 0.5 * gravity * time * time;
  }
  // share is 1 - e^(-drag t): the part of its speed the arrow has lost.
  const share = (drag * flat) / along;
  if (share >= 1) return null;
  const time = -Math.log(1 - share) / drag;
  const fall = gravity / drag;
  return (speed * Math.sin(angle) + fall) * share / drag - fall * time;
}

/*
 * The angle above level that lands an arrow `dy` above the bow `flat` blocks
 * out, on the low arc, or null when the draw cannot carry that far. The
 * height there only rises with the angle up to the steepest, so halving the
 * gap finds it.
 */
function bowPitch(flat, dy, flight) {
  let low = Math.atan2(dy, flat);
  let high = Math.min(BOW_STEEPEST_UP, Math.max(BOW_STEEPEST, low + 0.3));
  if (low >= high) return null;
  const top = arrowHeightAt(flat, high, flight);
  if (top === null || top < dy) return null;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const height = arrowHeightAt(flat, mid, flight);
    if (height !== null && height >= dy) high = mid; else low = mid;
  }
  return high;
}

/**
 * The nearest target inside the aim cone, as the yaw and pitch facing it. With
 * a bow drawn the pitch is the one an arrow loosed now would land on it from,
 * and the target must be in sight.
 */
function aimTarget() {
  const eye = aimOrigin();
  const flight = assistBow();
  const range = flight ? ASSIST_BOW_AIM_RANGE : ASSIST_AIM_RANGE;
  let best = null;
  let bestDistance = Infinity;
  for (const point of assistTargets() || []) {
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const flat = Math.hypot(dx, dz);
    const distance = Math.hypot(flat, dy);
    if (distance > range || distance < 0.3 || distance >= bestDistance) continue;
    const pitch = flight ? bowPitch(flat, dy, flight) : Math.atan2(dy, flat);
    if (pitch === null) continue;
    const yaw = Math.atan2(-dx, -dz);
    const yawOff = wrapAngle(yaw - view.yaw);
    const pitchOff = pitch - view.pitch;
    if (Math.hypot(yawOff, pitchOff) > ASSIST_AIM_CONE) continue;
    if (flight && !assistSight(eye, point)) continue;
    best = { yawOff, pitchOff };
    bestDistance = distance;
  }
  return best;
}

/**
 * One frame of the assist. `moveX` and `moveForward` are the left stick
 * (right and forward positive), `lookIdleFor` the seconds since the right
 * stick last moved, `mining` whether the mining trigger is held. `follow`
 * says whether to follow the walk and level the tilt, `lockOn` whether to
 * lean onto a hostile; with only the lock-on, the view is left alone whenever
 * nothing is in reach.
 *
 * Answers whether the stick's sideways lean went into steering this frame.
 * When it did, the walk must not also strafe on it: a walker sliding sideways
 * while the view turns traces a circle five blocks across, so pushing the
 * stick hard over from a standstill swung them round a ring instead of
 * turning them on the spot.
 */
export function updateCameraAssist(dt, {
  moveX = 0, moveForward = 0, lookIdleFor = 0, mining = false, follow = true, lockOn = true
} = {}) {
  if (dt <= 0) return false;
  if (lookIdleFor < ASSIST_LOOK_IDLE_SECONDS) {
    levelWait = lookIdleFor;
    return false;
  }

  let dYaw = 0;
  let dPitch = 0;
  let steering = false;
  const target = lockOn ? aimTarget() : null;

  if (target) {
    const blend = ease(ASSIST_AIM_RATE, dt);
    dYaw = target.yawOff * blend;
    dPitch = target.pitchOff * blend;
    levelWait = 0;
  } else if (follow) {
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
