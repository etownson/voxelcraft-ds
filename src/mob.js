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
  playAnimalSound, playCreeperHiss, playExplosionSound, playMobHurtSound, playSkeletonRattle,
  playSpiderHiss, playZombieGroan
} from './audio.js';
import { BLOCKS, isLava, isWater } from './blocks.js';
import { onChunkMeshed, world } from './chunks.js';
import { cellCollidesAt, inLavaAt, submergedAt } from './collision.js';
import {
  B, CHUNK_SIZE, COLLISION_EPSILON, DAY_LENGTH_SECONDS, DIFFICULTY_DAMAGE_SCALE, DIFFICULTY_ESSENCE_SCALE,
  DIFFICULTY_HEALTH_SCALE, DIFFICULTY_SPAWN_SCALE, EYE_HEIGHT, GRAVITY, MAX_MOVE_STEP,
  BURN_DAMAGE, BURN_INTERVAL, BURN_SECONDS, LAVA_DAMAGE, LAVA_DAMAGE_INTERVAL,
  JUMP_SPEED, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, TERMINAL_VELOCITY, chunkKey, clamp
} from './config.js';
import { beaconsActivatedCount, difficultyAt } from './beacons.js';
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
 * loose an arrow at the walker, and pay essence for a killed enemy. The page hands those over where the
 * walker exists, and nothing in the section reaches past these names.
 */
let mobWalker = null;
let hurtWalker = null;
let mobDrop = null;
let dropEssence = null;
let spillContents = null;
let shootWalker = null;
let mobWalkers = null;
let mobKilled = null;
let mobExploded = null;
export function setMobWorld(host) {
  shootWalker = host.shoot;
  mobWalker = host.walker;
  hurtWalker = host.hurt;
  mobDrop = host.drop;
  dropEssence = host.dropEssence;
  spillContents = host.spill;
  // Co-op's three, each optional: every walker in the world rather than the
  // one, word of a death, and word of a blast. A page that hands none of them
  // over is the single-player game, unchanged.
  mobWalkers = host.walkers ?? null;
  mobKilled = host.killed ?? null;
  mobExploded = host.exploded ?? null;
}

/* Which walker the mob being thought about right now is thinking about: the
   nearest one, chosen once per mob per frame, so a zombie between two players
   goes for whoever is closer. With no list there is only ever the one. */
let focusWalker = null;
function walkerNow() { return focusWalker || mobWalker(); }

function walkerList() {
  const list = mobWalkers ? mobWalkers() : null;
  return list && list.length ? list : [mobWalker()];
}

function nearestWalker(x, y, z) {
  const list = walkerList();
  if (list.length === 1) return list[0];
  let best = null;
  let bestD = Infinity;
  for (const walker of list) {
    // The dead are nobody's quarry, but they still hold a mob in the world.
    const d = Math.hypot(walker.pos.x - x, walker.pos.y - y, walker.pos.z - z) +
      (walker.dead ? 1e6 : 0);
    if (d < bestD) { best = walker; bestD = d; }
  }
  return best;
}

/* A guest's mobs are pictures of the host's: they do not think, spawn or die
   on their own, and a hit on one is the host's to apply. `report(mob, amount,
   knockX, knockZ)` is handed the hit instead, and the picture only flinches. */
let mobAuthority = null;
export function setMobAuthority(report) { mobAuthority = report; }

/* Whether this browser rolls herds onto freshly meshed ground. A guest does
   not: its animals are the host's. */
let mobSpawningOn = true;
export function setMobSpawning(on) { mobSpawningOn = !!on; }

/**
 * The two groups share one performance budget but each has a cap of its own, and
 * the two caps are sized so they can never add up to more than the total.
 * They used to overlap — 20 animals plus 13 hostiles against a total of 30 —
 * which put the groups in direct competition for the last few slots: a
 * comfortable herd of animals left room for only 9 zombies, and the total sat
 * at 29 of 30 with nowhere to put anything. Splitting the budget means a full
 * herd can no longer decide how dangerous the night is. All three were halved
 * together (from 32, 10 and 16) so the world holds half as many animals and
 * half as many hostiles at once.
 */
export const MOB_CAP = 16;
/**
 * Animals are deliberately scarce. Cooked meat is the best food in the game — worth
 * nearly twice a loaf of bread — and a landscape that refills itself with cows
 * makes farming optional forever. A herd this thin, arriving this rarely,
 * cannot keep a busy player in meat, so wheat becomes the meal they plan the
 * day around. See the animal scarcity addendum in the design document.
 */
export const PASSIVE_CAP = 5;
export const HOSTILE_CAP = 8;
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
 * Seconds of play before a chunk whose herd was taken may roll for it again.
 * Unloading the chunk used to be the only way back, which meant walking some
 * 180 blocks off and returning: anyone who settled near a beacon hunted the
 * ground around it bare in the first hour and never saw an animal there again.
 * One game day is slow enough that meat stays a find — the roll is still keyed
 * to the chunk, so only the chunks that held a herd hold one again, and the
 * passive cap still applies — but a base gets an animal or two back each day.
 */
export const HERD_REGROW_SECONDS = DAY_LENGTH_SECONDS;
/** Seconds of play the mob layer has run, the clock herd regrowth is timed by. */
let herdClock = 0;
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

