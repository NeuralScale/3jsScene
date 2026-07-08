import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { vertexCommon, vertexBegin } from './shaders/common.glsl.js';
import { groundFragmentCommon, groundFragmentColor } from './shaders/ground.glsl.js';
import { ripplesFragmentCommon, ripplesFragmentColor } from './shaders/ripples.glsl.js';

// Day and night palettes — the live colors blend between them by real local time
const PALETTES = {
  night: {
    fog: new THREE.Color(0.012, 0.02, 0.055),
    ground: new THREE.Color(0.05, 0.1, 0.04),
    shallow: new THREE.Color(0.05, 0.22, 0.2),
    deep: new THREE.Color(0.02, 0.12, 0.16),
    keyColor: new THREE.Color(0xbfd4ff),
    keyIntensity: 0.8,
    ambientColor: new THREE.Color(0x8899cc),
    ambientIntensity: 0.25,
    cloudColor: new THREE.Color(0x2a3350),
    cloudOpacity: 0.7,
  },
  day: {
    fog: new THREE.Color(0.196, 0.51, 0.804),
    ground: new THREE.Color(0.24, 0.42, 0.1),
    shallow: new THREE.Color(0.15, 0.65, 0.55),
    deep: new THREE.Color(0.06, 0.5, 0.51),
    keyColor: new THREE.Color(0xfff4e6),
    keyIntensity: 2.0,
    ambientColor: new THREE.Color(0xfff8f0),
    ambientIntensity: 0.4,
    cloudColor: new THREE.Color(0xffffff),
    cloudOpacity: 0.9,
  },
};

// Live colors, mutated in place by applyTimeOfDay()
const FOG_COLOR = PALETTES.night.fog.clone();
const GROUND_COLOR = PALETTES.night.ground.clone();
const WATER_SHALLOW = PALETTES.night.shallow.clone();
const WATER_DEEP = PALETTES.night.deep.clone();

const PLANE_SIZE = 55;
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
controls.minDistance = 5;
controls.maxDistance = 35;
controls.maxPolarAngle = Math.PI / 2.2;
controls.minPolarAngle = Math.PI / 4;

// Key + ambient lights; color and intensity are driven by time of day
const keyLight = new THREE.DirectionalLight(0xbfd4ff, 0.8);
keyLight.position.set(-15, 12, 8);
scene.add(keyLight);
const ambientLight = new THREE.AmbientLight(0x8899cc, 0.25);
scene.add(ambientLight);

// --- Ground: pond painted into a MeshStandardMaterial ---
const groundUniforms = {
  uGroundColor: { value: GROUND_COLOR },
  uWaterShallow: { value: WATER_SHALLOW },
  uWaterDeep: { value: WATER_DEEP },
  uPondCenter: { value: POND_CENTER },
  uPondRadius: { value: POND_RADIUS },
};

const groundMaterial = new THREE.MeshStandardMaterial({ roughness: 1.0 });
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
  new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE),
  groundMaterial
);
ground.rotateX(-Math.PI / 2);
scene.add(ground);

const grid = new THREE.GridHelper(PLANE_SIZE, PLANE_SIZE, 0xffffff, 0xffffff);
grid.material.transparent = true;
grid.material.opacity = 0.07;
grid.position.y = 0.02;
scene.add(grid);

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

// --- Rocks & pebbles around the pond ---
const rockMaterial = new THREE.MeshStandardMaterial({
  color: 0x4a4e57,
  roughness: 0.95,
  flatShading: true,
});
const pebbleMaterial = new THREE.MeshStandardMaterial({
  color: 0x6b6f77,
  roughness: 0.9,
  flatShading: true,
});

function placeAroundPond(minOffset, maxOffset) {
  const angle = Math.random() * Math.PI * 2;
  const r = POND_RADIUS + minOffset + Math.random() * (maxOffset - minOffset);
  const x = POND_CENTER.x + Math.cos(angle) * r;
  const z = POND_CENTER.y + Math.sin(angle) * r;
  return new THREE.Vector3(x, 0, z);
}

