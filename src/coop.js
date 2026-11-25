/*
 * Co-op: keeping one world in step across the browsers in a room. The wire
 * itself is net.js; this layer decides what goes over it and what each
 * message does when it lands.
 *
 * The host's browser owns the world. It keeps the save, thinks for every mob
 * and keeps the clock, and a guest joining is handed the host's world whole
 * before its own boot goes on. After that, each kind of thing has one rule:
 *
 * - Blocks: whoever changes one tells everyone, and everyone applies it.
 *   Water then flows the same way in every browser, because it is a function
 *   of the blocks alone, so flowing water is never sent.
 * - Players: each browser sends its own walker's pose a dozen times a second
 *   and draws everyone else's (remote-players.js).
 * - Mobs: only the host's mobs think. The host sends where they all are, and
 *   a guest draws them as pictures. A guest's hit is sent to the host to
 *   apply, and a mob's bite on a guest is sent to that guest to feel.
 * - Loot: every drop exists in one browser only. A block breaks into the
 *   breaker's world, and a mob a guest killed drops into that guest's world,
 *   so nothing is ever picked up twice.
 * - Containers: whoever has a chest or furnace open sends its contents when
 *   they change, and everyone else takes them.
 * - The mission and the clock: a beacon lit anywhere is lit everywhere, the
 *   host's hour is everyone's, and a night slept through by anyone is over.
 *
 * Effects on the player's own body and pack arrive through `setCoopView`,
 * so this layer never names the health, drop or screen layers.
 */

import * as THREE from 'three';
import { REMOTE_MOB_ARROW, REMOTE_PLAYER_ARROW, launchArrow } from './archery.js';
import { BLOCKS, createBlockEntity } from './blocks.js';
import { acceptRemoteBeacon } from './beacons.js';
import { markWorldDirty, setBlockEditListener, withEditsSilenced, world } from './chunks.js';
import { DAY_START, WORLD_HEIGHT, clamp } from './config.js';
import {
  animateMobPuppet, damageMob, explosionEffectsAt, mobDeathBurst, mobs, refitMobModel,
  removeMobRecord, setMobAuthority, setMobSpawning, spawnMob
} from './mob.js';
import * as net from './net.js';
import { player, view } from './player.js';
import {
  addAvatar, avatars, clearAvatars, removeAvatar, setAvatarPose, updateAvatars
} from './remote-players.js';
import { SAVE_SCHEMA, serializeSharedWorld, stackFromRecord, stackToRecord } from './save.js';
import { dayTime, setDayTime } from './sky.js';

const POSE_SECONDS = 1 / 12;
const MOB_SECONDS = 0.1;
const TIME_SECONDS = 4;
const CONTAINER_SECONDS = 0.25;
const PUPPET_EASE_RATE = 12;

/* ---------- What co-op asks of the page ---------- */

const coopView = {
  /** A host mob hurt this walker. */
  hurt: (amount, cause) => {},
  /** Loot the host says this walker earned. */
  drop: (itemId, count, x, y, z) => {},
  /** Essence the host says this walker earned. */
  essence: (amount, x, y, z) => {},
  /** The "x,y,z" of the chest or furnace whose screen is open, or null. */
  openContainer: () => null,
  /** The open container's contents changed under it. */
  redrawContainer: () => {},
  /** The open container was broken by somebody else. */
  closeContainer: () => {},
  /** Another player slept the night away. */
  daySkipped: () => {},
  /** Whether this walker is swinging, for the arm on their avatar. */
  swinging: () => false,
  /** One line for the player. */
  toast: () => {},
  /** The menu's co-op page: { mode, code, players, status, error }. */
  paintRoom: () => {}
};

export function setCoopView(shown) { Object.assign(coopView, shown); }

/* ---------- State ---------- */

let installed = false;
/** False on a guest until the host's world has been put down here. */
let worldReady = true;
const pendingWhileBooting = [];
let worldArrived = null;

