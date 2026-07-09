import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFluffyGrassMaterial } from './shaders/grassMaterial.js';
import { createFoliageMaterial } from './shaders/foliageMaterial.js';
import { vertexCommon, vertexBegin, noiseGLSL, pondDepth } from './shaders/common.glsl.js';
import { groundFragmentCommon, groundFragmentColor, groundFragmentEmissive } from './shaders/ground.glsl.js';
import { ripplesFragmentCommon, ripplesFragmentColor, ripplesFragmentEmissive } from './shaders/ripples.glsl.js';

// Day and night palettes — the live colors blend between them by real local time
const PALETTES = {
  night: {
    fog: new THREE.Color(0.012, 0.02, 0.055),
    ground: new THREE.Color(0x05a3af),
    shallow: new THREE.Color(0.09, 0.32, 0.3),
    deep: new THREE.Color(0.04, 0.2, 0.24),
    keyColor: new THREE.Color(0xbfd4ff),
    keyIntensity: 0.8,
    ambientColor: new THREE.Color(0x8899cc),
    ambientIntensity: 0.25,
  },
  day: {
    fog: new THREE.Color(0.196, 0.51, 0.804),
    ground: new THREE.Color(0x05a3af),
    shallow: new THREE.Color(0.32, 0.9, 0.79),
    deep: new THREE.Color(0.16, 0.74, 0.75),
    keyColor: new THREE.Color(0xfff4e6),
    keyIntensity: 1.5,
    ambientColor: new THREE.Color(0xfff8f0),
    ambientIntensity: 0.32,
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

function makeCrownGeometry(puffCount, radius, puffSize, rand) {
  const quads = [];
  const dir = new THREE.Vector3();
  for (let i = 0; i < puffCount; i++) {
    const quad = new THREE.PlaneGeometry(0, 0);
    // Uniform direction on the sphere, squashed vertically
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    dir.set(s * Math.cos(phi), u * 0.6, s * Math.sin(phi))
      .multiplyScalar(radius * Math.cbrt(rand()));
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
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09 * treeScale, 0.16 * treeScale, trunkHeight, 7),
    trunkMaterial
  );
  trunk.position.y = trunkHeight / 2;
  tree.add(trunk);

  // Puff size is a view-space offset, so tree scale is baked into the
  // geometry here rather than applied via tree.scale
  const crownRadius = (0.9 + rand() * 0.4) * treeScale;
  const crown = new THREE.Mesh(
    makeCrownGeometry(10, crownRadius, 0.85 * treeScale, rand),
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
// its 1-unit crown overhang sit on dry grass, spaced >= 2.6 apart
const TREE_SPOTS = [
  { x: 5.3, z: 0, scale: 1.15 },
  { x: 4.59, z: 2.65, scale: 0.85 },
  { x: 2.34, z: 4.75, scale: 1.3 },
  { x: -0.35, z: 5.29, scale: 0.9 },
  { x: -3.75, z: 3.75, scale: 1.2 },
  { x: 2.34, z: -4.75, scale: 1.0 },
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

// --- Sky: gradient dome (deep zenith to lighter horizon), day/night driven ---
const SKY_COLORS = {
  night: {
    top: new THREE.Color(0x010207),
    horizon: new THREE.Color(0x0a0f1f),
  },
  day: {
    top: new THREE.Color(0x184f9b),
    horizon: new THREE.Color(0x6ba3d6),
  },
};
const skyUniforms = {
  uTopColor: { value: SKY_COLORS.night.top.clone() },
  uHorizonColor: { value: SKY_COLORS.night.horizon.clone() },
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
      uniform vec3 uHorizonColor;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        // Horizon band wraps below eye level too, since the island floats
        vec3 color = mix(uHorizonColor, uTopColor, smoothstep(0.0, 0.65, abs(h)));
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
function makeGlowTexture(core, mid, halo) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, core);
  g.addColorStop(0.45, mid);
  g.addColorStop(1, halo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
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
  makeGlowTexture('rgba(255,244,214,0.95)', 'rgba(255,214,140,0.30)', 'rgba(255,200,120,0)'),
  20
);
const moon = makeGlowSprite(
  makeGlowTexture('rgba(228,238,255,0.95)', 'rgba(180,200,240,0.25)', 'rgba(160,180,230,0)'),
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
  const n = PALETTES.night;
  const d = PALETTES.day;

  FOG_COLOR.copy(n.fog).lerp(d.fog, t);
  GROUND_COLOR.copy(n.ground).lerp(d.ground, t);
  WATER_SHALLOW.copy(n.shallow).lerp(d.shallow, t);
  WATER_DEEP.copy(n.deep).lerp(d.deep, t);
  scene.background.copy(FOG_COLOR);

  // Sky gradient tracks the cycle; horizon warms toward the low sun
  skyUniforms.uTopColor.value.copy(SKY_COLORS.night.top).lerp(SKY_COLORS.day.top, t);
  skyUniforms.uHorizonColor.value
    .copy(SKY_COLORS.night.horizon)
    .lerp(SKY_COLORS.day.horizon, t);

  const hour = minutes / 60;

  // Sun: 0 at sunrise (east horizon), 1 at sunset (west). The whole arc
  // stays near the horizon — below camera eye level — so the disc is
  // actually visible behind the island despite the camera's polar limits.
  const dayProgress = THREE.MathUtils.clamp((hour - 6) / 14, 0, 1);
  const theta = dayProgress * Math.PI;
  const elevation = Math.sin(theta);
  sunPosition.set(Math.cos(theta) * 72, 2.4 + elevation * 4.4, -28);
  sunDirection.copy(sunPosition).normalize();
  sunColor.copy(SUN_COLOR_LOW).lerp(SUN_COLOR_HIGH, elevation);

  // Warm the horizon when the sun is low (sunrise / sunset glow)
  skyUniforms.uHorizonColor.value.lerp(sunColor, t * (1 - elevation) * 0.35);

  sun.position.copy(sunPosition);
  sun.material.color.copy(sunColor);
  // Fade the disc in/out around sunrise and sunset
  const rim = Math.min(hour - 6, 20 - hour);
  sun.material.opacity = THREE.MathUtils.clamp(rim * 2, 0, 1);

  // Moon: same horizon ride, sunset 20h to sunrise 6h
  const moonProgress = (hour >= 20 ? hour - 20 : hour + 4) / 10;
  const moonUp = moonProgress >= 0 && moonProgress <= 1 && (hour >= 20 || hour < 6);
  const moonTheta = moonProgress * Math.PI;
  const moonElevation = Math.sin(moonTheta);
  moon.position.set(Math.cos(moonTheta) * 72, 2.4 + moonElevation * 4.4, -28);
  moonDirection.copy(moon.position).normalize();
  moon.material.opacity = moonUp ? 0.9 : 0;

  // Stars come out as the daylight goes
  stars.material.opacity = (1 - t) * 0.9;
  stars.visible = t < 1;

  // Key light tracks the sun by day, falls back to the moon angle at night
  keyLight.position.lerpVectors(NIGHT_LIGHT_POS, sunPosition, t);
  keyLight.color.copy(n.keyColor).lerp(sunColor, t);
  keyLight.intensity = THREE.MathUtils.lerp(n.keyIntensity, d.keyIntensity, t);
  ambientLight.color.copy(n.ambientColor).lerp(d.ambientColor, t);
  ambientLight.intensity = THREE.MathUtils.lerp(n.ambientIntensity, d.ambientIntensity, t);

  // Glint on the pond: sun by day, a fainter cool moon streak at night
  if (t > 0) {
    groundUniforms.uSunDir.value.copy(sunDirection);
    // Half-desaturated toward white so a low sun doesn't stain the teal olive
    groundUniforms.uSunGlintColor.value.copy(sunColor).lerp(WHITE, 0.5);
    groundUniforms.uSunGlint.value = t;
  } else if (moonUp) {
    groundUniforms.uSunDir.value.copy(moonDirection);
    groundUniforms.uSunGlintColor.value.copy(MOON_GLINT_COLOR);
    groundUniforms.uSunGlint.value = 0.3;
  } else {
    groundUniforms.uSunGlint.value = 0;
  }

  grassUniforms.uDayFactor.value = t;
  foliageUniforms.uDayFactor.value = t;
  // Leaves: instanceColor is multiplied by material.color, so the same
  // dim-and-cool night tint as the grass goes there
  leaves.material.color.setRGB(0.30, 0.36, 0.55).lerp(new THREE.Color(0.82, 0.82, 0.82), t);

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
