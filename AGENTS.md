# VoxelVerse

VoxelVerse is a browser voxel survival game inspired by Minecraft, built around a
mission to relight five beacons. The repository, the storage keys and
`window.__voxelcraft` keep the older `voxelcraft` name; leave them as they are,
because saves and the snapshot baseline depend on them.

It ships as plain files: `index.html` + native ES modules
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
- `VoxelVerse Design.md` is the source of truth for gameplay decisions.

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
(the first world) or `SAVE_KEY:<world id>` (every other world; see
`src/worlds.js`). It stores only the blocks the player has changed, per
chunk, plus the player's state and the mission's progress. The comment above
`SAVE_KEY` keeps a running history of what each schema added.

**A change must never throw away a player's save.** People put hours into a
world, often with friends, so from schema 7 on every save is carried forward.
`SAVE_KEY` is frozen at `voxelcraft:world:v7` and never changes again; the
record's `v` says which schema wrote it. When the save shape changes:

- If the change only adds fields, and a save written before it reads exactly
  as it did (a new block-entity list that is simply absent, a new item id, a
  field with an honest default), it stays on the current schema. Note it in
  that comment.
- Anything else (a field renamed, removed or reinterpreted) bumps
  `SAVE_SCHEMA` and, in the same commit, adds `MIGRATIONS[old schema]`: the
  step that turns a record of the old schema into the new one. Never remove a
  step. Then run the save check (below) and add a fixture for the new schema.
- `readSavedWorld` never deletes anything: an upgraded record's original is
  kept under `voxelcraft:world:before-upgrade`, an unreadable one is moved to
  `voxelcraft:world:unreadable`, and a save from a newer build is left alone
  and never written over until the page reloads onto the new code.

**Debug API.** `window.__voxelcraft`, defined in `main.js`, exposes the world,
the player, the inventory, the item drops, the scene and the camera, plus verbs
such as `start()` (playable without pointer lock), `save()`, `wipeSave()`,
`render()` and `health()`. Automated checks and the snapshot harness drive the
game through it. Module state it does not expose can be reached from the page
with `await import('/src/…js')`, which returns the same live module. The design doc's "Debug surface" section
describes it.

**The mission layer.** `src/beacons.js` holds the
beacon sites, the `TRANSMISSIONS` text and the mission progress, all measured
from SP0, the first spawn column. `src/transmissions.js` only reads which of
those lines the player has already heard, for the journal. The story text, the
recipe unlocks and the base game's mechanics all come from `VoxelVerse
Design.md` (the mission is its section "The mission"). Update the doc in the same
change as the gameplay it describes.

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

There are no unit tests. The behavioural tests are the snapshot guard and the
save check, both run in a page.

## Save check

`tools/save-fixtures/` holds one real save per schema from v7 on, exactly as
the game stored it. `tools/save-check.js` walks each through the game's own
`MIGRATIONS` and fails if any no longer reaches the current schema with its
world, player, pack and containers. Run it in a page with the game booted:

```js
fetch('tools/save-check.js').then(r => r.text()).then(eval)
```

Run it whenever the save shape changes. After a bump, save a world at the new
schema into `tools/save-fixtures/v<N>.json` and add `N` to the list in the
script. Never remove a fixture.

## Snapshot guard

`tools/snapshot-harness.js` is a deterministic scripted scenario; its `strict`
output must match `tools/snapshot-baseline.json` byte for byte, so a pure code
move cannot change the world. It runs in a page, not in node. With the game
served and open, call `window.__voxelcraft.wipeSave()`, reload, then evaluate:

```js
fetch('tools/snapshot-check.js').then(r => r.text()).then(eval)
```

It reports each `strict` section that differs from the baseline.

When the page is driven by a script (a page evaluate from an agent or a test
runner), the wipe and the check are two separate evaluations. The reload ends
whatever script asked for it, so a check started in the same evaluation is cut
off partway and returns nothing. Wipe and reload in one, wait for the game to
boot, then run the check in the next.

`wipeSave()` erases the world saved for that origin. To keep a real save, run
the guard on another port (each origin has its own localStorage), or copy the
`SAVE_KEY` entry aside first and put it back afterwards.

When a change is *supposed* to change `strict` output (a new item, a world
change), confirm the diff is only what you meant, rebaseline in its own
deliberate commit, and say so in the commit message.

## Pacing

The mission is meant to take four to six hours: beacon 1 at once, then about an
hour to an hour and a half for each of the other four. `src/pacing.js` logs
real play per beacon in every world (`window.__voxelcraft.pacing()`) and marks
a run assisted when a debug verb or key bent it. `tools/pace-estimate.js` works
out what each beacon should take from the game's own numbers (prices, hostile
mix, health and essence scaling, sword damage, night length) and sets the log
beside it:

```js
fetch('tools/pace-estimate.js').then(r => r.text()).then(eval)
```

The model leaves out everything but the walk and the hunt, so the gap between
its night-bound column and a measured row is what that beacon spent on mining,
building and getting lost. Tune with the constants it reads, chiefly
`BEACON_KILLS_TO_LIGHT`, and say in the design doc why.

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
