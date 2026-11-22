# Audio Credits and Sources

The active bank in `assets/audio/` is built from the CC0 packs below. CC0 does
not require attribution; this file exists so the provenance is auditable and so
the source of every file is easy to find. The two generated files are called
out separately.

The file-to-source mapping is in `tools/build-cc0-bank.py`. The conversion
(mono, trim, fade, 44.1 kHz one-shots / 22.05 kHz loops) is done by that script.

## Active bank — CC0

| Source | Author | Licence | Used for |
|---|---|---|---|
| [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Footsteps (grass, snow, wood, concrete/carpet), stone/wood/glass/soft impacts |
| [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney | CC0 1.0 | UI click |
| [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney | CC0 1.0 | Door, chest creak/latch, knife/shear |
| [Kenney Foley Sounds](https://gamesounds.xyz/?dir=Kenney%27s%20Sound%20Pack/Foley%20Sounds) | Kenney | CC0 1.0 (pack `readme.txt`) | Stone hits, sword/tool break, water fill/pour, the furnace woosh |
| Suno (generated for this project) | Project author | Own use | Scheduled music under `assets/music/`: “Daybreak's First Note” (dawn), “Midday Calm” (noon), “Dusk Chamber 1/2” and “Dusk Piano 1/2” (dusk), “Midnight Pulse 1” (midnight) |
| [Fantozzi’s Footsteps](https://opengameart.org/content/fantozzis-footsteps-grasssand-stone) | Fantozzi, submitted by qubodup | CC0 1.0 | Sand and stone footsteps |
| [Different Steps](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud) | TinyWorlds | CC0 1.0 | Dirt/mud, gravel, leaves footsteps |
| [Zombies Sound Pack](https://opengameart.org/content/zombies-sound-pack) | artisticdude | CC0 1.0 | Zombie voices |
| [Baby Animals - Sounds Pack](https://opengameart.org/content/baby-animals-sounds-pack) | Technopeasant | CC0 1.0 | Cow, pig, sheep, chicken |
| [Yak Imitation](https://opengameart.org/content/yak-imitation) | AntumDeluge | CC0 1.0 | Second cow variant |
| [80 CC0 creature SFX](https://opengameart.org/content/80-cc0-creature-sfx) | rubberduck | CC0 1.0 | Hurt, eat, death (the creeper fuse is synthesized) |
| [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) | rubberduck | CC0 1.0 | Explosion, bell, splash, slam |
| [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2) | rubberduck | CC0 1.0 | Swim strokes |
| [SpritePilot ambient loops](https://spritepilot.com/free-game-assets/sound-effects/ambient) | SpritePilot | CC0 1.0 | Wind, river/water, cave, campfire loops |
| [Underwater Ambient Pad](https://opengameart.org/content/underwater-ambient-pad) | isaiah658 | CC0 1.0 | Underwater ambient loop |

The old Kenney **Foley Sounds** pack no longer has a current page on kenney.nl;
the `gamesounds.xyz` mirror carries the original pack `readme.txt`, which
dedicates it to CC0. The files are used under that dedication.

## Synthesized in the game, not in the bank

Picking up an item, crafting, jumping, and opening and closing a screen have no
recording at all. `src/audio.js` plays each as one short sine tone with no
reverb: those five events fire far more often than any block or mob sound, and
every recording tried for them — a Kenney confirmation chime, that chime mixed
with a click for crafting, a Kenney woosh, a Kenney open/close click with a
rattle, a clatter of loose objects — was too bright or too long for that much
repetition. The files that held them are no longer in the bank.

## Generated files

`assets/audio/event_heartbeat_1.wav` and `assets/audio/mob_creeper_1.wav` are
synthesized by `tools/generate-audio.mjs` and are also CC0. The creeper fuse
has no matching recording in the CC0 packs, and it needs irregular sputter and
crackle that are easier to synthesize than to cut from a breath. The generated
fallback/reference bank in `assets/audio-generated/` is produced by that
script; its creeper slot is the source for the active one, and the rest is not
part of the active CC0 bank.

## What was changed

The source files were converted to 16-bit mono PCM WAV, with silence trimmed,
short fades applied, and one-shots limited to fit the game’s slots. Ambient
loops were resampled to 22.05 kHz and left untrimmed so they loop cleanly. The
original CC0 dedication covers these adaptations.

Eight slots were later dropped from the active bank: the two pickup recordings,
the crafting mix, the jump woosh, the screen open and close clicks, and the two
Kenney music loops that the scheduled `assets/music/` tracks had already
replaced. The first six are synthesized by the game; the music loops were simply
not played. The active bank is now 108 files.

No files from the unused source packs are redistributed in the active bank.
