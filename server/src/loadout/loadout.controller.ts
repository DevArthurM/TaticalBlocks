import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import type { Loadout } from '../../../shared/weapons';
import { LoadoutService } from './loadout.service';

@Controller('loadout')
export class LoadoutController {
  constructor(private readonly loadoutService: LoadoutService) {}

  @Get()
  get() {
    return this.loadoutService.get();
  }

  @Post('validate')
  validate(@Body() body: Partial<Loadout>) {
    return this.loadoutService.validate(body);
  }

  @Put()
  save(@Body() body: Partial<Loadout>) {
    return this.loadoutService.save(body);
  }

  @Delete()
  reset() {
    return this.loadoutService.reset();
  }
}
