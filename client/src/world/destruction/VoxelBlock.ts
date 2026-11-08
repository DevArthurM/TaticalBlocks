import * as THREE from 'three';
import { seededRandom } from '../../core/math';
import type { VoxelMaterial } from './materials';

/** Tamanho alvo de cada voxel (m). O tamanho real se ajusta para dividir a caixa. */
export const VOXEL_SIZE = 0.25;


export interface GridHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  index: number;
}

/**
 * Uma caixa destrutível. Começa como malha inteira; no primeiro dano vira uma grade de
 * voxels (InstancedMesh). Guarda quais voxels existem, gera colisores fundindo voxels
 * em cuboides e faz raycast percorrendo a grade (DDA).
 */
/** Hash [0,1) do voxel e do centro do impacto (quantizado em 1/64 m). */
function edgeNoise(i: number, c: THREE.Vector3): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(Math.round(c.x * 64), 668265263) ^ Math.imul(Math.round(c.y * 64), 2147483647) ^ Math.imul(Math.round(c.z * 64), 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class VoxelBlock {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly cell: THREE.Vector3;
  readonly min: THREE.Vector3;
  readonly solid: Uint8Array;
  readonly colors: THREE.Color[];
  /** Vida de cada voxel (material define o máximo). */
  readonly hp: Float32Array;
  /** Colisores atuais (cuboides fundidos). */
  colliders: THREE.Box3[];
  instanced: THREE.InstancedMesh | null = null;
  /** Perdeu voxels (estrutura mudou). */
  dirty = false;
  /** Um vizinho mudou: reavaliar o apoio. */
  recheck = false;
  private alive: number;

  private readonly m = new THREE.Matrix4();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly id: string,
    readonly bounds: THREE.Box3,
    readonly intact: THREE.Mesh,
    readonly material: VoxelMaterial,
    tint?: number,
  ) {
    const size = bounds.getSize(new THREE.Vector3());
    this.nx = Math.max(1, Math.round(size.x / VOXEL_SIZE));
    this.ny = Math.max(1, Math.round(size.y / VOXEL_SIZE));
    this.nz = Math.max(1, Math.round(size.z / VOXEL_SIZE));
    this.cell = new THREE.Vector3(size.x / this.nx, size.y / this.ny, size.z / this.nz);
    this.min = bounds.min.clone();
    const n = this.nx * this.ny * this.nz;
    this.solid = new Uint8Array(n).fill(1);
    this.alive = n;
    this.colliders = [bounds.clone()];

    this.hp = new Float32Array(n).fill(material.hp);

    // cor por material e por profundidade em relação à superfície original
    const base = new THREE.Color(tint ?? material.baseColor);
    const rnd = seededRandom(hashId(id));
    const longAxis = this.nx >= this.nz ? 'x' : 'z';
    this.colors = new Array(n);
    for (let z = 0; z < this.nz; z++)
      for (let y = 0; y < this.ny; y++)
        for (let x = 0; x < this.nx; x++) {
          const depth = Math.min(x, this.nx - 1 - x, this.ny - 1 - y, y, z, this.nz - 1 - z);
          this.colors[this.index(x, y, z)] = material.color(base, { x, y, z, depth, longAxis, rnd });
        }
  }

  get voxelized(): boolean {
    return this.instanced !== null;
  }

  get destroyed(): boolean {
    return this.alive === 0;
  }

  index(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z);
  }

  coords(i: number): [number, number, number] {
    const x = i % this.nx;
    const y = Math.floor(i / this.nx) % this.ny;
    const z = Math.floor(i / (this.nx * this.ny));
    return [x, y, z];
  }

  center(i: number, out: THREE.Vector3): THREE.Vector3 {
    const [x, y, z] = this.coords(i);
    return out.set(this.min.x + (x + 0.5) * this.cell.x, this.min.y + (y + 0.5) * this.cell.y, this.min.z + (z + 0.5) * this.cell.z);
  }

  /** Troca a malha inteira pela grade de voxels. */
  voxelize(material: THREE.Material): THREE.InstancedMesh {
    const n = this.solid.length;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, n);
    mesh.name = `${this.id}-voxels`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const s = this.cell;
    for (let i = 0; i < n; i++) {
      if (!this.solid[i]) {
        mesh.setMatrixAt(i, this.zero);
      } else {
        this.center(i, this.tmp);
        this.m.makeScale(s.x, s.y, s.z).setPosition(this.tmp);
        mesh.setMatrixAt(i, this.m);
      }
      mesh.setColorAt(i, this.colors[i]);
    }
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    // raycast próprio pela grade: muito mais rápido que testar cada instância
    mesh.raycast = (raycaster, intersects) => {
      const hit = this.raycastGrid(raycaster.ray, raycaster.near, raycaster.far);
      if (hit) {
        intersects.push({
          distance: hit.distance,
          point: hit.point,
          object: mesh,
          instanceId: hit.index,
          face: { a: 0, b: 0, c: 0, normal: hit.normal, materialIndex: 0 },
        } as THREE.Intersection);
      }
    };
    this.instanced = mesh;
    this.intact.visible = false;
    return mesh;
  }

  /** Volta ao bloco inteiro (nova partida): todos os voxels de volta, vida cheia. */
  reset(): void {
    this.solid.fill(1);
    this.hp.fill(this.material.hp);
    this.alive = this.solid.length;
    this.colliders = [this.bounds.clone()];
    this.dirty = false;
    this.recheck = false;
    const mesh = this.instanced;
    if (!mesh) return;
    const s = this.cell;
    for (let i = 0; i < this.solid.length; i++) {
      this.center(i, this.tmp);
      this.m.makeScale(s.x, s.y, s.z).setPosition(this.tmp);
      mesh.setMatrixAt(i, this.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Índice do voxel que contém `p` (ou null fora da grade). */
  cellAt(p: THREE.Vector3): number | null {
    const x = Math.floor((p.x - this.min.x) / this.cell.x);
    const y = Math.floor((p.y - this.min.y) / this.cell.y);
    const z = Math.floor((p.z - this.min.z) / this.cell.z);
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return null;
    return this.index(x, y, z);
  }

  /**
   * Dano "orgânico": cada voxel dentro da esfera perde vida conforme a distância
   * (com ruído na borda). `seed` recebe o golpe cheio. Voxels sem vida somem;
   * os que resistem escurecem (amassado). Retorna os índices removidos.
   */
  carve(center: THREE.Vector3, radius: number, power: number, seed: number | null, roughness = 0.35): number[] {
    const removed: number[] = [];
    let damaged = false;
    const r = radius + Math.max(this.cell.x, this.cell.y, this.cell.z);
    const x0 = Math.max(0, Math.floor((center.x - r - this.min.x) / this.cell.x));
    const x1 = Math.min(this.nx - 1, Math.floor((center.x + r - this.min.x) / this.cell.x));
    const y0 = Math.max(0, Math.floor((center.y - r - this.min.y) / this.cell.y));
    const y1 = Math.min(this.ny - 1, Math.floor((center.y + r - this.min.y) / this.cell.y));
    const z0 = Math.max(0, Math.floor((center.z - r - this.min.z) / this.cell.z));
    const z1 = Math.min(this.nz - 1, Math.floor((center.z + r - this.min.z) / this.cell.z));
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = this.index(x, y, z);
          if (!this.solid[i]) continue;
          const d = this.center(i, this.tmp).distanceTo(center) / radius;
          // queda quadrática: o miolo da esfera leva quase o dano cheio
          // ruído determinístico (voxel + ponto do impacto): o mesmo tiro abre o mesmo buraco em todas as máquinas
          let falloff = 1 - d * d + (edgeNoise(i, center) - 0.5) * 2 * roughness;
          if (i === seed) falloff = Math.max(falloff, 1);
          if (falloff <= 0) continue;
          this.hp[i] -= power * Math.min(1, falloff);
          if (this.hp[i] <= 0) removed.push(i);
          else {
            damaged = true;
            const k = 0.5 + 0.5 * (this.hp[i] / this.material.hp);
            this.instanced?.setColorAt(i, this.colors[i].clone().multiplyScalar(k));
          }
        }
    if (damaged && this.instanced?.instanceColor) this.instanced.instanceColor.needsUpdate = true;
    this.remove(removed);
    return removed;
  }

  remove(indices: readonly number[]): void {
    for (const i of indices) {
      if (!this.solid[i]) continue;
      this.solid[i] = 0;
      this.alive--;
      this.instanced?.setMatrixAt(i, this.zero);
    }
    if (this.instanced && indices.length) this.instanced.instanceMatrix.needsUpdate = true;
    if (indices.length) this.dirty = true;
  }

  /**
   * Voxels que devem cair: sem ligação com a base OU longe demais (em vão horizontal)
   * de um apoio. Busca 0-1: subir/descer não conta distância, andar na horizontal
   * soma 1 voxel. `anchored(i)` diz se um voxel da borda do bloco está apoiado
   * (chão embaixo, ou voxel de outro bloco encostado embaixo/ao lado).
   */
  unsupported(anchored: (i: number) => boolean = () => true): number[] {
    const n = this.solid.length;
    const maxSpan = Math.round(this.material.maxSpan / Math.min(this.cell.x, this.cell.z));
    const dist = new Int32Array(n).fill(-1);
    // deque simples com dois arrays (frente = custo 0, trás = custo 1)
    let front: number[] = [];
    let back: number[] = [];
    for (let z = 0; z < this.nz; z++)
      for (let y = 0; y < this.ny; y++)
        for (let x = 0; x < this.nx; x++) {
          const onBorder = y === 0 || x === 0 || z === 0 || x === this.nx - 1 || z === this.nz - 1;
          if (!onBorder) continue;
          const i = this.index(x, y, z);
          if (this.solid[i] && anchored(i)) {
            dist[i] = 0;
            front.push(i);
          }
        }
    let level = 0;
    while (front.length || back.length) {
      if (!front.length) {
        front = back;
        back = [];
        level++;
        if (level > maxSpan) break;
      }
      const cur = front.pop()!;
      if (dist[cur] !== level) continue;
      const [x, y, z] = this.coords(cur);
      const relax = (xx: number, yy: number, zz: number, cost: number) => {
        if (xx < 0 || yy < 0 || zz < 0 || xx >= this.nx || yy >= this.ny || zz >= this.nz) return;
        const j = this.index(xx, yy, zz);
        if (!this.solid[j]) return;
        const d = level + cost;
        if (d > maxSpan || (dist[j] !== -1 && dist[j] <= d)) return;
        dist[j] = d;
        (cost === 0 ? front : back).push(j);
      };
      relax(x, y + 1, z, 0);
      relax(x, y - 1, z, 0);
      relax(x + 1, y, z, 1);
      relax(x - 1, y, z, 1);
      relax(x, y, z + 1, 1);
      relax(x, y, z - 1, 1);
    }
    const loose: number[] = [];
    for (let i = 0; i < n; i++) if (this.solid[i] && dist[i] === -1) loose.push(i);
    return loose;
  }

  /** Funde os voxels em poucos cuboides (greedy) para colisão e física. */
  rebuildColliders(): THREE.Box3[] {
    const { nx, ny, nz, cell, min } = this;
    const used = new Uint8Array(this.solid.length);
    const ok = (x: number, y: number, z: number) => {
      const i = this.index(x, y, z);
      return this.solid[i] === 1 && used[i] === 0;
    };
    const boxes: THREE.Box3[] = [];
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          if (!ok(x, y, z)) continue;
          let x1 = x;
          while (x1 + 1 < nx && ok(x1 + 1, y, z)) x1++;
          let z1 = z;
          grow: while (z1 + 1 < nz) {
            for (let xx = x; xx <= x1; xx++) if (!ok(xx, y, z1 + 1)) break grow;
            z1++;
          }
          let y1 = y;
          growY: while (y1 + 1 < ny) {
            for (let zz = z; zz <= z1; zz++) for (let xx = x; xx <= x1; xx++) if (!ok(xx, y1 + 1, zz)) break growY;
            y1++;
          }
          for (let zz = z; zz <= z1; zz++) for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used[this.index(xx, yy, zz)] = 1;
          boxes.push(
            new THREE.Box3(
              new THREE.Vector3(min.x + x * cell.x, min.y + y * cell.y, min.z + z * cell.z),
              new THREE.Vector3(min.x + (x1 + 1) * cell.x, min.y + (y1 + 1) * cell.y, min.z + (z1 + 1) * cell.z),
            ),
          );
        }
    this.colliders = boxes;
    return boxes;
  }

  /** Raycast pela grade (Amanatides–Woo). */
  raycastGrid(ray: THREE.Ray, near: number, far: number): GridHit | null {
    const o = ray.origin;
    const d = ray.direction;
    const bmin = this.min;
    const bmax = this.bounds.max;
    // entrada/saída na caixa (slabs)
    let t0 = -Infinity;
    let t1 = Infinity;
    let axis0 = 0;
    for (let a = 0; a < 3; a++) {
      const oa = o.getComponent(a);
      const da = d.getComponent(a);
      const lo = bmin.getComponent(a);
      const hi = bmax.getComponent(a);
      if (Math.abs(da) < 1e-9) {
        if (oa < lo || oa > hi) return null;
        continue;
      }
      let ta = (lo - oa) / da;
      let tb = (hi - oa) / da;
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) {
        t0 = ta;
        axis0 = a;
      }
      t1 = Math.min(t1, tb);
    }
    if (t1 < Math.max(t0, near) || t0 > far) return null;

    let t = Math.max(t0, near);
    const p = this.tmp.copy(d).multiplyScalar(t + 1e-6).add(o);
    const n = [this.nx, this.ny, this.nz];
    const c = [this.cell.x, this.cell.y, this.cell.z];
    const cellIdx = [0, 1, 2].map((a) =>
      Math.min(n[a] - 1, Math.max(0, Math.floor((p.getComponent(a) - bmin.getComponent(a)) / c[a]))),
    );
    const step = [0, 1, 2].map((a) => (d.getComponent(a) > 0 ? 1 : -1));
    const tDelta = [0, 1, 2].map((a) => (Math.abs(d.getComponent(a)) < 1e-9 ? Infinity : c[a] / Math.abs(d.getComponent(a))));
    const tMax = [0, 1, 2].map((a) => {
      const da = d.getComponent(a);
      if (Math.abs(da) < 1e-9) return Infinity;
      const boundary = bmin.getComponent(a) + (cellIdx[a] + (step[a] > 0 ? 1 : 0)) * c[a];
      return (boundary - o.getComponent(a)) / da;
    });
    let hitAxis = t0 >= near ? axis0 : -1;

    for (let guard = 0; guard < 512; guard++) {
      const i = this.index(cellIdx[0], cellIdx[1], cellIdx[2]);
      if (this.solid[i]) {
        const normal = new THREE.Vector3();
        if (hitAxis >= 0) normal.setComponent(hitAxis, -step[hitAxis]);
        else normal.copy(d).negate();
        return { distance: t, point: d.clone().multiplyScalar(t).add(o), normal, index: i };
      }
      // próxima célula
      let a = 0;
      if (tMax[1] < tMax[a]) a = 1;
      if (tMax[2] < tMax[a]) a = 2;
      t = tMax[a];
      if (t > far || t > t1) return null;
      cellIdx[a] += step[a];
      if (cellIdx[a] < 0 || cellIdx[a] >= n[a]) return null;
      tMax[a] += tDelta[a];
      hitAxis = a;
    }
    return null;
  }
}

/** Semente estável a partir do id (mesma aparência a cada carregamento). */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
