import {
  ATTACHMENTS,
  type AttachmentId,
  type AttachmentSlot,
  applyAttachmentStats,
  attachmentOptions,
  MAGNIFICATION,
  SLOT_LABEL,
  SLOT_ORDER,
  type WeaponAttachments,
} from '@shared/weapons/attachments';
import type { WeaponDef } from '@shared/weapons/types';
import { attachmentGifId } from '../../weapons/models/attachmentPreview';
import './attachments.css';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (k: number): string => `${k <= 1 ? '−' : '+'}${Math.round(Math.abs(1 - k) * 100)}%`;
const gif = (id: AttachmentId): string => `/weapons/gifs/${attachmentGifId(id)}.gif`;

/**
 * Onde cada quadrado fica em relação ao ponto do encaixe na arma (px, numa tela de
 * 900 px de altura) e para que lado a fileira de opções abre.
 */
const LAYOUT: Record<AttachmentSlot, { dx: number; dy: number; open: 'left' | 'right' }> = {
  optic: { dx: 70, dy: -130, open: 'right' },
  muzzle: { dx: -70, dy: -120, open: 'left' },
  rail: { dx: -20, dy: -185, open: 'left' },
  magazine: { dx: 90, dy: 130, open: 'right' },
  grip: { dx: -90, dy: 130, open: 'left' },
};

type Point = { x: number; y: number };

/**
 * Editor de acessórios (T): a arma fica na frente da câmera e de cada encaixe sai uma
 * linha até um quadrado com o acessório atual. Clicar no quadrado abre a fileira de
 * opções (como os arremessáveis do arsenal): passar o mouse troca na hora no modelo,
 * clicar escolhe (a opção escolhida fica destacada).
 */
export class AttachmentEditor {
  /** Escolheu: salva e devolve os acessórios válidos. */
  onChange: (id: string, att: WeaponAttachments) => WeaponAttachments = (_id, a) => a;
  /** Pré-visualização (mouse sobre uma opção); `null` volta ao escolhido. */
  onPreview: (att: WeaponAttachments | null) => void = () => {};
  onClose: () => void = () => {};
  /** Modo zumbis: preço do acessório ainda não comprado (null = já é do jogador). */
  priceOf: ((weapon: string, att: AttachmentId) => number | null) | null = null;
  /** Modo zumbis: compra o acessório (true se deu certo). */
  onBuy: (weapon: string, att: AttachmentId) => Promise<boolean> = async () => false;

