import { FLAG, type PlayerInfo, type PlayerState, type TeamId } from '@shared/net/protocol';
import * as THREE from 'three';
import { Footsteps } from '../../audio/Footsteps';
import { Ragdoll } from '../../enemies/zombie/Ragdoll';
import { BODY } from '../../enemies/zombie/ZombieModel';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { solveArmIK } from './ArmIK';
import { buildSoldier, skinIndexFor, type Soldier } from './SoldierModel';
import { buildThirdPersonWeapon, type TPWeapon } from './ThirdPersonWeapon';

const UPPER = BODY.upperArm;
const LOWER = BODY.forearm + BODY.hand * 0.5;
const RAGDOLL_LIFETIME = 9;

/** Pose da arma no espaço do peito: posição da empunhadura e rotação do pivô. */
interface WeaponPose {
  grip: THREE.Vector3;
  rot: THREE.Euler;
}

const LONG_GUNS = new Set(['smg', 'rifle', 'shotgun', 'sniper', 'heavy']);

/** Poses-chave da arma (espaço do peito). */
const POSES = {
  // fuzil: coronha no ombro direito; mirando, alinhado ao olho; parado, cano um pouco para baixo
  longAim: { grip: new THREE.Vector3(0.09, 0.43, -0.22), rot: new THREE.Euler(0, 0.02, 0) },
  longHip: { grip: new THREE.Vector3(0.11, 0.34, -0.2), rot: new THREE.Euler(-0.16, 0.08, 0.04) },
  longLow: { grip: new THREE.Vector3(0.15, 0.18, -0.16), rot: new THREE.Euler(-0.75, 0.35, 0.35) },
  // pistola: duas mãos à frente do peito (mais alta); mirando, braços estendidos na altura dos olhos
  pistolAim: { grip: new THREE.Vector3(0.02, 0.5, -0.48), rot: new THREE.Euler(0, 0, 0) },
  pistolHip: { grip: new THREE.Vector3(0.04, 0.36, -0.38), rot: new THREE.Euler(-0.18, 0, 0) },
  // pistola baixa (correndo / vitrine do menu): à frente do corpo, cano para baixo em diagonal
  pistolLow: { grip: new THREE.Vector3(0.05, 0.22, -0.42), rot: new THREE.Euler(-0.7, 0, 0) },
  melee: { grip: new THREE.Vector3(0.2, 0.1, -0.22), rot: new THREE.Euler(0.5, 0, -0.2) },
  throwable: { grip: new THREE.Vector3(0.2, 0.14, -0.22), rot: new THREE.Euler(0, 0, 0) },
} satisfies Record<string, WeaponPose>;

interface Sample {
  t: number;
  s: PlayerState;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

/** Cópias transparentes dos materiais (uma por material original), para o jogador protegido. */
const GHOST = new Map<THREE.Material, THREE.Material>();
const GHOST_OPACITY = { base: 0.38, pulse: 0.12 };
function ghostOf(mat: THREE.Material): THREE.Material {
  let g = GHOST.get(mat);
  if (!g) {
    g = mat.clone();
    g.transparent = true;
    g.depthWrite = false;
    g.opacity = GHOST_OPACITY.base;
    GHOST.set(mat, g);
  }
  return g;
}
/** Pistola sem ponto de apoio no modelo: mão esquerda envolve a direita. */
const PISTOL_SUPPORT = new THREE.Vector3(-0.012, -0.005, 0.02);
/** Mão direita na pistola: abaixo do topo da empunhadura, envolvendo o cabo (espaço da arma). */
const PISTOL_HAND = new THREE.Vector3(0, -0.06, 0.012);

/**
 * Outro jogador no modo online: soldado voxel interpolado a partir dos
 * snapshots do servidor, com animação procedural completa e ragdoll.
 * O próprio jogador nunca vê o seu — só os outros o veem assim.
 */
export class RemotePlayer {
  readonly id: string;
  name: string;
  team: TeamId;
  alive = true;
  soldier: Soldier;
  hp = 100;

  // estado interpolado
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  lean = 0;
  crouch = 0;
  flags = 0;

