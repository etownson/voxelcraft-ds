/*
 * The first-spawn scene: the short arrival that says the walker did not wake up
 * in this world, they were sent into it. It runs once, in a world nobody has
 * walked yet: the overlay lifts, the walker hangs a beat seven blocks over
 * their own spawn inside a column of teleport sparks, falls, and lands. The
 * page then lets the transmitter speak and, once the line is read, hands the
 * world its first music — the arrival song. The scene only plays its part in
 * that sequence and holds no music itself.
 *
 * The walker never owns the scene. The page reports it through `introActive`
 * and takes the controls away while it runs, and the fall is the arrival
 * rather than a drop: the walker's fall peak is pinned frame to frame, so the
 * teleport can never bill anyone for it. The physics layer is still what
 * catches the ground — the scene only decides where the walker begins.
 */

import { playTeleportSound } from './audio.js';
import { spawnBurstParticles } from './fx.js';
import { resetCameraStep, syncCamera } from './input.js';
import { player } from './player.js';

/** How far above the spawn footing the walker arrives. */
const ARRIVAL_HEIGHT = 7;
/** The beat the walker hangs in the beam before the beam lets go. */
const HOVER_SECONDS = 0.55;
/** A scene that cannot find its ground still ends, and still plays its song. */
const SCENE_LIMIT_SECONDS = 12;

const SPARK_BLUE = 0x8fe0ff;
const SPARK_WHITE = 0xffffff;

/** 'idle' outside the scene, 'hover' while the beam holds, 'falling' after. */
let phase = 'idle';
let hoverLeft = 0;
let sceneSeconds = 0;
let sparkleLeft = 0;
let hoverY = 0;
let spawnFeetY = 0;

/** Whether the scene has the controls. */
export function introActive() {
  return phase !== 'idle';
}

/**
 * Lifts the walker off their spawn footing and into the beam. The spawn patch
 * is already meshed — the page prepared it at boot — so the ground the scene
 * falls back onto is real from the first frame.
 */
export function startIntro() {
  if (phase !== 'idle') return false;

  spawnFeetY = player.pos.y;
  hoverY = spawnFeetY + ARRIVAL_HEIGHT;
  player.pos.y = hoverY;
  player.vel.set(0, 0, 0);
  player.onGround = false;
  player.fallPeakY = hoverY;
  resetCameraStep();
  syncCamera();

  playTeleportSound();
  spawnBurstParticles(player.pos.x, hoverY + 0.5, player.pos.z, SPARK_BLUE, 14, 2.6);

  phase = 'hover';
  hoverLeft = HOVER_SECONDS;
  sceneSeconds = 0;
  sparkleLeft = 0;
  return true;
}

/**
 * Cut the scene short: the walker is set down on their spawn footing. The
 * song is not the scene's to play — the page starts it when the arrival
 * sequence ends — so the transmission still gets its turn either way.
 */
export function skipIntro() {
  if (phase === 'idle') return false;
  setDownAtSpawn();
  phase = 'idle';
  return true;
}

/** One frame of the scene. Runs after the walker has been walked. */
export function updateIntro(dt) {
  if (phase === 'idle' || dt <= 0) return;
  sceneSeconds += dt;

  // The fall is the arrival, not a drop: pin the peak at the current feet so
  // the physics layer never bills the walker for the teleport.
  player.fallPeakY = player.pos.y;

  sparkleLeft -= dt;
  if (sparkleLeft <= 0) {
    sparkleLeft = 0.14;
    spawnBurstParticles(
      player.pos.x,
      player.pos.y + 0.4 + Math.random() * 1.4,
      player.pos.z,
      Math.random() < 0.25 ? SPARK_WHITE : SPARK_BLUE,
      2,
      0.7
    );
  }

  if (phase === 'hover') {
    player.pos.y = hoverY;
    player.vel.set(0, 0, 0);
    player.onGround = false;
    hoverLeft -= dt;
    if (hoverLeft <= 0) phase = 'falling';
    return;
  }

  if (player.onGround) {
    // The arrival's own mark on the ground, on top of the dust and thud the
    // audio layer already owes a fall this long.
    spawnBurstParticles(player.pos.x, player.pos.y + 0.1, player.pos.z, SPARK_BLUE, 18, 3.4);
    spawnBurstParticles(player.pos.x, player.pos.y + 1.2, player.pos.z, SPARK_WHITE, 6, 2);
    phase = 'idle';
    return;
  }

  if (sceneSeconds >= SCENE_LIMIT_SECONDS) {
    setDownAtSpawn();
    phase = 'idle';
  }
}

/** Puts the walker back on the footing the scene lifted them from. */
function setDownAtSpawn() {
  player.pos.y = spawnFeetY;
  player.vel.set(0, 0, 0);
  player.onGround = true;
  player.fallPeakY = spawnFeetY;
  resetCameraStep();
  syncCamera();
}
