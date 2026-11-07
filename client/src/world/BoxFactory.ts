import * as THREE from 'three';
import type { BoxData } from '../shared/types';
import { createWallTexture } from '../textures/WorldTextures';

/** Cria as caixas/paredes brancas do mapa (geometria unitária compartilhada). */
export class BoxFactory {
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material: THREE.MeshStandardMaterial;

  constructor(anisotropy: number) {
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: createWallTexture(anisotropy),
      roughness: 0.92,
      metalness: 0,
    });
  }

  create(data: BoxData): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.name = data.id;
    mesh.scale.set(data.size.x, data.size.y, data.size.z);
    mesh.position.set(data.position.x, data.position.y + data.size.y / 2, data.position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    return mesh;
  }
}
