import type * as THREE_T from 'three';
import * as THREE from 'three';
import type { SoundEngine } from '../../audio/SoundEngine';
import type { Decals } from '../../effects/Decals';
import type { ParticleSystem } from '../../effects/ParticleSystem';

export type BlastKind = 'frag' | 'rocket' | 'grenade40' | 'flash' | 'fire';

export interface ExplosionHooks {
  /** Tremor de câmera (0..1). */
  shake(amount: number): void;
  /** Cegueira por granada de luz (0..1). */
  blind(amount: number): void;
  /** Onda de choque: destrói blocos e empurra objetos com física. */
  blast?(center: THREE.Vector3, radius: number): void;
  /** Qualquer detonação (inclusive luz e fogo) — o modo online reporta as do jogador. */
  detonated?(kind: BlastKind, pos: THREE.Vector3, source: DetonationSource): void;
}

/** De onde veio a detonação: projétil local (reporta dano) ou de outro jogador. */
export interface DetonationSource {
  id: number;
  remote: boolean;
}

interface FireZone {
  pos: THREE.Vector3;
  radius: number;
  time: number;
  light: THREE.PointLight;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Explosões, clarões e áreas de fogo. */
export class Explosions {
  private readonly lights: THREE.PointLight[] = [];
  private readonly fires: FireZone[] = [];
  private readonly ray = new THREE.Raycaster();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly particles: ParticleSystem,
    private readonly decals: Decals,
    private readonly audio: SoundEngine,
    private readonly camera: THREE.Camera,
    private readonly occluders: THREE_T.Object3D[],
    private readonly hooks: ExplosionHooks,
  ) {
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 18, 2);
      scene.add(l);
      this.lights.push(l);
    }
  }

  detonate(kind: BlastKind, pos: THREE.Vector3, normal: THREE.Vector3 = UP, source: DetonationSource = { id: 0, remote: false }): void {
    this.hooks.detonated?.(kind, pos, source);
    const dist = this.camera.position.distanceTo(pos);
    const near = Math.max(0, 1 - dist / 25);
    if (kind === 'flash') return this.flash(pos, dist);
    if (kind === 'fire') return this.fire(pos);

    const big = kind === 'rocket' ? 1.3 : kind === 'grenade40' ? 0.9 : 1;
    const p = this.tmp.copy(pos).addScaledVector(normal, 0.15);
    this.particles.burst('fire', Math.round(55 * big), p, normal, 7 * big, 1.2, { life: 0.45, size: 0.35 * big, grow: 0.1, drag: 3, color: 0xffb14a, colorJitter: 0.5 });
    this.particles.burst('fire', Math.round(20 * big), p, null, 3, 1, { life: 0.3, size: 0.5 * big, grow: 0.05, drag: 2, color: 0xfff1b0 });
    this.particles.burst('smoke', Math.round(30 * big), p, normal, 3 * big, 1.4, { life: 2.2, size: 0.45 * big, grow: 2.6, drag: 1.6, gravity: 0.8, color: 0x4a4a4e, colorJitter: 0.4 });
    this.particles.burst('debris', Math.round(26 * big), p, normal, 9 * big, 1.1, { life: 1.4, size: 0.07, grow: 1, gravity: -16, drag: 0.4, color: 0xd9dadc, colorJitter: 0.3 });
    this.particles.burst('spark', 30, p, normal, 14, 1.2, { life: 0.5, size: 0.03, grow: 0.4, gravity: -12, drag: 0.8, color: 0xffc46b });
    this.decals.place(pos, normal, 2.4 * big, true);
    this.lightFlash(pos, 30 * big, 0.25, 0xffa04a);
    this.audio.play('explosion', Math.max(0.25, 1 - dist / 70));
    this.hooks.shake(near * big);
    this.hooks.blast?.(pos, 4.5 * big);
  }

  update(dt: number, time: number): void {
    for (const l of this.lights) {
      if (l.userData.ttl > 0) {
        l.userData.ttl -= dt;
        l.intensity = Math.max(0, l.userData.peak * (l.userData.ttl / l.userData.dur));
      }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.time -= dt;
      const fade = Math.min(1, f.time / 1.5);
      f.light.intensity = (6 + Math.sin(time * 23) * 1.5 + Math.sin(time * 37) * 1) * fade;
      const n = Math.round(60 * dt * 10 * fade);
      for (let j = 0; j < n; j++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * f.radius;
        this.tmp.set(f.pos.x + Math.cos(a) * r, f.pos.y + 0.05, f.pos.z + Math.sin(a) * r);
        this.tmp2.set((Math.random() - 0.5) * 0.4, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.4);
        const hot = Math.random() < 0.4;
        this.particles.emit('fire', this.tmp, this.tmp2, { life: 0.6, size: hot ? 0.16 : 0.24, grow: 0.1, drag: 1, color: hot ? 0xfff0a0 : 0xff7a2a, colorJitter: 0.3 });
        if (Math.random() < 0.08) {
          this.tmp2.y = 1.2;
          this.particles.emit('smoke', this.tmp.setY(f.pos.y + 0.8), this.tmp2, { life: 1.6, size: 0.25, grow: 2.5, drag: 0.8, color: 0x3a3a3c });
        }
      }
      if (f.time <= 0) {
        f.light.intensity = 0;
        f.light.userData.busy = false;
        this.fires.splice(i, 1);
      }
    }
  }

  private flash(pos: THREE.Vector3, dist: number): void {
    this.particles.burst('spark', 50, pos, null, 10, 1, { life: 0.35, size: 0.05, grow: 0.3, gravity: -6, color: 0xffffff });
    this.particles.burst('smoke', 12, pos, UP, 1.5, 1.2, { life: 2.5, size: 0.3, grow: 3, drag: 1.2, gravity: 0.5, color: 0xb9bcc2 });
    this.lightFlash(pos, 80, 0.4, 0xffffff);
    this.audio.play('flashbang', Math.max(0.3, 1 - dist / 60));

    // cegueira: depende da distância, do ângulo de visão e de linha de visada
    const toBlast = this.tmp.subVectors(pos, this.camera.position);
    const len = toBlast.length();
    if (len > 18) return;
    toBlast.normalize();
    const forward = this.tmp2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const facing = Math.max(0, forward.dot(toBlast));
    this.ray.set(this.camera.position, toBlast);
    this.ray.far = len - 0.2;
    if (this.ray.intersectObjects(this.occluders, false).length > 0) return;
    const amount = Math.min(1, (1 - len / 18) * 1.4) * (0.25 + 0.75 * facing);
    this.hooks.blind(amount);
    this.hooks.shake(0.2 * amount);
  }

  private fire(pos: THREE.Vector3): void {
    this.audio.play('glass');
    this.audio.play('fire');
    this.decals.place(pos, UP, 4, true);
    this.particles.burst('fire', 40, pos, UP, 4, 1.5, { life: 0.5, size: 0.3, grow: 0.1, drag: 2, color: 0xffa040, colorJitter: 0.4 });
    this.particles.burst('debris', 14, pos, UP, 3, 1.4, { life: 0.8, size: 0.03, grow: 1, gravity: -12, color: 0x7a4a24 });
    const light = this.lights.find((l) => !l.userData.busy && !(l.userData.ttl > 0)) ?? this.lights[0];
    light.userData.busy = true;
    light.userData.ttl = 0;
    light.color.set(0xff8a3a);
    light.position.copy(pos).setY(pos.y + 0.8);
    this.fires.push({ pos: pos.clone(), radius: 3, time: 7, light });
  }

  private lightFlash(pos: THREE.Vector3, peak: number, dur: number, color: number): void {
    const l = this.lights.find((x) => !x.userData.busy && !(x.userData.ttl > 0)) ?? this.lights.find((x) => !x.userData.busy) ?? this.lights[0];
    l.color.set(color);
    l.position.copy(pos).setY(pos.y + 0.6);
    l.userData.peak = peak;
    l.userData.dur = dur;
    l.userData.ttl = dur;
    l.intensity = peak;
  }
}