let poseTimer = 0;
let mobTimer = 0;
let timeTimer = 0;
let containerTimer = 0;
let statusLine = '';
let statusError = false;

/** Block edits made here this frame, sent as one message. */
const outbox = [];
/** host mob serial → this guest's picture of it. */
const puppets = new Map();
/** Container key → the contents last sent or heard, as JSON. */
const containerSeen = new Map();
let watchedContainer = null;

export function isCoopHost() { return net.isHost(); }
export function isCoopGuest() { return net.isGuest(); }
export function inCoop() { return net.inRoom(); }

/* ---------- Opening and leaving a room ---------- */

function install() {
  if (installed) return;
  installed = true;
  setBlockEditListener(queueEdit);

  net.onPeers((kind, peer) => {
    if (kind === 'join') {
      addAvatar(peer.id, peer.name);
      if (peer.role === 'host' && net.isGuest()) {
        // The host is back after a reload: their mobs are numbered afresh.
        for (const mob of puppets.values()) removeMobRecord(mob);
        puppets.clear();
        setStatus('The host is back. Playing in ' + net.roomCode() + '.', false);
      }
      say(peer.name + ' joined');
      // Somebody new sees this walker straight away, not on the next tick.
      sendPose(peer.id);
    } else {
      removeAvatar(peer.id);
      containerSeen.clear();
      say(peer.name + ' left');
    }
    paint();
  });
  net.onNetStatus(() => {
    const error = net.netError();
    if (error) setStatus(error, true);
    paint();
  });

  net.onMessage('want', (d, from) => {
    if (!net.isHost()) return;
    net.send('world', serializeSharedWorld(), from);
    sendMobs(from);
  });
  net.onMessage('world', (d) => {
    if (!net.isGuest() || !worldArrived) return;
    const done = worldArrived;
    worldArrived = null;
    done(d);
  });
  on('pose', (d, from) => {
    if (!avatars.has(from)) {
      const peer = net.peers.get(from);
      addAvatar(from, peer ? peer.name : 'Player');
    }
    if (![d.x, d.y, d.z, d.yaw, d.pitch].every(Number.isFinite)) return;
    setAvatarPose(from, d);
  });
  on('blk', (d) => applyRemoteEdits(d));
  on('ent', (d) => applyRemoteContainer(d));
  on('mobs', (d, from) => {
    if (net.isGuest() && from === net.hostId() && Array.isArray(d)) syncPuppets(d);
  });
  on('kill', (d, from) => {
    if (!net.isGuest() || from !== net.hostId()) return;
    const mob = puppets.get(d.id);
    if (!mob) return;
    mobDeathBurst(mob);
    removeMobRecord(mob);
    puppets.delete(d.id);
  });
  on('boom', (d, from) => {
    if (!net.isGuest() || from !== net.hostId()) return;
    if ([d.x, d.y, d.z].every(Number.isFinite)) explosionEffectsAt(d.x, d.y, d.z);
  });
  on('hit', (d, from) => {
    if (!net.isHost()) return;
    const mob = mobs.find((m) => m.serial === d.id && !m.dead);
    const amount = Number(d.a);
    if (!mob || !Number.isFinite(amount) || amount <= 0) return;
    // A guest's word is taken, within reason: no single blow beyond a diamond
    // sword's, and no shove beyond a sprinting hit's.
    damageMob(mob, Math.min(amount, 12), clamp(Number(d.kx) || 0, -6, 6),
      clamp(Number(d.kz) || 0, -6, 6), { by: from });
  });
  on('shear', (d) => {
    if (!net.isHost()) return;
    const mob = mobs.find((m) => m.serial === d.id && !m.dead);
    if (!mob || mob.type !== 'sheep' || mob.sheared) return;
    mob.sheared = true;
    refitMobModel(mob);
  });
  on('hurt', (d, from) => {
    if (!net.isGuest() || from !== net.hostId()) return;
    const amount = Number(d.a);
    if (!Number.isFinite(amount)) return;
    if (Array.isArray(d.k) && d.k.every(Number.isFinite)) {
      player.vel.x += d.k[0];
      player.vel.y += d.k[1];
      player.vel.z += d.k[2];
      if (d.k[1] > 0) player.onGround = false;
    }
    coopView.hurt(amount, String(d.c || 'unknown'));
  });
  on('loot', (d, from) => {
    if (from !== net.hostId() || !Array.isArray(d)) return;
    const [id, count, x, y, z] = d;
    if (typeof id !== 'string' || ![count, x, y, z].every(Number.isFinite)) return;
    coopView.drop(id, Math.trunc(count), x, y, z);
  });
  on('ess', (d, from) => {
    if (from !== net.hostId() || !Array.isArray(d) || !d.every(Number.isFinite)) return;
    coopView.essence(Math.trunc(d[0]), d[1], d[2], d[3]);
  });
  on('arrow', (d, from) => {
    if (!Array.isArray(d.p) || d.p.length !== 6 || !d.p.every(Number.isFinite)) return;
    // A mob's arrow only comes from the host, whose mobs are the only ones.
    const fromMob = !d.w && from === net.hostId();
    if (!d.w && !fromMob) return;
    const [x, y, z, vx, vy, vz] = d.p;
    launchArrow(x, y, z, vx, vy, vz, Number(d.d) || 0,
      fromMob ? REMOTE_MOB_ARROW : REMOTE_PLAYER_ARROW);
  });
  on('beacon', (d) => acceptRemoteBeacon(d.i));
  on('time', (d, from) => {
    if (net.isGuest() && from === net.hostId() && Number.isFinite(d.t)) setDayTime(d.t);
  });
  on('sleep', () => {
    setDayTime(DAY_START);
    coopView.daySkipped();
  });
}