export const MOB_DEFS = {
  cow: {
    hostile: false, health: 10, speed: 1.15, width: 0.82, height: 1.42,
    drops: [{ id: 'raw_meat', min: 1, max: 2 }, { id: 'leather', min: 0, max: 2 }]
  },
  pig: {
    hostile: false, health: 10, speed: 1.25, width: 0.78, height: 1.18,
    drops: [{ id: 'raw_meat', min: 1, max: 2 }]
  },
  sheep: {
    hostile: false, health: 8, speed: 1.2, width: 0.86, height: 1.34,
    drops: [{ id: 'raw_meat', min: 1, max: 2 }, { id: 'wool', min: 1, max: 1 }]
  },
  chicken: {
    hostile: false, health: 4, speed: 1.5, width: 0.46, height: 0.82,
    // A chicken is a mouthful next to a cow: half the time it gives one raw
    // meat, against the bigger animals' one or two every time.
    drops: [{ id: 'feather', min: 0, max: 2 }, { id: 'raw_meat', min: 0, max: 1 }]
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
  },
  // Spiders join the night once beacon 2 is lit, and they are where string
  // comes from. Wide and low, quick, and they climb any wall they run into.
  // Sunlight does not burn them; by day they keep to themselves unless hit.
  spider: {
    hostile: true, health: 16, speed: 2.5, width: 1.28, height: 0.9,
    detection: 18, damage: 2, reach: 1.45, attackInterval: 1.0,
    climbs: true, sunproof: true, calmByDay: true,
    essence: { min: 3, max: 5 },
    drops: [{ id: 'string', min: 0, max: 2 }]
  },
  // Skeleton archers join after beacon 3. They hold a distance rather than
  // closing it, circle, and shoot when they can see the walker; up close they
  // back away. Each arrow is `damage` before the ground's difficulty scales it.
  skeleton: {
    hostile: true, health: 20, speed: 1.7, width: 0.6, height: 1.94,
    detection: 24, damage: 3, attackInterval: 2.2,
    ranged: { range: 18, near: 6, far: 13, speed: 26 },
    essence: { min: 4, max: 6 },
    drops: [{ id: 'arrow', min: 0, max: 2 }]
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
  spider_body: mobTexture('spider_body', ({ px, rand, vary, fill }) => {
    fill([44, 38, 36], 8);
    for (let i = 0; i < 20; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([66, 56, 50], 8));
    }
  }),
  spider_face: mobTexture('spider_face', ({ px, rand, vary, fill }) => {
    fill([40, 34, 32], 6);
    // Two big eyes and four small ones, all the same angry red.
    px(4, 5, [196, 30, 28], 3, 2);
    px(9, 5, [196, 30, 28], 3, 2);
    px(3, 9, [168, 24, 24], 2, 1);
    px(11, 9, [168, 24, 24], 2, 1);
    px(6, 8, [168, 24, 24], 1, 1);
    px(9, 8, [168, 24, 24], 1, 1);
  }),
  skeleton_bone: mobTexture('skeleton_bone', ({ px, rand, vary, fill }) => {
    fill([206, 204, 196], 7);
    for (let i = 0; i < 14; i++) {
      px((rand() * 16) | 0, (rand() * 16) | 0, vary([170, 168, 160], 8));
    }
  }),
  skeleton_ribs: mobTexture('skeleton_ribs', ({ px, rand, vary, fill }) => {
    fill([60, 58, 56], 4);
    px(7, 0, [196, 194, 186], 2, 16);
    for (let y = 2; y < 14; y += 3) px(2, y, vary([196, 194, 186], 6), 12, 1);
  }),
  skeleton_face: mobTexture('skeleton_face', ({ px, rand, vary, fill }) => {
    fill([204, 202, 194], 6);
    px(3, 5, [36, 34, 32], 3, 3);
    px(10, 5, [36, 34, 32], 3, 3);
    px(7, 9, [70, 68, 64], 2, 1);
    px(4, 12, [52, 50, 48], 8, 1);
    for (let x = 5; x < 12; x += 2) px(x, 11, [52, 50, 48], 1, 1);
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
  } else if (type === 'spider') {
    const body = mobMaterial('spider_body');
    group.add(mobBox(0.62, 0.5, 0.78, body, 0, 0.56, -0.44));
    group.add(mobBox(0.4, 0.36, 0.4, body, 0, 0.5, 0.12));
    head = mobBox(0.5, 0.46, 0.44, mobHeadMaterials('spider_body', 'spider_face'), 0, 0.52, 0.52);
    group.add(head);
    // Eight legs, four a side, splayed out and down from the middle segment.
    // The walk swings them as it swings any leg; the splay is set once here.
    for (let i = 0; i < 4; i++) {
      const z = 0.3 - i * 0.18;
      for (const side of [-1, 1]) {
        const leg = mobLeg(0.08, 1.0, 0.08, body, side * 0.2, 0.62, z);
        leg.rotation.z = side * 1.05;
        legs.push(leg);
      }
    }
  } else if (type === 'skeleton') {
    const bone = mobMaterial('skeleton_bone');
    group.add(mobBox(0.46, 0.7, 0.22, mobMaterial('skeleton_ribs'), 0, 1.1, 0));
    head = mobBox(0.5, 0.5, 0.5, mobHeadMaterials('skeleton_bone', 'skeleton_face'), 0, 1.72, 0);
    group.add(head);
    // The bow arm is held out in front, the other drawn back to the string.
    const armLeft = mobLeg(0.1, 0.68, 0.1, bone, -0.3, 1.42, 0.06);
    const armRight = mobLeg(0.1, 0.68, 0.1, bone, 0.3, 1.42, 0.06);
    armLeft.rotation.x = -1.45;
    armRight.rotation.x = -1.3;
    armRight.rotation.z = 0.28;
    const wood = new THREE.MeshLambertMaterial({ color: 0x7a5426 });
    const bow = mobBox(0.05, 0.62, 0.05, wood, 0, -0.66, 0.02);
    bow.rotation.x = Math.PI / 2;
    armLeft.add(bow);
    group.add(armLeft, armRight);
    legs = [
      mobLeg(0.1, 0.72, 0.1, bone, -0.11, 0.72, 0),
      mobLeg(0.1, 0.72, 0.1, bone, 0.11, 0.72, 0)
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
    inLava: false,
    lavaTimer: 0,
    fireTime: 0,
    fireTimer: 0,
    health,
    maxHealth: health,
    hurtFlash: 0,
    walkPhase: Math.random() * Math.PI * 2,
    state: 'idle',
    stateTimer: 0.6 + Math.random() * 2.4,
    target: new THREE.Vector3(x, y, z),
    fleeTimer: 0,
    provoked: 0,
    strafe: Math.random() < 0.5 ? -1 : 1,
    strafeTimer: 1.5 + Math.random() * 2,
    fuse: -1,
    attackCooldown: 0,
    stuckTime: 0,
    detourTime: 0,
    detourSide: 1,
    detourMemory: 0,
    detourSpent: 0,
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

function dropMobLoot(mob, owner) {
  for (const drop of mob.def.drops || []) {
    // A shorn sheep has nothing left to give but its meat.
    if (mob.sheared && drop.id === 'wool') continue;
    const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
    // A hide roll can come up empty, which is how Minecraft spreads out loot.
    if (count <= 0) continue;
    mobDrop(
      drop.id, count,
      mob.pos.x, mob.pos.y + mob.def.height * 0.45, mob.pos.z,
      undefined, undefined, owner
    );
  }
}

function dropMobEssence(mob, owner) {
  // Essence is what enemies pay, and only enemies: a herd is food, not fuel.
  // The yield scales with the difficulty of the ground the mob came from, the
  // way its health and bite do: what is hard to kill is worth more to light.
  const yieldToTake = mob.def.essence;
  if (!mob.def.hostile || !dropEssence || !yieldToTake) return;
  const base = yieldToTake.min +
    Math.floor(Math.random() * (yieldToTake.max - yieldToTake.min + 1));
  const amount = Math.round(base * (1 + DIFFICULTY_ESSENCE_SCALE * mob.difficulty));
  if (amount <= 0) return;
  dropEssence(amount, mob.pos.x, mob.pos.y + mob.def.height * 0.4, mob.pos.z, owner);
}

/* `owner` is whoever struck the last blow, when that was another player in
   co-op: the loot and the essence are theirs, and the drop seam takes them there. */
function killMob(mob, owner = null) {
  if (!mob || mob.dead) return;
  mob.dead = true;
  mobDeathBurst(mob);
  dropMobLoot(mob, owner);
  dropMobEssence(mob, owner);
  if (mobKilled) mobKilled(mob);
}

/** The puff a mob leaves when it dies, for the host's own and a guest's picture. */
export function mobDeathBurst(mob) {
  spawnBurstParticles(
    mob.pos.x, mob.pos.y + mob.def.height * 0.5, mob.pos.z,
    0xb04a4a, 14, 4.4
  );
}

export function damageMob(mob, amount, knockX = 0, knockZ = 0, options = {}) {
  if (!mob || mob.dead) return false;
  if (mobAuthority && !options.authoritative) {
    // A guest's picture: flinch, and let the host decide what the hit did.
    mob.hurtFlash = 0.22;
    spawnBurstParticles(
      mob.pos.x, mob.pos.y + mob.def.height * 0.62, mob.pos.z,
      0xc84242, 6, 2.6
    );
    if (mob.audioCooldown <= 0) {
      mob.audioCooldown = 0.55;
      playMobHurtSound(mob.type, mob.pos.x, mob.pos.y + mob.def.height * 0.6, mob.pos.z);
    }
    mobAuthority(mob, amount, knockX, knockZ);
    return false;
  }
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
    // A spider minding its own business by day turns on whoever hit it.
    mob.provoked = 12;
  } else {
    mob.fleeTimer = 3.5;
  }

  if (mob.health <= 0) {
    killMob(mob, options.by ?? null);
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

/**
 * Move horizontally, sliding along whatever stops one axis. Each axis is
 * tried on its own, so a mob that meets a wall at an angle keeps the part of
 * its stride that runs along the wall. It used to be all or nothing: a blocked
 * axis put the mob back where it started on both, and a zombie that came at a
 * cliff diagonally stood against it and marched on the spot.
 */
function moveMobHorizontal(mob, dx, dz) {
  return { hitX: moveMobAxis(mob, 'x', dx), hitZ: moveMobAxis(mob, 'z', dz) };
}

/**
 * True when the obstacle a mob just walked into is one block it can jump:
 * there is room over its head where it stands, and its whole body fits a
 * block up, a short stride ahead. A wall two high, or a ledge under a low
 * ceiling, is not worth the jump, and the mob does not bounce against it.
 */
function canHopToward(mob, dirX, dirZ) {
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-5) return false;
  const up = mob.pos.y + 1.05;
  if (mobCollidesAt(mob, mob.pos.x, up, mob.pos.z)) return false;
  const stride = mob.def.width * 0.5 + 0.3;
  const aheadX = mob.pos.x + (dirX / length) * stride;
  const aheadZ = mob.pos.z + (dirZ / length) * stride;
  return !mobCollidesAt(mob, aheadX, up, aheadZ);
}

/**
 * Hunters that walk straight at the walker meet walls they cannot jump. One
 * that has made no headway for a moment picks a side and works along the wall
 * that way for a little while, which finds the way round a corner, a tree or a
 * pillar far more often than standing there does.
 */
const STUCK_BEFORE_DETOUR = 0.6;
const DETOUR_SECONDS = 2.6;
/** A mob stuck again this soon after a detour keeps the side it chose. */
const DETOUR_MEMORY = 6;
/** Seconds of one detour hugging a wall before the mob tries the other way. */
const DETOUR_GIVE_UP = 8;

/**
 * Mobs keep their distance from one another. Two bodies closer than the sum
 * of their half widths are pushed apart, each by its half of the overlap, and
 * the push goes through the same collision as walking, so a crowd spreads into
 * a ring round the walker instead of folding into one blob or into a wall.
 */
const SEPARATION_RATE = 20;

/** How far beyond its own half width a melee mob stops from the walker. */
const MELEE_STANDOFF = 0.5;

function separateMob(mob, dt) {
  let pushX = 0;
  let pushZ = 0;
  for (const other of mobs) {
    if (other === mob || other.dead) continue;
    if (other.pos.y >= mob.pos.y + mob.def.height || mob.pos.y >= other.pos.y + other.def.height) continue;
    const ox = mob.pos.x - other.pos.x;
    const oz = mob.pos.z - other.pos.z;
    const minDistance = (mob.def.width + other.def.width) * 0.5;
    if (Math.abs(ox) >= minDistance || Math.abs(oz) >= minDistance) continue;
    let d = Math.hypot(ox, oz);
    if (d >= minDistance) continue;
    let nx;
    let nz;
    if (d < 1e-4) {
      // Exactly on top of each other: part them along a direction that the
      // pair agrees on, so they do not both step the same way.
      const angle = ((mob.serial * 2654435761) % 6283) / 1000;
      nx = Math.cos(angle);
      nz = Math.sin(angle);
      d = 0;
    } else {
      nx = ox / d;
      nz = oz / d;
    }
    const overlap = (minDistance - d) * 0.5;
    pushX += nx * overlap;
    pushZ += nz * overlap;
  }
  // The walkers' bodies are kept clear too, and the mob takes the whole of
  // that push: the walker is not shoved about by what it is fighting.
  let solidX = 0;
  let solidZ = 0;
  for (const walker of walkerList()) {
    if (!walker || walker.dead) continue;
    const w = walker.pos;
    if (w.y >= mob.pos.y + mob.def.height || mob.pos.y >= w.y + PLAYER_HEIGHT) continue;
    const ox = mob.pos.x - w.x;
    const oz = mob.pos.z - w.z;
    const minDistance = mob.def.width * 0.5 + PLAYER_HALF_WIDTH;
    const d = Math.hypot(ox, oz);
    if (d >= minDistance || d < 1e-4) continue;
    solidX += (ox / d) * (minDistance - d);
    solidZ += (oz / d) * (minDistance - d);
  }
  if (pushX === 0 && pushZ === 0 && solidX === 0 && solidZ === 0) return;
  const share = Math.min(1, SEPARATION_RATE * dt);
  pushX = pushX * share + solidX;
  pushZ = pushZ * share + solidZ;
  moveMobAxis(mob, 'x', pushX);
  moveMobAxis(mob, 'z', pushZ);
}

/**
 * Whether a mob's blow can land: a clear line from its chest to the walker's
 * chest or eyes. Leaves and water do not stop it; a roof, a wall or a closed
 * door does, so a zombie standing on the dirt over your head cannot hit you
 * through it however close it is.
 */
function mobReachesWalker(mob) {
  const walker = walkerNow().pos;
  const fromY = mob.pos.y + mob.def.height * 0.6;
  return clearLine(mob.pos.x, fromY, mob.pos.z, walker.x, walker.y + EYE_HEIGHT, walker.z) ||
    clearLine(mob.pos.x, fromY, mob.pos.z, walker.x, walker.y + EYE_HEIGHT * 0.55, walker.z);
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

/** `face`, when given, is where the mob looks instead of where it walks. */
function steerMob(mob, dirX, dirZ, speed, dt, face = null) {
  if (face) mobLookToward(mob, face.x, face.z, dt, 10);
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-5) {
    mob.vel.x *= Math.exp(-8 * dt);
    mob.vel.z *= Math.exp(-8 * dt);
    return;
  }
  dirX /= length;
  dirZ /= length;
  if (!face) mobLookToward(mob, dirX, dirZ, dt);
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
 * A sight probe from the top of a mob's head to the player's eyes: the
 * creeper's, to decide whether to light, and the skeleton's, to decide whether
 * it has a shot.
 * Ignition used to be a horizontal ring plus a feet-to-feet window, and both
 * halves read wrong: it fired through walls the creeper had never seen past,
 * and it never fired at all once the feet sat more than two blocks apart, so
 * a creeper pressed against the foot of a ledge you stood on just stood there
 * and waved. Now it lights when its real three-dimensional reach is clear,
 * and the reach is what it measures. Leaves and water do not break the line;
 * a closed door or a wall does, so shelter now means what it looks like.
 */
function mobSeesWalker(mob) {
  const walker = walkerNow().pos;
  return clearLine(
    mob.pos.x, mob.pos.y + mob.def.height * 0.8, mob.pos.z,
    walker.x, walker.y + EYE_HEIGHT, walker.z
  );
}

/**
 * True when nothing solid but leaves or water lies between the two points.
 * It walks the line cell by cell, every cell it passes through, so it cannot
 * slip between samples across the corner of a roof edge or a wall.
 */
function clearLine(fromX, fromY, fromZ, toX, toY, toZ, seesThrough = sightPasses) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  let x = Math.floor(fromX);
  let y = Math.floor(fromY);
  let z = Math.floor(fromZ);
  const endX = Math.floor(toX);
  const endY = Math.floor(toY);
  const endZ = Math.floor(toZ);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const stepZ = Math.sign(dz);
  const deltaX = stepX ? Math.abs(1 / dx) : Infinity;
  const deltaY = stepY ? Math.abs(1 / dy) : Infinity;
  const deltaZ = stepZ ? Math.abs(1 / dz) : Infinity;
  let maxX = stepX ? (stepX > 0 ? x + 1 - fromX : fromX - x) * deltaX : Infinity;
  let maxY = stepY ? (stepY > 0 ? y + 1 - fromY : fromY - y) * deltaY : Infinity;
  let maxZ = stepZ ? (stepZ > 0 ? z + 1 - fromZ : fromZ - z) * deltaZ : Infinity;
  // The cells the line starts and ends in hold the two bodies, not a wall.
  for (let guard = 0; guard < 256; guard++) {
    // The next cell boundary lies past the end of the line: nothing between.
    if (Math.min(maxX, maxY, maxZ) >= 1) return true;
    if (maxX < maxY && maxX < maxZ) { x += stepX; maxX += deltaX; }
    else if (maxY < maxZ) { y += stepY; maxY += deltaY; }
    else { z += stepZ; maxZ += deltaZ; }
    if (x === endX && y === endY && z === endZ) return true;
    const id = world.getBlock(x, y, z);
    if (seesThrough(id)) continue;
    const block = BLOCKS[id];
    if (block && block.solid) return false;
  }
  return true;
}

/** Whether nothing solid but leaves or water lies between two `{ x, y, z }`. */
export function sightClear(from, to) {
  return clearLine(from.x, from.y, from.z, to.x, to.y, to.z);
}

/** What a mob's eyes pass through: open air, water, and the gaps in leaves. */
function sightPasses(id) {
  return id === B.AIR || isWater(id) || id === B.LEAVES;
}

/** A blast is stopped by anything solid, leaves included, as in Minecraft. */
function nothingPasses() {
  return false;
}

/** Minecraft's creeper: power 3, so a blast reaches 6 blocks to hurt. */
const CREEPER_BLAST_POWER = 3;
/** How far each blast ray moves per step, and what the step itself costs. */
const BLAST_STEP = 0.3;
const BLAST_STEP_DECAY = 0.225;

/**
 * The cells a blast of this power breaks, found the way Minecraft finds them:
 * a ray towards every point on the surface of a 16×16×16 cube, each starting
 * with the power give or take 30%, losing strength with every step and paying
 * each block's blast resistance for every step it spends inside it. A cell
 * breaks when a ray reaches it with strength left over. Tough blocks therefore
 * also shield whatever is behind them, and the random start strengths give the
 * crater its ragged edge.
 */
function blastCells(cx, cy, cz, power) {
  const cells = new Map();
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      for (let k = 0; k < 16; k++) {
        if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
        let dx = (i / 15) * 2 - 1;
        let dy = (j / 15) * 2 - 1;
        let dz = (k / 15) * 2 - 1;
        const length = Math.hypot(dx, dy, dz);
        dx = (dx / length) * BLAST_STEP;
        dy = (dy / length) * BLAST_STEP;
        dz = (dz / length) * BLAST_STEP;
        let strength = power * (0.7 + Math.random() * 0.6);
        let x = cx;
        let y = cy;
        let z = cz;
        while (strength > 0) {
          const bx = Math.floor(x);
          const by = Math.floor(y);
          const bz = Math.floor(z);
          const id = world.getBlock(bx, by, bz);
          if (id !== B.AIR) {
            const block = BLOCKS[id];
            strength -= (block.blastResistance + 0.3) * BLAST_STEP;
            if (strength > 0 && block.breakable && !block.liquid) {
              cells.set(bx + ',' + by + ',' + bz, [bx, by, bz]);
            }
          }
          x += dx;
          y += dy;
          z += dz;
          strength -= BLAST_STEP_DECAY;
        }
      }
    }
  }
  return [...cells.values()];
}

/**
 * How much of a walker the blast can see, from 0 to 1: lines from a grid of
 * points over their body to the blast, and the share of them nothing solid
 * cuts. A player behind a wall takes nothing; one peeking round a corner
 * takes part of it. Measured before the crater opens, as Minecraft does.
 */
function blastExposure(cx, cy, cz, walker) {
  const inset = 0.05;
  const width = PLAYER_HALF_WIDTH * 2 - inset * 2;
  const height = PLAYER_HEIGHT - inset * 2;
  const minX = walker.pos.x - PLAYER_HALF_WIDTH + inset;
  const minY = walker.pos.y + inset;
  const minZ = walker.pos.z - PLAYER_HALF_WIDTH + inset;
  let open = 0;
  let total = 0;
  for (let a = 0; a <= 2; a++) {
    for (let b = 0; b <= 4; b++) {
      for (let c = 0; c <= 2; c++) {
        total++;
        if (clearLine(
          minX + (width * a) / 2, minY + (height * b) / 4, minZ + (width * c) / 2,
          cx, cy, cz, nothingPasses
        )) open++;
      }
    }
  }
  return open / total;
}

function explodeCreeper(mob) {
  const cx = mob.pos.x;
  const cy = mob.pos.y + 0.75;
  const cz = mob.pos.z;
  const reach = CREEPER_BLAST_POWER * 2;
  // Who the blast can see is settled before it opens the crater, so the wall
  // that shielded someone still counts even though the blast then breaks it.
  const exposures = new Map();
  for (const walker of walkerList()) {
    const distance = Math.hypot(walker.pos.x - cx, walker.pos.y + 0.9 - cy, walker.pos.z - cz);
    if (distance < reach) exposures.set(walker, blastExposure(cx, cy, cz, walker));
  }

  const edits = [];
  const drops = [];
  // The ore the crater eats pays essence the way a pickaxe break does.
  let blastEssence = 0;
  // One door spread over two cells should only pay out its item once.
  const blastDoors = new Set();

  // The crater is measured from the creeper's feet, as Minecraft's is, so
  // about half the rays go into the ground it stands on.
  for (const [x, y, z] of blastCells(cx, mob.pos.y, cz, CREEPER_BLAST_POWER)) {
    const block = BLOCKS[world.getBlock(x, y, z)];
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

  if (edits.length) world.setBlocksBatch(edits);
  // Torches just outside the crater whose wall or floor it took pop off, the
  // same as when a pickaxe takes the block out from under them.
  for (const edit of edits) {
    for (const [tx, ty, tz] of world.torchesHeldBy(edit.x, edit.y, edit.z)) {
      if (world.getBlock(tx, ty, tz) !== B.TORCH) continue;
      world.setBlock(tx, ty, tz, B.AIR);
      drops.push({ id: 'torch', count: 1, x: tx + 0.5, y: ty + 0.3, z: tz + 0.5 });
    }
  }
  for (const drop of drops) {
    mobDrop(drop.id, drop.count, drop.x, drop.y, drop.z);
  }
  if (blastEssence > 0 && dropEssence) {
    dropEssence(blastEssence, cx, cy, cz);
  }

  explosionEffectsAt(cx, cy, cz);
  if (mobExploded) mobExploded(cx, cy, cz);

  // Everyone close enough feels it, not only the walker the creeper wanted.
  for (const walker of walkerList()) {
    const playerCx = walker.pos.x;
    const playerCy = walker.pos.y + 0.9;
    const playerCz = walker.pos.z;
    const distance = Math.hypot(playerCx - cx, playerCy - cy, playerCz - cz);
    // Out of reach, or behind something solid on every line to the blast.
    const exposure = exposures.get(walker) ?? 0;
    if (distance >= reach || exposure <= 0) continue;
    // How hard it lands: close and in the open is the whole blow, and every
    // line a wall cuts takes its share off, knockback and damage alike.
    const impact = (1 - distance / reach) * exposure;
    // The blast carries the difficulty of the ground the creeper was bred on,
    // the same way its health does: `mob.attack` is the def's 14 scaled up.
    const damage = Math.round((mob.attack ?? mob.def.damage) * impact);
    const knock = 8 * impact;
    if (distance > 0.01) {
      walker.vel.x += ((playerCx - cx) / distance) * knock;
      walker.vel.z += ((playerCz - cz) / distance) * knock;
      walker.vel.y += 4.5 * impact;
      walker.onGround = false;
    }
    hurtWalker(damage, 'creeper', walker);
  }

  mob.dead = true;
  mob.group.visible = false;
}

/** The flash, smoke and bang of a blast, without the blast. */
export function explosionEffectsAt(cx, cy, cz) {
  spawnBurstParticles(cx, cy, cz, 0xff9a3c, 26, 10);
  spawnBurstParticles(cx, cy, cz, 0x7d7d7d, 22, 8);
  spawnBurstParticles(cx, cy + 0.4, cz, 0x383838, 16, 6);
  playExplosionSound(cx, cy, cz);
  triggerExplosionPunch(cx, cy, cz);
}

function updateMobBurning(mob, dt) {
  if (!mob.def.hostile || mob.def.sunproof || mob.dead) return;
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

/**
 * Lava burns a mob the way it burns the player: four points every half second
 * while it is in it, and a point a second for eight seconds after it climbs
 * out, unless water puts it out. Passive animals bolt from the hurt, which
 * is what usually carries them back out of the pool.
 */
function updateMobLava(mob, dt) {
  if (mob.dead) return;
  const half = mob.def.height * 0.5;
  mob.inLava = inLavaAt(mob.pos.x, mob.pos.y + 0.05, mob.pos.z) ||
    inLavaAt(mob.pos.x, mob.pos.y + half, mob.pos.z);

  if (mob.inLava) {
    mob.fireTime = BURN_SECONDS;
    mob.lavaTimer -= dt;
    if (mob.lavaTimer <= 0) {
      mob.lavaTimer = LAVA_DAMAGE_INTERVAL;
      spawnBurstParticles(mob.pos.x, mob.pos.y + half, mob.pos.z, 0xff7a1c, 6, 2.2);
      damageMob(mob, LAVA_DAMAGE, 0, 0, { soundGap: 1.2 });
    }
    return;
  }
  mob.lavaTimer = 0;

  if (mob.fireTime <= 0) return;
  if (mob.inWater) {
    mob.fireTime = 0;
    return;
  }
  mob.fireTime -= dt;
  mob.fireTimer += dt;
  if (mob.fireTimer >= BURN_INTERVAL) {
    mob.fireTimer -= BURN_INTERVAL;
    spawnBurstParticles(mob.pos.x, mob.pos.y + half, mob.pos.z, 0xff9b36, 4, 1.6);
    damageMob(mob, BURN_DAMAGE, 0, 0, { soundGap: 2.6 });
  }
  if (mob.fireTime <= 0) mob.fireTimer = 0;
}

/**
 * True when a step towards (dirX, dirZ) would put the mob's feet into lava,
 * or onto lava a block down. A mob already in lava is never held back, or it
 * could not walk out.
 */
function lavaAhead(mob, dirX, dirZ) {
  if (mob.inLava) return false;
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-5) return false;
  const reach = mob.def.width * 0.5 + 0.45;
  const x = Math.floor(mob.pos.x + (dirX / length) * reach);
  const z = Math.floor(mob.pos.z + (dirZ / length) * reach);
  const y = Math.floor(mob.pos.y + 0.05);
  return isLava(world.getBlock(x, y, z)) || isLava(world.getBlock(x, y - 1, z));
}

/**
 * Where a skeleton walks while it has the walker in range: in from far off,
 * back from too close, and in between round them on a side it changes every
 * few seconds, so it is never standing still to be shot at.
 */
function archerMove(mob, dx, dz, distance, dt) {
  const { near, far } = mob.def.ranged;
  mob.strafeTimer -= dt;
  if (mob.strafeTimer <= 0) {
    mob.strafe = -mob.strafe;
    mob.strafeTimer = 1.8 + Math.random() * 2.4;
  }
  if (distance > far) {
    return { moveX: dx, moveZ: dz, moveSpeed: mob.def.speed };
  }
  if (distance < near) {
    return { moveX: -dx + -dz * mob.strafe * 0.4, moveZ: -dz + dx * mob.strafe * 0.4, moveSpeed: mob.def.speed };
  }
  return { moveX: -dz * mob.strafe, moveZ: dx * mob.strafe, moveSpeed: mob.def.speed * 0.6 };
}

/** A skeleton with a clear line and a ready string looses at the walker. */
function archerShoot(mob, distance, dy) {
  const def = mob.def;
  if (mob.attackCooldown > 0 || !shootWalker) return;
  if (distance > def.ranged.range || Math.abs(dy) > 10) return;
  if (!mobSeesWalker(mob)) return;
  mob.attackCooldown = def.attackInterval * (0.85 + Math.random() * 0.3);
  shootWalker(mob, def.ranged.speed, mob.attack ?? def.damage, walkerNow());
}

function updateMobAI(mob, dt) {
  const def = mob.def;
  const dx = walkerNow().pos.x - mob.pos.x;
  const dz = walkerNow().pos.z - mob.pos.z;
  const dy = walkerNow().pos.y - mob.pos.y;
  const distance = Math.hypot(dx, dz);
  const playerAlive = !walkerNow().dead;

  mob.stateTimer -= dt;
  if (mob.fleeTimer > 0) mob.fleeTimer -= dt;
  if (mob.provoked > 0) mob.provoked -= dt;
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
      } else if (mob.type === 'spider' || mob.type === 'skeleton') {
        if (hostileSoundCooldown <= 0) {
          hostileSoundCooldown = HOSTILE_SOUND_GAP_MIN +
            Math.random() * (HOSTILE_SOUND_GAP_MAX - HOSTILE_SOUND_GAP_MIN);
          const voice = mob.type === 'spider' ? playSpiderHiss : playSkeletonRattle;
          voice(mob.pos.x, mob.pos.y + def.height * 0.7, mob.pos.z);
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
  let face = null;
  // A spider out in the daylight hunts nobody unless somebody started it. In a
  // cave, noon is as dark as midnight, and it hunts as it would at night.
  const calm = def.calmByDay && daylight > 0.5 && mob.provoked <= 0 &&
    world.getSkyLight(
      Math.floor(mob.pos.x), Math.floor(mob.pos.y + def.height * 0.5), Math.floor(mob.pos.z)
    ) >= 10;

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
    } else if (playerAlive && !calm && distance < def.detection && Math.abs(dy) < 12) {
      if (def.ranged) {
        ({ moveX, moveZ, moveSpeed } = archerMove(mob, dx, dz, distance, dt));
        face = { x: dx, z: dz };
        archerShoot(mob, distance, dy);
      } else if (mob.type === 'creeper') {
        const reach = Math.hypot(dx, dy, dz);
        if (reach < 2.5 && mobSeesWalker(mob)) {
          mob.fuse = 1.55;
          mob.state = 'fuse';
          playCreeperHiss(mob.pos.x, mob.pos.y + 0.9, mob.pos.z);
        } else {
          moveX = dx;
          moveZ = dz;
          moveSpeed = def.speed * 1.05;
        }
      } else {
        // Close in to arm's length and no closer: walking on into the walker
        // stacked every zombie of a night on the one spot they all wanted.
        if (distance > def.width * 0.5 + MELEE_STANDOFF) {
          moveX = dx;
          moveZ = dz;
        } else {
          face = { x: dx, z: dz };
        }
        if (distance < def.reach && Math.abs(dy) < 2.1 && mob.attackCooldown <= 0 &&
            mobReachesWalker(mob)) {
          mob.attackCooldown = def.attackInterval;
          hurtWalker(mob.attack ?? def.damage, mob.type, walkerNow());
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

  // A hunter stuck against a wall it cannot jump works along it for a while.
  if (mob.detourMemory > 0) mob.detourMemory -= dt;
  if (mob.detourTime > 0) {
    mob.detourTime -= dt;
    if (moveX || moveZ) {
      const side = mob.detourSide;
      const along = { x: -moveZ * side, z: moveX * side };
      moveX = along.x + moveX * 0.25;
      moveZ = along.z + moveZ * 0.25;
    }
  }

  // Nothing walks into lava of its own accord. A wanderer turns to somewhere
  // else, and a hunter stops at the edge rather than following the player in.
  if (lavaAhead(mob, moveX, moveZ)) {
    moveX = 0;
    moveZ = 0;
    mob.stateTimer = Math.min(mob.stateTimer, 0);
  }

  steerMob(mob, moveX, moveZ, moveSpeed, dt, face);

  // Gravity and vertical collision. Whether it is falling is read after
  // gravity: read before, a mob that came into the world standing still on
  // the ground never counted as standing, and could never jump.
  mob.vel.y = Math.max(mob.vel.y - GRAVITY * dt, -TERMINAL_VELOCITY);
  const descending = mob.vel.y < 0;
  const hitY = moveMobAxis(mob, 'y', mob.vel.y * dt);
  if (hitY) {
    mob.onGround = descending;
    mob.vel.y = 0;
  } else {
    mob.onGround = mob.vel.y <= 0 &&
      mobCollidesAt(mob, mob.pos.x, mob.pos.y - 0.02, mob.pos.z);
  }

  // Walk, sliding along walls. What stops an axis zeroes only that axis, and
  // a one-block rise in the way is jumped like the player jumps it.
  const { hitX, hitZ } = moveMobHorizontal(mob, mob.vel.x * dt, mob.vel.z * dt);
  const walking = (moveX || moveZ) && !mob.inLava;
  const pushX = hitX ? mob.vel.x : 0;
  const pushZ = hitZ ? mob.vel.z : 0;
  if (hitX) mob.vel.x = 0;
  if (hitZ) mob.vel.z = 0;
  let blocked = false;
  if ((hitX || hitZ) && walking) {
    if (def.climbs) {
      // A climber that walks into a wall goes up it instead of stopping.
      mob.vel.y = Math.max(mob.vel.y, 2.6);
      mob.onGround = false;
    } else if ((mob.onGround || (mob.inWater && mob.vel.y <= 0)) && canHopToward(mob, pushX, pushZ)) {
      // In water the same kick is a stroke towards the bank.
      mob.vel.y = JUMP_SPEED;
      mob.onGround = false;
    } else if (mob.onGround) {
      blocked = true;
    }
  }

  // No headway against something it cannot jump: try going round. Still
  // against the wall partway through a detour, it keeps following the wall
  // rather than turning back at the walker and losing the ground it made; a
  // wall that goes on and on is tried the other way after a while.
  if (def.hostile && blocked) {
    if (mob.detourTime > 0) {
      mob.detourTime = Math.max(mob.detourTime, 0.5);
      mob.detourSpent += dt;
      if (mob.detourSpent > DETOUR_GIVE_UP) {
        mob.detourSide = -mob.detourSide;
        mob.detourSpent = 0;
      }
    } else if (Math.hypot(mob.vel.x, mob.vel.z) < def.speed * 0.35) {
      mob.stuckTime += dt;
      if (mob.stuckTime > STUCK_BEFORE_DETOUR) {
        if (mob.detourMemory <= 0) mob.detourSide = Math.random() < 0.5 ? -1 : 1;
        mob.detourTime = DETOUR_SECONDS;
        mob.detourMemory = DETOUR_MEMORY;
        mob.detourSpent = 0;
        mob.stuckTime = 0;
      }
    }
  } else {
    mob.stuckTime = 0;
  }

  separateMob(mob, dt);

  // Water slows mobs down, and lava far more.
  mob.inWater = submergedAt(mob.pos.x, mob.pos.y + 0.25, mob.pos.z);
  if (mob.inLava) {
    mob.vel.x *= Math.exp(-7 * dt);
    mob.vel.z *= Math.exp(-7 * dt);
  } else if (mob.inWater) {
    mob.vel.x *= Math.exp(-3 * dt);
    mob.vel.z *= Math.exp(-3 * dt);
  }

  // Do not let mobs drop out of the world.
  if (mob.pos.y < -2) mob.dead = true;
}

/** One frame of a guest's picture of a mob: legs, head, flash and fuse. */
export function animateMobPuppet(mob, dt) {
  updateMobAnimation(mob, dt);
  mob.group.position.copy(mob.pos);
  mob.group.rotation.y = mob.yaw;
}

/** Takes a mob out of the world outright, for a guest whose host let it go. */
export function removeMobRecord(mob) {
  removeMob(mob);
}

/**
 * Builds the mob's model again for what it now is, after a shearing. The old
 * model's materials go with it.
 */
export function refitMobModel(mob) {
  const model = createMobModel(mob.type, mob.sheared);
  scene.remove(mob.group);
  for (const material of mob.materials) material.dispose();
  mob.group = model.group;
  mob.legs = model.legs;
  mob.head = model.head;
  mob.headBaseY = model.headBaseY;
  mob.materials = model.materials;
  mob.group.position.copy(mob.pos);
  mob.group.rotation.y = mob.yaw;
  scene.add(mob.group);
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
  herdClock += dt;

  if (animalSoundCooldown > 0) animalSoundCooldown -= dt;
  if (hostileSoundCooldown > 0) hostileSoundCooldown -= dt;

  for (let i = mobs.length - 1; i >= 0; i--) {
    const mob = mobs[i];
    if (!mob) continue;
    focusWalker = nearestWalker(mob.pos.x, mob.pos.y, mob.pos.z);

    const dx = mob.pos.x - walkerNow().pos.x;
    const dz = mob.pos.z - walkerNow().pos.z;
    const dy = mob.pos.y - walkerNow().pos.y;
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
    updateMobLava(mob, dt);
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
  focusWalker = null;

  // The night comes for somebody: each spawn pass is centred on one walker,
  // taken in turn, so a guest off on their own gets a night of their own.
  const walkers = walkerList();
  focusWalker = walkers[spawnTurn++ % walkers.length];

  hostileSpawnTimer -= dt;
  if (hostileSpawnTimer <= 0) {
    hostileSpawnTimer = isNight() ? 1.4 : 3.6;
    // Frequency is the third scaling dimension of the design: the farther the
    // walker has travelled from SP0, the less the night waits between arrivals.
    const walker = walkerNow().pos;
    hostileSpawnTimer /= 1 + DIFFICULTY_SPAWN_SCALE * difficultyAt(walker.x, walker.y, walker.z);
    trySpawnHostile();
  }

  passiveSpawnTimer -= dt;
  if (passiveSpawnTimer <= 0) {
    passiveSpawnTimer = PASSIVE_SPAWN_INTERVAL;
    trySpawnPassive();
  }
  focusWalker = null;
}

/** Whose turn it is to be the centre of a spawn pass, in co-op. */
let spawnTurn = 0;

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
 * Which hostile a spawn puts down. The night grows with the mission: creepers
 * and zombies from the start, spiders once beacon 2 is lit, skeleton archers
 * once beacon 3 is. Each newcomer takes its share out of the zombies'.
 */
function pickHostileType() {
  const roll = Math.random();
  for (const [type, , below] of hostileMix(beaconsActivatedCount())) {
    if (roll < below) return type;
  }
  return 'zombie';
}

/**
 * The night's mix with `lit` beacons running, as [type, share, below] rows:
 * creepers a steady 16%, spiders 28% from beacon 2, skeletons 20% from beacon
 * 3, and zombies whatever is left. `below` is where the row's slice of the roll
 * ends, written out rather than summed so a float never moves a boundary. The
 * pace estimate reads the shares.
 */
export function hostileMix(lit) {
  const mix = [['creeper', 0.16, 0.16]];
  if (lit >= 2) mix.push(['spider', 0.28, 0.44]);
  if (lit >= 3) mix.push(['skeleton', 0.2, 0.64]);
  const taken = mix[mix.length - 1][2];
  mix.push(['zombie', Number((1 - taken).toFixed(2)), 1]);
  return mix;
}

/**
 * Probes one random column in the spawn band for a dark spot to stand on and
 * puts a hostile there. Returns null when the column is no good; how many
 * columns a pass is worth trying is the caller's business.
 */
/**
 * Where in block (x, z) a hostile of this type fits with its feet at y, or
 * null. The block centre comes first. A spider centred there spans three
 * blocks each way, so it also tries the block's four corners, which need only
 * a clear 2x2. Standing on the centre block alone used to turn half of all
 * spider rolls into zombies.
 */
function hostileSpotFor(type, x, y, z) {
  const probe = { def: MOB_DEFS[type] };
  if (!mobCollidesAt(probe, x + 0.5, y, z + 0.5)) return { x: x + 0.5, z: z + 0.5 };
  if (MOB_DEFS[type].width <= 1) return null;
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const start = Math.floor(Math.random() * 4);
  for (let i = 0; i < 4; i++) {
    const [dx, dz] = corners[(start + i) % 4];
    if (!mobCollidesAt(probe, x + dx, y, z + dz)) return { x: x + dx, z: z + dz };
  }
  return null;
}

function spawnHostileAtRandomColumn() {
  hostileSpawnTally.attempts++;

  const angle = Math.random() * Math.PI * 2;
  const radius = MOB_SPAWN_MIN_RADIUS +
    Math.random() * (MOB_SPAWN_MAX_RADIUS - MOB_SPAWN_MIN_RADIUS);
  const x = Math.floor(walkerNow().pos.x + Math.cos(angle) * radius);
  const z = Math.floor(walkerNow().pos.z + Math.sin(angle) * radius);

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

    const type = pickHostileType();
    const spot = hostileSpotFor(type, x, y + 1, z);
    // A spider is wider than a block: where no 2x2 corner of the spot is
    // clear either, a zombie takes the spot instead.
    if (!spot) return spawnMob('zombie', x + 0.5, y + 1, z + 0.5);
    return spawnMob(type, spot.x, y + 1, spot.z);
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
  if (!mobSpawningOn) return false;
  if (chunk.mobSpawnChecked) return false;
  // The only gate this needs is its own cap: PASSIVE_CAP and HOSTILE_CAP are
  // sized to fit inside MOB_CAP together, so a full herd can never be what
  // leaves no room for a night spawn.
  if (countMobs(false) >= PASSIVE_CAP) return false;

  const centerX = chunk.cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const centerZ = chunk.cz * CHUNK_SIZE + CHUNK_SIZE / 2;
  if (Math.hypot(centerX - walkerNow().pos.x, centerZ - walkerNow().pos.z) > PASSIVE_SPAWN_RADIUS) {
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
  chunk.herdSpentAt = herdClock;

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
    if (Math.hypot(wx + 0.5 - walkerNow().pos.x, wz + 0.5 - walkerNow().pos.z) < 6) continue;

    spot = { x: wx + 0.5, y: y + 1, z: wz + 0.5 };
    break;
  }
  if (!spot) return false;

  let type;
  const roll = rand();
  // Chickens are the only source of feathers, so every grassy biome keeps
  // them common; cows and pigs share what is left.
  if (column.biome === 'rainforest') {
    type = roll < 0.6 ? 'chicken' : roll < 0.82 ? 'pig' : 'cow';
  } else if (column.biome === 'forest') {
    type = roll < 0.4 ? 'chicken' : roll < 0.6 ? 'cow' : roll < 0.8 ? 'pig' : 'sheep';
  } else {
    type = roll < 0.3 ? 'chicken' : roll < 0.55 ? 'cow' : roll < 0.75 ? 'pig' : 'sheep';
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

/**
 * Whether a chunk's herd roll is free to be taken: never spent, or spent on
 * grass a game day ago with none of the animals it gave still walking about,
 * so a herd that is still alive never gets a twin. Desert, snow and ocean
 * chunks never record a spend, so they never come back. Changes nothing.
 */
export function herdRollReady(chunk) {
  if (!chunk.mobSpawnChecked) return true;
  if (chunk.herdSpentAt == null) return false;
  if (herdClock - chunk.herdSpentAt < HERD_REGROW_SECONDS) return false;
  const key = chunkKey(chunk.cx, chunk.cz);
  for (const mob of mobs) if (mob.spawnChunk === key) return false;
  return true;
}

/** Like `herdRollReady`, but a chunk whose herd has grown back is reopened. */
function herdRollOpen(chunk) {
  if (!herdRollReady(chunk)) return false;
  chunk.mobSpawnChecked = false;
  chunk.herdSpentAt = null;
  return true;
}

/** Moves the herd clock on, for a check that cannot wait a game day. */
export function advanceHerdClock(seconds) {
  herdClock += Math.max(0, seconds);
  return herdClock;
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

  const pcx = Math.floor(walkerNow().pos.x / CHUNK_SIZE);
  const pcz = Math.floor(walkerNow().pos.z / CHUNK_SIZE);

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
    if (!chunk || !chunk.meshed || !herdRollOpen(chunk)) continue;

    if (rollChunkHerd(chunk)) return mobs[mobs.length - 1];
  }
  return null;
}
