/*
 * Impact feedback: the break-particle pool everything spawns into, torch
 * embers, explosion flash and camera shake, and the movement-to-sound
 * listener that turns walking into footsteps.
 *
 * The layer asks the view for feet, eye, heading and pause through the
 * setFxView contract, and is handed the walker it listens to; it owns the
 * shake and hands the camera back when the shaking is done.
 */

import * as THREE from 'three';
import {
  blockSoundMaterial, playFootstepSound, playHeartbeatSound, playLandingSound, playSwimSound,
  playWaterEntrySound, setAudioListener, updateAmbient
} from './audio.js';
import { BLOCKS } from './blocks.js';
import { world } from './chunks.js';
import {
  EYE_HEIGHT, TORCH_HEIGHT, WALL_TORCH_FOOT, WALL_TORCH_LEAN, WALL_TORCH_RISE
} from './config.js';
import { camera, scene } from './render.js';

const EMBER_LIMIT = 84;
const EMBER_SPAWN_INTERVAL = 0.11;
const EMBER_RANGE = 20;
/** Where on a torch's stick the flame burns, measured up from its foot. */
const TORCH_FLAME_HEIGHT = 0.78;
const EMBER_HOT = new THREE.Color(0xffb347);
const EMBER_COOL = new THREE.Color(0x7a1d05);

const emberGeometry = new THREE.BoxGeometry(0.055, 0.055, 0.055);
const emberPool = [];
let emberActiveCount = 0;
let emberSpawnTimer = 0.3;

for (let i = 0; i < EMBER_LIMIT; i++) {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    fog: false
  });
  const mesh = new THREE.Mesh(emberGeometry, material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  emberPool.push({
    mesh,
    material,
    active: false,
    life: 0,
    maxLife: 1,
    phase: 0,
    velocity: new THREE.Vector3()
  });
}

function spawnTorchEmber(x, y, z) {
  if (emberActiveCount >= EMBER_LIMIT) return false;
  let ember = null;
  for (const candidate of emberPool) {
    if (!candidate.active) {
      ember = candidate;
      break;
    }
  }
  if (!ember) return false;

  ember.active = true;
  emberActiveCount++;
  ember.life = 0.9 + Math.random() * 1.15;
  ember.maxLife = ember.life;
  ember.phase = Math.random() * Math.PI * 2;
  ember.material.color.copy(EMBER_HOT);
  ember.material.opacity = 0.95;
  ember.velocity.set(
    (Math.random() - 0.5) * 0.16,
    0.26 + Math.random() * 0.32,
    (Math.random() - 0.5) * 0.16
  );
  ember.mesh.position.set(
    x + (Math.random() - 0.5) * 0.16,
    y + (Math.random() - 0.5) * 0.08,
    z + (Math.random() - 0.5) * 0.16
  );
  ember.mesh.scale.setScalar(0.7 + Math.random() * 0.7);
  ember.mesh.visible = true;
  return true;
}

/**
 * Everything this layer may know about the view: where the feet are, where
 * the eye settles between treads, which way the head is turned, whether the
 * game is paused, and the right to hand the camera back when the shaking is
 * done. The page registers these once before the first frame; nothing below
 * reaches up on its own.
 */
let fxView = null;
export function setFxView(view) { fxView = view; }

