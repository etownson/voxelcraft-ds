/*
 * The audio engine: a bank of CC0 samples with a synthesised fallback for
 * every one of them, the buses and voices that mix them, and the ambience
 * that listens to where the player is through audioListener.
 *
 * The layer never sees a player object. Sounds are given a position or take
 * the listener's, the pan is taken from the listener's heading, and the
 * frame that moves the player pushes what the mix should hear.
 */

import { BLOCKS, BLOCK_BY_KEY, isWater } from './blocks.js';
import { world } from './chunks.js';
import { B, EYE_HEIGHT, SEA_LEVEL, WORLD_HEIGHT, clamp } from './config.js';
import { camera } from './render.js';
import { clockHours } from './sky.js';

const AUDIO_DEFAULT_VOLUME = 0.7;
const AUDIO_DEFAULT_SFX_VOLUME = 0.6;
const AUDIO_DEFAULT_MUSIC_VOLUME = 0.5;
const AUDIO_MAX_VOICES = 40;
const AUDIO_NOISE_SECONDS = 2;
const AUDIO_ASSET_ROOT = 'assets/audio/';
/**
 * Every sampled one-shot is played through this trim, in one place, rather than
 * by editing twenty-odd call sites. The bank is a pile of independent CC0
 * recordings trimmed and normalised to roughly themselves, so it arrives louder
 * than the handful of synthesized blips the game now makes for its most frequent
 * events; pulling the whole sampled layer down together keeps the relative
 * shaping of the mix — a footstep still sits under a block break, an explosion
 * still dominates — while lowering the floor everything is measured against.
 *
 * It is deliberately only `audioSample`. The procedural fallbacks, the ambient
 * beds and the scheduled music are untouched, so on `file://`, where the bank
 * cannot load, the synthesizer plays at its own levels as before.
 */
const AUDIO_SAMPLE_TRIM = 0.5;
const AUDIO_SETTINGS_KEY = 'voxelcraft:audio:v1';

/** Build a list of `prefix1.wav`, `prefix2.wav`, ... */
function audioFileList(prefix, count) {
  const files = [];
  for (let i = 1; i <= count; i++) files.push(prefix + i + '.wav');
  return files;
}

/**
 * The sampled bank. Each key is the name callers ask for; the loader turns
 * every file in the list into an AudioBuffer and `audioSample` picks one at
 * random, which is what stops repeated footsteps from sounding mechanical.
 *
 * The bank is optional by design. If `assets/audio/` cannot be fetched (for
 * example when index.html is opened from file://), every `audioSample` call
 * returns false and the procedural synthesizer below takes over.
 */
const AUDIO_ASSETS = {
  footstep_stone: audioFileList('footstep_stone_', 4),
  footstep_dirt: audioFileList('footstep_dirt_', 4),
  footstep_grass: audioFileList('footstep_grass_', 4),
  footstep_sand: audioFileList('footstep_sand_', 4),
  footstep_snow: audioFileList('footstep_snow_', 4),
  footstep_wood: audioFileList('footstep_wood_', 4),
  footstep_leaves: audioFileList('footstep_leaves_', 4),

  break_stone: audioFileList('break_stone_', 3),
  break_dirt: audioFileList('break_dirt_', 3),
  break_grass: audioFileList('break_grass_', 3),
  break_sand: audioFileList('break_sand_', 3),
  break_snow: audioFileList('break_snow_', 3),
  break_wood: audioFileList('break_wood_', 3),
  break_leaves: audioFileList('break_leaves_', 3),
  break_glass: audioFileList('break_glass_', 3),

  place_stone: audioFileList('place_stone_', 2),
  place_dirt: audioFileList('place_dirt_', 2),
  place_grass: audioFileList('place_grass_', 2),
  place_sand: audioFileList('place_sand_', 2),
  place_snow: audioFileList('place_snow_', 2),
  place_wood: audioFileList('place_wood_', 2),
  place_leaves: audioFileList('place_leaves_', 2),
  place_glass: audioFileList('place_glass_', 2),

  mob_zombie: audioFileList('mob_zombie_', 2),
  mob_cow: audioFileList('mob_cow_', 2),
  mob_pig: audioFileList('mob_pig_', 2),
  mob_sheep: audioFileList('mob_sheep_', 2),
  mob_chicken: audioFileList('mob_chicken_', 2),
  mob_creeper: ['mob_creeper_1.wav'],

  event_hurt_player: ['event_hurt_player_1.wav'],
  event_hurt_mob: ['event_hurt_mob_1.wav'],
  event_explosion: ['event_explosion_1.wav'],
  event_eat: audioFileList('event_eat_', 2),
  event_swim: audioFileList('event_swim_', 2),
  // Picking up, crafting, jumping and opening or closing a screen have no slots
  // here at all: each is one tone built by its own `play…Sound`. Every recording
  // tried for those five was brighter and longer than a sound that fires this
  // often can be.
  event_door: ['event_door_1.wav'],
  event_chest_open: ['event_chest_open_1.wav'],
  event_chest_close: ['event_chest_close_1.wav'],
  event_tool_break: ['event_tool_break_1.wav'],
  event_furnace_ignite: ['event_furnace_ignite_1.wav'],
  event_furnace_finish: ['event_furnace_finish_1.wav'],
  event_hoe: ['event_hoe_1.wav'],
  event_bucket_fill: ['event_bucket_fill_1.wav'],
  event_bucket_pour: ['event_bucket_pour_1.wav'],
  event_shear: ['event_shear_1.wav'],
  event_splash: ['event_splash_1.wav'],
  event_land: audioFileList('event_land_', 3),
  event_ui_click: ['event_ui_click_1.wav'],
  event_heartbeat: ['event_heartbeat_1.wav'],
  event_death: ['event_death_1.wav'],

  ambient_wind: ['ambient_wind_1.wav'],
  ambient_water: ['ambient_water_1.wav'],
  ambient_cave: ['ambient_cave_1.wav'],
  ambient_fire: ['ambient_fire_1.wav'],
  ambient_underwater: ['ambient_underwater_1.wav'],
  // The scheduled songs are full tracks staged under assets/music/, not bank
  // samples. `audioStartLoop` draws one at random from the slot's list each
  // time a window opens. Add files here when a folder gains a song.
  music_dawn: ["music/dawn/Daybreak's First Note.m4a"],
  music_noon: ['music/noon/Midday Calm.m4a'],
  music_dusk: [
    'music/dusk/Dusk Chamber 1.m4a',
    'music/dusk/Dusk Chamber 2.m4a',
    'music/dusk/Dusk Piano 1.m4a',
    'music/dusk/Dusk Piano 2.m4a'
  ],
  music_midnight: ['music/midnight/Midnight Pulse 1.m4a']
};

const audioStateEl = document.getElementById('audio-state');
const audioVolumeEl = document.getElementById('audio-volume');
const audioVolumeValueEl = document.getElementById('audio-volume-value');
const audioSfxVolumeEl = document.getElementById('audio-sfx-volume');
const audioSfxVolumeValueEl = document.getElementById('audio-sfx-volume-value');
const audioMusicVolumeEl = document.getElementById('audio-music-volume');
const audioMusicVolumeValueEl = document.getElementById('audio-music-volume-value');
/*
 * The point of hearing. The audio layer has no player: it is told where one is.
 * Every sound that is not given a position of its own is placed here, every
 * pan is measured against this heading, and the ambience asks it whether the
 * sky is open overhead, whether the ears are underwater, whether the game is
 * paused, and whether the body lying still is the listener's own.
 */
const audioListener = {
  x: 0, y: 0, z: 0, yaw: 0,
  headInWater: false, dead: false, paused: false
};

/**
 * The player is the listener. Whatever moves the player and draws the screens
 * pushes these once a frame; everything below reads only these, never the
 * player itself.
 */
export function setAudioListener(values) {
  audioListener.x = values.x;
  audioListener.y = values.y;
  audioListener.z = values.z;
  audioListener.yaw = values.yaw;
  audioListener.headInWater = values.headInWater;
  audioListener.dead = values.dead;
  audioListener.paused = values.paused;
}

export let audioCtx = null;
let audioMaster = null;
let audioMuffle = null;
let audioCompressor = null;
let audioSfxBus = null;
let audioAmbientBus = null;
let audioUiBus = null;
let audioMusicBus = null;
let audioReverbSend = null;
let audioReverb = null;
let audioReverbGain = null;
let audioNoiseBuffer = null;
let audioPinkBuffer = null;
let audioBrownBuffer = null;
let audioMuted = false;
let audioVolume = AUDIO_DEFAULT_VOLUME;
let audioSfxVolume = AUDIO_DEFAULT_SFX_VOLUME;
let audioMusicVolume = AUDIO_DEFAULT_MUSIC_VOLUME;
let audioMusicTrack = null;
/** True once the current window's one-shot song has started; silence follows its end. */
let audioMusicPlayed = false;
let audioVoices = new Set();
let audioVoiceSerial = 0;
const audioBuffers = new Map();
const audioAssetLoad = {
  total: 0, loaded: 0, failed: 0, ready: false, started: false
};
const audioLoops = new Map();
const audioLoopPicks = new Map();
let audioAmbientTimer = 0;
let audioAmbientSnapshot = {
  underwater: false, openSky: true, nearWater: false, fireDistance: Infinity,
  wind: 0, water: 0, cave: 0, fire: 0, under: 0, music: 0, musicTrack: null
};
let audioUnderwaterShown = false;
let audioHudText = '';

