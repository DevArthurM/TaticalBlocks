import * as THREE from 'three';
import type { SoundEngine } from '../../audio/SoundEngine';
import type { Decals } from '../../effects/Decals';
import type { ParticleSystem } from '../../effects/ParticleSystem';
import type { Debris } from '../../physics/Debris';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { World } from '../World';
import { type DestructibleMaterial, VOXEL_MATERIALS, voxelMaterial } from './materials';
import { VoxelBlock } from './VoxelBlock';

/** Limites de detritos com física por evento (o resto vira partícula). */
const MAX_PHYSICS_PER_SHOT = 10;
const MAX_PHYSICS_PER_COLLAPSE = 70;
/** Dano que um tiro causa por ponto de dano da arma. */
const SHOT_POWER = 0.1;
/** Dano no centro de uma explosão. */
const BLAST_POWER = 40;

/**
 * Destruição do mapa em voxels: cada material tem resistência própria; tiros e
 * explosões tiram vida dos voxels, o que fica sem apoio desaba (inclusive tetos e
 * blocos apoiados em outros). Colisores, física e raycast seguem os voxels.
 */
export class DestructionSystem {
  private readonly blocks: VoxelBlock[] = [];
  private readonly byObject = new Map<THREE.Object3D, VoxelBlock>();
  private readonly fixedColliders: THREE.Box3[] = [];
  private readonly materials: Record<DestructibleMaterial, THREE.MeshStandardMaterial>;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();

