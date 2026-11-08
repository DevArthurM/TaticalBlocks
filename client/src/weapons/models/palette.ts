import * as THREE from 'three';
import { createGripTexture } from '../../textures/CharacterTextures';

const std = (color: number, roughness = 0.6, metalness = 0.15, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

/** Paleta compartilhada por todos os modelos (estilo voxel low-poly). */
function createPalette() {
  return {
    black: std(0x222327, 0.65, 0.1),
    gun: std(0x393b41, 0.55, 0.2),
    steel: std(0x5b5f67, 0.45, 0.3),
    silver: std(0xb9bec6, 0.3, 0.55),
    dark: std(0x17181b, 0.6, 0.1),
    grip: new THREE.MeshStandardMaterial({ map: createGripTexture(), roughness: 0.9 }),
    wood: std(0x8b5a32, 0.8, 0),
    woodDark: std(0x5f3b1f, 0.85, 0),
    tan: std(0x9e7c57, 0.75, 0.05),
    olive: std(0x59633d, 0.75, 0.05),
    oliveDark: std(0x3f472b, 0.8, 0.05),
    rpg: std(0x6c7442, 0.7, 0.1),
    brass: std(0xc9a24a, 0.3, 0.8),
    copper: std(0xb8693d, 0.32, 0.75),
    lead: std(0x80848b, 0.4, 0.6),
    steelCase: std(0x6f7464, 0.45, 0.5),
    shellRed: std(0xa8322b, 0.6, 0.05),
    blade: std(0xc6ccd4, 0.25, 0.7),
    lens: new THREE.MeshStandardMaterial({ color: 0x1b2d3d, roughness: 0.1, metalness: 0.6, emissive: 0x0a1a28 }),
    sight: new THREE.MeshBasicMaterial({ color: 0xc8f560 }),
    redDot: new THREE.MeshBasicMaterial({ color: 0xff3b2f }),
    grenade: std(0x4e5a33, 0.7, 0.1),
    grenadeDark: std(0x3a4426, 0.75, 0.1),
    yellow: std(0xd2b23c, 0.6, 0.1),
    bottle: std(0x6e3c1c, 0.25, 0.1, { transparent: true, opacity: 0.92 }),
    cloth: std(0xe6d6bb, 0.95, 0),
    flame: new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false }),
  };
}

export type Palette = ReturnType<typeof createPalette>;
export type MatKey = keyof Palette;

let shared: Palette | null = null;
export function getPalette(): Palette {
  shared ??= createPalette();
  return shared;
}