function audioStorageGet(key) {
  try { return window.localStorage.getItem(key); } catch (unavailable) { return null; }
}

function audioStorageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (unavailable) {}
}

function loadAudioLevel(key, fallback) {
  const stored = audioStorageGet(AUDIO_SETTINGS_KEY + key);
  // Number(null) is 0, which would silently mute a first visit.
  if (stored === null || stored === '') return fallback;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback;
}

function loadAudioMuted() {
  return audioStorageGet(AUDIO_SETTINGS_KEY + ':muted') === '1';
}

audioVolume = loadAudioLevel(':volume', AUDIO_DEFAULT_VOLUME);
audioSfxVolume = loadAudioLevel(':sfx', AUDIO_DEFAULT_SFX_VOLUME);
audioMusicVolume = loadAudioLevel(':music', AUDIO_DEFAULT_MUSIC_VOLUME);
audioMuted = loadAudioMuted();

function audioSupported() {
  return typeof window.AudioContext === 'function' ||
    typeof window.webkitAudioContext === 'function';
}

function buildNoiseBuffer(ctx, color = 'white') {
  const length = Math.floor(ctx.sampleRate * AUDIO_NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) * 0.998;
      data[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** A short decaying-noise impulse response; no external reverb file required. */
function buildImpulseResponse(ctx) {
  const seconds = 2.2;
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
    }
  }
  return impulse;
}

/**
 * voice → category bus → muffler → master → compressor → speakers
 *                                   ↘ reverb return ↗
 *
 * The compressor is what lets footsteps, mobs and an explosion share a frame
 * without the mix clipping. The muffler sits before the master so going
 * underwater can close the whole world down without touching a voice.
 */
function buildAudioGraph() {
  audioSfxBus = audioCtx.createGain();
  audioSfxBus.gain.value = audioSfxVolume;
  audioAmbientBus = audioCtx.createGain();
  audioAmbientBus.gain.value = audioSfxVolume;
  audioUiBus = audioCtx.createGain();
  audioUiBus.gain.value = audioSfxVolume;
  audioMusicBus = audioCtx.createGain();
  audioMusicBus.gain.value = audioMusicVolume;

  audioMuffle = audioCtx.createBiquadFilter();
  audioMuffle.type = 'lowpass';
  audioMuffle.frequency.value = 20000;
  audioMuffle.Q.value = 0.7;

  audioMaster = audioCtx.createGain();
  audioMaster.gain.value = audioMuted ? 0 : audioVolume;

  audioCompressor = audioCtx.createDynamicsCompressor();
  audioCompressor.threshold.value = -18;
  audioCompressor.knee.value = 20;
  audioCompressor.ratio.value = 5;
  audioCompressor.attack.value = 0.003;
  audioCompressor.release.value = 0.25;

  audioReverb = audioCtx.createConvolver();
  audioReverb.buffer = buildImpulseResponse(audioCtx);
  audioReverbSend = audioCtx.createGain();
  audioReverbSend.gain.value = 1;
  audioReverbGain = audioCtx.createGain();
  audioReverbGain.gain.value = 0.9;

  audioSfxBus.connect(audioMuffle);
  audioAmbientBus.connect(audioMuffle);
  audioUiBus.connect(audioMuffle);
  audioMusicBus.connect(audioMuffle);
  audioMuffle.connect(audioMaster);
  audioMaster.connect(audioCompressor);
  audioCompressor.connect(audioCtx.destination);
  audioReverbSend.connect(audioReverb);
  audioReverb.connect(audioReverbGain);
  audioReverbGain.connect(audioMuffle);
  audioUnderwaterShown = false;
}

function updateAudioHud() {
  if (!audioStateEl) return;
  let text;
  let off = false;
  if (!audioSupported()) {
    text = 'Audio unavailable';
    off = true;
  } else if (audioMuted) {
    text = 'Sound muted \u00b7 M';
    off = true;
  } else {
    text = 'Sound on \u00b7 ' + Math.round(audioVolume * 100) + '% \u00b7 M mute';
  }
  if (text !== audioHudText) {
    audioHudText = text;
    audioStateEl.textContent = text;
  }
  audioStateEl.classList.toggle('off', off);
  const masterPercent = Math.round(audioVolume * 100);
  const sfxPercent = Math.round(audioSfxVolume * 100);
  const musicPercent = Math.round(audioMusicVolume * 100);
  if (audioVolumeEl && document.activeElement !== audioVolumeEl) {
    audioVolumeEl.value = String(masterPercent);
  }
  if (audioVolumeValueEl) audioVolumeValueEl.textContent = masterPercent + '%';
  if (audioSfxVolumeEl && document.activeElement !== audioSfxVolumeEl) {
    audioSfxVolumeEl.value = String(sfxPercent);
  }
  if (audioSfxVolumeValueEl) audioSfxVolumeValueEl.textContent = sfxPercent + '%';
  if (audioMusicVolumeEl && document.activeElement !== audioMusicVolumeEl) {
    audioMusicVolumeEl.value = String(musicPercent);
  }
  if (audioMusicVolumeValueEl) audioMusicVolumeValueEl.textContent = musicPercent + '%';
}

export function setAudioVolume(value, persist = true) {
  audioVolume = clamp(audioNumber(Number(value), AUDIO_DEFAULT_VOLUME), 0, 1);
  if (persist) audioStorageSet(AUDIO_SETTINGS_KEY + ':volume', String(audioVolume));
  if (audioMaster && audioCtx) {
    audioMaster.gain.setTargetAtTime(
      audioMuted ? 0 : audioVolume,
      audioCtx.currentTime,
      0.025
    );
  }
  updateAudioHud();
  return audioVolume;
}

export function setAudioSfxVolume(value, persist = true) {
  audioSfxVolume = clamp(audioNumber(Number(value), AUDIO_DEFAULT_SFX_VOLUME), 0, 1);
  if (persist) audioStorageSet(AUDIO_SETTINGS_KEY + ':sfx', String(audioSfxVolume));
  if (audioCtx) {
    const now = audioCtx.currentTime;
    for (const bus of [audioSfxBus, audioUiBus, audioAmbientBus]) {
      if (bus) bus.gain.setTargetAtTime(audioSfxVolume, now, 0.025);
    }
  }
  updateAudioHud();
  return audioSfxVolume;
}

export function setAudioMusicVolume(value, persist = true) {
  audioMusicVolume = clamp(audioNumber(Number(value), AUDIO_DEFAULT_MUSIC_VOLUME), 0, 1);
  if (persist) audioStorageSet(AUDIO_SETTINGS_KEY + ':music', String(audioMusicVolume));
  if (audioMusicBus && audioCtx) {
    audioMusicBus.gain.setTargetAtTime(audioMusicVolume, audioCtx.currentTime, 0.025);
  }
  updateAudioHud();
  return audioMusicVolume;
}

/**
 * Fetch and decode the sampled bank. Failures are deliberately non-fatal:
 * `audioSample` simply returns false and the synthesizer is used instead.
 */
async function loadAudioAssets() {
  if (!audioCtx || audioAssetLoad.started) return;
  audioAssetLoad.started = true;

  const entries = [];
  for (const [base, files] of Object.entries(AUDIO_ASSETS)) {
    // Start with the beds and the music: they are what make the world feel
    // alive while the larger one-shot set is still decoding.
    const priority = base.startsWith('ambient_') || base.startsWith('music_') ? 0 : 1;
    for (const file of files) entries.push({ base, file, priority });
  }
  entries.sort((a, b) => a.priority - b.priority);
  audioAssetLoad.total = entries.length;

  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      try {
        // A file with a path sits beside the bank under assets/ (the music
        // folders); everything else is a bank sample. encodeURI because the
        // music files carry real spaces in their names.
        const url = entry.file.includes('/')
          ? 'assets/' + entry.file
          : AUDIO_ASSET_ROOT + entry.file;
        const response = await fetch(encodeURI(url));
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.arrayBuffer();
        const buffer = await new Promise((resolve, reject) => {
          audioCtx.decodeAudioData(data, resolve, reject);
        });
        if (!audioBuffers.has(entry.base)) audioBuffers.set(entry.base, []);
        audioBuffers.get(entry.base).push(buffer);
        audioAssetLoad.loaded++;
      } catch (error) {
        audioAssetLoad.failed++;
      }
    }
  };

  const workers = [];
  for (let i = 0; i < 6; i++) workers.push(worker());
  await Promise.all(workers);
  audioAssetLoad.ready = true;
  audioAmbientTimer = 0;
  if (audioAssetLoad.failed) {
    console.warn(
      'Audio assets: loaded ' + audioAssetLoad.loaded + ', failed ' +
      audioAssetLoad.failed + '. Procedural fallback covers the gaps.'
    );
  }
}

