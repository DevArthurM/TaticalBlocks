import * as THREE from 'three';

/** Lado de cada célula da grade de navegação (m). */
const CELL = 0.5;
/** Folga em volta dos obstáculos (raio do zumbi). */
const RADIUS = 0.3;
/** Obstáculo = algo entre estas alturas (passa por cima de degraus baixos e por baixo de tetos). */
const STEP = 0.45;
const HEAD = 1.7;
/** Intervalo mínimo entre recálculos do campo (s). */
const FIELD_EVERY = 0.25;
/** A cada quanto tempo confere se o mapa mudou (destruição) para refazer a grade (s). */
const GRID_CHECK = 1;

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * IA de caminho dos zumbis: grade do mapa com o que bloqueia a passagem e um
 * **campo de fluxo** — a distância de caminho mais curta de cada célula até o
 * jogador (Dijkstra a partir dele, contornando paredes e obstáculos). Cada zumbi só
 * consulta a sua célula e segue para a vizinha mais perto do jogador; um único
 * cálculo serve a todos. A grade é refeita quando o mapa é destruído.
 */
export class NavGrid {
  private readonly n: number;
  private readonly half: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Float32Array;
  private readonly heap: Int32Array;
  private heapSize = 0;
  private signature = '';
  private gridTimer = 0;
  private fieldTimer = 0;
  private targetKey = '';
  private dirty = true;

  constructor(
    mapSize: number,
    private readonly colliders: readonly THREE.Box3[],
  ) {
    this.n = Math.ceil(mapSize / CELL);
    this.half = (this.n * CELL) / 2;
    const count = this.n * this.n;
    this.blocked = new Uint8Array(count);
    this.dist = new Float32Array(count).fill(Infinity);
    this.heap = new Int32Array(count * 8);
    this.rebuild();
  }

  /**
   * Atualiza grade (se o mapa mudou) e o campo até os alvos (se algum mudou de
   * célula). Vários alvos (online): o campo leva ao jogador mais perto pelo caminho.
   */
  update(dt: number, targets: readonly THREE.Vector3[]): void {
    this.gridTimer -= dt;
    if (this.gridTimer <= 0) {
      this.gridTimer = GRID_CHECK;
      const sig = this.colliderSignature();
      if (sig !== this.signature) this.rebuild();
    }
    this.fieldTimer -= dt;
    const cells = targets.map((t) => this.nearestFree(this.cellOf(t.x, t.z))).filter((c) => c >= 0);
    if (!cells.length) return;
    const key = cells.join(',');
    if ((key !== this.targetKey || this.dirty) && this.fieldTimer <= 0) {
      this.fieldTimer = FIELD_EVERY;
      this.targetKey = key;
      this.dirty = false;
      this.computeField(cells);
    }
  }

  /**
   * Direção (x, z normalizada) do menor caminho até o jogador a partir de `pos`.
   * Se houver linha reta livre até o jogador, vai direto. Devolve false se não souber.
   */
  steer(pos: THREE.Vector3, target: THREE.Vector3, out: THREE.Vector3): boolean {
    if (this.clearLine(pos.x, pos.z, target.x, target.z)) {
      out.set(target.x - pos.x, 0, target.z - pos.z);
      const l = out.length();
      if (l < 1e-4) return false;
      out.multiplyScalar(1 / l);
      return true;
    }
    let c = this.cellOf(pos.x, pos.z);
    if (c < 0) return false;
    // dentro de algo (empurrado contra parede): usa a célula livre mais próxima
    if (this.blocked[c] || !Number.isFinite(this.dist[c])) c = this.nearestReachable(c);
    if (c < 0) return false;
    // segue pelo campo algumas células e mira a mais distante ainda visível (curvas suaves)
    let best = c;
    let cur = c;
    for (let step = 0; step < 6; step++) {
      const next = this.downhill(cur);
      if (next < 0 || next === cur) break;
      cur = next;
      const [cx, cz] = this.center(cur);
      if (this.clearLine(pos.x, pos.z, cx, cz)) best = cur;
      else break;
    }
    if (best === c) {
      const next = this.downhill(c);
      if (next < 0) return false;
      best = next;
    }
    const [bx, bz] = this.center(best);
    out.set(bx - pos.x, 0, bz - pos.z);
    const l = out.length();
    if (l < 1e-4) return false;
    out.multiplyScalar(1 / l);
    return true;
  }

  /** Distância de caminho (m) de `pos` até o jogador (Infinity se não houver caminho). */
  pathDistance(pos: THREE.Vector3): number {
    const c = this.cellOf(pos.x, pos.z);
    return c < 0 ? Infinity : this.dist[c];
  }

