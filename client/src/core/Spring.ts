/** Mola amortecida (usada para recuo, aterrissagem etc.). */
export class Spring {
  value = 0;
  velocity = 0;

  constructor(
    public stiffness = 300,
    public damping = 24,
  ) {}

  impulse(v: number): void {
    this.velocity += v;
  }

  update(dt: number): void {
    // Sub-passos fixos para estabilidade com dt variável.
    const step = 1 / 240;
    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(step, remaining);
      const accel = -this.stiffness * this.value - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
  }
}

/**
 * Mola que persegue um alvo (2ª ordem): atrasa, passa um pouco do ponto e assenta.
 * `zeta` < 1 dá a ultrapassagem; `omega` (rad/s) é a rapidez da resposta.
 */
export class Follow {
  value = 0;
  velocity = 0;

  constructor(
    public omega = 12,
    public zeta = 0.6,
  ) {}

  update(target: number, dt: number): number {
    const k = this.omega * this.omega;
    const c = 2 * this.zeta * this.omega;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0) {
      const h = Math.min(1 / 240, remaining);
      this.velocity += (k * (target - this.value) - c * this.velocity) * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    return this.value;
  }

  reset(v = 0): void {
    this.value = v;
    this.velocity = 0;
  }
}
