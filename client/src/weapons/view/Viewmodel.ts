import type { ShellType, WeaponDef } from '@shared/weapons/types';
import * as THREE from 'three';
import { clamp, damp, lerp } from '../../core/math';
import { Follow, Spring } from '../../core/Spring';
import type { SoundName } from '../../audio/SoundEngine';
import { HOLSTER_CLIP } from '../animation/actions';
import { addSample6, type Clip, type Cue, type HandValue, type Key, type Vec6, isVisible, segment } from '../animation/Clip';
import type { AttachmentSlot, WeaponAttachments } from '@shared/weapons/attachments';
import { applyAttachments } from '../models/attachments';
import { buildWeaponModel } from '../models/registry';
import type { AnchorName, PartName, WeaponModel } from '../models/types';
import { ArmModel } from './ArmModel';
import { createArmMaterials } from './materials';
import { MuzzleFlash } from './MuzzleFlash';
import { ShellEjector } from './ShellEjector';

export interface ViewmodelFrame {
  dt: number;
  time: number;
  moveSpeed: number;
  /** Velocidade lateral do jogador em m/s (+ = andando para a direita). */
  strafe: number;
  /** Velocidade para a frente em m/s (+ = frente, − = ré). */
  forward: number;
  sprinting: boolean;
  /** 0..1 — deslizando. */
  slide?: number;
  /** Velocidade vertical do jogador em m/s (+ = subindo): a arma atrasa no pulo e na queda. */
  vertical?: number;
  /** 0..1 — agachado: a arma afunda ao descer e levanta ao subir. */
  crouch?: number;
  /** 0..1 — modo de personalização (T): arma na frente da câmera. */
  customize?: number;
  onGround: boolean;
  adsT: number;
  lookDX: number;
  lookDY: number;
  landingImpact: number;
  /** Clipe de recarga atual e seu tempo normalizado. */
  reload: { clip: Clip; t: number; key: string; fromEmpty: boolean } | null;
  /** Mãos apoiadas numa quina (espaço da câmera) — escalada. */
  ledge: { left: THREE.Vector3; right: THREE.Vector3 } | null;
  /** Desvio do braço pela tensão do recuo (rad; + = cima / esquerda). */
  armPitch: number;
  armYaw: number;
  ammo: number;
  /** Rotação dos canos (minigun), 0..1. */
  spin: number;
  /** Esconde o viewmodel (luneta). */
  hidden: boolean;
}

interface ActionPlayback {
  clip: Clip;
  time: number;
  duration: number;
  prevT: number;
}

const SHOULDER_R = new THREE.Vector3(0.3, -0.55, 0.12);
const SHOULDER_L = new THREE.Vector3(-0.32, -0.55, 0.1);
/** Cotovelos apontam para baixo e para fora do corpo. */
const ELBOW_R = new THREE.Vector3(0.75, -1, 0.15).normalize();
const ELBOW_L = new THREE.Vector3(-0.75, -1, 0.15).normalize();
const FIXED_TARGETS: Record<'rest' | 'low' | 'lowRight', { left: THREE.Vector3; right: THREE.Vector3 }> = {
  rest: { left: new THREE.Vector3(-0.3, -0.55, -0.05), right: new THREE.Vector3(0.3, -0.55, -0.05) },
  low: { left: new THREE.Vector3(-0.1, -0.3, -0.25), right: new THREE.Vector3(0.12, -0.3, -0.25) },
  lowRight: { left: new THREE.Vector3(0.02, -0.3, -0.25), right: new THREE.Vector3(0.12, -0.3, -0.25) },
};

const SPRINT_OFFSET = { pos: new THREE.Vector3(-0.05, -0.045, 0.03), rot: new THREE.Vector3(-0.45, 0.6, 0.28) };
/** Mola da inércia lateral (andar de lado). */
/** Eixo da visada no espaço da câmera dos braços (a câmera olha para −Z). */
const SIGHT_AXIS = new THREE.Vector3(0, 0, 1);
/** Rolagem (rad) por unidade de inércia lateral. */
const STRAFE_ROLL = 0.2;

const STRAFE_SPRING = {
  hip: { stiffness: 70, damping: 11 },
  /** ζ = 1,1 → sem oscilação; ω ≈ 4,5 rad/s → resposta em ~0,5 s. */
  ads: { stiffness: 20, damping: 2 * Math.sqrt(20) * 1.1 },
} as const;
const SLIDE_BACK_TIME = 0.035;
/** Tempo máximo para abaixar a arma antiga antes de sacar a nova. */
const HOLSTER_TIME = 0.12;

/**
 * Tranco padrão de cada som de manejo (pico do deslocamento [px,py,pz,rx,ry,rz]):
 * a arma reage a cada contato — pente batendo, ferrolho fechando, telha indo e vindo.
 * +z = para trás (em direção à câmera), +rx = cano sobe, +rz = rola para a esquerda.
 */
const CUE_KICKS: Partial<Record<SoundName, Vec6>> = {
  magOut: [0, 0.004, 0, 0.018, 0, -0.025],
  magIn: [0, 0.015, 0.003, -0.05, 0, 0.035],
  slideBack: [0, 0.002, 0.012, 0.045, 0, 0.02],
  chargeBack: [0, 0.002, 0.012, 0.035, 0.01, 0.025],
  slideRelease: [0, -0.002, -0.012, -0.04, 0, -0.025],
  chargeRelease: [0, -0.002, -0.013, -0.035, -0.01, -0.03],
  pumpBack: [0, -0.003, 0.016, 0.035, 0, 0.02],
  pumpForward: [0, 0.002, -0.016, -0.035, 0, -0.02],
  boltUp: [0, 0.003, 0, 0.01, 0, 0.05],
  boltBack: [0, 0, 0.012, 0.03, 0.015, 0],
  boltForward: [0, 0, -0.012, -0.025, -0.01, 0],
  boltDown: [0, -0.003, 0, -0.01, 0, -0.055],
  shellInsert: [0, 0.005, -0.004, -0.022, 0, 0.018],
  cylinderOpen: [-0.006, 0, 0, 0, 0.02, 0.06],
  cylinderClose: [0.008, 0, 0, 0, -0.02, -0.07],
  coverOpen: [0, 0.004, 0.004, 0.035, 0, 0],
  coverClose: [0, -0.012, 0, -0.055, 0, 0],
  beltIn: [0, -0.004, 0, -0.015, 0, 0.02],
  rocketLoad: [0, 0, 0.016, 0.04, 0, 0],
};

