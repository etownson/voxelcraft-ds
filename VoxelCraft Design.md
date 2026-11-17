# VoxelCraft — Design Document

Build a fully playable 3D Minecraft-style voxel game in the browser using Three.js and
vanilla JavaScript in a single self-contained HTML file. The game should feel like a
simplified but functional Minecraft experience with an endless procedurally generated
world. Do not create a fixed world with edges or borders. Instead, use deterministic
chunk-based procedural generation so the terrain continues generating as the player moves
in any horizontal direction.

## Core goal

Create an infinite-style Minecraft-like voxel sandbox that runs in a modern browser using:

- One HTML file only
- Three.js loaded from a CDN
- Vanilla JavaScript
- No build tools
- No npm
- No external assets
- Procedural textures, colors, geometry, and sounds only

The world should have no visible edges. Terrain should stream in around the player and
unload when far away.

## World generation

Use procedural noise, such as Perlin, Simplex, or value noise, to generate terrain
deterministically from a world seed. The world must be divided into chunks:

- Chunk size: 16×16 blocks horizontally
- World height: 96 blocks, with sea level around y=48 so roughly half of the world's volume is underground
- Typical surface terrain should have at least 40 blocks of minable stone beneath it before reaching bedrock
- Chunks must support positive and negative world coordinates
- Generate chunks dynamically based on the player's current chunk position
- Render chunks within a configurable render distance, defaulting to 8–10 chunks (128–160 blocks), with fog positioned near the far edge to hide pop-in
- Unload or hide chunks that move outside the render distance
- Use the same seed so returning to a previous area regenerates the same terrain

Terrain should include:

- Varied, dramatic terrain: gentle plains, rolling hills, steep cliffs, and tall mountain ranges — terrain amplitude should depend on the biome, so plains stay walkable while mountain regions rise steeply well above the treeline
- At least these biomes: plains, forest, rainforest/jungle, desert, beach, ocean, rocky highlands, and snowy mountains
- Biomes determined by combining temperature and humidity noise with elevation: hot + dry = desert, hot + humid = rainforest, cold or high = snow, temperate = plains/forest
- Biome transitions must blend smoothly — no sudden walls or seams in terrain height at biome borders
- Water filling open, sky-exposed areas below a fixed sea level (caves are exempt — see the cave rules below)
- Beaches near sea level
- Snow on high-elevation terrain
- Tree style varies by biome: scattered oaks in plains, dense trees in forest, very dense and taller jungle trees with big canopies in rainforest, none in desert
- Rivers: winding water channels carved where the absolute value of a dedicated low-frequency noise field is below a small threshold; rivers cut down to just below sea level, fill with water, line their beds with sand, and visually connect lakes and oceans
- A connected Minecraft-style cave system carved with 3D noise:
  - Long winding "spaghetti" tunnels, carved where the absolute value of a low-frequency 3D noise field is below a small threshold; use two independent noise fields at different scales so tunnels branch and intersect into networks
  - Occasional larger caverns and rooms from a separate blobby 3D noise pass that intersects the tunnels
  - Cave density should increase with depth, and tunnels should occasionally break through the surface as natural, walkable cave entrances
  - Cave interiors always generate as air, even when below sea level — never flood caves with water; only columns open to the sky (oceans, lakes, rivers) fill with water up to sea level
- Ore veins embedded in stone, placed deterministically from the world seed:
  - Coal ore: common, in veins of 3–8 blocks, found at most underground depths
  - Iron ore: less common, in veins of 2–6 blocks, more frequent the deeper you go
  - Ores only replace stone blocks, and are often exposed on cave walls so caving is rewarded
- Bedrock at the bottom of the world with a ragged multi-layer floor

The player should spawn at the center of the world on top of the generated terrain.