/* Messages that change the world wait, on a guest, until the host's world is
   down; otherwise they would land on ground that is about to be replaced. */
function on(type, handler) {
  net.onMessage(type, (d, from) => {
    if (!worldReady) {
      pendingWhileBooting.push([handler, d, from]);
      return;
    }
    handler(d, from);
  });
}

/** Opens this world to friends under `code`. */
export async function startHosting(code, name) {
  install();
  setStatus('Opening the room…', false);
  try {
    await net.hostRoom(code, name);
  } catch (err) {
    setStatus(net.netError() || 'Could not open the room.', true);
    return false;
  }
  setStatus('Room open. Send the link to a friend, and keep this tab in front: a hidden tab stops the world for everyone.', false);
  return true;
}

/**
 * The first half of a guest's boot: join the room, find the host and ask for
 * their world. Resolves with the world record, or null with the reason said.
 * From here on this browser's mobs are pictures, so no herd may be rolled on
 * the ground the boot is about to mesh.
 */
export async function joinHostWorld(code, name) {
  install();
  worldReady = false;
  setMobSpawning(false);
  setMobAuthority((mob, amount, knockX, knockZ) => {
    net.sendToHost('hit', { id: mob.netId, a: amount, kx: knockX, kz: knockZ });
  });
  setStatus('Looking for the host of room ' + code + '…', false);
  try {
    await net.joinRoom(code, name);
    await net.waitForHost(30000);
  } catch (err) {
    return failJoin(net.netError() || 'Nobody is hosting room ' + code + ' right now.');
  }
  setStatus('Found the host. Fetching their world…', false);
  const shared = await new Promise((resolve) => {
    worldArrived = resolve;
    let asks = 0;
    const ask = () => {
      if (!worldArrived) return;
      if (asks++ >= 10 || !net.isGuest()) {
        worldArrived = null;
        resolve(null);
        return;
      }
      net.sendToHost('want', {});
      setTimeout(ask, 3000);
    };
    ask();
  });
  if (!shared) return failJoin(net.netError() || 'The host did not send their world.');
  // A different seed is only a different world: the page that asked reboots
  // built from the host's. A different schema is a different game.
  if (shared.v !== SAVE_SCHEMA || !Number.isFinite(shared.seed)) {
    return failJoin('The host is playing another version of the game.');
  }
  return shared;
}

