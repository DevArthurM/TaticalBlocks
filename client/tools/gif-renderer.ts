/**
 * Ferramenta de desenvolvimento: gera um GIF giratório leve para cada arma.
 * Abra http://localhost:5173/tools/gifs.html (com `npm run dev`) e clique em "Renderizar".
 */
import { WEAPONS } from '@shared/weapons/catalog';
import type { WeaponDef } from '@shared/weapons/types';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import * as THREE from 'three';
import { buildWeaponModel } from '../src/weapons/models/registry';

export const GIF = {
  width: 160,
  height: 90,
  fps: 25,
  /** Uma volta completa = 2 s → 50 quadros. */
  frames: 50,
  colors: 48,
  /** Inclinação da câmera (graus) para mostrar um pouco do topo. */
  elevation: 14,
} as const;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(GIF.width, GIF.height);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x50555e, 1.7));
const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
key.position.set(-2, 3, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0xcfe0ff, 1.0);
rim.position.set(2, 1, -2);
scene.add(rim);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
const turntable = new THREE.Group();
scene.add(turntable);

const readback = document.createElement('canvas');
readback.width = GIF.width;
readback.height = GIF.height;
const ctx = readback.getContext('2d', { willReadFrequently: true })!;

/** Coloca o modelo deitado/centralizado na plataforma e enquadra a câmera. */
function stage(def: WeaponDef): void {
  turntable.clear();
  const model = buildWeaponModel(def.id);
  const holder = new THREE.Group();
  holder.add(model.root);
  model.root.scale.setScalar(1);
  // armas brancas são modeladas em pé (cabo em +Y): deita para ficar horizontal
  if (def.kind === 'melee') holder.rotation.z = Math.PI / 2;

  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const center = box.getCenter(new THREE.Vector3());
  holder.position.sub(center);
  turntable.add(holder);

  // raio horizontal máximo (o modelo gira em torno de Y) + altura
  holder.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(holder);
  const rXZ = Math.max(Math.hypot(b.min.x, b.min.z), Math.hypot(b.max.x, b.max.z), Math.hypot(b.min.x, b.max.z), Math.hypot(b.max.x, b.min.z));
  const halfH = Math.max(Math.abs(b.min.y), Math.abs(b.max.y));
  const aspect = GIF.width / GIF.height;
  const el = THREE.MathUtils.degToRad(GIF.elevation);
  // projeção vertical na câmera inclinada: altura + profundidade inclinada
  const halfHeight = Math.max(halfH * Math.cos(el) + rXZ * Math.sin(el), rXZ / aspect) * 1.06;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  const dist = rXZ * 4 + 2;
  camera.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist);
  camera.near = 0.01;
  camera.far = dist * 2 + rXZ * 2;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function captureFrame(angle: number): Uint8ClampedArray {
  // barril apontando para a esquerda no quadro 0 (igual à imagem de referência)
  turntable.rotation.y = Math.PI / 2 + angle;
  renderer.render(scene, camera);
  ctx.clearRect(0, 0, GIF.width, GIF.height);
  ctx.drawImage(renderer.domElement, 0, 0);
  const data = ctx.getImageData(0, 0, GIF.width, GIF.height).data;
  // alfa de 1 bit: borda semi-transparente vira sólida ou some
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] >= 110 ? 255 : 0;
  return data;
}

export function encodeWeaponGif(def: WeaponDef): Uint8Array {
  stage(def);
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < GIF.frames; i++) frames.push(captureFrame((i / GIF.frames) * Math.PI * 2));

  // paleta global a partir de alguns quadros → cores estáveis e arquivo menor
  const sample = frames.filter((_, i) => i % 5 === 0);
  const joined = new Uint8ClampedArray(sample.length * frames[0].length);
  sample.forEach((f, i) => joined.set(f, i * f.length));
  const palette = quantize(joined, GIF.colors, { format: 'rgba4444', oneBitAlpha: true });
  const transparentIndex = Math.max(0, palette.findIndex((c) => c[3] === 0));

  const gif = GIFEncoder();
  frames.forEach((rgba, i) => {
    const index = applyPalette(rgba, palette, 'rgba4444');
    gif.writeFrame(index, GIF.width, GIF.height, {
      palette: i === 0 ? palette : undefined,
      delay: 1000 / GIF.fps,
      transparent: true,
      transparentIndex,
      dispose: 2,
    });
  });
  gif.finish();
  return gif.bytes();
}

async function save(id: string, bytes: Uint8Array): Promise<void> {
  const res = await fetch(`/__tools/save-gif?id=${encodeURIComponent(id)}`, { method: 'POST', body: bytes as BlobPart });
  if (!res.ok) throw new Error(`Falha ao salvar ${id}: HTTP ${res.status}`);
}

let running: Promise<{ count: number; bytes: number }> | null = null;

function renderAll(): Promise<{ count: number; bytes: number }> {
  running ??= doRenderAll().finally(() => (running = null));
  return running;
}

async function doRenderAll(): Promise<{ count: number; bytes: number }> {
  const status = document.getElementById('status')!;
  const grid = document.getElementById('grid')!;
  grid.innerHTML = '';
  let total = 0;
  for (const [i, def] of WEAPONS.entries()) {
    status.textContent = `Renderizando ${i + 1}/${WEAPONS.length}: ${def.name}…`;
    await new Promise((r) => setTimeout(r, 0));
    const bytes = encodeWeaponGif(def);
    await save(def.id, bytes);
    total += bytes.length;
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/gif' }));
    fig.append(img);
    fig.insertAdjacentHTML('beforeend', `<figcaption><span>${def.name}</span><span>${(bytes.length / 1024).toFixed(1)} KB</span></figcaption>`);
    grid.append(fig);
  }
  status.textContent = `✓ ${WEAPONS.length} GIFs salvos — total ${(total / 1024).toFixed(0)} KB (média ${(total / WEAPONS.length / 1024).toFixed(1)} KB)`;
  return { count: WEAPONS.length, bytes: total };
}

const button = document.getElementById('run') as HTMLButtonElement;
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await renderAll();
  } catch (err) {
    document.getElementById('status')!.textContent = String(err);
  } finally {
    button.disabled = false;
  }
});

(window as unknown as { renderAll: typeof renderAll }).renderAll = renderAll;
