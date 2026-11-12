import * as THREE from 'three';
import {
  AO_BLUR_FRAG,
  AO_FRAG,
  BLOOM_DOWN_FRAG,
  BLOOM_PREFILTER_FRAG,
  BLOOM_UP_FRAG,
  COMPOSITE_FRAG,
  FINAL_FRAG,
  FULLSCREEN_VERT,
  FXAA_FRAG,
  RAYS_FRAG,
} from './shaders';

export type AntialiasMode = 'off' | 'fxaa' | 'msaa';

export interface PostOptions {
  /** Oclusão de ambiente: 0 = desligada, 1 = 8 amostras, 2 = 16 amostras. */
  ao: 0 | 1 | 2;
  bloom: boolean;
  godRays: boolean;
  antialias: AntialiasMode;
}

/** Sol e névoa usados pela composição (vêm do ambiente do mapa). */
export interface Atmosphere {
  /** Direção do mundo que aponta PARA o sol. */
  sunDir: THREE.Vector3;
  /** Cor da luz do sol espalhada no ar (névoa e raios). */
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  /** Densidade da névoa ao nível do chão (1/m). */
  fogDensity: number;
  /** Quão rápido a névoa rareia com a altura (1/m). */
  fogFalloff: number;
}

const BLOOM_LEVELS = 5;
const tex = (v: THREE.Texture | null = null) => ({ value: v });

/**
 * Pós-processamento em HDR ("shaders"): o mundo é desenhado numa textura com
 * profundidade e passa por oclusão de ambiente → raios de sol → composição com
 * névoa volumétrica → (arma por cima) → bloom → gradação/curva de filme → FXAA.
 */
export class PostFX {
  private options: PostOptions = { ao: 0, bloom: true, godRays: false, antialias: 'fxaa' };
  private width = 1;
  private height = 1;

  private sceneRT!: THREE.WebGLRenderTarget;
  private compRT!: THREE.WebGLRenderTarget;
  private readonly aoRT = PostFX.target(THREE.UnsignedByteType);
  private readonly aoBlurRT = PostFX.target(THREE.UnsignedByteType);
  private readonly raysRT = PostFX.target(THREE.UnsignedByteType);
  private readonly ldrRT = PostFX.target(THREE.UnsignedByteType);
  private readonly bloomRT = Array.from({ length: BLOOM_LEVELS }, () => PostFX.target(THREE.HalfFloatType));

  private readonly fsScene = new THREE.Scene();
  private readonly fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;

