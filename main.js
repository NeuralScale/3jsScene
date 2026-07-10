import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFluffyGrassMaterial } from './shaders/grassMaterial.js';
import { createFoliageMaterial } from './shaders/foliageMaterial.js';
import { vertexCommon, vertexBegin, noiseGLSL, pondDepth } from './shaders/common.glsl.js';
import { groundFragmentCommon, groundFragmentColor, groundFragmentEmissive } from './shaders/ground.glsl.js';
import { ripplesFragmentCommon, ripplesFragmentColor, ripplesFragmentEmissive } from './shaders/ripples.glsl.js';

// Color timeline: keyframes through the day, sampled by the clock and
// smoothly blended between neighbors (wrapping across midnight). The water
// runs inverted — bright at night, darker by day — with warm tints at the
// sun's rise and set.
const TIMELINE = [
  { // deep night
    hour: 1.0,
    fog: new THREE.Color(0.012, 0.02, 0.055),
    shallow: new THREE.Color(0.32, 0.9, 0.79),
    deep: new THREE.Color(0.16, 0.74, 0.75),
    skyTop: new THREE.Color(0x010207),
    skyHigh: new THREE.Color(0x0c0620), // deep violet
    skyMid: new THREE.Color(0x05081a),
    skyLow: new THREE.Color(0x131a40), // indigo band
    skyHorizon: new THREE.Color(0x0a0f1f),
    keyColor: new THREE.Color(0xbfd4ff),
    keyIntensity: 0.8,
    ambientColor: new THREE.Color(0x8899cc),
    ambientIntensity: 0.25,
  },
  { // pre-dawn: a violet hint creeps into the dark
    hour: 5.0,
    fog: new THREE.Color(0.035, 0.03, 0.085),
    shallow: new THREE.Color(0.27, 0.74, 0.7),
    deep: new THREE.Color(0.13, 0.58, 0.62),
    skyTop: new THREE.Color(0x0a1030),
    skyHigh: new THREE.Color(0x101638),
    skyMid: new THREE.Color(0x191a3e),
    skyLow: new THREE.Color(0x3a2a58), // waking purple
    skyHorizon: new THREE.Color(0x2a2145),
    keyColor: new THREE.Color(0x9fa8d8),
    keyIntensity: 0.7,
    ambientColor: new THREE.Color(0x8890c0),
    ambientIntensity: 0.24,
  },
  { // sunrise: pink-orange horizon, warm light
    hour: 7.0,
    fog: new THREE.Color(0.32, 0.2, 0.26),
    shallow: new THREE.Color(0.3, 0.62, 0.6),
    deep: new THREE.Color(0.16, 0.46, 0.5),
    skyTop: new THREE.Color(0x2c4a8a),
    skyHigh: new THREE.Color(0x4a5fa0), // slate blue
    skyMid: new THREE.Color(0x8a72a4), // lavender belt
    skyLow: new THREE.Color(0xd88aa0), // rose pink over the blush
    skyHorizon: new THREE.Color(0xe8886a),
    keyColor: new THREE.Color(0xffc487),
    keyIntensity: 1.1,
    ambientColor: new THREE.Color(0xffd9c0),
    ambientIntensity: 0.3,
  },
  { // morning (~10am): dominantly light blue, very bright
    hour: 9.5,
    fog: new THREE.Color(0.11, 0.3, 0.5),
    shallow: new THREE.Color(0.2, 0.56, 0.52),
    deep: new THREE.Color(0.1, 0.4, 0.44),
    skyTop: new THREE.Color(0x0f3270), // cobalt
    skyHigh: new THREE.Color(0x1e4a8c),
    skyMid: new THREE.Color(0x2f6198), // azure
    skyLow: new THREE.Color(0x63a2b4), // minty band
    skyHorizon: new THREE.Color(0x74a6ba), // soft teal-tinted horizon
    keyColor: new THREE.Color(0xfff0d8),
    keyIntensity: 1.25,
    ambientColor: new THREE.Color(0xfff5e8),
    ambientIntensity: 0.32,
  },
  { // noon: full daylight
    hour: 13.0,
    fog: new THREE.Color(0.1, 0.29, 0.5),
    shallow: new THREE.Color(0.17, 0.52, 0.48),
    deep: new THREE.Color(0.09, 0.36, 0.4),
    skyTop: new THREE.Color(0x0b2a60), // deep ultramarine
    skyHigh: new THREE.Color(0x163a7a),
    skyMid: new THREE.Color(0x26538c), // muted royal blue
    skyLow: new THREE.Color(0x4a7cb0), // periwinkle band
    skyHorizon: new THREE.Color(0x5f8fb2), // dusty light blue
    keyColor: new THREE.Color(0xfff4e6),
    keyIntensity: 1.3,
    ambientColor: new THREE.Color(0xfff8f0),
    ambientIntensity: 0.28,
  },
  { // golden hour: everything warms up
    hour: 17.5,
    fog: new THREE.Color(0.4, 0.31, 0.22),
    shallow: new THREE.Color(0.24, 0.52, 0.46),
    deep: new THREE.Color(0.13, 0.38, 0.4),
    skyTop: new THREE.Color(0x2f5490),
    skyHigh: new THREE.Color(0x475d92), // steel blue
    skyMid: new THREE.Color(0x9d8398), // dusty pink belt
    skyLow: new THREE.Color(0xd8909a), // rose gold
    skyHorizon: new THREE.Color(0xf0a860),
    keyColor: new THREE.Color(0xffcf8f),
    keyIntensity: 1.3,
    ambientColor: new THREE.Color(0xffe3c2),
    ambientIntensity: 0.3,
  },
  { // sunset: burnt orange sinking into purple
    hour: 19.5,
    fog: new THREE.Color(0.28, 0.13, 0.19),
    shallow: new THREE.Color(0.3, 0.58, 0.58),
    deep: new THREE.Color(0.16, 0.42, 0.48),
    skyTop: new THREE.Color(0x1a2a5e),
    skyHigh: new THREE.Color(0x333a70), // indigo
    skyMid: new THREE.Color(0x6f4a74), // purple
    skyLow: new THREE.Color(0xc25a80), // magenta streak
    skyHorizon: new THREE.Color(0xe06a55),
    keyColor: new THREE.Color(0xff9a68),
    keyIntensity: 1.0,
    ambientColor: new THREE.Color(0xd9a8b8),
    ambientIntensity: 0.27,
  },
  { // dusk: last purple glow fading out
    hour: 21.0,
    fog: new THREE.Color(0.05, 0.04, 0.1),
    shallow: new THREE.Color(0.27, 0.68, 0.65),
    deep: new THREE.Color(0.13, 0.52, 0.56),
    skyTop: new THREE.Color(0x060a1c),
    skyHigh: new THREE.Color(0x0a0e28),
    skyMid: new THREE.Color(0x121236),
    skyLow: new THREE.Color(0x2a2050), // last violet glow
    skyHorizon: new THREE.Color(0x1c1838),
    keyColor: new THREE.Color(0xa8b4e8),
    keyIntensity: 0.8,
    ambientColor: new THREE.Color(0x9098c8),
    ambientIntensity: 0.25,
  },
];

