import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { SoundEngine } from '../audio/SoundEngine';
import type { BloodSystem } from '../effects/BloodSystem';
import type { Decals } from '../effects/Decals';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Barricade, Barricades } from '../world/Barricades';
import { OUTFIT_COUNT, SKINS, variantAt, type ZombieVariant } from './zombie/variants';
import { Ragdoll, RAGDOLL_GROUP } from './zombie/Ragdoll';
import { type HitResult, Zombie, type ZombieContext, type ZombieKind } from './zombie/Zombie';
import { NavGrid } from './NavGrid';
import { goreMaterials, ZOMBIE_UNIT_BOX } from './zombie/ZombieModel';
import { registerZombieMesh } from './zombie/ZombieInstancer';
import type { Severable, Side } from './zombie/zones';
import { type ClientEvents, SEVER_BITS, type Vec3Tuple, ZOMBIE_FIELDS, type ZombieEvent } from '@shared/net/protocol';

const KIND_CODE: ZombieKind[] = ['normal', 'runner', 'brute'];
/** Estado dos zumbis enviado pelo anfitrião 10×/s. */
const SYNC_EVERY = 0.1;
const r2 = (n: number) => Math.round(n * 100) / 100;
const tuple = (v: THREE.Vector3): Vec3Tuple => [r2(v.x), r2(v.y), r2(v.z)];

/**
 * Modo zumbis online: um jogador (o anfitrião) simula os zumbis e envia o estado;
 * os demais só espelham (bonecos) e mandam os acertos para ele aplicar o dano.
 */
export interface ZombieNet {
  host: boolean;
  myId: string;
  /** Jogadores vivos que os zumbis perseguem. */
  targets(): { id: string; position: THREE.Vector3 }[];
  send<K extends 'zsync' | 'zev' | 'zatk' | 'zhit'>(event: K, data: ClientEvents[K]): void;
}

/** Máximo de zumbis vivos ao mesmo tempo. */
export const MAX_ALIVE = 64;
/** Quantidade por onda: 1, 2, 4, 8, 16, 32 e depois sempre 64. */
export const waveSize = (wave: number) => Math.min(MAX_ALIVE, 2 ** (wave - 1));
/** Primeira onda com o máximo de zumbis. */
const MAX_WAVE = Math.ceil(Math.log2(MAX_ALIVE)) + 1;

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
  /** Membro pendurado: preso ao toco por um ligamento (corda curta). */
  hang?: {
    stump: THREE.Object3D;
    anchor: CANNON.Body;
    constraint: CANNON.PointToPointConstraint;
    /** Ponto do membro onde o ligamento prende (espaço do corpo físico). */
    pivot: CANNON.Vec3;
    ligament: THREE.Mesh;
  };
}

/** Corpo caído: ragdoll do zumbi morto. */
interface Corpse {
  ragdoll: Ragdoll;
  zombie: Zombie;
}

/** Chance de um braço arrancado a tiro ficar pendurado por um ligamento. */
const HANG_CHANCE = 0.5;
/** Comprimento do ligamento (m). */
const LIGAMENT = 0.13;

export interface DirectorHooks {
  /** Zumbi acertou o jogador. */
  onPlayerHit(damage: number, from: THREE.Vector3): void;
  /** Nova onda começou. */
  onWave(wave: number, count: number): void;
  /** Solo: zumbi morto (tipo 0/1/2 e se foi na cabeça) — recompensa. */
  onKilled?(kind: number, head: boolean): void;
}

export interface EnemyHit {
  distance: number;
  point: THREE.Vector3;
  /** Acertou a cabeça / matou (para o marcador de acerto). */
  head?: boolean;
  killed?: boolean;
  /** Acertou um corpo já caído. */
  corpse?: boolean;
}

/**
 * Ondas de zumbis (1, 2, 4, 8, 16, 32, 64), tiros e explosões neles, membros arrancados
 * com física, sangue e ragdolls.
 */
export class ZombieDirector {
  wave = 0;
  readonly zombies: Zombie[] = [];
  private readonly ragdolls: Corpse[] = [];
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

