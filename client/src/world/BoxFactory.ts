import * as THREE from 'three';
import type { BoxData } from '../shared/types';
import { createTileTexture, createWallTexture } from '../textures/WorldTextures';

/** Cria as caixas/paredes do mapa (geometria unitária compartilhada). */
export class BoxFactory {
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material: THREE.MeshStandardMaterial;
  /** Borda indestrutível: concreto escuro. */
  private readonly bedrock: THREE.MeshStandardMaterial;

  constructor(anisotropy: number) {
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: createWallTexture(anisotropy),
      roughness: 0.92,
      metalness: 0,
    });
    this.bedrock = this.material.clone();
    this.bedrock.color.set(0x7a7f87);
    this.tile = createTileTexture(anisotropy);
  }

  private readonly tile: THREE.Texture;

  /** Azulejo com repetição de acordo com o tamanho do bloco (~0,5 m por peça). */
  private tileMaterial(data: BoxData): THREE.MeshStandardMaterial {
    const tex = this.tile.clone();
    tex.repeat.set(Math.max(data.size.x, data.size.z) / 2, data.size.y / 2);
    return new THREE.MeshStandardMaterial({ map: tex, color: data.color ?? 0xffffff, roughness: 0.5, metalness: 0 });
  }

  create(data: BoxData): THREE.Mesh {
    const isBedrock = data.material === 'bedrock' || data.id.startsWith('wall-');
    const mat = data.material === 'hospital' ? this.tileMaterial(data) : isBedrock ? this.bedrock : this.material;
    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.name = data.id;
    mesh.scale.set(data.size.x, data.size.y, data.size.z);
    mesh.position.set(data.position.x, data.position.y + data.size.y / 2, data.position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    return mesh;
  }
}
