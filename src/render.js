/*
 * The renderer, the scene, the camera, and the materials that paint terrain with.
 * Built once, at load, before any chunk exists: a WebGL context, a fog colour the
 * sky shader shares, the terrain shader that reads per-vertex light, and the three
 * materials every chunk mesh ends up in — opaque, cutout for leaves, and the
 * translucent one for water.
 */

import * as THREE from 'three';
import { atlasTexture, tileRect } from './atlas.js';
import { BLOCKS } from './blocks.js';
import {
  B, FOG_COLOR, FOG_FAR, FOG_NEAR, HALF_TEXEL, SKY_HORIZON, SKY_ZENITH, clamp, smoothstep
} from './config.js';

const TERRAIN_VERTEX_SHADER = `
  attribute float aSky;
  attribute float aBlock;
  attribute float aShade;
  varying vec2 vUv;
  varying float vSky;
  varying float vBlock;
  varying float vShade;
  varying float vFogDepth;
  #ifdef WATER
    uniform float uTime;
    varying vec3 vWorldPos;
  #endif
  void main() {
    vUv = uv;
    vSky = aSky;
    vBlock = aBlock;
    vShade = aShade;
    vec3 pos = position;
    #ifdef WATER
      // Swells read the world position, not the cell's own corner, so two chunks
      // meeting on an edge lift it the same way at the same instant. It is the
      // same promise the blended corner heights already make: shared edges move as one.
      vec3 worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
      float swell = sin(worldPos.x * 0.7 + worldPos.z * 0.4 + uTime * 1.15)
                  + 0.5 * sin(worldPos.z * 1.3 - uTime * 0.85)
                  + 0.35 * sin((worldPos.x - worldPos.z) * 2.1 + uTime * 1.9);
      // The whole body rides the swell together — surface, skirt and all — so a
      // wave never tears a surface off the sides it was drawn with.
      pos.y += swell * 0.016;
      vWorldPos = worldPos;
    #endif
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const TERRAIN_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uDay;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;
  #ifdef WATER
    uniform float uTime;
    uniform vec4 uWaterTile;
    varying vec3 vWorldPos;
  #endif
  varying vec2 vUv;
  varying float vSky;
  varying float vBlock;
  varying float vShade;
  varying float vFogDepth;
  void main() {
    vec2 sampleUv = vUv;
    #ifdef WATER
      // Ripples wander in world space, so the shimmer runs across a whole sea
      // instead of restarting at every block seam, and the clamp keeps it inside
      // the water tile so a wave never smears a neighbour's pixels into the surface.
      vec2 ripple = vec2(
        sin(vWorldPos.z * 1.6 + uTime * 1.4)
          + 0.6 * sin(vWorldPos.z * 3.7 - vWorldPos.x * 1.1 - uTime * 2.2),
        cos(vWorldPos.x * 1.5 - uTime * 1.2)
          + 0.6 * cos(vWorldPos.x * 3.3 + vWorldPos.z * 0.9 + uTime * 1.8)
      );
      sampleUv = clamp(
        vUv + ripple * ${(1.5 * HALF_TEXEL).toFixed(6)},
        uWaterTile.xy + vec2(${HALF_TEXEL.toFixed(6)}),
        uWaterTile.zw - vec2(${HALF_TEXEL.toFixed(6)})
      );
    #endif
    vec4 texel = texture2D(uMap, sampleUv);
    #ifdef CUTOUT
      if (texel.a < 0.5) discard;
    #endif
    float lit = max(max(vSky * uDay, vBlock), 0.045);
    vec3 color = texel.rgb * vShade * lit;
    float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
    color = mix(color, uFogColor, fogFactor);
    gl_FragColor = vec4(color, texel.a * uOpacity);
    #include <colorspace_fragment>
  }
`;

const viewport = document.getElementById('viewport');
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(FOG_COLOR, 1);
viewport.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const fogColor = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.Fog(fogColor, FOG_NEAR, FOG_FAR);

export const skyMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uZenith: { value: new THREE.Color(SKY_ZENITH) },
    uHorizon: { value: new THREE.Color(SKY_HORIZON) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunset: { value: 0 }
  },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uSunDir;
    uniform float uSunset;
    varying vec3 vDir;
    void main() {
      vec3 dir = normalize(vDir);
      float h = clamp(dir.y, 0.0, 1.0);
      vec3 color = mix(uHorizon, uZenith, pow(h, 0.62));
      float sunAmount = max(dot(dir, normalize(uSunDir)), 0.0);
      color += vec3(1.0, 0.44, 0.13) * uSunset * pow(sunAmount, 6.0) * 0.45;
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }
  `,
  side: THREE.BackSide,
  depthWrite: false
});

export const skyDome = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMaterial);
skyDome.frustumCulled = false;
skyDome.renderOrder = -1;
scene.add(skyDome);

export const terrainMaterials = [];

function createTerrainMaterial(options = {}) {
  const defines = (options.cutout ? '#define CUTOUT\n' : '')
    + (options.water ? '#define WATER\n' : '');
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: atlasTexture },
      uDay: { value: 1 },
      uFogColor: { value: fogColor },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uOpacity: { value: options.opacity ?? 1 },
      uTime: { value: 0 },
      uWaterTile: { value: options.waterTile ?? new THREE.Vector4(0, 0, 1, 1) }
    },
    vertexShader: defines + TERRAIN_VERTEX_SHADER,
    fragmentShader: defines + TERRAIN_FRAGMENT_SHADER,
    transparent: !!options.transparent,
    depthWrite: options.depthWrite !== false,
    side: options.doubleSide ? THREE.DoubleSide : THREE.FrontSide
  });
  terrainMaterials.push(material);
  return material;
}

export const opaqueMaterial = createTerrainMaterial();
export const cutoutMaterial = createTerrainMaterial({ cutout: true, doubleSide: true });
// All water depths share one atlas tile, so one rect bounds the shimmer for every
// surface, skirt and stream the meshers draw with this material.
const waterTileRect = tileRect(BLOCKS[B.WATER].tileSide);
export const waterMaterial = createTerrainMaterial({
  transparent: true,
  opacity: 0.74,
  doubleSide: true,
  depthWrite: false,
  water: true,
  waterTile: new THREE.Vector4(
    waterTileRect.u0, waterTileRect.vBottom, waterTileRect.u1, waterTileRect.vTop
  )
});

export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';
