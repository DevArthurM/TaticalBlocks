import * as THREE from 'three';
import { seededRandom } from '../core/math';
import { createCanvas, pixelTexture } from './canvas';

type Rng = () => number;

function scatter(ctx: CanvasRenderingContext2D, rnd: Rng, size: number, colors: string[], count: number, maxW: number, maxH: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const w = 1 + Math.floor(rnd() * maxW);
    const h = 1 + Math.floor(rnd() * maxH);
    const x = Math.floor(rnd() * size);
    const y = Math.floor(rnd() * size);
    ctx.fillRect(x, y, w, h);
    // repete na borda oposta para o padrão "fechar" entre faces
    if (x + w > size) ctx.fillRect(x - size, y, w, h);
    if (y + h > size) ctx.fillRect(x, y - size, w, h);
  }
}

/** Camuflado digital verde/marrom das mangas. */
/** Paletas de camuflado: oliva (offline) e os uniformes dos times online. */
export type CamoPalette = 'woodland' | 'green' | 'blue';

const CAMO: Record<CamoPalette, { base: string; mid: string[]; light: string[]; dark: string[]; cuff: string[] }> = {
  woodland: { base: '#4e5733', mid: ['#6e7843', '#5a6439'], light: ['#8a7a57', '#7c6c4b'], dark: ['#33372a', '#2a2824'], cuff: ['#69724a', '#5d6641', '#757f53', '#6e6f4c', '#545c3a'] },
  green: { base: '#3d5a2a', mid: ['#557c35', '#4a6b2f'], light: ['#7f9450', '#6e8346'], dark: ['#22331a', '#1a2614'], cuff: ['#5b7a3c', '#506d35', '#678845', '#5f7a40', '#45602f'] },
  blue: { base: '#34496a', mid: ['#4a6690', '#405a7f'], light: ['#8a9ab2', '#7888a2'], dark: ['#1d283c', '#161f30'], cuff: ['#55698c', '#4b5e80', '#61779c', '#5a6c8c', '#43567a'] },
};

export function createCamoTexture(seed = 11, palette: CamoPalette = 'woodland'): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  const c = CAMO[palette];
  ctx.fillStyle = c.base;
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, c.mid, 14, 4, 3);
  scatter(ctx, rnd, S, c.light, 8, 3, 2);
  scatter(ctx, rnd, S, c.dark, 10, 3, 2);
  return pixelTexture(canvas);
}

/** Barra dobrada da manga (tom oliva mais claro e uniforme). */
export function createCuffTexture(seed = 5, palette: CamoPalette = 'woodland'): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  const c = CAMO[palette].cuff;
  ctx.fillStyle = c[0];
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, c.slice(1, 4), 14, 4, 3);
  ctx.fillStyle = c[4];
  ctx.fillRect(0, S - 2, S, 2);
  return pixelTexture(canvas);
}

export function createSkinTexture(seed = 3): THREE.Texture {
  const S = 8;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#e7b38b';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#dda57d', '#efbf98'], 6, 2, 2);
  return pixelTexture(canvas);
}

/** Luva tática preta com costuras. */
export function createGloveTexture(seed = 9): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#2b2a2f';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#323137', '#252429'], 10, 3, 3);
  ctx.fillStyle = '#1d1c20';
  ctx.fillRect(0, 5, S, 1);
  ctx.fillRect(0, 11, S, 1);
  ctx.fillRect(7, 0, 1, 5);
  ctx.fillStyle = '#3b3a40';
  ctx.fillRect(2, 2, 3, 2);
  ctx.fillRect(10, 7, 3, 2);
  return pixelTexture(canvas);
}

/** Textura de empunhadura com grip quadriculado. */
export function createGripTexture(): THREE.Texture {
  const S = 8;
  const { canvas, ctx } = createCanvas(S);
  ctx.fillStyle = '#1f2023';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#2a2b2f';
  for (let y = 0; y < S; y++) for (let x = (y % 2); x < S; x += 2) ctx.fillRect(x, y, 1, 1);
  return pixelTexture(canvas);
}

// ───────── Zumbi ─────────

/** Pele cinza-esverdeada com manchas e feridas. */
export function createZombieSkinTexture(seed = 41): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#8c9a78';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#7e8c6b', '#97a583', '#869473'], 16, 3, 3);
  scatter(ctx, rnd, S, ['#6e5a4a', '#5c3a32'], 4, 2, 2);
  scatter(ctx, rnd, S, ['#7a1d1a'], 2, 2, 1);
  return pixelTexture(canvas);
}