**Important: do not generate a fixed-size world.** There should be no walls, cliffs, hard
stops, invisible barriers, or obvious map boundaries. The world must continue generating
indefinitely in every horizontal direction as the player walks. Chunk generation must be a
pure function of (worldSeed, chunkX, chunkZ) so any chunk at any coordinate — including
large negative coordinates thousands of blocks from spawn — can be generated on demand.
Never pre-generate a bounded grid of chunks at startup and treat it as the world. To
verify: the player should be able to walk 1,000+ blocks in any direction and continue
seeing new terrain with no boundary.

## Block types

Include at least these block types:

- Grass
  - Green speckled top face
  - Brown dirt-like side faces with a green grass fringe along the top edge
  - Used on surface terrain in grassy biomes (plains, forest, rainforest)
- Dirt
  - Brown on all faces
  - Found under grass and surface layers
- Stone
  - Grey
  - Found deeper underground and in mountains
- Cobblestone
  - Grey with a rounded-stone mosaic pattern
  - Dropped when stone is mined
  - Used in crafting recipes
- Coal Ore
  - Stone texture with clusters of black angular chunks
  - Drops 1–2 Coal items when mined (coal is a material item, not placeable)
  - Mines significantly faster with a pickaxe
- Iron Ore
  - Stone texture with rust/tan colored flecks
  - Drops Iron directly when mined — no furnace or smelting system, for simplicity
  - Should be mined with a stone pickaxe or better; bare hands or wooden tools are very slow
- Sand
  - Tan/yellow
  - Used in deserts, on beaches near water, and lining river beds
- Water
  - Semi-transparent blue
  - No collision
  - Fills below sea level
- Wood (Log)
  - Brown bark texture on side faces
  - Ring pattern on top and bottom faces
  - Used for tree trunks
- Planks
  - Lighter brown with horizontal board lines
  - Crafted from wood logs
- Leaves
  - Green
  - Slightly transparent with small gaps in the texture
  - Used for tree canopies
- Snow
  - White
  - Appears on high-elevation blocks
- Crafting Table
  - Plank-like sides with a tool-grid pattern on top
  - Placeable; right-clicking it opens the 3×3 crafting grid
- Torch
  - Small brown stick with a glowing yellow/orange tip, rendered as thin geometry attached to the top of a solid block
  - Placeable on top faces of solid blocks; no collision; breaks instantly and drops itself
  - Emits block light (see the voxel lighting rules under Lighting and Atmosphere)
- Bedrock
  - Dark grey
  - Indestructible
  - Fills the bottom layer completely, with a ragged transition: layers y=1 through y=3 are a decreasing random mix of bedrock and stone, like Minecraft's bedrock floor

## Textures and materials

All textures must be procedurally generated at runtime. External image files are not
allowed. Generate Minecraft-style pixel textures:

- Create each block texture as a 16×16 pixel canvas, drawn pixel-by-pixel with code
- Combine all block textures into a single texture atlas canvas and map UVs per face
- Use NearestFilter (no texture smoothing/mipmap blur) so textures look crisp and pixelated like Minecraft
- Add per-pixel random noise/speckle variation within each texture using a seeded random so textures are consistent between runs
- Give each block type a distinct hand-drawn-looking pattern:
  - Grass top: green base with lighter and darker green speckles
  - Grass side: dirt texture with an irregular green fringe across the top 3–4 pixel rows
  - Dirt: brown base with darker brown clumps and occasional small stones
  - Stone: grey base with darker grey cracks and mottling
  - Cobblestone: mosaic of rounded grey stones with dark mortar lines
  - Coal ore: stone base with irregular black angular blobs
  - Iron ore: stone base with rust-tan flecks outlined in darker brown
  - Sand: pale yellow with subtle grain speckle
  - Wood log side: vertical bark striations in two brown tones
  - Wood log top: concentric ring pattern
  - Planks: horizontal boards separated by darker seam lines, with subtle grain
  - Leaves: layered greens with a few fully transparent pixels for depth
  - Snow: white with faint blue-grey speckle
  - Water: semi-transparent blue with lighter ripple pixels
  - Torch: thin brown handle with a bright yellow-white tip
  - Bedrock: dark grey with near-black jagged patches
