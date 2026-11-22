/*
 * What the pointer holds while a screen is open: one stack that sits in none of the
 * grids, and the ways a screen puts it down, splits it, merges with it or trades it
 * for the slot under the mouse. `cursorCarried` is the only way to read it; a screen
 * that wants it somewhere else calls a verb rather than assigning to it, and a
 * cursor that has handed over its last item is emptied instead of left holding
 * nothing.
 *
 * The crafting grid comes along because its result has to land somewhere and that
 * somewhere is the cursor. Which of the two grids is in play is the open screen's
 * doing, so `craftingContext` asks the view rather than knowing screens, and a
 * refusal — a full pack, a cursor already in the way, no room left on it — is said
 * out loud through the same view. It cannot move down to the crafting layer: that
 * layer owns the grids and has no business knowing a pointer exists, while this one
 * needs those grids to craft at all.
 *
 * The picture of the stack, the toast and which screen is up belong to whoever draws
 * screens and arrive through `setCursorView` at bootstrap.
 */

import { playCraftSound } from './audio.js';
import { ITEMS, freshStack, stacksMergeable } from './blocks.js';
import {
  CRAFT2_SIZE, CRAFT3_SIZE, consumeCraftIngredients, craft2, craft3, matchRecipe
} from './crafting.js';
import { spawnItemDrop } from './drops.js';
import { addItemToInventory, inventoryHasRoom, paintPack } from './inventory.js';
import { player } from './player.js';

/** Stack currently attached to the mouse cursor while a screen is open. */
let cursorStack = null;

/* A screen takes a stack onto the cursor and puts it back down, and these are
   the ways it does it. The inventory keeps what the cursor is carrying, because
   it is the thing that puts a crafted result there and the thing that drops it
   on the ground when a player quits with one; the screens say what they want
   rather than assigning to it. */

/** The cursor now carries `stack`, which may be nothing at all. */
export function setCursorStack(stack) { cursorStack = stack; }

/** The cursor is empty. */
export function clearCursorStack() { cursorStack = null; }

/** A cursor that has handed over its last item is not left holding nothing. */
export function dropEmptyCursorStack() {
  if (cursorStack && cursorStack.count <= 0) cursorStack = null;
}

/** The stack the cursor is carrying, or nothing at all. */
export function cursorCarried() { return cursorStack; }

/* A screen is what puts a picture of the carried stack on the pointer, what hears
   why a craft was refused, and — since the 2x2 grid belongs to the pack and the
   3x3 to the crafting table — which grid is in play at all. None of that is the
   cursor's business, so the page hands all three over at bootstrap. Until it
   does, a cursor carries a stack nothing pictures, refusals go unheard, and there
   is no grid to craft from. */
const cursorView = {
  screen: () => null,
  toast: () => {},
  paintCursor: () => {}
};

export function setCursorView(coming) { Object.assign(cursorView, coming); }

function craftingContext() {
  const screen = cursorView.screen();
  if (screen === 'crafting') return { grid: craft3, size: CRAFT3_SIZE };
  if (screen === 'inventory') return { grid: craft2, size: CRAFT2_SIZE };
  return null;
}

export function currentCraftRecipe() {
  const context = craftingContext();
  return context ? matchRecipe(context.grid, context.size) : null;
}

/**
 * Consume one set of ingredients and deliver the result either to the cursor
 * (normal click) or straight into the inventory (shift click).
 */
export function craftCurrent(intoInventory = false) {
  const context = craftingContext();
  if (!context) return false;

  const recipe = matchRecipe(context.grid, context.size);
  if (!recipe) return false;

  const result = recipe.result;
  const def = ITEMS.get(result.id);
  const produced = freshStack(result.id, result.count);

  if (intoInventory) {
    if (!inventoryHasRoom(result.id, result.count)) {
      cursorView.toast('Inventory full');
      return false;
    }
    addItemToInventory(produced.id, produced.count, produced.dur);
  } else if (cursorStack) {
    if (cursorStack.id !== produced.id || !stacksMergeable(cursorStack, produced)) {
      cursorView.toast('Clear the cursor to craft');
      return false;
    }
    if (cursorStack.count + produced.count > def.stack) {
      cursorView.toast('Not enough room on cursor');
      return false;
    }
    cursorStack.count += produced.count;
  } else {
    cursorStack = produced;
  }

  consumeCraftIngredients(context.grid);
  playCraftSound();
  paintPack();
  cursorView.paintCursor();
  return true;
}

export function returnCursorStack() {
  if (!cursorStack) return;
  const leftover = addItemToInventory(
    cursorStack.id, cursorStack.count, cursorStack.dur
  );
  if (leftover > 0) {
    spawnItemDrop(
      cursorStack.id, leftover,
      player.pos.x, player.pos.y + 1.2, player.pos.z, false, cursorStack.dur
    );
  }
  cursorStack = null;
  cursorView.paintCursor();
}
