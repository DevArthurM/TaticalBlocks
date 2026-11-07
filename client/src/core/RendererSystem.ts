import * as THREE from 'three';
import { CAMERA, VIEWMODEL, WORLD_COLORS } from '../config/constants';

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

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(WORLD_COLORS.sky);
    this.scene.fog = new THREE.Fog(WORLD_COLORS.sky, WORLD_COLORS.fogNear, WORLD_COLORS.fogFar);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.viewmodelCamera = new THREE.PerspectiveCamera(VIEWMODEL.fov, aspect, 0.01, 10);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
  }

  private readonly resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    for (const cam of [this.camera, this.viewmodelCamera]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  };
}
