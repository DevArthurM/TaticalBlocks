import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { ZombieBones } from './ZombieModel';

/** Ragdolls colidem com o mundo, mas não entre as próprias partes. */
export const RAGDOLL_GROUP = 2;
const WORLD_GROUP = 1;

interface SegmentDef {
  key: string;
  bone: keyof ZombieBones;
  half: [number, number, number];
  /** Centro do segmento no espaço do osso (o osso tem origem na articulação). */
  center: [number, number, number];
  mass: number;
  /** Segmento pai e articulação (osso cuja origem é o pivô). */
  parent?: string;
  pivot?: keyof ZombieBones;
}

const SEGMENTS: SegmentDef[] = [
  { key: 'pelvis', bone: 'pelvis', half: [0.17, 0.13, 0.1], center: [0, 0.06, 0], mass: 14 },
  { key: 'chest', bone: 'chest', half: [0.2, 0.21, 0.11], center: [0, 0.21, 0], mass: 18, parent: 'pelvis', pivot: 'chest' },
  { key: 'head', bone: 'neck', half: [0.13, 0.2, 0.13], center: [0, 0.2, 0], mass: 5, parent: 'chest', pivot: 'neck' },
  { key: 'upperArmL', bone: 'shoulderL', half: [0.065, 0.15, 0.065], center: [0, -0.15, 0], mass: 2.5, parent: 'chest', pivot: 'shoulderL' },
  { key: 'upperArmR', bone: 'shoulderR', half: [0.065, 0.15, 0.065], center: [0, -0.15, 0], mass: 2.5, parent: 'chest', pivot: 'shoulderR' },
  { key: 'forearmL', bone: 'elbowL', half: [0.055, 0.19, 0.05], center: [0, -0.19, 0], mass: 2, parent: 'upperArmL', pivot: 'elbowL' },
  { key: 'forearmR', bone: 'elbowR', half: [0.055, 0.19, 0.05], center: [0, -0.19, 0], mass: 2, parent: 'upperArmR', pivot: 'elbowR' },
  { key: 'thighL', bone: 'hipL', half: [0.075, 0.21, 0.08], center: [0, -0.21, 0], mass: 7, parent: 'pelvis', pivot: 'hipL' },
  { key: 'thighR', bone: 'hipR', half: [0.075, 0.21, 0.08], center: [0, -0.21, 0], mass: 7, parent: 'pelvis', pivot: 'hipR' },
  { key: 'shinL', bone: 'kneeL', half: [0.075, 0.25, 0.1], center: [0, -0.24, -0.02], mass: 4, parent: 'thighL', pivot: 'kneeL' },
  { key: 'shinR', bone: 'kneeR', half: [0.075, 0.25, 0.1], center: [0, -0.24, -0.02], mass: 4, parent: 'thighR', pivot: 'kneeR' },
];

/** Qual segmento do ragdoll recebe o impulso para cada osso atingido. */
const BONE_TO_SEGMENT: Record<string, string> = {
  pelvis: 'pelvis',
  waist: 'pelvis',
  chest: 'chest',
  neck: 'head',
  head: 'head',
  shoulderL: 'upperArmL',
  shoulderR: 'upperArmR',
  elbowL: 'forearmL',
  elbowR: 'forearmR',
  wristL: 'forearmL',
  wristR: 'forearmR',
  hipL: 'thighL',
  hipR: 'thighR',
  kneeL: 'shinL',
  kneeR: 'shinR',
  ankleL: 'shinL',
  ankleR: 'shinR',
};

interface Segment {
  group: THREE.Group;
  body: CANNON.Body;
  center: THREE.Vector3;
}

/**
 * Ligamento de uma articulação: mola com amortecimento que puxa o segmento filho
 * para a postura de repouso em relação ao pai. A tensão cresce de forma não linear
 * ao passar do limite (ligamento esticando). `hinge`: dobradiça (joelho/cotovelo)
 * — só dobra num sentido em torno do eixo X do pai.
 */
interface LigamentDef {
  /** Rigidez em aceleração angular por radiano (frequência própria ≈ √k rad/s). */
  k: number;
  /** Ângulo (rad) a partir do qual a tensão dispara. */
  limit: number;
  /** Faixa de dobra em X (rad, relativa ao pai) e folga lateral. */
  hinge?: { min: number; max: number; side: number };
}

