import * as THREE from 'three';

/**
 * Foco do atirador: desenha braços/arma numa textura separada e a compõe na tela
 * com desfoque leve, exceto num pequeno círculo nítido no centro (massa de mira).
 * Assim a alça de mira e o corpo da arma ficam suavemente desfocados.
 */
export class ViewmodelFocus {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clear = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tVm: { value: this.target.texture },
        resolution: { value: new THREE.Vector2(1, 1) },
        blurPx: { value: 0 },
        sharpRadius: { value: 8 },
        feather: { value: 40 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tVm;
        uniform vec2 resolution;
        uniform float blurPx;
        uniform float sharpRadius;
        uniform float feather;
        varying vec2 vUv;
        void main() {
          vec4 sharp = texture2D(tVm, vUv);
          // desfoque em disco (2 anéis × 12 amostras)
          vec2 px = blurPx / resolution;
          vec4 acc = sharp;
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 0.5235988 + 0.26;
            vec2 d = vec2(cos(a), sin(a));
            acc += texture2D(tVm, vUv + d * px);
            acc += texture2D(tVm, vUv + d * px * 0.5);
          }
          vec4 blurred = acc / 25.0;
          // nítido no centro (massa de mira), desfocando para fora
          float dist = length((vUv - 0.5) * resolution);
          float m = smoothstep(sharpRadius, sharpRadius + feather, dist);
          vec4 c = mix(sharp, blurred, m);
          // a textura é pré-multiplicada (fundo transparente = 0)
          gl_FragColor = vec4(c.a > 0.0 ? c.rgb / c.a : vec3(0.0), c.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb *= gl_FragColor.a;
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
  }

  /**
   * Desenha o viewmodel com foco. `amount` 0..1 (0 = sem efeito, o chamador deve
   * desenhar direto). Raio nítido e desfoque escalam com a altura da imagem.
   * `output`: onde compor (padrão: a tela; no pós-processamento, o alvo HDR).
   */
  render(scene: THREE.Scene, camera: THREE.Camera, amount: number, output: THREE.WebGLRenderTarget | null = null): void {
    const r = this.renderer;
    const h = this.target.height;
    const u = this.material.uniforms;
    u.blurPx.value = amount * h * 0.0042;
    u.sharpRadius.value = h * 0.011;
    u.feather.value = h * 0.05;

    r.getClearColor(this.clear);
    const alpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    // (num alvo HDR o three.js não aplica a curva de filme nem sRGB: a cor segue linear)
    r.setRenderTarget(output);
    r.setClearColor(this.clear, alpha);
    r.render(this.scene, this.camera);
  }
}
