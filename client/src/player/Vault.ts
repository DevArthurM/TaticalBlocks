import * as THREE from 'three';
import { type CapsuleBox, intersects } from './Collision';

/** Transpor obstáculos baixos (Espaço de frente para eles). */
export const VAULT = {
  /** Altura máxima do obstáculo, em fração da altura do jogador. */
  maxFraction: 0.6,
  /** Abaixo disto é só um degrau/pulo normal. */
  minHeight: 0.3,
  /** Distância máxima até a face do obstáculo (além do raio). */
  reach: 0.75,
  /** Mais fundo que isto: sobe e fica em cima em vez de passar por cima. */
  maxDepth: 1.6,
  /** Folga acima do topo durante a passagem. */
  clearance: 0.08,
  durationOver: 0.55,
  durationOnto: 0.38,
  /** Altura do corpo (agachado) usada para checar espaço livre acima do obstáculo. */
  bodyHeight: 1.0,
};

const STEP = 0.05;

/**
 * Salto sobre obstáculo: quando o jogador aperta Espaço de frente para algo de até
 * 60% da altura dele, desliza por cima (ou sobe nele, se for fundo) num arco curto,
 * sem colisão durante o movimento.
 */
export class Vault {
  active = false;
  /** 0..1 — andamento (para câmera/animações). */
  progress = 0;
  private t = 0;
  private duration = 0;
  private over = true;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private peak = 0;
  readonly dir = new THREE.Vector3();
  private readonly probe: CapsuleBox;
  private readonly p = new THREE.Vector3();

  constructor(
    private readonly colliders: readonly THREE.Box3[],
    private readonly radius: number,
    private readonly height: number,
  ) {
    this.probe = { position: this.p, radius, height: VAULT.bodyHeight };
  }

  /**
   * Procura um obstáculo baixo à frente (`dir`, horizontal e normalizado) e começa a transpô-lo.
   * @returns true se começou
   */
  tryStart(pos: THREE.Vector3, dir: THREE.Vector3): boolean {
    const maxH = this.height * VAULT.maxFraction;
    // 1) face do obstáculo: primeira coluna ocupada logo à frente
    let s0 = -1;
    let top = 0;
    for (let s = this.radius * 0.5; s <= this.radius + VAULT.reach; s += STEP) {
      const h = this.columnTop(pos.x + dir.x * s, pos.z + dir.z * s, pos.y);
      if (h !== null && h - pos.y > 0.05) {
        s0 = s;
        top = h;
        break;
      }
    }
    if (s0 < 0) return false;
    const rise = top - pos.y;
    if (rise < VAULT.minHeight || rise > maxH) return false;

    // 2) fundo do obstáculo: anda por cima até a coluna baixar
    let s1 = -1;
    let land = pos.y;
    for (let s = s0 + STEP; s <= s0 + VAULT.maxDepth + STEP; s += STEP) {
      const h = this.columnTop(pos.x + dir.x * s, pos.z + dir.z * s, pos.y) ?? pos.y;
      if (h < top - 0.2) {
        s1 = s;
        land = Math.max(pos.y - 1.5, h);
        break;
      }
      // topo irregular (algo mais alto em cima): não passa
      if (h > top + 0.05) return false;
    }
    const over = s1 > 0;
    const endS = over ? s1 + this.radius + 0.1 : s0 + this.radius + 0.15;
    this.to.set(pos.x + dir.x * endS, over ? land : top, pos.z + dir.z * endS);

    // 3) espaço livre: no caminho por cima (corpo agachado) e onde vai parar (corpo inteiro)
    for (let s = s0; s <= endS; s += 0.15) {
      this.p.set(pos.x + dir.x * s, top + 0.02, pos.z + dir.z * s);
      if (this.colliders.some((b) => intersects(this.probe, b))) return false;
    }
    this.p.copy(this.to).setY(this.to.y + 0.01);
    const full: CapsuleBox = { position: this.p, radius: this.radius, height: this.height };
    if (this.colliders.some((b) => intersects(full, b))) return false;

    this.from.copy(pos);
    this.dir.copy(dir);
    this.over = over;
    this.peak = top + VAULT.clearance;
    this.duration = over ? VAULT.durationOver : VAULT.durationOnto;
    this.t = 0;
    this.progress = 0;
    this.active = true;
    return true;
  }

  /** Avança o movimento e escreve a posição dos pés. @returns true no quadro em que termina */
  update(dt: number, pos: THREE.Vector3): boolean {
    if (!this.active) return false;
    this.t = Math.min(this.duration, this.t + dt);
    const k = this.t / this.duration;
    this.progress = k;
    const horiz = k * k * (3 - 2 * k) * 0.35 + k * 0.65; // começa rápido e chega macio
    pos.x = THREE.MathUtils.lerp(this.from.x, this.to.x, horiz);
    pos.z = THREE.MathUtils.lerp(this.from.z, this.to.z, horiz);
    // sobe rápido até o topo, desliza por cima e desce (ou fica em cima)
    const up = Math.min(1, k / 0.35);
    let y = THREE.MathUtils.lerp(this.from.y, this.peak, 1 - (1 - up) * (1 - up));
    if (this.over && k > 0.62) {
      const d = (k - 0.62) / 0.38;
      y = THREE.MathUtils.lerp(this.peak, this.to.y, d * d);
    } else if (!this.over && k > 0.6) {
      y = THREE.MathUtils.lerp(this.peak, this.to.y, (k - 0.6) / 0.4);
    }
    pos.y = y;
    if (k >= 1) {
      this.active = false;
      pos.copy(this.to);
      return true;
    }
    return false;
  }

  /** Câmera: abaixa e inclina um pouco no meio do movimento. */
  get cameraDip(): number {
    return this.active ? Math.sin(this.progress * Math.PI) : 0;
  }

  /** Topo da pilha de colisores que ocupa a coluna (x, z) a partir dos pés; null se vazia. */
  private columnTop(x: number, z: number, feetY: number): number | null {
    let top: number | null = null;
    // empilhados: sobe enquanto houver caixa encostando no topo atual
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      const base = top ?? feetY + 0.02;
      for (const b of this.colliders) {
        if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
        if (b.min.y > base + 0.02 || b.max.y <= (top ?? feetY + 0.02)) continue;
        if (top === null || b.max.y > top) {
          top = b.max.y;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return top;
  }
}
