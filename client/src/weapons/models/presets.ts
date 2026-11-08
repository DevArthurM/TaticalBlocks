import type { ViewSetup } from './types';

/** Posições padrão em primeira pessoa por família de arma. */
export const VIEW_PRESETS = {
  pistol: { hipPos: [0.125, -0.135, -0.36], hipRot: [0.03, 0.04, 0], adsDistance: 0.3, scale: 1.1, flashScale: 0.9, slideTravel: 0.032, shoulderL: [-0.24, -0.38, 0.06], elbowL: [-1, -0.35, 0.1], rigidHands: true },
  revolver: { hipPos: [0.125, -0.139, -0.36], hipRot: [0.03, 0.04, 0], adsDistance: 0.3, scale: 1.1, flashScale: 1.2, shoulderL: [-0.24, -0.38, 0.06], elbowL: [-1, -0.35, 0.1], rigidHands: true },
  smg: { hipPos: [0.1, -0.12, -0.255], hipRot: [0.01, 0.05, 0], adsDistance: 0.22, scale: 0.75, flashScale: 1 },
  rifle: { hipPos: [0.115, -0.125, -0.31], hipRot: [0.01, 0.035, 0], adsDistance: 0.2, scale: 0.75, flashScale: 1.3 },
  shotgun: { hipPos: [0.115, -0.13, -0.31], hipRot: [0.01, 0.035, 0], adsDistance: 0.21, scale: 0.75, flashScale: 1.7 },
  sniper: { hipPos: [0.115, -0.13, -0.3], hipRot: [0.01, 0.03, 0], adsDistance: 0.18, scale: 0.75, flashScale: 1.6 },
  lmg: { hipPos: [0.12, -0.15, -0.31], hipRot: [0.02, 0.04, 0], adsDistance: 0.21, scale: 0.75, flashScale: 1.4 },
  minigun: { hipPos: [0.14, -0.2, -0.36], hipRot: [0.06, 0.07, 0], adsDistance: 0.3, scale: 0.75, flashScale: 1.6 },
  rpg: { hipPos: [0.13, -0.14, -0.22], hipRot: [0.01, 0.02, 0], adsDistance: 0.18, scale: 0.75, flashScale: 2.2 },
  launcher: { hipPos: [0.12, -0.14, -0.31], hipRot: [0.01, 0.04, 0], adsDistance: 0.22, scale: 0.8, flashScale: 1.5 },
  melee: { hipPos: [0.15, -0.2, -0.34], hipRot: [-0.5, 0.2, 0.2], adsDistance: 0.3, scale: 1, flashScale: 0 },
  throwable: { hipPos: [0.13, -0.15, -0.3], hipRot: [0.1, 0.15, 0], adsDistance: 0.3, scale: 1, flashScale: 0 },
} satisfies Record<string, ViewSetup>;

export const view = (preset: keyof typeof VIEW_PRESETS, override: Partial<ViewSetup> = {}): ViewSetup => ({
  ...VIEW_PRESETS[preset],
  ...override,
});