- Support different textures per face (top, bottom, sides) where appropriate
- Basic material roughness and transparency settings

## Player and controls

Implement a first-person player controller:

- Pointer lock on click
- Mouse look
- WASD movement relative to camera direction
- Spacebar to jump
- Gravity
- Ground detection
- Shift or Ctrl to sprint at 1.5× speed
- Collision detection against solid blocks
- Player cannot walk through solid blocks
- Player can pass through water, but movement may optionally slow down in water
- Gamepad support using standard Web Gamepad API (left stick to move, right stick to look with configurable sensitivity, A/Cross to jump, right trigger to mine/attack, left trigger to place block/interact, shoulder buttons to scroll hotbar, Start/Menu to open/close inventory)
- Advanced Gamepad UI controls: navigate crafting/inventory grid with D-pad or left stick, press A to pick up whole stacks, A to place whole stacks, X/Square to pick up half of a stack, X to place one item of a stack, Y/Triangle to quick-move stacks to hotbar/crafting grid, and back/Select to close menus

The player should have a collision box, roughly:

- Width: 0.6 blocks
- Height: 1.8 blocks

Collision detection must work across chunk boundaries. The player has health:

- 10 hearts (20 health points) shown as a heart bar above the hotbar
- Damage from hostile mobs and fall damage from falls greater than 3 blocks
- Health slowly regenerates over time
- On death, show a respawn screen and respawn the player at the spawn point with full health; inventory may be kept for simplicity

## Block interaction

Implement Minecraft-style block interaction:

- Crosshair in the center of the screen
- Raycast from the camera to detect the targeted block
- Show a subtle wireframe outline around the targeted block
- Left click (hold) mines the targeted block with a short mining delay based on block hardness and the tool held
- While mining, show visible progress on the targeted block — cracking stages or a filling progress indicator — so the player can see that mining is working and that the correct tool is clearly faster
- Broken blocks drop as small floating, spinning item cubes that are pulled toward and collected by the player when nearby, adding to the inventory
- Right click places the currently selected block from the hotbar, consuming one from its stack
- Right click on a crafting table opens the 3×3 crafting UI instead of placing a block
- Do not allow placing a block inside the player's collision box
- Bedrock cannot be destroyed
- Water should not block raycasts unless intentionally targeted

## Held item view

Render the currently selected hotbar item in first person so the player can always see what
they are holding:

- A view-model anchored to the bottom-right of the camera, like Minecraft's held item
- Blocks render as a small 3D cube using their actual atlas textures
- Tools, torches, and material items render using their pixel-art icon (a flat or slightly extruded quad is fine)
- Play a short swing animation on left click and while mining or attacking
- Add a subtle bob while walking and a small sway when turning the camera
- Switching hotbar slots visibly swaps the held item
- An empty hand shows nothing (or a simple blocky arm)

## Inventory system

Implement a full Minecraft-style inventory:

- 36 slots total: 9 hotbar slots plus 27 storage slots
- Press E to open and close the inventory screen (releases pointer lock while open, pauses mouse look)
- Items stack up to 64 per slot, with the count rendered in the corner of each slot
- Click a stack to pick it up, click another slot to place it; right click to place a single item from a held stack
- Number keys 1–9 select the corresponding hotbar slot
- Mouse wheel scrolls through hotbar slots
- The hotbar is always visible at the bottom of the screen with the selected slot highlighted and the selected item's name shown briefly when switching
- Mined blocks and mob drops go into the inventory automatically, stacking with existing items first, then filling empty slots
- If the inventory is full, drops remain in the world as item entities
- Placing blocks decrements the stack; empty stacks clear the slot
- The player starts with an empty inventory and gathers everything by mining

## Crafting system

Implement a crafting system with two tiers:

