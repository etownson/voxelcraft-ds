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
  - Carving must not open the sea into a cave either: a cave may not be carved at or below sea level where the ground above it, or the neighbouring column, is flooded down to that height, because a breach lets the flow simulation flood a cave the player was meant to find dry
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
  - Not one block but fifteen states: a source, seven resting levels, and the same seven again
    carrying their own level while falling — see the water flow addendum at the end
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
- On death, show a respawn screen and respawn the player at the spawn point with full health and a full hunger bar; inventory may be kept for simplicity

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

- Zombies spawn on solid ground at night or in dark caves, in a band 20 to 48 blocks around the player, within a cap of their own; with the voxel lighting system, "dark" means the light level at the spawn spot is below a threshold, so unlit caves can spawn zombies even during the day, and torch-lit areas are safe
- Night arrives in batches: a spawn pass after dark may place up to three hostiles, so dusk turns dangerous within seconds instead of one zombie at a time, while daytime cave spawning keeps to its trickle
- Creepers spawn rarely under the same conditions
- Zombies path toward the player when within detection range (simple direct-walk steering with one-block step-up is acceptable; full pathfinding not required), and deal contact damage on touch with a cooldown
- Creepers approach the player, then hiss, flash, and explode after a short fuse, damaging the player and destroying nearby non-bedrock blocks (destroyed blocks drop as items)
- Hostile mobs take damage from player attacks (left click while looking at a mob within reach), with knockback
- Hostile mobs burn/despawn at dawn (mobs sheltered underground in darkness are exempt), but an idle hostile more than 32 blocks off in three dimensions keeps rolling until it gives up and vanishes, so a cave under the player's base cannot hold the entire hostile budget
- Mobs must not spawn inside blocks or in water, and despawn when the player is 96 blocks away measured in three dimensions, not just horizontally

Mob management:

- Mobs are entities separate from the voxel grid, updated each frame
- Cap total live mobs for performance, and split that cap into a passive half and a hostile half that add up to no more than the total. Caps that overlap put the two groups in competition for the last few slots, and animals win that fight: a healthy herd left room for nine zombies and nights never filled
- Mobs persist while their area is loaded and are removed when their chunk unloads
- A chunk's herd roll is spent only while the player is close enough to have seen it, and a timer draws on the rolls still unspent around the player, so herds arrive as the player travels rather than only around the first spawn point

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
- Water is drawn at the height its level actually fills, not at the top of its cell, and shared
  grid corners blend so neighbouring levels slope into each other instead of stepping
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

- One full cycle takes 20 real minutes, the length Minecraft runs on: the sun is up about 10 minutes and down about 10, with roughly half a minute of dusk and dawn at each end
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
| Oak Leaves | 0.2 | hoe | — | Apple at 2.5%, and never a leaf block |
| Torch | 0 | — | — | Torch |
| Oak Log | 2.0 | axe | — | Oak Log |
| Oak Planks | 2.0 | axe | — | Oak Planks |
| Crafting Table | 2.5 | axe | — | Crafting Table |
| Stone | 1.5 | pickaxe | 1 (wood) | Cobblestone |
| Cobblestone | 2.0 | pickaxe | 1 (wood) | Cobblestone |
| Coal Ore | 3.0 | pickaxe | 1 (wood) | 1–2 Coal |
| Iron Ore | 3.0 | pickaxe | 2 (stone) | Raw Iron |
| Diamond Ore | 3.0 | pickaxe | 3 (iron) | Diamond |
| Glass | 0.3 | — | — | Glass |
| Furnace | 3.5 | pickaxe | 1 (wood) | Furnace |
| Bedrock | ∞ | — | — | never breaks |

Two blocks outside that list carry Minecraft's numbers as well: a wooden door is 3.0 with an
axe to speed it up, and a bed is 0.2 with no tool at all.

Resulting break times, in seconds. Each tool column assumes that tier's correct kind of
tool for the row; ✗ means the block breaks but drops nothing, and those entries carry the
five-times penalty. Bedrock is unbreakable, and the 0.05 second floor is what holds snow at
0.05 in the diamond column and pins the whole torch row to 0.05. Glass has no tool at all in
Minecraft, so its row is one flat 0.45: a diamond pickaxe chops it no faster than a fist.

| Block (hardness) | hand | wood | stone | iron | diamond |
| --- | --- | --- | --- | --- | --- |
| Dirt (0.5) | 0.75 | 0.375 | 0.1875 | 0.125 | 0.09375 |
| Grass Block (0.6) | 0.9 | 0.45 | 0.225 | 0.15 | 0.1125 |
| Sand (0.5) | 0.75 | 0.375 | 0.1875 | 0.125 | 0.09375 |
| Snow Block (0.2) | 0.3 | 0.15 | 0.075 | 0.05 | 0.05 |
| Farmland (0.6) | 0.9 | 0.45 | 0.225 | 0.15 | 0.1125 |
| Oak Leaves (0.2) | 0.3 | 0.15 | 0.075 | 0.05 | 0.05 |
| Torch (0) | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 |
| Oak Log (2.0) | 3 | 1.5 | 0.75 | 0.5 | 0.375 |
| Oak Planks (2.0) | 3 | 1.5 | 0.75 | 0.5 | 0.375 |
| Crafting Table (2.5) | 3.75 | 1.875 | 0.9375 | 0.625 | 0.46875 |
| Stone (1.5) | 7.5 ✗ | 1.125 | 0.5625 | 0.375 | 0.28125 |
| Cobblestone (2.0) | 10 ✗ | 1.5 | 0.75 | 0.5 | 0.375 |
| Coal Ore (3.0) | 15 ✗ | 2.25 | 1.125 | 0.75 | 0.5625 |
| Iron Ore (3.0) | 15 ✗ | 7.5 ✗ | 1.125 | 0.75 | 0.5625 |
| Diamond Ore (3.0) | 15 ✗ | 7.5 ✗ | 3.75 ✗ | 0.75 | 0.5625 |
| Glass (0.3) | 0.45 | 0.45 | 0.45 | 0.45 | 0.45 |
| Furnace (3.5) | 17.5 ✗ | 2.625 | 1.3125 | 0.875 | 0.65625 |

### The gap between two blocks

A held click does not chain breaks at full speed. Once a block gives way Minecraft waits six
ticks before the next one starts to crack, so a row of dirt costs 1.05 seconds a block in a
bare hand — 0.75 to break and 0.3 of nothing — and 0.675 with a wooden shovel. A block that
shatters inside a single tick skips the gap outright, which is what lets an iron shovel tear
through a snowfield and an iron hoe through a canopy. `MINING_BLOCK_DELAY` is the six ticks;
`MINING_SWING_INTERVAL` stays what it was, the arm and its contact sound.

Measured by holding the click over a row of four blocks and counting 1/60 second frames, so
the chained column can sit a frame above the exact figure:

| Block, in hand | Break | Chained, per block |
| --- | --- | --- |
| Dirt, hand | 0.75 | 1.05 |
| Dirt, wooden shovel | 0.375 | 0.683 |
| Oak Leaves, hand | 0.3 | 0.617 |
| Oak Leaves, wooden hoe | 0.15 | 0.467 |
| Oak Leaves, iron hoe | 0.05 | 0.067 |
| Snow Block, iron shovel | 0.05 | 0.067 |

The gap runs out whether or not the button is still held, so releasing it halfway through
buys nothing on the next block, and swinging at bedrock — which never breaks — neither
earns nor spends one.

What is left unmapped is deliberate. Minecraft counts break progress in whole ticks and
rounds up, so it can be a hair slower than the figures above; the times here are continuous,
never above Minecraft's and at most one tick under. Sword speed (1.5 on everything), shears,
the gold, netherite and copper tiers, and the five-fold penalty for mining with the head
underwater or feet off the ground are not in the game at all.

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

The Raw Beef row is what puts a cooker in the food chain: meat dropped by a cow, pig or sheep
is not edible until it has been through a furnace, so steak, and the eight points it restores,
are gated behind the same ten seconds and one piece of fuel as an iron ingot.

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
above the hunger bar, and the row is hidden entirely while nothing is worn.

### Hunger

Twenty points of food, with Minecraft's hidden saturation counter sitting on top of it.
Exhaustion spends saturation first and food only once the cushion is gone, and it has to
reach 4.0 before it spends either of them. Health only regenerates on a nearly full stomach,
and an empty bar costs half a heart every four seconds and will kill you. A bite takes 0.6
seconds. Death ends the empty stomach: respawn fills the bar back to 20, sets Minecraft's own
five points of saturation, and zeroes the exhaustion counter, so hunger can kill you once but
never twice in a row.

| Constant | Value |
| --- | --- |
| Hunger maximum | 20 points |
| Saturation | hidden, 0-20, never above the food it cushions |
| Exhaustion per point spent | 4.0, saturation before food |
| Health regenerates at | hunger 18 or above, or any saturation left |
| Slow heal | half a heart every 4 seconds, 6 exhaustion each |
| Saturation boost | half a heart every 0.5 seconds at a full bar, 1.5 saturation each |
| Wait after a hit | 6 seconds, on the slow heal only |
| Starvation | half a heart every 4 seconds at hunger 0, straight through armour |
| Time per bite | 0.6 seconds |
| Food on respawn | 20 points, 5 saturation, exhaustion 0 |

Saturation has no bar of its own, so the food bar jitters whenever there is food left and no
cushion under it, which is Minecraft's only tell. It is also the reason to eat early: a meal
at a half-empty stomach wastes most of its saturation, and a full bar refuses a bite even
with nothing cushioning it, which leaves only the four-second heal until something is eaten
at 19 or below.

The two heal paths never run at once. At a full bar with saturation left, the half-second
boost pays for the health and the slow heal waits, which is the only way a steak's 12.8
saturation is worth the 8⅓ hearts it is worth in Minecraft.

What each activity costs, in exhaustion points — Minecraft Java 1.21's table, unchanged:

