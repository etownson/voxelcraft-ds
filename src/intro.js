/*
 * The first-spawn scene: how a world nobody has walked yet shows itself. The
 * screen is already black when the menu lifts, framed top and bottom by
 * letterbox bars, and the walker stands where the spawn put them while the
 * arrival plays out in front of them:
 *
 *   - the carrier climbs in the dark;
 *   - the beam pulses three times, and each pulse lets a little more of the
 *     world flicker through the black, washed in the beam's cyan;
 *   - the beam lets go in a white flash and a jolt, and the world is there,
 *     overexposed, blurred and drained of colour the way a walker just sent
 *     across would see it, and comes into focus;
 *   - the bars draw back and hand the walker the screen.
 *
 * The page then lets the transmitter speak and, once the line is read, hands
 * the world its first music — the arrival song. The scene only plays its part
 * in that sequence: it moves nobody, touches nothing the world or the save
 * keeps, and holds no music itself. Everything it does is paint on the page.
 *
 * The walker never owns the scene. The page reports it through `introActive`
 * and takes the controls away while it runs, so the arrival begins with the
 * world out of sight rather than with a walk that has already started.
 */

import { playTeleportHoldSound, playTeleportSettleSound, playTeleportSound } from './audio.js';
import { arrivalBarsEl, arrivalFadeEl, arrivalFlashEl, arrivalHazeEl, viewportEl } from './hud.js';

/** How long the whole scene runs, from the menu lifting to the bars gone. */
const SCENE_SECONDS = 6;

/* The beats, in seconds from the start. The carrier climbs at once; the hold's
   three pulses sound 0.26 s apart (see playTeleportHoldSound), and each throws
   a glimmer of the world through the black; the settle is the flash. */
const SEND_AT = 0;
const HOLD_AT = 1.3;
const PULSE_OFFSETS = [0, 0.26, 0.52];
const PULSE_STRENGTH = [0.35, 0.55, 0.8];
const PULSE_SECONDS = 0.22;
const SETTLE_AT = 2.5;

/** The flash burns off over this long after the settle. */
const FLASH_SECONDS = 1.1;
/** The jolt of landing, in pixels, and how long it takes to die away. */
const SHAKE_PIXELS = 11;
const SHAKE_SECONDS = 0.9;
/** The world comes into focus from the settle until this long before the end. */
const FOCUS_SECONDS = 3;
const HAZE_BLUR_PX = 12;
const HAZE_SATURATE = 0.2;
const HAZE_BRIGHTNESS = 1.7;
/** The bars draw back over the scene's last stretch. */
const BARS_FROM = 4.5;
const BARS_SECONDS = 1.4;

const reducedMotion = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 'idle' outside the scene, 'playing' while it runs. */
let phase = 'idle';
let elapsed = 0;
let sendSounded = false;
let holdSounded = false;
let settleSounded = false;

/** Whether the scene has the controls. */
export function introActive() {
  return phase === 'playing';
}

/**
 * Paints the screen black and puts the bars up before the scene has the
 * controls, so a fresh world opens from black instead of showing the bare
 * world for the frame between the menu lifting and the scene starting. Under
 * the menu, never over it.
 */
export function primeIntroBlack() {
  arrivalFadeEl.style.opacity = '1';
  arrivalBarsEl.style.setProperty('--bars', '1');
}

/**
 * Starts the scene. The spawn patch is already meshed — the page prepared it
 * at boot — so what the flash reveals is a finished footing from the first
 * clear frame, with nothing to stream in around the walker.
 */
export function startIntro() {
  if (phase !== 'idle') return false;

  primeIntroBlack();
  phase = 'playing';
  elapsed = 0;
  sendSounded = false;
  holdSounded = false;
  settleSounded = false;
  paint(0);
  soundArrival(0);
  return true;
}

/**
 * The teleport's three sounds, asked for as the scene passes them. Each is
 * asked again the frame after it fails: the audio clock only wakes on the
 * click that lifts the menu and can still be coming up when the scene already
 * is, and a sound that cannot be heard yet is worth a frame's wait rather than
 * losing.
 */