- A 2×2 crafting grid built into the inventory screen
- A 3×3 crafting grid opened by right-clicking a placed crafting table
- A result slot that previews the output of the current grid arrangement; clicking it consumes ingredients and gives the result
- Shape-aware recipe matching (recipes match their pattern anywhere within the grid)

Include at least these recipes:

- 1 Wood Log → 4 Planks (2×2)
- 2 Planks stacked vertically → 4 Sticks (2×2)
- 4 Planks in a square → 1 Crafting Table (2×2)
- 1 Coal on top of 1 Stick → 4 Torches (2×2)
- 3 Planks across the top + 2 Sticks down the middle → Wooden Pickaxe (3×3)
- 3 Cobblestone across the top + 2 Sticks down the middle → Stone Pickaxe (3×3)
- 3 Iron across the top + 2 Sticks down the middle → Iron Pickaxe (3×3)
- 2 Planks stacked + 1 Stick below → Wooden Sword (3×3, single column)
- 2 Cobblestone stacked + 1 Stick below → Stone Sword (3×3, single column)
- 2 Iron stacked + 1 Stick below → Iron Sword (3×3, single column)
- 1 Plank + 1 Stick below it, with 2 more planks forming an L → Wooden Axe (3×3)
- 1 Plank on top + 2 Sticks below → Wooden Shovel (3×3, single column)

Tools affect gameplay:

- Pickaxes mine stone, cobblestone, and ores significantly faster; each tier (wood → stone → iron) is faster than the last
- Iron ore should effectively require a stone pickaxe or better
- Axes speed up mining wood and planks
- Shovels speed up mining dirt, sand, grass, and snow
- Swords deal extra damage to mobs; iron sword is the strongest
- Coal and Iron are material items used only in crafting; they cannot be placed in the world
- Tools are items, not blocks: render a simple procedural pixel-art icon for each in the inventory/hotbar, and they cannot be placed in the world
- Tool durability is optional; if included, show a small durability bar on the item

## Animals and mobs

Add simple mobs built from procedurally generated box geometry (Minecraft-style blocky
bodies with a head, body, and four legs), textured with the same 16×16 procedural pixel
approach. Passive animals:

- Cows, pigs, sheep, and chickens
- Spawn on grass surface blocks in plains, forest, and rainforest biomes as chunks load, with a per-chunk spawn cap
- Wander idly: pick a random nearby point, walk to it, pause, repeat
- Simple leg-swing walking animation and head bobbing
- Affected by gravity and block collision; can hop up one block
- Flee briefly when hit
- Have health; when killed, play a small particle burst and drop items into the world (e.g., raw meat or feathers as simple stackable items)

Hostile mobs:

- Zombies spawn on solid ground at night or in dark caves, within a radius band around the player, with a global cap; with the voxel lighting system, "dark" means the light level at the spawn spot is below a threshold, so unlit caves can spawn zombies even during the day, and torch-lit areas are safe
- Creepers spawn rarely under the same conditions
- Zombies path toward the player when within detection range (simple direct-walk steering with one-block step-up is acceptable; full pathfinding not required), and deal contact damage on touch with a cooldown
- Creepers approach the player, then hiss, flash, and explode after a short fuse, damaging the player and destroying nearby non-bedrock blocks (destroyed blocks drop as items)
- Hostile mobs take damage from player attacks (left click while looking at a mob within reach), with knockback
- Hostile mobs burn/despawn at dawn (mobs sheltered underground in darkness are exempt)
- Mobs must not spawn inside blocks or in water, and despawn when the player is very far away

Mob management:

- Mobs are entities separate from the voxel grid, updated each frame
- Cap total live mobs for performance
- Mobs persist while their area is loaded and are removed when their chunk unloads

## Block changes and persistence

Because the world is procedurally generated, edited blocks must override generated terrain.
Implement an in-memory block override system:

