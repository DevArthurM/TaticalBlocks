import { registerZombieMesh } from './ZombieInstancer';
import { randomVariant, type ZombieVariant } from './variants';
import * as THREE from 'three';
import { clamp } from '../../core/math';
import { type CapsuleBox, moveAndCollide } from '../../player/Collision';
import { BODY, buildZombie, severGroup, woundMaterial, ZOMBIE_UNIT_BOX, type ZombieBones, type ZoneTag } from './ZombieModel';
import { PART_HP, type Severable, type Side, ZOMBIE_HP, ZONES } from './zones';

export type ZombieState = 'walk' | 'crawl' | 'dead';

export interface ZombieContext {
  dt: number;
  time: number;
  target: THREE.Vector3;
  colliders: readonly THREE.Box3[];
  /** O zumbi acertou o jogador. */
  onAttack(damage: number): void;
}

export interface HitResult {
  killed: boolean;
  /** Partes arrancadas por este acerto. */
  severed: { part: Severable; side: Side; group: THREE.Group }[];
  zone: ZoneTag;
  /** Osso atingido (para o impulso do ragdoll). */
  bone: string;
}

const UNIT = ZOMBIE_UNIT_BOX;
/** O que cada parte leva junto ao ser arrancada. */
const TAKES: Record<Severable, Severable[]> = {
  head: ['head'],
  upperArm: ['upperArm', 'forearm', 'hand'],
  forearm: ['forearm', 'hand'],
  hand: ['hand'],
  thigh: ['thigh', 'shin', 'foot'],
  shin: ['shin', 'foot'],
  foot: ['foot'],
};

/**
 * Zumbi voxel: persegue o jogador, anima o corpo proceduralmente conforme os
 * membros que ainda tem (andar, mancar, arrastar-se), recebe dano por zona e
 * perde partes do corpo.
 */
export class Zombie {
  readonly bones: ZombieBones;
  /** Malhas ainda presas (alvos de tiro). */
  meshes: THREE.Mesh[];
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  hp = ZOMBIE_HP;
  state: ZombieState = 'walk';
  /** Instante (s) da morte, para o ragdoll. */
  deadAt = 0;
  /** Destino próprio (ex.: barricada). `null` = persegue o jogador. */
  goal: THREE.Vector3 | null = null;
  /** Para onde olhar quando parado no destino (ex.: a janela). */
  faceTo: THREE.Vector3 | null = null;
  /** Arrancando tábuas: anima o golpe em vez de atacar o jogador. */
  tearing = false;
  /** Golpes que acertaram a barricada (o diretor consome). */
  tears = 0;
  private vault: { from: THREE.Vector3; to: THREE.Vector3; t: number; height: number } | null = null;

  private readonly lost = new Set<string>();
  private readonly partHp = new Map<string, number>();
  private readonly baseSpeed: number;
  private readonly headTilt: number;
  private phase = Math.random() * Math.PI * 2;
  private fall = 0;
  private attackCd = 0;
  private attackT = -1;
  private stuckTimer = 0;
  private sidestep = 0;
  private sideDir = 1;
  private readonly lastPos = new THREE.Vector3();
  private readonly body: CapsuleBox;
  private readonly stumps: { at: THREE.Object3D; time: number }[] = [];

  /** Roupa e tom de pele deste zumbi. */
  readonly variant: ZombieVariant;

  constructor(scene: THREE.Object3D, position: THREE.Vector3, speedScale = 1, variant: ZombieVariant = randomVariant()) {
    this.variant = variant;
    const { bones, meshes } = buildZombie(variant);
    this.bones = bones;
    this.meshes = meshes;
    for (const m of meshes) m.userData.zombie = this;
    this.position.copy(position);
    this.lastPos.copy(position);
    this.body = { position: this.position, radius: 0.28, height: 1.8 };
    this.baseSpeed = (0.95 + Math.random() * 0.6) * speedScale;
    this.headTilt = (Math.random() - 0.5) * 0.6;
    scene.add(bones.root);
    this.syncRoot();
  }

  get dead(): boolean {
    return this.state === 'dead';
  }

  has(part: Severable, side: Side): boolean {
    return !this.lost.has(`${part}:${side}`);
  }

