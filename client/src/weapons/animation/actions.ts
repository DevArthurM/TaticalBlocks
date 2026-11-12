import type { MeleeStyle } from '@shared/weapons/types';
import { type Clip, type Vec6, Z, add, h, k, scale6 } from './Clip';

/** Ciclos de ação (pump/ferrolho), golpes corpo a corpo, arremesso e saque. */

export function pumpCycle(): Clip {
  return {
    // a arma é puxada para trás junto com a telha e empurrada de volta; os trancos vêm das marcas
    pose: [k(0), k(0.14, [0, 0.002, 0, 0.012, 0, 0]), k(0.38, [0.004, -0.006, 0.014, -0.035, 0.02, 0.06], 'snap'), k(0.66, [0, 0.002, -0.008, 0.02, 0, -0.015], 'inOut'), k(1, Z)],
    parts: [{ part: 'pump', keys: [k(0), k(0.14), k(0.36, [0, 0, 0.085, 0, 0, 0], 'snap'), k(0.46, [0, 0, 0.085, 0, 0, 0]), k(0.66, Z, 'slam')] }],
    cues: [
      { t: 0.3, sound: 'pumpBack' },
      { t: 0.38, event: 'eject' },
      { t: 0.66, sound: 'pumpForward' },
    ],
  };
}

export function boltCycle(): Clip {
  const tilt: Vec6 = [0.004, 0.006, 0.012, 0.05, 0.03, 0.14];
  return {
    pose: [k(0), k(0.16, tilt, 'out'), k(0.46, add(tilt, [0, 0, 0.006, 0.015, 0, 0.03])), k(0.8, tilt), k(0.93, [0, -0.001, 0, -0.006, 0, -0.012]), k(1, Z)],
    right: [h(0, 'grip'), h(0.17, 'bolt', 'out'), h(0.74, 'bolt'), h(0.92, 'grip', 'inOut')],
    parts: [
      { part: 'boltHandle', keys: [k(0), k(0.2), k(0.29, [0, 0, 0, 0, 0, 1.1], 'snap'), k(0.62, [0, 0, 0, 0, 0, 1.1]), k(0.71, Z, 'slam')] },
      { part: 'bolt', keys: [k(0), k(0.3), k(0.43, [0, 0, 0.08, 0, 0, 0], 'slam'), k(0.48, [0, 0, 0.08, 0, 0, 0]), k(0.6, Z, 'slam')] },
    ],
    cues: [
      { t: 0.27, sound: 'boltUp' },
      { t: 0.43, sound: 'boltBack', event: 'eject' },
      { t: 0.6, sound: 'boltForward' },
      { t: 0.71, sound: 'boltDown' },
    ],
  };
}

/**
 * Golpes: antecipação curta, ataque que acelera até o impacto, um instante "preso"
 * no alvo (o tranco da marca `hit` treme a mão) e recuperação que passa do ponto.
 */
