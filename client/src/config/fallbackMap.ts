import type { MapData } from '../shared/types';

const box = (id: string, x: number, z: number, w: number, h: number, d: number, y = 0) => ({
  id,
  position: { x, y, z },
  size: { x: w, y: h, z: d },
});

/** Usado quando o servidor Nest não está disponível. */
export const FALLBACK_MAP: MapData = {
  name: 'Campo de Testes (offline)',
  seed: 0,
  size: 60,
  wallHeight: 4,
  spawn: { x: 0, y: 0, z: 0 },
  boxes: [
    box('wall-n', 0, -30.5, 62, 4, 1),
    box('wall-s', 0, 30.5, 62, 4, 1),
    box('wall-w', -30.5, 0, 1, 4, 60),
    box('wall-e', 30.5, 0, 1, 4, 60),
    box('b0', 6, -10, 2, 2, 2),
    box('b1', -8, -12, 3, 1, 2),
    box('b2', 12, 4, 2, 3, 2),
    box('b3', -12, 6, 4, 1.5, 4),
    box('b3t', -12, 6, 2, 1, 2, 1.5),
    box('b4', 0, -20, 6, 2.5, 0.6),
    box('b5', 18, -16, 1.5, 1.5, 1.5),
    box('b6', -20, -20, 2, 2, 2),
    box('b7', 20, 20, 3, 2, 3),
    box('b8', -4, 16, 1, 1, 1),
  ],
};
