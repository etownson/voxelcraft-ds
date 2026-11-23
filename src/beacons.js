/*
 * The mission's bones: spawn point 0 (SP0), the five beacon monuments that
 * stand between SP0 and the far edge of the world, and the progress of lighting
 * them one by one.
 *
 * SP0 is the column the walker first touched down on, and everything the design
 * measures is measured from it: where the monuments stand, what essence each
 * one wants, and how mean the enemies out that way have gotten. Because the
 * world streams in and out of memory, the monuments cannot be placed by
 * walking over to a spot and building: their positions are a pure function of
 * the seed and SP0 — the same kind of answer world generation gives — and they
 * are laid down as stored edits, the very ones the save keeps, so every chunk
 * that ever regenerates puts them back exactly where they were planted. The
 * search for a column refuses water, cliffs, trees and cave mouths, which is
 * what the design means by positions that "make sense".
 *
 * Lighting is this layer's whole verb. A right-click on a dark monument asks
 * the essence purse for the beacon's price — about thirty kills' worth on
 * the ground of the beacon before it —
 * and pays it: the block swaps to its lit id, a beam rises off it into the
 * sky, the recipes of the next transmission land in the journal, and the page
 * is handed the transmission's words and the next beacon's price. The
 * order is the mission: beacon 2 will not answer until beacon 1 runs.
 */

import * as THREE from 'three';
import { BLOCKS } from './blocks.js';
import { markWorldDirty, world } from './chunks.js';
import { setRecipesTransmitted } from './crafting.js';
import {
  B, BEACON_COLORS, BEACON_COUNT, BEACON_ESSENCE_PER_BLOCK, BEACON_KILLS_TO_LIGHT,
  BEACON_OUTWARD_BEARING, DIFFICULTY_ESSENCE_SCALE, HOSTILE_ESSENCE_AVERAGE,
  BEACON_TARGET_HOPS, CHUNK_SIZE,
  DIFFICULTY_MAX, DIFFICULTY_XZ_STEP, DIFFICULTY_Y_STEP, SEA_LEVEL, WORLD_HEIGHT,
  WORLD_SEED, blockIndex, clamp
} from './config.js';
import { essenceCount, spendEssence } from './essence.js';
import { spawnBurstParticles } from './fx.js';
import { hash3i, mulberry32 } from './noise.js';
import { scene } from './render.js';
import { say } from './say.js';
import { caveCarvesAt, sampleColumn, treeAt } from './worldgen.js';
import { playBeaconSound } from './audio.js';

/**
 * The bubble that meets the walker at SP0, before any beacon has been found:
 * the mission, told spotty, because the line is bad rather than the sender.
 *
 * The sender's feelings are spelled with emoji, sparingly: one per line at
 * most, on the words that carry the weight — the apology, the promise, the
 * thanks. They are picked from the astral planes (each one two halves of a
 * character in a JavaScript string), and `hud.js` types them a cluster at a
 * time so they land whole rather than as the boxes an emoji split down the
 * middle makes. The line noise never touches them either: it swaps letters
 * inside runs of A-Z only.
 */
export const SPAWN_TRANSMISSION = [
  'Can you hear me? 📡 The teleport held. Good.',
  'You are disoriented. That is the teleport. It fades. Listen instead.',
  'You were sent here to bring the beacons back online. All of them.',
  'One stands near where you fell. Find it. That is the first step.',
  'This is urgent. I cannot say why. Go.'
];

/**
 * What each activation carries over the air, one block per beacon, in the
 * order the design writes the transmissions down. The story arrives spotty;
 * the essentials do not. `transmissions.js` keeps the same words whole for the
 * journal's second page, which is why these are the mission's own record and
 * not the panel's.
 */