/** Camiseta branca suja, com manchas de sangue e terra. */
export function createDirtyShirtTexture(seed = 43): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#e6e2d8';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#d4cfc2', '#ecebe6'], 14, 3, 2);
  scatter(ctx, rnd, S, ['#b3a68e', '#9c8f78'], 5, 2, 2);
  scatter(ctx, rnd, S, ['#8a1f1b', '#6e1714'], 5, 3, 2);
  return pixelTexture(canvas);
}

/** Jeans azul com costuras e desgaste. */
export function createJeansTexture(seed = 47): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#3d5d8c';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#35537e', '#46689a', '#4a6c9c'], 18, 3, 1);
  scatter(ctx, rnd, S, ['#7d94b5'], 4, 2, 1);
  ctx.fillStyle = '#c9a65a';
  ctx.fillRect(3, 0, 1, S);
  scatter(ctx, rnd, S, ['#5a1b18'], 2, 2, 1);
  return pixelTexture(canvas);
}

/** Sapato social preto. */
export function createShoeTexture(): THREE.Texture {
  const S = 8;
  const { canvas, ctx } = createCanvas(S);
  ctx.fillStyle = '#1b1b1e';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#2c2c31';
  ctx.fillRect(1, 1, 3, 1);
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(0, S - 2, S, 2);
  return pixelTexture(canvas);
}

/** Rosto: pele, olhos sem vida e boca escura. */
export function createZombieFaceTexture(): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(53);
  ctx.fillStyle = '#8c9a78';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#7e8c6b', '#97a583'], 10, 3, 2);
  ctx.fillStyle = '#e8e4c8';
  ctx.fillRect(3, 6, 3, 2);
  ctx.fillRect(10, 6, 3, 2);
  ctx.fillStyle = '#7a1414';
  ctx.fillRect(4, 6, 1, 2);
  ctx.fillRect(11, 6, 1, 2);
  ctx.fillStyle = '#3a2a24';
  ctx.fillRect(3, 5, 3, 1);
  ctx.fillRect(10, 5, 3, 1);
  ctx.fillStyle = '#2a1414';
  ctx.fillRect(5, 11, 6, 2);
  ctx.fillStyle = '#d9d3b8';
  ctx.fillRect(6, 11, 1, 1);
  ctx.fillRect(9, 11, 1, 1);
  ctx.fillStyle = '#7a1d1a';
  ctx.fillRect(6, 13, 4, 1);
  return pixelTexture(canvas);
}

// ─────────────── variações de zumbi ───────────────
// Texturas de roupa NEUTRAS (claras): a cor de cada peça vem por instância
// (InstancedMesh.setColorAt), então variar cor não cria materiais nem draw calls.

/** Mistura um tom com branco (k > 0) ou preto (k < 0). */
function shade(hex: number, k: number): string {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const f = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Pele de zumbi em um tom (manchas, hematomas e sangue). */
export function createZombieSkinToneTexture(tone: number, seed = 41): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = shade(tone, 0);
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, [shade(tone, -0.08), shade(tone, 0.1), shade(tone, -0.03)], 16, 3, 3);
  scatter(ctx, rnd, S, ['#6e5a4a', '#5c3a32'], 4, 2, 2);
  scatter(ctx, rnd, S, ['#7a1d1a'], 2, 2, 1);
  return pixelTexture(canvas);
}

/** Rosto no mesmo tom da pele: olhos sem vida e boca escura (cores próprias, não tingidas). */
export function createZombieFaceToneTexture(tone: number): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(53);
  ctx.fillStyle = shade(tone, 0);
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, [shade(tone, -0.08), shade(tone, 0.1)], 10, 3, 2);
  ctx.fillStyle = '#e8e4c8';
  ctx.fillRect(3, 6, 3, 2);
  ctx.fillRect(10, 6, 3, 2);
  ctx.fillStyle = '#7a1414';
  ctx.fillRect(4, 6, 1, 2);
  ctx.fillRect(11, 6, 1, 2);
  ctx.fillStyle = shade(tone, -0.55);
  ctx.fillRect(3, 5, 3, 1);
  ctx.fillRect(10, 5, 3, 1);
  ctx.fillStyle = '#2a1414';
  ctx.fillRect(5, 11, 6, 2);
  ctx.fillStyle = '#d9d3b8';
  ctx.fillRect(6, 11, 1, 1);
  ctx.fillRect(9, 11, 1, 1);
  ctx.fillStyle = '#7a1d1a';
  ctx.fillRect(6, 13, 4, 1);
  return pixelTexture(canvas);
}

