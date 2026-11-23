# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The project's own agent instructions live in `AGENTS.md` and apply here in full:
the zero-build rule, the checks that stand in for a build, the snapshot guard,
the dev server and the commit style.

@AGENTS.md

## Commands

```bash
node tools/dev-server.mjs 8010   # serve the repo root; any port, default 8000
./tools/check-syntax.sh          # parse index.html's module script and src/*.js
./tools/check-imports.sh         # imports resolve to exports; no unimported names
./tools/check-audio.sh           # 108-file CC0 bank present and decodable
```

There are no unit tests. The only behavioural test is the snapshot guard, and
it runs in a page, not in node. With the game open (in the preview pane, say),
call `window.__voxelcraft.wipeSave()`, reload, then evaluate:

```js
fetch('tools/snapshot-check.js').then(r => r.text()).then(eval)
```

It reports each `strict` section that differs from
`tools/snapshot-baseline.json`. The tool comments still say
`python3 -m http.server`; use the dev server instead.

`check-syntax.sh` writes its temp file with `mktemp -t`, which lands in macOS's
per-user temp dir rather than `$TMPDIR`. Inside the Claude Code sandbox it fails
with "Operation not permitted" and has to run outside the sandbox.

## Architecture

**`src/main.js` is the real composition root.** `index.html` only does
`import './src/main.js'`. `main.js` does three jobs, in this order:

1. Boot the world: the spawn column, the save restore, the bars.
2. Wire the seams.
3. Run the `requestAnimationFrame` loop: the player, chunk streaming and
   meshing, water, mobs, drops, the render, autosave and the debug readout.

No other module imports `main.js`.

**Layers never reach sideways; they expose seams.** Each module knows only its
own subject. When it needs another layer to act, such as repainting a bar,
showing a death screen or delivering a transmission, it exports a registration
function: `set…View`, `set…Painter`, `set…Arrival` or `set…Deliverer`.
`main.js` fills them all in one block. When a new feature needs two distant
layers to talk, add a seam and register it in `main.js`. Don't add an import
between the two layers. A layer with nothing registered should still work,
silently.

**Determinism.** The world is generated from `WORLD_SEED` in `src/config.js`,
so chunks, beacon sites and the spawn are reproducible. Mob AI and visual
scatter (particles, essence bubbles) use `Math.random`; the harness keeps those
in its `loose` section, which is not compared. Anything that changes `strict`
output changes the world and needs a deliberate rebaseline commit.

**Persistence** (`src/save.js`). The save goes to localStorage under `SAVE_KEY`
(`voxelcraft:world:v7`). It stores only the blocks the player has changed, per
chunk, plus the player's state and the mission's progress. A change to the save
shape bumps `SAVE_SCHEMA` and `SAVE_KEY` and moves the old key into
`LEGACY_SAVE_KEYS`. Older saves are refused rather than migrated, and the
comment above `SAVE_KEY` keeps a running history of what each schema added.

**Debug API.** `window.__voxelcraft`, defined in `main.js`, exposes the world,
the player, the scene and the camera, plus verbs such as `start()` (playable
without pointer lock), `save()`, `wipeSave()`, `render()` and `health()`.
Automated checks and the snapshot harness drive the game through it. The design
doc's "Debug surface" section describes it.

**The mission layer** (MultiVoxelVerse Adventures). `src/beacons.js` holds the
beacon sites, the `TRANSMISSIONS` text and the mission progress, all measured
from SP0, the first spawn column. `src/transmissions.js` only reads which of
those lines the player has already heard, for the journal. The story text and
the recipe unlocks come from `MultiVoxelVerse Adventures Design.md`. The base
game's mechanics come from `VoxelCraft Design.md`. Update the matching doc in
the same change as the gameplay it describes.