  /** IA de caminho (campo de fluxo até o jogador). */
  private readonly nav: NavGrid;

  /**
   * Tipo do próximo zumbi: corredores a partir da onda 2, fortes a partir da 3. Depois
   * que a onda chega ao máximo (64), cada nova onda troca comuns por fortes e corredores.
   */
  private nextKind(): ZombieKind {
    const r = Math.random();
    const extra = Math.max(0, this.wave - MAX_WAVE);
    const brute = this.wave >= 3 ? Math.min(0.25, 0.1 + (this.wave - 3) * 0.04) + Math.min(0.3, extra * 0.06) : 0;
    const runner = this.wave >= 2 ? Math.min(0.4, 0.2 + (this.wave - 2) * 0.05) + Math.min(0.25, extra * 0.05) : 0;
    if (r < brute) return 'brute';
    if (r > 1 - runner) return 'runner';
    return 'normal';
  }

  /** Zumbis já atravessando uma porta aberta (destino fixo: lado de dentro). */
  private readonly entering = new Set<Zombie>();

  /** Online (modo zumbis); null = solo. */
  net: ZombieNet | null = null;
  /** Online: um zumbi morreu por tiro de `by` (marcador de abate de quem atirou). */
  onKillBy: (by: string) => void = () => {};
  private nextId = 0;
  private syncTimer = 0;

  private byId(id: number): Zombie | undefined {
    return this.zombies.find((z) => z.id === id);
  }

  /** Novo zumbi com id e visual compartilháveis pela rede. */
  private makeZombie(pos: THREE.Vector3): Zombie {
    const variant = this.nextVariant();
    const z = new Zombie(this.scene, pos, 1 + Math.min(0.5, (this.wave - 1) * 0.06), variant, this.nextKind());
    z.id = ++this.nextId;
    z.look = [variant.outfit, Math.max(0, SKINS.indexOf(variant.skin))];
    return z;
  }

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
    // IA de caminho: grade do mapa + menor caminho até o jogador
    this.nav = new NavGrid(mapSize, colliders);
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
    const net = this.net;
    if (net && !net.host) {
      // não é o anfitrião: os zumbis só seguem o estado recebido
      const living = this.zombies.filter((z) => !z.dead);
      for (const z of living) z.puppetUpdate(dt, this.time);
      this.ambient(dt, living);
      this.updateBodies(dt);
      return;
    }
    this.updateWaves(dt);

    // alvos: o jogador (solo) ou todos os jogadores vivos (online) — cada zumbi vai no mais perto
    const local = [{ id: net?.myId ?? '', position: this.player.position }];
    const targets = net ? net.targets() : local;
    const list = targets.length ? targets : local;
    this.nav.update(dt, list.map((t) => t.position));
    const nav = this.nav;
    let attacker: Zombie | null = null;
    let victim = list[0];
    const ctx: ZombieContext = {
      dt,
      time: this.time,
      target: victim.position,
      colliders: this.colliders,
      steer: (pos, out) => nav.steer(pos, ctx.target, out),
      onAttack: (d) => {
        const from = attacker?.position ?? victim.position;
        if (net) net.send('zatk', { target: victim.id, damage: Math.round(d), from: tuple(from) });
        else this.hooks.onPlayerHit(d, from);
        this.audio.at(from.x, from.z, 25, (v) => this.audio.play('zombieAttack', 0.7 * v));
      },
    };
    const living = this.zombies.filter((z) => !z.dead);
    for (const z of living) this.updateBreach(z);
    for (const z of living) {
      attacker = z;
      victim = list[0];
      if (list.length > 1) {
        let best = Infinity;
        for (const t of list) {
          const d = (t.position.x - z.position.x) ** 2 + (t.position.z - z.position.z) ** 2;
          if (d < best) {
            best = d;
            victim = t;
          }
        }
      }
      ctx.target = victim.position;
      z.update(ctx);
    }
    const grounded = living.filter((z) => !z.vaulting);
    for (let i = 0; i < grounded.length; i++) for (let j = i + 1; j < grounded.length; j++) grounded[i].separate(grounded[j]);
    this.ambient(dt, living);
    this.updateBodies(dt);

