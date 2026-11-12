import * as THREE from 'three';

/**
 * Materiais que "emitem luz" (faíscas, fogo, clarão do tiro). Com o pós-processamento
 * em HDR eles ganham brilho acima de 1 para acender o bloom; sem ele ficam na cor normal.
 */
const items: { material: THREE.MeshBasicMaterial; base: THREE.Color; boost: number }[] = [];
let hdr = false;

/** Registra um material emissivo. `boost` = multiplicador da cor em HDR. */
export function glow<T extends THREE.MeshBasicMaterial>(material: T, boost: number): T {
  const item = { material, base: material.color.clone(), boost };
  items.push(item);
  if (hdr) material.color.copy(item.base).multiplyScalar(boost);
  return material;
}

export function setHdrGlow(on: boolean): void {
  hdr = on;
  for (const it of items) it.material.color.copy(it.base).multiplyScalar(on ? it.boost : 1);
}
