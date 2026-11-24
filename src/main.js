/*
 * The composition root. Everything above is a layer that knows only its own
 * subject; this is the one file that knows all of them, because somebody has to
 * hold the pieces and hand each layer the others.
 *
 * Three jobs, in the order they run. First the world boots: the spawn column is
 * chosen and meshed, a save is read and put down, the bars are built and the
 * first debug readout is written. Then the seams are handed out — every
 * `set…View`, `set…Painter` and `set…Arrival` in the project is registered here,
 * in one block, and this is the only place in the codebase where two distant
 * layers are named in the same sentence. Then time starts: the frame loop walks
 * the player, streams and meshes chunks, ticks water and mobs and drops, draws,
 * autosaves and writes the readout, and the debug API hangs off `window` so a
 * headless check can ask the same questions a browser test does.
 *
 * The save UI here is the last of the page's own code: a status line, a start
 * button and a new-world button, because they belong to the document rather than
 * to the game and nothing else needs to know they exist.
 */

import * as THREE from 'three';
import {
  crackMesh, currentTarget, hideTargetOutline, setAimBlocked, shownCrackStage, targetOutline,
  updateTarget
} from './aim.js';
import {
  arrows, beginBowDraw, bowDraw, cancelBowDraw, clearArrows, mobShootsWalker, releaseBowDraw,
  setArcheryWorld, updateArchery
} from './archery.js';
import { atlasCanvas } from './atlas.js';
import {
  audioCtx, audioStatus, playMissionCompleteSong, playSound, playSpawnSong,
  resumeAudioIfUnpaused, setArrivalHold, setAudioMenuPause, setAudioMusicVolume,
  setAudioMuted, setAudioSfxVolume, setAudioVolume, toggleAudioMuted
} from './audio.js';
import {
  ARMOR_SLOTS, BLOCKS, BLOCK_BY_KEY, CHEST_SLOTS, ITEMS, freshStack, isChestBlock,
  isFallingWater, isFlowWater, isFurnaceBlock, isLava, makeStack, slotInfo, stackDurability,
  waterLevel
} from './blocks.js';
import {
  SPAWN_TRANSMISSION, beaconReport, beaconSites, beaconsActivatedCount, clearBeaconBeams,
  frontierZone, threatZoneAt, threatZoneCount,
  nextBeacon, plantBeaconMonuments, restoreBeaconProgress, setBeaconPainter, setSpawnPoint0,
  setTransmissionDeliverer, spawnPoint, startingEssence
} from './beacons.js';
import { isWorldDirty, markWorldDirty, world } from './chunks.js';
import { attackMob, clearMobTarget, mobTarget, updateCombat, updateMobTarget } from './combat.js';
import {
  B, CHUNK_SIZE, DAY_LENGTH_SECONDS, EXHAUSTION_THRESHOLD, EYE_HEIGHT, HUNGER_MAX,
  HUNGER_REGEN_MIN, WATER_NEIGHBORS, WATER_TICK_SECONDS, WORLD_HEIGHT, WORLD_SEED, blockIndex,
  clamp
} from './config.js';
import {
  BLOCK_ENTITY_NONE, FURNACE_FUEL, FURNACE_FUELS, FURNACE_INPUT, FURNACE_OUTPUT,
  SMELTING_RECIPES, setBlockEntityView, spillBlockEntityContents, updateBlockEntities
} from './containers.js';
import {
  CRAFT2_SIZE, CRAFT3_SIZE, RECIPES, consumeCraftIngredients, craft2, craft3, matchRecipe,
  recipeReceived
} from './crafting.js';
import { currentCraftRecipe, cursorCarried, returnCursorStack, setCursorView } from './cursor.js';
import { itemEntities, setItemPickup, spawnItemDrop, updateItemEntities } from './drops.js';
import {
  essenceCount, essenceEntities, grantEssence as addEssence, setEssencePainter,
  spawnEssenceBurst, updateEssenceBubbles
} from './essence.js';
import { isFarmlandWet, updateCrops } from './farming.js';
import {
  emberCount, explosionEffects, setFxView, torchEmbers, updateAudio, updateBreakParticles,
  updateExplosionEffects, updateTorchEmbers
} from './fx.js';
import {
  damagePlayer, healPlayer, respawnPlayer, setDeathView, setRespawnArrival, tryEatSelectedItem,
  tryUseSelectedItem, updateBurning, updateHealth, updateHunger
} from './health.js';
import {
  heldCamera, heldModelKey, heldRoot, heldScene, syncHeldAngles, triggerHeldSwing,
  updateHeldItem
} from './held.js';
import {
  GIVE_ITEMS, activeScreen, activeScreenAt, clearDamageFlash, closeScreen, controlHintEl,
  deathCauseEl, deathScreenEl, dismissTransmission, fadeDamageFlash, fps, handlePadScreenTap, hungerBarEl,
  openScreen, padCursor, padSensitivityEl, padStatusEl, paintBurning, renderArmorBar, renderEssence,
  paintThreat, paintWaypoint, renderHealth, renderHotbar, renderHunger, renderScreen, sampleFrameRate,
  selectHotbarSlot, setBeaconJumper, setTransmissionFinisher, showDamageFlash, showToast,
  showTransmission, sleepFadeEl, sprintStateEl,
  toggleInventory, toggleJournal, updateCursorVisual, updateDebug,
  updateFurnaceGauges, updateGamepadScreen
} from './hud.js';
import {
  PAD_BUTTON, cameraStepOffset, canvas, chooseSpawnColumn, clearSprintLatch,
  enableFallbackControls, ensurePlayerChunks, fallbackControls, gamepadState, handlePadTap,
  isMiningHeld, isPlayable, menuOpen, overlayEl, padMiningDown, prepareSpawnChunks,
  readPlayerInput, releaseMiningButton, requestLock, resetCameraStep, safeGroundY,
  setGamepadSensitivity, setInputView, setSprintLatch, spawnPlayer, sprintLatched, syncCamera,
  toggleSprintLatch, updateGamepad, updatePadStatus, updatePlayer, virtualPad
} from './input.js';
import {
  MINING_SWING_INTERVAL, hideMiningFeedback, isMining, miningFacts, miningReport,
  plantSeedsOnTarget, setInteractionView, tryPlaceSelectedBlock, updateMining, useHoeOnTarget
} from './interaction.js';
import { introActive, primeIntroBlack, skipIntro, startIntro, updateIntro } from './intro.js';
import {
  HOTBAR_SIZE, INVENTORY_SIZE, addItemToInventory, armorAbsorbed, armorDefense, armorSlots,
  countInventoryItem, currentSlot, equipSlotFor, equipStack, getSelectedStack, inventory,
  selectSlot, setArmorPainter, setPackPainter, unequipSlot
} from './inventory.js';
import {
  HOSTILE_CAP, MOB_CAP, MOB_SPAWN_MAX_RADIUS, MOB_SPAWN_MIN_RADIUS, PASSIVE_CAP,
  PASSIVE_SPAWN_RADIUS, countMobs, damageMob, hostileSpawnTally, mobs, setMobWorld, spawnMob,
  trySpawnHostile, trySpawnPassive, updateMobs, zeroSpawnTally
} from './mob.js';
import { menuState, padMenuTick, paintMenuMission, setMenuActions } from './menu.js';
import {
  aimPlayer, applyLook, player, setDamageFlash, setHealthPainter, setHungerPainter, view
} from './player.js';
import { camera, renderer, scene, skyDome } from './render.js';
import {
  LEGACY_SAVE_KEYS, SAVE_KEY, SAVE_SCHEMA, applySavedBlockEntities, applySavedEdits,
  forgetSavedWorld, formatSavedAt, hasCurrentSave, hasLegacySave, onSaveWritten,
  readSavedWorld, rememberSavedWorld, restoreSavedArmour, restoreSavedBeacons,
  restoreSavedEssence,
  restoreSavedInventory,
  restoreSavedPlayer, resumeAutosave, saveReport, saveWorld, setSaveArrival, setSaveSpawn,
  stopAutosave, updateSaveLoop
} from './save.js';
import { registerSpeaker } from './say.js';
import {
  advanceDayTime, applyDayNight, clockHours, dayTime, daylight, formatClock, isNight,
  setDayTime, setTimeScale, timeScale, updateDayNight, updateWaterLook
} from './sky.js';
import { desiredFluid, updateWater, waterTick } from './water.js';
import {
  activeWaypoint, forgetWaypoints, loadWaypoints, saveWaypoint, waypointTargets
} from './waypoints.js';
import { sampleColumn, treeAt } from './worldgen.js';

const saveStatusEl = document.getElementById('save-status');
const padSensSlider = document.getElementById('pad-sens');

function refreshSaveStatus() {
  if (!saveStatusEl) return;
  const written = saveReport();
  if (written.error) {
    saveStatusEl.textContent = written.error;
    saveStatusEl.classList.remove('found');
  } else if (written.at) {
    saveStatusEl.textContent = 'World saved ' + formatSavedAt(written.at);
    saveStatusEl.classList.add('found');
  } else if (hasLegacySave()) {
    saveStatusEl.textContent = 'A world from an older version exists and can\u2019t be loaded';
    saveStatusEl.classList.remove('found');
  } else {
    saveStatusEl.textContent = 'No saved world yet';
    saveStatusEl.classList.remove('found');
  }
}

/** New world, once the menu has asked and been told yes: wipe and reload. */
function eraseWorld() {
  // Stop the unload-triggered saves from resurrecting the wiped world.
  stopAutosave();
  try {
    localStorage.removeItem(SAVE_KEY);
    for (const legacy of LEGACY_SAVE_KEYS) localStorage.removeItem(legacy);
  } catch (unavailable) {}
  // The saved spots belong to the world that is going.
  forgetWaypoints();
  window.location.reload();
}

function initSaveUi(hasSavedWorld) {
  setMenuActions({
    newWorld: eraseWorld,
    // The menu names the spot; where the walker's feet are is the page's to say.
    saveSpot: (label) => saveWaypoint(label, player.pos.x, player.pos.y, player.pos.z)
  });
  if (hasSavedWorld) {
    saveStatusEl.textContent = 'Saved world found';
    saveStatusEl.classList.add('found');
  } else {
    refreshSaveStatus();
  }
}

window.addEventListener('pagehide', () => saveWorld());
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    saveWorld();
    // A background tab should not keep wind and music running.
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
  } else {
    // Coming back to a tab with the menu up leaves the world paused behind it.
    resumeAudioIfUnpaused();
  }
});
onSaveWritten(() => refreshSaveStatus());