| Activity | Exhaustion |
| --- | --- |
| Walking | nothing |
| Sprinting | 0.1 per block |
| Swimming | 0.01 per block |
| Jumping | 0.05 per jump |
| Sprint-jumping | 0.2 per jump |
| Mining a block | 0.005 |
| Attacking | 0.1 per landed swing |
| Taking a hit | 0.1 |
| Regenerating health | 6.0 per half heart |

Walking is free, so exploring costs nothing and a meal buys work rather than footsteps. There
is no sprint-swimming here, so water always charges the swim rate. Mending is the dearest
thing in the game by a wide margin: twelve health back is 72 exhaustion, more than a full day
of sprinting, mining, swinging and taking hits put together.

| Food | Hunger | Saturation |
| --- | --- | --- |
| Wheat | 2 | 1.2 |
| Apple | 4 | 2.4 |
| Bread | 5 | 6.0 |
| Steak | 8 | 12.8 |

Raw meat is not on that list, because it feeds nobody as it comes. Cows, pigs and sheep drop
Raw Beef, and only a furnace turns it into steak: right-clicking it costs the click, not the
item, and answers `Raw Beef needs cooking in a furnace` while there is room left to eat. The
slot tooltip carries the same reminder. Minecraft gives raw beef 3 food and 1.8 saturation
and relies on hunger alone to push players toward a cooker; withholding both is what makes
the furnace the only road past it here.

The apple is the other end of that design: the one food that needs no cooker, no field and no
knife, because it is already hanging in the canopy. Breaking a leaf block rolls it at 2.5%, and
a leaf gives up nothing else — no leaf block, ever. Both halves of that sentence diverge from
Minecraft, and the apple addendum at the end of this document records which numbers are borrowed
and which are this game's own.

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

### Sprint is a latch, not a held key

Shift, either Ctrl, or the gamepad's B / L3 starts the run and the same key stops
it, so nothing about sprinting depends on holding a modifier down. The latch drops
whenever the controls leave the player — the pause overlay, any open screen, death,
respawn, the window losing focus, a gamepad disconnect — so a sprint can never
resume by surprise. While it is set the HUD shows a `Sprint on` line in the debug
stack, above the sound state.

| Situation | Result |
| --- | --- |
| Latch set, moving | 6.9 blocks/s instead of 4.6 |
| Latch set, Shift let go | Keeps running |
| Latch set, standing still | Not sprinting, latch stays armed |
| Latch set, in water | Not sprinting, latch survives |
| Pause, screen, death, blur, pad lost | Latch drops |

### Notes for whoever picks this up next

- The save format is schema 4 under the key `voxelcraft:world:v4`. Older saves are deliberately not migrated: the game starts a fresh world and says so on screen. v1 and v2 fell to the furnace update, and v3 to the hunger parity pass below.
- New block ids are appended from 16 upwards and never renumbered, enforced by a runtime assertion. The eight wheat stages are block ids 21–28 rather than block entities, so crop stage survives chunk unloads with no change to the save format.
- `window.__voxelcraft` gained `breakTime`, `mine`, `give`, `durability`, `hunger`, `setHunger`, `eat`, `armour`, `equip`, `openFurnace`, `furnace`, `furnaceList`, `setFurnaceSlots`, `smelting`, `tillDirt`, `plantSeed`, `crops`, `growCrops`, `setSprint` and `sprintState`; `stats()` reports `sprintLatched` next to `sprinting`. Every number in this addendum was asserted through that API plus screenshots, including a gamepad-only pass over the armour, furnace and craft result slots.
- Accepted behaviour changes: iron is locked behind the furnace, hunger can kill, cows drop leather, grass drops seeds, sprint is tapped on and off instead of held, and any world saved before this milestone resets.

---

## Milestone 12 addendum — beds and shears

Recorded after the fact. Milestone 12 gives the world somewhere to wake up in and a reason to
keep a flock: shears take wool off a sheep, that wool becomes a bed, and a bed owns the respawn
point. After dark a bed also ends the night. Everything below is still the same single HTML
file, with textures, icons and sounds generated in code as before.

### Shearing

Shears are the first tool with no tier. They match no block's `tool`, so mining is untouched:
a log takes the same three seconds with shears as with a bare hand, and a swing that breaks
something spends none of their durability.

| Shears | Value |
| --- | --- |
| Craft | 2 iron ingots, either diagonal |
| Durability | 64 uses, one per sheep |
| Swing damage | 2, the improvised-weapon floor any non-sword tool swings at — but never against a sheep |
| Wear per blow that lands | 2, and a blow only lands on something that is not a sheep |
| Stack size | 1 |
| Mining speed | 1, the same as a hand |
| Wears while mining | never |

Either button shears. Right-click is the deliberate use, and the left button answers to it too,
because a pair of shears reads as a tool you swing, and a player who means to kill a sheep has
something sharper in hand. With the crosshair on a fleecy sheep the fleece comes off in one go:
the animal is not harmed, bleats, and trots away bare.

| Shearing | Result |
| --- | --- |
| Woolly sheep, either button | 1–3 wool, sheep becomes shorn, 1 durability, 0.005 exhaustion, toast `Sheared` |
| Already shorn, either button | toast `That sheep is already sheared`, no durability spent |
| Cow, pig, chicken, creeper — left button | takes the swing: 2 damage, 2 durability, as any other tool |
| Cow, pig, chicken, creeper — right button | toast `Nothing to shear here`, nothing spent, and the click is not handed on to placing |
| Sheep behind a solid cell | out of reach: the left button mines the cell in front, the right click uses it |
| Sheared sheep killed | meat only |
| Woolly sheep killed | meat plus 1 wool |

Shears are the one tool that never strikes a sheep, on either button. Holding the left button
down is an exception on noise only: the press toasts and every frame after it swings in silence,
so standing on a shorn sheep with the button held does not fill the screen with the same
refusal.

The reach is judged twice, once for the animal and once for the air in front of it. The mining
pass drops a mob as a target as soon as any block face is nearer, which is right for a pickaxe —
the ore behind the cow is the better target — and wrong for shears: aiming even slightly low at a
sheep on a slope puts the ground in front of the animal nearer than the animal's own box, so
every one of those shots was a snip that failed without even a sound. `mobUnderCrosshair` casts
the mob ray on its own and then steps `airClearTo` back along it, so clear air still has to
reach the fleece and a sheep on the other side of a wall stays out of reach until the player
walks in. A nearer block still wins a right click outright: a crafting table with a cow pressed
in behind it opens rather than being told what it is not.

A shorn sheep stays shorn: fleece never grows back, so a fleecy hillside is worth fencing.
The bare model is rebuilt from the same parts minus the fleece — seven pieces become six, the
body drops from 0.86 × 0.74 × 1.16 to 0.66 × 0.52 × 0.94, and a new `sheep_skin` texture
replaces the wool on the body and legs while the face keeps its own texture. Wool has no other
use yet, which is the point: it is the bed's ingredient.

### The bed

A bed is one item across two cells, the arrangement the door already uses. The foot cell takes
the block the player aims at, the head cell sits one step along the facing, and the facing is
pointed away from whoever places it so the pillow always lands at the far end. Both cells carry
the facing, so a bed keeps its direction across a save.

| Bed | Value |
| --- | --- |
| Block ids | 33 foot, 34 head, appended after the door's 29–32 |
| Hardness | 0.2, no correct tool — Minecraft gives a bed none |
| Drops | 1 bed from either half; the half that was not broken is cleared outright, so a bed never pays out twice |
| Collision | full solid cell, both halves — you walk on a bed, not through it |
| Light | none |
| Sound | wood |
| New atlas tiles | `bed_top`, `bed_side`, `bed_end`, `bed_pillow` |

Plotted as geometry rather than cubes: a mattress slab half a block tall across both cells,
blanket red on the top and along the length with a wooden rail along the frame, plank boards
across the two ends, and a white pillow riding the far end of the head cell a little above the
mattress. It is drawn in the cutout pass, which is double-sided like a door leaf, so the bed
reads the same from the foot and from the head.

| Placing a bed | Result |
| --- | --- |
| Solid ground under both cells, head cell clear | bed laid, one item spent |
| Air, water or a block over the ground | toast `Beds need solid ground beneath them` |
| Head cell occupied | toast `Needs a clear cell beside for the bed` |
| Either cell inside the player | toast `Not enough room to place that` |

### Sleeping, and who owns the respawn point

Right-clicking either half of a bed claims it, whatever else is being held.

| Situation | Result |
| --- | --- |
| Daytime, or the hour before dusk | spawn point moves to the foot cell, toast `Spawn point set`, clock untouched |
| Night | spawn point moves, the screen fades to black, the clock is set to `DAY_START` (0.22, 11:16) and the toast reads `Good morning` |
| Second click while falling asleep | spawn point moves again, the night is not skipped twice |
| Death afterwards | respawn on the bed with full health, a full hunger bar and, as ever, the inventory kept |

Night is the same test the sky already uses: the sun below −0.04. The fade takes 0.7 seconds
out and the world wakes 1.4 seconds after it goes dark. It is a blackout rather than a
fast-forward: the hours in between are never run through, the clock is simply set to `DAY_START`
when the world wakes. Nothing else is paused either — mobs within the usual 96 blocks keep
walking, so anything that was close when you lay down is still close when you get up. Because a
bed is solid all the way up, waking and dying both put the player standing on top of it.

The respawn point outlives the bed that set it. The save gained a `spawn: { x, z }` field beside
the player's own position; it is optional, so a world saved before this milestone loads
unchanged and keeps the world spawn. Schema stays 3 under `voxelcraft:world:v3`.

### Two recipes

| Result | Pattern | Grid |
| --- | --- | --- |
| Red Bed ×1 | `WWW` / `PPP` — three wool over three planks | 3×3 |
| Shears ×1 | `I.` / `.I`, and `.I` / `I.` — two ingots point to point | 2×2 |