/** Create/resume the context lazily from a user gesture. */
export function ensureAudio() {
  if (!audioSupported()) return null;

  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
      audioCtx = new AudioContextClass();
    } catch (err) {
      console.warn('Audio unavailable:', err);
      return null;
    }
    buildAudioGraph();
    audioNoiseBuffer = buildNoiseBuffer(audioCtx, 'white');
    audioPinkBuffer = buildNoiseBuffer(audioCtx, 'pink');
    audioBrownBuffer = buildNoiseBuffer(audioCtx, 'brown');
    updateAudioHud();
    loadAudioAssets();
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function setAudioMuted(value) {
  audioMuted = !!value;
  audioStorageSet(AUDIO_SETTINGS_KEY + ':muted', audioMuted ? '1' : '0');
  if (audioMaster && audioCtx) {
    audioMaster.gain.setTargetAtTime(
      audioMuted ? 0 : audioVolume,
      audioCtx.currentTime,
      0.025
    );
    if (!audioMuted && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }
  updateAudioHud();
  return audioMuted;
}

for (const [element, setter] of [
  [audioVolumeEl, setAudioVolume],
  [audioSfxVolumeEl, setAudioSfxVolume],
  [audioMusicVolumeEl, setAudioMusicVolume]
]) {
  if (!element) continue;
  element.addEventListener('input', () => {
    ensureAudio();
    setter(Number(element.value) / 100);
  });
  // The pause panel itself is a click-to-resume surface; a slider is not.
  for (const type of ['click', 'pointerdown']) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }
}

/* Flips the mute and says what to tell the player. The audio layer owns the
   flag; the toast is whoever has a screen to show it on. */
export function toggleAudioMuted() {
  return setAudioMuted(!audioMuted) ? 'Sound muted' : 'Sound on';
}

function audioBeginVoice(duration = 0.2, priority = 1) {
  if (!audioCtx || audioMuted) return false;
  if (audioVoices.size >= AUDIO_MAX_VOICES) {
    // Keep a creeper audible when a burst of footsteps fills the pool: drop the
    // least important voice, and only if the new sound outranks it.
    let weakest = null;
    for (const voice of audioVoices) {
      if (!weakest || voice.priority < weakest.priority) weakest = voice;
    }
    if (!weakest || priority <= weakest.priority) return false;
    if (weakest.stop) {
      try { weakest.stop(); } catch (error) {}
    }
    audioVoices.delete(weakest);
  }

  const seconds = Math.max(0.05, audioNumber(duration, 0.2));
  const voice = {
    id: ++audioVoiceSerial,
    priority: audioNumber(priority, 1),
    stop: null,
    timer: null
  };
  voice.timer = window.setTimeout(() => {
    audioVoices.delete(voice);
  }, Math.max(90, seconds * 1000 + 120));
  audioVoices.add(voice);
  return voice;
}

function audioEndVoice(voice) {
  if (!voice) return;
  if (voice.timer) {
    window.clearTimeout(voice.timer);
    voice.timer = null;
  }
  audioVoices.delete(voice);
}

/**
 * An AudioParam rejects NaN and Infinity, and the throw lands on whatever frame
 * happened to be making a sound. Physics and look input only slip once before a
 * NaN is permanent, so no number reaches a param without passing through here.
 */
function audioNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function audioBusNode(bus) {
  if (bus === 'ambient') return audioAmbientBus;
  if (bus === 'music') return audioMusicBus;
  if (bus === 'ui') return audioUiBus;
  return audioSfxBus;
}

function audioConnectOutput(pan = 0, bus = 'sfx', reverb = 0) {
  if (!audioCtx) return null;
  const target = audioBusNode(bus);
  let out;
  if (audioCtx.createStereoPanner) {
    const panner = audioCtx.createStereoPanner();
    panner.pan.value = clamp(audioNumber(pan, 0), -1, 1);
    panner.connect(target);
    out = panner;
  } else {
    out = audioCtx.createGain();
    out.connect(target);
  }

  if (reverb > 0 && audioReverbSend) {
    const send = audioCtx.createGain();
    send.gain.value = clamp(audioNumber(reverb, 0), 0, 1);
    out.connect(send);
    send.connect(audioReverbSend);
  }
  return out;
}

/** Open the whole mix down to a muffled thump when the head goes under. */
function audioSetMuffle(underwater) {
  if (!audioCtx || !audioMuffle) return;
  if (underwater === audioUnderwaterShown) return;
  audioUnderwaterShown = underwater;
  audioMuffle.frequency.setTargetAtTime(
    underwater ? 620 : 20000,
    audioCtx.currentTime,
    0.16
  );
}

/**
 * Distance attenuation plus stereo pan relative to the camera. The right
 * vector comes from yaw so no matrix update is needed.
 */
function audioSpatial(x, y, z, range = 26) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { gain: 1, pan: 0, distance: 0, cutoff: 20000 };
  }
  range = Math.max(1, audioNumber(range, 26));
  const dx = x - camera.position.x;
  const dy = y - camera.position.y;
  const dz = z - camera.position.z;
  // The listener goes non-finite exactly like a sound does, and a NaN here would
  // make every distance and level below one too. The voice is played at full
  // level dead centre instead: nothing that can be heard is lost, and the frame
  // that asked for it survives.
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
    return { gain: 1, pan: 0, distance: 0, cutoff: 20000 };
  }
  const distance = Math.hypot(dx, dy, dz);
  if (distance >= range || !Number.isFinite(distance)) {
    return { gain: 0, pan: 0, distance, cutoff: 700 };
  }

  const falloff = 1 - distance / range;
  const gain = falloff * falloff;
  // Air absorbs the top end before it absorbs the bottom, so a distant sound is
  // duller as well as quieter. This is what makes the forest feel deep.
  const cutoff = Math.max(700, 18000 * Math.pow(falloff, 1.4));
  const horizontal = Math.hypot(dx, dz);
  // yaw can go non-finite the same way, and a heading nobody can place by ear is
  // worth the same as no heading at all.
  const bearing =
    (dx * Math.cos(audioListener.yaw) - dz * Math.sin(audioListener.yaw)) / horizontal;
  const pan = horizontal > 0.001 ? clamp(audioNumber(bearing, 0), -1, 1) * 0.72 : 0;
  return { gain, pan, distance, cutoff };
}

/**
 * A cheap voxel line-of-sight test for one-shots. Two solid cells in the way is
 * enough to count as occluded; a single block edge is not. Footsteps and other
 * close sounds skip this by passing `occlude: false`.
 */
function audioOcclusion(x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 1;
  const dx = x - camera.position.x;
  const dy = y - camera.position.y;
  const dz = z - camera.position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 2.5 || distance > 40 || !Number.isFinite(distance)) return 1;

  const steps = Math.min(24, Math.ceil(distance / 0.7));
  let solid = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const bx = Math.floor(camera.position.x + dx * t);
    const by = Math.floor(camera.position.y + dy * t);
    const bz = Math.floor(camera.position.z + dz * t);
    const block = BLOCKS[world.getBlock(bx, by, bz)];
    if (block && block.solid) {
      solid++;
      if (solid >= 2) return 0.55;
    }
  }
  return 1;
}

/**
 * Play one sampled effect. Returns false when the bank is unavailable, which is
 * the signal every caller uses to fall back to the procedural synthesizer.
 */
function audioSample(name, options = {}) {
  const list = audioBuffers.get(name);
  if (!audioCtx || audioMuted || !list || !list.length) return false;
  const buffer = list[(Math.random() * list.length) | 0];
  if (!buffer) return false;

  const spatial = options.spatial === false
    ? { gain: 1, pan: 0, distance: 0, cutoff: 20000 }
    : audioSpatial(options.x, options.y, options.z, options.range ?? 24);
  if (spatial.gain <= 0.001) return false;

  const occluded = options.occlude === false
    ? 1
    : audioOcclusion(options.x, options.y, options.z);
  const volume = clamp(
    audioNumber(options.volume, 1) * spatial.gain * occluded * AUDIO_SAMPLE_TRIM,
    0,
    1.5
  );
  if (volume <= 0.001) return false;

  const pitch = clamp(
    audioNumber(options.pitch, 1) * (0.97 + Math.random() * 0.06),
    0.25,
    4
  );
  const duration = buffer.duration / pitch;
  const voice = audioBeginVoice(duration, options.priority ?? 1);
  if (!voice) return false;

  const now = audioCtx.currentTime;
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = pitch;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = clamp(
    audioNumber(options.cutoff ?? spatial.cutoff, 20000) *
      (occluded < 1 ? 0.55 : 1),
    300,
    20000
  );
  filter.Q.value = 0.7;

  const gain = audioCtx.createGain();
  gain.gain.value = volume;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioConnectOutput(
    spatial.pan,
    options.bus || 'sfx',
    options.reverb ?? 0.18
  ));
  source.start(now);
  source.stop(now + duration + 0.05);

  voice.stop = () => {
    try { source.stop(); } catch (error) {}
  };
  source.onended = () => audioEndVoice(voice);
  return true;
}

