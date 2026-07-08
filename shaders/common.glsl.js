// Shared GLSL chunks injected into MeshStandardMaterial via onBeforeCompile.
// hash/vnoise/pondDepth also exist as JS twins at the bottom of this file,
// bit-exact thanks to the integer hash — keep both versions in sync.

// Adds a world-position varying to the vertex shader <common> block
export const vertexCommon = /* glsl */ `
  #include <common>
  varying vec3 vWorldPos;
`;

export const vertexBegin = /* glsl */ `
  #include <begin_vertex>
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
`;

// World-position varying + 2D value noise + procedural pond mask
export const noiseGLSL = /* glsl */ `
  varying vec3 vWorldPos;
  // PCG-style integer hash, called on whole-number lattice points only
  float hash(vec2 p) {
    uvec2 v = uvec2(ivec2(p));
    v = v * 1664525u + 1013904223u;
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v.x ^= v.x >> 16u;
    v.y ^= v.y >> 16u;
    v.x += v.y * 1664525u;
    v.x ^= v.x >> 16u;
    return float(v.x & 0x00ffffffu) / 16777216.0;
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  // Wobbly pond mask: 0 outside, ~1 at the deepest point
  float pondDepth(vec2 xz, vec2 center, float radius) {
    float wobble = (vnoise(xz * 0.35) - 0.5) * 2.5;
    float d = length(xz - center) + wobble;
    return 1.0 - smoothstep(0.0, radius, d);
  }
`;

// --- JS twins of the GLSL above ---
// The integer hash makes these match the GPU bit-for-bit, so main.js can
// find the exact shoreline the shaders draw (e.g. to place edging stones).

function hash(ix, iy) {
  let x = (Math.imul(ix, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(iy, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0;
  y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x & 0x00ffffff) / 16777216;
}

const mix = (a, b, t) => a + (b - a) * t;

function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = (x - ix) * (x - ix) * (3 - 2 * (x - ix));
  const fy = (y - iy) * (y - iy) * (3 - 2 * (y - iy));
  return mix(
    mix(hash(ix, iy), hash(ix + 1, iy), fx),
    mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx),
    fy
  );
}

export function pondDepth(x, z, center, radius) {
  const wobble = (vnoise(x * 0.35, z * 0.35) - 0.5) * 2.5;
  const dx = x - center.x;
  const dz = z - center.y;
  const d = Math.sqrt(dx * dx + dz * dz) + wobble;
  const t = Math.min(Math.max(d / radius, 0), 1);
  return 1 - t * t * (3 - 2 * t);
}
