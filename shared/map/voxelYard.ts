import type { BoxData, MapData, MaterialId } from './types';

/**
 * "Pátio Voxel": arena PvP 1v1, todo destrutível (exceto a borda).
 *
 * Simetria de ponto (rotação de 180° em torno do centro): cada base tem as
 * mesmas rotas, coberturas e ângulos que a outra — a rota da direita de um
 * jogador é a rota da direita do adversário.
 *
 *            N  base VERMELHA (z ≈ −24)
 *   ┌──────────────────────────────────┐
 *   │ contêineres │  meio  │  barracão │   ← rota esq. / meio / dir. (vista do sul)
 *   │             │ bunker │           │
 *   │  barracão   │  meio  │contêineres│
 *   └──────────────────────────────────┘
 *            S  base AZUL (z ≈ +24, spawn)
 *
 * Coordenadas em metros, múltiplas de 0,25 (tamanho do voxel).
 */
export function buildVoxelYard(): MapData {
  const boxes: BoxData[] = [];
  let n = 0;
  /** Bloco pelos cantos mínimo/máximo. */
  const box = (material: MaterialId, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color?: number, id?: string) => {
    boxes.push({
      id: id ?? `${material}-${n++}`,
      material,
      color,
      position: { x: (x0 + x1) / 2, y: y0, z: (z0 + z1) / 2 },
      size: { x: x1 - x0, y: y1 - y0, z: z1 - z0 },
    });
  };
  /** Bloco + a cópia girada 180° (lado adversário). `mirror` troca a cor do time. */
  const sym = (material: MaterialId, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color?: number, mirror?: number) => {
    box(material, x0, y0, z0, x1, y1, z1, color);
    box(material, -x1, y0, -z1, -x0, y1, -z0, mirror ?? color);
  };

  const SIZE = 60;
  const H = SIZE / 2;
  const BLUE = 0x2f7fd8;
  const RED = 0xd9433b;
  const WHITE = 0xeeeeea;
  const YELLOW = 0xf2c12e;

  // ── borda indestrutível ──
  box('bedrock', -H - 1, 0, -H - 1, H + 1, 4, -H, undefined, 'wall-n');
  box('bedrock', -H - 1, 0, H, H + 1, 4, H + 1, undefined, 'wall-s');
  box('bedrock', -H - 1, 0, -H, -H, 4, H, undefined, 'wall-w');
  box('bedrock', H, 0, -H, H + 1, 4, H, undefined, 'wall-e');

  const c = 'concrete';
  const w = 'wood';
  const m = 'metal';
  const p = 'plastic';

  // ── bases (azul ao sul, vermelha ao norte) ──
  // sala em U aberta para o meio, com duas saídas laterais e uma central
  sym(c, -7, 0, 27, 7, 3, 27.25); // fundo
  // laterais com porta (z 22.5–24)
  for (const [x0, x1] of [
    [-7, -6.75],
    [6.75, 7],
  ]) {
    sym(c, x0, 0, 20.25, x1, 3, 22.5);
    sym(c, x0, 0, 24, x1, 3, 27);
    sym(c, x0, 2.25, 22.5, x1, 3, 24);
  }
  sym(c, -7, 0, 20, -2, 3, 20.25); // frente (esq.) — saída central de 4 m
  sym(c, 2, 0, 20, 7, 3, 20.25); // frente (dir.)
  sym(c, -2, 2.25, 20, 2, 3, 20.25); // verga da saída central
  // faixa do time (plástico colorido) acima da saída e pilares de marcação
  sym(p, -2, 3, 19.75, 2, 3.5, 20.25, BLUE, RED);
  sym(p, -2.75, 0, 19, -2, 1.25, 19.75, BLUE, RED);
  sym(p, 2, 0, 19, 2.75, 1.25, 19.75, BLUE, RED);
  // coberturas logo na saída da base
  sym(c, -5, 0, 15.5, -1.5, 1.25, 15.75);
  sym(c, 1.5, 0, 15.5, 5, 1.25, 15.75);

  // ── meio: bunker de concreto com teto (simétrico em si) ──
  // paredes norte/sul com janela, leste/oeste com porta
  sym(c, -3, 0, 2.75, -1, 3, 3);
  sym(c, 1, 0, 2.75, 3, 3, 3);
  sym(c, -1, 0, 2.75, 1, 1, 3);
  sym(c, -1, 2, 2.75, 1, 3, 3);
  sym(c, -3, 0, -2.75, -2.75, 3, -0.75);
  sym(c, -3, 0, 0.75, -2.75, 3, 2.75);
  sym(c, -3, 2.25, -0.75, -2.75, 3, 0.75);
  box(c, -3, 3, -3, 3, 3.25, 3); // teto
  // muretas de aproximação ao meio
  sym(c, -1.5, 0, 8.5, 1.5, 1.25, 8.75);
  sym(p, -6.5, 0, 6, -5.5, 1, 7, YELLOW);
  sym(p, 5.5, 0, 6, 6.5, 1, 7, WHITE);
  sym(c, -8.5, 0, 11, -7.5, 3, 12); // pilares
  sym(c, 7.5, 0, 11, 8.5, 3, 12);

  // ── divisórias entre rotas (com janela de passagem) ──
  sym(c, -11, 0, 4, -10.75, 2.5, 8);
  sym(c, -11, 0, 10, -10.75, 2.5, 13);
  sym(c, -11, 1, 8, -10.75, 2.5, 10); // janela baixa (dá para pular)
  sym(c, 10.75, 0, 4, 11, 2.5, 8);
  sym(c, 10.75, 0, 10, 11, 2.5, 13);
  sym(c, 10.75, 1, 8, 11, 2.5, 10);

  // ── rota oeste (vista do sul): barracão de madeira atravessável ──
  sym(w, -22, 0, 6, -21.75, 2.75, 14); // parede externa
  sym(w, -16.25, 0, 6, -16, 2.75, 8.5); // parede interna com porta
  sym(w, -16.25, 0, 11.5, -16, 2.75, 14);
  sym(w, -16.25, 2, 8.5, -16, 2.75, 11.5);
  sym(w, -22, 2.75, 6, -16, 3, 14); // telhado
  sym(w, -22, 0, 14, -20.5, 2.75, 14.25); // frente com porta larga
  sym(w, -17.5, 0, 14, -16, 2.75, 14.25);
  sym(w, -24, 0, 17, -23.75, 1.25, 21); // cerca até a base
  sym(w, -19.5, 0, 17.5, -18.25, 1, 18.75); // paletes
  sym(w, -19.5, 1, 17.5, -18.25, 1.5, 18.75);

  // ── rota leste (vista do sul): contêineres ──
  const container = (x0: number, z0: number, color: number, mirror: number) => {
    // ao longo de Z, aberto nas duas pontas (corredor coberto)
    const x1 = x0 + 2.5;
    const z1 = z0 + 6;
    sym(m, x0, 0, z0, x0 + 0.25, 2.25, z1, color, mirror);
    sym(m, x1 - 0.25, 0, z0, x1, 2.25, z1, color, mirror);
    sym(m, x0, 2.25, z0, x1, 2.5, z1, color, mirror);
  };
  container(15, 6, 0x2f5f9e, 0xb3392f);
  // contêiner fechado (oco) — cobertura alta para subir pela quina
  sym(m, 20, 0, 9, 22.5, 2.25, 9.25, 0x4f7a3a);
  sym(m, 20, 0, 14.75, 22.5, 2.25, 15, 0x4f7a3a);
  sym(m, 20, 0, 9.25, 20.25, 2.25, 14.75, 0x4f7a3a);
  sym(m, 22.25, 0, 9.25, 22.5, 2.25, 14.75, 0x4f7a3a);
  sym(m, 20, 2.25, 9, 22.5, 2.5, 15, 0x4f7a3a);
  sym(p, 18, 0, 16.5, 19, 1, 17.5, BLUE, RED); // caixotes empilhados
  sym(p, 19, 0, 16.5, 20, 1, 17.5, YELLOW);
  sym(p, 18, 1, 16.5, 19, 2, 17.5, YELLOW);

  // ── linha central (z ≈ 0): coberturas das rotas laterais ──
  sym(c, 14, 0, -0.25, 18, 1.25, 0.25);
  sym(c, 21, 0, -2, 22, 3, -1); // pilar
  sym(p, -26, 0, -1, -25, 1, 1, WHITE);

  return {
    name: 'Pátio Voxel',
    seed: 0,
    size: SIZE,
    wallHeight: 4,
    // dentro da base azul, olhando para o norte (−Z)
    spawn: { x: 0, y: 0, z: 24 },
    boxes,
    // caixas com física espelhadas (mesma proteção para os dois lados)
    crates: [
      { x: 4, z: 12.5, size: 0.8, stack: 2 },
      { x: -4, z: -12.5, size: 0.8, stack: 2 },
      { x: -3.5, z: 11.5, size: 0.7 },
      { x: 3.5, z: -11.5, size: 0.7 },
      { x: -13, z: 2.5, size: 0.8 },
      { x: 13, z: -2.5, size: 0.8 },
      { x: 13.25, z: 15.5, size: 0.6 },
      { x: -13.25, z: -15.5, size: 0.6 },
      { x: -5, z: 22.5, size: 0.7, stack: 3 },
      { x: 5, z: -22.5, size: 0.7, stack: 3 },
    ],
  };
}
