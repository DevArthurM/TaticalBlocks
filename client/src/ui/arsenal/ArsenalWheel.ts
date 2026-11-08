import { CATEGORIES, SLOT_LABELS, TIERS } from '@shared/weapons/categories';
import { type Loadout, MAX_GRENADES } from '@shared/weapons/loadout';
import type { WeaponCategory, WeaponDef } from '@shared/weapons/types';
import { statBars, weaponTags } from '../weaponStats';
import './arsenal.css';
import { annularSector, arcPath, inArc, polar, toPolar } from './geometry';

type RingSlot = 'primary' | 'secondary' | 'melee';

/** Setores do anel (graus, 0 = topo, sentido horário). */
const SECTORS: Record<RingSlot, { a0: number; a1: number }> = {
  secondary: { a0: 0, a1: 143 },
  melee: { a0: 143, a1: 217 },
  primary: { a0: 217, a1: 360 },
};
const RING_ORDER: RingSlot[] = ['primary', 'secondary', 'melee'];

/**
 * Onde cada slot ancora seus arcos (sempre a mesma posição) e para que lado crescem.
 * 1 = horário, -1 = anti-horário — sempre em direção ao topo da tela.
 */
const BAND_ANCHOR: Record<RingSlot, { deg: number; dir: 1 | -1 }> = {
  primary: { deg: 252, dir: 1 },
  secondary: { deg: 108, dir: -1 },
  melee: { deg: 240, dir: 1 },
};
const GAP = 1.4;

/** Medidas base (px) — escaladas pelo tamanho da tela. */
const BASE = {
  r1: 92,
  r2: 232,
  bandGap: 34,
  bandWidth: 74,
  circle: 60,
  slotGif: 66,
  throwY: 300,
};

const gifUrl = (id: string) => `/weapons/gifs/${id}.gif`;
/** GIFs já baixados e decodificados (trocar de lista não pisca esperando imagem). */
const gifCache = new Map<string, HTMLImageElement>();
function preloadGifs(ids: Iterable<string>): void {
  for (const id of ids) {
    if (gifCache.has(id)) continue;
    const img = new Image();
    img.src = gifUrl(id);
    img.decode().catch(() => {});
    gifCache.set(id, img);
  }
}
const gifCircle = (id: string, extra = '') =>
  `<span class="aw-gif ${extra}"><img src="${gifUrl(id)}" alt="" draggable="false" onerror="this.style.visibility='hidden'" /></span>`;

/**
 * Menu radial de armas (tecla B): anel com primária/secundária/branca,
 * bolinha que orbita o anel e abre arcos de categorias → armas, e linha de arremessáveis.
 */
export class ArsenalWheel {
  onChange: (loadout: Loadout) => void = () => {};

  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private s = 1;
  private openState = false;
  private closeTimer = 0;
  private statusText = '';

  private hoverSlot: RingSlot | null = null;
  private band: { slot: RingSlot; deg: number; dir: 1 | -1; category: WeaponCategory | null; catDeg: number } | null = null;
  private throwPicker = false;