The matcher reads a pattern exactly and never mirrors one, so shears are written down twice,
once for each diagonal. Both come out of the 2×2 grid, which means a miner with two ingots and
no table can arm themselves for a flock.

### Notes for whoever picks this up next

- `tryUseSelectedItem` now runs in this order: eat, shear a mob, then whatever right-clicking a
  block does. Shearing is the only use aimed at an entity rather than a cell, and it wins over
  placement, so a sheep standing in a doorway cannot be accidentally built over.
- `tryShearMob(mode)` is the one interaction wired to both buttons, and the mode only changes how
  loudly it answers: `'use'` for a right click, `'swing'` for the left button coming down (mouse
  and pad alike), and `'held'` for the left button staying down in `updateCombat`, which is the
  one that keeps quiet and the one that will never claim a mob that is not a sheep — otherwise a
  creeper at the crosshair would stop taking the swing. Either left-button path sets
  `player.attackCooldown` when it takes the shot, so one press cannot shear twice, and the right
  click keeps no cooldown the way it never did.
- Reported by playing, not by the harness: `updateMobTarget` was the only target check, so shears
  attacked sheep whenever a block face sat nearer than the animal, which on anything but flat
  ground is most shots. The debug API could not show this, because `use()` went through the same
  call and agreed with it. Assert these things through `document.dispatchEvent` on real
  `mousedown`/`mouseup` instead, and zero `player.attackCooldown` between sub-tests — a stale
  throttle swallows the next hit silently and reads as a bug in the new code.
- Beds clear their partner cell in both `breakBlockAt` and `World.setBlocksBatch`, the same hooks
  the door uses, so an explosion, a piston-less mass set, or a pickaxe on the pillow all take the
  whole bed with them.
- `window.__voxelcraft` gained `use()`, which right-clicks whatever the crosshair is on, and
  `mobInfo` now reports `sheared`. Every claim in this addendum was asserted through that API:
  placement and the facing it stores, breaking either half for exactly one bed, a night sleep
  that rolled the clock from 02:24 to 11:16, respawn landing on the bed at full health, shearing
  for 2 wool and one point of durability with the model swap verified from the scene graph, death
  drops for both a fleecy and a shorn sheep, and a save-reload round trip that brought back both
  cells, their facing, and the spawn point.
- Read the effect of a bed rather than its return value: right-clicking a bed, a door or a table
  answers `false`, because those paths claim, toggle or open instead of placing. A claimed bed
  shows up in `spawnColumn` and, after dark, in the clock. Shearing does answer `true`, including
  the already-sheared refusal, so durability is the thing to watch there.
- The mouse path was driven separately from the API, because fallback controls treat a right
  drag as looking and a right click as using: a drag of 60 px turned the camera 0.19 radians and
  left the spawn point alone, while the same click without movement set it. The drag threshold
  for that decision was raised from 4 px to 10 px — the camera still turns from the first pixel,
  the threshold only decides whether the press also counts as a use, and a swallowed use is
  silent, which reads as the held item being dead rather than as the click having been lost. A
  6 px jiggle now shears and turns 0.019 radians; 60 px still only looks.
- `simulate()` now runs `updateCombat` alongside the frame loop. Without it there was no way at
  all to say what a held left button does, since a hidden tab never runs a real frame. Note that
  a held shear on a shorn sheep re-arms `attackCooldown` every frame, so the cooldown staying at
  0.38 is proof the combat path ran, not that it stalled; probe it on empty air instead.
- Accepted behaviour changes: sheep give wool when killed as well as when shorn, fleece never
  regrows, sleeping always ends at 11:16 rather than at sunrise, the respawn point sits on
  top of the bed rather than in the cell beside it, and shears will not wound a sheep at all —
  killing one for its wool takes any other tool in the hotbar.

## Mob budget addendum — why nights were empty

Nights were too quiet, and the report was that animals were crowding hostiles out. That was true,
and a second cause was hiding behind it. Everything below was measured by driving the frame loop
through `window.__voxelcraft.tick()` with the clock frozen, not by reading the spawn code and
guessing.

### What the numbers said

| Situation, before the change | Hostiles | Why |
| --- | --- | --- |
| Midnight, world cleared of mobs | 13 within 40 s | The spawn machinery was never broken |
| Midnight with the herd at its cap of 20 | 9, forever | 20 animals plus a `MOB_CAP - 1` reservation, against a total of 30 |
| Bright noon on the surface, world cleared | 13 within 160 s, all of them underground | Caves pass the darkness test at noon |
| The night after that noon | nothing new at all | Those 13 never burn, and never counted as far away |

The last two rows were the actual complaint. Sheltered hostiles are exempt from burning, and the
despawn test measured horizontal distance only, so a zombie sixty blocks under the player's base
read as standing right next to them and stayed for the rest of the session. A cave network under a
house therefore held the entire hostile budget from noon onwards, and night had nothing left to
spawn.

### What changed

| Knob | Was | Now |
| --- | --- | --- |
| `MOB_CAP` / `PASSIVE_CAP` / `HOSTILE_CAP` | 30 / 20 / 13 | 32 / 16 / 16 |
| Reservations off the total | `-1` for hostiles, `-2` for herds | none; the two group caps fit inside the total |
| Columns probed per pass | 4 | 8 |
| Night spawn pass | one hostile per 1.9 s | up to three per 1.4 s |
| Spawn band | 17–42 blocks | 20–48 blocks |
| Surface candidates after dark | 62% of rolls | 85%, and 35% by day, when only caves can pass anyway |
| Despawn distance | 96 blocks, horizontal | 96 blocks in three dimensions |
| Idle hostiles past 32 blocks | stay forever | a 25% chance every 5 s to give up and vanish |

The caps no longer overlap, which is what stops a healthy herd from deciding how dangerous the
night is. `spawnMob` still refuses anything past `MOB_CAP`, so those reservations were only ever
compensating for caps that did not add up. The despawn roll cannot interrupt a chase: both
detection ranges sit inside 32 blocks.

### Measured afterwards

| Situation, after the change | Result |
| --- | --- |
| Midnight, world cleared | hostile cap in 10 s, 13 of the 16 on the surface, 10 within 32 blocks |
| Midnight with the herd full at 16 | hostile cap in 8 s; the total peaked at exactly 32 and never past it |
| Bright noon above caves, 300 s | hostiles hover between 4 and 7, and `hostile_cap` refusals: 0 all day |
| Dusk after that noon | five fresh surface hostiles within 4 s; 11 of 13 living hostiles new since dark |
| 32 mobs on screen | 0.06 ms of simulation per frame, about 3 draw calls a mob against 214 for the terrain |

Mobs were never the expensive part — the terrain alone draws 1.8 M triangles — so the two extra
slots cost nothing measurable.

### Notes for whoever picks this up next

- `__voxelcraft.spawnReport()` answers the question this whole addendum is about: the live caps,
  and a tally of why hostile spawns are being refused (`hostile_cap`, `no_chunk`, `terrain`,
  `light`), with `resetSpawnTally()` to zero it between runs. `stats().mobs` now carries the caps
  beside the counts. A rising `hostile_cap` with nothing on screen means invisible mobs are holding
  slots; a high `light` count means torches are doing their job.
- `spawnHostile()` runs one hostile pass on demand, the way `spawnPassive()` already did.
- Freeze the clock first (`setTimeScale(0)`, then `setTime()`). The frame loop advances time on its
  own, and an unfrozen test measures dusk when it meant to measure midnight.
- `tick()` runs the real `updateMobs`, spawn timers included, so a whole night compresses into
  about a second of wall time. Heal the player between rounds: sixteen hostiles will otherwise
  kill them halfway through a run, and the creepers will leave craters in the test site.
- Accepted behaviour changes: idle hostiles now vanish well before 96 blocks, so a cave the player
  walks away from empties out instead of seasoning the walk back; and animals are capped at 16
  rather than 20, so a very green valley now holds a thinner herd than it used to.

---

## Respawn feeding addendum — hunger can kill you once

The report was that death by hunger was unfair: the player starved at night, respawned at full
health with an empty bar, and lost health faster than a cow could be found, cooked and eaten. The
rate was not the problem. Where the food came back was.

### What the report was and was not

| Claim | Measured |
| --- | --- |
| "Health drains too quickly" | Not the bug. The real starvation clock, run through `tick()`: first bite at 4 s, 1 HP each, 20 bites, death at 80.5 s from full health. That is Minecraft's Hard difficulty, unchanged |
| "I respawned with hunger at 0" | True, and the whole bug: `respawnPlayer()` restored health, velocity and timers but never touched `player.hunger`, so an empty stomach restarted its 80-second countdown at the spawn point |
| Minecraft | resets food to 20 (and saturation to 5) on every respawn. Starvation also floors at 1 HP on Normal and 10 HP on Easy, so only Hard ever kills. This game keeps the lethal floor on purpose |

### What changed

`respawnPlayer()` now fills the bar back to `HUNGER_MAX`, zeroes `player.exhaustion` so leftover
exhaustion cannot spend a bite off a stomach that was just filled, redraws the hunger bar, and
marks the save dirty. One edit, and every respawn path goes through it: the respawn button, the `A`
key, the gamepad A button and `__voxelcraft.respawn()`.

The save mark is load-bearing rather than tidy. A death and a respawn change nothing in the world,
so the save was still clean afterwards: starve, respawn, close the tab before the next autosave, and
the save came back holding the empty bar the death had earned.

| Situation | Result |
| --- | --- |
| Starved to death for real, then respawned | 20 food, 0 exhaustion, 20 health, 10 of 10 haunches lit; 20 s standing at the spawn point costs nothing |
| Leftover exhaustion at death (0.1 from a hit) | 0 after respawn |
| Clean save holding hunger 0 → die → respawn | `saveInfo().dirty` flips to true, and a reload boots at 20 food with the bar drawn full |
| Clean save holding hunger 7, no death | boots at 7: respawning feeds, loading a save still does not |

