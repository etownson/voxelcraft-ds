#!/usr/bin/env node
/**
 * Generate VoxelVerse's synthesized sample bank.
 *
 * The active bank is the CC0 recordings in `assets/audio/`, built by
 * `tools/build-cc0-bank.py`. That script needs only two files from this bank —
 * the creeper fuse and the heartbeat — and renders it into a throwaway
 * directory with `--out`; the committed copy of `assets/audio-generated/` was
 * removed as unused at runtime. Run this without arguments to write the
 * reference bank back to `assets/audio-generated/`; it must never overwrite
 * the active bank.
 *
 * Short effects are 44.1 kHz mono 16-bit PCM WAV. Ambient beds are 22.05 kHz
 * so a 16-second loop stays around 700 KB. WAV is deliberate: `decodeAudioData`
 * handles it everywhere, it has no encoder delay (important for loops), and it
 * needs no build-time codec. GitHub Pages serves it as a normal static file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFlag = process.argv.indexOf('--out');
const OUT_DIR = outFlag !== -1 && process.argv[outFlag + 1]
  ? path.resolve(process.argv[outFlag + 1])
  : path.join(ROOT, 'assets', 'audio-generated');
const SFX_RATE = 44100;
const LOOP_RATE = 22050;

fs.mkdirSync(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ *
 * Deterministic randomness and small DSP helpers
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function makeBuffer(seconds, sr) {
  return new Float32Array(Math.max(1, Math.ceil(seconds * sr)));
}

function mixInto(target, source, gain = 1, offset = 0) {
  const start = Math.max(0, Math.floor(offset));
  const count = Math.min(source.length, target.length - start);
  for (let i = 0; i < count; i++) target[start + i] += source[i] * gain;
}

function noiseArray(length, rand, color = 'white') {
  const out = new Float32Array(length);
  if (color === 'white') {
    for (let i = 0; i < length; i++) out[i] = rand() * 2 - 1;
  } else if (color === 'pink') {
    // Paul Kellet's economical pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = rand() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    // Brown / red noise: integrate white and leak the DC.
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (rand() * 2 - 1)) * 0.998;
      out[i] = last * 3.5;
    }
  }
  return out;
}

function biquad(data, sr, type, freq, q = 0.707, gainDb = 0) {
  const w0 = (2 * Math.PI * clamp(freq, 20, sr * 0.45)) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(0.0001, q));
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === 'bandpass') {
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === 'peak') {
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else {
    throw new Error('unknown biquad type ' + type);
  }
  const x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let sX1 = x1, sX2 = x2, sY1 = y1, sY2 = y2;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 * x + b1 * sX1 + b2 * sX2 - a1 * sY1 - a2 * sY2) / a0;
    sX2 = sX1; sX1 = x; sY2 = sY1; sY1 = y;
    data[i] = y;
  }
  return data;
}

/** One-pole low-pass whose cutoff can follow a function of sample index. */
function sweepLowpass(data, sr, cutoffAt) {
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    const cutoff = clamp(cutoffAt(i / data.length), 30, sr * 0.45);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
    y += a * (data[i] - y);
    data[i] = y;
  }
  return data;
}

function sweepHighpass(data, sr, cutoffAt) {
  let y = 0;
  let prev = 0;
  for (let i = 0; i < data.length; i++) {
    const cutoff = clamp(cutoffAt(i / data.length), 30, sr * 0.45);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
    const x = data[i];
    y = a * (y + x - prev);
    prev = x;
    data[i] = y;
  }
  return data;
}

function normalize(data, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
  if (max < 1e-9) return data;
  const scale = peak / max;
  for (let i = 0; i < data.length; i++) data[i] *= scale;
  return data;
}

function fadeEdges(data, sr, seconds = 0.004) {
  const n = Math.min(Math.floor(seconds * sr), Math.floor(data.length / 2));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    data[i] *= t;
    data[data.length - 1 - i] *= t;
  }
  return data;
}

/**
 * Crossfade the tail of a longer render back over its head so the result loops
 * without a click. Returns exactly `loopSeconds` of audio.
 */
function seamlessLoop(data, sr, loopSeconds, fadeSeconds = 0.75) {
  const length = Math.min(data.length, Math.floor(loopSeconds * sr));
  const fade = Math.min(Math.floor(fadeSeconds * sr), Math.floor(length / 2));
  const out = data.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const t = i / Math.max(1, fade - 1);
    out[i] = data[i] * t + data[length + i] * (1 - t);
  }
  return out;
}

function softClip(data, drive = 1) {
  for (let i = 0; i < data.length; i++) {
    const x = data[i] * drive;
    data[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
  }
  return data;
}

function addSine(target, sr, options = {}) {
  const from = options.from ?? 440;
  const to = options.to ?? from;
  const duration = options.duration ?? target.length / sr;
  const volume = options.volume ?? 0.2;
  const start = Math.max(0, Math.floor((options.at ?? 0) * sr));
  const length = Math.min(
    target.length - start,
    Math.max(1, Math.floor(duration * sr))
  );
  const attack = Math.max(1, Math.floor((options.attack ?? 0.005) * sr));
  const release = Math.max(1, Math.floor((options.release ?? duration * 0.5) * sr));
  let phase = options.phase ?? 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    const freq = from + (to - from) * t;
    phase += (2 * Math.PI * freq) / sr;
    let env = Math.min(1, i / attack);
    env *= Math.min(1, (length - i) / release);
    const wave = options.type === 'triangle'
      ? (2 / Math.PI) * Math.asin(Math.sin(phase))
      : options.type === 'saw'
        ? 2 * ((phase / (2 * Math.PI)) % 1) - 1
        : Math.sin(phase);
    target[start + i] += wave * volume * env;
  }
  return target;
}

