import type { MaterialId } from '@shared/map/types';
import * as THREE from 'three';
import type { SoundName } from '../../audio/SoundEngine';

export type DestructibleMaterial = Exclude<MaterialId, 'bedrock'>;

/** Dados para escolher a cor de cada voxel. */
export interface VoxelCellInfo {
  x: number;
  y: number;
  z: number;
  /** Distância (em voxels) até a superfície original: 0 = face externa. */
  depth: number;
  /** Eixo mais longo no plano horizontal (veio da madeira / ondulação do metal). */
  longAxis: 'x' | 'z';
  rnd: () => number;
}

export interface VoxelMaterial {
  id: DestructibleMaterial;
  label: string;
  /** Vida de cada voxel. Dano do tiro ≈ dano da arma / 10. */
  hp: number;
  /** Multiplica o raio da cratera (frágil = estilhaça mais). */
  spread: number;
  /** Maior vão horizontal (m) que o material sustenta a partir de um apoio. */
  maxSpan: number;
  /** Densidade dos detritos (kg/m³). */
  density: number;
  roughness: number;
  metalness: number;
  /** Cor padrão quando o bloco não define uma. */
  baseColor: number;
  sound: SoundName;
  impact: {
    /** Faíscas por impacto. */
    sparks: number;
    /** Partículas de lascas (usam a cor do voxel). */
    chips: number;
    dust: number;
    dustColor: number;
  };
  color(base: THREE.Color, c: VoxelCellInfo): THREE.Color;
}

const shade = (base: THREE.Color, k: number) => base.clone().multiplyScalar(k);

export const VOXEL_MATERIALS: Record<DestructibleMaterial, VoxelMaterial> = {
  concrete: {
    id: 'concrete',
    label: 'Concreto',
    hp: 4,
    spread: 1,
    maxSpan: 5,
    density: 2200,
    roughness: 0.92,
    metalness: 0,
    baseColor: 0xecece8,
    sound: 'hitConcrete',
    impact: { sparks: 2, chips: 3, dust: 8, dustColor: 0xdadcdf },
    color: (base, c) => {
      const depth = c.depth === 0 ? 1 : c.depth === 1 ? 0.88 : 0.78;
      return shade(base, depth * (1 - c.rnd() * 0.04));
    },
  },
  wood: {
    id: 'wood',
    label: 'Madeira',
    hp: 2,
    spread: 1.1,
    maxSpan: 3.5,
    density: 650,
    roughness: 0.85,
    metalness: 0,
    baseColor: 0x9c6b3c,
    sound: 'hitWood',
    impact: { sparks: 0, chips: 6, dust: 3, dustColor: 0xb89a74 },
    color: (base, c) => {
      // tábuas horizontais: cada fileira de voxels é uma tábua com tom próprio
      const plank = [1, 0.88, 1.08, 0.94][c.y % 4];
      const grain = 1 - c.rnd() * 0.08;
      const core = c.depth === 0 ? 1 : 0.75;
      return shade(base, plank * grain * core);
    },
  },
  metal: {
    id: 'metal',
    label: 'Metal',
    hp: 10,
    spread: 0.7,
    maxSpan: 6,
    density: 3000,
    roughness: 0.42,
    metalness: 0.55,
    baseColor: 0x8a9099,
    sound: 'hitMetal',
    impact: { sparks: 9, chips: 1, dust: 2, dustColor: 0x6c7077 },
    color: (base, c) => {
      // chapa ondulada: colunas alternadas ao longo do eixo longo
      const col = c.longAxis === 'x' ? c.x : c.z;
      const rib = col % 2 === 0 ? 1 : 0.84;
      const core = c.depth === 0 ? 1 : 0.7;
      return shade(base, rib * core * (1 - c.rnd() * 0.03));
    },
  },
  plastic: {
    id: 'plastic',
    label: 'Plástico',
    hp: 1,
    spread: 1.4,
    maxSpan: 1.5,
    density: 400,
    roughness: 0.35,
    metalness: 0,
    baseColor: 0x2f7fd8,
    sound: 'hitPlastic',
    impact: { sparks: 0, chips: 7, dust: 1, dustColor: 0xe9e9e9 },
    color: (base, c) => shade(base, (c.depth === 0 ? 1 : 0.86) * (1 - c.rnd() * 0.03)),
  },
};

export function voxelMaterial(id: MaterialId | undefined): VoxelMaterial | null {
  if (id === 'bedrock') return null;
  return VOXEL_MATERIALS[id ?? 'concrete'];
}
