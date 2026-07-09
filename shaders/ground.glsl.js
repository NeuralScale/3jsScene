import { noiseGLSL } from './common.glsl.js';

// Fragment <common> block: noise helpers + pond uniforms
export const groundFragmentCommon = /* glsl */ `
  #include <common>
  ${noiseGLSL}
  uniform vec3 uGroundColor;
  uniform vec3 uSoilColor;
  uniform vec3 uWaterShallow;
  uniform vec3 uWaterDeep;
  uniform vec2 uPondCenter;
  uniform float uPondRadius;
  uniform vec3 uSunDir;
  uniform vec3 uSunGlintColor;
  uniform float uSunGlint;
`;

// Fragment <color_fragment> block: paint the pond onto the ground
export const groundFragmentColor = /* glsl */ `
  #include <color_fragment>
  float depth = pondDepth(vWorldPos.xz, uPondCenter, uPondRadius);
  float waterMask = smoothstep(0.05, 0.15, depth);
  vec3 waterColor = mix(uWaterShallow, uWaterDeep, smoothstep(0.15, 0.8, depth));
  // Grass texture: stretched fine noise reads as blades, coarse noise as patches
  float blades = vnoise(vec2(vWorldPos.x * 45.0, vWorldPos.z * 5.0));
  float patches = vnoise(vWorldPos.xz * 2.5);
  vec3 grassColor = uGroundColor * (0.72 + blades * 0.28 + patches * 0.22);
  // Soil ring hugging the shoreline, fading back into the ground color
  vec3 shoreColor = mix(grassColor, uSoilColor, smoothstep(0.045, 0.09, depth));
  diffuseColor.rgb = mix(shoreColor, waterColor, waterMask);
`;

// Fragment <emissivemap_fragment> block: water glows on its own. The pond is
// part of the lit ground, so with a low sun it would go swamp-dark while the
// unlit grass around it stays bright — self-lit water keeps the style even.
// The sun/moon glint lives here too so lighting can't mute it.
export const groundFragmentEmissive = /* glsl */ `
  #include <emissivemap_fragment>
  // Sun on the water: a tight mirror glint plus a broad colored haze,
  // rippled slightly by the same noise so the streak shimmers
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 bounce = reflect(-viewDir, vec3(0.0, 1.0, 0.0));
  float facing = max(dot(bounce, uSunDir), 0.0);
  float shimmer = 0.75 + 0.5 * vnoise(vWorldPos.xz * 3.0);
  float glint = pow(facing, 160.0) * shimmer;
  float haze = pow(facing, 8.0) * 0.03;
  totalEmissiveRadiance +=
    (waterColor * 0.5 + uSunGlintColor * (glint + haze) * uSunGlint) * waterMask;
`;
