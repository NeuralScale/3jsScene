import { noiseGLSL } from './common.glsl.js';

// Fragment <common> block: noise helpers + ripple uniforms
export const ripplesFragmentCommon = /* glsl */ `
  #include <common>
  ${noiseGLSL}
  uniform float uTime;
  uniform vec2 uPondCenter;
  uniform float uPondRadius;

  // Click drops (inspired by jeantimex/threejs-water addDrop):
  // xy = world xz of the drop, z = spawn time in seconds, w = active flag
  #define MAX_DROPS 8
  uniform vec4 uDrops[MAX_DROPS];
  uniform float uClock;

  // Expanding rings for one drop, in the same style as the ambient bands
  float dropRing(vec2 xz, vec4 drop) {
    if (drop.w < 0.5) return 0.0;
    float age = uClock - drop.z;
    if (age < 0.0 || age > 5.0) return 0.0;
    float dist = length(xz - drop.xy);
    // Same sin-band look as the ambient ripples, radiating from the click
    float rings = sin((dist - age * 0.55) * 8.0);
    float band = smoothstep(0.75, 0.95, rings);
    // Only inside the expanding wavefront, fading with age and distance
    float front = smoothstep(age * 0.55 + 0.5, age * 0.55, dist);
    float decay = exp(-age * 0.9);
    return band * front * decay;
  }
`;

// Fragment <color_fragment> block: animated rings over the pond
export const ripplesFragmentColor = /* glsl */ `
  #include <color_fragment>
  float depth = pondDepth(vWorldPos.xz, uPondCenter, uPondRadius);
  float waterMask = smoothstep(0.1, 0.25, depth);
  // Concentric rings expanding outward, broken up by noise
  float rings = sin((depth + uTime * 8.0) * 40.0);
  float band = smoothstep(0.75, 0.95, rings);
  // Suppress rings near the pond center so they emerge further out
  band *= 1.0 - smoothstep(0.45, 0.7, depth);
  float breakup = vnoise(vWorldPos.xz * 1.5 + uTime * 3.0);
  band *= smoothstep(0.35, 0.65, breakup);
  // Click-spawned ripples, broken up by the same noise as the ambient bands
  float drops = 0.0;
  for (int i = 0; i < MAX_DROPS; i++) {
    drops += dropRing(vWorldPos.xz, uDrops[i]);
  }
  drops *= smoothstep(0.35, 0.65, breakup) * 0.5;
  diffuseColor.rgb = vec3(1.0);
  diffuseColor.a = clamp(band + drops, 0.0, 1.0) * 0.55 * waterMask;
`;
