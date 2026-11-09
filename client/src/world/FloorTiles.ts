import * as THREE from 'three';

/** Lado de cada quadrado do piso (m) e fresta entre eles. */
export const FLOOR_TILE = { size: 0.5, gap: 0, thickness: 0.02 } as const;
/** Cor do sangue seco para onde as manchas puxam. */
const BLOOD = new THREE.Color(0x8a0808);

/**
 * Piso do mapa: grade de pequenos quadrados brancos (não são voxels — não quebram),
 * cada um com a própria cor. Uma única malha instanciada; o chão de baixo aparece
 * nas frestas. Sangue que cai num quadrado puxa a cor dele para o vermelho.
 */
export class FloorTiles {
  readonly mesh: THREE.InstancedMesh;
  /** Topo dos quadrados (altura onde uma gota encosta): rente ao chão, abaixo das marcas de tiro. */
  readonly top = 0.003;
  private readonly n: number;
  private readonly half: number;
  private readonly base: THREE.Color[] = [];
  private readonly colors: THREE.Color[] = [];
  private dirty = false;

  constructor(scene: THREE.Scene, mapSize: number) {
    this.n = Math.round(mapSize / FLOOR_TILE.size);
    this.half = (this.n * FLOOR_TILE.size) / 2;
    const count = this.n * this.n;
    const s = FLOOR_TILE.size - FLOOR_TILE.gap;
    // a placa afunda no chão: só o topo (3 mm acima) aparece; sem frestas, o piso é contínuo
    const geo = new THREE.BoxGeometry(s, FLOOR_TILE.thickness, s).translate(0, this.top - FLOOR_TILE.thickness / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.name = 'floor-tiles';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    const m = new THREE.Matrix4();
    // pseudoaleatório estável: o piso é igual em todos os clientes
    let seed = 20261108;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let z = 0; z < this.n; z++)
      for (let x = 0; x < this.n; x++) {
        const i = z * this.n + x;
        m.makeTranslation(-this.half + (x + 0.5) * FLOOR_TILE.size, 0, -this.half + (z + 0.5) * FLOOR_TILE.size);
        this.mesh.setMatrixAt(i, m);
        // asfalto: cinza-escuro com variação por quadrado e algumas pedrinhas mais claras
        const v = 0.045 + rnd() * 0.01 + (rnd() < 0.03 ? 0.012 : 0);
        const c = new THREE.Color(v, v * 1.01, v * 1.07);
        this.base.push(c);
        this.colors.push(c.clone());
        this.mesh.setColorAt(i, c);
      }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.computeBoundingBox();
    // estático: nada de raycast (tiros acertam o chão de baixo) nem matriz por quadro
    this.mesh.raycast = () => {};
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    scene.add(this.mesh);
  }

  /** Índice do quadrado em (x, z), ou -1 fora do piso. */
  index(x: number, z: number): number {
    const ix = Math.floor((x + this.half) / FLOOR_TILE.size);
    const iz = Math.floor((z + this.half) / FLOOR_TILE.size);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }

  /** Sangue caiu em (x, z): o quadrado fica mais vermelho (`amount` 0..1 por gota). */
  stain(x: number, z: number, amount: number): boolean {
    const i = this.index(x, z);
    if (i < 0) return false;
    this.colors[i].lerp(BLOOD, amount);
    this.mesh.setColorAt(i, this.colors[i]);
    this.dirty = true;
    return true;
  }

  /** Envia as cores alteradas (uma vez por quadro). */
  update(): void {
    if (!this.dirty || !this.mesh.instanceColor) return;
    this.mesh.instanceColor.needsUpdate = true;
    this.dirty = false;
  }

  /** Piso limpo de novo (mapa restaurado). */
  reset(): void {
    this.colors.forEach((c, i) => {
      c.copy(this.base[i]);
      this.mesh.setColorAt(i, c);
    });
    this.dirty = true;
  }
}
