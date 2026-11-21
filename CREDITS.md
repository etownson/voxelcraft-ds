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
| [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney | CC0 1.0 | UI click, open, close, confirmation, pickup |
| [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney | CC0 1.0 | Door, chest creak/latch, knife/shear |
| [Kenney Foley Sounds](https://gamesounds.xyz/?dir=Kenney%27s%20Sound%20Pack/Foley%20Sounds) | Kenney | CC0 1.0 (pack `readme.txt`) | Stone hits, sword/tool break, water fill/pour, whooshes |
| [Kenney Music Loops](https://gamesounds.xyz/?dir=Kenney%27s%20Sound%20Pack/Music%20Loops) | Kenney | CC0 1.0 (pack `readme.txt`) | `music_sad_descent_1` (“Sad Descent”) and `music_retro_mystic_1` (“Retro Mystic”), still in the bank but retired from the schedule |
| Suno (generated for this project) | Project author | Own use | Scheduled music under `assets/music/`: “Daybreak's First Note” (dawn), “Midday Calm” (noon), “Dusk Chamber 1/2” and “Dusk Piano 1/2” (dusk), “Midnight Pulse 1” (midnight) |
| [Fantozzi’s Footsteps](https://opengameart.org/content/fantozzis-footsteps-grasssand-stone) | Fantozzi, submitted by qubodup | CC0 1.0 | Sand and stone footsteps |
| [Different Steps](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud) | TinyWorlds | CC0 1.0 | Dirt/mud, gravel, leaves footsteps |
| [Zombies Sound Pack](https://opengameart.org/content/zombies-sound-pack) | artisticdude | CC0 1.0 | Zombie voices |
| [Baby Animals - Sounds Pack](https://opengameart.org/content/baby-animals-sounds-pack) | Technopeasant | CC0 1.0 | Cow, pig, sheep, chicken |
| [Yak Imitation](https://opengameart.org/content/yak-imitation) | AntumDeluge | CC0 1.0 | Second cow variant |
| [80 CC0 creature SFX](https://opengameart.org/content/80-cc0-creature-sfx) | rubberduck | CC0 1.0 | Hurt, eat, death (the creeper fuse is synthesized) |
| [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) | rubberduck | CC0 1.0 | Explosion, bell, splash, slam |
| [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2) | rubberduck | CC0 1.0 | Swim strokes, item pickup |
| [SpritePilot ambient loops](https://spritepilot.com/free-game-assets/sound-effects/ambient) | SpritePilot | CC0 1.0 | Wind, river/water, cave, campfire loops |
| [Underwater Ambient Pad](https://opengameart.org/content/underwater-ambient-pad) | isaiah658 | CC0 1.0 | Underwater ambient loop |

The old Kenney **Foley Sounds** and **Music Loops** packs no longer have current
pages on kenney.nl; the `gamesounds.xyz` mirror carries the original pack
`readme.txt`, which dedicates both to CC0. The files are used under that
dedication.

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
two music loops are the exception: neither Kenney track ends where it begins, so
`tools/build-cc0-bank.py` folds the last 0.75 s over the first 0.75 s and the
gain of each is set so both land at the same RMS — “Sad Descent” is about 8 dB
hotter than “Retro Mystic” as delivered, and dusk must not sound louder than
morning. The original CC0 dedication covers these adaptations.

No files from the unused source packs are redistributed in the active bank.
