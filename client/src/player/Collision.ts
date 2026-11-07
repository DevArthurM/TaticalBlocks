import type * as THREE from 'three';

export type Axis = 'x' | 'y' | 'z';

export interface CapsuleBox {
  position: THREE.Vector3; // pés do jogador
  radius: number;
  height: number;
}

/** Testa se o "cilindro" (aprox. AABB) do jogador intersecta a caixa. */
export function intersects(p: CapsuleBox, b: THREE.Box3): boolean {
  const { x, y, z } = p.position;
  return !(
    x + p.radius <= b.min.x ||
    x - p.radius >= b.max.x ||
    z + p.radius <= b.min.z ||
    z - p.radius >= b.max.z ||
    y + p.height <= b.min.y ||
    y >= b.max.y
  );
}

const EPS = 1e-4;

/**
 * Move o corpo em um eixo e resolve colisões nesse eixo.
 * Retorna `true` se colidiu.
 */
export function moveAndCollide(body: CapsuleBox, axis: Axis, delta: number, colliders: readonly THREE.Box3[]): boolean {
  if (delta === 0) return false;
  body.position[axis] += delta;
  let hit = false;
  for (const b of colliders) {
    if (!intersects(body, b)) continue;
    hit = true;
    if (axis === 'y') {
      body.position.y = delta < 0 ? b.max.y : b.min.y - body.height - EPS;
    } else {
      body.position[axis] = delta > 0 ? b.min[axis] - body.radius - EPS : b.max[axis] + body.radius + EPS;
    }
  }
  return hit;
}
