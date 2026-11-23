/*
 * The clock and the dome it paints. One number says what time of day it
 * is, and everything else here follows from it: the sun and moon on their
 * arcs, the sky colours and the fog they bleed into, the stars, and the
 * murk that closes over the view when a head goes under. That number is
 * nobody's to reach in and set — the clock is wound through the functions
 * at the top of this file, so a save, a keypress and the frame tick all
 * put it where the sky will agree to put it.
 */

import * as THREE from 'three';
import { DAY_LENGTH_SECONDS, DAY_START, FOG_FAR, FOG_NEAR, lerp, smoothstep } from './config.js';
import { mulberry32 } from './noise.js';
import { camera, fogColor, renderer, scene, skyMaterial, terrainMaterials } from './render.js';

export let dayTime = DAY_START;
export let timeScale = 1;

/**
 * Puts the clock at a time of day, as a fraction of one: whatever is asked for
 * is wrapped into the day it names, so a save that writes 1.75 and a debug key
 * that overshoots midnight both land somewhere the sky recognises.
 */
export function setDayTime(time) { dayTime = ((time % 1) + 1) % 1; }

/** Slides the clock a little way at a time, a keypress at a time. */
export function nudgeDayTime(delta) { dayTime = (dayTime + delta + 1) % 1; }

/**
 * Runs the clock forward by `seconds` of world time. Time being frozen is no
 * reason not to: somebody asked to see what happens later.
 */
export function advanceDayTime(seconds) {
  dayTime = (dayTime + seconds / DAY_LENGTH_SECONDS) % 1;
}

/** How fast the clock runs; 0 stands still, and nothing runs backwards. */
export function setTimeScale(scale) { timeScale = Math.max(0, Number(scale) || 0); }

export let daylight = 1;
let sunHeight = 0;

const SUN_DIR = new THREE.Vector3(0, 1, 0);
const MOON_DIR = new THREE.Vector3(0, -1, 0);

const DAY_ZENITH = new THREE.Color(0x4f8fd8);
const DAY_HORIZON = new THREE.Color(0xc3dbef);
const SUNSET_ZENITH = new THREE.Color(0x2b3a6b);
const SUNSET_HORIZON = new THREE.Color(0xff9a5a);
const NIGHT_ZENITH = new THREE.Color(0x050a1a);
const NIGHT_HORIZON = new THREE.Color(0x0c1730);

const skyZenithColor = new THREE.Color();
const skyHorizonColor = new THREE.Color();

// Blocky sun and moon quads live inside the sky dome and follow the camera.
const sunMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(46, 46),
  new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false, depthWrite: false })
);
sunMesh.frustumCulled = false;
sunMesh.renderOrder = -0.9;
scene.add(sunMesh);

const moonMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(36, 36),
  new THREE.MeshBasicMaterial({ color: 0xd9e6ff, fog: false, depthWrite: false })
);
moonMesh.frustumCulled = false;
moonMesh.renderOrder = -0.9;
scene.add(moonMesh);

// A few hundred procedural stars fade in at night.
const STAR_COUNT = 420;
const starPositions = new Float32Array(STAR_COUNT * 3);
{
  const rand = mulberry32(0x51A2C0DE);
  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const radius = 560;
    starPositions[i * 3] = Math.cos(theta) * Math.sin(phi) * radius;
    starPositions[i * 3 + 1] = Math.cos(phi) * radius;
    starPositions[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * radius;
  }
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMaterial = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 1.7,
  sizeAttenuation: false,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  fog: false
});
const stars = new THREE.Points(starGeometry, starMaterial);
stars.frustumCulled = false;
stars.renderOrder = -0.8;
scene.add(stars);

const ambientLight = new THREE.AmbientLight(0xbfd4ff, 0.5);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xfff1c8, 1.1);
scene.add(sunLight);
scene.add(sunLight.target);

export function clockHours() {
  return (dayTime * 24 + 6) % 24;
}

