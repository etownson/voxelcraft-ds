# VoxelCraft

A browser voxel game that ships as plain files: `index.html` + native ES modules
under `src/`, served statically to GitHub Pages. There is no `package.json`, no
build step, and no dependencies to install — `three` comes from a CDN via the
importmap in `index.html`. Do not add a bundler, transpiler, or npm dependency
without asking; the zero-build layout is deliberate.

## Layout

- `index.html` — markup, the styles link and the importmap. Its module script
  only does `import './src/main.js'`.
- `src/main.js` — the real composition root (see Architecture). Nothing imports
  it.
- `src/` — about forty small single-purpose modules (`worldgen`, `chunks`, `mob`,
  `combat`, `crafting`, `menu`, ...). Keep new code in the right module and keep
  the single-purpose split; `tools/split-modules.mjs` exists to carve more out.
- The start form and the pause panel are the same `#overlay`, shaped as a menu
  (`src/menu.js`). While it is open its input must never reach the world: any
  global key, mouse, or wheel listener gates on `menuOpen()` from `src/input.js`.
- `tools/` — the project's own checks and generators, in bash and node.
- The two design docs (`VoxelCraft Design.md`, `MultiVoxelVerse Adventures
  Design.md`) are the source of truth for gameplay decisions.

## Architecture

**`src/main.js` does three jobs, in this order:**

1. Boot the world: the spawn column, the save restore, the bars.
2. Wire the seams.
3. Run the `requestAnimationFrame` loop: the player, chunk streaming and
   meshing, water, mobs, drops, the render, autosave and the debug readout.

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
output needs a deliberate rebaseline (see Snapshot guard).

**Persistence** (`src/save.js`). The save goes to localStorage under `SAVE_KEY`
(`voxelcraft:world:v<SAVE_SCHEMA>`; read the current value there rather than
copying it here). It stores only the blocks the player has changed, per
chunk, plus the player's state and the mission's progress. Older saves are
refused rather than migrated, and the comment above `SAVE_KEY` keeps a running
history of what each schema added. When the save shape changes:

- If the change only adds fields, and a save written before it reads exactly
  as it did, it may stay on the current schema. Note it in that comment.
- Anything else (a field renamed, removed or reinterpreted) bumps `SAVE_SCHEMA`
  and `SAVE_KEY` and moves the old key into `LEGACY_SAVE_KEYS`.

**Debug API.** `window.__voxelcraft`, defined in `main.js`, exposes the world,
the player, the inventory, the item drops, the scene and the camera, plus verbs
such as `start()` (playable without pointer lock), `save()`, `wipeSave()`,
`render()` and `health()`. Automated checks and the snapshot harness drive the
game through it. Module state it does not expose can be reached from the page
with `await import('/src/…js')`, which returns the same live module. The design doc's "Debug surface" section
describes it.

**The mission layer** (MultiVoxelVerse Adventures). `src/beacons.js` holds the
beacon sites, the `TRANSMISSIONS` text and the mission progress, all measured
from SP0, the first spawn column. `src/transmissions.js` only reads which of
those lines the player has already heard, for the journal. The story text and
the recipe unlocks come from `MultiVoxelVerse Adventures Design.md`; the base
game's mechanics come from `VoxelCraft Design.md`. Update the matching doc in
the same change as the gameplay it describes.

## Checking changes

There is no compiler, so these checks are the build. Run them before committing:

```bash
./tools/check-syntax.sh    # parse index.html's module script and src/*.js
./tools/check-imports.sh   # imports resolve to exports; no unimported names
./tools/check-audio.sh     # 108-file CC0 bank present and decodable
```

`check-imports.sh` catches the link errors and runtime ReferenceErrors that
`node --check` cannot see. `check-syntax.sh` writes its temp file with
`mktemp -t`, which lands in macOS's per-user temp dir rather than `$TMPDIR`, so
inside a sandboxed agent shell it fails with "Operation not permitted" and has
to run outside the sandbox.

Module scope rules (what a file declares, what it refers to) live in
`tools/js-scope.mjs` and are shared by the import checker and the splitter.
Never duplicate that logic in a new tool.

There are no unit tests. The only behavioural test is the snapshot guard.

## Snapshot guard

`tools/snapshot-harness.js` is a deterministic scripted scenario; its `strict`
output must match `tools/snapshot-baseline.json` byte for byte, so a pure code
move cannot change the world. It runs in a page, not in node. With the game
served and open, call `window.__voxelcraft.wipeSave()`, reload, then evaluate:

```js
fetch('tools/snapshot-check.js').then(r => r.text()).then(eval)
```

It reports each `strict` section that differs from the baseline.

`wipeSave()` erases the world saved for that origin. To keep a real save, run
the guard on another port (each origin has its own localStorage), or copy the
`SAVE_KEY` entry aside first and put it back afterwards.

When a change is *supposed* to change `strict` output (a new item, a world
change), confirm the diff is only what you meant, rebaseline in its own
deliberate commit, and say so in the commit message.

## Running the game

```bash
node tools/dev-server.mjs 8010   # serve the repo root; any port, default 8000
```

Use it rather than `python3 -m http.server`: it sends every file with
`Cache-Control: no-store`, so a reload after an edit or a rebaseline never runs
modules the browser kept from before.

## Audio assets

`assets/audio/` is the active CC0 bank, built by `tools/build-cc0-bank.py`.
`tools/generate-audio.mjs` renders a synthesized reference bank on demand and
must never overwrite the active one. The game falls back to a procedural
synthesizer when the bank is missing, so partial audio commits go unnoticed
until `check-audio.sh` runs.

## Commit style

Short lowercase sentences, written plainly and slightly narratively:
"Give each lit beacon its own colour, orange out to indigo". Describe the
behaviour change, not the file touched.