function failJoin(reason) {
  setStatus(reason, true);
  net.leaveRoom();
  worldReady = true;
  pendingWhileBooting.length = 0;
  setMobSpawning(true);
  setMobAuthority(null);
  return null;
}

/** The guest's boot has put the host's world down: play what arrived meanwhile. */
export function coopWorldReady() {
  worldReady = true;
  const waiting = pendingWhileBooting.splice(0);
  for (const [handler, d, from] of waiting) handler(d, from);
  setStatus('Playing in ' + net.roomCode() + ' with the host.', false);
}

/** Leaves the room. A host carries on alone; a guest's page goes home. */
export async function leaveCoop() {
  await net.leaveRoom();
  clearAvatars();
  for (const mob of puppets.values()) removeMobRecord(mob);
  puppets.clear();
  containerSeen.clear();
  setStatus('', false);
  paint();
}

/* ---------- Status for the menu ---------- */

function setStatus(line, error) {
  statusLine = line;
  statusError = !!error;
  paint();
}

function say(line) { coopView.toast(line); }

function paint() {
  const mode = net.netMode();
  const players = [];
  if (net.inRoom()) {
    players.push({ name: net.selfName(), role: net.isHost() ? 'host' : 'guest', self: true });
    for (const peer of net.peers.values()) players.push({ name: peer.name, role: peer.role, self: false });
  }
  coopView.paintRoom({ mode, code: net.roomCode(), players, status: statusLine, error: statusError });
}

/* ---------- Blocks ---------- */

function queueEdit(x, y, z, id, facing) {
  if (!net.inRoom()) return;
  outbox.push(facing ? [x, y, z, id, facing[0], facing[1]] : [x, y, z, id]);
}

function applyRemoteEdits(edits) {
  if (!Array.isArray(edits)) return;
  withEditsSilenced(() => {
    for (const edit of edits) {
      if (!Array.isArray(edit)) continue;
      const [x, y, z, id] = edit;
      if (![x, y, z, id].every(Number.isInteger)) continue;
      if (y < 0 || y >= WORLD_HEIGHT || id < 0 || id >= BLOCKS.length) continue;
      const facing = edit.length >= 6 && Number.isFinite(edit[4]) && Number.isFinite(edit[5])
        ? [edit[4], edit[5]]
        : null;
      world.setBlock(x, y, z, id, facing);
    }
  });
  const open = coopView.openContainer();
  if (open && !world.blockEntities.has(open)) coopView.closeContainer();
}

/* ---------- Containers ---------- */

/* The block entities whose slots go over the wire while someone has one open. */
const SYNCED_CONTAINERS = new Set(['chest', 'furnace', 'enchanter']);

function containerRecord(state) {
  const record = { kind: state.kind, s: state.slots.map((slot) => stackToRecord(slot)) };
  if (state.kind === 'furnace') {
    record.b = Math.round(state.burnTime * 10) / 10;
    record.t = Math.round(state.burnTotal * 10) / 10;
    record.c = Math.round(state.cookTime * 10) / 10;
  }
  return record;
}

function sendContainerIfChanged(key) {
  const state = world.blockEntities.get(key);
  if (!state || !SYNCED_CONTAINERS.has(state.kind)) return;
  const record = containerRecord(state);
  const json = JSON.stringify(record);
  if (containerSeen.get(key) === json) return;
  containerSeen.set(key, json);
  net.send('ent', { k: key, r: record });
}

