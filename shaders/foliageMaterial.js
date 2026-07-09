import * as THREE from 'three';

// Fluffy tree foliage adapted from douges.dev "Building fluffy trees" part 1.
// Each foliage "quad" is degenerate — all four vertices sit on one point —
// and the vertex shader spreads the corners apart in *view space* by an
// offset derived from their UVs, so every puff always faces the camera.
// Puff size comes from the per-vertex aPuffSize attribute.
//
// Shading matches the fluffy grass: unlit, tinted between the same two tip
// colors by the shared perlin noise texture, and dimmed/cooled at night by
// the same uDayFactor curve — so the canopy reads as part of the meadow.
export function createFoliageMaterial({ alphaTexture, noiseTexture, terrainSize }) {
  const uniforms = {
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector3(0, -1000, 0) }, // world pos, starts far away
    uDayFactor: { value: 1 },
    uNoiseScale: { value: 1.5 },
    uColor1: { value: new THREE.Color('#8fe8d8') }, // grass tip colors
    uColor2: { value: new THREE.Color('#05a3af') },
    uAlphaTexture: { value: alphaTexture },
    uNoiseTexture: { value: noiseTexture },
    uTerrainSize: { value: terrainSize },
  };

  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = /* glsl */ `
      #include <common>
      attribute float aPuffSize;
      uniform float uTime;
      uniform float uTerrainSize;
      uniform vec3 uPointer;
      uniform sampler2D uNoiseTexture;
      varying vec2 vUv;
      varying vec2 vGlobalUV;
      void main() {
        vec4 modelPosition = modelMatrix * vec4(position, 1.0);
        vGlobalUV = (uTerrainSize - modelPosition.xz) / uTerrainSize;

        // Wind: same travelling sine + scrolling noise as the grass blades,
        // with a faster per-puff flutter and a slow vertical breath
        vec4 noise = texture2D(uNoiseTexture, vGlobalUV + uTime * 0.001);
        float sway = sin(50.0 * dot(normalize(vec2(1.0, 1.0)), vGlobalUV) + noise.g * 5.5 + uTime)
          * 0.09;
        float flutter = sin(uTime * 2.2 + noise.r * 10.0 + modelPosition.y * 2.0) * 0.045;
        modelPosition.x += sway + flutter;
        modelPosition.z += sway - flutter * 0.5;
        modelPosition.y += sin(uTime * 1.7 + noise.b * 9.0) * 0.03;

        // Bend puffs away from the hovered point, same feel as the grass
        vec3 away = modelPosition.xyz - uPointer;
        float push = smoothstep(1.6, 0.0, length(away));
        modelPosition.xyz += normalize(away + vec3(0.0001)) * push * 0.45;

        // Spread the collapsed quad's corners apart in view space, direction
        // from each corner's UV — a billboard sized by aPuffSize
        vec2 vertexOffset = normalize(uv * 2.0 - 1.0) * vec2(-1.0, 1.0);
        vec4 mvPosition = viewMatrix * modelPosition;
        mvPosition.xyz += vec3(vertexOffset, 1.0) * aPuffSize;

        gl_Position = projectionMatrix * mvPosition;
        vUv = uv;
      }
    `;

    shader.fragmentShader = /* glsl */ `
      #include <common>
      uniform sampler2D uAlphaTexture;
      uniform sampler2D uNoiseTexture;
      uniform float uNoiseScale;
      uniform float uDayFactor;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      varying vec2 vUv;
      varying vec2 vGlobalUV;
      void main() {
        float leafAlpha = texture2D(uAlphaTexture, vUv).r;
        if (leafAlpha < 0.5) discard;

        vec4 variation = texture2D(uNoiseTexture, vGlobalUV * uNoiseScale);
        vec3 color = mix(uColor1, uColor2, variation.r);
        // Slightly darker than the grass tips so crowns keep some depth
        color *= 0.75 + variation.g * 0.25;
        // Same day/night dim + cool as the grass
        color *= mix(vec3(0.30, 0.36, 0.55), vec3(0.82), uDayFactor);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;
  };

  return { material, uniforms };
}
