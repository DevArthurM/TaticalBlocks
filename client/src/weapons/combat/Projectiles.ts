import type { ThrowableEffect } from '@shared/weapons/types';
import * as THREE from 'three';
import type { SoundEngine } from '../../audio/SoundEngine';
import type { ParticleSystem } from '../../effects/ParticleSystem';
import { buildWeaponModel } from '../models/registry';
import type { BlastKind, Explosions } from './Explosions';

type ProjectileKind = 'rocket' | 'grenade40' | 'thrown';

interface Projectile {
  kind: ProjectileKind;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  fuse: number | null;
  blast: BlastKind;
  spin: THREE.Vector3;
  age: number;
  /** Identificador para o modo online (liga lançamento ↔ explosão). */
  netId: number;
  /** Projétil de outro jogador: só efeitos visuais/destruição, sem reportar dano. */
  remote: boolean;
}

/** Projétil lançado pelo próprio jogador (o modo online repassa aos outros). */
export interface LaunchInfo {
  id: number;
  weapon: string;
  kind: 'launch' | 'throw';
  origin: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number | null;
}

const GRAVITY = { rocket: -1.5, grenade40: -9.8, thrown: -14 } as const;

/** Foguetes, granadas de 40 mm e arremessáveis com física simples e quique. */
export class Projectiles {
  private readonly list: Projectile[] = [];
  private readonly ray = new THREE.Raycaster();
  private readonly next = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private nextId = 1;
  /** Avisado a cada projétil lançado/arremessado pelo próprio jogador. */
  onLaunch: (info: LaunchInfo) => void = () => {};

  constructor(
    private readonly scene: THREE.Scene,
    private readonly targets: THREE.Object3D[],
    private readonly explosions: Explosions,
    private readonly particles: ParticleSystem,
    private readonly audio: SoundEngine,
  ) {}

  launch(kind: 'rocket' | 'grenade40', origin: THREE.Vector3, dir: THREE.Vector3, weapon = '', remote = false): void {
    const speed = kind === 'rocket' ? 45 : 34;
    this.launchWithVelocity(kind, origin, dir.clone().multiplyScalar(speed), weapon, remote);
  }

  /** Foguete/granada 40 mm com velocidade explícita (também usado para projéteis de outros jogadores). */
  launchWithVelocity(kind: 'rocket' | 'grenade40', origin: THREE.Vector3, vel: THREE.Vector3, weapon = '', remote = false): void {
    const mesh = kind === 'rocket' ? this.extractPart('rpg7', 'rocket') : this.extractPart('m32', 'shell');
    const netId = this.nextId++;
    this.add({ kind, mesh, pos: origin.clone(), vel: vel.clone(), gravity: GRAVITY[kind], fuse: null, blast: kind, spin: new THREE.Vector3(), age: 0, netId, remote });
    if (!remote) this.onLaunch({ id: netId, weapon, kind: 'launch', origin: origin.clone(), vel: vel.clone(), fuse: null });
  }

  throwItem(id: string, effect: ThrowableEffect, fuse: number | null, origin: THREE.Vector3, vel: THREE.Vector3, remote = false): void {
    const model = buildWeaponModel(id);
    model.root.scale.setScalar(1.6);
    if (effect === 'fire') model.parts.get('flame')!.visible = true;
    model.parts.get('pin')?.removeFromParent();
    const spin = new THREE.Vector3(8 + Math.random() * 6, Math.random() * 4, Math.random() * 4);
    const netId = this.nextId++;
    this.add({ kind: 'thrown', mesh: model.root, pos: origin.clone(), vel: vel.clone(), gravity: GRAVITY.thrown, fuse, blast: effect, spin, age: 0, netId, remote });
    if (!remote) this.onLaunch({ id: netId, weapon: id, kind: 'throw', origin: origin.clone(), vel: vel.clone(), fuse });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      p.vel.y += p.gravity * dt;
      this.next.copy(p.pos).addScaledVector(p.vel, dt);

      const exploded = this.collide(p) || (p.fuse !== null && (p.fuse -= dt) <= 0) || p.age > 12;
      if (exploded) {
        if (p.fuse !== null && p.fuse <= 0) this.explosions.detonate(p.blast, p.pos, undefined, { id: p.netId, remote: p.remote });
        this.scene.remove(p.mesh);
        this.list.splice(i, 1);
        continue;
      }
      p.mesh.position.copy(p.pos);
      if (p.kind === 'thrown') {
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.rotation.z += p.spin.z * dt;
      } else {
        p.mesh.lookAt(this.tmp.copy(p.pos).sub(p.vel));
      }
      if (p.kind === 'rocket') {
        this.tmp.copy(p.vel).normalize().multiplyScalar(-0.4).add(p.pos);
        this.particles.emit('smoke', this.tmp, this.dir.set((Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5), { life: 1.2, size: 0.18, grow: 3, drag: 1.5, color: 0x8d9097 });
        this.particles.emit('fire', this.tmp, this.dir.set(0, 0, 0), { life: 0.08, size: 0.14, grow: 0.2, color: 0xffc060 });
      }
    }
  }

  /** Testa o segmento pos→next contra o mundo. Retorna true se o projétil deve sumir. */
  private collide(p: Projectile): boolean {
    this.dir.subVectors(this.next, p.pos);
    const len = this.dir.length();
    let hit: THREE.Intersection | undefined;
    if (len > 1e-5) {
      this.ray.set(p.pos, this.dir.normalize());
      this.ray.far = len;
      hit = this.ray.intersectObjects(this.targets, false)[0];
    }
    if (!hit && this.next.y < 0.02) {
      hit = { point: this.next.clone().setY(0.02), distance: 0, object: this.scene, face: { normal: new THREE.Vector3(0, 1, 0) } } as unknown as THREE.Intersection;
    }
    if (!hit) {
      p.pos.copy(this.next);
      return false;
    }
    if (hit.face) this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    else this.normal.set(0, 1, 0);

    // impacto direto
    if (p.kind !== 'thrown' || p.fuse === null) {
      this.explosions.detonate(p.blast, hit.point, this.normal, { id: p.netId, remote: p.remote });
      return true;
    }
    // quique
    const speed = p.vel.length();
    const vn = p.vel.dot(this.normal);
    p.vel.addScaledVector(this.normal, -1.45 * vn).multiplyScalar(0.62);
    p.spin.multiplyScalar(0.6);
    p.pos.copy(hit.point).addScaledVector(this.normal, 0.04);
    if (speed > 2.5) this.audio.play('bounce', Math.min(1, speed / 12));
    if (p.vel.length() < 0.6 && this.normal.y > 0.7) {
      p.vel.set(0, 0, 0);
      p.gravity = 0;
    }
    return false;
  }

  private add(p: Projectile): void {
    p.mesh.position.copy(p.pos);
    p.mesh.traverse((o) => (o.castShadow = true));
    this.scene.add(p.mesh);
    this.list.push(p);
  }

  private extractPart(modelId: string, part: 'rocket' | 'shell'): THREE.Object3D {
    const model = buildWeaponModel(modelId);
    const obj = model.parts.get(part)!;
    obj.removeFromParent();
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.visible = true;
    const holder = new THREE.Group();
    // o modelo aponta para -Z e o lookAt mira +Z para trás → -Z segue a velocidade
    obj.scale.setScalar(part === 'shell' ? 1.6 : 1);
    holder.add(obj);
    return holder;
  }
}
