import * as THREE from 'three';
import { glow } from '../core/Glow';

export type ParticleKind = 'dust' | 'spark' | 'fire' | 'smoke' | 'debris';

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: number;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  gravity: number;
  drag: number;
  color: THREE.Color;
}

export interface EmitOptions {
  life: number;
  size: number;
  /** Tamanho final relativo (1 = constante). */
  grow?: number;
  gravity?: number;
  drag?: number;
  color?: THREE.ColorRepresentation;
  /** Variação aleatória de brilho da cor (0..1). */
  colorJitter?: number;
}

const CAPACITY: Record<ParticleKind, number> = { dust: 300, spark: 200, fire: 500, smoke: 300, debris: 200 };

/** Partículas em cubos (estilo voxel) usando InstancedMesh — uma draw call por tipo. */
export class ParticleSystem {
  private readonly pools = new Map<ParticleKind, { mesh: THREE.InstancedMesh; items: Particle[]; next: number }>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats: Record<ParticleKind, THREE.Material> = {
      dust: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      spark: glow(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 5),
      fire: glow(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 3.5),
      smoke: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
      debris: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    };
    for (const kind of Object.keys(CAPACITY) as ParticleKind[]) {
      const cap = CAPACITY[kind];
      const mesh = new THREE.InstancedMesh(geo, mats[kind], cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color());
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = kind === 'debris';
      scene.add(mesh);
      const items: Particle[] = Array.from({ length: cap }, () => ({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: 0,
        life: 0,
        maxLife: 1,
        size0: 1,
        size1: 1,
        gravity: 0,
        drag: 0,
        color: new THREE.Color(),
      }));
      this.pools.set(kind, { mesh, items, next: 0 });
    }
  }

  emit(kind: ParticleKind, pos: THREE.Vector3, vel: THREE.Vector3, o: EmitOptions): void {
    const pool = this.pools.get(kind)!;
    const p = pool.items[pool.next];
    pool.next = (pool.next + 1) % pool.items.length;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    p.spin = (Math.random() - 0.5) * 10;
    p.life = p.maxLife = o.life * (0.75 + Math.random() * 0.5);
    p.size0 = o.size * (0.7 + Math.random() * 0.6);
    p.size1 = p.size0 * (o.grow ?? 0.3);
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 1;
    p.color.set(o.color ?? 0xffffff);
    if (o.colorJitter) p.color.multiplyScalar(1 - Math.random() * o.colorJitter);
  }

  /** Emite `count` partículas numa esfera de velocidades em torno de `dir`. */
  burst(kind: ParticleKind, count: number, pos: THREE.Vector3, dir: THREE.Vector3 | null, speed: number, spread: number, o: EmitOptions): void {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(spread);
      if (dir) v.add(dir).normalize();
      v.multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.emit(kind, pos, v, o);
    }
  }

  update(dt: number): void {
    for (const pool of this.pools.values()) {
      let n = 0;
      for (const p of pool.items) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) continue;
        p.vel.y += p.gravity * dt;
        p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < 0.01 && p.vel.y < 0) {
          p.pos.y = 0.01;
          p.vel.y *= -0.3;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
        }
        p.rot.x += p.spin * dt;
        p.rot.y += p.spin * dt * 0.7;
        const k = 1 - p.life / p.maxLife;
        const size = p.size0 + (p.size1 - p.size0) * k;
        this.q.setFromEuler(p.rot);
        this.m.compose(p.pos, this.q, this.s.setScalar(size));
        pool.mesh.setMatrixAt(n, this.m);
        pool.mesh.setColorAt(n, p.color);
        n++;
      }
      pool.mesh.count = n;
      pool.mesh.instanceMatrix.needsUpdate = true;
      if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    }
  }
}