export const TRANSMISSIONS = [
  [
    'You lit it. 💠 The grid stirs. I have recipes queued — they are in your journal now.',
    'I am sorry. 💔 You are flesh in that world: it will want feeding, and it can be hurt.',
    'The creatures are worst after dark and grow stronger the further you venture. Do not hide from them. Essence is what they pay.',
    'Find the second beacon. We are preparing it with more recipes. Build a shelter before you light it. Promise me. 🤝',
    'And watch the sun. 🌙 Before it sets, have torches lit, a door hung and something cooked to eat. Night comes faster than you think.'
  ],
  [
    'Two of five. 🌄 The world is waking past this valley.',
    'The chaos you see has a history. It was made, not born. More of it once you are ready.',
    'You will want to farm: sow seeds on tilled soil beside water, and the wheat will rise.',
    'More recipes are in the journal. The next beacon is farther out. Be brave. 💪'
  ],
  [
    'Three. The far grid hums now, and the creatures with it.',
    'Where I come from, this was the part that went wrong. We are out of second chances. 🕯',
    'Iron will carry you farther than wood ever did. More is in the journal.',
    'The next beacon stands at the edge of everything I can see for you.'
  ],
  [
    'Four! One left, and it is the farthest. Listen.',
    'This time will be different for this world. I have staked everything on it.',
    'Diamond cuts whatever the last valley holds between you and the finish. 💎',
    'Find it. Finish it. 🔥'
  ],
  [
    'Five! All five! 🎉🎉🎉🎉!',
    'The teleport lattice is whole. You can go home a hero, and the way stays open.',
    'Or stay. Finish the base. Make it ready for the colonizers behind you. 🏠',
    'Whatever you choose: thank you. 🙏'
  ]
];

/* ---------- SP0 and the five columns ---------- */

/* The column the walker landed on, and the monuments measured from it. Both
   are set once at bootstrap — from the save when there is one, from the chosen
   spawn when there is not — and the save keeps them, because a world whose
   SP0 moves is a different world. */
let spawnPoint0 = { x: 0, z: 0 };
let sites = null;
let beaconsActivated = 0;

/** The mission readout's place on the page, painted through this at bootstrap. */
let paintMission = () => {};

/** The page says where the beacon readout is drawn. */
export function setBeaconPainter(paint) { paintMission = paint; }

/* A transmission is a block of lines, not a single toast. Whoever shows the
   page takes the whole message at bootstrap; until then the words are said a
   line at a time, which still carries them. */
let deliverTransmission = (lines) => { for (const line of lines) say(line); };

/** The page says how a transmission is delivered. */
export function setTransmissionDeliverer(deliver) { deliverTransmission = deliver; }

/** Whether a column can hold a monument: dry, flat, treeless and cave-tight. */
function monumentGround(x, z) {
  const column = sampleColumn(x, z);
  if (column.height <= SEA_LEVEL + 1) return null;
  if (column.height > WORLD_HEIGHT - 16) return null;

  // A shallow step in the ground is fine; a shelf the platform overhangs is not.
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(sampleColumn(x + dx, z + dz).height - column.height) > 2) return null;
    }
  }
  // Canopies would swallow the monument, and cave mouths leave the platform
  // standing over a hole.
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (treeAt(x + dx, z + dz)) return null;
    }
  }
  for (let y = column.height - 4; y <= column.height; y++) {
    if (caveCarvesAt(x, y, z)) return null;
  }
  return column;
}

/**
 * One monument column per beacon, a pure function of the seed, SP0 and the
 * beacon number. The mission is a chain of legs: beacon 1 stands its hop from
 * SP0, and each monument after it stands its hop from the one before. The
 * bearing starts at random and swings no more than BEACON_OUTWARD_BEARING off
 * the direction the chain is already heading, so the line of monuments runs
 * outward instead of curling back over ground the walker has worked.
 */
