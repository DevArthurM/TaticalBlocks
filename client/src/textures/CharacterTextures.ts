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
export function createCamoTexture(seed = 11): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#4e5733';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#6e7843', '#5a6439'], 14, 4, 3);
  scatter(ctx, rnd, S, ['#8a7a57', '#7c6c4b'], 8, 3, 2);
  scatter(ctx, rnd, S, ['#33372a', '#2a2824'], 10, 3, 2);
  return pixelTexture(canvas);
}

/** Barra dobrada da manga (tom oliva mais claro e uniforme). */
export function createCuffTexture(seed = 5): THREE.Texture {
  const S = 16;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(seed);
  ctx.fillStyle = '#69724a';
  ctx.fillRect(0, 0, S, S);
  scatter(ctx, rnd, S, ['#5d6641', '#757f53', '#6e6f4c'], 14, 4, 3);
  ctx.fillStyle = '#545c3a';
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
