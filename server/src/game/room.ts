import type { WebSocket } from 'ws';
import {
  BLAST_DAMAGE,
  FIRE_ZONE,
  isPlayerZone,
  PLAYER_HP,
  PLAYER_ZONE_MULTIPLIER,
  type PlayerZone,
  SELF_DAMAGE,
} from '../../../shared/net/damage';
import {
  GUNGAME_LADDER,
  type GameMode,
  type MatchInfo,
  type MatchPhase,
  MODES,
  NET,
  type PlayerInfo,
  type PlayerState,
  type RoomInfo,
  type ServerEvents,
  type TeamId,
  type Vec3Tuple,
} from '../../../shared/net/protocol';
import { TEAM_SPAWNS } from '../../../shared/net/spawns';
import { findWeapon } from '../../../shared/weapons/catalog';
import { dist } from './validate';

/** Não renasce a menos disto de um inimigo vivo (se houver ponto livre). */
const SPAWN_SAFE_RADIUS = 12;

/** Jogador conectado a uma sala. */

export interface ServerPlayer {
  id: string;
  name: string;
  socket: WebSocket;
  team: TeamId;
  state: PlayerState | null;
  alive: boolean;
  hp: number;
  kills: number;
  deaths: number;
  respawnAt: number;
  protectedUntil: number;
  lastShotAt: number;
  lastMeleeAt: number;
  shots: Map<number, { weapon: string; t: number; pellets: number; hits: number }>;
  /** Gun Game: posição na escada de armas. */
  level: number;
  projectiles: Map<number, { weapon: string; t: number; origin: Vec3Tuple; done: boolean }>;
}

interface FireZone {
  pos: Vec3Tuple;
  owner: string;
  weapon: string;
  until: number;
  /** Dano acumulado por jogador (aplicado em parcelas). */
  pending: Map<string, number>;
}

const now = (): number => performance.now() / 1000;