### Notes for whoever picks this up next

- Two deliberate divergences from Minecraft survived what came after this. Armour no longer
  absorbs starvation damage — the hunger parity addendum below routes that bite straight
  through the plate — and nothing still stops a sprint below hunger 7, where Minecraft does.
  Every other divergence listed here was closed by that pass: there is now a saturation buffer,
  exhaustion spends a bite at Minecraft's 4.0 rather than 1.0, and mining, jumping, attacking
  and walking are priced the way Minecraft prices them. The starvation clock measured above is
  untouched, and still correct.
- Found while screenshotting this, and fixed since: `#armor.hidden` had no CSS rule while every
  other `.hidden` in the file did, so `renderArmorBar` set the class and the empty row still
  painted as ten dark shields above the food bar whenever nothing was worn. The rule is there now,
  and the row measures gone at zero defence, four shields at eight and seven shields plus a half
  one at iron's fifteen, with the food bar never moving more than a pixel and a half between them.


---

## Hunger parity addendum — Minecraft's stomach, whole

Recorded after the fact. Hunger already had the right shape and the wrong arithmetic: a
20-point bar, a private price list, and an exhaustion counter that spent a whole bite for every
1.0 it accumulated. Walking cost food, a sword fight cost a fortune, and eating was a chore to
grind through rather than a decision about when to eat. This pass moves the economy onto
Minecraft Java 1.21's numbers and adds the one counter that was missing. Content the game does
not have — the hunger effect, pufferfish, chorus fruit, a spear's Lunge — is not priced.

### The counter that was missing

`player.saturation` is Minecraft's hidden buffer, on the same 0-20 scale, never allowed above
the food it cushions. Exhaustion spends it before it spends food, so a good meal is what carries
a busy day and an empty cushion is what makes the next hard job cost food. A new world and every
respawn start at food 20 with saturation 5, which is Minecraft's own starting cushion.

Saturation has no bar of its own, so the food bar jitters whenever food is left and the cushion
is not: the CSS animation is on `#hunger.jitter`, toggled by `renderHunger()`, and it is the
player's only tell. `__voxelcraft.hunger().jittering` reads it back.

The ordering matters more than the numbers. Food now only moves once saturation is gone, which
turns eating into timing: a steak eaten at 3 food loses 1.8 of its saturation to the cap, and a
full bar refuses a bite outright even with nothing cushioning it, which leaves the player on the
four-second heal until something is eaten at 19 or below.

### Two ways to mend, and never both at once

- **Saturation boost.** At a completely full bar with saturation left, half a heart every half
  second, 1.5 saturation each. Eight times the speed of the slow heal, and paid out of a pocket
  food never sees.
- **Slow heal.** Half a heart every four seconds while the bar is at 18 or above, or while any
  saturation is left at a lower bar, and 6 exhaustion each — 1.5 saturation while there is any,
  otherwise 1.5 food.

The boost takes precedence and returns before the slow heal is considered. That is not tidiness:
a steak's 12.8 saturation is worth exactly 8⅓ hearts in Minecraft, which only works out arithmetically
if the boost is the one paying for them. Twelve health back on the slow heal is 72 exhaustion,
which is more food than a whole day of work, and is the point.

A hit still starts a six-second wait, but it gates the slow heal only. Minecraft resets its own
food clock on damage without pausing the boost, and so does this.

Starvation, at hunger 0: half a heart every four seconds, straight through any armour, charging
no exhaustion — Minecraft only exhausts a player for damage armour was in a position to block.
There is no difficulty setting and no floor to stop at, so the bar can kill you, which is
Minecraft's Hard difficulty on purpose and keeps `VoxelCraft Design`'s own promise that an empty
hunger bar is a slow way to die.

### What everything costs, and how each figure was read

Values are Minecraft's. Each one was measured through `__voxelcraft` against the live player,
summing distance frame by frame because exhaustion is charged frame by frame.

| Action | Minecraft | Measured |
| --- | --- | --- |
| Walking | free | 11.66 blocks walked, 0.000 exhaustion |
| Sprinting | 0.1 per block | 20.54 blocks, 2.054 |
| Swimming | 0.01 per block | 30.48 m over 2,734 frames, 0.305 |
| Jumping | 0.05 per jump | one frame, 0.050 |
| Sprint-jumping | 0.2 per jump | one frame, 0.200 |
| Mining a block | 0.005 | three dirt blocks, 0.005 each |
| Landed swing | 0.1 | 25 swings, 2.500 between them |
| Swing at nothing | nothing | 0.000 |
| Taking a hit | 0.1 | 0.1, armour wearing as usual |
| Starvation bite | nothing, and no armour | 0.000, durability untouched |
| Slow heal | 6.0 per half heart | two health mended, food 20 → 17 |
| Threshold | 4.0 | 40 hits spent four points, saturation first |

Swimming was the trap: a jump held against the seabed is a ground jump and charges 0.05, so the
figures above hold forward down and never touch jump. Walking is free, which means exploring
costs nothing and a meal buys work rather than footsteps.

### A worked day, end to end

Sprinting 302 m, swimming 8 m, mining 100 blocks, 40 jumps and 17 hits taken, starting from a
fresh world's stomach of 20 food and 5 saturation:

| | Exhaustion |
| --- | --- |
| Sprint 302 m | 30.25 |
| Swim 8 m | 0.08 |
| Mine 100 blocks | 0.50 |
| 40 jumps | 2.00 |
| 17 hits | 1.70 |
| **Expected** | **34.62** |
| **Measured** | **34.61** |

Eight points spent: the five of saturation first, then three of food, ending on food 17 with
3.088 exhaustion banked and the bar jittering. One steak covers that day twice over — 8 food
plus 12.8 saturation is 20.8 points, or 83 exhaustion — which is what makes hunger a planning
problem rather than a tax.

Then, bleeding on that food 17: nothing. Twelve seconds of a wounded player at hunger 17 with no
saturation left mends exactly nothing, because the slow heal needs 18 or a cushion. One steak
brings the bar to 20 — four points of it wasted, which is the whole argument for eating early —
and its saturation mends nine health in four and a half seconds, after which the slow heal takes
two more health and stalls at 19 when the bar drops through 17. The tenth point needs another
bite. That sequence is the economy working as designed, not a bug.

### Save format

Schema 4 under `voxelcraft:world:v4`, because saturation has no honest default for a stomach
that is already half empty and every food value changed underneath it. v3 joins v1 and v2 as a
world that stays in storage, cannot be read, and gets announced: such a save boots as a new
world with `A world from an older version exists and can't be loaded`.

Both counters are pulled back inside their invariants on the way in: saturation is clamped to the
food it cushions, and exhaustion that arrives at or past a whole bite, or below zero, starts over
rather than spending food the instant the world opens. A stored stomach of hunger 13 / saturation
9.5 / exhaustion 7.4 boots as hunger 13 / saturation 9.5 / exhaustion 0.

### Divergences left in place on purpose

- **Raw Beef feeds nobody**, where Minecraft gives it 3 food and 1.8 saturation. Minecraft trusts
  hunger alone to push players toward a cooker; here the furnace is already the gate and taking
  both values keeps it that way.
- **Wheat is edible**, at 2 food and 1.2 saturation, where Minecraft has no edible wheat item at
  all. Farming has to feed you or it is decoration; the food value is this game's own and the
  saturation borrows Minecraft's 2-food tier.
- **Sprinting is never gated by hunger.** Minecraft stops a sprint at 6 food or less and drops the
  latch. Nothing here does, and it was measured: hunger 4, latch armed, sprint runs and spends
  0.822 exhaustion a second.
- **No difficulty setting**, so starvation is always lethal with no 1 HP floor, and the six-second
  post-hit wait stays six seconds where Minecraft's food clock uses ten.
- **No sprint-swimming**, so water always charges the swim rate rather than the sprint rate.
- **Shearing charges mining's 0.005**, and the row for it in the shears table used to say 0.05.

### Notes for whoever picks this up next

- `__voxelcraft.hunger()` gained `saturation`, `biteCost` and `jittering`; `setSaturation()` is
  new; `setHunger()` drags saturation down with a lowered bar instead of leaving an invisible
  cushion on an empty stomach; `stats().health` reports saturation next to food and exhaustion.
- `simulate()` runs `updatePlayer` and nothing else, so the swing cooldown never cools under it:
  25 swings in a row need `player.attackCooldown = 0` between them, or 24 of them quietly miss and
  charge nothing. `tick()` runs the whole loop, which is a trap of its own — a wounded player at a
  full bar with saturation left mends through the boost mid-measurement and burns the very
  saturation being counted. Pin health, or make movement the only exhaustion source.
- Judge distance per frame. Endpoint distance under-reads a curving run badly enough to make a
  correct 0.1-per-block rate look like 0.45, and a run that wanders into water pays the swim rate
  for those metres, so track `player.inWater` per frame or the totals will not close.

## Apple addendum — the food that falls out of a tree

Every calorie the game had before this passed a workshop: wheat needed a hoe, a furrow and ten
minutes; bread needed three of those loaves and a crafting table; steak needed a cow and ten
seconds of furnace. An apple needs nothing, which makes it the first food a player finds by
accident rather than by plan.

### What changed

- An `apple` item at `kind: 'food'`: 4 hunger, 2.4 saturation, stacks to 64, bitten in the usual
  0.6 seconds. Both food values are Minecraft's own.
- `APPLE_DROP_CHANCE = 0.025`, and one entry on the leaf block's own drop list:
  `{ item: 'apple', min: 1, max: 1, chance: APPLE_DROP_CHANCE }`. A leaf still never gives up a
  leaf block.
- The apple is a drop on a block definition rather than a case in the break handler, so every
  path that destroys a block owes the same roll — the pickaxe and a creeper crater included.
  That is what turned up the bug below.