export function formatClock() {
  const totalMinutes = Math.floor(clockHours() * 60) % (24 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export function isNight() {
  return sunHeight < -0.04;
}

function updateSkyObjects() {
  const radius = 420;

  sunMesh.position.copy(camera.position).addScaledVector(SUN_DIR, radius);
  sunMesh.lookAt(camera.position);
  sunMesh.visible = SUN_DIR.y > -0.08;

  moonMesh.position.copy(camera.position).addScaledVector(MOON_DIR, radius);
  moonMesh.lookAt(camera.position);
  moonMesh.visible = MOON_DIR.y > -0.08;

  stars.position.copy(camera.position);

  sunLight.position.copy(camera.position).addScaledVector(SUN_DIR, 120);
  sunLight.target.position.copy(camera.position);
  sunLight.target.updateMatrixWorld();
}

export function applyDayNight() {
  const angle = dayTime * Math.PI * 2;
  SUN_DIR.set(Math.cos(angle), Math.sin(angle), 0.28).normalize();
  MOON_DIR.copy(SUN_DIR).negate();
  sunHeight = SUN_DIR.y;

  daylight = smoothstep(-0.14, 0.22, sunHeight);
  const twilight = Math.exp(-Math.pow(sunHeight / 0.2, 2));

  skyZenithColor.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, daylight);
  skyHorizonColor.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, daylight);
  skyZenithColor.lerp(SUNSET_ZENITH, twilight * 0.55);
  skyHorizonColor.lerp(SUNSET_HORIZON, twilight * 0.9);

  skyMaterial.uniforms.uZenith.value.copy(skyZenithColor);
  skyMaterial.uniforms.uHorizon.value.copy(skyHorizonColor);
  skyMaterial.uniforms.uSunDir.value.copy(SUN_DIR);
  skyMaterial.uniforms.uSunset.value = twilight;

  fogColor.copy(skyHorizonColor);
  scene.fog.color.copy(fogColor);
  renderer.setClearColor(fogColor, 1);

  const skyUniformDay = 0.06 + 0.94 * daylight;
  for (const material of terrainMaterials) {
    material.uniforms.uDay.value = skyUniformDay;
  }

  ambientLight.intensity = 0.12 + 0.5 * daylight;
  ambientLight.color.setRGB(
    lerp(0.42, 0.85, daylight),
    lerp(0.5, 0.9, daylight),
    lerp(0.75, 1.0, daylight)
  );
  sunLight.intensity = 0.08 + 1.0 * daylight;
  sunLight.color.setRGB(
    1.0,
    lerp(0.55, 0.95, daylight),
    lerp(0.32, 0.82, daylight)
  );

  starMaterial.opacity = (1 - daylight) * 0.9;
  updateSkyObjects();
}

export function updateDayNight(dt) {
  if (timeScale > 0) {
    dayTime = (dayTime + (dt * timeScale) / DAY_LENGTH_SECONDS) % 1;
  }
  applyDayNight();
}

/**
 * The water's living look: the clock the swells and ripples run on, and the murk
 * that closes in once the camera goes under. Both keep running behind a paused
 * screen, so the sea seen through the instructions never hangs mid-swell.
 * Whether the head is under is told to it rather than read off the player: the
 * sky knows about water, not about whoever happens to be standing in it.
 */
let waterTime = 0;
let underwaterBlend = 0;
let waterTintShown = -1;
const UNDERWATER_FOG_COLOR = new THREE.Color(0x0e3a5c);
const underwaterScratch = new THREE.Color();
const waterTintEl = document.getElementById('water-tint');
const UNDERWATER_FOG_NEAR = 0.5;
const UNDERWATER_FOG_FAR = 24;

export function updateWaterLook(dt, headUnderwater) {
  waterTime += dt;

  const target = headUnderwater ? 1 : 0;
  underwaterBlend += (target - underwaterBlend) * Math.min(1, dt * 5);
  if (Math.abs(target - underwaterBlend) < 0.003) underwaterBlend = target;
  const b = underwaterBlend;

  // The day/night pass hands over the sky's own fog, and this sits the water's
  // murk on top of it, pulling the view in to a few blocks. The colour is
  // recomputed whole from the sky each frame rather than nudged from the last,
  // so a paused frame — where the sky pass stays away — can never compound the blend.
  const fogNear = lerp(FOG_NEAR, UNDERWATER_FOG_NEAR, b);
  const fogFar = lerp(FOG_FAR, UNDERWATER_FOG_FAR, b);
  for (const material of terrainMaterials) {
    material.uniforms.uTime.value = waterTime;
    material.uniforms.uFogNear.value = fogNear;
    material.uniforms.uFogFar.value = fogFar;
  }
  underwaterScratch.copy(UNDERWATER_FOG_COLOR).multiplyScalar(0.15 + 0.85 * daylight);
  fogColor.copy(skyHorizonColor).lerp(underwaterScratch, b);
  scene.fog.color.copy(fogColor);
  scene.fog.near = fogNear;
  scene.fog.far = fogFar;
  renderer.setClearColor(fogColor, 1);

  // The screen wash rides the same blend. Quantised so the style is only touched
  // when it visibly changes, not every frame at full submersion.
  const tint = Math.round(b * 30) / 30;
  if (tint !== waterTintShown) {
    waterTintEl.style.opacity = tint * 0.6;
    waterTintShown = tint;
  }
}