  private samples: Sample[] = [];
  private weapon: TPWeapon | null = null;
  private weaponId: string | null = null;
  /** Acessórios da arma na mão ("holo,suppressor"). */
  attachments = '';
  private pendingWeapon: string | null = null;
  private readonly holder = new THREE.Group();
  private ragdolls: { ragdoll: Ragdoll; age: number }[] = [];

  // animação
  private phase = 0;
  private kick = 0;
  private switchT = 1;
  private meleeT = 1;
  private throwT = 1;
  private reloadT = 0;
  private flinch = 0;
  private aimT = 0;
  private lowT = 0;
  private airT = 0;
  private slideT = 0;
  /** Começou a deslizar neste quadro (som/poeira). */
  slideStarted = false;
  /** Cadência dos passos (som). */
  readonly steps = new Footsteps();
  private breath = Math.random() * 10;
  private readonly pose = { grip: new THREE.Vector3(), rot: new THREE.Euler() };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    info: PlayerInfo,
  ) {
    this.id = info.id;
    this.name = info.name;
    this.team = info.team;
    this.alive = info.alive;
    this.hp = info.hp;
    this.soldier = this.spawnModel();
    this.soldier.bones.root.visible = info.alive;
  }

  /** Malhas atingíveis (vivo). */
  get meshes(): THREE.Mesh[] {
    return this.alive ? this.soldier.meshes : [];
  }

