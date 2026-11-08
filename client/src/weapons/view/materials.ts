import * as THREE from 'three';
import { registerCamo } from '../../textures/teamCamo';
import { createCamoTexture, createCuffTexture, createGloveTexture, createSkinTexture } from '../../textures/CharacterTextures';

export interface ArmMaterials {
  sleeve: THREE.Material;
  cuff: THREE.Material;
  skin: THREE.Material;
  glove: THREE.Material;
}

export function createArmMaterials(): ArmMaterials {
  const sleeve = new THREE.MeshStandardMaterial({ map: createCamoTexture(), roughness: 0.95 });
  const cuff = new THREE.MeshStandardMaterial({ map: createCuffTexture(), roughness: 0.95 });
  registerCamo(sleeve, 11);
  registerCamo(cuff, 5, 'cuff');
  return {
    sleeve,
    cuff,
    skin: new THREE.MeshStandardMaterial({ map: createSkinTexture(), roughness: 0.75 }),
    glove: new THREE.MeshStandardMaterial({ map: createGloveTexture(), roughness: 0.7 }),
  };
}
