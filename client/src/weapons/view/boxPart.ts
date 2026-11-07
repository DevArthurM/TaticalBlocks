import * as THREE from 'three';

const unitBox = new THREE.BoxGeometry(1, 1, 1);

export function boxPart(
  parent: THREE.Object3D,
  material: THREE.Material,
  size: [number, number, number],
  position: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}
