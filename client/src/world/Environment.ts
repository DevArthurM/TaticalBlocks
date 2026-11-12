import type { MapData } from '@shared/map/types';
import * as THREE from 'three';
import type { Atmosphere } from '../core/post/PostFX';
import { ATMOSPHERE } from './Atmosphere';
import { createLighting } from './Lighting';
import { Sky } from './Sky';

export interface EnvironmentRig {
  /** Luz principal com sombras (sol ou luar). */
  sun: THREE.DirectionalLight;
  /** Céu procedural (sol, gradiente e nuvens). */
  sky: Sky;
  /** Sol e névoa para o pós-processamento. */
  atmosphere: Atmosphere;
  /** Quanto a luz dos braços/arma deve ser reduzida (1 = normal). */
  viewmodelLight: number;
  /** `viewer`: posição da câmera (escolhe quais luminárias acendem de verdade). */
  update(dt: number, time: number, viewer: THREE.Vector3): void;
}

/** Céu, névoa e sol. */
export function setupEnvironment(scene: THREE.Scene, map: MapData): EnvironmentRig {
  const fog = ATMOSPHERE.legacyFog;
  scene.background = new THREE.Color(fog.color);
  scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
  const sky = new Sky(ATMOSPHERE.sunDir, ATMOSPHERE.sky);
  scene.add(sky.mesh);
  return {
    sun: createLighting(scene, map.size),
    sky,
    atmosphere: {
      sunDir: ATMOSPHERE.sunDir,
      sunColor: ATMOSPHERE.scatter,
      fogColor: ATMOSPHERE.fogColor,
      fogDensity: ATMOSPHERE.fogDensity,
      fogFalloff: ATMOSPHERE.fogFalloff,
    },
    viewmodelLight: 1,
    update: (_dt, time) => sky.update(time),
  };
}
