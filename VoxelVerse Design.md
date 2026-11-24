# VoxelVerse — Design Document

VoxelVerse is a first-person voxel survival game in the browser, inspired by Minecraft.
The world is an endless, deterministic, chunk-based voxel map with no edges or borders:
terrain streams in around the player and unloads behind them, in every horizontal
direction, forever. Into that world the player is teleported with a mission: relight
five beacons, each of which unlocks the next set of recipes and points the way to the
next (see The mission). Up to four players can share a world in co-op.

It is built with Three.js and vanilla JavaScript as native ES modules served straight
from the repository, with a CC0 audio bank and a procedural synthesizer behind it.

## Core shape

- One `index.html` page, one `styles.css`, and a `src/` graph of native ES modules,
  beside the CC0 sample bank in `assets/audio/` and the music in `assets/music/`
- Three.js loaded from a CDN; the page's only script line is `import './src/main.js';`
- No build tools and no npm required to play. The browser resolves the `src/` modules
  itself, so the repository *is* the deploy: GitHub Pages serves the same files it is
  given, with nothing compiled, bundled, or minified in between
- Serve the game over http — `python3 -m http.server` or Pages. Under `file://` the
  browser will not resolve module imports, so the page stays blank
- Audio is CC0 (Kenney, OpenGameArt, SpritePilot; see `CREDITS.md`). Textures, icons,
  colors, geometry, and the fallback sounds are all procedural
- The document is also the game's tuning record: every gameplay number the game runs on
  lives in `src/config.js`, and this document describes those numbers as they are

## The mission

VoxelVerse is not an open sandbox from the first minute. The walker has been teleported
into this world to relight the five beacons placed in it long ago, and the world's
crafting stays locked until they do. Each beacon lit sends a transmission with more of
the story, a new set of recipes and the way to the next beacon.

### Arrival

You spawn into a new world. The first spawn is a scene told with graphics and sound to
mark the importance of the event (see Audio for the fade and the teleport heard).

A chat bubble appears that is a transmission from a distant place. All transmissions are
understandable but a bit spotty in places. The following comes through:

- The transmitter tells you that you have been teleported here to fully reactivate the
  beacons previously placed in the world
- The transmitter knows you are disoriented from the teleportation process
- The transmitter tells you that you need to find and activate a beacon that should be
  nearby
- The transmitter tells you that your mission is urgent, but not enough of the
  transmission comes through to understand why

You start with no items in your inventory. You can punch trees and gather logs, but no
crafting has been unlocked: it is gated by the requirement to find recipes. You receive
new recipes by finding and activating beacons. Activating a beacon requires essence, and
you start with just enough essence for one activation. The recipes you have received are
listed in the journal, and once received they are ready to use with nothing more to do.

### SP0 and the beacons

The point where you first spawn into the world is spawn point 0 (SP0), and everything the
mission measures is measured from it: where the monuments stand, what essence each one
wants, and how mean the enemies out that way have gotten. The first beacon is near SP0
but just far enough away to need a short bit of exploration.

The five monuments stand between SP0 and the far reaches of the world. Their positions
are a pure function of the seed and SP0, and they are laid down as stored edits, the same
ones the save keeps, so every chunk that regenerates puts them back where they were
planted. The search for a site refuses water, cliffs, trees and cave mouths. A dark
monument (block 53) lights (block 54) when right-clicked with its price in hand, and a
beam rises off it into the sky. The order is the mission: beacon 2 will not answer until
beacon 1 runs.

### Threat zones

Enemy difficulty scales with an enemy's distance along the X and Z axes from SP0, taken
where it spawned. Enemies only start scaling along the Y axis as well once they are below
sea level. Difficulty scales spawn frequency, health and attack damage.

The world divides into threat zones, SP0's and one around each beacon, each reaching
halfway to its neighbours. The HUD shows the zone underfoot as pips, coloured green behind
the most recently lit beacon's zone, yellow in it, and red beyond it, so the walker can
tell when they have outrun what their recipes were meant for (see HUD and UI).

### Essence

You earn essence by killing enemies. The amount scales with the enemy's difficulty.
Enemies drop essence bubbles a short random distance from where they die. You must pick
them up by running over them, or they fade out and are lost. They take a short time to
appear, so the player has to think about where they move to collect them in the heat of
battle.

The first beacon costs what the walker starts with: one essence per 1.5 blocks from SP0.
Every later beacon costs about thirty kills' worth of essence, at the yield an enemy pays
on the ground of the beacon lit before it, so each new beacon asks for the same hunt in
the zone the last one opened.

### Transmissions

Each time you activate a new beacon you receive a unique transmission carrying:

- A little more of the story
- New recipes that help you survive in the outer areas you must cross to reach the next
  beacon
- The way to the next beacon. The HUD's waypoint arrow points at it from the moment the
  last one is lit, and the main menu's mission page says what it wants and what you
  carry. No coordinates are shown: the arrow is the way. The walker can also save places
  of their own under a name and have the arrow follow those, or any beacon already lit

### Beacon 1

You understand the following from the transmission:

- You are being given recipes to help you survive
- You are now incarnated as a biological creature, and the transmitter apologizes for
  subjecting you to the horrors of health and hunger
- The transmitter warns about awful creatures at night but urges you to be brave and
  extract essence from them
- The transmitter urges you to find the second beacon, but warns you to establish a base
  before attempting to activate it
- The transmission closes by urging you to prepare for nightfall: torches lit, a door
  hung and food cooked before the sun goes down

The first transmission provides enough recipes for a player to survive around SP0,
establish a base, and make it to the second beacon.

Handheld (inventory 2×2) recipes:

| Item           |
| -------------- |
| Planks ×4      |
| Sticks ×4      |
| Crafting Table |
| Torch ×4       |

Crafting table (3×3) recipes:

| Item           |
| -------------- |
| Furnace        |
| Wooden Door ×3 |
| Chest          |
| Wood Pickaxe   |
| Wood Sword     |
| Wood Axe       |
| Wood Shovel    |
| Wood Hoe       |

The furnace also arrives with this beacon: it makes iron ingots, steak, glass, stone and
charcoal from raw iron, raw beef, sand, cobblestone and logs. Its fuels and timings are
under Furnace and smelting.

### Beacon 2

You understand the following from the transmission:

- More of what happened in the world that caused it to fall into its current chaos, with
  monsters roaming at night
- Farming instructions
- More recipes
- The way to the next beacon

Crafting table (3×3) recipes:

| Item                  |
| --------------------- |
| Bread                 |
| Shears                |
| Bed                   |
| Bucket                |
| Oak Stairs ×4         |
| Cobblestone Stairs ×4 |
| Ladder ×3             |
| Stone pickaxe         |
| Stone sword           |
| Stone axe             |
| Stone shovel          |
| Stone hoe             |
| Leather helmet        |
| Leather chestplate    |
| Leather leggings      |
| Leather boots         |
| Bow                   |
| Arrow ×4              |

The bow is three sticks bent into the arc with three strings down the open side, mirrored
either way. An arrow is a chip of cobblestone over a stick over a feather; Minecraft tips
it with flint, and this world has no gravel to knap it from.

Lighting beacon 2 also wakes spiders. They join the night's hostiles and are the only
source of string, so the bow has to be hunted for before it can be made. See Archery and
the night's newcomers.

### Beacon 3

You understand the following from the transmission:

- More of what happened in the world you came from that makes it urgent for you to
  prepare this world for colonization
- More recipes
- The way to the next beacon

Crafting table (3×3) recipes:

| Item            |
| --------------- |
| Iron pickaxe    |
| Iron sword      |
| Iron axe        |
| Iron shovel     |
| Iron hoe        |
| Iron helmet     |
| Iron chestplate |
| Iron leggings   |
| Iron boots      |

Lighting beacon 3 also arms the night: skeleton archers join the hostiles. See Archery
and the night's newcomers.

### Beacon 4

You understand the following from the transmission:

- More urgency about your mission, and a promise that this time will be different for
  this world
- More recipes
- The way to the next beacon

Crafting table (3×3) recipes:

| Item               |
| ------------------ |
| Diamond pickaxe    |
| Diamond sword      |
| Diamond axe        |
| Diamond shovel     |
| Diamond hoe        |
| Diamond helmet     |
| Diamond chestplate |
| Diamond leggings   |
| Diamond boots      |

### Beacon 5

A celebratory transmission tells you that you have fully unlocked teleportation to this
world and can now return home a hero. It also lets you know you can choose to stay and
keep preparing a base to help the colonizers when they arrive.

### The journal

The journal (`src/journal.js`) opens with `J` in the world, View/Back on the pad, or the
menu's Journal page. It reads the same in the main menu and in the world, and the
keyboard, the mouse and a controller can all reach every card. Every journal has two
pages, Recipes and Transmissions. (This was once a setting that was off by default;
hiding the way back to a missed line behind a switch read as stingy.)

**Recipes** draws each received recipe instead of listing it:

- A card for each thing that can be made, shelved under the beacon that sent it
  (Beacon 1, survival kit; Beacon 2, farming, building and stone; Beacon 3, iron;
  Beacon 4, diamond). Recipes that make the same thing (coal and charcoal torches,
  either-handed shears) share one card and step through their ways with R, X or a click
- The highlighted card is drawn on the right on its real grid: its pattern in the 2×2
  pocket grid or the table's 3×3, centred where the matcher accepts it, an arrow, the
  result with its count, whether it needs the crafting table (anything three cells wide
  or tall), and what it uses
- Once the furnace recipe has arrived, a Furnace shelf shows each smelt, input over
  flame to output, and what burns
- A beacon that has not been lit gets one dim line saying how many recipes are waiting
  there. It does not show what they are, so the book never spoils a beacon

**Transmissions** keeps every message, because they are spotty on purpose and a line is
easy to miss the first time it comes through:

