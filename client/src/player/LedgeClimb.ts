import * as THREE from 'three';
import { clamp, easeOutCubic, smoothRange } from '../core/math';
import { type CapsuleBox, intersects } from './Collision';

export type LedgePhase = 'hang' | 'climb';

export interface Ledge {
  /** Altura do topo da superfície. */
  top: number;
  /** Ponto da quina mais próximo do jogador (y = topo). */
  edge: THREE.Vector3;
  /** Normal horizontal da parede (aponta da parede para o jogador). */
  normal: THREE.Vector3;
}

export interface LedgeInput {
  holdingJump: boolean;
  forward: boolean;
  back: boolean;
}

export type LedgeEvent = 'hang' | 'climb' | 'released' | 'done';

/** Ajustes da escalada. */
export const CLIMB = {
  /** Quina mais baixa que pode ser agarrada, acima dos pés (m). */
  minHeight: 0.75,
  /** Alcance das mãos acima dos pés (m). */
  reach: 2.3,
  /** Distância horizontal máxima até a parede, além do raio do corpo. */
  grabDistance: 0.45,
  /** Olhos ficam esta altura acima da quina quando pendurado (dá para espiar o topo). */
  eyeAboveLedge: 0.08,
  /** Duração da subida (s). */
  climbTime: 0.75,
  /** Tempo de encaixe na posição pendurada (s). */
  snapTime: 0.12,
  /** Espera após soltar antes de poder agarrar de novo (s). */
  regrabDelay: 0.35,
} as const;

/**
 * Agarrar quinas e escalar: detecta uma borda alcançável à frente com espaço livre em
 * cima, prende o jogador nela e faz a subida (puxar para cima → passar por cima da borda).
 */
export class LedgeClimb {
  phase: LedgePhase | null = null;
  ledge: Ledge | null = null;
  /** 0..1 durante a subida. */
  progress = 0;

  private cooldown = 0;
  private snap = 0;
  private readonly start = new THREE.Vector3();
  private readonly hang = new THREE.Vector3();
  private readonly finish = new THREE.Vector3();
  private readonly probe: CapsuleBox;
  private readonly probePos = new THREE.Vector3();

  constructor(
    private readonly colliders: readonly THREE.Box3[],
    private readonly radius: number,
    height: number,
    private readonly eyeHeight: number,
  ) {
    this.probe = { position: this.probePos, radius: radius - 0.02, height };
  }

  /** Inclinação da câmera para baixo durante a subida (rad). */
  get cameraDip(): number {
    return this.phase === 'climb' ? Math.sin(this.progress * Math.PI) * 0.14 : 0;
  }

  tick(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /** Procura uma quina à frente do jogador que dê para agarrar e subir. */
  find(pos: THREE.Vector3, yaw: number): Ledge | null {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best: Ledge | null = null;
    let bestDist = Infinity;

    for (const b of this.colliders) {
      const top = b.max.y;
      if (top < pos.y + CLIMB.minHeight || top > pos.y + CLIMB.reach) continue;

      // ponto da "pegada" na borda mais próxima do jogador
      const cx = clamp(pos.x, b.min.x, b.max.x);
      const cz = clamp(pos.z, b.min.z, b.max.z);
      const dx = cx - pos.x;
      const dz = cz - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-4 || dist > this.radius + CLIMB.grabDistance) continue;
      // precisa estar à frente (cone de ~60°)
      if ((dx * fx + dz * fz) / dist < 0.5) continue;

      // normal da face (caixas alinhadas aos eixos)
      const normal = Math.abs(dx) > Math.abs(dz) ? new THREE.Vector3(-Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, -Math.sign(dz));
      const edge = new THREE.Vector3(cx, top, cz);

      // espaço livre para ficar em pé em cima, logo depois da borda
      this.probePos.set(edge.x - normal.x * (this.radius + 0.12), top + 0.01, edge.z - normal.z * (this.radius + 0.12));
      if (this.colliders.some((o) => intersects(this.probe, o))) continue;

      if (dist < bestDist) {
        bestDist = dist;
        best = { top, edge, normal };
      }
    }
    return best;
  }

  /** No ar, segurando pular: tenta agarrar. */
  tryGrab(pos: THREE.Vector3, vel: THREE.Vector3, yaw: number, holdingJump: boolean): boolean {
    if (this.phase || this.cooldown > 0 || !holdingJump || vel.y > 3) return false;
    const ledge = this.find(pos, yaw);
    if (!ledge) return false;
    this.ledge = ledge;
    this.phase = 'hang';
    this.snap = 0;
    this.start.copy(pos);
    const off = this.radius + 0.03;
    this.hang.set(
      ledge.edge.x + ledge.normal.x * off,
      ledge.top + CLIMB.eyeAboveLedge - this.eyeHeight,
      ledge.edge.z + ledge.normal.z * off,
    );
    return true;
  }

  /** Avança pendurar/subir e escreve a posição do jogador em `pos`. */
  update(dt: number, input: LedgeInput, pos: THREE.Vector3): LedgeEvent {
    const ledge = this.ledge!;
    if (this.phase === 'hang') {
      this.snap = Math.min(1, this.snap + dt / CLIMB.snapTime);
      pos.lerpVectors(this.start, this.hang, easeOutCubic(this.snap));

      if (!input.holdingJump || input.back) {
        this.release(pos);
        return 'released';
      }
      if (input.forward && this.snap >= 1) {
        this.phase = 'climb';
        this.progress = 0;
        this.start.copy(pos);
        const off = this.radius + 0.18;
        this.finish.set(ledge.edge.x - ledge.normal.x * off, ledge.top + 0.001, ledge.edge.z - ledge.normal.z * off);
        return 'climb';
      }
      return 'hang';
    }

    // subida: 0–60% puxa para cima, 45–100% passa por cima da borda
    this.progress = Math.min(1, this.progress + dt / CLIMB.climbTime);
    const p = this.progress;
    const up = easeOutCubic(smoothRange(0, 0.6, p));
    const over = smoothRange(0.45, 1, p);
    pos.x = this.start.x + (this.finish.x - this.start.x) * over;
    pos.z = this.start.z + (this.finish.z - this.start.z) * over;
    pos.y = this.start.y + (this.finish.y + 0.04 - this.start.y) * up - 0.04 * smoothRange(0.8, 1, p);
    if (p >= 1) {
      pos.copy(this.finish);
      this.phase = null;
      this.ledge = null;
      return 'done';
    }
    return 'climb';
  }

  /** Pontos das duas mãos na quina (espaço do mundo). */
  handPoints(left: THREE.Vector3, right: THREE.Vector3): boolean {
    const l = this.ledge;
    if (!l) return false;
    // lateral ao longo da borda; olhando para a parede (-normal), (−nz, nx) aponta para a esquerda
    const sx = -l.normal.z;
    const sz = l.normal.x;
    const inset = 0.06;
    for (const [out, side] of [
      [left, 1],
      [right, -1],
    ] as const) {
      out.set(l.edge.x + sx * side * 0.24 - l.normal.x * inset, l.top + 0.03, l.edge.z + sz * side * 0.24 - l.normal.z * inset);
    }
    return true;
  }

  private release(pos: THREE.Vector3): void {
    // afasta um pouco da parede para não agarrar de novo na hora
    if (this.ledge) pos.addScaledVector(this.ledge.normal, 0.05);
    this.phase = null;
    this.ledge = null;
    this.cooldown = CLIMB.regrabDelay;
  }
}