/* The eye, for the layers that shake the camera and paint embers: the same
   position syncCamera settles the view onto, scratch-reused frame to frame. */
const fxEyePoint = new THREE.Vector3();
setFxView({
  pos: () => player.pos,
  eye: () => fxEyePoint.set(
    player.pos.x,
    player.pos.y + EYE_HEIGHT - cameraStepOffset,
    player.pos.z
  ),
  yaw: () => view.yaw,
  paused: () => !!activeScreen || !overlayEl.classList.contains('hidden') || player.dead,
  restore: () => syncCamera()
});

/* The same handover for the mob layer, whose four answers all live above
 * it: the walker it hunts, and the hurt, drop and spill it causes. The
 * walker is this very record, not a copy of it — an explosion that knocks
 * someone back moves the body the controller owns. */
setMobWorld({
  walker: () => player,
  hurt: (amount, cause) => damagePlayer(amount, cause),
  drop: (itemId, count, x, y, z, scatter, dur) =>
    spawnItemDrop(itemId, count, x, y, z, scatter, dur),
  dropEssence: (amount, x, y, z) => spawnEssenceBurst(amount, x, y, z),
  spill: (x, y, z) => spillBlockEntityContents(x, y, z),
  shoot: (mob, speed, damage) => mobShootsWalker(mob, speed, damage)
});

/* An arrow that finds the walker hurts them the way a bite does. */
setArcheryWorld({
  hurt: (amount, cause) => damagePlayer(amount, cause)
});

/* And for the block entities, whose whole idea of a screen is the one furnace
 * in front of the player: the screens name it when they have one and draw it,
 * and the tick never has to ask what is open. */
setBlockEntityView({
  at: () => activeScreen === 'furnace' && activeScreenAt
    ? activeScreenAt.x + ',' + activeScreenAt.y + ',' + activeScreenAt.z
    : BLOCK_ENTITY_NONE,
  paint: (state) => updateFurnaceGauges(state),
  redraw: () => renderScreen(),
  spill: (slots, x, y, z) => {
    for (const slot of slots) {
      if (!slot) continue;
      spawnItemDrop(
        slot.id, slot.count, x + 0.5, y + 0.5, z + 0.5, true, slot.dur, slot.contents
      );
    }
  }
});

/* Drops go into the pack, and the pack says how much did not fit. */
setItemPickup((itemId, count, dur, contents) =>
  addItemToInventory(itemId, count, dur, contents));

/* And the crosshair stops pointing whenever something else has the controls. */
setAimBlocked(() => !!activeScreen || player.dead || introActive());

/* The body spends itself digging, swimming, jumping and swinging; the page says
   which picture of the food bar that moves. */
/* The screen also says how a sentence reaches the player, so that a layer which
   has just run out of something can say so without knowing about toasts. */
registerSpeaker(showToast);

setHungerPainter(renderHunger);

/* The carried essence gets its picture the same way: the essence layer says
   when the total moves, and never names the row it draws. The menu's mission
   page quotes what is being carried toward the next beacon, so the purse
   repaints both. */
setEssencePainter(() => {
  renderEssence();
  paintMenuMission();
});

/* The beacon layer speaks through the page too: the mission page in the menu,
   and the panel the transmissions arrive in. The HUD arrow needs no word of
   it: it asks the waypoint layer every frame, and that reads the beacons live. The page also keeps
   which block of words went up, because one of them is the block the finale
   song waits on. A beacon is lit before its words arrive, so the transmission
   that leaves no beacon to point at is the fifth one. */
let finaleSongWaiting = false;
setBeaconPainter(paintMenuMission);
setTransmissionDeliverer((lines) => {
  finaleSongWaiting = nextBeacon() === null;
  showTransmission(lines);
});

/* And the debug key that skips the walk: the HUD asks, the page moves the walker. */
setBeaconJumper(tourDebugStops);

/* The hearts are the same kind of picture, and so is the red wash: the body
   says when each of them changes, and never names an element. */
setHealthPainter(renderHealth);
setDamageFlash({
  flash: showDamageFlash,
  fade: fadeDamageFlash,
  clear: clearDamageFlash
});

/* And the pack says where its picture is: the hotbar, and the screen too when
   one of them is showing the same thirty-six slots. */
setPackPainter(() => {
  renderHotbar();
  if (activeScreen) renderScreen();
});

/* And the page's screens, toast, sleep fade, readout and spawn column come down
   as one view, so nothing that uses a block has to know their names. */
setInteractionView({
  toast: showToast,
  openScreen,
  placeSpawn: (x, z) => {
    spawnColumn.x = x;
    spawnColumn.z = z;
  },
  showSleepFade: () => sleepFadeEl.classList.add('active'),
  hideSleepFade: () => sleepFadeEl.classList.remove('active'),
  paintReadout: updateDebug
});

/* What the body looks like, and where it stands: the armour bar redraws from the
   worn slots, and a save that has just put a player down hands them to whoever is
   walking about in the world. */
setArmorPainter(renderArmorBar);
setSaveArrival({
  makeChunks: ensurePlayerChunks,
  groundUnder: safeGroundY,
  resetStep: resetCameraStep,
  placeCamera: syncCamera
});

/* Death and respawn, as the screens and the world know them. The body says the
   player is gone, or back; everything else is somebody else's: the run latch,
   the held button, the mining feedback, the crosshair's block, the open screen,
   the words on the death screen, the pointer, the spawn column and the chunks
   around it, which may have unloaded while the player was away. */
setDeathView({
  depart() {
    clearSprintLatch();
    releaseMiningButton();
    cancelBowDraw();
    hideMiningFeedback();
    hideTargetOutline();
    clearMobTarget();
    if (activeScreen) closeScreen();
  },
  show(cause) {
    const messages = {
      fall: 'You fell too far.',
      zombie: 'A zombie got you.',
      creeper: 'A creeper found you.',
      spider: 'A spider got you.',
      skeleton: 'A skeleton shot you.',
      starving: 'You starved with nothing to eat.',
      lava: 'You tried to swim in lava.',
      fire: 'You burned to death.'
    };
    deathCauseEl.textContent = messages[cause] || 'The world got the better of you.';
    deathScreenEl.classList.remove('hidden');
    overlayEl.classList.add('hidden');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  },
  hide() {
    deathScreenEl.classList.add('hidden');
  }
});

setRespawnArrival({
  clearRun: clearSprintLatch,
  place() {
    spawnPlayer(spawnColumn);
    // The spawn area was almost certainly unloaded while the player was out
    // exploring, so mesh it here: without this they come back to an empty sky and
    // a world that streams in a second later around them.
    prepareSpawnChunks(
      Math.floor(spawnColumn.x / CHUNK_SIZE),
      Math.floor(spawnColumn.z / CHUNK_SIZE)
    );
    syncHeldAngles(view.yaw, view.pitch);
    ensurePlayerChunks();
    world.updateStreaming(player.pos.x, player.pos.z);
    updateTarget();
    updateMobTarget();
    updateDebug();
  },
  resume() {
    if (!fallbackControls) requestLock();
    else controlHintEl.classList.remove('hidden');
  }
});

/* The controller's view of the screens: whether one has the controls, and the
   few pictures and verbs a key or a pad button can reach — the control hint, the
   sprint line, the pad's name and its sensitivity, the pad's way through a menu,
   the pack, the hotbar, a screen's own frame step, and the transmission's way off
   the page. */
setInputView({
  screenOpen: () => !!activeScreen || introActive(),
  hint: (show) => controlHintEl.classList.toggle('hidden', !show),
  paintSprint: (on) => {
    if (!sprintStateEl) return;
    sprintStateEl.classList.toggle('hidden', !on);
  },
  paintSensitivity: (value) => {
    if (padSensitivityEl) padSensitivityEl.textContent = value.toFixed(1) + '\u00d7';
    if (padSensSlider && document.activeElement !== padSensSlider) {
      padSensSlider.value = String(value);
    }
  },
  paintPadStatus: (text, on) => {
    if (!padStatusEl) return;
    padStatusEl.textContent = text;
    padStatusEl.classList.toggle('on', on);
  },
  screenTap: handlePadScreenTap,
  hotbarStep: (delta) => selectHotbarSlot(currentSlot() + delta, true),
  togglePack: toggleInventory,
  toggleJournal,
  screenTick: updateGamepadScreen,
  menuPad: padMenuTick,
  dismissTransmission
});

/* The cursor's picture, its refusals, and the grid its screen is using. */
setCursorView({
  screen: () => activeScreen,
  toast: showToast,
  paintCursor: updateCursorVisual
});

/* The held item's frame: the view model reads the game only through this. */
function heldFrame() {
  return {
    stack: getSelectedStack(),
    yaw: view.yaw,
    pitch: view.pitch,
    speed: Math.hypot(player.vel.x, player.vel.z),
    onGround: player.onGround,
    hidden: !!activeScreen || player.dead,
    mining: isMiningHeld() && isMining() && !player.dead,
    swingInterval: MINING_SWING_INTERVAL,
    draw: bowDraw()
  };
}

const loadedSave = readSavedWorld();
if (loadedSave) {
  applySavedEdits(world, loadedSave);
  applySavedBlockEntities(world, loadedSave);
}

// Pick a dry spawn column, then prepare a 3x3 patch synchronously so the spawn
// chunk can mesh with correct borders.
const spawnColumn = chooseSpawnColumn();
setSaveSpawn(spawnColumn);

/* SP0 before the ground: the monuments, the essence prices and the difficulty
   of the whole map are measured from the column the walker first landed on,
   so a saved world gets back the one it was written with and a fresh one
   adopts the column just chosen. The monuments then go into the override
   tables as permanent edits — generated with every chunk, saved with every
   write, and never needing a player to walk out there and find them built. */
if (loadedSave && loadedSave.sp0) {
  restoreSavedBeacons(loadedSave);
} else {
  setSpawnPoint0(spawnColumn);
}
plantBeaconMonuments();
// The saved spots are this world's only if they were written for this SP0.
loadWaypoints();

prepareSpawnChunks(
  Math.floor(spawnColumn.x / CHUNK_SIZE),
  Math.floor(spawnColumn.z / CHUNK_SIZE)
);

