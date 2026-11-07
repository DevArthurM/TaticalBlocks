import { ModelBuilder } from './ModelBuilder';
import { curvedMag, ironSights, pistolGrip, railRibs, redDot, scope, triggerGuard } from './parts';
import { view } from './presets';
import type { WeaponModel } from './types';

interface ArOptions {
  barrel: number;
  handguard: number;
  railed: boolean;
  carryHandle: boolean;
  stock: 'collapsible' | 'fixed';
  optic: 'iron' | 'reddot' | 'scope';
  verticalGrip?: boolean;
  magLength?: number;
}

/** Plataforma AR (M4A1, M16A4, HK416, SR-25). */
function ar(id: string, o: ArOptions, preset: 'rifle' | 'sniper' = 'rifle'): WeaponModel {
  const b = new ModelBuilder(id);
  // inferior / superior
  b.box('black', [0.04, 0.045, 0.2], [0, 0.0, -0.02]);
  b.box('gun', [0.042, 0.05, 0.22], [0, 0.047, -0.03]);
  b.box('dark', [0.004, 0.016, 0.05], [0.022, 0.05, -0.03]); // janela de ejeção
  b.box('dark', [0.03, 0.008, 0.2], [0, 0.076, -0.03]); // trilho superior
  const hgZ = -0.14 - o.handguard / 2;
  b.box(o.railed ? 'black' : 'gun', [0.05, 0.05, o.handguard], [0, 0.045, hgZ]);
  if (o.railed) railRibs(b, 0.073, hgZ - o.handguard / 2 + 0.01, hgZ + o.handguard / 2);
  else for (let i = 0; i < 6; i++) b.box('dark', [0.052, 0.004, 0.012], [0, 0.04, hgZ - o.handguard / 2 + 0.03 + i * (o.handguard / 6)]);
  const muzzleZ = -0.14 - o.handguard - o.barrel;
  b.rod('dark', 0.016, o.barrel, [0, 0.045, -0.14 - o.handguard - o.barrel / 2]);
  b.rod('black', 0.024, 0.04, [0, 0.045, muzzleZ + 0.02]);
  triggerGuard(b);
  pistolGrip(b, 0.035);
  curvedMag(b, [0, -0.0, -0.075], 'gun', o.magLength ?? 0.16, 0.22);
  b.box('black', [0.036, 0.03, 0.04], [0, -0.01, -0.075]); // poço do pente

  // coronha
  if (o.stock === 'collapsible') {
    b.rod('black', 0.026, 0.14, [0, 0.03, 0.15]);
    b.box('black', [0.036, 0.07, 0.12], [0, 0.015, 0.22]);
  } else {
    b.box('black', [0.038, 0.06, 0.24], [0, 0.02, 0.2]);
    b.box('black', [0.038, 0.09, 0.02], [0, 0.005, 0.32]);
  }

  // alavanca de manejo traseira
  const ch = b.part('charging', [0, 0.072, 0.085]);
  b.box('dark', [0.04, 0.01, 0.014], [0, 0, 0], ch);
  b.anchor('charging', [-0.022, 0, 0], ch);

  const sightY = 0.08;
  if (o.carryHandle) {
    b.box('gun', [0.016, 0.04, 0.012], [0, 0.1, -0.08]);
    b.box('gun', [0.016, 0.04, 0.012], [0, 0.1, 0.03]);
    b.box('gun', [0.022, 0.014, 0.13], [0, 0.125, -0.025]);
    ironSights(b, 0.13, 0.03, -0.14 - o.handguard + 0.01, 0.12);
    b.box('dark', [0.01, 0.06, 0.01], [0, 0.09, -0.14 - o.handguard + 0.01]);
  } else if (o.optic === 'reddot') {
    redDot(b, sightY, -0.03);
    b.box('dark', [0.01, 0.05, 0.01], [0, 0.09, -0.14 - o.handguard + 0.01]);
  } else if (o.optic === 'scope') {
    scope(b, sightY, -0.04, 0.26);
  } else {
    ironSights(b, sightY, 0.06, -0.14 - o.handguard + 0.01, sightY + 0.02);
  }

  if (o.verticalGrip) {
    b.box('grip', [0.024, 0.07, 0.026], [0, -0.012, -0.21]);
    b.anchor('support', [-0.016, -0.02, -0.21]);
  } else {
    b.anchor('support', [-0.018, 0.012, -0.2]);
  }
  b.anchor('muzzle', [0, 0.045, muzzleZ - 0.01]);
  b.anchor('eject', [0.026, 0.05, -0.03]);
  b.anchor('grip', [0.006, -0.042, 0.055]);
  return b.build(view(preset));
}

export const buildM4A1 = () =>
  ar('m4a1', { barrel: 0.16, handguard: 0.17, railed: false, carryHandle: true, stock: 'collapsible', optic: 'iron' });
export const buildM16A4 = () =>
  ar('m16a4', { barrel: 0.24, handguard: 0.24, railed: false, carryHandle: false, stock: 'fixed', optic: 'iron' });
export const buildHK416 = () =>
  ar('hk416', { barrel: 0.12, handguard: 0.2, railed: true, carryHandle: false, stock: 'collapsible', optic: 'reddot' });
export const buildSR25 = () =>
  ar('sr25', { barrel: 0.3, handguard: 0.26, railed: true, carryHandle: false, stock: 'fixed', optic: 'scope', magLength: 0.11 }, 'sniper');

export function buildAK47(): WeaponModel {
  const b = new ModelBuilder('ak47');
  b.box('gun', [0.04, 0.06, 0.3], [0, 0.03, -0.07]);
  b.box('steel', [0.038, 0.02, 0.24], [0, 0.07, -0.05]); // tampa
  b.box('dark', [0.004, 0.018, 0.08], [0.021, 0.045, -0.06]);
  // guarda-mão de madeira
  b.box('wood', [0.048, 0.045, 0.16], [0, 0.03, -0.3]);
  b.box('wood', [0.036, 0.03, 0.12], [0, 0.072, -0.28]);
  b.rod('dark', 0.016, 0.24, [0, 0.045, -0.5]);
  b.rod('steel', 0.012, 0.18, [0, 0.07, -0.43]); // tubo de gás
  b.box('dark', [0.008, 0.03, 0.01], [0, 0.07, -0.6]);
  b.box('sight', [0.003, 0.003, 0.002], [0, 0.088, -0.596]);
  b.rod('black', 0.022, 0.03, [0, 0.045, -0.63]);
  ironSights(b, 0.08, -0.2, -0.6, 0.075);
  triggerGuard(b, 'steel');
  pistolGrip(b, 0.04, 0.09, 'woodDark');
  curvedMag(b, [0, 0.0, -0.08], 'gun', 0.18, 0.42);
  // coronha de madeira inclinada
  b.box('wood', [0.04, 0.06, 0.28], [0, 0.0, 0.2], b.root, [0.12, 0, 0]);
  b.box('woodDark', [0.042, 0.09, 0.02], [0, -0.03, 0.33], b.root, [0.12, 0, 0]);
  // alavanca do lado direito
  const ch = b.part('charging', [0.026, 0.05, -0.02]);
  b.box('steel', [0.016, 0.012, 0.014], [0.006, 0, 0], ch);
  b.anchor('charging', [0.016, 0.005, 0], ch);
  b.anchor('support', [-0.02, 0.0, -0.3]);
  b.anchor('muzzle', [0, 0.045, -0.65]);
  b.anchor('eject', [0.026, 0.06, -0.04]);
  b.anchor('grip', [0.006, -0.04, 0.06]);
  return b.build(view('rifle'));
}
