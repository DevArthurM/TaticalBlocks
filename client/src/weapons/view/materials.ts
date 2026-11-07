import * as THREE from 'three';
import { createCamoTexture, createCuffTexture, createGloveTexture, createSkinTexture } from '../../textures/CharacterTextures';

export interface ArmMaterials {
  sleeve: THREE.Material;
  cuff: THREE.Material;
  skin: THREE.Material;
  glove: THREE.Material;
}

export function createArmMaterials(): ArmMaterials {
  return {
    sleeve: new THREE.MeshStandardMaterial({ map: createCamoTexture(), roughness: 0.95 }),
    cuff: new THREE.MeshStandardMaterial({ map: createCuffTexture(), roughness: 0.95 }),
    skin: new THREE.MeshStandardMaterial({ map: createSkinTexture(), roughness: 0.75 }),
    glove: new THREE.MeshStandardMaterial({ map: createGloveTexture(), roughness: 0.7 }),
  };
}
