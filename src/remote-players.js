/*
 * The other players, as this browser draws them: a blocky body each, walking
 * where their own browser says they are, with their name floating over their
 * head. Nothing here knows how the positions arrive. The co-op layer hands
 * each pose over as it comes, and this file eases the body toward it, so a
 * dozen updates a second still reads as a walk rather than a hop.
 *
 * Each avatar also carries `pos`, `vel`, `dead` and `onGround`: the raw pose
 * last heard, not the eased one. That is the shape the mob layer expects of a
 * walker, so the host's zombies can chase a guest with no special case.
 */

import * as THREE from 'three';
import { camera, scene } from './render.js';

/** How quickly a body closes on where it was last said to be, per second. */
const EASE_RATE = 14;
/** A pose further than this from the body is a teleport, not a walk. */
const SNAP_DISTANCE = 8;

/* One shirt colour a player, picked from their id so it stays theirs. */
const SHIRTS = [0x3d7fd1, 0xd1543d, 0x47a854, 0xc9a13a, 0x9455c4, 0x37a8a8, 0xd16a9e, 0x8a8a8a];

const skinMaterial = new THREE.MeshLambertMaterial({ color: 0xd8a47f });
const hairMaterial = new THREE.MeshLambertMaterial({ color: 0x4a3222 });
const trouserMaterial = new THREE.MeshLambertMaterial({ color: 0x2f3f66 });
const eyeMaterial = new THREE.MeshLambertMaterial({ color: 0x1b2433 });
const shirtMaterials = new Map();

function shirtFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = SHIRTS[hash % SHIRTS.length];
  let material = shirtMaterials.get(color);
  if (!material) {
    material = new THREE.MeshLambertMaterial({ color });
    shirtMaterials.set(color, material);
  }
  return material;
}

const geometries = new Map();
function box(w, h, d) {
  const key = w + 'x' + h + 'x' + d;
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = new THREE.BoxGeometry(w, h, d);
    geometries.set(key, geometry);
  }
  return geometry;
}

/* A limb hangs from its top, so it swings from the shoulder or the hip. */
function limb(w, h, d, material, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const mesh = new THREE.Mesh(box(w, h, d), material);
  mesh.position.y = -h / 2;
  pivot.add(mesh);
  return pivot;
}

function buildBody(id) {
  const group = new THREE.Group();
  const shirt = shirtFor(id);

  const legL = limb(0.24, 0.72, 0.24, trouserMaterial, -0.125, 0.72, 0);
  const legR = limb(0.24, 0.72, 0.24, trouserMaterial, 0.125, 0.72, 0);
  const torso = new THREE.Mesh(box(0.5, 0.7, 0.26), shirt);
  torso.position.y = 1.07;
  const armL = limb(0.22, 0.68, 0.22, shirt, -0.36, 1.4, 0);
  const armR = limb(0.22, 0.68, 0.22, shirt, 0.36, 1.4, 0);
  const handL = new THREE.Mesh(box(0.2, 0.14, 0.2), skinMaterial);
  handL.position.y = -0.62;
  armL.add(handL);
  const handR = handL.clone();
  armR.add(handR);

  // The head turns with the look; the body turns with the yaw.
  const head = new THREE.Group();
  head.position.y = 1.42;
  const skull = new THREE.Mesh(box(0.44, 0.44, 0.44), skinMaterial);
  skull.position.y = 0.22;
  const hair = new THREE.Mesh(box(0.46, 0.12, 0.46), hairMaterial);
  hair.position.y = 0.42;
  const eyeL = new THREE.Mesh(box(0.08, 0.06, 0.02), eyeMaterial);
  eyeL.position.set(-0.1, 0.24, -0.225);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.1;
  head.add(skull, hair, eyeL, eyeR);

  group.add(legL, legR, torso, armL, armR, head);
  return { group, head, legL, legR, armL, armR };
}

/** peerId → avatar. */
export const avatars = new Map();

let tagLayer = null;
function tags() {
  if (!tagLayer) tagLayer = document.getElementById('coop-tags');
  return tagLayer;
}

