import { ModelBuilder } from './ModelBuilder';
import { view } from './presets';
import type { WeaponModel } from './types';

/** Empunhadura de pistola inclinada, retornando o grupo (útil p/ pente na empunhadura). */
function pistolGrip(b: ModelBuilder, z = 0.03, length = 0.095, mat: 'grip' | 'black' | 'tan' = 'grip') {
  const g = b.group([0, -0.004, z], b.root, [-0.26, 0, 0]);
  b.box(mat, [0.03, length, 0.04], [0, -length / 2, 0], g);
  return g;
}

function triggerGroup(b: ModelBuilder) {
  b.box('black', [0.012, 0.006, 0.05], [0, -0.03, -0.03]);
  b.box('black', [0.012, 0.03, 0.006], [0, -0.016, -0.055]);
  b.box('dark', [0.006, 0.018, 0.006], [0, -0.012, -0.02]);
}

function ironSights(b: ModelBuilder, y: number, rearZ: number, frontZ: number) {
  b.box('dark', [0.006, 0.012, 0.008], [-0.009, y + 0.006, rearZ]);
  b.box('dark', [0.006, 0.012, 0.008], [0.009, y + 0.006, rearZ]);
  b.box('dark', [0.006, 0.014, 0.008], [0, y + 0.007, frontZ]);
  b.box('sight', [0.003, 0.003, 0.002], [0, y + 0.013, frontZ + 0.005]);
  b.anchor('sight', [0, y + 0.012, rearZ]);
}

export function buildMP7(): WeaponModel {
  const b = new ModelBuilder('mp7');
  b.box('black', [0.042, 0.06, 0.24], [0, 0.03, -0.05]);
  b.box('gun', [0.036, 0.014, 0.22], [0, 0.067, -0.05]);
  for (let i = 0; i < 8; i++) b.box('dark', [0.038, 0.004, 0.006], [0, 0.075, -0.15 + i * 0.026]);
  b.rod('dark', 0.018, 0.07, [0, 0.03, -0.2]);
  triggerGroup(b);
  // empunhadura frontal vertical
  b.box('grip', [0.024, 0.075, 0.026], [0, -0.035, -0.13]);
  b.anchor('support', [-0.014, -0.04, -0.13]);
  // pente pela empunhadura
  const g = pistolGrip(b);
  const mag = b.part('mag', [0, 0, 0], g);
  b.box('gun', [0.022, 0.16, 0.03], [0, -0.07, 0.002], mag);
  b.box('dark', [0.03, 0.01, 0.04], [0, -0.152, 0.002], mag);
  b.anchor('mag', [0, -0.16, 0], mag);
  // coronha retrátil
  b.box('black', [0.012, 0.012, 0.13], [-0.012, 0.035, 0.12]);
  b.box('black', [0.012, 0.012, 0.13], [0.012, 0.035, 0.12]);
  b.box('black', [0.04, 0.06, 0.016], [0, 0.03, 0.19]);
  // alavanca de manejo em T
  const ch = b.part('charging', [0, 0.06, 0.08]);
  b.box('dark', [0.05, 0.01, 0.012], [0, 0, 0], ch);
  b.anchor('charging', [-0.02, 0.0, 0.0], ch);
  ironSights(b, 0.074, 0.02, -0.15);
  b.anchor('muzzle', [0, 0.03, -0.24]);
  b.anchor('eject', [0.022, 0.04, -0.03]);
  b.anchor('grip', [0.006, -0.04, 0.045]);
  return b.build(view('smg'));
}