- A 16×16 icon: a red body, 704 pixels of it, a notch at the top for the stem, one leaf leaning
  off to the right, a darker underbelly and a highlight down the left flank. Nothing falls back
  to the grey placeholder, and the slot reads `Apple`.

### The rate, measured

3,850 leaf blocks broken one at a time through `mine()` in one session, with the pack emptied
first so every apple had to be counted either in the pack or on the ground where it fell:

| | |
| --- | --- |
| Leaf blocks broken | 3,850 |
| Breaks that failed | 0 |
| Apples | 108 |
| Measured rate | 2.805% |
| Expected at 2.5% | 96.3, so 1.21σ away |
| Expected at Minecraft's 0.5% | 19.3, so 20.28σ away |
| Leaf blocks collected | 0 |

What a tree is worth, from 23 trees standing clear of every other trunk in their 9×9 footprint,
so their canopies could not be each other's:

| Canopy | Leaf cells | Apples at 2.5% | Apples at 0.5% |
| --- | --- | --- | --- |
| Lone oak, median | 96 | 2.4 | 0.5 |
| Lone oak, range | 69–175 | 1.7–4.4 | 0.3–0.9 |
| Jungle, counted in a ±4 box | 286 | 7.2 | 1.4 |

A lone oak's 96 leaves are close to a minute of punching them — 0.617 seconds a leaf once
Minecraft's six-tick gap between blocks is counted — or 45 seconds with a wooden hoe and six
with an iron one, whose 0.05 second break skips the gap entirely.
That is the whole case for 2.5%: Minecraft's rate pays half an apple per felled tree, which is a
statistic rather than a discovery, and this one pays two and a half, which is a reason to clear
the canopy before walking on.

### A blast owes the same roll as a pickaxe

Explosions build their drop list in their own loop, and that loop read `min` and `max` off every
drop and ignored `chance`. Grass has carried a 25% seed drop since the farming pass, so for all
that time a creeper landing in a field paid 1–2 seeds for *every* grass block in its crater
rather than a quarter of them. Apples would have made it impossible to miss: one apple for every
leaf in the canopy. The loop now skips a conditional drop exactly as `breakBlockAt` does.

Three creepers detonated, each inside a shell of leaves built from the canopy air around it, with
the cells they and the player stand in left open:

| Blast | Blocks destroyed | Dropped | What the roll predicts |
| --- | --- | --- | --- |
| Leaves | 68 | 2 apples, 0 leaf blocks | 1.7 apples |
| Grass and dirt | 24 grass, 56 dirt | 6 seeds, 83 dirt | a quarter of the grass, 1–2 seeds each |

Before the fix those two rows read 68 apples and between 24 and 48 seeds. The dirt comes in three
over the 80 cells the snapshot held, because the cells left open for the two parties to breathe
were also in the crater and also dropped their dirt, and were never in the snapshot.

### Eating one

| Stomach | After the bite | |
| --- | --- | --- |
| Food 1, saturation 0 | Food 5, saturation 2.4 | Every point lands, none of it capped away |
| Food 16, saturation 0 | Food 20, saturation 2.4 | The same, with saturation sitting just under its ceiling |
| Food 20 | Refused | `You're already full`, and the apple stays in the hand |

The cushion spends in Minecraft's order, and a 2.4 saturation apple is small enough to watch it
happen. After an apple at food 16, a wounded player at pinned health spends exhaustion one wound
of 0.1 at a time, and touches no food until the fourth whole bite:

| Wounds taken | Saturation | Food |
| --- | --- | --- |
| 0 | 2.4 | 20 |
| 40 | 1.4 | 20 |
| 80 | 0.4 | 20 |
| 120 | 0 | 20 |
| 160 | 0 | 19 |

It ends on food 19, saturation 0, 2.0 exhaustion banked and the bar jittering. A crossing spends
one point of saturation *or* one of food, never a split of the two, so an apple's 2.4 saturation
buys exactly three crossings — twelve exhaustion — and the third of them spends 0.4 of a point as
though it were a whole one and lets the other 0.6 go.

### Divergences left in place on purpose

- **2.5% rather than Minecraft's 0.5%**, five times the rate, because a food nobody ever finds is
  indistinguishable from a food that does not exist. The food values themselves are untouched.
- **Every leaf block rolls.** Minecraft gates apples to oak and dark oak; jungle, birch and
  spruce never drop one. There is one leaf block here, written by both the oak-shaped and the
  jungle-shaped tree, so the 286-cell jungle canopy measured above rolls apples too. Gating it
  would mean working out which tree a canopy belongs to, which has no honest answer for a canopy
  overhanging a neighbour's chunk or for leaves the player set down by hand.
- **Apples cannot be farmed.** There are no saplings, so the canopy is the only source and the
  supply is whatever the forest that generated happens to hold. It is what keeps a 2.5% rate from
  turning into an orchard.
- **No other use at all.** Not fuel, not smeltable, not an ingredient. Food or nothing.

### Notes for whoever picks this up next

- Sum `count`, not entity length. An `itemEntities` entry is a stack: three apples on the ground
  are one entry. Add the pack on top of that, because anything that lands within 2.5 m of the
  player is already picked up by the time the trial looks.
- Filter fresh drops by `serial`. Clearing the inventory does not clear the ground, and the
  previous round's apples drift into this round's total.
- A creeper sealed inside a leaf shell suffocates before it ever lights. The mob list goes quiet
  about six and a half seconds later, not one block has moved, and the run reports an explosion
  that destroyed nothing — which is exactly the shape of a false pass. Leave the cells within
  about 1.2 m of both the creeper and the player open, and watch `fuse` rise rather than only
  checking that the mob disappeared.
- Scanning down from the top of the world for a tree finds the top of a canopy, after which the
  trunk is always below where the scan started and never gets found. Walk up from
  `sampleColumn(x, z).height` instead.

## Water flow addendum — the sea runs when you break it

Water used to be a statue. Dig one block into the side of a lake and the lake stayed exactly where
it was, holding a wall of water up in the air where the shore should have slumped. This adds the
level-based flow that was always meant to be under the block: water finds its own level, in the
player's session rather than at generation time.

### What changed

- Depth is stored in the block id, the way wheat stores its growth stage. `WATER` is a source;
  `WATER_FLOW_1..7` are resting sheets, rank 1 the deepest and 7 a film; `WATER_FALL_1..7` are
  falling water carrying its own rank. Fifteen states in all, appended at the end of `BLOCKS` with
  their ids appended at the end of `B` — ids are storage, so nothing may ever be inserted in the
  middle.
- One rule decides everything: **a cell's rank is the shortest path cost from a source, where a
  step sideways costs a depth and a step down costs nothing.** A source hands depth 1 to whatever
  falls into the cell below it, and a fall feeds nobody sideways — falling water is on its way
  somewhere, it is not a supply. The pour threshold is rank ≤ 7, so a film ends instead of pouring
  off the edge of the world.
- Sources are placed, never bred. The usual "two flowing sources meeting make a source" shortcut
  was tried and printed a permanent sea source into a shore notch on the very first dig, which then
  flooded the notch forever. Worldgen and the player are the only things that make a source.
- The simulation is reactive and never global. An edit queues the cells around it
  (`queueWaterAround`, called from both `setBlock` and `setBlocksBatch`) and nothing else is ever
  looked at, so the ocean that has stood for ten minutes costs nothing per frame. Resolution is
  batched Jacobi: every read sees start-of-tick state and the whole batch of edits lands at once,
  so the order cells come out of the queue cannot change the result.
- Water only moves into air. Crops, torches and plants are never displaced, and solid ground is
  never converted.
- A cell whose neighbour chunk is not loaded retries twelve ticks and then leaves the queue without
  leaving the simulation: it is parked against its own chunk (`parkWater`). Dropping it was a real
  bug, not a corner case — a flood that ran off the edge of the loaded world stayed off it forever.
- **A chunk arriving is a wake-up call.** `wakeWaterOnArrival` runs wherever a chunk finishes
  generating and does two jobs. It re-queues parked cells, in the arriving chunk and its four
  orthogonal neighbours — a cell can only ever wait on those, never on a diagonal one. And it wakes
  saved water around the overrides the chunk restored, because a save taken mid-pour has water that
  is genuinely flowing and a queue that was never saved: reload it and the pour is frozen where it
  stopped. An `AIR` override only wakes its neighbourhood when it touches water, which is what keeps a
  world the player drained by hand from waking itself on every chunk. Both halves cost nothing on an
  untouched map, because watergen is already a fixed point: rousing all 6,508 loaded ocean sources in
  a fresh world inserted 17,317 queue entries, ran 45 ticks and changed no cell, world hash
  unmoved.
- Drying a flow cell writes an `AIR` override rather than deleting the override, so the base map
  stays untouched. That costs save bytes on purpose; `SAVE_SCHEMA` is still `v4`. Old saves keep
  reading: id 42 changes meaning from "generic falling water" to "rank-1 falling water".

### Why it is allowed to cost

| Rig | Ticks | Cells changed |
| --- | --- | --- |
| Shelf over open sea, source at one end, pours off both | 16 | 273 |
| 9×9 deck 20 blocks above the sea, source at the middle | 31 | 498, peak queue 140 |
| Same deck left idle after settling | 1 | 0 |
| Same deck, source removed | 29 | drains to nothing |
| Sealed shaft, 5×5×10, source on top | 11 | 48 |
| Source sealed in solid rock | 1 | 0 |

The deck is the interesting row: 455.25 blocks of water poured out of one source cell and the
volume was byte-identical when the same rig was left running afterwards, because a settled sheet
with nothing feeding it is a fixed point. The sealed source is the other one worth reading — a
source in rock never asks to be anywhere, so it costs one queue entry and nothing else, forever.

The tick is 0.15 s with a budget of 512 cells, and remeshing after a flood is deferred through
`world.flowRemesh`, drained when the queue is idle: a flood can touch a hundred cells and chunk
meshes cost about 13 ms each, so meshing inline stalls the frame it happened in.