function chooseMonumentColumns() {
  const chosen = [];
  let from = { x: spawnPoint0.x, z: spawnPoint0.z };
  let bearing = null;

  for (let index = 0; index < BEACON_COUNT; index++) {
    const rand = mulberry32(hash3i(
      spawnPoint0.x, index, spawnPoint0.z, (WORLD_SEED ^ 0xBEA90001) >>> 0
    ));
    const hop = BEACON_TARGET_HOPS[index];
    const jitter = (rand() - 0.5) * BEACON_OUTWARD_BEARING * 2;
    if (bearing === null) bearing = rand() * Math.PI * 2;
    const base = bearing + jitter;

    let placed = null;
    // Walk the rings out from the leg's length: one step nearer, one farther,
    // and so on, six blocks at a time, sampling each ring every quarter turn or
    // so. The samples drift by the ring number so a ring the ground refuses
    // does not keep offering the same four columns.
    for (let ring = 0; ring < 28 && !placed; ring++) {
      const radius = hop + (ring % 2 === 0 ? -1 : 1) * Math.ceil(ring / 2) * 6;
      if (radius < 12) continue;
      const samples = Math.max(12, Math.round(radius / 3));
      for (let i = 0; i < samples && !placed; i++) {
        const angle = base + (i / samples) * Math.PI * 2 + ring * 0.7;
        const x = Math.round(from.x + Math.cos(angle) * radius);
        const z = Math.round(from.z + Math.sin(angle) * radius);
        const ground = monumentGround(x, z);
        if (!ground) continue;
        placed = monumentSite(index, from, x, z, ground.height);
      }
    }
    // A seed that refuses every column cannot stop the mission: fall back to
    // the exact leg length on the chosen bearing, and accept wet ground before
    // the platform fails to exist at all.
    if (!placed) {
      for (let step = 0; step < 8 && !placed; step++) {
        const radius = hop + (step === 0 ? 0 : (step % 2 === 0 ? -1 : 1) * step * 12);
        const x = Math.round(from.x + Math.cos(base) * radius);
        const z = Math.round(from.z + Math.sin(base) * radius);
        const ground = step < 5 ? monumentGround(x, z) : sampleColumn(x, z);
        if (!ground) continue;
        placed = monumentSite(index, from, x, z, Math.max(ground.height, SEA_LEVEL + 1));
      }
    }
    chosen.push(placed);
    // The chain keeps its heading: the next leg leaves from this monument,
    // pointed the way the last one travelled.
    bearing = Math.atan2(placed.z - from.z, placed.x - from.x);
    from = { x: placed.x, z: placed.z };
  }
  return chosen;
}

/**
 * What a monument knows about itself: where it stands, the leg that reaches it
 * and the price asked there. Beacon 1 asks for its distance from SP0, which is
 * what the purse opens with. Every later beacon asks for about
 * `BEACON_KILLS_TO_LIGHT` kills' essence on the surface where the one before
 * it stands (`from`), so each is the same hunt in the zone the walker has
 * just unlocked, however far apart the monuments fall.
 */
function monumentSite(index, from, x, z, height) {
  const hop = Math.round(Math.hypot(x - from.x, z - from.z));
  const distance = Math.round(Math.hypot(x - spawnPoint0.x, z - spawnPoint0.z));
  let cost;
  if (index === 0) {
    cost = Math.max(4, Math.round(distance / BEACON_ESSENCE_PER_BLOCK));
  } else {
    const perKill = HOSTILE_ESSENCE_AVERAGE *
      (1 + DIFFICULTY_ESSENCE_SCALE * difficultyAt(from.x, SEA_LEVEL, from.z));
    cost = Math.round(BEACON_KILLS_TO_LIGHT * perKill);
  }
  return { index, x, z, y: height, hop, distance, cost };
}

/** The five monument columns, computed once per world. */
export function beaconSites() {
  if (!sites) sites = chooseMonumentColumns();
  return sites;
}

/** Where the walker first fell. Enemy difficulty and every beacon lean on this. */
export function spawnPoint() { return { ...spawnPoint0 }; }

/** Records SP0 and resets the site lookup around it. */
export function setSpawnPoint0(sp) {
  spawnPoint0 = { x: Math.trunc(sp.x) || 0, z: Math.trunc(sp.z) || 0 };
  sites = null;
}

/**
 * The difficulty the ground at a point asks for: X and Z travel from SP0
 * always, and depth below sea level only after the walker has gone under it —
 * one unit per step constant, capped, so the far corners stay survivable.
 */
export function difficultyAt(x, y, z) {
  const horiz = Math.hypot(x - spawnPoint0.x, z - spawnPoint0.z) / DIFFICULTY_XZ_STEP;
  const depth = y < SEA_LEVEL ? (SEA_LEVEL - y) / DIFFICULTY_Y_STEP : 0;
  return clamp(horiz + depth, 0, DIFFICULTY_MAX);
}

