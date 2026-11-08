/**
 * Dano por parte do corpo no PvP — mesmas zonas do zumbi, porém o jogador é
 * bem mais sensível (vida 100, multiplicadores maiores).
 */
export type PlayerZone =
  | 'head'
  | 'neck'
  | 'torso'
  | 'waist'
  | 'hip'
  | 'shoulder'
  | 'forearm'
  | 'hand'
  | 'thigh'
  | 'knee'
  | 'leg'
  | 'foot';

export const PLAYER_HP = 100;

/** Multiplicador sobre o dano da arma. */
export const PLAYER_ZONE_MULTIPLIER: Record<PlayerZone, number> = {
  head: 4,
  neck: 2.6,
  torso: 1.35,
  waist: 1.2,
  hip: 1.1,
  shoulder: 1,
  forearm: 0.85,
  hand: 0.7,
  thigh: 1,
  knee: 0.9,
  leg: 0.85,
  foot: 0.7,
};

export const PLAYER_ZONE_LABEL: Record<PlayerZone, string> = {
  head: 'cabeça',
  neck: 'pescoço',
  torso: 'tronco',
  waist: 'cintura',
  hip: 'quadril',
  shoulder: 'ombro',
  forearm: 'antebraço',
  hand: 'mão',
  thigh: 'coxa',
  knee: 'joelho',
  leg: 'perna',
  foot: 'pé',
};

export function isPlayerZone(z: unknown): z is PlayerZone {
  return typeof z === 'string' && z in PLAYER_ZONE_MULTIPLIER;
}

/** Explosões: dano máximo no centro e raio (queda linear). */
export const BLAST_DAMAGE: Record<'frag' | 'rocket' | 'grenade40', { damage: number; radius: number }> = {
  frag: { damage: 150, radius: 4.5 },
  rocket: { damage: 180, radius: 5.85 },
  grenade40: { damage: 120, radius: 4.05 },
};

/** Coquetel molotov: área de fogo. */
export const FIRE_ZONE = { radius: 2.4, duration: 6, dps: 22 } as const;
/** Dano em si mesmo e em aliados (fogo amigo desligado). */
export const SELF_DAMAGE = 0.5;