if (loadedSave && restoreSavedPlayer(loadedSave)) {
  restoreSavedInventory(loadedSave);
  restoreSavedArmour(loadedSave);
  restoreSavedEssence(loadedSave);
  if (Number.isFinite(loadedSave.time)) setDayTime(loadedSave.time);
  const savedSpawn = loadedSave.spawn;
  if (savedSpawn && Number.isFinite(savedSpawn.x) && Number.isFinite(savedSpawn.z)) {
    spawnColumn.x = Math.trunc(savedSpawn.x);
    spawnColumn.z = Math.trunc(savedSpawn.z);
  }
} else {
  spawnPlayer(spawnColumn);
}
world.updateStreaming(player.pos.x, player.pos.z);
selectHotbarSlot(loadedSave ? clamp(Math.trunc(Number(loadedSave.slot) || 0), 0, HOTBAR_SIZE - 1) : 0);
renderHotbar();
applyDayNight();
updateDebug();

rememberSavedWorld((loadedSave && loadedSave.savedAt) || 0);
initSaveUi(Boolean(loadedSave));

/** The arrival transmission is armed at boot and spent by the frame loop. */
let arrivalWaiting = false;
let arrivalAt = 0;
/** The beat of quiet between the black clearing and the line dialing. */
const ARRIVAL_DELAY_MS = 550;
/** The first-spawn scene is armed the same way and spent the same frame the
 *  overlay lifts; the arrival line waits for the fade to clear. */
let introWaiting = false;
/** True from the moment the arrival line is on the page until the transmitter
 *  finishes it — typed out, or closed — which is when the arrival song plays.
 *  Until then a fresh world has heard no music at all. */
let arrivalSongWaiting = false;

/* A world nobody has walked yet opens the way the design opens it: the walker
   starts with no items but exactly one activation's worth of essence —
   beacon 1's price — and the transmitter's first bubble arrives over the
   landing. A saved world keeps its own purse and its own quiet.

   The bubble itself waits for the game to begin: the start overlay sits above
   the whole HUD, so a transmission fired at boot is words nobody sees, and the
   audio clock is stopped until the first click, so the line would dial itself in
   a heap. It lands a beat after the scene does. */
if (!loadedSave) {
  addEssence(startingEssence());
  arrivalWaiting = true;
  introWaiting = true;
  // Black behind the menu before anything can be seen, so the fade starts from
  // black on the very first frame the overlay lifts.
  primeIntroBlack();
  // Hold the clock's music from the first frame: a fresh world gets no song
  // behind the menu, none during the fade, and none while the transmitter
  // talks. Its first music is the arrival song, at the end of all that.
  setArrivalHold(true);
}
paintMenuMission();

/* Both mission songs land when the transmitter stops talking: the last line
   typed out, or the panel closed early. The arrival song is the tail of the
   arrival sequence, so it only answers once — to the line the spawn point
   sends — and it hands the schedule back to the clock when it goes. The finale
   answers to the fifth beacon's block, which is the transmission that left the
   mission with nowhere to point next. */
setTransmissionFinisher(() => {
  if (arrivalSongWaiting) {
    arrivalSongWaiting = false;
    setArrivalHold(false);
    playSpawnSong();
    return;
  }
  if (finaleSongWaiting) {
    finaleSongWaiting = false;
    playMissionCompleteSong();
  }
});

// A world written by an older build stays in storage but cannot be read, so
// say so out loud on the first new-world boot rather than let a player wonder
// where their base went.
if (!loadedSave && !hasCurrentSave() && hasLegacySave()) {
  showToast('Older worlds can\u2019t be loaded \u2014 this is a new world');
}

/* ---------- Moving the walker outright ---------- */

/**
 * Puts the walker somewhere else in one step: no walk, no velocity carried over,
 * and the ground under the new footing pulled in before the next frame reads it.
 * A fall peak is set at the arrival height so a jump that lands a block low is
 * never read as a drop.
 */
function moveWalker(x, y, z) {
  player.pos.set(x, y, z);
  player.vel.set(0, 0, 0);
  player.onGround = false;
  player.fallPeakY = y;
  resetCameraStep();
  ensurePlayerChunks();
  syncCamera();
  updateTarget();
  updateMobTarget();
  updateDebug();
}

/* ---------- Debug: the tour of the monuments ---------- */

/**
 * The stops the debug tour walks, in mission order: SP0, then the five
 * monuments. Home is a stop of its own because the long way back in from the
 * far bands is the half of the walk nobody wants to make twice.
 */
function debugTourStops() {
  const home = spawnPoint();
  const stops = [{ name: 'SP0', x: home.x, z: home.z, site: null }];
  for (const site of beaconSites()) {
    stops.push({ name: 'Beacon ' + (site.index + 1), x: site.x, z: site.z, site });
  }
  return stops;
}

let debugTourStop = 0;

/**
 * Stands the walker three blocks out from a stop, on the side they would have
 * walked up from, facing the machine. Three clears the plinth's three by three
 * while staying inside the treeless ground the monument search insisted on, and
 * the height comes from safeGroundY, so the arrival is level and never inside a
 * trunk. The ground is generated before the walker is moved: fifteen hundred
 * blocks out there is no streaming behind them to fall back on.
 */
function standAtDebugStop(index) {
  const stops = debugTourStops();
  const wanted = clamp(Math.trunc(Number(index) || 0), 0, stops.length - 1);
  const stop = stops[wanted];
  debugTourStop = wanted;

  // A monument is approached from the stop before it; SP0 faces beacon 1.
  const from = stops[wanted > 0 ? wanted - 1 : 1] || stop;
  const dx = from.x - stop.x;
  const dz = from.z - stop.z;
  const len = Math.hypot(dx, dz) || 1;
  const footX = Math.round(stop.x + (dx / len) * 3);
  const footZ = Math.round(stop.z + (dz / len) * 3);

  prepareSpawnChunks(Math.floor(footX / CHUNK_SIZE), Math.floor(footZ / CHUNK_SIZE));
  moveWalker(footX + 0.5, safeGroundY(footX, footZ), footZ + 0.5);

  if (stop.site) {
    // Aim at the middle of the machine's own cell, which is where a walker
    // looking up at it would point.
    const ax = stop.site.x + 0.5 - (footX + 0.5);
    const ay = stop.site.y + 1.5 - (player.pos.y + EYE_HEIGHT);
    const az = stop.site.z + 0.5 - (footZ + 0.5);
    aimPlayer(Math.atan2(-ax, -az), Math.atan2(ay, Math.hypot(ax, az)));
    applyLook();
    updateTarget();
  }

  const lit = stop.site && stop.site.index < beaconsActivatedCount();
  showToast(stop.site
    ? stop.name + ' \u00b7 ' + (lit ? 'lit' : 'dark') + ' \u00b7 wants ' + stop.site.cost +
      ' \u00b7 ' + stop.site.distance + ' blocks from SP0'
    : 'SP0 \u00b7 home');
}

/** What the tour key asks for: the next stop, or the one before it. */
function tourDebugStops(direction = 1) {
  const total = debugTourStops().length;
  const step = direction < 0 ? -1 : 1;
  standAtDebugStop((debugTourStop + step + total) % total);
}

