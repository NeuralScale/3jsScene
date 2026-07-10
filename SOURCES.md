# Sources & Attributions

## Libraries

- **[Three.js](https://github.com/mrdoob/three.js)** v0.166.1 (MIT) — 3D rendering.
  Loaded from CDN: `https://cdn.jsdelivr.net/npm/three@0.166.1/`
  Addons used: `OrbitControls`, `BufferGeometryUtils` (`mergeGeometries`).

## Grass

- **[FluffyGrass](https://github.com/thebenezer/FluffyGrass)** by [thebenezer](https://github.com/thebenezer) (MIT, © 2023 Ebenezer) —
  the fluffy grass technique: instanced alpha-cutout tufts, base→tip color
  gradient, noise-driven tint variation, and sine + noise wind sway.
  - `shaders/grassMaterial.js` — adapted from `src/GrassMaterial.ts` (simplified:
    no shadows/fog, retinted, added `uTint` time-of-day light tinting).
  - `textures/grass.jpeg` — blade alpha texture from the repo.
  - `textures/perlinnoise.webp` — perlin noise texture from the repo.

## Trees

- **["Building fluffy trees with three.js"](https://douges.dev/blog/threejs-trees-1)** by
  [Michael Dougall](https://douges.dev) — the fluffy foliage technique: alpha-cutout
  quads inflated in view space by a UV-derived vertex offset (pseudo-billboarding).
  - `shaders/foliageMaterial.js` — vertex shader ported from the article's
    CustomShaderMaterial example onto `MeshStandardMaterial.onBeforeCompile`.
  - `textures/foliage_alpha.png` — foliage alpha map from the article
    (`douges.dev/static/foliage_alpha3.png`).

## Ripples

- Click-spawned water drops in `shaders/ripples.glsl.js` are inspired by the
  `addDrop` interaction in **[jeantimex/threejs-water](https://github.com/jeantimex/threejs-water)**
  (visuals reimplemented as simple expanding sin bands, no code copied).

## Noise

- The pond shape uses 2D value noise with a PCG-style integer hash
  (constants from the classic LCG `1664525` / `1013904223`, mix in the style of
  [Jarzynski & Olano, "Hash Functions for GPU Rendering"](https://jcgt.org/published/0009/03/02/)),
  implemented twice — GLSL and JS — in `shaders/common.glsl.js` so CPU
  placement matches the GPU-drawn shoreline exactly.