- Store destroyed blocks by world coordinate
- Store placed blocks by world coordinate
- When a chunk is regenerated, apply stored overrides after procedural generation
- Use a key format like "x,y,z" for modified blocks
- This does not need to persist after page refresh, but the code should be structured so localStorage or IndexedDB could be added later

## Rendering and performance

Use chunk-based rendering for performance. Requirements:

- Each chunk should generate a single optimized mesh or a small number of meshes grouped by material type
- Do not render hidden faces between solid blocks
- Only render faces exposed to air, water, leaves, or transparent blocks
- Rebuild chunk meshes when blocks are added or removed
- Rebuild neighboring chunk meshes when editing blocks on a chunk border
- Use render distance to limit active chunks
- Add fog to hide chunk pop-in
- Use frustum culling where possible
- Target smooth performance in modern Chrome and Firefox
- The larger default render distance (8–10 chunks) means several hundred loaded chunks; keep per-chunk data in typed arrays, keep meshing efficient, and spread work across frames so performance stays smooth

Chunk loading should be incremental:

- Do not freeze the browser by generating too many chunks in one frame
- Queue chunk generation and process a few chunks per frame
- Prioritize chunks closest to the player
- Remove or dispose of geometries and materials when chunks are unloaded

## Lighting and atmosphere

Add:

- Ambient light
- Directional sunlight
- Fog matching the sky color
- A sky gradient background using CSS, a shader, or scene background updates
- Simple sun and moon objects in the sky
- Minecraft-style per-voxel lighting baked into chunk meshes:
  - Sky light: blocks open to the sky are fully lit; sky light propagates downward and spreads sideways into overhangs and cave mouths with falloff, so tunnels and deep caves fade to near-black without a light source
  - Block light: torches emit light at a high level (e.g., 14) that spreads outward via flood fill, losing one level per block
  - Each block's brightness is the maximum of its sky light and block light; bake this into the chunk mesh as vertex colors or per-face shading during mesh generation
  - The sky light contribution scales with time of day, so the surface darkens at night while torch light stays constant; caves are dark even at noon
  - Recompute lighting for affected areas and rebuild those chunk meshes when blocks are placed or broken and when torches are added or removed
  - Keep light updates incremental and localized so placing a torch does not cause frame hitches

## Day/night cycle

Implement a slow day/night cycle:

- Sky color transitions from daytime blue to sunset colors to dark navy/black
- Directional light rotates to simulate the sun
- Ambient light dims at night
- A visible sun moves across the sky
- A visible moon appears at night
- Fog color should shift subtly with the sky
- Night triggers hostile mob spawning; dawn burns hostile mobs away

## HUD and UI

Include:

- Crosshair
- Hotbar (9 slots) with item icons, stack counts, and the selected slot highlighted
- Health bar (hearts) above the hotbar
- Inventory screen (E) with the 27 storage slots, 9 hotbar slots, and the 2×2 crafting grid plus result slot
- Crafting table screen with the 3×3 grid plus result slot
- FPS counter in the top left
- Current chunk coordinate display, useful for debugging
- Brief instructions overlay on first load
- Overlay dismisses when the player clicks and pointer lock starts

Instructions overlay should explain:

- Click to lock mouse
- WASD to move
- Mouse to look
- Space to jump
- Shift or Ctrl to sprint
- Left click to break blocks / attack mobs
- Right click to place blocks / use crafting table
- Number keys 1–9 or mouse wheel to select hotbar slot
- E to open inventory and crafting

## Particles and feedback

When a block is destroyed:

- Remove it immediately
- Spawn a brief particle effect using small colored cubes or sprites
- Particles should scatter outward and fade quickly
- Particle colors should match the destroyed block type

Also add:

- Hit particles and a brief red flash when a mob takes damage
- Explosion particles for creepers
- Occasional small ember/flicker particles above placed torches

## Optional audio

Use the Web Audio API to generate simple procedural sound effects:

- Block break crunch/pop sound
- Block place sound
- Subtle footsteps while walking on solid ground
- Mob sounds: zombie groan, creeper hiss, animal noises (simple synthesized tones are fine)
- Player hurt sound
- No external audio files

