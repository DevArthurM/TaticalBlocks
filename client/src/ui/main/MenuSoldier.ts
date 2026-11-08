import { FLAG, type PlayerState, type TeamId } from '@shared/net/protocol';
import type { WeaponDef } from '@shared/weapons/types';
import * as THREE from 'three';
import { RemotePlayer } from '../../online/avatar/RemotePlayer';
import { PhysicsWorld } from '../../physics/PhysicsWorld';

/** Enquadramento: câmera levemente abaixo do rosto, os três soldados de corpo inteiro. */
const CAMERA = { fov: 30, pos: new THREE.Vector3(0.4, 1.12, -4.7), target: new THREE.Vector3(0, 0.98, 0.3) };

/** Quanto a câmera sobe (m) por unidade de zoom acima de 1. */
const ZOOM_LIFT = 0.75;

/** Um soldado da vitrine: arma e uniforme. */
export interface SquadMember {
  weapon: WeaponDef;
  team: TeamId;
}

/** Posição (x, z: + = atrás) e giro de cada um: o principal no meio, os outros dois atrás e virados para fora. */
const SLOTS = [
  { x: 0, z: 0, yaw: -0.3 },
  { x: 0.95, z: 0.75, yaw: -0.75 },
  { x: -0.95, z: 0.75, yaw: 0.2 },
];

/**
 * Vitrine do menu principal: três soldados do jogo (mesmo modelo do online) parados,
 * respirando, cada um com uma arma sorteada a cada carregamento da página — o
 * principal no meio, dois atrás dele. Renderizador próprio (só existe com o menu aberto).
 */
export class MenuSoldier {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 30);
  private readonly squad: { player: RemotePlayer; turntable: THREE.Group; yaw: number; phase: number }[] = [];
  private readonly resize: ResizeObserver;
  private raf = 0;
  private last = 0;
  private time = 0;
  private mouseX = 0;
  private lookX = 0;
  private width = 1;
  private height = 1;
  /** Onde (fração da largura) fica o centro do esquadrão: alvo e valor atual (animado). */
  private centerTarget = 0.5;
  private center = 0.5;
  /** Aproximação da câmera (1 = normal): alvo e valor atual (animado). */
  private zoomTarget = 1;
  private zoom = 1;
  private baseFov: number = CAMERA.fov;
  private readonly lookAt = new THREE.Vector3();

  /** Aproxima (zoom > 1) ou afasta a câmera, animado. */
  setZoom(zoom: number, instant = false): void {
    this.zoomTarget = zoom;
    if (instant) this.zoom = zoom;
  }

  /**
   * Leva o esquadrão para a fração `x` da largura da tela (0 = esquerda, 1 = direita),
   * deslizando a câmera. `instant` pula a animação.
   */
  setCenter(x: number, instant = false): void {
    this.centerTarget = x;
    if (instant) this.center = x;
  }

  constructor(
    private readonly host: HTMLElement,
    members: readonly SquadMember[],
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'mm-soldier-canvas';
    host.appendChild(this.renderer.domElement);

    this.setupLights();
    const physics = new PhysicsWorld();
    members.slice(0, SLOTS.length).forEach((m, i) => {
      const slot = SLOTS[i];
      const turntable = new THREE.Group();
      turntable.position.set(slot.x, 0, slot.z);
      this.scene.add(turntable);
      turntable.add(this.floor());
      // o mesmo avatar dos outros jogadores no online
      const player = new RemotePlayer(this.scene, physics, {
        id: `menu-${i}-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        team: m.team,
        kills: 0,
        deaths: 0,
        alive: true,
        hp: 100,
      });
      const root = player.soldier.bones.root;
      turntable.add(root);
      // no jogo o avatar é desenhado por instâncias; aqui as malhas aparecem direto
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.visible = true;
          o.castShadow = true;
        }
      });
      // "correndo" parado: pose baixa (arma atravessada no peito), como na referência
      const state: PlayerState = { p: [0, 0, 0], v: [0, 0, 0], yaw: 0, pitch: -0.05, lean: 0, crouch: 0, flags: FLAG.ground | FLAG.sprint, weapon: m.weapon.id };
      player.push(0, state);
      player.push(1, state);
      this.squad.push({ player, turntable, yaw: slot.yaw, phase: i * 2.1 });
    });

    this.camera.position.copy(CAMERA.pos);
    this.camera.lookAt(CAMERA.target);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    window.addEventListener('mousemove', this.onMouse);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    window.removeEventListener('mousemove', this.onMouse);
    for (const m of this.squad) m.player.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private setupLights(): void {
    // luz de estúdio: ambiente frio fraco, principal quente de cima/frente e contorno azul por trás
    this.scene.add(new THREE.HemisphereLight(0x8fa4c8, 0x14161c, 0.55));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(1.6, 3.2, -2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.8, bottom: -1, near: 0.5, far: 10 });
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb0ff, 2.2);
    rim.position.set(-1.8, 2.2, 2.4);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xc8f560, 0.35); // toque da cor de destaque da interface
    fill.position.set(2.5, 0.6, 0.5);
    this.scene.add(fill);
  }

  /** Disco escuro sob os pés (some nas bordas) + plano que só recebe a sombra. */
  private floor(): THREE.Group {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const group = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShadowMaterial({ opacity: 0.35 }));
    shadow.receiveShadow = true;
    for (const [m, y] of [[disc, 0.001], [shadow, 0.002]] as const) {
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      group.add(m);
    }
    return group;
  }

  private fit(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // tela estreita: afasta a câmera para o corpo inteiro caber
    this.baseFov = CAMERA.fov * Math.max(1, 0.75 / this.camera.aspect);
    this.applyFov();
  }

  /** FOV com o zoom: fov menor = mais perto (tan da metade do ângulo dividida pelo zoom). */
  private applyFov(): void {
    const half = THREE.MathUtils.degToRad(this.baseFov / 2);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / this.zoom));
    this.camera.updateProjectionMatrix();
  }

  private readonly onMouse = (e: MouseEvent): void => {
    this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
  };

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    this.time += dt;
    // gira devagar de um lado para o outro e acompanha um pouco o mouse
    this.lookX += (this.mouseX - this.lookX) * Math.min(1, dt * 3);
    // desliza a câmera de lado (sem girar): o esquadrão vai para `center` da tela
    this.center += (this.centerTarget - this.center) * Math.min(1, dt * 5);
    if (Math.abs(this.zoomTarget - this.zoom) > 1e-4) {
      this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 4);
      // aproximando, mira mais alto (tronco e rosto em vez da cintura)
      this.lookAt.copy(CAMERA.target).setY(CAMERA.target.y + (this.zoom - 1) * ZOOM_LIFT);
      this.camera.position.copy(CAMERA.pos).setY(CAMERA.pos.y + (this.zoom - 1) * ZOOM_LIFT);
      this.camera.lookAt(this.lookAt);
      this.applyFov();
    }
    const shift = (0.5 - this.center) * this.width;
    if (Math.abs(shift) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, shift, 0, this.width, this.height);
    for (const m of this.squad) {
      // cada um no seu ângulo, oscilando pouco e fora de fase; todos acompanham um pouco o mouse
      m.turntable.rotation.y = m.yaw + Math.sin(this.time * 0.35 + m.phase) * 0.1 + this.lookX * 0.15;
      m.player.update(dt, 1);
      // a pose de corrida inclina o tronco para a frente: aqui fica ereto
      m.player.soldier.bones.waist.rotation.x = 0;
    }
    this.renderer.render(this.scene, this.camera);
  };
}