/**
 * Picks one loaded variant of a loop at random, rerolling when the draw lands
 * on the same index as last time so dusk does not play the same song every
 * evening while four are waiting.
 */
function audioPickVariant(name, list) {
  let index = Math.floor(Math.random() * list.length);
  if (list.length > 1 && index === audioLoopPicks.get(name)) {
    index = (index + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
  }
  audioLoopPicks.set(name, index);
  return { index, buffer: list[index] };
}

function audioStartLoop(name, gain = 0) {
  if (!audioCtx || audioMuted) return null;
  const existing = audioLoops.get(name);
  if (existing) return existing;

  const list = audioBuffers.get(name);
  if (!list || !list.length) return null;
  const pick = audioPickVariant(name, list);

  // Ambient beds are continuous, so they loop forever. A music slot plays its
  // song straight through once, and the finished bed clears its slot in
  // `onended` so the silence holds until the next window.
  const looping = !name.startsWith('music_');
  const source = audioCtx.createBufferSource();
  source.buffer = pick.buffer;
  source.loop = looping;
  if (looping) {
    source.loopStart = 0;
    source.loopEnd = pick.buffer.duration;
  }

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 20000;
  filter.Q.value = 0.6;

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 0;

  // Bus by name, not by looping: music_ beds ride the music bus so the music
  // slider moves them, everything else rides the ambient bus.
  const bus = name.startsWith('music_') ? 'music' : 'ambient';
  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioConnectOutput(0, bus, 0));
  source.start();

  const entry = { source, filter, gain: gainNode, name, variant: pick.index, stopTimer: null };
  audioLoops.set(name, entry);
  source.onended = () => {
    // A straight-through playthrough ends here: clear the slot so the window
    // falls silent, but never a bed that has since taken the slot.
    if (audioLoops.get(name) !== entry) return;
    if (entry.stopTimer) window.clearTimeout(entry.stopTimer);
    audioLoops.delete(name);
  };
  audioSetLoop(name, gain, 20000);
  return entry;
}

function audioSetLoop(name, target, cutoff = 20000) {
  const level = clamp(audioNumber(target, 0), 0, 1);
  const entry = audioLoops.get(name);
  if (!entry) {
    if (level > 0.001) return audioStartLoop(name, level);
    return null;
  }
  if (!audioCtx) return entry;
  if (entry.stopTimer && level > 0.001) {
    // The bed was fading out and the world asked for it again — within a music
    // window's fade that is a scrub back across the boundary, and the song
    // survives rather than dying mid-fade and staying dead.
    window.clearTimeout(entry.stopTimer);
    entry.stopTimer = null;
  }
  const now = audioCtx.currentTime;
  entry.gain.gain.setTargetAtTime(level, now, 0.45);
  entry.filter.frequency.setTargetAtTime(
    clamp(audioNumber(cutoff, 20000), 80, 20000),
    now,
    0.6
  );
  return entry;
}

function audioStopLoop(name) {
  const entry = audioLoops.get(name);
  if (!entry || !audioCtx) return;
  entry.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.25);
  if (entry.stopTimer) window.clearTimeout(entry.stopTimer);
  entry.stopTimer = window.setTimeout(() => {
    entry.stopTimer = null;
    try { entry.source.stop(); } catch (error) {}
    // The timer may outlive the bed it was armed for; only the entry still
    // holding the slot gets cleared by it.
    if (audioLoops.get(name) === entry) audioLoops.delete(name);
  }, 900);
}

function audioTone(config = {}) {
  if (!audioCtx) return;
  const now = audioNumber(config.now, audioCtx.currentTime);
  const duration = Math.max(0.03, audioNumber(config.duration, 0.2));
  const from = Math.max(20, audioNumber(config.from, 440));
  const to = Math.max(20, audioNumber(config.to, from));
  const volume = Math.max(0.0002, audioNumber(config.volume, 0.15));
  const voice = audioBeginVoice(duration, config.priority ?? 1);
  if (!voice) return;

  const oscillator = audioCtx.createOscillator();
  oscillator.type = config.type || 'sine';
  oscillator.frequency.setValueAtTime(from, now);
  if (Math.abs(to - from) > 0.01) {
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
  }

  let lastNode = oscillator;
  if (config.filterType) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = config.filterType;
    filter.frequency.value = Math.max(40, audioNumber(config.filterFreq, 900));
    filter.Q.value = audioNumber(config.filterQ, 0.8);
    lastNode.connect(filter);
    lastNode = filter;
  }

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.02, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  lastNode.connect(gain);
  gain.connect(audioConnectOutput(
    config.pan ?? 0,
    config.bus || 'sfx',
    config.reverb ?? 0
  ));

  oscillator.start(now);
  oscillator.stop(now + duration + 0.03);
  voice.stop = () => {
    try { oscillator.stop(); } catch (error) {}
  };
  oscillator.onended = () => audioEndVoice(voice);
}

/* ---------- Ambient mix: wind, water, caves, fire, underwater ---------- */

function ambientIsOpenSky() {
  const x = Math.floor(audioListener.x);
  const z = Math.floor(audioListener.z);
  const feet = Math.floor(audioListener.y + EYE_HEIGHT) + 1;
  for (let y = feet; y < WORLD_HEIGHT; y++) {
    const id = world.getBlock(x, y, z);
    const block = BLOCKS[id];
    // Leaves are a roof overhead, not a cave: a forest should still hear wind.
    if (block && block.solid && id !== B.LEAVES) return false;
  }
  return true;
}

function ambientNearWater() {
  const x = Math.floor(audioListener.x);
  const y = Math.floor(audioListener.y);
  const z = Math.floor(audioListener.z);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -8; dx <= 8; dx += 2) {
      for (let dz = -8; dz <= 8; dz += 2) {
        if (isWater(world.getBlock(x + dx, y + dy, z + dz))) return true;
      }
    }
  }
  return false;
}

/** Nearest lit torch or burning furnace, in blocks. Infinity when none is near. */
function ambientNearFire() {
  const px = audioListener.x;
  const py = audioListener.y + EYE_HEIGHT;
  const pz = audioListener.z;
  let best = Infinity;

  const consider = (key, offsetY) => {
    const parts = key.split(',');
    const x = Number(parts[0]) + 0.5;
    const y = Number(parts[1]) + offsetY;
    const z = Number(parts[2]) + 0.5;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const distance = Math.hypot(x - px, y - py, z - pz);
    if (distance < best) best = distance;
  };

  for (const key of world.torches) consider(key, 0.5);
  for (const [key, entity] of world.blockEntities) {
    if (entity && entity.kind === 'furnace' && entity.burnTime > 0) {
      consider(key, 0.5);
    }
  }
  return best;
}

/** The four scheduled music windows, in the same clock the HUD shows. */
function musicTrackForClock(hours) {
  if (hours >= 6 && hours < 12) return 'music_dawn';
  if (hours >= 12 && hours < 18) return 'music_noon';
  if (hours >= 18 && hours < 24) return 'music_dusk';
  return 'music_midnight';
}

export function updateAmbient(dt) {
  if (!audioCtx) return;
  audioAmbientTimer -= dt;
  if (audioAmbientTimer > 0) return;
  audioAmbientTimer = 0.5;

  const underwater = !!audioListener.headInWater;
  const openSky = ambientIsOpenSky();
  const nearWater = ambientNearWater();
  const fireDistance = ambientNearFire();
  const deep = clamp(audioNumber((SEA_LEVEL - audioListener.y) / 30, 0), 0, 1);
  const altitude = clamp(audioNumber((audioListener.y - SEA_LEVEL) / 40, 0), 0, 1);
  const paused = audioListener.paused;

  let wind = underwater ? 0.015 : (openSky ? 0.08 + altitude * 0.08 : 0.015);
  let water = underwater || !nearWater ? 0 : 0.11;
  let cave = underwater || openSky ? 0 : 0.09 + deep * 0.13;
  let fire = underwater || !Number.isFinite(fireDistance) || fireDistance >= 9
    ? 0
    : 0.16 * (1 - fireDistance / 9);
  let under = underwater ? 0.22 : 0;

  // The clock picks the slot and the slot opens on a random song from its
  // folder: dawn from sunrise, noon from midday, dusk from eighteen, and
  // midnight from zero. The song plays straight through once, then the window
  // stays quiet until the next one opens.
  const musicTrack = musicTrackForClock(clockHours());
  if (musicTrack !== audioMusicTrack) {
    if (audioMusicTrack) audioStopLoop(audioMusicTrack);
    audioMusicTrack = musicTrack;
    audioMusicPlayed = false;
  }
  let music = underwater ? 0.04 : (openSky ? 0.16 : 0.12);
  if (audioListener.dead) {
    music = 0;
    under = 0;
  }
  if (paused) {
    wind *= 0.6;
    water *= 0.6;
    cave *= 0.6;
    fire *= 0.6;
    music *= 0.55;
  }

  audioSetLoop('ambient_wind', wind, 1800);
  audioSetLoop('ambient_water', water, 1200);
  audioSetLoop('ambient_cave', cave, 300);
  audioSetLoop('ambient_fire', fire, 2600);
  audioSetLoop('ambient_underwater', under, 500);
  // Ride the level with the environment while the song is running, but once
  // its one playthrough has ended, leave the window in silence: starting it
  // again is the next window's job.
  if (!audioMusicPlayed || audioLoops.has(musicTrack)) {
    if (audioSetLoop(musicTrack, music, 6000)) audioMusicPlayed = true;
  }
  audioSetMuffle(underwater);

  audioAmbientSnapshot = {
    underwater, openSky, nearWater, fireDistance,
    wind, water, cave, fire, under, music, musicTrack
  };
}

