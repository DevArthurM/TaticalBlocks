import type { MatKey } from './palette';
import type { ModelBuilder } from './ModelBuilder';
import type { V3 } from './types';

/** Peças reutilizadas por várias armas longas. */

export function pistolGrip(b: ModelBuilder, z = 0.03, length = 0.095, mat: MatKey = 'grip', angle = -0.28) {
  const g = b.group([0, -0.004, z], b.root, [angle, 0, 0]);
  b.box(mat, [0.03, length, 0.04], [0, -length / 2, 0], g);
  return g;
}

export function triggerGuard(b: ModelBuilder, mat: MatKey = 'black') {
  b.box(mat, [0.012, 0.006, 0.055], [0, -0.032, -0.03]);
  b.box(mat, [0.012, 0.032, 0.006], [0, -0.017, -0.058]);
  b.box('dark', [0.006, 0.018, 0.006], [0, -0.012, -0.02]);
}

/** Alça de mira traseira + massa frontal; registra a âncora `sight`. */
export function ironSights(b: ModelBuilder, y: number, rearZ: number, frontZ: number, frontY = y) {
  b.box('dark', [0.006, 0.014, 0.01], [-0.009, y + 0.007, rearZ]);
  b.box('dark', [0.006, 0.014, 0.01], [0.009, y + 0.007, rearZ]);
  b.box('dark', [0.005, frontY - y + 0.016, 0.008], [0, (y + frontY) / 2 + 0.008, frontZ]);
  b.box('sight', [0.003, 0.003, 0.002], [0, frontY + 0.014, frontZ + 0.005]);
  b.anchor('sight', [0, y + 0.012, rearZ]);
}

export function redDot(b: ModelBuilder, y: number, z: number) {
  b.box('black', [0.028, 0.012, 0.05], [0, y + 0.006, z]);
  b.box('black', [0.006, 0.03, 0.04], [-0.014, y + 0.025, z]);
  b.box('black', [0.006, 0.03, 0.04], [0.014, y + 0.025, z]);
  b.box('black', [0.034, 0.006, 0.04], [0, y + 0.043, z]);
  b.box('lens', [0.022, 0.022, 0.002], [0, y + 0.026, z + 0.012]);
  b.box('redDot', [0.003, 0.003, 0.001], [0, y + 0.026, z - 0.01]);
  b.anchor('sight', [0, y + 0.026, z + 0.03]);
}

export function scope(b: ModelBuilder, y: number, z: number, length = 0.26, body: MatKey = 'black') {
  b.rod(body, 0.034, length, [0, y + 0.04, z]);
  b.rod(body, 0.046, 0.05, [0, y + 0.04, z - length / 2 + 0.02]);
  b.rod(body, 0.04, 0.04, [0, y + 0.04, z + length / 2 - 0.02]);
  b.box('lens', [0.032, 0.032, 0.002], [0, y + 0.04, z - length / 2 - 0.001]);
  b.box('lens', [0.028, 0.028, 0.002], [0, y + 0.04, z + length / 2 + 0.001]);
  b.box(body, [0.014, 0.016, 0.014], [0, y + 0.064, z]); // torre
  b.box('dark', [0.012, 0.03, 0.014], [0, y + 0.012, z - 0.06]);
  b.box('dark', [0.012, 0.03, 0.014], [0, y + 0.012, z + 0.06]);
  b.anchor('sight', [0, y + 0.04, z + length / 2 + 0.03]);
}

/** Pente curvo (duas metades inclinadas) dentro de uma peça `mag`. */
export function curvedMag(b: ModelBuilder, pos: V3, mat: MatKey = 'gun', length = 0.15, curve = 0.3) {
  const mag = b.part('mag', pos);
  const h = length / 2;
  b.box(mat, [0.024, h + 0.01, 0.036], [0, -h / 2, 0], mag, [curve * 0.3, 0, 0]);
  b.box(mat, [0.024, h, 0.036], [0, -h * 1.45, -h * curve * 0.55], mag, [curve, 0, 0]);
  b.box('dark', [0.028, 0.01, 0.04], [0, -h * 1.95, -h * curve * 0.9], mag, [curve, 0, 0]);
  b.anchor('mag', [0, -h * 1.9, -h * curve * 0.8], mag);
  return mag;
}

export function railRibs(b: ModelBuilder, y: number, z0: number, z1: number, width = 0.05) {
  for (let z = z0; z < z1; z += 0.022) b.box('dark', [width + 0.002, 0.006, 0.008], [0, y, z]);
}
