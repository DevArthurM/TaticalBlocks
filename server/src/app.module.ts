import { Module } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { HealthModule } from './health/health.module';
import { LoadoutModule } from './loadout/loadout.module';
import { MapModule } from './map/map.module';
import { WeaponsModule } from './weapons/weapons.module';

@Module({
  imports: [HealthModule, MapModule, WeaponsModule, LoadoutModule, GameModule],
})
export class AppModule {}
