import * as THREE from 'three';
import { createBulletHoleTexture } from '../textures/WorldTextures';

const MAX = 120;

/** Marcas de bala e queimaduras de explosão (planos reaproveitados). */
const PLANE_NORMAL = new THREE.Vector3(0, 0, 1);

export class Decals {
  private readonly items: THREE.Mesh[] = [];
  private next = 0;
  private readonly look = new THREE.Vector3();
  private readonly holeMat: THREE.MeshBasicMaterial;
  private readonly scorchMat: THREE.MeshBasicMaterial;
  private readonly bloodMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const tex = createBulletHoleTexture();
    const base = { map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 };
    this.holeMat = new THREE.MeshBasicMaterial(base);
    this.scorchMat = new THREE.MeshBasicMaterial({ ...base, color: 0x333333, opacity: 0.85 });
    this.bloodMat = new THREE.MeshBasicMaterial({ ...base, color: 0x8a0d0a, opacity: 0.9 });
    const geo = new THREE.PlaneGeometry(1, 1);
    // os três materiais distribuídos no conjunto: a pré-compilação de shaders encontra todos
    const mats = [this.holeMat, this.scorchMat, this.bloodMat];
    for (let i = 0; i < MAX; i++) {
      const m = new THREE.Mesh(geo, mats[i % mats.length]);
      m.visible = false;
      m.matrixAutoUpdate = false; // marcas não se movem depois de colocadas
      scene.add(m);
      this.items.push(m);
    }
  }

  place(point: THREE.Vector3, normal: THREE.Vector3, size: number, scorch = false): void {
    const d = this.items[this.next];
    this.next = (this.next + 1) % MAX;
    d.material = scorch ? this.scorchMat : this.holeMat;
    d.position.copy(point).addScaledVector(normal, scorch ? 0.006 : 0.003);
    // orienta o plano (+Z) pela normal; não usa lookAt, que depende da matriz de mundo
    // (congelada aqui — matrixAutoUpdate = false)
    d.quaternion.setFromUnitVectors(PLANE_NORMAL, this.look.copy(normal).normalize());
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    d.updateMatrix();
    d.visible = true;
  }

  /** Esconde marcas dentro de `radius` (a superfície onde estavam foi destruída). */
  clearNear(point: THREE.Vector3, radius: number): void {
    for (const d of this.items) if (d.visible && d.position.distanceTo(point) < radius) d.visible = false;
  }

  /** Some com todas as marcas (mapa restaurado). */
  clearAll(): void {
    for (const d of this.items) d.visible = false;
  }

  /** Mancha de sangue no chão. */
  placeBlood(point: THREE.Vector3, size: number): void {
    const d = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    d.material = this.bloodMat;
    d.position.copy(point);
    d.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    d.scale.setScalar(size);
    d.updateMatrix();
    d.visible = true;
  }
}
