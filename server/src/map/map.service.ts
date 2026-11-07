import { Injectable } from '@nestjs/common';
import { BoxDto, MapDto } from './dto/map.dto';
import { createRandom, pick } from './random';

const MAP_SIZE = 80;
const WALL_HEIGHT = 4;
const WALL_THICKNESS = 1;
const SPAWN_CLEAR_RADIUS = 7;
const TARGET_BOX_COUNT = 34;

@Injectable()
export class MapService {
  private readonly cache = new Map<number, MapDto>();

  getMap(seed = 1337): MapDto {
    const cached = this.cache.get(seed);
    if (cached) return cached;
    const map = this.generate(seed);
    this.cache.set(seed, map);
    return map;
  }

  private generate(seed: number): MapDto {
    const rnd = createRandom(seed);
    const boxes: BoxDto[] = [...this.perimeterWalls(), ...this.coverWalls()];
    const footprints = boxes.map((b) => ({ ...b }));
    const half = MAP_SIZE / 2 - 4;

    let id = 0;
    for (let attempt = 0; attempt < 600 && id < TARGET_BOX_COUNT; attempt++) {
      const w = pick(rnd, [1, 1.5, 2, 2, 3, 4]);
      const d = pick(rnd, [1, 1.5, 2, 2, 3, 4]);
      const h = pick(rnd, [1, 1, 1.5, 2, 2.5, 3]);
      const x = Math.round((rnd() * 2 - 1) * half * 2) / 2;
      const z = Math.round((rnd() * 2 - 1) * half * 2) / 2;

      if (Math.hypot(x, z) < SPAWN_CLEAR_RADIUS + Math.max(w, d) / 2) continue;
      const candidate: BoxDto = { id: `box-${id}`, position: { x, y: 0, z }, size: { x: w, y: h, z: d } };
      if (footprints.some((o) => this.overlaps(candidate, o, 1.4))) continue;

      boxes.push(candidate);
      footprints.push(candidate);
      id++;

      // Às vezes empilha uma caixa menor em cima para variar a silhueta.
      if (h <= 2 && rnd() < 0.3) {
        const s = Math.max(1, Math.min(w, d) - 0.5);
        boxes.push({
          id: `box-${id - 1}-top`,
          position: { x: x + (rnd() - 0.5) * (w - s) * 0.5, y: h, z: z + (rnd() - 0.5) * (d - s) * 0.5 },
          size: { x: s, y: pick(rnd, [1, 1.5]), z: s },
        });
      }
    }

    return {
      name: 'Campo de Testes',
      seed,
      size: MAP_SIZE,
      wallHeight: WALL_HEIGHT,
      spawn: { x: 0, y: 0, z: 0 },
      boxes,
    };
  }

  private perimeterWalls(): BoxDto[] {
    const half = MAP_SIZE / 2;
    const t = WALL_THICKNESS;
    const len = MAP_SIZE + t * 2;
    return [
      { id: 'wall-n', position: { x: 0, y: 0, z: -half - t / 2 }, size: { x: len, y: WALL_HEIGHT, z: t } },
      { id: 'wall-s', position: { x: 0, y: 0, z: half + t / 2 }, size: { x: len, y: WALL_HEIGHT, z: t } },
      { id: 'wall-w', position: { x: -half - t / 2, y: 0, z: 0 }, size: { x: t, y: WALL_HEIGHT, z: MAP_SIZE } },
      { id: 'wall-e', position: { x: half + t / 2, y: 0, z: 0 }, size: { x: t, y: WALL_HEIGHT, z: MAP_SIZE } },
    ];
  }

  /** Algumas paredes baixas e longas para dar cobertura e profundidade. */
  private coverWalls(): BoxDto[] {
    return [
      { id: 'cover-0', position: { x: -14, y: 0, z: -12 }, size: { x: 9, y: 2.5, z: 0.6 } },
      { id: 'cover-1', position: { x: 15, y: 0, z: 13 }, size: { x: 0.6, y: 2.5, z: 9 } },
      { id: 'cover-2', position: { x: 16, y: 0, z: -18 }, size: { x: 0.6, y: 3, z: 7 } },
      { id: 'cover-3', position: { x: -17, y: 0, z: 17 }, size: { x: 7, y: 3, z: 0.6 } },
    ];
  }

  private overlaps(a: BoxDto, b: BoxDto, margin: number): boolean {
    return (
      Math.abs(a.position.x - b.position.x) * 2 < a.size.x + b.size.x + margin * 2 &&
      Math.abs(a.position.z - b.position.z) * 2 < a.size.z + b.size.z + margin * 2
    );
  }
}