function addNoise(target, sr, options = {}) {
  const rand = mulberry32(options.seed ?? 1);
  const color = options.color ?? 'white';
  const duration = options.duration ?? target.length / sr;
  const start = Math.max(0, Math.floor((options.at ?? 0) * sr));
  const length = Math.min(
    target.length - start,
    Math.max(1, Math.floor(duration * sr))
  );
  const source = noiseArray(length, rand, color);
  const attack = Math.max(1, Math.floor((options.attack ?? 0.004) * sr));
  const release = Math.max(1, Math.floor((options.release ?? duration * 0.6) * sr));
  const curve = options.curve ?? 1.6;
  for (let i = 0; i < length; i++) {
    let env = Math.min(1, i / attack);
    const out = Math.min(1, (length - i) / release);
    env *= Math.pow(out, curve);
    target[start + i] += source[i] * (options.volume ?? 0.2) * env;
  }
  return target;
}

function addCrackle(target, sr, options = {}) {
  const rand = mulberry32(options.seed ?? 99);
  const count = options.count ?? 24;
  const duration = target.length / sr;
  for (let i = 0; i < count; i++) {
    const at = rand() * Math.max(0, duration - 0.02);
    const len = 0.004 + rand() * 0.02;
    const gain = (0.2 + rand() * 0.8) * (options.volume ?? 0.2);
    const start = Math.floor(at * sr);
    const length = Math.max(2, Math.floor(len * sr));
    for (let j = 0; j < length && start + j < target.length; j++) {
      const env = Math.pow(1 - j / length, 2.5);
      target[start + j] += (rand() * 2 - 1) * gain * env;
    }
  }
  return target;
}

function ensureStereoPair(data) {
  return data;
}

/* ------------------------------------------------------------------ *
 * WAV writing
 * ------------------------------------------------------------------ */