function applyRemoteContainer(d) {
  if (!d || typeof d.k !== 'string' || !d.r || !Array.isArray(d.r.s)) return;
  const parts = d.k.split(',').map(Number);
  if (parts.length !== 3 || !parts.every(Number.isInteger)) return;
  const record = d.r;
  if (!SYNCED_CONTAINERS.has(record.kind)) return;
  let state = world.blockEntities.get(d.k);
  if (!state) {
    state = createBlockEntity(record.kind);
    world.blockEntities.set(d.k, state);
  }
  if (state.kind !== record.kind) return;
  for (let i = 0; i < state.slots.length; i++) state.slots[i] = stackFromRecord(record.s[i]);
  if (state.kind === 'furnace') {
    state.burnTime = Number(record.b) || 0;
    state.burnTotal = Number(record.t) || 0;
    state.cookTime = Number(record.c) || 0;
  }
  markWorldDirty();
  containerSeen.set(d.k, JSON.stringify(containerRecord(state)));
  if (coopView.openContainer() === d.k) coopView.redrawContainer();
}

function watchContainers() {
  const key = coopView.openContainer();
  // The screen just closed on one: whatever was last done in it goes out.
  if (watchedContainer && watchedContainer !== key) sendContainerIfChanged(watchedContainer);
  watchedContainer = key;
  if (key) sendContainerIfChanged(key);
}

/* ---------- Mobs ---------- */

const round2 = (n) => Math.round(n * 100) / 100;

function mobRows() {
  const rows = [];
  for (const mob of mobs) {
    if (mob.dead) continue;
    const flags = (mob.sheared ? 1 : 0) | (mob.fuse >= 0 ? 2 : 0) | (mob.hurtFlash > 0 ? 4 : 0);
    rows.push([
      mob.serial, mob.type, round2(mob.pos.x), round2(mob.pos.y), round2(mob.pos.z),
      round2(mob.yaw), Math.ceil(mob.health), flags
    ]);
  }
  return rows;
}

function sendMobs(target = null) {
  net.send('mobs', mobRows(), target);
}

function syncPuppets(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 8) continue;
    const [id, type, x, y, z, yaw, health, flags] = row;
    if (![id, x, y, z, yaw].every(Number.isFinite)) continue;
    seen.add(id);
    let mob = puppets.get(id);
    if (mob && mob.type !== type) {
      // The same number for a different animal: the host has started counting again.
      removeMobRecord(mob);
      puppets.delete(id);
      mob = null;
    }
    if (!mob) {
      mob = spawnMob(type, x, y, z, { yaw, sheared: !!(flags & 1) });
      if (!mob) continue;
      mob.netId = id;
      mob.netPos = new THREE.Vector3(x, y, z);
      mob.netYaw = yaw;
      mob.shearSent = false;
      puppets.set(id, mob);
    }
    mob.netPos.set(x, y, z);
    mob.netYaw = yaw;
    if (Number.isFinite(health)) mob.health = health;
    const sheared = !!(flags & 1);
    if (sheared && !mob.sheared) {
      mob.sheared = true;
      refitMobModel(mob);
    } else if (!sheared && mob.sheared && !mob.shearSent) {
      // Sheared here, by this walker, and the host has not heard yet.
      mob.shearSent = true;
      net.sendToHost('shear', { id });
    }
    mob.fuse = flags & 2 ? 1 : -1;
    if (flags & 4 && mob.hurtFlash < 0.05) mob.hurtFlash = 0.22;
  }
  for (const [id, mob] of puppets) {
    if (seen.has(id)) continue;
    removeMobRecord(mob);
    puppets.delete(id);
  }
}

function angleToward(from, to, t) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

function updatePuppets(dt) {
  if (dt <= 0) return;
  const t = 1 - Math.exp(-PUPPET_EASE_RATE * dt);
  for (const mob of puppets.values()) {
    const beforeX = mob.pos.x;
    const beforeZ = mob.pos.z;
    if (mob.pos.distanceTo(mob.netPos) > 8) mob.pos.copy(mob.netPos);
    else mob.pos.lerp(mob.netPos, t);
    mob.vel.set((mob.pos.x - beforeX) / dt, 0, (mob.pos.z - beforeZ) / dt);
    mob.yaw = angleToward(mob.yaw, mob.netYaw, t);
    if (mob.audioCooldown > 0) mob.audioCooldown -= dt;
    animateMobPuppet(mob, dt);
  }
}