// Fantasy-style skies: push every keyframe's sky bands toward richer, more
// saturated hues (same brightness, just more color) — one knob for the look
const SKY_SATURATION_BOOST = 1.55;
{
  const hsl = { h: 0, s: 0, l: 0 };
  for (const keyframe of TIMELINE) {
    for (const band of ['skyTop', 'skyHigh', 'skyMid', 'skyLow', 'skyHorizon']) {
      keyframe[band].getHSL(hsl, THREE.SRGBColorSpace);
      keyframe[band].setHSL(
        hsl.h,
        Math.min(1, hsl.s * SKY_SATURATION_BOOST + 0.04),
        hsl.l,
        THREE.SRGBColorSpace
      );
    }
  }
}

// Blend of the two timeline keyframes around `hour` (wraps across midnight)
const livePalette = {
  fog: new THREE.Color(),
  shallow: new THREE.Color(),
  deep: new THREE.Color(),
  skyTop: new THREE.Color(),
  skyHigh: new THREE.Color(),
  skyMid: new THREE.Color(),
  skyLow: new THREE.Color(),
  skyHorizon: new THREE.Color(),
  keyColor: new THREE.Color(),
  keyIntensity: 0,
  ambientColor: new THREE.Color(),
  ambientIntensity: 0,
};

function samplePalette(hour) {
  let a = TIMELINE[TIMELINE.length - 1];
  let b = TIMELINE[0];
  let span = b.hour + 24 - a.hour;
  let t = ((hour - a.hour + 24) % 24) / span;
  for (let i = 0; i < TIMELINE.length - 1; i++) {
    if (hour >= TIMELINE[i].hour && hour < TIMELINE[i + 1].hour) {
      a = TIMELINE[i];
      b = TIMELINE[i + 1];
      t = (hour - a.hour) / (b.hour - a.hour);
      break;
    }
  }
  t = THREE.MathUtils.clamp(t, 0, 1);
  t = t * t * (3 - 2 * t); // ease each segment so keyframes don't feel angular
  for (const key of ['fog', 'shallow', 'deep', 'skyTop', 'skyHigh', 'skyMid', 'skyLow', 'skyHorizon', 'keyColor', 'ambientColor']) {
    livePalette[key].copy(a[key]).lerp(b[key], t);
  }
  livePalette.keyIntensity = THREE.MathUtils.lerp(a.keyIntensity, b.keyIntensity, t);
  livePalette.ambientIntensity = THREE.MathUtils.lerp(a.ambientIntensity, b.ambientIntensity, t);
  return livePalette;
}

// Live colors, mutated in place by applyTimeOfDay()
const FOG_COLOR = TIMELINE[0].fog.clone();
const GROUND_COLOR = new THREE.Color(0x05a3af);
const WATER_SHALLOW = TIMELINE[0].shallow.clone();
const WATER_DEEP = TIMELINE[0].deep.clone();

const PLANE_SIZE = 13;
const POND_CENTER = new THREE.Vector2(0.0, 0.0); // world xz
const POND_RADIUS = 5;

const scene = new THREE.Scene();
scene.background = FOG_COLOR.clone();

const camera = new THREE.PerspectiveCamera(
  25, window.innerWidth / window.innerHeight, 0.1, 200
);
camera.position.set(18.25, 10.69, 27.32);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1.75;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI / 2.2;
controls.minPolarAngle = 1.0; // keep well off vertical: dead top-down makes orbiting feel weird

// OrbitControls zoom is instant; replace it with an eased dolly
controls.enableZoom = false;
let zoomTargetDistance = camera.position.distanceTo(controls.target);
renderer.domElement.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    // Same 5-35 range OrbitControls' min/maxDistance used to enforce
    zoomTargetDistance = THREE.MathUtils.clamp(
      zoomTargetDistance * Math.pow(1.28, event.deltaY / 100),
      5,
      35
    );
  },
  { passive: false }
);

// Pinch zoom on touch devices, driving the same eased zoom target.
// (OrbitControls' own pinch is off along with enableZoom above.)
//
// Touch downs on the canvas are intercepted in the window capture phase —
// before OrbitControls' own listeners — and the first finger is held back
// until the gesture is known. A second finger means pinch: OrbitControls
// never hears about either finger, so no rotation sneaks in before the
// zoom. If the finger instead moves on its own (or lifts, for a tap), the
// held event is replayed to the canvas and rotation/ripples work as usual.
const touchPoints = new Map();
let pinchStartSpread = 0;
let pinchStartTarget = 0;
let heldTouch = null; // first-finger pointerdown, not yet forwarded
let rotatingTouchId = null; // finger OrbitControls currently knows about
let syntheticEvent = false;
const DRAG_THRESHOLD = 6; // px of movement before a lone finger rotates

