import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { SoundEngine } from '../audio/SoundEngine';
import type { Decals } from '../effects/Decals';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Barricade, Barricades } from '../world/Barricades';
import { OUTFIT_COUNT, SKINS, variantAt, type ZombieVariant } from './zombie/variants';
import { Ragdoll, RAGDOLL_GROUP } from './zombie/Ragdoll';
import { Zombie } from './zombie/Zombie';
import type { Severable } from './zombie/zones';

/** Quantidade por onda: 1, 2, 4, 8, 16 e depois sempre 32. */
export const waveSize = (wave: number) => Math.min(32, 2 ** (wave - 1));

const INTERMISSION = 5;
const SPAWN_INTERVAL = 0.35;
const MAX_ACTIVE_RAGDOLLS = 10;
const BODY_LIFETIME = 25;
const GIB_LIFETIME = 15;

/** Tamanho/centro (espaço do osso) das partes arrancadas, para a física. */
const GIB_SHAPE: Record<Severable, { half: [number, number, number]; center: [number, number, number]; mass: number }> = {
  head: { half: [0.13, 0.2, 0.13], center: [0, 0.2, 0], mass: 5 },
  upperArm: { half: [0.065, 0.34, 0.065], center: [0, -0.34, 0], mass: 4 },
  forearm: { half: [0.055, 0.19, 0.05], center: [0, -0.19, 0], mass: 2 },
  hand: { half: [0.055, 0.055, 0.035], center: [0, -0.055, 0], mass: 0.5 },
  thigh: { half: [0.08, 0.46, 0.13], center: [0, -0.45, -0.03], mass: 11 },
  shin: { half: [0.08, 0.25, 0.13], center: [0, -0.24, -0.03], mass: 4 },
  foot: { half: [0.075, 0.045, 0.135], center: [0, -0.025, -0.05], mass: 1 },
};

interface Gib {
  group: THREE.Group;
  body: CANNON.Body;
  center: THREE.Vector3;
  age: number;
}

export interface DirectorHooks {
  /** Zumbi acertou o jogador. */
  onPlayerHit(damage: number): void;
  /** Nova onda começou. */
  onWave(wave: number, count: number): void;
}

export interface EnemyHit {
  distance: number;
  point: THREE.Vector3;
}

/**
 * Ondas de zumbis (1, 2, 4, 8, 16, 32), tiros e explosões neles, membros arrancados
 * com física, sangue e ragdolls.
 */
export class ZombieDirector {
  wave = 0;
  readonly zombies: Zombie[] = [];
  private readonly ragdolls: { ragdoll: Ragdoll; zombie: Zombie }[] = [];
  private readonly gibs: Gib[] = [];
  private toSpawn = 0;
  private timer = 2;
  private spawnTimer = 0;
  private groanTimer = 3;
  private time = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly stumps: THREE.Vector3[] = [];
  private readonly spawnPoints: THREE.Vector3[];
  /** Zumbi → barricada que ele está tentando atravessar. */
  private readonly breach = new Map<Zombie, Barricade>();
  /** Roupas embaralhadas: só repete uma combinação depois de usar as 125. */
  private outfitDeck: number[] = [];