/** Every walker the host's mobs can see: this one and every guest heard from. */
export function coopWalkers() {
  if (!net.isHost() || avatars.size === 0) return null;
  const list = [player];
  for (const avatar of avatars.values()) if (avatar.heard) list.push(avatar);
  return list;
}

/** Whether a walker the mob layer named is somebody else's. */
export function isRemoteWalker(walker) { return !!(walker && walker.remote); }

/** A host mob hurt a guest: tell them, with the shove the blast gave the stand-in. */
export function hurtRemoteWalker(walker, amount, cause) {
  const knock = [round2(walker.vel.x), round2(walker.vel.y), round2(walker.vel.z)];
  walker.vel.set(0, 0, 0);
  net.send('hurt', { a: amount, c: cause, k: knock }, walker.id);
  return true;
}

/** A mob a guest killed: the loot goes to their world. */
export function sendLoot(owner, itemId, count, x, y, z) {
  net.send('loot', [itemId, count, round2(x), round2(y), round2(z)], owner);
}

export function sendEssence(owner, amount, x, y, z) {
  net.send('ess', [amount, round2(x), round2(y), round2(z)], owner);
}

/** The host's mob died: guests let their picture of it go with a puff. */
export function announceMobKilled(mob) {
  if (net.isHost()) net.send('kill', { id: mob.serial });
}

export function announceExplosion(x, y, z) {
  if (net.isHost()) net.send('boom', { x: round2(x), y: round2(y), z: round2(z) });
}

/** An arrow loosed here, by this walker or by one of the host's mobs. */
export function announceArrow(x, y, z, vx, vy, vz, damage, byWalker) {
  if (!net.inRoom()) return;
  net.send('arrow', {
    p: [x, y, z, vx, vy, vz].map(round2),
    d: damage,
    w: byWalker
  });
}

export function announceBeacon(index) {
  if (net.inRoom()) net.send('beacon', { i: index });
}

export function announceSleep() {
  if (net.inRoom()) net.send('sleep', {});
}

/* ---------- The frame ---------- */

function sendPose(target = null) {
  net.send('pose', {
    x: round2(player.pos.x),
    y: round2(player.pos.y),
    z: round2(player.pos.z),
    yaw: round2(view.yaw),
    pitch: round2(view.pitch),
    dead: player.dead,
    swing: !!coopView.swinging()
  }, target);
}

/** One frame of co-op. Does nothing outside a room. */
export function updateCoop(dt) {
  if (!net.inRoom()) return;

  if (outbox.length) net.send('blk', outbox.splice(0));

  poseTimer -= dt;
  if (poseTimer <= 0) {
    poseTimer = POSE_SECONDS;
    sendPose();
  }

  if (net.isHost() && net.peers.size) {
    mobTimer -= dt;
    if (mobTimer <= 0) {
      mobTimer = MOB_SECONDS;
      sendMobs();
    }
    timeTimer -= dt;
    if (timeTimer <= 0) {
      timeTimer = TIME_SECONDS;
      net.send('time', { t: dayTime });
    }
  }

  containerTimer -= dt;
  if (containerTimer <= 0) {
    containerTimer = CONTAINER_SECONDS;
    watchContainers();
  }

  if (net.isGuest()) updatePuppets(dt);
  updateAvatars(dt);
}

/** What the debug surface may say about co-op. */
export function coopReport() {
  return {
    ...net.netReport(),
    ready: worldReady,
    avatars: [...avatars.values()].map((a) => ({
      id: a.id, name: a.name, dead: a.dead,
      x: round2(a.pos.x), y: round2(a.pos.y), z: round2(a.pos.z)
    })),
    puppets: puppets.size,
    status: statusLine
  };
}