const pinchSpread = () => {
  const [a, b] = [...touchPoints.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

function replayTouch(type, init) {
  syntheticEvent = true;
  renderer.domElement.dispatchEvent(
    new PointerEvent(type, { pointerType: 'touch', isPrimary: true, ...init })
  );
  syntheticEvent = false;
}

const touchInit = (event) => ({
  pointerId: event.pointerId,
  clientX: event.clientX,
  clientY: event.clientY,
});

window.addEventListener(
  'pointerdown',
  (event) => {
    if (syntheticEvent || event.pointerType !== 'touch') return;
    if (event.target !== renderer.domElement) return;
    event.stopPropagation(); // withhold from OrbitControls until gesture is known
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size === 1) {
      heldTouch = touchInit(event);
    } else if (touchPoints.size === 2) {
      heldTouch = null;
      if (rotatingTouchId !== null) {
        // First finger was already rotating: stop that before pinching
        replayTouch('pointerup', { pointerId: rotatingTouchId });
        rotatingTouchId = null;
      }
      pinchStartSpread = pinchSpread();
      pinchStartTarget = zoomTargetDistance;
    }
  },
  true
);

window.addEventListener(
  'pointermove',
  (event) => {
    if (event.pointerType !== 'touch' || !touchPoints.has(event.pointerId)) return;
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size === 2 && pinchStartSpread > 0) {
      zoomTargetDistance = THREE.MathUtils.clamp(
        pinchStartTarget * (pinchStartSpread / pinchSpread()),
        5,
        35
      );
    } else if (heldTouch && heldTouch.pointerId === event.pointerId) {
      const moved = Math.hypot(
        event.clientX - heldTouch.clientX,
        event.clientY - heldTouch.clientY
      );
      if (moved > DRAG_THRESHOLD) {
        // Lone finger drag: hand it to OrbitControls from its start point
        replayTouch('pointerdown', heldTouch);
        rotatingTouchId = event.pointerId;
        heldTouch = null;
      }
    }
  },
  true
);

function onTouchEnd(event) {
  if (syntheticEvent || event.pointerType !== 'touch') return;
  if (!touchPoints.has(event.pointerId)) return;
  const wasPinching = touchPoints.size === 2;
  touchPoints.delete(event.pointerId);
  if (heldTouch && heldTouch.pointerId === event.pointerId) {
    // Tap: replay the down so ripples (and controls) see the click
    replayTouch('pointerdown', heldTouch);
    heldTouch = null;
  }
  if (event.pointerId === rotatingTouchId) rotatingTouchId = null;
  if (wasPinching && touchPoints.size === 1) {
    // Pinch ended with a finger still down: let it rotate from here
    pinchStartSpread = 0;
    const [remainingId] = touchPoints.keys();
    const p = touchPoints.get(remainingId);
    replayTouch('pointerdown', { pointerId: remainingId, clientX: p.x, clientY: p.y });
    rotatingTouchId = remainingId;
  }
}
window.addEventListener('pointerup', onTouchEnd, true);
window.addEventListener('pointercancel', onTouchEnd, true);

const zoomOffset = new THREE.Vector3();
function updateZoomDamping() {
  zoomOffset.copy(camera.position).sub(controls.target);
  const eased = THREE.MathUtils.lerp(zoomOffset.length(), zoomTargetDistance, 0.07);
  camera.position.copy(controls.target).addScaledVector(zoomOffset.normalize(), eased);
}

// Key + ambient lights; color and intensity are driven by time of day
const keyLight = new THREE.DirectionalLight(0xbfd4ff, 0.8);
keyLight.position.set(-15, 12, 8);
scene.add(keyLight);
const ambientLight = new THREE.AmbientLight(0x8899cc, 0.25);
scene.add(ambientLight);

// --- Ground: pond painted into a MeshStandardMaterial ---
const groundUniforms = {
  uGroundColor: { value: GROUND_COLOR },
  uSoilColor: { value: new THREE.Color(0x9a7d9f) },
  uWaterShallow: { value: WATER_SHALLOW },
  uWaterDeep: { value: WATER_DEEP },
  uPondCenter: { value: POND_CENTER },
  uPondRadius: { value: POND_RADIUS },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunGlintColor: { value: new THREE.Color(0xfff6d8) },
  uSunGlint: { value: 0 },
};

const groundMaterial = new THREE.MeshStandardMaterial({
  roughness: 1.0,
  side: THREE.DoubleSide,
});
groundMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, groundUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', vertexCommon)
    .replace('#include <begin_vertex>', vertexBegin);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', groundFragmentCommon)
    .replace('#include <color_fragment>', groundFragmentColor)
    .replace('#include <emissivemap_fragment>', groundFragmentEmissive);
};

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(PLANE_SIZE / 2, 64),
  groundMaterial
);
ground.rotateX(-Math.PI / 2);
scene.add(ground);

