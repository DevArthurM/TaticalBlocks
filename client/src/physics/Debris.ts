import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { PhysicsWorld } from './PhysicsWorld';

interface Piece {
  body: CANNON.Body;
  size: number;
  color: THREE.Color;
  life: number;
}

const CAPACITY = 220;
const LIFETIME = 9;
const FADE = 1.2;

/** Pedaços de voxel com física (caem, quicam, rolam e somem aos poucos). */
export class Debris {
  private readonly mesh: THREE.InstancedMesh;
  private readonly pieces: Piece[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.92 }), CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  get count(): number {
    return this.pieces.length;
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.ColorRepresentation, density = 1800): void {
    if (this.pieces.length >= CAPACITY) this.remove(0);
    const half = size / 2;
    const body = new CANNON.Body({
      mass: Math.max(0.02, size * size * size * density),
      material: this.physics.material,
      shape: new CANNON.Box(new CANNON.Vec3(half, half, half)),
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      velocity: new CANNON.Vec3(vel.x, vel.y, vel.z),
      angularVelocity: new CANNON.Vec3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
      linearDamping: 0.05,
      angularDamping: 0.2,
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 0.6,
    });
    body.quaternion.setFromEuler(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.physics.world.addBody(body);
    this.pieces.push({ body, size, color: new THREE.Color(color), life: LIFETIME * (0.7 + Math.random() * 0.6) });
  }

  update(dt: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      piece.life -= dt;
      if (piece.life <= 0 || piece.body.position.y < -5) this.remove(i);
    }
    this.pieces.forEach((piece, i) => {
      const b = piece.body;
      const shrink = Math.min(1, piece.life / FADE);
      this.p.set(b.position.x, b.position.y, b.position.z);
      this.q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      this.m.compose(this.p, this.q, this.s.setScalar(piece.size * shrink));
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, piece.color);
    });
    this.mesh.count = this.pieces.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Empurra detritos próximos de uma explosão. */
  blast(center: THREE.Vector3, radius: number, strength: number): void {
    for (const { body } of this.pieces) {
      const dx = body.position.x - center.x;
      const dy = body.position.y - center.y;
      const dz = body.position.z - center.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius || d < 1e-3) continue;
      const k = (strength * (1 - d / radius)) / d;
      body.wakeUp();
      body.velocity.x += dx * k;
      body.velocity.y += dy * k + strength * 0.3 * (1 - d / radius);
      body.velocity.z += dz * k;
    }
  }

  private remove(i: number): void {
    this.physics.world.removeBody(this.pieces[i].body);
    this.pieces.splice(i, 1);
  }
}