  constructor(
    private readonly world: World,
    private readonly physics: PhysicsWorld,
    private readonly debris: Debris,
    private readonly particles: ParticleSystem,
    private readonly decals: Decals,
    private readonly audio: SoundEngine,
    /** Colisores extras dinâmicos (ex.: caixas de madeira), mantidos no fim da lista. */
    private readonly extraColliders: THREE.Box3[] = [],
  ) {
    const mk = (id: DestructibleMaterial) =>
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: VOXEL_MATERIALS[id].roughness, metalness: VOXEL_MATERIALS[id].metalness });
    this.materials = { concrete: mk('concrete'), wood: mk('wood'), metal: mk('metal'), plastic: mk('plastic') };

    for (const b of world.blocks) {
      const mat = b.data.id.startsWith('wall-') ? null : voxelMaterial(b.data.material);
      if (!mat) {
        // borda do mapa: indestrutível
        this.fixedColliders.push(b.bounds.clone());
        physics.setStatic(b.data.id, [b.bounds]);
        continue;
      }
      const block = new VoxelBlock(b.data.id, b.bounds, b.mesh, mat, b.data.color);
      this.blocks.push(block);
      this.byObject.set(b.mesh, block);
      // todo o mapa já nasce em voxels (materiais visíveis desde o início)
      this.voxelize(block);
      physics.setStatic(block.id, block.colliders);
    }
    this.rebuildColliderList();
  }

  /** Total de voxels do mapa (diagnóstico). */
  get voxelCount(): number {
    return this.blocks.reduce((n, b) => n + b.solid.length, 0);
  }

  /** Tiro/golpe acertou algo: se for um bloco, causa dano. Retorna true se tratou. */
  hit(hit: THREE.Intersection, dir: THREE.Vector3, damage: number): boolean {
    const block = this.byObject.get(hit.object);
    if (!block || !hit.face) return false;
    const mat = block.material;
    const radius = THREE.MathUtils.clamp(0.14 + damage * 0.006, 0.18, 0.6) * mat.spread;
    const normal = hit.face.normal;
    // ponto um pouco para dentro da superfície
    const inside = this.tmp.copy(hit.point).addScaledVector(normal, -0.02);
    const removed = this.carve(block, inside, radius, damage * SHOT_POWER, normal, dir, 2.5 + damage * 0.03, MAX_PHYSICS_PER_SHOT);
    this.impactFx(block, hit.point, normal, removed > 0);
    return true;
  }

  /** Explosão: crateras esféricas em todos os blocos no raio. */
  explode(center: THREE.Vector3, radius: number): void {
    for (const block of this.blocks) {
      if (block.destroyed) continue;
      const r = radius * 0.32 * block.material.spread;
      if (block.bounds.distanceToPoint(center) > r) continue;
      const out = this.tmp2.subVectors(block.bounds.getCenter(this.tmp2), center).normalize();
      this.carve(block, center, r, BLAST_POWER, out, out, 7, 30, 0.45);
    }
  }

  /** Aplica as mudanças pendentes uma vez por quadro (em cascata: tetos, pilhas). */
  update(): void {
    let changed = false;
    for (let pass = 0; pass < 8; pass++) {
      const pending = this.blocks.filter((b) => b.dirty || b.recheck);
      if (!pending.length) break;
      for (const block of pending) {
        let structural = block.dirty;
        block.dirty = false;
        block.recheck = false;
        // o que perdeu apoio (ou passou do vão máximo) desaba como detrito
        const loose = block.unsupported((i) => this.isAnchored(block, i));
        if (loose.length) {
          block.remove(loose);
          block.dirty = false;
          structural = true;
          this.spawnDebris(block, loose, null, null, 1, MAX_PHYSICS_PER_COLLAPSE);
          this.audio.play(block.material.sound, Math.min(1, 0.4 + loose.length / 60));
        }
        if (!structural) continue;
        changed = true;
        block.rebuildColliders();
        this.physics.setStatic(block.id, block.colliders);
        // blocos encostados (em cima ou ao lado) precisam reavaliar o apoio
        for (const other of this.blocks) if (other !== block && !other.destroyed && this.touches(other, block)) other.recheck = true;
      }
    }
    if (changed) this.rebuildColliderList();
  }

  // ───────────────────────────────────────────

  private carve(
    block: VoxelBlock,
    center: THREE.Vector3,
    radius: number,
    power: number,
    normal: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
    maxPhysics: number,
    roughness = 0.35,
  ): number {
    if (!block.voxelized) this.voxelize(block);
    const seed = block.cellAt(center);
    const removed = block.carve(center, radius, power, seed, roughness);
    if (!removed.length) return 0;
    this.decals.clearNear(center, radius + 0.15);
    this.spawnDebris(block, removed, normal, dir, speed, maxPhysics);
    return removed.length;
  }

  /**
   * Voxel da borda está apoiado? Chão embaixo, ou voxel de outro bloco encostado
   * embaixo ou ao lado (vergas, peitoris e tetos se apoiam nas paredes).
   */
  private isAnchored(block: VoxelBlock, i: number): boolean {
    const [x, y, z] = block.coords(i);
    if (y === 0 && block.min.y < 0.05) return true;
    const c = block.center(i, this.tmp2);
    const h = block.cell;
    const probes: [boolean, number, number, number][] = [
      [y === 0, 0, -h.y / 2 - 0.01, 0],
      [x === 0, -h.x / 2 - 0.01, 0, 0],
      [x === block.nx - 1, h.x / 2 + 0.01, 0, 0],
      [z === 0, 0, 0, -h.z / 2 - 0.01],
      [z === block.nz - 1, 0, 0, h.z / 2 + 0.01],
    ];
    for (const [onFace, dx, dy, dz] of probes) {
      if (!onFace) continue;
      this.probe.set(c.x + dx, c.y + dy, c.z + dz);
      for (const other of this.blocks) {
        if (other === block || !other.bounds.containsPoint(this.probe)) continue;
        const j = other.cellAt(this.probe);
        if (j !== null && other.solid[j]) return true;
      }
    }
    return false;
  }

  /** Blocos encostados (face com face). */
  private touches(a: VoxelBlock, b: VoxelBlock): boolean {
    return a.bounds.clone().expandByScalar(0.02).intersectsBox(b.bounds);
  }

  /** Efeito e som de impacto característicos do material. */
  private impactFx(block: VoxelBlock, point: THREE.Vector3, normal: THREE.Vector3, broke: boolean): void {
    const fx = block.material.impact;
    const p = this.tmp2.copy(point).addScaledVector(normal, 0.03);
    if (fx.sparks) this.particles.burst('spark', fx.sparks, p, normal, 7, 1.1, { life: 0.22, size: 0.018, grow: 0.4, gravity: -9, drag: 1, color: 0xffd28a });
    if (fx.dust) this.particles.burst('dust', fx.dust, p, normal, 1.6, 0.9, { life: 0.5, size: 0.045, grow: 0.4, gravity: -2, drag: 3, color: fx.dustColor, colorJitter: 0.2 });
    if (fx.chips) {
      const i = block.cellAt(this.tmp.copy(point).addScaledVector(normal, -0.02));
      const color = i !== null ? block.colors[i] : new THREE.Color(block.material.baseColor);
      this.particles.burst('debris', fx.chips, p, normal, 3, 1.2, { life: 0.7, size: 0.03, grow: 0.8, gravity: -14, drag: 0.6, color });
    }
    this.audio.play(block.material.sound, broke ? 0.55 : 0.4);
  }

  /** Voxels removidos viram detritos: alguns com física, o resto partículas. */
  private spawnDebris(
    block: VoxelBlock,
    indices: readonly number[],
    normal: THREE.Vector3 | null,
    dir: THREE.Vector3 | null,
    speed: number,
    maxPhysics: number,
  ): void {
    const size = Math.min(block.cell.x, block.cell.y, block.cell.z) * 0.92;
    const density = block.material.density;
    const vel = new THREE.Vector3();
    const order = [...indices].sort(() => Math.random() - 0.5);
    order.forEach((i, n) => {
      const pos = block.center(i, this.tmp);
      vel.set((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
      if (normal) vel.addScaledVector(normal, speed * (0.5 + Math.random()));
      if (dir) vel.addScaledVector(dir, speed * 0.25);
      const color = block.colors[i];
      if (n < maxPhysics) {
        this.debris.spawn(pos, vel, size * (0.6 + Math.random() * 0.4), color, density);
      } else {
        this.particles.emit('debris', pos, vel, { life: 1.1, size: size * 0.5, grow: 0.6, gravity: -14, drag: 0.5, color });
      }
      if (n % 3 === 0) {
        this.particles.emit('dust', pos, vel.multiplyScalar(0.3), {
          life: 0.8,
          size: size * 0.9,
          grow: 2.2,
          gravity: 0.3,
          drag: 2,
          color: block.material.impact.dustColor,
        });
      }
    });
  }

  private voxelize(block: VoxelBlock): void {
    const mesh = block.voxelize(this.materials[block.material.id]);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    this.world.root.add(mesh);
    const targets = this.world.hitTargets;
    const at = targets.indexOf(block.intact);
    if (at >= 0) targets[at] = mesh;
    else targets.push(mesh);
    this.byObject.set(mesh, block);
  }

  /** Reescreve a lista de colisores compartilhada (mesmo array usado pelo jogador etc.). */
  private rebuildColliderList(): void {
    const list = this.world.colliders;
    list.length = 0;
    list.push(...this.fixedColliders);
    for (const b of this.blocks) list.push(...b.colliders);
    list.push(...this.extraColliders);
  }
}
