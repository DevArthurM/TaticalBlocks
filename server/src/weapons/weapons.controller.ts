import { Controller, Get, Param, Query } from '@nestjs/common';
import { WeaponsService } from './weapons.service';

@Controller('weapons')
export class WeaponsController {
  constructor(private readonly weaponsService: WeaponsService) {}

  @Get()
  findAll(@Query('category') category?: string) {
    return this.weaponsService.findAll(category);
  }

  /** Declarado antes de `:id` para não ser capturado pela rota dinâmica. */
  @Get('categories')
  categories() {
    return this.weaponsService.categories();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.weaponsService.findOne(id);
  }
}
