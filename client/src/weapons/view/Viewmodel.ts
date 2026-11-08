import type { ShellType, WeaponDef } from '@shared/weapons/types';
import * as THREE from 'three';
import { clamp, damp, lerp } from '../../core/math';
import { Spring } from '../../core/Spring';
import { addSample6, type Clip, type Cue, type HandValue, type Key, isVisible, segment } from '../animation/Clip';
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
  sprinting: boolean;
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
const STRAFE_SPRING = {
  hip: { stiffness: 70, damping: 11 },
  /** ζ = 1,1 → sem oscilação; ω ≈ 4,5 rad/s → resposta em ~0,5 s. */
  ads: { stiffness: 20, damping: 2 * Math.sqrt(20) * 1.1 },
} as const;
const SLIDE_BACK_TIME = 0.035;
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
  private readonly cache = new Map<string, { model: WeaponModel; ads: THREE.Vector3; defaultVis: Map<THREE.Object3D, boolean> }>();

  private current: {
    def: WeaponDef;
    model: WeaponModel;
    ads: THREE.Vector3;
    defaultVis: Map<THREE.Object3D, boolean>;
    /** Encaixe fixo dos braços relativo à arma (modo `rigidHands`). */
    grip?: { right: THREE.Matrix4; left: THREE.Matrix4 };
  } | null = null;
  private action: ActionPlayback | null = null;
  private reloadPrev = { key: '', t: 0 };
  private modelHidden = false;

  private readonly recoilPos = new Spring(320, 26);
  private readonly recoilRot = new Spring(260, 20);
  private readonly landing = new Spring(180, 14);
  private sprintT = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private swayX = 0;
  private swayY = 0;
  /** Inércia lateral (mola de 2ª ordem: atrasa, passa um pouco do ponto e assenta). */
  private strafeX = 0;
  private strafeV = 0;
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

  /** Quanto o braço está inclinado pela inércia lateral (0 = centrado). */
  get strafeTilt(): number {
    return Math.abs(this.strafeX);
  }

  get weaponId(): string | null {
    return this.current?.def.id ?? null;
  }

  /** Troca a arma exibida e toca o saque. */
  equip(def: WeaponDef | null, drawClip: Clip | null, drawTime: number): void {
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
    this.flash.attach(entry.model.anchors.get('muzzle'), entry.model.view.flashScale);
    if (entry.model.view.rigidHands) this.current.grip = this.computeGripRig(entry.model);
    if (drawClip) this.play(drawClip, drawTime);
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
    this.recoilPos.impulse(0.95 * k);
    this.recoilRot.impulse(1.4 * Math.min(k, 1.8));
    this.slideTimer = 0;
    this.slideLocked = lastRound && this.current?.model.view.slideTravel !== undefined;
    this.flash.trigger();
    const eject = this.current?.model.anchors.get('eject');
    if (ejectNow && eject) this.shells.spawn(eject, shell);
  }

  onDryFire(): void {
    this.recoilRot.impulse(0.4);
  }

  onReloadComplete(): void {
    this.slideLocked = false;
  }

  /** Esconde o modelo (granada arremessada). */
  hideModel(hidden: boolean): void {
    this.modelHidden = hidden;
  }

  ejectShell(shell: ShellType, all = false): void {
    const m = this.current?.model;
    if (!m) return;
    if (all) {
      const at = m.anchors.get('cylinder') ?? m.anchors.get('grip');
      if (at) for (let i = 0; i < 6; i++) this.shells.spawn(at, 'pistol', true);
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

  update(f: ViewmodelFrame): void {
    const cur = this.current;
    this.flash.update(f.dt);
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
    this.sprintT = damp(this.sprintT, f.sprinting && !reloading ? 1 : 0, 9, f.dt);
    this.recoilPos.update(f.dt);
    this.recoilRot.update(f.dt);
    if (f.landingImpact > 2) this.landing.impulse(-Math.min(f.landingImpact, 12) * 0.05);
    this.landing.update(f.dt);

    this.pos.set(...view.hipPos).lerp(cur.ads, f.adsT);
    this.rot.set(...view.hipRot).multiplyScalar(1 - f.adsT);
    this.tmpA.copy(SPRINT_OFFSET.pos).multiplyScalar(this.sprintT);
    this.pos.add(this.tmpA);
    this.tmpA.copy(SPRINT_OFFSET.rot).multiplyScalar(this.sprintT * (cur.def.category === 'heavy' ? 0.5 : 1));
    this.rot.add(this.tmpA);

    this.applyBob(f);
    this.applySway(f);
    this.applyStrafeInertia(f);

    // escalada: arma desce e sai de cena enquanto as mãos vão para a quina
    this.ledgeT = damp(this.ledgeT, f.ledge ? 1 : 0, 12, f.dt);
    if (f.ledge) {
      this.ledgeL.copy(f.ledge.left);
      this.ledgeR.copy(f.ledge.right);
    }
    this.pos.y -= this.ledgeT * 0.34;
    this.rot.x -= this.ledgeT * 0.7;

    const p = this.pose;
    this.poseGroup.position.set(this.pos.x + p[0], this.pos.y + p[1] + this.landing.value, this.pos.z + p[2] + this.recoilPos.value * 0.04);
    this.poseGroup.rotation.set(this.rot.x + p[3] + this.recoilRot.value * 0.035, this.rot.y + p[4], this.rot.z + p[5]);

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
      this.leftFree = damp(this.leftFree, f.reload ? 1 : 0, 14, f.dt);
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
      entry = { model, ads, defaultVis };
      this.cache.set(id, entry);
    }
    return entry;
  }

  private emitCues(clip: Clip, prev: number, t: number, empty: boolean): void {
    if (!clip.cues) return;
    for (const cue of clip.cues) {
      if (cue.empty && !empty) continue;
      if (prev < cue.t && t >= cue.t) this.onCue(cue);
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
  }

  private resolveTarget(v: HandValue, side: 'left' | 'right', out: THREE.Vector3): void {
    const anchors = this.current!.model.anchors;
    const fixed = FIXED_TARGETS[v.a as keyof typeof FIXED_TARGETS];
    const anchor = fixed ? undefined : (anchors.get(v.a as AnchorName) ?? (v.a === 'grip' ? undefined : anchors.get('support')));
    if (fixed) out.copy(fixed[side]);
    else if (anchor) anchor.getWorldPosition(out);
    else out.copy(FIXED_TARGETS.rest[side]);
    if (v.o) out.add(this.tmpB.set(v.o[0], v.o[1], v.o[2]));
  }

  private applyBob(f: ViewmodelFrame): void {
    const moving = f.onGround ? clamp(f.moveSpeed / 4.6, 0, 1.7) : 0;
    this.bobAmount = damp(this.bobAmount, moving, 8, f.dt);
    this.bobPhase += f.dt * lerp(8.5, 12.5, this.sprintT) * (moving > 0.05 ? 1 : 0);
    const amp = this.bobAmount * lerp(1, 0.12, f.adsT) * (1 + this.sprintT * 1.4);
    const s = Math.sin(this.bobPhase);
    const c = Math.cos(this.bobPhase);
    this.pos.x += s * 0.007 * amp;
    this.pos.y += -Math.abs(c) * 0.0065 * amp;
    this.rot.z += s * 0.025 * amp;
    this.rot.x += Math.abs(c) * 0.01 * amp;
    const breathe = 1 - f.adsT * 0.85;
    this.pos.y += Math.sin(f.time * 1.7) * 0.0012 * breathe;
    this.rot.x += Math.sin(f.time * 1.7 + 0.6) * 0.004 * breathe;
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
    // mesma intensidade mirando ou não; só reduz na corrida
    const k = 1 - this.sprintT * 0.5;
    const s = this.strafeX * k;
    this.pos.x += s * 0.028;
    this.pos.y -= Math.abs(s) * 0.006;
    this.rot.z -= s * 0.16; // rola para o lado oposto ao movimento
    this.rot.y -= s * 0.06;
  }

  private applySway(f: ViewmodelFrame): void {
    const k = lerp(1, 0.3, f.adsT);
    this.swayX = damp(this.swayX, clamp(-f.lookDX * 0.0003, -0.025, 0.025) * k, 9, f.dt);
    this.swayY = damp(this.swayY, clamp(f.lookDY * 0.0003, -0.025, 0.025) * k, 9, f.dt);
    this.pos.x += this.swayX;
    this.pos.y += this.swayY;
    this.rot.y += this.swayX * 2.4;
    this.rot.z -= this.swayX * 1.6;
    this.rot.x -= this.swayY * 1.6;
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
