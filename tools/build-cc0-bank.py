#!/usr/bin/env python3
"""Build VoxelCraft's active CC0 sound bank from downloaded source packs.

The active bank is `assets/audio/`. The generated fallback bank is kept in
`assets/audio-generated/` and is produced by `tools/generate-audio.mjs`.

This script expects a staging directory containing the source packs:

  staging/kenney/impact_sounds/
  staging/kenney/interface_sounds/
  staging/kenney/ui_audio/
  staging/kenney/rpg_audio/
  staging/kenney/foley_sounds/
  staging/oga/creature80/
  staging/oga/cc0-sfx-100/
  staging/oga/cc0-sfx-100-v2/
  staging/oga/different-steps/
  staging/oga/fantozzi/Fantozzi-footsteps/ogg/
  staging/oga/zombies/zombies/
  staging/animal/baby/            (Baby Animals sounds: Moo, Squeal, Bleat, Baa, Peeps)
  staging/animal/yak.ogg
  staging/spritepilot/spritepilot-sound-effects-ambient/ogg/ambient/
  staging/Underwater-Ambient-Pad.ogg

The source URLs and licences are in `CREDITS.md`. Every source file is CC0.
The script converts everything to 16-bit mono WAV so `decodeAudioData` and
GitHub Pages stay simple: 44.1 kHz for one-shots, 22.05 kHz for loops.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "audio")
GENERATED = os.path.join(ROOT, "assets", "audio-generated")
SFX_RATE = 44100
LOOP_RATE = 22050


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def convert_one(src, dst, max_seconds, volume=1.0):
    """Trim, fade and normalise one shot to 44.1 kHz mono PCM."""
    fade_out = max(0.0, max_seconds - 0.04)
    filters = [
        f"volume={volume}",
        "afade=t=in:st=0:d=0.004",
        f"apad=pad_dur={max_seconds}",
        f"afade=t=out:st={fade_out:.3f}:d=0.04",
        "alimiter=limit=0.95",
    ]
    run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", src,
        "-ac", "1", "-ar", str(SFX_RATE), "-t", f"{max_seconds}",
        "-af", ",".join(filters), "-c:a", "pcm_s16le", dst,
    ])


def convert_loop(src, dst, seconds, volume=1.0, crossfade=0.0):
    """Make a mono 22.05 kHz loop.

    With `crossfade`, fold the tail of the source over the head so a music
    track that does not end on its first sample still loops without a click.
    `seconds` is the source span consumed; the output is `seconds` minus the
    fade.
    """
    if crossfade <= 0:
        run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", src,
            "-ac", "1", "-ar", str(LOOP_RATE), "-t", f"{seconds}",
            "-af", f"volume={volume},alimiter=limit=0.95",
            "-c:a", "pcm_s16le", dst,
        ])
        return

    fade = min(crossfade, seconds / 4)
    loop_seconds = max(0.1, seconds - fade)
    graph = (
        f"[0:a]volume={volume},atrim=0:{seconds},asetpts=PTS-STARTPTS,"
        f"asplit=2[head][tail];"
        f"[head]atrim=0:{loop_seconds},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d={fade:.3f}[h];"
        f"[tail]atrim={loop_seconds}:{seconds},asetpts=PTS-STARTPTS,"
        f"afade=t=out:st=0:d={fade:.3f}[t];"
        f"[h][t]amix=inputs=2:duration=first:normalize=0,"
        f"alimiter=limit=0.95[aout]"
    )
    run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", src,
        "-filter_complex", graph, "-map", "[aout]",
        "-ac", "1", "-ar", str(LOOP_RATE), "-t", f"{loop_seconds}",
        "-c:a", "pcm_s16le", dst,
    ])


def make_tone(path, frequency, seconds, volume=0.5):
    run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration={seconds}",
        "-af", f"volume={volume},afade=t=in:st=0:d=0.01,"
               f"afade=t=out:st={max(0.0, seconds - 0.2):.3f}:d=0.2",
        "-ac", "1", "-ar", str(SFX_RATE), "-c:a", "pcm_s16le", path,
    ])


def convert_mix(sources, dst, max_seconds, volume=1.0):
    """sources: [(path, gain, delay_seconds), ...]"""
    inputs = []
    for src, _gain, _delay in sources:
        inputs += ["-i", src]
    graph = []
    for i, (_src, gain, delay) in enumerate(sources):
        ms = int(delay * 1000)
        graph.append(f"[{i}:a]volume={gain},adelay={ms}|{ms}[a{i}]")
    mix_inputs = "".join(f"[a{i}]" for i in range(len(sources)))
    graph.append(
        f"{mix_inputs}amix=inputs={len(sources)}:duration=longest:normalize=0,"
        f"volume={volume},afade=t=in:st=0:d=0.004,"
        f"apad=pad_dur={max_seconds},"
        f"afade=t=out:st={max(0.0, max_seconds - 0.04):.3f}:d=0.04,"
        "alimiter=limit=0.95[aout]"
    )
    run([
        "ffmpeg", "-y", "-loglevel", "error", *inputs,
        "-filter_complex", ";".join(graph), "-map", "[aout]",
        "-ac", "1", "-ar", str(SFX_RATE), "-t", f"{max_seconds}",
        "-c:a", "pcm_s16le", dst,
    ])


def build(staging):
    def s(*parts):
        return os.path.join(staging, *parts)

    def k(*parts):
        return s("kenney", *parts)

    def o(*parts):
        return s("oga", *parts)

    if os.path.isdir(OUT):
        for name in os.listdir(OUT):
            if name.endswith(".wav"):
                os.remove(os.path.join(OUT, name))
    else:
        os.makedirs(OUT, exist_ok=True)

    one = {}
    loops = {}
    mixes = {}

    # ---------- Footsteps ----------
    for i, name in enumerate(["StoneL1", "StoneR1", "StoneL2", "StoneR2"], 1):
        one[f"footstep_stone_{i}"] = (o("fantozzi", "Fantozzi-footsteps", "ogg", f"Fantozzi-{name}.ogg"), 0.45)
    for i, name in enumerate(["Fantozzi-SandL1", "Fantozzi-SandR1", "Fantozzi-SandL2", "Fantozzi-SandR2"], 1):
        one[f"footstep_sand_{i}"] = (o("fantozzi", "Fantozzi-footsteps", "ogg", name + ".ogg"), 0.45)
    for i, name in enumerate(["leaves01", "leaves02"], 1):
        one[f"footstep_leaves_{i}"] = (o("different-steps", name + ".ogg"), 0.4)
    one["footstep_leaves_3"] = (k("impact_sounds", "footstep_carpet_002.ogg"), 0.25)
    one["footstep_leaves_4"] = (k("impact_sounds", "footstep_carpet_003.ogg"), 0.25)
    one["footstep_dirt_1"] = (o("different-steps", "mud02.ogg"), 0.4)
    one["footstep_dirt_2"] = (o("different-steps", "gravel.ogg"), 0.4)
    one["footstep_dirt_3"] = (k("impact_sounds", "footstep_carpet_000.ogg"), 0.25)
    one["footstep_dirt_4"] = (k("impact_sounds", "footstep_carpet_001.ogg"), 0.25)
    for i in range(4):
        one[f"footstep_grass_{i + 1}"] = (k("impact_sounds", f"footstep_grass_{i:03d}.ogg"), 0.4)
        one[f"footstep_snow_{i + 1}"] = (k("impact_sounds", f"footstep_snow_{i:03d}.ogg"), 0.35)
        one[f"footstep_wood_{i + 1}"] = (k("impact_sounds", f"footstep_wood_{i:03d}.ogg"), 0.3)

    # ---------- Block break ----------
    break_sets = {
        "stone": [
            k("impact_sounds", "impactMining_000.ogg"),
            k("impact_sounds", "impactPlate_heavy_000.ogg"),
            k("foley_sounds", "Rocks", "stonesHit1.ogg"),
        ],
        "dirt": [
            k("impact_sounds", "impactSoft_heavy_000.ogg"),
            k("impact_sounds", "impactSoft_heavy_001.ogg"),
            k("impact_sounds", "impactSoft_heavy_002.ogg"),
        ],
        "grass": [
            k("impact_sounds", "impactSoft_medium_002.ogg"),
            k("impact_sounds", "impactSoft_heavy_003.ogg"),
            k("impact_sounds", "footstep_grass_000.ogg"),
        ],
        "sand": [
            k("impact_sounds", "impactSoft_medium_003.ogg"),
            k("impact_sounds", "impactSoft_medium_004.ogg"),
            o("fantozzi", "Fantozzi-footsteps", "ogg", "Fantozzi-SandR1.ogg"),
        ],
        "snow": [
            k("impact_sounds", "impactSoft_medium_001.ogg"),
            k("impact_sounds", "impactSoft_medium_002.ogg"),
            k("impact_sounds", "footstep_snow_000.ogg"),
        ],
        "wood": [
            k("impact_sounds", "impactWood_heavy_000.ogg"),
            k("impact_sounds", "impactWood_medium_000.ogg"),
            k("impact_sounds", "impactWood_light_000.ogg"),
        ],
        "leaves": [
            k("impact_sounds", "impactSoft_medium_000.ogg"),
            o("different-steps", "leaves01.ogg"),
            o("different-steps", "leaves02.ogg"),
        ],
        "glass": [
            k("impact_sounds", "impactGlass_heavy_000.ogg"),
            k("impact_sounds", "impactGlass_heavy_001.ogg"),
            k("impact_sounds", "impactGlass_medium_000.ogg"),
        ],
    }
    for material, files in break_sets.items():
        for i, src in enumerate(files, 1):
            one[f"break_{material}_{i}"] = (src, 0.5 if material != "glass" else 0.55)

    # ---------- Block place ----------
    place_sets = {
        "stone": [k("impact_sounds", "impactPlate_light_000.ogg"), k("impact_sounds", "impactGeneric_light_000.ogg")],
        "dirt": [k("impact_sounds", "impactSoft_medium_000.ogg"), k("impact_sounds", "impactSoft_medium_001.ogg")],
        "grass": [k("impact_sounds", "impactSoft_medium_002.ogg"), k("impact_sounds", "impactSoft_medium_003.ogg")],
        "sand": [k("impact_sounds", "impactSoft_medium_003.ogg"), k("impact_sounds", "impactSoft_medium_004.ogg")],
        "snow": [k("impact_sounds", "impactSoft_medium_001.ogg"), k("impact_sounds", "impactSoft_medium_002.ogg")],
        "wood": [k("impact_sounds", "impactWood_light_000.ogg"), k("impact_sounds", "impactWood_light_001.ogg")],
        "leaves": [k("impact_sounds", "impactSoft_medium_000.ogg"), k("impact_sounds", "impactSoft_medium_001.ogg")],
        "glass": [k("impact_sounds", "impactGlass_light_000.ogg"), k("impact_sounds", "impactGlass_light_001.ogg")],
    }
    for material, files in place_sets.items():
        for i, src in enumerate(files, 1):
            one[f"place_{material}_{i}"] = (src, 0.3 if material != "stone" else 0.35)

    # ---------- Mobs ----------
    one["mob_zombie_1"] = (o("zombies", "zombies", "zombie-1.wav"), 1.2)
    one["mob_zombie_2"] = (o("zombies", "zombies", "zombie-2.wav"), 1.2)
    baby = ("animal", "baby")
    one["mob_cow_1"] = (s(*baby, "Moo.ogg"), 1.5)
    one["mob_cow_2"] = (s("animal", "yak.ogg"), 0.6)
    one["mob_pig_1"] = (s(*baby, "Squeal.ogg"), 1.2)
    one["mob_pig_2"] = (s(*baby, "Squeal.ogg"), 0.8)
    one["mob_sheep_1"] = (s(*baby, "Bleat.ogg"), 1.0)
    one["mob_sheep_2"] = (s(*baby, "Baa.ogg"), 1.0)
    one["mob_chicken_1"] = (s(*baby, "Peeps.ogg"), 0.7)
    one["mob_chicken_2"] = (s(*baby, "Peeps.ogg"), 0.5)

    # ---------- Events ----------
    one["event_hurt_player_1"] = (o("creature80", "hurt_01.ogg"), 0.7)
    one["event_hurt_mob_1"] = (o("creature80", "hurt_02.ogg"), 0.7)
    one["event_eat_1"] = (o("creature80", "eat_01.ogg"), 0.7)
    one["event_eat_2"] = (o("creature80", "eat_02.ogg"), 0.7)
    one["event_swim_1"] = (o("cc0-sfx-100-v2", "sfx100v2_footstep_wet_01.ogg"), 0.5)
    one["event_swim_2"] = (o("cc0-sfx-100-v2", "sfx100v2_footstep_wet_02.ogg"), 0.55)
    one["event_door_1"] = (k("rpg_audio", "doorOpen_1.ogg"), 1.0)
    one["event_chest_open_1"] = (k("rpg_audio", "creak2.ogg"), 0.9)
    one["event_chest_close_1"] = (k("rpg_audio", "metalLatch.ogg"), 0.4)
    one["event_furnace_finish_1"] = (o("cc0-sfx-100", "bell_02.ogg"), 0.6)
    one["event_hoe_1"] = (k("foley_sounds", "Rocks", "stoneDragHit1.ogg"), 0.5)
    one["event_bucket_fill_1"] = (k("foley_sounds", "Water", "sinkWater2.ogg"), 0.8)
    one["event_bucket_pour_1"] = (k("foley_sounds", "Water", "sinkDrain1.ogg"), 1.2)
    one["event_shear_1"] = (k("rpg_audio", "knifeSlice.ogg"), 0.3)
    one["event_splash_1"] = (o("cc0-sfx-100", "splash_01.ogg"), 0.8)
    one["event_land_1"] = (k("foley_sounds", "Rocks", "stonesHit1.ogg"), 0.5)
    one["event_land_2"] = (k("impact_sounds", "impactSoft_heavy_000.ogg"), 0.5)
    one["event_land_3"] = (o("cc0-sfx-100", "slam_04.ogg"), 0.5)
    # The creeper fuse is synthesized rather than sampled: a lit fuse needs
    # irregular sputter and crackle, and no CC0 pack in the bank has a match.
    one["mob_creeper_1"] = (os.path.join(GENERATED, "mob_creeper_1.wav"), 1.55)
    # Picking up, crafting, jumping and opening or closing a screen are
    # synthesized in the game itself: each used to be a recording here, and every
    # candidate was too bright or too long for a sound that fires this often. They
    # have no slot in this bank.
    one["event_ui_click_1"] = (k("interface_sounds", "click_001.ogg"), 0.2)
    one["event_death_1"] = (o("creature80", "scream_02.ogg"), 1.2)

    with tempfile.TemporaryDirectory() as tmp:
        sub = os.path.join(tmp, "sub.wav")
        low = os.path.join(tmp, "low.wav")
        make_tone(sub, 48, 1.0, 0.55)
        make_tone(low, 92, 0.8, 0.35)

        mixes["event_explosion_1"] = (
            [(o("cc0-sfx-100", "explosion.ogg"), 1.0, 0.0), (sub, 0.65, 0.0)],
            1.2,
        )
        mixes["event_tool_break_1"] = (
            [(k("foley_sounds", "Swords", "swordStone3.ogg"), 0.9, 0.0),
             (k("impact_sounds", "impactMetal_light_000.ogg"), 0.4, 0.0)],
            0.5,
        )
        mixes["event_furnace_ignite_1"] = (
            [(k("foley_sounds", "Woosh", "woosh2.ogg"), 0.9, 0.0),
             (k("impact_sounds", "impactSoft_heavy_000.ogg"), 0.45, 0.0),
             (low, 0.55, 0.0)],
            0.9,
        )

        # ---------- Ambient ----------
        loops["ambient_wind_1"] = (
            s("spritepilot", "spritepilot-sound-effects-ambient", "ogg", "ambient", "wind.ogg"), 13.2, 0.8)
        loops["ambient_water_1"] = (
            s("spritepilot", "spritepilot-sound-effects-ambient", "ogg", "ambient", "river.ogg"), 13.2, 0.8)
        loops["ambient_cave_1"] = (
            s("spritepilot", "spritepilot-sound-effects-ambient", "ogg", "ambient", "cave.ogg"), 13.2, 0.8)
        loops["ambient_fire_1"] = (
            s("spritepilot", "spritepilot-sound-effects-ambient", "ogg", "ambient", "campfire.ogg"), 13.2, 0.8)
        loops["ambient_underwater_1"] = (s("Underwater-Ambient-Pad.ogg"), 16.67, 0.8)

        # ---------- Music ----------
        # The scheduled songs are whole tracks staged under assets/music/ and
        # fetched by the game outside this bank, so there is no music slot here.
        # The two Kenney loops that used to be built are gone: nothing plays them.

        # ---------- Build ----------
        for name, (src, seconds) in one.items():
            convert_one(src, os.path.join(OUT, name + ".wav"), seconds)
        for name, spec in loops.items():
            src, seconds, volume = spec[:3]
            crossfade = spec[3] if len(spec) > 3 else 0.0
            convert_loop(
                src, os.path.join(OUT, name + ".wav"), seconds, volume, crossfade
            )
        for name, (sources, seconds) in mixes.items():
            convert_mix(sources, os.path.join(OUT, name + ".wav"), seconds)

    # The one sound that is still better generated: the heartbeat.
    heartbeat_src = os.path.join(GENERATED, "event_heartbeat_1.wav")
    if os.path.exists(heartbeat_src):
        shutil.copyfile(heartbeat_src, os.path.join(OUT, "event_heartbeat_1.wav"))
    else:
        print("warning: generated heartbeat not found at", heartbeat_src, file=sys.stderr)

    files = sorted(f for f in os.listdir(OUT) if f.endswith(".wav"))
    print(f"wrote {len(files)} files to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", default="staging", help="directory containing the source packs")
    args = parser.parse_args()
    build(os.path.abspath(args.staging))