/** Quanto cada categoria reage aos trancos (arma leve sacode mais). */
const KICK_SCALE: Record<string, number> = { pistol: 1.25, smg: 1, rifle: 0.9, shotgun: 0.95, sniper: 0.8, heavy: 0.6, melee: 1, throwable: 1 };
const SLIDE_RETURN_TIME = 0.07;

/** Braços + arma em primeira pessoa e toda a mistura de animações procedurais e por clipes. */
export class Viewmodel {
  /** Chamado quando um clipe atinge uma marca de som/evento. */
  onCue: (cue: Cue) => void = () => {};

  private readonly root = new THREE.Group();
  private readonly poseGroup = new THREE.Group();
  private readonly rightArm: ArmModel;
  private readonly leftArm: ArmModel;
  private readonly flash = new MuzzleFlash();
  private readonly shells: ShellEjector;
  private readonly cache = new Map<
    string,
    { model: WeaponModel; ads: THREE.Vector3; show: { pos: THREE.Vector3; rot: THREE.Euler }; defaultVis: Map<THREE.Object3D, boolean> }
  >();

  /** Acessórios escolhidos por arma (o modelo é refeito ao trocar). */
  private readonly attachments = new Map<string, WeaponAttachments>();

  private current: {
    def: WeaponDef;
    model: WeaponModel;
    ads: THREE.Vector3;
    /** Pose de vitrine (personalização). */
    show: { pos: THREE.Vector3; rot: THREE.Euler };
    defaultVis: Map<THREE.Object3D, boolean>;
    /** Encaixe fixo dos braços relativo à arma (modo `rigidHands`). */
    grip?: { right: THREE.Matrix4; left: THREE.Matrix4 };
  } | null = null;
  private action: ActionPlayback | null = null;
  /** Arma nova esperando a antiga terminar de ser abaixada. */
  private pending: { def: WeaponDef | null; drawClip: Clip; drawTime: number } | null = null;
  private reloadPrev = { key: '', t: 0 };
  private modelHidden = false;

  private readonly recoilPos = new Spring(320, 26);
  private readonly recoilRot = new Spring(260, 20);
  private readonly landing = new Spring(180, 14);
  /** Rolagem e desvio lateral aleatórios de cada tiro (a arma não recua sempre igual). */
  private readonly recoilRoll = new Spring(200, 14);
  private readonly recoilSide = new Spring(220, 17);
  /** Mola de 6 eixos dos trancos de manejo (marcas dos clipes). */
  private readonly jolt = [0, 1, 2, 3, 4, 5].map((i) => (i < 3 ? new Spring(260, 19) : new Spring(230, 16)));
  /** Pose de corrida com ultrapassagem (o peso `sprintT` continua suave). */
  private readonly sprintPose = new Follow(11, 0.62);
  /** Arma atrasada em relação ao corpo no pulo/queda. */
  private readonly air = new Follow(9, 0.7);
  private readonly swayXF = new Follow(15, 0.55);
  private readonly swayYF = new Follow(15, 0.55);
  private prevCrouch = 0;
  private prevAds = 0;
  private sprintT = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private swayX = 0;
  private swayY = 0;
  /** Inércia lateral (mola de 2ª ordem: atrasa, passa um pouco do ponto e assenta). */
  private strafeX = 0;
  private strafeV = 0;
  /**
   * Rolagem em torno do eixo da visada (a reta da câmera que passa pela alça e
   * pela massa): o balanço do movimento gira braços/arma ao redor da mira, que
   * fica sempre no centro.
   */
  private sightRoll = 0;
  private readonly rollQ = new THREE.Quaternion();
  private slideTimer = 1;
  private slideLocked = false;
  private barrelAngle = 0;