- The page holds every transmission received so far, whole. Each entry is headed by the
  beacon that carried it: Arrival at SP0, then Beacon 1, Beacon 2, and so on. Entries run
  oldest first, so the story reads in the order it was heard
- Reading the journal is quiet. It carries the words only, with no sound and no line by
  line timing, and it never replays the transmission. The panel that talks over the
  hotbar still fires once, at the moment the beacon is lit
- Nothing arrives early. An entry joins the journal only when its transmission is
  received, so the journal cannot spoil a beacon that has not been lit
- The journal asks for no saving of its own. The text is the same in every world, so
  the count of lit beacons the save already keeps is enough to know which entries the
  player has heard, the arrival transmission included

## World generation

Terrain is generated deterministically from a world seed (`WORLD_SEED` in
`src/config.js`) with hashing and gradient noise. Chunk generation is a pure function of
(seed, chunkX, chunkZ), so any chunk at any coordinate — including large negative
coordinates thousands of blocks from spawn — can be generated on demand, and returning to
a previous area regenerates the same terrain. There are no walls, cliffs, hard stops,
invisible barriers, or map boundaries; the world is never a pre-generated bounded grid.

- Chunk size: 16×16 blocks horizontally, 96 blocks tall, with sea level at y=48
- Chunks span positive and negative coordinates
- Chunks generate dynamically around the player's current chunk position, within a
  render distance of 8 chunks (128 blocks); chunks unload past render distance + 3
- Fog sits near the render edge (near 48, far 132) to hide pop-in
- Bedrock floors the bottom of the world with a ragged transition: layers y=1 through
  y=3 are a decreasing random mix of bedrock and stone
- The player spawns at the center of the world on top of the generated terrain

Terrain content:

- Varied, dramatic terrain: gentle plains, rolling hills, steep cliffs, and tall
  mountain ranges — amplitude depends on the biome, so plains stay walkable while
  mountain regions rise steeply well above the treeline
- Biomes: plains, forest, rainforest/jungle, desert, beach, ocean, rocky highlands, and
  snowy mountains, determined by temperature and humidity noise combined with elevation
  (hot + dry = desert, hot + humid = rainforest, cold or high = snow, temperate =
  plains/forest), blended smoothly across borders with no seams in terrain height
- Beaches near sea level; snow on high-elevation terrain
- Trees vary by biome: scattered oaks in plains, dense trees in forest, very dense and
  taller jungle trees with big canopies in rainforest, none in desert
- Rivers: winding channels carved where a dedicated low-frequency noise field crosses
  zero, cut down to just below sea level, filled with water, bedded with sand, and
  visually connecting lakes and oceans
- A connected cave system carved with 3D noise: long winding "spaghetti" tunnels from
  two independent low-frequency fields that branch and intersect into networks, plus
  occasional larger caverns from a separate blobby pass. Cave density increases with
  depth, and tunnels occasionally break through the surface as walkable cave entrances
- Cave fluids by region. A coarse noise field (`waterTableAt`) splits the underground
  into regions about a hundred blocks across:
  - About half are dry. Their caves are air, except at or below y=10 (`LAVA_LEVEL`),
    where every cut is a lava source: lava lakes and lava-floored tunnels right where
    the diamonds are
  - The rest are aquifers, each with one water table (14, 20, 26, 32 or 38, the
    shallow ones commonest). Every cave cut at or below the table is a water source,
    and a wet region holds no lava
  - Inside a region every cut under its line is filled, so no fluid is born beside open
    air and the pools lie still until the player breaks in. Where two regions would put
    different things side by side at one height (water beside air, water beside lava),
    `cutCrossesAquifer` refuses the cut on both sides and the border keeps a wall of
    stone. The sea test below applies to every cut, so no cave fluid touches the sea
- Water fills columns open to the sky below sea level (oceans, lakes, rivers). Caves are
  exempt: cave interiors hold only what their region gives them (above), and carving never
  opens the sea into a cave —
  `cutOpensSea` refuses a carve at or below sea level where the ground above it, or the
  neighbouring column, is flooded down to that height
- Ore veins, embedded in stone and placed deterministically from the seed, biased to
  deep rock and commonly exposed on cave walls:
  - Coal: veins of 3–8, from y=4 up to near the surface
  - Iron: veins of 2–6, deeper-biased
  - Diamond: veins of 2–5, only between y=4 and y=26, most near the bottom — the
    diamond tier comes after the furnace, not around it

## Block types

Blocks live in a single `BLOCKS` table indexed by id. **New blocks are appended from id
16 upwards and never renumbered** — ids are storage (chunk cells are one byte per cell),
and a runtime assertion enforces that each block sits at its own id.

| Id | Block | Notes |
| --- | --- | --- |
| 0 | Air | |
| 1 | Grass Block | Green speckled top, dirt sides with a grass fringe |
| 2 | Dirt | Brown on all faces |
| 3 | Stone | Grey |
| 4 | Cobblestone | Rounded-stone mosaic; dropped when stone is mined |
| 5 | Coal Ore | Drops 1–2 Coal |
| 6 | Iron Ore | Drops Raw Iron |
| 7 | Sand | Deserts, beaches, river beds |
| 8 | Water | A source; see Fluids: water and lava |
| 9 | Oak Log | Bark sides, ring top/bottom |
| 10 | Oak Planks | Horizontal boards |
| 11 | Oak Leaves | Slightly transparent cutout; drops apples, never itself |
| 12 | Snow Block | High-elevation surface |
| 13 | Crafting Table | Right-click opens the 3×3 grid |
| 14 | Torch | Thin geometry on a top face, or leaning off the side face it was placed on (the wall it hangs from is kept in the facings map), light 14, no collision; pops off as an item when the block holding it is mined or blown up |
| 15 | Bedrock | Indestructible |
| 16 | Diamond Ore | Drops Diamond; needs an iron pickaxe or better |
| 17 / 18 | Furnace / lit Furnace | A burning furnace is a second id and emits light 13 |
| 19 | Glass | Smelted sand; no tool speeds it, as in Minecraft |
| 20 | Farmland | Made by hoeing grass or dirt |
| 21–28 | Wheat, stages 0–7 | Crop growth lives in the block id, so fields survive chunk unloads |
| 29–32 | Wooden Door (lower/upper, closed/open pair) | One item across two cells; the open ids are non-solid |
| 33 / 34 | Red Bed (foot/head) | One item across two cells |
| 35–48 | Water flow/fall levels 1–7 each | Resting sheets and falling water; see Fluids: water and lava |
| 49 | Chest | Contents live in a block entity |
| 50 / 51 | Oak Stairs / Cobblestone Stairs | The only sub-block collider in the game |
| 52 | Ladder | Solid: false; the first block a player stands inside of |
| 53 / 54 | Beacon (unlit/lit) | Mission monuments; see The mission |
| 55 | Lava | A source; see Fluids: water and lava. Light 15, no collision |
| 56–61 | Lava flow/fall levels 1–3 each | Every rank glows at 15 like the source |
| 62 | Obsidian | What a lava source hardens into; hardness 50, needs a diamond pickaxe |

Grass grows on surface terrain in grassy biomes; dirt underlies the surface layers;
stone fills the deep rock and mountains. Water and bedrock are never placed or mined by
the player.

## Textures and materials

All block textures are generated at runtime — no external image files. Each texture is a
16×16 pixel canvas drawn pixel-by-pixel and combined into a single 16×16-tile atlas with
UVs mapped per face, sampled with `NearestFilter` so it stays crisp and pixelated.
Per-pixel speckle uses a seeded random so textures are identical between runs. Each block
has a distinct hand-drawn-looking pattern (grass with fringe, stone cracks, cobblestone
mosaic, ore blobs and flecks, bark striations and rings, plank boards, layered leaves,
ripple water), plus dedicated tiles for the furnace faces, chest faces, door leaves, bed
pieces, ladder rungs, crack overlay stages, and the eight wheat stages. Blocks support
different textures per face (top, bottom, side, front), and materials carry roughness and
transparency settings; the cutout pass handles leaves, glass, doors, beds, ladders, and
torches with correct transparency. Item icons are separate procedural pixel-art canvases
in `src/icons.js`.

## Player and controls

A first-person controller:

- Pointer lock on click; mouse look; WASD relative to the camera
- Space to jump; gravity; ground detection; collision against solid blocks, correct
  across chunk boundaries
- Sprint is a latch, not a held key: Shift, either Ctrl, or the gamepad's B / L3 starts
  the run and the same key stops it. Sprinting walks at 6.9 blocks/s instead of 4.6.
  The latch drops whenever the controls leave the player — pause, any open screen,
  death, respawn, window blur, gamepad disconnect — so a sprint never resumes by
  surprise. Standing still or being in water pauses the effect without dropping the
  latch. The HUD shows a `Sprint on` line beside the day dial while it is set
- Step-up walking: `PLAYER_STEP_HEIGHT = 0.6`. When a grounded frame's horizontal move
  is blocked, the move is replayed stood a little taller, in lifts up to 0.6, so half-
  block stair treads are walked up rather than jumped. Anything taller still has to be
  jumped; water keeps its own taller mantle trick
- The camera pays for those lifts with a glide rather than a jolt: `tryStepUp` reports
  how far the feet rose, and the view is eased down below the eyes
  (`cameraStepOffset`, exponential decay, rate 13, cap 1.2 blocks), zeroed by teleport,
  respawn, void rescue and load. Everything that touches the world — the block ray,
  the water ray, the mob ray — aims from the true eye (`aimOrigin()`), not the gliding
  view
- The player can pass through water, with movement slowed and a swimming model (swim
  acceleration, buoyancy, a mantle at the surface). Ladders are climbed, not collided
  with — see Ladders