/* ---------- New one-shots built on the sample bank ---------- */

export function playLandingSound(blockId, x, y, z, strength) {
  const material = blockSoundMaterial(blockId);
  const volume = clamp(0.35 + strength * 0.06, 0.35, 0.9);
  if (audioSample('event_land', {
    x, y, z, volume, pitch: 0.9 + Math.random() * 0.16,
    range: 16, priority: 2, occlude: false
  })) {
    playMaterialNoise(material, x, y, z, {
      action: 'step', volume: 0.35, pitch: 0.8 + Math.random() * 0.12,
      durationScale: 0.6, range: 14, priority: 1, occlude: false
    });
    return true;
  }
  return playMaterialNoise(material, x, y, z, {
    action: 'step', volume: 0.75, pitch: 0.72,
    durationScale: 1.1, range: 16, priority: 1, occlude: false
  });
}

export function playWaterEntrySound(x, y, z) {
  if (audioSample('event_splash', {
    x, y, z, volume: 0.75, range: 20, priority: 2, occlude: false
  })) return true;
  return playMaterialNoise('splash', x, y, z, {
    volume: 0.8, pitch: 0.9, durationScale: 1.2, range: 20, priority: 2
  });
}

export function playSwimSound(x, y, z) {
  if (audioSample('event_swim', {
    x, y, z, volume: 0.32, range: 12, priority: 0, occlude: false, reverb: 0.05
  })) return true;
  return audioNoiseHit({
    type: 'bandpass', freq: 900, freqEnd: 380, q: 0.8,
    duration: 0.3, volume: 0.1
  }, x, y, z, { volume: 0.6, range: 12, priority: 0 });
}

export function playJumpSound() {
  // No recording: the woosh in the bank is four tenths of broadband air, which
  // was the loudest thing in the mix every time the space bar was tapped. One
  // short sine that climbs from 300 to 430 Hz says "pushed off" and stops, dry,
  // with no air in it. It sits under the screen open/close pair in pitch and
  // rises where a pickup falls, so the three blips stay legible apart, and the
  // landing thud stays sampled and spatial — a light self-sound against a heavy
  // ground impact is what makes a jump read as a jump.
  audioTone({
    type: 'sine', from: 300, to: 430, duration: 0.12,
    volume: 0.05, bus: 'sfx', priority: 0
  });
  return !!audioCtx && !audioMuted;
}

export function playPickupSound() {
  // Picking up is the most repeated sound in the game and the only one most
  // players never notice until it grates, so it gets no recording: a sample has
  // an attack and a rasp of its own, and thirty of those a minute is a chatter.
  // This is one soft sine, a hair under a fifth of a second, falling rather than
  // rising so it reads as something set down rather than announced, dry so it
  // does not bloom over the next one, and quiet enough to sit under the ambience.
  audioTone({
    type: 'sine', from: 540, to: 500, duration: 0.14,
    volume: 0.055, bus: 'ui', priority: 0
  });
  return !!audioCtx && !audioMuted;
}

export function playEssenceSound() {
  // The essence pickup is the item pickup seen from the other side: where
  // picking up a block falls, so it reads as something set down, collecting
  // essence rises, so it reads as something taken in. Two sines a fifth
  // apart, quick and dry, quiet enough to survive a whole night of combat.
  audioTone({
    type: 'sine', from: 620, to: 930, duration: 0.18,
    volume: 0.05, bus: 'ui', priority: 0
  });
  return !!audioCtx && !audioMuted;
}

export function playBeaconSound() {
  // Lighting a beacon happens once in a world per monument, so it can afford
  // to be an event rather than a blip: a low fifth that arrives under a
  // rising third, the machine coming up before the light does. It borrows the
  // furnace ignition's two-stage shape but an octave cleaner and longer, so
  // the two events cannot be mistaken for each other across the mission.
  audioTone({
    type: 'sine', from: 180, to: 270, duration: 0.5,
    volume: 0.09, bus: 'ui', priority: 0
  });
  if (!audioCtx) return !!audioCtx && !audioMuted;
  audioTone({
    type: 'triangle', from: 540, to: 810, duration: 0.7,
    now: audioCtx.currentTime + 0.35,
    volume: 0.07, bus: 'ui', priority: 0
  });
  return !!audioCtx && !audioMuted;
}

export function playUiClickSound() {
  if (audioSample('event_ui_click', {
    spatial: false, volume: 0.5, bus: 'ui', priority: 0
  })) return true;
  audioTone({
    type: 'triangle', from: 760, to: 680, duration: 0.06,
    volume: 0.06, bus: 'ui', priority: 0
  });
  return !!audioCtx && !audioMuted;
}

export function playUiOpenSound() {
  // A screen arriving is one tone that climbs; a screen leaving is the same tone
  // running backwards. Nothing else differs between the two, so the pair reads as
  // in and out without needing two different timbres, and a sine has no attack to
  // click on. It sits a shade above the pickup blip because it fires once per
  // keypress rather than thirty times a minute, and it is longer than that blip
  // and sweeps wider so the two cannot be mistaken for each other.
  audioTone({
    type: 'sine', from: 420, to: 640, duration: 0.18,
    volume: 0.065, bus: 'ui', priority: 0
  });
  return !!audioCtx && !audioMuted;
}

export function playUiCloseSound() {
  audioTone({
    type: 'sine', from: 640, to: 420, duration: 0.18,
    volume: 0.065, bus: 'ui', priority: 0
  });
  return !!audioCtx && !audioMuted;
}

export function playHeartbeatSound() {
  if (audioSample('event_heartbeat', {
    spatial: false, volume: 0.55, bus: 'ui', priority: 0
  })) return true;
  if (!audioCtx || audioMuted) return false;
  const now = audioCtx.currentTime;
  audioTone({
    type: 'sine', from: 82, to: 42, duration: 0.17,
    volume: 0.16, now, bus: 'ui', priority: 0
  });
  audioTone({
    type: 'sine', from: 68, to: 38, duration: 0.17,
    volume: 0.12, now: now + 0.22, bus: 'ui', priority: 0
  });
  return true;
}

export function playDeathSound() {
  if (audioSample('event_death', {
    spatial: false, volume: 0.8, bus: 'ui', priority: 4
  })) return true;
  if (!audioCtx || audioMuted) return false;
  audioTone({
    type: 'sawtooth', from: 220, to: 55, duration: 1.4,
    volume: 0.16, filterType: 'lowpass', filterFreq: 700,
    bus: 'ui', priority: 4
  });
  return true;
}

const BLOCK_SOUND_PROFILES = {
  stone: {
    type: 'lowpass', freq: 780, freqEnd: 260, q: 0.9,
    duration: 0.17, volume: 0.32, tone: 116, toneVolume: 0.12
  },
  dirt: {
    type: 'lowpass', freq: 1350, freqEnd: 520, q: 0.7,
    duration: 0.13, volume: 0.24
  },
  grass: {
    type: 'lowpass', freq: 1800, freqEnd: 760, q: 0.6,
    duration: 0.13, volume: 0.21
  },
  sand: {
    type: 'highpass', freq: 1900, freqEnd: 1200, q: 0.5,
    duration: 0.16, volume: 0.18
  },
  snow: {
    type: 'lowpass', freq: 1000, freqEnd: 420, q: 0.8,
    duration: 0.12, volume: 0.17
  },
  wood: {
    type: 'bandpass', freq: 780, freqEnd: 430, q: 1.4,
    duration: 0.18, volume: 0.3, tone: 168, toneVolume: 0.08
  },
  leaves: {
    type: 'highpass', freq: 2500, freqEnd: 1600, q: 0.6,
    duration: 0.15, volume: 0.16
  },
  glass: {
    type: 'bandpass', freq: 3200, freqEnd: 2100, q: 2.4,
    duration: 0.13, volume: 0.2, tone: 1560, toneVolume: 0.07
  },
  // Water running over a rim: no impact in it at all, so a band of noise
  // swept back down instead of a strike, with a low note under it for the
  // weight of a whole bucketful.
  splash: {
    type: 'bandpass', freq: 1500, freqEnd: 340, q: 0.9,
    duration: 0.26, volume: 0.26, tone: 300, toneVolume: 0.05
  }
};

