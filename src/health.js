/*
 * What the body has left: health, food, the hidden saturation cushion and the
 * exhaustion that spends it, plus the three clocks that mend, fast-mend and
 * starve it. `src/player.js` owns the body itself — where it stands, what it is
 * looking at, how tired it is — and this file owns what happens to it: a hit
 * taking a share through the worn set, a bite of bread putting food back, a
 * night without either ending at the death screen.
 *
 * Nothing here knows what a heart looks like, where the death screen is, or
 * which chunk the spawn column is in. The bars are painted through the body's
 * painters (`paintHealth`, `paintHunger`) and the red wash through the body's
 * own verbs; dying and coming back are handed to the page as two contracts —
 * `deathView` for the words and the pointer, `respawnArrival` for the spawn
 * column and the chunks around it — both defaulting to nothing happening, so a
 * save or a headless run can kill the player without a document.
 *
 * Eating is here rather than with the world interactions because food is a
 * reserve and nothing else: the bite spends what the hand holds through the
 * inventory's verbs and never asks which block is under the crosshair.
 */

import { playDeathSound, playEatSound, playPlayerHurtSound } from './audio.js';
import { ITEMS } from './blocks.js';
import { markWorldDirty } from './chunks.js';
import { tryShearMob } from './combat.js';
import {
  EXHAUSTION, HUNGER_MAX, HUNGER_REGEN_MIN, REGEN_INTERVAL, SATURATION_BOOST_COST,
  SATURATION_BOOST_INTERVAL, SATURATION_ON_RESPAWN, STARVE_INTERVAL, clamp
} from './config.js';
import { triggerHeldSwing } from './held.js';
import { tryPlaceSelectedBlock } from './interaction.js';
import {
  armorAbsorbed, armorDefense, consumeSelectedItem, getSelectedStack, wearArmour
} from './inventory.js';
import {
  addExhaustion, clearDamage, fadeDamage, flashDamage, paintHealth, paintHunger, player
} from './player.js';
import { say } from './say.js';

let regenTimer = 0;
/** Counts up to Java's half-second saturation boost at a completely full bar. */
let saturationBoostTimer = 0;

/* Dying and coming back are the screen's business as much as the body's: one
   leaves the world behind a message, the other puts the player back into it, at
   a spawn the world may have unloaded while they were away. The body says which
   happened and why, and never touches an element or a chunk. */
const deathView = {
  depart() {},
  show() {},
  hide() {}
};

export function setDeathView(verbs) {
  Object.assign(deathView, verbs);
}

const respawnArrival = {
  clearRun() {},
  place() {},
  resume() {}
};

export function setRespawnArrival(verbs) {
  Object.assign(respawnArrival, verbs);
}

export function damagePlayer(amount, cause = 'unknown') {
  if (player.dead || !Number.isFinite(amount) || amount <= 0) return false;
  if (player.hurtCooldown > 0 && cause !== 'fall') return false;

  // Starvation walks straight past armour, as it does in Minecraft: a set of iron
  // must not turn an empty stomach into a slow tick that grinds the kit to dust
  // while you sit there. It exhausts nobody either, because Minecraft only
  // charges exhaustion for damage armour was in a position to block.
  const starving = cause === 'starving';
  const defense = starving ? 0 : armorDefense();
  const absorbed = armorAbsorbed(defense, amount);
  if (absorbed > 0) wearArmour(absorbed);
  if (!starving) addExhaustion(EXHAUSTION.hurt);

  player.health = Math.max(0, player.health - (amount - absorbed));
  player.hurtCooldown = 0.35;
  player.regenDelay = 6;
  regenTimer = 0;
  flashDamage();
  playPlayerHurtSound();
  paintHealth();

  if (player.health <= 0) {
    playerDie(cause);
    return true;
  }
  return true;
}

export function healPlayer(amount) {
  if (player.dead) return;
  player.health = clamp(player.health + amount, 0, player.maxHealth);
  paintHealth();
}

function playerDie(cause) {
  if (player.dead) return;
  player.dead = true;
  player.health = 0;
  player.vel.set(0, 0, 0);
  player.sprinting = false;
  playDeathSound();
  deathView.depart();
  clearDamage();
  paintHealth();
  // Dead players stop being hungry on screen: this drops the saturation jitter.
  paintHunger();
  deathView.show(cause);
}

export function respawnPlayer() {
  player.dead = false;
  player.health = player.maxHealth;
  player.sprinting = false;
  respawnArrival.clearRun();
  player.hurtCooldown = 0;
  player.regenDelay = 0;
  player.fallPeakY = 0;
  starveTimer = 0;
  regenTimer = 0;
  saturationBoostTimer = 0;
  // Starving has to end at the death screen, not carry over into the next life:
  // Minecraft resets food to full on respawn, and without it a player who died of
  // hunger comes back at 0 with the clock already running, with no time to find a
  // meal. Saturation comes back at Minecraft's five and the leftover exhaustion
  // goes too, so it cannot spend a bite off a stomach that was just filled.
  player.hunger = HUNGER_MAX;
  player.saturation = SATURATION_ON_RESPAWN;
  player.exhaustion = 0;
  paintHunger();
  // A death and a respawn change the save even when the world itself does not, so
  // the refilled stomach has to be written: without this, closing the tab before
  // the next autosave brings back the empty bar the save was holding.
  markWorldDirty();
  clearDamage();
  deathView.hide();
  paintHealth();

  respawnArrival.place();
  respawnArrival.resume();
}