export function buildMP5K(): WeaponModel {
  const b = new ModelBuilder('mp5k');
  b.box('black', [0.044, 0.062, 0.26], [0, 0.03, -0.06]);
  b.box('gun', [0.028, 0.03, 0.18], [0, 0.07, -0.06]); // trilho/alça
  b.box('dark', [0.03, 0.006, 0.14], [0, 0.088, -0.06]);
  b.rod('dark', 0.03, 0.12, [0, 0.045, -0.16]); // tubo da alavanca
  b.rod('dark', 0.018, 0.04, [0, 0.03, -0.21]);
  triggerGroup(b);
  b.box('black', [0.026, 0.06, 0.03], [0, -0.03, -0.16]);
  b.box('black', [0.034, 0.012, 0.04], [0, -0.06, -0.16]);
  b.anchor('support', [-0.015, -0.035, -0.16]);
  pistolGrip(b, 0.035);
  // pente curvo na frente do gatilho
  const mag = b.part('mag', [0, -0.002, -0.075]);
  b.box('gun', [0.022, 0.08, 0.032], [0, -0.04, 0], mag, [0.12, 0, 0]);
  b.box('gun', [0.022, 0.07, 0.032], [0, -0.11, -0.016], mag, [0.3, 0, 0]);
  b.anchor('mag', [0, -0.14, -0.03], mag);
  // braço de coronha
  b.box('black', [0.02, 0.05, 0.12], [0.004, 0.02, 0.13]);
  b.box('black', [0.024, 0.065, 0.016], [0.004, 0.015, 0.19]);
  const ch = b.part('charging', [-0.022, 0.05, -0.12]);
  b.box('dark', [0.016, 0.01, 0.012], [-0.006, 0, 0], ch);
  b.anchor('charging', [-0.015, 0, 0], ch);
  ironSights(b, 0.09, -0.0, -0.13);
  b.anchor('muzzle', [0, 0.03, -0.235]);
  b.anchor('eject', [0.022, 0.04, -0.04]);
  b.anchor('grip', [0.006, -0.04, 0.05]);
  return b.build(view('smg'));
}

export function buildTMP(): WeaponModel {
  const b = new ModelBuilder('tmp');
  b.box('gun', [0.04, 0.058, 0.2], [0, 0.03, -0.05]);
  b.box('black', [0.03, 0.012, 0.16], [0, 0.064, -0.05]);
  b.rod('dark', 0.02, 0.06, [0, 0.03, -0.17]);
  triggerGroup(b);
  pistolGrip(b, 0.025, 0.09, 'black');
  // pente longo à frente, segurado pela mão de apoio
  const mag = b.part('mag', [0, -0.005, -0.1]);
  b.box('gun', [0.022, 0.17, 0.03], [0, -0.08, 0], mag);
  b.box('dark', [0.03, 0.01, 0.038], [0, -0.17, 0], mag);
  b.anchor('mag', [0, -0.17, 0], mag);
  b.box('black', [0.034, 0.05, 0.04], [0, -0.02, -0.1]); // poço do pente
  b.anchor('support', [-0.014, -0.06, -0.1]);
  // coronha esquelética dobrável
  b.box('black', [0.01, 0.01, 0.15], [0, 0.04, 0.12]);
  b.box('black', [0.01, 0.01, 0.15], [0, -0.0, 0.12], b.root, [0.25, 0, 0]);
  b.box('black', [0.012, 0.07, 0.014], [0, 0.015, 0.195]);
  const ch = b.part('charging', [0, 0.064, 0.04]);
  b.box('dark', [0.02, 0.012, 0.012], [0, 0.006, 0], ch);
  b.anchor('charging', [-0.012, 0.006, 0], ch);
  ironSights(b, 0.07, 0.01, -0.12);
  b.anchor('muzzle', [0, 0.03, -0.2]);
  b.anchor('eject', [0.02, 0.04, -0.04]);
  b.anchor('grip', [0.006, -0.04, 0.04]);
  return b.build(view('smg'));
}

export function buildMAC10(): WeaponModel {
  const b = new ModelBuilder('mac10');
  b.box('black', [0.046, 0.07, 0.17], [0, 0.03, -0.035]);
  b.box('gun', [0.04, 0.012, 0.15], [0, 0.07, -0.035]);
  b.rod('dark', 0.018, 0.06, [0, 0.035, -0.15]);
  for (let i = 0; i < 3; i++) b.box('dark', [0.02, 0.022, 0.004], [0, 0.035, -0.165 + i * 0.012]);
  triggerGroup(b);
  const g = b.group([0, -0.004, 0.0], b.root, [-0.05, 0, 0]);
  b.box('grip', [0.03, 0.09, 0.04], [0, -0.045, 0], g);
  const mag = b.part('mag', [0, 0, 0], g);
  b.box('gun', [0.022, 0.18, 0.03], [0, -0.08, 0], mag);
  b.box('dark', [0.03, 0.01, 0.038], [0, -0.17, 0], mag);
  b.anchor('mag', [0, -0.175, 0], mag);
  // coronha de arame recolhida
  b.box('black', [0.008, 0.008, 0.16], [-0.026, 0.05, 0.06]);
  b.box('black', [0.008, 0.008, 0.16], [0.026, 0.05, 0.06]);
  b.box('black', [0.06, 0.03, 0.008], [0, 0.05, 0.14]);
  // segurada pela correia/frente do corpo
  b.box('dark', [0.006, 0.02, 0.05], [-0.025, 0.0, -0.09]);
  b.anchor('support', [-0.03, -0.0, -0.1]);
  const ch = b.part('charging', [0, 0.08, -0.01]);
  b.box('dark', [0.012, 0.014, 0.012], [0, 0, 0], ch);
  b.anchor('charging', [-0.008, 0.01, 0], ch);
  ironSights(b, 0.076, 0.03, -0.1);
  b.anchor('muzzle', [0, 0.035, -0.185]);
  b.anchor('eject', [0.024, 0.04, -0.03]);
  b.anchor('grip', [0.006, -0.042, 0.012]);
  return b.build(view('smg'));
}

