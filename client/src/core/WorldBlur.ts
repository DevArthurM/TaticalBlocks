import * as THREE from 'three';

/**
 * Fundo desfocado (personalização da arma): desenha o mundo numa textura e a
 * compõe na tela com desfoque em disco e um escurecimento nas bordas — o foco
 * fica todo na arma, desenhada nítida por cima.
 */
export class WorldBlur {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        resolution: { value: new THREE.Vector2(1, 1) },
        blurPx: { value: 0 },
        dim: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 resolution;
        uniform float blurPx;
        uniform float dim;
        varying vec2 vUv;
        void main() {
          vec2 px = blurPx / resolution;
          vec4 acc = texture2D(tScene, vUv);
          // desfoque em disco: 3 anéis × 12 amostras
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 0.5235988 + 0.13;
            vec2 d = vec2(cos(a), sin(a));
            acc += texture2D(tScene, vUv + d * px);
            acc += texture2D(tScene, vUv + d * px * 0.66 + d.yx * px * 0.12);
            acc += texture2D(tScene, vUv + d * px * 0.33);
          }
          vec4 c = acc / 37.0;
          // escurece um pouco e mais nas bordas: o olho vai para a arma
          float v = smoothstep(0.25, 0.95, length((vUv - 0.5) * vec2(1.4, 1.0)));
          c.rgb *= 1.0 - dim * (0.18 + 0.45 * v);
          gl_FragColor = vec4(c.rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
  }

  /** Desenha o mundo desfocado (`amount` 0..1) direto na tela. */
  render(scene: THREE.Scene, camera: THREE.Camera, amount: number): void {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    const h = this.material.uniforms.resolution.value.y;
    this.material.uniforms.blurPx.value = amount * h * 0.012;
    this.material.uniforms.dim.value = amount;
    r.render(this.scene, this.camera);
  }
}
