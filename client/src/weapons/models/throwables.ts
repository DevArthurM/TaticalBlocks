import { ModelBuilder } from './ModelBuilder';
import { view } from './presets';
import type { WeaponModel } from './types';

function pinRing(b: ModelBuilder, pos: [number, number, number]) {
  const pin = b.part('pin', pos);
  b.box('silver', [0.004, 0.03, 0.004], [-0.014, 0, 0], pin);
  b.box('silver', [0.004, 0.03, 0.004], [0.014, 0, 0], pin);
  b.box('silver', [0.03, 0.004, 0.004], [0, 0.014, 0], pin);
  b.box('silver', [0.03, 0.004, 0.004], [0, -0.014, 0], pin);
  b.anchor('pin', [-0.01, -0.02, 0.0], pin);
}

export function buildFrag(): WeaponModel {
  const b = new ModelBuilder('frag');
  b.box('grenade', [0.058, 0.07, 0.058], [0, 0.02, 0]);
  b.box('grenade', [0.062, 0.06, 0.062], [0, 0.02, 0], b.root, [0, Math.PI / 4, 0]);
  for (let i = 0; i < 3; i++) b.box('grenadeDark', [0.066, 0.004, 0.066], [0, -0.003 + i * 0.022, 0]);
  b.box('steel', [0.024, 0.02, 0.024], [0, 0.064, 0]);
  b.box('steel', [0.012, 0.07, 0.008], [0.004, 0.035, 0.035], b.root, [-0.1, 0, 0]); // colher
  pinRing(b, [-0.026, 0.07, 0]);
  b.anchor('grip', [0, 0.0, 0.01]);
  b.anchor('muzzle', [0, 0.02, 0]);
  return b.build(view('throwable'));
}

export function buildFlash(): WeaponModel {
  const b = new ModelBuilder('flash');
  b.rod('grenade', 0.05, 0.1, [0, 0.02, 0], b.root, 'y');
  b.rod('yellow', 0.052, 0.014, [0, 0.045, 0], b.root, 'y');
  for (let i = 0; i < 4; i++) b.box('dark', [0.008, 0.06, 0.054], [0, 0.0, 0], b.root, [0, (i * Math.PI) / 4, 0]);
  b.box('steel', [0.024, 0.02, 0.024], [0, 0.08, 0]);
  b.box('steel', [0.012, 0.08, 0.008], [0.004, 0.035, 0.03], b.root, [-0.08, 0, 0]);
  pinRing(b, [-0.026, 0.085, 0]);
  b.anchor('grip', [0, 0.0, 0.01]);
  b.anchor('muzzle', [0, 0.02, 0]);
  return b.build(view('throwable'));
}

export function buildMolotov(): WeaponModel {
  const b = new ModelBuilder('molotov');
  b.box('bottle', [0.052, 0.1, 0.052], [0, 0.0, 0]);
  b.box('bottle', [0.036, 0.03, 0.036], [0, 0.064, 0]);
  b.box('bottle', [0.02, 0.05, 0.02], [0, 0.1, 0]);
  b.box('cloth', [0.03, 0.05, 0.03], [0.004, 0.14, 0], b.root, [0, 0, 0.3]);
  b.box('cloth', [0.02, 0.04, 0.02], [0.016, 0.15, 0.004], b.root, [0, 0, -0.4]);
  const flame = b.part('flame', [0.006, 0.18, 0]);
  b.box('flame', [0.03, 0.05, 0.03], [0, 0, 0], flame, [0, 0.6, 0]);
  b.box('yellow', [0.018, 0.035, 0.018], [0, 0.01, 0], flame, [0, 0.2, 0]);
  b.anchor('pin', [0.0, 0.14, 0.0]);
  b.anchor('grip', [0, -0.01, 0.01]);
  b.anchor('muzzle', [0, 0.17, 0]);
  const model = b.build(view('throwable'));
  model.parts.get('flame')!.visible = false;
  return model;
}
