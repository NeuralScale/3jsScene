import { noiseGLSL } from './common.glsl.js';

// Fragment <common> block: noise helpers + pond uniforms
export const groundFragmentCommon = /* glsl */ `
  #include <common>
  ${noiseGLSL}
  uniform vec3 uGroundColor;
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
  diffuseColor.rgb = mix(uGroundColor, waterColor, waterMask);
`;