export function blockSoundMaterial(blockId) {
  const block = typeof blockId === 'string'
    ? BLOCK_BY_KEY.get(blockId)
    : BLOCKS[blockId];
  if (!block) return String(blockId || 'stone').toLowerCase();
  switch (block.key) {
    case 'grass': return 'grass';
    case 'dirt': return 'dirt';
    case 'sand': return 'sand';
    case 'snow': return 'snow';
    case 'log':
    case 'planks':
    case 'crafting_table':
    case 'torch':
    case 'door':
    case 'door_top':
    case 'door_open':
    case 'door_open_top':
    case 'bed':
    case 'bed_head':
    case 'oak_stairs':
    case 'ladder': return 'wood';
    case 'leaves': return 'leaves';
    case 'glass': return 'glass';
    case 'farmland': return 'dirt';
    default: return 'stone';
  }
}

function audioNoiseHit(profile, x, y, z, options = {}) {
  const ctx = ensureAudio();
  if (!ctx) return false;

  const spatial = options.spatial === false
    ? { gain: 1, pan: 0, distance: 0, cutoff: 20000 }
    : audioSpatial(x, y, z, options.range ?? 24);
  if (spatial.gain <= 0.001) return false;

  const pitch = audioNumber(options.pitch, 1);
  const duration = Math.max(
    0.04,
    audioNumber((profile.duration || 0.14) * (options.durationScale ?? 1), 0.14)
  );
  if (!audioBeginVoice(duration, options.priority ?? 1)) return false;

  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = audioNoiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = profile.type || 'lowpass';
  const from = Math.max(40, (profile.freq || 900) * pitch);
  const to = Math.max(40, (profile.freqEnd || profile.freq || 700) * pitch);
  filter.frequency.setValueAtTime(from, now);
  if (Math.abs(to - from) > 0.5) {
    filter.frequency.exponentialRampToValueAtTime(to, now + duration);
  }
  filter.Q.value = profile.q ?? 0.8;

  const gain = ctx.createGain();
  const volume = Math.max(
    0.0002,
    audioNumber((profile.volume ?? 0.2) * (options.volume ?? 1) * spatial.gain, 0.0002)
  );
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.016, duration * 0.3));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  // Distance already dulls the band above; this second filter is the air itself.
  const distanceFilter = ctx.createBiquadFilter();
  distanceFilter.type = 'lowpass';
  distanceFilter.frequency.value = clamp(
    audioNumber(spatial.cutoff, 20000), 300, 20000
  );
  distanceFilter.Q.value = 0.7;

  source.connect(filter);
  filter.connect(distanceFilter);
  distanceFilter.connect(gain);
  gain.connect(audioConnectOutput(
    spatial.pan, 'sfx', options.reverb ?? 0.16
  ));

  const maxOffset = Math.max(0.01, audioNoiseBuffer.duration - duration - 0.02);
  source.start(now, Math.random() * maxOffset, duration);
  source.stop(now + duration + 0.03);

  if (profile.tone) {
    audioTone({
      type: 'triangle',
      from: profile.tone * pitch,
      to: profile.tone * pitch * 0.55,
      duration: duration * 0.9,
      volume: (profile.toneVolume ?? 0.08) * spatial.gain * (options.volume ?? 1),
      pan: spatial.pan,
      priority: options.priority ?? 1
    });
  }
  return true;
}

function playMaterialNoise(material, x, y, z, options = {}) {
  // The sample bank carries a separate set for each action. If it is not
  // loaded (or the page is on file://), the procedural profile still answers.
  const action = options.action === 'step'
    ? 'footstep'
    : options.action === 'place'
      ? 'place'
      : 'break';
  const sampleName = action + '_' + material;
  if (audioSample(sampleName, {
    ...options,
    x, y, z,
    // Keep block interactions centred and dry enough to read as "in hand".
    reverb: options.reverb ?? (action === 'footstep' ? 0.05 : 0.12)
  })) return true;

  const profile = BLOCK_SOUND_PROFILES[material] || BLOCK_SOUND_PROFILES.stone;
  return audioNoiseHit(profile, x, y, z, options);
}

export function playBreakSound(blockId, x, y, z) {
  return playMaterialNoise(blockSoundMaterial(blockId), x, y, z, {
    action: 'break',
    pitch: 0.92 + Math.random() * 0.16,
    volume: 0.7,
    range: 22,
    priority: 1
  });
}

/**
 * Contact noise for each swing while a block is being broken, like the
 * repeated digging sounds Minecraft plays. Quieter than the break itself.
 */
export function playMiningHitSound(blockId, x, y, z) {
  return playMaterialNoise(blockSoundMaterial(blockId), x, y, z, {
    action: 'break',
    pitch: 0.76 + Math.random() * 0.2,
    volume: 0.38,
    durationScale: 0.8,
    range: 16,
    priority: 0,
    occlude: false
  });
}

export function playPlaceSound(blockId, x, y, z) {
  return playMaterialNoise(blockSoundMaterial(blockId), x, y, z, {
    action: 'place',
    pitch: 0.68 + Math.random() * 0.1,
    volume: 0.52,
    durationScale: 0.72,
    range: 18,
    priority: 1
  });
}

/**
 * A stretched wooden creak for the hinge, drawn out compared with a placed
 * block so a swinging door sounds like movement rather than an impact.
 */
export function playDoorSound(x, y, z) {
  if (audioSample('event_door', {
    x, y, z, volume: 0.48, range: 18, priority: 1,
    pitch: 0.94 + Math.random() * 0.12
  })) return true;
  return playMaterialNoise('wood', x, y, z, {
    pitch: 0.42 + Math.random() * 0.1,
    volume: 0.42,
    durationScale: 1.7,
    range: 18
  });
}

/**
 * The dry snip of fleece giving way: a wooden contact pushed well above its
 * usual pitch, brief and light.
 */
export function playShearSound(x, y, z) {
  if (audioSample('event_shear', {
    x, y, z, volume: 0.55, range: 16, priority: 1,
    pitch: 0.95 + Math.random() * 0.12
  })) return true;
  return playMaterialNoise('wood', x, y, z, {
    pitch: 1.9 + Math.random() * 0.25,
    volume: 0.32,
    durationScale: 0.35,
    range: 16
  });
}

/**
 * A bucketful going in: the same water drawn high and short, a gulp off the
 * surface. Minecraft carries both bucket sounds sixteen blocks, so this does too.
 */
export function playFillBucketSound(x, y, z) {
  if (audioSample('event_bucket_fill', {
    x, y, z, volume: 0.58, range: 16, priority: 1,
    pitch: 0.95 + Math.random() * 0.1
  })) return true;
  return playMaterialNoise('splash', x, y, z, {
    pitch: 1.3 + Math.random() * 0.16,
    durationScale: 0.7,
    range: 16
  });
}

/**
 * A bucketful coming out: the same water run lower and longer, so it reads as
 * a pour that takes a moment rather than a single splash.
 */
export function playPourBucketSound(x, y, z) {
  if (audioSample('event_bucket_pour', {
    x, y, z, volume: 0.68, range: 16, priority: 1,
    pitch: 0.94 + Math.random() * 0.1
  })) return true;
  return playMaterialNoise('splash', x, y, z, {
    pitch: 0.82 + Math.random() * 0.12,
    volume: 0.9,
    durationScale: 1.6,
    range: 16
  });
}

export function playFootstepSound(material, x, y, z, sprinting = false) {
  return playMaterialNoise(material, x, y, z, {
    action: 'step',
    pitch: 0.92 + Math.random() * 0.14,
    volume: sprinting ? 0.4 : 0.3,
    durationScale: 0.62,
    range: 14,
    priority: 0,
    occlude: false
  });
}

export function playZombieGroan(x, y, z) {
  if (audioSample('mob_zombie', {
    x, y, z, volume: 0.72, range: 30, priority: 2,
    pitch: 0.92 + Math.random() * 0.14
  })) return true;

  const ctx = ensureAudio();
  if (!ctx) return false;
  const spatial = audioSpatial(x, y, z, 30);
  if (spatial.gain <= 0.001) return false;

  const duration = 0.85 + Math.random() * 0.4;
  if (!audioBeginVoice(duration, 2)) return false;

  const now = ctx.currentTime;
  const base = 76 + Math.random() * 34;
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(base, now);
  oscillator.frequency.linearRampToValueAtTime(base * 0.62, now + duration);

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 3.6 + Math.random() * 2.4;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 3.8;
  lfo.connect(lfoGain);
  lfoGain.connect(oscillator.frequency);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  filter.Q.value = 1.1;

  const gain = ctx.createGain();
  const volume = 0.22 * spatial.gain;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.18);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(audioConnectOutput(spatial.pan, 'sfx', 0.2));

  oscillator.start(now);
  lfo.start(now);
  oscillator.stop(now + duration + 0.04);
  lfo.stop(now + duration + 0.04);
  return true;
}