export const MELEE_CLIPS: Record<MeleeStyle, Clip> = {
  stab: {
    pose: [
      k(0),
      k(0.18, [0.02, 0.01, 0.08, 0.2, 0.1, 0.12], 'out'),
      k(0.38, [-0.05, 0.035, -0.26, -0.1, -0.16, -0.1], 'slam'),
      k(0.52, [-0.045, 0.03, -0.235, -0.08, -0.14, -0.06], 'out'),
      k(0.86, [0.006, -0.008, 0.012, 0.03, 0.02, 0.02], 'inOut'),
      k(1, Z),
    ],
    cues: [
      { t: 0.15, sound: 'swing' },
      { t: 0.38, event: 'hit', kick: [0, 0.004, 0.02, 0.05, 0, 0.04] },
    ],
  },
  chop: {
    pose: [
      k(0),
      k(0.3, [0.04, 0.11, 0.07, 0.95, 0.08, 0.4], 'out'),
      k(0.48, [-0.14, -0.13, -0.15, -1.0, -0.22, -0.5], 'slam'),
      k(0.64, [-0.13, -0.12, -0.12, -0.9, -0.2, -0.44], 'out'),
      k(0.9, [0.008, 0.01, 0.01, 0.05, 0, 0.03], 'inOut'),
      k(1, Z),
    ],
    cues: [
      { t: 0.33, sound: 'swing' },
      { t: 0.48, event: 'hit', kick: [0.01, 0.015, 0.015, 0.12, 0, 0.05] },
    ],
  },
  smash: {
    pose: [
      k(0),
      k(0.12, [0, -0.02, 0, -0.08, 0, 0], 'out'),
      k(0.44, [-0.06, 0.15, 0.11, 1.25, 0, 0.12], 'out'),
      k(0.58, [-0.07, -0.18, -0.17, -0.9, 0, -0.16], 'slam'),
      k(0.74, [-0.07, -0.165, -0.15, -0.8, 0, -0.14], 'out'),
      k(0.93, [0, 0.012, 0.01, 0.06, 0, 0.02], 'inOut'),
      k(1, Z),
    ],
    cues: [
      { t: 0.46, sound: 'swingHeavy' },
      { t: 0.58, event: 'hit', kick: [0, 0.03, 0.02, 0.2, 0, 0.04] },
    ],
  },
};

export function throwClip(kind: 'pin' | 'light'): Clip {
  const windup: Vec6 = [0.04, 0.08, 0.1, 0.75, 0.08, 0.3];
  return {
    pose: [
      k(0),
      // traz a granada para a frente do peito, para a outra mão puxar o pino / acender
      k(0.14, [-0.03, 0.02, 0.01, 0.12, 0.1, -0.14], 'out'),
      k(0.3, [-0.03, 0.02, 0.01, 0.12, 0.1, -0.14]),
      k(0.36, [-0.022, 0.014, 0.02, 0.1, 0.14, -0.2], 'snap'),
      k(0.54, windup, 'out'),
      k(0.66, [-0.06, 0.03, -0.24, -0.55, -0.1, -0.12], 'slam'),
      k(1, [0, -0.16, -0.05, -0.65, 0, 0], 'out'),
    ],
    left: [h(0, 'rest'), h(0.13, 'pin', 'out'), h(0.3, 'pin'), h(0.36, 'pin', 'snap', false, [-0.07, -0.02, 0.03]), h(0.5, 'rest', 'inOut'), h(1, 'rest')],
    parts: kind === 'pin' ? [{ part: 'pin', keys: [k(0), k(0.3), k(0.4, [-0.1, -0.06, 0.04, 0, 0, 1], 'snap')] }] : [],
    vis: kind === 'pin' ? [{ part: 'pin', hide: [[0.42, 1]] }] : [{ part: 'flame', show: [[0.3, 0.64]] }],
    cues: [
      { t: 0.3, sound: kind === 'pin' ? 'pinPull' : 'ignite', kick: [0.006, 0, 0, 0, 0.04, 0.05] },
      { t: 0.63, sound: 'throw', event: 'release' },
    ],
  };
}

/** Pose de arma abaixada (fora do quadro): começo do saque e fim do guardar. */
export const LOWERED: Vec6 = [0.03, -0.26, 0.08, -1.0, 0.35, 0.3];

/**
 * Saque: a arma sobe girando, passa do ponto e assenta. Nas armas de duas mãos a
 * mão de apoio chega depois e "agarra" o guarda-mão (um tranco leve).
 */