export function buildUMP(): WeaponModel {
  const b = new ModelBuilder('ump45');
  b.box('black', [0.046, 0.068, 0.32], [0, 0.03, -0.09]);
  b.box('gun', [0.034, 0.012, 0.28], [0, 0.07, -0.09]);
  b.box('black', [0.048, 0.04, 0.12], [0, -0.005, -0.19]);
  b.rod('dark', 0.02, 0.05, [0, 0.03, -0.27]);
  triggerGroup(b);
  pistolGrip(b, 0.035);
  const mag = b.part('mag', [0, -0.004, -0.08]);
  b.box('gun', [0.024, 0.13, 0.034], [0, -0.065, 0], mag, [0.05, 0, 0]);
  b.box('dark', [0.03, 0.01, 0.042], [0, -0.13, -0.004], mag);
  b.anchor('mag', [0, -0.135, -0.004], mag);
  b.anchor('support', [-0.016, -0.03, -0.2]);
  b.box('black', [0.024, 0.055, 0.2], [0, 0.02, 0.15]);
  b.box('black', [0.028, 0.08, 0.02], [0, 0.01, 0.25]);
  const ch = b.part('charging', [-0.026, 0.045, -0.17]);
  b.box('dark', [0.014, 0.01, 0.012], [-0.004, 0, 0], ch);
  b.anchor('charging', [-0.012, 0, 0], ch);
  ironSights(b, 0.076, 0.0, -0.21);
  b.anchor('muzzle', [0, 0.03, -0.295]);
  b.anchor('eject', [0.024, 0.04, -0.05]);
  b.anchor('grip', [0.006, -0.04, 0.05]);
  return b.build(view('smg'));
}

export function buildP90(): WeaponModel {
  const b = new ModelBuilder('p90');
  // corpo bullpup verde com buraco do polegar
  b.box('olive', [0.056, 0.07, 0.42], [0, 0.03, 0.02]);
  b.box('olive', [0.056, 0.05, 0.12], [0, -0.04, 0.17]); // coronha baixa
  b.box('oliveDark', [0.05, 0.03, 0.08], [0, -0.035, -0.12]); // guarda frontal
  b.box('oliveDark', [0.058, 0.012, 0.03], [0, -0.06, -0.16]);
  b.rod('dark', 0.018, 0.06, [0, 0.03, -0.21]);
  b.box('dark', [0.006, 0.018, 0.006], [0, -0.01, -0.02]);
  b.box('grip', [0.032, 0.07, 0.04], [0, -0.035, 0.03], b.root, [-0.2, 0, 0]);
  // carregador superior translúcido
  const mag = b.part('mag', [0, 0.072, 0.03]);
  b.box('gun', [0.05, 0.022, 0.3], [0, 0, 0], mag);
  b.box('brass', [0.03, 0.01, 0.26], [0, 0.012, 0], mag);
  b.anchor('mag', [-0.025, 0.0, -0.05], mag);
  // mira reflex sobre trilho
  b.box('black', [0.03, 0.03, 0.06], [0, 0.11, -0.06]);
  b.box('lens', [0.024, 0.022, 0.002], [0, 0.112, -0.03]);
  b.box('redDot', [0.003, 0.003, 0.001], [0, 0.112, -0.09]);
  b.anchor('sight', [0, 0.112, -0.02]);
  const ch = b.part('charging', [-0.03, 0.03, -0.1]);
  b.box('dark', [0.01, 0.012, 0.016], [0, 0, 0], ch);
  b.anchor('charging', [-0.006, 0, 0], ch);
  b.anchor('support', [-0.02, -0.04, -0.13]);
  b.anchor('muzzle', [0, 0.03, -0.24]);
  b.anchor('eject', [0, -0.05, 0.1]);
  b.anchor('grip', [0.006, -0.03, 0.04]);
  return b.build(view('smg', { hipPos: [0.11, -0.11, -0.31] }));
}