  /** Um osso ainda está preso ao corpo? */
  attached(obj: THREE.Object3D): boolean {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o === this.bones.root) return true;
      o = o.parent;
    }
    return false;
  }

  /** Centro aproximado (para checagens rápidas). */
  center(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + (this.state === 'crawl' ? 0.25 : 1), this.position.z);
  }

  // ─────────────────────────── dano ───────────────────────────

  /** Aplica dano do tiro/golpe na malha atingida. */
  hit(mesh: THREE.Mesh, damage: number): HitResult {
    const tag = mesh.userData.hit as ZoneTag;
    const info = ZONES[tag.zone];
    const result: HitResult = { killed: false, severed: [], zone: tag, bone: mesh.parent?.name ?? 'chest' };
    if (this.dead) return result;

    this.hp -= damage * info.multiplier;
    if (info.part) {
      const side = info.part === 'head' ? 'C' : tag.side;
      const key = `${info.part}:${side}`;
      const left = (this.partHp.get(key) ?? PART_HP[info.part]) - damage;
      this.partHp.set(key, left);
      if (left <= 0 && this.has(info.part, side)) {
        result.severed.push(this.sever(info.part, side));
        if (info.part === 'head') this.hp = 0;
      }
    }
    if (this.hp <= 0) {
      this.state = 'dead';
      result.killed = true;
    }
    return result;
  }

  /** Arranca a parte: o grupo vai para a cena (o diretor cria a física dele). */
  private sever(part: Severable, side: Side): { part: Severable; side: Side; group: THREE.Group } {
    const group = severGroup(this.bones, part, side);
    const parent = group.parent!;
    for (const p of TAKES[part]) this.lost.add(`${p}:${part === 'head' ? 'C' : side}`);
    this.bones.root.updateMatrixWorld(true);

    // toco: ferida vermelha na articulação que ficou
    const stump = new THREE.Mesh(UNIT, woundMaterial());
    const thick = part === 'thigh' || part === 'shin' ? 0.14 : part === 'head' ? 0.12 : 0.1;
    stump.scale.set(thick, 0.04, thick);
    stump.position.copy(group.position);
    parent.add(stump);
    registerZombieMesh(stump);
    this.stumps.push({ at: stump, time: 0 });

    group.removeFromParent();
    const removed = new Set<THREE.Object3D>();
    group.traverse((o) => removed.add(o));
    this.meshes = this.meshes.filter((m) => !removed.has(m));
    for (const o of removed) if (o instanceof THREE.Mesh) o.userData.zombie = undefined;

    // perdeu perna/canela → cai e passa a se arrastar
    if (this.state === 'walk' && (!this.has('shin', 'L') || !this.has('shin', 'R'))) this.state = 'crawl';
    return { part, side, group };
  }

  /** Tocos sangrando (posições de mundo), para o diretor emitir sangue. */
  bleeding(out: THREE.Vector3[]): void {
    out.length = 0;
    for (const s of this.stumps) if (s.time < 2.5) out.push(s.at.getWorldPosition(new THREE.Vector3()));
  }

  // ─────────────────────────── IA + animação ───────────────────────────

  /** Pular a janela: do lado de fora até `to`, passando por cima do peitoril. */
  startVault(to: THREE.Vector3, sillHeight: number): void {
    this.vault = { from: this.position.clone(), to: to.clone(), t: 0, height: sillHeight };
    this.tearing = false;
  }

  get vaulting(): boolean {
    return this.vault !== null;
  }

  update(c: ZombieContext): void {
    if (this.dead) return;
    const dt = c.dt;
    if (this.vault) {
      this.updateVault(dt, c.time);
      return;
    }
    const target = this.goal ?? c.target;
    for (const s of this.stumps) s.time += dt;
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.state === 'crawl') this.fall = Math.min(1, this.fall + dt / 0.55);

    // direção ao jogador
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    let wantYaw = Math.atan2(-dx, -dz);
    if (this.faceTo && dist < 0.6) wantYaw = Math.atan2(-(this.faceTo.x - this.position.x), -(this.faceTo.z - this.position.z));
    if (this.sidestep > 0) wantYaw += this.sideDir * 1.1;
    let dy = wantYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += clamp(dy, -3 * dt, 3 * dt);

    const crawling = this.state === 'crawl';
    const limp = !crawling && (!this.has('foot', 'L') || !this.has('foot', 'R'));
    const armsLost = Number(!this.has('upperArm', 'L')) + Number(!this.has('upperArm', 'R'));
    let speed = this.baseSpeed * (crawling ? 0.42 : limp ? 0.62 : 1) * (armsLost === 2 ? 1.15 : 1);
    if (crawling && this.fall < 1) speed = 0;

    const reach = this.goal ? 0.35 : crawling ? 0.95 : 1.05;
    const inRange = dist < reach;
    if (inRange) speed = 0;
    // indo para a barricada: só "ataca" se estiver arrancando tábuas
    const canSwing = this.goal ? this.tearing : true;

    // ataque (golpe com os braços; sem braços, mordida)
    if (inRange && canSwing && this.attackCd <= 0 && this.attackT < 0) this.attackT = 0;
    if (this.attackT >= 0) {
      const before = this.attackT;
      this.attackT += dt / 0.7;
      if (before < 0.45 && this.attackT >= 0.45) {
        if (this.goal && this.tearing) this.tears++;
        else if (!this.goal && dist < reach + 0.35) c.onAttack(crawling ? 7 : armsLost === 2 ? 8 : 12);
      }
      if (this.attackT >= 1) {
        this.attackT = -1;
        this.attackCd = 0.5 + Math.random() * 0.4;
      }
    }

    // movimento
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    // crawlers avançam aos puxões (no tempo das braçadas)
    const pull = crawling ? Math.max(0, Math.sin(this.phase)) * 2 : 1;
    this.velocity.set(fx * speed * pull, 0, fz * speed * pull);
    this.body.height = crawling ? 0.5 : 1.8;
    moveAndCollide(this.body, 'x', this.velocity.x * dt, c.colliders);
    moveAndCollide(this.body, 'z', this.velocity.z * dt, c.colliders);

    // preso numa parede? contorna por um tempo
    this.stuckTimer += dt;
    if (this.stuckTimer > 0.8) {
      const moved = this.position.distanceTo(this.lastPos);
      if (speed > 0.2 && moved < speed * this.stuckTimer * 0.25) {
        this.sidestep = 1.2;
        this.sideDir = Math.random() < 0.5 ? -1 : 1;
      }
      this.lastPos.copy(this.position);
      this.stuckTimer = 0;
    }
    this.sidestep = Math.max(0, this.sidestep - dt);

    this.phase += dt * (crawling ? 3.2 : 1.6 + speed * 2.4);
    this.animate(c.time, speed, crawling, limp);
    this.syncRoot();
  }

  /** Pulo da janela: agacha, apoia no peitoril, passa as pernas e cai do lado de dentro. */
  private updateVault(dt: number, time: number): void {
    const v = this.vault!;
    v.t = Math.min(1, v.t + dt / 1.25);
    const t = v.t;
    // avança devagar no começo (sobe), rápido no meio (passa), assenta no fim
    const along = t < 0.35 ? t * 0.4 : 0.14 + ((t - 0.35) / 0.65) * 0.86;
    this.position.lerpVectors(v.from, v.to, along);
    this.position.y = Math.sin(Math.min(1, t / 0.8) * Math.PI) * (v.height * 0.95);
    this.yaw = Math.atan2(-(v.to.x - v.from.x), -(v.to.z - v.from.z));

    const b = this.bones;
    for (const k of ['pelvis', 'waist', 'chest', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'] as const)
      b[k].rotation.set(0, 0, 0);
    const crouch = Math.sin(t * Math.PI);
    b.pelvis.position.y = BODY.pelvisY - crouch * 0.35;
    b.waist.rotation.x = -0.6 * crouch;
    b.hipL.rotation.x = 1.3 * crouch;
    b.hipR.rotation.x = 0.7 * crouch;
    b.kneeL.rotation.x = -1.6 * crouch;
    b.kneeR.rotation.x = -1.1 * crouch;
    for (const side of ['L', 'R'] as const) {
      if (!this.has('upperArm', side)) continue;
      b[`shoulder${side}`].rotation.x = 1.1 + Math.sin(time * 6) * 0.1;
      b[`elbow${side}`].rotation.x = 0.5;
    }
    b.neck.rotation.x = 0.3;
    this.syncRoot();
    if (t >= 1) {
      this.position.y = 0;
      this.vault = null;
    }
  }

  /** Separa de outro zumbi (evita que se sobreponham). */
  separate(other: Zombie): void {
    const dx = this.position.x - other.position.x;
    const dz = this.position.z - other.position.z;
    const d = Math.hypot(dx, dz);
    const min = 0.6;
    if (d > 0.001 && d < min) {
      const push = (min - d) / 2;
      this.position.x += (dx / d) * push;
      this.position.z += (dz / d) * push;
      other.position.x -= (dx / d) * push;
      other.position.z -= (dz / d) * push;
    }
  }

  dispose(): void {
    this.bones.root.removeFromParent();
  }

  private syncRoot(): void {
    this.bones.root.position.copy(this.position);
    this.bones.root.rotation.y = this.yaw;
  }

  /** Animação procedural (zera e recompõe as rotações a cada quadro). */
  private animate(time: number, speed: number, crawling: boolean, limp: boolean): void {
    const b = this.bones;
    const p = this.phase;
    const s = Math.sin(p);
    const cs = Math.cos(p);
    const atk = this.attackT >= 0 ? Math.sin(Math.min(1, this.attackT) * Math.PI) : 0;
    const hasArm = { L: this.has('upperArm', 'L'), R: this.has('upperArm', 'R') };
    const hasFore = { L: this.has('forearm', 'L'), R: this.has('forearm', 'R') };
    const moving = clamp(speed / 1.2, 0, 1);

    for (const k of ['pelvis', 'waist', 'chest', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'] as const)
      b[k].rotation.set(0, 0, 0);

    if (crawling) {
      // cai de bruços e se arrasta com os braços
      const f = this.fall;
      b.pelvis.position.y = BODY.pelvisY * (1 - f) + 0.17 * f;
      b.pelvis.rotation.x = -1.45 * f;
      b.neck.rotation.x = 1.25 * f;
      b.neck.rotation.z = this.headTilt * 0.5;
      for (const side of ['L', 'R'] as const) {
        const ph = side === 'L' ? s : -s;
        // braçada: alcança (≈2,5 rad) e puxa (≈1,35 rad)
        b[`shoulder${side}`].rotation.x = f * (1.9 + ph * 0.6);
        b[`shoulder${side}`].rotation.z = (side === 'L' ? -1 : 1) * 0.25 * f;
        b[`elbow${side}`].rotation.x = f * (0.35 + Math.max(0, -ph) * 0.5);
        // pernas que sobraram se arrastam
        b[`hip${side}`].rotation.x = f * (0.1 + ph * 0.08);
        b[`knee${side}`].rotation.x = -f * 0.2;
      }
      b.chest.rotation.z = s * 0.08 * f;
      if (atk) b.neck.rotation.x += atk * 0.4;
      return;
    }

    // ── andar arrastado ──
    const swing = 0.42 * moving;
    b.hipL.rotation.x = s * swing;
    b.hipR.rotation.x = -s * swing;
    b.kneeL.rotation.x = -Math.max(0, cs) * 0.75 * moving;
    b.kneeR.rotation.x = -Math.max(0, -cs) * 0.75 * moving;
    b.ankleL.rotation.x = -(b.hipL.rotation.x + b.kneeL.rotation.x) * 0.6;
    b.ankleR.rotation.x = -(b.hipR.rotation.x + b.kneeR.rotation.x) * 0.6;

    let pelvisY = BODY.pelvisY - Math.abs(cs) * 0.03 * moving;
    let roll = s * 0.06 * moving;
    if (limp) {
      // manca: o corpo cai para o lado do pé que falta quando apoia nele
      const lameL = !this.has('foot', 'L');
      const stance = lameL ? Math.max(0, -s) : Math.max(0, s);
      pelvisY -= stance * 0.07;
      roll += (lameL ? -1 : 1) * stance * 0.12;
      if (lameL) b.kneeL.rotation.x -= 0.15;
      else b.kneeR.rotation.x -= 0.15;
    }
    b.pelvis.position.y = pelvisY;
    b.pelvis.rotation.z = roll;
    b.pelvis.rotation.y = s * 0.08 * moving;

    // tronco curvado para frente; sem braços, curva mais e cambaleia
    const armsLost = Number(!hasArm.L) + Number(!hasArm.R);
    b.waist.rotation.x = -0.16 - (armsLost === 2 ? 0.18 : 0) - atk * 0.25;
    b.chest.rotation.x = -0.08;
    b.chest.rotation.z = -roll * 0.6 + (armsLost === 1 ? (hasArm.L ? 0.12 : -0.12) : 0);
    b.neck.rotation.x = 0.18 + Math.sin(time * 1.3 + this.headTilt * 5) * 0.06 + atk * 0.2;
    b.neck.rotation.z = this.headTilt + Math.sin(time * 0.9) * 0.08;

    for (const side of ['L', 'R'] as const) {
      if (!hasArm[side]) continue;
      const sh = b[`shoulder${side}`];
      const el = b[`elbow${side}`];
      const sign = side === 'L' ? -1 : 1;
      const wobble = Math.sin(p * 0.5 + (side === 'L' ? 0 : 1.7)) * 0.12;
      if (hasFore[side]) {
        // braços estendidos para frente, tentando agarrar
        sh.rotation.x = 1.35 + wobble + atk * 0.55 * (side === 'L' ? 1 : 0.8);
        sh.rotation.z = sign * (0.12 - atk * 0.25);
        el.rotation.x = 0.2 - atk * 0.15;
      } else {
        // só o toco do braço: balança solto
        sh.rotation.x = 0.35 + Math.sin(p) * 0.35 * (side === 'L' ? 1 : -1);
        sh.rotation.z = sign * 0.15;
      }
    }
  }
}
