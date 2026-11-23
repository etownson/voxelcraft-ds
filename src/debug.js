/*
 * Whether this page was opened for debugging. The give shelf, the essence
 * grant, the monument tour, the time nudges and the position readout are all
 * tools for whoever is building the game, not for whoever is playing it, so
 * they only answer when the address asks for them: `index.html?debug`.
 *
 * `window.__voxelcraft` is not behind this. The snapshot guard and the
 * scripted checks drive the game through it, and nobody reaches it by
 * accident from a keyboard.
 */

export const debugEnabled = (() => {
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch (unavailable) {
    return false;
  }
})();
