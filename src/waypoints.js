/*
 * Where the HUD arrow points. A waypoint is a place the walker wants to get
 * back to: the next beacon the transmission wants, one already lit, or a spot
 * they stood on and named themselves.
 *
 * The beacons are read live from the mission layer, so the "next beacon"
 * target moves on by itself the moment one is lit. Only the saved spots and
 * the choice of target are this layer's own.
 *
 * They are kept under their own localStorage key, not in the world save. The
 * save is refused whole when its shape changes (see SAVE_KEY in save.js), and a
 * list of named places is not worth losing a world over, nor a world worth
 * losing over it. The record carries the seed and SP0 it was written for, so a
 * list from a different world is ignored rather than pointing somewhere
 * meaningless, and Reset world forgets it outright.
 *
 * Nothing here holds an element. The HUD paints the arrow and the menu draws
 * the list, both from what this layer answers.
 */

import { beaconSites, beaconsActivatedCount, nextBeacon, spawnPoint } from './beacons.js';
import { WORLD_SEED } from './config.js';
import { registerWorldKey, worldKey } from './worlds.js';

/** Each world keeps its own list: the default world under this key, the rest under `:<id>`. */
export const WAYPOINTS_KEY = 'voxelcraft:waypoints:v1';
registerWorldKey(WAYPOINTS_KEY);
const ACTIVE_WAYPOINTS_KEY = worldKey(WAYPOINTS_KEY);
const LABEL_MAX = 32;
const SAVED_MAX = 50;

/** The target the arrow follows: 'next', 'beacon:N', 'saved:ID' or 'none'. */
let active = 'next';
let saved = [];
let nextId = 1;

function storageGet() {
  try { return window.localStorage.getItem(ACTIVE_WAYPOINTS_KEY); } catch (unavailable) { return null; }
}

function storageSet(json) {
  try { window.localStorage.setItem(ACTIVE_WAYPOINTS_KEY, json); } catch (unavailable) {}
}

function storageRemove() {
  try { window.localStorage.removeItem(ACTIVE_WAYPOINTS_KEY); } catch (unavailable) {}
}

function persist() {
  const sp0 = spawnPoint();
  storageSet(JSON.stringify({ seed: WORLD_SEED, sp0, active, list: saved }));
}

function cleanLabel(label) {
  return String(label == null ? '' : label).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
}

/**
 * Reads the list back for the world now loaded. Called once SP0 is known,
 * because SP0 is what says the list belongs to this world.
 */
export function loadWaypoints() {
  active = 'next';
  saved = [];
  nextId = 1;
  let data = null;
  try { data = JSON.parse(storageGet() || 'null'); } catch (broken) { data = null; }
  if (!data || data.seed !== WORLD_SEED || !data.sp0) return;
  const sp0 = spawnPoint();
  if (data.sp0.x !== sp0.x || data.sp0.z !== sp0.z) return;

  if (Array.isArray(data.list)) {
    for (const entry of data.list.slice(0, SAVED_MAX)) {
      if (!entry) continue;
      const x = Number(entry.x);
      const y = Number(entry.y);
      const z = Number(entry.z);
      const id = Math.trunc(Number(entry.id));
      if (![x, y, z].every(Number.isFinite) || !(id > 0)) continue;
      saved.push({ id, label: cleanLabel(entry.label) || 'Waypoint ' + id, x, y, z });
      nextId = Math.max(nextId, id + 1);
    }
  }
  if (typeof data.active === 'string') active = data.active;
  if (!resolve(active) && active !== 'none') active = 'next';
}

/** New world: the list goes with it. */
export function forgetWaypoints() {
  active = 'next';
  saved = [];
  nextId = 1;
  storageRemove();
}

/**
 * Names the spot. A blank label gets a number, so a pad, which has nothing to
 * type with, can still save one. Coordinates are kept whole blocks plus the
 * height the walker's feet were at.
 */
export function saveWaypoint(label, x, y, z) {
  if (saved.length >= SAVED_MAX) return null;
  const id = nextId++;
  const entry = {
    id,
    label: cleanLabel(label) || 'Waypoint ' + id,
    x: Math.floor(x) + 0.5,
    y: Math.round(y * 10) / 10,
    z: Math.floor(z) + 0.5
  };
  saved.push(entry);
  persist();
  return { ...entry };
}

export function deleteWaypoint(id) {
  const at = saved.findIndex((entry) => entry.id === id);
  if (at < 0) return false;
  saved.splice(at, 1);
  if (active === 'saved:' + id) active = 'next';
  persist();
  return true;
}

function beaconTarget(site, label) {
  return { label, x: site.x + 0.5, y: site.y + 1.5, z: site.z + 0.5 };
}

function resolve(key) {
  if (key === 'next') {
    const next = nextBeacon();
    return next ? beaconTarget(next, 'Beacon ' + (next.index + 1)) : null;
  }
  let match = /^beacon:(\d+)$/.exec(key);
  if (match) {
    const index = Number(match[1]);
    const site = beaconSites()[index];
    if (!site || index >= beaconsActivatedCount()) return null;
    return beaconTarget(site, 'Beacon ' + (index + 1));
  }
  match = /^saved:(\d+)$/.exec(key);
  if (match) {
    const entry = saved.find((e) => e.id === Number(match[1]));
    return entry ? { label: entry.label, x: entry.x, y: entry.y, z: entry.z } : null;
  }
  return null;
}

/**
 * Everything the arrow could follow, in the order the menu lists it: the next
 * beacon, the lit ones, then the walker's own spots. Each carries the key
 * that picks it and whether it is the one picked.
 */
export function waypointTargets() {
  const list = [];
  const next = nextBeacon();
  if (next) {
    list.push({ key: 'next', kind: 'next', label: 'Next beacon (' + (next.index + 1) + ' of ' +
      beaconSites().length + ')' });
  }
  const lit = beaconsActivatedCount();
  for (const site of beaconSites()) {
    if (site.index >= lit) continue;
    list.push({ key: 'beacon:' + site.index, kind: 'beacon',
      label: 'Beacon ' + (site.index + 1) + ' · lit' });
  }
  for (const entry of saved) {
    list.push({ key: 'saved:' + entry.id, kind: 'saved', id: entry.id, label: entry.label,
      x: Math.floor(entry.x), y: Math.round(entry.y), z: Math.floor(entry.z) });
  }
  for (const target of list) target.active = target.key === active;
  return list;
}

/** What a spot saved now without a label would be called. */
export function nextWaypointLabel() { return 'Waypoint ' + nextId; }

/** Picks what the arrow follows; 'none' puts it away. */
export function setActiveWaypoint(key) {
  if (key !== 'none' && !resolve(key)) return false;
  active = key;
  persist();
  return true;
}

export function activeWaypointKey() { return active; }

/** The place the arrow points at now, or null when there is nowhere to point. */
export function activeWaypoint() {
  return active === 'none' ? null : resolve(active);
}
