import { ATTACHMENTS, type AttachmentId } from '@shared/weapons/attachments';
import * as THREE from 'three';
import { applyAttachments } from './attachments';
import { buildWeaponModel } from './registry';

/** Arma onde cada acessório é montado para a miniatura (aceita todos). */
const REFERENCE_WEAPON = 'm16a4';

/** Id do GIF giratório de um acessório (`public/weapons/gifs/att_<id>.gif`). */
export const attachmentGifId = (id: AttachmentId): string => `att_${id}`;

/**
 * Só as peças de um acessório (sem a arma), em escala real e já posicionadas,
 * para gerar o GIF giratório: monta o acessório numa arma de referência e copia
 * as malhas marcadas como acessório (pente estendido: a peça do pente).
 */
export function buildAttachmentPreview(id: AttachmentId): { root: THREE.Group } {
  const model = buildWeaponModel(REFERENCE_WEAPON);
  applyAttachments(model, { [ATTACHMENTS[id].slot]: id });
  model.root.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.name = `att-${id}`;
  const take = (mesh: THREE.Mesh) => {
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    mesh.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    root.add(copy);
  };
  if (id === 'extmag') {
    model.parts.get('mag')?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) take(o as THREE.Mesh);
    });
  } else {
    model.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.attachment && !o.userData.beam) take(o as THREE.Mesh);
    });
  }
  return { root };
}