The worst frame a flood can force is one tick. The frame loop clamps `dt` to 0.1 s and a tick is
0.15 s, so `updateWater`'s catch-up loop can never reach more than one step in a frame however long
the stall was. A 2,528-cell hole carved into the shore across nine chunks in one batch settled in 34
ticks, with ticks averaging 11.5 ms and peaking at 14.3 — 512 cells of resolution plus two chunk
meshes, so one dropped frame at 60 fps during a very large flood and nothing worse. The 141 ms that
same dig spent inside `setBlocksBatch` is not the flow's doing: it is 2,500 edits, and it costs the
same in dry stone.

### Generation stays dry

Caves are still air, and now nothing lets the simulation undo that from the other side.
`cutOpensSea` refuses a carve at or below sea level when the cell overhead, or the neighbouring
column, is flooded down to that height. Before that, generation could open a sea into a cave and
the player's first visit would spend the next few seconds quietly draining the ocean underground.
Measured afterwards: no untouched air cell between y16 and y48 touches a source any more (it was
115 in the sample), and average chunk generation is 5.7 ms.

### The renderer had to follow

This is not polish, it is correctness: a rank-7 sheet drawn as a full cube is a staircase.

- A cell draws its surface at `(8 − rank)/8` of the cell, and a grid corner takes the average of
  the water cells that meet there. Both neighbours read the same number for a corner they share, so
  a deep cell and a shallow one slope into each other instead of leaving a step.
- Only the top of a body of water draws a surface. Resting water above a cell presses it up to its
  ceiling and seals that ceiling, which is what makes a stack read as one surface.
- A stream pouring past is the exception, twice over. It does not press the pool it lands in up to
  a full block — that was a grey slab at the foot of every waterfall — and the pool keeps a surface
  of its own, because a body with no surface at all is a window straight down to the seabed. Both
  bugs were visible in the same screenshot.
- A stream is drawn down to the surface it actually lands on, so the ribbon reaches the pool
  instead of stopping a block short of it. Measured on the seam between a rank-7 fall and the film
  it lands in: one skirt 49.000–49.125, the stream above it 49.125–51.000, meeting exactly.

Verified as two invariants over the whole loaded world rather than by eye: 4,903 columns of water,
every one of them with a surface drawn inside the span its water occupies; and 9,854 surfaces
inside bodies, none of them below the top cell of the body that owns it. The second one is the one
that matters with a transparent material — a plane buried inside a body shows up as a seam.

### Where it under-fills, on purpose

A fall feeds nobody sideways, so the only thing that carries water sideways is a resting sheet. That
is paid for whenever a dig is deeper than one block. Cutting a five-by-three channel into the shore
beside a source floods the floor row with the correct 1..6 gradient, sends a two-cell waterfall down
the entry column, and leaves the rows above the floor dry — 5.125 blocks of water in fifteen cells of
empty space below sea level, where Minecraft would fill the channel to the surface.

It is left that way deliberately. Letting a fall feed sideways at its own rank would fill those rows,
and rank would still be a shortest-path cost from a source, but it would also make every waterfall
spray sideways off the wall it is pouring down, and an early version of that rule never converged at
all — 163,000 changes in 1,200 ticks, because generic falling water reported itself as depth 1 and
invented water at the bottom of every column. What the rule gives up is water in the wrong place. What
it keeps is the part the player judges: nothing is ever left unsupported, nothing floods further than
it should, and every dig reaches a fixed point. Pull the floor out from under a settled sheet and it
runs off into the hole; plug a breach and the notch it was feeding drains back; settle a trench in two
halves and it is byte-identical to the same trench dug in one.

### The neck that would not settle

A screenshot of water hanging frozen over a hole dug under the shoreline looked like the under-fill
above, and was not: the water was caught mid-loop. A breach exactly two blocks deeper than the water
standing over it leaves one cell of air between a source and the sheet beneath it, and that cell
belonged to no rule in `desiredWaterLevel`. It was not the foot of a fall — a resting sheet was below
it, not ground — it had no neighbour to thin from, and "a fall arriving overhead" did not cover a
source, which is the very thing pouring. So it fell through to `return B.AIR` and deleted itself. The
sheet it had been feeding was then a closed loop, thinned a rank a tick until it was a film and then
air, and the fall re-formed to start again: four ticks, 0.6 s, forever. One cell changing per tick in a
shaft, `queued` pinned at 95–117, and a chunk kept in `flowRemesh` so a 13 ms mesh rebuild came back
into the frame budget every tick. A 13×3 trench blown out under the shore spent 15,069 changes on 120
seconds of ticks and settled on nothing.

Since the sea's sources only exist at and below `SEA_LEVEL`, this was specifically a below-sea-level
bug: digging down under the shore hit it, digging one block deep never did.

The fix is one clause: overhead counts as pouring in when it is a fall *or the source a fall came
from* (`fallsIn`). The alternative, letting a fall feed sideways, is already ruled out above. Afterwards
the same rigs settle in two or three ticks and stay: a two-deep shaft holds `source / fall / rank-1
pool`, the trench holds a fall under each source with the row above the floor dry beside it and a `1..6`
gradient along the floor, `queued`, `parked` and `remeshing` all reach zero, and 400 further ticks
change nothing. Pull the sea out from over it and the whole flood leaves down to no water at all, which
is the check that the fix invents none.

`__voxelcraft.waterFlowCheck()` keeps it. It builds its rigs in a world of its own — `world.getBlock`
is shadowed by a lookup into a map, the tick is replayed there, and no chunk, override or save is
touched — and runs six cases: shafts one, two and three blocks under a source, a breach under the sea,
the same breach draining when the sea is pulled out, and a sheet running off a shelf and over a ledge.
Each has to reach a state it no longer wants to leave, in the shape it is supposed to reach, and the
sealed shafts have to hold exactly the volume their ranks account for. It costs about 11 ms. Restoring
the old `fallsIn` turns the two-deep shaft and the breach into cases that run out the 200-pass limit
without settling, so the check fails on exactly the bug it was written for.

### Verified at the edges

- Reads below the world floor come back solid and reads above the ceiling come back air, so a source
  placed on the bottom of the world rests there instead of pouring into the void, and one placed at
  the very top pours down a shaft and pools at the bottom of it. Both converge and both are
  idempotent.
- Sky light reaches 15 all the way down a forty-five block column of falling water, exactly as it does
  down the identical dry shaft beside it. That is the licence for flow edits skipping lighting
  altogether: air and water are both transparent here, so neither can be the thing that changed the
  light.
- A sweep of every loaded water mesh — 21 chunks, 4,462 triangles — found no degenerate triangle and
  no non-finite vertex, including at the lips where a deep sheet steps down into a shallow one. A
  nineteen-cell falling column draws eight side triangles per cell and no interior surface at all.

### Left for later on purpose

Cosmetics: fresnel, foam at the waterline, animated UVs, caustics, the underwater tint. Flow first,
because none of it is worth doing on a surface that is in the wrong place.

## Bucket addendum — take it with you

Buckets landed: smelt the iron, fold three ingots into a V, dip the empty in a
source, carry the full one back and put the water down somewhere else.

### What changed

- Two items, `bucket` (stacks to 16) and `water_bucket` (one to a slot), painted
  on the same silhouette so the only difference you have to read is the brim.
- One shaped recipe, `['I.I', '.I.']` in the 3x3 — three ingots and no sticks,
  the V that the painted item is drawn as. It is the last entry in `RECIPES`.
  `matchRecipe` returns the first pattern that fits and its shapeless branch only
  compares which ids are present, not how many, so a shapeless bucket would have
  claimed three loose ingots off any grid that had them and starved the recipes
  that want those ingots for themselves. Shaped, it cannot.
- Water is still `breakable: false`, which is what it always was, so the bucket
  is the only way to move it and a right click is the only way to fill one. That
  is Minecraft's arrangement rather than a shortcut: you cannot mine the sea, you
  dip a bucket in it. Nothing about the break path or the drop rolls changed.
- Right click is dispatched to `tryUseBucket` from inside `tryPlaceSelectedBlock`,
  after the hoe and the seeds, so an interactive block keeps first refusal: a
  crafting table behind a puddle opens rather than flooding.

### The water rules

A bucket drinks only from a full source (`waterLevel === 0`). A ripple that has
run out from its shore stays where it is, because lifting one of those would
empty the wrong cell and leave the sheet hanging in the air behind it. Lifting a
source is what makes a well that never runs dry: the cells beside it pour into
the hole the moment the cell itself goes.

Pouring puts a full source in the cell the crosshair points at, provided that
cell is air or water already — the same room rule as any other placement. There
is no test for whether that cell is the one you are standing in: pour at the face
under your feet and the water arrives around your ankles, as it does in Minecraft,
and the swimming code is there for exactly that. `world.setBlock` wakes the flood
on its own, which is the whole reason a poured source starts spreading without a
line added anywhere in the flow code. And a poured source is a source in every
way the simulation cares about, so the same bucket will drink from it again.

### Checked in the world

Driven through `window.__voxelcraft` against a flat stone platform built for the
purpose, one observation at a time:

- Three ingots in a V at the table craft one bucket. The same grid minus the
  middle ingot, laid out in the 2x2, still reads as shears, so the new pattern
  shadows nothing that came before it.
- Three empties in hand, dipped in a source: two left in the hand, the full one
  gone into the next free slot. One empty in hand takes the water into its own
  slot instead.
- A level-7 sheet refuses the bucket and stays where it is, and so does dry
  ground. A stone fence put between the hand and the source refuses it too, and
  the very same aim works again the moment the fence is pulled out.
- A poured bucket leaves a source in the cell over the face that was aimed at and
  hands back an empty, and that fresh source is drunk again a moment later with no
  complaint.
- A crafting table with water behind it opens the crafting screen and pours
  nothing, which is the whole reason the bucket is asked last.