const LIGAMENTS: Record<string, LigamentDef> = {
  chest: { k: 420, limit: 0.55 }, // coluna: firme
  head: { k: 260, limit: 0.7 }, // pescoço
  upperArmL: { k: 70, limit: 1.5 }, // ombros: soltos
  upperArmR: { k: 70, limit: 1.5 },
  forearmL: { k: 90, limit: 1.3, hinge: { min: -0.05, max: 2.5, side: 0.2 } }, // cotovelo dobra para a frente
  forearmR: { k: 90, limit: 1.3, hinge: { min: -0.05, max: 2.5, side: 0.2 } },
  thighL: { k: 260, limit: 1.1 }, // quadril
  thighR: { k: 260, limit: 1.1 },
  shinL: { k: 200, limit: 1.3, hinge: { min: -2.5, max: 0.05, side: 0.15 } }, // joelho dobra para trás
  shinR: { k: 200, limit: 1.3, hinge: { min: -2.5, max: 0.05, side: 0.15 } },
};

/** Tônus muscular logo após a morte (multiplica a rigidez) e quanto tempo leva para sumir. */
const TONE = { start: 1.2, relax: 0.9 };
/** Ligamento: frouxo até `slack` × limite; depois a tensão cresce (rigidez × `gain`). */
const LIGAMENT = { slack: 0.6, gain: 2.5 };
/** Atrito das articulações (fração do amortecimento crítico) — faz o corpo assentar. */
const FRICTION = 0.9;
/** Teto de rigidez efetiva (ω² em rad²/s²) para a integração da física não explodir. */
const MAX_OMEGA2 = 2500;
/** Tensão extra ao passar do limite / fora da faixa da dobradiça. */
const STRETCH = { power: 4, gain: 7, hinge: 380 };

interface Joint {
  a: CANNON.Body;
  b: CANNON.Body;
  def: LigamentDef;
  /** Orientação do filho em relação ao pai no repouso (qa⁻¹·qb). */
  rest: CANNON.Quaternion;
}

// temporários dos ligamentos
const _qa = new CANNON.Quaternion();
const _rel = new CANNON.Quaternion();
const _d = new CANNON.Quaternion();
const _axis = new CANNON.Vec3();
const _t = new CANNON.Vec3();
const _w = new CANNON.Vec3();
const _e = new THREE.Euler();
const _q3 = new THREE.Quaternion();

/**
 * Ragdoll do zumbi morto: um corpo rígido por segmento ainda preso, ligado por
 * articulações. Os ossos passam a ser dirigidos pela física.
 */
export class Ragdoll {
  age = 0;
  private readonly segments = new Map<string, Segment>();
  private readonly constraints: CANNON.Constraint[] = [];
  private readonly joints: Joint[] = [];
  private readonly onPreStep = (): void => this.applyLigaments();
  private active = true;
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(
    private readonly physics: PhysicsWorld,
    scene: THREE.Object3D,
    bones: ZombieBones,
    /** Ossos ainda presos ao corpo (não arrancados). */
    attached: (bone: THREE.Object3D) => boolean,
    velocity: THREE.Vector3,
  ) {
    bones.root.updateMatrixWorld(true);
    for (const def of SEGMENTS) {
      const group = bones[def.bone];
      if (!attached(group)) continue;
      const center = new THREE.Vector3(...def.center);
      const pos = group.localToWorld(center.clone());
      group.getWorldQuaternion(this.q);
      const body = new CANNON.Body({
        mass: def.mass,
        material: physics.material,
        shape: new CANNON.Box(new CANNON.Vec3(...def.half)),
        position: new CANNON.Vec3(pos.x, pos.y, pos.z),
        quaternion: new CANNON.Quaternion(this.q.x, this.q.y, this.q.z, this.q.w),
        velocity: new CANNON.Vec3(velocity.x, velocity.y, velocity.z),
        linearDamping: 0.08,
        angularDamping: 0.35,
        collisionFilterGroup: RAGDOLL_GROUP,
        collisionFilterMask: WORLD_GROUP,
        sleepSpeedLimit: 0.2,
        sleepTimeLimit: 0.8,
      });
      physics.world.addBody(body);
      this.segments.set(def.key, { group, body, center });
    }
    // articulações (ponto a ponto, nos pivôs dos ossos)
    for (const def of SEGMENTS) {
      if (!def.parent || !def.pivot) continue;
      const a = this.segments.get(def.parent);
      const b = this.segments.get(def.key);
      if (!a || !b) continue;
      const pivot = bones[def.pivot].getWorldPosition(new THREE.Vector3());
      const c = new CANNON.PointToPointConstraint(
        a.body,
        a.body.pointToLocalFrame(new CANNON.Vec3(pivot.x, pivot.y, pivot.z)),
        b.body,
        b.body.pointToLocalFrame(new CANNON.Vec3(pivot.x, pivot.y, pivot.z)),
      );
      physics.world.addConstraint(c);
      this.constraints.push(c);
      // ligamento elástico: repouso = postura no instante da morte
      const lig = LIGAMENTS[def.key];
      if (lig) {
        const rest = a.body.quaternion.conjugate().mult(b.body.quaternion);
        this.joints.push({ a: a.body, b: b.body, def: lig, rest });
      }
    }
    physics.world.addEventListener('preStep', this.onPreStep);
    // os ossos de cada segmento passam a viver soltos na cena (posição vem da física)
    for (const s of this.segments.values()) scene.attach(s.group);
    this.sync();
  }

