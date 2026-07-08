import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFluffyGrassMaterial } from './shaders/grassMaterial.js';
import { vertexCommon, vertexBegin, noiseGLSL, pondDepth } from './shaders/common.glsl.js';
import { groundFragmentCommon, groundFragmentColor } from './shaders/ground.glsl.js';
import { ripplesFragmentCommon, ripplesFragmentColor } from './shaders/ripples.glsl.js';

// Day and night palettes — the live colors blend between them by real local time
const PALETTES = {
  night: {
    fog: new THREE.Color(0.012, 0.02, 0.055),
    ground: new THREE.Color(0x05a3af),
    shallow: new THREE.Color(0.05, 0.22, 0.2),
    deep: new THREE.Color(0.02, 0.12, 0.16),
    keyColor: new THREE.Color(0xbfd4ff),
    keyIntensity: 0.8,
    ambientColor: new THREE.Color(0x8899cc),
    ambientIntensity: 0.25,
  },
  day: {
    fog: new THREE.Color(0.196, 0.51, 0.804),
    ground: new THREE.Color(0x05a3af),
    shallow: new THREE.Color(0.15, 0.65, 0.55),
    deep: new THREE.Color(0.06, 0.5, 0.51),
    keyColor: new THREE.Color(0xfff4e6),
    keyIntensity: 2.0,
    ambientColor: new THREE.Color(0xfff8f0),
    ambientIntensity: 0.4,
  },
};

// Live colors, mutated in place by applyTimeOfDay()
const FOG_COLOR = PALETTES.night.fog.clone();
const GROUND_COLOR = PALETTES.night.ground.clone();
const WATER_SHALLOW = PALETTES.night.shallow.clone();
const WATER_DEEP = PALETTES.night.deep.clone();

const PLANE_SIZE = 13;
const POND_CENTER = new THREE.Vector2(0.0, 0.0); // world xz
const POND_RADIUS = 5;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR, 47, 57);
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
controls.minPolarAngle = 0; // allow a straight top-down view

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
    .replace('#include <color_fragment>', groundFragmentColor);
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
    .replace('#include <color_fragment>', ripplesFragmentColor);
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
  const hit = raycaster.intersectObject(ground)[0];
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
const timeSlider = document.getElementById('time-slider');
const liveButton = document.getElementById('live-button');

// null = follow the real clock; otherwise minutes since midnight from the slider
let manualMinutes = null;

// 1 = full day, 0 = full night, smooth ramps at dawn (6-8h) and dusk (18-20h)
function daylightFactor(hour) {
  if (hour < 6 || hour >= 20) return 0;
  if (hour < 8) return (hour - 6) / 2;
  if (hour < 18) return 1;
  return 1 - (hour - 18) / 2;
}

function applyTimeOfDay() {
  const now = new Date();
  let minutes;
  if (manualMinutes === null) {
    minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    timeSlider.value = Math.round(minutes);
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
  const n = PALETTES.night;
  const d = PALETTES.day;

  FOG_COLOR.copy(n.fog).lerp(d.fog, t);
  GROUND_COLOR.copy(n.ground).lerp(d.ground, t);
  WATER_SHALLOW.copy(n.shallow).lerp(d.shallow, t);
  WATER_DEEP.copy(n.deep).lerp(d.deep, t);
  if (scene.fog) scene.fog.color.copy(FOG_COLOR);
  scene.background.copy(FOG_COLOR);

  keyLight.color.copy(n.keyColor).lerp(d.keyColor, t);
  keyLight.intensity = THREE.MathUtils.lerp(n.keyIntensity, d.keyIntensity, t);
  ambientLight.color.copy(n.ambientColor).lerp(d.ambientColor, t);
  ambientLight.intensity = THREE.MathUtils.lerp(n.ambientIntensity, d.ambientIntensity, t);

  grassUniforms.uDayFactor.value = t;

  // Fireflies only come out at night
  fireflies.material.opacity = 1 - t;
  fireflies.visible = t < 1;
}

function updatePanelState() {
  liveButton.classList.toggle('active', manualMinutes === null);
}

// Grabbing the slider freezes the scene at that time; the live button resumes
timeSlider.addEventListener('pointerdown', () => {
  manualMinutes = Number(timeSlider.value);
  updatePanelState();
});
timeSlider.addEventListener('input', () => {
  manualMinutes = Number(timeSlider.value);
  updatePanelState();
  applyTimeOfDay();
});
liveButton.addEventListener('click', () => {
  manualMinutes = null;
  updatePanelState();
  applyTimeOfDay();
});

applyTimeOfDay();
updatePanelState();
setInterval(applyTimeOfDay, 1000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  ripplesUniforms.uTime.value += 0.00015;
  ripplesUniforms.uClock.value = clock.getElapsedTime();
  grassUniforms.uTime.value = clock.getElapsedTime();
  grassUniforms.uPointer.value.lerp(grassPointerTarget, 0.06);
  updateFireflies(clock.getElapsedTime());
  updateZoomDamping();
  controls.update();
  renderer.render(scene, camera);
});
