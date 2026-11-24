# VoxelVerse

A first-person voxel survival game in the browser, inspired by Minecraft.

You've been teleported into an endless world, generated from a seed, to relight five
beacons that were left there long ago. You start with empty hands and no recipes. Punch
trees, mine and fight through the night to gather essence. Each beacon you light sends
a transmission with more of the story, a new set of recipes and the way to the next
beacon. Up to four friends can share one world in co-op, browser to browser, with no
server.

## Playing locally

The game is plain files: `index.html`, `styles.css` and native ES modules under `src/`,
with Three.js loaded from a CDN. There's no build step and nothing to install. It does
need to be served over http, because browsers won't load modules from `file://`:

```bash
node tools/dev-server.mjs 8010
```

Then open <http://localhost:8010>. The port is optional and defaults to 8000.

## Controls

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Look / move | Mouse, WASD | Right stick, left stick |
| Jump | Space | A |
| Sprint (toggle) | Shift or Ctrl | B / L3 |
| Mine / attack | Left click | Right trigger |
| Place / use | Right click | Left trigger |
| Hotbar | 1–9, mouse wheel | Shoulder buttons |
| Inventory | E | Y |
| Journal | J | View / Back |
| Menu | Esc | Start / Menu |
| Mute | M | — |

## Co-op

Host from the menu's Co-op page to get a six-character room code. Friends join at
`#join=CODE`. The host's browser owns the world and its save, so the world is only
reachable while the host's tab is open and in front.

## Design and development

[VoxelVerse Design.md](VoxelVerse%20Design.md) is the source of truth for gameplay: the
mission, the world, the mechanics and every tuning number. [AGENTS.md](AGENTS.md)
covers the architecture, the checks, the snapshot guard and the commit style.

There's no compiler, so these checks act as the build:

```bash
./tools/check-syntax.sh
```

```bash
./tools/check-imports.sh
```

```bash
./tools/check-audio.sh
```

## Credits

The sound effects are CC0 (Kenney, OpenGameArt, SpritePilot), and the music was made
for the project. Textures, icons and geometry are all procedural. See
[CREDITS.md](CREDITS.md).
