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

/** Whoever paints a preference hears when one changes. */
export function onSettingsChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