  /** Impulso no segmento atingido (ponto em coordenadas de mundo). */
  impulse(boneName: string, point: THREE.Vector3, impulse: THREE.Vector3): void {
    const seg = this.segments.get(BONE_TO_SEGMENT[boneName] ?? 'chest') ?? this.segments.get('pelvis');
    if (!seg) return;
    const b = seg.body;
    b.wakeUp();
    b.applyImpulse(
      new CANNON.Vec3(impulse.x, impulse.y, impulse.z),
      new CANNON.Vec3(point.x - b.position.x, point.y - b.position.y, point.z - b.position.z),
    );
  }

  /** Explosão: empurra todos os segmentos para fora e para cima. */
  blast(center: THREE.Vector3, radius: number, strength: number): void {
    for (const { body } of this.segments.values()) {
      this.v.set(body.position.x - center.x, body.position.y - center.y, body.position.z - center.z);
      const d = this.v.length();
      if (d > radius) continue;
      const k = strength * (1 - d / radius) * body.mass;
      this.v.normalize();
      this.v.y += 0.8;
      this.v.normalize().multiplyScalar(k);
      body.wakeUp();
      body.applyImpulse(new CANNON.Vec3(this.v.x, this.v.y, this.v.z));
    }
  }

  /** Segundos desde que caiu ou levou o último tiro (para congelar quando assentar). */
  sinceWake = 0;

  update(dt: number): void {
    this.age += dt;
    this.sinceWake += dt;
    if (this.active) this.sync();
  }

  /** Acorda (levou tiro depois de morto): se estava congelado, volta a simular. */
  wake(): void {
    this.sinceWake = 0;
    if (!this.active) {
      this.active = true;
      for (const s of this.segments.values()) this.physics.world.addBody(s.body);
      for (const c of this.constraints) this.physics.world.addConstraint(c);
      this.physics.world.addEventListener('preStep', this.onPreStep);
    }
    for (const s of this.segments.values()) s.body.wakeUp();
  }

