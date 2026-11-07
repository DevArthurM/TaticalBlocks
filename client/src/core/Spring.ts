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
