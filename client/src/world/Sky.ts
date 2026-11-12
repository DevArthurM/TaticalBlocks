import * as THREE from 'three';

export type CloudQuality = 0 | 1 | 2;

export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** Abaixo do horizonte (bruma ao longe). */
  ground: THREE.Color;
  sun: THREE.Color;
  cloudLit: THREE.Color;
  cloudShadow: THREE.Color;
}

/**
 * Céu procedural: gradiente do zênite ao horizonte, disco do sol com halo e nuvens
 * de ruído fractal que andam com o vento e recebem luz do lado do sol.
 * É uma cúpula que acompanha a câmera e não escreve profundidade — no
 * pós-processamento, "sem profundidade" = céu (sem névoa nem oclusão).
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(sunDir: THREE.Vector3, colors: SkyColors) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: sunDir.clone().normalize() },
        uZenith: { value: colors.zenith },
        uHorizon: { value: colors.horizon },
        uGround: { value: colors.ground },
        uSun: { value: colors.sun },
        uCloudLit: { value: colors.cloudLit },
        uCloudShadow: { value: colors.cloudShadow },
        uTime: { value: 0 },
      },
      defines: { CLOUDS: 2 },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          // só a rotação da câmera: a cúpula fica sempre centrada em quem olha
          vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform vec3 uSun;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudShadow;
        uniform float uTime;
        varying vec3 vDir;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        #if CLOUDS > 1
        #define OCTAVES 5
        #else
        #define OCTAVES 3
        #endif
        #if CLOUDS > 0
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < OCTAVES; i++) {
            v += a * noise(p);
            p = p * 2.03 + vec2(17.1, 9.3);
            a *= 0.5;
          }
          return v;
        }
        #endif

        void main() {
          vec3 d = normalize(vDir);
          float sunAmt = max(dot(d, uSunDir), 0.0);
          float h = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, 1.0 - pow(1.0 - h, 3.2));
          col = mix(col, uGround, smoothstep(0.0, -0.3, d.y));
          // luz do sol espalhada no ar: halo largo + brilho forte perto do disco
          col += uSun * (pow(sunAmt, 8.0) * 0.07 + pow(sunAmt, 80.0) * 0.3);
          col += uSun * smoothstep(0.99935, 0.9998, dot(d, uSunDir)) * 30.0;

          #if CLOUDS > 0
          if (d.y > 0.01) {
            // plano de nuvens "curvado": perto do horizonte elas se comprimem
            vec2 p = d.xz / (d.y + 0.14) * 1.25 + uTime * vec2(0.008, 0.003);
            float n = fbm(p);
            float cov = smoothstep(0.47, 0.74, n);
            #if CLOUDS > 1
            // densidade um passo em direção ao sol: se aumenta, este ponto está na sombra da nuvem
            float n2 = fbm(p + normalize(uSunDir.xz + 1e-4) * 0.1);
            float shade = clamp((n - n2) * 2.6 + 0.6, 0.0, 1.0);
            #else
            float shade = 0.72;
            #endif
            vec3 cl = mix(uCloudShadow, uCloudLit, shade);
            // contraluz: bordas finas acendem perto do sol
            cl += uSun * pow(sunAmt, 12.0) * 0.7 * (1.0 - cov * 0.6);
            col = mix(col, cl, cov * smoothstep(0.01, 0.2, d.y) * 0.94);
          }
          #endif

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
  }

  /** 0 = céu limpo, 1 = nuvens simples, 2 = nuvens volumosas (com luz e sombra). */
  setClouds(quality: CloudQuality): void {
    if (this.material.defines.CLOUDS === quality) return;
    this.material.defines.CLOUDS = quality;
    this.material.needsUpdate = true;
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
  }
}
