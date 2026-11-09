import { ATTACHMENTS, type AttachmentId, attachmentOptions, SLOT_LABEL, SLOT_ORDER, type WeaponAttachments } from '@shared/weapons/attachments';
import { CATEGORIES, TIERS } from '@shared/weapons/categories';
import { AMMO, ammoPrice, ATTACHMENT_PRICE, MAX_SHOP_GRENADES, money, weaponPrice } from '@shared/weapons/economy';
import type { Loadout } from '@shared/weapons/loadout';
import type { FirearmDef, ThrowableDef, WeaponCategory, WeaponDef } from '@shared/weapons/types';
import type { Economy } from '../../weapons/Economy';
import './shop.css';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const gif = (id: string): string => `/weapons/gifs/${id}.gif`;

/** O que a loja precisa do jogo. */
export interface ShopHost {
  economy: Economy;
  loadout(): Loadout;
  grenades(): number;
  ammo(def: FirearmDef): { mag: number; reserve: number; max: number };
  attachments(id: string): WeaponAttachments;
  /** Compra (se preciso) e equipa a arma. */
  takeWeapon(def: WeaponDef): Promise<void>;
  buyAmmo(def: FirearmDef): Promise<void>;
  buyGrenade(def: ThrowableDef): Promise<void>;
  /** Compra (se preciso) e liga/desliga o acessório. */
  toggleAttachment(def: FirearmDef, att: AttachmentId): Promise<void>;
}

/**
 * Loja do modo zumbis (tecla B): armas por categoria, munição, granadas e
 * acessórios das armas equipadas. Tudo custa dinheiro ganho matando zumbis.
 */
export class ShopMenu {
  private readonly root: HTMLDivElement;
  private openState = false;
  private category: WeaponCategory = 'pistol';
  private flash = '';
  private flashTimer = 0;