/** Ambient embers rising from placed torches near the player. */
export function updateTorchEmbers(dt) {
  if (dt <= 0) return;

  emberSpawnTimer -= dt;
  if (emberSpawnTimer <= 0) {
    emberSpawnTimer = EMBER_SPAWN_INTERVAL * (0.7 + Math.random() * 0.7);
    if (emberActiveCount < EMBER_LIMIT && world.torches.size) {
      const candidates = [];
      const listener = fxView.pos();
      for (const key of world.torches) {
        const parts = key.split(',');
        let tx = Number(parts[0]) + 0.5;
        let ty = Number(parts[1]);
        let tz = Number(parts[2]) + 0.5;
        // A wall torch's flame sits where its leaning stick ends, not over
        // the middle of the cell.
        const facing = world.facings.get(key);
        if (facing) {
          const along = WALL_TORCH_FOOT + WALL_TORCH_LEAN * TORCH_FLAME_HEIGHT / TORCH_HEIGHT;
          tx += facing[0] * along;
          tz += facing[1] * along;
          ty += WALL_TORCH_RISE;
        }
        const dx = tx - listener.x;
        const dy = ty - listener.y;
        const dz = tz - listener.z;
        if (dx * dx + dy * dy + dz * dz <= EMBER_RANGE * EMBER_RANGE) {
          candidates.push({ x: tx, y: ty, z: tz });
        }
      }
      if (candidates.length) {
        const torch = candidates[(Math.random() * candidates.length) | 0];
        spawnTorchEmber(torch.x, torch.y + TORCH_FLAME_HEIGHT, torch.z);
      }
    }
  }

  const time = performance.now() * 0.001;
  for (const ember of emberPool) {
    if (!ember.active) continue;
    ember.life -= dt;
    if (ember.life <= 0) {
      ember.active = false;
      emberActiveCount = Math.max(0, emberActiveCount - 1);
      ember.mesh.visible = false;
      continue;
    }

    const progress = 1 - ember.life / ember.maxLife;
    ember.mesh.position.x +=
      (ember.velocity.x + Math.sin(time * 4.2 + ember.phase) * 0.045) * dt;
    ember.mesh.position.y += ember.velocity.y * dt;
    ember.mesh.position.z +=
      (ember.velocity.z + Math.cos(time * 3.7 + ember.phase) * 0.045) * dt;
    ember.velocity.x *= Math.max(0, 1 - dt * 0.5);
    ember.velocity.z *= Math.max(0, 1 - dt * 0.5);
    ember.velocity.y += 0.08 * dt;

    ember.material.color.copy(EMBER_HOT).lerp(EMBER_COOL, progress);
    ember.material.opacity = 0.95 * (1 - progress * progress);
    const flicker = 0.82 + Math.sin(time * 19 + ember.phase) * 0.13;
    ember.mesh.scale.setScalar(flicker * (1 - progress * 0.35));
  }
}

export function emberCount() {
  return emberActiveCount;
}

/** Snapshot of nearby torches and live embers for debug/tests. */
export function torchEmbers() {
  const listener = fxView.pos();
  const torches = [];
  for (const key of world.torches) {
    const parts = key.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (Math.hypot(x + 0.5 - listener.x, y - listener.y, z + 0.5 - listener.z) <= EMBER_RANGE) {
      torches.push([x, y, z]);
    }
  }
  const embers = [];
  for (const ember of emberPool) {
    if (!ember.active) continue;
    embers.push({
      pos: [ember.mesh.position.x, ember.mesh.position.y, ember.mesh.position.z],
      life: ember.life,
      maxLife: ember.maxLife
    });
  }
  embers.count = embers.length;
  embers.torches = torches;
  embers.torchCount = torches.length;
  return embers;
}

/* ---------- Explosion light flash and camera shake ---------- */

const explosionLight = new THREE.PointLight(0xff7a2a, 0, 18, 2);
explosionLight.visible = false;
scene.add(explosionLight);

const EXPLOSION_FLASH_SECONDS = 0.55;
let explosionFlashTimer = 0;
let cameraShake = 0;

export function triggerExplosionPunch(x, y, z) {
  explosionLight.position.set(x, y, z);
  explosionLight.visible = true;
  explosionLight.intensity = 18;
  explosionFlashTimer = EXPLOSION_FLASH_SECONDS;

  const from = fxView.pos();
  const dx = from.x - x;
  const dy = from.y + EYE_HEIGHT - y;
  const dz = from.z - z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 16) {
    cameraShake = Math.max(cameraShake, 0.12 * (1 - distance / 16));
  }
}

