/*
 * Essence: the fuel the beacons want and the enemies pay. It is not an item —
 * it never sits in a slot, never spills from a pack and never burns in a
 * furnace. It is a running total the walker carries, and the only way it moves
 * is by walking through the bubbles a killed enemy leaves behind.
 *
 * The bubbles keep their own manners, and they are deliberately worse behaved
 * than item drops. They take a beat to arrive, so the fight that made them
 * cannot end before the player starts moving through the aftermath; they are
 * claimed by intersecting with one, not by a magnet reaching out from the pack;
 * and they fade away on a clock, because essence that is not collected is
 * essence that is lost, which is the whole design of an action economy.
 *
 * The running total belongs to this file and to nothing else: the save puts a
 * number in and asks for one back, the page paints it through the painter it
 * hands over at bootstrap, and the debug shelf grants it the way it grants
 * items. What it is spent on is the beacon layer's story: a monument takes
 * its price out of this purse, through the one door below.
 */

import * as THREE from 'three';
import { BLOCKS } from './blocks.js';
import { markWorldDirty, world } from './chunks.js';
import { playEssenceSound } from './audio.js';
import { spawnBurstParticles } from './fx.js';
import { createCanvas } from './icons.js';
import { player } from './player.js';
import { scene } from './render.js';

/**
 * Seconds a bubble takes to appear after the kill. The delay is the point:
 * it puts a beat between dying things and collecting them, so a player who
 * kills with their back turned loses the essence and knows it was a choice.
 */
const BUBBLE_APPEAR_DELAY = 0.6;
/**
 * A bubble's whole life, appear delay included. Past this it has gone: the
 * design treats uncollected essence as lost, not waiting.
 */
const BUBBLE_LIFETIME = 14;
/** The last seconds of that life, spent going translucent before vanishing. */
const BUBBLE_FADE = 3;
/**
 * How close a bubble has to sit to the body to be claimed: within this
 * horizontal reach, and anywhere along the body's height. Deliberately not
 * the item drop's 2.5-block magnet — essence must be run over.
 */
const BUBBLE_REACH = 0.9;
const BUBBLE_REACH_BELOW = 0.4;
const BUBBLE_REACH_ABOVE = 2.2;
/** A bubble's drawn size, in world units. A quarter block across. */
const BUBBLE_SCALE = 0.105;

/* ---------- The running total ---------- */

let essenceTotal = 0;

/* The number's picture, handed over by the page at bootstrap the way the
   hearts and the food bar are. Until then the total simply changes quietly. */
let paintEssence = () => {};

/** The page says where the total is shown. */
export function setEssencePainter(paint) { paintEssence = paint; }

/** What the walker carries right now. */
export function essenceCount() { return essenceTotal; }

/** Puts essence in hand — a kill, a debug grant — and repaints. */
export function grantEssence(amount) {
  const added = Math.trunc(Number(amount) || 0);
  if (added <= 0) return essenceTotal;
  essenceTotal += added;
  markWorldDirty();
  paintEssence();
  return essenceTotal;
}

/** Sets the total outright, the way a save puts a number back. */
export function setEssence(value) {
  essenceTotal = Math.max(0, Math.trunc(Number(value) || 0));
  paintEssence();
  return essenceTotal;
}

/**
 * Spends essence, answering whether the purse was deep enough. The beacons
 * are what ask for this, one monument price at a time; nothing else gets to
 * reach in, which is the point of keeping the door here rather than letting
 * every caller add and subtract freely.
 */
export function spendEssence(amount) {
  const wanted = Math.trunc(Number(amount) || 0);
  if (wanted <= 0 || wanted > essenceTotal) return false;
  essenceTotal -= wanted;
  markWorldDirty();
  paintEssence();
  return true;
}

/* ---------- The bubbles ---------- */

export const essenceEntities = [];
let essenceEntitySerial = 0;
let bubbleMaterial = null;

/**
 * The bubble itself: a soft glowing sphere, teal-white at the heart and
 * edged with a rim, painted once onto a canvas and shared by every bubble
 * the world ever drops.
 */
function bubbleTexture() {
  const canvas = createCanvas(16);
  const ctx = canvas.getContext('2d');
  const heart = ctx.createRadialGradient(8, 7, 1, 8, 8, 7.5);
  heart.addColorStop(0, 'rgba(226, 250, 255, 0.95)');
  heart.addColorStop(0.45, 'rgba(120, 216, 235, 0.8)');
  heart.addColorStop(0.85, 'rgba(64, 160, 190, 0.55)');
  heart.addColorStop(1, 'rgba(40, 110, 140, 0)');
  ctx.fillStyle = heart;
  ctx.beginPath();
  ctx.arc(8, 8, 7.5, 0, Math.PI * 2);
  ctx.fill();
  // A short bright arc at the upper left, the way light finds a soap film.
  ctx.strokeStyle = 'rgba(240, 252, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(8, 8, 5.5, Math.PI * 1.05, Math.PI * 1.45);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function sharedBubbleMaterial() {
  if (!bubbleMaterial) {
    bubbleMaterial = new THREE.SpriteMaterial({
      map: bubbleTexture(),
      transparent: true,
      depthWrite: false
    });
  }
  // Each bubble fades on its own clock, and a shared material cannot fade
  // alone, so every entity gets its own copy of the one texture.
  return bubbleMaterial.clone();
}