  constructor(
    container: HTMLElement,
    private readonly catalog: readonly WeaponDef[],
    private readonly host: ShopHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'shop hidden';
    container.appendChild(this.root);
    this.root.addEventListener('click', (e) => void this.onClick(e));
    for (const ev of ['mousedown', 'contextmenu'] as const)
      this.root.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'contextmenu') e.preventDefault();
      });
  }

  get isOpen(): boolean {
    return this.openState;
  }

  setOpen(open: boolean): void {
    this.openState = open;
    this.root.classList.toggle('hidden', !open);
    if (open) this.render();
  }

  /** Saldo/itens mudaram: redesenha se estiver aberta. */
  refresh(): void {
    if (this.openState) this.render();
  }

  private render(): void {
    const e = this.host.economy;
    const tabs = CATEGORIES.map(
      (c) => `<button type="button" class="shop-tab${c.id === this.category ? ' on' : ''}" data-cat="${c.id}">${esc(c.label)}</button>`,
    ).join('');
    const list = this.catalog.filter((w) => w.category === this.category);
    const lo = this.host.loadout();
    const cards = list
      .map((w) => {
        const throwable = w.kind === 'throwable';
        const equipped = throwable ? lo.grenade.type === w.id && this.host.grenades() > 0 : lo[w.slot as 'primary'] === w.id;
        const owned = !throwable && e.ownsWeapon(w.id);
        const price = weaponPrice(w);
        let action: string;
        if (throwable) {
          const full = lo.grenade.type === w.id && this.host.grenades() >= MAX_SHOP_GRENADES;
          action = full ? '<span class="shop-tag">máximo</span>' : this.priceButton(`g:${w.id}`, price, `+1 ${money(price)}`, 'grenade', w.id);
        } else if (equipped) action = '<span class="shop-tag on">equipada</span>';
        else if (owned) action = `<button type="button" class="shop-btn" data-act="take" data-id="${w.id}">Equipar</button>`;
        else action = this.priceButton(`w:${w.id}`, price, money(price), 'take', w.id);
        const count = throwable && lo.grenade.type === w.id ? `<em>${this.host.grenades()}/${MAX_SHOP_GRENADES}</em>` : '';
        return `<div class="shop-card tier-${w.tier}${equipped ? ' equipped' : ''}">
          <img src="${gif(w.id)}" alt="" draggable="false" onerror="this.style.visibility='hidden'" />
          <b>${esc(w.name)}</b><small>${TIERS[w.tier].label}${count}</small>${action}
        </div>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="shop-panel">
        <header><h2>LOJA</h2><span class="shop-money">${money(e.money)}</span><span class="shop-flash">${esc(this.flash)}</span><em>B fechar</em></header>
        <nav>${tabs}</nav>
        <section class="shop-grid">${cards || '<p class="shop-empty">Nada nesta categoria.</p>'}</section>
        <aside>${this.renderEquipped(lo)}</aside>
      </div>`;
  }

  private priceButton(item: string, price: number, label: string, act: string, id: string): string {
    const ok = this.host.economy.canAfford(item);
    return `<button type="button" class="shop-btn buy${ok ? '' : ' poor'}" data-act="${act}" data-id="${id}" data-price="${price}">${label}</button>`;
  }

  /** Coluna da direita: armas equipadas com munição e acessórios. */
  private renderEquipped(lo: Loadout): string {
    const blocks: string[] = [];
    for (const slot of ['primary', 'secondary'] as const) {
      const def = this.catalog.find((w) => w.id === lo[slot]);
      if (!def || def.kind !== 'firearm') {
        blocks.push(`<div class="shop-eq empty"><small>${slot === 'primary' ? 'Principal' : 'Secundária'}</small><b>—</b></div>`);
        continue;
      }
      const a = this.host.ammo(def);
      const full = a.reserve >= a.max;
      const ammoBtn = full
        ? '<span class="shop-tag">munição cheia</span>'
        : this.priceButton(`m:${def.id}`, ammoPrice(def), `Munição +${AMMO.packMags} pentes · ${money(ammoPrice(def))}`, 'ammo', def.id);
      const opts = attachmentOptions(def);
      const current = this.host.attachments(def.id);
      const atts = SLOT_ORDER.flatMap((s) => (opts[s] ?? []).map((id) => ({ s, id })))
        .map(({ s, id }) => {
          const on = current[s] === id;
          const owned = this.host.economy.ownsAttachment(def.id, id);
          const label = owned ? (on ? 'usando' : 'usar') : money(ATTACHMENT_PRICE[id]);
          const poor = !owned && !this.host.economy.canAfford(`a:${def.id}:${id}`);
          return `<button type="button" class="shop-att${on ? ' on' : ''}${owned ? ' owned' : ''}${poor ? ' poor' : ''}" data-act="att" data-id="${def.id}" data-att="${id}" title="${esc(SLOT_LABEL[s])}">
            <span>${esc(ATTACHMENTS[id].name)}</span><i>${label}</i></button>`;
        })
        .join('');
      blocks.push(`<div class="shop-eq">
        <small>${slot === 'primary' ? 'Principal' : 'Secundária'}</small><b>${esc(def.name)}</b>
        <span class="shop-ammo">${a.mag} / ${a.reserve}</span>${ammoBtn}
        ${atts ? `<div class="shop-atts">${atts}</div>` : '<span class="shop-note">Não aceita acessórios</span>'}
      </div>`);
    }
    return `<h3>Equipado</h3>${blocks.join('')}`;
  }

  private async onClick(ev: MouseEvent): Promise<void> {
    const t = ev.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-cat]');
    if (tab) {
      this.category = tab.dataset.cat as WeaponCategory;
      return this.render();
    }
    const btn = t.closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const def = this.catalog.find((w) => w.id === btn.dataset.id);
    if (!def) return;
    if (btn.classList.contains('poor')) return this.say('Dinheiro insuficiente');
    const act = btn.dataset.act;
    if (act === 'take') await this.host.takeWeapon(def);
    else if (act === 'ammo' && def.kind === 'firearm') await this.host.buyAmmo(def);
    else if (act === 'grenade' && def.kind === 'throwable') await this.host.buyGrenade(def);
    else if (act === 'att' && def.kind === 'firearm') await this.host.toggleAttachment(def, btn.dataset.att as AttachmentId);
    this.render();
  }

  private say(text: string): void {
    this.flash = text;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flash = '';
      this.refresh();
    }, 1500);
    this.render();
  }
}
