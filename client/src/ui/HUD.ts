import { TIERS } from '@shared/weapons/categories';
import type { Tier } from '@shared/weapons/types';
import type { DataSource } from '../shared/types';

export interface SlotView {
  key: number;
  name: string | null;
  tier: Tier | null;
  active: boolean;
  extra?: string;
}

export interface HudState {
  weaponName: string;
  tier: Tier | null;
  mode: string;
  /** null = sem munição (arma branca). */
  ammo: number | null;
  magazineSize: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  crosshairGap: number;
  /** Deslocamento da mira em px (recuo do braço). */
  aimOffset: [number, number];
  aiming: boolean;
  sprinting: boolean;
  scoped: boolean;
  spin: number | null;
  slots: SlotView[];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
};

/** HUD em DOM: mira, slots, munição, luneta, clarão e tela de pausa. */
export class HUD {
  private readonly crosshair: HTMLDivElement;
  private readonly ammoBox: HTMLDivElement;
  private readonly weaponName: HTMLDivElement;
  private readonly modeText: HTMLSpanElement;
  private readonly magText: HTMLSpanElement;
  private readonly sepText: HTMLSpanElement;
  private readonly reserveText: HTMLSpanElement;
  private readonly bullets: HTMLDivElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly reloadBar: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly slotList: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly scope: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly spinBar: HTMLDivElement;
  private blind = 0;
  private lastAmmoKey = '';
  private lastSlotsKey = '';
  private bulletCount = -1;
  private ammoFlags = '';

  constructor(container: HTMLElement) {
    const root = el('div', 'hud', container);
    this.scope = el('div', 'scope', root);
    this.scope.innerHTML = '<div class="scope-lens"><i class="h"></i><i class="v"></i><i class="dot"></i></div>';
    this.flash = el('div', 'blind', root);

    this.crosshair = el('div', 'crosshair', root);
    for (const dir of ['top', 'bottom', 'left', 'right']) el('span', `ch ch-${dir}`, this.crosshair);
    el('span', 'ch-dot', this.crosshair);

    this.slotList = el('div', 'slots', root);

    this.ammoBox = el('div', 'ammo', root);
    const head = el('div', 'ammo-head', this.ammoBox);
    this.weaponName = el('div', 'ammo-weapon', head);
    this.modeText = el('span', 'ammo-mode', head);
    const count = el('div', 'ammo-count', this.ammoBox);
    this.magText = el('span', 'ammo-mag', count);
    this.sepText = el('span', 'ammo-sep', count);
    this.reserveText = el('span', 'ammo-reserve', count);
    this.bullets = el('div', 'ammo-bullets', this.ammoBox);
    this.spinBar = el('div', 'spin-bar', this.ammoBox);
    el('i', '', this.spinBar);
    this.reloadBar = el('div', 'reload-bar', this.ammoBox);
    this.reloadFill = el('div', 'reload-fill', this.reloadBar);
    this.hint = el('div', 'ammo-hint', this.ammoBox);

    this.status = el('div', 'status', root);
    el('div', 'arsenal-hint', root).innerHTML = '<kbd>B</kbd> Arsenal';

    this.overlay = el('div', 'overlay', root);
    this.overlay.innerHTML = `
      <div class="overlay-card">
        <h1>CAMPO DE TESTES</h1>
        <p class="overlay-sub">Clique para jogar</p>
        <ul class="controls">
          <li><kbd>W A S D</kbd> mover</li>
          <li><kbd>Shift</kbd> correr</li>
          <li><kbd>Espaço</kbd> pular</li>
          <li><kbd>Mouse esq.</kbd> atirar / golpear / arremessar</li>
          <li><kbd>Mouse dir.</kbd> mirar</li>
          <li><kbd>R</kbd> recarregar</li>
          <li><kbd>1 2 3 4</kbd> trocar arma</li>
          <li><kbd>Roda / X</kbd> próxima / última</li>
          <li><kbd>Q / E</kbd> inclinar</li>
          <li><kbd>B</kbd> arsenal</li>
          <li><kbd>Esc</kbd> pausar</li>
        </ul>
        <p class="overlay-note">Balas infinitas nesta fase de teste</p>
      </div>`;
  }

