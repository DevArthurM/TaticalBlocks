import * as THREE from 'three';
import { CAMERA, VIEWMODEL, WORLD_COLORS } from '../config/constants';
import { ViewmodelFocus } from './ViewmodelFocus';
import { WorldBlur } from './WorldBlur';

/** Limites e passos da resolução dinâmica. */
const DYN_MIN = 0.6;
const DYN_STEP_DOWN = 0.1;
const DYN_STEP_UP = 0.05;

/**
 * Renderiza duas cenas: o mundo e o viewmodel (braços + arma) por cima,
 * com o depth limpo para a arma nunca atravessar paredes.
 */
export class RendererSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly viewmodelScene = new THREE.Scene();
  readonly viewmodelCamera: THREE.PerspectiveCamera;
  /** 0..1 — desfoque da arma ao mirar (massa de mira nítida). */
  focus = 0;
  /** Chamado depois de atualizar as matrizes de mundo e antes de desenhar (ex.: instâncias). */
  beforeRender: () => void = () => {};
  private readonly vmFocus: ViewmodelFocus;
  /** 0..1 — fundo desfocado (personalização da arma). */
  worldBlur = 0;
  private readonly worldBlurPass: WorldBlur;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    // as matrizes de mundo são atualizadas uma vez por quadro em render()
    this.scene.matrixWorldAutoUpdate = false;

    this.scene.background = new THREE.Color(WORLD_COLORS.sky);
    this.scene.fog = new THREE.Fog(WORLD_COLORS.sky, WORLD_COLORS.fogNear, WORLD_COLORS.fogFar);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.viewmodelCamera = new THREE.PerspectiveCamera(VIEWMODEL.fov, aspect, 0.01, 10);
    this.vmFocus = new ViewmodelFocus(this.renderer);
    this.worldBlurPass = new WorldBlur(this.renderer);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  private renderScale = 1;
  /** Fator automático da resolução dinâmica (multiplica a escala escolhida). */
  private dynamicScale = 1;
  private dynamicEnabled = true;
  private readonly dyn = { avg: 1 / 60, cooldown: 2, goodFor: 0, ceiling: 1, ceilingAge: 0, lastRaise: -99, clock: 0 };

  /** Escala de resolução (1 = nativo, até 2× em telas de alta densidade). */
  setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.applyPixelRatio();
  }

  /** Liga/desliga a resolução dinâmica (volta à escala escolhida ao desligar). */
  setDynamicResolution(enabled: boolean): void {
    this.dynamicEnabled = enabled;
    if (!enabled && this.dynamicScale !== 1) {
      this.dynamicScale = 1;
      this.applyPixelRatio();
    }
  }

  /** Fator atual da resolução dinâmica (1 = sem redução). */
  get dynamicResolution(): number {
    return this.dynamicScale;
  }

  /**
   * Resolução dinâmica: mede o tempo entre quadros e reduz os pixels quando o jogo
   * cai abaixo de ~50 FPS; volta a subir aos poucos quando sobra folga. Se subir
   * logo causar nova queda, aquele nível vira teto por um tempo (evita ficar oscilando).
   */
  adaptResolution(frameDt: number): void {
    if (!this.dynamicEnabled) return;
    const d = this.dyn;
    d.clock += frameDt;
    // ignora travadas isoladas (troca de aba, carregamento)
    if (frameDt > 0.25) return;
    d.avg += (frameDt - d.avg) * 0.08;
    d.cooldown -= frameDt;
    d.ceilingAge += frameDt;
    if (d.ceilingAge > 30) d.ceiling = 1;
    if (d.cooldown > 0) return;
    if (d.avg > 1 / 50 && this.dynamicScale > DYN_MIN) {
      // caiu logo depois de subir: esse nível não se sustenta
      if (d.clock - d.lastRaise < 5) {
        d.ceiling = this.dynamicScale - DYN_STEP_UP;
        d.ceilingAge = 0;
      }
      this.dynamicScale = Math.max(DYN_MIN, this.dynamicScale - DYN_STEP_DOWN);
      this.applyPixelRatio();
      d.cooldown = 1;
      d.goodFor = 0;
    } else if (d.avg < 1 / 57) {
      d.goodFor += frameDt;
      const next = Math.min(1, d.ceiling, this.dynamicScale + DYN_STEP_UP);
      if (d.goodFor > 3 && next > this.dynamicScale + 1e-3) {
        this.dynamicScale = next;
        this.applyPixelRatio();
        d.cooldown = 1;
        d.goodFor = 0;
        d.lastRaise = d.clock;
      }
    } else d.goodFor = 0;
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale * this.dynamicScale);
    this.resize();
  }

  /**
   * Compila os shaders de todas as cenas antes de jogar, para o primeiro tiro,
   * explosão ou zumbi não travar o jogo enquanto a GPU compila.
   */
  async warmUp(): Promise<void> {
    // objetos escondidos (clarão do tiro etc.) também precisam do shader pronto
    const hidden: THREE.Object3D[] = [];
    for (const scene of [this.scene, this.viewmodelScene])
      scene.traverse((o) => {
        if (!o.visible) {
          o.visible = true;
          hidden.push(o);
        }
      });
    let pending: Promise<unknown>;
    try {
      // compileAsync coleta os materiais na hora da chamada; depois só espera a GPU
      pending = Promise.all([
        this.renderer.compileAsync(this.scene, this.camera),
        this.renderer.compileAsync(this.viewmodelScene, this.viewmodelCamera),
      ]);
    } finally {
      for (const o of hidden) o.visible = false;
    }
    await pending;
    // um quadro desenhado também prepara mapa de sombra e texturas na GPU
    this.render();
  }

  /** Liga/desliga sombras e define a resolução do mapa de sombra do sol. */
  setShadows(sun: THREE.DirectionalLight, mapSize: number): void {
    const enabled = mapSize > 0;
    const wasEnabled = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = enabled;
    sun.castShadow = enabled;
    if (enabled && sun.shadow.mapSize.x !== mapSize) {
      sun.shadow.mapSize.set(mapSize, mapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    // os shaders mudam quando as sombras ligam/desligam
    if (wasEnabled !== enabled) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
  }

  /**
   * FOV da câmera dos braços/arma acompanhando o FOV escolhido pelo jogador,
   * na mesma proporção de tela (escala pela tangente do meio-ângulo).
   */
  setViewmodelFovFor(baseFov: number): void {
    const half = (deg: number) => Math.tan(THREE.MathUtils.degToRad(deg / 2));
    const vm = 2 * THREE.MathUtils.radToDeg(Math.atan((half(VIEWMODEL.fov) * half(baseFov)) / half(CAMERA.fov)));
    if (Math.abs(this.viewmodelCamera.fov - vm) < 0.01) return;
    this.viewmodelCamera.fov = vm;
    this.viewmodelCamera.updateProjectionMatrix();
  }

  setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.scene.updateMatrixWorld();
    this.beforeRender();
    this.renderer.clear();
    if (this.worldBlur > 0.01) this.worldBlurPass.render(this.scene, this.camera, this.worldBlur);
    else this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    if (this.focus > 0.01) this.vmFocus.render(this.viewmodelScene, this.viewmodelCamera, this.focus);
    else this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
  }

  private readonly resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.vmFocus?.setSize(size.x, size.y);
    this.worldBlurPass?.setSize(size.x, size.y);
    for (const cam of [this.camera, this.viewmodelCamera]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  };
}