  /** Próxima variação: roupa do "baralho" + tom de pele aleatório. */
  private nextVariant(): ZombieVariant {
    if (!this.outfitDeck.length) {
      this.outfitDeck = Array.from({ length: OUTFIT_COUNT }, (_, i) => i);
      for (let i = this.outfitDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.outfitDeck[i], this.outfitDeck[j]] = [this.outfitDeck[j], this.outfitDeck[i]];
      }
    }
    return variantAt(this.outfitDeck.pop()!, Math.floor(Math.random() * SKINS.length));
  }

  /** Zumbis já atravessando uma porta aberta (destino fixo: lado de dentro). */
  private readonly entering = new Set<Zombie>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly particles: ParticleSystem,
    private readonly decals: Decals,
    private readonly audio: SoundEngine,
    private readonly colliders: THREE.Box3[],
    private readonly player: { position: THREE.Vector3 },
    private readonly hooks: DirectorHooks,
    mapSize: number,
    private readonly barricades: Barricades | null = null,
  ) {
    // pontos de spawn num anel perto da borda do mapa
    const r = mapSize / 2 - 3;
    this.spawnPoints = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    });
  }

  get alive(): number {
    return this.zombies.filter((z) => !z.dead).length + this.toSpawn;
  }

  /** Recomeça do zero (ex.: jogador morreu). */
  reset(): void {
    for (const z of this.zombies) z.dispose();
    this.zombies.length = 0;
    for (const r of this.ragdolls) r.ragdoll.dispose();
    this.ragdolls.length = 0;
    for (const g of this.gibs) this.removeGib(g);
    this.gibs.length = 0;
    this.wave = 0;
    this.toSpawn = 0;
    this.timer = 3;
    this.breach.clear();
    this.entering.clear();
    this.barricades?.reset();
  }

  update(dt: number): void {
    this.time += dt;
    this.updateWaves(dt);

    const ctx = {
      dt,
      time: this.time,
      target: this.player.position,
      colliders: this.colliders,
      onAttack: (d: number) => {
        this.hooks.onPlayerHit(d);
        this.audio.play('zombieAttack', 0.7);
      },
    };
    const living = this.zombies.filter((z) => !z.dead);
    for (const z of living) this.updateBreach(z);
    for (const z of living) z.update(ctx);
    const grounded = living.filter((z) => !z.vaulting);
    for (let i = 0; i < grounded.length; i++) for (let j = i + 1; j < grounded.length; j++) grounded[i].separate(grounded[j]);

    // sangue saindo dos tocos
    for (const z of living) {
      z.bleeding(this.stumps);
      for (const p of this.stumps) if (Math.random() < dt * 25) this.bleed(p, 1, 1.2);
    }

    // gemidos ocasionais
    this.groanTimer -= dt;
    if (this.groanTimer <= 0 && living.length) {
      this.groanTimer = 1.5 + Math.random() * 3;
      const z = living[Math.floor(Math.random() * living.length)];
      const d = z.position.distanceTo(this.player.position);
      if (d < 30) this.audio.play('zombieGroan', Math.max(0.15, 1 - d / 30));
    }

    this.updateBodies(dt);
  }

  /**
   * Tiro/golpe: procura o zumbi mais próximo no raio (até `far`).
   * Se acertar, aplica dano, sangue, desmembramento e ragdoll.
   */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, far: number, damage: number): EnemyHit | null {
    this.raycaster.set(origin, dir);
    this.raycaster.far = far;
    let best: THREE.Intersection | null = null;
    for (const z of this.zombies) {
      if (z.dead) continue;
      // descarte rápido pela esfera do corpo
      const c = z.center(this.tmp);
      if (this.raycaster.ray.distanceSqToPoint(c) > 1.3 * 1.3) continue;
      const hit = this.raycaster.intersectObjects(z.meshes, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    if (!best) return null;
    const mesh = best.object as THREE.Mesh;
    const zombie = mesh.userData.zombie as Zombie;
    const res = zombie.hit(mesh, damage);

    // sangue e som de carne
    this.bleed(best.point, Math.round(4 + damage / 8), 2.5, dir);
    this.audio.play(res.zone.zone === 'head' ? 'gore' : 'flesh', 0.6);

    for (const s of res.severed) {
      this.spawnGib(s.part, s.group, dir, damage);
      this.bleed(best.point, 14, 3.5, dir);
      this.audio.play('gore', 0.9);
    }
    if (res.killed) this.kill(zombie, res.bone, best.point, dir.clone().multiplyScalar(damage * 0.55));
    return { distance: best.distance, point: best.point.clone() };
  }

  /** Explosão: dano por distância; mortos viram ragdoll arremessado. */
  blast(center: THREE.Vector3, radius: number, damage: number): void {
    for (const z of this.zombies) {
      if (z.dead) continue;
      const d = z.center(this.tmp).distanceTo(center);
      if (d > radius) continue;
      const k = 1 - d / radius;
      z.hp -= damage * k;
      // explosão perto arranca membros
      if (k > 0.55) {
        const part = (['upperArm', 'forearm', 'shin', 'foot'] as Severable[])[Math.floor(Math.random() * 4)];
        const mesh = z.meshes.find((m) => {
          const zone = (m.userData.hit as { zone: string }).zone;
          return { upperArm: 'shoulder', forearm: 'forearm', shin: 'leg', foot: 'foot' }[part as 'upperArm'] === zone;
        });
        if (mesh) {
          const res = z.hit(mesh, 999 / 4);
          for (const s of res.severed) this.spawnGib(s.part, s.group, this.tmp2.subVectors(z.center(this.tmp), center).normalize(), 200);
        }
      }
      if (z.hp <= 0 || z.dead) {
        z.state = 'dead';
        const out = this.tmp2.subVectors(z.center(this.tmp), center).normalize();
        this.kill(z, 'chest', z.center(this.tmp), out.multiplyScalar(0));
        this.ragdolls[this.ragdolls.length - 1]?.ragdoll.blast(center, radius * 1.2, 9 * k + 3);
        this.bleed(z.center(this.tmp), 20, 4);
      }
    }
    // corpos e partes já no chão também voam
    for (const r of this.ragdolls) if (r.ragdoll.isActive) r.ragdoll.blast(center, radius, 7);
    for (const g of this.gibs) {
      const b = g.body;
      this.tmp.set(b.position.x - center.x, b.position.y - center.y, b.position.z - center.z);
      const d = this.tmp.length();
      if (d > radius) continue;
      this.tmp.normalize().multiplyScalar(8 * (1 - d / radius) * b.mass);
      b.wakeUp();
      b.applyImpulse(new CANNON.Vec3(this.tmp.x, this.tmp.y + 3 * b.mass, this.tmp.z));
    }
  }

  // ───────────────────────────────────────────

  private updateWaves(dt: number): void {
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.zombies.filter((z) => !z.dead).length < 32) {
        if (this.spawnOne()) this.toSpawn--;
        this.spawnTimer = SPAWN_INTERVAL;
      }
      return;
    }
    if (this.zombies.some((z) => !z.dead)) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.wave++;
    this.toSpawn = waveSize(this.wave);
    this.timer = INTERMISSION;
    this.hooks.onWave(this.wave, this.toSpawn);
  }

  /**
   * Zumbi com barricada: vai até o lado de fora, arranca as tábuas (uma por golpe)
   * e, sem tábuas, pula a janela ou atravessa a porta. Depois persegue o jogador.
   */
  private updateBreach(z: Zombie): void {
    const b = this.breach.get(z);
    if (!b) return;
    if (z.vaulting) return;
    const near = Math.hypot(z.position.x - b.outside.x, z.position.z - b.outside.z) < 0.6;
    // já do lado de dentro?
    const o = b.data.outward;
    const side = (z.position.x - b.data.position.x) * o.x + (z.position.z - b.data.position.z) * o.z;
    if (side < -0.3) {
      this.breach.delete(z);
      this.entering.delete(z);
      z.goal = null;
      z.faceTo = null;
      z.tearing = false;
      return;
    }
    if (this.entering.has(z)) {
      // atravessando a porta: segue para dentro (se alguém pregar tábuas, volta a arrancar)
      if (b.count === 0) return;
      this.entering.delete(z);
    }
    z.goal = b.outside;
    z.faceTo = b.center;
    z.tearing = near && b.count > 0;
    while (z.tears > 0) {
      z.tears--;
      this.barricades!.removeBoard(b);
    }
    if (near && b.count === 0) {
      if (b.data.kind === 'window') z.startVault(b.inside, b.data.position.y);
      else {
        // porta aberta: entra andando
        z.goal = b.inside;
        z.faceTo = null;
        z.tearing = false;
        this.entering.add(z);
      }
    }
  }

  private spawnOne(): boolean {
    if (this.barricades?.list.length) return this.spawnOutside();
    // ponto livre e longe do jogador
    const options = this.spawnPoints
      .filter((p) => p.distanceTo(this.player.position) > 14)
      .sort(() => Math.random() - 0.5);
    for (const p of options) {
      const pos = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
      const probe = new THREE.Box3(new THREE.Vector3(pos.x - 0.3, 0.05, pos.z - 0.3), new THREE.Vector3(pos.x + 0.3, 1.8, pos.z + 0.3));
      if (this.colliders.some((c) => c.intersectsBox(probe))) continue;
      // ondas mais altas: zumbis um pouco mais rápidos
      this.zombies.push(new Zombie(this.scene, pos, 1 + Math.min(0.5, (this.wave - 1) * 0.06), this.nextVariant()));
      return true;
    }
    return false;
  }

  /** Mapa com barricadas: nasce do lado de fora e escolhe a abertura menos disputada. */
  private spawnOutside(): boolean {
    const list = this.barricades!.list;
    const load = (b: Barricade) => [...this.breach.values()].filter((x) => x === b).length;
    const sorted = [...list].sort((a, b) => load(a) - load(b) + (Math.random() - 0.5) * 1.5);
    for (const b of sorted) {
      const o = b.data.outward;
      for (let tries = 0; tries < 6; tries++) {
        const dist = 7 + Math.random() * 8;
        const lateral = (Math.random() - 0.5) * 8;
        const pos = new THREE.Vector3(b.outside.x + o.x * dist + o.z * lateral, 0, b.outside.z + o.z * dist + o.x * lateral);
        const probe = new THREE.Box3(new THREE.Vector3(pos.x - 0.3, 0.05, pos.z - 0.3), new THREE.Vector3(pos.x + 0.3, 1.8, pos.z + 0.3));
        if (this.colliders.some((c) => c.intersectsBox(probe))) continue;
        const z = new Zombie(this.scene, pos, 1 + Math.min(0.5, (this.wave - 1) * 0.06), this.nextVariant());
        this.zombies.push(z);
        this.breach.set(z, b);
        return true;
      }
    }
    return false;
  }

  private kill(zombie: Zombie, bone: string, point: THREE.Vector3, impulse: THREE.Vector3): void {
    this.breach.delete(zombie);
    this.entering.delete(zombie);
    zombie.state = 'dead';
    zombie.deadAt = this.time;
    const ragdoll = new Ragdoll(this.physics, this.scene, zombie.bones, (o) => zombie.attached(o), zombie.velocity);
    ragdoll.impulse(bone, point, impulse.add(new THREE.Vector3(0, impulse.length() * 0.15, 0)));
    this.ragdolls.push({ ragdoll, zombie });
    this.audio.play('zombieDeath', 0.8);
    // limita a quantidade de ragdolls simulando ao mesmo tempo
    const active = this.ragdolls.filter((r) => r.ragdoll.isActive);
    if (active.length > MAX_ACTIVE_RAGDOLLS) active[0].ragdoll.freeze();
  }

  private spawnGib(part: Severable, group: THREE.Group, dir: THREE.Vector3, damage: number): void {
    const shape = GIB_SHAPE[part];
    this.scene.attach(group);
    group.updateMatrixWorld(true);
    const center = new THREE.Vector3(...shape.center);
    const pos = group.localToWorld(center.clone());
    const q = group.getWorldQuaternion(new THREE.Quaternion());
    const body = new CANNON.Body({
      mass: shape.mass,
      material: this.physics.material,
      shape: new CANNON.Box(new CANNON.Vec3(...shape.half)),
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      quaternion: new CANNON.Quaternion(q.x, q.y, q.z, q.w),
      linearDamping: 0.1,
      angularDamping: 0.3,
      collisionFilterGroup: RAGDOLL_GROUP,
      collisionFilterMask: 1,
    });
    const k = Math.min(6, 1.5 + damage * 0.04);
    body.velocity.set(dir.x * k + (Math.random() - 0.5), dir.y * k + 2 + Math.random() * 1.5, dir.z * k + (Math.random() - 0.5));
    body.angularVelocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    this.physics.world.addBody(body);
    this.gibs.push({ group, body, center, age: 0 });
  }

  private updateBodies(dt: number): void {
    for (const g of this.gibs) {
      g.age += dt;
      const b = g.body;
      g.group.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      this.tmp.copy(g.center).applyQuaternion(g.group.quaternion);
      g.group.position.set(b.position.x - this.tmp.x, b.position.y - this.tmp.y, b.position.z - this.tmp.z);
      // pinga sangue no começo
      if (g.age < 1.5 && Math.random() < dt * 10) this.bleed(g.group.getWorldPosition(this.tmp2), 1, 0.8);
    }
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      if (this.gibs[i].age > GIB_LIFETIME) {
        this.removeGib(this.gibs[i]);
        this.gibs.splice(i, 1);
      }
    }
    for (const r of this.ragdolls) r.ragdoll.update(dt);
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i];
      if (r.ragdoll.age > 8 && r.ragdoll.isActive) r.ragdoll.freeze();
      if (r.ragdoll.age > BODY_LIFETIME) {
        r.ragdoll.dispose();
        r.zombie.dispose();
        this.ragdolls.splice(i, 1);
        this.zombies.splice(this.zombies.indexOf(r.zombie), 1);
      }
    }
  }

  private removeGib(g: Gib): void {
    this.physics.world.removeBody(g.body);
    g.group.removeFromParent();
  }

  /** Sangue: gotas + névoa, e mancha no chão. */
  private bleed(p: THREE.Vector3, count: number, speed: number, dir?: THREE.Vector3): void {
    const v = this.tmp2;
    for (let i = 0; i < count; i++) {
      v.set((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      if (dir) v.addScaledVector(dir, speed * 0.6);
      this.particles.emit('debris', p, v, { life: 0.9, size: 0.035, grow: 0.7, gravity: -14, drag: 0.4, color: 0x7d0f0c, colorJitter: 0.4 });
    }
    if (count >= 3) {
      this.particles.emit('dust', p, v.set(0, 0.3, 0), { life: 0.5, size: 0.12, grow: 2, drag: 2, color: 0x6e1210 });
      if (Math.random() < 0.5) this.decals.placeBlood(this.tmp.set(p.x + (Math.random() - 0.5) * 0.6, 0.01, p.z + (Math.random() - 0.5) * 0.6), 0.35 + Math.random() * 0.5);
    }
  }
}
