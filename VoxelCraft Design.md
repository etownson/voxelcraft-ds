# VoxelCraft — Design Document

A fully playable 3D Minecraft-style voxel game in the browser, built with Three.js and
vanilla JavaScript as native ES modules served straight from the repository, with a CC0
audio bank and a procedural synthesizer behind it. The world is an endless, deterministic,
chunk-based voxel map with no edges or borders: terrain streams in around the player and
unloads behind them, in every horizontal direction, forever.

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
- Water fills columns open to the sky below sea level (oceans, lakes, rivers). Caves are
  exempt: cave interiors are always air, and carving never opens the sea into a cave —
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
| 8 | Water | A source; see Water flow |
| 9 | Oak Log | Bark sides, ring top/bottom |
| 10 | Oak Planks | Horizontal boards |
| 11 | Oak Leaves | Slightly transparent cutout; drops apples, never itself |
| 12 | Snow Block | High-elevation surface |
| 13 | Crafting Table | Right-click opens the 3×3 grid |
| 14 | Torch | Thin geometry on a top face, light 14, no collision |
| 15 | Bedrock | Indestructible |
| 16 | Diamond Ore | Drops Diamond; needs an iron pickaxe or better |
| 17 / 18 | Furnace / lit Furnace | A burning furnace is a second id and emits light 13 |
| 19 | Glass | Smelted sand; no tool speeds it, as in Minecraft |
| 20 | Farmland | Made by hoeing grass or dirt |
| 21–28 | Wheat, stages 0–7 | Crop growth lives in the block id, so fields survive chunk unloads |
| 29–32 | Wooden Door (lower/upper, closed/open pair) | One item across two cells; the open ids are non-solid |
| 33 / 34 | Red Bed (foot/head) | One item across two cells |
| 35–48 | Water flow/fall levels 1–7 each | Resting sheets and falling water; see Water flow |
| 49 | Chest | Contents live in a block entity |
| 50 / 51 | Oak Stairs / Cobblestone Stairs | The only sub-block collider in the game |
| 52 | Ladder | Solid: false; the first block a player stands inside of |

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
  latch. The debug stack shows a `Sprint on` line while it is set
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
  Start/Menu opens and closes the inventory. Menu grids are walked with the D-pad or
  stick: A picks up and places whole stacks, X takes half a stack and places one item,
  Y/Triangle quick-moves, back/Select closes

Health:

- 10 hearts (20 health points), drawn as a heart bar above the hotbar
- Damage from hostile mobs, creepers, starvation, and falls greater than 3 blocks
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
  the rules listed under Player and controls

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

## Water flow

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

Generation stays dry from the other side too: caves are never carved open under water
(`cutOpensSea`), so the player's first visit never drains the sea underground.

The renderer follows the levels: each cell draws its surface at `(8 − rank)/8` of the
cell, shared grid corners average the water cells that meet there so neighbouring
levels slope into each other, and only the top of a body of water draws a surface —
resting water presses the cell below up to its ceiling and seals it. A pouring stream
neither presses the pool it lands in nor loses the pool's own surface, and is drawn
down to the surface it actually lands on. Flow edits skip lighting: air and water are
both transparent, so neither can be what changed the light.

Cosmetics — fresnel, foam, animated UVs, caustics, an underwater tint beyond the audio
muffle — are deliberately unmade until the surfaces stop moving.

### Buckets

Smelt the iron, fold three ingots into a V (`I.I` / `.I.`), dip the empty bucket in a
source, carry it, pour it elsewhere. Two item ids — `bucket` (stacks to 16) and
`water_bucket` (never stacks) — rather than a flag, because the save, drops, and the
merge rule all read the id.

- A bucket drinks only from a full source. A ripple that has run out from its shore
  stays where it is
- A source with water beside it is a body's mouth, not a bucketful: it keeps its cell
  and refills the next bucket, leaving the body's ranks untouched. Only a source with
  no water in its six neighbours at all is a whole body — a lone puddle or sealed well —
  and that one cell lifts whole
- Pouring puts a source in the aimed cell if it is air or already water; the flow code
  wakes on its own. There is no test for whether that cell is the one you stand in —
  pour under your feet and the water arrives around your ankles
- Water is still `breakable: false`: the bucket is the only way to move water, and
  right click is the only way to fill one. The bucket is dispatched inside placement,
  after the hoe and the seeds, so an interactive block keeps first refusal: a crafting
  table behind a puddle opens rather than flooding. The bucket finds water with its own
  walk of the ray (`raycastWater`), stopping at the first solid
- No lava bucket (no lava), no water bottle (nothing to fill), and nothing in the world
  hands out a free bucket

## Containers

Right-click opens containers ahead of any block placement, and each screen keeps the
armour column and the 2×2 grid alongside the player's own rows.

