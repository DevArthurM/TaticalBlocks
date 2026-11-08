// Gera o logo vetorial do TaticalBlocks (client/public/logo.svg) e o ícone (favicon.svg).
// Letras em grade de blocos (estilo voxel): face com gradiente, extrusão escura embaixo
// e contorno preto grosso em volta de tudo. Uso: node scripts/gen-logo.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Glifos 7 linhas de altura ('#' = bloco). Minúsculas ocupam as 5 linhas de baixo. */
const GLYPHS = {
  T: ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..'],
  B: ['#####.', '##..##', '##..##', '#####.', '##..##', '##..##', '#####.'],
  a: ['......', '......', '#####.', '....##', '.#####', '##..##', '.#####'],
  t: ['.##.', '.##.', '####', '.##.', '.##.', '.##.', '..##'],
  i: ['##', '..', '##', '##', '##', '##', '##'],
  c: ['.....', '.....', '.####', '##...', '##...', '##...', '.####'],
  l: ['##', '##', '##', '##', '##', '##', '##'],
  o: ['......', '......', '.####.', '##..##', '##..##', '##..##', '.####.'],
  k: ['##....', '##....', '##..##', '##.##.', '####..', '##.##.', '##..##'],
  s: ['......', '......', '.#####', '##....', '.####.', '....##', '#####.'],
};

const U = 20; // tamanho do bloco (px)
const GAP = 1; // blocos entre letras
const EXTRUDE = 0.9; // profundidade da extrusão (em blocos)
const OUTLINE = 0.56; // espessura do contorno (em blocos)
const PAD = 1.4; // margem (em blocos)

/** Gerador pseudoaleatório estável (mesmo SVG a cada execução). */
let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Blocos de uma palavra: [{x, y}] em unidades de bloco. */
function layout(word, startX) {
  const cells = [];
  let x = startX;
  for (const ch of word) {
    const g = GLYPHS[ch];
    g.forEach((row, y) => [...row].forEach((c, i) => c === '#' && cells.push({ x: x + i, y })));
    x += g[0].length + GAP;
  }
  return { cells, end: x - GAP };
}

/** Blocos de cada linha unidos em retângulos horizontais (menos elementos e sem frestas). */
function runs(cells) {
  const rows = new Map();
  for (const c of cells) (rows.get(c.y) ?? rows.set(c.y, []).get(c.y)).push(c.x);
  const out = [];
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let s = xs[0];
    let p = xs[0];
    for (const x of [...xs.slice(1), Infinity]) {
      if (x === p + 1) {
        p = x;
        continue;
      }
      out.push({ x: s, y, w: p - s + 1 });
      s = p = x;
    }
  }
  return out;
}

const rect = (r, dx, dy, fill) =>
  `<rect x="${((r.x + dx) * U).toFixed(1)}" y="${((r.y + dy) * U).toFixed(1)}" width="${(r.w * U).toFixed(1)}" height="${U}" fill="${fill}"/>`;

function word(cells, face, side, shade) {
  const rs = runs(cells);
  const parts = [];
  // extrusão: várias cópias descendo (parede lateral contínua)
  const steps = 8;
  for (let k = steps; k >= 1; k--) {
    const d = (EXTRUDE * k) / steps;
    parts.push(`<g fill="${k === steps ? shade : side}">${rs.map((r) => rect(r, d * 0.25, d, 'inherit').replace(' fill="inherit"', '')).join('')}</g>`);
  }
  // face com gradiente
  parts.push(`<g fill="url(#${face})">${rs.map((r) => rect(r, 0, 0, '').replace(' fill=""', '')).join('')}</g>`);
  // variação de tom por bloco (textura voxel)
  parts.push(
    `<g>${cells
      .map((c) => {
        const v = rnd();
        const fill = v < 0.5 ? '#000' : '#fff';
        const op = (0.02 + Math.abs(v - 0.5) * 0.12).toFixed(3);
        return `<rect x="${c.x * U}" y="${c.y * U}" width="${U}" height="${U}" fill="${fill}" fill-opacity="${op}"/>`;
      })
      .join('')}</g>`,
  );
  return parts.join('');
}

function logo() {
  const a = layout('Tatical', 0);
  const b = layout('Blocks', a.end + GAP + 0.5);
  const W = (b.end + PAD * 2) * U;
  const H = (7 + EXTRUDE + PAD * 2) * U;
  const tx = PAD * U;
  const ty = PAD * U;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">
  <title>TaticalBlocks</title>
  <defs>
    <linearGradient id="gray" x1="0" y1="0" x2="0" y2="${7 * U}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f4f4f1"/><stop offset="0.55" stop-color="#d6d6d2"/><stop offset="1" stop-color="#9b9c98"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="0" y2="${7 * U}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a6d44e"/><stop offset="0.55" stop-color="#7fb236"/><stop offset="1" stop-color="#4f7f22"/>
    </linearGradient>
    <!-- contorno preto: dilata a silhueta e coloca por baixo -->
    <filter id="outline" x="-5%" y="-20%" width="110%" height="140%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="${OUTLINE * U}" result="thick"/>
      <feFlood flood-color="#0b0c0b"/>
      <feComposite in2="thick" operator="in" result="stroke"/>
      <feMerge><feMergeNode in="stroke"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g transform="translate(${tx} ${ty})" filter="url(#outline)">
    ${word(a.cells, 'gray', '#4a4b48', '#2f302e')}
    ${word(b.cells, 'green', '#2f4f16', '#22390f')}
  </g>
</svg>
`;
}

/** Ícone: "TB" em blocos sobre fundo escuro arredondado. */
function favicon() {
  const t = layout('T', 0);
  const b = layout('B', t.end + GAP);
  const w = b.end;
  const S = 64;
  const scale = (S * 0.72) / (w * U);
  const ox = (S - w * U * scale) / 2;
  const oy = (S - 7 * U * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" shape-rendering="crispEdges">
  <defs>
    <linearGradient id="gray" x1="0" y1="0" x2="0" y2="${7 * U}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f4f4f1"/><stop offset="1" stop-color="#a5a6a2"/></linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="0" y2="${7 * U}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#a6d44e"/><stop offset="1" stop-color="#4f7f22"/></linearGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="12" fill="#12151b"/>
  <g transform="translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${scale.toFixed(4)})">
    <g fill="url(#gray)">${runs(t.cells).map((r) => rect(r, 0, 0, '').replace(' fill=""', '')).join('')}</g>
    <g fill="url(#green)">${runs(b.cells).map((r) => rect(r, 0, 0, '').replace(' fill=""', '')).join('')}</g>
  </g>
</svg>
`;
}

const out = resolve(ROOT, 'client/public');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'logo.svg'), logo());
writeFileSync(resolve(out, 'favicon.svg'), favicon());
console.log('logo.svg e favicon.svg gerados em client/public/');
