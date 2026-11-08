import type { WeaponCategory } from '@shared/weapons/types';
import { findWeapon } from '@shared/weapons/catalog';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { decodeAttachments, sanitizeAttachments } from '@shared/weapons/attachments';
import { applyAttachments } from '../../weapons/models/attachments';
import { buildWeaponModel } from '../../weapons/models/registry';

/** Comprimento da arma no mundo (m) por categoria. */
const LENGTH: Record<WeaponCategory, number> = {
  pistol: 0.3,
  smg: 0.55,
  rifle: 0.92,
  shotgun: 1,
  sniper: 1.18,
  heavy: 1.05,
  melee: 0.42,
  throwable: 0.12,
};
const LENGTH_BY_ID: Record<string, number> = { knife: 0.3, sledge: 0.9 };

export interface TPWeapon {
  id: string;
  category: WeaponCategory;
  /** Malha "assada" (poucos draw calls), com a empunhadura na origem. */
  root: THREE.Group;
  /** Pontos (no espaço de `root`): mão de apoio e cano. */
  support: THREE.Vector3 | null;
  muzzle: THREE.Vector3;
}

const cache = new Map<string, { group: THREE.Group; support: THREE.Vector3 | null; muzzle: THREE.Vector3; category: WeaponCategory }>();

/**
 * Arma na mão de outro jogador: o mesmo modelo da primeira pessoa, em escala de
 * mundo, com as peças fundidas por material (uma malha por material).
 */
export function buildThirdPersonWeapon(id: string, att = ''): TPWeapon | null {
  const def = findWeapon(id);
  if (!def) return null;
  const key = `${id}|${att}`;
  let base = cache.get(key);
  if (!base) {
    const model = buildWeaponModel(id);
    // mesmos acessórios da primeira pessoa (mira, silenciador, pente, trilho, empunhadura)
    if (att) applyAttachments(model, sanitizeAttachments(def, decodeAttachments(att)));
    model.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.root);
    const size = box.getSize(new THREE.Vector3());
    const scale = (LENGTH_BY_ID[id] ?? LENGTH[def.category]) / Math.max(size.x, size.y, size.z, 1e-3);
    const local = (name: 'grip' | 'support' | 'muzzle') => {
      const a = model.anchors.get(name);
      return a ? a.getWorldPosition(new THREE.Vector3()) : null;
    };
    const grip = local('grip') ?? box.getCenter(new THREE.Vector3());
    const support = local('support');
    const muzzle = local('muzzle') ?? new THREE.Vector3(grip.x, grip.y, box.min.z);
    // transforma tudo para: empunhadura na origem, escala de mundo
    const toLocal = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z));
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !visibleChain(mesh) || Array.isArray(mesh.material)) return;
      const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
      const list = byMat.get(mesh.material) ?? [];
      list.push(g);
      byMat.set(mesh.material, list);
    });
    const group = new THREE.Group();
    for (const [mat, geos] of byMat) {
      const merged = tryMerge(geos);
      for (const g of merged) {
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
    }
    base = {
      group,
      category: def.category,
      support: support ? support.applyMatrix4(toLocal) : null,
      muzzle: muzzle.applyMatrix4(toLocal),
    };
    cache.set(key, base);
  }
  const root = new THREE.Group();
  for (const m of base.group.children) root.add((m as THREE.Mesh).clone());
  return { id, category: base.category, root, support: base.support?.clone() ?? null, muzzle: base.muzzle.clone() };
}

function visibleChain(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Funde geometrias compatíveis; as que não fundem ficam separadas. */
function tryMerge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  if (geos.length === 1) return geos;
  const indexed = geos.filter((g) => g.index);
  const plain = geos.filter((g) => !g.index);
  const out: THREE.BufferGeometry[] = [];
  for (const set of [indexed, plain]) {
    if (!set.length) continue;
    const merged = set.length > 1 ? mergeGeometries(set, false) : set[0];
    if (merged) out.push(merged);
    else out.push(...set);
  }
  return out;
}