  private readonly pose = [0, 0, 0, 0, 0, 0];
  private readonly partOffsets = new Map<PartName, number[]>();
  private readonly pos = new THREE.Vector3();
  private readonly rot = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpE = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  /** 0..1 — mãos na quina (escalada). */
  private ledgeT = 0;
  private readonly ledgeL = new THREE.Vector3();
  private readonly ledgeR = new THREE.Vector3();
  /** 0 = mão esquerda presa à arma, 1 = livre (recarga). */
  private leftFree = 0;
  private readonly leftTarget = new THREE.Vector3();
  private readonly rightTarget = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.setupLights(scene);
    scene.add(this.root);
    this.root.add(this.poseGroup);
    const mats = createArmMaterials();
    this.rightArm = new ArmModel(mats, 'right', 0.7);
    this.leftArm = new ArmModel(mats, 'left', 0.7);
    this.root.add(this.rightArm.root, this.leftArm.root);
    this.shells = new ShellEjector(this.root);
  }


  get weaponId(): string | null {
    return this.current?.def.id ?? null;
  }

  /** Troca a arma exibida e toca o saque. */
  equip(def: WeaponDef | null, drawClip: Clip | null, drawTime: number): void {
    // arma visível na mão: primeiro ela desce (guardar) e a troca acontece fora do quadro
    if (drawClip && this.current && !this.modelHidden && this.root.visible && drawTime > 0.1) {
      const holster = Math.min(HOLSTER_TIME, drawTime * 0.3);
      // troca em cima de outra troca: mantém a descida que já está em curso
      if (!this.pending) this.play(HOLSTER_CLIP, holster);
      this.pending = { def, drawClip, drawTime: drawTime - holster };
      return;
    }
    this.pending = null;
    this.swap(def, drawClip, drawTime);
  }

  private swap(def: WeaponDef | null, drawClip: Clip | null, drawTime: number): void {
    if (this.current) this.poseGroup.remove(this.current.model.root);
    this.flash.attach(undefined, 0);
    this.current = null;
    this.action = null;
    this.slideLocked = false;
    this.modelHidden = false;
    if (!def) return;

    const entry = this.getModel(def.id);
    this.current = { def, ...entry };
    this.leftFree = 0;
    this.poseGroup.add(entry.model.root);
    // silenciador: sem clarão na boca do cano
    this.flash.attach(entry.model.anchors.get('muzzle'), entry.model.root.userData.suppressed ? 0 : entry.model.view.flashScale);
    if (entry.model.view.rigidHands) this.current.grip = this.computeGripRig(entry.model);
    if (drawClip) this.play(drawClip, drawTime);
  }

  /** Enquadramento da vitrine (T) congelado: pré-visualizar acessórios não faz a arma pular. */
  private lockedShow: { pos: THREE.Vector3; rot: THREE.Euler } | null = null;

  lockShowcase(on: boolean): void {
    this.lockedShow = on && this.current ? this.current.show : null;
  }

  /**
   * Onde cada encaixe de acessório fica na arma atual (espaço do viewmodel), para o
   * editor do T ligar uma linha do ponto até o quadrado da opção.
   */
  slotPoints(): Partial<Record<AttachmentSlot, THREE.Vector3>> {
    const model = this.current?.model;
    if (!model) return {};
    model.root.updateWorldMatrix(true, true); // inclui a pose/balanço da mão neste quadro
    const world = (o: THREE.Object3D | undefined, local?: THREE.Vector3): THREE.Vector3 | undefined =>
      o ? (local ? o.localToWorld(local.clone()) : o.getWorldPosition(new THREE.Vector3())) : undefined;
    const rootPt = (x: number, y: number, z: number) => model.root.localToWorld(new THREE.Vector3(x, y, z));
    const anchor = (n: AnchorName) => model.anchors.get(n);
    const rootPos = (n: AnchorName) => {
      const a = anchor(n);
      return a ? model.root.worldToLocal(a.getWorldPosition(new THREE.Vector3())) : null;
    };
    const center = (o: THREE.Object3D | undefined) => (o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()) : undefined);
    let optic: THREE.Object3D | undefined;
    model.root.traverse((o) => {
      if (o.name === 'optic') optic = o;
    });
    const out: Partial<Record<AttachmentSlot, THREE.Vector3>> = {};
    out.optic = center(optic) ?? world(anchor('sight'));
    out.muzzle = world(anchor('muzzle'));
    out.magazine = center(model.parts.get('mag')) ?? world(anchor('mag'));
    // trilho: mesmo ponto onde o módulo é montado (lado direito do guarda-mão / sob o cano na pistola)
    const muzzle = rootPos('muzzle');
    const support = rootPos('support');
    if (muzzle) {
      out.rail =
        world(anchor('light')) ??
        world(anchor('laser')) ??
        (this.current!.def.category === 'pistol' || !support
          ? rootPt(0, muzzle.y - 0.028, muzzle.z + 0.045)
          : rootPt(0.034, support.y + 0.04, support.z + (muzzle.z - support.z) * 0.3));
    }
    out.grip = world(anchor('support'));
    return out;
  }

  /** Troca os acessórios de uma arma: refaz o modelo (e troca na hora se estiver na mão). */
  setAttachments(id: string, att: WeaponAttachments): void {
    this.attachments.set(id, att);
    const old = this.cache.get(id);
    if (!old) return;
    this.cache.delete(id);
    // (durante o guardar a arma antiga já está saindo: o modelo novo nasce no saque)
    if (this.current?.def.id === id && !this.pending) {
      const def = this.current.def;
      this.equip(def, null, 0);
    }
  }

  /**
   * Feixe do laser (só na primeira pessoa): um traço vermelho simples e curto saindo
   * do módulo, preso à arma. Mesmo comprimento visível em todas as armas (descontada a escala).
   */
  private addLaserBeam(model: WeaponModel): void {
    const a = model.anchors.get('laser');
    if (!a) return;
    // do módulo até passar um pouco da boca do cano (silenciador incluso)
    model.root.updateMatrixWorld(true);
    const local = (o: THREE.Object3D) => model.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const muzzle = model.anchors.get('muzzle');
    const toMuzzle = muzzle ? Math.max(0, local(a).z - local(muzzle).z) : 0;
    const len = toMuzzle + LASER_BEAM.length / model.view.scale;
    const t = LASER_BEAM.thickness / model.view.scale;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(t, t, len).translate(0, 0, -len / 2), LASER_BEAM_MAT);
    beam.frustumCulled = false;
    beam.userData.beam = true;
    a.add(beam);
  }

  /**
   * Posição e direção (para onde o cano aponta) de uma âncora no espaço da câmera
   * do viewmodel, que coincide com o espaço local da câmera do mundo.
   */
  anchorFrame(name: AnchorName, pos: THREE.Vector3, dir: THREE.Vector3): boolean {
    const a = this.current?.model.anchors.get(name);
    if (!a || this.modelHidden) return false;
    a.updateWorldMatrix(true, false);
    a.getWorldPosition(pos);
    a.getWorldDirection(dir).negate();
    return true;
  }

  /** Pré-carrega um modelo (evita travadas na primeira troca). */
  preload(id: string): void {
    this.getModel(id);
  }

  /** Toca um clipe de ação (saque, ciclo, golpe, arremesso). */
  play(clip: Clip, duration: number): void {
    this.action = { clip, time: 0, duration: Math.max(0.01, duration), prevT: -1 };
  }

  cancelAction(): void {
    this.action = null;
  }

  get actionBusy(): boolean {
    return this.action !== null;
  }

  onFire(recoilPitch: number, adsT: number, lastRound: boolean, shell: ShellType, ejectNow: boolean): void {
    const k = lerp(1, 0.55, adsT) * clamp(recoilPitch / 0.022, 0.4, 3);
    const kr = Math.min(k, 1.8);
    this.recoilPos.impulse(0.95 * k);
    this.recoilRot.impulse(1.4 * kr);
    this.recoilRoll.impulse((Math.random() * 2 - 1) * kr);
    this.recoilSide.impulse((Math.random() * 2 - 1) * 0.8 * kr);
    this.slideTimer = 0;
    this.slideLocked = lastRound && this.current?.model.view.slideTravel !== undefined;
    this.flash.trigger();
    const eject = this.current?.model.anchors.get('eject');
    if (ejectNow && eject) this.shells.spawn(eject, shell);
  }

  onDryFire(): void {
    this.recoilRot.impulse(0.4);
    this.kick([0, -0.001, 0, -0.008, 0, 0.012]);
  }

  onReloadComplete(): void {
    this.slideLocked = false;
  }

  /** Esconde o modelo (granada arremessada). */
  hideModel(hidden: boolean): void {
    this.modelHidden = hidden;
  }

  ejectShell(shell: ShellType, all = false, count = 6): void {
    const m = this.current?.model;
    if (!m) return;
    if (all) {
      const at = m.anchors.get('cylinder') ?? m.anchors.get('grip');
      if (at) for (let i = 0; i < count; i++) this.shells.spawn(at, 'pistol', true);
      return;
    }
    const at = m.anchors.get('eject');
    if (at) this.shells.spawn(at, shell);
  }

  /** Posição do mundo de uma âncora (p/ efeitos). */
  anchorWorld(name: AnchorName, out: THREE.Vector3): boolean {
    const a = this.current?.model.anchors.get(name);
    if (!a) return false;
    a.getWorldPosition(out);
    return true;
  }

  /** Tranco na arma (pico do deslocamento); a mola de 6 eixos devolve com um leve balanço. */
  kick(v: Vec6, scale = 1): void {
    const s = scale * (KICK_SCALE[this.current?.def.category ?? ''] ?? 1);
    // resposta ao impulso de uma mola com ζ≈0,55: pico ≈ v/(2ω) → v = 2ω·pico
    for (let i = 0; i < 6; i++) this.jolt[i].impulse(v[i] * s * 2 * Math.sqrt(this.jolt[i].stiffness));
  }

  update(f: ViewmodelFrame): void {
    // a arma antiga terminou de descer (ou a descida foi cancelada): troca e saca a nova
    if (this.pending && (!this.action || this.action.time + f.dt >= this.action.duration)) {
      const p = this.pending;
      this.pending = null;
      this.swap(p.def, p.drawClip, p.drawTime);
    }
    const cur = this.current;
    this.flash.update(f.dt);
    // laser: intensidade oscila com ruído de Perlin 1D em loop
    LASER_BEAM_MAT.opacity = LASER_FLICKER.base * (1 + LASER_FLICKER.depth * laserNoise(f.time));
    this.shells.update(f.dt);
    this.root.visible = !!cur && !f.hidden;
    if (!cur) return;

    // ── clipes ──
    this.pose.fill(0);
    this.partOffsets.clear();
    let left: [Key<HandValue>, Key<HandValue>, number] | null = null;
    let right: [Key<HandValue>, Key<HandValue>, number] | null = null;
    const visOverrides: Array<{ clip: Clip; t: number; empty: boolean }> = [];

    const apply = (clip: Clip, t: number, empty: boolean) => {
      addSample6(this.pose, clip.pose, t, empty);
      for (const track of clip.parts ?? []) {
        let arr = this.partOffsets.get(track.part);
        if (!arr) this.partOffsets.set(track.part, (arr = [0, 0, 0, 0, 0, 0]));
        addSample6(arr, track.keys, t, empty);
      }
      if (clip.left) left = segment(clip.left, t, empty) ?? left;
      if (clip.right) right = segment(clip.right, t, empty) ?? right;
      if (clip.vis) visOverrides.push({ clip, t, empty });
    };

    if (f.reload) {
      const r = f.reload;
      if (this.reloadPrev.key !== r.key) this.reloadPrev = { key: r.key, t: -1 };
      apply(r.clip, r.t, r.fromEmpty);
      this.emitCues(r.clip, this.reloadPrev.t, r.t, r.fromEmpty);
      this.reloadPrev.t = r.t;
    } else {
      this.reloadPrev.key = '';
    }

    if (this.action) {
      const a = this.action;
      a.time += f.dt;
      const t = Math.min(1, a.time / a.duration);
      apply(a.clip, t, false);
      this.emitCues(a.clip, a.prevT, t, false);
      a.prevT = t;
      if (t >= 1) this.action = null;
    }

    // ── pose base ──
    const view = cur.model.view;
    const reloading = !!f.reload;
    const sprintOn = f.sprinting && !reloading;
    this.sprintT = damp(this.sprintT, sprintOn ? 1 : 0, 9, f.dt);
    const sprintP = this.sprintPose.update(sprintOn ? 1 : 0, f.dt);
    this.recoilPos.update(f.dt);
    this.recoilRot.update(f.dt);
    this.recoilRoll.update(f.dt);
    this.recoilSide.update(f.dt);
    for (const j of this.jolt) j.update(f.dt);
    if (f.landingImpact > 2) {
      const hit = Math.min(f.landingImpact, 12);
      this.landing.impulse(-hit * 0.05);
      // a arma "cabeceia" ao aterrissar
      this.kick([0, 0, 0, -0.006 * hit, 0, 0.004 * hit], 1 - f.adsT * 0.7);
    }
    // agachar/levantar: a arma atrasa em relação ao corpo
    const crouch = f.crouch ?? 0;
    this.landing.impulse(-(crouch - this.prevCrouch) * 0.3);
    this.prevCrouch = crouch;
    this.landing.update(f.dt);
    // chegou na mira: um assento curto para trás
    if (f.adsT >= 1 && this.prevAds < 1) this.kick([0, 0, 0.004, 0, 0, 0]);
    this.prevAds = f.adsT;

    // mira: curva suave (arranca e assenta) com um arco — a arma inclina e afunda no meio do caminho
    const ads = smooth01(f.adsT);
    const adsArc = Math.sin(Math.PI * f.adsT);
    this.pos.set(...view.hipPos).lerp(cur.ads, ads);
    this.rot.set(...view.hipRot).multiplyScalar(1 - ads);
    this.pos.y -= adsArc * 0.008;
    this.tmpA.copy(SPRINT_OFFSET.pos).multiplyScalar(sprintP);
    this.pos.add(this.tmpA);
    this.tmpA.copy(SPRINT_OFFSET.rot).multiplyScalar(sprintP * (cur.def.category === 'heavy' ? 0.5 : 1));
    this.rot.add(this.tmpA);

    this.sightRoll = adsArc * 0.06;
    const hipK = 1 - f.adsT;
    // agachado: arma levemente deitada
    this.rot.z += crouch * 0.05 * hipK;
    // pulo/queda: subindo a arma fica para baixo; caindo ela sobe e o cano levanta
    const air = this.air.update(f.onGround ? 0 : clamp(f.vertical ?? 0, -9, 6), f.dt) * (1 - f.adsT * 0.75);
    this.pos.y -= air * 0.0035;
    this.rot.x -= air * 0.012;
    this.rot.z += air * 0.006 * hipK;
    // recuo: rolagem em torno da visada e um desvio lateral diferentes a cada tiro
    this.sightRoll += this.recoilRoll.value * 0.5;
    this.pos.x += this.recoilSide.value * 0.08 * hipK;
    this.rot.y += this.recoilSide.value * 0.2 * hipK;
    // deslize: arma inclina para o lado e desce um pouco (mirando, gira em torno da visada)
    const slide = f.slide ?? 0;
    this.pos.y -= slide * 0.03 * (1 - f.adsT);
    this.rot.z += slide * 0.28 * (1 - f.adsT);
    this.sightRoll += slide * 0.12 * f.adsT;
    this.applyBob(f);
    this.applySway(f);
    this.applyStrafeInertia(f);
    this.applyForwardTilt(f);

    // escalada: arma desce e sai de cena enquanto as mãos vão para a quina
    this.ledgeT = damp(this.ledgeT, f.ledge ? 1 : 0, 12, f.dt);
    if (f.ledge) {
      this.ledgeL.copy(f.ledge.left);
      this.ledgeR.copy(f.ledge.right);
    }
    this.pos.y -= this.ledgeT * 0.34;
    this.rot.x -= this.ledgeT * 0.7;

    // personalização (T): arma centralizada na frente da câmera, de lado, oscilando de leve
    const cz = smooth01(f.customize ?? 0);
    if (cz > 0) {
      const sh = this.lockedShow ?? cur.show;
      const t = f.time;
      this.pos.lerp(this.tmpA.set(sh.pos.x, sh.pos.y + Math.sin(t * 0.9) * 0.004, sh.pos.z + Math.sin(t * 0.6) * 0.006), cz);
      this.rot.set(
        lerp(this.rot.x, sh.rot.x + Math.sin(t * 0.7) * 0.025, cz),
        lerp(this.rot.y, sh.rot.y + Math.sin(t * 0.45) * 0.06, cz),
        lerp(this.rot.z, sh.rot.z + Math.sin(t * 0.55 + 1) * 0.02, cz),
      );
      this.sightRoll *= 1 - cz;
    }

    const p = this.pose;
    const j = this.jolt;
    // mirando o recuo de inclinação fica com a mola do braço (a visada não pode sair do alvo sozinha)
    const kickRot = this.recoilRot.value * lerp(RECOIL_VIEW.rot, RECOIL_VIEW.rotAds, f.adsT);
    this.poseGroup.position.set(
      this.pos.x + p[0] + j[0].value,
      this.pos.y + p[1] + j[1].value + this.landing.value,
      this.pos.z + p[2] + j[2].value + this.recoilPos.value * RECOIL_VIEW.back,
    );
    this.poseGroup.rotation.set(this.rot.x + p[3] + j[3].value + kickRot, this.rot.y + p[4] + j[4].value, this.rot.z + p[5] + j[5].value);
    // balanço do movimento: gira tudo em torno do eixo da visada (a mira não sai do centro)
    if (this.sightRoll !== 0) {
      this.rollQ.setFromAxisAngle(SIGHT_AXIS, this.sightRoll);
      this.poseGroup.position.applyQuaternion(this.rollQ);
      this.poseGroup.quaternion.premultiply(this.rollQ);
    }

    // ── peças ──
    this.updateParts(cur, f, visOverrides, reloading);
    cur.model.root.visible = !this.modelHidden;

    // ── mãos ──
    this.rightArm.resetElbow();
    this.leftArm.resetElbow();
    this.root.updateMatrixWorld(true);
    this.resolveHand(right, 'right', this.rightTarget);
    this.resolveHand(left, 'left', this.leftTarget);
    const shoulderL = view.shoulderL ? this.tmpS.set(view.shoulderL[0], view.shoulderL[1], view.shoulderL[2]) : SHOULDER_L;
    const elbowL = view.elbowL ? this.tmpE.set(view.elbowL[0], view.elbowL[1], view.elbowL[2]).normalize() : ELBOW_L;

    if (this.ledgeT > 0.001) {
      this.rightTarget.lerp(this.ledgeR, this.ledgeT);
      this.leftTarget.lerp(this.ledgeL, this.ledgeT);
      this.rightArm.aim(this.rightTarget, SHOULDER_R, ELBOW_R);
      this.leftArm.aim(this.leftTarget, SHOULDER_L, ELBOW_L);
    } else if (view.rigidHands && cur.grip) {
      // mão direita: presa rigidamente à arma (mesmo encaixe da pose de referência)
      this.applyRigid(this.rightArm, cur.grip.right);
      // mão esquerda: presa à arma; na recarga solta suavemente e segue a animação
      this.leftFree = damp(this.leftFree, f.reload || this.action?.clip.left ? 1 : 0, 14, f.dt);
      if (this.leftFree < 0.001) {
        this.applyRigid(this.leftArm, cur.grip.left);
      } else {
        this.leftArm.aim(this.leftTarget, shoulderL, elbowL);
        if (this.leftFree < 0.999) {
          this.tmpP.copy(this.leftArm.root.position);
          this.tmpQ.copy(this.leftArm.root.quaternion);
          this.applyRigid(this.leftArm, cur.grip.left);
          this.leftArm.root.position.lerp(this.tmpP, this.leftFree);
          this.leftArm.root.quaternion.slerp(this.tmpQ, this.leftFree);
        }
      }
    } else {
      this.rightArm.aim(this.rightTarget, SHOULDER_R, ELBOW_R);
      this.leftArm.aim(this.leftTarget, shoulderL, elbowL);
    }

    this.applyElbowTension(f);

    // personalização (T) com pistola: só a mão direita segura; a esquerda desce para fora do quadro
    if (cz > 0 && cur.def.category === 'pistol') {
      this.leftArm.root.position.addScaledVector(SHOW_LEFT_DROP, cz);
      this.leftArm.root.rotateX(-0.6 * cz);
    }
  }

  /**
   * Tensão do recuo percebida no COTOVELO: o braço de cima fica parado e o antebraço
   * direito dobra no cotovelo; a arma gira junto (pivô = cotovelo direito).
   * O antebraço esquerdo dobra no próprio cotovelo o suficiente para a mão seguir a arma.
   */
  private applyElbowTension(f: ViewmodelFrame): void {
    if (f.armPitch === 0 && f.armYaw === 0) return;
    const rot = this.tmpQ.setFromEuler(this.tmpEuler.set(f.armPitch, f.armYaw, 0, 'YXZ'));

    this.root.updateMatrixWorld(true);
    const elbowR = this.rightArm.elbow.getWorldPosition(this.tmpS);
    const handL = this.leftArm.hand.getWorldPosition(this.tmpP);

    // arma gira em torno do cotovelo direito
    this.poseGroup.position.sub(elbowR).applyQuaternion(rot).add(elbowR);
    this.poseGroup.quaternion.premultiply(rot);

    this.rightArm.bendElbow(rot);
    // onde a mão esquerda tem de ir para continuar presa à arma
    handL.sub(elbowR).applyQuaternion(rot).add(elbowR);
    this.leftArm.bendElbowToward(handL);
  }

  // ───────────────────────────────────────────

  /**
   * Monta a pose de referência (quadril, sem animação), posiciona os braços nas
   * âncoras `grip`/`support` e guarda a transformação de cada braço RELATIVA à arma.
   * A partir daí os braços andam junto com a arma como se estivessem presos a ela.
   */
  private computeGripRig(model: WeaponModel): { right: THREE.Matrix4; left: THREE.Matrix4 } {
    const v = model.view;
    this.poseGroup.position.set(...v.hipPos);
    this.poseGroup.rotation.set(...v.hipRot);
    for (const [part, rest] of model.rest) {
      part.position.copy(rest.pos);
      part.rotation.copy(rest.rot);
    }
    this.root.updateMatrixWorld(true);
    const grip = model.anchors.get('grip')!.getWorldPosition(new THREE.Vector3());
    const support = (model.anchors.get('support') ?? model.anchors.get('grip')!).getWorldPosition(new THREE.Vector3());
    const shoulderL = v.shoulderL ? new THREE.Vector3(...v.shoulderL) : SHOULDER_L;
    const elbowL = v.elbowL ? new THREE.Vector3(...v.elbowL).normalize() : ELBOW_L;
    this.rightArm.aim(grip, SHOULDER_R, ELBOW_R);
    this.leftArm.aim(support, shoulderL, elbowL);
    this.rightArm.root.updateMatrix();
    this.leftArm.root.updateMatrix();
    const inv = this.poseGroup.matrix.clone().invert();
    return {
      right: inv.clone().multiply(this.rightArm.root.matrix),
      left: inv.multiply(this.leftArm.root.matrix),
    };
  }

  /** Posiciona o braço = transformação da arma × encaixe fixo. */
  private applyRigid(arm: ArmModel, local: THREE.Matrix4): void {
    this.tmpM.multiplyMatrices(this.poseGroup.matrixWorld, local).decompose(arm.root.position, arm.root.quaternion, arm.root.scale);
  }

  private getModel(id: string) {
    let entry = this.cache.get(id);
    if (!entry) {
      const model = buildWeaponModel(id);
      const att = this.attachments.get(id);
      if (att) applyAttachments(model, att);
      this.addLaserBeam(model);
      model.root.updateMatrixWorld(true);
      const ads = new THREE.Vector3();
      const sight = model.anchors.get('sight');
      if (sight) {
        sight.getWorldPosition(ads);
        ads.set(-ads.x, -ads.y, -model.view.adsDistance - ads.z);
      } else {
        ads.set(...model.view.hipPos);
      }
      const defaultVis = new Map<THREE.Object3D, boolean>();
      for (const part of model.parts.values()) defaultVis.set(part, part.visible);
      entry = { model, ads, show: showcasePose(model), defaultVis };
      this.cache.set(id, entry);
    }
    return entry;
  }

  private emitCues(clip: Clip, prev: number, t: number, empty: boolean): void {
    if (!clip.cues) return;
    for (const cue of clip.cues) {
      if (cue.empty && !empty) continue;
      if (prev < cue.t && t >= cue.t) {
        const kick = cue.kick ?? (cue.sound ? CUE_KICKS[cue.sound] : undefined);
        if (kick) this.kick(kick);
        this.onCue(cue);
      }
    }
  }

  private updateParts(
    cur: NonNullable<Viewmodel['current']>,
    f: ViewmodelFrame,
    vis: Array<{ clip: Clip; t: number; empty: boolean }>,
    reloading: boolean,
  ): void {
    const { model } = cur;
    // ferrolho de pistola: recuo ao atirar / travado aberto
    this.slideTimer += f.dt;
    const travel = model.view.slideTravel;
    if (travel && !(reloading && this.partOffsets.has('slide'))) {
      let back: number;
      if (this.slideTimer < SLIDE_BACK_TIME) back = this.slideTimer / SLIDE_BACK_TIME;
      else if (this.slideTimer < SLIDE_BACK_TIME + SLIDE_RETURN_TIME)
        back = this.slideLocked ? 1 : 1 - (this.slideTimer - SLIDE_BACK_TIME) / SLIDE_RETURN_TIME;
      else back = this.slideLocked ? 1 : 0;
      const arr = this.partOffsets.get('slide') ?? [0, 0, 0, 0, 0, 0];
      arr[2] += back * travel;
      this.partOffsets.set('slide', arr);
    }
    // canos da minigun
    this.barrelAngle += f.spin * f.dt * 40;

    for (const [name, part] of model.parts) {
      const rest = model.rest.get(part)!;
      const off = this.partOffsets.get(name);
      part.position.copy(rest.pos);
      part.rotation.copy(rest.rot);
      if (off) {
        part.position.x += off[0];
        part.position.y += off[1];
        part.position.z += off[2];
        part.rotation.x += off[3];
        part.rotation.y += off[4];
        part.rotation.z += off[5];
      }
      if (name === 'barrels') part.rotation.z += this.barrelAngle;

      let visible = cur.defaultVis.get(part) ?? true;
      if (name === 'rocket' && f.ammo <= 0) visible = false;
      for (const v of vis) {
        for (const track of v.clip.vis ?? []) if (track.part === name) visible = isVisible(track, v.t, v.empty, visible);
      }
      part.visible = visible;
    }
  }

  private resolveHand(seg: [Key<HandValue>, Key<HandValue>, number] | null, side: 'left' | 'right', out: THREE.Vector3): void {
    if (!seg) {
      this.resolveTarget({ a: side === 'right' ? 'grip' : 'support' }, side, out);
      return;
    }
    const [a, b, u] = seg;
    this.resolveTarget(a.v, side, this.tmpA);
    this.resolveTarget(b.v, side, this.tmpB);
    out.lerpVectors(this.tmpA, this.tmpB, u);
    // mão em trânsito entre dois pontos: faz um arco (afasta da arma, vem para o corpo e desce)
    // em vez de cortar em linha reta por dentro do modelo
    if (a.v.a !== b.v.a) {
      const lift = Math.sin(Math.PI * u) * Math.min(HAND_ARC.max, this.tmpA.distanceTo(this.tmpB) * HAND_ARC.ratio);
      out.x += (side === 'left' ? -0.4 : 0.4) * lift;
      out.y -= 0.5 * lift;
      out.z += lift;
    }
  }

  private resolveTarget(v: HandValue, side: 'left' | 'right', out: THREE.Vector3): void {
    const anchors = this.current!.model.anchors;
    const fixed = FIXED_TARGETS[v.a as keyof typeof FIXED_TARGETS];
    const anchor = fixed ? undefined : (anchors.get(v.a as AnchorName) ?? (v.a === 'grip' ? undefined : anchors.get('support')));
    if (fixed) out.copy(fixed[side]);
    else if (anchor) anchor.getWorldPosition(out);
    else out.copy(FIXED_TARGETS.rest[side]);
    // (sem vetor temporário: `out` pode ser o próprio tmpB)
    if (v.o) out.set(out.x + v.o[0], out.y + v.o[1], out.z + v.o[2]);
  }

  private applyBob(f: ViewmodelFrame): void {
    const moving = f.onGround ? clamp(f.moveSpeed / 4.6, 0, 1.7) : 0;
    this.bobAmount = damp(this.bobAmount, moving, 8, f.dt);
    this.bobPhase += f.dt * lerp(8.5, 12.5, this.sprintT) * (moving > 0.05 ? 1 : 0);
    const amp = this.bobAmount;
    // passo: um "8" deitado — vai de um lado ao outro e afunda duas vezes por ciclo (uma por pé)
    const s = Math.sin(this.bobPhase);
    const dip = 0.5 - 0.5 * Math.cos(this.bobPhase * 2);
    // o cano atrasa um pouco em relação ao corpo
    const lag = Math.sin(this.bobPhase - 0.6);
    // quadril: a arma balança solta; mirando: só gira em torno da visada
    const free = 1 - f.adsT;
    const walk = amp * (1 - this.sprintT * 0.4) * free;
    this.pos.x += s * 0.007 * walk;
    this.pos.y -= dip * 0.0075 * walk;
    this.pos.z += dip * 0.003 * walk;
    this.rot.z += lag * 0.028 * walk;
    this.rot.y += lag * 0.012 * walk;
    this.rot.x += dip * 0.012 * walk;
    this.sightRoll += s * 0.03 * amp * f.adsT;
    // corrida: a arma bombeia de um lado ao outro e sobe/desce com os braços
    const run = amp * this.sprintT * free;
    this.pos.x += s * 0.022 * run;
    this.pos.y -= dip * 0.02 * run;
    this.pos.z += lag * 0.012 * run;
    this.rot.y += lag * 0.07 * run;
    this.rot.x += (dip - 0.5) * 0.07 * run;
    this.rot.z += s * 0.05 * run;
    // parado: respiração + uma deriva lenta (a mão nunca fica imóvel)
    const breathe = 1 - f.adsT * 0.85;
    const t = f.time;
    this.pos.y += Math.sin(t * 1.7) * 0.0012 * breathe;
    this.rot.x += Math.sin(t * 1.7 + 0.6) * 0.004 * breathe;
    this.pos.x += Math.sin(t * 0.83 + 1.3) * 0.0008 * breathe;
    this.rot.y += Math.sin(t * 0.61 + 0.4) * 0.0035 * free;
    this.rot.z += Math.sin(t * 1.07 + 2) * 0.005 * free;
    this.sightRoll += Math.sin(t * 1.07 + 2) * 0.004 * f.adsT;
  }

  /**
   * Andar para a direita deixa braços/arma para trás: deslocam e giram para a esquerda
   * (e o inverso para a esquerda). Igual mirando ou não; a mira do HUD fica fixa no centro.
   */
  private applyStrafeInertia(f: ViewmodelFrame): void {
    const target = clamp(-f.strafe / 4.6, -1.4, 1.4);
    // Mirando: mola mais macia e criticamente amortecida (sem tranco nem balanço).
    // Quadril: mola mais viva, com um leve passar do ponto.
    const stiffness = lerp(STRAFE_SPRING.hip.stiffness, STRAFE_SPRING.ads.stiffness, f.adsT);
    const damping = lerp(STRAFE_SPRING.hip.damping, STRAFE_SPRING.ads.damping, f.adsT);
    // sub-passos para a mola ficar estável com dt variável
    let remaining = f.dt;
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 120);
      const accel = stiffness * (target - this.strafeX) - damping * this.strafeV;
      this.strafeV += accel * h;
      this.strafeX += this.strafeV * h;
      remaining -= h;
    }
    // mesma intensidade mirando ou não; só reduz na corrida.
    // Braços e arma giram em torno do eixo da visada (alça e massa ficam no centro),
    // rolando para o lado oposto ao movimento.
    const k = 1 - this.sprintT * 0.5;
    this.sightRoll -= this.strafeX * k * STRAFE_ROLL;
  }

  private forwardTilt = 0;
  /**
   * Andando para a frente o cano (e os braços junto) aponta sutilmente para baixo;
   * de ré, para cima. Quase nada mirando (a visada fica no centro) e nada correndo.
   */
  private applyForwardTilt(f: ViewmodelFrame): void {
    const target = f.onGround ? clamp(f.forward / 4.6, -1, 1.2) : 0;
    this.forwardTilt = damp(this.forwardTilt, target, 5, f.dt);
    const k = (1 - f.adsT * 0.85) * (1 - this.sprintT);
    this.rot.x -= this.forwardTilt * FORWARD_TILT * k;
    this.pos.y -= this.forwardTilt * 0.006 * k;
  }

  private applySway(f: ViewmodelFrame): void {
    const k = lerp(1, 0.3, f.adsT);
    // o alvo segue o mouse; a mola atrasa a arma, passa um pouco do ponto ao parar e assenta
    this.swayX = damp(this.swayX, clamp(-f.lookDX * 0.0003, -0.025, 0.025) * k, 16, f.dt);
    this.swayY = damp(this.swayY, clamp(f.lookDY * 0.0003, -0.025, 0.025) * k, 16, f.dt);
    const sx = this.swayXF.update(this.swayX, f.dt);
    const sy = this.swayYF.update(this.swayY, f.dt);
    const free = 1 - f.adsT;
    this.pos.x += sx * free;
    this.pos.y += sy * free;
    this.rot.y += sx * 2.4 * free;
    this.rot.z -= sx * 1.6 * free;
    this.rot.x -= sy * 1.6 * free;
    this.sightRoll -= sx * 1.6 * f.adsT;
  }

  private readonly vmLights: { light: THREE.Light; base: number }[] = [];

  /** Reduz a luz dos braços/arma em mapas escuros (1 = normal). */
  setLightScale(k: number): void {
    for (const l of this.vmLights) l.light.intensity = l.base * k;
  }

  private setupLights(scene: THREE.Scene): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x5a5f66, 1.6);
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
    key.position.set(-0.6, 1.2, 0.6);
    const rim = new THREE.DirectionalLight(0xcfe0ff, 0.6);
    rim.position.set(1, 0.3, -1);
    scene.add(hemi, key, rim);
    for (const light of [hemi, key, rim]) this.vmLights.push({ light, base: light.intensity });
  }

}

