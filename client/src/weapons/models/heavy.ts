import { ModelBuilder } from './ModelBuilder';
import { ironSights, pistolGrip, triggerGuard } from './parts';
import { view } from './presets';
import type { WeaponModel } from './types';

export function buildM249(): WeaponModel {
  const b = new ModelBuilder('m249');
  /** Linha de visada (altura do olho na âncora `sight`). */
  const L = 0.112;
  b.box('black', [0.06, 0.08, 0.3], [0, 0.035, -0.06]);
  b.box('dark', [0.004, 0.03, 0.08], [0.031, 0.04, -0.05]);
  // tampa superior articulada na traseira (a alça e a mira acoplada sobem junto na recarga)
  const coverAt: [number, number, number] = [0, 0.078, 0.07];
  const cover = b.part('cover', coverAt);
  const c = (x: number, y: number, z: number): [number, number, number] => [x - coverAt[0], y - coverAt[1], z - coverAt[2]];
  b.box('gun', [0.058, 0.02, 0.22], [0, 0.008, -0.11], cover);
  b.box('dark', [0.06, 0.006, 0.02], [0, 0.0, -0.2], cover);
  b.anchor('cover', [-0.02, 0.016, -0.18], cover);
  // alça em anel (abertura) sobre a tampa, com orelhas de proteção
  const rearZ = 0.04;
  b.irons(() => {
    b.box('black', [0.026, 0.01, 0.024], c(0, 0.101, rearZ), cover); // base
    b.box('dark', [0.016, 0.004, 0.005], c(0, L + 0.006, rearZ), cover);
    b.box('dark', [0.016, 0.004, 0.005], c(0, L - 0.006, rearZ), cover);
    b.box('dark', [0.004, 0.016, 0.005], c(-0.006, L, rearZ), cover);
    b.box('dark', [0.004, 0.016, 0.005], c(0.006, L, rearZ), cover);
    b.box('black', [0.004, 0.022, 0.016], c(-0.012, L - 0.002, rearZ), cover);
    b.box('black', [0.004, 0.022, 0.016], c(0.012, L - 0.002, rearZ), cover);
  });
  b.anchor('sight', [0, L, rearZ]);

  // guarda-mão, cano longo e alça de transporte
  b.box('black', [0.054, 0.05, 0.18], [0, 0.02, -0.3]);
  for (let i = 0; i < 5; i++) b.box('dark', [0.056, 0.008, 0.01], [0, 0.03, -0.38 + i * 0.035]);
  b.rod('steel', 0.024, 0.54, [0, 0.045, -0.65]);
  for (let i = 0; i < 3; i++) b.rod('dark', 0.028, 0.012, [0, 0.045, -0.44 - i * 0.03]); // aletas de refrigeração
  b.rod('black', 0.03, 0.05, [0, 0.045, -0.945]);
  // alça de transporte: sai com mira acoplada (não aparece no fundo da luneta)
  b.irons(() => {
    b.box('black', [0.016, 0.04, 0.012], [0, 0.085, -0.42]);
    b.box('black', [0.02, 0.012, 0.09], [0, 0.11, -0.42]);
  });

  // massa: poste com capuz aberto num bloco preso ao cano
  const frontZ = -0.88;
  b.box('black', [0.03, 0.03, 0.024], [0, 0.05, frontZ]); // abraçadeira no cano
  b.irons(() => {
    b.box('black', [0.006, L - 0.064, 0.008], [0, (0.064 + L) / 2 - 0.001, frontZ]); // poste
    b.box('sight', [0.003, 0.003, 0.002], [0, L - 0.0015, frontZ + 0.005]);
    b.box('black', [0.004, 0.04, 0.018], [-0.012, 0.09, frontZ]); // capuz
    b.box('black', [0.004, 0.04, 0.018], [0.012, 0.09, frontZ]);
  });

  // bipé recolhido sob o cano, preso por uma abraçadeira (bloco que liga as pernas ao cano)
  const bipodZ = -0.8;
  b.box('black', [0.036, 0.04, 0.028], [0, 0.03, bipodZ]); // abraçadeira
  b.box('dark', [0.044, 0.012, 0.02], [0, 0.012, bipodZ + 0.004]); // eixo das pernas
  b.box('black', [0.01, 0.01, 0.2], [-0.016, 0.01, bipodZ + 0.1]);
  b.box('black', [0.01, 0.01, 0.2], [0.016, 0.01, bipodZ + 0.1]);
  b.box('dark', [0.014, 0.014, 0.016], [-0.016, 0.01, bipodZ + 0.2]); // sapatas
  b.box('dark', [0.014, 0.014, 0.016], [0.016, 0.01, bipodZ + 0.2]);

  triggerGuard(b);
  pistolGrip(b, 0.06);
  // caixa de munição + cinta
  const mag = b.part('mag', [0, -0.02, -0.12]);
  b.box('olive', [0.08, 0.11, 0.12], [-0.01, -0.06, 0], mag);
  b.box('oliveDark', [0.082, 0.02, 0.122], [-0.01, -0.005, 0], mag);
  const belt = b.part('belt', [-0.035, 0.0, 0], mag);
  for (let i = 0; i < 6; i++) b.box('brass', [0.012, 0.01, 0.04], [0, 0.012 + i * 0.012, 0], belt);
  b.anchor('mag', [-0.05, -0.08, 0], mag);
  // coronha
  b.box('black', [0.04, 0.07, 0.24], [0, 0.02, 0.21]);
  b.box('black', [0.044, 0.1, 0.02], [0, 0.01, 0.33]);
  const ch = b.part('charging', [0.034, 0.03, -0.18]);
  b.box('dark', [0.014, 0.014, 0.02], [0.006, 0, 0], ch);
  b.anchor('charging', [0.016, 0, 0], ch);
  b.anchor('support', [-0.022, -0.005, -0.3]);
  b.anchor('muzzle', [0, 0.045, -0.975]);
  b.anchor('eject', [0.02, -0.02, -0.06]);
  b.anchor('grip', [0.006, -0.042, 0.085]);
  return b.build(view('lmg'));
}

