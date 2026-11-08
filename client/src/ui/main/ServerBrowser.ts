import { type GameMode, MODES, type RoomInfo } from '@shared/net/protocol';
import { NetClient } from '../../online/NetClient';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PHASE = { warmup: 'aguardando', countdown: 'começando', playing: 'em jogo', ended: 'fim de partida' } as const;
/** Intervalo de atualização da lista (s). */
const REFRESH = 3;

/**
 * Lista de servidores online dentro do menu principal: todas as salas de todos os
 * modos, modo para partida rápida/criar sala e entrar. Só consulta a lista; entrar
 * abre o jogo online já indo para a sala escolhida.
 */
export class ServerBrowser {
  /** Entrar: `room` = id da sala, `'new'` = criar, ausente = partida rápida. */
  onJoin: (mode: GameMode, room?: string) => void = () => {};
  onClose: () => void = () => {};

  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private net: NetClient | null = null;
  private timer = 0;
  private mode: GameMode = '1v1';
  private rooms: RoomInfo[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'mm-servers';
    this.root.innerHTML = `
      <header class="mm-servers-head">
        <b>Servidores online</b>
        <span class="mm-servers-count"></span>
        <button type="button" class="mm-servers-close" data-act="close" title="Voltar" aria-label="Voltar">—</button>
      </header>
      <div class="mm-servers-modes">${(Object.keys(MODES) as GameMode[])
        .map((m) => `<button type="button" data-mode="${m}" title="${MODES[m].label}">${MODES[m].short}</button>`)
        .join('')}</div>
      <div class="mm-servers-actions">
        <button type="button" class="primary" data-act="quick">Partida rápida</button>
        <button type="button" data-act="create">Criar sala</button>
      </div>
      <div class="mm-servers-list"></div>
      <p class="mm-servers-status"></p>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.mm-servers-list')!;
    this.status = this.root.querySelector('.mm-servers-status')!;
    this.root.addEventListener('click', this.onClick);
    this.setMode('1v1');
  }

  /** Abre: conecta e começa a atualizar a lista. */
  start(): void {
    this.setStatus('Conectando…');
    this.net ??= this.connect();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refresh(), REFRESH * 1000);
  }

  /** Fecha: para de atualizar e desconecta. */
  stop(): void {
    window.clearInterval(this.timer);
    this.net?.close();
    this.net = null;
  }

  private connect(): NetClient {
    const net = new NetClient();
    net.on('rooms', ({ rooms }) => {
      this.rooms = rooms;
      this.setStatus('');
      this.render();
    });
    net.onClose = () => {
      if (this.net === net) this.setStatus('Conexão com o servidor perdida — tentando de novo…', true);
      if (this.net === net) this.net = null;
    };
    net
      .connect()
      .then(() => this.refresh())
      .catch((e: Error) => {
        if (this.net === net) this.net = null;
        this.setStatus(e.message, true);
      });
    return net;
  }

  private refresh(): void {
    if (!this.net) this.net = this.connect();
    else if (this.net.connected) this.net.send('rooms', {});
  }

  private setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  private setMode(mode: GameMode): void {
    this.mode = mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  }

  /** Todas as salas de todos os modos, agrupadas por modo e mais cheias primeiro. */
  private render(): void {
    const order = Object.keys(MODES) as GameMode[];
    const rooms = [...this.rooms].sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode) || b.players - a.players);
    const players = rooms.reduce((n, r) => n + r.players, 0);
    this.root.querySelector('.mm-servers-count')!.textContent = `${rooms.length} ${rooms.length === 1 ? 'sala' : 'salas'} · ${players} ${players === 1 ? 'jogador' : 'jogadores'}`;
    this.list.innerHTML = rooms.length
      ? rooms
          .map(
            (r) => `<div class="mm-room${r.players >= r.max ? ' full' : ''}">
              <b>${esc(r.name)}</b>
              <em class="om-tag" data-mode="${r.mode}">${MODES[r.mode]?.label ?? r.mode}</em>
              <span class="mm-room-fill"><i style="transform:scaleX(${(r.players / r.max).toFixed(3)})"></i></span>
              <span>${r.players}/${r.max} · ${PHASE[r.phase]}</span>
              <button type="button" data-room="${esc(r.id)}" data-room-mode="${r.mode}" ${r.players >= r.max ? 'disabled' : ''}>Entrar</button>
            </div>`,
          )
          .join('')
      : `<p class="mm-servers-empty">Nenhuma sala aberta — crie uma ou use a partida rápida.</p>`;
  }

  private readonly onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.mode) return this.setMode(t.dataset.mode as GameMode);
    if (t.dataset.room) return this.onJoin((t.dataset.roomMode as GameMode) ?? this.mode, t.dataset.room);
    if (t.dataset.act === 'quick') return this.onJoin(this.mode);
    if (t.dataset.act === 'create') return this.onJoin(this.mode, 'new');
    if (t.dataset.act === 'close') return this.onClose();
  };
}