// Short cylinder slab under the ground disc — small floating island look
const islandMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4a5e, roughness: 1.0 });
islandMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', vertexCommon)
    .replace('#include <begin_vertex>', vertexBegin);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${noiseGLSL}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
  // Soil mottling: coarse clumps + fine grit, varying down the side too
  float soilGrain = vnoise(vWorldPos.xz * 6.0 + vWorldPos.y * 4.0) * 0.6
    + vnoise(vWorldPos.xz * 20.0 + vWorldPos.y * 14.0) * 0.4;
  diffuseColor.rgb *= 0.8 + soilGrain * 0.38;`);
};
const islandBase = new THREE.Mesh(
  new THREE.CylinderGeometry(PLANE_SIZE / 2, PLANE_SIZE / 2, 0.12, 64),
  islandMaterial
);
islandBase.position.y = -0.07; // top cap just below the ground disc, avoids z-fighting
scene.add(islandBase);

// --- Ripples: animated rings floating just above the pond ---
const MAX_DROPS = 8;
const ripplesUniforms = {
  uTime: { value: 0 },
  uClock: { value: 0 },
  uPondCenter: { value: POND_CENTER },
  uPondRadius: { value: POND_RADIUS },
  uDrops: {
    value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(0, 0, 0, 0)),
  },
};

const ripplesMaterial = new THREE.MeshStandardMaterial({
  color: 'black',
  transparent: true,
  side: THREE.DoubleSide,
});
ripplesMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, ripplesUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', vertexCommon)
    .replace('#include <begin_vertex>', vertexBegin);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', ripplesFragmentCommon)
    .replace('#include <color_fragment>', ripplesFragmentColor)
    .replace('#include <emissivemap_fragment>', ripplesFragmentEmissive);
};

const ripples = new THREE.Mesh(
  new THREE.PlaneGeometry(POND_RADIUS * 2.5, POND_RADIUS * 2.5),
  ripplesMaterial
);
ripples.rotateX(-Math.PI / 2);
ripples.position.set(POND_CENTER.x, 0.05, POND_CENTER.y);
scene.add(ripples);

// --- Fluffy grass: instanced alpha-cutout tufts (thebenezer/FluffyGrass) ---
const textureLoader = new THREE.TextureLoader();
const grassAlphaTexture = textureLoader.load('./textures/grass.jpeg');
const perlinTexture = textureLoader.load('./textures/perlinnoise.webp');
perlinTexture.wrapS = perlinTexture.wrapT = THREE.RepeatWrapping;

// Each tuft is three crossed quads, pivot at the base
const tuftPlane = new THREE.PlaneGeometry(0.55, 0.5);
tuftPlane.translate(0, 0.25, 0);
const tuftGeometry = mergeGeometries([
  tuftPlane,
  tuftPlane.clone().rotateY(Math.PI / 3),
  tuftPlane.clone().rotateY((Math.PI * 2) / 3),
]);

const { material: grassMaterial, uniforms: grassUniforms } = createFluffyGrassMaterial({
  alphaTexture: grassAlphaTexture,
  noiseTexture: perlinTexture,
  terrainSize: PLANE_SIZE,
});

const GRASS_COUNT = 1500;
const grass = new THREE.InstancedMesh(tuftGeometry, grassMaterial, GRASS_COUNT);
const tuftDummy = new THREE.Object3D();
let tuftsPlaced = 0;
while (tuftsPlaced < GRASS_COUNT) {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * (PLANE_SIZE / 2 - 0.3);
  const x = POND_CENTER.x + Math.cos(angle) * r;
  const z = POND_CENTER.y + Math.sin(angle) * r;
  // Reject spots on the water or the soil ring
  if (pondDepth(x, z, POND_CENTER, POND_RADIUS) > 0.045) continue;
  tuftDummy.position.set(x, 0, z);
  tuftDummy.rotation.y = Math.random() * Math.PI;
  tuftDummy.scale.setScalar(0.7 + Math.random() * 0.7);
  tuftDummy.updateMatrix();
  grass.setMatrixAt(tuftsPlaced, tuftDummy.matrix);
  tuftsPlaced++;
}
scene.add(grass);

// --- Fluffy trees (douges.dev "Building fluffy trees"): dark trunk +
// alpha-cutout quads inflated in view space by the foliage shader ---
const foliageAlphaTexture = textureLoader.load('./textures/foliage_alpha.png');
const { material: foliageMaterial, uniforms: foliageUniforms } = createFoliageMaterial({
  alphaTexture: foliageAlphaTexture,
  noiseTexture: perlinTexture,
  terrainSize: PLANE_SIZE,
});
const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2033, roughness: 1.0 });
// Procedural bark: noise stretched vertically reads as ridges and furrows
// (high frequency around the trunk, low along it), with a second finer
// layer breaking the stripes up so they don't look ruled on
trunkMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', vertexCommon)
    .replace('#include <begin_vertex>', vertexBegin);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${noiseGLSL}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
  float ridges = vnoise(vec2(vWorldPos.x * 14.0 + vWorldPos.z * 14.0, vWorldPos.y * 2.0));
  float grain = vnoise(vec2(vWorldPos.x * 40.0 + vWorldPos.z * 40.0, vWorldPos.y * 9.0));
  float bark = ridges * 0.7 + grain * 0.3;
  // Furrows darken sharply, ridge tops pick up a faint warm highlight
  diffuseColor.rgb *= 0.62 + smoothstep(0.25, 0.85, bark) * 0.75;
  diffuseColor.rgb += vec3(0.05, 0.035, 0.04) * smoothstep(0.75, 1.0, bark);`);
};

// A cloud of collapsed quads scattered in a squashed sphere; the foliage
// shader spreads each one into a camera-facing puff sized by aPuffSize.
// Normals point outward from the crown center so the whole canopy shades
// like one soft sphere.
// Tiny seeded RNG (mulberry32) so tree silhouettes are identical every load
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function makeCrownGeometry(puffCount, radius, puffSize, rand) {
  const quads = [];
  const dir = new THREE.Vector3();
  for (let i = 0; i < puffCount; i++) {
    const quad = new THREE.PlaneGeometry(0, 0);
    // Fibonacci-sphere directions (evenly spread — pure random can dump most
    // puffs on one side of a 10-puff crown) with jitter, squashed vertically
    const u = THREE.MathUtils.clamp(
      1 - ((i + 0.5) / puffCount) * 2 + (rand() - 0.5) * 0.35,
      -1,
      1
    );
    const phi = i * GOLDEN_ANGLE + (rand() - 0.5) * 1.2;
    const s = Math.sqrt(1 - u * u);
    dir.set(s * Math.cos(phi), u * 0.6, s * Math.sin(phi))
      .multiplyScalar(radius * (0.55 + 0.45 * rand()));
    quad.translate(dir.x, dir.y, dir.z);
    const normal = dir.clone().normalize();
    const normals = quad.attributes.normal;
    for (let v = 0; v < normals.count; v++) normals.setXYZ(v, normal.x, normal.y, normal.z);
    const size = puffSize * (0.75 + rand() * 0.5);
    quad.setAttribute('aPuffSize', new THREE.Float32BufferAttribute([size, size, size, size], 1));
    quads.push(quad);
  }
  return mergeGeometries(quads);
}

function createTree(treeScale, seed) {
  const rand = mulberry32(seed);
  const tree = new THREE.Group();
  const trunkHeight = (1.5 + rand() * 0.6) * treeScale;

  // Puff size is a view-space offset, so tree scale is baked into the
  // geometry here rather than applied via tree.scale
  const crownRadius = (0.9 + rand() * 0.4) * treeScale;

  // The trunk continues well into the crown: puff placement is random, so a
  // seed can leave the canopy's underside sparse — without this the crown
  // can read as floating above a too-short trunk
  const trunkLength = trunkHeight + crownRadius * 0.8;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09 * treeScale, 0.16 * treeScale, trunkLength, 7),
    trunkMaterial
  );
  trunk.position.y = trunkLength / 2;
  tree.add(trunk);
  const crown = new THREE.Mesh(
    makeCrownGeometry(18, crownRadius, 0.75 * treeScale, rand),
    foliageMaterial
  );
  crown.position.y = trunkHeight + crownRadius * 0.35;
  tree.add(crown);

  // The collapsed puff quads have no surface to raycast, so hover detection
  // uses an invisible sphere around the crown (invisible meshes still raycast)
  const crownProxy = new THREE.Mesh(
    new THREE.SphereGeometry(crownRadius * 1.1, 8, 6),
    new THREE.MeshBasicMaterial()
  );
  crownProxy.visible = false;
  crownProxy.position.copy(crown.position);
  tree.add(crownProxy);
  tree.userData.crown = { radius: crownRadius, height: crown.position.y, proxy: crownProxy };

  return tree;
}

