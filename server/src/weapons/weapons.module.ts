import { Module } from '@nestjs/common';
import { WeaponsController } from './weapons.controller';
import { WeaponsService } from './weapons.service';

@Module({
  controllers: [WeaponsController],
  providers: [WeaponsService],
  exports: [WeaponsService],
})
export class WeaponsModule {}
