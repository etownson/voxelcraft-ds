/*
 * The mobs: what walks the landscape, what it wants, and what it does about
 * it. One performance budget split between animals and hostiles, spawn ground
 * chosen around the walker, the models that are assembled from boxes, and the
 * small talk a herd makes when nobody is watching.
 *
 * It paths and lands by the same collision kernel the player obeys, and it
 * never sees the game: the walker it hunts and the hurt, drop and spill it
 * causes are handed over once, through setMobWorld.
 */

import * as THREE from 'three';
import {
  playAnimalSound, playCreeperHiss, playExplosionSound, playMobHurtSound, playZombieGroan
} from './audio.js';
import { BLOCKS, isWater } from './blocks.js';
import { onChunkMeshed, world } from './chunks.js';
import { cellCollidesAt, isSolid, submergedAt } from './collision.js';
import {
  B, CHUNK_SIZE, COLLISION_EPSILON, DIFFICULTY_DAMAGE_SCALE, DIFFICULTY_ESSENCE_SCALE,
  DIFFICULTY_HEALTH_SCALE, DIFFICULTY_SPAWN_SCALE, EYE_HEIGHT, GRAVITY, MAX_MOVE_STEP,
  TERMINAL_VELOCITY, chunkKey, clamp
} from './config.js';
import { difficultyAt } from './beacons.js';
import { spawnBurstParticles, triggerExplosionPunch } from './fx.js';
import { createCanvas } from './icons.js';
import { chunkRandom, hashString, mulberry32 } from './noise.js';
import { scene } from './render.js';
import { daylight, isNight } from './sky.js';
import { sampleColumn } from './worldgen.js';

/**
 * The world the mob layer is allowed to know about: the walker it hunts,
 * frightens and knocks around, and the ways it leaves a mark on everything
 * else — hurt someone, drop something, spill what a broken container held,
 * and pay essence for a killed enemy. The page hands those over where the
 * walker exists, and nothing in the section reaches past these names.
 */
let mobWalker = null;
let hurtWalker = null;
let mobDrop = null;
let dropEssence = null;
let spillContents = null;
export function setMobWorld(host) {
  mobWalker = host.walker;
  hurtWalker = host.hurt;
  mobDrop = host.drop;
  dropEssence = host.dropEssence;
  spillContents = host.spill;
}

/**
 * The two groups share one performance budget but each has a cap of its own, and
 * the two caps are sized so they can never add up to more than the total.
 * They used to overlap — 20 animals plus 13 hostiles against a total of 30 —
 * which put the groups in direct competition for the last few slots: a
 * comfortable herd of animals left room for only 9 zombies, and the total sat
 * at 29 of 30 with nowhere to put anything. Splitting the budget means a full
 * herd can no longer decide how dangerous the night is.
 */
export const MOB_CAP = 32;
/**
 * Animals are deliberately scarce. Steak is the best food in the game — worth
 * nearly twice a loaf of bread — and a landscape that refills itself with cows
 * makes farming optional forever. A herd this thin, arriving this rarely,
 * cannot keep a busy player in meat, so wheat becomes the meal they plan the
 * day around. See the animal scarcity addendum in the design document.
 */
export const PASSIVE_CAP = 10;
export const HOSTILE_CAP = 16;
const MOB_SALT = 0x4D0B5A17;
/**
 * A chunk only earns its herd roll while the player is this close, which is
 * well inside render distance: chunks are meshed about 136 blocks out, long
 * before anyone is around to see animals arrive.
 */
export const PASSIVE_SPAWN_RADIUS = 76;
/** Never roll a herd under the player's own feet; save it for a chunk ahead. */
const PASSIVE_SPAWN_MIN_RADIUS = 20;
/**
 * Seconds between sweeps for unspent herd rolls. A hunted valley refills at a
 * walk, not a run: over an entire session, seeing an animal should be an
 * event, not scenery.
 */
const PASSIVE_SPAWN_INTERVAL = 5;
/**
 * Hostiles spawn in a band rather than anywhere nearby: close enough to reach
 * the player in seconds, far enough that they arrive out of the dark instead of
 * popping into existence inside a zombie's 26-block detection range and
 * beelining. The old band started at 17, which put most of them instantly on the
 * player.
 */
export const MOB_SPAWN_MIN_RADIUS = 20;
export const MOB_SPAWN_MAX_RADIUS = 48;
/** Columns a single hostile spawn pass is willing to probe. */
const MOB_SPAWN_ATTEMPTS = 8;
/** Hostiles one night pass may place, so dusk arrives rather than trickles. */
const MOB_SPAWN_BATCH = 3;
/** Past this three-dimensional distance any mob is removed outright. */
const MOB_DESPAWN_DISTANCE = 96;
/**
 * Within that, an idle hostile this far out is given a chance to give up and
 * vanish. Hostiles that settled into a cave under the player's base used to hold
 * every slot in HOSTILE_CAP forever: sheltered mobs are exempt from burning, and
 * the despawn test only looked at horizontal distance, so a zombie sixty blocks
 * straight down read as "next to the player" and stayed for the whole session,
 * leaving night with nothing left to spawn. Anything actually chasing the player
 * is inside its detection range, well within this distance, so a chase is never
 * interrupted.
 */
const MOB_DESPAWN_CHANCE_DISTANCE = 32;
const MOB_DESPAWN_ROLL_INTERVAL = 5;
const MOB_DESPAWN_CHANCE = 0.25;
/**
 * Why hostile spawns are being refused, counted per attempt so the balance can be
 * measured instead of guessed at. A rising `hostile_cap` while nothing is
 * visible on screen means the budget is full of mobs the player cannot see.
 */
export const hostileSpawnTally = {
  attempts: 0,
  spawned: 0,
  hostile_cap: 0,
  no_chunk: 0,
  terrain: 0,
  light: 0
};

export function zeroSpawnTally() {
  for (const key of Object.keys(hostileSpawnTally)) hostileSpawnTally[key] = 0;
}

export const mobs = [];
let mobSerial = 0;
let hostileSpawnTimer = 2.5;
let passiveSpawnTimer = 1.2;

/**
 * Passive animals are background texture, not a chorus. Their own timer is long,
 * and one shared gap keeps a herd from firing its random calls in the same few
 * seconds.
 */
const ANIMAL_SOUND_MIN = 15;
const ANIMAL_SOUND_MAX = 35;
const ANIMAL_SOUND_GAP_MIN = 4;
const ANIMAL_SOUND_GAP_MAX = 8;
let animalSoundCooldown = 0;

/**
 * Hostiles need to be heard — a groan out of the dark is the warning — but they
 * used to be heard constantly. Each one rolled a fresh 4.5–11 s, and unlike the
 * animals there was no shared gap, so the calls simply added up: three zombies in
 * range meant a 1.2-second groan every 2.6 s on average, and a night crowd near
 * the hostile cap groaned about twice a second. The per-mob roll is longer now
 * and a shared gap follows the animal rule, so the pack has one voice at a time
 * however many are awake.
 */
const HOSTILE_SOUND_MIN = 11;
const HOSTILE_SOUND_MAX = 24;
const HOSTILE_SOUND_GAP_MIN = 6;
const HOSTILE_SOUND_GAP_MAX = 11;
let hostileSoundCooldown = 0;

