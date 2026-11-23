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
 *
 * Nothing here knows where the pack is drawn. Filling a slot reports what did
 * not fit and asks whoever is showing the slots to redraw, and the page names
 * them with `setPackPainter` at bootstrap.
 */

import { playToolBreakSound } from './audio.js';
import {
  ARMOR_MAX_DEFENSE, ARMOR_SLOTS, ITEMS, consumeDurability, makeStack, stacksMergeable
} from './blocks.js';
import { markWorldDirty } from './chunks.js';
import { say } from './say.js';

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

/* The pack is drawn in more than one place — the hotbar, and whichever screen is
   showing the same slots — and which screens those are is not the pack's
   business. The page hands one painter over at bootstrap; until then the pack
   can change and nothing notices. */
let packPainter = () => {};

export function setPackPainter(paint) { packPainter = paint; }

/**
 * Redraws the pack wherever it is being shown. Anything that has just moved a
 * stack calls this and knows nothing about where the picture of it gets drawn.
 */
export function paintPack() {
  packPainter();
}

/* The armour bar is a second picture of the same slots: what is worn, and how much
   of it is left. The page hands this painter over at bootstrap too, so putting
   armour back from a save does not have to know the bar exists. */
let armorPainter = () => {};

export function setArmorPainter(paint) { armorPainter = paint; }

/** Redraws the armour bar wherever it is being shown. */
export function paintArmorBar() {
  armorPainter();
}

export function inventoryHasRoom(itemId, count) {
  const def = ITEMS.get(itemId);
  if (!def) return false;
  let room = 0;
  for (const slot of inventory) {
    if (!slot) room += def.stack;
    else if (slot.id === itemId) room += def.stack - slot.count;
    if (room >= count) return true;
  }
  return false;
}

export function addItemToInventory(itemId, count, dur, contents) {
  const def = ITEMS.get(itemId);
  if (!def || count <= 0) return count;
  const maxStack = def.stack;
  const probe = makeStack(itemId, count, dur, contents);
  let remaining = count;

  for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
    const slot = inventory[i];
    if (!slot || !stacksMergeable(probe, slot) || slot.count >= maxStack) continue;
    const moved = Math.min(remaining, maxStack - slot.count);
    slot.count += moved;
    remaining -= moved;
  }

  for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
    if (inventory[i]) continue;
    const moved = Math.min(remaining, maxStack);
    inventory[i] = makeStack(itemId, moved, dur, contents);
    remaining -= moved;
  }

  if (remaining !== count) paintPack();
  return remaining;
}

export function getSelectedStack() {
  return inventory[currentSlot()] || null;
}

export function consumeSelectedItem(count = 1) {
  const stack = getSelectedStack();
  if (!stack) return false;
  stack.count -= count;
  if (stack.count <= 0) emptyHand();
  paintPack();
  return true;
}

/** The stack the hand is out with is gone, whether spent or worn out. */
export function emptyHand() {
  inventory[currentSlot()] = null;
}

export function countInventoryItem(itemId) {
  let total = 0;
  for (const slot of inventory) {
    if (slot && slot.id === itemId) total += slot.count;
  }
  return total;
}

/**
 * Armour's damage reduction, straight from Minecraft: a set absorbs a share of
 * the incoming hit, and heavy hits get through proportionally more of them.
 */
export function armorAbsorbed(defense, amount) {
  if (defense <= 0) return 0;
  const points = Math.min(ARMOR_MAX_DEFENSE, defense);
  const factor = Math.min(20, Math.max(points / 5, points - amount / 2)) / 25;
  return amount * factor;
}

/**
 * A hit costs the set four durability per point it absorbed, Minecraft's rate.
 * One random piece carries the whole cost, which is what wears a set out
 * unevenly instead of every piece at once, and a hit the set barely softens
 * costs nothing at all.
 */
export function wearArmour(absorbed) {
  const cost = Math.floor(absorbed * 4);
  if (cost <= 0) return;
  const worn = [];
  for (let i = 0; i < armorSlots.length; i++) {
    if (armorSlots[i]) worn.push(i);
  }
  if (worn.length === 0) return;

  const index = worn[Math.floor(Math.random() * worn.length)];
  const stack = armorSlots[index];
  if (!consumeDurability(stack, cost)) return;

  armorSlots[index] = null;
  const item = ITEMS.get(stack.id);
  say((item ? item.name : 'Armour') + ' broke');
  playToolBreakSound();
  paintArmorBar();
  markWorldDirty();
}