## Technical requirements

Everything must be contained in one HTML file:

- HTML
- CSS
- JavaScript
- Procedural noise implementation
- Game logic
- Rendering logic
- UI

Use Three.js from a CDN. The code should be organized into clear sections:

- Constants and configuration
- Block and item definitions
- Procedural texture atlas generation
- Noise functions
- Chunk class or chunk management
- World generation
- Voxel lighting (sky light and torch light)
- Mesh generation
- Player controls and health
- Collision detection
- Raycasting and block editing
- Held item view model
- Inventory and crafting systems
- Mob entities and AI
- HUD and UI
- Day/night cycle
- Main animation loop

The game must run without errors in modern Chrome and Firefox.

## Implementation priorities

Prioritize the following in order:

1. Infinite chunk-based procedural terrain with no world edges
2. Smooth first-person movement and collision
3. Block breaking and placing across chunks with item drops
4. Hidden face culling for performance
5. Minecraft-style procedural pixel texture atlas
6. Inventory system with hotbar, stacking, and the inventory screen
7. Crafting system (2×2 and 3×3) with tools
8. Biomes, trees, rivers, water, cave systems, ore veins, and snow
9. Voxel lighting: underground darkness and torch light
10. Held-item view model and mining progress feedback
11. Passive animals, then hostile mobs and player health
12. Day/night cycle and atmospheric effects
13. Particles and audio polish

Build the entire game in one continuous pass. Do not stop to ask questions or wait for
confirmation between sections — deliver the complete, working single-file game.

---

## Milestone 11 addendum — tools, furnaces and farming

Recorded after the fact. The brief above describes the first pass of the game. Milestone 10
added world persistence; milestone 11 adds the survival layer the brief never had: a tech
tree that has to be climbed in order, gear that wears out, and a stomach that empties while
you work. Everything below lives in the same single HTML file, with the same procedural
textures, icons and sounds, and no new files or build step.

### The progression chain

- A bare hand and wooden tools gather dirt, grass, wood, coal and stone, but stone is slow by hand and iron ore yields nothing at all to a wooden pickaxe.
- Eight cobblestone plus some coal makes a furnace, and the furnace turns raw iron into ingots. The furnace is now mandatory rather than convenient.
- Diamond ore only drops for an iron pickaxe or better, and sits in veins between y=4 and y=26, so the diamond tier comes after the furnace rather than around it.
- A hoe turns grass or dirt into farmland, seeds sown on it grow into wheat, and three wheat make a loaf at the crafting table.

### Mining speed and tool wear

Break time is `hardness * 1.5 / speed` with the right tool at the right tier, and
`hardness * 5 / speed` with anything else, with a floor of 0.05 seconds. A block whose tier
outranks the tool in hand still breaks, but drops nothing — which is how diamond ore refuses
a stone pickaxe. Durability is only spent by swings that break something and blows that
land; a broken tool vanishes with a toast.

Tool tiers, from `TOOL_TIERS`:

| Tool | Mining speed | Tier | Durability (uses) |
| --- | --- | --- | --- |
| hand, or the wrong kind of tool | 1 | — | — |
| Wood | 2 | 1 | 60 |
| Stone | 4 | 2 | 132 |
| Iron | 6 | 3 | 251 |
| Diamond | 8 | 4 | 1561 |

Hardnesses and tier gates are Minecraft's own:

| Block | Hardness | Correct tool | Minimum tool tier | Drops |
| --- | --- | --- | --- | --- |
| Dirt | 0.5 | shovel | — | Dirt |
| Grass Block | 0.6 | shovel | — | Dirt, plus 1–2 seeds at 25% |
| Sand | 0.5 | shovel | — | Sand |
| Snow Block | 0.2 | shovel | — | Snow |
| Farmland | 0.6 | shovel | — | Dirt |
| Oak Leaves | 0.2 | — | — | nothing |
| Torch | 0 | — | — | Torch |
| Oak Log | 2.0 | axe | — | Oak Log |
| Oak Planks | 2.0 | axe | — | Oak Planks |
| Crafting Table | 2.5 | axe | — | Crafting Table |
| Stone | 1.5 | pickaxe | 1 (wood) | Cobblestone |
| Cobblestone | 2.0 | pickaxe | 1 (wood) | Cobblestone |
| Coal Ore | 3.0 | pickaxe | 1 (wood) | 1–2 Coal |
| Iron Ore | 3.0 | pickaxe | 2 (stone) | Raw Iron |
| Diamond Ore | 3.0 | pickaxe | 3 (iron) | Diamond |
| Glass | 0.3 | pickaxe | — | Glass |
| Furnace | 3.5 | pickaxe | 1 (wood) | Furnace |
| Bedrock | ∞ | — | — | never breaks |

Resulting break times, in seconds. Each tool column assumes that tier's correct kind of
tool for the row; ✗ means the block breaks but drops nothing, and those entries carry the
five-times penalty. Bedrock is unbreakable, and the 0.05 second floor is what holds snow at
0.05 in the diamond column and pins the whole torch row to 0.05.

| Block (hardness) | hand | wood | stone | iron | diamond |
| --- | --- | --- | --- | --- | --- |
| Dirt (0.5) | 0.75 | 0.375 | 0.1875 | 0.125 | 0.09375 |
| Grass Block (0.6) | 0.9 | 0.45 | 0.225 | 0.15 | 0.1125 |
| Sand (0.5) | 0.75 | 0.375 | 0.1875 | 0.125 | 0.09375 |
| Snow Block (0.2) | 0.3 | 0.15 | 0.075 | 0.05 | 0.05 |
| Farmland (0.6) | 0.9 | 0.45 | 0.225 | 0.15 | 0.1125 |
| Oak Leaves (0.2) | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 |
| Torch (0) | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 |
| Oak Log (2.0) | 3 | 1.5 | 0.75 | 0.5 | 0.375 |
| Oak Planks (2.0) | 3 | 1.5 | 0.75 | 0.5 | 0.375 |
| Crafting Table (2.5) | 3.75 | 1.875 | 0.9375 | 0.625 | 0.46875 |
| Stone (1.5) | 7.5 ✗ | 1.125 | 0.5625 | 0.375 | 0.28125 |
| Cobblestone (2.0) | 10 ✗ | 1.5 | 0.75 | 0.5 | 0.375 |
| Coal Ore (3.0) | 15 ✗ | 2.25 | 1.125 | 0.75 | 0.5625 |
| Iron Ore (3.0) | 15 ✗ | 7.5 ✗ | 1.125 | 0.75 | 0.5625 |
| Diamond Ore (3.0) | 15 ✗ | 7.5 ✗ | 3.75 ✗ | 0.75 | 0.5625 |
| Glass (0.3) | 0.45 | 0.225 | 0.1125 | 0.075 | 0.05625 |
| Furnace (3.5) | 17.5 ✗ | 2.625 | 1.3125 | 0.875 | 0.65625 |

### Furnaces and smelting

Every item takes ten seconds. A burning furnace is a second block id and gives off light
level 13, which is what makes a mine shaft readable. Contents and the direction a furnace
faces live in a block entity keyed by position; only furnaces within 32 blocks of the
player, plus the one on screen, tick.

| Input | Output | Seconds |
| --- | --- | --- |
| Raw Iron | Iron Ingot | 10 |
| Raw Beef | Steak | 10 |
| Sand | Glass | 10 |
| Cobblestone | Stone | 10 |
| Oak Log | Charcoal | 10 |

Fuel buys heat, and heat carries over between items, so a stick only covers half of one:

| Fuel | Seconds of heat | Items per unit |
| --- | --- | --- |
| Coal | 80 | 8 |
| Charcoal | 80 | 8 |
| Oak Planks | 15 | 1.5 |
| Oak Log | 15 | 1.5 |
| Crafting Table | 15 | 1.5 |
| Stick | 5 | 0.5 |

### Armour

Leather, iron and diamond sets, one piece per slot.

| Material | Helmet | Chestplate | Leggings | Boots |
| --- | --- | --- | --- | --- |
| Leather — defence | 1 | 3 | 2 | 1 |
| Iron — defence | 2 | 6 | 5 | 2 |
| Diamond — defence | 3 | 8 | 6 | 3 |
| Leather — durability | 55 | 80 | 75 | 65 |
| Iron — durability | 165 | 240 | 225 | 195 |
| Diamond — durability | 363 | 528 | 495 | 429 |

Damage absorbed is

```text
amount * min(20, max(defence / 5, defence - amount / 2)) / 25
```

Each hit costs one random worn piece four durability per point absorbed, so a set wears
unevenly, and a piece that runs out un-equips itself. The HUD draws the set as ten shields
above the hunger bar.

### Hunger

Twenty points, no saturation. Every exhaustion point costs one bite. Health only
regenerates at hunger 18 or above, and an empty bar costs half a heart every four seconds
and will kill you. A bite takes 0.6 seconds.

| Constant | Value |
| --- | --- |
| Hunger maximum | 20 points |
| Health regenerates at | hunger 18 or above |
| Starvation | half a heart every 4 seconds at hunger 0 |
| Time per bite | 0.6 seconds |

What each activity costs, in exhaustion points:

| Activity | Exhaustion |
| --- | --- |
| Walking | 0.004 per block |
| Sprinting | 0.02 per block |
| Jumping | 0.1 per jump |
| Mining a block | 0.05 |
| Attacking | 0.1 per swing |
| Taking a hit | 0.1 |
| Regenerating health | 0.1 per half heart |

| Food | Hunger restored |
| --- | --- |
| Wheat | 2 |
| Bread | 5 |
| Raw Beef | 3 |
| Steak | 8 |

### Wheat

- Seeds come from breaking grass: 25% chance of one or two. Farmland is made by hoeing grass or dirt.
- Eight growth stages, drawn as two crossed quads that grow taller, leaf out, and turn gold at the tip.

One growth attempt per crop per second at a 1.2% chance, and only where sky or lamp light
reaches 9, so an unlit field never ripens. Roughly ten real minutes in the open.

| Constant | Value |
| --- | --- |
| Growth tick | 1 second per crop |
| Chance per tick | 1.2% |
| Light needed | 9 or higher, sky or block |
| Stages | 8, block ids 21–28 |
| Ripe time in the open | about 10 real minutes |

| Harvest | Drops |
| --- | --- |
| Ripe wheat | 1 wheat and 1–2 seeds |
| Unripe crop | its seed, and the furrow stays tilled |
| Farmland dug out from under a crop | the crop is destroyed |

### Notes for whoever picks this up next

- The save format is schema 3 under the key `voxelcraft:world:v3`. v1 and v2 saves are deliberately not migrated: the game starts a fresh world and says so on screen.
- New block ids are appended from 16 upwards and never renumbered, enforced by a runtime assertion. The eight wheat stages are block ids 21–28 rather than block entities, so crop stage survives chunk unloads with no change to the save format.
- `window.__voxelcraft` gained `breakTime`, `mine`, `give`, `durability`, `hunger`, `setHunger`, `eat`, `armour`, `equip`, `openFurnace`, `furnace`, `furnaceList`, `setFurnaceSlots`, `smelting`, `tillDirt`, `plantSeed`, `crops` and `growCrops`. Every number in this addendum was asserted through that API plus screenshots, including a gamepad-only pass over the armour, furnace and craft result slots.
- Accepted behaviour changes: iron is locked behind the furnace, hunger can kill, cows drop leather, grass drops seeds, and any world saved before this milestone resets.