export function updateExplosionEffects(dt) {
  if (dt <= 0) return;

  if (explosionFlashTimer > 0) {
    explosionFlashTimer = Math.max(0, explosionFlashTimer - dt);
    const t = explosionFlashTimer / EXPLOSION_FLASH_SECONDS;
    explosionLight.intensity = 18 * t * t;
    if (explosionFlashTimer <= 0) {
      explosionLight.intensity = 0;
      explosionLight.visible = false;
    }
  }

  if (cameraShake > 0) {
    const time = performance.now() * 0.001;
    const amplitude = cameraShake;
    const eye = fxView.eye();
    camera.position.set(
      eye.x + Math.sin(time * 61) * amplitude,
      eye.y + Math.cos(time * 73) * amplitude * 0.6,
      eye.z + Math.sin(time * 53 + 1.7) * amplitude
    );
    cameraShake = Math.max(0, cameraShake - dt * 0.7);
    if (cameraShake <= 0) fxView.restore();
  }
}

export function explosionEffects() {
  return {
    flash: explosionFlashTimer,
    shake: cameraShake,
    lightIntensity: explosionLight.intensity
  };
}

/* ---------- Break particles ---------- */

const breakParticleGeometry = new THREE.BoxGeometry(0.11, 0.11, 0.11);
const breakParticleMaterials = new Map();
const breakParticles = [];

function breakParticleMaterial(color) {
  let material = breakParticleMaterials.get(color);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color });
    breakParticleMaterials.set(color, material);
  }
  return material;
}

export function spawnBlockBreakParticles(x, y, z, blockId) {
  const color = BLOCKS[blockId].particleColor ?? 0x9a9a9a;
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(breakParticleGeometry, breakParticleMaterial(color));
    mesh.position.set(
      x + 0.2 + Math.random() * 0.6,
      y + 0.2 + Math.random() * 0.6,
      z + 0.2 + Math.random() * 0.6
    );
    const life = 0.45 + Math.random() * 0.25;
    mesh.scale.setScalar(0.7 + Math.random() * 0.8);
    scene.add(mesh);
    breakParticles.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 4.2,
        1.6 + Math.random() * 3.2,
        (Math.random() - 0.5) * 4.2
      ),
      life,
      maxLife: life
    });
  }
}

export function updateBreakParticles(dt) {
  for (let i = breakParticles.length - 1; i >= 0; i--) {
    const particle = breakParticles[i];
    particle.life -= dt;
    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      breakParticles.splice(i, 1);
      continue;
    }
    particle.vel.y -= 18 * dt;
    particle.mesh.position.addScaledVector(particle.vel, dt);
    particle.mesh.rotation.x += dt * 7;
    particle.mesh.rotation.z += dt * 5;
    particle.mesh.scale.setScalar(Math.max(0.12, particle.life / particle.maxLife));
  }
}

export function spawnBurstParticles(x, y, z, color, count = 8, spread = 3.2) {
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(breakParticleGeometry, breakParticleMaterial(color));
    mesh.position.set(
      x + (Math.random() - 0.5) * 0.5,
      y + (Math.random() - 0.5) * 0.5,
      z + (Math.random() - 0.5) * 0.5
    );
    const life = 0.4 + Math.random() * 0.35;
    mesh.scale.setScalar(0.55 + Math.random() * 0.9);
    scene.add(mesh);
    breakParticles.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        Math.random() * spread * 0.8,
        (Math.random() - 0.5) * spread
      ),
      life,
      maxLife: life
    });
  }
}

/* ---------- Landing dust and water-entry splashes ---------- */

function spawnLandingPuff(x, y, z, blockId, strength = 1) {
  const color = BLOCKS[blockId]?.particleColor ?? 0xa89880;
  spawnBurstParticles(x, y + 0.06, z, color, Math.min(8, 3 + Math.round(strength * 2)), 1.5);
}

function spawnWaterSplash(x, y, z) {
  spawnBurstParticles(x, y + 0.05, z, 0x9ecbff, 8, 2.2);
  spawnBurstParticles(x, y + 0.1, z, 0x5f9fd8, 4, 1.4);
}

/* What the walking-around audio has to remember between frames: where the
   player was, how far past the next footstep they are, how long since the last
   heartbeat. The engine above this sets up a context, loads a bank and runs
   loops; this is the part that listens to the player, and every line of it is
   read and written by the one function below. */