- The collision box is 0.6 wide, 1.8 tall, eye at 1.62
- Gamepad support via the Web Gamepad API: left stick moves, right stick looks
  (configurable sensitivity), A/Cross jumps, right trigger mines/attacks, left trigger
  places/interacts, shoulder buttons scroll the hotbar, B/L3 latches sprint,
  Y opens the inventory, View/Back opens the journal, and Start/Menu opens the main
  menu. Menu grids are walked with the D-pad or stick: A picks up and places whole
  stacks, X takes half a stack and places one item, Y/Triangle quick-moves, B or
  View/Back closes

Health:

- 10 hearts (20 health points), drawn as a heart bar above the hotbar
- Damage from hostile mobs, creepers, starvation, falls greater than 3 blocks, lava and
  fire (see In lava)
- Health regenerates only through the hunger system (see Hunger): a nearly full stomach
  heals, an empty one kills
- On death, a respawn screen offers a respawn (its button, the `A` key, or gamepad A)
  at the spawn point with full health and a full stomach; the inventory is kept

## Mining and block interaction

- Crosshair in the center; a raycast from the true eye picks the targeted block, drawn
  with a subtle wireframe outline over the whole cell (the picker is cell-granular even
  for the sub-block stairs and ladder)
- Left click (hold) mines the target with progress drawn as cracking stages on the block
- Broken blocks drop as small floating, spinning item entities that are pulled toward
  and collected by the player
- Right click places the selected block, consuming one from its stack; right-clicking a
  crafting table opens the 3×3 grid instead
- A block may not be placed inside the player's collision box; placing against a bottom
  face is refused
- Water is see-through to the block raycast (the bucket gets its own water ray) and
  cannot be mined at all — `breakable: false`
- Bedrock never breaks

Break time is Minecraft's formula: `hardness * 1.5 / speed` with the right tool at the
right tier, `hardness * 5 / speed` with anything else, floored at 0.05 seconds. A block
whose tier gate outranks the tool still breaks, but drops nothing — which is how diamond
ore refuses a stone pickaxe and iron ore refuses bare hands.

Tool tiers (`TOOL_TIERS`):

| Tool material | Mining speed | Tier | Durability | Attack damage |
| --- | --- | --- | --- | --- |
| hand, or the wrong kind of tool | 1 | — | — | 1 |
| Wood | 2 | 1 | 60 | 2.5 |
| Stone | 4 | 2 | 132 | 3.5 |
| Iron | 6 | 3 | 251 | 5.0 |
| Diamond | 8 | 4 | 1561 | 7.0 |

Hardnesses, tool gates and drops, each block's correct tool in italics:

| Block | Hardness | Correct tool | Min tier | Drops |
| --- | --- | --- | --- | --- |
| Dirt | 0.5 | *shovel* | — | Dirt |
| Grass Block | 0.6 | *shovel* | — | Dirt, plus 1–2 seeds at 25% |
| Sand | 0.5 | *shovel* | — | Sand |
| Snow Block | 0.2 | *shovel* | — | Snow |
| Farmland | 0.6 | *shovel* | — | Dirt |
| Oak Leaves | 0.2 | *hoe* | — | Apple at 2.5%; never a leaf block |
| Torch | 0 | — | — | Torch |
| Oak Log | 2.0 | *axe* | — | Oak Log |
| Oak Planks | 2.0 | *axe* | — | Oak Planks |
| Crafting Table | 2.5 | *axe* | — | Crafting Table |
| Stone | 1.5 | *pickaxe* | 1 (wood) | Cobblestone |
| Cobblestone | 2.0 | *pickaxe* | 1 (wood) | Cobblestone |
| Coal Ore | 3.0 | *pickaxe* | 1 (wood) | 1–2 Coal |
| Iron Ore | 3.0 | *pickaxe* | 2 (stone) | Raw Iron |
| Diamond Ore | 3.0 | *pickaxe* | 3 (iron) | Diamond |
| Glass | 0.3 | — | — | Glass |
| Furnace | 3.5 | *pickaxe* | 1 (wood) | Furnace |
| Wooden Door | 3.0 | *axe* | — | Door |
| Red Bed | 0.2 | — | — | Bed |
| Chest | 2.5 | *axe* | — | Chest |
| Oak Stairs | 2.0 | *axe* | — | Oak Stairs |
| Cobblestone Stairs | 2.0 | *pickaxe* | 1 (wood) | Cobblestone Stairs |
| Ladder | 0.4 | *axe* | — | Ladder |
| Bedrock | ∞ | — | — | never breaks |

Between blocks, a held click does not chain at full speed: once a block gives way the
game waits six ticks (`MINING_BLOCK_DELAY`, 0.3 s) before the next one starts to crack,
unless the block shatters inside a single tick, which skips the gap — that is what lets
an iron shovel tear through a snowfield. The gap runs whether or not the button stays
held; swinging at unbreakable bedrock neither earns nor spends one. The swing itself —
the arm animation and the contact sound — repeats every 0.3 s (`MINING_SWING_INTERVAL`).

Durability is only spent by swings that break something and blows that land; a broken
tool vanishes with a toast, and the HUD draws a durability bar on worn tools and armour.
Mining with the head underwater, sword swing speeds, and shears-as-tools are deliberately
not modelled.

Combat: left click while a mob is under the crosshair within reach attacks it, with
knockback and an attack cooldown; swords hit hardest. `tryShearMob` is the one
interaction wired to both buttons (see Shearing).

## Held item view

The selected hotbar item is drawn in first person, anchored bottom-right like
Minecraft's held item: blocks as small 3D cubes wearing their real atlas textures
(stairs and the rest all draw as cubes in the hand); tools, torches, doors, ladders,
and material items as their pixel-art icon (the ladder uses its flat 32×60 tile, like
the torch and door). A short swing plays on left click and while mining or attacking;
the view bobs while walking and sways on turns; switching slots swaps it visibly; an
empty hand shows nothing.

## Inventory system

- 36 slots: 9 hotbar plus 27 storage; E opens and closes the screen (releasing pointer
  lock); the inventory, crafting, chest and give screens pause the player's input
- Items stack to 64 (buckets 16; tools, armour, water buckets 1), with the count in the
  slot corner and a durability bar when relevant; a damaged tool never merges with a
  fresh one
- Click picks up a whole stack, click again places it; right click places one item;
  shift-click quick-moves between pack rows, and into or out of an open container —
  from the pack into a chest it tops up matching stacks, then claims free rows;
  armour shift-clicked from a container goes onto the body
- Number keys 1–9 and the mouse wheel select the hotbar; the hotbar is always visible
  with the selected slot highlighted and the item's name shown briefly on switch
- Drops go into the inventory automatically, stacking first; if the pack is full they
  stay in the world as entities. The player starts with an empty inventory
- A stack can also ride the cursor between screens; the gamepad walks every grid with
  the rules listed under Player and controls, and a pad pick in the grid answers with
  the simple UI click — the same tick the hotbar makes. The crafting result pad keeps
  its own chime, so a craft is not a click with a second answer on top

## Crafting system

Two grids: a 2×2 built into the inventory screen and a 3×3 opened by right-clicking a
placed crafting table. A result slot previews the output; clicking it consumes the
ingredients. The matcher is shape-aware: patterns match anywhere in the grid, patterns
are trimmed to their bounding box, a `.` must stay empty, patterns never mirror or
rotate (which is why both shears diagonals are written down), and shapeless recipes
compare which item ids are present, not how many.

Recipes:

| Result | Pattern | Grid |
| --- | --- | --- |
| Oak Planks ×4 | 1 Oak Log | 2×2, shapeless |
| Stick ×4 | two planks stacked | 2×2 |
| Crafting Table ×1 | 2×2 planks | 2×2 |
| Torch ×4 | coal (or charcoal) over a stick | 2×2 |
| Furnace ×1 | eight cobblestone ring | 3×3 |
| Bread ×1 | `WWW` | 3×3 |
| Wooden Door ×3 | `PP` / `PP` / `PP` | 3×3 |
| Shears ×1 | two iron ingots point-to-point (either diagonal) | 2×2 |
| Red Bed ×1 | `WWW` over `PPP` | 3×3 |
| Bucket ×1 | `I.I` / `.I.` | 3×3 |
| Chest ×1 | `PPP` / `P.P` / `PPP` | 3×3 |
| Oak / Cobblestone Stairs ×4 | six planks (or cobblestone) in a V | 3×3 |
| Ladder ×3 | `S.S` / `SSS` / `S.S` | 3×3 |
| Pickaxe / Axe / Shovel / Hoe / Sword, in wood, stone, iron or diamond | Minecraft's own tool shapes over a stick handle | 3×3 |
| Helmet / Chestplate / Leggings / Boots, in leather, iron or diamond | Minecraft's own armour shapes | 3×3 |

Anything three cells across — bed, bucket, chest, stairs, ladder, bread, door, furnace,
tools, armour — needs the crafting table; the pocket 2×2 folds only planks, sticks,
tables, and torches. Coal, charcoal, raw iron, iron ingots, diamond, leather, wool,
feathers, seeds and apples are material or food items and cannot be placed in the
world.

## Armour

Leather, iron and diamond sets, one piece per slot, with Minecraft's own numbers:

| Material | Defence (H/C/L/B) | Durability (H/C/L/B) |
| --- | --- | --- |
| Leather | 1 / 3 / 2 / 1 | 55 / 80 / 75 / 65 |
| Iron | 2 / 6 / 5 / 2 | 165 / 240 / 225 / 195 |
| Diamond | 3 / 8 / 6 / 3 | 363 / 528 / 495 / 429 |

Damage absorbed is `amount * min(20, max(defence / 5, defence - amount / 2)) / 25`.
Each hit costs one random worn piece four durability per point absorbed, so a set wears
unevenly, and a piece that runs out un-equips itself. The HUD draws the set as ten
shields above the hunger bar; the row is hidden while nothing is worn. Starvation
damage goes straight through armour.

## Hunger and food

Twenty points of food with Minecraft's hidden saturation counter on top of it:

| Rule | Value |
| --- | --- |
| Hunger maximum | 20 points, drawn as a shank bar |
| Saturation | hidden, 0–20, never above the food it cushions |
| Exhaustion spends at | 4.0, saturation before food, one point of either per crossing |
| Slow heal | half a heart every 4 s at hunger 18+, or with any saturation left; 6 exhaustion each |
| Saturation boost | half a heart every 0.5 s at a completely full bar with saturation left, 1.5 saturation each |
| Post-hit wait | 6 s, gating the slow heal only, never the boost |
| Starvation | half a heart every 4 s at hunger 0, straight through armour, no exhaustion |
| Time per bite | 0.6 s |
| On respawn | food 20, saturation 5, exhaustion 0 |

The two heal paths never run at once — at a full bar with saturation the boost pays for
the health. There is no difficulty setting and no floor, so an empty bar can kill, and
the respawn refill means hunger can kill once but never twice in a row.

Exhaustion costs, per Minecraft Java 1.21: sprinting 0.1 per block, swimming 0.01 per
block, jumping 0.05 per jump, sprint-jumping 0.2, mining a block 0.005, a landed swing
0.1, taking a hit 0.1, regenerating 6.0 per half heart. Walking is free, so exploring
costs nothing and a meal buys work rather than footsteps. There is no sprint-swimming;
water always charges the swim rate. Sprinting is never gated by low hunger.

Saturation has no bar of its own; the food bar jitters whenever there is food left and
no cushion under it — Minecraft's only tell. Eating early matters: a meal at a
half-empty stomach wastes most of its saturation, and a full bar refuses a bite even
with nothing cushioning it.

| Food | Hunger | Saturation |
| --- | --- | --- |
| Wheat | 2 | 1.2 |
| Apple | 4 | 2.4 |
| Bread | 5 | 6.0 |
| Steak | 8 | 12.8 |

Deliberate divergences from Minecraft: raw beef feeds nobody as it comes (right-click
answers *Raw Beef needs cooking in a furnace*; only a furnace's steak is food, which
makes the cooker a gate of the food chain, not just of the tech tree); wheat itself is
edible, so farming has to feed you or it is decoration; the apple's food values are
Minecraft's but its source is not — see Farming.

## Furnace and smelting

Eight cobblestone ring a furnace at the crafting table, and the furnace is mandatory:
iron only becomes an ingot through it, and so does steak, glass and charcoal. Every
smelt takes ten seconds. A burning furnace is a second block id and gives off light
level 13. Contents, remaining burn, and the direction it faces live in a block entity
keyed by position; block entities within 32 blocks of the player, plus the one whose
screen is open, tick.

| Input | Output |
| --- | --- |
| Raw Iron | Iron Ingot |
| Raw Beef | Steak |
| Sand | Glass |
| Cobblestone | Stone |
| Oak Log | Charcoal |

Fuel buys heat, and heat carries over between items:

| Fuel | Seconds of heat | Items per unit |
| --- | --- | --- |
| Coal / Charcoal | 80 | 8 |
| Oak Planks / Oak Log / Crafting Table | 15 | 1.5 |
| Stick | 5 | 0.5 |
| Lava Bucket | 1000 | 100 |

A lava bucket burns whole and leaves the empty bucket in the fuel slot. The screen
says "That will not burn" while the fuel slot holds something that is not fuel.

The furnace screen has input, fuel, and output slots with a burn indicator, and keeps
cooking while open.

## Farming: wheat, soil and apples

- Seeds come from breaking grass: 25% for 1–2. That, plus the apple, is how a player
  with no farm gets food started
- A hoe turns grass or dirt into farmland; a seed sown on it starts at stage 0
- Wheat has eight growth stages (block ids 21–28), drawn as two crossed quads that grow
  taller, leaf out, and turn gold at the tip
- Growth: one attempt per crop per second at a 1.2% chance, only where sky or block
  light reaches 9 — roughly ten real minutes in the open. A crop's furrow also has to
  be wet: any liquid (source or ripple) inside the 9×9 square centred on the furrow
  (`FARMLAND_WET_REACH = 4`, Chebyshev distance) at the furrow's own level or one
  above. One above is in the rule because a ditch running over the tops of furrows
  waters them; one below is not, so water under the soil is a swamp, not irrigation.
  A dry furrow simply stops — no slow crawl — and sowing dry soil works but says so:
  *Dry soil — crops wait for water within 4 blocks*
- Harvest: ripe wheat drops 1 wheat and 1–2 seeds; an unripe crop gives back its seed
  and the furrow stays tilled; digging farmland out from under a crop destroys the crop
- Wetness is a question asked of the world each tick, never a stored value: a field
  wets and dries in the same frame the water moves, and an unloaded furrow just reads
  dry and waits
- Apples hang in every canopy: a broken leaf rolls one at 2.5%, five times Minecraft's
  rate, because a food nobody ever finds is indistinguishable from one that does not
  exist. A leaf gives up nothing else — no leaf block, ever. The roll is a drop entry
  on the leaf block itself, so every path that destroys a block owes it — a creeper
  crater included. Apples cannot be farmed (there are no saplings), and have no other
  use: food or nothing

## Fluids: water and lava

Water and lava share one flow model (`desiredFluid` in `src/water.js`). Every block
carries `fluid` (`'water'`, `'lava'` or null) and `fluidLevel` (0 for a source, the rank
above that); the rules below are written for water and apply to lava unchanged, with
lava's own numbers:

