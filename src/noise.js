/*
 * Randomness that gives the same answer twice. Every field here is a pure
 * function of coordinates and the world seed, which is the only reason a chunk
 * regenerated after a reload matches the one it replaced. The Perlin fields are
 * built once at load so the permutation table is shuffled from the seed exactly
 * once.
 */

import { WORLD_SEED, clamp, lerp } from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hash3i(x, y, z, seed = 0) {
  let h = (seed >>> 0) ^ Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

export function chunkRandom(cx, cz, salt = 0) {
  return mulberry32(hash3i(cx, 0, cz, (WORLD_SEED ^ salt) >>> 0));
}

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
];

class Noise {
  constructor(seed) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) this.perm[i] = p[i & 255];
    this.grad2Scale = 1.42;
  }

  static fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  grad2(h, x, y) {
    const g = GRAD3[h % 12];
    return g[0] * x + g[1] * y;
  }

  grad3(h, x, y, z) {
    const g = GRAD3[h % 12];
    return g[0] * x + g[1] * y + g[2] * z;
  }

  noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const u = Noise.fade(xf);
    const v = Noise.fade(yf);
    const p = this.perm;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(this.grad2(aa, xf, yf), this.grad2(ba, xf - 1, yf), u);
    const x2 = lerp(this.grad2(ab, xf, yf - 1), this.grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * this.grad2Scale;
  }

  noise3(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = Noise.fade(xf);
    const v = Noise.fade(yf);
    const w = Noise.fade(zf);
    const p = this.perm;
    const A = p[X] + Y;
    const B = p[X + 1] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    const x1 = lerp(this.grad3(p[AA], xf, yf, zf), this.grad3(p[BA], xf - 1, yf, zf), u);
    const x2 = lerp(this.grad3(p[AB], xf, yf - 1, zf), this.grad3(p[BB], xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);
    const x3 = lerp(this.grad3(p[AA + 1], xf, yf, zf - 1), this.grad3(p[BA + 1], xf - 1, yf, zf - 1), u);
    const x4 = lerp(this.grad3(p[AB + 1], xf, yf - 1, zf - 1), this.grad3(p[BB + 1], xf - 1, yf - 1, zf - 1), u);
    const y2 = lerp(x3, x4, v);
    return lerp(y1, y2, w) * 1.1;
  }

  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * frequency, y * frequency) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise3(x * frequency, y * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  ridged2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let norm = 0;
    let amplitude = 1;
    let frequency = 1;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise2(x * frequency, y * frequency));
      n *= n;
      sum += n * amplitude * weight;
      norm += amplitude;
      weight = n;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return clamp(sum / norm, 0, 1);
  }
}

export const terrainNoise = new Noise(WORLD_SEED);
export const detailNoise = new Noise((WORLD_SEED ^ 0x9E3779B9) >>> 0);
export const tempNoise = new Noise((WORLD_SEED ^ 0x1234567) >>> 0);
export const humidNoise = new Noise((WORLD_SEED ^ 0x89ABCDE) >>> 0);
export const mountainNoise = new Noise((WORLD_SEED ^ 0x5F3759DF) >>> 0);
export const riverNoise = new Noise((WORLD_SEED ^ 0x1B873593) >>> 0);
export const caveNoiseA = new Noise((WORLD_SEED ^ 0xA5A5A5) >>> 0);
export const caveNoiseB = new Noise((WORLD_SEED ^ 0x5A5A5A) >>> 0);
export const cavernNoise = new Noise((WORLD_SEED ^ 0xCAFE) >>> 0);
export const aquiferNoise = new Noise((WORLD_SEED ^ 0xA0F1E5) >>> 0);