for (let i = 0; i < 6; i++) {
  const size = 0.35 + Math.random() * 0.6;
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rockMaterial);
  rock.position.copy(placeAroundPond(0.4, 2.5));
  rock.position.y += size * 0.3; // sink slightly into the ground
  rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  rock.scale.y = 0.6 + Math.random() * 0.4;
  scene.add(rock);
}

for (let i = 0; i < 18; i++) {
  const size = 0.06 + Math.random() * 0.12;
  const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), pebbleMaterial);
  pebble.position.copy(placeAroundPond(0.1, 1.8));
  pebble.position.y += size * 0.4;
  pebble.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  pebble.scale.y = 0.6;
  scene.add(pebble);
}

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

// --- Sky deco: drifting night clouds ---
const cloudMaterial = new THREE.MeshBasicMaterial({
  color: 0x2a3350,
  fog: false,
  transparent: true,
  opacity: 0.7,
});

function makeCloud() {
  const cloud = new THREE.Group();
  const puffs = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < puffs; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(1.5 + Math.random() * 1.5, 10, 10),
      cloudMaterial
    );
    puff.position.set(i * 2 - puffs, Math.random() * 0.8, (Math.random() - 0.5) * 2);
    puff.scale.y = 0.55;
    cloud.add(puff);
  }
  return cloud;
}

const clouds = [];
for (let i = 0; i < 6; i++) {
  const cloud = makeCloud();
  cloud.position.set(
    -80 + Math.random() * 160,
    28 + Math.random() * 14,
    -90 + Math.random() * 60
  );
  scene.add(cloud);
  clouds.push(cloud);
}

// --- Click to spawn a ripple (raycast the pond, addDrop-style) ---
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let nextDrop = 0;

window.addEventListener('pointerdown', (event) => {
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

// --- Real-time clock + day/night cycle ---
const clockElement = document.getElementById('clock');

// 1 = full day, 0 = full night, smooth ramps at dawn (6-8h) and dusk (18-20h)
function daylightFactor(date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour < 6 || hour >= 20) return 0;
  if (hour < 8) return (hour - 6) / 2;
  if (hour < 18) return 1;
  return 1 - (hour - 18) / 2;
}

function applyTimeOfDay() {
  const now = new Date();
  clockElement.textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const t = daylightFactor(now);
  const n = PALETTES.night;
  const d = PALETTES.day;

  FOG_COLOR.copy(n.fog).lerp(d.fog, t);
  GROUND_COLOR.copy(n.ground).lerp(d.ground, t);
  WATER_SHALLOW.copy(n.shallow).lerp(d.shallow, t);
  WATER_DEEP.copy(n.deep).lerp(d.deep, t);
  scene.fog.color.copy(FOG_COLOR);
  scene.background.copy(FOG_COLOR);

  keyLight.color.copy(n.keyColor).lerp(d.keyColor, t);
  keyLight.intensity = THREE.MathUtils.lerp(n.keyIntensity, d.keyIntensity, t);
  ambientLight.color.copy(n.ambientColor).lerp(d.ambientColor, t);
  ambientLight.intensity = THREE.MathUtils.lerp(n.ambientIntensity, d.ambientIntensity, t);

  cloudMaterial.color.copy(n.cloudColor).lerp(d.cloudColor, t);
  cloudMaterial.opacity = THREE.MathUtils.lerp(n.cloudOpacity, d.cloudOpacity, t);

  // Fireflies only come out at night
  fireflies.material.opacity = 1 - t;
  fireflies.visible = t < 1;
}

applyTimeOfDay();
setInterval(applyTimeOfDay, 1000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  ripplesUniforms.uTime.value += 0.00015;
  ripplesUniforms.uClock.value = clock.getElapsedTime();
  updateFireflies(clock.getElapsedTime());
  for (const cloud of clouds) {
    cloud.position.x += 0.015;
    if (cloud.position.x > 90) cloud.position.x = -90;
  }
  controls.update();
  renderer.render(scene, camera);
});
