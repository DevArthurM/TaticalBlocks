import type { DataSource } from '../shared/types';

export interface HudState {
  crosshairGap: number;
  /** Deslocamento da mira em px (recuo do braço). */
  aimOffset: [number, number];
  aiming: boolean;
  sprinting: boolean;
  scoped: boolean;
  /** 0..1 — túnel de foco ao mirar (vinheta). */
  tunnel: number;
  /** 0..1 — vermelho nas bordas (dano recente + vida baixa). */
  hurt: number;
  /** Escopeta: mira em círculo. */
  round: boolean;
}

export interface InspectView {
  gifId: string;
  count: number;
  /** Reserva (∞ = infinita; NaN = não mostrar, ex.: granadas). */
  reserve: number;
  /** 0..1 da inspeção. */
  t: number;
  /** Acessórios equipados (nomes). */
  attachments: string[];
  /** Posição na tela (px) perto da arma. */
  x: number;
  y: number;
}

/** Indicadores de direção de dano simultâneos. */
const DAMAGE_SLOTS = 4;
/** Segundos que a meia-lua fica visível (some nos últimos ~40%). */
const DAMAGE_LIFE = 1.6;
/** Meia-lua: arco grosso no topo de um círculo de raio 100 (centro 110,110), afinando nas pontas. */
const DAMAGE_ARC =
  'M 46.6 46.6 A 90 90 0 0 1 173.4 46.6 L 167.4 54.2 A 80 80 0 0 0 52.6 54.2 Z'.replace(/\s+/g, ' ');

interface DamageMark {
  el: HTMLDivElement;
  x: number;
  z: number;
  life: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
};

/**
 * HUD mínimo: só a mira durante o jogo. Munição aparece apenas ao inspecionar (V),
 * como um número flutuante ao lado da arma com o cartucho girando.
 * Também cuida de luneta, clarão, avisos e tela de pausa.
 */
export class HUD {
  /** Clique no botão "Configurações" da tela de pausa. */
  onOpenSettings: () => void = () => {};
  /** Botão "Menu principal". */
  onMainMenu: () => void = () => {};
  /** Botão "Sair da partida". */
  onExitMatch: () => void = () => {};

  /** Modo online: dica do placar no painel de pausa. */
  setOnlineMode(online: boolean): void {
    this.overlay.querySelector<HTMLElement>('.pause-hint')!.textContent = online
      ? 'Clique no jogo para continuar · segure Tab para ver o placar'
      : 'Clique no jogo para continuar';
  }

  private readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly scope: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private hitTimer = 0;
  private readonly purse: HTMLDivElement;
  private readonly moneyEl: HTMLElement;
  private readonly ammoEl: HTMLElement;
  private moneyText = '';
  private ammoText = '';

  /** Modo zumbis: dinheiro no canto (null esconde). */
  setMoney(text: string | null): void {
    this.purse.classList.toggle('hidden', text === null);
    if (text !== null && text !== this.moneyText) this.moneyEl.textContent = this.moneyText = text;
  }

  /** Modo zumbis: munição da arma na mão (pente / reserva). */
  setAmmo(text: string): void {
    if (text !== this.ammoText) this.ammoEl.textContent = this.ammoText = text;
  }

  /** Ganhou dinheiro: "+$60" sobe e some. */
  earn(text: string): void {
    const pop = el('span', 'purse-pop', this.purse);
    pop.textContent = text;
    setTimeout(() => pop.remove(), 1200);
  }

  /** Marcador de acerto no centro (amarelo na cabeça, vermelho e maior no abate). */
  hitMark(head: boolean, kill: boolean): void {
    this.hitTimer = kill ? 0.45 : 0.22;
    this.hitmarker.className = `hitmark${head ? ' head' : ''}${kill ? ' kill' : ''}`;
  }
  private readonly tunnel: HTMLDivElement;
  private readonly hurtEl: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private bannerTimer = 0;
  private readonly inspect: HTMLDivElement;
  private readonly inspectImg: HTMLImageElement;
  private readonly inspectCount: HTMLElement;
  private readonly inspectReserve: HTMLElement;
  private readonly inspectAtt: HTMLUListElement;
  private promptText = '';
  private inspectGif = '';
  private inspectKey = '';
  private blind = 0;
  private readonly damageMarks: DamageMark[] = [];