### Divergences left in place on purpose

- A bucket finds water with `raycastWater`, a second walk of the same ray that
  the highlight uses. The block ray treats water as see-through, and the water is
  exactly what the bucket wants to see, so it gets its own accept test over the
  same grid walk. It stops at the first solid, so a pond under a plank is still
  out of reach.
- No lava bucket, because there is no lava in the world yet, and no water
  bottle, because nothing in the game is drunk. `raw_iron` and the furnace were
  already there, so the ingots the recipe wants cost nothing new.
- Nothing in the world hands a bucket over: no mob, no chest, no ore, no
  generated structure. `spawnItemDrop` is there and one `drops:` entry on a block
  would change that, but for now a bucket is crafted or it is not.
- Only a water bucket exists. When a second filled bucket arrives, `tryUseBucket`
  is the table to grow rather than the dispatch inside `tryPlaceSelectedBlock`.

### Notes for whoever picks this up next

- `RECIPES` gained one entry and mine closes it; the bed that used to close it
  now ends with a comma. The tool and armour recipes are pushed on after the
  literal list, so the array is longer at runtime than it looks in the source.
- The water addendum's model is untouched: a bucket only ever writes the source
  id or takes it away, and the flow code never learns a bucket exists.
- Two ids rather than one id and a flag, because the save record, `stacksMergeable`
  and `tryUseBucket` all read the id. A metadata bit would have had to be
  threaded through every one of them to mean what the id already means.
- `tools/check-syntax.sh` is still the only check in the repo, and it passes.

## Chest addendum — a box that keeps what you put in it

Chests landed: eight boards ringed around an empty middle at the table, placed
with the lock toward whoever placed it, and twenty-seven slots that wait for you
to come back.

### What changed

- One block, `B.CHEST` (49): hardness 2.5, an axe is the fast tool, and no
  `tier`, so a bare hand takes it apart in 3.75 s and still gets the box back —
  0.625 s with an iron axe. That is Minecraft's arrangement rather than a
  shortcut: a chest asks for no pickaxe, and the furnace next to it, which does,
  is the contrast worth having in the world.
- Structurally it is a furnace. `facings: true` turns the front tile to face the
  placer, and `blockEntity: 'chest'` puts its contents in `world.blockEntities`
  beside the furnaces rather than in a map of their own. One id and no lit
  variant, because nothing about a box changes once it is set down.
- Three tiles: `chest_top`, which is also the bottom, `chest_side` and
  `chest_front`, all three painted from one shared body — lid boards lying flat
  over a dark seam, upright planking below, corner battens down both edges and
  along the foot. The front adds an iron strap running down from the lid's edge
  into a lock plate with a keyhole punched through it, and the top tile carries
  that strap's last two pixels along its own front edge, so the two faces line
  up on the corner. The item icon needed no work: block items draw themselves as
  the isometric cube, and that reads as a chest the moment the tiles exist.
- One recipe, `['PPP', 'P.P', 'PPP']` in the 3x3, and it is the last entry in
  `RECIPES` — the bucket's V now ends with a comma. Eight boards around a hollow
  centre, because the box is all walls and the gap is how things get in. Like the
  bed and the bucket it is three cells across, so the 2x2 in your pocket cannot
  fold one.
- Twenty-seven slots, opened by right click from the same place the crafting
  table and the furnace are asked, ahead of any block placement. The panel puts
  the box's three rows above Storage in the left column, the way Minecraft
  stacks them, and keeps the armour column and the 2x2 grid every other screen
  already carries. The 3x3 stays home: a chest screen that also opened a table
  would be a second screen wearing the first one's clothes, and the box is the
  thing being looked at.
- Shift-click reads which hand it came from. From the pack it goes into the box
  through `mergeStackInto`, the same helper the pack's own shift-click uses, so
  it tops up what the chest already holds and then claims a free row for the
  rest; only when the box has nowhere to put it does the stack stay in the pack,
  rather than trading hotbar rows the way a shift-click with no chest open
  would. From the chest it goes to the pack as it would from any container.
  Armour shift-clicked out of a chest goes onto your back, which is what the
  shift key already means for armour.
- Two sounds, both one-shot noise. The lid is a bandpass rising from 480 to
  1040 Hz over a low 128 Hz knock; the shut is one short falling lowpass knock
  where that rise ended. Both are asked for at the block's centre with a 20 m
  range, so a chest across the clearing opens quietly and one at your feet does
  not, and each gets a small random pitch so the fifth one in a row is not the
  first one again.
- Breaking a chest hands over its contents and then itself.
  `spillBlockEntityContents` — which was `spillFurnaceContents`, and is now the
  same four lines for both kinds — dumps every slot as a real item drop before
  the block's own `drops:` entry adds the box. A creeper owes the same roll as a
  pickaxe, so the explosion path calls it too.
- The save grows one sibling of the furnace list: `entities.chests`, one flat row
  per box of `[x, y, z]` and then twenty-seven id and count pairs, 57 fields
  whether the box holds one diamond or nothing at all. `SAVE_SCHEMA` stays at 4:
  a world written before this addendum loads unchanged and simply has no chests
  key, and a world written now carries one extra key.

### Checked in the world

Driven through `window.__voxelcraft` the way the bucket was, one observation at a
time:

- Eight planks in a ring at the table craft one chest. Seven do not, and the ring
  missing its centre is what makes it a chest rather than nine.
- Placing it against the top face of a block puts the box there with its front
  normal pointing back at the placer, and the same aim from the other side
  records the opposite normal. Two boxes in the world read back as two rows from
  `chestList`, each with its own facing.
- Shift-clicking 10 wheat into a chest holding 60 leaves 64 in the first slot, 6
  in the next row and an empty hand. Filling all twenty-seven rows with cobble
  and shifting a further 30 wheat at the box leaves the wheat where it was and
  the box at twenty-seven used slots.
- Shift-clicking an axe out of the box puts it in the pack; shift-clicking an
  iron chestplate out of it puts it on, defence reading 6 afterwards. Clicking an
  empty chest slot does nothing at all, which is worth writing down only because
  it is the one click that moves nothing and still marks the save dirty.
- Breaking it bare-handed yields cobblestone x40, iron_ingot x5 and the chest
  itself as three separate drops on the ground, all three pickable, with nothing
  left in `world.blockEntities` at that position.
- A save with a chest in it writes 859 bytes, its chest row 57 fields long, and a
  reload of that save brings the box back with its facing and both stacks in the
  same rows they were left in.
- The panel closes itself if the box goes away underneath an open screen —
  measured by deleting the block and letting the next render notice, which left
  no screen and, through `returnCursorStack`, handed back the three diamonds that
  were still on the cursor from a gamepad pickup. Walking the pad cursor over a
  chest screen starts at `chest:0`, walks the three rows nine wide, and steps off
  the bottom of the lid into Storage rather than sideways into the armour column.
- The furnace screen is untouched by all of this: three furnace slots, no chest
  slots, its own title, and coal lighting raw iron with the burn counter running
  while the screen sits open.

### Divergences left in place on purpose

- Nothing in the world hands a chest over. No mob carries one, no structure
  generates one, no ore yields one, so the bucket addendum's line about there
  being no chest to loot is still true in the only way it can be now: chests
  exist, and the world gives you none of them for free. Loot chests want a
  structure to sit in, and there are still no structures.
- Contents do not ride on the item. A chest that comes back out of the ground is
  an empty box, because its things were spilled as drops on the way out and are
  lying there if you were quick enough. Carrying a loaded chest around in one
  slot would want a stack payload, which is the same machinery a loot chest
  would want, and neither is worth inventing before there is a reason.
- No lid animation, no double chest, no lock. The lid is paint: the front tile is
  drawn shut and stays shut, and the creak is the only thing that says otherwise.
  Double chests want a merge rule for two neighbours that Minecraft itself only
  approximates.
- A chest never ticks. `updateFurnaces` became `updateBlockEntities` and still
  looks only at things within `BLOCK_ENTITY_TICK_RANGE` (32) of the player, plus
  the furnace whose screen is open; a chest's whole share of that work is the
  stale-state sweep, which clears a box's contents if the block under it is gone.
  Opening a chest screen therefore pauses the world the way the inventory does,
  where the furnace screen alone keeps something running.
- A schema-4 save written by this build will still load in a build from before
  it — same schema, same seed — and that older build will silently forget what
  was in the boxes, because it never reads a `chests` key. The schema number is
  a compatibility promise in one direction only, and this is what breaking it
  looks like. Bump `SAVE_SCHEMA` if chests ever have to be made load-bearing.

### Notes for whoever picks this up next

- A container screen has to register itself in five places, and this addendum
  touched all five: `openScreen`'s accept list and its "is there still a block
  here" guard, `screenGridFor`, `quickMoveStack`'s two direction tests,
  `handleScreenSlotClick`'s `markSaveDirty` line, and `renderScreen` — plus
  `padSections` for the D-pad and `buildStorageColumn(withChest)` for the grid
  itself. A barrel wants the same list and nothing else.
- `buildStorageColumn` is the only place the chest grid is drawn and
  `padSections` the only place it is walked, so both know about the chest screen
  by name. If a second container arrives, that pair is the thing to fold into a
  table rather than to copy a third time.
- A chest's contents survive only while the saved block diff still says a chest
  stands at that position — the same witness rule the furnaces use, and for the
  same reason: at load time the chunks are not made yet, so `world.overrides` is
  the only thing that can answer the question.
- A chest state created by an old save whose block has since gone is cleared the
  first time the player comes within 32 m of the empty spot, and not before. Far
  away, stale rows sit in `world.blockEntities` harmlessly, and they cost nothing
  but the map entry.
- `createBlockEntity` reads `CHEST_SLOTS`, which is declared a few hundred lines
  later. That is safe only because worldgen and the game loop run at the end of
  the file; moving the init block up would turn it into a temporal-dead-zone
  error at the first chest.
