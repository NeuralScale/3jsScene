import * as THREE from 'three';

// Fluffy grass material adapted from thebenezer/FluffyGrass (MIT).
// Alpha-cutout tufts with a base->tip gradient, noise-driven tint variation
// and sinusoidal wind sway. Simplified for this scene: no shadows/fog, and a
// uDayFactor uniform dims + cools the grass through the day/night cycle.
export function createFluffyGrassMaterial({ alphaTexture, noiseTexture, terrainSize }) {
  const uniforms = {
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector3(0, -1000, 0) }, // world pos, starts far away
    uDayFactor: { value: 1 },
    uNoiseScale: { value: 1.5 },
    uBaseColor: { value: new THREE.Color('#036d75') },
    uTipColor1: { value: new THREE.Color('#8fe8d8') },
    uTipColor2: { value: new THREE.Color('#05a3af') },
    uGrassAlphaTexture: { value: alphaTexture },
    uNoiseTexture: { value: noiseTexture },
    uTerrainSize: { value: terrainSize },
  };

  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = /* glsl */ `
      #include <common>
      uniform sampler2D uNoiseTexture;
      uniform float uTime;
      uniform float uTerrainSize;
      uniform vec3 uPointer;
      varying vec2 vUv;
      varying vec2 vGlobalUV;
      void main() {
        vec4 modelPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vGlobalUV = (uTerrainSize - modelPosition.xz) / uTerrainSize;

        // Wind: travelling sine wave broken up by scrolling noise, tips only,
        // plus a faster small flutter so blades never sit still
        vec4 noise = texture2D(uNoiseTexture, vGlobalUV + uTime * 0.001);
        float sway = sin(50.0 * dot(normalize(vec2(1.0, 1.0)), vGlobalUV) + noise.g * 5.5 + uTime)
          * 0.12 * uv.y;
        float flutter = sin(uTime * 2.6 + noise.r * 12.0) * 0.035 * uv.y;
        modelPosition.x += sway + flutter;
        modelPosition.z += sway - flutter * 0.6;

        // Bend tips away from the hovered point, squashing down slightly
        vec2 away = modelPosition.xz - uPointer.xz;
        float push = smoothstep(1.3, 0.0, length(away)) * uv.y;
        modelPosition.xz += normalize(away + vec2(0.0001)) * push * 0.22;
        modelPosition.y -= push * 0.08;

        gl_Position = projectionMatrix * viewMatrix * modelPosition;
        vUv = uv;
      }
    `;

    shader.fragmentShader = /* glsl */ `
      #include <common>
      uniform sampler2D uGrassAlphaTexture;
      uniform sampler2D uNoiseTexture;
      uniform float uNoiseScale;
      uniform float uDayFactor;
      uniform vec3 uBaseColor;
      uniform vec3 uTipColor1;
      uniform vec3 uTipColor2;
      varying vec2 vUv;
      varying vec2 vGlobalUV;
      void main() {
        float grassAlpha = texture2D(uGrassAlphaTexture, vUv).r;
        if (grassAlpha < 0.15) discard;

        vec4 variation = texture2D(uNoiseTexture, vGlobalUV * uNoiseScale);
        vec3 tipColor = mix(uTipColor1, uTipColor2, variation.r);
        vec3 color = mix(uBaseColor, tipColor, vUv.y);
        // Day/night: dim and cool the grass at night, keep day below full blast
        color *= mix(vec3(0.30, 0.36, 0.55), vec3(0.82), uDayFactor);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;
  };

  return { material, uniforms };
}
