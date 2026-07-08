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