function writeWav(filename, data, sr) {
  const length = data.length;
  const bytes = new Uint8Array(44 + length * 2);
  const view = new DataView(bytes.buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);     // byte rate
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = clamp(data[i], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  fs.writeFileSync(path.join(OUT_DIR, filename), bytes);
}

/* ------------------------------------------------------------------ *
 * Material recipes
 * ------------------------------------------------------------------ */

const MATERIALS = {
  stone: { body: 720, end: 260, q: 0.9, thud: 116, click: 2400, decay: 0.22, tone: 0.12 },
  dirt: { body: 1180, end: 430, q: 0.7, thud: 92, click: 1300, decay: 0.17, tone: 0.04 },
  grass: { body: 1650, end: 620, q: 0.6, thud: 84, click: 2600, decay: 0.16, tone: 0.05 },
  sand: { body: 2200, end: 1150, q: 0.5, thud: 72, click: 3600, decay: 0.2, tone: 0.03 },
  snow: { body: 900, end: 340, q: 0.8, thud: 64, click: 1700, decay: 0.16, tone: 0.02 },
  wood: { body: 760, end: 400, q: 1.4, thud: 104, click: 1900, decay: 0.22, tone: 0.18 },
  leaves: { body: 2500, end: 1450, q: 0.6, thud: 70, click: 4200, decay: 0.18, tone: 0.02 },
  glass: { body: 3100, end: 1900, q: 2.4, thud: 150, click: 5200, decay: 0.16, tone: 0.32 },
  splash: { body: 1500, end: 330, q: 0.9, thud: 260, click: 2200, decay: 0.3, tone: 0.05 }
};

function materialHit(material, options = {}) {
  const sr = options.sr ?? SFX_RATE;
  const variant = options.variant ?? 1;
  const rand = mulberry32((options.seed ?? 1) + variant * 7919);
  const m = MATERIALS[material] ?? MATERIALS.stone;
  const duration = (options.duration ?? m.decay) * (0.92 + rand() * 0.16);
  const out = makeBuffer(duration + 0.05, sr);

  // Bright contact transient.
  const click = makeBuffer(0.055, sr);
  addNoise(click, sr, {
    seed: 1000 + variant * 17, volume: options.clickVolume ?? 0.38,
    attack: 0.0005, release: 0.04, curve: 2.4
  });
  biquad(click, sr, 'highpass', m.click * (0.9 + rand() * 0.2), 0.8);
  mixInto(out, click, 0.9);

  // Main body: noise swept through the material's band.
  const body = makeBuffer(duration, sr);
  addNoise(body, sr, {
    seed: 2000 + variant * 31, volume: options.bodyVolume ?? 0.45,
    attack: 0.003, release: duration * 0.86, curve: 1.5
  });
  sweepLowpass(body, sr, (t) => m.body * (1 - t) + m.end * t);
  biquad(body, sr, 'peak', Math.max(80, (m.body + m.end) * 0.5), m.q, 2);
  mixInto(out, body, 0.95);

  // A little grit after the hit.
  if (material !== 'splash') {
    const grit = makeBuffer(duration * 0.8, sr);
    addCrackle(grit, sr, { seed: 3000 + variant * 13, count: 14, volume: 0.16 });
    biquad(grit, sr, 'bandpass', m.body * 0.8, 0.7);
    mixInto(out, grit, 0.55, 0.012);
  }

  // Low weight.
  const thud = makeBuffer(0.22, sr);
  addSine(thud, sr, {
    type: 'triangle', from: m.thud, to: m.thud * 0.55,
    duration: 0.2, volume: options.thudVolume ?? 0.22,
    attack: 0.002, release: 0.18
  });
  mixInto(out, thud, 0.9);

  // Material resonance.
  if (m.tone > 0.08) {
    const tone = makeBuffer(0.35, sr);
    addSine(tone, sr, {
      type: 'triangle', from: m.thud * 2.1, to: m.thud * 1.35,
      duration: 0.3, volume: options.toneVolume ?? m.tone,
      attack: 0.003, release: 0.28
    });
    mixInto(out, tone, 0.7);
  }

  normalize(out, options.peak ?? 0.82);
  fadeEdges(out, sr, 0.003);
  return out;
}

/* ------------------------------------------------------------------ *
 * One-shot recipes
 * ------------------------------------------------------------------ */

function makeFootstep(material, variant) {
  const rand = mulberry32(4000 + variant * 101 + material.length * 37);
  return materialHit(material, {
    variant,
    seed: 11000 + material.length * 11,
    duration: 0.16,
    bodyVolume: 0.3,
    clickVolume: 0.18,
    thudVolume: 0.14,
    toneVolume: 0.06,
    peak: 0.55
  });
}

function makeBreak(material, variant) {
  const sr = SFX_RATE;
  const m = MATERIALS[material] ?? MATERIALS.stone;
  const rand = mulberry32(5000 + variant * 137 + material.length * 53);
  const out = materialHit(material, {
    variant,
    seed: 12000 + material.length * 7,
    duration: m.decay * 1.25,
    bodyVolume: 0.55,
    clickVolume: 0.5,
    thudVolume: 0.28,
    peak: 0.9
  });
  // Extra debris after the main crack.
  const debris = makeBuffer(0.3, sr);
  addCrackle(debris, sr, { seed: 13000 + variant * 41, count: 22, volume: 0.24 });
  biquad(debris, sr, 'bandpass', 1200 + rand() * 1800, 0.8);
  mixInto(out, debris, 0.7, 0.025);
  normalize(out, 0.92);
  fadeEdges(out, sr, 0.004);
  return out;
}

function makePlace(material, variant) {
  const out = materialHit(material, {
    variant: variant + 4,
    seed: 15000 + material.length * 17,
    duration: 0.16,
    bodyVolume: 0.32,
    clickVolume: 0.24,
    thudVolume: 0.2,
    peak: 0.7
  });
  return out;
}

function makeZombie(variant) {
  const sr = SFX_RATE;
  const rand = mulberry32(7000 + variant * 211);
  const duration = 0.9 + rand() * 0.5;
  const out = makeBuffer(duration, sr);
  const base = 68 + rand() * 30;
  const osc = makeBuffer(duration, sr);
  let phase = 0;
  let phase2 = 0;
  const lfo = 2.8 + rand() * 2.4;
  for (let i = 0; i < osc.length; i++) {
    const t = i / osc.length;
    const f = base * (1 - t * 0.38) * (1 + Math.sin(t * duration * lfo * Math.PI * 2) * 0.035);
    phase += (2 * Math.PI * f) / sr;
    phase2 += (2 * Math.PI * f * 2.02) / sr;
    const saw = 2 * ((phase / (2 * Math.PI)) % 1) - 1;
    const saw2 = 2 * ((phase2 / (2 * Math.PI)) % 1) - 1;
    const env = Math.min(1, t / 0.18) * Math.min(1, (1 - t) / 0.4);
    osc[i] = (saw * 0.7 + saw2 * 0.3) * env;
  }
  biquad(osc, sr, 'lowpass', 420, 1.1);
  biquad(osc, sr, 'peak', 700, 2.2, 5);
  mixInto(out, osc, 0.9);

  const breath = makeBuffer(duration, sr);
  addNoise(breath, sr, {
    seed: 7100 + variant, volume: 0.16, attack: 0.25,
    release: duration * 0.6, curve: 1.3
  });
  biquad(breath, sr, 'bandpass', 900, 0.8);
  mixInto(out, breath, 0.7);
  normalize(out, 0.72);
  fadeEdges(out, sr, 0.02);
  return out;
}

function makeCreeper() {
  // A lit fuse, not a breath: bright sizzle, irregular sputter, and a handful
  // of crackles that get denser as the blast approaches. The length matches
  // the 1.55 s creeper fuse so the sound stops when the explosion starts.
  const sr = SFX_RATE;
  const duration = 1.55;
  const out = makeBuffer(duration, sr);
  const rand = mulberry32(8100);

  const sizzle = noiseArray(out.length, rand, 'white');
  biquad(sizzle, sr, 'highpass', 1200, 0.7);
  biquad(sizzle, sr, 'bandpass', 2600, 0.8);

  // A slow random control signal makes the sizzle catch and sputter instead
  // of sitting at one flat level.
  const controlRate = 240;
  const control = noiseArray(Math.ceil(duration * controlRate), mulberry32(8101), 'white');
  biquad(control, controlRate, 'lowpass', 20, 0.7);
  let controlPeak = 0;
  for (let i = 0; i < control.length; i++) {
    controlPeak = Math.max(controlPeak, Math.abs(control[i]));
  }
  const controlScale = controlPeak > 1e-6 ? 1 / controlPeak : 0;

  for (let i = 0; i < sizzle.length; i++) {
    const t = i / sizzle.length;
    const c = Math.min(control.length - 1, Math.floor(t * control.length));
    const sputter = 0.35 + 0.65 * (0.5 + 0.5 * control[c] * controlScale);
    const rise = 0.35 + 0.65 * Math.pow(t, 0.75);
    out[i] += sizzle[i] * sputter * rise * 0.5;
  }

  const crackle = makeBuffer(duration, sr);
  const crackleRand = mulberry32(8102);
  const crackles = 38;
  for (let n = 0; n < crackles; n++) {
    // Bias the ticks toward the end of the fuse.
    const at = Math.pow(crackleRand(), 0.65) * (duration - 0.02);
    const length = Math.max(2, Math.floor((0.003 + crackleRand() * 0.012) * sr));
    const start = Math.floor(at * sr);
    const gain = (0.18 + crackleRand() * 0.5) * (0.3 + 0.7 * (at / duration));
    for (let j = 0; j < length && start + j < crackle.length; j++) {
      const env = Math.pow(1 - j / length, 3);
      crackle[start + j] += (crackleRand() * 2 - 1) * gain * env;
    }
  }
  biquad(crackle, sr, 'highpass', 1200, 0.7);
  biquad(crackle, sr, 'bandpass', 2800, 0.9);
  mixInto(out, crackle, 0.95);

  const bed = makeBuffer(duration, sr);
  addNoise(bed, sr, {
    seed: 8103, color: 'brown', volume: 0.18,
    attack: 0.08, release: duration * 0.8, curve: 1.1
  });
  biquad(bed, sr, 'lowpass', 340, 0.8);
  mixInto(out, bed, 0.35);

  normalize(out, 0.72);
  fadeEdges(out, sr, 0.012);
  return out;
}

function makeAnimal(type, variant) {
  const sr = SFX_RATE;
  const rand = mulberry32(9000 + variant * 173 + type.length * 31);
  const voices = {
    cow: { type: 'saw', from: 160, to: 108, duration: 0.72, filter: 540, q: 1.4, volume: 0.5 },
    pig: { type: 'square', from: 290, to: 205, duration: 0.36, filter: 850, q: 1.1, volume: 0.4 },
    sheep: { type: 'triangle', from: 345, to: 292, duration: 0.58, filter: 1040, q: 0.9, volume: 0.4 },
    chicken: { type: 'sine', from: 940, to: 1280, duration: 0.22, filter: 1900, q: 0.7, volume: 0.35 }
  };
  const v = voices[type] ?? voices.cow;
  const out = makeBuffer(v.duration + 0.2, sr);
  const osc = makeBuffer(v.duration, sr);
  let phase = 0;
  for (let i = 0; i < osc.length; i++) {
    const t = i / osc.length;
    const f = (v.from + (v.to - v.from) * t) * (1 + Math.sin(t * 38) * 0.012);
    phase += (2 * Math.PI * f) / sr;
    let wave;
    if (v.type === 'saw') wave = 2 * ((phase / (2 * Math.PI)) % 1) - 1;
    else if (v.type === 'square') wave = Math.sin(phase) > 0 ? 0.7 : -0.7;
    else if (v.type === 'triangle') wave = (2 / Math.PI) * Math.asin(Math.sin(phase));
    else wave = Math.sin(phase);
    const env = Math.min(1, t / 0.06) * Math.min(1, (1 - t) / 0.35);
    osc[i] = wave * env;
  }
  biquad(osc, sr, 'lowpass', v.filter, v.q);
  mixInto(out, osc, v.volume);
  if (type === 'chicken' && variant % 2 === 0) {
    addSine(out, sr, {
      type: 'sine', from: 1080, to: 1420, duration: 0.12,
      volume: 0.18, at: 0.18, attack: 0.004, release: 0.1
    });
  }
  if (type === 'cow' || type === 'sheep') {
    addNoise(out, sr, {
      seed: 9100 + variant, volume: 0.06, attack: 0.08,
      release: v.duration * 0.5, curve: 1.4
    });
  }
  normalize(out, 0.68);
  fadeEdges(out, sr, 0.012);
  return out;
}

function makeHurtPlayer() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.34, sr);
  const noise = makeBuffer(0.3, sr);
  addNoise(noise, sr, { seed: 10100, volume: 0.4, attack: 0.002, release: 0.26, curve: 1.8 });
  sweepLowpass(noise, sr, (t) => 1100 - t * 850);
  mixInto(out, noise, 0.9);
  addSine(out, sr, {
    type: 'triangle', from: 220, to: 110, duration: 0.28,
    volume: 0.16, attack: 0.002, release: 0.24
  });
  normalize(out, 0.8);
  fadeEdges(out, sr, 0.004);
  return out;
}