export function drawClip(twoHanded: boolean, heavy = false): Clip {
  const over: Vec6 = heavy ? [-0.002, 0.008, -0.006, 0.04, -0.02, -0.02] : [-0.004, 0.014, -0.012, 0.08, -0.035, -0.04];
  const up = heavy ? 0.6 : 0.5;
  return {
    pose: [k(0, LOWERED), k(up, over, 'snap'), k(0.8, [0.001, -0.003, 0.003, -0.012, 0.006, 0.008], 'inOut'), k(1, Z, 'inOut')],
    left: twoHanded ? [h(0, 'low'), h(up * 0.55, 'low'), h(up + 0.16, 'support', 'out'), h(1, 'support')] : undefined,
    cues: [{ t: 0.08, sound: 'draw' }, ...(twoHanded ? [{ t: up + 0.16, kick: [0, 0.004, 0.005, 0.02, 0, -0.015] as Vec6 }] : [])],
  };
}

/** Guardar: a arma desce rápido para fora do quadro antes da troca. */
export const HOLSTER_CLIP: Clip = {
  pose: [k(0), k(1, scale6(LOWERED, 0.8), 'in')],
};

export interface InspectOptions {
  /** Inclinação do cano para cima (rad), ex.: pistolas. */
  tiltUp?: number;
  /** Checagem do pente: tira o pente (para baixo, ou para cima no P90) e põe de volta. */
  mag?: 'down' | 'up' | null;
}

/** Janela (0..1) da inspeção em que o pente está fora e a munição aparece. */
export const INSPECT_REVEAL = { mag: [0.5, 0.8] as const, noMag: [0.3, 0.9] as const };

/**
 * Inspecionar (V): mostra a lateral esquerda, a mão esquerda tira o pente para
 * conferir a munição e o põe de volta, vira para a direita e volta.
 * `s` reduz o giro para armas longas/pesadas (que ocupariam a tela toda).
 */
export function inspectClip(s = 1, o: InspectOptions = {}): Clip {
  const up: Vec6 = [0, 0.01 * (o.tiltUp ?? 0), 0, o.tiltUp ?? 0, 0, 0];
  const at = (v: Vec6): Vec6 => add(scale6(v, s), up);
  const a = at([-0.07, 0.05, 0.03, 0.18, 0.95, -0.35]);
  const b = at([-0.075, 0.055, 0.035, 0.22, 1.0, -0.4]);
  const c = at([-0.02, 0.04, 0.02, 0.1, -0.55, 0.45]);
  const d = at([-0.025, 0.045, 0.02, 0.12, -0.6, 0.5]);
  if (!o.mag) {
    return {
      pose: [k(0), k(0.04, scale6(a, -0.06), 'out'), k(0.2, a, 'spring'), k(0.42, b), k(0.62, c, 'spring'), k(0.82, d), k(0.96, scale6(d, -0.05), 'inOut'), k(1, Z, 'inOut')],
      cues: [
        { t: 0.05, sound: 'draw' },
        { t: 0.52, sound: 'draw' },
      ],
    };
  }
  // checagem do pente: arma de lado com o pente virado para a câmera
  const m = at([-0.05, 0.06, 0.03, 0.2, 0.55, -0.55]);
  const dir = o.mag === 'up' ? 1 : -1;
  const out: Vec6 = [0, dir * 0.055, 0.004, dir * -0.1, 0, 0];
  return {
    pose: [k(0), k(0.035, scale6(a, -0.06), 'out'), k(0.17, a, 'spring'), k(0.3, b), k(0.42, m, 'inOut'), k(0.62, add(m, [0, 0.004, 0.004, 0.03, 0.03, -0.04])), k(0.8, m), k(0.91, d, 'spring'), k(0.97, scale6(d, -0.05), 'inOut'), k(1, Z, 'inOut')],
    parts: [{ part: 'mag', keys: [k(0), k(0.45), k(0.52, out, 'snap'), k(0.76, out), k(0.81, Z, 'slam')] }],
    left: [h(0, 'support'), h(0.38, 'support'), h(0.45, 'mag', 'out'), h(0.82, 'mag'), h(0.92, 'support', 'inOut'), h(1, 'support')],
    cues: [
      { t: 0.05, sound: 'draw' },
      { t: 0.46, sound: 'magOut' },
      { t: 0.81, sound: 'magIn' },
    ],
  };
}