/**
 * Drops one bubble's worth of essence at a point. `scatter` gives it the
 * small pop item drops get, so a burst of three settles apart rather than
 * stacked on one another.
 */
function spawnEssenceBubble(amount, x, y, z) {
  if (amount <= 0) return null;
  const material = sharedBubbleMaterial();
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(BUBBLE_SCALE, BUBBLE_SCALE, 1);
  sprite.visible = false;

  const entity = {
    serial: essenceEntitySerial++,
    amount,
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(
      (Math.random() - 0.5) * 1.6,
      2.2 + Math.random() * 1.2,
      (Math.random() - 0.5) * 1.6
    ),
    age: 0,
    settled: false,
    phase: Math.random() * Math.PI * 2,
    mesh: sprite
  };
  sprite.position.copy(entity.pos);
  scene.add(sprite);
  essenceEntities.push(entity);
  return entity;
}

/**
 * The way the mob layer pays: one total for the kill, broken into a few
 * bubbles scattered within a pace or two of where the enemy fell. More than
 * one bubble because one is scenery and three are a decision about which to
 * chase.
 */
export function spawnEssenceBurst(total, x, y, z) {
  const amount = Math.trunc(Number(total) || 0);
  if (amount <= 0) return [];
  const bubbles = Math.min(amount, 1 + Math.floor(Math.random() * 3));
  const entities = [];
  for (let i = 0; i < bubbles; i++) {
    // Share the total out, giving the last bubble whatever rounding left over.
    const share = Math.floor(amount / bubbles) + (i === bubbles - 1 ? amount % bubbles : 0);
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.4 + Math.random() * 1.8;
    entities.push(spawnEssenceBubble(
      share,
      x + Math.cos(angle) * radius,
      y,
      z + Math.sin(angle) * radius
    ));
  }
  return entities;
}

function removeEssenceEntity(index) {
  const entity = essenceEntities[index];
  if (!entity) return;
  scene.remove(entity.mesh);
  entity.mesh.material.dispose();
  essenceEntities.splice(index, 1);
}

/** The body's claim on a bubble: it is inside the bubble, not near it. */
function bodyOverlaps(entity) {
  const dx = entity.pos.x - player.pos.x;
  const dz = entity.pos.z - player.pos.z;
  const dy = entity.pos.y - player.pos.y;
  return Math.hypot(dx, dz) <= BUBBLE_REACH &&
    dy >= -BUBBLE_REACH_BELOW && dy <= BUBBLE_REACH_ABOVE;
}

export function updateEssenceBubbles(dt) {
  if (dt <= 0) return;

  for (let i = essenceEntities.length - 1; i >= 0; i--) {
    const entity = essenceEntities[i];
    entity.age += dt;

    if (entity.age >= BUBBLE_LIFETIME) {
      removeEssenceEntity(i);
      continue;
    }

    // Only an arrived bubble can be claimed or fade; before the delay it is
    // not even drawn.
    const arrived = entity.age >= BUBBLE_APPEAR_DELAY;

    if (arrived && !player.dead && bodyOverlaps(entity)) {
      grantEssence(entity.amount);
      playEssenceSound();
      spawnBurstParticles(entity.pos.x, entity.pos.y + 0.3, entity.pos.z, 0x78d8eb, 8, 3.2);
      removeEssenceEntity(i);
      continue;
    }

    if (!arrived) continue;

    // Bubbles fall like anything else until the ground stops them, then they
    // ride just above it, bobbing — a bubble should not sit flat on the dirt.
    if (!entity.settled) {
      entity.vel.y -= 14 * dt;
      const nx = entity.pos.x + entity.vel.x * dt;
      const ny = entity.pos.y + entity.vel.y * dt;
      const nz = entity.pos.z + entity.vel.z * dt;
      if (BLOCKS[world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))].solid) {
        if (entity.vel.y < 0) {
          entity.pos.set(nx, Math.floor(ny) + 1.3, nz);
          entity.vel.set(0, 0, 0);
          entity.settled = true;
        }
      } else {
        entity.pos.set(nx, ny, nz);
        if (entity.pos.y < 1) {
          entity.pos.y = 1;
          entity.vel.y = 0;
          entity.settled = true;
        }
      }
    }

    const arriving = Math.min(1, (entity.age - BUBBLE_APPEAR_DELAY) / 0.3);
    const fading = Math.min(1, (BUBBLE_LIFETIME - entity.age) / BUBBLE_FADE);
    entity.mesh.visible = true;
    entity.mesh.material.opacity = arriving * fading;
    const scale = BUBBLE_SCALE * arriving;
    entity.mesh.scale.set(scale, scale, 1);
    entity.mesh.position.set(
      entity.pos.x,
      entity.pos.y + 0.15 + Math.sin(entity.age * 2.4 + entity.phase) * 0.1,
      entity.pos.z
    );
  }
}
