import { ConnectedSocket, MessageBody, type OnGatewayConnection, type OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { NET } from '../../../shared/net/protocol';
import { RoomsService } from './rooms.service';
import { isNum, playerState, shortString, unitVec, vec } from './validate';

type Body = Record<string, unknown> | undefined;

/**
 * WebSocket do modo online em `/server` (mesma porta da API HTTP).
 * Mensagens: `{ "event": "...", "data": { ... } }`.
 */
@WebSocketGateway({ path: NET.path, maxPayload: 16 * 1024 })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly rooms: RoomsService) {}

  handleConnection(socket: WebSocket): void {
    this.rooms.connect(socket);
  }

  handleDisconnect(socket: WebSocket): void {
    this.rooms.disconnect(socket);
  }

  @SubscribeMessage('hello')
  hello(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    if (s) this.rooms.hello(s, d?.name);
  }

  @SubscribeMessage('rooms')
  list(@ConnectedSocket() socket: WebSocket): void {
    const s = this.rooms.session(socket);
    if (s) this.rooms.listRooms(s);
  }

  @SubscribeMessage('join')
  join(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    if (s) this.rooms.join(s, d?.mode, d?.room);
  }

  @SubscribeMessage('leave')
  leave(@ConnectedSocket() socket: WebSocket): void {
    const s = this.rooms.session(socket);
    if (s) this.rooms.leave(s);
  }

  @SubscribeMessage('ping')
  ping(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    if (s && isNum(d?.t, 1e13)) this.rooms.send(s, 'pong', { t: d.t as number, server: performance.now() / 1000 });
  }

  @SubscribeMessage('state')
  state(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    const st = playerState(d);
    if (s?.room && s.player && st) s.room.onState(s.player, st);
  }

  @SubscribeMessage('shot')
  shot(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    const origin = vec(d?.origin);
    const dir = unitVec(d?.dir);
    if (!s?.room || !s.player || !origin || !dir || !isNum(d?.id) || !shortString(d?.weapon, 24)) return;
    s.room.onShot(s.player, { id: d.id as number, weapon: d.weapon as string, origin, dir });
  }

  @SubscribeMessage('hit')
  hit(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    const point = vec(d?.point);
    if (!s?.room || !s.player || !point || !isNum(d?.shot) || !shortString(d?.weapon, 24) || !shortString(d?.target) || !shortString(d?.zone, 16)) return;
    s.room.onHit(s.player, { shot: d.shot as number, weapon: d.weapon as string, target: d.target as string, zone: d.zone as string, point });
  }

  @SubscribeMessage('impact')
  impact(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    const point = vec(d?.point);
    const dir = unitVec(d?.dir);
    if (!s?.room || !s.player || !point || !dir || !isNum(d?.damage, 1000)) return;
    s.room.onImpact(s.player, { point, dir, damage: d.damage as number });
  }

  @SubscribeMessage('projectile')
  projectile(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    const origin = vec(d?.origin);
    const vel = vec(d?.vel, 200);
    const fuse = d?.fuse === null ? null : isNum(d?.fuse, 30) ? (d.fuse as number) : undefined;
    if (!s?.room || !s.player || !origin || !vel || fuse === undefined || !isNum(d?.id) || !shortString(d?.weapon, 24)) return;
    if (d.kind !== 'launch' && d.kind !== 'throw') return;
    s.room.onProjectile(s.player, { id: d.id as number, weapon: d.weapon as string, kind: d.kind, origin, vel, fuse });
  }

  @SubscribeMessage('explode')
  explode(@ConnectedSocket() socket: WebSocket, @MessageBody() d: Body): void {
    const s = this.rooms.session(socket);
    const pos = vec(d?.pos);
    if (!s?.room || !s.player || !pos || !isNum(d?.id)) return;
    s.room.onExplode(s.player, { id: d.id as number, pos });
  }
}
