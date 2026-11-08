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

/** Céu, névoa e luzes de acordo com o mapa. */
export function setupEnvironment(scene: THREE.Scene, map: MapData): EnvironmentRig {
  if (map.environment !== 'hospital') {
    scene.background = new THREE.Color(WORLD_COLORS.sky);
    scene.fog = new THREE.Fog(WORLD_COLORS.sky, WORLD_COLORS.fogNear, WORLD_COLORS.fogFar);
    return { sun: createLighting(scene, map.size), viewmodelLight: 1, update: () => {} };
  }
  return hospital(scene, map);
}

/** Noite: luar azulado entrando pelas janelas + fluorescentes no teto (algumas falhando). */
function hospital(scene: THREE.Scene, map: MapData): EnvironmentRig {
  const dark = 0x050608;
  scene.background = new THREE.Color(dark);
  scene.fog = new THREE.Fog(dark, 5, 30);
  scene.add(new THREE.HemisphereLight(0x3a4660, 0x0b0d10, 0.22));

  const moon = new THREE.DirectionalLight(0x9fb4ff, 1.3);
  moon.position.set(6, 24, -26);
  moon.castShadow = true;
  moon.shadow.mapSize.set(4096, 4096);
  const ext = map.size / 2 + 6;
  Object.assign(moon.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 });
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.03;
  moon.shadow.camera.layers.enable(1);
  scene.add(moon, moon.target);

  const fixtureOn = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe6f6ff, emissiveIntensity: 2.2 });
  const fixtureOff = new THREE.MeshStandardMaterial({ color: 0x3a3d40, emissive: 0x000000 });
  const geo = new THREE.BoxGeometry(1.3, 0.06, 0.28);
  // cada luminária tem seu próprio estado (acesa/falhando), mas só as mais próximas
  // do jogador recebem uma PointLight de verdade — o resto fica só a lâmpada acesa
  const fixtures = (map.lights ?? []).map((l) => {
    const mesh = new THREE.Mesh(geo, fixtureOn);
    mesh.position.set(l.position.x, l.position.y, l.position.z);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    return { pos: new THREE.Vector3(l.position.x, l.position.y - 0.15, l.position.z), mesh, flicker: !!l.flicker, level: 1, off: 0, next: Math.random() * 2, dist: 0 };
  });
  // número fixo de luzes: mudar a quantidade recompilaria todos os shaders
  const pool = Array.from({ length: Math.min(LIGHT_POOL, fixtures.length) }, () => {
    const light = new THREE.PointLight(0xdcefff, 0, LIGHT_RANGE, 1.7);
    scene.add(light);
    return light;
  });

  return {
    sun: moon,
    viewmodelLight: 0.4,
    update: (dt, time, viewer) => {
      for (const f of fixtures) {
        if (!f.flicker) {
          // zumbido leve das fluorescentes
          f.level = 0.96 + Math.sin(time * 120) * 0.02;
        } else {
          // falhando: apaga em rajadas irregulares
          f.next -= dt;
          if (f.next <= 0) {
            f.off = Math.random() < 0.55 ? 0.05 + Math.random() * 0.5 : 0;
            f.next = f.off + 0.08 + Math.random() * (Math.random() < 0.3 ? 2.5 : 0.4);
          }
          f.off = Math.max(0, f.off - dt);
          f.level = f.off <= 0 ? 0.7 + Math.random() * 0.3 : 0;
          f.mesh.material = f.level > 0 ? fixtureOn : fixtureOff;
        }
        f.dist = Math.hypot(f.pos.x - viewer.x, f.pos.z - viewer.z);
      }
      const near = [...fixtures].sort((a, b) => a.dist - b.dist);
      pool.forEach((light, i) => {
        const f = near[i];
        light.position.copy(f.pos);
        // some suavemente com a distância, para a troca de luminária não "piscar"
        const fade = 1 - THREE.MathUtils.smoothstep(f.dist, FADE_START, FADE_END);
        light.intensity = LAMP_INTENSITY * f.level * fade;
      });
    },
  };
}

/** Luzes reais simultâneas (o resto das luminárias só brilha). */
const LIGHT_POOL = 4;
const LIGHT_RANGE = 10;
const LAMP_INTENSITY = 3.6;
/** Distância (horizontal) em que a luz de uma luminária começa/termina de sumir. */
const FADE_START = 7;
const FADE_END = 10;