// Fixed spots, precomputed against the JS pondDepth twin so every trunk and
// its 1-unit crown overhang sit on dry grass, spaced >= 2.6 apart. Spread
// around the full ring, but leaving the arc the default camera looks
// through (~20-90° azimuth) open so the pond is unobstructed at load; also
// kept >= 1.8 away from the watercolor bird's spot at (-4.2, -3.9).
const TREE_SPOTS = [
  { x: -0.97, z: 5.51, scale: 1.15 },
  { x: -4.83, z: 3.02, scale: 0.9 },
  { x: -5.41, z: -1.25, scale: 1.25 },
  { x: -2.0, z: -5.5, scale: 1.0 },
  { x: 2.02, z: -5.27, scale: 1.3 },
  { x: 5.42, z: -0.96, scale: 0.85 },
];
const treeCrowns = []; // world-space crown centers + radii, for leaf spawning
const hoverTargets = []; // ground + crown proxies, filled below
TREE_SPOTS.forEach((spot, i) => {
  const tree = createTree(spot.scale, 1000 + i);
  tree.position.set(spot.x, 0, spot.z);
  scene.add(tree);
  const { radius, height, proxy } = tree.userData.crown;
  treeCrowns.push({ center: new THREE.Vector3(spot.x, height, spot.z), radius });
  hoverTargets.push(proxy);
});
hoverTargets.push(ground);

// Foliage shares the grass's eased pointer so crowns and blades bend together
foliageUniforms.uPointer.value = grassUniforms.uPointer.value;

// --- Watercolor bird ("Watercolor bird" by peachyroyalty on Sketchfab,
// CC BY-NC — see SOURCES.md), perched on the grass facing the pond.
// Sketchfab downloads need a login, so the GLB ships separately: drop it at
// ./models/watercolor_bird.glb (see models/README.md). A missing file just
// logs a hint and the scene carries on without the bird. ---
const BIRD_SPOT = { x: -4.2, z: -3.9 }; // dry grass, clear of pond wobble and trees
new GLTFLoader().load(
  './models/watercolor_bird.glb',
  (gltf) => {
    const bird = gltf.scene;
    bird.rotation.y = Math.atan2(-BIRD_SPOT.x, -BIRD_SPOT.z); // face the pond
    // Exports come in arbitrary units: normalize to ~1.1 units tall, then
    // center it over the spot with its feet exactly on the ground plane
    const box = new THREE.Box3().setFromObject(bird);
    const size = box.getSize(new THREE.Vector3());
    bird.scale.setScalar(1.1 / Math.max(size.y, 1e-6));
    box.setFromObject(bird);
    const center = box.getCenter(new THREE.Vector3());
    bird.position.x += BIRD_SPOT.x - center.x;
    bird.position.z += BIRD_SPOT.z - center.z;
    bird.position.y -= box.min.y;
    scene.add(bird);
  },
  undefined,
  () => console.warn(
    'Watercolor bird GLB not found — download it from Sketchfab (login required) ' +
    'and save it as models/watercolor_bird.glb (see models/README.md)'
  )
);

// --- Sky: gradient dome, timeline driven. Three vertical stops (horizon,
// mid-band, zenith) plus an azimuthal glow so the horizon isn't one flat
// ring: warm around the sun at its rise/set, faintly cool around the moon ---
const skyUniforms = {
  uTopColor: { value: TIMELINE[0].skyTop.clone() },
  uHighColor: { value: TIMELINE[0].skyHigh.clone() },
  uMidColor: { value: TIMELINE[0].skyMid.clone() },
  uLowColor: { value: TIMELINE[0].skyLow.clone() },
  uHorizonColor: { value: TIMELINE[0].skyHorizon.clone() },
  uGlowDir: { value: new THREE.Vector2(0, -1) }, // xz direction of sun/moon
  uGlowColor: { value: new THREE.Color(0xffa95e) },
  uGlowStrength: { value: 0 },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(130, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopColor;
      uniform vec3 uHighColor;
      uniform vec3 uMidColor;
      uniform vec3 uLowColor;
      uniform vec3 uHorizonColor;
      uniform vec2 uGlowDir;
      uniform vec3 uGlowColor;
      uniform float uGlowStrength;
      varying vec3 vDir;
      void main() {
        // Five stacked bands, wrapping below eye level too (floating island)
        float h = abs(normalize(vDir).y);
        vec3 color = mix(uHorizonColor, uLowColor, smoothstep(0.0, 0.14, h));
        color = mix(color, uMidColor, smoothstep(0.1, 0.32, h));
        color = mix(color, uHighColor, smoothstep(0.28, 0.52, h));
        color = mix(color, uTopColor, smoothstep(0.46, 0.8, h));
        // Directional glow hugging the horizon around the sun/moon azimuth,
        // so opposite sides of the sky at the same height differ in color
        float azimuth = max(dot(normalize(vDir.xz), uGlowDir), 0.0);
        float hug = 1.0 - smoothstep(0.0, 0.45, h);
        color = mix(color, uGlowColor, pow(azimuth, 3.0) * hug * uGlowStrength);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
);
sky.renderOrder = -1; // paint first, everything else draws over it
scene.add(sky);

// --- Sun & moon: horizon-level glow sprites. The camera's polar limits
// never let it look up at the sky, so both ride just above the horizon
// (below camera eye level) where they show up behind the island. ---
// Built as a DataTexture rather than a 2D-canvas radial gradient: canvas
// pixels are premultiplied by alpha, and un-premultiplying on texture upload
// amplifies quantization noise in the faint halo into colored speckles
// (clearly visible on mobile GPUs). Writing straight RGBA avoids that.
function makeGlowTexture(core, mid, halo) {
  const SIZE = 128;
  // Stops as [r, g, b, a] in 0-1, matching the old gradient stops
  const stops = [
    { at: 0.0, color: [1, 1, 1, 1] },
    { at: 0.18, color: core },
    { at: 0.45, color: mid },
    { at: 1.0, color: halo },
  ];
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.min(
        Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2) / (SIZE / 2),
        1
      );
      let s = 1;
      while (s < stops.length - 1 && stops[s].at < d) s++;
      const a = stops[s - 1];
      const b = stops[s];
      const t = (d - a.at) / (b.at - a.at);
      const o = (y * SIZE + x) * 4;
      for (let c = 0; c < 4; c++) {
        data[o + c] = Math.round((a.color[c] + (b.color[c] - a.color[c]) * t) * 255);
      }
    }
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeGlowSprite(texture, size) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false })
  );
  sprite.scale.set(size, size, 1);
  scene.add(sprite);
  return sprite;
}

