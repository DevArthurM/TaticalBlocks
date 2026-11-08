import type { MapData } from '@shared/map/types';
import * as THREE from 'three';
import { WORLD_COLORS } from '../config/constants';
import { createLighting } from './Lighting';

export interface EnvironmentRig {
  /** Luz principal com sombras (sol ou luar). */
  sun: THREE.DirectionalLight;
  /** Quanto a luz dos braços/arma deve ser reduzida (1 = normal). */
  viewmodelLight: number;
  /** `viewer`: posição da câmera (escolhe quais luminárias acendem de verdade). */
  update(dt: number, time: number, viewer: THREE.Vector3): void;
}

/** Céu, névoa e sol. */
export function setupEnvironment(scene: THREE.Scene, map: MapData): EnvironmentRig {
  scene.background = new THREE.Color(WORLD_COLORS.sky);
  scene.fog = new THREE.Fog(WORLD_COLORS.sky, WORLD_COLORS.fogNear, WORLD_COLORS.fogFar);
  return { sun: createLighting(scene, map.size), viewmodelLight: 1, update: () => {} };
}