const LASER_BEAM_MAT = new THREE.MeshBasicMaterial({
  color: 0xff2a1c,
  transparent: true,
  // fraco, mas visível também contra paredes claras (aditivo sumia no branco)
  opacity: 0.32,
  depthWrite: false,
});

/** Oscilação da intensidade do laser: opacidade base, variação (±) e ruído. */
const LASER_FLICKER = {
  base: 0.45,
  /** ±fração da opacidade base no pico do ruído. */
  depth: 0.45,
  /** Pontos da grade do ruído (o loop se repete a cada `cells / speed` s). */
  cells: 8,
  /** Células por segundo. */
  speed: 4,
};

/** Gradientes fixos (−1..1) de cada ponto da grade: hash simples, alternando o sinal. */
const LASER_GRADS = Array.from({ length: LASER_FLICKER.cells }, (_, i) => {
  const h = Math.abs(Math.sin(i * 78.233 + 1.7) * 43758.5453) % 1;
  return (0.4 + 0.6 * h) * (i % 2 ? -1 : 1);
});

/**
 * Ruído de Perlin 1D periódico, normalizado para −1..1: em cada célula interpola as rampas dos
 * gradientes das duas pontas com a curva suave 6t⁵−15t⁴+10t³. A grade dá a volta
 * (o último ponto liga no primeiro), então a animação repete em loop sem emenda.
 */