const MOB_DEFS = {
  cow: {
    hostile: false, health: 10, speed: 1.15, width: 0.82, height: 1.42,
    drops: [{ id: 'raw_beef', min: 1, max: 2 }, { id: 'leather', min: 0, max: 2 }]
  },
  pig: {
    hostile: false, health: 10, speed: 1.25, width: 0.78, height: 1.18,
    drops: [{ id: 'raw_beef', min: 1, max: 2 }]
  },
  sheep: {
    hostile: false, health: 8, speed: 1.2, width: 0.86, height: 1.34,
    drops: [{ id: 'raw_beef', min: 1, max: 2 }, { id: 'wool', min: 1, max: 1 }]
  },
  chicken: {
    hostile: false, health: 4, speed: 1.5, width: 0.46, height: 0.82,
    drops: [{ id: 'feather', min: 1, max: 2 }]
  },
  zombie: {
    hostile: true, health: 20, speed: 1.85, width: 0.62, height: 1.94,
    detection: 26, damage: 3, reach: 1.12, attackInterval: 1.0,
    essence: { min: 3, max: 5 },
    drops: []
  },
  creeper: {
    hostile: true, health: 20, speed: 1.65, width: 0.62, height: 1.66,
    detection: 24,
    // The creeper's "attack" is the explosion at the end of its fuse: the
    // 14 is full strength at point blank, and the falloff rides beside it.
    damage: 14, essence: { min: 3, max: 5 },
    drops: []
  }
};

const mobTextureCache = new Map();

function mobTexture(key, painter) {
  let texture = mobTextureCache.get(key);
  if (texture) return texture;

  const canvas = createCanvas(16);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const rand = mulberry32(hashString('voxelcraft:mob:' + key));

  const px = (x, y, color, w = 1, h = 1) => {
    ctx.fillStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
    ctx.fillRect(x | 0, y | 0, w, h);
  };
  const vary = (color, amount) => {
    const d = (rand() * 2 - 1) * amount;
    return [
      clamp(Math.round(color[0] + d), 0, 255),
      clamp(Math.round(color[1] + d), 0, 255),
      clamp(Math.round(color[2] + d), 0, 255)
    ];
  };
  const fill = (color, amount) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) px(x, y, vary(color, amount));
    }
  };

  painter({ px, rand, vary, fill });

  texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  mobTextureCache.set(key, texture);
  return texture;
}

const MOB_TEXTURES = {
  cow_hide: mobTexture('cow_hide', ({ px, rand, vary, fill }) => {
    fill([232, 231, 224], 7);
    for (let i = 0; i < 8; i++) {
      const x = (rand() * 12) | 0;
      const y = (rand() * 12) | 0;
      const w = 2 + ((rand() * 4) | 0);
      const h = 2 + ((rand() * 4) | 0);
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          if (rand() < 0.82) px(x + xx, y + yy, vary([40, 38, 36], 8));
        }
      }
    }
  }),
  cow_face: mobTexture('cow_face', ({ px, rand, vary, fill }) => {
    fill([236, 233, 224], 6);
    px(4, 5, [28, 24, 22], 2, 2);
    px(10, 5, [28, 24, 22], 2, 2);
    px(5, 6, [230, 230, 230]);
    px(11, 6, [230, 230, 230]);
    for (let x = 4; x < 12; x++) {
      px(x, 10, vary([204, 159, 137], 9));
      px(x, 11, vary([214, 169, 147], 9));
    }
    px(6, 11, [110, 82, 74]);
    px(9, 11, [110, 82, 74]);
    px(2, 2, vary([60, 52, 48], 8), 2, 2);
    px(12, 2, vary([60, 52, 48], 8), 2, 2);
  }),
  pig_skin: mobTexture('pig_skin', ({ px, rand, vary, fill }) => {
    fill([236, 156, 160], 8);
    for (let i = 0; i < 16; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([216, 128, 136], 8));
    }
  }),
  pig_face: mobTexture('pig_face', ({ px, rand, vary, fill }) => {
    fill([238, 159, 163], 7);
    px(4, 5, [32, 26, 28], 2, 2);
    px(10, 5, [32, 26, 28], 2, 2);
    px(3, 9, vary([206, 121, 128], 6), 10, 4);
    px(5, 10, [110, 61, 66], 2, 2);
    px(9, 10, [110, 61, 66], 2, 2);
  }),
  sheep_wool: mobTexture('sheep_wool', ({ px, rand, vary, fill }) => {
    fill([226, 224, 214], 12);
    for (let i = 0; i < 26; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([205, 202, 190], 11));
    }
  }),
  sheep_face: mobTexture('sheep_face', ({ px, rand, vary, fill }) => {
    fill([206, 178, 154], 8);
    px(4, 5, [30, 26, 24], 2, 2);
    px(10, 5, [30, 26, 24], 2, 2);
    px(6, 9, [126, 92, 76], 4, 2);
    px(7, 10, vary([150, 112, 94], 7), 2, 2);
  }),
  sheep_skin: mobTexture('sheep_skin', ({ px, rand, vary, fill }) => {
    // A shorn sheep: pinkish skin where the fleece used to be.
    fill([228, 184, 180], 8);
    for (let i = 0; i < 14; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([208, 160, 158], 7));
    }
  }),
  chicken_skin: mobTexture('chicken_skin', ({ px, rand, vary, fill }) => {
    fill([244, 242, 235], 7);
    for (let i = 0; i < 12; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([218, 214, 204], 7));
    }
  }),
  chicken_face: mobTexture('chicken_face', ({ px, rand, vary, fill }) => {
    fill([247, 245, 239], 6);
    px(4, 5, [30, 26, 24], 2, 2);
    px(10, 5, [30, 26, 24], 2, 2);
    px(7, 8, [232, 162, 54], 2, 3);
    px(2, 1, [206, 52, 48], 3, 2);
    px(11, 1, [206, 52, 48], 3, 2);
  }),
  zombie_skin: mobTexture('zombie_skin', ({ px, rand, vary, fill }) => {
    fill([110, 148, 86], 9);
    for (let i = 0; i < 18; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([92, 128, 72], 8));
    }
  }),
  zombie_face: mobTexture('zombie_face', ({ px, rand, vary, fill }) => {
    fill([108, 146, 84], 8);
    px(3, 5, [22, 34, 22], 3, 2);
    px(10, 5, [22, 34, 22], 3, 2);
    px(6, 10, [38, 52, 36], 5, 2);
    px(7, 12, [38, 52, 36], 3, 1);
  }),
  zombie_shirt: mobTexture('zombie_shirt', ({ px, rand, vary, fill }) => {
    fill([52, 106, 108], 8);
    for (let i = 0; i < 14; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([38, 84, 88], 7));
    }
  }),
  zombie_pants: mobTexture('zombie_pants', ({ px, rand, vary, fill }) => {
    fill([54, 62, 112], 8);
    for (let i = 0; i < 12; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([42, 48, 90], 7));
    }
  }),
  creeper_skin: mobTexture('creeper_skin', ({ px, rand, vary, fill }) => {
    fill([96, 154, 62], 10);
    for (let i = 0; i < 22; i++) {
      const x = (rand() * 14) | 0;
      const y = (rand() * 14) | 0;
      const color = rand() < 0.5 ? [66, 120, 44] : [124, 184, 82];
      px(x, y, vary(color, 8));
      if (rand() < 0.5) px(x + 1, y, vary(color, 8));
      if (rand() < 0.35) px(x, y + 1, vary(color, 8));
    }
  }),
  creeper_face: mobTexture('creeper_face', ({ px, rand, vary, fill }) => {
    fill([94, 152, 60], 9);
    px(3, 4, [18, 28, 16], 4, 4);
    px(9, 4, [18, 28, 16], 4, 4);
    px(6, 8, [18, 28, 16], 4, 3);
    px(5, 11, [18, 28, 16], 2, 4);
    px(9, 11, [18, 28, 16], 2, 4);
    px(6, 9, [30, 42, 26], 4, 2);
  })
};