  private readonly ao = this.material(AO_FRAG, {
    tDepth: tex(),
    uInvProj: { value: new THREE.Matrix4() },
    uProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() },
    uRadius: { value: 0.55 },
  });
  private readonly aoBlur = this.material(AO_BLUR_FRAG, {
    tDepth: tex(),
    tAO: tex(),
    uInvProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() },
  });
  private readonly rays = this.material(RAYS_FRAG, {
    tDepth: tex(),
    uSunUv: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
  });
  private readonly composite = this.material(COMPOSITE_FRAG, {
    tScene: tex(),
    tDepth: tex(),
    tAO: tex(),
    tRays: tex(),
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uFogColor: { value: new THREE.Color(1, 1, 1) },
    uFogDensity: { value: 0 },
    uFogFalloff: { value: 0.1 },
    uAoOn: { value: 0 },
    uRaysOn: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uBlurPx: { value: 0 },
    uDim: { value: 0 },
  });
  private readonly bloomPrefilter = this.material(BLOOM_PREFILTER_FRAG, {
    tColor: tex(),
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: 1.15 },
  });
  private readonly bloomDown = this.material(BLOOM_DOWN_FRAG, { tColor: tex(), uTexel: { value: new THREE.Vector2() } });
  private readonly bloomUp = this.material(BLOOM_UP_FRAG, { tColor: tex(), uTexel: { value: new THREE.Vector2() } });
  private readonly final = this.material(FINAL_FRAG, {
    tColor: tex(),
    tBloom: tex(),
    uBloom: { value: 0 },
    uExposure: { value: 1 },
  });
  private readonly fxaa = this.material(FXAA_FRAG, { tColor: tex(), uTexel: { value: new THREE.Vector2() } });

  private readonly sunView = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  /** Intensidade do bloom e exposição da imagem final. */
  bloomStrength = 0.42;
  /** (a curva ACES do three.js embute ×1/0,6: mantém o mesmo brilho do modo sem shaders) */
  exposure = 1.32;
  /** Força dos raios de sol. */
  rayStrength = 0.16;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo, this.final);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
    // a soma dos níveis do bloom é feita com mistura aditiva
    this.bloomUp.blending = THREE.AdditiveBlending;
    this.bloomUp.transparent = true;
    this.ao.defines = { AO_SAMPLES: 8 };
    this.rays.defines = { RAY_SAMPLES: 28 };
    this.buildSceneTargets();
  }

  configure(o: PostOptions): void {
    const msaaChanged = (o.antialias === 'msaa') !== (this.options.antialias === 'msaa');
    this.options = { ...o };
    const samples = o.ao === 2 ? 16 : 8;
    if (this.ao.defines.AO_SAMPLES !== samples) {
      this.ao.defines.AO_SAMPLES = samples;
      this.ao.needsUpdate = true;
    }
    if (msaaChanged) this.buildSceneTargets();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(2, width);
    this.height = Math.max(2, height);
    const w = this.width;
    const h = this.height;
    this.sceneRT.setSize(w, h);
    this.compRT.setSize(w, h);
    this.ldrRT.setSize(w, h);
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    for (const rt of [this.aoRT, this.aoBlurRT, this.raysRT]) rt.setSize(hw, hh);
    this.bloomRT.forEach((rt, i) => rt.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
  }

  /**
   * Desenha um quadro. `drawViewmodel` desenha braços/arma por cima do mundo já
   * composto (no alvo recebido, com a profundidade limpa).
   */
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    atmosphere: Atmosphere,
    worldBlur: number,
    drawViewmodel: (target: THREE.WebGLRenderTarget) => void,
  ): void {
    const r = this.renderer;
    const o = this.options;
    const depth = this.sceneRT.depthTexture!;

    // 1) mundo em HDR + profundidade
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2) oclusão de ambiente (metade da resolução)
    if (o.ao > 0) {
      const u = this.ao.uniforms;
      u.tDepth.value = depth;
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uProj.value.copy(camera.projectionMatrix);
      u.uTexel.value.set(1 / this.width, 1 / this.height);
      this.pass(this.ao, this.aoRT);
      const b = this.aoBlur.uniforms;
      b.tDepth.value = depth;
      b.tAO.value = this.aoRT.texture;
      b.uInvProj.value.copy(camera.projectionMatrixInverse);
      b.uTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
      this.pass(this.aoBlur, this.aoBlurRT);
    }

    // 3) raios de sol: só com o sol na frente da câmera (some aos poucos ao virar)
    camera.getWorldDirection(this.forward);
    const facing = this.forward.dot(atmosphere.sunDir);
    const rayAmount = o.godRays ? THREE.MathUtils.smoothstep(facing, 0.05, 0.55) * this.rayStrength : 0;
    if (rayAmount > 0) {
      this.sunView.copy(camera.position).addScaledVector(atmosphere.sunDir, 100).project(camera);
      const u = this.rays.uniforms;
      u.tDepth.value = depth;
      u.uSunUv.value.set(this.sunView.x * 0.5 + 0.5, this.sunView.y * 0.5 + 0.5);
      u.uAspect.value = this.width / this.height;
      this.pass(this.rays, this.raysRT);
    }

    // 4) composição: oclusão + névoa + raios (+ desfoque do menu T)
    const c = this.composite.uniforms;
    c.tScene.value = this.sceneRT.texture;
    c.tDepth.value = depth;
    c.tAO.value = this.aoBlurRT.texture;
    c.tRays.value = this.raysRT.texture;
    c.uInvProj.value.copy(camera.projectionMatrixInverse);
    c.uCamWorld.value.copy(camera.matrixWorld);
    c.uCamPos.value.copy(camera.position);
    c.uSunDir.value.copy(atmosphere.sunDir);
    c.uSunColor.value.copy(atmosphere.sunColor);
    c.uFogColor.value.copy(atmosphere.fogColor);
    c.uFogDensity.value = atmosphere.fogDensity;
    c.uFogFalloff.value = atmosphere.fogFalloff;
    c.uAoOn.value = o.ao > 0 ? 1 : 0;
    c.uRaysOn.value = rayAmount;
    c.uResolution.value.set(this.width, this.height);
    c.uBlurPx.value = worldBlur > 0.01 ? worldBlur * this.height * 0.012 : 0;
    c.uDim.value = worldBlur > 0.01 ? worldBlur : 0;
    this.pass(this.composite, this.compRT);

    // 5) braços e arma por cima (profundidade própria)
    r.clearDepth();
    drawViewmodel(this.compRT);

    // 6) bloom: pirâmide de reduções e ampliações somadas
    if (o.bloom) {
      const levels = this.bloomRT;
      this.bloomPrefilter.uniforms.tColor.value = this.compRT.texture;
      this.bloomPrefilter.uniforms.uTexel.value.set(0.5 / this.width, 0.5 / this.height);
      this.pass(this.bloomPrefilter, levels[0]);
      for (let i = 1; i < levels.length; i++) {
        this.bloomDown.uniforms.tColor.value = levels[i - 1].texture;
        this.bloomDown.uniforms.uTexel.value.set(0.5 / levels[i - 1].width, 0.5 / levels[i - 1].height);
        this.pass(this.bloomDown, levels[i]);
      }
      for (let i = levels.length - 1; i > 0; i--) {
        this.bloomUp.uniforms.tColor.value = levels[i].texture;
        this.bloomUp.uniforms.uTexel.value.set(1 / levels[i].width, 1 / levels[i].height);
        this.pass(this.bloomUp, levels[i - 1]);
      }
    }

    // 7) imagem final (+ FXAA)
    const f = this.final.uniforms;
    f.tColor.value = this.compRT.texture;
    f.tBloom.value = this.bloomRT[0].texture;
    f.uBloom.value = o.bloom ? this.bloomStrength / BLOOM_LEVELS : 0;
    f.uExposure.value = this.exposure;
    if (o.antialias === 'fxaa') {
      this.pass(this.final, this.ldrRT);
      this.fxaa.uniforms.tColor.value = this.ldrRT.texture;
      this.fxaa.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      this.pass(this.fxaa, null);
    } else this.pass(this.final, null);
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCamera);
  }

  /** Alvos do mundo e da composição: recriados quando o MSAA liga/desliga. */
  private buildSceneTargets(): void {
    this.sceneRT?.dispose();
    this.compRT?.dispose();
    const samples = this.options.antialias === 'msaa' ? 4 : 0;
    this.sceneRT = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      samples,
      depthTexture: new THREE.DepthTexture(this.width, this.height),
    });
    this.compRT = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples, depthBuffer: true });
  }

  private material(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  private static target(type: THREE.TextureDataType): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false });
  }
}
