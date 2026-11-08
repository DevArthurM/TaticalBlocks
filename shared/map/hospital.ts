import type { BarricadeData, BoxData, MapData, MaterialId } from './types';

/**
 * "Hospital": corredor escuro com janelas e saídas de emergência barricadas.
 * Os zumbis surgem do lado de fora e precisam arrancar as tábuas para entrar.
 * Corredor ao longo de X (−20..20), largura 4 (z −2..2), pé-direito 3.
 */
export function buildHospital(): MapData {
  const boxes: BoxData[] = [];
  const barricades: BarricadeData[] = [];
  let n = 0;
  const box = (material: MaterialId, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color?: number, id?: string) => {
    boxes.push({
      id: id ?? `${material}-${n++}`,
      material,
      color,
      position: { x: (x0 + x1) / 2, y: y0, z: (z0 + z1) / 2 },
      size: { x: x1 - x0, y: y1 - y0, z: z1 - z0 },
    });
  };
  const SIZE = 60;
  const H = SIZE / 2;
  const WALL = 0xd5dfd8;
  const CEIL = 0x9aa19c;
  const T = 0.25; // espessura das paredes
  const L = 20; // meio comprimento do corredor
  const HEIGHT = 3;

  // ── borda do mapa (pátio externo) ──
  box('bedrock', -H - 1, 0, -H - 1, H + 1, 4, -H, undefined, 'wall-n');
  box('bedrock', -H - 1, 0, H, H + 1, 4, H + 1, undefined, 'wall-s');
  box('bedrock', -H - 1, 0, -H, -H, 4, H, undefined, 'wall-w');
  box('bedrock', H, 0, -H, H + 1, 4, H, undefined, 'wall-e');

  /** Parede ao longo de X com aberturas (janelas/portas). */
  const wallX = (z0: number, z1: number, openings: { x: number; w: number; bottom: number; top: number }[], outward: number) => {
    let x = -L - T;
    const sorted = [...openings].sort((a, b) => a.x - b.x);
    for (const o of sorted) {
      const a = o.x - o.w / 2;
      const b = o.x + o.w / 2;
      if (a > x) box('hospital', x, 0, z0, a, HEIGHT, z1, WALL);
      if (o.bottom > 0) box('hospital', a, 0, z0, b, o.bottom, z1, WALL); // peitoril
      box('hospital', a, o.top, z0, b, HEIGHT, z1, WALL); // verga
      barricades.push({
        id: `bar-${barricades.length}`,
        kind: o.bottom > 0 ? 'window' : 'door',
        position: { x: o.x, y: o.bottom, z: (z0 + z1) / 2 },
        width: o.w,
        height: o.top - o.bottom,
        outward: { x: 0, z: outward },
      });
      x = b;
    }
    if (x < L + T) box('hospital', x, 0, z0, L + T, HEIGHT, z1, WALL);
  };

  const win = (x: number) => ({ x, w: 1.5, bottom: 0.9, top: 2.2 });
  const door = (x: number) => ({ x, w: 1.25, bottom: 0, top: 2.25 });
  // parede norte: 4 janelas
  wallX(-2 - T, -2, [win(-14), win(-5), win(4), win(13)], -1);
  // parede sul: 2 saídas de emergência + 2 janelas
  wallX(2, 2 + T, [door(-9.5), win(-1), door(8.5), win(16)], 1);
  // fundos do corredor
  box('hospital', -L - T, 0, -2, -L, HEIGHT, 2, WALL);
  box('hospital', L, 0, -2, L + T, HEIGHT, 2, WALL);
  // teto (escurece o corredor)
  box('hospital', -L - T, HEIGHT, -2 - T, L + T, HEIGHT + 0.2, 2 + T, CEIL, 'ceiling');

  // ── mobília (destrutível) ──
  const bed = (x: number, z: number) => {
    // armação de metal + colchão de plástico branco
    box('metal', x - 1, 0, z - 0.45, x + 1, 0.5, z + 0.45, 0x9aa3ad);
    box('plastic', x - 1, 0.5, z - 0.45, x + 1, 0.75, z + 0.45, 0xe8ecef);
    box('plastic', x - 1, 0.75, z - 0.45, x - 0.5, 0.95, z + 0.45, 0xdfe7f2); // travesseiro
  };
  bed(-17, 1.4);
  bed(-2, -1.4);
  bed(11, 1.4);
  // posto de enfermagem (madeira) e cadeiras azuis
  box('wood', 1.5, 0, 0.75, 4.5, 1.1, 1.5, 0x8f6a45);
  box('wood', 1.5, 1.1, 0.75, 4.5, 1.15, 1.75, 0x7a5a3a);
  box('plastic', -7.5, 0, -1.75, -7, 0.5, -1.25, 0x2f6fb8);
  box('plastic', -6.75, 0, -1.75, -6.25, 0.5, -1.25, 0x2f6fb8);
  box('plastic', 14.5, 0, -1.75, 15, 0.5, -1.25, 0x2f6fb8);
  // suportes de soro
  box('metal', -15.75, 0, -1.75, -15.5, 1.75, -1.5, 0xb8c0c8);
  box('metal', 9.25, 0, 1.5, 9.5, 1.75, 1.75, 0xb8c0c8);

  // ── pátio externo: alguns obstáculos ──
  box('concrete', -12, 0, -10, -8, 1.25, -9.5);
  box('concrete', 6, 0, -12, 10, 1.25, -11.5);
  box('metal', -20, 0, 8, -14, 2.25, 10.5, 0x4f7a3a);
  box('wood', 12, 0, 9, 13.25, 1, 10.25);

  // luzes de teto a cada 5 m; algumas falhando
  const lights = [];
  for (let x = -17.5; x <= 17.5; x += 5) lights.push({ position: { x, y: HEIGHT - 0.05, z: 0 }, flicker: x === -7.5 || x === 12.5 });

  return {
    name: 'Hospital',
    seed: 0,
    size: SIZE,
    wallHeight: 4,
    spawn: { x: 0, y: 0, z: 0 },
    boxes,
    barricades,
    lights,
    environment: 'hospital',
  };
}
