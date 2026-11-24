/*
 * Which world this page is: the list of worlds the browser keeps, each with a
 * name and a seed, and the one of them that is being played. Everything the
 * world is made of is generated from its seed at the moment the modules load
 * (the noise, the chunk table, the beacon sites), so a world is chosen before
 * any of them evaluate and changing world is a reload, never a swap in place.
 *
 * The first world a browser ever had is `default`. It keeps seed 20261116 and
 * every storage key it had before there were other worlds, so an old save is
 * simply that world, and the snapshot guard still runs on it. Any other world
 * keeps the same records under the same keys with `:<id>` on the end:
 * `worldKey(base, id)`. A module that keeps something per world registers its
 * base key here, and deleting a world removes that key for it.
 *
 * A `#join=CODE` link is a visit to somebody else's world, not one of these.
 * The page boots a guest world that lives for that page alone: its seed comes
 * from the link's `seed=` when it has one, and its keys are the room's, so a
 * visit never touches a world of the visitor's own.
 *
 * This module imports nothing, so config.js can read the seed from it.
 */

const REGISTRY_KEY = 'voxelcraft:worlds:v1';
const LEGACY_HOST_CODE_KEY = 'voxelcraft:coop:hostCode';
export const DEFAULT_WORLD_ID = 'default';
export const DEFAULT_WORLD_SEED = 20261116;
const NAME_MAX = 32;

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (unavailable) { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch (unavailable) { return false; }
}
function storageRemove(key) {
  try { window.localStorage.removeItem(key); } catch (unavailable) {}
}

function cleanName(name, fallback) {
  const clean = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return clean || fallback;
}

function defaultEntry() {
  return {
    id: DEFAULT_WORLD_ID,
    name: 'My first world',
    seed: DEFAULT_WORLD_SEED,
    createdAt: 0,
    lastPlayedAt: 0,
    // The room code this browser hosted under before worlds had their own,
    // so the links friends already saved still open this world.
    hostCode: storageGet(LEGACY_HOST_CODE_KEY) || null
  };
}

function readRegistry() {
  let data = null;
  try { data = JSON.parse(storageGet(REGISTRY_KEY) || 'null'); } catch (broken) { data = null; }
  const list = [];
  if (data && Array.isArray(data.list)) {
    for (const entry of data.list) {
      if (!entry || typeof entry.id !== 'string' || !Number.isFinite(entry.seed)) continue;
      if (list.some((w) => w.id === entry.id)) continue;
      list.push({
        id: entry.id,
        name: cleanName(entry.name, 'World'),
        seed: entry.seed >>> 0,
        createdAt: Number(entry.createdAt) || 0,
        lastPlayedAt: Number(entry.lastPlayedAt) || 0,
        hostCode: typeof entry.hostCode === 'string' ? entry.hostCode : null
      });
    }
  }
  if (!list.some((w) => w.id === DEFAULT_WORLD_ID)) list.unshift(defaultEntry());
  const active = data && list.some((w) => w.id === data.active) ? data.active : DEFAULT_WORLD_ID;
  return { active, list };
}

let registry = readRegistry();

function writeRegistry() {
  return storageSet(REGISTRY_KEY, JSON.stringify(registry));
}

/* ---------- The world this page is ---------- */