export function buildMinigun(): WeaponModel {
  const b = new ModelBuilder('minigun');
  b.box('black', [0.11, 0.11, 0.22], [0, 0.07, -0.16]);
  b.box('gun', [0.08, 0.08, 0.1], [0.06, 0.02, -0.1]); // motor
  b.box('dark', [0.115, 0.02, 0.02], [0, 0.07, -0.05]);
  // canos rotativos
  const barrels = b.part('barrels', [0, 0.07, -0.27]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box('steel', [0.016, 0.016, 0.46], [Math.cos(a) * 0.03, Math.sin(a) * 0.03, -0.23], barrels);
  }
  b.rod('black', 0.09, 0.02, [0, 0, -0.08], barrels);
  b.rod('black', 0.09, 0.02, [0, 0, -0.44], barrels);
  b.rod('dark', 0.02, 0.46, [0, 0, -0.23], barrels);
  // alça superior e empunhadura traseira
  b.box('black', [0.014, 0.05, 0.014], [0, 0.145, -0.22]);
  b.box('black', [0.014, 0.05, 0.014], [0, 0.145, -0.08]);
  b.box('black', [0.022, 0.022, 0.18], [0, 0.175, -0.15]);
  b.box('grip', [0.032, 0.1, 0.04], [0, -0.05, 0]);
  b.box('black', [0.04, 0.03, 0.08], [0, 0.02, -0.03]);
  // caixa de munição
  const mag = b.part('mag', [-0.02, -0.04, -0.16]);
  b.box('olive', [0.11, 0.13, 0.15], [-0.04, -0.06, 0], mag);
  b.box('oliveDark', [0.112, 0.02, 0.152], [-0.04, 0.01, 0], mag);
  const belt = b.part('belt', [0.0, 0.02, 0], mag);
  for (let i = 0; i < 5; i++) b.box('brass', [0.012, 0.01, 0.04], [0.01 + i * 0.008, i * 0.012, 0], belt);
  b.anchor('mag', [-0.08, -0.06, 0], mag);
  b.anchor('support', [-0.01, 0.18, -0.15]);
  b.anchor('sight', [0, 0.2, -0.1]);
  b.anchor('muzzle', [0, 0.07, -0.75]);
  b.anchor('eject', [0.06, 0.03, -0.18]);
  b.anchor('grip', [0.006, -0.045, 0.01]);
  return b.build(view('minigun'));
}