export function playCreeperHiss(x, y, z) {
  if (audioSample('mob_creeper', {
    x, y, z, volume: 0.75, range: 28, priority: 2,
    pitch: 0.96 + Math.random() * 0.08
  })) return true;

  // Without the bank, build the fuse from bright noise: a high-passed hiss
  // with a randomly stepping level so it catches and sputters, plus a low
  // bed to give it weight.
  const ctx = ensureAudio();
  if (!ctx) return false;
  const spatial = audioSpatial(x, y, z, 28);
  if (spatial.gain <= 0.001) return false;

  const duration = 1.55;
  if (!audioBeginVoice(duration, 2)) return false;

  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = audioNoiseBuffer;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 1200;
  highpass.Q.value = 0.7;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(2400, now);
  band.frequency.exponentialRampToValueAtTime(3200, now + duration);
  band.Q.value = 0.8;

  const gain = ctx.createGain();
  const peak = 0.2 * spatial.gain;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.06);
  for (let t = 0.1; t < duration - 0.08; t += 0.035 + Math.random() * 0.09) {
    const rise = 0.45 + 0.55 * (t / duration);
    gain.gain.setValueAtTime(peak * rise * (0.35 + Math.random() * 0.65), now + t);
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(highpass);
  highpass.connect(band);
  band.connect(gain);
  gain.connect(audioConnectOutput(spatial.pan, 'sfx', 0.22));
  source.start(now);
  source.stop(now + duration + 0.04);

  audioTone({
    type: 'triangle', from: 64, to: 46, duration: 1.1,
    volume: 0.07 * spatial.gain, pan: spatial.pan,
    priority: 2, reverb: 0.12
  });
  return true;
}

const ANIMAL_VOICES = {
  cow: { type: 'sawtooth', from: 172, to: 112, duration: 0.68, volume: 0.22, cutoff: 540 },
  pig: { type: 'square', from: 292, to: 206, duration: 0.34, volume: 0.17, cutoff: 860 },
  sheep: { type: 'triangle', from: 344, to: 296, duration: 0.56, volume: 0.17, cutoff: 1040 },
  chicken: { type: 'sine', from: 960, to: 1280, duration: 0.15, volume: 0.14, cutoff: 1900 }
};

/**
 * How loud each species' pain call is, as a share of the 0.85 every hurt call
 * used to be played at. A killing blow has no sound of its own — `killMob` is
 * silent and the cry a cow makes when it goes down is this call — so this is
 * also the death volume.
 *
 * The recordings are nowhere near one level: the first cow call is a second and
 * a half of chest-heavy low mids at RMS 0.138, while a sheep's second call is a
 * shorter but harsher RMS 0.204. At a shared 0.85 the animals came out at up to
 * twice the player's own hurt. Hostiles keep the full level, because a hostile's
 * pain is a threat cue rather than a farm noise.
 */
const MOB_HURT_GAIN = { cow: 0.53, pig: 0.7, sheep: 0.7, chicken: 0.6 };

export function playAnimalSound(type, x, y, z, options = {}) {
  const hurt = !!options.hurt;
  // The active animal bank is species-specific, so leave the recorded pitch
  // alone; a hurt sound is still raised.
  if (audioSample('mob_' + type, {
    x, y, z,
    volume: hurt ? 0.38 * (MOB_HURT_GAIN[type] ?? 1) : 0.22,
    range: 20,
    priority: 2,
    pitch: hurt ? 1.22 : 1
  })) return true;

  const ctx = ensureAudio();
  const voice = ANIMAL_VOICES[type];
  if (!ctx || !voice) return false;
  const spatial = audioSpatial(x, y, z, 20);
  if (spatial.gain <= 0.001) return false;

  const duration = voice.duration * (hurt ? 0.62 : 1);
  const extra = type === 'chicken' && !hurt ? 0.18 : 0;
  if (!audioBeginVoice(duration + extra, 2)) return false;

  const pitch = hurt ? 1.25 : 1;
  audioTone({
    type: voice.type,
    from: voice.from * pitch,
    to: voice.to * pitch * (hurt ? 1.1 : 1),
    duration,
    volume: voice.volume * spatial.gain * (hurt ? 1.35 * (MOB_HURT_GAIN[type] ?? 1) : 1),
    filterType: 'lowpass',
    filterFreq: voice.cutoff * (hurt ? 1.3 : 1),
    pan: spatial.pan
  });

  if (extra) {
    audioTone({
      type: 'sine',
      from: 1080,
      to: 1420,
      duration: 0.12,
      volume: voice.volume * spatial.gain * 0.9,
      pan: spatial.pan,
      now: ctx.currentTime + extra
    });
  }
  return true;
}

export function playMobHurtSound(type, x, y, z) {
  // A creeper's hiss is its fuse, not its pain; use the generic hurt for it.
  const base = type === 'creeper' ? 'event_hurt_mob' : 'mob_' + type;
  if (audioSample(base, {
    x, y, z, volume: 0.85 * (MOB_HURT_GAIN[type] ?? 1), range: 20, priority: 2,
    pitch: type === 'creeper' ? 1.25 : 1.15
  })) return true;

  if (type === 'zombie') return playZombieGroan(x, y, z);
  if (type === 'creeper') {
    return audioNoiseHit({
      type: 'bandpass', freq: 980, freqEnd: 420, q: 1.0,
      duration: 0.22, volume: 0.18
    }, x, y, z, { pitch: 1.3, range: 20, priority: 2 });
  }
  return playAnimalSound(type, x, y, z, { hurt: true });
}

export function playPlayerHurtSound() {
  if (audioSample('event_hurt_player', {
    spatial: false, volume: 0.8, priority: 3
  })) return true;
  return audioNoiseHit({
    type: 'lowpass', freq: 980, freqEnd: 240, q: 0.8,
    duration: 0.26, volume: 0.3
  }, audioListener.x, audioListener.y + EYE_HEIGHT, audioListener.z, {
    spatial: false, priority: 3
  });
}

export function playCraftSound() {
  // A completed recipe is one steady note, not the two-layer Kenney mix the bank
  // used to carry. That mix — a confirmation chime over a click — was 0.4 s with
  // most of its energy at 2–4.5 kHz, and the `file://` fallback on top of it was
  // a 2.2 kHz noise tick, which is the harshest thing in the game. One held note
  // at 680 Hz is the only sound here that does not glide, so a finished craft is
  // unmistakable next to the pickup, jump and screen blips.
  audioTone({
    type: 'sine', from: 680, to: 680, duration: 0.22,
    volume: 0.06, bus: 'ui', priority: 1
  });
  return !!audioCtx && !audioMuted;
}

/** A bite of food: two dry crunches, then a short swallow. */
export function playEatSound() {
  if (audioSample('event_eat', {
    spatial: false, volume: 0.65, bus: 'ui', priority: 1
  })) return true;

  const ctx = ensureAudio();
  if (!ctx) return false;
  if (!audioBeginVoice(0.42, 1)) return false;

  const now = ctx.currentTime;
  const bites = [
    { at: now, freq: 1500, end: 700, gain: 0.2 },
    { at: now + 0.19, freq: 1100, end: 420, gain: 0.17 }
  ];
  for (const bite of bites) {
    const source = ctx.createBufferSource();
    source.buffer = audioNoiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(bite.freq, bite.at);
    filter.frequency.exponentialRampToValueAtTime(bite.end, bite.at + 0.1);
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, bite.at);
    gain.gain.exponentialRampToValueAtTime(bite.gain, bite.at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, bite.at + 0.12);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioConnectOutput(0));
    source.start(bite.at, Math.random() * 0.4, 0.14);
    source.stop(bite.at + 0.16);
  }
  return true;
}

/** Sharp double snap for a tool reaching zero durability. */
export function playToolBreakSound() {
  if (audioSample('event_tool_break', {
    spatial: false, volume: 0.7, bus: 'ui', priority: 1
  })) return true;

  const ctx = ensureAudio();
  if (!ctx) return false;
  if (!audioBeginVoice(0.24, 1)) return false;
  const now = ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const at = now + i * 0.07;
    const source = ctx.createBufferSource();
    source.buffer = audioNoiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(i ? 1100 : 1900, at);
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioConnectOutput(0));
    source.start(at, Math.random() * 0.4, 0.12);
    source.stop(at + 0.13);
  }
  audioTone({
    type: 'square',
    from: 420,
    to: 130,
    duration: 0.18,
    volume: 0.07,
    pan: 0
  });
  return true;
}

/** Airy whoosh plus a low rumble as a furnace catches its fuel. */
export function playFurnaceIgniteSound(x, y, z) {
  if (audioSample('event_furnace_ignite', {
    x, y, z, volume: 0.52, range: 22, priority: 1,
    pitch: 0.94 + Math.random() * 0.12
  })) return true;
  return audioNoiseHit(
    {
      type: 'bandpass', freq: 420, freqEnd: 1500, q: 0.8,
      duration: 0.42, volume: 0.18, tone: 92, toneVolume: 0.1
    },
    x, y, z, { range: 22 }
  );
}