**Chest** (id 49): eight boards ringed around an empty middle at the table, placed with
the latch toward whoever placed it, 27 slots that wait for the player to come back.
Hardness 2.5 with an axe and no tier, so a bare hand takes it apart in 3.75 s and still
gets the box back. It is structurally a furnace: one id, its facing in the facings map,
contents in a block entity. Breaking it spills its contents as real item drops and then
the box — the explosion path owes the same roll as a pickaxe. A chest never ticks
beyond a stale-state sweep that clears a box whose block is gone; opening a chest
pauses the world the way the inventory does. Contents do not ride on the dropped box;
there are no loot chests, because there are still no structures.

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
  rainforest as chunks load. They are deliberately scarce: fewer than half of grassy
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
  conditions
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
drops one wool on top of its meat, a shorn one meat only; chickens drop feathers.
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

## Block changes and persistence

Edited blocks override generated terrain and persist across reloads:

- Destroyed and placed blocks are stored by world coordinate ("x,y,z" keys) and applied
  after procedural generation whenever a chunk regenerates
- Block entities (furnaces, chests) and facings live in their own maps keyed by
  position; block contents survive only while the saved block diff still says the block
  stands there — at load time the chunks are not made yet, so the override is the only
  witness
- Saves go to `localStorage` under `voxelcraft:world:v4` (`SAVE_SCHEMA` 4): seed, block
  diff, block entities (furnace rows; `entities.chests`, one 57-field row per box),
  player position, hunger/saturation/exhaustion, and the optional `spawn: { x, z }`.
  Autosave runs every 25 s over dirty state; a death-and-respawn marks the save dirty
  so a fed stomach survives a closed tab
- Old saves are not migrated. A save under any older key boots a fresh world and says
  so on screen; the legacy keys are cleared
- Stored hunger counters are pulled back inside their invariants on load (saturation
  clamped to the food it cushions, out-of-range exhaustion reset)

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
  jitter animation; ten armour shields (hidden when empty); durability bars; FPS
  counter and current chunk coordinates for debugging; toasts for every refusal and
  confirmation
- Screens: inventory (27 storage + hotbar + 2×2 grid + armour column), crafting table
  (3×3), furnace (three slots and burn gauge), chest (27 slots above the pack), and a
  debug give shelf
- A brief instructions overlay on first load — click to lock, WASD, mouse, Space,
  Shift/Ctrl sprint, left break/attack, right place/use, 1–9 and wheel for the hotbar,
  E for inventory — dismissed by the click that locks the pointer
- A pause panel carries the volume sliders (Master / Sound effects / Music) and the
  control list; it is click-to-resume
- A `G` debug shelf lists every item — blocks first, then materials, food, tools and
  armour — as a nine-wide grid of icons: left click adds a whole stack, right click
  one, on mouse and pad alike. It is a debug option, not a shop: the shelf never
  empties, and a full pack says *No room in your pack*
- `M` mutes audio; the debug stack reads sprint state and sound state

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

The graph is `voice → sfx/ambient/ui/music bus → low-pass muffler → master gain →
compressor → destination`, with a generated stereo impulse response feeding a convolver
send on one-shots (ambient bypasses it). The muffler is the underwater switch: 20 kHz
in air, 620 Hz with the head in water. `audioSpatial` gives distance-squared gain, a
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

Animal and hostile calls are quiet on purpose: each passive idles 15–35 s with a shared
4–8 s gap at 0.22 gain; hostiles roll 11–24 s with a shared 6–11 s gap; pain is scaled
per species (`MOB_HURT_GAIN`: cow 0.53, chicken 0.6, pig/sheep 0.7, hostiles 1) since
the hurt call is also the death cry; a burning mob's hurt calls are gapped to 2.6 s
even though the burn ticks every 0.65 s.

Settings: three sliders in the pause panel — Master (70%), Sound effects (100%), Music
(70%) — persisted under `voxelcraft:audio:v1`; `M` mutes the master; the context
suspends when the tab hides. For GitHub Pages: relative fetch paths, a committed
`.nojekyll`, never Git LFS (Pages serves the pointer, not the sample), the whole bank
far inside the Pages budget; `file://` runs the game on the synthesizer alone.

## Technical requirements and source tree

The game is `index.html` plus a graph of native ES modules — no build step between the
repository and the page:

    index.html          the document: canvas, overlays, screen furniture, the
                        three import map, and one import
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
    src/say.js          one way for any layer to tell the player something
    assets/audio/       the active CC0 bank
    assets/music/       the scheduled music, one folder per clock window
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
`spawnPassive`, `spawnHostile`, `spawnReport` with caps and refusal tallies), time and
simulation (`setTime`, `setTimeScale`, `tick`, `simulate(seconds, input)`), screens and
the shelf (`screen`, `openGive`, `giveList`), and audio (`audio`, `setVolume`).
The `G` give shelf is the human-facing half of the same door.