/** Uma sala 1v1/5v5/10v10 no "Pátio Voxel": partida por abates, com tempo. */
export class Room {
  readonly players = new Map<string, ServerPlayer>();
  private phase: MatchPhase = 'warmup';
  private phaseEnds = 0;
  private winner: TeamId | 'draw' | undefined;
  private readonly score: Record<TeamId, number> = { green: 0, blue: 0 };
  private readonly fires: FireZone[] = [];
  private lastMatchBroadcast = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly mode: GameMode,
  ) {}

  get max(): number {
    return MODES[this.mode].max;
  }

  /** Modo por times (com fogo amigo desligado) ou cada um por si. */
  get teams(): boolean {
    return MODES[this.mode].teams;
  }

  get gungame(): boolean {
    return this.mode === 'gungame';
  }

  get full(): boolean {
    return this.players.size >= this.max;
  }

  get info(): RoomInfo {
    return { id: this.id, name: this.name, mode: this.mode, players: this.players.size, max: this.max, phase: this.phase };
  }

  // ───────────── entrada e saída ─────────────

  add(id: string, name: string, socket: WebSocket): ServerPlayer {
    const count = (t: TeamId) => [...this.players.values()].filter((p) => p.team === t).length;
    const team: TeamId = count('green') < count('blue') ? 'green' : count('blue') < count('green') ? 'blue' : Math.random() < 0.5 ? 'green' : 'blue';
    // nomes repetidos na sala ganham sufixo
    let unique = name;
    for (let i = 2; [...this.players.values()].some((p) => p.name === unique); i++) unique = `${name.slice(0, NET.maxNameLength - 3)}#${i}`;
    const p: ServerPlayer = {
      id,
      name: unique,
      socket,
      team,
      state: null,
      alive: true,
      hp: PLAYER_HP,
      kills: 0,
      deaths: 0,
      respawnAt: 0,
      protectedUntil: now() + NET.spawnProtection,
      lastShotAt: 0,
      lastMeleeAt: 0,
      shots: new Map(),
      projectiles: new Map(),
      level: 0,
    };
    const spawn = this.pickSpawn(p);
    p.state = { p: spawn.p, v: [0, 0, 0], yaw: spawn.yaw, pitch: 0, lean: 0, crouch: 0, flags: 8, weapon: null };
    this.players.set(id, p);
    this.broadcast('playerJoined', { player: this.playerInfo(p) }, id);
    this.send(p, 'joined', {
      room: this.info,
      you: this.playerInfo(p),
      players: [...this.players.values()].map((x) => this.playerInfo(x)),
      match: this.matchInfo(),
      spawn,
    });
    this.sendLevel(p);
    this.checkTeams();
    return p;
  }

  remove(id: string): void {
    if (!this.players.delete(id)) return;
    this.broadcast('playerLeft', { id });
    this.checkTeams();
  }

  // ───────────── mensagens dos jogadores ─────────────

  onState(p: ServerPlayer, s: PlayerState): void {
    if (!p.alive) return;
    p.state = s;
  }

  onShot(p: ServerPlayer, d: { id: number; weapon: string; origin: Vec3Tuple; dir: Vec3Tuple }): void {
    const def = findWeapon(d.weapon);
    const t = now();
    if (p.alive && def?.kind === 'melee' && t - p.lastMeleeAt > 0.25) {
      // golpe: só animação/som nos outros (o dano vem no `hit`)
      this.broadcast('shot', { by: p.id, weapon: def.id, origin: d.origin, dir: d.dir }, p.id);
      return;
    }
    if (!p.alive || def?.kind !== 'firearm' || def.projectile) return;
    // Gun Game: só a arma do nível atual
    if (this.gungame && def.id !== GUNGAME_LADDER[p.level]) return;
    // cadência: aceita até ~40% mais rápido que o rpm (variação de rede)
    if (t - p.lastShotAt < (60 / def.rpm) * 0.6) return;
    p.lastShotAt = t;
    p.shots.set(d.id, { weapon: def.id, t, pellets: def.pellets, hits: 0 });
    for (const [k, s] of p.shots) if (t - s.t > 2) p.shots.delete(k);
    this.broadcast('shot', { by: p.id, weapon: def.id, origin: d.origin, dir: d.dir }, p.id);
  }

  onHit(p: ServerPlayer, d: { shot: number; weapon: string; target: string; zone: string; point: Vec3Tuple }): void {
    const target = this.players.get(d.target);
    if (!p.alive || !target || !target.alive || target === p || !isPlayerZone(d.zone) || !p.state || !target.state) return;
    const def = findWeapon(d.weapon);
    if (!def) return;
    // Gun Game: só a arma do nível atual (ou a faca) causa dano
    if (this.gungame && def.id !== GUNGAME_LADDER[p.level] && def.id !== 'knife') return;
    const range = dist(p.state.p, target.state.p);
    let damage: number;
    if (d.shot === -1) {
      // corpo a corpo
      const t = now();
      if (def.kind !== 'melee' || range > def.range + 1.6 || t - p.lastMeleeAt < 0.25) return;
      p.lastMeleeAt = t;
      damage = def.damage * 1.4;
    } else {
      const shot = p.shots.get(d.shot);
      if (def.kind !== 'firearm' || !shot || shot.weapon !== def.id || shot.hits >= shot.pellets || range > def.range + 3) return;
      shot.hits++;
      damage = def.damage;
    }
    this.damage(target, p, damage * PLAYER_ZONE_MULTIPLIER[d.zone], d.zone, def.id, d.point, this.dirBetween(p, target));
  }

  onImpact(p: ServerPlayer, d: { point: Vec3Tuple; dir: Vec3Tuple; damage: number }): void {
    if (!p.alive) return;
    this.broadcast('impact', { by: p.id, point: d.point, dir: d.dir, damage: Math.min(d.damage, 400) }, p.id);
  }

  onProjectile(p: ServerPlayer, d: { id: number; weapon: string; kind: 'launch' | 'throw'; origin: Vec3Tuple; vel: Vec3Tuple; fuse: number | null }): void {
    const def = findWeapon(d.weapon);
    const ok = def && ((d.kind === 'launch' && def.kind === 'firearm' && def.projectile) || (d.kind === 'throw' && def.kind === 'throwable'));
    if (!p.alive || !ok || p.projectiles.size > 24) return;
    const t = now();
    p.projectiles.set(d.id, { weapon: def.id, t, origin: d.origin, done: false });
    for (const [k, x] of p.projectiles) if (t - x.t > 20) p.projectiles.delete(k);
    this.broadcast('projectile', { by: p.id, weapon: def.id, kind: d.kind, origin: d.origin, vel: d.vel, fuse: d.fuse }, p.id);
  }

  onExplode(p: ServerPlayer, d: { id: number; pos: Vec3Tuple }): void {
    const proj = p.projectiles.get(d.id);
    if (!proj || proj.done || dist(proj.origin, d.pos) > 160) return;
    proj.done = true;
    const def = findWeapon(proj.weapon);
    if (!def) return;
    const kind = def.kind === 'firearm' ? def.projectile : def.kind === 'throwable' ? def.effect : undefined;
    if (kind === 'fire') {
      this.fires.push({ pos: d.pos, owner: p.id, weapon: def.id, until: now() + FIRE_ZONE.duration, pending: new Map() });
      return;
    }
    if (kind !== 'frag' && kind !== 'rocket' && kind !== 'grenade40') return;
    const blast = BLAST_DAMAGE[kind];
    for (const target of this.players.values()) {
      if (!target.alive || !target.state) continue;
      const c: Vec3Tuple = [target.state.p[0], target.state.p[1] + 0.9, target.state.p[2]];
      const r = dist(c, d.pos);
      if (r >= blast.radius) continue;
      const dir: Vec3Tuple = [c[0] - d.pos[0], c[1] - d.pos[1] + 0.5, c[2] - d.pos[2]];
      this.damage(target, p, blast.damage * (1 - r / blast.radius), 'torso', def.id, null, dir);
    }
  }

  // ───────────── simulação ─────────────

  tick(): void {
    const t = now();
    this.updateMatch(t);
    // renascimento
    for (const p of this.players.values()) {
      if (!p.alive && t >= p.respawnAt) this.respawn(p);
    }
    this.updateFires(t);
    const players = [...this.players.values()].filter((p) => p.alive && p.state).map((p) => ({ id: p.id, s: p.state! }));
    this.broadcast('snapshot', { t, players });
  }

  private updateFires(t: number): void {
    const dt = 1 / NET.tickRate;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (t > f.until) {
        this.fires.splice(i, 1);
        continue;
      }
      const owner = this.players.get(f.owner) ?? null;
      for (const p of this.players.values()) {
        if (!p.alive || !p.state) continue;
        const inside = Math.hypot(p.state.p[0] - f.pos[0], p.state.p[2] - f.pos[2]) < FIRE_ZONE.radius && Math.abs(p.state.p[1] - f.pos[1]) < 1.5;
        if (!inside) continue;
        const acc = (f.pending.get(p.id) ?? 0) + FIRE_ZONE.dps * dt;
        // aplica em parcelas de ~5 para não inundar a rede
        if (acc >= 5) {
          f.pending.set(p.id, 0);
          this.damage(p, owner, acc, 'leg', f.weapon, null, [0, 1, 0]);
        } else f.pending.set(p.id, acc);
      }
    }
  }

  private damage(target: ServerPlayer, by: ServerPlayer | null, amount: number, zone: PlayerZone, weapon: string, point: Vec3Tuple | null, dir: Vec3Tuple): void {
    if (!target.alive || now() < target.protectedUntil || this.phase === 'ended' || this.phase === 'countdown') return;
    if (this.teams && by && by !== target && by.team === target.team) return; // sem fogo amigo nos modos por times
    if (by === target) amount *= SELF_DAMAGE;
    amount = Math.round(amount);
    if (amount <= 0) return;
    target.hp = Math.max(0, target.hp - amount);
    this.broadcast('damage', { target: target.id, by: by?.id ?? '', zone, amount, hp: target.hp, point });
    if (target.hp <= 0) this.kill(target, by, weapon, zone, dir);
  }

  private kill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: string, zone: PlayerZone, dir: Vec3Tuple): void {
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = now() + NET.respawnTime;
    victim.shots.clear();
    let won = false;
    if (killer && killer !== victim) {
      killer.kills++;
      if (this.phase === 'playing' && this.teams) this.score[killer.team]++;
      if (this.gungame && this.phase === 'playing') won = this.advanceLadder(killer, victim, weapon);
    }
    this.broadcast('kill', { killer: killer?.id ?? victim.id, victim: victim.id, weapon, zone, dir });
    this.broadcast('scores', { players: [...this.players.values()].map((p) => this.playerInfo(p)) });
    if (this.phase !== 'playing' || !killer) return this.broadcastMatch();
    if (this.teams && this.score[killer.team] >= MODES[this.mode].scoreLimit) this.endMatch(killer.team);
    else if (this.mode === 'ffa' && killer.kills >= MODES.ffa.scoreLimit) this.endMatch('draw', killer);
    else if (won) this.endMatch('draw', killer);
    else this.broadcastMatch();
  }

  /**
   * Gun Game: abate com a arma do nível (ou faca) sobe um nível; com a faca, a
   * vítima desce um. Abate com a faca na última etapa vence. Retorna se venceu.
   */
  private advanceLadder(killer: ServerPlayer, victim: ServerPlayer, weapon: string): boolean {
    const last = GUNGAME_LADDER.length - 1;
    const knife = weapon === 'knife';
    if (knife && victim.level > 0) {
      victim.level--;
      this.sendLevel(victim, true);
    }
    if (weapon !== GUNGAME_LADDER[killer.level] && !knife) return false;
    if (killer.level === last) return knife;
    killer.level++;
    this.sendLevel(killer);
    return false;
  }

  /** Avisa o jogador do nível/arma atual no Gun Game. */
  private sendLevel(p: ServerPlayer, demoted = false): void {
    if (!this.gungame) return;
    const weapon = GUNGAME_LADDER[p.level];
    this.send(p, 'gungame', { level: p.level, weapon, next: GUNGAME_LADDER[p.level + 1] ?? null, demoted });
  }

  private respawn(p: ServerPlayer): void {
    const spawn = this.pickSpawn(p);
    p.alive = true;
    p.hp = PLAYER_HP;
    p.protectedUntil = now() + NET.spawnProtection;
    p.state = { p: spawn.p, v: [0, 0, 0], yaw: spawn.yaw, pitch: 0, lean: 0, crouch: 0, flags: 8, weapon: p.state?.weapon ?? null };
    this.broadcast('respawn', { id: p.id, p: spawn.p, yaw: spawn.yaw });
  }

  /**
   * Ponto de renascimento sorteado: entre os pontos do time (cada um por si: todos),
   * evitando os ocupados e os que estão perto de inimigos vivos.
   */
  private pickSpawn(p: ServerPlayer): { p: Vec3Tuple; yaw: number } {
    const ffa = !this.teams;
    const points = ffa ? [...TEAM_SPAWNS.green.points, ...TEAM_SPAWNS.blue.points] : TEAM_SPAWNS[p.team].points;
    const others = [...this.players.values()].filter((o) => o !== p && o.alive && o.state);
    const free = points.filter((s) => others.every((o) => dist(s, o.state!.p) > 1.2));
    const safe = free.filter((s) => others.every((o) => (!ffa && o.team === p.team) || dist(s, o.state!.p) > SPAWN_SAFE_RADIUS));
    const pool = safe.length ? safe : free.length ? free : points;
    const best = pool[Math.floor(Math.random() * pool.length)];
    // cada um por si: olha para o centro do mapa
    const yaw = ffa ? (best[2] > 0 ? 0 : Math.PI) : TEAM_SPAWNS[p.team].yaw;
    return { p: [...best] as Vec3Tuple, yaw };
  }

  // ───────────── partida ─────────────

  private checkTeams(): void {
    // por times: alguém em cada time; cada um por si: pelo menos 2 jogadores
    const both = this.teams
      ? (['green', 'blue'] as TeamId[]).every((t) => [...this.players.values()].some((p) => p.team === t))
      : this.players.size >= 2;
    if (this.phase === 'warmup' && both) this.startMatch();
    else if ((this.phase === 'playing' || this.phase === 'countdown') && !both) this.setPhase('warmup', 0);
    else this.broadcastMatch();
  }

  private startMatch(): void {
    this.score.green = 0;
    this.score.blue = 0;
    this.winner = undefined;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.level = 0;
      this.sendLevel(p);
      this.respawn(p);
    }
    this.fires.length = 0;
    // 3-2-1: os clientes restauram o mapa e ninguém se mexe; depois começa valendo
    this.setPhase('countdown', NET.countdown);
    this.broadcast('scores', { players: [...this.players.values()].map((p) => this.playerInfo(p)) });
  }

  private winnerPlayer: ServerPlayer | null = null;

  private endMatch(winner: TeamId | 'draw', player: ServerPlayer | null = null): void {
    this.winner = winner;
    this.winnerPlayer = player;
    this.setPhase('ended', NET.endTime);
  }

  private updateMatch(t: number): void {
    if (this.phase === 'playing' && t >= this.phaseEnds) {
      if (!this.teams) {
        // fim do tempo: vence quem lidera
        this.endMatch('draw', this.leaderPlayer());
      } else {
        const { green, blue } = this.score;
        this.endMatch(green === blue ? 'draw' : green > blue ? 'green' : 'blue');
      }
    } else if (this.phase === 'countdown' && t >= this.phaseEnds) {
      this.setPhase('playing', NET.matchTime);
    } else if (this.phase === 'ended' && t >= this.phaseEnds) {
      this.setPhase('warmup', 0);
      this.checkTeams();
    }
    if (t - this.lastMatchBroadcast > 5) this.broadcastMatch();
  }

  private setPhase(phase: MatchPhase, duration: number): void {
    this.phase = phase;
    this.phaseEnds = now() + duration;
    this.broadcastMatch();
  }

  private matchInfo(): MatchInfo {
    return {
      phase: this.phase,
      score: { ...this.score },
      timeLeft: Math.max(0, this.phaseEnds - now()),
      scoreLimit: MODES[this.mode].scoreLimit,
      winner: this.winner,
      ...(this.teams ? {} : this.ffaInfo()),
    };
  }

  /** Líder (abates no 1 contra todos, nível no Gun Game). */
  private leaderPlayer(): ServerPlayer | null {
    const value = (p: ServerPlayer) => (this.gungame ? p.level * 1000 + p.kills : p.kills);
    let best: ServerPlayer | null = null;
    for (const p of this.players.values()) if (!best || value(p) > value(best)) best = p;
    return best;
  }

  private ffaInfo(): Pick<MatchInfo, 'leader' | 'winnerId' | 'winnerName'> {
    const l = this.leaderPlayer();
    return {
      leader: l ? { id: l.id, name: l.name, value: this.gungame ? l.level + 1 : l.kills } : undefined,
      winnerId: this.phase === 'ended' ? this.winnerPlayer?.id : undefined,
      winnerName: this.phase === 'ended' ? this.winnerPlayer?.name : undefined,
    };
  }

  private broadcastMatch(): void {
    this.lastMatchBroadcast = now();
    this.broadcast('match', this.matchInfo());
  }

  // ───────────── utilitários ─────────────

  playerInfo(p: ServerPlayer): PlayerInfo {
    return { id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, alive: p.alive, hp: p.hp, ...(this.gungame ? { level: p.level } : {}) };
  }

  private dirBetween(a: ServerPlayer, b: ServerPlayer): Vec3Tuple {
    const pa = a.state!.p;
    const pb = b.state!.p;
    const d: Vec3Tuple = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  send<K extends keyof ServerEvents>(p: ServerPlayer, event: K, data: ServerEvents[K]): void {
    if (p.socket.readyState === 1) p.socket.send(JSON.stringify({ event, data }));
  }

  broadcast<K extends keyof ServerEvents>(event: K, data: ServerEvents[K], except?: string): void {
    const msg = JSON.stringify({ event, data });
    for (const p of this.players.values()) if (p.id !== except && p.socket.readyState === 1) p.socket.send(msg);
  }
}
