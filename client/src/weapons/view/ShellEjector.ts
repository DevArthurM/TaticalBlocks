import type { ShellType } from '@shared/weapons/types';
import * as THREE from 'three';

interface Shell {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

const POOL_SIZE = 24;
const LIFETIME = 0.7;
const GRAVITY = -4.5;

const SHELL_LOOK: Record<Exclude<ShellType, 'none'>, { size: [number, number, number]; mat: THREE.Material }> = {
  pistol: { size: [0.008, 0.008, 0.02], mat: new THREE.MeshStandardMaterial({ color: 0xd4a94a, metalness: 0.85, roughness: 0.3 }) },
  rifle: { size: [0.009, 0.009, 0.04], mat: new THREE.MeshStandardMaterial({ color: 0xd4a94a, metalness: 0.85, roughness: 0.3 }) },
  shotgun: { size: [0.016, 0.016, 0.05], mat: new THREE.MeshStandardMaterial({ color: 0xa8322b, roughness: 0.6 }) },
};

/** Cápsulas ejetadas no espaço do viewmodel. */
export class ShellEjector {
  private readonly shells: Shell[] = [];
  private next = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);

  constructor(private readonly parent: THREE.Object3D) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.geo, SHELL_LOOK.pistol.mat);
      mesh.visible = false;
      parent.add(mesh);
      this.shells.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
  }

  spawn(from: THREE.Object3D, type: ShellType, scatter = false): void {
    if (type === 'none') return;
    const look = SHELL_LOOK[type];
    const s = this.shells[this.next];
    this.next = (this.next + 1) % POOL_SIZE;
    from.getWorldPosition(this.tmp);
    this.parent.worldToLocal(this.tmp);
    s.mesh.material = look.mat;
    s.mesh.scale.set(...look.size);
    s.mesh.position.copy(this.tmp);
    s.mesh.rotation.set(Math.random(), Math.random(), Math.random());
    if (scatter) s.velocity.set((Math.random() - 0.5) * 0.4, -0.2 - Math.random() * 0.4, (Math.random() - 0.5) * 0.3);
    else s.velocity.set(0.7 + Math.random() * 0.35, 0.9 + Math.random() * 0.4, 0.15 + Math.random() * 0.2);
    s.spin.set(Math.random() * 30, Math.random() * 30, Math.random() * 30);
    s.life = LIFETIME;
    s.mesh.visible = true;
  }

  update(dt: number): void {
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.velocity.y += GRAVITY * dt;
      s.mesh.position.addScaledVector(s.velocity, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
}