- The debug API grew `openChest(x, y, z)`, `chest(x, y, z)`, `chestList()` and
  `setChestSlots(x, y, z, rows)`, where a row is either `'wheat'` or
  `['wheat', 12]`. `setChestSlots` overwrites all twenty-seven slots rather than
  merging into them, which is what makes it useful for setting up a check: pass
  fewer than twenty-seven rows and the rest come back empty.
- `tools/check-syntax.sh` is still the only check in the repo, and it passes.

## Audio addendum — a sound does not get to end the frame

Added after the chest one, when a scripted run turned up a `TypeError` from
`audioConnectOutput` on a frame where nothing about the sound was wrong.

### What broke

Every number the audio layer hands an `AudioParam` comes out of the position of
something, and a position is the least trustworthy number in the game. An
`AudioParam` rejects NaN and Infinity by throwing, and the throw is not local to
the sound: it unwinds the update loop that happened to be asking for a footstep,
so whatever else that frame owed is lost with it.

Two ways in, both reproduced against the build before this one, where all
fourteen named debug sounds threw in both states:

- A non-finite `yaw` with the sound a few blocks away. The pan is a projection
  onto the camera's right vector, so a broken heading makes the pan NaN and the
  throw lands on `panner.pan.value`. A sound at the listener's own feet is safe,
  which is why the `playSound` defaults never showed it.
- A non-finite camera. Every `dx`/`dy`/`dz` goes NaN, the falloff goes NaN, the
  level goes NaN, and the throw lands on `exponentialRampToValueAtTime` instead.

### The rule now

Nothing reaches a param raw. `audioNumber(value, fallback)` is a finite test with
a default behind it, and it sits in front of the pan in `audioConnectOutput`, the
duration/pitch/volume in `audioNoiseHit`, and the shape inputs in `audioTone`.
`audioSpatial` is the one that actually knows what a bad number means, so it
guarantees a finite `gain`, `pan` and `distance` for both sides of the
relationship: the sound's own position, and the listener's. A listener that is no
longer a place gets the voice at full level dead centre, which costs nothing that
can be heard — the alternative is a NaN that ends the frame instead. `yaw` is
handled the same way one step further down: a heading nobody can place by ear is
worth the same as no heading at all.

`range` gets the same treatment, because the falloff divides by it, so a NaN
range was quietly a NaN gain with a perfectly good position on both sides.

There is no `try`/`catch` around any of this on purpose. Falling back per number
keeps the graph honest — a centred voice is still a voice, and it is obvious in
the code which value was suspected — whereas swallowing a throw would hide which
coordinate slipped and leave a silent voice that reads as the sound not working.

### Where it still comes from

The fix is in the ear, not in the coordinate. Whatever slipped once — physics
that divided by a missing surface, a `look(NaN)` through the debug API — still
leaves the camera non-finite from then on, and rendering, raycasting and mob
steering see that just as plainly as the audio did. The chest checks ran into a
second version of this: `teleport(NaN, …)` wedges the page outright, because the
chunk loop around the player has no more opinion about NaN than the audio layer
used to. That is the place to look if a non-finite camera turns up again; the
audio is only where it used to show first.

### Checked in the world

- Before and after, same script: the previous build throws on all fourteen named
  sounds with a broken heading and again with a broken camera; this one throws on
  none of them, and plays them normally again afterwards.
- Stereo is unchanged: a sound 6 m to the right pans +0.72, the mirrored one
  −0.72, one directly behind 0. Distance is unchanged: the same break peaks at
  0.287 one metre away and 0.042 fourteen metres away.
- Bad inputs fall back rather than throw: NaN `pitch`, `durationScale`, `volume`
  and `range` all sound like their defaults; NaN and infinite sound coordinates
  are dropped the way the old NaN guard already dropped them.
- Mute still mutes, and the mob groan/hurt path that goes through `audioSpatial`
  outside the debug names is clean. No console errors on any of it, and
  `tools/check-syntax.sh` passes.

## Soil addendum — a furrow drinks from water within reach

Milestone 11 asked for two things before a crop would grow: a hoe'd furrow and a
seed in it. Minecraft asks for a third, and it is the one every farmer repeats —
the soil has to be wet. Wheat now waits for water the way it waits for daylight.

### What changed

- `FARMLAND_WET_REACH = 4` and `isFarmlandWet(x, y, z)` sit beside the other crop
  constants. `updateCrops` asks it one line after the light check, and a furrow
  that fails is simply skipped.
- No block id, no save field, no per-furrow moisture value. Wetness is a question
  asked of the world every tick, so a field wets and dries in the same frame the
  water moves and there is nothing to keep in step.
- Sowing dry soil still works, with a toast that says what is waiting: "Dry soil —
  crops wait for water within 4 blocks". The hoe and the seed keep doing exactly
  what they did; only the growth tick learned a new condition.
- `crops()` reports `wet` for every tracked crop and there is a new
  `soilWet(x, y, z)` for any furrow, so the rule can be read rather than inferred
  from what grew.

### The wetness rule

A furrow is wet when any liquid sits inside the 9x9 square centred on it, at the
furrow's own level or one above. Chebyshev distance, so the corner of that square
counts as much as the cell beside it, and one canal four blocks off keeps a whole
field alive. Any liquid counts, source or the last ripple of a sheet that has run
out from its shore, because the test looks at what is in the cell rather than at
how it got there — the sea, a bucket poured along the headland, and a puddle left
by a broken dam all water the same furrow.

One above is in the rule because Minecraft puts it there: a ditch dug one layer
over the tops of the furrows waters them, which is how a field is irrigated
without drowning it. One below is not, and that is the asymmetry that makes a
drained field mean something — water under the soil is a swamp, not irrigation.

### Divergences left in place on purpose

- Minecraft lets a bone-dry field creep along at a twenty-fifth of normal speed.
  Here a dry furrow stops outright. The slow crawl is invisible to a player who is
  timing nothing, and "it stopped because it is dry" is the rule people actually
  learn.
- Dry soil accepts the seed. Minecraft does the same, and refusing the click would
  punish the player for a mistake they have not made yet — the toast is the nudge
  instead, and it fires every time, including on a furrow that was wet a minute ago.
- An unloaded furrow reads as air, so `isFarmlandWet` answers dry for a field whose
  water is off-screen. That is the safe direction: `updateCrops` already skips
  chunks the player walked away from, so the field waits rather than dying, and the
  wetness test cannot be the thing that changes that.

### Checked in the world

Driven through `window.__voxelcraft` on a dirt platform built for the purpose at
y=75, noon, sky light 15 at every crop. The hoe, the seeds and the bucket were all
used through `tillDirt`, `plantSeed` and `use`, not by writing blocks:

- Two furrows tilled and sown on dry ground read `wet: false`, and 1200 growth
  ticks — twenty minutes of the crop clock — left both at stage 0. The same clock
  ripens a watered furrow, which is the point.
- A bucket poured into a hole four blocks off arrived as a source, handed back the
  empty, and `soilWet` read true in the same call. Two seconds of flow left it a
  single source with every neighbour still soil. That furrow went to stage 7 inside
  1200 ticks; a second furrow twelve blocks off stayed at stage 0, `wet: false`,
  the whole time.
- The reach box, each time a source sealed in soil and read at one furrow: same
  level four away wet, five away dry; four along z wet; corner four by four wet,
  corner four by five dry; one above the furrow wet; one below dry; two below dry.
  Nine by nine, two layers, no radius and no diagonal distance anywhere in it.
- With one source in the middle of a row of furrows, every cell from four blocks
  west of it to four blocks east read wet and the cell at five read dry — the
  nine-wide strip, measured rather than asserted. Twelve cells sown that way came
  up ripe: eight at stage 7 after 1000 ticks, and of the four sown on the far side
  three were stage 7 and one stage 6 after their own 1000. The growth roll is a
  chance per tick, so one lagging cell is noise, not reach. Three control cells at
  five and six blocks sat at stage 0, `wet: false`, through all of it.
- A half-grown crop stops and starts on cue. Watered, it reached stage 5 in 300
  ticks; the source was scooped back up with an empty bucket and the furrow read
  dry in the same call; 2000 further ticks left it at stage 5, same block id, still
  tracked, no wither. The water went back and 600 ticks ripened it.
- Standing 300 blocks away, `soilWet` on a watered furrow reads dry instead of
  throwing, 3000 growth ticks with the field off-screen left all eighteen tracked
  crops alive, and the walk back read it wet again.
- The old rules are untouched: a stage 6 crop disappeared on the next tick once its
  furrow was dug out from under it.
- `save()` afterwards: 1120 edits, 9779 bytes, "World saved just now", no console
  errors for the whole session, and `tools/check-syntax.sh` passes. Nothing in the
  save record changed shape — there is no moisture to write.

### Notes for whoever picks this up next

- `soilWet(x, y, z)` answers false for anything that is not a furrow, so it reads
  as "dry" when the real answer is "that is a dirt block". `crops()` carries the
  same flag next to the ground id for exactly that reason.
- `selectSlot(i)` goes through `selectHotbarSlot`, which folds with `i % HOTBAR_SIZE`.
  A main-inventory index does not reach the main inventory: index 27 selects slot 0.
  Scripted checks should stay inside 0..8 and read `heldItem().id` back.
- `lookAt` sets a direction, not a target. From an eye 1.62 above a flat surface,
  aiming at the centre of a block one cell away crosses the surface about 0.02 into
  the intended cell, which flips to the neighbour whenever a float disagrees. Aim at
  the lower half of the block instead and there is half a cell of margin.
- A scripted player standing in a cell that holds something — ripe wheat, a leaf —
  gets that very cell back from the raycast at distance 0, and every placement aimed
  through it is refused. That, and not the reach, is why test platforms want their
  working row clear to y=77.
- `tools/check-syntax.sh` is still the only check in the repo, and it passes.