const mobBaseMaterialCache = new Map();

function mobBaseMaterial(textureKey) {
  let material = mobBaseMaterialCache.get(textureKey);
  if (!material) {
    material = new THREE.MeshLambertMaterial({ map: MOB_TEXTURES[textureKey] });
    mobBaseMaterialCache.set(textureKey, material);
  }
  return material;
}

function mobMaterial(textureKey) {
  return mobBaseMaterial(textureKey).clone();
}

function mobHeadMaterials(skinKey, faceKey) {
  const skin = mobMaterial(skinKey);
  const face = mobMaterial(faceKey);
  return [skin, skin.clone(), skin.clone(), skin.clone(), face, skin.clone()];
}

const mobBoxGeometries = new Map();

function mobBoxGeometry(w, h, d) {
  const key = w + 'x' + h + 'x' + d;
  let geometry = mobBoxGeometries.get(key);
  if (!geometry) {
    geometry = new THREE.BoxGeometry(w, h, d);
    mobBoxGeometries.set(key, geometry);
  }
  return geometry;
}

function mobBox(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(mobBoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function mobLeg(w, h, d, material, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const mesh = new THREE.Mesh(mobBoxGeometry(w, h, d), material);
  mesh.position.y = -h / 2;
  pivot.add(mesh);
  return pivot;
}

export function createMobModel(type, sheared = false) {
  const group = new THREE.Group();
  let legs = [];
  let head = null;
  let extraMeshes = [];

  if (type === 'cow') {
    const hide = mobMaterial('cow_hide');
    group.add(mobBox(0.82, 0.68, 1.24, hide, 0, 0.9, 0));
    head = mobBox(0.52, 0.52, 0.52, mobHeadMaterials('cow_hide', 'cow_face'), 0, 1.12, 0.84);
    group.add(head);
    group.add(mobBox(0.34, 0.2, 0.16, mobMaterial('cow_face'), 0, 1.02, 1.1));
    legs = [
      mobLeg(0.2, 0.56, 0.2, hide, -0.27, 0.56, -0.4),
      mobLeg(0.2, 0.56, 0.2, hide, 0.27, 0.56, -0.4),
      mobLeg(0.2, 0.56, 0.2, hide, -0.27, 0.56, 0.4),
      mobLeg(0.2, 0.56, 0.2, hide, 0.27, 0.56, 0.4)
    ];
  } else if (type === 'pig') {
    const skin = mobMaterial('pig_skin');
    group.add(mobBox(0.76, 0.54, 1.02, skin, 0, 0.66, 0));
    head = mobBox(0.48, 0.48, 0.48, mobHeadMaterials('pig_skin', 'pig_face'), 0, 0.86, 0.64);
    group.add(head);
    group.add(mobBox(0.2, 0.16, 0.16, mobMaterial('pig_face'), 0, 0.79, 0.93));
    legs = [
      mobLeg(0.19, 0.4, 0.19, skin, -0.25, 0.4, -0.32),
      mobLeg(0.19, 0.4, 0.19, skin, 0.25, 0.4, -0.32),
      mobLeg(0.19, 0.4, 0.19, skin, -0.25, 0.4, 0.32),
      mobLeg(0.19, 0.4, 0.19, skin, 0.25, 0.4, 0.32)
    ];
  } else if (type === 'sheep') {
    if (sheared) {
      // Shorn: fleece gone, the pink skin shows, and the outline slims down
      // by the depth of all that wool.
      const skin = mobMaterial('sheep_skin');
      group.add(mobBox(0.66, 0.52, 0.94, skin, 0, 0.76, 0));
      head = mobBox(0.4, 0.4, 0.42, mobHeadMaterials('sheep_skin', 'sheep_face'), 0, 1.0, 0.6);
      group.add(head);
      legs = [
        mobLeg(0.16, 0.5, 0.16, skin, -0.2, 0.5, -0.3),
        mobLeg(0.16, 0.5, 0.16, skin, 0.2, 0.5, -0.3),
        mobLeg(0.16, 0.5, 0.16, skin, -0.2, 0.5, 0.3),
        mobLeg(0.16, 0.5, 0.16, skin, 0.2, 0.5, 0.3)
      ];
    } else {
      const wool = mobMaterial('sheep_wool');
      group.add(mobBox(0.86, 0.74, 1.16, wool, 0, 0.88, 0));
      group.add(mobBox(0.7, 0.18, 0.94, wool, 0, 1.29, -0.03));
      head = mobBox(0.44, 0.44, 0.46, mobHeadMaterials('sheep_wool', 'sheep_face'), 0, 1.08, 0.64);
      group.add(head);
      legs = [
        mobLeg(0.18, 0.5, 0.18, wool, -0.26, 0.5, -0.36),
        mobLeg(0.18, 0.5, 0.18, wool, 0.26, 0.5, -0.36),
        mobLeg(0.18, 0.5, 0.18, wool, -0.26, 0.5, 0.36),
        mobLeg(0.18, 0.5, 0.18, wool, 0.26, 0.5, 0.36)
      ];
    }
  } else if (type === 'chicken') {
    const skin = mobMaterial('chicken_skin');
    group.add(mobBox(0.44, 0.44, 0.58, skin, 0, 0.48, 0));
    head = mobBox(0.3, 0.32, 0.32, mobHeadMaterials('chicken_skin', 'chicken_face'), 0, 0.83, 0.26);
    group.add(head);
    group.add(mobBox(0.14, 0.1, 0.18, mobMaterial('chicken_face'), 0, 0.78, 0.48));
    group.add(mobBox(0.1, 0.12, 0.16, new THREE.MeshLambertMaterial({ color: 0xd2443c }), 0, 1.02, 0.24));
    group.add(mobBox(0.06, 0.34, 0.4, skin, -0.25, 0.48, -0.02));
    group.add(mobBox(0.06, 0.34, 0.4, skin, 0.25, 0.48, -0.02));
    legs = [
      mobLeg(0.08, 0.26, 0.08, mobMaterial('chicken_face'), -0.12, 0.26, 0.04),
      mobLeg(0.08, 0.26, 0.08, mobMaterial('chicken_face'), 0.12, 0.26, 0.04)
    ];
  } else if (type === 'zombie') {
    const skin = mobMaterial('zombie_skin');
    const shirt = mobMaterial('zombie_shirt');
    const pants = mobMaterial('zombie_pants');
    group.add(mobBox(0.5, 0.7, 0.28, shirt, 0, 1.1, 0));
    head = mobBox(0.5, 0.5, 0.5, mobHeadMaterials('zombie_skin', 'zombie_face'), 0, 1.72, 0);
    group.add(head);
    const armLeft = mobLeg(0.16, 0.68, 0.16, skin, -0.34, 1.42, 0.12);
    const armRight = mobLeg(0.16, 0.68, 0.16, skin, 0.34, 1.42, 0.12);
    armLeft.rotation.x = -1.28;
    armRight.rotation.x = -1.28;
    group.add(armLeft, armRight);
    legs = [
      mobLeg(0.18, 0.72, 0.18, pants, -0.13, 0.72, 0),
      mobLeg(0.18, 0.72, 0.18, pants, 0.13, 0.72, 0)
    ];
  } else if (type === 'creeper') {
    const skin = mobMaterial('creeper_skin');
    group.add(mobBox(0.48, 0.8, 0.3, skin, 0, 0.76, 0));
    head = mobBox(0.5, 0.5, 0.5, mobHeadMaterials('creeper_skin', 'creeper_face'), 0, 1.4, 0.03);
    group.add(head);
    legs = [
      mobLeg(0.18, 0.36, 0.18, skin, -0.14, 0.36, -0.16),
      mobLeg(0.18, 0.36, 0.18, skin, 0.14, 0.36, -0.16),
      mobLeg(0.18, 0.36, 0.18, skin, -0.14, 0.36, 0.16),
      mobLeg(0.18, 0.36, 0.18, skin, 0.14, 0.36, 0.16)
    ];
  }

  for (const leg of legs) group.add(leg);

  const materials = new Set();
  group.traverse((object) => {
    if (!object.isMesh) return;
    const material = object.material;
    if (Array.isArray(material)) {
      for (const entry of material) materials.add(entry);
    } else {
      materials.add(material);
    }
  });

  return {
    group,
    legs,
    head,
    headBaseY: head ? head.position.y : 0,
    materials: [...materials],
    extraMeshes
  };
}

export function spawnMob(type, x, y, z, options = {}) {
  const def = MOB_DEFS[type];
  if (!def || mobs.length >= MOB_CAP) return null;

  // Difficulty is read off the ground the mob arrives on, not the ground it
  // wanders to: the X and Z distance from SP0 and the depth below sea level
  // decide how tough this one is, and they decide it for keeps. A creeper
  // bred at the far edge of the world stays mean when it calls on SP0.
  const difficulty = difficultyAt(x, y, z);
  const health = Math.max(1, Math.round(def.health * (1 + DIFFICULTY_HEALTH_SCALE * difficulty)));
  const attack = def.damage == null
    ? null
    : def.damage * (1 + DIFFICULTY_DAMAGE_SCALE * difficulty);

  const model = createMobModel(type, !!options.sheared);
  const mob = {
    serial: mobSerial++,
    type,
    def,
    difficulty,
    attack,
    sheared: !!options.sheared,
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(),
    yaw: options.yaw ?? Math.random() * Math.PI * 2,
    onGround: false,
    inWater: false,
    health,
    maxHealth: health,
    hurtFlash: 0,
    walkPhase: Math.random() * Math.PI * 2,
    state: 'idle',
    stateTimer: 0.6 + Math.random() * 2.4,
    target: new THREE.Vector3(x, y, z),
    fleeTimer: 0,
    fuse: -1,
    attackCooldown: 0,
    burnTimer: 0,
    audioCooldown: 0,
    soundTimer: def.hostile
      ? 3 + Math.random() * 7
      : ANIMAL_SOUND_MIN + Math.random() * (ANIMAL_SOUND_MAX - ANIMAL_SOUND_MIN),
    // Staggered so a fresh herd does not take all its despawn rolls on the
    // same frame.
    despawnTimer: MOB_DESPAWN_ROLL_INTERVAL * (0.6 + Math.random()),
    dead: false,
    spawnChunk: options.spawnChunk ?? chunkKey(
      Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)
    ),
    group: model.group,
    legs: model.legs,
    head: model.head,
    headBaseY: model.headBaseY,
    materials: model.materials
  };

  mob.group.position.copy(mob.pos);
  mob.group.rotation.y = mob.yaw;
  scene.add(mob.group);
  mobs.push(mob);
  return mob;
}

function removeMob(mob, index = mobs.indexOf(mob)) {
  if (index < 0) return;
  scene.remove(mob.group);
  for (const material of mob.materials) material.dispose();
  mobs.splice(index, 1);
}

function dropMobLoot(mob) {
  for (const drop of mob.def.drops || []) {
    // A shorn sheep has nothing left to give but its meat.
    if (mob.sheared && drop.id === 'wool') continue;
    const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
    // A hide roll can come up empty, which is how Minecraft spreads out loot.
    if (count <= 0) continue;
    mobDrop(
      drop.id, count,
      mob.pos.x, mob.pos.y + mob.def.height * 0.45, mob.pos.z
    );
  }
}

function dropMobEssence(mob) {
  // Essence is what enemies pay, and only enemies: a herd is food, not fuel.
  // The yield scales with the difficulty of the ground the mob came from, the
  // way its health and bite do: what is hard to kill is worth more to light.
  const yieldToTake = mob.def.essence;
  if (!mob.def.hostile || !dropEssence || !yieldToTake) return;
  const base = yieldToTake.min +
    Math.floor(Math.random() * (yieldToTake.max - yieldToTake.min + 1));
  const amount = Math.round(base * (1 + DIFFICULTY_ESSENCE_SCALE * mob.difficulty));
  if (amount <= 0) return;
  dropEssence(amount, mob.pos.x, mob.pos.y + mob.def.height * 0.4, mob.pos.z);
}

function killMob(mob) {
  if (!mob || mob.dead) return;
  mob.dead = true;
  spawnBurstParticles(
    mob.pos.x, mob.pos.y + mob.def.height * 0.5, mob.pos.z,
    0xb04a4a, 14, 4.4
  );
  dropMobLoot(mob);
  dropMobEssence(mob);
}

export function damageMob(mob, amount, knockX = 0, knockZ = 0, options = {}) {
  if (!mob || mob.dead) return false;
  mob.health -= amount;
  mob.hurtFlash = 0.22;
  spawnBurstParticles(
    mob.pos.x, mob.pos.y + mob.def.height * 0.62, mob.pos.z,
    0xc84242, 6, 2.6
  );
  if (mob.audioCooldown <= 0) {
    // Sunlight burns a hostile in ticks a little over half a second apart, and
    // a hurt call on every one of them turns a burning zombie into a siren. A
    // hit asks for the usual gap; fire asks for a long one.
    mob.audioCooldown = options.soundGap ?? 0.55;
    playMobHurtSound(mob.type, mob.pos.x, mob.pos.y + mob.def.height * 0.6, mob.pos.z);
  }

  if (knockX || knockZ) {
    mob.vel.x += knockX;
    mob.vel.z += knockZ;
    mob.vel.y = Math.max(mob.vel.y, 2.7);
    mob.onGround = false;
  }

  if (mob.def.hostile) {
    mob.fleeTimer = 0;
  } else {
    mob.fleeTimer = 3.5;
  }

  if (mob.health <= 0) {
    killMob(mob);
    return true;
  }
  return false;
}

function mobCollidesAt(mob, x, y, z) {
  const half = mob.def.width / 2;
  const boxMinX = x - half + COLLISION_EPSILON;
  const boxMaxX = x + half - COLLISION_EPSILON;
  const boxMinY = y + COLLISION_EPSILON;
  const boxMaxY = y + mob.def.height - COLLISION_EPSILON;
  const boxMinZ = z - half + COLLISION_EPSILON;
  const boxMaxZ = z + half - COLLISION_EPSILON;
  const minX = Math.floor(boxMinX);
  const maxX = Math.floor(boxMaxX);
  const minY = Math.floor(boxMinY);
  const maxY = Math.floor(boxMaxY);
  const minZ = Math.floor(boxMinZ);
  const maxZ = Math.floor(boxMaxZ);

  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        if (cellCollidesAt(bx, by, bz, boxMinX, boxMaxX, boxMinY, boxMaxY, boxMinZ, boxMaxZ)) {
          return true;
        }
      }
    }
  }
  return false;
}

