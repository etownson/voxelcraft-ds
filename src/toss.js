/*
 * Throwing things away: an item out of the hand, or the stack on the cursor
 * when a screen is open and the player clicks outside it. Either way it
 * leaves from the eyes along the crosshair, lands a few blocks ahead, and is
 * out of the thrower's own reach for a moment so it does not fly straight
 * back. What lands is a shared drop (drops.js), which is how co-op players
 * hand each other things.
 */

import * as THREE from 'three';
import { makeStack } from './blocks.js';
import { tossItemDrop } from './drops.js';
import { consumeSelectedItem, getSelectedStack } from './inventory.js';
import { aimOrigin, player } from './player.js';
import { camera } from './render.js';

/** How fast a thrown stack leaves the hand, in blocks a second. */
const TOSS_SPEED = 6;
/** The little lift a throw has on top of where it is aimed. */
const TOSS_LIFT = 1.4;

const direction = new THREE.Vector3();

/** Throws `stack` out along the crosshair. The stack is the drop's now. */
export function tossStack(stack) {
  if (!stack || stack.count <= 0) return null;
  camera.getWorldDirection(direction);
  const eye = aimOrigin();
  return tossItemDrop(
    stack.id, stack.count, stack.dur, stack.contents,
    eye.x + direction.x * 0.3, eye.y - 0.3, eye.z + direction.z * 0.3,
    player.vel.x + direction.x * TOSS_SPEED,
    direction.y * TOSS_SPEED + TOSS_LIFT,
    player.vel.z + direction.z * TOSS_SPEED
  );
}

/**
 * Throws one of what the hand holds, or the whole stack with `all`. False
 * when the hand is empty.
 */
export function tossFromHand(all = false) {
  const held = getSelectedStack();
  if (!held || player.dead) return false;
  const count = all ? held.count : 1;
  const thrown = makeStack(held.id, count, held.dur, held.contents);
  consumeSelectedItem(count);
  tossStack(thrown);
  return true;
}
