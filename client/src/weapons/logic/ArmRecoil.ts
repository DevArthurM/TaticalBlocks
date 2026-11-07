import type { ArmSpring } from '@shared/weapons/types';

/**
 * "Tensão" entre braço e antebraço: cada disparo empurra o braço (pitch/yaw)
 * e uma mola amortecida o traz de volta à posição inicial.
 * Os ângulos (rad) desviam a arma, as mãos e a direção real do tiro.
 */
export class ArmRecoil {
  /** + = cano para cima. */
  pitch = 0;
  /** + = cano para a esquerda. */
  yaw = 0;
  private vPitch = 0;
  private vYaw = 0;

  /** Aplica o impulso do disparo. `steadiness` < 1 reduz (ex.: mirando). */
  kick(spring: ArmSpring, yawRatio: number, steadiness = 1): void {
    const f = spring.force * steadiness;
    this.vPitch += f * (0.85 + Math.random() * 0.3);
    this.vYaw += f * yawRatio * (Math.random() * 2 - 1);
  }

  update(dt: number, spring: ArmSpring | null): void {
    // sem arma de fogo: volta suave e sem oscilar
    const k = spring?.tension ?? 120;
    const c = spring?.damping ?? 2 * Math.sqrt(k);
    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 240);
      this.vPitch += (-k * this.pitch - c * this.vPitch) * h;
      this.vYaw += (-k * this.yaw - c * this.vYaw) * h;
      this.pitch += this.vPitch * h;
      this.yaw += this.vYaw * h;
      remaining -= h;
    }
    // limite físico do braço (~20°)
    this.pitch = Math.max(-0.35, Math.min(0.35, this.pitch));
    this.yaw = Math.max(-0.25, Math.min(0.25, this.yaw));
  }

  reset(): void {
    this.pitch = this.yaw = this.vPitch = this.vYaw = 0;
  }
}