/* ---------- Planting the monuments ---------- */

/**
 * Lay every monument into the override tables, the way a save edit lands:
 * chunks regenerate them forever, and nothing has to be built while loaded.
 * A cell the world already remembers keeps its memory — a lit beacon stays
 * lit across a reseed.
 */
export function plantBeaconMonuments() {
  for (const site of beaconSites()) {
    const blocks = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        blocks.push([site.x + dx, site.y, site.z + dz, B.COBBLESTONE]);
      }
    }
    // Replace the centre's plinth stone with the machine standing on it.
    blocks.push([site.x, site.y + 1, site.z,
      beaconsActivated > site.index ? B.BEACON_ACTIVE : B.BEACON]);
    for (const [x, y, z, id] of blocks) {
      const key = x + ',' + y + ',' + z;
      if (world.overrides.has(key)) continue;
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      const lx = x - cx * CHUNK_SIZE;
      const lz = z - cz * CHUNK_SIZE;
      world.loadSavedOverride(cx, cz, blockIndex(lx, y, lz), id);
    }
  }
  // The plinth under the beacon is cobblestone either way; only the beacon
  // cell itself cares about the progress count, and it reads the count as it
  // was when the monument was planted. A later activation is a real edit.
}

/* ---------- Lighting ---------- */

/** The site whose beacon block stands at this cell, or -1 for none. */
export function beaconSiteAt(x, y, z) {
  const id = world.getBlock(x, y, z);
  if (!BLOCKS[id] || BLOCKS[id].beacon === null) return -1;
  for (const site of beaconSites()) {
    if (site.x === x && site.y + 1 === y && site.z === z) return site.index;
  }
  return -1;
}

/** How many monuments are running. */
export function beaconsActivatedCount() { return beaconsActivated; }

/** The beacon the mission is on next, or null when the last one already runs. */
export function nextBeacon() {
  const sitesNow = beaconSites();
  return beaconsActivated < sitesNow.length ? sitesNow[beaconsActivated] : null;
}

/**
 * Threat zones belong to the beacons: zone 0 is SP0's ground, zone 1 beacon
 * 1's, and so on, each running halfway to its neighbours so the beacon stands
 * in the middle of its own zone; the last runs on past the final monument.
 * Distance is the same difficulty the mobs use, so going below sea level
 * pushes the walker outward too.
 */
export function threatZoneAt(x, y, z) {
  const here = difficultyAt(x, y, z);
  let zone = 0;
  let previous = 0; // SP0's difficulty
  for (const site of beaconSites()) {
    const next = difficultyAt(site.x, site.y + 1, site.z);
    if (here < (previous + next) / 2) break;
    zone++;
    previous = next;
  }
  return zone;
}

/** How many threat zones there are: SP0's and one per beacon. */
export function threatZoneCount() { return beaconSites().length + 1; }

/** The zone the mission has reached: the most recently lit beacon's, or SP0's. */
export function frontierZone() { return beaconsActivated; }

/**
 * The starting purse, for a world that has not had a kill yet: the design
 * says the walker begins with just enough for one activation — beacon 1's.
 */
export function startingEssence() { return beaconSites()[0].cost; }

/**
 * Right-click on a beacon cell. Every refusal still answers true — the click
 * reached a beacon and the beacon spoke — so the click never also places the
 * held block against the transmitter's machine.
 */
export function tryLightBeacon(x, y, z) {
  const index = beaconSiteAt(x, y, z);
  if (index < 0) return false;
  const site = beaconSites()[index];

  if (world.getBlock(x, y, z) === B.BEACON_ACTIVE) {
    say('This beacon is already lit. It answers.');
    return true;
  }
  if (index !== beaconsActivated) {
    say('Dark and quiet. The transmission wants a different beacon.');
    return true;
  }

  const carried = essenceCount();
  if (carried < site.cost) {
    say('This beacon wants ' + site.cost + ' essence. You carry ' + carried + '.');
    return true;
  }

  spendEssence(site.cost);
  world.setBlock(x, y, z, B.BEACON_ACTIVE);
  beaconsActivated = index + 1;
  setRecipesTransmitted(beaconsActivated);
  markWorldDirty();

  raiseBeaconBeam(site);
  spawnBurstParticles(x + 0.5, y + 1.2, z + 0.5, beaconColor(site.index), 24, 4.2);
  playBeaconSound();

  deliverTransmission(TRANSMISSIONS[index]);
  const next = nextBeacon();
  if (next) {
    // No coordinates: the HUD arrow points the way, and the menu's mission
    // page keeps the price.
    say('The next beacon wants ' + next.cost + ' essence. Follow the arrow.');
  }
  paintMission();
  return true;
}