function moveMobAxis(mob, axis, delta) {
  if (delta === 0) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_MOVE_STEP));
  const step = delta / steps;

  for (let i = 0; i < steps; i++) {
    const start = mob.pos[axis];
    mob.pos[axis] = start + step;
    if (!mobCollidesAt(mob, mob.pos.x, mob.pos.y, mob.pos.z)) continue;

    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) * 0.5;
      mob.pos[axis] = start + step * mid;
      if (mobCollidesAt(mob, mob.pos.x, mob.pos.y, mob.pos.z)) hi = mid;
      else lo = mid;
    }
    mob.pos[axis] = start + step * lo;
    return true;
  }
  return false;
}

/** Move horizontally, hopping up a single block when the path is blocked. */
function moveMobHorizontal(mob, dx, dz) {
  const startX = mob.pos.x;
  const startY = mob.pos.y;
  const startZ = mob.pos.z;
  const hitX = moveMobAxis(mob, 'x', dx);
  const hitZ = moveMobAxis(mob, 'z', dz);

  if (!hitX && !hitZ) return false;

  if (mob.onGround && !mobCollidesAt(mob, startX, startY + 1.02, startZ)) {
    mob.pos.set(startX, startY + 1.02, startZ);
    const stepHitX = moveMobAxis(mob, 'x', dx);
    const stepHitZ = moveMobAxis(mob, 'z', dz);
    if (!stepHitX && !stepHitZ) {
      mob.vel.y = 0;
      return false;
    }
  }

  mob.pos.set(startX, startY, startZ);
  return true;
}