  // ───────────── grade ─────────────

  private colliderSignature(): string {
    let h = this.colliders.length;
    for (const b of this.colliders) h = (h * 31 + Math.round((b.min.x + b.max.y * 7 + b.max.z * 13) * 100)) | 0;
    return String(h);
  }

  private rebuild(): void {
    this.signature = this.colliderSignature();
    this.blocked.fill(0);
    const n = this.n;
    for (const b of this.colliders) {
      if (b.max.y < STEP || b.min.y > HEAD) continue;
      const x0 = Math.max(0, Math.floor((b.min.x - RADIUS + this.half) / CELL));
      const x1 = Math.min(n - 1, Math.floor((b.max.x + RADIUS + this.half) / CELL));
      const z0 = Math.max(0, Math.floor((b.min.z - RADIUS + this.half) / CELL));
      const z1 = Math.min(n - 1, Math.floor((b.max.z + RADIUS + this.half) / CELL));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.blocked[z * n + x] = 1;
    }
    this.dirty = true;
  }

  private cellOf(x: number, z: number): number {
    const ix = Math.floor((x + this.half) / CELL);
    const iz = Math.floor((z + this.half) / CELL);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }

  private center(c: number): [number, number] {
    const x = c % this.n;
    const z = Math.floor(c / this.n);
    return [-this.half + (x + 0.5) * CELL, -this.half + (z + 0.5) * CELL];
  }

  /** Célula livre mais próxima (busca em anéis). */
  private nearestFree(c: number): number {
    if (c < 0 || !this.blocked[c]) return c;
    return this.ringSearch(c, (i) => !this.blocked[i]);
  }

  private nearestReachable(c: number): number {
    return this.ringSearch(c, (i) => !this.blocked[i] && Number.isFinite(this.dist[i]));
  }

  private ringSearch(c: number, ok: (i: number) => boolean): number {
    const n = this.n;
    const cx = c % n;
    const cz = Math.floor(c / n);
    for (let r = 1; r < 8; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const i = z * n + x;
          if (ok(i)) return i;
        }
    return -1;
  }

  /** Vizinha com menor distância (sem cortar quinas de obstáculos). */
  private downhill(c: number): number {
    const n = this.n;
    const x = c % n;
    const z = Math.floor(c / n);
    let best = -1;
    let bestD = this.dist[c];
    for (const [dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const i = nz * n + nx;
      if (this.blocked[i]) continue;
      if (dx && dz && (this.blocked[z * n + nx] || this.blocked[nz * n + x])) continue;
      if (this.dist[i] < bestD) {
        bestD = this.dist[i];
        best = i;
      }
    }
    return best;
  }

  /** Linha reta livre na grade entre dois pontos (amostrada a cada 1/4 de célula). */
  private clearLine(x0: number, z0: number, x1: number, z1: number): boolean {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(len / (CELL * 0.25));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const c = this.cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (c < 0 || this.blocked[c]) return false;
    }
    return true;
  }

  // ───────────── campo de fluxo (Dijkstra a partir do jogador) ─────────────

  private computeField(starts: number[]): void {
    const n = this.n;
    const dist = this.dist;
    dist.fill(Infinity);
    this.heapSize = 0;
    for (const s of starts) {
      dist[s] = 0;
      this.push(s);
    }
    while (this.heapSize) {
      const c = this.pop();
      const d = dist[c];
      const x = c % n;
      const z = Math.floor(c / n);
      for (const [dx, dz, cost] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const i = nz * n + nx;
        if (this.blocked[i]) continue;
        // diagonal só se as duas laterais estiverem livres (não corta quina)
        if (dx && dz && (this.blocked[z * n + nx] || this.blocked[nz * n + x])) continue;
        const nd = d + cost * CELL;
        if (nd < dist[i]) {
          dist[i] = nd;
          this.push(i);
        }
      }
    }
  }

  // heap binário mínimo por distância (entradas repetidas são toleradas)
  private push(c: number): void {
    if (this.heapSize >= this.heap.length) return;
    const h = this.heap;
    const d = this.dist;
    let i = this.heapSize++;
    h[i] = c;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[h[p]] <= d[h[i]]) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }

  private pop(): number {
    const h = this.heap;
    const d = this.dist;
    const top = h[0];
    h[0] = h[--this.heapSize];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.heapSize && d[h[l]] < d[h[m]]) m = l;
      if (r < this.heapSize && d[h[r]] < d[h[m]]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
    return top;
  }
}
