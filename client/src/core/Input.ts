/** Teclado + mouse com Pointer Lock. Estados "pressed" valem por um único frame. */
export class Input {
  mouseDX = 0;
  mouseDY = 0;
  /** Passos da roda do mouse neste frame (+ = para baixo). */
  wheel = 0;
  locked = false;

  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly lockListeners: Array<(locked: boolean) => void> = [];

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.down.clear());
    element.addEventListener('click', () => {
      if (!this.locked) void element.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    });
  }

  onLockChange(listener: (locked: boolean) => void): void {
    this.lockListeners.push(listener);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Deve ser chamado ao fim de cada frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.locked) return;
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    const code = `Mouse${e.button}`;
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`);
  };

  private readonly handleLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) this.down.clear();
    this.lockListeners.forEach((l) => l(this.locked));
  };
}

export const KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  reload: 'KeyR',
  lastWeapon: 'KeyX',
  leanLeft: 'KeyQ',
  leanRight: 'KeyE',
  loadout: 'KeyB',
  fire: 'Mouse0',
  aim: 'Mouse2',
} as const;