  constructor(
    container: HTMLElement,
    private catalog: readonly WeaponDef[],
    private loadout: Loadout,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'arsenal-wheel';
    this.root.innerHTML = '<div class="aw-stage"></div><div class="aw-status"></div>';
    this.stage = this.root.querySelector('.aw-stage')!;
    container.appendChild(this.root);

    this.root.addEventListener('mousemove', this.onMove);
    this.root.addEventListener('mouseover', this.onOver);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.openState && this.build());
    preloadGifs(catalog.map((w) => w.id));
  }

  get isOpen(): boolean {
    return this.openState;
  }

  setOpen(open: boolean): void {
    if (open === this.openState) return;
    this.openState = open;
    clearTimeout(this.closeTimer);
    if (open) {
      this.root.classList.remove('closing');
      this.root.classList.add('visible');
      this.build();
    } else {
      this.root.classList.add('closing');
      this.closeTimer = window.setTimeout(() => this.root.classList.remove('visible', 'closing'), 170);
    }
  }

  setLoadout(loadout: Loadout): void {
    this.loadout = loadout;
    if (this.openState) {
      this.renderSlots(false);
      this.renderThrowables(false);
    }
  }

  setCatalog(catalog: readonly WeaponDef[]): void {
    this.catalog = catalog;
    preloadGifs(catalog.map((w) => w.id));
  }

  setStatus(text: string): void {
    this.statusText = text;
    (this.root.querySelector('.aw-status') as HTMLElement).textContent = text;
  }

  // ═════════════════════ construção ═════════════════════

  private get px() {
    const s = this.s;
    return {
      r1: BASE.r1 * s,
      r2: BASE.r2 * s,
      circle: BASE.circle * s,
      slotGif: BASE.slotGif * s,
      bandR1: (BASE.r2 + BASE.bandGap + BASE.bandWidth / 2) * s,
      bandR2: (BASE.r2 + BASE.bandGap * 2 + BASE.bandWidth * 1.5) * s,
      bandWidth: BASE.bandWidth * s,
      throwY: BASE.throwY * s,
    };
  }

  /** Monta o menu do zero (dispara as animações de entrada). */
  private build(): void {
    const extent = BASE.r2 + BASE.bandGap * 2 + BASE.bandWidth * 1.5 + BASE.circle / 2 + 12;
    this.s = Math.max(0.5, Math.min(1.15, Math.min(window.innerWidth, window.innerHeight) / (extent * 2)));
    this.root.classList.toggle('compact', this.s < 0.95);
    this.hoverSlot = null;
    this.band = null;
    this.throwPicker = false;
    const { r1, r2 } = this.px;
    const size = r2 * 2 + 4;

    const sectors = RING_ORDER.map((slot, i) => {
      const { a0, a1 } = SECTORS[slot];
      return `<path class="aw-sector" data-ring="${slot}" style="--d:${60 + i * 55}ms" d="${annularSector(r1, r2, a0 + GAP, a1 - GAP)}" />`;
    }).join('');

    this.stage.innerHTML = `
      <svg class="aw-ring" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}">
        <circle class="aw-ring-glow" r="${r2 + 2}" />
        ${sectors}
      </svg>
      <div class="aw-piece aw-center" style="--x:0px;--y:0px;--d:0ms;width:${r1 * 2 - 14}px;height:${r1 * 2 - 14}px"></div>
      <div class="aw-slots"></div>
      <div class="aw-throw"></div>
      <div class="aw-throw-picker"></div>
      <div class="aw-bands"></div>`;
    this.renderSlots();
    this.renderThrowables();
    this.renderCenter(null);
    this.setStatus(this.statusText);
  }

  private renderSlots(animate = true): void {
    const { r1, r2, slotGif } = this.px;
    const host = this.stage.querySelector('.aw-slots')!;
    host.classList.toggle('static', !animate);
    host.innerHTML = RING_ORDER.map((slot, i) => {
      const { a0, a1 } = SECTORS[slot];
      const p = polar((r1 + r2) / 2, (a0 + a1) / 2);
      const def = this.find(this.loadout[slot]);
      const tier = def ? `tier-${def.tier}` : '';
      return `<div class="aw-piece aw-slot ${tier}" style="--x:${p.x}px;--y:${p.y}px;--d:${180 + i * 60}ms;--g:${slotGif}px">
        <span class="aw-slot-label">${SLOT_LABELS[slot]}</span>
        ${def ? gifCircle(def.id, 'aw-slot-gif') : '<span class="aw-gif aw-slot-gif aw-empty"></span>'}
        <span class="aw-slot-name">${def?.name ?? '—'}</span>
      </div>`;
    }).join('');
  }

  private get throwSlotX(): number {
    const { circle } = this.px;
    const sq = circle * 0.72;
    return -((sq + 8 * this.s) * MAX_GRENADES) / 2 - circle * 0.2;
  }

  private renderThrowables(animate = true): void {
    const { throwY, circle } = this.px;
    const host = this.stage.querySelector('.aw-throw')!;
    host.classList.toggle('static', !animate);
    const g = this.loadout.grenade;
    const def = this.find(g.type);
    const sq = circle * 0.72;
    const slotX = this.throwSlotX;
    let html = `<div class="aw-piece aw-throw-slot ${def ? `tier-${def.tier}` : ''}" data-throw-slot style="--x:${slotX}px;--y:${throwY}px;--d:330ms;--c:${circle * 1.15}px">
      ${def ? gifCircle(def.id) : '<span class="aw-gif aw-empty"></span>'}
      <span class="aw-throw-label">Arremessável</span>
    </div>`;
    for (let i = 0; i < MAX_GRENADES; i++) {
      const x = slotX + circle * 0.95 + i * (sq + 8 * this.s);
      const filled = def && i < g.count;
      html += `<div class="aw-piece aw-square ${filled ? 'filled' : ''}" style="--x:${x}px;--y:${throwY}px;--d:${380 + i * 35}ms;--q:${sq}px">
        ${filled ? `<img src="${gifUrl(def.id)}" alt="" draggable="false" /><button class="aw-minus" data-minus title="Remover uma">−</button>` : ''}
      </div>`;
    }
    host.innerHTML = html;
  }

  /** Opções de arremessáveis que saem do slot para a esquerda. */
  private renderThrowPicker(): void {
    const { throwY, circle } = this.px;
    const host = this.stage.querySelector('.aw-throw-picker')!;
    if (!this.throwPicker) {
      host.innerHTML = '';
      return;
    }
    const slotX = this.throwSlotX;
    const type = this.loadout.grenade.type;
    host.innerHTML = this.catalog
      .filter((w) => w.kind === 'throwable')
      .map((w, i) => {
        const x = slotX - circle * 1.2 * (i + 1) - 6 * this.s;
        return `<div class="aw-piece aw-option aw-from-slot tier-${w.tier} ${w.id === type ? 'selected' : ''}" data-throw="${w.id}"
          style="--x:${x}px;--y:${throwY}px;--d:${i * 45}ms;--c:${circle}px;--ox:${slotX - x}px">${gifCircle(w.id)}${w.id === type ? '<span class="aw-plus">+1</span>' : ''}</div>`;
      })
      .join('');
  }

  private renderCenter(def: WeaponDef | null, title?: string, subtitle?: string): void {
    const el = this.stage.querySelector('.aw-center') as HTMLElement | null;
    if (!el) return;
    if (!def) {
      el.innerHTML = `<div class="aw-center-inner aw-center-idle">
        <b>${title ?? 'ARSENAL'}</b><span>${subtitle ?? 'Passe o mouse num compartimento'}</span><kbd>B</kbd>
      </div>`;
      el.className = 'aw-piece aw-center';
      return;
    }
    const bars = statBars(def)
      .slice(0, 3)
      .map((b) => `<div class="aw-bar"><span>${b.label}</span><b><i style="transform:scaleX(${b.value.toFixed(3)})"></i></b></div>`)
      .join('');
    el.className = `aw-piece aw-center tier-${def.tier}`;
    el.innerHTML = `<div class="aw-center-inner" key="${def.id}">
      ${gifCircle(def.id, 'aw-center-gif')}
      <span class="aw-tier">${TIERS[def.tier].short} · ${TIERS[def.tier].label}</span>
      <b class="aw-center-name">${def.name}</b>
      <span class="aw-center-tags">${weaponTags(def).slice(0, 2).join(' · ')}</span>
      <div class="aw-bars">${bars}</div>
    </div>`;
  }

  // ═════════════════════ bolinha + arcos ═════════════════════

  private openBand(slot: RingSlot): void {
    if (this.band?.slot === slot) return;
    const { deg, dir } = BAND_ANCHOR[slot];
    this.band = { slot, deg, dir, category: null, catDeg: deg };
    const cats = this.categoriesFor(slot);
    if (cats.length === 1) this.band.category = cats[0];
    this.renderBands();
  }

  private closeBand(): void {
    if (!this.band) return;
    this.band = null;
    this.renderBands();
  }

  private categoriesFor(slot: RingSlot): WeaponCategory[] {
    return CATEGORIES.filter((c) => c.slot === slot && this.catalog.some((w) => w.category === c.id)).map((c) => c.id);
  }

  /** Arcos completos (ao abrir um compartimento): categorias + armas da categoria. */
  private renderBands(): void {
    const host = this.stage.querySelector('.aw-bands')!;
    const b = this.band;
    if (!b) {
      host.innerHTML = '';
      return;
    }
    const { bandR1, bandWidth, circle } = this.px;
    const cats = this.categoriesFor(b.slot);
    const catStep = this.bandStep(bandR1) * b.dir;
    const catEnd = b.deg + catStep * (cats.length - 1);
    const html = cats
      .map((id, i) => {
        const deg = b.deg + catStep * i;
        const p = polar(bandR1, deg);
        const info = CATEGORIES.find((c) => c.id === id)!;
        const sample = this.catalog.filter((w) => w.category === id).sort((a, z) => z.tier - a.tier)[0];
        const active = b.category === id;
        return `<div class="aw-piece aw-option aw-cat ${active ? 'active' : ''}" data-cat="${id}" data-deg="${deg}"
          style="--x:${p.x}px;--y:${p.y}px;--d:${40 + i * 35}ms;--c:${circle}px">
          ${gifCircle(sample.id)}<span class="aw-cat-label">${info.label}</span></div>`;
      })
      .join('');
    host.innerHTML = `<div class="aw-band-layer">${this.bandSvg(this.bandPath(bandR1, b.deg, catEnd, bandWidth, 'cat'))}${html}</div><div class="aw-band-layer aw-weapons-layer"></div>`;
    this.renderWeaponBand(false);
  }

  /**
   * Só o arco de armas (ao trocar de categoria): as categorias ficam onde estão
   * (sem reanimar) e a lista antiga some enquanto a nova entra.
   */
  private renderWeaponBand(swap = true): void {
    const b = this.band;
    const layer = this.stage.querySelector<HTMLElement>('.aw-weapons-layer');
    if (!b || !layer) return;
    this.stage.querySelectorAll<HTMLElement>('.aw-cat').forEach((el) => el.classList.toggle('active', el.dataset.cat === b.category));
    if (swap && layer.childElementCount) {
      // a lista anterior sai em fade (sem cliques) por cima da nova
      const old = layer.cloneNode(true) as HTMLElement;
      old.classList.remove('aw-weapons-layer');
      old.classList.add('aw-leaving');
      layer.before(old);
      window.setTimeout(() => old.remove(), 160);
    }
    if (!b.category) {
      layer.innerHTML = '';
      return;
    }
    const { bandR2, bandWidth, circle } = this.px;
    const weapons = this.catalog.filter((w) => w.category === b.category).sort((a, z) => a.tier - z.tier);
    const wStep = this.bandStep(bandR2) * b.dir;
    const start = b.catDeg;
    const current = this.loadout[b.slot];
    const html = weapons
      .map((w, i) => {
        const deg = start + wStep * i;
        const p = polar(bandR2, deg);
        return `<div class="aw-piece aw-option aw-weapon tier-${w.tier} ${w.id === current ? 'selected' : ''}" data-pick="${w.id}"
            style="--x:${p.x}px;--y:${p.y}px;--d:${(swap ? 0 : 60) + i * (swap ? 18 : 35)}ms;--c:${circle}px">${gifCircle(w.id)}</div>`;
      })
      .join('');
    layer.classList.toggle('aw-swap', swap);
    layer.innerHTML = this.bandSvg(this.bandPath(bandR2, start, start + wStep * (weapons.length - 1), bandWidth, 'weapons')) + html;
  }

  private bandStep(r: number): number {
    return (((this.px.circle + 12 * this.s) / r) * 180) / Math.PI;
  }

  private bandSvg(paths: string): string {
    const size = (this.px.bandR2 + this.px.bandWidth) * 2;
    return `<svg class="aw-band-svg" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}">${paths}</svg>`;
  }

  private bandPath(r: number, a0: number, a1: number, width: number, kind: string): string {
    const pad = ((width * 0.1) / r) * (180 / Math.PI);
    const lo = Math.min(a0, a1) - pad;
    const hi = Math.max(a0, a1) + pad;
    // desenha a partir da bolinha para fora
    const d = a1 >= a0 ? arcPath(r, lo, hi) : arcPath(r, hi, lo);
    return `<path class="aw-band aw-band-${kind}" d="${d}" stroke-width="${width}" pathLength="1" />`;
  }

  // ═════════════════════ eventos ═════════════════════

  private readonly onMove = (e: MouseEvent): void => {
    const { r1, r2 } = this.px;
    const { r, deg } = toPolar(e.clientX - window.innerWidth / 2, e.clientY - window.innerHeight / 2);
    let slot: RingSlot | null = null;
    if (r >= r1 && r <= r2) slot = RING_ORDER.find((s) => inArc(deg, SECTORS[s].a0, SECTORS[s].a1)) ?? null;

    if (r < r1) {
      this.setHover(null);
      this.closeBand();
      if (this.throwPicker) this.setThrowPicker(false);
      this.renderCenter(null);
    } else if (slot) {
      // passar o mouse no compartimento já abre os arcos dele
      this.setHover(slot);
      if (this.throwPicker) this.setThrowPicker(false);
      this.openBand(slot);
    }
  };

  private readonly onOver = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-cat],[data-pick],[data-throw-slot],[data-throw]');
    if (!t) return;
    if (t.dataset.cat && this.band) {
      const cat = t.dataset.cat as WeaponCategory;
      if (this.band.category !== cat) {
        this.band.category = cat;
        this.band.catDeg = Number(t.dataset.deg);
        this.renderWeaponBand();
      }
      const info = CATEGORIES.find((c) => c.id === cat)!;
      this.renderCenter(null, info.label.toUpperCase(), `${this.catalog.filter((w) => w.category === cat).length} armas`);
    } else if (t.dataset.pick) {
      this.renderCenter(this.find(t.dataset.pick) ?? null);
    } else if (t.dataset.throwSlot !== undefined) {
      this.closeBand();
      this.setHover(null);
      if (!this.throwPicker) this.setThrowPicker(true);
      this.renderCenter(this.find(this.loadout.grenade.type) ?? null);
    } else if (t.dataset.throw) {
      this.renderCenter(this.find(t.dataset.throw) ?? null);
    }
  };

  private readonly onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-pick],[data-throw],[data-minus]');
    if (!t) return;
    const next: Loadout = structuredClone(this.loadout);
    if (t.dataset.pick && this.band) {
      next[this.band.slot] = t.dataset.pick;
    } else if (t.dataset.throw) {
      const id = t.dataset.throw;
      if (next.grenade.type === id) next.grenade.count = Math.min(MAX_GRENADES, next.grenade.count + 1);
      else next.grenade = { type: id, count: 1 };
    } else if (t.dataset.minus !== undefined) {
      next.grenade.count = Math.max(0, next.grenade.count - 1);
    } else return;

    this.loadout = next;
    this.onChange(next);
    if (t.dataset.pick) {
      this.renderSlots(false);
      this.root.querySelectorAll('.aw-weapon').forEach((n) => n.classList.toggle('selected', (n as HTMLElement).dataset.pick === t.dataset.pick));
      const slotEl = this.stage.querySelector(`.aw-slot:nth-child(${RING_ORDER.indexOf(this.band!.slot) + 1})`);
      slotEl?.classList.add('flash');
    } else {
      this.renderThrowables(false);
      this.updateThrowPickerSelection();
      this.stage.querySelector('.aw-throw-slot')?.classList.add('flash');
    }
  };

  private setHover(slot: RingSlot | null): void {
    if (slot === this.hoverSlot) return;
    this.hoverSlot = slot;
    this.root.querySelectorAll<SVGPathElement>('.aw-sector').forEach((p) => p.classList.toggle('hover', p.dataset.ring === slot));
    if (slot) this.renderCenter(this.find(this.loadout[slot]) ?? null, SLOT_LABELS[slot].toUpperCase(), 'Vazio');
  }

  /** Atualiza seleção/“+1” sem recriar (recriar repetiria a animação sob o cursor). */
  private updateThrowPickerSelection(): void {
    const type = this.loadout.grenade.type;
    this.stage.querySelectorAll<HTMLElement>('.aw-throw-picker [data-throw]').forEach((el) => {
      const sel = el.dataset.throw === type;
      el.classList.toggle('selected', sel);
      el.querySelector('.aw-plus')?.remove();
      if (sel) el.insertAdjacentHTML('beforeend', '<span class="aw-plus">+1</span>');
    });
  }

  private setThrowPicker(open: boolean): void {
    this.throwPicker = open;
    this.renderThrowPicker();
  }

  private find(id: string | null | undefined): WeaponDef | undefined {
    return id ? this.catalog.find((w) => w.id === id) : undefined;
  }
}
