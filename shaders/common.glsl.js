// Shared GLSL chunks injected into MeshStandardMaterial via onBeforeCompile.

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
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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
