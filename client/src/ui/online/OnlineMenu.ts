import { type GameMode, MODES, type RoomInfo, sanitizeName } from '@shared/net/protocol';

const NAME_KEY = 'fps.name';

const MODE_DESC: Record<GameMode, string> = {
  '1v1': 'Duelo: Verde × Azul, primeiro a 10 abates.',
  '5v5': 'Times de 5: primeiro time a 40 abates.',
  '10v10': 'Times de 10: primeiro time a 75 abates.',
  ffa: 'Cada um por si (até 12): primeiro a 20 abates vence.',
  gungame: 'Cada abate troca sua arma pela próxima da escada; termine com a faca. Faca rebaixa a vítima.',
  zombies: 'Cooperativo (até 5): sobreviva juntos às ondas de zumbis, até 64 ao mesmo tempo.',
};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Tela de entrada do online: nome, modo (1v1/5v5/10v10) e salas. */
export class OnlineMenu {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly nameInput: HTMLInputElement;
  private mode: GameMode = '1v1';
  private rooms: RoomInfo[] = [];
  onJoin: (name: string, mode: GameMode, room?: string) => void = () => {};
  onRefresh: () => void = () => {};
  onOffline: () => void = () => {};

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'online-menu';
    const saved = (() => {
      try {
        return localStorage.getItem(NAME_KEY) ?? '';
      } catch {
        return '';
      }
    })();
    this.root.innerHTML = `
      <div class="om-card">
        <h2>JOGAR ONLINE</h2>
        <p class="om-sub">Pátio Voxel · times, 1 contra todos ou Gun Game</p>
        <label class="om-name">Seu nome<input maxlength="16" placeholder="Jogador" autocomplete="off" spellcheck="false" /></label>
        <div class="om-modes">${(Object.keys(MODES) as GameMode[]).map((m) => `<button type="button" data-mode="${m}" title="${MODES[m].label}">${MODES[m].short}</button>`).join('')}</div>
        <p class="om-mode-desc"></p>
        <div class="om-actions">
          <button type="button" class="primary" data-action="quick">Partida rápida</button>
          <button type="button" data-action="create">Criar sala</button>
        </div>
        <h3>Todas as salas</h3>
        <div class="om-list"></div>
        <p class="om-status"></p>
        <button type="button" class="om-back" data-action="offline">← Voltar ao menu principal</button>
      </div>`;
    container.appendChild(this.root);
    this.list = this.root.querySelector('.om-list')!;
    this.status = this.root.querySelector('.om-status')!;
    this.nameInput = this.root.querySelector('input')!;
    this.nameInput.value = saved;
    this.nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.addEventListener('click', this.onClick);
    this.setMode('1v1');
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle('hidden', !open);
    if (open) this.onRefresh();
  }

  setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  setRooms(rooms: RoomInfo[]): void {
    this.rooms = rooms;
    this.renderRooms();
  }

  private setMode(mode: GameMode): void {
    this.mode = mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    this.root.querySelector('.om-mode-desc')!.textContent = MODE_DESC[mode];
    this.renderRooms();
  }

  /** Lista completa: todas as salas de todos os modos (o modo escolhido só vale para criar/partida rápida). */
  private renderRooms(): void {
    const order = Object.keys(MODES) as GameMode[];
    const rooms = [...this.rooms].sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode) || b.players - a.players);
    const phase = { warmup: 'aguardando', countdown: 'começando', playing: 'em jogo', ended: 'fim de partida' } as const;
    this.list.innerHTML = rooms.length
      ? rooms
          .map(
            (r) => `<div class="om-room"><b>${esc(r.name)}</b><em class="om-tag" data-mode="${r.mode}">${MODES[r.mode]?.label ?? r.mode}</em><span>${r.players}/${r.max} · ${phase[r.phase]}</span>
              <button type="button" data-room="${esc(r.id)}" data-room-mode="${r.mode}" ${r.players >= r.max ? 'disabled' : ''}>Entrar</button></div>`,
          )
          .join('')
      : `<p class="om-empty">Nenhuma sala aberta — crie uma ou use a partida rápida.</p>`;
  }

  /** Nome do campo (limpo e salvo). */
  get playerName(): string {
    return this.name();
  }

  private name(): string {
    const name = sanitizeName(this.nameInput.value);
    this.nameInput.value = name;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* sem armazenamento */
    }
    return name;
  }

  private readonly onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.mode) return this.setMode(t.dataset.mode as GameMode);
    if (t.dataset.room) return this.onJoin(this.name(), (t.dataset.roomMode as GameMode) ?? this.mode, t.dataset.room);
    if (t.dataset.action === 'quick') return this.onJoin(this.name(), this.mode);
    if (t.dataset.action === 'create') return this.onJoin(this.name(), this.mode, 'new');
    if (t.dataset.action === 'offline') return this.onOffline();
  };
}
