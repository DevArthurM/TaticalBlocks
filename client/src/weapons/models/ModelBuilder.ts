import * as THREE from 'three';
import { type MatKey, type Palette, getPalette } from './palette';
import type { AnchorName, PartName, V3, ViewSetup, WeaponModel } from './types';

const unitBox = new THREE.BoxGeometry(1, 1, 1);

/**
 * DSL para montar armas em blocos. Convenção: origem = ponto onde a mão
 * direita segura, -Z = frente (cano), +Y = cima, unidades em metros.
 */
export class ModelBuilder {
  readonly root = new THREE.Group();
  private readonly parts = new Map<PartName, THREE.Object3D>();
  private readonly anchors = new Map<AnchorName, THREE.Object3D>();
  private readonly pal: Palette = getPalette();

  constructor(private readonly id: string) {
    this.root.name = id;
  }

  /** Bloco com tamanho `size` centrado em `pos`. */
  box(mat: MatKey, size: V3, pos: V3 = [0, 0, 0], parent: THREE.Object3D = this.root, rot?: V3): THREE.Mesh {
    const mesh = new THREE.Mesh(unitBox, this.pal[mat]);
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(mesh);
    return mesh;
  }

  /** Bloco "octogonal" (dois blocos cruzados) — aproxima cilindros no estilo voxel. */
  rod(mat: MatKey, thickness: number, length: number, pos: V3, parent: THREE.Object3D = this.root, axis: 'x' | 'y' | 'z' = 'z'): void {
    const size: [number, number, number] =
      axis === 'z' ? [thickness, thickness, length] : axis === 'y' ? [thickness, length, thickness] : [length, thickness, thickness];
    this.box(mat, size, pos, parent);
    const r = Math.PI / 4;
    const rot: V3 = axis === 'z' ? [0, 0, r] : axis === 'y' ? [0, r, 0] : [r, 0, 0];
    this.box(mat, size, pos, parent, rot);
  }

  group(pos: V3 = [0, 0, 0], parent: THREE.Object3D = this.root, rot?: V3): THREE.Group {
    const g = new THREE.Group();
    g.position.set(pos[0], pos[1], pos[2]);
    if (rot) g.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(g);
    return g;
  }

  part(name: PartName, pos: V3 = [0, 0, 0], parent: THREE.Object3D = this.root, rot?: V3): THREE.Group {
    const g = this.group(pos, parent, rot);
    g.name = name;
    this.parts.set(name, g);
    return g;
  }

  anchor(name: AnchorName, pos: V3, parent: THREE.Object3D = this.root): THREE.Object3D {
    const o = new THREE.Object3D();
    o.name = `@${name}`;
    o.position.set(pos[0], pos[1], pos[2]);
    parent.add(o);
    this.anchors.set(name, o);
    return o;
  }

  build(view: ViewSetup): WeaponModel {
    this.root.scale.setScalar(view.scale);
    const rest = new Map<THREE.Object3D, { pos: THREE.Vector3; rot: THREE.Euler }>();
    for (const p of this.parts.values()) rest.set(p, { pos: p.position.clone(), rot: p.rotation.clone() });
    return { id: this.id, root: this.root, parts: this.parts, anchors: this.anchors, rest, view };
  }
}
