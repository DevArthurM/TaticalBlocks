import * as THREE from 'three';
import type { BoxData, MapData } from '../shared/types';
import { BoxFactory } from './BoxFactory';
import { createGround } from './Ground';
import { type EnvironmentRig, setupEnvironment } from './Environment';

const INVISIBLE_WALL = { height: 60, thickness: 3 };

/** Monta o mapa: chão, caixas, luzes. Expõe colisores e alvos de raycast. */
export class World {
  readonly colliders: THREE.Box3[] = [];
  /** Paredes invisíveis da borda (já incluídas em `colliders`). */
  readonly boundary: THREE.Box3[] = [];
  readonly hitTargets: THREE.Object3D[] = [];
  readonly root = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly env: EnvironmentRig;
  /** Cada caixa do mapa (dados + malha + limites), usada pela destruição. */
  readonly blocks: { data: BoxData; mesh: THREE.Mesh; bounds: THREE.Box3 }[] = [];

  constructor(
    scene: THREE.Scene,
    readonly map: MapData,
    anisotropy: number,
  ) {
    this.root.name = 'world';
    scene.add(this.root);
    this.env = setupEnvironment(scene, map);
    this.sun = this.env.sun;

    const ground = createGround(map.size, anisotropy);
    // chão escuro: aparece nas frestas entre os quadradinhos do piso (FloorTiles)
    (ground.material as THREE.MeshStandardMaterial).color.set(0x2a2c30);
    this.root.add(ground);
    this.hitTargets.push(ground);

    const factory = new BoxFactory(anisotropy);
    for (const data of map.boxes) {
      const mesh = factory.create(data);
      this.root.add(mesh);
      this.hitTargets.push(mesh);
      const bounds = new THREE.Box3().setFromObject(mesh);
      this.colliders.push(bounds.clone());
      this.blocks.push({ data, mesh, bounds });
    }
    if (map.invisibleWalls) this.addInvisibleWalls(map.size / 2);
    // cenário estático: matrizes calculadas uma vez (o three.js não recalcula a cada quadro)
    this.root.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
  }

  /**
   * Borda invisível: só colisão (sem malha e sem bloquear tiros), bem mais alta que
   * qualquer coisa escalável e cobrindo o topo dos muros da borda.
   */
  private addInvisibleWalls(half: number): void {
    const t = INVISIBLE_WALL.thickness;
    const y0 = -1;
    const y1 = INVISIBLE_WALL.height;
    const o = half + t;
    this.boundary.push(
      new THREE.Box3(new THREE.Vector3(-o, y0, -o), new THREE.Vector3(o, y1, -half)), // norte
      new THREE.Box3(new THREE.Vector3(-o, y0, half), new THREE.Vector3(o, y1, o)), // sul
      new THREE.Box3(new THREE.Vector3(-o, y0, -half), new THREE.Vector3(-half, y1, half)), // oeste
      new THREE.Box3(new THREE.Vector3(half, y0, -half), new THREE.Vector3(o, y1, half)), // leste
    );
    this.colliders.push(...this.boundary);
  }
}
