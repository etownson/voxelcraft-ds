/*
 * The first-spawn scene: how a world nobody has walked yet shows itself. The
 * screen is already black when the menu lifts, and the world comes up out of
 * that black over three and a half seconds while the walker stands where the
 * spawn put them. What brought them is told entirely by ear: three synthesised
 * gestures strung across the fade — the carrier climbing, the beam pulsing, the
 * beam letting go — with nothing on screen but the black lifting. The page then
 * lets the transmitter speak and, once the line is read, hands the world its
 * first music — the arrival song. The scene only plays its part in that
 * sequence: it moves nobody and it holds no music itself.
 *
 * The walker never owns the scene. The page reports it through `introActive`
 * and takes the controls away while the black is still lifting, which is the
 * only thing the scene is for: the arrival begins with the world out of sight
 * rather than with a walk that has already started.
 */

import { playTeleportHoldSound, playTeleportSettleSound, playTeleportSound } from './audio.js';
import { arrivalFadeEl } from './hud.js';

/** How long the world takes to come up out of the black. */
const FADE_SECONDS = 3.5;

/* The teleport is told entirely by ear now, so its three sounds are hung off
   the fade itself, as shares of it: the carrier climbing as the black is put
   down, the beam pulsing while the world is still out of sight, and the beam
   letting go just in time for the walker to be standing in it. */
const SEND_AT = 0;
const HOLD_AT = 0.36;
const SETTLE_AT = 0.7;

/** 'idle' outside the scene, 'fading' while the black is still lifting. */
let phase = 'idle';
let fadeLeft = 0;
let sendSounded = false;
let holdSounded = false;
let settleSounded = false;

/** Whether the scene has the controls. */
export function introActive() {
  return phase === 'fading';
}

/**
 * Paints the screen black before the scene has the controls, so a fresh world
 * opens from black instead of showing the bare world for the frame between the
 * menu lifting and the scene starting. Black under the menu, never over it.
 */
export function primeIntroBlack() {
  arrivalFadeEl.style.opacity = '1';
}

/**
 * Lifts the black off the world. The spawn patch is already meshed — the page
 * prepared it at boot — so what the fade reveals is a finished footing from the
 * first clear frame, with nothing to stream in around the walker.
 */
export function startIntro() {
  if (phase !== 'idle') return false;

  arrivalFadeEl.style.opacity = '1';
  phase = 'fading';
  fadeLeft = FADE_SECONDS;
  sendSounded = false;
  holdSounded = false;
  settleSounded = false;
  soundArrival(0);
  return true;
}

/**
 * The teleport's three sounds, asked for as the fade passes them. Each is asked
 * again the frame after it fails: the audio clock only wakes on the click that
 * lifts the menu and can still be coming up when the scene already is, and a
 * sound that cannot be heard yet is worth a frame's wait rather than losing.
 */
function soundArrival(progress) {
  if (!sendSounded) sendSounded = playTeleportSound();
  if (!holdSounded && progress >= HOLD_AT) holdSounded = playTeleportHoldSound();
  if (!settleSounded && progress >= SETTLE_AT) settleSounded = playTeleportSettleSound();
}

/**
 * Cut the scene short: the black is taken off at once and the world is shown.
 * The teleport still gets to finish saying itself — letting go is the part that
 * says the walker is really standing there — and the song is not the scene's to
 * play, so the transmission still takes its turn either way.
 */
export function skipIntro() {
  if (phase !== 'fading') return false;
  arrivalFadeEl.style.opacity = '0';
  if (!settleSounded) settleSounded = playTeleportSettleSound();
  phase = 'idle';
  return true;
}

/** One frame of the scene. Runs after the walker has been walked. */
export function updateIntro(dt) {
  if (phase !== 'fading' || dt <= 0) return;

  fadeLeft -= dt;
  if (fadeLeft <= 0) {
    arrivalFadeEl.style.opacity = '0';
    phase = 'idle';
    return;
  }
  const progress = (FADE_SECONDS - fadeLeft) / FADE_SECONDS;
  soundArrival(progress);
  arrivalFadeEl.style.opacity = String(fadeLeft / FADE_SECONDS);
}
