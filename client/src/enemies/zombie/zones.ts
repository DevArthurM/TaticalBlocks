/** Zonas de acerto do zumbi. */
export type Zone =
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

/** Partes que podem ser arrancadas (com tudo que está "abaixo" delas). */
export type Severable = 'head' | 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot';
export type Side = 'L' | 'R' | 'C';

export interface ZoneInfo {
  label: string;
  /** Multiplicador do dano na vida total. */
  multiplier: number;
  /** Qual parte (com vida própria) recebe o dano bruto. */
  part?: Severable;
}

export const ZONES: Record<Zone, ZoneInfo> = {
  head: { label: 'Cabeça', multiplier: 3.5, part: 'head' },
  neck: { label: 'Pescoço', multiplier: 2.2, part: 'head' },
  torso: { label: 'Tronco', multiplier: 1 },
  waist: { label: 'Cintura', multiplier: 0.9 },
  hip: { label: 'Quadril', multiplier: 0.85 },
  shoulder: { label: 'Ombro', multiplier: 0.55, part: 'upperArm' },
  forearm: { label: 'Antebraço', multiplier: 0.45, part: 'forearm' },
  hand: { label: 'Mão', multiplier: 0.35, part: 'hand' },
  thigh: { label: 'Coxa', multiplier: 0.65, part: 'thigh' },
  knee: { label: 'Joelho', multiplier: 0.55, part: 'shin' },
  leg: { label: 'Perna', multiplier: 0.5, part: 'shin' },
  foot: { label: 'Pé', multiplier: 0.35, part: 'foot' },
};

/** Vida de cada parte arrancável (dano bruto da arma). */
export const PART_HP: Record<Severable, number> = {
  head: 40,
  upperArm: 38,
  forearm: 24,
  hand: 12,
  thigh: 48,
  shin: 30,
  foot: 14,
};

export const ZOMBIE_HP = 100;