/** Soft muted chink when a smelted item lands in the output slot. */
export function playFurnaceFinishSound(x, y, z) {
  if (audioSample('event_furnace_finish', {
    x, y, z, volume: 0.42, range: 16, priority: 1,
    pitch: 0.96 + Math.random() * 0.1
  })) return true;
  return audioNoiseHit(
    { type: 'highpass', freq: 2400, duration: 0.16, volume: 0.07 },
    x, y, z, { range: 16 }
  );
}

/** Wooden creak as a chest lid swings up: a rising band over a low knock. */
export function playChestOpenSound(x, y, z) {
  if (audioSample('event_chest_open', {
    x, y, z, volume: 0.5, range: 20, priority: 1,
    pitch: 0.94 + Math.random() * 0.12
  })) return true;
  return audioNoiseHit(
    {
      type: 'bandpass', freq: 480, freqEnd: 1040, q: 1.8,
      duration: 0.28, volume: 0.15, tone: 128, toneVolume: 0.06
    },
    x, y, z, { range: 20, pitch: 0.92 + Math.random() * 0.14 }
  );
}

/** The lid dropping shut: one low, short knock where the open creak rose. */
export function playChestCloseSound(x, y, z) {
  if (audioSample('event_chest_close', {
    x, y, z, volume: 0.5, range: 20, priority: 1,
    pitch: 0.94 + Math.random() * 0.12
  })) return true;
  return audioNoiseHit(
    { type: 'lowpass', freq: 900, freqEnd: 240, q: 0.9, duration: 0.14, volume: 0.2 },
    x, y, z, { range: 20, pitch: 0.85 + Math.random() * 0.12 }
  );
}

/** Earthy scrape as a hoe drags furrows through soil. */
export function playHoeTillSound(x, y, z) {
  if (audioSample('event_hoe', {
    x, y, z, volume: 0.52, range: 18, priority: 1,
    pitch: 0.94 + Math.random() * 0.12
  })) return true;
  return audioNoiseHit(
    { type: 'lowpass', freq: 1500, freqEnd: 430, q: 0.7, duration: 0.26, volume: 0.26 },
    x, y, z, { range: 18, pitch: 0.9 + Math.random() * 0.15 }
  );
}

export function playExplosionSound(x, y, z) {
  if (audioSample('event_explosion', {
    x, y, z, volume: 1.04, range: 58, priority: 4, reverb: 0.38
  })) {
    const spatial = audioSpatial(x, y, z, 58);
    if (spatial.gain > 0.001) {
      // The recorded blast is mostly sub-bass, which small speakers swallow.
      // A short midrange crack and a sub drop give it the extra weight.
      audioNoiseHit({
        type: 'bandpass', freq: 1500, freqEnd: 500, q: 0.7,
        duration: 0.22, volume: 0.22
      }, x, y, z, { range: 58, priority: 4, reverb: 0.3 });
      audioTone({
        type: 'sine', from: 74, to: 30, duration: 0.72,
        volume: 0.3 * spatial.gain, pan: spatial.pan,
        priority: 4, reverb: 0.28
      });
    }
    return true;
  }

  const ctx = ensureAudio();
  if (!ctx) return false;
  const spatial = audioSpatial(x, y, z, 58);
  if (spatial.gain <= 0.001) return false;

  const duration = 1.2;
  if (!audioBeginVoice(duration, 4)) return false;

  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  const noise = audioBrownBuffer || audioNoiseBuffer;
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2800, now);
  filter.frequency.exponentialRampToValueAtTime(140, now + duration);
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  const volume = 0.58 * spatial.gain;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioConnectOutput(spatial.pan, 'sfx', 0.32));
  const maxOffset = Math.max(0.01, noise.duration - duration - 0.05);
  source.start(now, Math.random() * maxOffset, duration);
  source.stop(now + duration + 0.04);

  audioNoiseHit({
    type: 'bandpass', freq: 1600, freqEnd: 460, q: 0.7,
    duration: 0.24, volume: 0.14
  }, x, y, z, { range: 58, priority: 4, reverb: 0.3 });
  audioTone({
    type: 'sine',
    from: 94,
    to: 30,
    duration: 0.82,
    volume: 0.46 * spatial.gain,
    pan: spatial.pan,
    priority: 4,
    reverb: 0.32
  });
  return true;
}

/** Debug/test entry point: trigger a named procedural sound. */
export function playSound(name, options = {}) {
  const x = options.x ?? audioListener.x;
  const y = options.y ?? (audioListener.y + 1);
  const z = options.z ?? audioListener.z;

  switch (String(name || '').toLowerCase()) {
    case 'break':
      return options.material
        ? playMaterialNoise(String(options.material).toLowerCase(), x, y, z, {
          action: 'break', pitch: 0.92 + Math.random() * 0.16,
          volume: 0.7, range: 22
        })
        : playBreakSound(options.blockId ?? B.STONE, x, y, z);
    case 'hit':
    case 'dig':
      return options.material
        ? playMaterialNoise(String(options.material).toLowerCase(), x, y, z, {
          action: 'break', pitch: 0.76 + Math.random() * 0.2,
          volume: 0.38, durationScale: 0.8, range: 16,
          priority: 0, occlude: false
        })
        : playMiningHitSound(options.blockId ?? B.STONE, x, y, z);
    case 'place':
      return options.material
        ? playMaterialNoise(String(options.material).toLowerCase(), x, y, z, {
          action: 'place', pitch: 0.68 + Math.random() * 0.1,
          volume: 0.52, durationScale: 0.72, range: 18
        })
        : playPlaceSound(options.blockId ?? B.STONE, x, y, z);
    case 'step':
    case 'footstep':
      return playFootstepSound(options.material ?? 'grass', x, y, z, !!options.sprinting);
    case 'zombie':
      return playZombieGroan(x, y, z);
    case 'creeper':
    case 'hiss':
      return playCreeperHiss(x, y, z);
    case 'cow':
    case 'pig':
    case 'sheep':
    case 'chicken':
      return playAnimalSound(String(name).toLowerCase(), x, y, z, options);
    case 'mobhurt':
      return playMobHurtSound(options.type ?? 'zombie', x, y, z);
    case 'hurt':
    case 'playerhurt':
      return playPlayerHurtSound();
    case 'craft':
      return playCraftSound();
    case 'eat':
      return playEatSound();
    case 'toolbreak':
    case 'tooldamage':
      return playToolBreakSound();
    case 'door':
      return playDoorSound(x, y, z);
    case 'shear':
      return playShearSound(x, y, z);
    case 'bucketfill':
      return playFillBucketSound(x, y, z);
    case 'bucketpour':
      return playPourBucketSound(x, y, z);
    case 'hoe':
      return playHoeTillSound(x, y, z);
    case 'furnace':
    case 'furnaceignite':
      return playFurnaceIgniteSound(x, y, z);
    case 'furnacefinish':
      return playFurnaceFinishSound(x, y, z);
    case 'chestopen':
      return playChestOpenSound(x, y, z);
    case 'chestclose':
      return playChestCloseSound(x, y, z);
    case 'land':
      return playLandingSound(
        options.blockId ?? B.STONE, x, y, z, options.strength ?? 2
      );
    case 'splash':
    case 'waterentry':
      return playWaterEntrySound(x, y, z);
    case 'swim':
      return playSwimSound(x, y, z);
    case 'jump':
      return playJumpSound();
    case 'pickup':
      return playPickupSound();
    case 'essence':
      return playEssenceSound();
    case 'ui':
    case 'uiclick':
      return playUiClickSound();
    case 'uiopen':
      return playUiOpenSound();
    case 'uiclose':
      return playUiCloseSound();
    case 'heartbeat':
      return playHeartbeatSound();
    case 'death':
      return playDeathSound();
    case 'explosion':
      return playExplosionSound(x, y, z);
    default:
      return false;
  }
}

export function audioStatus() {
  return {
    supported: audioSupported(),
    created: !!audioCtx,
    state: audioCtx ? audioCtx.state : 'none',
    unlocked: !!audioCtx && audioCtx.state === 'running',
    muted: audioMuted,
    volume: audioVolume,
    masterVolume: audioVolume,
    sfxVolume: audioSfxVolume,
    musicVolume: audioMusicVolume,
    musicTrack: audioMusicTrack,
    musicVariant: (audioLoops.get(audioMusicTrack) || {}).variant ?? null,
    musicPlayed: audioMusicPlayed,
    activeVoices: audioVoices.size,
    maxVoices: AUDIO_MAX_VOICES,
    noiseBuffer: !!audioNoiseBuffer,
    pinkNoise: !!audioPinkBuffer,
    brownNoise: !!audioBrownBuffer,
    reverb: !!audioReverb,
    assets: { ...audioAssetLoad },
    loops: Array.from(audioLoops.keys()),
    ambient: { ...audioAmbientSnapshot },
    sampleRate: audioCtx ? audioCtx.sampleRate : 0
  };
}

updateAudioHud();
