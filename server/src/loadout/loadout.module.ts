import { Module } from '@nestjs/common';
import { LoadoutController } from './loadout.controller';
import { LoadoutService } from './loadout.service';

@Module({
  controllers: [LoadoutController],
  providers: [LoadoutService],
})
export class LoadoutModule {}
