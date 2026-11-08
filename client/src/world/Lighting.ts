import * as THREE from 'three';

/** Sol direcional com sombras suaves + luz hemisférica para preencher. */
export function createLighting(scene: THREE.Scene, mapSize: number): THREE.DirectionalLight {
  const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x7d838c, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3e2, 3.2);
  sun.position.set(45, 38, 26);
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
