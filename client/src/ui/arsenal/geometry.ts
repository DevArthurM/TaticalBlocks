/**
 * Geometria polar do menu radial.
 * Ângulos em graus, 0° = topo, crescendo no sentido horário (coordenadas de tela, y para baixo).
 */
export interface Point {
  x: number;
  y: number;
}

export const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function polar(r: number, deg: number): Point {
  const a = toRad(deg);
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

/** Ângulo (0..360) e raio de um ponto relativo ao centro. */
export function toPolar(dx: number, dy: number): { r: number; deg: number } {
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return { r: Math.hypot(dx, dy), deg };
}

/** `deg` está no intervalo [a0, a1] (a1 pode passar de 360). */
export function inArc(deg: number, a0: number, a1: number): boolean {
  const d = (((deg - a0) % 360) + 360) % 360;
  return d <= a1 - a0;
}

/** Limita `deg` ao arco [a0, a1], aceitando volta em 360. */
export function clampToArc(deg: number, a0: number, a1: number): number {
  if (inArc(deg, a0, a1)) return deg;
  const mid = (a0 + a1) / 2;
  const dist = (x: number) => Math.abs(((((deg - x) % 360) + 540) % 360) - 180);
  return dist(a0) < dist(a1) || dist(mid) > 180 ? a0 : a1;
}

const f = (n: number) => n.toFixed(2);

/** Caminho SVG de um setor anular (anel entre r1 e r2, de a0 até a1). */
export function annularSector(r1: number, r2: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const o0 = polar(r2, a0);
  const o1 = polar(r2, a1);
  const i1 = polar(r1, a1);
  const i0 = polar(r1, a0);
  return [
    `M ${f(o0.x)} ${f(o0.y)}`,
    `A ${f(r2)} ${f(r2)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)}`,
    `L ${f(i1.x)} ${f(i1.y)}`,
    `A ${f(r1)} ${f(r1)} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)}`,
    'Z',
  ].join(' ');
}

/** Caminho SVG de um arco simples (para faixas com stroke grosso). */
export function arcPath(r: number, a0: number, a1: number): string {
  const p0 = polar(r, a0);
  const p1 = polar(r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 >= a0 ? 1 : 0;
  return `M ${f(p0.x)} ${f(p0.y)} A ${f(r)} ${f(r)} 0 ${large} ${sweep} ${f(p1.x)} ${f(p1.y)}`;
}