    // anfitrião: estado compacto dos zumbis para os outros
    if (net) {
      this.syncTimer -= dt;
      if (this.syncTimer <= 0) {
        this.syncTimer = SYNC_EVERY;
        net.send('zsync', { wave: this.wave, z: this.pack(living) });
      }
    }
  }

  /** Sangue dos tocos e gemidos. */
  private ambient(dt: number, living: Zombie[]): void {
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
  }

  // ───────────── rede (modo zumbis online) ─────────────

  private pack(living: Zombie[]): number[] {
    const out: number[] = [];
    for (const z of living) {
      let mask = 0;
      SEVER_BITS.forEach((key, bit) => {
        if (z.lostParts.has(key)) mask |= 1 << bit;
      });
      const st = (z.state === 'crawl' ? 1 : 0) | (z.attacking ? 2 : 0);
      out.push(z.id, r2(z.position.x), r2(z.position.z), r2(z.yaw), st, KIND_CODE.indexOf(z.kind), z.look[0], z.look[1], mask);
    }
    return out;
  }

  /** Não-anfitrião: estado recebido (cria, move, arranca partes e descarta os que sumiram). */
  applySync(wave: number, data: number[]): void {
    if (this.net?.host) return;
    this.wave = wave;
    const seen = new Set<number>();
    for (let i = 0; i + ZOMBIE_FIELDS <= data.length; i += ZOMBIE_FIELDS) {
      const [id, x, zz, yaw, st, kind, outfit, skin, mask] = data.slice(i, i + ZOMBIE_FIELDS);
      seen.add(id);
      let z = this.byId(id);
      if (!z) {
        z = new Zombie(this.scene, new THREE.Vector3(x, 0, zz), 1, variantAt(outfit, skin), KIND_CODE[kind] ?? 'normal');
        z.id = id;
        z.look = [outfit, skin];
        z.yaw = yaw;
        this.zombies.push(z);
      }
      if (z.dead) continue;
      z.setNetState(x, zz, yaw, (st & 1) !== 0, (st & 2) !== 0);
      // partes perdidas (evento perdido ou entrou no meio da partida): some sem física
      SEVER_BITS.forEach((key, bit) => {
        if (!(mask & (1 << bit)) || z.lostParts.has(key)) return;
        const [part, side] = key.split(':') as [Severable, Side];
        z.severPart(part, side)?.group.removeFromParent();
      });
    }
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.dead || seen.has(z.id)) continue;
      z.dispose();
      this.zombies.splice(i, 1);
    }
  }

  /** Não-anfitrião: morte, membro arrancado ou nova onda. */
  applyEvent(e: ZombieEvent): void {
    if (this.net?.host) return;
    if (e.type === 'wave') {
      this.wave = e.wave;
      this.hooks.onWave(e.wave, e.count);
      return;
    }
    const z = this.byId(e.id);
    if (!z || z.dead) return;
    if (e.type === 'sever') {
      const dir = new THREE.Vector3().fromArray(e.dir);
      const s = z.severPart(e.part as Severable, e.side as Side);
      if (!s) return;
      if (e.hang) this.spawnHangingLimb(s.part, s.group, s.stump, dir, 60);
      else this.spawnGib(s.part, s.group, dir, 60);
      this.bleed(s.stump.getWorldPosition(this.tmp), 14, 3.5, dir);
      this.audio.play('gore', 0.9);
    } else {
      const point = new THREE.Vector3().fromArray(e.point);
      this.kill(z, e.bone, point, new THREE.Vector3().fromArray(e.impulse));
      this.onKillBy(e.by);
    }
  }

  /** Anfitrião: tiro de outro jogador (peça `meshIndex` do zumbi `id`). */
  remoteHit(by: string, id: number, meshIndex: number, damage: number, point: Vec3Tuple, dir: Vec3Tuple): void {
    if (!this.net?.host) return;
    const z = this.byId(id);
    const mesh = z?.meshes[meshIndex];
    if (!z || z.dead || !mesh || !z.attached(mesh)) return;
    this.applyHit(z, mesh, damage, new THREE.Vector3().fromArray(point), undefined, new THREE.Vector3().fromArray(dir).normalize(), by);
  }

  /** Parte arrancada: física (pendurada ou solta) + aviso aos outros (anfitrião). */
  private severedPart(z: Zombie, s: HitResult['severed'][number], dir: THREE.Vector3, damage: number, canHang: boolean): void {
    // braço arrancado a tiro: às vezes fica pendurado no toco por um ligamento
    const arm = s.part === 'upperArm' || s.part === 'forearm';
    const hang = canHang && arm && Math.random() < HANG_CHANCE;
    if (hang) this.spawnHangingLimb(s.part, s.group, s.stump, dir, damage);
    else this.spawnGib(s.part, s.group, dir, damage);
    if (this.net?.host) this.net.send('zev', { type: 'sever', id: z.id, part: s.part, side: s.side, dir: tuple(dir), hang });
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
    // corpos no chão também levam tiro (se estiverem na frente)
    let corpse: { hit: THREE.Intersection; r: Corpse } | null = null;
    for (const r of this.ragdolls) {
      const hit = this.raycaster.intersectObjects(r.zombie.meshes, false)[0];
      if (hit && (!corpse || hit.distance < corpse.hit.distance)) corpse = { hit, r };
    }
    if (corpse && (!best || corpse.hit.distance < best.distance)) return this.shootCorpse(corpse.r, corpse.hit, dir, damage);
    if (!best) return null;
    const mesh = best.object as THREE.Mesh;
    const zombie = mesh.userData.zombie as Zombie;
    // normal da face atingida em coordenadas de mundo (para a ferida ficar na superfície certa)
    const normal = best.face ? best.face.normal.clone().transformDirection(mesh.matrixWorld) : undefined;
    const zone = (mesh.userData.hit as { zone: string }).zone;
    const head = zone === 'head' || zone === 'neck';
    if (this.net && !this.net.host) {
      // não é o anfitrião: mostra ferida e sangue já; o dano quem aplica é o anfitrião
      this.net.send('zhit', { id: zombie.id, mesh: zombie.meshes.indexOf(mesh), damage: Math.round(damage), point: tuple(best.point), dir: tuple(dir) });
      zombie.woundAt(mesh, damage, best.point, normal ?? null);
      this.bleed(best.point, Math.round(4 + damage / 8), 2.5, dir);
      this.audio.play(zone === 'head' ? 'gore' : 'flesh', 0.6);
      return { distance: best.distance, point: best.point.clone(), head };
    }
    const res = this.applyHit(zombie, mesh, damage, best.point, normal, dir, this.net?.myId ?? '');
    return { distance: best.distance, point: best.point.clone(), head, killed: res.killed };
  }

  /** Dano de um acerto: ferida, sangue, partes arrancadas e morte. */
  private applyHit(zombie: Zombie, mesh: THREE.Mesh, damage: number, point: THREE.Vector3, normal: THREE.Vector3 | undefined, dir: THREE.Vector3, by: string): HitResult {
    const res = zombie.hit(mesh, damage, point, normal);
    // sangue e som de carne
    this.bleed(point, Math.round(4 + damage / 8), 2.5, dir);
    this.audio.at(point.x, point.z, 40, (v) => this.audio.play(res.zone.zone === 'head' ? 'gore' : 'flesh', 0.6 * v));
    for (const s of res.severed) {
      this.severedPart(zombie, s, dir, damage, true);
      this.bleed(point, 14, 3.5, dir);
      this.audio.at(point.x, point.z, 40, (v) => this.audio.play('gore', 0.9 * v));
    }
    if (res.killed) {
      // o sangue sai do ponto atingido; se a parte foi arrancada, sai do toco que ficou
      const severed = res.severed.find((s) => s.group.getObjectById(mesh.id));
      this.kill(zombie, res.bone, point, dir.clone().multiplyScalar(damage * 0.55), severed ? severed.stump : mesh, by);
    }
    return res;
  }

  /** Explosão: dano por distância; mortos viram ragdoll arremessado. */
  blast(center: THREE.Vector3, radius: number, damage: number, by = ''): void {
    // online: só o anfitrião aplica dano de explosão nos zumbis
    const simulate = !this.net || this.net.host;
    for (const z of this.zombies) {
      if (z.dead || !simulate) continue;
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
          for (const s of res.severed) this.severedPart(z, s, this.tmp2.subVectors(z.center(this.tmp), center).normalize().clone(), 200, false);
        }
      }
      if (z.hp <= 0 || z.dead) {
        z.state = 'dead';
        const out = this.tmp2.subVectors(z.center(this.tmp), center).normalize();
        this.kill(z, 'chest', z.center(this.tmp), out.multiplyScalar(0), undefined, by);
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
      if (this.spawnTimer <= 0 && this.zombies.filter((z) => !z.dead).length < MAX_ALIVE) {
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
    if (this.net) this.net.send('zev', { type: 'wave', wave: this.wave, count: this.toSpawn });
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
    const players = this.net ? this.net.targets().map((t) => t.position) : [this.player.position];
    const options = this.spawnPoints
      .filter((p) => players.every((t) => p.distanceTo(t) > 14))
      .sort(() => Math.random() - 0.5);
    for (const p of options) {
      const pos = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
      const probe = new THREE.Box3(new THREE.Vector3(pos.x - 0.3, 0.05, pos.z - 0.3), new THREE.Vector3(pos.x + 0.3, 1.8, pos.z + 0.3));
      if (this.colliders.some((c) => c.intersectsBox(probe))) continue;
      // ondas mais altas: zumbis um pouco mais rápidos
      this.zombies.push(this.makeZombie(pos));
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
        const z = this.makeZombie(pos);
        this.zombies.push(z);
        this.breach.set(z, b);
        return true;
      }
    }
    return false;
  }

  /** Sangue com física (gotas que mancham piso e voxels); o jogo liga isto. */
  blood: BloodSystem | null = null;

  /**
   * `source`: de onde o sangue sai (a parte atingida, ou o toco se ela foi arrancada);
   * o jato acompanha esse ponto enquanto o corpo cai.
   */
  private kill(zombie: Zombie, bone: string, point: THREE.Vector3, impulse: THREE.Vector3, source?: THREE.Object3D, by = ''): void {
    const head = bone === 'head' || bone === 'neck';
    if (this.net?.host) this.net.send('zev', { type: 'kill', id: zombie.id, bone, point: tuple(point), impulse: tuple(impulse), by, kind: KIND_CODE.indexOf(zombie.kind), head });
    // solo: o dinheiro é dado aqui (online o servidor soma)
    if (!this.net) this.hooks.onKilled?.(KIND_CODE.indexOf(zombie.kind), head);
    const from = source ?? Object.values(zombie.bones).find((o) => o.name === bone) ?? zombie.bones.chest;
    if (this.blood) {
      // toco: o sangue sai dele (o ponto do tiro foi embora com a parte arrancada)
      const at = source && !source.userData.hit ? source.getWorldPosition(new THREE.Vector3()) : point;
      this.blood.spray(at, 26, 3, impulse.clone().normalize());
      this.blood.bleedFrom(from, at, bone === 'head' || bone === 'neck' ? 2.4 : 1.8);
    }
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

  /**
   * Tiro num corpo já caído: empurra o ragdoll (acorda se estiver parado), abre
   * ferida e espirra sangue do ponto atingido.
   */
  private shootCorpse(r: Corpse, hit: THREE.Intersection, dir: THREE.Vector3, damage: number): EnemyHit {
    const mesh = hit.object as THREE.Mesh;
    const normal = hit.face ? hit.face.normal.clone().transformDirection(mesh.matrixWorld) : undefined;
    r.zombie.woundAt(mesh, damage, hit.point, normal ?? null);
    r.ragdoll.wake();
    r.ragdoll.impulse(mesh.parent?.name ?? 'chest', hit.point, dir.clone().multiplyScalar(damage * 0.7));
    if (this.blood) {
      this.blood.spray(hit.point, Math.round(5 + damage / 6), 2.6, dir.clone().negate());
      this.blood.bleedFrom(mesh, hit.point, 0.9, 35);
    }
    this.audio.play('flesh', 0.5);
    return { distance: hit.distance, point: hit.point.clone(), corpse: true };
  }

  /**
   * Membro arrancado que fica pendurado: vira corpo físico (como as partes soltas),
   * mas preso ao toco por uma corda curta — balança conforme o zumbi anda ou cai.
   */
  private spawnHangingLimb(part: Severable, group: THREE.Group, stump: THREE.Object3D, dir: THREE.Vector3, damage: number): void {
    this.spawnGib(part, group, dir, damage * 0.25);
    const g = this.gibs[this.gibs.length - 1];
    stump.updateWorldMatrix(true, false);
    const at = stump.getWorldPosition(new THREE.Vector3());
    // âncora sem massa que segue o toco a cada quadro
    const anchor = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, position: new CANNON.Vec3(at.x, at.y, at.z) });
    this.physics.world.addBody(anchor);
    // a articulação fica em −center no espaço do corpo; o ligamento sai dela "para cima" do membro
    const joint = g.center.clone().negate();
    const pivot = new CANNON.Vec3(joint.x, joint.y + LIGAMENT, joint.z);
    const constraint = new CANNON.PointToPointConstraint(anchor, new CANNON.Vec3(0, 0, 0), g.body, pivot, 400);
    this.physics.world.addConstraint(constraint);
    // ligamento: tira fina de carne do toco até o membro
    const ligament = new THREE.Mesh(ZOMBIE_UNIT_BOX, goreMaterials().flesh);
    this.scene.add(ligament);
    registerZombieMesh(ligament);
    g.hang = { stump, anchor, constraint, pivot: new CANNON.Vec3(joint.x, joint.y, joint.z), ligament };
    g.body.velocity.scale(0.3, g.body.velocity);
  }

  private updateBodies(dt: number): void {
    for (const g of this.gibs) {
      g.age += dt;
      if (g.hang) this.updateHang(g);
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
      if (r.ragdoll.sinceWake > 8 && r.ragdoll.isActive) r.ragdoll.freeze();
      if (r.ragdoll.age > BODY_LIFETIME) {
        r.ragdoll.dispose();
        r.zombie.dispose();
        this.ragdolls.splice(i, 1);
        this.zombies.splice(this.zombies.indexOf(r.zombie), 1);
      }
    }
  }

  private readonly hangA = new THREE.Vector3();
  private readonly hangB = new THREE.Vector3();
  private readonly hangUp = new THREE.Vector3(0, 1, 0);
  /** Âncora segue o toco; o ligamento é esticado entre o toco e o membro. */
  private updateHang(g: Gib): void {
    const h = g.hang!;
    h.stump.updateWorldMatrix(true, false);
    const a = h.stump.getWorldPosition(this.hangA);
    h.anchor.position.set(a.x, a.y, a.z);
    const p = g.body.pointToWorldFrame(h.pivot, new CANNON.Vec3());
    const b = this.hangB.set(p.x, p.y, p.z);
    const len = Math.max(0.01, a.distanceTo(b));
    h.ligament.position.copy(a).add(b).multiplyScalar(0.5);
    h.ligament.quaternion.setFromUnitVectors(this.hangUp, b.sub(a).normalize());
    h.ligament.scale.set(0.035, len, 0.035);
    h.ligament.updateMatrixWorld();
  }

  private removeGib(g: Gib): void {
    if (g.hang) {
      this.physics.world.removeConstraint(g.hang.constraint);
      this.physics.world.removeBody(g.hang.anchor);
      g.hang.ligament.removeFromParent();
    }
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
    // parte das gotas cai de verdade e mancha o que tocar
    if (this.blood && count >= 2) this.blood.spray(p, Math.ceil(count / 2), speed, dir);
    if (count >= 3) {
      this.particles.emit('dust', p, v.set(0, 0.3, 0), { life: 0.5, size: 0.12, grow: 2, drag: 2, color: 0x6e1210 });
      if (Math.random() < 0.5) this.decals.placeBlood(this.tmp.set(p.x + (Math.random() - 0.5) * 0.6, 0.01, p.z + (Math.random() - 0.5) * 0.6), 0.35 + Math.random() * 0.5);
    }
  }
}