function mobLookToward(mob, dirX, dirZ, dt, speed = 8) {
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-5) return;
  const targetYaw = Math.atan2(dirX, dirZ);
  let delta = targetYaw - mob.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  mob.yaw += delta * (1 - Math.exp(-speed * dt));
}

function steerMob(mob, dirX, dirZ, speed, dt) {
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-5) {
    mob.vel.x *= Math.exp(-8 * dt);
    mob.vel.z *= Math.exp(-8 * dt);
    return;
  }
  dirX /= length;
  dirZ /= length;
  mobLookToward(mob, dirX, dirZ, dt);
  const blend = 1 - Math.exp(-9 * dt);
  mob.vel.x += (dirX * speed - mob.vel.x) * blend;
  mob.vel.z += (dirZ * speed - mob.vel.z) * blend;
}

function pickWanderTarget(mob) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 3 + Math.random() * 6;
  mob.target.set(
    mob.pos.x + Math.cos(angle) * radius,
    mob.pos.y,
    mob.pos.z + Math.sin(angle) * radius
  );
}

/**
 * A short sight probe from the top of a creeper's head to the player's eyes.
 * Ignition used to be a horizontal ring plus a feet-to-feet window, and both
 * halves read wrong: it fired through walls the creeper had never seen past,
 * and it never fired at all once the feet sat more than two blocks apart, so
 * a creeper pressed against the foot of a ledge you stood on just stood there
 * and waved. Now it lights when its real three-dimensional reach is clear,
 * and the reach is what it measures. Leaves and water do not break the line;
 * a closed door or a wall does, so shelter now means what it looks like.
 */
function creeperSeesPlayer(mob) {
  const fromX = mob.pos.x;
  const fromY = mob.pos.y + mob.def.height * 0.8;
  const fromZ = mob.pos.z;
  const toX = mobWalker().pos.x;
  const toY = mobWalker().pos.y + EYE_HEIGHT;
  const toZ = mobWalker().pos.z;
  const length = Math.hypot(toX - fromX, toY - fromY, toZ - fromZ);
  const steps = Math.max(2, Math.ceil(length / 0.35));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const id = world.getBlock(
      Math.floor(fromX + (toX - fromX) * t),
      Math.floor(fromY + (toY - fromY) * t),
      Math.floor(fromZ + (toZ - fromZ) * t)
    );
    if (id === B.AIR || isWater(id) || id === B.LEAVES) continue;
    const block = BLOCKS[id];
    if (block && block.solid) return false;
  }
  return true;
}

function explodeCreeper(mob) {
  const cx = mob.pos.x;
  const cy = mob.pos.y + 0.75;
  const cz = mob.pos.z;
  // A crater just over two blocks deep. The old 3.2 bit out nearly a stack of
  // barrels of terrain at once; this still takes the ground out from under the
  // player and opens a visible scar, but a house or a mine entrance can now
  // survive standing next to one.
  const radius = 2.2;
  const edits = [];
  const drops = [];
  // The ore the crater eats pays essence the way a pickaxe break does.
  let blastEssence = 0;
  // One door spread over two cells should only pay out its item once.
  const blastDoors = new Set();

  for (let dy = -2; dy <= 2; dy++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        const x = Math.floor(cx) + dx;
        const y = Math.floor(cy) + dy;
        const z = Math.floor(cz) + dz;
        const id = world.getBlock(x, y, z);
        if (id === B.AIR || id === B.BEDROCK || isWater(id)) continue;
        const block = BLOCKS[id];
        if (!block.breakable || block.liquid) continue;
        // A furnace or chest caught in the blast empties its contents first,
        // so what was kept inside is not simply deleted.
        if (block.blockEntity) spillContents(x, y, z);
        edits.push({ x, y, z, id: B.AIR });
        for (const drop of block.drops || []) {
          if (block.door) {
            const base = x + ',' + (block.door === 'upper' ? y - 1 : y) + ',' + z;
            if (blastDoors.has(base)) continue;
            blastDoors.add(base);
          }
          // The same roll a pickaxe makes. Without it a blast pays out every
          // conditional drop in the crater at once: seeds from every grass block,
          // an apple from every leaf.
          if (drop.chance != null && Math.random() >= drop.chance) continue;
          drops.push({
            id: drop.item,
            count: drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1)),
            x: x + 0.5, y: y + 0.5, z: z + 0.5
          });
        }
        if (block.essence) blastEssence += block.essence;
      }
    }
  }

  if (edits.length) world.setBlocksBatch(edits);
  for (const drop of drops) {
    mobDrop(drop.id, drop.count, drop.x, drop.y, drop.z);
  }
  if (blastEssence > 0 && dropEssence) {
    dropEssence(blastEssence, cx, cy, cz);
  }

  spawnBurstParticles(cx, cy, cz, 0xff9a3c, 26, 10);
  spawnBurstParticles(cx, cy, cz, 0x7d7d7d, 22, 8);
  spawnBurstParticles(cx, cy + 0.4, cz, 0x383838, 16, 6);
  playExplosionSound(cx, cy, cz);
  triggerExplosionPunch(cx, cy, cz);

  const playerCx = mobWalker().pos.x;
  const playerCy = mobWalker().pos.y + 0.9;
  const playerCz = mobWalker().pos.z;
  const distance = Math.hypot(playerCx - cx, playerCy - cy, playerCz - cz);
  if (distance < 6) {
    // The blast carries the difficulty of the ground the creeper was bred on,
    // the same way its health does: `mob.attack` is the def's 14 scaled up.
    const damage = Math.round(
      (mob.attack ?? mob.def.damage) * (1 - distance / 6)
    );
    const knock = 8 * (1 - distance / 6);
    if (distance > 0.01) {
      mobWalker().vel.x += ((playerCx - cx) / distance) * knock;
      mobWalker().vel.z += ((playerCz - cz) / distance) * knock;
      mobWalker().vel.y += 4.5 * (1 - distance / 6);
      mobWalker().onGround = false;
    }
    hurtWalker(damage, 'creeper');
  }

  mob.dead = true;
  mob.group.visible = false;
}