/** Tecido liso neutro, sujo e com sangue (camiseta, regata, avental, calças). */
export function createClothTexture(seed = 43): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#e2e2e2', '#fafafa', '#d8d8d8'], 16, 3, 2);
  scatter(ctx, rnd, S, ['#b8ad98', '#a39a88'], 5, 2, 2);
  scatter(ctx, rnd, S, ['#8a1f1b', '#6e1714'], 5, 3, 2);
  return pixelTexture(canvas);
}

/** Xadrez de flanela (tingido pela cor da camisa). */
export function createPlaidTexture(): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(61);
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(20,20,20,0.55)';
  for (const k of [2, 3, 10, 11]) {
    ctx.fillRect(k, 0, 1, S);
    ctx.fillRect(0, k, S, 1);
  }
  ctx.fillStyle = 'rgba(20,20,20,0.3)';
  ctx.fillRect(6, 0, 1, S);
  ctx.fillRect(0, 6, S, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(14, 0, 1, S);
  ctx.fillRect(0, 14, S, 1);
  scatter(ctx, rnd, S, ['#8a1f1b', '#a39a88'], 5, 2, 2);
  return pixelTexture(canvas);
}

/** Jeans neutro (trama + costura), tingido pela cor da calça. */
export function createDenimTexture(seed = 47): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#e6e6e6';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#d2d2d2', '#f2f2f2', '#dcdcdc'], 22, 3, 1);
  scatter(ctx, rnd, S, ['#ffffff'], 5, 2, 1);
  ctx.fillStyle = '#fff3c8';
  ctx.fillRect(3, 0, 1, S);
  scatter(ctx, rnd, S, ['#7a2420'], 2, 2, 1);
  return pixelTexture(canvas);
}

/** Couro gasto com costuras (jaqueta). */
export function createLeatherTexture(): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(67);
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#cfcfcf', '#f0f0f0'], 12, 4, 3);
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 7, S, 1);
  ctx.fillRect(8, 0, 1, 7);
  scatter(ctx, rnd, S, ['#ffffff'], 4, 2, 1); // desgaste
  scatter(ctx, rnd, S, ['#6e1714'], 3, 2, 2);
  return pixelTexture(canvas);
}

/** Calçado neutro: cabedal + sola escura (tingido pela cor do calçado). */
export function createFootwearTexture(): THREE.Texture {
  const S = 8;
  const { canvas, ctx } = createCanvas(S);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1, 1, 3, 1);
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(0, S - 2, S, 2);
  return pixelTexture(canvas);
}

// ─────────────── soldado (modo online) ───────────────

/** Rosto humano voxel em um tom de pele. */
export function createSoldierFaceTexture(tone: number): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(71);
  ctx.fillStyle = shade(tone, 0);
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, [shade(tone, -0.06), shade(tone, 0.06)], 10, 3, 2);
  // sobrancelhas, olhos, nariz e boca
  ctx.fillStyle = shade(tone, -0.6);
  ctx.fillRect(3, 5, 3, 1);
  ctx.fillRect(10, 5, 3, 1);
  ctx.fillStyle = '#f2efe6';
  ctx.fillRect(3, 6, 3, 2);
  ctx.fillRect(10, 6, 3, 2);
  ctx.fillStyle = '#2b2a28';
  ctx.fillRect(4, 6, 1, 2);
  ctx.fillRect(11, 6, 1, 2);
  ctx.fillStyle = shade(tone, -0.18);
  ctx.fillRect(7, 8, 2, 2);
  ctx.fillStyle = shade(tone, -0.45);
  ctx.fillRect(6, 11, 4, 1);
  return pixelTexture(canvas);
}

/** Pele humana lisa em um tom. */
export function createHumanSkinTexture(tone: number): THREE.Texture {
  const S = 8;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(73);
  ctx.fillStyle = shade(tone, 0);
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, [shade(tone, -0.05), shade(tone, 0.05)], 8, 2, 2);
  return pixelTexture(canvas);
}

/** Equipamento tático (colete, bolsos): trama de nylon. */
export function createGearTexture(color: number): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(79);
  ctx.fillStyle = shade(color, 0);
  ctx.fillRect(0, 0, S, S);
  for (let y = 1; y < S; y += 4) {
    ctx.fillStyle = shade(color, -0.25);
    ctx.fillRect(0, y, S, 1);
  }
  scatter(ctx, rnd, S, [shade(color, 0.1), shade(color, -0.1)], 10, 3, 1);
  return pixelTexture(canvas);
}