function makeHurtMob() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.24, sr);
  addNoise(out, sr, { seed: 10200, volume: 0.32, attack: 0.002, release: 0.2, curve: 1.7 });
  biquad(out, sr, 'bandpass', 900, 1.0);
  addSine(out, sr, {
    type: 'triangle', from: 300, to: 160, duration: 0.2,
    volume: 0.12, attack: 0.002, release: 0.16
  });
  normalize(out, 0.72);
  fadeEdges(out, sr, 0.004);
  return out;
}

function makeExplosion() {
  const sr = SFX_RATE;
  const duration = 1.4;
  const out = makeBuffer(duration, sr);
  const noise = makeBuffer(duration, sr);
  addNoise(noise, sr, {
    seed: 11100, color: 'brown', volume: 1.0,
    attack: 0.004, release: duration * 0.9, curve: 1.15
  });
  sweepLowpass(noise, sr, (t) => 2600 * Math.pow(1 - t, 2.2) + 90);
  biquad(noise, sr, 'peak', 120, 1.0, 4);
  softClip(noise, 1.7);
  mixInto(out, noise, 0.9);
  addSine(out, sr, {
    type: 'sine', from: 92, to: 28, duration: 0.95,
    volume: 0.55, attack: 0.003, release: 0.9
  });
  const debris = makeBuffer(0.7, sr);
  addCrackle(debris, sr, { seed: 11200, count: 34, volume: 0.3 });
  biquad(debris, sr, 'bandpass', 1600, 0.7);
  mixInto(out, debris, 0.5, 0.05);
  normalize(out, 0.95);
  fadeEdges(out, sr, 0.006);
  return out;
}

function makeCraft() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.28, sr);
  addNoise(out, sr, { seed: 12100, volume: 0.22, attack: 0.0005, release: 0.05, curve: 2.5 });
  biquad(out, sr, 'highpass', 2200, 0.8);
  addSine(out, sr, {
    type: 'triangle', from: 760, to: 1080, duration: 0.11,
    volume: 0.14, at: 0.06, attack: 0.004, release: 0.1
  });
  addSine(out, sr, {
    type: 'sine', from: 1180, to: 1320, duration: 0.08,
    volume: 0.07, at: 0.13, attack: 0.004, release: 0.07
  });
  normalize(out, 0.6);
  fadeEdges(out, sr, 0.003);
  return out;
}

function makeEat(variant) {
  const sr = SFX_RATE;
  const out = makeBuffer(0.5, sr);
  for (let i = 0; i < 2; i++) {
    const at = i * 0.19 + (variant % 2) * 0.02;
    const bite = makeBuffer(0.13, sr);
    addNoise(bite, sr, {
      seed: 13100 + variant * 7 + i * 13, volume: 0.34,
      attack: 0.001, release: 0.11, curve: 1.8
    });
    sweepLowpass(bite, sr, (t) => 1700 - t * 1000);
    biquad(bite, sr, 'bandpass', 1100, 1.1);
    mixInto(out, bite, 0.9, at);
  }
  addSine(out, sr, {
    type: 'sine', from: 300, to: 120, duration: 0.18,
    volume: 0.08, at: 0.36, attack: 0.01, release: 0.16
  });
  normalize(out, 0.66);
  fadeEdges(out, sr, 0.004);
  return out;
}