window.__voxelcraft = {
  version: '0.1.0-milestone-13',
  seed: WORLD_SEED,
  world,
  camera,
  scene,
  renderer,
  atlas: atlasCanvas,
  player,
  spawnColumn,
  inventory,
  itemEntities,
  essenceEntities,
  targetOutline,
  crackMesh,
  heldRoot,
  heldScene,
  heldCamera,
  /**
   * Drop the game into its playing state without pointer lock so automated
   * checks can drive updatePlayer(). Real players get here through the overlay
   * click plus requestLock(); the harness must not race that 350 ms timeout.
   */
  start() {
    if (!isPlayable()) enableFallbackControls();
    return { playable: isPlayable(), screen: activeScreen, dead: player.dead };
  },
  save() {
    // Asking for a write also re-arms autosave, which wipeSave() turns off.
    resumeAutosave();
    saveWorld();
    return this.saveInfo();
  },
  saveInfo() {
    const written = saveReport();
    return {
      key: SAVE_KEY,
      schema: SAVE_SCHEMA,
      savedAt: written.at || null,
      bytes: written.bytes,
      edits: world.overrides.size,
      dirty: isWorldDirty(),
      error: written.error
    };
  },
  /** The pause panel's save line, re-evaluated. Lets the legacy-world notice be checked. */
  saveStatus() {
    refreshSaveStatus();
    return {
      text: saveStatusEl ? saveStatusEl.textContent : null,
      legacy: hasLegacySave(),
      keys: LEGACY_SAVE_KEYS.concat([SAVE_KEY])
    };
  },
  wipeSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      for (const legacy of LEGACY_SAVE_KEYS) localStorage.removeItem(legacy);
    } catch (unavailable) {}
    // Same guard the "New world" button uses: pagehide also writes a save, so
    // without this the wiped world comes straight back on the next load.
    forgetSavedWorld();
    forgetWaypoints();
    refreshSaveStatus();
    return false;
  },
  /** What the HUD arrow could follow, which one it does, and where that is. */
  waypoints() {
    return { targets: waypointTargets(), active: activeWaypoint() };
  },
  /** Where the main menu's highlight is, which page is up, and which hand moved it. */
  menuState() {
    return menuState();
  },
  render() {
    renderGame();
    return renderer.info.render.triangles;
  },
  health() {
    return {
      health: player.health,
      max: player.maxHealth,
      dead: player.dead,
      hurtCooldown: player.hurtCooldown,
      regenDelay: player.regenDelay
    };
  },
  setHealth(value) {
    player.health = clamp(Number(value) || 0, 0, player.maxHealth);
    if (player.health > 0 && player.dead) {
      player.dead = false;
      deathScreenEl.classList.add('hidden');
    }
    renderHealth();
    return this.health();
  },
  damage(amount, cause = 'debug') {
    damagePlayer(Number(amount) || 0, cause);
    return this.health();
  },
  /** Food left, plus Minecraft's two invisible counters that spend it. */
  hunger() {
    return {
      hunger: player.hunger,
      saturation: Number(player.saturation.toFixed(3)),
      exhaustion: Number(player.exhaustion.toFixed(3)),
      max: HUNGER_MAX,
      regenNeeds: HUNGER_REGEN_MIN,
      /** Exhaustion that spends one point, saturation first and food after. */
      biteCost: EXHAUSTION_THRESHOLD,
      /** The HUD's only tell for the hidden counter: full bar, no cushion. */
      jittering: hungerBarEl.classList.contains('jitter')
    };
  },
  setHunger(points) {
    player.hunger = clamp(Number(points) || 0, 0, HUNGER_MAX);
    // Saturation cannot outlive the food it cushions, so dropping the bar drags it
    // down with it rather than leaving an invisible cushion on an empty stomach.
    player.saturation = Math.min(player.saturation, player.hunger);
    renderHunger();
    markWorldDirty();
    return this.hunger();
  },
  /** Sets the hidden saturation counter, which can never exceed the food. */
  setSaturation(points) {
    player.saturation = clamp(Number(points) || 0, 0, player.hunger);
    renderHunger();
    markWorldDirty();
    return this.hunger();
  },
  /** Eats one bite of whatever food is held, as a right click would. */
  eat() {
    return tryEatSelectedItem();
  },
  /** The essence the walker carries: the fuel a kill pays and a beacon wants. */
  essence() {
    return essenceCount();
  },
  /** Debug grant: puts essence straight in hand, the give shelf's way with items. */
  grantEssence(amount = 5) {
    return addEssence(Number(amount) || 0);
  },
  /** The mission: SP0, the five monuments, their prices, and how many run. */
  beacons() {
    return beaconReport();
  },
  /**
   * Debug fast-forward of the mission: put `count` monuments down as running
   * without the walk or the purse, blocks included, so a scripted check reads
   * the same world a played one would. Backwards works the same way.
   */
  advanceBeacons(count = 1) {
    const wanted = clamp(Math.trunc(Number(count) || 0), 0, beaconSites().length);
    for (const site of beaconSites()) {
      const y = site.y + 1;
      const id = world.getBlock(site.x, y, site.z);
      if (site.index < wanted && id === B.BEACON) {
        world.setBlock(site.x, y, site.z, B.BEACON_ACTIVE);
      } else if (site.index >= wanted && id === B.BEACON_ACTIVE) {
        world.setBlock(site.x, y, site.z, B.BEACON);
      }
    }
    clearBeaconBeams();
    restoreBeaconProgress(wanted);
    return beaconReport();
  },
  /**
   * The debug tour: stands the walker at one stop — 0 is SP0, 1 to 5 are the
   * five monuments — on the side they would have walked up from, facing the
   * machine. The same jump the T key makes, without the key.
   */
  visitBeacon(stop = 0) {
    standAtDebugStop(Number(stop) || 0);
    return { stop: debugTourStop, feet: [player.pos.x, player.pos.y, player.pos.z] };
  },
  /** One step along the tour: +1 forward, anything else back. */
  beaconTour(direction = 1) {
    tourDebugStops(direction);
    return { stop: debugTourStop, feet: [player.pos.x, player.pos.y, player.pos.z] };
  },
  /** Which tour stop the walker is standing at. */
  tourStop() { return debugTourStop; },
  heal(amount = 20) {
    healPlayer(Number(amount) || 0);
    return this.health();
  },
  respawn() {
    respawnPlayer();
    return this.health();
  },
  addMob(type, x = player.pos.x + 3, y = player.pos.y, z = player.pos.z) {
    const mob = spawnMob(type, x, y, z);
    return mob ? this.mobInfo(mob) : null;
  },
  attack() {
    updateTarget();
    updateMobTarget();
    const target = mobTarget();
    return target ? attackMob(target) : false;
  },
  /** Draw the bow in hand for `seconds`, let go, and say what is in the air. */
  loose(seconds = 1) {
    if (!beginBowDraw()) return { loosed: false, reason: 'no bow in hand' };
    updateArchery(Math.max(0.001, Number(seconds) || 0));
    const loosed = releaseBowDraw();
    return { loosed, arrows: this.arrows() };
  },
  /** Every arrow in flight or stuck, and whose it is. */
  arrows() {
    return arrows.map((arrow) => ({
      pos: [arrow.pos.x, arrow.pos.y, arrow.pos.z],
      vel: [arrow.vel.x, arrow.vel.y, arrow.vel.z],
      from: arrow.from === 'walker' ? 'walker' : arrow.from.type,
      damage: arrow.damage,
      stuck: arrow.stuck
    }));
  },
  mob() {
    const target = mobTarget();
    return target ? this.mobInfo(target) : null;
  },
  mobInfo(mob) {
    return {
      serial: mob.serial,
      type: mob.type,
      health: mob.health,
      maxHealth: mob.maxHealth,
      hostile: mob.def.hostile,
      // What the ground it spawned on made of it: the difficulty score and
      // the bite it carries, both scaled from the definition.
      difficulty: Number(mob.difficulty.toFixed(3)),
      attack: mob.attack == null ? null : Number(mob.attack.toFixed(2)),
      pos: [mob.pos.x, mob.pos.y, mob.pos.z],
      onGround: mob.onGround,
      fuse: mob.fuse,
      sheared: mob.sheared,
      soundTimer: Number(mob.soundTimer.toFixed(2)),
      audioCooldown: Number(mob.audioCooldown.toFixed(2))
    };
  },
  mobs() {
    return mobs.map((mob) => this.mobInfo(mob));
  },
  /** Runs one passive-spawn pass immediately, the way the timer does. */
  spawnPassive() {
    const mob = trySpawnPassive();
    return mob ? this.mobInfo(mob) : null;
  },
  /** Runs one hostile-spawn pass immediately, the way the timer does. */
  spawnHostile() {
    const mob = trySpawnHostile();
    return mob ? this.mobInfo(mob) : null;
  },
  /**
   * The mob budget, and why hostile spawning is refusing. `tally` counts since
   * the last reset: a `hostile_cap` count that climbs while nothing is on screen
   * means the budget is full of mobs the player cannot see.
   */
  spawnReport() {
    return {
      caps: { total: MOB_CAP, passive: PASSIVE_CAP, hostile: HOSTILE_CAP },
      live: { total: mobs.length, passive: countMobs(false), hostile: countMobs(true) },
      night: isNight(),
      band: [MOB_SPAWN_MIN_RADIUS, MOB_SPAWN_MAX_RADIUS],
      tally: { ...hostileSpawnTally }
    };
  },
  resetSpawnTally() {
    zeroSpawnTally();
    return { ...hostileSpawnTally };
  },
  /** Loaded chunks around the player whose herd roll has not been spent yet. */
  unspentSpawnChunks() {
    let count = 0;
    for (const chunk of world.chunks.values()) {
      if (!chunk.meshed || chunk.mobSpawnChecked) continue;
      const dx = chunk.cx * CHUNK_SIZE + CHUNK_SIZE / 2 - player.pos.x;
      const dz = chunk.cz * CHUNK_SIZE + CHUNK_SIZE / 2 - player.pos.z;
      if (Math.hypot(dx, dz) <= PASSIVE_SPAWN_RADIUS) count++;
    }
    return count;
  },
  clearMobs() {
    const removed = mobs.length;
    for (const mob of mobs) {
      scene.remove(mob.group);
      for (const material of mob.materials) material.dispose();
    }
    mobs.length = 0;
    clearArrows();
    return removed;
  },
  hurtMob(serial, amount = 5) {
    const mob = mobs.find((entry) => entry.serial === serial);
    if (!mob) return false;
    damageMob(mob, Number(amount) || 0, 0, 0);
    return true;
  },
  swing() {
    triggerHeldSwing();
    return true;
  },
  heldItem() {
    const stack = getSelectedStack();
    return {
      id: stack ? stack.id : null,
      count: stack ? stack.count : 0,
      dur: stack ? stack.dur ?? null : null,
      model: heldModelKey,
      visible: heldRoot.visible
    };
  },
  /** Teleport the player's feet to the given world coordinates. */
  teleport(x, y, z) { moveWalker(x, y, z); },
  /** Whether the first-spawn scene has the controls. */
  intro() {
    return introActive();
  },
  /** Cut the first-spawn fade short: the world is shown at once, and the
   *  transmission and the arrival song still take their turn afterwards. */
  skipIntro() {
    const skipped = skipIntro();
    updateDebug();
    return skipped;
  },
  look(yawValue, pitchValue) {
    aimPlayer(yawValue, pitchValue);
    applyLook();
    updateTarget();
  },
  /** Aim the camera at a block's centre (debug/testing helper). */
  lookAt(x, y, z) {
    const dx = x - player.pos.x;
    const dy = y - (player.pos.y + EYE_HEIGHT);
    const dz = z - player.pos.z;
    aimPlayer(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    applyLook();
    updateTarget();
    return this.target();
  },
  getBlock(x, y, z) {
    return world.getBlock(x, y, z);
  },
  /** The definition table entry for a block, by key or id. */
  blockInfo(key) {
    const block = typeof key === 'number' ? BLOCKS[key] : BLOCK_BY_KEY.get(key);
    if (!block) return null;
    return {
      id: block.id,
      key: block.key,
      name: block.name,
      hardness: block.hardness,
      tool: block.tool ?? null,
      tier: block.tier ?? null,
      solid: block.solid,
      opaque: block.opaque,
      cutout: block.cutout,
      light: block.light ?? 0,
      facings: block.facings,
      stairs: block.stairs,
      ladder: block.ladder,
      blockEntity: block.blockEntity,
      placeable: block.placeable,
      drops: (block.drops ?? []).map((drop) => drop.item),
      tiles: {
        top: block.tileTop,
        bottom: block.tileBottom,
        side: block.tileSide,
        front: block.tileFront === undefined ? null : block.tileFront
      }
    };
  },
  /** Stored orientation of an oriented block at a position, if any. */
  facingAt(x, y, z) {
    return world.facingAt(x, y, z);
  },
  getSkyLight(x, y, z) {
    return world.getSkyLight(x, y, z);
  },
  getBlockLight(x, y, z) {
    return world.getBlockLight(x, y, z);
  },
  getLight(x, y, z) {
    return {
      sky: world.getSkyLight(x, y, z),
      block: world.getBlockLight(x, y, z)
    };
  },
  sampleColumn(x, z) {
    return sampleColumn(x, z);
  },
  treeAt(x, z) {
    return treeAt(x, z);
  },
  give(itemId, count = 1, dur) {
    const leftover = addItemToInventory(itemId, count, dur);
    renderHotbar();
    return { added: count - leftover, leftover };
  },
  /** Opens the debug give shelf, the on-screen menu that hands out items. */
  openGive() {
    openScreen('give');
    return activeScreen;
  },
  /** Everything the give shelf carries, in shelf order. */
  giveList() {
    return GIVE_ITEMS.map((id) => ({
      id,
      name: ITEMS.get(id).name,
      stack: ITEMS.get(id).stack
    }));
  },
  itemCount(itemId) {
    return countInventoryItem(itemId);
  },
  /** Durability of the stack in an inventory slot, or null if it never wears. */
  durability(slotIndex = currentSlot()) {
    return stackDurability(inventory[Number(slotIndex)] || null);
  },
  /** Worn armour: the four slots plus the defence they are worth. */
  armour() {
    const worn = {};
    armorSlots.forEach((stack, i) => {
      worn[ARMOR_SLOTS[i]] = stack
        ? { id: stack.id, dur: stack.dur ?? null, max: ITEMS.get(stack.id).durability }
        : null;
    });
    return { defense: armorDefense(), worn };
  },
  /** How much of a hit a given defence would absorb, Minecraft's formula. */
  armorAbsorb(defense, amount) {
    return armorAbsorbed(Number(defense) || 0, Number(amount) || 0);
  },
  /** Equips the stack in an inventory slot, the way shift-click does. */
  equip(slotIndex) {
    const stack = inventory[Number(slotIndex)];
    if (!stack || equipSlotFor(stack) < 0) return null;
    inventory[Number(slotIndex)] = null;
    const spare = equipStack(stack);
    if (spare) inventory[Number(slotIndex)] = spare;
    renderArmorBar();
    renderHotbar();
    markWorldDirty();
    return this.armour();
  },
  /** Takes a piece off into the first free slot. False when the pack is full. */
  unequip(armorSlot) {
    const index = ARMOR_SLOTS.indexOf(String(armorSlot));
    if (index < 0) return false;
    const moved = unequipSlot(index);
    if (moved) {
      renderArmorBar();
      renderHotbar();
      markWorldDirty();
    }
    return moved;
  },
  /** Empty every slot, cursor included. Handy for focused test runs. */
  clearInventory() {
    for (let i = 0; i < INVENTORY_SIZE; i++) inventory[i] = null;
    for (let i = 0; i < armorSlots.length; i++) armorSlots[i] = null;
    renderArmorBar();
    returnCursorStack();
    renderHotbar();
    if (activeScreen) renderScreen();
    return true;
  },
  openInventory() {
    openScreen('inventory');
    return activeScreen;
  },
  /** Opens the journal of recipes the beacons have transmitted. */
  openJournal() {
    openScreen('journal');
    return activeScreen;
  },
  openCraftingTable() {
    openScreen('crafting');
    return activeScreen;
  },
  /** Opens the furnace screen for the furnace at a position. */
  openFurnace(x = null, y = null, z = null) {
    let at = null;
    if (x !== null && y !== null && z !== null) at = { x, y, z };
    else if (currentTarget && isFurnaceBlock(currentTarget.id)) {
      at = { x: currentTarget.x, y: currentTarget.y, z: currentTarget.z };
    }
    if (!at) return null;
    openScreen('furnace', at);
    return activeScreen;
  },
  /** Furnace contents and timers at a position, or the open furnace. */
  furnace(x = null, y = null, z = null) {
    let key = null;
    if (x !== null && y !== null && z !== null) key = x + ',' + y + ',' + z;
    else if (activeScreenAt) {
      key = activeScreenAt.x + ',' + activeScreenAt.y + ',' + activeScreenAt.z;
    }
    if (!key) return null;

    const state = world.blockEntities.get(key);
    if (!state) return null;
    const parts = key.split(',');
    const facing = world.facings.get(key) ?? null;
    return {
      at: [Number(parts[0]), Number(parts[1]), Number(parts[2])],
      block: world.getBlock(Number(parts[0]), Number(parts[1]), Number(parts[2])),
      lit: state.burnTime > 0,
      burn: Number(state.burnTime.toFixed(2)),
      burnTotal: state.burnTotal,
      cook: Number(state.cookTime.toFixed(2)),
      facing,
      input: slotInfo(state.slots[FURNACE_INPUT]),
      fuel: slotInfo(state.slots[FURNACE_FUEL]),
      output: slotInfo(state.slots[FURNACE_OUTPUT])
    };
  },
  /** The smelting table, for scripted checks. */
  smelting() {
    return {
      recipes: [...SMELTING_RECIPES].map(([from, to]) => ({
        from, to: to.out, seconds: to.seconds
      })),
      fuels: [...FURNACE_FUELS].map(([id, seconds]) => ({ id, seconds }))
    };
  },
  /** Every furnace in the world, for scripted checks. */
  furnaceList() {
    const rows = [];
    for (const [key, state] of world.blockEntities) {
      if (state.kind !== 'furnace') continue;
      const at = key.split(',').map(Number);
      rows.push({
        at,
        block: world.getBlock(at[0], at[1], at[2]),
        facing: world.facings.get(key) ?? null,
        lit: state.burnTime > 0,
        burn: Number(state.burnTime.toFixed(2)),
        cook: Number(state.cookTime.toFixed(2)),
        slots: state.slots.map((slot) => (slot ? slot.id + ' x' + slot.count : null))
      });
    }
    return rows;
  },
  /** Puts stacks straight into a furnace, for scripted tests. */
  setFurnaceSlots(x, y, z, input = null, fuel = null, count = 1, output = null) {
    if (!isFurnaceBlock(world.getBlock(x, y, z))) return null;
    const state = world.blockEntityAt(x, y, z, 'furnace');
    if (!state) return null;
    state.slots[FURNACE_INPUT] = input ? freshStack(input, count) : null;
    state.slots[FURNACE_FUEL] = fuel ? freshStack(fuel, count) : null;
    state.slots[FURNACE_OUTPUT] = output ? freshStack(output, count) : null;
    if (activeScreen === 'furnace') renderScreen();
    return this.furnace(x, y, z);
  },
  /** Opens the chest screen for the chest at a position. */
  openChest(x = null, y = null, z = null) {
    let at = null;
    if (x !== null && y !== null && z !== null) at = { x, y, z };
    else if (currentTarget && isChestBlock(currentTarget.id)) {
      at = { x: currentTarget.x, y: currentTarget.y, z: currentTarget.z };
    }
    if (!at) return null;
    openScreen('chest', at);
    return activeScreen;
  },
  /** Chest contents at a position, or the open chest. */
  chest(x = null, y = null, z = null) {
    let key = null;
    if (x !== null && y !== null && z !== null) key = x + ',' + y + ',' + z;
    else if (activeScreen === 'chest' && activeScreenAt) {
      key = activeScreenAt.x + ',' + activeScreenAt.y + ',' + activeScreenAt.z;
    }
    if (!key) return null;

    const state = world.blockEntities.get(key);
    if (!state || state.kind !== 'chest') return null;
    const parts = key.split(',');
    return {
      at: [Number(parts[0]), Number(parts[1]), Number(parts[2])],
      block: world.getBlock(Number(parts[0]), Number(parts[1]), Number(parts[2])),
      facing: world.facings.get(key) ?? null,
      used: state.slots.filter((slot) => slot).length,
      slots: state.slots.map((slot) => slotInfo(slot))
    };
  },
  /** Every chest in the world, for scripted checks. */
  chestList() {
    const rows = [];
    for (const [key, state] of world.blockEntities) {
      if (state.kind !== 'chest') continue;
      const at = key.split(',').map(Number);
      rows.push({
        at,
        block: world.getBlock(at[0], at[1], at[2]),
        facing: world.facings.get(key) ?? null,
        slots: state.slots.map((slot) => (slot ? slot.id + ' x' + slot.count : null))
      });
    }
    return rows;
  },
  /**
   * Puts stacks straight into a chest, for scripted tests. Rows read either
   * 'wheat' or ['wheat', 12]; anything else leaves the slot empty.
   */
  setChestSlots(x, y, z, rows = []) {
    if (!isChestBlock(world.getBlock(x, y, z))) return null;
    const state = world.blockEntityAt(x, y, z, 'chest');
    if (!state) return null;
    for (let i = 0; i < CHEST_SLOTS; i++) {
      const row = rows[i];
      if (!row) {
        state.slots[i] = null;
      } else if (Array.isArray(row)) {
        state.slots[i] = row[0] ? freshStack(row[0], row[1] || 1) : null;
      } else {
        state.slots[i] = freshStack(row, 1);
      }
    }
    if (activeScreen === 'chest') renderScreen();
    return this.chest(x, y, z);
  },
  closeScreen() {
    closeScreen();
    return activeScreen;
  },
  screen() {
    return activeScreen;
  },
  cursor() {
    return slotInfo(cursorCarried());
  },
  setCraftingGrid(kind, itemIds = []) {
    const grid = kind === '3x3' ? craft3 : craft2;
    for (let i = 0; i < grid.length; i++) {
      const id = itemIds[i] || null;
      grid[i] = id ? freshStack(id, 1) : null;
    }
    if (activeScreen) renderScreen();
    return this.craftPreview(kind);
  },
  craftPreview(kind = '2x2') {
    const grid = kind === '3x3' ? craft3 : craft2;
    const size = kind === '3x3' ? CRAFT3_SIZE : CRAFT2_SIZE;
    const recipe = matchRecipe(grid, size);
    return recipe ? {
      id: recipe.result.id,
      count: recipe.result.count,
      recipe: recipe.id
    } : null;
  },
  craft(kind = '2x2') {
    const grid = kind === '3x3' ? craft3 : craft2;
    const size = kind === '3x3' ? CRAFT3_SIZE : CRAFT2_SIZE;
    const recipe = matchRecipe(grid, size);
    if (!recipe) return null;
    const produced = freshStack(recipe.result.id, recipe.result.count);
    consumeCraftIngredients(grid);
    const leftover = addItemToInventory(produced.id, produced.count, produced.dur);
    if (leftover > 0) {
      spawnItemDrop(
        produced.id, leftover,
        player.pos.x, player.pos.y + 1.2, player.pos.z, false, produced.dur
      );
    }
    renderHotbar();
    if (activeScreen) renderScreen();
    return { id: produced.id, count: produced.count, recipe: recipe.id };
  },
  recipes() {
    return RECIPES.map((recipe) => ({
      id: recipe.id,
      result: { ...recipe.result },
      shapeless: recipe.shapeless ? [...recipe.shapeless] : null,
      pattern: recipe.pattern ? [...recipe.pattern] : null,
      unlockedBy: recipe.unlockedBy ?? null,
      received: recipeReceived(recipe)
    }));
  },
  selectSlot(index) {
    selectHotbarSlot(index, true);
    return currentSlot();
  },
  /** Set or flip the sprint latch, the way Shift, Ctrl and B do. */
  setSprint(value) {
    if (value === 'toggle') toggleSprintLatch();
    else setSprintLatch(!!value);
    return this.sprintState();
  },
  sprintState() {
    return { latched: sprintLatched, sprinting: player.sprinting };
  },
  gamepad() {
    return {
      connected: gamepadState.connected,
      active: gamepadState.active,
      index: gamepadState.index,
      name: gamepadState.name,
      sensitivity: gamepadState.sensitivity,
      axes: gamepadState.axes.slice(),
      buttons: gamepadState.buttons.map(Boolean),
      mining: padMiningDown,
      screen: activeScreen,
      cursor: { section: padCursor.section, index: padCursor.index },
      virtual: virtualPad.active
    };
  },
  setGamepadSensitivity(value) {
    setGamepadSensitivity(value);
    return this.gamepad();
  },
  /** Simulate a pad button tap through the normal handler chain. */
  padTap(name) {
    if (!gamepadState.active) {
      gamepadState.active = true;
      updatePadStatus();
    }
    handlePadTap(String(name).toLowerCase());
    return this.gamepad();
  },
  /** Hold a synthetic pad state; safe to leave active between checks. */
  setVirtualPad(config = {}) {
    virtualPad.active = true;
    virtualPad.axes = [0, 0, 0, 0];
    virtualPad.buttons = new Array(17).fill(false);
    const axes = config.axes || [];
    for (let i = 0; i < Math.min(4, axes.length); i++) {
      virtualPad.axes[i] = Number(axes[i]) || 0;
    }
    for (const [name, value] of Object.entries(config.buttons || {})) {
      const index = PAD_BUTTON[name];
      if (index != null) virtualPad.buttons[index] = !!value;
    }
    return this.gamepad();
  },
  clearVirtualPad() {
    virtualPad.active = false;
    virtualPad.axes = [0, 0, 0, 0];
    virtualPad.buttons = new Array(17).fill(false);
    gamepadState.pressed.fill(false);
    gamepadState.prev.fill(false);
    return this.gamepad();
  },
  audio() {
    return audioStatus();
  },
  setMuted(value) {
    setAudioMuted(value);
    return audioStatus();
  },
  setVolume(value) {
    setAudioVolume(Number(value));
    return audioStatus();
  },
  setSfxVolume(value) {
    setAudioSfxVolume(Number(value));
    return audioStatus();
  },
  setMusicVolume(value) {
    setAudioMusicVolume(Number(value));
    return audioStatus();
  },
  toggleMute() {
    toggleAudioMuted();
    return audioStatus();
  },
  playSound(name, options = {}) {
    return playSound(name, options);
  },
  emberCount() {
    return emberCount();
  },
  torchEmbers() {
    return torchEmbers();
  },
  explosionFx() {
    return explosionEffects();
  },
  target() {
    updateTarget();
    if (!currentTarget) return null;
    return {
      x: currentTarget.x,
      y: currentTarget.y,
      z: currentTarget.z,
      id: currentTarget.id,
      name: BLOCKS[currentTarget.id].name,
      normal: { ...currentTarget.normal },
      distance: currentTarget.distance
    };
  },
  /** Hold left click for the given number of seconds. */
  mine(seconds = 1) {
    const frames = Math.max(1, Math.ceil(seconds * 60));
    const dt = seconds / frames;
    for (let i = 0; i < frames; i++) {
      updateTarget();
      updateMobTarget();
      updateMining(dt, !mobTarget());
      updateItemEntities(dt);
      updateEssenceBubbles(dt);
      updateBreakParticles(dt);
      updateTorchEmbers(dt);
    }
    updateTarget();
    updateDebug();
    return this.stats();
  },
  /**
   * Break time in seconds for a block with a given item in hand, worked out
   * without touching the world. Pass null as the item for an empty hand.
   */
  breakTime(block, item = null) {
    let blockId = block;
    if (typeof block === 'string') {
      blockId = BLOCK_BY_KEY.get(block)?.id ?? Number(block);
    }
    if (!Number.isFinite(blockId)) return null;
    const facts = miningFacts(blockId, item ? makeStack(item, 1) : null);
    return {
      seconds: Number.isFinite(facts.duration)
        ? Number(facts.duration.toFixed(4))
        : null,
      canHarvest: facts.canHarvest,
      wearsTool: facts.wearsTool
    };
  },
  /** Snapshot of the mining loop, including the tool it is wearing down. */
  mining() {
    const loop = miningReport();
    return {
      ...loop,
      delay: Number(loop.delay.toFixed(3)),
      held: slotInfo(getSelectedStack())
    };
  },
  place() {
    const placed = tryPlaceSelectedBlock();
    updateTarget();
    return placed;
  },
  /** Right-clicks whatever the crosshair is on: place, eat, shear, sleep. */
  use() {
    updateTarget();
    updateMobTarget();
    const used = tryUseSelectedItem();
    updateTarget();
    return { used, target: currentTarget ? { ...currentTarget } : null };
  },
  /** Tills the block under the crosshair with the hoe in hand. */
  tillDirt() {
    updateTarget();
    const tilled = currentTarget ? useHoeOnTarget() : false;
    updateTarget();
    return { tilled, target: currentTarget ? { ...currentTarget } : null };
  },
  /** Sows the seeds in hand onto the farmland under the crosshair. */
  plantSeed() {
    updateTarget();
    const planted = currentTarget ? plantSeedsOnTarget() : false;
    updateTarget();
    return { planted, crops: this.crops() };
  },
  /** Every tracked crop with its stage, so a field can be read at a glance. */
  crops() {
    const list = [];
    for (const key of world.crops) {
      const [x, y, z] = key.split(',').map(Number);
      const block = BLOCKS[world.getBlock(x, y, z)];
      list.push({
        at: [x, y, z],
        stage: block.crop,
        ground: world.getBlock(x, y - 1, z),
        wet: isFarmlandWet(x, y - 1, z),
        sky: world.getSkyLight(x, y, z),
        lamp: world.getBlockLight(x, y, z)
      });
    }
    return list;
  },
  /**
   * Whether the farmland at these coordinates has water within reach. Any
   * liquid within the square at its level or one above counts, and a false
   * answer means the crops on it are standing still, not dying.
   */
  soilWet(x, y, z) {
    return world.getBlock(x, y, z) === B.FARMLAND && isFarmlandWet(x, y, z);
  },
  /** Runs the crop growth clock forward without waiting real time. */
  growCrops(seconds = 60) {
    updateCrops(seconds);
    return this.crops();
  },
  /**
   * Every flow cell in the loaded world, which is to say every drop the
   * simulation has actually moved. The ocean is all sources, so it never shows
   * up here and the list stays exactly as large as the flooding is. Give it a
   * centre to look at one patch, which is far cheaper than the whole world.
   */
  water(limit = 500, centre = null, radius = 32) {
    const list = [];
    const reach = Math.ceil(radius / CHUNK_SIZE);
    const cxc = centre ? Math.floor(centre[0] / CHUNK_SIZE) : 0;
    const czc = centre ? Math.floor(centre[2] / CHUNK_SIZE) : 0;
    for (const chunk of world.chunks.values()) {
      if (!chunk.generated) continue;
      if (centre && (Math.abs(chunk.cx - cxc) > reach || Math.abs(chunk.cz - czc) > reach)) {
        continue;
      }
      const baseX = chunk.cx * CHUNK_SIZE;
      const baseZ = chunk.cz * CHUNK_SIZE;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const level = BLOCKS[chunk.blocks[blockIndex(x, y, z)]].waterLevel;
            // Sources sit at 0 and air below that, so this is only ever the
            // thin water: what the flow actually put there.
            if (level <= 0) continue;
            if (list.length >= limit) return list;
            list.push({ at: [baseX + x, y, baseZ + z], level });
          }
        }
      }
    }
    return list;
  },
  /**
   * Runs the flow clock forward without waiting for real time, so a flood can
   * be watched to completion in one call. Ask for `list` to get the cells back;
   * counting them means reading every loaded chunk.
   */
  flow(seconds = 1, list = false) {
    const passes = Math.max(1, Math.ceil(seconds / WATER_TICK_SECONDS));
    let changed = 0;
    for (let i = 0; i < passes; i++) {
      changed += waterTick();
      if (world.waterQueue.size === 0 && world.flowRemesh.size === 0) break;
    }
    return {
      changed,
      queued: world.waterQueue.size,
      waiting: world.waterWait.size,
      parked: world.parkedWaterCount(),
      remeshing: world.flowRemesh.size,
      cells: list ? this.water(500) : undefined
    };
  },
  /**
   * The flow rules, tried against a world made on the spot rather than the
   * player's: `world.getBlock` is briefly shadowed by a lookup into a small map,
   * the tick is replayed here the way waterTick runs it, and nothing reaches a
   * chunk, an override or a save.
   *
   * The rigs are the shapes the rules once lost their nerve on. A breach two
   * blocks deeper than the water standing over it left a neck of air with a sheet
   * below it and nothing beside it, and no rule in desiredFluid claimed the
   * neck: it dried, the orphaned sheet thinned itself a rank a tick, the fall
   * returned and the whole thing pulsed for as long as the chunk stayed loaded.
   * So every case is a convergence test first — a dig has to reach a state it no
   * longer wants to leave — and the shape is the fixed point it should reach.
   */
  waterFlowCheck() {
    const key = (x, y, z) => x + ',' + y + ',' + z;
    const at = (cells) => (x, y, z) => {
      if (y < 0) return B.BEDROCK;
      if (y >= WORLD_HEIGHT) return B.AIR;
      return cells.get(key(x, y, z)) ?? B.AIR;
    };
    /** A source is a full block; every rank below it is an eighth thinner. */
    const volume = (cells) => {
      let eighths = 0;
      for (const id of cells.values()) {
        const level = BLOCKS[id].waterLevel;
        if (level >= 0) eighths += 8 - level;
      }
      return eighths / 8;
    };
    const show = (id) => {
      if (id === B.WATER) return 'S';
      if (isFallingWater(id)) return 'v';
      if (isFlowWater(id)) return String(waterLevel(id));
      // Lava reads as letters so a mixed rig stays one row of characters: L for
      // a source, A to C for its resting ranks, ! for lava pouring down, and
      // the two things a meeting leaves behind, c for cobblestone and O for
      // obsidian. No water-only rig produces any of them.
      if (id === B.LAVA) return 'L';
      if (isLava(id)) {
        return BLOCKS[id].falling ? '!' : 'ABC'[BLOCKS[id].fluidLevel - 1];
      }
      if (id === B.COBBLESTONE) return 'c';
      if (id === B.OBSIDIAN) return 'O';
      return id === B.AIR ? '.' : '#';
    };
    const rig = () => {
      const cells = new Map();
      /** Solid on the outside, hollowed out and filled by the caller. */
      const box = (x0, y0, z0, x1, y1, z1, id) => {
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++)
            for (let z = z0; z <= z1; z++) cells.set(key(x, y, z), id);
      };
      return { cells, box };
    };
    /**
     * The tick, replayed: reads see the pass as it began, the writes go in
     * together afterwards, and whatever moved wakes the six cells beside it.
     */
    const run = (caseRig, limit = 200) => {
      const read = at(caseRig.cells);
      const queue = new Set();
      const wake = (x, y, z) => {
        queue.add(key(x, y, z));
        for (const [dx, dy, dz] of WATER_NEIGHBORS) {
          const ny = y + dy;
          if (ny >= 0 && ny < WORLD_HEIGHT) queue.add(key(x + dx, ny, z + dz));
        }
      };
      for (const cell of Array.from(caseRig.cells.keys())) {
        const [x, y, z] = cell.split(',').map(Number);
        wake(x, y, z);
      }
      let passes = 0;
      const hadOwn = Object.prototype.hasOwnProperty.call(world, 'getBlock');
      const realGetBlock = world.getBlock;
      world.getBlock = read;
      try {
        while (queue.size > 0 && passes < limit) {
          const batch = Array.from(queue);
          queue.clear();
          passes++;
          const edits = [];
          for (const cell of batch) {
            const [x, y, z] = cell.split(',').map(Number);
            const next = desiredFluid(x, y, z);
            if (next !== read(x, y, z)) edits.push([x, y, z, next]);
          }
          for (const [x, y, z, id] of edits) {
            caseRig.cells.set(key(x, y, z), id);
            wake(x, y, z);
          }
        }
      } finally {
        if (hadOwn) world.getBlock = realGetBlock;
        else delete world.getBlock;
      }
      return { passes, settled: queue.size === 0 };
    };
    const cases = [];
    /** Runs a rig, keeps what it settled into, and says whether that was the point. */
    const test = (name, built, expect, check) => {
      const result = run(built.rig);
      const got = built.read();
      cases.push({
        name,
        passes: result.passes,
        settled: result.settled,
        got,
        expect,
        volume: +volume(built.rig.cells).toFixed(4),
        pass: result.settled && (expect === undefined || got === expect) &&
          (check === undefined || check(built.rig))
      });
    };

    // A shaft sealed by solid ground on every side but its own floor, with one
    // source dropped down it. One deep always settled; two deep used to pulse,
    // because the neck of air between the source and the pool belonged to no rule.
    const shaft = (depth) => {
      const built = rig();
      built.box(-1, 0, -1, 1, depth + 2, 1, B.STONE);
      for (let y = 1; y <= depth; y++) built.box(0, y, 0, 0, y, 0, B.AIR);
      built.box(0, depth + 1, 0, 0, depth + 1, 0, B.WATER);
      const read = at(built.cells);
      return {
        rig: built,
        read: () => {
          let column = '';
          for (let y = depth + 1; y >= 1; y--) column += show(read(0, y, 0));
          return column;
        }
      };
    };
    test('one block under a source', shaft(1), 'S1', (r) => volume(r.cells) === 1 + 7 / 8);
    test('two blocks under a source', shaft(2), 'Sv1', (r) => volume(r.cells) === 1 + 2 * (7 / 8));
    test('three blocks under a source', shaft(3), 'Svv1', (r) => volume(r.cells) === 1 + 3 * (7 / 8));

    // A shore blown out under the sea: the trench is three rows deeper than the
    // sources over it and twice as wide, so the floor has to flood from the falls
    // above it and then thin away sideways until the reach runs out. The lip the
    // sea pours over stays a column, and the row above the floor beside it stays
    // dry, because a fall feeds nobody beside it.
    const trench = (() => {
      const built = rig();
      built.box(-1, 0, -1, 14, 5, 3, B.STONE);
      built.box(0, 1, 0, 12, 3, 2, B.AIR);          // 13 x 3, three rows open
      built.box(0, 3, 0, 6, 3, 2, B.WATER);         // the sea over half of it
      const read = at(built.cells);
      return {
        rig: built,
        read: () => {
          const row = (y) => {
            let line = '';
            for (let x = 0; x <= 12; x++) line += show(read(x, y, 0));
            return line;
          };
          return row(3) + '/' + row(2) + '/' + row(1);
        }
      };
    })();
    test('a breach under the sea', trench, 'SSSSSSSv...../vvvvvvvv...../1111111123456');

    // Pull the sea out and the whole flood has to leave: a sheet left behind with
    // nothing feeding it runs off rather than hanging there, and a column of falls
    // with air overhead is nothing holding it up.
    const drained = (() => {
      const built = trench.rig;
      for (let x = 0; x <= 6; x++)
        for (let z = 0; z <= 2; z++) built.cells.set(key(x, 3, z), B.AIR);
      return { rig: built };
    })();
    const dry = run(drained.rig);
    cases.push({
      name: 'the flood drains when the sea goes',
      passes: dry.passes,
      settled: dry.settled,
      volume: +volume(drained.rig.cells).toFixed(4),
      expect: 0,
      pass: dry.settled && volume(drained.rig.cells) === 0
    });

    // The rule the fix leans on must not overshoot either: water runs across a
    // shelf, thins as it goes, and pours over the edge still wearing that
    // thinness — a column, not a fan — landing in a pool one step under the shelf
    // that starts at the rank the fall arrived with.
    const ledge = (() => {
      const built = rig();
      built.box(-5, 0, -1, -5, 6, 1, B.STONE);      // a wall for the source to lean on
      built.box(-4, 0, -1, -1, 3, 1, B.STONE);      // a shelf to run water across
      built.box(0, 0, -1, 4, 0, 1, B.STONE);        // the floor a step below it
      built.box(-5, 4, -1, 4, 7, -1, B.STONE);      // the sides of the channel, so
      built.box(-5, 4, 1, 4, 7, 1, B.STONE);        // the sheet cannot run off sideways
      built.box(-4, 4, 0, -4, 4, 0, B.WATER);       // a source at the far end
      const read = at(built.cells);
      return {
        rig: built,
        read: () => [4, 3, 2, 1].map((y) => {
          let line = '';
          for (let x = -4; x <= 4; x++) line += show(read(x, y, 0));
          return line;
        }).join('/')
      };
    })();
    test('a sheet over a ledge', ledge, 'S123v..../####v..../####v..../####4567.');

    // Lava runs the same rules on a three-rank leash, and where it meets water
    // one of them hardens. These rigs are reported apart from the water ones,
    // so the water cases above keep answering for exactly what they always did.
    const waterCases = cases.splice(0);
    /** A one-wide channel on a stone floor, open along x from 0 to `length - 1`. */
    const channel = (length, fill) => {
      const built = rig();
      built.box(-1, 0, -1, length, 3, 1, B.STONE);
      built.box(0, 1, 0, length - 1, 1, 0, B.AIR);
      fill(built);
      const read = at(built.cells);
      return {
        rig: built,
        read: () => {
          let line = '';
          for (let x = 0; x < length; x++) line += show(read(x, 1, 0));
          return line;
        }
      };
    };
    const spill = channel(8, (r) => r.cells.set(key(0, 1, 0), B.LAVA));
    test('lava reaches three blocks', spill, 'LABC....');
    spill.rig.cells.set(key(0, 1, 0), B.AIR);
    test('lava drains when its source goes', spill, '........');

    const lavaShaft = shaft(2);
    lavaShaft.rig.cells.set(key(0, 3, 0), B.LAVA);
    test('lava pours down a shaft', lavaShaft, 'L!A');

    // Water and lava sent toward each other along the same channel. The water
    // takes the cell they both reach, and the lava beside it hardens to
    // cobblestone; the source behind is never touched, so it stays lava.
    test('flowing lava meets water', channel(7, (r) => {
      r.cells.set(key(0, 1, 0), B.LAVA);
      r.cells.set(key(6, 1, 0), B.WATER);
    }), 'LAc321S');

    /** A sealed column, read from `top` down to y=1. */
    const column = (top, fill) => {
      const built = rig();
      built.box(-1, 0, -1, 1, top + 1, 1, B.STONE);
      fill(built);
      const read = at(built.cells);
      return {
        rig: built,
        read: () => {
          let line = '';
          for (let y = top; y >= 1; y--) line += show(read(0, y, 0));
          return line;
        }
      };
    };
    test('water on a lava source makes obsidian', column(2, (r) => {
      r.cells.set(key(0, 1, 0), B.LAVA);
      r.cells.set(key(0, 2, 0), B.WATER);
    }), 'SO');
    test('lava poured onto water makes stone', column(3, (r) => {
      r.cells.set(key(0, 1, 0), B.WATER);
      r.cells.set(key(0, 2, 0), B.AIR);
      r.cells.set(key(0, 3, 0), B.LAVA);
    }), 'LA#');

    const lavaCases = cases.splice(0);
    cases.push(...waterCases);
    return {
      ok: cases.every((c) => c.pass),
      cases,
      lavaOk: lavaCases.every((c) => c.pass),
      lava: lavaCases
    };
  },
  setBlock(x, y, z, id) {
    let numericId = id;
    if (typeof id === 'string') {
      numericId = BLOCK_BY_KEY.get(id)?.id ?? Number(id);
    }
    if (!Number.isFinite(numericId)) return this.stats();
    world.setBlock(x, y, z, numericId);
    updateTarget();
    return this.stats();
  },
  /** Advance the player, item drops, and particles deterministically. */
  tick(seconds = 1) {
    const frames = Math.max(1, Math.ceil(seconds * 60));
    const dt = seconds / frames;
    const idle = { forward: 0, right: 0, jump: false, sprint: false };
    for (let i = 0; i < frames; i++) {
      updatePlayer(dt, idle);
      world.updateStreaming(player.pos.x, player.pos.z);
      updateTarget();
      updateMobTarget();
      updateMining(dt, false);
      updateMobs(dt);
      updateArchery(dt);
      updateHealth(dt);
      updateBurning(dt);
      updateHunger(dt);
      updateHeldItem(dt, heldFrame());
      updateItemEntities(dt);
      updateEssenceBubbles(dt);
      updateBreakParticles(dt);
      updateTorchEmbers(dt);
      updateAudio(dt, player);
      updateExplosionEffects(dt);
      updateBlockEntities(dt);
      updateCrops(dt);
      updateWater(dt);
    }
    updateDebug();
    return this.stats();
  },
  /** Advance the player deterministically (used by automated checks). */
  simulate(seconds, input = {}) {
    const frames = Math.max(1, Math.ceil(seconds * 60));
    const dt = seconds / frames;
    const normalized = {
      forward: input.forward ?? 0,
      right: input.right ?? 0,
      jump: !!input.jump,
      sprint: !!input.sprint
    };
    for (let i = 0; i < frames; i++) {
      updatePlayer(dt, normalized);
      world.updateStreaming(player.pos.x, player.pos.z);
      updateTarget();
      updateMobTarget();
      // Combat belongs here as much as it belongs in the frame loop: without it
      // there is no way to assert what the left button does while it is held.
      updateCombat(dt, isMiningHeld());
      updateMobs(dt);
      updateArchery(dt);
      updateHealth(dt);
      updateBurning(dt);
      updateHunger(dt);
      updateHeldItem(dt, heldFrame());
      updateItemEntities(dt);
      updateEssenceBubbles(dt);
      updateBreakParticles(dt);
      updateTorchEmbers(dt);
      updateAudio(dt, player);
      updateExplosionEffects(dt);
      updateWater(dt);
    }
    updateDebug();
    return this.stats();
  },
  setDay(value) {
    // Backwards-compatible debug helper: 1 = noon, 0 = midnight.
    setDayTime(value >= 0.5 ? 0.25 : 0.75);
    applyDayNight();
    updateDebug();
    return this.time();
  },
  setTime(value) {
    setDayTime(value);
    applyDayNight();
    updateDebug();
    return this.time();
  },
  getTime() {
    return this.time();
  },
  time() {
    return {
      t: dayTime,
      hours: clockHours(),
      clock: formatClock(),
      daylight,
      night: isNight(),
      timeScale,
      dayLength: DAY_LENGTH_SECONDS
    };
  },
  setTimeScale(scale) {
    setTimeScale(scale);
    updateDebug();
    return timeScale;
  },
  advanceTime(seconds) {
    advanceDayTime(seconds);
    applyDayNight();
    updateDebug();
    return this.time();
  },
  isNight() {
    return isNight();
  },
  flushLight() {
    world.processLightDirty(Infinity);
    updateTarget();
    updateDebug();
    return this.stats();
  },
  flushChunks() {
    world.flushStreaming(player.pos.x, player.pos.z);
    updateTarget();
    updateDebug();
  },
  stats() {
    const pos = player.pos;
    let meshed = 0;
    for (const chunk of world.chunks.values()) if (chunk.meshed) meshed++;
    const selected = getSelectedStack();
    const craftRecipe = currentCraftRecipe();
    const miningLoop = miningReport();
    return {
      version: '0.1.0-milestone-13',
      seed: WORLD_SEED,
      position: [camera.position.x, camera.position.y, camera.position.z],
      feet: [pos.x, pos.y, pos.z],
      velocity: [player.vel.x, player.vel.y, player.vel.z],
      onGround: player.onGround,
      inWater: player.inWater,
      headInWater: player.headInWater,
      inLava: player.inLava,
      headInLava: player.headInLava,
      fireTime: Number(player.fireTime.toFixed(2)),
      sprinting: player.sprinting,
      sprintLatched: sprintLatched,
      playable: isPlayable(),
      gamepad: {
        connected: gamepadState.connected,
        active: gamepadState.active,
        sensitivity: gamepadState.sensitivity,
        mining: padMiningDown,
        screen: activeScreen
      },
      chunk: [Math.floor(pos.x / CHUNK_SIZE), Math.floor(pos.z / CHUNK_SIZE)],
      loadedChunks: world.chunks.size,
      meshedChunks: meshed,
      triangles: renderer.info.render.triangles,
      fps,
      audio: audioStatus(),
      embers: emberCount(),
      torches: world.torches.size,
      water: {
        queued: world.waterQueue.size,
        waiting: world.waterWait.size,
        parked: world.parkedWaterCount(),
        remeshing: world.flowRemesh.size
      },
      explosion: explosionEffects(),
      time: {
        t: dayTime,
        hours: clockHours(),
        clock: formatClock(),
        daylight,
        night: isNight(),
        timeScale,
        dayLength: DAY_LENGTH_SECONDS
      },
      health: {
        points: player.health,
        max: player.maxHealth,
        dead: player.dead,
        regenDelay: player.regenDelay,
        hunger: player.hunger,
        saturation: Number(player.saturation.toFixed(3)),
        exhaustion: Number(player.exhaustion.toFixed(3)),
        defense: armorDefense()
      },
      mobs: {
        total: mobs.length,
        passive: countMobs(false),
        hostile: countMobs(true),
        caps: { total: MOB_CAP, passive: PASSIVE_CAP, hostile: HOSTILE_CAP },
        entities: mobs.map((mob) => this.mobInfo(mob))
      },
      heldItem: (() => {
        const stack = getSelectedStack();
        return {
          id: stack ? stack.id : null,
          count: stack ? stack.count : 0,
          dur: stack ? stack.dur ?? null : null,
          model: heldModelKey
        };
      })(),
      selectedSlot: currentSlot(),
      selected: selected ? { id: selected.id, count: selected.count } : null,
      inventory: inventory.map((slot) => slotInfo(slot)),
      armour: armorSlots.map((slot) => slotInfo(slot)),
      crafting: {
        screen: activeScreen,
        cursor: slotInfo(cursorCarried()),
        grid2: craft2.map((slot) => slotInfo(slot)),
        grid3: craft3.map((slot) => slotInfo(slot)),
        preview: craftRecipe ? {
          id: craftRecipe.result.id,
          count: craftRecipe.result.count,
          recipe: craftRecipe.id
        } : null
      },
      overrides: world.overrides.size,
      furnaces: world.blockEntities.size,
      crops: world.crops.size,
      save: this.saveInfo(),
      essence: essenceCount(),
      beacons: {
        activated: beaconReport().activated,
        next: beaconReport().next
      },
      essenceDrops: essenceEntities.map((entity) => ({
        amount: entity.amount,
        age: Number(entity.age.toFixed(2)),
        pos: [entity.pos.x, entity.pos.y, entity.pos.z]
      })),
      itemDrops: itemEntities.map((entity) => ({
        id: entity.itemId,
        count: entity.count,
        dur: entity.dur == null ? null : entity.dur,
        pos: [entity.pos.x, entity.pos.y, entity.pos.z]
      })),
      target: currentTarget ? {
        x: currentTarget.x,
        y: currentTarget.y,
        z: currentTarget.z,
        id: currentTarget.id,
        name: BLOCKS[currentTarget.id].name
      } : null,
      mining: {
        active: miningLoop.active,
        progress: miningLoop.progress,
        duration: miningLoop.duration,
        stage: shownCrackStage()
      }
    };
  }
};

