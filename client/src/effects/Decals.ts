import * as THREE from 'three';
import { createBulletHoleTexture } from '../textures/WorldTextures';

const MAX = 120;

/** Marcas de bala e queimaduras de explosão (planos reaproveitados). */
export class Decals {
  private readonly items: THREE.Mesh[] = [];
  private next = 0;
  private readonly look = new THREE.Vector3();
  private readonly holeMat: THREE.MeshBasicMaterial;
  private readonly scorchMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const tex = createBulletHoleTexture();
    const base = { map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 };
    this.holeMat = new THREE.MeshBasicMaterial(base);
    this.scorchMat = new THREE.MeshBasicMaterial({ ...base, color: 0x333333, opacity: 0.85 });
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX; i++) {
      const m = new THREE.Mesh(geo, this.holeMat);
      m.visible = false;
      scene.add(m);
      this.items.push(m);
    }
  }

  place(point: THREE.Vector3, normal: THREE.Vector3, size: number, scorch = false): void {
    const d = this.items[this.next];
    this.next = (this.next + 1) % MAX;
    d.material = scorch ? this.scorchMat : this.holeMat;
    d.position.copy(point).addScaledVector(normal, scorch ? 0.006 : 0.003);
    d.lookAt(this.look.copy(d.position).add(normal));
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    d.visible = true;
  }
}
