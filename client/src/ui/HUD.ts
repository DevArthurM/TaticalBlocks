import type { DataSource } from '../shared/types';

export interface HudState {
  crosshairGap: number;
  /** Deslocamento da mira em px (recuo do braço). */
  aimOffset: [number, number];
  aiming: boolean;
  sprinting: boolean;
  scoped: boolean;
  /** 0..1 — opacidade do ponto central ao mirar inclinado (andando de lado). */
  adsDot: number;
  /** 0..1 — túnel de foco ao mirar (vinheta). */
  tunnel: number;
  /** 0..1 — vermelho nas bordas (dano recente + vida baixa). */
  hurt: number;
}

export interface InspectView {
  gifId: string;
  count: number;
  /** Reserva (∞ = infinita; NaN = não mostrar, ex.: granadas). */
  reserve: number;
  /** 0..1 da inspeção. */
  t: number;
  /** Posição na tela (px) perto da arma. */
  x: number;
  y: number;
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
  /** Troca de mapa pela tela de pausa. */
  onSelectMap: (mode: string) => void = () => {};

  setMapChoice(mode: string): void {
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) => b.classList.toggle('on', b.dataset.map === mode));
  }

  private readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly scope: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly adsDot: HTMLDivElement;
  private readonly tunnel: HTMLDivElement;
  private readonly hurtEl: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private bannerTimer = 0;
  private readonly inspect: HTMLDivElement;
  private readonly inspectImg: HTMLImageElement;
  private readonly inspectCount: HTMLElement;
  private readonly inspectReserve: HTMLElement;
  private promptText = '';
  private inspectGif = '';
  private inspectKey = '';
  private blind = 0;

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

    this.adsDot = el('div', 'ads-dot', this.root);
    this.prompt = el('div', 'prompt', this.root);

    this.inspect = el('div', 'inspect', this.root);
    const bob = el('div', 'inspect-bob', this.inspect);
    this.inspectImg = el('img', 'inspect-gif', bob);
    this.inspectImg.alt = '';
    this.inspectImg.draggable = false;
    const num = el('div', 'inspect-num', bob);
    this.inspectCount = el('b', '', num);
    this.inspectReserve = el('span', '', num);

    this.overlay = el('div', 'overlay', this.root);
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
          <li><kbd>V</kbd> inspecionar (munição)</li>
          <li><kbd>F</kbd> (segurar) pregar tábuas</li>
          <li><kbd>1 2 3 4</kbd> trocar arma</li>
          <li><kbd>Roda / X</kbd> próxima / última</li>
          <li><kbd>Q / E</kbd> inclinar</li>
          <li><kbd>C</kbd> agachar</li>
          <li><kbd>Espaço</kbd> (segurar) agarrar quina</li>
          <li><kbd>B</kbd> arsenal</li>
          <li><kbd>Esc</kbd> pausar</li>
        </ul>
        <p class="overlay-note">Balas infinitas nesta fase de teste</p>
        <p class="overlay-status"></p>
        <div class="overlay-maps">
          <span>Mapa</span>
          <button type="button" data-map="voxel">Pátio Voxel</button>
          <button type="button" data-map="hospital">Hospital</button>
        </div>
        <div class="overlay-actions"><button type="button" class="overlay-btn" data-open-settings>⚙ Configurações</button></div>
      </div>`;
    this.status = this.overlay.querySelector('.overlay-status')!;
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!btn.classList.contains('on')) this.onSelectMap(btn.dataset.map!);
      }),
    );
    this.overlay.querySelector('[data-open-settings]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onOpenSettings();
    });
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
    this.overlay.classList.toggle('hidden', !paused);
  }

  /** Mapa e servidor: mostrado só na tela de pausa. */
  setStatus(mapName: string, source: DataSource): void {
    const label = source === 'server' ? 'servidor online' : 'offline — dados locais';
    this.status.innerHTML = `<b>${mapName}</b> · <span class="${source}">${label}</span>`;
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

  /** Granada de atordoamento. */
  addBlind(amount: number): void {
    this.blind = Math.min(1.6, this.blind + amount * 1.6);
  }

  update(s: HudState, inspect: InspectView | null, dt: number): void {
    this.blind = Math.max(0, this.blind - dt * 0.45);
    this.flash.style.opacity = String(Math.min(1, this.blind));

    this.scope.classList.toggle('on', s.scoped);
    this.crosshair.style.setProperty('--gap', `${Math.round(s.crosshairGap)}px`);
    // mira e ponto de ADS seguem o mesmo desvio do braço (recuo + mola de tensão)
    const offset = `translate(${s.aimOffset[0].toFixed(1)}px, ${s.aimOffset[1].toFixed(1)}px)`;
    this.crosshair.style.transform = offset;
    this.adsDot.style.transform = offset;
    this.crosshair.classList.toggle('hidden', s.aiming || s.sprinting || s.scoped);
    this.adsDot.style.opacity = s.adsDot.toFixed(3);
    this.tunnel.style.setProperty('--f', s.tunnel.toFixed(3));
    this.hurtEl.style.opacity = s.hurt.toFixed(3);
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
    const key = `${v.count}|${v.reserve}`;
    if (key !== this.inspectKey) {
      this.inspectKey = key;
      this.inspectCount.textContent = String(v.count);
      this.inspectReserve.textContent = Number.isNaN(v.reserve) ? '' : `/ ${Number.isFinite(v.reserve) ? v.reserve : '∞'}`;
    }
    // entra e sai suavemente no começo/fim da inspeção
    const fade = Math.min(1, v.t / 0.1, (1 - v.t) / 0.12);
    this.inspect.style.opacity = String(Math.max(0, fade));
    this.inspect.style.transform = `translate(${v.x.toFixed(0)}px, ${v.y.toFixed(0)}px) scale(${(0.85 + 0.15 * fade).toFixed(3)})`;
  }
}
