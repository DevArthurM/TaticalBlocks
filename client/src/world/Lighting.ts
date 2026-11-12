import * as THREE from 'three';
import { ATMOSPHERE } from './Atmosphere';

/**
 * Sol direcional quente com sombras suaves + luz hemisférica azulada do céu.
 * O contraste entre os dois é o que dá o ar de "shader": sol dourado, sombra fria.
 */
export function createLighting(scene: THREE.Scene, mapSize: number): THREE.DirectionalLight {
  const hemi = new THREE.HemisphereLight(ATMOSPHERE.skyLight, ATMOSPHERE.groundLight, ATMOSPHERE.ambient);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(ATMOSPHERE.sunLight, ATMOSPHERE.sunIntensity);
  sun.position.copy(ATMOSPHERE.sunDir).multiplyScalar(65);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const extent = mapSize / 2 + 6;
  const cam = sun.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 1;
  cam.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  // camada 1: objetos que só projetam sombra (ex.: pelve do próprio jogador)
  sun.shadow.camera.layers.enable(1);
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}
