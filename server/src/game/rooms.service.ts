import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { type GameMode, MODES, NET, type ServerEvents, sanitizeName } from '../../../shared/net/protocol';
import { Room, type ServerPlayer } from './room';

interface Session {
  id: string;
  name: string | null;
  socket: WebSocket;
  room: Room | null;
  player: ServerPlayer | null;
  /** Limite de mensagens por segundo (balde). */
  budget: number;
  /** Última mensagem recebida (s) — conexões mudas são derrubadas. */
  lastSeen: number;
}

/** Sem nenhuma mensagem por este tempo, a conexão é encerrada (o cliente faz ping a cada 3 s). */
const IDLE_TIMEOUT = 10;
const nowS = (): number => performance.now() / 1000;

const MAX_MESSAGES_PER_SECOND = 120;

/** Conexões, salas e o laço de simulação (20 Hz). */
@Injectable()
export class RoomsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Online');
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly rooms = new Map<string, Room>();
  private roomCounter = 0;
  private timer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), 1000 / NET.tickRate);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  connect(socket: WebSocket): void {
    this.sessions.set(socket, { id: randomBytes(6).toString('hex'), name: null, socket, room: null, player: null, budget: MAX_MESSAGES_PER_SECOND, lastSeen: nowS() });
  }

  disconnect(socket: WebSocket): void {
    const s = this.sessions.get(socket);
    if (!s) return;
    this.leave(s);
    this.sessions.delete(socket);
  }

  /** Sessão da conexão, se ainda houver orçamento de mensagens neste segundo. */
  session(socket: WebSocket): Session | null {
    const s = this.sessions.get(socket);
    if (!s) return null;
    s.lastSeen = nowS();
    if (s.budget <= 0) return null;
    s.budget--;
    return s;
  }

  hello(s: Session, rawName: unknown): void {
    s.name = sanitizeName(rawName);
    this.send(s, 'welcome', { id: s.id, name: s.name });
  }

  listRooms(s: Session): void {
    this.send(s, 'rooms', { rooms: [...this.rooms.values()].map((r) => r.info) });
  }

  join(s: Session, mode: unknown, roomId: unknown): void {
    if (!s.name) return this.send(s, 'error', { message: 'Escolha um nome primeiro.' });
    if (typeof mode !== 'string' || !(mode in MODES)) return this.send(s, 'error', { message: 'Modo inválido.' });
    this.leave(s);
    let room: Room | undefined;
    if (roomId === 'new') room = this.createRoom(mode as GameMode);
    else if (typeof roomId === 'string') {
      room = this.rooms.get(roomId);
      if (!room) return this.send(s, 'error', { message: 'Sala não encontrada.' });
      if (room.full) return this.send(s, 'error', { message: 'Sala cheia.' });
    } else {
      // partida rápida: a sala do modo com mais gente que ainda tem vaga
      room = [...this.rooms.values()].filter((r) => r.mode === mode && !r.full).sort((a, b) => b.players.size - a.players.size)[0] ?? this.createRoom(mode as GameMode);
    }
    s.room = room;
    s.player = room.add(s.id, s.name, s.socket);
    this.log.log(`${s.player.name} entrou em ${room.name} (${room.mode}) no time ${s.player.team}`);
  }

  leave(s: Session): void {
    if (!s.room) return;
    s.room.remove(s.id);
    if (s.room.players.size === 0) this.rooms.delete(s.room.id);
    s.room = null;
    s.player = null;
  }

  private createRoom(mode: GameMode): Room {
    const id = randomBytes(4).toString('hex');
    const room = new Room(id, `Sala ${++this.roomCounter}`, mode);
    this.rooms.set(id, room);
    return room;
  }

  private tick(): void {
    const t = nowS();
    for (const s of [...this.sessions.values()]) {
      s.budget = Math.min(MAX_MESSAGES_PER_SECOND, s.budget + MAX_MESSAGES_PER_SECOND / NET.tickRate);
      // conexão muda (aba fechada atrás de um proxy que não repassou o fechamento)
      if (t - s.lastSeen > IDLE_TIMEOUT) {
        this.disconnect(s.socket);
        s.socket.terminate();
      }
    }
    for (const room of this.rooms.values()) room.tick();
  }

  send<K extends keyof ServerEvents>(s: Session, event: K, data: ServerEvents[K]): void {
    if (s.socket.readyState === 1) s.socket.send(JSON.stringify({ event, data }));
  }
}

export type { Session };