function updateMobBurning(mob, dt) {
  if (!mob.def.hostile || mob.dead) return;
  if (daylight <= 0.5) {
    mob.burnTimer = 0;
    return;
  }

  const headY = Math.floor(mob.pos.y + mob.def.height * 0.85);
  const sky = world.getSkyLight(Math.floor(mob.pos.x), headY, Math.floor(mob.pos.z));
  if (sky < 13) {
    mob.burnTimer = 0;
    return;
  }

  mob.burnTimer += dt;
  if (mob.burnTimer >= 0.65) {
    mob.burnTimer = 0;
    spawnBurstParticles(
      mob.pos.x, mob.pos.y + mob.def.height * 0.55, mob.pos.z,
      0xff9b36, 5, 1.8
    );
    damageMob(mob, 2, 0, 0, { soundGap: 2.6 });
  }
}

function updateMobAI(mob, dt) {
  const def = mob.def;
  const dx = mobWalker().pos.x - mob.pos.x;
  const dz = mobWalker().pos.z - mob.pos.z;
  const dy = mobWalker().pos.y - mob.pos.y;
  const distance = Math.hypot(dx, dz);
  const playerAlive = !mobWalker().dead;

  mob.stateTimer -= dt;
  if (mob.fleeTimer > 0) mob.fleeTimer -= dt;
  if (mob.attackCooldown > 0) mob.attackCooldown -= dt;
  if (mob.audioCooldown > 0) mob.audioCooldown -= dt;
  mob.soundTimer -= dt;

  if (mob.soundTimer <= 0) {
    mob.soundTimer = def.hostile
      ? HOSTILE_SOUND_MIN + Math.random() * (HOSTILE_SOUND_MAX - HOSTILE_SOUND_MIN)
      : ANIMAL_SOUND_MIN + Math.random() * (ANIMAL_SOUND_MAX - ANIMAL_SOUND_MIN);
    if (distance < 26 && Math.abs(dy) < 14 && !mob.dead) {
      if (mob.type === 'zombie') {
        if (hostileSoundCooldown <= 0) {
          hostileSoundCooldown = HOSTILE_SOUND_GAP_MIN +
            Math.random() * (HOSTILE_SOUND_GAP_MAX - HOSTILE_SOUND_GAP_MIN);
          playZombieGroan(mob.pos.x, mob.pos.y + def.height * 0.7, mob.pos.z);
        }
      } else if (mob.type === 'creeper') {
        if (mob.fuse < 0 && Math.random() < 0.4 && hostileSoundCooldown <= 0) {
          hostileSoundCooldown = HOSTILE_SOUND_GAP_MIN +
            Math.random() * (HOSTILE_SOUND_GAP_MAX - HOSTILE_SOUND_GAP_MIN);
          playMobHurtSound('creeper', mob.pos.x, mob.pos.y + def.height * 0.7, mob.pos.z);
        }
      } else if (animalSoundCooldown <= 0) {
        animalSoundCooldown = ANIMAL_SOUND_GAP_MIN +
          Math.random() * (ANIMAL_SOUND_GAP_MAX - ANIMAL_SOUND_GAP_MIN);
        playAnimalSound(mob.type, mob.pos.x, mob.pos.y + def.height * 0.7, mob.pos.z);
      }
    }
  }

  let moveSpeed = def.speed;
  let moveX = 0;
  let moveZ = 0;

  if (def.hostile) {
    if (mob.fuse >= 0) {
      mob.fuse -= dt;
      mob.vel.x *= Math.exp(-10 * dt);
      mob.vel.z *= Math.exp(-10 * dt);
      mobLookToward(mob, dx, dz, dt, 12);
      if (mob.fuse <= 0) {
        explodeCreeper(mob);
        return;
      }
    } else if (playerAlive && distance < def.detection && Math.abs(dy) < 12) {
      if (mob.type === 'creeper') {
        const reach = Math.hypot(dx, dy, dz);
        if (reach < 2.5 && creeperSeesPlayer(mob)) {
          mob.fuse = 1.55;
          mob.state = 'fuse';
          playCreeperHiss(mob.pos.x, mob.pos.y + 0.9, mob.pos.z);
        } else {
          moveX = dx;
          moveZ = dz;
          moveSpeed = def.speed * 1.05;
        }
      } else {
        moveX = dx;
        moveZ = dz;
        if (distance < def.reach && Math.abs(dy) < 2.1 && mob.attackCooldown <= 0) {
          mob.attackCooldown = def.attackInterval;
          hurtWalker(mob.attack ?? def.damage, 'zombie');
        }
      }
    } else {
      if (mob.stateTimer <= 0) {
        pickWanderTarget(mob);
        mob.stateTimer = 2.5 + Math.random() * 4;
      }
      moveX = mob.target.x - mob.pos.x;
      moveZ = mob.target.z - mob.pos.z;
      moveSpeed = def.speed * 0.45;
    }
  } else if (mob.fleeTimer > 0) {
    moveX = -dx;
    moveZ = -dz;
    moveSpeed = def.speed * 1.9;
  } else if (mob.stateTimer <= 0) {
    if (mob.state === 'walk') {
      mob.state = 'idle';
      mob.stateTimer = 1.5 + Math.random() * 3.5;
    } else {
      mob.state = 'walk';
      pickWanderTarget(mob);
      mob.stateTimer = 2.5 + Math.random() * 4;
    }
  } else if (mob.state === 'walk') {
    moveX = mob.target.x - mob.pos.x;
    moveZ = mob.target.z - mob.pos.z;
    if (Math.hypot(moveX, moveZ) < 0.45) {
      mob.state = 'idle';
      mob.stateTimer = 1.4 + Math.random() * 3;
    }
  }

  steerMob(mob, moveX, moveZ, moveSpeed, dt);

  // Gravity and vertical collision.
  const wasDescending = mob.vel.y < 0;
  mob.vel.y = Math.max(mob.vel.y - GRAVITY * dt, -TERMINAL_VELOCITY);
  const hitY = moveMobAxis(mob, 'y', mob.vel.y * dt);
  if (hitY) {
    if (wasDescending) mob.onGround = true;
    mob.vel.y = 0;
  } else {
    mob.onGround = mob.vel.y <= 0 &&
      mobCollidesAt(mob, mob.pos.x, mob.pos.y - 0.02, mob.pos.z);
  }

  // Step up one block when running into terrain.
  const hitHorizontal = moveMobHorizontal(mob, mob.vel.x * dt, mob.vel.z * dt);
  if (hitHorizontal) {
    mob.vel.x = 0;
    mob.vel.z = 0;
  }

  // Settle feet on top of the block when standing.
  if (mob.onGround) {
    const below = Math.floor(mob.pos.y - 0.05);
    if (!isSolid(world.getBlock(Math.floor(mob.pos.x), below, Math.floor(mob.pos.z)))) {
      mob.onGround = false;
    }
  }

  // Water slows mobs down.
  mob.inWater = submergedAt(mob.pos.x, mob.pos.y + 0.25, mob.pos.z);
  if (mob.inWater) {
    mob.vel.x *= Math.exp(-3 * dt);
    mob.vel.z *= Math.exp(-3 * dt);
  }

  // Do not let mobs drop out of the world.
  if (mob.pos.y < -2) mob.dead = true;
}

