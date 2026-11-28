/*
 * The viewer's own display preferences: things that belong to the screen in
 * front of them rather than to the world they are walking. They live in their
 * own localStorage keys, outside the save, so a new world keeps them and a
 * saved world never carries them to somebody else's browser.
 *
 * Storage can be missing or refuse a write (a private window, blocked site
 * data), and then a preference simply lasts for the session.
 */

const SETTINGS_KEY = 'voxelcraft:settings';

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (unavailable) { return null; }
}

function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (unavailable) {}
}

let showFps = storageGet(SETTINGS_KEY + ':fps') === '1';
const listeners = new Set();

/** Whether the frame-rate counter is on the HUD. Off unless asked for. */
export function fpsShown() { return showFps; }

export function setFpsShown(on) {
  showFps = !!on;
  storageSet(SETTINGS_KEY + ':fps', showFps ? '1' : '0');
  for (const listener of listeners) listener();
}

/* The walker's block position on the HUD. Off unless asked for, because the
   mission is found by the waypoint arrow, not by numbers; some players still
   want them, to plan a build or to tell a friend where they are. */
let showCoords = storageGet(SETTINGS_KEY + ':coords') === '1';

/** Whether the player's XYZ readout is on the HUD. */
export function coordsShown() { return showCoords; }

export function setCoordsShown(on) {
  showCoords = !!on;
  storageSet(SETTINGS_KEY + ':coords', showCoords ? '1' : '0');
  for (const listener of listeners) listener();
}

/** Whoever paints a preference hears when one changes. */
export function onSettingsChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* The name the other players see over this player's head in co-op. It belongs
   to the person, not to any world, so it lives out here with the screen's own
   preferences. */
let coopNameValue = (storageGet(SETTINGS_KEY + ':coopName') || '').slice(0, 24);

/** The co-op display name, or '' when none was given. */
export function coopName() { return coopNameValue; }

export function setCoopName(name) {
  coopNameValue = String(name || '').trim().slice(0, 24);
  storageSet(SETTINGS_KEY + ':coopName', coopNameValue);
}

/* Camera assist, for a pad player who finds the right stick hard to work
   while steering: the view follows the walk and levels its tilt (see
   src/camera-assist.js). It belongs to the person holding the pad, not to the
   world, so it lives here. Off unless asked for. */
let cameraAssistOn = storageGet(SETTINGS_KEY + ':cameraAssist') === '1';

/** Whether the camera assist turns the view for the pad. */
export function cameraAssist() { return cameraAssistOn; }

export function setCameraAssist(on) {
  cameraAssistOn = !!on;
  storageSet(SETTINGS_KEY + ':cameraAssist', cameraAssistOn ? '1' : '0');
  for (const listener of listeners) listener();
}

/* Lock-on assist: the view leaning onto a hostile close ahead, so a swing
   lands without fine aiming. It used to come with the camera assist and is now
   its own switch, either one working without the other; a browser that never
   set it starts where its camera assist stands, so turning the two apart
   takes nothing away from anyone who had the camera assist on. */
const storedLockOn = storageGet(SETTINGS_KEY + ':lockOnAssist');
let lockOnAssistOn = storedLockOn === null ? cameraAssistOn : storedLockOn === '1';

/** Whether the pad's view leans onto a hostile close ahead. */
export function lockOnAssist() { return lockOnAssistOn; }

export function setLockOnAssist(on) {
  lockOnAssistOn = !!on;
  storageSet(SETTINGS_KEY + ':lockOnAssist', lockOnAssistOn ? '1' : '0');
  for (const listener of listeners) listener();
}
