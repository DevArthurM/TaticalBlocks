import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { seededRandom } from '../core/math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createCrateTexture } from '../textures/WorldTextures';

interface Crate {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  /** Caixa de colisão (eixos alinhados) usada pelo jogador. */
  aabb: THREE.Box3;
  half: number;
}

/** Densidade da madeira (kg/m³) — caixa de 0,8 m ≈ 30 kg com o miolo vazio. */
const DENSITY = 60;

/**
 * Caixas de madeira com física: caem, empilham, tombam, recebem impulso de tiros e
 * explosões e podem ser empurradas pelo jogador (e usadas como plataforma).
 */
export class Crates {
  /** AABBs das caixas — incluídas nos colisores do mundo e atualizadas todo quadro. */
  readonly colliders: THREE.Box3[] = [];
  readonly meshes: THREE.Mesh[] = [];
  private readonly crates: Crate[] = [];
  private readonly byMesh = new Map<THREE.Object3D, Crate>();
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly mat = new THREE.MeshStandardMaterial({ map: createCrateTexture(), roughness: 0.85 });
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    obstacles: readonly THREE.Box3[],
    /** Posições definidas pelo mapa; sem elas, espalha ao acaso. */
    layout?: readonly { x: number; z: number; size: number; stack?: number }[],
    seed = 4242,
  ) {
    if (layout?.length) {
      for (const c of layout)
        for (let i = 0; i < (c.stack ?? 1); i++) this.add(c.x, c.size * (i + 0.5) + 0.01 * (i + 1), c.z, c.size, obstacles);
    } else this.place(obstacles, seed);
  }

  /** Copia física → malhas e atualiza as AABBs. */
  update(): void {
    for (const c of this.crates) {
      const b = c.body;
      c.mesh.position.set(b.position.x, b.position.y, b.position.z);
      c.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      c.mesh.updateMatrixWorld();
      c.aabb.setFromObject(c.mesh);
      // um pouco menor: caixas inclinadas não devem "segurar" o jogador no ar
      c.aabb.expandByScalar(-0.03);
    }
  }

  /** Tiro/golpe: impulso no ponto atingido (gera giro realista). */
  hit(hit: THREE.Intersection, dir: THREE.Vector3, damage: number): boolean {
    const c = this.byMesh.get(hit.object);
    if (!c) return false;
    const strength = damage * 0.55;
    const rel = new CANNON.Vec3(hit.point.x - c.body.position.x, hit.point.y - c.body.position.y, hit.point.z - c.body.position.z);
    c.body.wakeUp();
    c.body.applyImpulse(new CANNON.Vec3(dir.x * strength, dir.y * strength, dir.z * strength), rel);
    return true;
  }

  /** Explosão: empurra para fora e para cima, com giro. */
  blast(center: THREE.Vector3, radius: number, strength: number): void {
    for (const c of this.crates) {
      const p = c.body.position;
      this.tmp.set(p.x - center.x, p.y - center.y, p.z - center.z);
      const d = this.tmp.length();
      if (d > radius) continue;
      const k = strength * (1 - d / radius) * c.body.mass;
      this.tmp.normalize();
      this.tmp.y += 0.6;
      this.tmp.normalize().multiplyScalar(k);
      c.body.wakeUp();
      const off = new CANNON.Vec3((Math.random() - 0.5) * c.half, (Math.random() - 0.5) * c.half, (Math.random() - 0.5) * c.half);
      c.body.applyImpulse(new CANNON.Vec3(this.tmp.x, this.tmp.y, this.tmp.z), off);
    }
  }

  /**
   * O jogador encostando empurra a caixa na direção em que anda.
   * `vel` = velocidade que o jogador queria ter (antes de colidir).
   */
  push(pos: THREE.Vector3, radius: number, height: number, vel: THREE.Vector3): void {
    const speed = Math.hypot(vel.x, vel.z);
    if (speed < 0.3) return;
    const player = new THREE.Box3(
      new THREE.Vector3(pos.x - radius - 0.08, pos.y + 0.05, pos.z - radius - 0.08),
      new THREE.Vector3(pos.x + radius + 0.08, pos.y + height, pos.z + radius + 0.08),
    );
    for (const c of this.crates) {
      if (!player.intersectsBox(c.aabb)) continue;
      // só empurra caixas à frente do movimento (não as que estão embaixo dos pés)
      if (c.aabb.max.y <= pos.y + 0.1) continue;
      const dx = c.body.position.x - pos.x;
      const dz = c.body.position.z - pos.z;
      const along = (dx * vel.x + dz * vel.z) / (Math.hypot(dx, dz) * speed || 1);
      if (along < 0.3) continue;
      c.body.wakeUp();
      // caixas leves acompanham quase na velocidade do jogador; pesadas, mais devagar
      const follow = Math.min(1, 40 / c.body.mass) * 0.85;
      c.body.velocity.x += (vel.x * follow - c.body.velocity.x) * 0.5;
      c.body.velocity.z += (vel.z * follow - c.body.velocity.z) * 0.5;
    }
  }

  private place(obstacles: readonly THREE.Box3[], seed: number): void {
    const rnd = seededRandom(seed);
    // pirâmide perto do spawn
    const S = 0.8;
    const base: [number, number][] = [
      [-1, 0],
      [0, 0],
      [1, 0],
    ];
    base.forEach(([i]) => this.add(5 + i * (S + 0.02), S / 2, -6, S, obstacles));
    [-0.5, 0.5].forEach((i) => this.add(5 + i * (S + 0.02), S * 1.5 + 0.01, -6, S, obstacles));
    this.add(5, S * 2.5 + 0.02, -6, S, obstacles);
    // pilha de duas e algumas soltas
    this.add(-4, 0.35, 5, 0.7, obstacles);
    this.add(-4, 1.06, 5, 0.7, obstacles);
    for (let n = 0, tries = 0; n < 12 && tries < 200; tries++) {
      const size = rnd() < 0.5 ? 0.6 : 0.8;
      const a = rnd() * Math.PI * 2;
      const r = 5 + rnd() * 22;
      if (this.add(Math.cos(a) * r, size / 2 + 0.01, Math.sin(a) * r, size, obstacles, rnd() * Math.PI)) n++;
    }
  }

  private add(x: number, y: number, z: number, size: number, obstacles: readonly THREE.Box3[], yaw = 0): boolean {
    const half = size / 2;
    const probe = new THREE.Box3(new THREE.Vector3(x - half, y - half, z - half), new THREE.Vector3(x + half, y + half, z + half));
    if (obstacles.some((o) => o.intersectsBox(probe))) return false;
    if (this.crates.some((c) => c.aabb.intersectsBox(probe.clone().expandByScalar(-0.02)))) return false;

    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.scale.setScalar(size);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const body = new CANNON.Body({
      mass: size * size * size * DENSITY,
      material: this.physics.material,
      shape: new CANNON.Box(new CANNON.Vec3(half, half, half)),
      position: new CANNON.Vec3(x, y, z),
      linearDamping: 0.08,
      angularDamping: 0.12,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.5,
    });
    body.quaternion.setFromEuler(0, yaw, 0);
    this.physics.world.addBody(body);
    const crate: Crate = { mesh, body, aabb: probe.clone(), half };
    this.crates.push(crate);
    this.byMesh.set(mesh, crate);
    this.meshes.push(mesh);
    this.colliders.push(crate.aabb);
    return true;
  }
}
