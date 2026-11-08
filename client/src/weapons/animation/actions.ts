import type { MeleeStyle } from '@shared/weapons/types';
import { type Clip, type Vec6, Z, add, h, k, scale6 } from './Clip';

/** Ciclos de ação (pump/ferrolho), golpes corpo a corpo, arremesso e saque. */

export function pumpCycle(): Clip {
  return {
    pose: [k(0), k(0.35, [0, -0.005, 0.012, -0.03, 0, 0.03], 'out'), k(0.7, [0, 0, -0.006, 0.02, 0, 0]), k(1, Z)],
    parts: [{ part: 'pump', keys: [k(0), k(0.12), k(0.4, [0, 0, 0.085, 0, 0, 0], 'out'), k(0.68, Z, 'in')] }],
    cues: [
      { t: 0.28, sound: 'pumpBack' },
      { t: 0.4, event: 'eject' },
      { t: 0.64, sound: 'pumpForward' },
    ],
  };
}

export function boltCycle(): Clip {
  const tilt: Vec6 = [0, 0.005, 0.01, 0.04, 0, 0.12];
  return {
    pose: [k(0), k(0.15, tilt), k(0.8, tilt), k(1, Z)],
    right: [h(0, 'grip'), h(0.18, 'bolt', 'inOut'), h(0.74, 'bolt'), h(0.92, 'grip', 'inOut')],
    parts: [
      { part: 'boltHandle', keys: [k(0), k(0.2), k(0.3, [0, 0, 0, 0, 0, 1.1], 'out'), k(0.62, [0, 0, 0, 0, 0, 1.1]), k(0.72, Z, 'in')] },
      { part: 'bolt', keys: [k(0), k(0.3), k(0.45, [0, 0, 0.08, 0, 0, 0], 'out'), k(0.6, Z, 'in')] },
    ],
    cues: [
      { t: 0.28, sound: 'boltUp' },
      { t: 0.42, sound: 'boltBack', event: 'eject' },
      { t: 0.58, sound: 'boltForward' },
      { t: 0.7, sound: 'boltDown' },
    ],
  };
}

export const MELEE_CLIPS: Record<MeleeStyle, Clip> = {
  stab: {
    pose: [k(0), k(0.2, [0.01, 0.0, 0.06, 0.18, 0, 0], 'out'), k(0.4, [-0.04, 0.03, -0.24, -0.08, -0.12, 0], 'in'), k(0.58, [-0.04, 0.03, -0.22, -0.08, -0.12, 0]), k(1, Z)],
    cues: [
      { t: 0.15, sound: 'swing' },
      { t: 0.4, event: 'hit' },
    ],
  },
  chop: {
    pose: [k(0), k(0.32, [0.03, 0.1, 0.06, 0.9, 0.05, 0.35], 'out'), k(0.5, [-0.13, -0.12, -0.14, -0.95, -0.2, -0.45], 'in'), k(0.68, [-0.13, -0.12, -0.12, -0.95, -0.2, -0.45]), k(1, Z)],
    cues: [
      { t: 0.35, sound: 'swing' },
      { t: 0.48, event: 'hit' },
    ],
  },
  smash: {
    pose: [k(0), k(0.45, [-0.06, 0.14, 0.1, 1.2, 0, 0.1], 'out'), k(0.6, [-0.07, -0.17, -0.16, -0.85, 0, -0.15], 'in'), k(0.76, [-0.07, -0.17, -0.15, -0.85, 0, -0.15]), k(1, Z)],
    cues: [
      { t: 0.46, sound: 'swingHeavy' },
      { t: 0.58, event: 'hit' },
    ],
  },
};

export function throwClip(kind: 'pin' | 'light'): Clip {
  const windup: Vec6 = [0.03, 0.07, 0.09, 0.7, 0, 0.25];
  return {
    pose: [k(0), k(0.3, [0, 0.01, 0, 0.1, 0, -0.1]), k(0.52, windup, 'out'), k(0.66, [-0.05, 0.02, -0.22, -0.5, 0, -0.1], 'in'), k(1, add(Z, [0, -0.15, 0, -0.6, 0, 0]))],
    left: [h(0, 'rest'), h(0.12, 'pin', 'inOut'), h(0.3, 'pin'), h(0.45, 'rest', 'inOut'), h(1, 'rest')],
    parts: kind === 'pin' ? [{ part: 'pin', keys: [k(0), k(0.3), k(0.42, [-0.1, -0.06, 0.04, 0, 0, 1], 'out')] }] : [],
    vis: kind === 'pin' ? [{ part: 'pin', hide: [[0.44, 1]] }] : [{ part: 'flame', show: [[0.3, 0.64]] }],
    cues: [
      { t: 0.28, sound: kind === 'pin' ? 'pinPull' : 'ignite' },
      { t: 0.62, sound: 'throw', event: 'release' },
    ],
  };
}

export const DRAW_CLIP: Clip = {
  pose: [k(0, [0.02, -0.2, 0.06, -0.9, 0.3, 0.2]), k(1, Z, 'out')],
  cues: [{ t: 0.1, sound: 'draw' }],
};

/**
 * Inspecionar (V): mostra a lateral esquerda, vira para a direita e volta.
 * `s` reduz o giro para armas longas/pesadas (que ocupariam a tela toda).
 */
export function inspectClip(s = 1): Clip {
  const a: Vec6 = scale6([-0.07, 0.05, 0.03, 0.18, 0.95, -0.35], s);
  const b: Vec6 = scale6([-0.075, 0.055, 0.035, 0.22, 1.0, -0.4], s);
  const c: Vec6 = scale6([-0.02, 0.04, 0.02, 0.1, -0.55, 0.45], s);
  const d: Vec6 = scale6([-0.025, 0.045, 0.02, 0.12, -0.6, 0.5], s);
  return {
    pose: [k(0), k(0.16, a, 'out'), k(0.42, b), k(0.58, c, 'inOut'), k(0.82, d), k(1, Z, 'inOut')],
    cues: [
      { t: 0.05, sound: 'draw' },
      { t: 0.52, sound: 'draw' },
    ],
  };
}
