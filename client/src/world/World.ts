import * as THREE from 'three';
import type { BoxData, MapData } from '../shared/types';
import { BoxFactory } from './BoxFactory';
import { createGround } from './Ground';
import { type EnvironmentRig, setupEnvironment } from './Environment';
import { createHospitalFloorTexture } from '../textures/WorldTextures';

/** Monta o mapa: chão, caixas, luzes. Expõe colisores e alvos de raycast. */
export class World {
  readonly colliders: THREE.Box3[] = [];
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
    this.root.add(ground);
    this.hitTargets.push(ground);
    if (map.environment === 'hospital') {
      // pátio externo escuro + piso quadriculado dentro do corredor
      (ground.material as THREE.MeshStandardMaterial).color.set(0x4a4f55);
      const tex = createHospitalFloorTexture(anisotropy);
      tex.repeat.set(40 / 1.2, 4 / 1.2);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.003;
      floor.receiveShadow = true;
      floor.updateMatrixWorld(true);
      this.root.add(floor);
      this.hitTargets.push(floor);
    }

    const factory = new BoxFactory(anisotropy);
    for (const data of map.boxes) {
      const mesh = factory.create(data);
      this.root.add(mesh);
      this.hitTargets.push(mesh);
      const bounds = new THREE.Box3().setFromObject(mesh);
      this.colliders.push(bounds.clone());
      this.blocks.push({ data, mesh, bounds });
    }
    // cenário estático: matrizes calculadas uma vez (o three.js não recalcula a cada quadro)
    this.root.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
  }
}
