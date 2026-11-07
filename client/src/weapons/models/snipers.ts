import { ModelBuilder } from './ModelBuilder';
import { ironSights, pistolGrip, scope, triggerGuard } from './parts';
import { view } from './presets';
import type { WeaponModel } from './types';

/** Ferrolho com manopla lateral; registra `bolt` e a âncora da manopla. */
function boltAction(b: ModelBuilder, z: number, y: number) {
  const bolt = b.part('bolt', [0, y, z]);
  b.rod('silver', 0.018, 0.09, [0, 0, 0], bolt);
  const handle = b.part('boltHandle', [0.01, 0, 0.03], bolt);
  b.box('silver', [0.04, 0.008, 0.008], [0.02, 0, 0], handle);
  b.box('black', [0.016, 0.016, 0.016], [0.04, 0, 0], handle);
  b.anchor('bolt', [0.044, -0.01, 0.006], handle);
}

export function buildHunting(): WeaponModel {
  const b = new ModelBuilder('hunting');
  // coronha inteiriça de madeira
  b.box('wood', [0.044, 0.045, 0.62], [0, 0.0, -0.2]);
  b.box('wood', [0.04, 0.05, 0.12], [0, -0.005, 0.06], b.root, [0.25, 0, 0]);
  b.box('wood', [0.044, 0.09, 0.26], [0, -0.02, 0.24], b.root, [0.1, 0, 0]);
  b.box('woodDark', [0.046, 0.1, 0.02], [0, -0.035, 0.37], b.root, [0.1, 0, 0]);
  b.box('steel', [0.032, 0.035, 0.18], [0, 0.04, -0.06]);
  b.rod('dark', 0.02, 0.55, [0, 0.042, -0.42]);
  b.box('dark', [0.004, 0.01, 0.05], [0.017, 0.055, -0.07]); // janela de carga
  triggerGuard(b, 'steel');
  boltAction(b, 0.0, 0.05);
  ironSights(b, 0.06, -0.12, -0.67, 0.05);
  // cartucho p/ recarga
  const shell = b.part('shell', [0, 0.06, -0.07]);
  b.box('brass', [0.01, 0.01, 0.05], [0, 0, 0], shell);
  b.anchor('shell', [-0.01, 0.0, 0.015], shell);
  b.anchor('support', [-0.02, -0.01, -0.3]);
  b.anchor('muzzle', [0, 0.042, -0.7]);
  b.anchor('eject', [0.02, 0.06, -0.06]);
  b.anchor('grip', [0.006, -0.02, 0.06]);
  const model = b.build(view('sniper'));
  model.parts.get('shell')!.visible = false;
  return model;
}

export function buildAWM(): WeaponModel {
  const b = new ModelBuilder('awm');
  // chassi verde com buraco do polegar
  b.box('olive', [0.05, 0.06, 0.4], [0, 0.01, -0.16]);
  b.box('olive', [0.05, 0.03, 0.2], [0, 0.04, 0.24]);
  b.box('olive', [0.05, 0.1, 0.03], [0, -0.005, 0.33]);
  b.box('olive', [0.05, 0.03, 0.1], [0, -0.04, 0.16], b.root, [-0.3, 0, 0]);
  b.box('oliveDark', [0.052, 0.06, 0.012], [0, 0.0, 0.345]);
  b.box('steel', [0.034, 0.04, 0.2], [0, 0.05, -0.04]);
  b.rod('dark', 0.022, 0.5, [0, 0.05, -0.55]);
  b.box('black', [0.032, 0.03, 0.05], [0, 0.05, -0.81]); // freio de boca
  b.box('dark', [0.034, 0.008, 0.03], [0, 0.05, -0.81]);
  triggerGuard(b, 'oliveDark');
  pistolGrip(b, 0.04, 0.09, 'olive', -0.15);
  // carregador destacável
  const mag = b.part('mag', [0, -0.02, -0.08]);
  b.box('black', [0.03, 0.05, 0.08], [0, -0.025, 0], mag);
  b.anchor('mag', [0, -0.05, 0], mag);
  boltAction(b, 0.02, 0.055);
  scope(b, 0.075, -0.06, 0.32, 'black');
  // bipé recolhido
  b.box('black', [0.01, 0.01, 0.16], [-0.012, -0.03, -0.3]);
  b.box('black', [0.01, 0.01, 0.16], [0.012, -0.03, -0.3]);
  b.anchor('support', [-0.022, -0.01, -0.22]);
  b.anchor('muzzle', [0, 0.05, -0.84]);
  b.anchor('eject', [0.02, 0.07, -0.04]);
  b.anchor('grip', [0.006, -0.04, 0.06]);
  return b.build(view('sniper'));
}
