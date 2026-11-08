import type { TeamId, Vec3Tuple } from './protocol';

/**
 * Pontos de nascimento do "Pátio Voxel" (arena 1v1): base azul ao sul (olhando
 * para o norte, yaw 0) e verde ao norte (girada 180°, yaw π). 10 por time.
 */
const BLUE: Vec3Tuple[] = [
  [-1.5, 0, 23],
  [1.5, 0, 23],
  [-4.5, 0, 23],
  [4.5, 0, 23],
  [-1.5, 0, 25.5],
  [1.5, 0, 25.5],
  [-4.5, 0, 25.5],
  [4.5, 0, 25.5],
  [-3, 0, 21.5],
  [3, 0, 21.5],
];

export const TEAM_SPAWNS: Record<TeamId, { points: Vec3Tuple[]; yaw: number }> = {
  blue: { points: BLUE, yaw: 0 },
  green: { points: BLUE.map(([x, y, z]) => [-x, y, -z] as Vec3Tuple), yaw: Math.PI },
};

/** Limites jogáveis do mapa (borda indestrutível em ±30). */
export const ARENA_HALF = 29.6;