/** Puts a player in the world, or renames the one already there. */
export function addAvatar(id, name) {
  let avatar = avatars.get(id);
  if (avatar) {
    avatar.name = name;
    if (avatar.tag) avatar.tag.textContent = name;
    return avatar;
  }
  const body = buildBody(id);
  body.group.visible = false;
  scene.add(body.group);
  let tag = null;
  if (tags()) {
    tag = document.createElement('div');
    tag.className = 'coop-tag hidden';
    tag.textContent = name;
    tags().append(tag);
  }
  avatar = {
    id,
    name,
    remote: true,
    // The walker the mob layer chases: the last pose heard, as it was said.
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    onGround: true,
    dead: false,
    // What this browser draws, easing toward `pos`.
    shown: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    shownYaw: 0,
    swing: 0,
    walkPhase: 0,
    heard: false,
    body,
    tag
  };
  avatars.set(id, avatar);
  return avatar;
}

/** Takes a player out of the world. */
export function removeAvatar(id) {
  const avatar = avatars.get(id);
  if (!avatar) return;
  scene.remove(avatar.body.group);
  if (avatar.tag) avatar.tag.remove();
  avatars.delete(id);
}

/** Every player out of the world at once, for leaving a room. */
export function clearAvatars() {
  for (const id of [...avatars.keys()]) removeAvatar(id);
}

/**
 * A pose as heard: feet position, yaw, pitch, whether they are dead and
 * whether their arm is swinging.
 */
export function setAvatarPose(id, pose) {
  const avatar = avatars.get(id);
  if (!avatar) return;
  avatar.pos.set(pose.x, pose.y, pose.z);
  avatar.yaw = pose.yaw;
  avatar.pitch = pose.pitch;
  avatar.dead = !!pose.dead;
  if (pose.swing) avatar.swing = 1;
  if (!avatar.heard || avatar.shown.distanceTo(avatar.pos) > SNAP_DISTANCE) {
    avatar.shown.copy(avatar.pos);
    avatar.shownYaw = avatar.yaw;
    avatar.heard = true;
  }
}

function angleToward(from, to, t) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

const tagPoint = new THREE.Vector3();

/** One frame: every body eases toward its pose, and every name follows its head. */
export function updateAvatars(dt) {
  const t = 1 - Math.exp(-EASE_RATE * dt);
  const width = window.innerWidth;
  const height = window.innerHeight;
  for (const avatar of avatars.values()) {
    const { body } = avatar;
    if (!avatar.heard) continue;
    const beforeX = avatar.shown.x;
    const beforeZ = avatar.shown.z;
    avatar.shown.lerp(avatar.pos, t);
    avatar.shownYaw = angleToward(avatar.shownYaw, avatar.yaw, t);
    const speed = dt > 0 ? Math.hypot(avatar.shown.x - beforeX, avatar.shown.z - beforeZ) / dt : 0;

    body.group.visible = !avatar.dead;
    body.group.position.copy(avatar.shown);
    body.group.rotation.y = avatar.shownYaw;
    body.head.rotation.x = avatar.pitch;

    avatar.walkPhase += dt * (3 + speed * 2.2);
    const amp = Math.min(1, speed / 4) * 0.8;
    body.legL.rotation.x = Math.sin(avatar.walkPhase) * amp;
    body.legR.rotation.x = -Math.sin(avatar.walkPhase) * amp;
    body.armL.rotation.x = -Math.sin(avatar.walkPhase) * amp * 0.8;
    avatar.swing = Math.max(0, avatar.swing - dt * 4);
    body.armR.rotation.x = Math.sin(avatar.walkPhase) * amp * 0.8 - avatar.swing * 1.6;

    if (!avatar.tag) continue;
    tagPoint.set(avatar.shown.x, avatar.shown.y + 2.05, avatar.shown.z);
    const distance = tagPoint.distanceTo(camera.position);
    tagPoint.project(camera);
    const onScreen = !avatar.dead && tagPoint.z < 1 && distance < 64 &&
      Math.abs(tagPoint.x) < 1.1 && Math.abs(tagPoint.y) < 1.1;
    avatar.tag.classList.toggle('hidden', !onScreen);
    if (onScreen) {
      avatar.tag.style.left = ((tagPoint.x + 1) / 2 * width).toFixed(1) + 'px';
      avatar.tag.style.top = ((1 - tagPoint.y) / 2 * height).toFixed(1) + 'px';
    }
  }
}