  constructor(container: HTMLElement) {
    this.root = el('div', 'hud', container);
    this.tunnel = el('div', 'focus-tunnel', this.root);
    this.hurtEl = el('div', 'hurt', this.root);
    this.banner = el('div', 'wave-banner', this.root);
    this.scope = el('div', 'scope', this.root);
    this.scope.innerHTML = '<div class="scope-lens"><i class="h"></i><i class="v"></i><i class="dot"></i></div>';
    this.flash = el('div', 'blind', this.root);

    this.crosshair = el('div', 'crosshair', this.root);
    for (const dir of ['top', 'bottom', 'left', 'right']) el('span', `ch ch-${dir}`, this.crosshair);
    el('span', 'ch-dot', this.crosshair);
    el('span', 'ch-ring', this.crosshair);

    for (let i = 0; i < DAMAGE_SLOTS; i++) {
      const mark = el('div', 'dmg-dir', this.root);
      mark.innerHTML = `<svg viewBox="0 0 220 220"><path d="${DAMAGE_ARC}"/></svg>`;
      this.damageMarks.push({ el: mark, x: 0, z: 0, life: 0 });
    }
    this.prompt = el('div', 'prompt', this.root);
    this.hitmarker = el('div', 'hitmark', this.root);
    for (let i = 0; i < 4; i++) el('i', '', this.hitmarker);
    this.purse = el('div', 'purse hidden', this.root);
    this.ammoEl = el('span', 'purse-ammo', this.purse);
    this.moneyEl = el('b', 'purse-money', this.purse);

    this.inspect = el('div', 'inspect', this.root);
    const bob = el('div', 'inspect-bob', this.inspect);
    this.inspectImg = el('img', 'inspect-gif', bob);
    this.inspectImg.alt = '';
    this.inspectImg.draggable = false;
    const num = el('div', 'inspect-num', bob);
    this.inspectCount = el('b', '', num);
    this.inspectReserve = el('span', '', num);
    this.inspectAtt = el('ul', 'inspect-att', bob);

    // pausa (Esc): painel lateral à esquerda; o jogo continua visível à direita (clicar nele retoma)
    this.overlay = el('div', 'overlay', this.root);
    this.overlay.innerHTML = `
      <aside class="pause-panel">
        <div class="pause-name"><small>Jogador</small><b></b></div>
        <nav class="pause-actions">
          <button type="button" data-act="main">Menu Principal</button>
          <button type="button" data-act="settings">Configurações</button>
        </nav>
        <div class="pause-foot">
          <p class="pause-hint">Clique no jogo para continuar</p>
          <p class="overlay-status"></p>
          <button type="button" class="pause-exit" data-act="exit">Sair da partida</button>
        </div>
      </aside>`;
    this.status = this.overlay.querySelector('.overlay-status')!;
    const panel = this.overlay.querySelector<HTMLElement>('.pause-panel')!;
    // cliques no painel não retomam o jogo (só fora dele)
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'main') this.onMainMenu();
      else if (act === 'settings') this.onOpenSettings();
      else if (act === 'exit') this.onExitMatch();
    });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  /** Aviso contextual no centro-baixo da tela (null esconde). */
  setPrompt(html: string | null): void {
    const text = html ?? '';
    if (text === this.promptText) return;
    this.promptText = text;
    this.prompt.innerHTML = text;
    this.prompt.classList.toggle('on', !!html);
  }

  setPaused(paused: boolean): void {
    if (paused) {
      let name = '';
      try {
        name = localStorage.getItem('fps.name') ?? '';
      } catch {
        /* sem armazenamento */
      }
      this.overlay.querySelector('.pause-name b')!.textContent = name || 'Soldado';
    }
    this.overlay.classList.toggle('hidden', !paused);
  }

  /** Mapa e servidor: mostrado só na tela de pausa. */
  setStatus(mapName: string, source: DataSource): void {
    const label = source === 'server' ? 'servidor online' : 'offline — dados locais';
    this.status.innerHTML = `<b>${mapName}</b> · <span class="${source}">${label}</span>`;
  }

  /** Personalizando a arma: esconde a mira e efeitos de mira. */
  setCustomizing(on: boolean): void {
    this.root.classList.toggle('customizing', on);
  }

  /** Mensagem temporária no lugar do status (ex.: carregando). */
  setLoading(message: string): void {
    this.status.innerHTML = `<span class="loading">${message}</span>`;
  }

  /** Aviso grande e breve no topo (ex.: nova onda). */
  announce(title: string, subtitle: string): void {
    this.banner.innerHTML = `<b>${title}</b><span>${subtitle}</span>`;
    this.bannerTimer = 3;
  }

  /**
   * Levou dano vindo de `from` (posição no mundo): meia-lua vermelha em volta da
   * mira apontando para lá. Segue girando conforme o jogador vira.
   */
  damageFrom(x: number, z: number): void {
    // reaproveita a marca da mesma direção (rajada do mesmo atirador) ou a mais antiga
    let slot = this.damageMarks.find((m) => m.life > 0 && Math.hypot(m.x - x, m.z - z) < 1.5);
    slot ??= this.damageMarks.reduce((a, b) => (b.life < a.life ? b : a));
    slot.x = x;
    slot.z = z;
    slot.life = DAMAGE_LIFE;
  }

  /** Atualiza as meias-luas para a posição/direção atual da câmera. */
  updateDamageDir(camX: number, camZ: number, yaw: number, dt: number): void {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (const m of this.damageMarks) {
      if (m.life <= 0) continue;
      m.life = Math.max(0, m.life - dt);
      const dx = m.x - camX;
      const dz = m.z - camZ;
      // ângulo na tela: 0 = à frente (topo), positivo = à direita (sentido horário)
      const angle = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
      m.el.style.transform = `rotate(${angle.toFixed(3)}rad)`;
      m.el.style.opacity = Math.min(1, m.life / (DAMAGE_LIFE * 0.4)).toFixed(3);
    }
  }

  /** Granada de atordoamento. */
  addBlind(amount: number): void {
    this.blind = Math.min(1.6, this.blind + amount * 1.6);
  }

  update(s: HudState, inspect: InspectView | null, dt: number): void {
    this.blind = Math.max(0, this.blind - dt * 0.45);
    this.flash.style.opacity = String(Math.min(1, this.blind));

    this.scope.classList.toggle('on', s.scoped);
    this.crosshair.style.setProperty('--gap', `${Math.round(s.crosshairGap)}px`);
    // a mira segue o desvio do braço (recuo + mola de tensão)
    this.crosshair.style.transform = `translate(${s.aimOffset[0].toFixed(1)}px, ${s.aimOffset[1].toFixed(1)}px)`;
    // o marcador de acerto acompanha a mira (recuo/desvio do braço)
    this.hitmarker.style.transform = this.crosshair.style.transform;
    this.crosshair.classList.toggle('hidden', s.aiming || s.sprinting || s.scoped);
    this.crosshair.classList.toggle('round', s.round);
    this.tunnel.style.setProperty('--f', s.tunnel.toFixed(3));
    this.hurtEl.style.opacity = s.hurt.toFixed(3);
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.hitmarker.style.opacity = String(Math.min(1, this.hitTimer / 0.12));
    this.bannerTimer -= dt;
    this.banner.classList.toggle('on', this.bannerTimer > 0);

    this.updateInspect(inspect);
  }

  private updateInspect(v: InspectView | null): void {
    this.inspect.classList.toggle('on', !!v);
    if (!v) return;
    if (v.gifId !== this.inspectGif) {
      this.inspectGif = v.gifId;
      this.inspectImg.src = `/weapons/gifs/${v.gifId}.gif`;
    }
    const key = `${v.count}|${v.reserve}|${v.attachments.join(',')}`;
    if (key !== this.inspectKey) {
      this.inspectKey = key;
      this.inspectAtt.replaceChildren(
        ...v.attachments.map((name) => {
          const li = document.createElement('li');
          li.textContent = name;
          return li;
        }),
      );
      this.inspectCount.textContent = String(v.count);
      this.inspectReserve.textContent = Number.isNaN(v.reserve) ? '' : `/ ${Number.isFinite(v.reserve) ? v.reserve : '∞'}`;
    }
    // entra e sai suavemente no começo/fim da inspeção
    const fade = Math.min(1, v.t / 0.1, (1 - v.t) / 0.12);
    this.inspect.style.opacity = String(Math.max(0, fade));
    this.inspect.style.transform = `translate(${v.x.toFixed(0)}px, ${v.y.toFixed(0)}px) scale(${(0.85 + 0.15 * fade).toFixed(3)})`;
  }
}
