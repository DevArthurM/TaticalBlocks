import type { MatKey } from './palette';
import { ModelBuilder } from './ModelBuilder';
import { view } from './presets';
import type { WeaponModel } from './types';

interface GlockOptions {
  slide: MatKey;
  frame: MatKey;
  /** Comprimento do ferrolho. */
  length: number;
  /** Altura da empunhadura. */
  gripLength: number;
  /** Janela de alívio no ferrolho (G34). */
  window?: boolean;
}

/** Família de pistolas de polímero (G17, G17 Inox, G34, G19). */
function glock(id: string, o: GlockOptions): WeaponModel {
  const b = new ModelBuilder(id);
  const L = o.length;
  const rear = 0.035;
  const front = rear - L;

  // armação
  b.box(o.frame, [0.026, 0.022, L * 0.86], [0, 0.005, rear - L * 0.47]);
  b.box(o.frame, [0.024, 0.008, 0.05], [0, -0.008, front + 0.05]); // trilho
  b.box(o.frame, [0.012, 0.006, 0.05], [0, -0.032, -0.03]); // guarda-mato
  b.box(o.frame, [0.012, 0.03, 0.006], [0, -0.019, -0.055]);
  b.box('dark', [0.006, 0.018, 0.006], [0, -0.014, -0.02]); // gatilho

  // ferrolho
  const slide = b.part('slide', [0, 0.016, 0]);
  b.box(o.slide, [0.03, 0.033, L], [0, 0.0165, rear - L / 2], slide);
  for (let i = 0; i < 4; i++) b.box('dark', [0.031, 0.022, 0.003], [0, 0.017, 0.012 + i * 0.006], slide);
  b.box('dark', [0.004, 0.012, 0.034], [0.014, 0.024, -0.04], slide);
  b.box('dark', [0.016, 0.016, 0.006], [0, 0.014, front + 0.001], slide);
  if (o.window) b.box('dark', [0.031, 0.008, 0.05], [0, 0.03, front + 0.06], slide);
  b.box('dark', [0.007, 0.008, 0.006], [-0.0085, 0.036, 0.024], slide);
  b.box('dark', [0.007, 0.008, 0.006], [0.0085, 0.036, 0.024], slide);
  b.box('dark', [0.005, 0.007, 0.008], [0, 0.0365, front + 0.01], slide);
  b.box('sight', [0.0028, 0.0028, 0.0015], [0, 0.0378, front + 0.0145], slide);
  b.anchor('muzzle', [0, 0.014, front - 0.005], slide);
  b.anchor('eject', [0.018, 0.026, -0.04], slide);
  b.anchor('slide', [0, 0.03, 0.025], slide);

  // empunhadura + carregador
  const grip = b.group([0, -0.004, 0.03], b.root, [-0.24, 0, 0]);
  b.box('grip', [0.03, o.gripLength, 0.042], [0, -o.gripLength / 2, 0], grip);
  b.box(o.frame, [0.026, 0.01, 0.02], [0, 0.004, 0.026], grip);
  const mag = b.part('mag', [0, 0, 0], grip);
  b.box('gun', [0.022, o.gripLength - 0.005, 0.032], [0, -o.gripLength / 2, 0], mag);
  b.box('dark', [0.032, 0.01, 0.046], [0, -o.gripLength - 0.001, 0.001], mag);
  b.box('brass', [0.009, 0.009, 0.02], [0, 0.002, -0.004], mag);
  b.anchor('mag', [0, -o.gripLength - 0.01, 0], mag);

  // pegada alta: direita logo abaixo do ferrolho, esquerda envolvendo por baixo
  b.anchor('grip', [0.004, -o.gripLength * 0.27 + 0.027, 0.002], grip);
  b.anchor('support', [-0.012, -o.gripLength * 0.27 + 0.02, -0.032], grip);
  b.anchor('sight', [0, 0.054, 0.024]);
  return b.build(view('pistol'));
}

export const buildG17 = () => glock('g17', { slide: 'black', frame: 'black', length: 0.19, gripLength: 0.105 });
export const buildG17Inox = () => glock('g17_inox', { slide: 'silver', frame: 'black', length: 0.19, gripLength: 0.105 });
export const buildG34 = () => glock('g34', { slide: 'black', frame: 'black', length: 0.225, gripLength: 0.105, window: true });
export const buildG19 = () => glock('g19_fde', { slide: 'black', frame: 'tan', length: 0.17, gripLength: 0.09 });

export function buildRevolver(): WeaponModel {
  const b = new ModelBuilder('revolver');
  // armação e cano
  b.box('steel', [0.026, 0.05, 0.075], [0, 0.022, -0.022]);
  b.box('steel', [0.02, 0.012, 0.06], [0, 0.052, -0.03]);
  b.rod('steel', 0.02, 0.105, [0, 0.038, -0.105]);
  b.box('steel', [0.018, 0.016, 0.1], [0, 0.02, -0.105]);
  b.box('dark', [0.006, 0.012, 0.012], [0, 0.054, -0.148]);
  b.box('dark', [0.008, 0.02, 0.012], [0, 0.055, 0.016]); // cão
  b.box('steel', [0.012, 0.006, 0.04], [0, -0.012, -0.015]);
  b.box('dark', [0.006, 0.016, 0.006], [0, -0.004, -0.01]);

  // tambor (gira para a esquerda numa haste)
  const cyl = b.part('cylinder', [-0.013, 0.012, -0.03]);
  b.rod('silver', 0.042, 0.042, [0.013, 0.02, 0], cyl);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box('dark', [0.008, 0.008, 0.003], [0.013 + Math.cos(a) * 0.013, 0.02 + Math.sin(a) * 0.013, -0.022], cyl);
  }
  b.box('steel', [0.006, 0.01, 0.04], [0.002, -0.004, -0.01], cyl); // haste
  b.anchor('cylinder', [0.0, 0.0, -0.03], cyl);

  // speedloader (aparece só na recarga)
  const sl = b.part('speedloader', [0.013, 0.02, 0.032], cyl);
  b.rod('black', 0.04, 0.014, [0, 0, 0.008], sl);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box('brass', [0.007, 0.007, 0.03], [Math.cos(a) * 0.013, Math.sin(a) * 0.013, -0.012], sl);
  }
  b.anchor('speedloader', [0, -0.01, 0.02], sl);

  const grip = b.group([0, -0.004, 0.022], b.root, [-0.38, 0, 0]);
  b.box('black', [0.028, 0.09, 0.038], [0, -0.045, 0.002], grip);
  b.box('dark', [0.03, 0.06, 0.004], [0, -0.04, -0.016], grip);
  b.anchor('grip', [0.004, -0.024 + 0.027, 0.004], grip);
  b.anchor('support', [-0.012, -0.024 + 0.02, -0.03], grip);

  b.anchor('muzzle', [0, 0.038, -0.162]);
  b.anchor('sight', [0, 0.056, 0.016]);
  const model = b.build(view('revolver'));
  model.parts.get('speedloader')!.visible = false;
  return model;
}