| | Water | Lava |
| --- | --- | --- |
| Ranks past the source | 7 | 3 (Minecraft's overworld reach of four blocks) |
| Beat | every water tick (0.15 s) | every 6th water tick (0.9 s), Minecraft's 30-vs-5 ratio |
| Surface step per rank | ⅛ block | ¼ block |
| Light | none | 15 at every rank |
| Drawn with | the blended water pass | the opaque terrain (nothing is seen through it) |

Only lava *moving* waits for lava's beat: lava spreading, drying up, or arriving beside
water. Lava hardening happens on the tick water reaches it, so a bucket poured on a
spill quenches it at once. Waiting changes when lava moves, never what it settles into.

Where the two meet, Minecraft's three rules decide, and they are the only way a fluid
ever becomes solid:

- Lava with water beside it or on top of it hardens in place: a source into **obsidian**,
  any flowing rank into **cobblestone**. Water does not wash lava away
- Water with lava pouring onto it from above turns to **stone**, so a lavafall into a
  lake plugs itself
- Water *below* lava does nothing to the lava: the lava pours down into it, and that is
  the water cell's meeting
- A cell both fluids reach holds water, and the lava beside it is what hardens

A solid never turns back into a fluid, so every meeting is final and the flood still
reaches a fixed point. Flow edits that change light or opacity (lava arriving or
leaving, a meeting leaving rock) go through the light engine; plain water edits still
skip it. A placed block replaces lava the same way it replaces water, rays pass through
both, and only water wets farmland. Worldgen fills caves with lava and water by region
(see World generation), always settled; no cave fluid moves until an edit reaches it.

`waterFlowCheck()` replays the rules on small rigs. Its `cases` are the water rigs the
snapshot guard compares; `lava` holds the lava and meeting rigs (`lavaOk`).

### Water

Water is fifteen block states: a source (`WATER`, id 8), seven resting levels
(`WATER_FLOW_1..7`, rank 1 deepest, 7 a film), and the same seven carrying their own
rank while falling (`WATER_FALL_1..7`). Depth lives in the id the way wheat growth does.

One rule decides everything: **a cell's rank is the shortest path cost from a source,
where a step sideways costs a depth and a step down costs nothing.** A source hands
depth 1 to the cell below it; a fall feeds nobody sideways — falling water is on its way
somewhere, not a supply. A cell pours sideways only while its rank is ≤ 7, so a film
ends instead of running off the edge of the world. The one exception feeding a cell from
above: overhead counts as pouring in when it is a fall *or the source a fall came from*.
Sources are never bred — worldgen and the bucket are the only sources — because
two-flows-make-a-source printed permanent sea into shore notches and flooded them
forever.

The model accepts under-filling on purpose: digging a channel deeper than one block
floods its floor with the correct gradient and leaves the rows above dry, where
Minecraft would fill to the surface. Letting falls feed sideways sprays every waterfall
off its wall and historically never converged. What the rule guarantees is what the
player judges: nothing is left unsupported, nothing floods further than it should, and
every edit reaches a fixed point.

The simulation is reactive, never global:

- An edit queues the cells around it (`queueWaterAround`, called from `setBlock` and
  `setBlocksBatch`); nothing else is ever looked at, so an untouched ocean costs
  nothing per frame
- Resolution is batched Jacobi — every read sees start-of-tick state, so queue order
  cannot change the result. The tick is 0.15 s with a 512-cell budget
- Water only moves into air: crops, torches and plants are never displaced
- A cell waiting on an unloaded neighbour retries twelve ticks, then parks against its
  own chunk rather than being dropped
- A chunk arriving is a wake-up call: parked cells re-queue, and saved water around
  restored overrides re-joins the queue, so a save taken mid-pour resumes the pour.
  Worldgen water is already a fixed point, so waking it changes nothing
- Drying a flow cell writes an `AIR` override rather than deleting one
- Remeshing after a flow is deferred through `flowRemesh` with per-tick and idle
  budgets, so a hundred-cell flood cannot stall a frame; worst case the frame loop ever
  runs is one water tick (dt is clamped below the tick length)
- Reads below the world floor are solid and above the ceiling are air, so sources at
  either extreme converge

Generation stays settled from the other side too: caves are never carved open under
water (`cutOpensSea`), so the player's first visit never drains the sea underground, and
cave pools from different regions are walled apart (`cutCrossesAquifer`).

The renderer follows the levels: each cell draws its surface at `(8 − rank)/8` of the
cell, shared grid corners average the water cells that meet there so neighbouring
levels slope into each other, and only the top of a body of water draws a surface —
resting water presses the cell below up to its ceiling and seals it. A pouring stream
neither presses the pool it lands in nor loses the pool's own surface, and is drawn
down to the surface it actually lands on. Flow edits skip lighting: air and water are
both transparent, so neither can be what changed the light.

Cosmetics — fresnel, foam, animated UVs, caustics, an underwater tint beyond the audio
muffle — are deliberately unmade until the surfaces stop moving.

### In lava

Lava is swum the way water is, only thicker. Lava hurts whatever touches it, and
nothing walks into it on purpose.

- **Moving.** A body is in lava when its feet or its middle are (the same depth rule as
  water, asked lower: a foot in lava burns where a foot in water does not swim). It wades
  at 0.3 of walking speed (water: 0.55), strokes up at 0.45 of water's rate, sinks at
  water's slow rate, cannot sprint, takes no fall damage landing in it, and can climb out
  over a ledge the way a swimmer can
- **Burning.** In lava: 4 damage every half second, the first on contact, with armour
  taking its share as it does of a hit. A bite the hurt cooldown turns away is retried
  the next frame, not lost. Leaving lava leaves the body on fire for 8 seconds at 1
  damage a second. Being in lava keeps the fire at its full 8; water puts it out at
  once. The saturation boost still heals through it, so a well-fed player outlasts the
  afterburn. Death messages: "You tried to swim in lava." and "You burned to death."
  The fire's seconds left are saved as the player's `fire`, written only while above
  zero, and respawning puts it out
- **Mobs** burn by the same numbers and are slowed harder than in water. A step that
  would put a mob's feet in lava, or onto lava a block down, is cancelled: a wanderer
  picks somewhere else and a hunter stops at the edge. A mob already in lava is never
  held back, so it can walk out, and a hurt animal's panic usually carries it out
- **Drops.** An item entity in a lava cell burns at once, the whole stack, before the
  player's pull can save it. A mob killed in lava loses its loot the same way
- **The view.** With the eyes in lava the fog closes to 0.1–2.5 blocks in a glowing
  orange that ignores the time of day, and an orange wash covers the screen
  (`#lava-tint`). While the body is in lava or on fire, flames flicker up from the
  bottom of the view (`#burn-glow`)

### Buckets

Smelt the iron, fold three ingots into a V (`I.I` / `.I.`), dip the empty bucket in a
source, carry it, pour it elsewhere. Three item ids — `bucket` (stacks to 16),
`water_bucket` and `lava_bucket` (neither stacks) — rather than a flag, because the
save, drops, and the merge rule all read the id.

- A bucket drinks only from a full source. A ripple that has run out from its shore
  stays where it is
- A source with water beside it is a body's mouth, not a bucketful: it keeps its cell
  and refills the next bucket, leaving the body's ranks untouched. Only a source with
  no water in its six neighbours at all is a whole body — a lone puddle or sealed well —
  and that one cell lifts whole
- A lava source always lifts out whole, beside other lava or not: lava does not make more
  of itself the way a lake does, so a pool shrinks by a bucket each time and its flow
  closes the gap from the sources left
- Pouring puts a source in the aimed cell if it is air or already fluid; the flow code
  wakes on its own and settles any meeting, so lava poured into water is obsidian at once. There is no test for whether that cell is the one you stand in —
  pour under your feet and the water arrives around your ankles
- Water is still `breakable: false`: the bucket is the only way to move water, and
  right click is the only way to fill one. The bucket is dispatched inside placement,
  after the hoe and the seeds, so an interactive block keeps first refusal: a crafting
  table behind a puddle opens rather than flooding. The bucket finds a source with its
  own walk of the ray (`raycastFluidSource`), stopping at the first solid and taking the
  first source of either fluid along the way
- A lava bucket is furnace fuel (see Furnace and smelting)
- No water bottle (nothing to fill), and nothing in the world hands out a free bucket

## Containers

Right-click opens containers ahead of any block placement, and each screen keeps the
armour column and the 2×2 grid alongside the player's own rows.

**Chest** (id 49): eight boards ringed around an empty middle at the table, placed with
the latch toward whoever placed it, 27 slots that wait for the player to come back.
Hardness 2.5 with an axe and no tier, so a bare hand takes it apart in 3.75 s and still
gets the box back. It is structurally a furnace: one id, its facing in the facings map,
contents in a block entity. Breaking an empty chest drops the plain chest item. Breaking
one with anything inside picks it up whole as a **Packed Chest**: a separate item id that
stacks one to a slot, places as an ordinary chest, and carries its 27 slots on the stack
(`contents`, each slot keeping its count, wear and any packed chest of its own). It goes
straight into the pack when a slot is free, and only drops at the player's feet when the
pack is full, since a dropped item can be lost. Setting it down puts every slot back where
it was. This is the base-moving tool: the mission walks the player from beacon to beacon,
and the base comes with them. A packed chest never merges with anything, the tooltip
says how many stacks are inside, and the debug shelf's own packed chest is just an empty
box. An explosion still blows a chest open: its contents spill as real drops, each with
its wear and contents intact, and then the box — the explosion path owes the same roll as
a pickaxe. A chest never ticks beyond a stale-state sweep that clears a box whose block
is gone; opening a chest pauses the world the way the inventory does. There are no loot
chests, because there are still no structures.

## Doors and beds

A wooden door is one item across two cells (ids 29–32): the open pair are separate ids
that are non-solid, which is what makes a doorway walk-through. Right-click swings it,
whatever is held. Six planks make three doors at the table. Breaking either half takes
the whole door with it and pays out one item.

A bed (ids 33/34) is the same two-cell arrangement: the foot takes the aimed cell, the
head sits one step along a facing pointed away from the placer, both cells carry the
facing, and both are solid — you walk on a bed, not through it. Three wool over three
planks makes one at the table. Breaking either half clears the other outright, so a bed
never pays out twice. It is drawn as geometry: a half-tall mattress across both cells,
blanket red with a wooden rail, plank ends, and a pillow at the far end of the head.

Right-clicking either half claims the bed, whatever else is held:

- Daytime, or the hour before dusk: the spawn point moves to the bed; the clock is
  untouched
- Night (the same test the sky uses, sun below −0.04): the spawn point moves, the
  screen fades to black over 0.7 s, and the world wakes 1.4 s later at `DAY_START`
  (0.22, 11:16) with a `Good morning` toast. It is a blackout, not a fast-forward —
  nothing else is paused, so mobs that were close when you lay down are close when you
  get up
- The respawn point outlives the bed: the save carries a `spawn: { x, z }` beside the
  player's own position; a world without one keeps the world spawn. Because the bed is
  solid, waking and dying both put the player standing on top of it

## Stairs and ladders

Oak and cobblestone stairs (ids 50/51) are the first shape in the game that is not a
whole cell: hardness 2, oak asks an axe, cobblestone a pickaxe at tier 1; six boards in
a V saw four stairs, Minecraft's pattern and numbers. The facing points at the low step,
turned toward the placer, so a line of stairs climbs away from whoever stood at the
bottom. Structurally they are facing blocks like the chest — one id per family, no new
save key.

- `cellCollidesAt` is the collision primitive: a stair answers with two boxes — half a
  block tall across the whole cell, and the upper half over the side away from the
  facing — and the player and mobs both walk their raw boxes through it. Combined with
  `PLAYER_STEP_HEIGHT = 0.6`, a staircase is something a player walks up and a mob
  hops up; nothing else in the world is sub-block
- The step is drawn on the opaque pass (eleven quads) with the tile sliced, so the two
  boxes read as one block sawn along the step. Stairs are `opaque: false`: light gets
  through the open corner and neighbours do not cull against the step. Item icons show
  the step in side elevation rather than an isometric cube
- Deliberate limits: the raycast and outline are whole cells, one cell one block (no
  waterlogging), no upside-down state (facings carry a direction, not a flip), stairs
  float where you put them, and placing against a bottom face is refused — the
  engine's rule for every block

Ladders (id 52) are the other half of sub-block: a cell that is climbable and blocks
nothing. Hardness 0.4 with an axe; `solid: false, opaque: false, cutout: true`; drawn
as one double-sided quad standing 1/16 off the wall, wearing the runged tile. Seven
sticks make three ladders.

- The facing is the wall's, not the placer's: `ladderFacingFor` reads the clicked face,
  and the top or bottom of an existing ladder borrows that ladder's facing when the
  wall carries on, so columns build upward. A ladder with no wall refuses placement:
  *A ladder needs a wall to hang on* — and removing the wall never drops the ladder:
  this game has no support rule anywhere
- `ladderHolding` is a question about the feet cell (with a hundredth of upward
  slack), never a collider. On a ladder the player climbs at Minecraft's 2.3572
  blocks/s with jump, descends at the same speed with the backward key (this game has
  no sneak key — Shift latches sprint), gravity is off, the away-from-wall velocity is
  cancelled while descending, and touching a ladder mid-fall cancels the fall
- Mobs do not climb; the raycast and outline are whole cells; the plank itself has no
  collision

## Animals and mobs

Mobs are entities separate from the voxel grid, built from box geometry with
16×16 procedural textures: head, body, four legs, leg-swing walk and head bob. They
feel gravity and block collision, hop one block (and take the stairs' half-blocks),
flee briefly when hit, burst into particles and drop items when killed, and take
player attacks with knockback.

Population is a budget:

- `MOB_CAP` 32 total, split into `PASSIVE_CAP` 10 and `HOSTILE_CAP` 16 that add up to
  no more than the total with no reservations — a healthy herd can never decide how
  dangerous the night is
- Passive animals — cows, pigs, sheep, chickens — spawn on grass in plains, forest, and
  rainforest as chunks load. Chickens, the only source of feathers, are the most
  common species in every one of them: plains roll chicken 30%, cow 25%, pig 20%,
  sheep 25%; forest chicken 40% and cow, pig, sheep 20% each; rainforest chicken
  60%, pig 22%, cow 18%. They are deliberately scarce: fewer than half of grassy
  chunks hold a herd (38%), a herd is a lone animal 80% of the time and a pair 20%, and
  the refill sweep runs every 5 s. There is no breeding and passives never despawn on a
  roll, so these knobs are the whole supply: meat is a find, not a stipend, and the
  wheat field is the reliable half of the food economy. A chunk's herd roll is spent
  only while the player is close enough to have seen it, so herds arrive as the player
  travels
- Zombies spawn on solid ground at night or in dark places — the light level at the
  spot below a threshold, so unlit caves spawn zombies even at noon and torch-lit
  areas are safe — in a band 20 to 48 blocks around the player. Night arrives in
  batches: up to three hostiles per 1.4 s after dark (one per 3.6 s by day), with the
  night's candidates weighted 85% to the surface. Creepers spawn rarely under the same
  conditions. Spiders (after beacon 2) and skeleton archers (after beacon 3) join the
  same spawns as the mission goes on; Archery and the night's newcomers describes
  them, the bow and its arrows
- Zombies walk directly at the player within detection range (step-up steering, no full
  pathfinding) and deal contact damage on a cooldown. Creepers approach, then hiss,
  flash, and explode on a 1.55 s fuse lit at about 2.5 blocks in three dimensions with
  clear sight — leaves and water do not break the sight line, walls and closed doors
  do — destroying nearby non-bedrock blocks, which drop as items. A creeper sealed
  too tight suffocates before it lights
- Hostile mobs burn under open sky at dawn (sheltered in darkness they stay) and keep
  giving up and vanishing on a roll — 25% every 5 s once idle and 32+ blocks away in
  three dimensions — so a cave under the player's base cannot hold the entire hostile
  budget. Everything despawns at 96 blocks in three dimensions

Drops: cows, pigs and sheep drop Raw Beef (and Leather from cows); a woolly sheep
drops one wool on top of its meat, a shorn one meat only; chickens drop feathers;
spiders drop string and skeletons arrows.
Raw beef must be cooked. Shearing is the other way to take wool — see Shearing.

## Shearing

Shears (2×2, two ingots point-to-point) are the one tool with no tier: they match no
block's tool, mine at hand speed, and spend no durability while mining. 64 uses, stack
of 1. Either button shears — right click is the deliberate use, but the left button
answers to it too, and shears never wound a sheep at all on either path; killing one
for its fleece takes any other tool. A woolly sheep under the crosshair comes off
whole: 1–3 wool, one durability, the animal bleats and trots away bare. An already
shorn sheep says so and costs nothing; on any other mob the left button swings like a
generic tool (2 damage, 2 durability) and the right click says *Nothing to shear
here*.

Reach is judged for the animal on its own ray, with clear air required to the fleece —
a sheep on a slope is not disowned because the ground in front of it is nearer — and a
nearer block still wins a right click outright: a crafting table with a cow pressed
behind it opens. Holding the left button down answers once, then swings in silence.

Fleece never grows back: a fleecy hillside is worth fencing. The shorn model drops the
fleece layer and shows bare skin. Wool's only use is the bed.

## Archery and the night's newcomers
The night grows with the mission. Before beacon 2 a hostile spawn is a creeper 16% of the time and a zombie otherwise. Once beacon 2 is lit, a fifth of spawns roll a spider. A spider that would not fit the spot arrives as a zombie instead, so about one spawn in ten is a spider. Once beacon 3 is lit, another fifth of spawns are skeletons. The newcomers take their share out of the zombies'. All of them scale with the ground they were spawned on, as every enemy does, and pay essence when killed.

**Spiders** (beacon 2). 16 health, quick, wide and low: 1.28 blocks across, wider than one block. A spider climbs any wall it runs into while it walks. It bites for 2 on a one-second cooldown. Sunlight does not burn it. Out under the daytime sky it hunts nobody unless it is hit, and then it stays angry for twelve seconds. In a dark cave it hunts as it would at night. It drops 0–2 string.

**Skeleton archers** (beacon 3). 20 health. Within 24 blocks a skeleton holds its distance instead of closing it: it walks in from beyond 13 blocks, backs away inside 6, and in between circles the walker, changing side every few seconds. With a clear line of sight within 18 blocks it looses an arrow about every 2.2 seconds. The arrow aims high by the drop its flight will take and wobbles a little, and hits for 3 before difficulty scaling. Skeletons burn in sunlight like zombies. A skeleton drops 0–2 arrows, and its arrows that miss stick where they land and are gone after four seconds.

**The bow.** Hold the use button (right click, or the left trigger) to draw, and let go to shoot. A full draw takes a second. A full draw shoots an arrow at 42 blocks a second for 7 damage, and a partial draw shoots slower and weaker in proportion. A draw under a tenth of the way lets go without shooting. Each shot spends one arrow from anywhere in the pack and one of the bow's 384 uses. Without arrows the bow says so. Arrows fall under gravity. The walker's arrows that miss land as an arrow item to pick up again, and one that hits is spent. The bow mines nothing and swings in melee like any tierless tool. Without pointer lock the right button is the look drag, so a right click there shoots a full draw at once.

## Block changes and persistence

Edited blocks override generated terrain and persist across reloads:

- Destroyed and placed blocks are stored by world coordinate ("x,y,z" keys) and applied
  after procedural generation whenever a chunk regenerates
- Block entities (furnaces, chests) and facings live in their own maps keyed by
  position; block contents survive only while the saved block diff still says the block
  stands there — at load time the chunks are not made yet, so the override is the only
  witness
- Saves go to `localStorage` under `voxelcraft:world:v7` (`SAVE_SCHEMA` 7): seed, block
  diff, block entities (furnace rows; `entities.chests`, one 57-field row per box, plus
  a trailing slot-to-record map for any slot whose wear or packed contents the id and
  count pairs cannot hold; a packed chest's stack record carries its slots as a fourth
  element),
  player position, hunger/saturation/exhaustion, and the optional `spawn: { x, z }`.
  Autosave runs every 25 s over dirty state; a death-and-respawn marks the save dirty
  so a fed stomach survives a closed tab
- Old saves are not migrated. A save under any older key boots a fresh world and says
  so on screen; the legacy keys are cleared
- Stored hunger counters are pulled back inside their invariants on load (saturation
  clamped to the food it cushions, out-of-range exhaustion reset)

## Co-op

Up to four players share one world, peer to peer, with no server of the game's own:

- **Transport.** Browsers connect directly over WebRTC through Trystero (`trystero` in
  the import map, pinned, from jsDelivr). Trystero finds peers by posting encrypted
  offers on free public Nostr relays, so there is no account and no bill. It is
  imported only when a room is opened, so a single-player session never touches the
  network. A room is a six-character code; the code doubles as the room password,
  so the relays only see ciphertext. Every peer connects to every other peer.
  Roughly one network pair in ten cannot connect without a TURN relay, and a dead
  public relay shows up as a failed WebSocket in the console while a room is open
- **The host owns the world.** Hosting opens the world already loaded; its save is
  the world's save. A host keeps one room code for good (`voxelcraft:coop:hostCode`)
  and, after a reload, opens the room again by itself (`voxelcraft:coop:hosting`).
  The world is only reachable while the host's tab is open and in front: a hidden
  tab stops its frame loop, and with it every mob in the room
- **Joining** is a fresh page at `#join=CODE`. The boot waits for the host's world
  (`serializeSharedWorld`: the block diff, block entities, SP0, the beacon count,
  the clock, the respawn and where the host stands) before it builds any ground, and
  a first visit arrives a step beside the host. A guest never writes `SAVE_KEY`: its
  own body, pack, armour, purse and respawn go under `voxelcraft:coop:<code>` in the
  save's own shape without the world, and come back when it rejoins that room. A
  join that fails boots the guest's own world and says why. New world is refused to
  a guest
- **Blocks.** Every `setBlock` and `setBlocksBatch` made in one browser is sent to the
  others, a frame's worth at a time, and applied there inside `withEditsSilenced` so
  it is never echoed back. Flowing water is not sent: every browser runs the same
  flow from the same blocks
- **Players** send their pose twelve times a second (and once to anyone who joins);
  everyone else draws a blocky body that eases toward it, with a name tag
  (`remote-players.js`). The name is a screen preference, outside any save
- **Mobs** think only on the host. Its mobs chase the nearest living player, each
  spawn pass centres on the next player in turn, and a creeper's blast reaches
  everyone in range. The host sends every mob ten times a second; a guest draws
  them as pictures that never spawn, think or die on their own. A guest's hit or
  arrow on a picture is sent to the host to apply; a bite or blast on a guest is
  sent to that guest, with the shove, to feel. Mobs exist only where the host's
  chunks are loaded, so a guest who wanders far from the host walks an empty world
- **Loot** exists in one browser only: a broken block drops into the breaker's world,
  and a mob a guest killed sends its loot and essence to that guest. Nothing can be
  picked up twice
- **Containers.** Whoever has a chest or furnace open sends its contents whenever they
  change, and everyone else takes them; a container broken under an open screen
  closes it. Every browser near a furnace keeps it smelting
- **The mission and the clock.** A beacon lit anywhere is lit everywhere
  (`acceptRemoteBeacon`), transmission and all, without spending anyone else's
  essence. The host's clock is everyone's, and a night slept through by anyone ends
  for all. Crops grow on the host
- **No pause.** The menu or a screen stops one walker's hands, not the shared world:
  in a room the world keeps running behind them

## Rendering and performance

- Each chunk builds a small number of meshes grouped by pass: opaque, cutout
  (leaves, glass, doors, beds, ladders, torches, crops), and water. Sub-cell shapes —
  stairs, the ladder plate, water surfaces at partial height — get their own `append*`
  on the pass their material belongs to
- Hidden faces between solid blocks are not drawn; only faces exposed to air, water,
  leaves, or transparent blocks are. Water is drawn at the height its level fills and
  blends across shared grid corners
- Chunk meshes rebuild on edits, including neighbours across chunk borders; light
  updates and remeshes are incremental and localized so a torch never hitches a frame
- Chunk loading is incremental: a time budget (8 ms) per frame, a queue prioritized
  closest-first, geometries and materials disposed on unload, frustum culling, fog at
  the render edge. Several hundred loaded chunks stay smooth on typed-array per-chunk
  data
- Target: smooth 60 fps in modern Chrome and Firefox

## Lighting and atmosphere

Minecraft-style per-voxel lighting baked into chunk meshes as vertex colors:

- Sky light: 15 open to the sky, propagating down and spreading into overhangs and cave
  mouths with falloff; deep caves fade to near-black
- Block light: torches emit 14, lit furnaces 13, spreading by flood fill losing one
  level per block; brightness is the max of sky and block light
- The sky contribution scales with the clock, so the surface darkens at night while
  torch light stays constant; crops need light 9 or more
- Water and non-opaque blocks pass light: a column of falling water reads sky 15 top to
  bottom; light comes through the open corner of a stair
- Light updates stay incremental: placing a torch updates the affected area and rebuilds
  only those chunk meshes
- Plus ambient light, directional sunlight, fog matching the sky, a sky gradient, and
  sun and moon discs in the sky

## Day/night cycle

- One full cycle is 20 real minutes, Minecraft's length: about 10 up, 10 down, half a
  minute of dusk and dawn at each end. `DAY_START` is 0.22 (11:16 on the in-game clock)
- Sky, fog and ambient light transition through sunset colours to dark navy; the sun
  and moon cross the sky
- Night triggers hostile spawning; dawn burns exposed hostiles away
- Sleeping in a bed at night skips to `DAY_START` — see Doors and beds

## HUD and UI

- Crosshair; hotbar with icons, counts and selection; heart bar; hunger shanks with a
  jitter animation; ten armour shields (hidden when empty); durability bars; toasts
  for every refusal and confirmation
- Top left, a day dial: a disc, day on its top half and night on its bottom, turned
  so the hour now sits under a notch (noon puts the sun there, midnight the moon,
  dawn and dusk the seam). Hovering it gives the clock. Beside it, the sprint latch
  while it is set, and a frame-rate counter only when Settings → Display turns it on
  (a per-browser preference, kept outside the world save)
- Under those, the threat zone: `Zone` and a pip per beacon. There is SP0's zone,
  which lights none, and one per beacon, whose zone lights as many as its number; each runs halfway to its neighbours, so
  a beacon stands in the middle of its own, and the last runs on past the final
  monument. Distance is enemy difficulty (`difficultyAt`), so depth below sea level
  pushes the walker outward too. Every zone is dangerous at night, so the pips
  don't grade danger; their colour says where the walker's zone stands against the
  last lit beacon's (SP0's before any is lit): green behind it, yellow in it, red
  beyond it.
  Hovering names the zone (SP0 or beacon n) and that standing. It hides behind screens and the death
  screen, like the waypoint arrow
- Top centre, the waypoint arrow: up is straight ahead, and it turns with the walker
  toward the target, with the target's name, the distance in metres and ▲/▼ when it
  stands more than four blocks above or below. Within a couple of blocks it becomes
  a dot. It follows the next beacon by default and moves on by itself when one is
  lit; the menu's Waypoints page picks any lit beacon or saved spot instead, or no
  arrow at all
- The position readout (XYZ, chunk, loaded chunks, mobs, triangles) is a debug tool
  and only shows when the page is opened with `?debug`
- Screens: inventory (27 storage + hotbar + 2×2 grid + armour column), crafting table
  (3×3), furnace (three slots and burn gauge), chest (27 slots above the pack), and a
  debug give shelf
- The main menu is the start form and the pause panel in one card: a rail down the
  left holds Start (Resume once the world has been entered), Journal, Waypoints,
  Co-op, Settings and Controls, and the page for whichever has the highlight fills the
  right. The Co-op page takes a name, hosts this world or joins a room by code, and
  once in a room shows the code, a copy-link button, the players and a status line. Start sits at the top of the rail and never moves; only the page scrolls.
  The Start page is the mission: two lines of what the walker was sent for, then one
  line a beacon (lit, the next one with its price and the essence carried, or not
  found yet; never coordinates), and the save line. Waypoints lists what the HUD
  arrow can follow and saves the spot the walker stands on under a typed label (a
  blank label, as from a pad, is numbered); saved spots show their coordinates and
  can be deleted. They live in their own localStorage key, written for this world's
  seed and SP0, so a save-schema bump never costs them and New world forgets them.
  Settings carries the gamepad status, a look-sensitivity slider, the frame-rate
  toggle, the Master, Sound effects and Music sliders, and New
  world, which asks *Erase this world for good?* inside the card with Keep it
  highlighted, so a pad can answer. Controls lists keyboard and mouse beside the pad,
  with the column for the hand in use lit. Journal mounts the same book the `J`
  screen shows (below)
- Every control in the card is reachable from every hand, through one walker
  (`src/menu-nav.js`). The arrow keys or WASD, the D-pad or left stick, and the mouse
  move one highlight; Enter, Space, A and a click press. Direction comes from where
  things are drawn, so grids, slider columns and the rail need no wiring. Right or A
  steps from the rail into the page, and left off the page's edge, Esc or Backspace
  steps back. Once the world has been entered, B on the pad leaves the menu for the
  world, as Start does: the button that closes every other panel closes this one.
  Before the first start, and while New world is asking, B steps back instead. Q/E or LB/RB turn the journal's pages inside the journal and
  walk the rail's pages elsewhere. Left and right step a highlighted slider; up and
  down leave it. In a text field every key types except up, down and Esc, which
  leave it, and Enter, which saves. The right stick scrolls the page. Hovering a control highlights it,
  so the mouse and the highlight never disagree. A hint line along the bottom is
  written for the hand that last moved
- Start is the only way in: the button, Enter or A on it, or the pad's Start from
  anywhere in the menu. A click on the dark around the card does nothing (it used to
  start the game and was the menu's most common misfire). Every press answers with
  one neutral click at a fixed pitch — not the world's jittered sample — and a
  repeated pick inside a moment is swallowed, so a doubled button event still sounds
  like a single answer. The menu is allowed no other sound: a pick that resumes the
  game is spent, not a jump — held or tapped again at once — until the thumb has been
  off A for a quiet moment
- The journal (`src/journal.js`, `J` in the world, View/Back on the pad, or the
  menu's Journal page) is a book of two pages, Recipes and Transmissions; see The
  journal under The mission
- While the menu has the page, its input belongs to the menu and never reaches the
  world: no walked keys remembered into the resume, no swinging pick behind the
  panel, no hotbar digits, wheel, mute, or screen keys. `menuOpen()` in `input.js`
  is the gate every global listener checks
- Debug keys answer only when the page is opened with `?debug`; without it they are
  ordinary unbound letters. Time stops only behind a screen or the menu: there is no
  key to freeze it any more. `[` and `]` nudge the time of day back and forward
- A `G` debug shelf lists every item — blocks first, then materials, food, tools and
  armour — as a nine-wide grid of icons: left click adds a whole stack, right click
  one, on mouse and pad alike. It is a debug option, not a shop: the shelf never
  empties, and a full pack says *No room in your pack*
- `Shift+G` hands out essence, a hundred at a press: the shelf's key shifted, because
  essence never sits in a slot to be clicked
- `B` walks a debug tour — SP0, then the five monuments in mission order, then home —
  and `Shift+B` walks it back. Each stop stands the walker three blocks out from the
  monument on the side they would have walked up from, facing the machine, and says
  which beacon it is and what it wants. Like the shelf, it answers only while the
  walker is in the world with no screen up
- `M` mutes audio and says so in a toast; the HUD keeps no sound line

## Particles and feedback

- Block destroyed: removed at once, with small colored cubes scattering outward and
  fading, colored to match the block
- Mobs: hit particles and a brief red flash on damage; creeper explosion particles
  (with camera shake and a flash); occasional ember flickers above torches and the
  mouth of a burning furnace

## Audio

Every sound goes through the Web Audio API, as three layers:

- The active CC0 bank in `assets/audio/`: 108 mono 16-bit WAVs (7.7 MB) built by
  `tools/build-cc0-bank.py` from Kenney, OpenGameArt and SpritePilot packs — 28
  footsteps (7 materials × 4 variants), 24 breaks (8 materials × 3), 16 places
  (8 × 2), 11 mob voices, 24 event one-shots, and 5 ambient beds. `CREDITS.md`
  records pack, author and slot mapping; `AUDIO_ASSETS` in `src/audio.js` is the
  manifest. Two slots — the heartbeat and the creeper fuse — are sampled from the
  synthesizer because no CC0 pack matches them
- The synthesized reference bank (116 slots, 9.3 MB) is not committed;
  `tools/generate-audio.mjs` renders it on demand and never touches `assets/audio/`
- The procedural synthesizer, the runtime fallback: `audioSample` returns false when
  the bank is not loaded, a name is missing, the page is on `file://`, or the voice
  pool is full, and the caller plays the old synthesized voice instead. The game is
  never silent on a partial deploy

Five events are always synthesized — pickup, crafting, jump, and the screen
open/close pair — one short dry sine each at a fixed pitch, because a sampled attack
plus random variants plus detune is harshness at thirty repetitions a minute. Every
sampled one-shot plays at `AUDIO_SAMPLE_TRIM` (0.5, −6 dB); the trim skips the
synthesizer, the ambient beds and the music.

| Event | Contour | Length | Gain | Bus |
| --- | --- | --- | --- | --- |
| Jump | 300 → 430 Hz | 0.12 s | 0.05 | sfx |
| Pickup | 540 → 500 Hz | 0.14 s | 0.055 | ui |
| Screen open | 420 → 640 Hz | 0.18 s | 0.065 | ui |
| Screen close | 640 → 420 Hz | 0.18 s | 0.065 | ui |
| Crafting | 680 Hz held | 0.22 s | 0.06 | ui |

The graph is `voice → sfx/ambient/music bus → world gate → low-pass muffler → master
gain → compressor → destination`, with a generated stereo impulse response feeding a
convolver send on one-shots (ambient bypasses it) whose return also passes the gate. The
ui bus goes around the gate, straight to the muffler. The muffler is the underwater
switch: 20 kHz in air, 620 Hz with the head in water. The world gate is the main menu's:
while the start form or pause panel is up, the gate fades the world out (about half a
second) and the audio clock is then suspended, so songs and beds hold their place; the
menu's own clicks still sound, waking the clock briefly behind the closed gate. Closing
the menu wakes the clock and fades the world back in from where it stopped. A tab that
comes back into view with the menu up stays paused. Other screens (inventory, crafting,
chests) only duck the beds and music. `audioSpatial` gives distance-squared gain, a
yaw pan and a duller cutoff with distance; `audioOcclusion` walks the voxel line —
two solid cells occlude. The voice pool is priority-based (footsteps 0, blocks/UI 1,
mobs 2, player hurt 3, explosions 4) and stops the weakest voice rather than dropping
the new sound. Nothing reaches an `AudioParam` unguarded: `audioNumber` puts a finite
fallback in front of every pan, gain, pitch and distance, so a NaN coordinate sounds
centred instead of throwing mid-frame.

Ambient beds mix every 0.5 s from the environment: wind by height/outdoors, water by a
9×9×5 sample around the feet, cave by the lack of open sky and depth, fire by the
nearest torch or burning furnace within 9 blocks, and underwater.

Music is scheduled by the in-game clock, not the environment: each six-hour window —
dawn, noon, dusk, midnight — draws one random song from its folder under
`assets/music/` and plays it once, then silence until the next window. Music rides its
own bus, plays through once (`loop = false`), has no synthesizer behind it, and re-rolls
to avoid repeating last night's song.

A fresh world breaks the schedule once, from the first frame: a held clock keeps it
silent behind the start menu, through the first-spawn scene, and while the arrival
transmission talks. When the transmitter finishes its line — typed out, or closed — the
walker's own song, `assets/music/first-spawn/`, plays through on the music bus, and the
clock's windows take the world back when it ends. The morning bed and the arrival song
can never be up together. A saved world never hears the hold or the song.

The mission breaks it again at the other end. The page notes which block of words went
up, and the block that leaves the mission with no beacon to point at next is the fifth
one; when that transmission is read, `assets/music/mission-complete/` plays through on
the music bus on the same terms as the arrival song, and the clock's windows take the
world back when it ends. Only one mission song is on the bus at a time — the finale
takes the slot off anything still playing — and a world loaded with all five already
lit hears nothing, because the song belongs to the moment, not to the state.

The arrival has nothing on screen but a fade lifting off black, so the teleport is told
by ear alone: three synthesised gestures hung across the fade as shares of it — a
carrier climbing out of the transmitter's range, three detuned pulses of beam held
mid-air, and a carrier falling back down its own way into a held fifth with one bright
tick on top. Each is asked for again the frame after it fails, because the audio clock
only wakes on the click that lifts the menu.

Animal and hostile calls are quiet on purpose: each passive idles 15–35 s with a shared
4–8 s gap at 0.22 gain; hostiles roll 11–24 s with a shared 6–11 s gap; pain is scaled
per species (`MOB_HURT_GAIN`: cow 0.53, chicken 0.6, pig/sheep 0.7, hostiles 1) since
the hurt call is also the death cry; a burning mob's hurt calls are gapped to 2.6 s
even though the burn ticks every 0.65 s.

Settings: three sliders in the menu's Settings page — Master (70%), Sound effects (100%), Music
(70%) — persisted under `voxelcraft:audio:v1`; `M` mutes the master; the context
suspends when the tab hides. For GitHub Pages: relative fetch paths, a committed
`.nojekyll`, never Git LFS (Pages serves the pointer, not the sample), the whole bank
far inside the Pages budget; `file://` runs the game on the synthesizer alone.

## Technical requirements and source tree

The game is `index.html` plus a graph of native ES modules — no build step between the
repository and the page:

    index.html          the document: canvas, overlays, screen furniture, the
                        import map (three, and trystero for co-op), and one import
    styles.css          HUD, screens, overlays
    src/main.js         the composition root (see below)
    src/config.js       every tuning number and the block ids
    src/noise.js        hashing and gradient noise
    src/worldgen.js     terrain, caves, ores, trees, the spawn column
    src/blocks.js       block and item definitions, stacks, durability, armour
    src/atlas.js        the texture atlas
    src/icons.js        item icons and canvases
    src/mesh.js         chunk meshing
    src/lighting.js     the light field
    src/chunks.js       the world: chunks, streaming, meshing, edits
    src/water.js        flow and the flow budget
    src/collision.js    the swept box
    src/player.js       the body: position, look, exhaustion, hunger counters
    src/health.js       health, food and the clocks that mend and starve
    src/inventory.js    the pack, the worn row, the held slot
    src/crafting.js     recipes and the two grids
    src/cursor.js       the stack on the pointer, and crafting with it
    src/containers.js   furnaces and chests as block entities
    src/drops.js        item entities
    src/farming.js      farmland and crops
    src/aim.js          the crosshair's block ray and crack
    src/interaction.js  mining, placing, doors, beds, buckets, hoes, seeds
    src/intro.js        the first-spawn scene: a slow fade from black, the teleport heard
    src/combat.js       the crosshair's mob ray, swings and shearing
    src/mob.js          animals, hostiles, spawning, explosions
    src/fx.js           particles, embers, ambient sound
    src/held.js         the held-item view model
    src/audio.js        the sound bank and its mixer
    src/sky.js          sun, moon, sky colour, the clock
    src/render.js       renderer, camera, scene
    src/hud.js          every element: bars, hotbar, toasts, screens, pad UI
    src/input.js        keyboard, mouse, pointer lock, the pad, the walk
    src/save.js         the record, the restore, autosave
    src/net.js          the co-op wire: rooms, peers, typed messages (Trystero)
    src/coop.js         co-op: what crosses the wire and what it does on landing
    src/remote-players.js  the other players' bodies and name tags
    src/say.js          one way for any layer to tell the player something
    assets/audio/       the active CC0 bank
    assets/music/       the scheduled music, one folder per clock window, plus first-spawn
    tools/              the bank builders, the checks, and the snapshot harness
    CREDITS.md          source and licence record for the active bank

**The one rule: imports point down.** `main.js` imports everything; nothing imports
`main.js`. A module never imports a module that imports it, and no module's state is
touched from outside its subject: the pack is `inventory.js`'s, the crosshair is
`aim.js`'s, the held stack is `cursor.js`'s. When two layers need each other, `main.js`
is where they meet, through seams: a module declares a small contract object whose
verbs default to doing nothing and exports a `set…` for it; `main.js` registers the
real verbs at bootstrap. A layer that only needs to read something small gets a verb
(`mobTarget()`, `cursorCarried()`, `screen()`) rather than an import it might write.
`main.js` is the only file that knows the order things happen in: the world boots, the
seams are handed out, time starts.

Standing invariants:

- Block ids are appended and never renumbered, enforced at runtime
- `cellCollidesAt` is the answer to "does this cell get in the way"; anything sub-block
  routes through it. `ladderHolding` answers "does this cell hold me" and must never
  become a collider
- A container screen registers in one place per concern — the screen list, its block
  guard, its grid, quick-move, the pad sections, the storage column — so a future
  barrel wants the same table, not a third copy
- The bank and the `AUDIO_ASSETS` manifest move together with the build script's
  recipes and `CREDITS.md`

Checks in the repository:

    ./tools/check-syntax.sh    every module parses
    ./tools/check-imports.sh   no module uses a name it does not import
    ./tools/check-audio.sh     the banks and the manifest agree

`tools/snapshot-check.js` compares a live world against `tools/snapshot-baseline.json`,
and a change that moves code between files is expected to keep the game runnable at
every commit and leave that digest alone. The game must run without console errors in
modern Chrome and Firefox.

## Debug surface

`window.__voxelcraft` exposes the whole game to the console and to scripted checks:
`screenshot`-grade hooks for the world (`getBlock`, `setBlocksBatch`, `sampleColumn`),
the player (`stats()`, `teleport`, `look`, `hunger`, `eat`, `armour`, `equip`,
`sprintState`), mining (`breakTime`, `mine`, `give`, `durability`), containers
(`openFurnace`, `furnace`, `chest`, `chestList`, `setChestSlots`), farming (`tillDirt`,
`plantSeed`, `crops`, `soilWet`), water (`waterFlowCheck` — six rigs replayed in a
shadow map, which fails if the settlement rule is broken), mobs (`mobs`, `mobInfo`,
`spawnPassive`, `spawnHostile`, `spawnReport` with caps and refusal tallies), archery
(`loose(seconds)` draws the bow in hand that long and lets go, `arrows()` lists what is
in the air or stuck), time and
simulation (`setTime`, `setTimeScale`, `tick`, `simulate(seconds, input)`), screens and
the shelf (`screen`, `openGive`, `giveList`), the mission tour (`visitBeacon(stop)`,
`beaconTour(direction)`, `tourStop()`), the main menu (`menuState()` — open, page,
the rail-or-page zone, the highlighted control and the hand that moved it; drive it
with `setVirtualPad` or key events), and audio (`audio`, `setVolume`).
`waypoints()` lists what the arrow can follow and where it points now. `coop()`
reports the co-op room: mode, code, this peer and the host, the peers, the avatars
heard, how many mob pictures a guest is drawing, and the status line. The API is
always there, `?debug` or not; the `G` give shelf and the `B` monument tour are the
human-facing halves of the same door, and only those need the flag.