function makeDoor() {
  const sr = SFX_RATE;
  const duration = 0.72;
  const out = makeBuffer(duration, sr);
  const creak = makeBuffer(duration, sr);
  addNoise(creak, sr, {
    seed: 14100, volume: 0.22, attack: 0.06,
    release: duration * 0.8, curve: 1.2
  });
  // A slow bandpass sweep is the hinge's complaint.
  for (let i = 0; i < creak.length; i++) {
    const t = i / creak.length;
    const cutoff = 420 + t * 620;
    // Cheap resonant emphasis by mixing a delayed copy.
    const d = Math.min(creak.length - 1, i + Math.floor(sr / cutoff));
    creak[i] = creak[i] * 0.7 + creak[d] * 0.3;
  }
  biquad(creak, sr, 'bandpass', 640, 2.2);
  mixInto(out, creak, 1);
  const knock = makeBuffer(0.2, sr);
  addSine(knock, sr, {
    type: 'triangle', from: 140, to: 80, duration: 0.18,
    volume: 0.2, attack: 0.002, release: 0.15
  });
  mixInto(out, knock, 0.7, 0.52);
  normalize(out, 0.62);
  fadeEdges(out, sr, 0.01);
  return out;
}

function makeChestOpen() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.55, sr);
  const creak = makeBuffer(0.5, sr);
  addNoise(creak, sr, {
    seed: 15100, volume: 0.2, attack: 0.05,
    release: 0.42, curve: 1.2
  });
  sweepLowpass(creak, sr, (t) => 480 + t * 700);
  biquad(creak, sr, 'bandpass', 760, 1.8);
  mixInto(out, creak, 1);
  addSine(out, sr, {
    type: 'triangle', from: 128, to: 84, duration: 0.16,
    volume: 0.13, at: 0.02, attack: 0.002, release: 0.14
  });
  normalize(out, 0.58);
  fadeEdges(out, sr, 0.008);
  return out;
}

function makeChestClose() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.28, sr);
  addNoise(out, sr, { seed: 15200, volume: 0.28, attack: 0.001, release: 0.12, curve: 2.2 });
  sweepLowpass(out, sr, (t) => 900 - t * 650);
  addSine(out, sr, {
    type: 'triangle', from: 116, to: 70, duration: 0.18,
    volume: 0.18, attack: 0.002, release: 0.15
  });
  normalize(out, 0.7);
  fadeEdges(out, sr, 0.004);
  return out;
}

function makeToolBreak() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.38, sr);
  for (let i = 0; i < 2; i++) {
    const at = i * 0.075;
    const snap = makeBuffer(0.11, sr);
    addNoise(snap, sr, {
      seed: 16100 + i * 11, volume: 0.4,
      attack: 0.0005, release: 0.09, curve: 2.4
    });
    biquad(snap, sr, 'bandpass', i ? 1150 : 1950, 1.5);
    mixInto(out, snap, 0.9, at);
  }
  addSine(out, sr, {
    type: 'square', from: 420, to: 120, duration: 0.2,
    volume: 0.1, at: 0.02, attack: 0.002, release: 0.18
  });
  normalize(out, 0.75);
  fadeEdges(out, sr, 0.004);
  return out;
}

function makeFurnaceIgnite() {
  const sr = SFX_RATE;
  const duration = 0.75;
  const out = makeBuffer(duration, sr);
  const air = makeBuffer(duration, sr);
  addNoise(air, sr, {
    seed: 17100, volume: 0.26, attack: 0.08,
    release: duration * 0.7, curve: 1.3
  });
  sweepLowpass(air, sr, (t) => 420 + t * 1300);
  biquad(air, sr, 'bandpass', 900, 0.8);
  mixInto(out, air, 1);
  addSine(out, sr, {
    type: 'sine', from: 92, to: 68, duration: 0.5,
    volume: 0.14, attack: 0.02, release: 0.4
  });
  addCrackle(out, sr, { seed: 17200, count: 10, volume: 0.1 });
  normalize(out, 0.62);
  fadeEdges(out, sr, 0.01);
  return out;
}

function makeFurnaceFinish() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.3, sr);
  addNoise(out, sr, { seed: 18100, volume: 0.16, attack: 0.001, release: 0.08, curve: 2 });
  biquad(out, sr, 'highpass', 2400, 0.7);
  addSine(out, sr, {
    type: 'sine', from: 1560, to: 1320, duration: 0.18,
    volume: 0.08, at: 0.02, attack: 0.002, release: 0.16
  });
  normalize(out, 0.5);
  fadeEdges(out, sr, 0.003);
  return out;
}

function makeHoe() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.4, sr);
  addNoise(out, sr, {
    seed: 19100, volume: 0.34, attack: 0.004,
    release: 0.34, curve: 1.5
  });
  sweepLowpass(out, sr, (t) => 1500 - t * 1050);
  addCrackle(out, sr, { seed: 19200, count: 12, volume: 0.08 });
  normalize(out, 0.62);
  fadeEdges(out, sr, 0.005);
  return out;
}

function makeBucket(fill) {
  const sr = SFX_RATE;
  const duration = fill ? 0.42 : 0.85;
  const out = makeBuffer(duration, sr);
  const water = makeBuffer(duration, sr);
  addNoise(water, sr, {
    seed: fill ? 20100 : 20200, volume: 0.34, attack: 0.01,
    release: duration * 0.8, curve: 1.2
  });
  sweepLowpass(water, sr, (t) => fill
    ? 1500 - t * 1150
    : 750 + t * 1150);
  biquad(water, sr, 'bandpass', fill ? 760 : 1200, 0.9);
  mixInto(out, water, 1);
  // A few bubbles give the water a surface.
  const rand = mulberry32(fill ? 20300 : 20400);
  const bubbles = fill ? 5 : 9;
  for (let i = 0; i < bubbles; i++) {
    addSine(out, sr, {
      type: 'sine',
      from: 300 + rand() * 500,
      to: 520 + rand() * 700,
      duration: 0.06 + rand() * 0.08,
      volume: 0.05 + rand() * 0.04,
      at: rand() * (duration * 0.7),
      attack: 0.004,
      release: 0.07
    });
  }
  if (!fill) {
    addSine(out, sr, {
      type: 'triangle', from: 120, to: 70, duration: 0.3,
      volume: 0.08, attack: 0.01, release: 0.25
    });
  }
  normalize(out, 0.68);
  fadeEdges(out, sr, 0.008);
  return out;
}

