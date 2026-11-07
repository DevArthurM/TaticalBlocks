import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { MapDto } from './dto/map.dto';
import { MapService } from './map.service';

@Controller('map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get()
  getMap(@Query('seed', new ParseIntPipe({ optional: true })) seed?: number): MapDto {
    return this.mapService.getMap(seed);
  }
}
