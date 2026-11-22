# VoxelCraft

A browser voxel game that ships as plain files: `index.html` + native ES modules
under `src/`, served statically to GitHub Pages. There is no `package.json`, no
build step, and no dependencies to install — `three` comes from a CDN via the
importmap in `index.html`. Do not add a bundler, transpiler, or npm dependency
without asking; the zero-build layout is deliberate.

## Layout

- `index.html` — the composition root: markup, styles link, and a module script
  that imports everything. Nothing imports it.
- `src/` — ~30 small single-purpose modules (`worldgen`, `chunks`, `mob`,
  `combat`, `crafting`, ...). Keep new code in the right module and keep the
  single-purpose split; `tools/split-modules.mjs` exists to carve more out.
- `tools/` — the project's own checks and generators, in bash and node.
- The two design docs (`VoxelCraft Design.md`, `MultiVoxelVerse Adventures
  Design.md`) are the source of truth for gameplay decisions.

## Checking changes

There is no compiler, so these checks are the build. Run them before committing:

- `./tools/check-syntax.sh` — parses the module script and every file in `src/`.
- `./tools/check-imports.sh` — every imported name is exported, and no module
  uses a name it never imported. This catches the link errors and runtime
  ReferenceErrors that `node --check` cannot see.
- `./tools/check-audio.sh` — the CC0 sample bank in `assets/audio/` is complete
  (108 files) and decodes.

Module scope rules (what a file declares, what it refers to) live in
`tools/js-scope.mjs` and are shared by the import checker and the splitter.
Never duplicate that logic in a new tool.

## Snapshot guard

`tools/snapshot-harness.js` is a deterministic scripted scenario; `strict`
output must match `tools/snapshot-baseline.json` byte for byte, so a pure code
move cannot change the world. To run it: serve the repo root, wipe the save and
reload (`window.__voxelcraft.wipeSave()`), then evaluate
`tools/snapshot-check.js` in the page. When a gameplay change is *supposed* to
change world state, rebaseline the golden state in its own deliberate step and
say so in the commit.

## Running the game

`node tools/dev-server.mjs [port]` (default 8000). Prefer it over
`python3 -m http.server`: it answers `/health`, which a local supervisor polls.

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
