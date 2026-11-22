/*
 * What the player carries: the thirty-six slots of pack, the strip of nine at
 * the bottom of them, the four pieces worn, and which of the nine the hand is
 * out at.
 *
 * The arrays are exported as themselves — picking up writes a cell, a screen
 * reads them, a save copies them out and a death empties them — because they
 * are the same arrays the whole game has always filled. The held index is not:
 * one door writes it and everything else asks, which is the difference between
 * a bar that repaints and a bar that lies. Armour crosses between the worn row
 * and the pack through `equipStack` and `unequipSlot` and nowhere else.
 */

import { ARMOR_SLOTS, ITEMS } from './blocks.js';

export const INVENTORY_SIZE = 36;
export const HOTBAR_SIZE = 9;
export const inventory = new Array(INVENTORY_SIZE).fill(null);

/**
 * Which hotbar slot is held out. The bar paints this one and everything that
 * eats, digs, places or wears something asks for it, so it lives with the pack
 * it indexes rather than with the strip of nine that shows it.
 */
let selectedSlot = 0;

/** The slot the player is holding out of the hotbar, nought through eight. */
export function currentSlot() { return selectedSlot; }

/**
 * Points the held hand at a hotbar slot, wrapping past either end. True when
 * the slot really changed, which is when the click is owed.
 */
export function selectSlot(index) {
  const previous = selectedSlot;
  selectedSlot = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  return selectedSlot !== previous;
}

/**
 * Worn armour in head, chest, legs, feet order. Kept apart from the inventory
 * so a full pack never strands a helmet in it, and so a death can leave the
 * gear on the player the way Minecraft does.
 */
export const armorSlots = new Array(ARMOR_SLOTS.length).fill(null);

/** Which worn slot a stack belongs in, or -1 when it is not armour. */
export function equipSlotFor(stack) {
  if (!stack) return -1;
  const item = ITEMS.get(stack.id);
  if (!item || item.kind !== 'armor') return -1;
  return ARMOR_SLOTS.indexOf(item.armorSlot);
}

/** Defence points worn right now. Minecraft caps the total at 20 points. */
export function armorDefense() {
  let total = 0;
  for (const stack of armorSlots) {
    if (!stack) continue;
    const item = ITEMS.get(stack.id);
    if (item && item.kind === 'armor') total += item.defense || 0;
  }
  return total;
}

/**
 * Puts a stack on, swapping with whatever is already worn in that slot. The
 * incoming stack replaces the worn one in place; the caller gets back anything
 * that has to go somewhere else, or null when the swap is clean.
 */
export function equipStack(stack) {
  const index = equipSlotFor(stack);
  if (index < 0) return stack;
  const worn = armorSlots[index];
  armorSlots[index] = stack;
  return worn;
}

/** Takes a piece off into the first free inventory cell. False when full. */
export function unequipSlot(index) {
  const worn = armorSlots[index];
  if (!worn) return false;
  const free = inventory.findIndex((slot) => !slot);
  if (free < 0) return false;
  armorSlots[index] = null;
  inventory[free] = worn;
  return true;
}