export function buildRPG7(): WeaponModel {
  const b = new ModelBuilder('rpg7');
  const y = 0.075;
  b.rod('steel', 0.05, 0.92, [0, y, -0.1]);
  b.rod('wood', 0.066, 0.22, [0, y, -0.02]);
  b.rod('steel', 0.07, 0.12, [0, y, 0.38]);
  b.rod('dark', 0.074, 0.02, [0, y, 0.44]);
  b.box('black', [0.03, 0.05, 0.03], [0, 0.03, -0.0]); // base gatilho
  pistolGrip(b, 0.0, 0.09, 'black', -0.15);
  triggerGuard(b);
  b.box('black', [0.028, 0.08, 0.032], [0, 0.0, -0.2]); // empunhadura frontal
  b.anchor('support', [-0.016, -0.0, -0.2]);
  // mira lateral simples sobre o tubo
  ironSights(b, y + 0.026, 0.06, -0.38, y + 0.02);
  // foguete
  const rocket = b.part('rocket', [0, y, -0.56]);
  b.rod('rpg', 0.04, 0.14, [0, 0, -0.04], rocket);
  b.rod('rpg', 0.06, 0.06, [0, 0, -0.13], rocket);
  b.rod('rpg', 0.09, 0.07, [0, 0, -0.19], rocket);
  b.rod('rpg', 0.06, 0.06, [0, 0, -0.26], rocket);
  b.rod('rpg', 0.03, 0.05, [0, 0, -0.31], rocket);
  b.box('dark', [0.012, 0.012, 0.02], [0, 0, -0.345], rocket);
  b.anchor('rocket', [-0.03, -0.035, -0.16], rocket);
  b.anchor('muzzle', [0, y, -0.58]);
  b.anchor('grip', [0.006, -0.04, 0.012]);
  return b.build(view('rpg'));
}

export function buildM32(): WeaponModel {
  const b = new ModelBuilder('m32');
  b.box('black', [0.05, 0.02, 0.36], [0, 0.12, -0.12]); // trilho superior
  b.box('black', [0.05, 0.06, 0.08], [0, 0.06, 0.0]); // armação traseira
  b.box('black', [0.04, 0.03, 0.03], [0, 0.1, -0.29]);
  // tambor
  const cyl = b.part('cylinder', [0, 0.055, -0.13]);
  b.rod('black', 0.14, 0.15, [0, 0, 0], cyl);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box('dark', [0.03, 0.03, 0.004], [Math.cos(a) * 0.045, Math.sin(a) * 0.045, -0.076], cyl);
    b.box('gun', [0.012, 0.03, 0.15], [Math.cos(a + 0.5) * 0.07, Math.sin(a + 0.5) * 0.07, 0], cyl, [0, 0, a + 0.5]);
  }
  b.anchor('cylinder', [-0.07, -0.03, -0.04], cyl);
  b.rod('dark', 0.05, 0.16, [0, 0.07, -0.29]);
  b.rod('black', 0.06, 0.03, [0, 0.07, -0.36]);
  triggerGuard(b);
  pistolGrip(b, 0.03);
  b.box('grip', [0.026, 0.08, 0.03], [0, -0.02, -0.29]);
  b.anchor('support', [-0.016, -0.025, -0.29]);
  b.rod('black', 0.026, 0.14, [0, 0.07, 0.11]);
  b.box('black', [0.04, 0.09, 0.02], [0, 0.05, 0.19]);
  // granada 40 mm (recarga)
  const shell = b.part('shell', [0, 0.055, -0.04]);
  b.rod('brass', 0.034, 0.03, [0, 0, 0.0], shell);
  b.rod('olive', 0.03, 0.03, [0, 0, -0.03], shell);
  b.anchor('shell', [-0.01, -0.02, 0.01], shell);
  ironSights(b, 0.13, 0.0, -0.27, 0.115);
  b.anchor('muzzle', [0, 0.07, -0.38]);
  b.anchor('grip', [0.006, -0.04, 0.05]);
  const model = b.build(view('launcher'));
  model.parts.get('shell')!.visible = false;
  return model;
}