  setPaused(paused: boolean): void {
    this.overlay.classList.toggle('hidden', !paused);
  }

  setStatus(mapName: string, source: DataSource): void {
    const label = source === 'server' ? 'servidor online' : 'offline — dados locais';
    this.status.innerHTML = `<b>${mapName}</b> · <span class="${source}">${label}</span>`;
  }

  /** Granada de atordoamento. */
  addBlind(amount: number): void {
    this.blind = Math.min(1.6, this.blind + amount * 1.6);
  }

  update(s: HudState, dt: number): void {
    this.blind = Math.max(0, this.blind - dt * 0.45);
    this.flash.style.opacity = String(Math.min(1, this.blind));

    this.scope.classList.toggle('on', s.scoped);
    this.crosshair.style.setProperty('--gap', `${Math.round(s.crosshairGap)}px`);
    this.crosshair.style.transform = `translate(${s.aimOffset[0].toFixed(1)}px, ${s.aimOffset[1].toFixed(1)}px)`;
    this.crosshair.classList.toggle('hidden', s.aiming || s.sprinting || s.scoped);

    const slotsKey = s.slots.map((x) => `${x.name}|${x.active}|${x.extra ?? ''}`).join(';');
    if (slotsKey !== this.lastSlotsKey) {
      this.lastSlotsKey = slotsKey;
      this.slotList.innerHTML = s.slots
        .map(
          (x) => `<div class="slot ${x.active ? 'active' : ''} ${x.name ? '' : 'empty'} ${x.tier ? `tier-${x.tier}` : ''}">
            <kbd>${x.key}</kbd><span>${x.name ?? '—'}</span>${x.extra ? `<em>${x.extra}</em>` : ''}</div>`,
        )
        .join('');
    }

    this.weaponName.textContent = s.weaponName.toUpperCase();
    this.weaponName.title = s.tier ? TIERS[s.tier].label : '';
    this.modeText.textContent = s.mode;

    const key = `${s.weaponName}|${s.ammo}|${s.reserve}|${s.reloading}`;
    if (key !== this.lastAmmoKey) {
      this.lastAmmoKey = key;
      const melee = s.ammo === null;
      this.magText.textContent = melee ? '—' : String(s.ammo);
      this.sepText.textContent = melee ? '' : '/';
      this.reserveText.textContent = melee ? '' : Number.isFinite(s.reserve) ? String(s.reserve) : '∞';
      this.renderBullets(melee ? 0 : s.magazineSize, s.ammo ?? 0);
      const low = !melee && s.ammo! <= Math.ceil(s.magazineSize * 0.25);
      this.ammoFlags = `${low && !s.reloading ? 'low' : ''} ${s.ammo === 0 && !s.reloading ? 'empty' : ''}`;
      this.hint.textContent = s.reloading ? 'RECARREGANDO' : s.ammo === 0 ? 'SEM MUNIÇÃO — [R]' : low ? '[R] RECARREGAR' : '';
    }
    this.ammoBox.className = `ammo ${s.tier ? `tier-${s.tier}` : ''} ${this.ammoFlags}`;
    this.reloadBar.classList.toggle('active', s.reloading);
    this.reloadFill.style.transform = `scaleX(${s.reloading ? s.reloadProgress : 0})`;
    this.spinBar.classList.toggle('active', s.spin !== null);
    (this.spinBar.firstChild as HTMLElement).style.transform = `scaleX(${s.spin ?? 0})`;
  }

  private renderBullets(size: number, ammo: number): void {
    const icons = size > 0 && size <= 50;
    if (this.bulletCount !== size) {
      this.bulletCount = size;
      this.bullets.innerHTML = icons ? '<i class="bullet"></i>'.repeat(size) : '';
      this.bullets.classList.toggle('dense', size > 20);
    }
    if (icons) Array.from(this.bullets.children).forEach((b, i) => b.classList.toggle('spent', i >= ammo));
  }
}