function laserNoise(time: number): number {
  const n = LASER_FLICKER.cells;
  const x = (((time * LASER_FLICKER.speed) % n) + n) % n;
  const i = Math.floor(x);
  const t = x - i;
  const a = LASER_GRADS[i] * t;
  const b = LASER_GRADS[(i + 1) % n] * (t - 1);
  const fade = t * t * t * (t * (t * 6 - 15) + 10);
  // o Perlin 1D fica em ±0,5·|g| no meio da célula: ×2,5 aproxima de ±1
  return Math.max(-1, Math.min(1, (a + (b - a) * fade) * 2.5));
}

const smooth01 = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** Quanto as molas do recuo deslocam a arma: recuo para trás (m) e inclinação (rad) no quadril / mirando. */
const RECOIL_VIEW = { back: 0.3, rot: 0.18, rotAds: 0.05 };

/** Arco da mão em trânsito: fração da distância percorrida e teto (m). */
const HAND_ARC = { ratio: 0.22, max: 0.06 };

/** Inclinação do cano (rad) andando para a frente na velocidade de caminhada. */
const FORWARD_TILT = 0.06;

/** Traço do laser: quanto passa da boca do cano e espessura (m no espaço da câmera, igual em todas as armas). */
const LASER_BEAM = { length: 0.3, thickness: 0.003 };