  private readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly boxes = new Map<AttachmentSlot, HTMLDivElement>();
  private readonly lines = new Map<AttachmentSlot, SVGLineElement>();
  private readonly info: HTMLDivElement;
  private def: WeaponDef | null = null;
  private att: WeaponAttachments = {};
  private slots: AttachmentSlot[] = [];
  private picker: AttachmentSlot | null = null;
  /** Última posição de cada quadrado (congelada enquanto uma fileira está aberta). */
  private readonly boxPos = new Map<AttachmentSlot, Point>();
  private hoverDesc: string | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'att-editor hidden';
    this.root.innerHTML = '<svg class="att-lines"></svg><div class="att-boxes"></div><div class="att-info"></div>';
    container.appendChild(this.root);
    this.svg = this.root.querySelector('svg')!;
    this.info = this.root.querySelector('.att-info')!;
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('pointerover', this.onOver);
    this.root.addEventListener('pointerout', this.onOut);
    for (const ev of ['mousedown', 'click'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(def: WeaponDef | null, att: WeaponAttachments): void {
    this.def = def;
    this.att = { ...att };
    this.picker = null;
    this.hoverDesc = null;
    const opts = attachmentOptions(def ?? undefined);
    this.slots = SLOT_ORDER.filter((s) => opts[s]?.length);
    this.build();
    this.root.classList.remove('hidden');
  }

  close(): void {
    this.root.classList.add('hidden');
    this.picker = null;
  }

  /**
   * Posição na tela de cada encaixe neste quadro (a arma balança): linhas e quadrados
   * acompanham.
   */
  update(points: Partial<Record<AttachmentSlot, Point>>): void {
    if (!this.isOpen) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const k = Math.min(1.2, Math.max(0.6, h / 900));
    for (const slot of this.slots) {
      const p = points[slot];
      const box = this.boxes.get(slot)!;
      const line = this.lines.get(slot)!;
      box.style.visibility = p ? '' : 'hidden';
      line.style.visibility = p ? '' : 'hidden';
      if (!p) continue;
      const l = LAYOUT[slot];
      const half = 38;
      let bx = Math.min(w - half - 12, Math.max(half + 12, p.x + l.dx * k));
      let by = Math.min(h - half - 40, Math.max(half + 12, p.y + l.dy * k));
      // com uma fileira aberta os quadrados não se mexem: a pré-visualização muda a arma
      // (ex.: silenciador alonga o cano) e o quadrado fugiria de baixo do mouse
      const frozen = this.picker ? this.boxPos.get(slot) : undefined;
      if (frozen) ({ x: bx, y: by } = frozen);
      else this.boxPos.set(slot, { x: bx, y: by });
      box.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`;
      line.setAttribute('x1', p.x.toFixed(1));
      line.setAttribute('y1', p.y.toFixed(1));
      line.setAttribute('x2', bx.toFixed(1));
      line.setAttribute('y2', by.toFixed(1));
      const dot = line.nextElementSibling as SVGCircleElement;
      dot.setAttribute('cx', p.x.toFixed(1));
      dot.setAttribute('cy', p.y.toFixed(1));
    }
  }

  // ───────────── montagem ─────────────

  private build(): void {
    this.svg.innerHTML = '';
    const host = this.root.querySelector('.att-boxes')!;
    host.innerHTML = '';
    this.boxes.clear();
    this.lines.clear();
    this.boxPos.clear();
    for (const slot of this.slots) {
      const ns = 'http://www.w3.org/2000/svg';
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', 'att-line');
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('class', 'att-dot');
      dot.setAttribute('r', '3.5');
      this.svg.append(line, dot);
      this.lines.set(slot, line);
      const box = document.createElement('div');
      box.className = `att-box open-${LAYOUT[slot].open}`;
      box.dataset.slot = slot;
      host.appendChild(box);
      this.boxes.set(slot, box);
      this.renderBox(slot);
    }
    this.renderInfo();
  }

  private renderBox(slot: AttachmentSlot): void {
    const box = this.boxes.get(slot)!;
    const id = this.att[slot];
    const open = this.picker === slot;
    box.classList.toggle('picking', open);
    box.classList.toggle('filled', !!id);
    const opts = [null, ...(attachmentOptions(this.def ?? undefined)[slot] ?? [])];
    const picker = open
      ? `<div class="att-picker">${opts
          .map((o, i) => {
            const sel = (id ?? null) === o;
            return `<button type="button" class="att-opt${sel ? ' selected' : ''}" data-opt="${o ?? ''}" style="--i:${i}">
              ${o ? `<img src="${gif(o)}" alt="" draggable="false" />` : '<span class="att-none"></span>'}
              <span class="att-opt-name">${esc(o ? ATTACHMENTS[o].name : slot === 'magazine' ? 'Padrão' : 'Nenhum')}</span>
              ${this.priceTag(o)}
            </button>`;
          })
          .join('')}</div>`
      : '';
    box.innerHTML = `
      <button type="button" class="att-square" data-square="${slot}" title="${SLOT_LABEL[slot]}">
        ${id ? `<img src="${gif(id)}" alt="" draggable="false" />` : '<span class="att-plus">+</span>'}
      </button>
      <span class="att-label"><small>${SLOT_LABEL[slot]}</small>${esc(id ? ATTACHMENTS[id].name : slot === 'magazine' ? 'Padrão' : 'Nenhum')}</span>
      ${picker}`;
  }

  private renderInfo(): void {
    const def = this.def;
    if (!def || !this.slots.length) {
      this.info.innerHTML = `<b>${esc(def?.name ?? 'Sem arma')}</b><span>Esta arma não aceita acessórios.</span><em>T voltar</em>`;
      return;
    }
    let stats = '';
    if (def.kind === 'firearm') {
      const d = applyAttachmentStats(def, this.att);
      const zoom = this.att.optic ? (MAGNIFICATION[this.att.optic] ?? 1) : 1;
      const chips: string[] = [`Munição ${d.magazineSize}`, `Aumento ${zoom.toString().replace('.', ',')}x`];
      if (d.recoil.pitch !== def.recoil.pitch) chips.push(`Recuo ${pct(d.recoil.pitch / def.recoil.pitch)}`);
      if (d.hipSpread !== def.hipSpread) chips.push(`Quadril ${pct(d.hipSpread / def.hipSpread)}`);
      stats = `<span class="att-stats">${chips.map((c) => `<i>${c}</i>`).join('')}</span>`;
    }
    const hint = this.hoverDesc ?? 'Clique num quadrado para ver as opções';
    this.info.innerHTML = `<b>${esc(def.name)}</b>${stats}<span>${esc(hint)}</span><em>T voltar</em>`;
  }

  // ───────────── eventos ─────────────

  private readonly onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    const square = t.closest<HTMLElement>('[data-square]');
    const opt = t.closest<HTMLElement>('[data-opt]');
    if (opt) {
      const slot = opt.closest<HTMLElement>('.att-box')!.dataset.slot as AttachmentSlot;
      return void this.choose(slot, (opt.dataset.opt || null) as AttachmentId | null);
    }
    if (square) {
      const slot = square.dataset.square as AttachmentSlot;
      const prev = this.picker;
      this.picker = prev === slot ? null : slot;
      if (prev) this.renderBox(prev);
      if (this.picker) this.renderBox(this.picker);
      return;
    }
    // clique fora: fecha a fileira aberta
    if (this.picker) {
      const prev = this.picker;
      this.picker = null;
      this.renderBox(prev);
    }
  };

  private priceTag(id: AttachmentId | null): string {
    const p = id && this.def && this.priceOf ? this.priceOf(this.def.id, id) : null;
    return p === null ? '' : `<i class="att-price">$${p.toLocaleString('pt-BR')}</i>`;
  }

  /** Escolhe (salva) a opção: o quadrado e o destaque mudam; a fileira continua aberta. */
  private async choose(slot: AttachmentSlot, id: AttachmentId | null): Promise<void> {
    if (!this.def) return;
    // modo zumbis: acessório ainda não comprado → compra primeiro
    if (id && this.priceOf?.(this.def.id, id) != null && !(await this.onBuy(this.def.id, id))) {
      this.hoverDesc = 'Dinheiro insuficiente';
      this.renderInfo();
      return;
    }
    const next: WeaponAttachments = { ...this.att };
    if (id) next[slot] = id;
    else delete next[slot];
    this.att = this.onChange(this.def.id, next);
    this.renderBox(slot);
    this.renderInfo();
  }

  /** Mouse sobre uma opção: troca na hora na arma (sem escolher). */
  private readonly onOver = (e: PointerEvent): void => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-opt]');
    if (!opt) return;
    const slot = opt.closest<HTMLElement>('.att-box')!.dataset.slot as AttachmentSlot;
    const id = (opt.dataset.opt || null) as AttachmentId | null;
    const preview: WeaponAttachments = { ...this.att };
    if (id) preview[slot] = id;
    else delete preview[slot];
    this.onPreview(preview);
    this.hoverDesc = id ? ATTACHMENTS[id].desc : 'Sem acessório neste encaixe.';
    this.renderInfo();
  };

  /** Saiu de cima das opções: volta ao que está escolhido. */
  private readonly onOut = (e: PointerEvent): void => {
    const from = (e.target as HTMLElement).closest('[data-opt]');
    const to = (e.relatedTarget as HTMLElement | null)?.closest?.('[data-opt]');
    if (!from || to) return;
    this.onPreview(null);
    this.hoverDesc = null;
    this.renderInfo();
  };
}