function soundArrival(t) {
  if (!sendSounded && t >= SEND_AT) sendSounded = playTeleportSound();
  if (!holdSounded && t >= HOLD_AT) holdSounded = playTeleportHoldSound();
  if (!settleSounded && t >= SETTLE_AT) settleSounded = playTeleportSettleSound();
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (v) => 1 - (1 - v) ** 3;
const easeInOut = (v) => (v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2);

/** How bright the beam's glimmer is at `t`, 0 between pulses. */
function glimmerAt(t) {
  let glimmer = 0;
  for (let i = 0; i < PULSE_OFFSETS.length; i++) {
    const local = (t - HOLD_AT - PULSE_OFFSETS[i]) / PULSE_SECONDS;
    if (local >= 0 && local < 1) glimmer = Math.max(glimmer, PULSE_STRENGTH[i] * Math.sin(Math.PI * local));
  }
  return glimmer;
}

/** Paints every layer of the scene for the moment `t` seconds in. */
function paint(t) {
  let black;
  let flash;
  if (t < SETTLE_AT) {
    const glimmer = glimmerAt(t);
    black = 1 - 0.55 * glimmer;
    flash = 0.35 * glimmer;
  } else {
    black = 0;
    flash = 1 - easeOut(clamp01((t - SETTLE_AT) / FLASH_SECONDS));
  }
  arrivalFadeEl.style.opacity = String(black);
  arrivalFlashEl.style.opacity = String(flash);

  // Out of focus from the flash on; the black hides it before then.
  const focus = t < SETTLE_AT ? 0 : easeOut(clamp01((t - SETTLE_AT) / FOCUS_SECONDS));
  const haze = 1 - focus;
  const filter = haze > 0.001
    ? `blur(${(HAZE_BLUR_PX * haze).toFixed(2)}px) `
      + `saturate(${(HAZE_SATURATE + (1 - HAZE_SATURATE) * focus).toFixed(3)}) `
      + `brightness(${(1 + (HAZE_BRIGHTNESS - 1) * haze).toFixed(3)})`
    : 'none';
  arrivalHazeEl.style.backdropFilter = filter;
  arrivalHazeEl.style.webkitBackdropFilter = filter;

  const sinceSettle = t - SETTLE_AT;
  if (!reducedMotion && sinceSettle >= 0 && sinceSettle < SHAKE_SECONDS) {
    const amp = SHAKE_PIXELS * (1 - sinceSettle / SHAKE_SECONDS) ** 2;
    const x = Math.sin(sinceSettle * 71) * amp;
    const y = Math.cos(sinceSettle * 53) * amp * 0.7;
    viewportEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  } else {
    viewportEl.style.transform = '';
  }

  const bars = 1 - easeInOut(clamp01((t - BARS_FROM) / BARS_SECONDS));
  arrivalBarsEl.style.setProperty('--bars', String(bars));
}

/** Takes every layer of the scene off the page. */
function clearScene() {
  arrivalFadeEl.style.opacity = '0';
  arrivalFlashEl.style.opacity = '0';
  arrivalHazeEl.style.backdropFilter = 'none';
  arrivalHazeEl.style.webkitBackdropFilter = 'none';
  arrivalBarsEl.style.setProperty('--bars', '0');
  viewportEl.style.transform = '';
}

/**
 * Cut the scene short: every layer is taken off at once and the world is
 * shown. The teleport still gets to finish saying itself — letting go is the
 * part that says the walker is really standing there — and the song is not
 * the scene's to play, so the transmission still takes its turn either way.
 */
export function skipIntro() {
  if (phase !== 'playing') return false;
  clearScene();
  if (!settleSounded) settleSounded = playTeleportSettleSound();
  phase = 'idle';
  return true;
}

/** One frame of the scene. Runs after the walker has been walked. */
export function updateIntro(dt) {
  if (phase !== 'playing' || dt <= 0) return;

  elapsed += dt;
  if (elapsed >= SCENE_SECONDS) {
    clearScene();
    phase = 'idle';
    return;
  }
  soundArrival(elapsed);
  paint(elapsed);
}