/**
 * Put the mission back the way a save left it: the count, and a beam on every
 * monument the count says is running. The blocks themselves come back with the
 * saved edits.
 */
export function restoreBeaconProgress(activated) {
  beaconsActivated = clamp(Math.trunc(Number(activated) || 0), 0, BEACON_COUNT);
  setRecipesTransmitted(beaconsActivated);
  for (const site of beaconSites()) {
    if (site.index < beaconsActivated) raiseBeaconBeam(site);
  }
  paintMission();
}

/* ---------- The beams ---------- */

/* A lit beacon puts a column of light up out of itself, drawn here rather than
   in any chunk: its position is known whether or not the monument's column is
   in memory, and a beam the renderer only sees when the ground is loaded
   would be a beam that flickers on a long walk home. */
/* The colour this monument wears when it runs. A mission with more monuments
   than there are colours keeps the original teal rather than going colourless. */
function beaconColor(index) {
  return BEACON_COLORS[index] ?? 0x8fe8f2;
}

const beams = new Map();
const beamMaterials = new Map();
let beamGeometries = null;

/* One pair of materials per colour, shared by whichever monument wears it. The
   wide shell adds its light over everything behind it, and the narrower core is
   the part whose hue survives a bright daytime sky: additive alone washes an
   orange column to near-white against the blue, which is how all five beams
   used to read the same. */
function beamMaterialsFor(color) {
  const cached = beamMaterials.get(color);
  if (cached) return cached;
  const pair = {
    glow: new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    }),
    core: new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.62, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.NormalBlending, fog: false
    })
  };
  beamMaterials.set(color, pair);
  return pair;
}

function raiseBeaconBeam(site) {
  const key = site.x + ',' + site.z;
  if (beams.has(key)) return;
  if (!beamGeometries) {
    // Open-ended cylinders from the emitter to the top of the world: eight
    // faces each, double-sided, and shared by all five monuments.
    beamGeometries = {
      glow: new THREE.CylinderGeometry(0.45, 0.45, WORLD_HEIGHT, 8, 1, true),
      core: new THREE.CylinderGeometry(0.24, 0.24, WORLD_HEIGHT, 8, 1, true)
    };
  }
  const materials = beamMaterialsFor(beaconColor(site.index));
  const beam = new THREE.Group();
  const glow = new THREE.Mesh(beamGeometries.glow, materials.glow);
  const core = new THREE.Mesh(beamGeometries.core, materials.core);
  // The core is drawn last so the hue sits inside the bloom rather than under
  // it, whichever order the renderer decides to walk the transparent list in.
  glow.renderOrder = 1;
  core.renderOrder = 2;
  beam.add(glow, core);
  beam.position.set(site.x + 0.5, site.y + 1 + WORLD_HEIGHT / 2, site.z + 0.5);
  scene.add(beam);
  beams.set(key, beam);
}

/** Take every beam down again, for a debug rewind of the mission count. */
export function clearBeaconBeams() {
  for (const beam of beams.values()) scene.remove(beam);
  beams.clear();
}

/** The mission's picture, for the debug hook and the page's readout. */
export function beaconReport() {
  return {
    sp0: { ...spawnPoint0 },
    activated: beaconsActivated,
    sites: beaconSites().map((site) => ({
      index: site.index,
      at: [site.x, site.y + 1, site.z],
      hop: site.hop,
      distance: site.distance,
      cost: site.cost,
      lit: site.index < beaconsActivated
    })),
    next: nextBeacon() ? {
      at: [nextBeacon().x, nextBeacon().y + 1, nextBeacon().z],
      cost: nextBeacon().cost
    } : null
  };
}