let audioPositionInitialized = false;
const audioLastPosition = new THREE.Vector3();
let audioStepAccumulator = 0;
let audioSwimAccumulator = 0;
let audioAirPeakY = 0;
let audioPrevVelocityY = 0;
let audioLastOnGround = true;
let audioLastInWater = false;
let audioHeartbeatTimer = 0;

/** Track footstep cadence, landings, water entry, swimming and the heartbeat. */
export function updateAudio(dt, player) {
  if (dt <= 0) return;

  setAudioListener({
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z,
    yaw: fxView.yaw(),
    headInWater: player.headInWater,
    dead: player.dead,
    paused: fxView.paused()
  });

  updateAmbient(dt);

  const moved = Math.hypot(
    player.pos.x - audioLastPosition.x,
    player.pos.z - audioLastPosition.z
  );

  if (!audioPositionInitialized || moved > 5) {
    audioPositionInitialized = true;
    audioStepAccumulator = 0;
    audioLastPosition.copy(player.pos);
    audioAirPeakY = player.pos.y;
    audioPrevVelocityY = player.vel.y;
    audioLastOnGround = player.onGround;
    audioLastInWater = player.inWater;
    return;
  }

  if (player.inWater) {
    audioStepAccumulator = 0;
    // A swim stroke is driven by distance through the water, including the
    // vertical kick, so treading water is quiet but a crossing is not.
    audioSwimAccumulator += moved + Math.abs(player.vel.y) * dt;
    const swimThreshold = player.sprinting ? 0.85 : 1.15;
    if (audioSwimAccumulator >= swimThreshold) {
      audioSwimAccumulator = 0;
      playSwimSound(player.pos.x, player.pos.y, player.pos.z);
    }
  } else if (player.onGround && moved > 0.0001) {
    audioSwimAccumulator = 0;
    audioStepAccumulator += moved;
    const threshold = player.sprinting ? 1.65 : 2.2;
    while (audioStepAccumulator >= threshold) {
      audioStepAccumulator -= threshold;
      const groundId = world.getBlock(
        Math.floor(player.pos.x),
        Math.floor(player.pos.y - 0.05),
        Math.floor(player.pos.z)
      );
      if (BLOCKS[groundId].solid) {
        playFootstepSound(
          blockSoundMaterial(groundId),
          player.pos.x,
          player.pos.y,
          player.pos.z,
          player.sprinting
        );
      }
    }
  } else {
    audioStepAccumulator = 0;
    audioSwimAccumulator = 0;
  }

  if (!player.onGround && !player.inWater) {
    audioAirPeakY = Math.max(audioAirPeakY, player.pos.y);
  }

  if (player.onGround && !audioLastOnGround && !player.inWater) {
    const fallDistance = audioAirPeakY - player.pos.y;
    if (fallDistance > 1.2) {
      const groundId = world.getBlock(
        Math.floor(player.pos.x),
        Math.floor(player.pos.y - 0.05),
        Math.floor(player.pos.z)
      );
      spawnLandingPuff(player.pos.x, player.pos.y, player.pos.z, groundId, fallDistance);
      playLandingSound(
        groundId, player.pos.x, player.pos.y, player.pos.z, fallDistance
      );
    }
    audioAirPeakY = player.pos.y;
  }

  if (player.inWater && !audioLastInWater && audioPrevVelocityY < -1.2) {
    spawnWaterSplash(player.pos.x, player.pos.y, player.pos.z);
    playWaterEntrySound(player.pos.x, player.pos.y, player.pos.z);
  }

  // A quiet heartbeat is the only warning an empty health bar gives.
  if (!player.dead && player.health <= 6 && !fxView.paused()) {
    audioHeartbeatTimer -= dt;
    if (audioHeartbeatTimer <= 0) {
      audioHeartbeatTimer = player.health <= 3 ? 0.72 : 1.15;
      playHeartbeatSound();
    }
  } else if (player.health > 6) {
    audioHeartbeatTimer = 0;
  }

  if (player.onGround || player.inWater) audioAirPeakY = player.pos.y;
  audioPrevVelocityY = player.vel.y;
  audioLastOnGround = player.onGround;
  audioLastInWater = player.inWater;
  audioLastPosition.copy(player.pos);
}