// Sprite sizes scale with the arc distance to keep the same apparent size
const sun = makeGlowSprite(
  makeGlowTexture(
    [255 / 255, 244 / 255, 214 / 255, 0.95],
    [255 / 255, 214 / 255, 140 / 255, 0.3],
    [255 / 255, 200 / 255, 120 / 255, 0]
  ),
  20
);
const moon = makeGlowSprite(
  makeGlowTexture(
    [228 / 255, 238 / 255, 255 / 255, 0.95],
    [180 / 255, 200 / 255, 240 / 255, 0.25],
    [160 / 255, 180 / 255, 230 / 255, 0]
  ),
  13
);

const SUN_COLOR_HIGH = new THREE.Color(0xfff6d8); // noon
const SUN_COLOR_LOW = new THREE.Color(0xffa95e); // sunrise / sunset
const MOON_GLINT_COLOR = new THREE.Color(0x9fb4d8);
const WHITE = new THREE.Color(0xffffff);
const NIGHT_LIGHT_POS = new THREE.Vector3(-15, 12, 8); // original moonlight angle
const sunPosition = new THREE.Vector3();
const sunDirection = new THREE.Vector3(0, 1, 0);
const moonDirection = new THREE.Vector3(0, 1, 0);
const sunColor = new THREE.Color();
const foliageTint = new THREE.Color();
const tintScratch = new THREE.Color();

// --- Falling leaves: small quads fluttering down from the crowns ---
const LEAF_COUNT = 45;
const leafColor1 = new THREE.Color('#8fe8d8');
const leafColor2 = new THREE.Color('#05a3af');
const leaves = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.11, 0.08),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  LEAF_COUNT
);
leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LEAF_COUNT * 3), 3);
scene.add(leaves);

const leafRand = mulberry32(7);
const leafStates = [];
const leafDummy = new THREE.Object3D();
const leafColor = new THREE.Color();

function respawnLeaf(state) {
  const crown = treeCrowns[Math.floor(leafRand() * treeCrowns.length)];
  const az = leafRand() * Math.PI * 2;
  const r = Math.sqrt(leafRand()) * crown.radius * 0.9;
  state.x = crown.center.x + Math.cos(az) * r;
  state.z = crown.center.z + Math.sin(az) * r;
  state.y = crown.center.y + (leafRand() - 0.3) * crown.radius * 0.6;
  state.fall = 0.22 + leafRand() * 0.25;
  state.phase = leafRand() * Math.PI * 2;
  state.sway = 0.6 + leafRand() * 0.9;
  state.spin = 1.5 + leafRand() * 2.5;
}

for (let i = 0; i < LEAF_COUNT; i++) {
  const state = {};
  respawnLeaf(state);
  // Start scattered through the air so the effect doesn't begin in bursts
  state.y *= leafRand();
  leafStates.push(state);
  // Same shading as the tree foliage shader: a plain blend between the two
  // crown colors, no darkening
  leafColor.copy(leafColor1).lerp(leafColor2, leafRand());
  leaves.setColorAt(i, leafColor);
}

function updateLeaves(t, dt) {
  const pointer = grassUniforms.uPointer.value;
  for (let i = 0; i < LEAF_COUNT; i++) {
    const leaf = leafStates[i];
    leaf.y -= leaf.fall * dt;
    leaf.x += Math.sin(t * leaf.sway + leaf.phase) * 0.4 * dt;
    leaf.z += Math.cos(t * leaf.sway * 0.8 + leaf.phase) * 0.3 * dt;
    // Drift away from the pointer, like the grass bending
    const dx = leaf.x - pointer.x;
    const dy = leaf.y - pointer.y;
    const dz = leaf.z - pointer.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1.2 && dist > 0.001) {
      const push = ((1.2 - dist) / 1.2) * 2.2 * dt;
      leaf.x += (dx / dist) * push;
      leaf.z += (dz / dist) * push;
    }
    if (leaf.y < 0.03) respawnLeaf(leaf);
    leafDummy.position.set(leaf.x, leaf.y, leaf.z);
    leafDummy.rotation.set(
      t * leaf.spin * 0.6 + leaf.phase,
      t * leaf.spin * 0.4 + leaf.phase,
      Math.sin(t * leaf.sway + leaf.phase) * 0.8
    );
    leafDummy.updateMatrix();
    leaves.setMatrixAt(i, leafDummy.matrix);
  }
  leaves.instanceMatrix.needsUpdate = true;
}

