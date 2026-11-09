import { registerZombieMesh } from './ZombieInstancer';
import { randomVariant, type ZombieVariant } from './variants';
import * as THREE from 'three';
import { clamp } from '../../core/math';
import { type CapsuleBox, moveAndCollide } from '../../player/Collision';
import { BODY, buildZombie, goreMaterials, severGroup, woundMaterial, ZOMBIE_UNIT_BOX, type ZombieBones, type ZoneTag } from './ZombieModel';
import { PART_HP, type Severable, type Side, ZOMBIE_HP, ZONES } from './zones';

export type ZombieState = 'walk' | 'crawl' | 'dead';

/** Tipos de zumbi: comum, corredor (rápido e frágil) e forte (grande, lento e resistente). */
export type ZombieKind = 'normal' | 'runner' | 'brute';

export const ZOMBIE_KINDS: Record<
  ZombieKind,
  { speed: number; hp: number; parts: number; damage: number; scale: number; radius: number }
> = {
  normal: { speed: 1, hp: 1, parts: 1, damage: 1, scale: 1, radius: 0.28 },
  runner: { speed: 3.3, hp: 0.7, parts: 0.8, damage: 0.8, scale: 0.96, radius: 0.27 },
  brute: { speed: 0.72, hp: 3.2, parts: 2.2, damage: 2.2, scale: 1.12, radius: 0.38 },
};

export interface ZombieContext {
  dt: number;
  time: number;
  target: THREE.Vector3;
  colliders: readonly THREE.Box3[];
  /** IA de caminho: direção do menor caminho até o alvo (false = sem caminho conhecido). */
  steer?(pos: THREE.Vector3, out: THREE.Vector3): boolean;
  /** O zumbi acertou o jogador. */
  onAttack(damage: number): void;
}

export interface HitResult {
  killed: boolean;
  /** Partes arrancadas por este acerto (`stump`: o toco que ficou no corpo). */
  severed: { part: Severable; side: Side; group: THREE.Group; stump: THREE.Object3D }[];
  zone: ZoneTag;
  /** Osso atingido (para o impulso do ragdoll). */
  bone: string;
}

