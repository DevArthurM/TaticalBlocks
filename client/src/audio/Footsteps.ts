import type { SoundName } from './SoundEngine';

/** Alcance (m) em que os passos de outro jogador são ouvidos. */
export const STEP_RANGE = { crouch: 12, walk: 32, run: 48 } as const;

/**
 * Cadência de passos pela distância percorrida no chão: a passada cresce com a
 * velocidade (agachado ~0,6 s por passo, andando ~0,45 s, correndo ~0,33 s).
 */
export class Footsteps {
  private dist = 0;

  /**
   * @returns o som do passo que caiu neste quadro (ou null)
   */
  update(dt: number, speed: number, onGround: boolean, sprinting: boolean): SoundName | null {
    if (!onGround || speed < 0.6) {
      // parado: o próximo passo sai logo que voltar a andar
      this.dist = Math.max(this.dist, 0.7);
      return null;
    }
    this.dist += speed * dt;
    const stride = 1.2 + speed * 0.17;
    if (this.dist < stride) return null;
    this.dist -= stride;
    return sprinting ? 'stepRun' : 'step';
  }
}