  /**
   * Tensão dos ligamentos (a cada passo da física): cada articulação puxa o filho de
   * volta à postura de repouso, com amortecimento; passando do limite a tensão cresce
   * muito (o ligamento estica). Dobradiças não dobram para o lado errado. O tônus
   * começa alto (o corpo ainda "segura") e relaxa até sobrar só o ligamento.
   */
  private applyLigaments(): void {
    // músculo: ainda segura o corpo logo após a morte e some com o tempo
    const muscle = TONE.start * Math.exp(-this.age / TONE.relax);
    for (const j of this.joints) {
      const { a, b, def } = j;
      if (a.sleepState === CANNON.Body.SLEEPING && b.sleepState === CANNON.Body.SLEEPING) continue;
      a.quaternion.conjugate(_qa);
      _qa.mult(b.quaternion, _rel); // filho no espaço do pai
      // rotação que leva a postura atual à de repouso (no espaço do pai)
      _rel.conjugate(_d);
      j.rest.mult(_d, _d);
      if (_d.w < 0) {
        _d.x = -_d.x;
        _d.y = -_d.y;
        _d.z = -_d.z;
        _d.w = -_d.w;
      }
      const angle = 2 * Math.acos(Math.min(1, _d.w));
      const sinHalf = Math.sqrt(Math.max(0, 1 - _d.w * _d.w));
      _t.set(0, 0, 0);
      if (sinHalf > 1e-5) {
        // aceleração angular (rad/s²): músculo (proporcional) + ligamento (só esticado, não linear)
        let acc = def.k * muscle * angle;
        const slack = def.limit * LIGAMENT.slack;
        if (angle > slack) {
          const stretch = (angle - slack) / (def.limit - slack);
          acc += def.k * LIGAMENT.gain * (angle - slack) * (1 + STRETCH.gain * Math.pow(stretch, STRETCH.power));
        }
        acc = Math.min(acc, MAX_OMEGA2 * angle);
        _axis.set(_d.x / sinHalf, _d.y / sinHalf, _d.z / sinHalf);
        a.quaternion.vmult(_axis, _axis); // eixo no mundo
        _t.set(_axis.x * acc, _axis.y * acc, _axis.z * acc);
      }
      // dobradiça: fora da faixa em X ou torcendo de lado → ligamento duro
      let hingeHit = false;
      if (def.hinge) {
        _q3.set(_rel.x, _rel.y, _rel.z, _rel.w);
        _e.setFromQuaternion(_q3, 'XYZ');
        const h = def.hinge;
        const push = (excess: number, lx: number, ly: number, lz: number) => {
          hingeHit = true;
          _axis.set(lx, ly, lz);
          a.quaternion.vmult(_axis, _axis);
          _t.x += _axis.x * excess * STRETCH.hinge;
          _t.y += _axis.y * excess * STRETCH.hinge;
          _t.z += _axis.z * excess * STRETCH.hinge;
        };
        if (_e.x < h.min) push(h.min - _e.x, 1, 0, 0);
        else if (_e.x > h.max) push(h.max - _e.x, 1, 0, 0);
        if (Math.abs(_e.y) > h.side) push(Math.sign(_e.y) * h.side - _e.y, 0, 1, 0);
        if (Math.abs(_e.z) > h.side) push(Math.sign(_e.z) * h.side - _e.z, 0, 0, 1);
      }
      // atrito da articulação: amortece a velocidade relativa (faz o corpo assentar)
      // (encostada no limite da dobradiça, o amortecimento acompanha a rigidez dela)
      const c = 2 * Math.sqrt(hingeHit ? Math.max(def.k, STRETCH.hinge) : def.k) * FRICTION;
      b.angularVelocity.vsub(a.angularVelocity, _w);
      _t.x -= _w.x * c;
      _t.y -= _w.y * c;
      _t.z -= _w.z * c;
      // teto de aceleração (estabilidade com passo de 1/60 s)
      const tl = _t.length();
      const aMax = MAX_OMEGA2 * 1.2;
      if (tl > aMax) _t.scale(aMax / tl, _t);
      // aceleração relativa → torque com a inércia reduzida do par na direção dela:
      // filho e pai recebem torques opostos (ação e reação) e a aceleração RELATIVA é exatamente α
      const mag = _t.length();
      if (mag < 1e-6) continue;
      const Ib = this.inertiaAlong(b, _t, mag);
      const Ia = this.inertiaAlong(a, _t, mag);
      const reduced = (Ia * Ib) / (Ia + Ib);
      this.tl.set(_t.x * reduced, _t.y * reduced, _t.z * reduced);
      b.torque.vadd(this.tl, b.torque);
      a.torque.vsub(this.tl, a.torque);
    }
  }

  private readonly tl = new CANNON.Vec3();
  private readonly tq = new CANNON.Quaternion();
  private readonly td = new CANNON.Vec3();
  /** Momento de inércia do corpo em torno da direção (mundo) de `v` (|v| = `len`). */
  private inertiaAlong(body: CANNON.Body, v: CANNON.Vec3, len: number): number {
    body.quaternion.conjugate(this.tq);
    this.tq.vmult(v, this.td);
    const I = body.inertia;
    const x = this.td.x / len;
    const y = this.td.y / len;
    const z = this.td.z / len;
    return I.x * x * x + I.y * y * y + I.z * z * z;
  }

  /** Para de simular (fica deitado onde está) — economiza física com muitos corpos. */
  freeze(): void {
    if (!this.active) return;
    this.active = false;
    this.physics.world.removeEventListener('preStep', this.onPreStep);
    for (const c of this.constraints) this.physics.world.removeConstraint(c);
    for (const s of this.segments.values()) this.physics.world.removeBody(s.body);
  }

  dispose(): void {
    this.freeze();
    for (const s of this.segments.values()) s.group.removeFromParent();
  }

  get isActive(): boolean {
    return this.active;
  }

  private sync(): void {
    for (const s of this.segments.values()) {
      const b = s.body;
      s.group.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      this.v.copy(s.center).applyQuaternion(s.group.quaternion);
      s.group.position.set(b.position.x - this.v.x, b.position.y - this.v.y, b.position.z - this.v.z);
    }
  }
}