// --- Stars: seeded points on a far hemisphere, night only ---
// The island floats in a void and the camera always looks slightly downward,
// so the stars wrap the full sphere — whatever direction you orbit from,
// the background holds sky.
const STAR_COUNT = 1200;
const starRand = mulberry32(42);
const starPositions = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const az = starRand() * Math.PI * 2;
  const y = starRand() * 2 - 1;
  const s = Math.sqrt(1 - y * y);
  starPositions[i * 3] = Math.cos(az) * s * 90;
  starPositions[i * 3 + 1] = y * 90;
  starPositions[i * 3 + 2] = Math.sin(az) * s * 90;
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const stars = new THREE.Points(
  starGeometry,
  new THREE.PointsMaterial({
    color: 0xcfe0ff,
    size: 2.2, // screen pixels — attenuated sizes vanish at the shell's distance
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
);
scene.add(stars);

// --- Fireflies: glowing points bobbing around the pond ---
const FIREFLY_COUNT = 30;
const fireflyGeometry = new THREE.BufferGeometry();
fireflyGeometry.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(new Array(FIREFLY_COUNT * 3).fill(0), 3)
);
const fireflies = new THREE.Points(
  fireflyGeometry,
  new THREE.PointsMaterial({
    color: 0xf2ffa6,
    size: 0.1,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
scene.add(fireflies);

// Each firefly orbits a home point with its own speed and phase
const fireflyHomes = [];
for (let i = 0; i < FIREFLY_COUNT; i++) {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * (POND_RADIUS + 3);
  fireflyHomes.push({
    x: POND_CENTER.x + Math.cos(angle) * r,
    z: POND_CENTER.y + Math.sin(angle) * r,
    y: 0.4 + Math.random() * 1.6,
    wanderR: 0.5 + Math.random() * 1.2,
    speed: 0.3 + Math.random() * 0.7,
    phase: Math.random() * Math.PI * 2,
  });
}

function updateFireflies(t) {
  const pos = fireflyGeometry.attributes.position;
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const f = fireflyHomes[i];
    const a = t * f.speed + f.phase;
    pos.setXYZ(
      i,
      f.x + Math.cos(a) * f.wanderR,
      f.y + Math.sin(a * 2.3) * 0.3,
      f.z + Math.sin(a) * f.wanderR
    );
  }
  pos.needsUpdate = true;
}

// --- Click to spawn a ripple (raycast the pond, addDrop-style) ---
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let nextDrop = 0;

// Hovering over the ground bends nearby grass away from the pointer.
// The shader uniform eases toward this target in the render loop.
const grassPointerTarget = grassUniforms.uPointer.value.clone();
renderer.domElement.addEventListener('pointermove', (event) => {
  pointer.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(hoverTargets)[0];
  if (hit) grassPointerTarget.copy(hit.point);
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointer.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(ripples)[0];
  if (!hit) return;
  // Only spawn inside the pond
  const dx = hit.point.x - POND_CENTER.x;
  const dz = hit.point.z - POND_CENTER.y;
  if (Math.hypot(dx, dz) > POND_RADIUS) return;
  ripplesUniforms.uDrops.value[nextDrop].set(
    hit.point.x, hit.point.z, clock.getElapsedTime(), 1
  );
  nextDrop = (nextDrop + 1) % MAX_DROPS;
});

// --- Clock + day/night cycle: follows real time, or a slider-scrubbed time ---
const clockElement = document.getElementById('clock');
const dateElement = document.getElementById('date');
const timeDial = document.getElementById('time-dial');
const dialHandle = document.getElementById('dial-handle');
const liveButton = document.getElementById('live-button');

// Handle position on the dial ring: midnight at the bottom, clockwise,
// noon at the top. Tinted warm by day, cool by night.
const dialDayColor = new THREE.Color('#ffd27f');
const dialNightColor = new THREE.Color('#aebeff');
function updateDial(minutes, dayFactor) {
  const a = (minutes / 1440) * Math.PI * 2;
  const r = timeDial.clientWidth / 2;
  const x = r + Math.sin(a + Math.PI) * (r - 6);
  const y = r + Math.cos(a + Math.PI) * (r - 6) * -1;
  dialHandle.style.transform = `translate(${x}px, ${y}px)`;
  dialHandle.style.background =
    '#' + dialNightColor.clone().lerp(dialDayColor, dayFactor).getHexString();
  timeDial.setAttribute('aria-valuenow', Math.round(minutes));
}

// null = follow the real clock; otherwise minutes since midnight from the dial
let manualMinutes = null;

// ?time=14:30 or ?time=870 (minutes) starts the scene frozen at that time
const timeParam = new URLSearchParams(location.search).get('time');
if (timeParam) {
  const [h, m = 0] = timeParam.split(':').map(Number);
  const minutes = timeParam.includes(':') ? h * 60 + m : Number(timeParam);
  if (Number.isFinite(minutes)) manualMinutes = ((minutes % 1440) + 1440) % 1440;
}

// 1 = full day, 0 = full night, smooth ramps at dawn (6-8h) and dusk (18-20h)
function daylightFactor(hour) {
  if (hour < 6 || hour >= 20) return 0;
  if (hour < 8) return (hour - 6) / 2;
  if (hour < 18) return 1;
  return 1 - (hour - 18) / 2;
}

function applyTimeOfDay() {
  const now = new Date();
  // The actual local date — scrubbing only changes the time of day
  dateElement.textContent = now.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  let minutes;
  if (manualMinutes === null) {
    minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    clockElement.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } else {
    minutes = manualMinutes;
    now.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    clockElement.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const t = daylightFactor(minutes / 60);
  updateDial(minutes, t);
  const hour = minutes / 60;
  const pal = samplePalette(hour);

  FOG_COLOR.copy(pal.fog);
  WATER_SHALLOW.copy(pal.shallow);
  WATER_DEEP.copy(pal.deep);
  scene.background.copy(FOG_COLOR);

  // Sky gradient tracks the timeline
  skyUniforms.uTopColor.value.copy(pal.skyTop);
  skyUniforms.uHighColor.value.copy(pal.skyHigh);
  skyUniforms.uMidColor.value.copy(pal.skyMid);
  skyUniforms.uLowColor.value.copy(pal.skyLow);
  skyUniforms.uHorizonColor.value.copy(pal.skyHorizon);

  // Sun: 0 at sunrise (east horizon), 1 at sunset (west). The whole arc
  // stays near the horizon — below camera eye level — so the disc is
  // actually visible behind the island despite the camera's polar limits.
  const dayProgress = THREE.MathUtils.clamp((hour - 6) / 14, 0, 1);
  const theta = dayProgress * Math.PI;
  const elevation = Math.sin(theta);
  sunPosition.set(Math.cos(theta) * 108, 3.6 + elevation * 6.6, -42);
  sunDirection.copy(sunPosition).normalize();
  sunColor.copy(SUN_COLOR_LOW).lerp(SUN_COLOR_HIGH, elevation);

  sun.position.copy(sunPosition);
  sun.material.color.copy(sunColor);
  // Fade the disc in/out around sunrise and sunset
  const rim = Math.min(hour - 6, 20 - hour);
  const sunOpacity = THREE.MathUtils.clamp(rim * 2, 0, 1);
  sun.material.opacity = sunOpacity;

  // Moon: same horizon ride, sunset 20h to sunrise 6h. Like the sun, it
  // fades over the half hour after rise and before set instead of blinking
  const moonProgress = (hour >= 20 ? hour - 20 : hour + 4) / 10;
  const moonTheta = moonProgress * Math.PI;
  const moonElevation = Math.sin(moonTheta);
  moon.position.set(Math.cos(moonTheta) * 108, 3.6 + moonElevation * 6.6, -42);
  moonDirection.copy(moon.position).normalize();
  const moonRim = Math.min(moonProgress, 1 - moonProgress) * 10; // hours from rise/set
  const moonOpacity = THREE.MathUtils.clamp(moonRim * 2, 0, 1) * 0.9;
  moon.material.opacity = moonOpacity;

  // Sky horizon glow: warm around a low sun (strongest at rise/set, fading
  // as it climbs), or a faint cool sheen around the moon at night
  if (sunOpacity > 0) {
    skyUniforms.uGlowDir.value.set(sunPosition.x, sunPosition.z).normalize();
    skyUniforms.uGlowColor.value.copy(sunColor).lerp(WHITE, 0.15);
    skyUniforms.uGlowStrength.value = sunOpacity * (1 - elevation * 0.75) * 0.55;
  } else if (moonOpacity > 0) {
    skyUniforms.uGlowDir.value.set(moon.position.x, moon.position.z).normalize();
    skyUniforms.uGlowColor.value.copy(MOON_GLINT_COLOR);
    skyUniforms.uGlowStrength.value = (moonOpacity / 0.9) * 0.18;
  } else {
    skyUniforms.uGlowStrength.value = 0;
  }

  // Stars come out as the daylight goes
  stars.material.opacity = (1 - t) * 0.9;
  stars.visible = t < 1;

  // Key light tracks the sun by day, falls back to the moon angle at night;
  // its color and intensity come from the timeline keyframes
  keyLight.position.lerpVectors(NIGHT_LIGHT_POS, sunPosition, t);
  keyLight.color.copy(pal.keyColor);
  keyLight.intensity = pal.keyIntensity;
  ambientLight.color.copy(pal.ambientColor);
  ambientLight.intensity = pal.ambientIntensity;

  // Glint on the pond: sun by day, a fainter cool moon streak at night
  if (t > 0) {
    groundUniforms.uSunDir.value.copy(sunDirection);
    // Half-desaturated toward white so a low sun doesn't stain the teal olive
    groundUniforms.uSunGlintColor.value.copy(sunColor).lerp(WHITE, 0.5);
    groundUniforms.uSunGlint.value = t;
  } else if (moonOpacity > 0) {
    groundUniforms.uSunDir.value.copy(moonDirection);
    groundUniforms.uSunGlintColor.value.copy(MOON_GLINT_COLOR);
    // Glint fades with the moon so it doesn't linger after moonset
    groundUniforms.uSunGlint.value = 0.3 * (moonOpacity / 0.9);
  } else {
    groundUniforms.uSunGlint.value = 0;
  }

  // Grass, tree foliage and falling leaves reflect the current scene light:
  // sun/moon key color scaled by intensity, the ambient, and a touch of the
  // sky horizon — so sunrise stains them pink, noon is bright and neutral,
  // and night cools them down, all from the same timeline keyframes.
  foliageTint
    .copy(pal.keyColor).multiplyScalar(pal.keyIntensity * 0.4)
    .add(tintScratch.copy(pal.ambientColor).multiplyScalar(pal.ambientIntensity * 0.5))
    .add(tintScratch.copy(pal.skyHorizon).multiplyScalar(0.12));
  grassUniforms.uTint.value.copy(foliageTint);
  foliageUniforms.uTint.value.copy(foliageTint);
  // Leaves: instanceColor is multiplied by material.color, so the tint goes there
  leaves.material.color.copy(foliageTint);

  // Fireflies only come out at night
  fireflies.material.opacity = 1 - t;
  fireflies.visible = t < 1;
}

function updatePanelState() {
  liveButton.classList.toggle('active', manualMinutes === null);
}

// Grabbing the dial freezes the scene at that time; the live button resumes
function dialMinutesFromPointer(event) {
  const rect = timeDial.getBoundingClientRect();
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  // Inverse of updateDial's mapping: midnight bottom, clockwise
  const a = Math.atan2(-dx, dy);
  const minutes = ((a / (Math.PI * 2)) * 1440 + 1440) % 1440;
  return Math.round(minutes);
}
let dialDragging = false;
timeDial.addEventListener('pointerdown', (event) => {
  dialDragging = true;
  timeDial.setPointerCapture(event.pointerId);
  manualMinutes = dialMinutesFromPointer(event);
  updatePanelState();
  applyTimeOfDay();
});
timeDial.addEventListener('pointermove', (event) => {
  if (!dialDragging) return;
  manualMinutes = dialMinutesFromPointer(event);
  applyTimeOfDay();
});
timeDial.addEventListener('pointerup', () => { dialDragging = false; });
timeDial.addEventListener('pointercancel', () => { dialDragging = false; });
// iOS Safari ignores touch-action for double-tap zoom; killing the touchend
// default is the reliable way to stop taps on the dial from zooming the page
// (the dial itself works via pointer events, which still fire)
timeDial.addEventListener('touchend', (event) => event.preventDefault(), { passive: false });
liveButton.addEventListener('click', () => {
  manualMinutes = null;
  updatePanelState();
  applyTimeOfDay();
});

// Pin the clock's width to the live format (the widest, with seconds) so
// switching to the shorter manual format can't resize the right-anchored
// panel and shift the dial and live button. tabular-nums keeps digit widths
// equal, so one measurement holds for any time.
clockElement.textContent = new Date().toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
clockElement.style.minWidth = `${Math.ceil(clockElement.getBoundingClientRect().width)}px`;
clockElement.style.textAlign = 'center';

applyTimeOfDay();
updatePanelState();
setInterval(applyTimeOfDay, 1000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastTime = 0;
renderer.setAnimationLoop(() => {
  const elapsed = clock.getElapsedTime();
  const delta = Math.min(elapsed - lastTime, 0.1);
  lastTime = elapsed;
  ripplesUniforms.uTime.value += 0.00015;
  ripplesUniforms.uClock.value = elapsed;
  grassUniforms.uTime.value = elapsed;
  foliageUniforms.uTime.value = elapsed;
  grassUniforms.uPointer.value.lerp(grassPointerTarget, 0.06);
  updateLeaves(elapsed, delta);
  updateFireflies(elapsed);
  updateZoomDamping();
  controls.update();
  renderer.render(scene, camera);
});