function updateMobAnimation(mob, dt) {
  const speed = Math.hypot(mob.vel.x, mob.vel.z);
  mob.walkPhase += dt * (3.2 + speed * 2.4);
  const amp = clamp(speed / 1.6, 0, 1) * 0.72;

  for (let i = 0; i < mob.legs.length; i++) {
    mob.legs[i].rotation.x = Math.sin(mob.walkPhase + i * Math.PI) * amp;
  }

  if (mob.head) {
    mob.head.position.y = mob.headBaseY +
      Math.sin(mob.walkPhase * 2) * 0.022 * amp;
    if (mob.def.hostile && mob.fuse < 0) {
      mob.head.rotation.y = Math.sin(performance.now() * 0.0009 + mob.serial) * 0.06;
    }
  }

  mob.hurtFlash = Math.max(0, mob.hurtFlash - dt);
  const fusing = mob.fuse >= 0;
  const pulse = fusing ? (Math.sin(performance.now() * 0.028) + 1) * 0.5 : 0;

  for (const material of mob.materials) {
    if (!material.emissive) continue;
    if (mob.hurtFlash > 0) material.emissive.setHex(0x6b1010);
    else if (fusing) material.emissive.setRGB(0.55 * pulse, 0.55 * pulse, 0.55 * pulse);
    else material.emissive.setHex(0x000000);
  }

  const scale = fusing ? 1 + pulse * 0.1 : 1;
  mob.group.scale.setScalar(scale);
}

export function updateMobs(dt) {
  if (dt <= 0) return;

  if (animalSoundCooldown > 0) animalSoundCooldown -= dt;
  if (hostileSoundCooldown > 0) hostileSoundCooldown -= dt;

  for (let i = mobs.length - 1; i >= 0; i--) {
    const mob = mobs[i];
    if (!mob) continue;

    const dx = mob.pos.x - mobWalker().pos.x;
    const dz = mob.pos.z - mobWalker().pos.z;
    const dy = mob.pos.y - mobWalker().pos.y;
    // Three dimensions: a mob in a cave under the player shares their x and z,
    // and counting it as "right here" is what let invisible zombies hold mob
    // slots for a whole session.
    const distance = Math.hypot(dx, dy, dz);

    if (mob.dead || distance > MOB_DESPAWN_DISTANCE || mob.pos.y < -3) {
      removeMob(mob, i);
      continue;
    }

    if (!world.getChunk(
      Math.floor(mob.pos.x / CHUNK_SIZE),
      Math.floor(mob.pos.z / CHUNK_SIZE)
    )) {
      removeMob(mob, i);
      continue;
    }

    if (mob.def.hostile && mob.fuse < 0 && distance > MOB_DESPAWN_CHANCE_DISTANCE) {
      mob.despawnTimer -= dt;
      if (mob.despawnTimer <= 0) {
        mob.despawnTimer = MOB_DESPAWN_ROLL_INTERVAL;
        if (Math.random() < MOB_DESPAWN_CHANCE) {
          removeMob(mob, i);
          continue;
        }
      }
    }

    updateMobBurning(mob, dt);
    if (mob.dead) {
      removeMob(mob, i);
      continue;
    }

    updateMobAI(mob, dt);
    if (mob.dead) {
      removeMob(mob, i);
      continue;
    }

    updateMobAnimation(mob, dt);
    mob.group.position.copy(mob.pos);
    mob.group.rotation.y = mob.yaw;
  }

  hostileSpawnTimer -= dt;
  if (hostileSpawnTimer <= 0) {
    hostileSpawnTimer = isNight() ? 1.4 : 3.6;
    // Frequency is the third scaling dimension of the design: the farther the
    // walker has travelled from SP0, the less the night waits between arrivals.
    const walker = mobWalker().pos;
    hostileSpawnTimer /= 1 + DIFFICULTY_SPAWN_SCALE * difficultyAt(walker.x, walker.y, walker.z);
    trySpawnHostile();
  }

  passiveSpawnTimer -= dt;
  if (passiveSpawnTimer <= 0) {
    passiveSpawnTimer = PASSIVE_SPAWN_INTERVAL;
    trySpawnPassive();
  }
}

export function countMobs(hostile) {
  let count = 0;
  for (const mob of mobs) if (mob.def.hostile === hostile) count++;
  return count;
}

/**
 * One hostile spawn pass. Daylight keeps its single trickle into the caves;
 * night fills a batch, because one zombie every 1.9 seconds meant dusk spent its
 * first half minute building up. A pass stops at whichever comes first: its
 * batch, the hostile cap, or running out of columns to probe.
 */
export function trySpawnHostile() {
  if (countMobs(true) >= HOSTILE_CAP) {
    hostileSpawnTally.hostile_cap++;
    return null;
  }

  const batch = isNight() ? MOB_SPAWN_BATCH : 1;
  let last = null;
  let placed = 0;

  for (let attempt = 0;
    attempt < MOB_SPAWN_ATTEMPTS && placed < batch && countMobs(true) < HOSTILE_CAP;
    attempt++) {
    const mob = spawnHostileAtRandomColumn();
    if (!mob) continue;
    hostileSpawnTally.spawned++;
    placed++;
    last = mob;
  }
  return last;
}

/**
 * Probes one random column in the spawn band for a dark spot to stand on and
 * puts a hostile there. Returns null when the column is no good; how many
 * columns a pass is worth trying is the caller's business.
 */
