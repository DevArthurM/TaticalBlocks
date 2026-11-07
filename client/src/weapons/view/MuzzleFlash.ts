import * as THREE from 'three';
import { createFlashTexture } from '../../textures/WorldTextures';

const FLASH_DURATION = 0.05;

/** Clarão do cano; é reanexado à âncora `muzzle` da arma atual. */
export class MuzzleFlash {
  readonly group = new THREE.Group();
  private readonly light = new THREE.PointLight(0xffb060, 0, 1.4, 2);
  private readonly material: THREE.MeshBasicMaterial;
  private timer = 0;
  private size = 1;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      map: createFlashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), this.material);
    const sideA = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.16), this.material);
    sideA.rotation.set(Math.PI / 2, 0, 0);
    sideA.position.z = -0.06;
    const sideB = sideA.clone();
    sideB.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    this.group.add(front, sideA, sideB, this.light);
    this.group.visible = false;
  }

  attach(anchor: THREE.Object3D | undefined, size: number): void {
    this.group.removeFromParent();
    this.size = size;
    if (anchor && size > 0) anchor.add(this.group);
  }

  trigger(): void {
    if (!this.group.parent) return;
    this.timer = FLASH_DURATION;
    this.group.visible = true;
    this.group.rotation.z = Math.random() * Math.PI * 2;
    // compensa a escala do modelo (pistolas são escaladas)
    const parentScale = this.group.parent.getWorldScale(new THREE.Vector3()).x || 1;
    this.group.scale.setScalar(((0.8 + Math.random() * 0.5) * this.size) / parentScale);
    this.light.intensity = 4;
  }

  update(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    const k = Math.max(0, this.timer / FLASH_DURATION);
    this.material.opacity = k;
    this.light.intensity = 4 * k;
    if (this.timer <= 0) this.group.visible = false;
  }
}
