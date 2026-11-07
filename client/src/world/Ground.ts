import * as THREE from 'three';
import { createGroundTexture } from '../textures/WorldTextures';

const TILE_SIZE = 2;

export function createGround(mapSize: number, anisotropy: number): THREE.Mesh {
  const size = mapSize * 4; // estende além das paredes até a névoa
  const tex = createGroundTexture(anisotropy);
  tex.repeat.set(size / TILE_SIZE, size / TILE_SIZE);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.updateMatrixWorld(true);
  return ground;
}