function spawnHostileAtRandomColumn() {
  hostileSpawnTally.attempts++;

  const angle = Math.random() * Math.PI * 2;
  const radius = MOB_SPAWN_MIN_RADIUS +
    Math.random() * (MOB_SPAWN_MAX_RADIUS - MOB_SPAWN_MIN_RADIUS);
  const x = Math.floor(mobWalker().pos.x + Math.cos(angle) * radius);
  const z = Math.floor(mobWalker().pos.z + Math.sin(angle) * radius);

  if (!world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))) {
    hostileSpawnTally.no_chunk++;
    return null;
  }

  const surface = world.surfaceY(x, z);
  const candidateYs = [];

  // After dark the open surface is the point of the exercise, so most rolls
  // start there. In daylight only caves can pass the light test anyway, so the
  // surface is mostly a wasted attempt.
  if (Math.random() < (isNight() ? 0.85 : 0.35)) candidateYs.push(surface);
  for (let attemptY = 0; attemptY < 9; attemptY++) {
    candidateYs.push(5 + Math.floor(Math.random() * Math.max(1, surface - 5)));
  }

  let tooBright = false;
  for (const y of candidateYs) {
    const floorId = world.getBlock(x, y, z);
    if (!BLOCKS[floorId].solid || BLOCKS[floorId].liquid) continue;
    if (world.getBlock(x, y + 1, z) !== B.AIR) continue;
    if (world.getBlock(x, y + 2, z) !== B.AIR) continue;

    const light = Math.max(
      world.getBlockLight(x, y + 1, z),
      world.getSkyLight(x, y + 1, z) * clamp(daylight, 0, 1)
    );
    if (light >= 6.5) {
      tooBright = true;
      continue;
    }

    const type = Math.random() < 0.16 ? 'creeper' : 'zombie';
    return spawnMob(type, x + 0.5, y + 1, z + 0.5);
  }

  // Telling "nowhere to stand" apart from "somewhere, but the torches are doing
  // their job" is the difference between a broken spawner and a safe base.
  if (tooBright) hostileSpawnTally.light++;
  else hostileSpawnTally.terrain++;
  return null;
}

/**
 * Rolls the passive herd a chunk was allotted. The roll is keyed to the chunk
 * coordinates, so trying again later gives the same answer and costs nothing.
 * Returns true when at least one animal appeared.
 *
 * Only a roll the player could actually have watched is spent, which is what
 * `mobSpawnChecked` means. Chunks are meshed at the edge of render distance,
 * over a hundred blocks away, and mobs despawn past 96, so a chunk that bailed
 * out because the player was far away, or because the mob caps were full, has
 * to be free to try again once someone is standing in it. Burning the roll in
 * those cases left every chunk the player walked towards permanently checked:
 * the starting herd walked out of range and the rest of the world was empty.
 */
function rollChunkHerd(chunk) {
  if (chunk.mobSpawnChecked) return false;
  // The only gate this needs is its own cap: PASSIVE_CAP and HOSTILE_CAP are
  // sized to fit inside MOB_CAP together, so a full herd can never be what
  // leaves no room for a night spawn.
  if (countMobs(false) >= PASSIVE_CAP) return false;

  const centerX = chunk.cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const centerZ = chunk.cz * CHUNK_SIZE + CHUNK_SIZE / 2;
  if (Math.hypot(centerX - mobWalker().pos.x, centerZ - mobWalker().pos.z) > PASSIVE_SPAWN_RADIUS) {
    return false;
  }

  const column = sampleColumn(Math.floor(centerX), Math.floor(centerZ));
  const grassy = column.biome === 'plains' || column.biome === 'forest' ||
    column.biome === 'rainforest';
  if (!grassy) {
    // Desert, snow and ocean columns never hold a herd, whoever is nearby, so
    // this roll really is used up.
    chunk.mobSpawnChecked = true;
    return false;
  }

  chunk.mobSpawnChecked = true;

  const rand = chunkRandom(chunk.cx, chunk.cz, MOB_SALT);
  // Fewer than half of grassy chunks hold a herd, so green country is still
  // no guaranteed butcher.
  if (rand() > 0.38) return false;

  let spot = null;
  for (let attempt = 0; attempt < 22; attempt++) {
    const lx = Math.floor(rand() * CHUNK_SIZE);
    const lz = Math.floor(rand() * CHUNK_SIZE);
    const wx = chunk.cx * CHUNK_SIZE + lx;
    const wz = chunk.cz * CHUNK_SIZE + lz;
    const y = chunk.heightMap[lx + lz * CHUNK_SIZE];

    if (chunk.getBlock(lx, y, lz) !== B.GRASS) continue;
    if (chunk.getBlock(lx, y + 1, lz) !== B.AIR) continue;
    if (chunk.getBlock(lx, y + 2, lz) !== B.AIR) continue;
    if (Math.hypot(wx + 0.5 - mobWalker().pos.x, wz + 0.5 - mobWalker().pos.z) < 6) continue;

    spot = { x: wx + 0.5, y: y + 1, z: wz + 0.5 };
    break;
  }
  if (!spot) return false;

  let type;
  const roll = rand();
  if (column.biome === 'rainforest') {
    type = roll < 0.42 ? 'chicken' : roll < 0.74 ? 'pig' : 'cow';
  } else if (column.biome === 'forest') {
    type = roll < 0.34 ? 'cow' : roll < 0.62 ? 'pig' : roll < 0.84 ? 'sheep' : 'chicken';
  } else {
    type = roll < 0.4 ? 'cow' : roll < 0.72 ? 'pig' : 'sheep';
  }

  let spawned = false;
  // Mostly one animal grazing alone, occasionally a pair.
  const herd = rand() < 0.8 ? 1 : 2;
  for (let i = 0; i < herd && countMobs(false) < PASSIVE_CAP; i++) {
    const ox = spot.x + (rand() - 0.5) * 1.8;
    const oz = spot.z + (rand() - 0.5) * 1.8;
    const mob = spawnMob(type, ox, spot.y + 0.02, oz, {
      spawnChunk: chunkKey(chunk.cx, chunk.cz)
    });
    if (mob) spawned = true;
  }
  return spawned;
}

/* A freshly meshed chunk rolls for its herd, and that is the whole of what the
   mob layer does with the event: the registration is the only thing the mesher
   has to know about, so it never learns that animals exist. */
onChunkMeshed(rollChunkHerd);

/**
 * Keeps animals coming while the player travels. Chunk meshing alone cannot do
 * it: a chunk is meshed once, far off in the distance, and animals on grass the
 * player was never near are gone again by the time they walk up. So every so
 * often this looks for a loaded chunk around the player that still has its roll
 * unspent and spends one of them.
 */
export function trySpawnPassive() {
  if (countMobs(false) >= PASSIVE_CAP) return null;
  // No total-cap check here either: the two group caps fit inside MOB_CAP
  // together, so animals cannot spend the hostile half of the budget.
  // Grazing animals should not arrive on a dark landscape.
  if (daylight < 0.35) return null;

  const pcx = Math.floor(mobWalker().pos.x / CHUNK_SIZE);
  const pcz = Math.floor(mobWalker().pos.z / CHUNK_SIZE);

  for (let attempt = 0; attempt < 5; attempt++) {
    const cx = pcx + Math.floor(Math.random() * 9) - 4;
    const cz = pcz + Math.floor(Math.random() * 9) - 4;
    const dx = (cx - pcx) * CHUNK_SIZE;
    const dz = (cz - pcz) * CHUNK_SIZE;
    const distance = Math.hypot(dx, dz);
    if (distance < PASSIVE_SPAWN_MIN_RADIUS || distance > PASSIVE_SPAWN_RADIUS) continue;

    // A meshed chunk is a hard requirement: an ungenerated column reads as air
    // all the way down, and the animal would fall straight out of the world.
    const chunk = world.getChunk(cx, cz);
    if (!chunk || !chunk.meshed || chunk.mobSpawnChecked) continue;

    if (rollChunkHerd(chunk)) return mobs[mobs.length - 1];
  }
  return null;
}