/** The room a `#join=CODE` link names, as typed, or null. */
function linkJoinCode() {
  const match = /(?:^#|&)join=([A-Za-z0-9-]+)/.exec(window.location.hash || '');
  return match ? match[1].toUpperCase() : null;
}

/** The seed a `#join=CODE&seed=N` link carries, or null. */
function linkSeed() {
  const match = /(?:^#|&)seed=(\d{1,10})(?:&|$)/.exec(window.location.hash || '');
  if (!match) return null;
  const seed = Number(match[1]);
  return Number.isFinite(seed) ? seed >>> 0 : null;
}

function resolveActive() {
  const own = registry.list.find((w) => w.id === registry.active) || registry.list[0];
  const code = linkJoinCode();
  if (!code) return { ...own, guest: false };
  const seed = linkSeed();
  return {
    id: 'guest:' + code,
    name: 'Visiting room ' + code,
    seed: seed == null ? own.seed : seed,
    // Whether the seed came from the link: a guest who joined on a guess and
    // found the host elsewhere reloads once with the host's seed, and only once.
    seedFromLink: seed != null,
    createdAt: 0,
    lastPlayedAt: 0,
    hostCode: null,
    guest: true
  };
}

const active = resolveActive();

/** The world this page was booted into. Fixed for the life of the page. */
export function activeWorld() { return active; }

/** The key a per-world record of `base` lives under for world `id`. */
export function worldKey(base, id = active.id) {
  return id === DEFAULT_WORLD_ID ? base : base + ':' + id;
}

const perWorldKeys = new Set();

/** A module keeping a per-world record under `base` says so here. */
export function registerWorldKey(base) { perWorldKeys.add(base); }

/* ---------- The list ---------- */

/** Every world of this browser's own, newest played first, the current one marked. */
export function listWorlds() {
  return registry.list
    .map((w) => ({ ...w, current: !active.guest && w.id === active.id }))
    .sort((a, b) => (b.lastPlayedAt - a.lastPlayedAt) || (a.createdAt - b.createdAt));
}

/**
 * The seed a typed line means: a whole number is itself, any other text is
 * hashed, so "ingrid" is always the same world, and nothing at all is random.
 */
export function seedFromText(text) {
  const clean = String(text == null ? '' : text).trim();
  if (!clean) {
    const word = new Uint32Array(1);
    crypto.getRandomValues(word);
    return word[0];
  }
  if (/^\d{1,10}$/.test(clean) && Number(clean) <= 0xFFFFFFFF) return Number(clean) >>> 0;
  // FNV-1a over the UTF-16 units.
  let hash = 0x811C9DC5;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function newId() {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return 'w' + Date.now().toString(36) + word[0].toString(36);
}

/** Adds a world with this name and numeric seed; answers its record, or null if storage refused. */
export function createWorld(name, seed) {
  const entry = {
    id: newId(),
    name: cleanName(name, 'World ' + (registry.list.length + 1)),
    seed: seed >>> 0,
    createdAt: Date.now(),
    lastPlayedAt: 0,
    hostCode: null
  };
  registry.list.push(entry);
  if (!writeRegistry()) {
    registry.list.pop();
    return null;
  }
  return { ...entry };
}

export function renameWorld(id, name) {
  const entry = registry.list.find((w) => w.id === id);
  if (!entry) return false;
  entry.name = cleanName(name, entry.name);
  if (id === active.id) active.name = entry.name;
  return writeRegistry();
}

/** Removes a world and every per-world record it kept. Never the one being played. */
export function deleteWorld(id) {
  if (id === active.id) return false;
  const at = registry.list.findIndex((w) => w.id === id);
  if (at < 0) return false;
  registry.list.splice(at, 1);
  // The default world can go too; the registry brings back an empty one
  // under the same id the next time it is read.
  for (const base of perWorldKeys) storageRemove(worldKey(base, id));
  if (registry.active === id) registry.active = active.guest ? DEFAULT_WORLD_ID : active.id;
  writeRegistry();
  return true;
}

/** Makes `id` the world the next load boots, and loads it. Saving first is the caller's. */
export function switchToWorld(id) {
  if (!registry.list.some((w) => w.id === id)) return false;
  registry.active = id;
  writeRegistry();
  // A visit's link would only join the room again.
  window.history.replaceState(null, '', window.location.origin + window.location.pathname + window.location.search);
  window.location.reload();
  return true;
}

/** The world being played was played just now. A visit is nobody's to mark. */
export function markWorldPlayed() {
  if (active.guest) return;
  const entry = registry.list.find((w) => w.id === active.id);
  if (!entry) return;
  entry.lastPlayedAt = Date.now();
  writeRegistry();
}

/** The room code this world is hosted under for good, or null before it first is. */
export function worldHostCode() {
  if (active.guest) return null;
  const entry = registry.list.find((w) => w.id === active.id);
  return entry ? entry.hostCode : null;
}

export function setWorldHostCode(code) {
  if (active.guest) return;
  const entry = registry.list.find((w) => w.id === active.id);
  if (!entry) return;
  entry.hostCode = code;
  active.hostCode = code;
  writeRegistry();
}
