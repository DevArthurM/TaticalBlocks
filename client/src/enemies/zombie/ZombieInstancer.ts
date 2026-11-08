import * as THREE from 'three';

/**
 * Desenha todos os zumbis (vivos, ragdolls, partes arrancadas e tocos) com um
 * `InstancedMesh` por material: ~7 draw calls no total, em vez de ~16 por zumbi.
 *
 * As malhas originais continuam existindo — dão a hierarquia de ossos, o raycast
 * dos tiros, o desmembramento e o ragdoll — mas ficam invisíveis; a cada quadro
 * a matriz de mundo de cada uma é copiada para a instância correspondente.
 */

/** Malhas registradas (todas usam a mesma geometria de cubo unitário). */
const registry = new Set<THREE.Mesh>();

/** Registra uma malha de zumbi para ser desenhada por instância. */
export function registerZombieMesh(mesh: THREE.Mesh): void {
  mesh.visible = false;
  registry.add(mesh);
}

const INITIAL_CAPACITY = 1024;
const WHITE = new THREE.Color(1, 1, 1);

interface Batch {
  mesh: THREE.InstancedMesh;
  count: number;
}

export class ZombieInstancer {
  private readonly batches = new Map<THREE.Material | THREE.Material[], Batch>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly geometry: THREE.BufferGeometry,
  ) {}

  /** Cria os lotes de antemão (para que os shaders possam ser pré-compilados). */
  prepare(materials: (THREE.Material | THREE.Material[])[]): void {
    for (const m of materials) this.batch(m);
  }

  /** Copia as matrizes de mundo (já atualizadas) para as instâncias. */
  sync(): void {
    for (const b of this.batches.values()) b.count = 0;
    for (const mesh of registry) {
      if (!this.inScene(mesh)) {
        // removida da cena (zumbi descartado / parte sumiu): não volta mais
        registry.delete(mesh);
        continue;
      }
      const b = this.batch(mesh.material);
      if (b.count >= b.mesh.instanceMatrix.count) this.grow(mesh.material, b);
      // cor da peça (roupas são texturas neutras tingidas por instância)
      b.mesh.setColorAt(b.count, (mesh.userData.tint as THREE.Color | undefined) ?? WHITE);
      b.mesh.setMatrixAt(b.count++, mesh.matrixWorld);
    }
    for (const b of this.batches.values()) {
      b.mesh.count = b.count;
      const attrs: [THREE.BufferAttribute, number][] = [
        [b.mesh.instanceMatrix, 16],
        [b.mesh.instanceColor!, 3],
      ];
      for (const [attr, size] of attrs) {
        attr.clearUpdateRanges();
        if (b.count > 0) {
          attr.addUpdateRange(0, b.count * size);
          attr.needsUpdate = true;
        }
      }
    }
  }

  private batch(material: THREE.Material | THREE.Material[]): Batch {
    let b = this.batches.get(material);
    if (!b) {
      b = { mesh: this.createMesh(material, INITIAL_CAPACITY), count: 0 };
      this.batches.set(material, b);
    }
    return b;
  }

  private createMesh(material: THREE.Material | THREE.Material[], capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // cor por instância desde o início (o shader pré-compilado já inclui a cor)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // as instâncias se espalham pelo mapa inteiro: o volume da malha não serve para recorte
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'zombie-instances';
    this.scene.add(mesh);
    return mesh;
  }

  private grow(material: THREE.Material | THREE.Material[], b: Batch): void {
    const old = b.mesh;
    const bigger = this.createMesh(material, old.instanceMatrix.count * 2);
    (bigger.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    (bigger.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array);
    old.removeFromParent();
    old.dispose();
    b.mesh = bigger;
  }

  private inScene(o: THREE.Object3D): boolean {
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p === this.scene) return true;
      p = p.parent;
    }
    return false;
  }
}