const UNIT = ZOMBIE_UNIT_BOX;
/** Dano acumulado (fração da vida da parte) para cada nível de ferida: arranhão, aberta, osso. */
const WOUND_STEPS = [0.2, 0.5, 0.8] as const;
/** "Vida" de referência das partes sem vida própria (tronco, cintura, quadril). */
const WOUND_POOL = 60;
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
  private readonly steerDir = new THREE.Vector3();
  private readonly body: CapsuleBox;
  private readonly stumps: { at: THREE.Object3D; time: number }[] = [];

  /** Roupa e tom de pele deste zumbi. */
  readonly variant: ZombieVariant;

  /** Tipo (comum, corredor ou forte). */
  readonly kind: ZombieKind;
  /** Online (modo zumbis): id compartilhado entre os jogadores. */
  id = 0;
  /** Online: índices da roupa e da pele (os outros montam o mesmo visual). */
  look: [number, number] = [0, 0];
  private readonly stats: (typeof ZOMBIE_KINDS)[ZombieKind];

  constructor(scene: THREE.Object3D, position: THREE.Vector3, speedScale = 1, variant: ZombieVariant = randomVariant(), kind: ZombieKind = 'normal') {
    this.variant = variant;
    this.kind = kind;
    this.stats = ZOMBIE_KINDS[kind];
    const { bones, meshes } = buildZombie(variant);
    this.bones = bones;
    this.meshes = meshes;
    for (const m of meshes) m.userData.zombie = this;
    this.position.copy(position);
    this.lastPos.copy(position);
    this.body = { position: this.position, radius: this.stats.radius, height: 1.8 * this.stats.scale };
    this.baseSpeed = (0.95 + Math.random() * 0.6) * speedScale * this.stats.speed;
    this.hp = ZOMBIE_HP * this.stats.hp;
    bones.root.scale.setScalar(this.stats.scale);
    if (kind === 'brute') {
      // forte: tronco e braços bem maiores (os braços herdam a escala do tronco), cabeça no tamanho normal
      bones.chest.scale.set(1.38, 1.12, 1.32);
      bones.neck.scale.set(1 / 1.38, 1 / 1.12, 1 / 1.32);
      for (const s of ['L', 'R'] as const) bones[`shoulder${s}`].scale.set(1.25, 1.12, 1.25);
      bones.waist.scale.set(1.2, 1, 1.15);
      for (const s of ['L', 'R'] as const) bones[`hip${s}`].scale.set(1.18, 1, 1.18);
    }
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

  /**
   * Aplica dano do tiro/golpe na malha atingida. `point`/`normal` (mundo): onde
   * acertou, para desenhar a ferida.
   */
  hit(mesh: THREE.Mesh, damage: number, point?: THREE.Vector3, normal?: THREE.Vector3): HitResult {
    const tag = mesh.userData.hit as ZoneTag;
    const info = ZONES[tag.zone];
    const result: HitResult = { killed: false, severed: [], zone: tag, bone: mesh.parent?.name ?? 'chest' };
    if (this.dead) return result;
    if (point) this.wound(mesh, damage, point, normal ?? null);

    this.hp -= damage * info.multiplier;
    if (info.part) {
      const side = info.part === 'head' ? 'C' : tag.side;
      const key = `${info.part}:${side}`;
      const left = (this.partHp.get(key) ?? PART_HP[info.part] * this.stats.parts) - damage;
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

  // ─────────────────────────── feridas ───────────────────────────

  /** Ferida num ponto (também no corpo já morto). */
  woundAt(mesh: THREE.Mesh, damage: number, point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    this.wound(mesh, damage, point, normal);
  }

  /** Dano acumulado em cada parte do corpo (malha) e o nível de ferida já mostrado. */
  private readonly woundDamage = new Map<THREE.Mesh, { dmg: number; level: number }>();

  /**
   * Cada parte do corpo tem 3 níveis de ferida, conforme o dano acumulado nela:
   * 1 = arranhão (sangue), 2 = ferida aberta (carne), 3 = carne exposta com osso.
   * A ferida nova aparece no ponto do tiro e acompanha a parte (inclusive arrancada).
   */
  private wound(mesh: THREE.Mesh, damage: number, point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const tag = mesh.userData.hit as ZoneTag;
    const info = ZONES[tag.zone];
    const pool = (info.part ? PART_HP[info.part] : WOUND_POOL) * this.stats.parts;
    const w = this.woundDamage.get(mesh) ?? { dmg: 0, level: 0 };
    w.dmg += damage;
    const frac = w.dmg / pool;
    const level = frac >= WOUND_STEPS[2] ? 3 : frac >= WOUND_STEPS[1] ? 2 : frac >= WOUND_STEPS[0] ? 1 : 0;
    this.woundDamage.set(mesh, w);
    if (level <= w.level) return;
    w.level = level;

    // ponto e face atingida no espaço da malha (cubo unitário escalado)
    mesh.updateWorldMatrix(true, false);
    const local = mesh.worldToLocal(point.clone());
    let axis: 'x' | 'y' | 'z' = 'z';
    let sign = 1;
    if (normal) {
      const n = normal.clone().transformDirection(mesh.matrixWorld.clone().invert());
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);
      axis = ax > ay && ax > az ? 'x' : ay > az ? 'y' : 'z';
      sign = Math.sign(n[axis]) || 1;
    } else {
      const ax = Math.abs(local.x);
      const ay = Math.abs(local.y);
      const az = Math.abs(local.z);
      axis = ax > ay && ax > az ? 'x' : ay > az ? 'y' : 'z';
      sign = Math.sign(local[axis]) || 1;
    }
    const gore = goreMaterials();
    const s = mesh.scale;
    /** Caixa na superfície: tamanho em metros, `out` = quanto sai da superfície (m), `depth` = espessura (m). */
    const add = (mat: THREE.Material, size: number, out: number, depth: number, jitter = 0) => {
      const box = new THREE.Mesh(UNIT, mat);
      const p = local.clone();
      // espalha um pouco em volta do ponto (no plano da face)
      for (const k of ['x', 'y', 'z'] as const) if (k !== axis) p[k] += ((Math.random() - 0.5) * jitter) / s[k];
      for (const k of ['x', 'y', 'z'] as const) {
        if (k === axis) continue;
        p[k] = THREE.MathUtils.clamp(p[k], -0.5 + size / 2 / s[k], 0.5 - size / 2 / s[k]);
      }
      p[axis] = sign * (0.5 + (out - depth / 2) / s[axis]);
      box.position.copy(p);
      box.scale.set(size / s.x, size / s.y, size / s.z);
      box.scale[axis] = depth / s[axis];
      mesh.add(box);
      registerZombieMesh(box);
    };
    // tamanhos limitados à parte (antebraço/mão são finos)
    const k = Math.min(1, (Math.min(s.x, s.y, s.z) + 0.1) / 0.32);
    if (level === 1) {
      // arranhão: mancha de sangue com respingos
      add(gore.wound, 0.07 * k, 0.004, 0.006);
      add(gore.wound, 0.035 * k, 0.004, 0.006, 0.09);
      add(gore.wound, 0.025 * k, 0.004, 0.006, 0.11);
    } else if (level === 2) {
      // ferida aberta: sangue em volta e carne viva no meio
      add(gore.wound, 0.12 * k, 0.005, 0.008);
      add(gore.flesh, 0.08 * k, 0.012, 0.016);
      add(gore.wound, 0.045 * k, 0.005, 0.008, 0.13);
    } else {
      // carne exposta: buraco grande e osso saindo
      add(gore.wound, 0.16 * k, 0.006, 0.008);
      add(gore.flesh, 0.12 * k, 0.016, 0.022);
      add(gore.bone, 0.045 * k, 0.05, 0.06);
      add(gore.bone, 0.03 * k, 0.035, 0.045, 0.05);
      add(gore.flesh, 0.05 * k, 0.014, 0.018, 0.14);
    }
  }

  /** Partes arrancadas (chaves `parte:lado`), para a rede. */
  get lostParts(): ReadonlySet<string> {
    return this.lost;
  }

  /** Online: arranca uma parte por ordem do anfitrião (null se já não tinha). */
  severPart(part: Severable, side: Side): { part: Severable; side: Side; group: THREE.Group; stump: THREE.Object3D } | null {
    const s = part === 'head' ? 'C' : side;
    if (!this.has(part, s)) return null;
    const r = this.sever(part, s);
    if (part === 'head') this.hp = 0;
    return r;
  }

  // ─────────── boneco (online: quem não é o anfitrião só segue o estado recebido) ───────────

  private readonly netTarget = { x: 0, z: 0, yaw: 0, crawl: false, attack: false, set: false };

  /** Golpeando agora (para a rede). */
  get attacking(): boolean {
    return this.attackT >= 0;
  }

  /** Último estado recebido do anfitrião. */
  setNetState(x: number, z: number, yaw: number, crawl: boolean, attack: boolean): void {
    this.netTarget.attack = attack;
    const t = this.netTarget;
    if (!t.set) {
      this.position.set(x, 0, z);
      this.yaw = yaw;
    }
    t.x = x;
    t.z = z;
    t.yaw = yaw;
    t.crawl = crawl;
    t.set = true;
  }

  /** Anda suavemente até o estado recebido e anima como se andasse sozinho. */
  puppetUpdate(dt: number, time: number): void {
    if (this.dead) return;
    const t = this.netTarget;
    for (const s of this.stumps) s.time += dt;
    if (t.crawl && this.state === 'walk') this.state = 'crawl';
    const crawling = this.state === 'crawl';
    if (crawling) this.fall = Math.min(1, this.fall + dt / 0.55);
    const k = Math.min(1, dt * 10);
    const px = this.position.x;
    const pz = this.position.z;
    this.position.x += (t.x - px) * k;
    this.position.z += (t.z - pz) * k;
    let dy = t.yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k;
    const speed = dt > 0 ? Math.hypot(this.position.x - px, this.position.z - pz) / dt : 0;
    if (t.attack && this.attackT < 0) this.attackT = 0;
    if (this.attackT >= 0) {
      this.attackT += dt / 0.7;
      if (this.attackT >= 1) this.attackT = -1;
    }
    this.velocity.set((this.position.x - px) / Math.max(dt, 1e-3), 0, (this.position.z - pz) / Math.max(dt, 1e-3));
    this.phase += dt * (crawling ? 3.2 : 1.6 + speed * 2.4);
    this.animate(time, speed, crawling, !crawling && (!this.has('foot', 'L') || !this.has('foot', 'R')));
    this.syncRoot();
  }

  /** Arranca a parte: o grupo vai para a cena (o diretor cria a física dele). */
  private sever(part: Severable, side: Side): { part: Severable; side: Side; group: THREE.Group; stump: THREE.Object3D } {
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
    return { part, side, group, stump };
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
    // IA: segue o menor caminho até o jogador (contorna paredes), não a linha reta
    if (!this.goal && dist > 0.9 && c.steer?.(this.position, this.steerDir)) {
      wantYaw = Math.atan2(-this.steerDir.x, -this.steerDir.z);
    }
    if (this.faceTo && dist < 0.6) wantYaw = Math.atan2(-(this.faceTo.x - this.position.x), -(this.faceTo.z - this.position.z));
    if (this.sidestep > 0) wantYaw += this.sideDir * 1.1;
    let dy = wantYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const turn = this.kind === 'runner' ? 6 : this.kind === 'brute' ? 2.2 : 3.5;
    this.yaw += clamp(dy, -turn * dt, turn * dt);

    const crawling = this.state === 'crawl';
    const limp = !crawling && (!this.has('foot', 'L') || !this.has('foot', 'R'));
    const armsLost = Number(!this.has('upperArm', 'L')) + Number(!this.has('upperArm', 'R'));
    let speed = this.baseSpeed * (crawling ? 0.42 : limp ? 0.62 : 1) * (armsLost === 2 ? 1.15 : 1);
    if (crawling && this.fall < 1) speed = 0;

    const reach = this.goal ? 0.35 : (crawling ? 0.95 : 1.05) + (this.kind === 'brute' ? 0.25 : 0);
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
        else if (!this.goal && dist < reach + 0.35) c.onAttack((crawling ? 7 : armsLost === 2 ? 8 : 12) * this.stats.damage);
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

    // ── andar arrastado (corredor: passada longa e joelhos altos; forte: passos pesados) ──
    const run = this.kind === 'runner' ? moving : 0;
    const swing = (0.42 + run * 0.5) * moving;
    b.hipL.rotation.x = s * swing;
    b.hipR.rotation.x = -s * swing;
    b.kneeL.rotation.x = -Math.max(0, cs) * (0.75 + run * 0.8) * moving;
    b.kneeR.rotation.x = -Math.max(0, -cs) * (0.75 + run * 0.8) * moving;
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
    b.waist.rotation.x = -0.16 - (armsLost === 2 ? 0.18 : 0) - atk * 0.25 - run * 0.38 - (this.kind === 'brute' ? 0.08 : 0);
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
        const reachX = 1.35 + wobble + atk * 0.55 * (side === 'L' ? 1 : 0.8);
        const reachZ = sign * (0.12 - atk * 0.25);
        const reachEl = 0.2 - atk * 0.15;
        // corredor: cotovelos dobrados e braços bombeando para frente e para trás,
        // opostos à perna do mesmo lado (no golpe volta a esticar para agarrar)
        const k = run * (1 - atk);
        const swingArm = side === 'L' ? -s : s;
        sh.rotation.x = reachX * (1 - k) + (0.25 + swingArm * 1.05) * k;
        sh.rotation.z = reachZ * (1 - k) + sign * 0.16 * k;
        el.rotation.x = reachEl * (1 - k) + (1.5 + Math.max(0, swingArm) * 0.35) * k;
      } else {
        // só o toco do braço: balança solto
        sh.rotation.x = 0.35 + Math.sin(p) * 0.35 * (side === 'L' ? 1 : -1);
        sh.rotation.z = sign * 0.15;
      }
    }
  }
}