renderer.info.autoReset = false;

function renderGame() {
  renderer.info.reset();
  renderer.autoClear = true;
  renderer.render(scene, camera);

  // Draw the held item over the world with a fresh depth buffer.
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(heldScene, heldCamera);
  renderer.autoClear = true;
}

let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);

  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const dt = Math.min(Math.max(rawDt, 0), 0.1);

  updateGamepad(dt);

  // The main menu fades the world's sound out and holds it until it closes.
  setAudioMenuPause(menuOpen());

  /* A world nobody has walked yet opens quiet: the world fades up out of the
     black the menu sat on. The scene starts on the frame the overlay lifts —
     the same gate the arrival line waits behind, and it holds that line
     until the black clears. */
  if (introWaiting && overlayEl.classList.contains('hidden') && !player.dead) {
    introWaiting = false;
    startIntro();
  }

  /* The arrival transmission lands once the walker is really in the world: the
     overlay hides the HUD, the audio context only wakes on the click that
     lifts it, and the fade says the walk has begun, so the dial tone would
     otherwise be spent unheard. */
  if (arrivalWaiting && overlayEl.classList.contains('hidden') && !introActive()) {
    if (!arrivalAt) arrivalAt = now + ARRIVAL_DELAY_MS;
    else if (now >= arrivalAt) {
      arrivalWaiting = false;
      arrivalSongWaiting = true;
      showTransmission(SPAWN_TRANSMISSION);
    }
  }

  // The pause overlay and the inventory/crafting screens freeze the whole
  // world, Minecraft-style. Rendering, chunk streaming, pad menu navigation,
  // ambience and autosave keep running.
  if (!activeScreen && overlayEl.classList.contains('hidden')) {
    updatePlayer(dt, readPlayerInput());
    // Runs after the walker is walked: the scene pins the fall peak behind
    // the physics layer, so the arrival can never read as a drop.
    updateIntro(dt);
    updateTarget();
    updateMobTarget();
    const canMine = isMiningHeld() && !player.dead && isPlayable() && !introActive();
    updateMining(dt, canMine && !mobTarget());
    updateCombat(dt, isMiningHeld());
    updateMobs(dt);
    updateArchery(dt);
    updateHeldItem(dt, heldFrame());
    updateHealth(dt);
    updateBurning(dt);
    updateHunger(dt);
    updateItemEntities(dt);
    updateEssenceBubbles(dt);
    updateBreakParticles(dt);
    updateTorchEmbers(dt);
    updateDayNight(dt);
    updateExplosionEffects(dt);
    updateBlockEntities(dt);
    updateCrops(dt);
    updateWater(dt);
  } else {
    // A pause or an open screen takes the controls away, and the sprint latch
    // goes with them: resuming must never leave the player running unawares.
    clearSprintLatch();
    if (activeScreen === 'furnace') {
      // The furnace whose screen is open keeps smelting while you browse your
      // inventory; everything else in the world stays frozen.
      updateBlockEntities(dt);
    }
  }

  // Runs after the day/night pass so the water's murk sits on top of the sky's
  // fog, and outside the pause branch so the sea keeps breathing behind a screen.
  updateWaterLook(dt, player.headInWater, player.headInLava);
  paintBurning(!player.dead && (player.inLava || player.fireTime > 0));
  paintWaypoint(activeWaypoint(), player.pos, view.yaw);
  paintThreat(threatZoneAt(player.pos.x, player.pos.y, player.pos.z), frontierZone(), threatZoneCount());

  world.updateStreaming(player.pos.x, player.pos.z);
  updateAudio(dt, player);
  updateSaveLoop(dt);
  skyDome.position.copy(camera.position);
  renderGame();

  if (sampleFrameRate(rawDt)) updateDebug();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  heldCamera.aspect = camera.aspect;
  heldCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

requestAnimationFrame(animate);
