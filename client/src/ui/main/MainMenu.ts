import { type GameMode, NET, sanitizeName, type TeamId } from '@shared/net/protocol';
import type { WeaponDef } from '@shared/weapons/types';
import './mainmenu.css';
import { MenuSoldier, type SquadMember } from './MenuSoldier';
import { ServerBrowser } from './ServerBrowser';

/** Centro do esquadrão (fração da largura): à direita no menu, à esquerda com a lista de servidores. */
const SQUAD_CENTER = { menu: 0.66, online: 0.27, narrow: 0.5 };
/** Aproximação da câmera nos soldados com a lista de servidores aberta. */
const SQUAD_ZOOM = 1.4;
/** Abaixo desta largura o layout empilha (sem deslocar o esquadrão). */
const NARROW = 720;

/** Mesma chave do menu online (o nome escolhido aqui já aparece lá). */
const NAME_KEY = 'fps.name';

const readName = (): string => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * Menu principal: barra com o nome do jogador, botões à esquerda (online, zumbis
 * solo, configurações) e, à direita, o esquadrão do jogo com armas sorteadas.
 * "Jogar Online" recolhe os botões, leva o esquadrão para a esquerda e mostra a
 * lista de servidores à direita.
 */
export class MainMenu {
  /** Entrar numa sala escolhida na lista (`room`: id, 'new' ou ausente = partida rápida). */
  onJoinOnline: (name: string, mode: GameMode, room?: string) => void = () => {};
  onPlaySolo: () => void = () => {};
  onSettings: () => void = () => {};

  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private soldier: MenuSoldier | null = null;
  private open = false;
  private online = false;
  private readonly servers: ServerBrowser;
  /** Soldados da vitrine (principal + 2): armas e uniforme sorteados uma vez por carregamento da página. */
  private readonly squad: SquadMember[];

  constructor(container: HTMLElement, catalog: readonly WeaponDef[]) {
    // três armas diferentes; o esquadrão inteiro com o mesmo uniforme
    const guns = catalog.filter((w) => w.kind === 'firearm').sort(() => Math.random() - 0.5);
    const team: TeamId = Math.random() < 0.5 ? 'green' : 'blue';
    this.squad = [0, 1, 2].map((i) => ({ weapon: guns[i % guns.length] ?? catalog[0], team }));
    this.root = document.createElement('div');
    this.root.className = 'main-menu';
    this.root.innerHTML = `
      <header class="mm-top">
        <label class="mm-name">
          <span>Nome do jogador</span>
          <input type="text" maxlength="${NET.maxNameLength}" spellcheck="false" autocomplete="off" placeholder="Soldado" />
        </label>
        <img class="mm-brand" src="/logo.svg" alt="TaticalBlocks" draggable="false" />
      </header>
      <div class="mm-body">
        <nav class="mm-actions">
          <button type="button" data-act="online"><span>Jogar Online</span><small>1v1 · 5v5 · 10v10 · 1×Todos · Gun Game</small></button>
          <button type="button" data-act="solo"><span>Jogar Zombie Solo</span><small>Ondas de zumbis no Pátio Voxel</small></button>
          <button type="button" data-act="settings"><span>Configuração</span><small>Gráficos, controles e áudio</small></button>
        </nav>
        <section class="mm-stage">
          <div class="mm-soldier"></div>
          <div class="mm-weapon"><small>Arma em destaque</small><b></b></div>
        </section>
      </div>`;
    container.appendChild(this.root);
    // palco atrás de tudo: o esquadrão anda de um lado para o outro pela área inteira
    const body = this.root.querySelector<HTMLElement>('.mm-body')!;
    body.prepend(this.root.querySelector('.mm-stage')!);
    this.servers = new ServerBrowser(body);
    this.servers.onClose = () => this.setOnline(false);
    this.servers.onJoin = (mode, room) => this.onJoinOnline(this.playerName, mode, room);
    window.addEventListener('resize', () => this.placeSquad(true));
    this.nameInput = this.root.querySelector('input')!;
    this.nameInput.value = readName();
    this.nameInput.addEventListener('input', () => {
      try {
        localStorage.setItem(NAME_KEY, sanitizeName(this.nameInput.value));
      } catch {
        /* sem armazenamento: só não lembra o nome */
      }
    });
    // o menu não pode virar "clique para jogar" (pointer lock) nem disparar teclas do jogo
    for (const ev of ['mousedown', 'click', 'keydown'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'online') this.setOnline(true);
      else if (act === 'solo') this.onPlaySolo();
      else if (act === 'settings') this.onSettings();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Nome digitado (já limpo). */
  get playerName(): string {
    return sanitizeName(this.nameInput.value);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.root.classList.toggle('on', open);
    if (open) {
      this.soldier ??= new MenuSoldier(this.root.querySelector('.mm-soldier')!, this.squad);
      this.root.querySelector('.mm-weapon b')!.textContent = this.squad[0].weapon.name;
      this.placeSquad(true);
    } else {
      // fora do menu o renderizador próprio não precisa existir
      this.setOnline(false);
      this.soldier?.dispose();
      this.soldier = null;
    }
  }

  /** Lista de servidores à direita (botões recolhem para a esquerda, esquadrão vai junto). */
  setOnline(on: boolean): void {
    if (on === this.online) return;
    this.online = on;
    this.root.classList.toggle('online', on);
    if (on) this.servers.start();
    else this.servers.stop();
    this.placeSquad(false);
  }

  private placeSquad(instant: boolean): void {
    const narrow = window.innerWidth < NARROW;
    this.soldier?.setCenter(narrow ? SQUAD_CENTER.narrow : this.online ? SQUAD_CENTER.online : SQUAD_CENTER.menu, instant);
    // com a lista de servidores a câmera aproxima dos soldados
    this.soldier?.setZoom(this.online && !narrow ? SQUAD_ZOOM : 1, instant);
  }

  /** Esconde temporariamente (ex.: configurações por cima) sem descartar o soldado. */
  setDimmed(dim: boolean): void {
    this.root.classList.toggle('dim', dim);
  }
}
