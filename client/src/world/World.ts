import * as THREE from 'three';
import type { MapData } from '../shared/types';
import { BoxFactory } from './BoxFactory';
import { createGround } from './Ground';
import { createLighting } from './Lighting';

/** Monta o mapa: chão, caixas, luzes. Expõe colisores e alvos de raycast. */
export class World {
  readonly colliders: THREE.Box3[] = [];
  readonly hitTargets: THREE.Object3D[] = [];
  readonly root = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    readonly map: MapData,
    anisotropy: number,
  ) {
    this.root.name = 'world';
    scene.add(this.root);
    createLighting(scene, map.size);

    const ground = createGround(map.size, anisotropy);
    this.root.add(ground);
    this.hitTargets.push(ground);

    const factory = new BoxFactory(anisotropy);
    for (const data of map.boxes) {
      const mesh = factory.create(data);
      this.root.add(mesh);
      this.hitTargets.push(mesh);
      this.colliders.push(new THREE.Box3().setFromObject(mesh));
    }
  }
}
