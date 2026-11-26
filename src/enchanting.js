/*
 * The enchanting table's one trick. Put a sword, a tool, a bow or a piece of
 * armour in its slot and pay essence, and the slot holds the enchanted version
 * instead: better numbers, two and a half times the uses, and every one of them
 * there, because enchanting mends whatever wear the item had. An item is
 * enchanted once; an enchanted item put back in the slot can only be mended,
 * for half the price, and only while it has worn at all.
 *
 * The price is about `ENCHANT_KILLS` hostile kills' essence on the ground of
 * the most recently lit beacon, so it grows the way the mission's own prices
 * do. The table's slot is a block entity the screen fills; this module only
 * says what the slot's item can become and makes it so.
 */

import { frontierKillEssence } from './beacons.js';
import { ITEMS, enchantedIdFor, freshStack, stackDurability } from './blocks.js';
import { markWorldDirty } from './chunks.js';
import { ENCHANT_KILLS } from './config.js';
import { essenceCount, spendEssence } from './essence.js';

/** What enchanting one item costs right now, in essence. */
export function enchantCost() {
  return frontierKillEssence(ENCHANT_KILLS);
}

/** What mending one enchanted item costs right now: half its enchanting price. */
export function repairCost() {
  return Math.round(enchantCost() / 2);
}

/**
 * What the table would do to a stack: 'enchant' for gear that has an
 * enchanted twin, 'repair' for enchanted gear, or null for anything else.
 */
export function enchantAction(stack) {
  if (!stack) return null;
  const item = ITEMS.get(stack.id);
  if (!item) return null;
  if (item.enchanted) return 'repair';
  return ITEMS.has(enchantedIdFor(stack.id)) ? 'enchant' : null;
}

/**
 * Everything the screen needs to draw the table's button for the item in a
 * table's slot: what it would do, what it costs, and when it cannot, why not.
 */
export function enchantOffer(state) {
  const stack = state && state.slots ? state.slots[0] : null;
  const action = enchantAction(stack);
  const cost = action === 'repair' ? repairCost() : enchantCost();
  let reason = null;
  if (!stack) {
    reason = 'Place gear to enchant';
  } else if (!action) {
    reason = 'Cannot be enchanted';
  } else if (action === 'repair' && isUnworn(stack)) {
    reason = 'Already enchanted';
  } else if (essenceCount() < cost) {
    reason = 'Needs ' + cost + ' essence';
  }
  return { action, cost, ready: reason === null, reason };
}

function isUnworn(stack) {
  const durability = stackDurability(stack);
  return !durability || durability.current >= durability.max;
}

/**
 * Enchants or mends the item in a table's slot, paying for it out of the
 * walker's essence. Answers the offer it acted on, with `done` saying whether
 * anything happened.
 */
export function enchantSlot(state) {
  const offer = enchantOffer(state);
  if (!offer.ready || !spendEssence(offer.cost)) return { ...offer, done: false };
  const stack = state.slots[0];
  const id = offer.action === 'enchant' ? enchantedIdFor(stack.id) : stack.id;
  state.slots[0] = freshStack(id, stack.count);
  markWorldDirty();
  return { ...offer, done: true };
}