  /** Recebe um estado do snapshot (tempo do servidor). */
  push(t: number, s: PlayerState): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    this.samples.push({ t, s });
    if (this.samples.length > 40) this.samples.shift();
  }

  update(dt: number, renderT: number): void {
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i];
      r.age += dt;
      r.ragdoll.update(dt);
      if (r.age > 5 && r.ragdoll.isActive) r.ragdoll.freeze();
      if (r.age > RAGDOLL_LIFETIME) {
        r.ragdoll.dispose();
        this.ragdolls.splice(i, 1);
      }
    }
    if (!this.alive) {
      this.setGhost(false);
      return;
    }
    this.interpolate(renderT);
    this.animate(dt);
    this.setGhost(performance.now() / 1000 < this.protectedUntil);
  }

  // ───────────── proteção ao renascer ─────────────

  /** Fim da proteção (performance.now em s). */
  private protectedUntil = 0;
  private ghost = false;

  /** Renasceu protegido: semitransparente (e imortal no servidor) por `seconds`. */
  setProtected(seconds: number): void {
    this.protectedUntil = performance.now() / 1000 + seconds;
  }

  /**
   * Liga/desliga o visual semitransparente. As peças do soldado normalmente são
   * desenhadas por instância (material compartilhado); protegido, cada uma sai da
   * instância e usa uma cópia transparente — a arma na mão também.
   */
  private setGhost(on: boolean): void {
    if (on) {
      const swap = (o: THREE.Object3D) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.ghostFrom) return;
        mesh.userData.ghostFrom = mesh.material;
        mesh.userData.ghostVisible = mesh.visible;
        mesh.userData.direct = true; // fora do desenho por instância
        // a cabeça usa uma lista de materiais (rosto numa face): cada um vira transparente
        const m = mesh.material;
        mesh.material = Array.isArray(m) ? m.map(ghostOf) : ghostOf(m);
        mesh.visible = true;
      };
      for (const m of this.soldier.meshes) swap(m);
      this.holder.traverse(swap); // inclui uma arma trocada durante a proteção
      // pisca de leve
      const t = performance.now() / 1000;
      for (const g of GHOST.values()) g.opacity = GHOST_OPACITY.base + Math.sin(t * 9) * GHOST_OPACITY.pulse;
    } else if (this.ghost) {
      const restore = (o: THREE.Object3D) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.userData.ghostFrom) return;
        mesh.material = mesh.userData.ghostFrom as THREE.Material | THREE.Material[];
        mesh.visible = mesh.userData.ghostVisible as boolean;
        delete mesh.userData.ghostFrom;
        delete mesh.userData.ghostVisible;
        delete mesh.userData.direct;
      };
      for (const m of this.soldier.meshes) restore(m);
      this.holder.traverse(restore);
    }
    this.ghost = on;
  }

  // ───────────── eventos ─────────────

  onShot(): void {
    if (this.weapon?.category === 'melee') this.meleeT = 0;
    else this.kick = 1;
  }

  onThrow(): void {
    this.throwT = 0;
  }

  onDamage(): void {
    this.flinch = 1;
  }

  die(dir: THREE.Vector3, bone: string): void {
    if (!this.alive) return;
    this.alive = false;
    const b = this.soldier.bones;
    b.root.updateMatrixWorld(true);
    const ragdoll = new Ragdoll(this.physics, this.scene, b, () => true, _v.copy(this.vel).setY(Math.max(0, this.vel.y)));
    const at = (b[bone as keyof typeof b] ?? b.chest).getWorldPosition(_w);
    ragdoll.impulse(bone, at, _v.copy(dir).setY(dir.y + 0.25).normalize().multiplyScalar(55));
    this.ragdolls.push({ ragdoll, age: 0 });
    // o modelo virou ragdoll; um novo nasce no respawn
    b.root.removeFromParent();
    this.weapon = null;
    this.weaponId = null;
    this.soldier = this.spawnModel();
    this.soldier.bones.root.visible = false;
  }

  respawn(p: THREE.Vector3, yaw: number): void {
    this.alive = true;
    this.hp = 100;
    this.samples = [];
    this.pos.copy(p);
    this.yaw = yaw;
    this.soldier.bones.root.visible = true;
    this.soldier.bones.root.position.copy(p);
    this.soldier.bones.root.rotation.y = yaw;
  }

  setTeam(team: TeamId): void {
    if (team === this.team) return;
    this.team = team;
    this.soldier.bones.root.removeFromParent();
    this.weapon = null;
    this.weaponId = null;
    const visible = this.alive;
    this.soldier = this.spawnModel();
    this.soldier.bones.root.visible = visible;
  }

  /** Ponta do cano (mundo) — origem dos traçantes. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.weapon) return this.headWorld(out);
    return out.copy(this.weapon.muzzle).applyMatrix4(this.weapon.root.matrixWorld);
  }

  /** Topo da cabeça (mundo) — para a etiqueta de nome. */
  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.soldier.bones.head.getWorldPosition(out).setY(out.y + 0.42);
  }

  dispose(): void {
    this.soldier.bones.root.removeFromParent();
    for (const r of this.ragdolls) r.ragdoll.dispose();
    this.ragdolls = [];
  }

  // ───────────── interpolação ─────────────

  private interpolate(renderT: number): void {
    const n = this.samples.length;
    if (!n) return;
    let a = this.samples[0];
    let b = a;
    for (let i = 0; i < n; i++) {
      if (this.samples[i].t <= renderT) a = this.samples[i];
      if (this.samples[i].t >= renderT) {
        b = this.samples[i];
        break;
      }
      b = this.samples[i];
    }
    // descarta o que já passou (mantém um anterior)
    while (this.samples.length > 2 && this.samples[1].t < renderT) this.samples.shift();

    let k = 0;
    if (b.t > a.t) k = THREE.MathUtils.clamp((renderT - a.t) / (b.t - a.t), 0, 1);
    const sa = a.s;
    const sb = b.s;
    this.pos.set(lerp(sa.p[0], sb.p[0], k), lerp(sa.p[1], sb.p[1], k), lerp(sa.p[2], sb.p[2], k));
    // sem amostra nova: extrapola um pouco pela velocidade (até 150 ms)
    if (renderT > b.t && a === b) {
      const ex = Math.min(0.15, renderT - b.t);
      this.pos.x += sb.v[0] * ex;
      this.pos.z += sb.v[2] * ex;
    }
    this.vel.set(lerp(sa.v[0], sb.v[0], k), lerp(sa.v[1], sb.v[1], k), lerp(sa.v[2], sb.v[2], k));
    this.yaw = lerpAngle(sa.yaw, sb.yaw, k);
    this.pitch = lerp(sa.pitch, sb.pitch, k);
    this.lean = lerp(sa.lean, sb.lean, k);
    this.crouch = lerp(sa.crouch, sb.crouch, k);
    this.slideStarted = (sb.flags & FLAG.slide) !== 0 && (this.flags & FLAG.slide) === 0;
    this.flags = sb.flags;
    // trocou só os acessórios: refaz a arma na hora
    const att = sb.att ?? '';
    if (att !== this.attachments) {
      this.attachments = att;
      if (sb.weapon === this.weaponId) this.equip(this.weaponId);
    }
    if (sb.weapon !== this.weaponId && sb.weapon !== this.pendingWeapon) {
      // troca: abaixa a arma atual, troca no meio, levanta a nova
      if (this.weaponId) {
        this.pendingWeapon = sb.weapon;
        this.switchT = 0;
      } else {
        // sem arma na mão: equipa já e só faz a metade de "levantar"
        this.equip(sb.weapon);
        this.switchT = 0.5;
      }
    }
  }

  // ───────────── animação ─────────────

  private animate(dt: number): void {
    const b = this.soldier.bones;
    b.root.position.copy(this.pos);
    b.root.rotation.y = this.yaw;

    const ground = (this.flags & FLAG.ground) !== 0;
    const sprint = (this.flags & FLAG.sprint) !== 0;
    const aim = (this.flags & FLAG.aim) !== 0;
    const reloading = (this.flags & FLAG.reload) !== 0;
    this.airT = approach(this.airT, ground ? 0 : 1, dt * 6);
    this.slideT = approach(this.slideT, this.flags & FLAG.slide ? 1 : 0, dt * (this.flags & FLAG.slide ? 9 : 4));
    this.aimT = approach(this.aimT, aim ? 1 : 0, dt * 7);
    this.lowT = approach(this.lowT, sprint && ground ? 1 : 0, dt * 6);

    // velocidade no referencial do corpo (frente = −Z)
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const fwd = -(this.vel.x * sin + this.vel.z * cos);
    const side = this.vel.x * cos - this.vel.z * sin;
    const speed = Math.hypot(fwd, side);
    const moveAngle = Math.atan2(side, fwd);
    const stride = THREE.MathUtils.clamp(speed / 4.2, 0, 1) * (sprint ? 1 : 0.75) * (1 - this.airT) * (1 - this.crouch * 0.35);
    this.phase += dt * (speed > 0.1 ? 2.2 + speed * 1.55 : 0) * (fwd < -0.2 ? -1 : 1);
    this.breath += dt;

    for (const k of ['pelvis', 'waist', 'chest', 'neck', 'head', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'wristL', 'wristR'] as const)
      b[k].rotation.set(0, 0, 0);

    // ── pernas: ciclo de passada na direção do movimento, agachar e pulo ──
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const fwdK = Math.cos(moveAngle);
    const sideK = Math.sin(moveAngle);
    const crouch = this.crouch;
    const swing = stride * (sprint ? 0.85 : 0.6);
    for (const [hip, knee, ankle, sign] of [
      [b.hipL, b.kneeL, b.ankleL, 1],
      [b.hipR, b.kneeR, b.ankleR, -1],
    ] as const) {
      const leg = s * sign;
      const lift = Math.max(0, c * sign);
      hip.rotation.x = leg * swing * Math.abs(fwdK) * Math.sign(fwdK || 1) + crouch * 1.15 + this.airT * (sign > 0 ? 0.7 : 0.25);
      hip.rotation.z = -leg * swing * sideK * 0.55;
      knee.rotation.x = -(lift * stride * (sprint ? 1.25 : 0.85)) - crouch * 2.05 - this.airT * (sign > 0 ? 1.1 : 0.5);
      ankle.rotation.x = -(hip.rotation.x + knee.rotation.x) * 0.55;
    }
    const bob = Math.abs(Math.sin(this.phase * 1)) * 0.035 * stride;
    b.pelvis.position.y = BODY.pelvisY - crouch * 0.4 + bob - this.airT * 0.05;
    // deslize: quadril rente ao chão, perna direita esticada à frente, esquerda dobrada por baixo, tronco para trás
    const sl = this.slideT;
    if (sl > 0) {
      const mix = (v: number, target: number) => v + (target - v) * sl;
      b.pelvis.position.y = mix(b.pelvis.position.y, 0.42);
      b.pelvis.rotation.x = mix(0, 0.55);
      b.hipR.rotation.set(mix(b.hipR.rotation.x, 1.0), 0, mix(b.hipR.rotation.z, 0.05));
      b.kneeR.rotation.x = mix(b.kneeR.rotation.x, -0.08);
      b.ankleR.rotation.x = mix(b.ankleR.rotation.x, -0.3);
      b.hipL.rotation.set(mix(b.hipL.rotation.x, 0.25), 0, mix(b.hipL.rotation.z, -0.35));
      b.kneeL.rotation.x = mix(b.kneeL.rotation.x, -2.3);
      b.ankleL.rotation.x = mix(b.ankleL.rotation.x, 0.6);
    }
    // tronco: inclina para frente ao correr e agachar; balança com a passada
    // (no deslize o quadril já gira para trás; o tronco compensa para olhar à frente)
    b.waist.rotation.x = -0.28 * this.lowT - 0.22 * crouch * (1 - this.slideT) - this.slideT * 0.3;
    b.waist.rotation.y = s * swing * 0.12 * fwdK;
    // inclinação lateral (Q/E) e respiração
    b.waist.rotation.z = -this.lean * 0.22;
    b.chest.rotation.z = -this.lean * 0.2;
    b.chest.rotation.x = this.pitch * 0.35 + Math.sin(this.breath * 1.6) * 0.012;
    b.neck.rotation.x = this.pitch * 0.4;
    // levou tiro: tranco no tronco
    this.flinch = Math.max(0, this.flinch - dt * 5);
    b.chest.rotation.x += this.flinch * 0.22;
    b.neck.rotation.x -= this.flinch * 0.2;

    this.animateWeapon(dt, reloading);
  }

  private animateWeapon(dt: number, reloading: boolean): void {
    const b = this.soldier.bones;
    const pivot = this.soldier.weaponPivot;
    // troca de arma
    if (this.switchT < 1) {
      const before = this.switchT;
      this.switchT = Math.min(1, this.switchT + dt / 0.55);
      if (before < 0.5 && this.switchT >= 0.5) this.equip(this.pendingWeapon);
    }
    const cat = this.weapon?.category;
    const long = cat ? LONG_GUNS.has(cat) : false;
    const pistol = cat === 'pistol';
    let base: WeaponPose;
    if (long || pistol) {
      const aim = long ? POSES.longAim : POSES.pistolAim;
      const hip = long ? POSES.longHip : POSES.pistolHip;
      const low = long ? POSES.longLow : POSES.pistolLow;
      this.blend(hip, aim, this.aimT);
      this.blendInto(low, this.lowT);
      base = this.pose;
    } else {
      base = cat === 'melee' ? POSES.melee : POSES.throwable;
      this.pose.grip.copy(base.grip);
      this.pose.rot.copy(base.rot);
    }

    // olhar para cima/baixo: a arma acompanha o que falta da inclinação do peito
    const pitchRest = this.pitch * 0.65 * (1 - this.lowT * 0.7);
    pivot.position.copy(this.pose.grip);
    pivot.rotation.set(this.pose.rot.x + pitchRest, this.pose.rot.y, this.pose.rot.z);

    // recuo
    this.kick = Math.max(0, this.kick - dt * 9);
    pivot.position.z += this.kick * 0.06;
    pivot.rotation.x += this.kick * 0.14;

    // recarga: inclina a arma; mão de apoio vai ao bolso e volta
    this.reloadT = reloading ? this.reloadT + dt : 0;
    const rel = reloading ? Math.sin(Math.min(1, this.reloadT / 0.3) * Math.PI * 0.5) : 0;
    pivot.rotation.z += rel * 0.45;
    pivot.rotation.x -= rel * 0.25;

    // troca: arma desce e volta
    const sw = this.switchT < 1 ? Math.sin(this.switchT * Math.PI) : 0;
    pivot.rotation.x -= sw * 1.2;
    pivot.position.y -= sw * 0.15;

    // golpe corpo a corpo: arco de cima para baixo
    if (this.meleeT < 1) {
      this.meleeT = Math.min(1, this.meleeT + dt / 0.45);
      const k = this.meleeT;
      const arc = k < 0.35 ? -k / 0.35 : -1 + ((k - 0.35) / 0.65) * 2.2;
      pivot.position.y += 0.25 * Math.max(0, -arc) - 0.1 * Math.max(0, arc);
      pivot.position.z += -0.18 * Math.max(0, arc);
      pivot.rotation.x += -arc * 1.1;
    }
    // arremesso: braço vai para trás e lança por cima
    let throwArm = 0;
    if (this.throwT < 1) {
      this.throwT = Math.min(1, this.throwT + dt / 0.6);
      throwArm = this.throwT < 0.45 ? this.throwT / 0.45 : 1 - (this.throwT - 0.45) / 0.55;
      pivot.position.set(0.22, 0.25 + throwArm * 0.35, -0.1 + throwArm * 0.3 - (this.throwT > 0.45 ? 0.35 * (1 - throwArm) : 0));
    }
    if (this.weapon) this.weapon.root.visible = !(cat === 'throwable' && this.throwT > 0.5 && this.throwT < 1);

    // ── braços por IK até a arma ──
    pivot.updateMatrix();
    // pistola: a mão direita desce pelo cabo (a origem da arma é o topo da empunhadura)
    const right = pistol ? _v.copy(PISTOL_HAND).applyMatrix4(pivot.matrix) : _v.copy(pivot.position);
    solveArmIK(b.shoulderR, b.elbowR, UPPER, LOWER, right, _w.set(0.7, -1, 0.5));
    const support = this.weapon?.support ?? (pistol ? PISTOL_SUPPORT : null);
    if (support && (long || pistol) && this.throwT >= 1) {
      // mão de apoio no guarda-mão (ou envolvendo a pistola)
      const left = support.clone().applyMatrix4(_m.copy(pivot.matrix).multiply(this.holder.matrix));
      if (rel > 0) left.lerp(_w.set(-0.12, 0.05, -0.1), rel * (0.5 + 0.5 * Math.sin(this.reloadT * 5)));
      solveArmIK(b.shoulderL, b.elbowL, UPPER, LOWER, left, _w.set(-0.6, -1, 0.3));
    } else {
      // braço livre: solto ao lado do corpo, balançando na passada
      b.shoulderL.quaternion.setFromEuler(_e.set(-Math.sin(this.phase) * 0.3 + 0.1, 0, -0.12));
      b.elbowL.rotation.set(0.35, 0, 0);
    }
    b.wristR.rotation.x = -0.3;
  }

  /** Pose = mistura de duas poses-chave. */
  private blend(a: WeaponPose, b: WeaponPose, k: number): void {
    this.pose.grip.lerpVectors(a.grip, b.grip, k);
    this.pose.rot.set(lerp(a.rot.x, b.rot.x, k), lerp(a.rot.y, b.rot.y, k), lerp(a.rot.z, b.rot.z, k));
  }

  private blendInto(p: WeaponPose, k: number): void {
    if (k <= 0) return;
    this.pose.grip.lerp(p.grip, k);
    this.pose.rot.set(lerp(this.pose.rot.x, p.rot.x, k), lerp(this.pose.rot.y, p.rot.y, k), lerp(this.pose.rot.z, p.rot.z, k));
  }

  private equip(id: string | null): void {
    this.holder.clear();
    this.weapon = id ? buildThirdPersonWeapon(id, this.attachments) : null;
    this.weaponId = id;
    this.pendingWeapon = null;
    if (this.weapon) this.holder.add(this.weapon.root);
  }

  private spawnModel(): Soldier {
    const soldier = buildSoldier(this.team, skinIndexFor(this.id));
    for (const m of soldier.meshes) m.userData.remote = this;
    this.holder.removeFromParent();
    soldier.weaponPivot.add(this.holder);
    this.holder.updateMatrix();
    this.scene.add(soldier.bones.root);
    if (this.weaponId) this.equip(this.weaponId);
    return soldier;
  }
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const approach = (v: number, target: number, step: number): number => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
