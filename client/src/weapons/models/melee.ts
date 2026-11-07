import { ModelBuilder } from './ModelBuilder';
import { view } from './presets';
import type { WeaponModel } from './types';

/** Armas brancas: cabo ao longo de +Y, mão direita na origem. */

export function buildKnife(): WeaponModel {
  const b = new ModelBuilder('knife');
  b.box('black', [0.028, 0.11, 0.032], [0, -0.01, 0]);
  for (let i = 0; i < 4; i++) b.box('dark', [0.03, 0.004, 0.034], [0, -0.05 + i * 0.025, 0]);
  b.box('dark', [0.03, 0.02, 0.034], [0, -0.068, 0]);
  b.box('steel', [0.034, 0.012, 0.06], [0, 0.05, 0]); // guarda
  b.box('blade', [0.008, 0.16, 0.034], [0, 0.135, 0.002]);
  b.box('steel', [0.009, 0.15, 0.008], [0, 0.13, 0.017]); // dorso
  b.box('blade', [0.008, 0.05, 0.024], [0, 0.225, -0.006], b.root, [0.45, 0, 0]);
  b.anchor('muzzle', [0, 0.24, 0]);
  b.anchor('grip', [0, -0.01, 0]);
  return b.build(view('melee', { hipPos: [0.14, -0.16, -0.3], hipRot: [-1.15, 0.2, 0.15] }));
}

export function buildHatchet(): WeaponModel {
  const b = new ModelBuilder('hatchet');
  b.box('wood', [0.026, 0.4, 0.032], [0, 0.11, 0]);
  b.box('woodDark', [0.03, 0.03, 0.036], [0, -0.09, 0]);
  b.box('steel', [0.022, 0.06, 0.1], [0, 0.29, -0.035]);
  b.box('blade', [0.012, 0.09, 0.03], [0, 0.29, -0.095]);
  b.box('steel', [0.028, 0.04, 0.036], [0, 0.29, 0.03]);
  b.anchor('muzzle', [0, 0.29, -0.11]);
  b.anchor('grip', [0, -0.04, 0]);
  return b.build(view('melee', { hipPos: [0.15, -0.2, -0.33], hipRot: [-0.35, 0.25, 0.25] }));
}

export function buildSledge(): WeaponModel {
  const b = new ModelBuilder('sledge');
  b.box('wood', [0.03, 0.64, 0.034], [0, 0.2, 0]);
  b.box('black', [0.08, 0.08, 0.17], [0, 0.5, 0]);
  b.box('dark', [0.086, 0.086, 0.02], [0, 0.5, -0.085]);
  b.box('dark', [0.086, 0.086, 0.02], [0, 0.5, 0.085]);
  b.anchor('support', [0, 0.2, 0]);
  b.anchor('muzzle', [0, 0.5, -0.09]);
  b.anchor('grip', [0, -0.08, 0]);
  return b.build(view('melee', { hipPos: [0.18, -0.22, -0.36], hipRot: [-0.25, 0.3, 0.45] }));
}