function makeShear() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.2, sr);
  addNoise(out, sr, {
    seed: 21100, volume: 0.24, attack: 0.0005,
    release: 0.08, curve: 2.4
  });
  biquad(out, sr, 'bandpass', 2600, 2.2);
  addSine(out, sr, {
    type: 'triangle', from: 880, to: 620, duration: 0.12,
    volume: 0.09, attack: 0.001, release: 0.1
  });
  normalize(out, 0.58);
  fadeEdges(out, sr, 0.003);
  return out;
}

function makeSplash() {
  const sr = SFX_RATE;
  const duration = 0.55;
  const out = makeBuffer(duration, sr);
  addNoise(out, sr, {
    seed: 22100, volume: 0.5, attack: 0.004,
    release: duration * 0.8, curve: 1.35
  });
  sweepLowpass(out, sr, (t) => 1600 - t * 1350);
  biquad(out, sr, 'bandpass', 900, 0.8);
  const rand = mulberry32(22200);
  for (let i = 0; i < 8; i++) {
    addSine(out, sr, {
      type: 'sine',
      from: 340 + rand() * 500,
      to: 600 + rand() * 800,
      duration: 0.05 + rand() * 0.08,
      volume: 0.05 + rand() * 0.05,
      at: rand() * 0.35,
      attack: 0.003,
      release: 0.06
    });
  }
  normalize(out, 0.8);
  fadeEdges(out, sr, 0.006);
  return out;
}

function makeSwim(variant) {
  const sr = SFX_RATE;
  const out = makeBuffer(0.4, sr);
  addNoise(out, sr, {
    seed: 23100 + variant * 11, volume: 0.28,
    attack: 0.02, release: 0.34, curve: 1.2
  });
  sweepLowpass(out, sr, (t) => 700 + Math.sin(t * Math.PI) * 500);
  biquad(out, sr, 'bandpass', 500, 0.8);
  normalize(out, 0.45);
  fadeEdges(out, sr, 0.01);
  return out;
}

function makeLand(variant) {
  const sr = SFX_RATE;
  const out = makeBuffer(0.34, sr);
  addNoise(out, sr, {
    seed: 24100 + variant * 17, volume: 0.34,
    attack: 0.001, release: 0.26, curve: 1.8
  });
  sweepLowpass(out, sr, (t) => 900 - t * 700);
  addSine(out, sr, {
    type: 'triangle', from: 86 + variant * 10, to: 48,
    duration: 0.22, volume: 0.28, attack: 0.002, release: 0.2
  });
  normalize(out, 0.78);
  fadeEdges(out, sr, 0.004);
  return out;
}

function makeJump() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.22, sr);
  addNoise(out, sr, {
    seed: 25100, volume: 0.18, attack: 0.01,
    release: 0.16, curve: 1.3
  });
  biquad(out, sr, 'bandpass', 900, 0.6);
  addSine(out, sr, {
    type: 'sine', from: 180, to: 120, duration: 0.12,
    volume: 0.06, attack: 0.005, release: 0.1
  });
  normalize(out, 0.4);
  fadeEdges(out, sr, 0.005);
  return out;
}

function makePickup(variant) {
  const sr = SFX_RATE;
  const out = makeBuffer(0.22, sr);
  const base = variant % 2 ? 1180 : 980;
  addSine(out, sr, {
    type: 'triangle', from: base, to: base * 1.5, duration: 0.1,
    volume: 0.12, attack: 0.002, release: 0.09
  });
  addSine(out, sr, {
    type: 'sine', from: base * 1.5, to: base * 2, duration: 0.08,
    volume: 0.05, at: 0.06, attack: 0.002, release: 0.07
  });
  normalize(out, 0.42);
  fadeEdges(out, sr, 0.003);
  return out;
}

function makeUi(kind) {
  const sr = SFX_RATE;
  if (kind === 'click') {
    const out = makeBuffer(0.09, sr);
    addNoise(out, sr, { seed: 26100, volume: 0.18, attack: 0.0005, release: 0.05, curve: 2.5 });
    biquad(out, sr, 'bandpass', 1800, 1.4);
    addSine(out, sr, {
      type: 'triangle', from: 760, to: 680, duration: 0.05,
      volume: 0.06, attack: 0.001, release: 0.04
    });
    normalize(out, 0.42);
    fadeEdges(out, sr, 0.002);
    return out;
  }
  const out = makeBuffer(0.3, sr);
  const up = kind === 'open';
  addSine(out, sr, {
    type: 'triangle', from: up ? 520 : 760, to: up ? 760 : 520,
    duration: 0.2, volume: 0.09, attack: 0.004, release: 0.17
  });
  addSine(out, sr, {
    type: 'sine', from: up ? 1040 : 1520, to: up ? 1520 : 1040,
    duration: 0.14, volume: 0.04, at: 0.04, attack: 0.004, release: 0.12
  });
  normalize(out, 0.32);
  fadeEdges(out, sr, 0.005);
  return out;
}

function makeHeartbeat() {
  const sr = SFX_RATE;
  const out = makeBuffer(0.6, sr);
  for (let i = 0; i < 2; i++) {
    addSine(out, sr, {
      type: 'sine', from: i ? 68 : 82, to: 42,
      duration: 0.17, volume: i ? 0.22 : 0.3,
      at: i * 0.22, attack: 0.008, release: 0.15
    });
  }
  normalize(out, 0.7);
  fadeEdges(out, sr, 0.008);
  return out;
}

