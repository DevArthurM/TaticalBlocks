import * as THREE from 'three';
import { seededRandom } from '../core/math';
import { createCanvas, smoothTexture } from './canvas';

/**
 * Parede branca com bordas levemente escurecidas (oclusão falsa)
 * para destacar as arestas das caixas e reforçar a profundidade.
 */
export function createWallTexture(anisotropy: number): THREE.Texture {
  const S = 256;
  const { canvas, ctx } = createCanvas(S);
  ctx.fillStyle = '#f4f4f2';
  ctx.fillRect(0, 0, S, S);

  const rnd = seededRandom(42);
  for (let i = 0; i < 2500; i++) {
    const v = 236 + Math.floor(rnd() * 16);
    ctx.fillStyle = `rgb(${v},${v},${v - 2})`;
    ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
  }

  const edge = 18;
  for (let i = 0; i < edge; i++) {
    const a = 0.16 * Math.pow(1 - i / edge, 2.2);
    ctx.strokeStyle = `rgba(40,45,55,${a})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(i + 0.5, i + 0.5, S - i * 2 - 1, S - i * 2 - 1);
  }
  return smoothTexture(canvas, anisotropy);
}

/** Piso cinza claro com grade — dá referência de distância e velocidade. */
export function createGroundTexture(anisotropy: number): THREE.Texture {
  const S = 256;
  const { canvas, ctx } = createCanvas(S);
  ctx.fillStyle = '#c5c9ce';
  ctx.fillRect(0, 0, S, S);

  const rnd = seededRandom(7);
  for (let i = 0; i < 3000; i++) {
    const v = 188 + Math.floor(rnd() * 18);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
  }

  ctx.fillStyle = '#aeb3b9';
  ctx.fillRect(0, 0, S, 3);
  ctx.fillRect(0, 0, 3, S);
  ctx.fillStyle = '#b9bec4';
  ctx.fillRect(0, S / 2, S, 1);
  ctx.fillRect(S / 2, 0, 1, S);

  const tex = smoothTexture(canvas, anisotropy);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Sprite radial para clarão de disparo. */
export function createFlashTexture(): THREE.Texture {
  const S = 64;
  const { canvas, ctx } = createCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.25, 'rgba(255,210,120,0.95)');
  g.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  g.addColorStop(1, 'rgba(255,100,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // raios
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,220,150,0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    ctx.lineTo(S / 2 + Math.cos(a) * S * 0.48, S / 2 + Math.sin(a) * S * 0.48);
    ctx.stroke();
  }
  return smoothTexture(canvas);
}

/** Marca de bala na parede. */
export function createBulletHoleTexture(): THREE.Texture {
  const S = 64;
  const { canvas, ctx } = createCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(15,15,18,1)');
  g.addColorStop(0.28, 'rgba(25,25,30,0.95)');
  g.addColorStop(0.42, 'rgba(90,90,95,0.55)');
  g.addColorStop(1, 'rgba(120,120,125,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return smoothTexture(canvas);
}

/** Caixa de madeira: tábuas, moldura escura e travessa diagonal (estilo voxel). */
export function createCrateTexture(): THREE.Texture {
  const S = 32;
  const { canvas, ctx } = createCanvas(S);
  const rnd = seededRandom(17);
  ctx.fillStyle = '#9a6a3a';
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 8) {
    ctx.fillStyle = y % 16 ? '#a87443' : '#8f5f33';
    ctx.fillRect(0, y, S, 7);
    ctx.fillStyle = '#6f4724';
    ctx.fillRect(0, y + 7, S, 1);
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#86592f' : '#b07c4a';
    ctx.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 2 + Math.floor(rnd() * 3), 1);
  }
  ctx.fillStyle = '#5a3a1d';
  ctx.fillRect(0, 0, S, 3);
  ctx.fillRect(0, S - 3, S, 3);
  ctx.fillRect(0, 0, 3, S);
  ctx.fillRect(S - 3, 0, 3, S);
  for (let i = 3; i < S - 3; i++) ctx.fillRect(i, i - 1, 2, 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}


