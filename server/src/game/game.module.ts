import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { RoomsService } from './rooms.service';

/** Modo online: WebSocket em `/server`, salas 1v1/5v5/10v10. */
@Module({
  providers: [GameGateway, RoomsService],
})
export class GameModule {}