function makeDeath() {
  const sr = SFX_RATE;
  const out = makeBuffer(1.6, sr);
  addSine(out, sr, {
    type: 'saw', from: 220, to: 55, duration: 1.4,
    volume: 0.16, attack: 0.02, release: 1.2
  });
  biquad(out, sr, 'lowpass', 700, 0.8);
  addNoise(out, sr, {
    seed: 27100, color: 'brown', volume: 0.3,
    attack: 0.02, release: 1.3, curve: 1.1
  });
  sweepLowpass(out, sr, (t) => 1200 - t * 900);
  normalize(out, 0.75);
  fadeEdges(out, sr, 0.02);
  return out;
}

/* ------------------------------------------------------------------ *
 * Ambient loops and music
 * ------------------------------------------------------------------ */

function makeWindLoop() {
  const sr = LOOP_RATE;
  const loopSeconds = 16;
  const renderSeconds = loopSeconds + 1;
  const rand = mulberry32(30100);
  const out = noiseArray(Math.floor(renderSeconds * sr), rand, 'pink');
  // Slow gusts: two low-frequency LFOs moving amplitude and cutoff.
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const gust = 0.55 + 0.45 * Math.sin(t * 0.31) * Math.sin(t * 0.13 + 1.7);
    const cutoff = 240 + 900 * (0.5 + 0.5 * Math.sin(t * 0.23 + 0.6));
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
    y += a * (out[i] - y);
    out[i] = y * gust;
  }
  // A thin whistle above the bed.
  addSine(out, sr, {
    type: 'sine', from: 620, to: 700, duration: renderSeconds,
    volume: 0.012, attack: 1.5, release: 2
  });
  normalize(out, 0.55);
  return seamlessLoop(out, sr, loopSeconds, 1.2);
}

function makeWaterLoop() {
  const sr = LOOP_RATE;
  const loopSeconds = 16;
  const renderSeconds = loopSeconds + 1;
  const rand = mulberry32(30200);
  const out = noiseArray(Math.floor(renderSeconds * sr), rand, 'pink');
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const swell = 0.6 + 0.4 * Math.sin(t * 0.42) * Math.sin(t * 0.19 + 2.1);
    const cutoff = 500 + 800 * (0.5 + 0.5 * Math.sin(t * 0.27));
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
    y += a * (out[i] - y);
    out[i] = y * swell;
  }
  // Occasional bubbles.
  const bubbleRand = mulberry32(30300);
  for (let i = 0; i < 26; i++) {
    addSine(out, sr, {
      type: 'sine',
      from: 260 + bubbleRand() * 300,
      to: 420 + bubbleRand() * 500,
      duration: 0.05 + bubbleRand() * 0.1,
      volume: 0.02 + bubbleRand() * 0.03,
      at: bubbleRand() * (renderSeconds - 0.2),
      attack: 0.004,
      release: 0.08
    });
  }
  normalize(out, 0.5);
  return seamlessLoop(out, sr, loopSeconds, 1.2);
}

function makeCaveLoop() {
  const sr = LOOP_RATE;
  const loopSeconds = 16;
  const renderSeconds = loopSeconds + 1;
  const rand = mulberry32(30400);
  const out = noiseArray(Math.floor(renderSeconds * sr), rand, 'brown');
  sweepLowpass(out, sr, () => 180);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] *= 0.55 + 0.45 * Math.sin(t * 0.21 + 1.2) * Math.sin(t * 0.09);
  }
  // Water drips with a short synthetic tail.
  const dripRand = mulberry32(30500);
  for (let i = 0; i < 10; i++) {
    const at = dripRand() * (renderSeconds - 0.5);
    const freq = 700 + dripRand() * 900;
    addSine(out, sr, {
      type: 'sine', from: freq, to: freq * 0.65, duration: 0.09,
      volume: 0.05 + dripRand() * 0.05, at,
      attack: 0.002, release: 0.08
    });
    addSine(out, sr, {
      type: 'sine', from: freq * 0.5, to: freq * 0.4, duration: 0.3,
      volume: 0.012, at: at + 0.02, attack: 0.01, release: 0.28
    });
  }
  normalize(out, 0.42);
  return seamlessLoop(out, sr, loopSeconds, 1.5);
}

function makeFireLoop() {
  const sr = LOOP_RATE;
  const loopSeconds = 12;
  const renderSeconds = loopSeconds + 1;
  const rand = mulberry32(30600);
  const out = noiseArray(Math.floor(renderSeconds * sr), rand, 'brown');
  sweepLowpass(out, sr, () => 260);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] *= 0.5 + 0.5 * Math.sin(t * 0.5 + 0.4) * Math.sin(t * 0.17);
  }
  addCrackle(out, sr, { seed: 30700, count: 120, volume: 0.16 });
  // A little airy hiss over the crackle.
  addNoise(out, sr, {
    seed: 30800, color: 'pink', volume: 0.035,
    attack: 0.2, release: renderSeconds * 0.8, curve: 1
  });
  normalize(out, 0.5);
  return seamlessLoop(out, sr, loopSeconds, 1.0);
}

function makeUnderwaterLoop() {
  const sr = LOOP_RATE;
  const loopSeconds = 12;
  const renderSeconds = loopSeconds + 1;
  const rand = mulberry32(30900);
  const out = noiseArray(Math.floor(renderSeconds * sr), rand, 'brown');
  sweepLowpass(out, sr, (t) => 180 + 120 * Math.sin(t * Math.PI * 2 * 0.08));
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] *= 0.5 + 0.5 * Math.sin(t * 0.33 + 1.1);
  }
  const bubbleRand = mulberry32(31000);
  for (let i = 0; i < 18; i++) {
    addSine(out, sr, {
      type: 'sine',
      from: 180 + bubbleRand() * 220,
      to: 300 + bubbleRand() * 400,
      duration: 0.08 + bubbleRand() * 0.12,
      volume: 0.03 + bubbleRand() * 0.04,
      at: bubbleRand() * (renderSeconds - 0.3),
      attack: 0.006,
      release: 0.12
    });
  }
  normalize(out, 0.4);
  return seamlessLoop(out, sr, loopSeconds, 1.0);
}

