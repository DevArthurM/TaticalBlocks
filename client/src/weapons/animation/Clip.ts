import type { SoundName } from '../../audio/SoundEngine';
import type { AnchorName, PartName, V3 } from '../models/types';

/**
 * `back`: passa do ponto e volta · `snap`: arranca rápido e freia longo ·
 * `slam`: acelera até bater (encaixes) · `spring`: assenta oscilando · `wind`: recua antes de ir.
 */
export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'back' | 'snap' | 'slam' | 'spring' | 'wind';
/** [px, py, pz, rx, ry, rz] — deslocamento somado à pose/peça. */
export type Vec6 = readonly [number, number, number, number, number, number];

export interface Key<T> {
  t: number;
  v: T;
  /** Easing do trecho que TERMINA nesta chave. */
  e?: Ease;
  /** Só existe quando a recarga começou com a arma vazia. */
  empty?: boolean;
}

/** Alvo de mão: âncora do modelo ou ponto fixo no espaço da câmera. */
export type HandTarget = AnchorName | 'rest' | 'low' | 'lowRight';
export interface HandValue {
  a: HandTarget;
  o?: V3;
}

export interface PartTrack {
  part: PartName;
  keys: Key<Vec6>[];
}

/** `show`: visível só nesses intervalos. `hide`: escondida nesses intervalos. */
export interface VisTrack {
  part: PartName;
  show?: [number, number][];
  hide?: [number, number][];
  empty?: boolean;
}

export type ClipEvent = 'eject' | 'ejectAll' | 'hit' | 'release';

export interface Cue {
  t: number;
  sound?: SoundName;
  event?: ClipEvent;
  empty?: boolean;
  /**
   * Tranco na arma neste instante (pico do deslocamento [px,py,pz,rx,ry,rz]); uma mola
   * o devolve. Sem `kick`, o som da marca escolhe um tranco padrão (`CUE_KICKS`).
   */
  kick?: Vec6;
}

export interface Clip {
  pose?: Key<Vec6>[];
  left?: Key<HandValue>[];
  right?: Key<HandValue>[];
  parts?: PartTrack[];
  vis?: VisTrack[];
  cues?: Cue[];
}

export const Z: Vec6 = [0, 0, 0, 0, 0, 0];

// ───────── helpers de autoria ─────────
export const k = (t: number, v: Vec6 = Z, e?: Ease, empty?: boolean): Key<Vec6> => ({ t, v, e, empty });
export const h = (t: number, a: HandTarget, e?: Ease, empty?: boolean, o?: V3): Key<HandValue> => ({
  t,
  v: { a, o },
  e,
  empty,
});
export const add = (a: Vec6, b: Vec6): Vec6 => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4], a[5] + b[5]];
export const scale6 = (a: Vec6, s: number): Vec6 => [a[0] * s, a[1] * s, a[2] * s, a[3] * s, a[4] * s, a[5] * s];

// ───────── amostragem ─────────
const EASES: Record<Ease, (x: number) => number> = {
  linear: (x) => x,
  in: (x) => x * x,
  out: (x) => 1 - (1 - x) * (1 - x),
  inOut: (x) => x * x * (3 - 2 * x),
  back: (x) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  snap: (x) => 1 - Math.pow(1 - x, 4),
  slam: (x) => x * x * x,
  // mola subamortecida: chega em ~40% do trecho, passa ~12% e assenta
  spring: (x) => 1 - Math.exp(-7 * x) * Math.cos(9.5 * x) * (1 - x),
  wind: (x) => {
    const c1 = 1.70158;
    return (c1 + 1) * x * x * x - c1 * x * x;
  },
};

/** Encontra o segmento de `keys` que contém `t`. Retorna [a, b, u]. */
export function segment<T>(keys: readonly Key<T>[], t: number, empty: boolean): [Key<T>, Key<T>, number] | null {
  let prev: Key<T> | null = null;
  for (const key of keys) {
    if (key.empty && !empty) continue;
    if (key.t >= t) {
      if (!prev) return [key, key, 1];
      const span = key.t - prev.t;
      const raw = span > 0 ? (t - prev.t) / span : 1;
      return [prev, key, EASES[key.e ?? 'inOut'](Math.min(1, Math.max(0, raw)))];
    }
    prev = key;
  }
  return prev ? [prev, prev, 1] : null;
}

/** Soma a amostra da trilha Vec6 em `out`. */
export function addSample6(out: number[], keys: readonly Key<Vec6>[] | undefined, t: number, empty: boolean, weight = 1): void {
  if (!keys) return;
  const seg = segment(keys, t, empty);
  if (!seg) return;
  const [a, b, u] = seg;
  for (let i = 0; i < 6; i++) out[i] += (a.v[i] + (b.v[i] - a.v[i]) * u) * weight;
}

export function isVisible(track: VisTrack, t: number, empty: boolean, base: boolean): boolean {
  if (track.empty && !empty) return base;
  if (track.show) return track.show.some(([a, b]) => t >= a && t <= b);
  if (track.hide) return base && !track.hide.some(([a, b]) => t >= a && t <= b);
  return base;
}
