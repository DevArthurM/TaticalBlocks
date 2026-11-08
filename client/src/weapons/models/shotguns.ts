import { ModelBuilder } from './ModelBuilder';
import { ironSights, pistolGrip, railRibs, redDot, triggerGuard } from './parts';
import { view } from './presets';
import type { WeaponModel } from './types';

/** Cartucho vermelho usado nas recargas cartucho-a-cartucho. */
function shellPart(b: ModelBuilder, pos: [number, number, number]) {
  const shell = b.part('shell', pos);
  b.box('shellRed', [0.018, 0.018, 0.05], [0, 0, 0], shell);
  b.box('brass', [0.02, 0.02, 0.012], [0, 0, 0.03], shell);
  b.anchor('shell', [0, -0.012, 0.01], shell);
  return shell;
}

interface PumpOptions {
  barrel: number;
  body: 'black' | 'gun';
  pumpMat: 'wood' | 'black';
  stock: 'wood' | 'pistol';
}

function pumpShotgun(id: string, o: PumpOptions): WeaponModel {
  const b = new ModelBuilder(id);
  b.box(o.body, [0.042, 0.06, 0.2], [0, 0.03, -0.04]);
  b.box('dark', [0.004, 0.02, 0.06], [0.022, 0.035, -0.05]);
  b.rod('dark', 0.024, o.barrel, [0, 0.045, -0.14 - o.barrel / 2]);
  b.rod('black', 0.02, o.barrel * 0.75, [0, 0.012, -0.14 - o.barrel * 0.375]); // tubo do carregador
  b.box('black', [0.024, 0.04, 0.014], [0, 0.03, -0.14 - o.barrel * 0.75]);
  triggerGuard(b);
  // telha (pump)
  const pump = b.part('pump', [0, 0.012, -0.24]);
  b.box(o.pumpMat, [0.044, 0.038, 0.12], [0, 0, 0], pump);
  if (o.pumpMat === 'black') {
    railRibs(b, -0.022, -0.05, 0.05, 0.03);
  } else {
    for (let i = 0; i < 5; i++) b.box('woodDark', [0.046, 0.04, 0.006], [0, 0, -0.045 + i * 0.022], pump);
  }
  b.anchor('pump', [-0.018, -0.012, 0], pump);
  b.anchor('support', [-0.018, -0.012, 0], pump);

  if (o.stock === 'wood') {
    b.box('wood', [0.036, 0.05, 0.1], [0, -0.0, 0.08], b.root, [0.2, 0, 0]); // pulso
    b.box('wood', [0.042, 0.085, 0.24], [0, -0.025, 0.24], b.root, [0.12, 0, 0]);
    b.box('woodDark', [0.044, 0.1, 0.02], [0, -0.04, 0.36], b.root, [0.12, 0, 0]);
  } else {
    pistolGrip(b, 0.04, 0.095, 'black', -0.35);
    b.box('black', [0.03, 0.04, 0.03], [0, 0.02, 0.07]);
  }
  ironSights(b, 0.064, 0.04, -0.14 - o.barrel + 0.02, 0.058);
  shellPart(b, [0, -0.03, -0.04]);
  b.anchor('muzzle', [0, 0.045, -0.14 - o.barrel - 0.01]);
  b.anchor('eject', [0.026, 0.04, -0.05]);
  b.anchor('grip', o.stock === 'wood' ? [0.006, -0.02, 0.07] : [0.006, -0.042, 0.06]);
  const model = b.build(view('shotgun'));
  model.parts.get('shell')!.visible = false;
  return model;
}

export const buildR870 = () => pumpShotgun('r870', { barrel: 0.46, body: 'gun', pumpMat: 'wood', stock: 'wood' });
export const buildM590 = () => pumpShotgun('m590s', { barrel: 0.3, body: 'black', pumpMat: 'black', stock: 'pistol' });

export function buildAA12(): WeaponModel {
  const b = new ModelBuilder('aa12');
  b.box('black', [0.06, 0.085, 0.42], [0, 0.035, -0.1]);
  b.box('gun', [0.05, 0.02, 0.4], [0, 0.085, -0.1]);
  railRibs(b, 0.097, -0.28, 0.08, 0.034);
  b.rod('dark', 0.03, 0.12, [0, 0.03, -0.37]);
  b.box('black', [0.04, 0.05, 0.04], [0, 0.03, -0.43]);
  triggerGuard(b);
  pistolGrip(b, 0.06);
  b.box('grip', [0.026, 0.07, 0.03], [0, -0.04, -0.24]);
  b.anchor('support', [-0.016, -0.045, -0.24]);
  // tambor
  const mag = b.part('mag', [0, -0.03, -0.1]);
  b.box('black', [0.09, 0.1, 0.1], [0, -0.05, 0], mag);
  b.box('black', [0.1, 0.09, 0.09], [0, -0.05, 0], mag, [0, 0, Math.PI / 4]);
  b.box('dark', [0.11, 0.03, 0.03], [0, -0.05, 0], mag);
  b.anchor('mag', [-0.05, -0.06, 0], mag);
  // coronha
  b.box('black', [0.04, 0.07, 0.18], [0, 0.02, 0.2]);
  b.box('black', [0.044, 0.1, 0.02], [0, 0.01, 0.29]);
  const ch = b.part('charging', [-0.032, 0.06, -0.15]);
  b.box('dark', [0.014, 0.012, 0.016], [-0.004, 0, 0], ch);
  b.anchor('charging', [-0.012, 0, 0], ch);
  // mira elevada numa base: a carcaça alta da AA-12 não tampa mais a visada
  b.box('black', [0.024, 0.026, 0.06], [0, 0.108, -0.06]);
  redDot(b, 0.121, -0.06);
  b.anchor('muzzle', [0, 0.03, -0.45]);
  b.anchor('eject', [0.032, 0.05, -0.06]);
  b.anchor('grip', [0.006, -0.042, 0.08]);
  return b.build(view('shotgun', { hipPos: [0.115, -0.135, -0.31] }));
}
