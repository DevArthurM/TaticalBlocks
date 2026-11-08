import type * as THREE from 'three';
import { type CamoPalette, createCamoTexture, createCuffTexture } from './CharacterTextures';

/**
 * Materiais camuflados do próprio jogador (braços e corpo). No online o uniforme
 * troca para a cor do time; offline fica o oliva.
 */
const registry: { material: THREE.MeshStandardMaterial; seed: number; kind: 'camo' | 'cuff' }[] = [];

export function registerCamo(material: THREE.MeshStandardMaterial, seed: number, kind: 'camo' | 'cuff' = 'camo'): void {
  registry.push({ material, seed, kind });
}

export function setCamoPalette(palette: CamoPalette): void {
  for (const r of registry) {
    r.material.map?.dispose();
    r.material.map = r.kind === 'cuff' ? createCuffTexture(r.seed, palette) : createCamoTexture(r.seed, palette);
    r.material.needsUpdate = true;
  }
}