function makeMusicLoop(variant = 'retro') {
  const sr = LOOP_RATE;
  const loopSeconds = 32;
  const renderSeconds = loopSeconds + 2;
  const out = makeBuffer(renderSeconds, sr);
  // A slow pad with a gentle turn at the halfway point. "sad" is the darker
  // reference for dusk; "retro" stands in for the morning slot.
  const chords = variant === 'sad'
    ? [
      [110, 130.81, 164.81, 220],
      [98, 123.47, 146.83, 196],
      [87.31, 110, 130.81, 174.61],
      [82.41, 103.83, 123.47, 164.81]
    ]
    : [
      [110, 164.81, 220, 261.63],
      [98, 146.83, 196, 246.94],
      [87.31, 130.81, 174.61, 220],
      [82.41, 123.47, 164.81, 207.65]
    ];
  const segment = renderSeconds / chords.length;
  chords.forEach((chord, index) => {
    const at = index * segment;
    chord.forEach((freq, voice) => {
      addSine(out, sr, {
        type: voice === 0 ? 'triangle' : 'sine',
        from: freq,
        to: freq * (1 + (voice % 2 ? 0.0015 : -0.0015)),
        duration: segment + 0.8,
        volume: 0.035 / (voice + 1),
        at,
        attack: 1.6,
        release: 2.2
      });
      addSine(out, sr, {
        type: 'sine',
        from: freq * 2.005,
        to: freq * 2.0,
        duration: segment + 0.5,
        volume: 0.012 / (voice + 1),
        at: at + 0.2,
        attack: 2.0,
        release: 2.0
      });
    });
  });
  // Distant, sparse bell notes.
  const bellRand = mulberry32(variant === 'sad' ? 31150 : 31100);
  const bellNotes = variant === 'sad'
    ? [392, 466.16, 523.25, 622.25]
    : [440, 523.25, 659.25, 783.99];
  for (let i = 0; i < 12; i++) {
    const at = bellRand() * (renderSeconds - 2);
    const freq = bellNotes[Math.floor(bellRand() * 4)];
    addSine(out, sr, {
      type: 'sine', from: freq, to: freq * 0.998,
      duration: 1.4, volume: 0.018,
      at, attack: 0.02, release: 1.3
    });
  }
  normalize(out, 0.28);
  return seamlessLoop(out, sr, loopSeconds, 2.0);
}

/* ------------------------------------------------------------------ *
 * Build the bank
 * ------------------------------------------------------------------ */

const written = [];

function writeSfx(name, data, sr = SFX_RATE) {
  writeWav(name + '.wav', data, sr);
  written.push(name + '.wav');
}

const materialList = ['stone', 'dirt', 'grass', 'sand', 'snow', 'wood', 'leaves', 'glass'];
const footstepMaterials = ['stone', 'dirt', 'grass', 'sand', 'snow', 'wood', 'leaves'];

for (const material of footstepMaterials) {
  for (let variant = 1; variant <= 4; variant++) {
    writeSfx(`footstep_${material}_${variant}`, makeFootstep(material, variant));
  }
}
for (const material of materialList) {
  for (let variant = 1; variant <= 3; variant++) {
    writeSfx(`break_${material}_${variant}`, makeBreak(material, variant));
  }
  for (let variant = 1; variant <= 2; variant++) {
    writeSfx(`place_${material}_${variant}`, makePlace(material, variant));
  }
}

for (let variant = 1; variant <= 2; variant++) {
  writeSfx(`mob_zombie_${variant}`, makeZombie(variant));
  writeSfx(`mob_cow_${variant}`, makeAnimal('cow', variant));
  writeSfx(`mob_pig_${variant}`, makeAnimal('pig', variant));
  writeSfx(`mob_sheep_${variant}`, makeAnimal('sheep', variant));
  writeSfx(`mob_chicken_${variant}`, makeAnimal('chicken', variant));
}
writeSfx('mob_creeper_1', makeCreeper());

writeSfx('event_hurt_player_1', makeHurtPlayer());
writeSfx('event_hurt_mob_1', makeHurtMob());
writeSfx('event_explosion_1', makeExplosion());
writeSfx('event_craft_1', makeCraft());
for (let variant = 1; variant <= 2; variant++) {
  writeSfx(`event_eat_${variant}`, makeEat(variant));
  writeSfx(`event_swim_${variant}`, makeSwim(variant));
  writeSfx(`event_pickup_${variant}`, makePickup(variant));
}
writeSfx('event_door_1', makeDoor());
writeSfx('event_chest_open_1', makeChestOpen());
writeSfx('event_chest_close_1', makeChestClose());
writeSfx('event_tool_break_1', makeToolBreak());
writeSfx('event_furnace_ignite_1', makeFurnaceIgnite());
writeSfx('event_furnace_finish_1', makeFurnaceFinish());
writeSfx('event_hoe_1', makeHoe());
writeSfx('event_bucket_fill_1', makeBucket(true));
writeSfx('event_bucket_pour_1', makeBucket(false));
writeSfx('event_shear_1', makeShear());
writeSfx('event_splash_1', makeSplash());
for (let variant = 1; variant <= 3; variant++) {
  writeSfx(`event_land_${variant}`, makeLand(variant));
}
writeSfx('event_jump_1', makeJump());
writeSfx('event_ui_click_1', makeUi('click'));
writeSfx('event_ui_open_1', makeUi('open'));
writeSfx('event_ui_close_1', makeUi('close'));
writeSfx('event_heartbeat_1', makeHeartbeat());
writeSfx('event_death_1', makeDeath());

writeSfx('ambient_wind_1', makeWindLoop(), LOOP_RATE);
writeSfx('ambient_water_1', makeWaterLoop(), LOOP_RATE);
writeSfx('ambient_cave_1', makeCaveLoop(), LOOP_RATE);
writeSfx('ambient_fire_1', makeFireLoop(), LOOP_RATE);
writeSfx('ambient_underwater_1', makeUnderwaterLoop(), LOOP_RATE);
writeSfx('music_sad_descent_1', makeMusicLoop('sad'), LOOP_RATE);
writeSfx('music_retro_mystic_1', makeMusicLoop('retro'), LOOP_RATE);

console.log(`wrote ${written.length} files to ${path.relative(ROOT, OUT_DIR)}`);
