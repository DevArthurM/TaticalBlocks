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
 * Ragdoll do zumbi morto: um corpo rígido por segmento ainda preso, ligado por
 * articulações. Os ossos passam a ser dirigidos pela física.
 */
export class Ragdoll {
  age = 0;
  private readonly segments = new Map<string, Segment>();
  private readonly constraints: CANNON.Constraint[] = [];
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
    }
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

  update(dt: number): void {
    this.age += dt;
    if (this.active) this.sync();
  }

  /** Para de simular (fica deitado onde está) — economiza física com muitos corpos. */
  freeze(): void {
    if (!this.active) return;
    this.active = false;
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
