import { NET, FLAG, MODES, type MatchInfo, type PlayerInfo, type ServerEvents, type TeamId, type Vec3Tuple } from '@shared/net/protocol';
import { decodeAttachments, encodeAttachments } from '@shared/weapons/attachments';
import { findWeapon } from '@shared/weapons/catalog';
import * as THREE from 'three';
import { STEP_RANGE } from '../audio/Footsteps';
import type { SoundEngine } from '../audio/SoundEngine';
import type { Decals } from '../effects/Decals';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlayerController } from '../player/PlayerController';
import { setCamoPalette } from '../textures/teamCamo';
import type { OnlineHud } from '../ui/online/OnlineHud';
import type { DetonationSource } from '../weapons/combat/Explosions';
import type { LaunchInfo, Projectiles } from '../weapons/combat/Projectiles';
import type { ShotMeta, WeaponManager } from '../weapons/WeaponManager';
import type { DestructionSystem } from '../world/destruction/DestructionSystem';
import type { NetClient } from './NetClient';
import { RemotePlayer } from './avatar/RemotePlayer';

export interface OnlineDeps {
  net: NetClient;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  physics: PhysicsWorld;
  player: PlayerController;
  weapons: WeaponManager;
  projectiles: Projectiles;
  destruction: DestructionSystem;
  hitTargets: THREE.Object3D[];
  particles: ParticleSystem;
  decals: Decals;
  audio: SoundEngine;
  hud: OnlineHud;
}

/** Osso do ragdoll que recebe o impulso do tiro fatal, por zona. */
const ZONE_BONE: Record<string, string> = {
  head: 'head',
  neck: 'neck',
  torso: 'chest',
  waist: 'pelvis',
  hip: 'pelvis',
  shoulder: 'chest',
  forearm: 'chest',
  hand: 'chest',
  thigh: 'pelvis',
  knee: 'pelvis',
  leg: 'pelvis',
  foot: 'pelvis',
};

const tuple = (v: THREE.Vector3): Vec3Tuple => [round(v.x), round(v.y), round(v.z)];
const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Partida online em andamento: envia o estado do jogador, mostra os outros como
 * soldados interpolados e traduz tiros/explosões em mensagens para o servidor
 * (que decide o dano).
 */