let starveTimer = 0;
/** Seconds left before another bite can be taken. */
let eatTimer = 0;
const EAT_SECONDS = 0.6;

/**
 * Eats one bite of whatever food is held. Food is the only way back up to a
 * full stomach, so a night of fighting and mining has to end at a cooker.
 */
export function tryEatSelectedItem() {
  const stack = getSelectedStack();
  if (!stack) return false;

  const item = ITEMS.get(stack.id);
  if (!item || item.kind !== 'food') return false;

  // Raw meat feeds nobody straight out of a cow: the furnace is the only way
  // past it, so say so instead of silently swallowing the right click.
  if (item.needsCooking) {
    if (player.hunger < HUNGER_MAX) say(item.name + ' needs cooking in a furnace');
    return false;
  }
  if (!item.hunger) return false;

  // Full is full, even with no saturation left: Minecraft refuses the bite too, so
  // a topped-up bar mends at the slow four-second rate until something is eaten at
  // 19 or below. Eating early is the whole trick.
  if (player.hunger >= HUNGER_MAX) {
    say("You're already full");
    return false;
  }
  if (eatTimer > 0) return false;

  eatTimer = EAT_SECONDS;
  consumeSelectedItem();
  player.hunger = Math.min(HUNGER_MAX, player.hunger + item.hunger);
  // Saturation can never outrun the food it sits on, so a big meal at a nearly
  // empty stomach wastes most of it — the same reason Minecraft pays to eat early
  // rather than waiting until the bar is gone.
  player.saturation = Math.min(player.hunger, player.saturation + (item.saturation || 0));
  paintHunger();
  triggerHeldSwing();
  playEatSound();
  markWorldDirty();
  return true;
}

/** Right-click with something held: eat first, then use it on the world. */
export function tryUseSelectedItem() {
  if (tryEatSelectedItem()) return true;
  if (tryShearMob('use')) return true;
  return tryPlaceSelectedBlock();
}

/** Starvation bites once food is gone; a full stomach closes wounds. */
export function updateHunger(dt) {
  if (dt <= 0 || player.dead) return;

  if (eatTimer > 0) eatTimer = Math.max(0, eatTimer - dt);

  // Saturation is always gone by the time the bar is, since it can never sit above
  // the food it cushions, so an empty bar is the whole condition. The bite is a
  // full point and there is no floor to stop at: Minecraft's Hard difficulty, on
  // purpose, so this game can end you without a mob in sight.
  if (player.hunger <= 0) {
    starveTimer += dt;
    if (starveTimer >= STARVE_INTERVAL) {
      starveTimer = 0;
      damagePlayer(1, 'starving');
    }
    return;
  }
  starveTimer = 0;
}

export function updateHealth(dt) {
  if (dt <= 0) return;

  if (player.hurtCooldown > 0) {
    player.hurtCooldown = Math.max(0, player.hurtCooldown - dt);
  }
  if (player.regenDelay > 0) {
    player.regenDelay = Math.max(0, player.regenDelay - dt);
  }
  fadeDamage(dt);

  if (player.dead) return;

  const wounded = player.health < player.maxHealth;
  // Java's saturation boost: a completely full bar with saturation left mends a
  // point of health every half second and burns 1.5 saturation for it, eight times
  // the speed of the slow heal below and paid out of a pocket food never sees.
  // Minecraft never runs both at once — a steak's 12.8 saturation is worth exactly
  // 8⅓ points of health, which only works out if the boost is the one paying — and
  // it does not pause the boost when the player is hit, which is why this sits
  // above the post-damage cooldown. Eating well before a fight is what keeps you
  // standing through it.
  if (wounded && player.hunger >= HUNGER_MAX && player.saturation > 0) {
    regenTimer = 0;
    saturationBoostTimer += dt;
    while (saturationBoostTimer >= SATURATION_BOOST_INTERVAL && player.saturation > 0) {
      saturationBoostTimer -= SATURATION_BOOST_INTERVAL;
      healPlayer(1);
      player.saturation = Math.max(0, player.saturation - SATURATION_BOOST_COST);
      // The bar starts jittering the moment that cushion is gone.
      if (player.saturation <= 0) paintHunger();
    }
    return;
  }
  saturationBoostTimer = 0;

  // The slow heal. Minecraft resets its own food clock when you are hit, so wounds
  // wait out a cooldown before closing; this game uses the six seconds it already
  // had, where Minecraft uses ten.
  if (player.regenDelay > 0) {
    regenTimer = 0;
    return;
  }

  // A point of health every four seconds while the bar is at 18 or above, or while
  // saturation is holding you up at a lower bar. Each point costs 6 exhaustion —
  // 1.5 saturation, or 1.5 food once that runs dry — which makes getting hit and
  // mending it the dearest thing in the game. Twelve health back is more food than
  // a full day of mining, sprinting and crafting put together.
  if (wounded && (player.hunger >= HUNGER_REGEN_MIN || player.saturation > 0)) {
    regenTimer += dt;
    while (regenTimer >= REGEN_INTERVAL) {
      regenTimer -= REGEN_INTERVAL;
      healPlayer(1);
      addExhaustion(EXHAUSTION.regen);
    }
  } else {
    regenTimer = 0;
  }
}
