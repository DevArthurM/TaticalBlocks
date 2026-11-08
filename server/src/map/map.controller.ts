import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { MapDto } from './dto/map.dto';
import { MapService } from './map.service';

@Controller('map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get()
  getMap(@Query('mode') mode?: string, @Query('seed', new ParseIntPipe({ optional: true })) seed?: number): MapDto {
    const m = mode === 'classic' ? mode : 'voxel';
    return this.mapService.getMap(m, seed);
  }
}