export class OnlineSession {
  myId = '';
  myTeam: TeamId = 'blue';
  /** Morto aguardando renascer (o jogo congela os controles). */
  dead = false;
  /** Levou dano vindo desta posição (indicador de direção na HUD). */
  onHurtFrom: (x: number, z: number) => void = () => {};
  /** Direção do tiro/golpe que matou o jogador local (para a câmera de morte). */
  deathDir: THREE.Vector3 | null = null;
  /** Modo por times (aliados, sem fogo amigo) ou cada um por si. */
  teams = true;
  /** Gun Game: o servidor impõe a arma (o jogo troca o loadout). */
  onForcedWeapon: (weapon: string, level: number, demoted: boolean) => void = () => {};
  private readonly remotes = new Map<string, RemotePlayer>();
  private readonly infos = new Map<string, PlayerInfo>();
  private sendTimer = 0;
  private pingTimer = 0;
  private shotId = 0;
  private clockOffset: number | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tracers: { line: THREE.Line; life: number }[] = [];
  private readonly unsubscribe: (() => void)[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(private readonly d: OnlineDeps) {
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 24; i++) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), tracerMat);
      line.visible = false;
      line.frustumCulled = false;
      d.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    const on = <K extends keyof ServerEvents>(k: K, h: (data: ServerEvents[K]) => void) => this.unsubscribe.push(d.net.on(k, h));
    on('snapshot', (m) => this.onSnapshot(m));
    on('playerJoined', ({ player }) => this.addPlayer(player));
    on('playerLeft', ({ id }) => this.removePlayer(id));
    on('shot', (m) => this.onRemoteShot(m));
    on('impact', (m) => this.onRemoteImpact(m));
    on('projectile', (m) => this.onRemoteProjectile(m));
    on('damage', (m) => this.onDamage(m));
    on('kill', (m) => this.onKill(m));
    on('respawn', (m) => this.onRespawn(m));
    on('match', (m) => this.onMatch(m));
    on('scores', ({ players }) => {
      players.forEach((p) => this.infos.set(p.id, p));
      const me = players.find((p) => p.id === this.myId);
      if (me && !this.d.hud.gungame) this.d.hud.myValue = me.kills;
    });
    on('pong', ({ t }) => (d.hud.ping = Math.round(performance.now() - t)));
    on('gungame', (m) => {
      d.hud.setGunGame(m.level, m.weapon, m.next);
      this.onForcedWeapon(m.weapon, m.level, !!m.demoted);
    });
    d.projectiles.onLaunch = (info) => this.onLocalLaunch(info);
  }

  /** Entrou na sala: time, posição inicial e jogadores presentes. */
  start(j: ServerEvents['joined']): void {
    // sala nova: descarta os jogadores da anterior
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.infos.clear();
    this.dead = false;
    this.myId = j.you.id;
    this.myTeam = j.you.team;
    this.teams = MODES[j.room.mode].teams;
    this.d.hud.teams = this.teams;
    this.d.hud.gungame = j.room.mode === 'gungame';
    this.d.hud.myId = j.you.id;
    setCamoPalette(j.you.team);
    this.d.hud.setTeam(j.you.team);
    this.d.hud.setHealth(100);
    for (const p of j.players) {
      this.infos.set(p.id, p);
      if (p.id !== this.myId) this.addPlayer(p);
    }
    this.teleport(j.spawn.p, j.spawn.yaw);
    this.d.hud.setProtected(NET.spawnProtection);
    this.phase = null;
    this.onMatch(j.match);
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }

  get players(): PlayerInfo[] {
    return [...this.infos.values()];
  }

  // ───────────── laço ─────────────

  update(dt: number, boardOpen: boolean): void {
    const { player, weapons, net } = this.d;
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && !this.dead) {
      this.sendTimer = 1 / NET.sendRate;
      const held = weapons.held;
      let flags = 0;
      if (player.crouchAmount > 0.5) flags |= FLAG.crouch;
      if (player.sprinting) flags |= FLAG.sprint;
      if (weapons.aiming) flags |= FLAG.aim;
      if (player.onGround) flags |= FLAG.ground;
      if (weapons.gun?.reloading) flags |= FLAG.reload;
      if (player.sliding) flags |= FLAG.slide;
      net.send('state', {
        p: tuple(player.position),
        v: tuple(player.velocity),
        yaw: round(player.yaw),
        pitch: round(player.pitch),
        lean: round(player.leanAmount),
        crouch: round(player.crouchAmount),
        flags,
        weapon: held?.def.id ?? null,
        att: encodeAttachments(weapons.currentAttachments),
      });
    }
    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 2;
      net.send('ping', { t: performance.now() });
    }

    const renderT = this.serverNow() - NET.interpDelay;
    for (const r of this.remotes.values()) {
      r.update(dt, renderT);
      if (r.slideStarted) this.d.audio.at(r.pos.x, r.pos.z, 40, (v) => this.d.audio.play('slide', v));
      this.remoteSteps(r, dt);
      if (r.alive && r.flags & FLAG.slide && Math.random() < dt * 30) {
        this.tmp.set(r.pos.x + (Math.random() - 0.5) * 0.3, 0.05, r.pos.z + (Math.random() - 0.5) * 0.3);
        this.d.particles.emit('dust', this.tmp, this.tmp2.set(-r.vel.x * 0.15, 0.5, -r.vel.z * 0.15), { life: 0.7, size: 0.14, grow: 2.2, drag: 2.5, color: 0xb9b6ad });
      }
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.line.visible = false;
    }
    this.updateTags();
    this.d.hud.update(dt);
    this.d.hud.setBoard(boardOpen, this.players, this.myId);
  }

  // ───────────── ganchos do jogo local ─────────────

  /** Disparo local (um por gatilho). */
  onShot(weapon: string, origin: THREE.Vector3, dir: THREE.Vector3, pellets: number): void {
    this.shotId++;
    this.d.net.send('shot', { id: this.shotId, weapon, origin: tuple(origin), dir: tuple(dir), pellets });
  }

  /** Raio do tiro/golpe local contra os outros jogadores (antes do cenário). */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, far: number, _damage: number, meta?: ShotMeta): { distance: number } | null {
    const meshes: THREE.Object3D[] = [];
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      // pré-filtro: distância do raio ao jogador
      this.tmp.copy(r.pos).setY(r.pos.y + 0.95);
      if (this.raycaster.ray.set(origin, dir).distanceSqToPoint(this.tmp) > 1.4 * 1.4) continue;
      meshes.push(...r.meshes);
    }
    if (!meshes.length) return null;
    this.raycaster.set(origin, dir);
    this.raycaster.far = far;
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const remote = hit.object.userData.remote as RemotePlayer;
    const zone = (hit.object.userData.hit as { zone: string }).zone;
    // aliado: o corpo bloqueia o tiro, sem dano (sem fogo amigo); cada um por si: todos são alvo
    if (!this.isAlly(remote)) {
      this.d.net.send('hit', { shot: meta?.melee ? -1 : this.shotId, weapon: meta?.weapon ?? '', target: remote.id, zone, point: tuple(hit.point) });
      this.blood(hit.point, dir, zone === 'head' ? 6 : 3);
      this.d.audio.play(zone === 'head' ? 'gore' : 'flesh', 0.6);
    }
    return { distance: hit.distance };
  }

  /** Impacto local no cenário destrutível: os outros reproduzem. */
  onWorldImpact(point: THREE.Vector3, dir: THREE.Vector3, damage: number): void {
    this.d.net.send('impact', { point: tuple(point), dir: tuple(dir), damage: round(damage) });
  }

  /** Detonação: só as do próprio jogador são reportadas (o servidor calcula o dano). */
  onDetonated(_kind: string, pos: THREE.Vector3, source: DetonationSource): void {
    if (!source.remote && source.id > 0) this.d.net.send('explode', { id: source.id, pos: tuple(pos) });
  }

  // ───────────── mensagens do servidor ─────────────

  private onSnapshot(m: ServerEvents['snapshot']): void {
    const offset = m.t - performance.now() / 1000;
    // relógio do servidor: segue o atraso mínimo (pacotes atrasados não puxam para trás)
    this.clockOffset = this.clockOffset === null ? offset : offset > this.clockOffset ? this.clockOffset + (offset - this.clockOffset) * 0.1 : offset;
    for (const { id, s } of m.players) this.remotes.get(id)?.push(m.t, s);
  }

  private onRemoteShot(m: ServerEvents['shot']): void {
    const r = this.remotes.get(m.by);
    const def = findWeapon(m.weapon);
    if (!r || !def) return;
    r.onShot();
    const suppressed = decodeAttachments(r.attachments).muzzle === 'suppressor';
    const audio = this.d.audio;
    if (def.kind === 'firearm') {
      // tiro posicionado: lado/distância; silenciador alcança bem menos (e sem clarão)
      audio.at(r.pos.x, r.pos.z, suppressed ? 35 : 160, (v) => audio.shot(def.sound, Math.min(1, v * 1.3), suppressed));
      const from = r.muzzleWorld(new THREE.Vector3());
      const dir = new THREE.Vector3().fromArray(m.dir);
      this.tracer(from, dir, def.range);
      if (!suppressed) this.d.particles.burst('fire', 4, from, dir, 2, 0.6, { life: 0.05, size: 0.12, grow: 0.5, color: 0xffd38a });
    } else if (def.kind === 'melee') audio.at(r.pos.x, r.pos.z, 15, (v) => audio.play(def.id === 'sledge' ? 'swingHeavy' : 'swing', v));
  }

  private onRemoteImpact(m: ServerEvents['impact']): void {
    const dir = new THREE.Vector3().fromArray(m.dir).normalize();
    const start = new THREE.Vector3().fromArray(m.point).addScaledVector(dir, -0.3);
    this.raycaster.set(start, dir);
    this.raycaster.far = 0.6;
    const hit = this.raycaster.intersectObjects(this.d.hitTargets, false)[0];
    if (hit) this.d.destruction.hit(hit, dir, m.damage);
  }

  private onRemoteProjectile(m: ServerEvents['projectile']): void {
    const def = findWeapon(m.weapon);
    const origin = new THREE.Vector3().fromArray(m.origin);
    const vel = new THREE.Vector3().fromArray(m.vel);
    if (m.kind === 'launch' && def?.kind === 'firearm' && def.projectile) {
      this.d.projectiles.launchWithVelocity(def.projectile, origin, vel, def.id, true);
      this.remotes.get(m.by)?.onShot();
      this.d.audio.at(origin.x, origin.z, 160, (v) => this.d.audio.shot(def.sound, Math.min(1, v * 1.3)));
    } else if (m.kind === 'throw' && def?.kind === 'throwable') {
      this.d.projectiles.throwItem(def.id, def.effect, m.fuse, origin, vel, true);
      this.remotes.get(m.by)?.onThrow();
    }
  }

  private onLocalLaunch(info: LaunchInfo): void {
    this.d.net.send('projectile', { id: info.id, weapon: info.weapon, kind: info.kind, origin: tuple(info.origin), vel: tuple(info.vel), fuse: info.fuse });
  }

  private onDamage(m: ServerEvents['damage']): void {
    const info = this.infos.get(m.target);
    if (info) info.hp = m.hp;
    if (m.target === this.myId) {
      const { player } = this.d;
      player.health = m.hp;
      player.hurt = Math.min(1, player.hurt + m.amount / 40);
      this.d.audio.play('playerHurt', 0.6);
      this.d.hud.setHealth(m.hp);
      const from = m.by !== this.myId ? this.remotes.get(m.by)?.pos : m.point ? new THREE.Vector3().fromArray(m.point) : null;
      if (from) this.onHurtFrom(from.x, from.z);
    } else {
      const r = this.remotes.get(m.target);
      r?.onDamage();
      // o atirador já espalhou sangue no ponto exato; os demais veem aqui
      if (r && m.by !== this.myId) this.blood(m.point ? new THREE.Vector3().fromArray(m.point) : r.pos.clone().setY(r.pos.y + 1.2), null, 3);
    }
    if (m.by === this.myId && m.target !== this.myId) {
      this.d.hud.hit(m.zone === 'head', m.hp <= 0);
      this.d.audio.play('hitmarker', m.hp <= 0 ? 0.9 : 0.6);
    }
  }

  private onKill(m: ServerEvents['kill']): void {
    const killer = this.infos.get(m.killer);
    const victim = this.infos.get(m.victim);
    if (victim) victim.alive = false;
    this.d.hud.kill(killer, victim, m.weapon, m.zone, m.killer === this.myId || m.victim === this.myId);
    if (m.victim === this.myId) {
      this.deathDir = m.killer !== m.victim ? new THREE.Vector3().fromArray(m.dir) : null;
      this.dead = true;
      this.d.player.health = 0;
      this.d.hud.setHealth(0);
      this.d.hud.showDeath(m.killer !== m.victim ? killer : undefined, m.weapon, m.zone, NET.respawnTime);
    } else {
      this.remotes.get(m.victim)?.die(new THREE.Vector3().fromArray(m.dir), ZONE_BONE[m.zone] ?? 'chest');
    }
  }

  private onRespawn(m: ServerEvents['respawn']): void {
    const info = this.infos.get(m.id);
    if (info) {
      info.alive = true;
      info.hp = 100;
    }
    if (m.id === this.myId) {
      this.teleport(m.p, m.yaw);
      this.dead = false;
      this.d.player.health = 100;
      this.d.player.hurt = 0;
      this.d.hud.setHealth(100);
      this.d.hud.hideDeath();
      this.d.hud.setProtected(NET.spawnProtection);
    } else {
      const r = this.remotes.get(m.id);
      r?.respawn(new THREE.Vector3().fromArray(m.p), m.yaw);
      // renasceu: semitransparente e imortal por alguns segundos (contra spawn kill)
      r?.setProtected(NET.spawnProtection);
    }
  }

  private phase: MatchInfo['phase'] | null = null;

  private onMatch(m: MatchInfo): void {
    // começou uma nova partida (3-2-1): o mapa volta inteiro para todos
    if (m.phase === 'countdown' && this.phase !== 'countdown') this.onRestart();
    this.phase = m.phase;
    this.d.hud.setMatch(m);
  }

  /** Nova partida: restaurar o mapa (o jogo liga isto à destruição). */
  onRestart: () => void = () => {};

  /** Contagem 3-2-1: ninguém se mexe nem atira. */
  get frozen(): boolean {
    return this.phase === 'countdown';
  }

  // ───────────── jogadores ─────────────

  private addPlayer(p: PlayerInfo): void {
    this.infos.set(p.id, p);
    if (p.id === this.myId || this.remotes.has(p.id)) return;
    this.remotes.set(p.id, new RemotePlayer(this.d.scene, this.d.physics, p));
  }

  private removePlayer(id: string): void {
    this.infos.delete(id);
    this.remotes.get(id)?.dispose();
    this.remotes.delete(id);
    this.d.hud.removeTag(id);
  }

  private teleport(p: Vec3Tuple, yaw: number): void {
    const { player } = this.d;
    player.position.fromArray(p);
    player.velocity.set(0, 0, 0);
    player.yaw = yaw;
    player.pitch = 0;
  }

  private isAlly(r: RemotePlayer): boolean {
    return this.teams && r.team === this.myTeam;
  }

  private serverNow(): number {
    return performance.now() / 1000 + (this.clockOffset ?? 0);
  }

  // ───────────── efeitos ─────────────

  private tracer(from: THREE.Vector3, dir: THREE.Vector3, range: number): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    // termina no primeiro obstáculo do cenário
    this.raycaster.set(from, dir);
    this.raycaster.far = range;
    const hit = this.raycaster.intersectObjects(this.d.hitTargets, false)[0];
    const end = this.tmp2.copy(from).addScaledVector(dir, hit ? hit.distance : Math.min(range, 80));
    const pos = t.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    // traçante curto perto do fim (não uma linha inteira)
    const start = from.clone().lerp(end, 0.35);
    pos.setXYZ(0, start.x, start.y, start.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.06;
  }

  private blood(point: THREE.Vector3, dir: THREE.Vector3 | null, count: number): void {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.set((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(1 + Math.random() * 1.5);
      if (dir) v.addScaledVector(dir, 1.2);
      this.d.particles.emit('debris', point, v, { life: 0.8, size: 0.035, grow: 0.7, gravity: -14, drag: 0.4, color: 0x7d0f0c, colorJitter: 0.4 });
    }
    this.d.particles.emit('dust', point, v.set(0, 0.3, 0), { life: 0.4, size: 0.1, grow: 2, drag: 2, color: 0x6e1210 });
  }

  /** Passos dos outros jogadores (agachado quase não faz barulho). */
  private remoteSteps(r: RemotePlayer, dt: number): void {
    if (!r.alive || r.flags & FLAG.slide) return;
    const speed = Math.hypot(r.vel.x, r.vel.z);
    const sound = r.steps.update(dt, speed, (r.flags & FLAG.ground) !== 0, (r.flags & FLAG.sprint) !== 0);
    if (!sound) return;
    const crouched = (r.flags & FLAG.crouch) !== 0;
    const range = crouched ? STEP_RANGE.crouch : sound === 'stepRun' ? STEP_RANGE.run : STEP_RANGE.walk;
    this.d.audio.at(r.pos.x, r.pos.z, range, (v) => this.d.audio.play(sound, v * (crouched ? 0.4 : 1)));
  }

  /** Nomes: aliados sempre; inimigos nunca. */
  private updateTags(): void {
    const cam = this.d.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const r of this.remotes.values()) {
      let screen: { x: number; y: number } | null = null;
      if (r.alive && this.isAlly(r)) {
        const p = r.headWorld(this.tmp).project(cam);
        if (p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1) screen = { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
      }
      this.d.hud.setTag(r.id, r.name, r.team, screen);
    }
  }
}