/** Quanto a mão esquerda desce/recua na vitrine de pistolas (sai do quadro). */
const SHOW_LEFT_DROP = new THREE.Vector3(-0.12, -0.55, 0.12);

/**
 * Rotação da vitrine: cano para a esquerda e empunhadura à direita (cada mão do seu
 * lado, sem cruzar os braços); lado esquerdo da arma virado para a câmera, um pouco de cima.
 */
const SHOW_ROT = new THREE.Euler(0.16, 1.2, -0.05);

/**
 * Pose de vitrine: posiciona o centro da arma no meio da tela, a uma distância
 * que faz a arma inteira caber no quadro.
 */
function showcasePose(model: WeaponModel): { pos: THREE.Vector3; rot: THREE.Euler } {
  model.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  model.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible && !o.userData.beam) box.expandByObject(o, true);
  });
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.y, size.z);
  // perto da câmera: a arma ocupa boa parte da tela (as pontas podem sair um pouco)
  // (armas curtas têm distância mínima para a mão não sair do quadro)
  const dist = Math.max(0.27, 0.1 + length * 0.62);
  const q = new THREE.Quaternion().setFromEuler(SHOW_ROT);
  // posição do grupo = alvo − R·centro
  const pos = new THREE.Vector3(0.0, -0.01, -dist).sub(center.applyQuaternion(q));
  return { pos, rot: SHOW_ROT.clone() };
}
