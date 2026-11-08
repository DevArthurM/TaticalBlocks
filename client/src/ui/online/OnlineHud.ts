import { PLAYER_ZONE_LABEL, type PlayerZone } from '@shared/net/damage';
import { GUNGAME_LADDER, type MatchInfo, type PlayerInfo, TEAM_LABEL, type TeamId } from '@shared/net/protocol';
import { findWeapon } from '@shared/weapons/catalog';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** HUD do modo online: placar, abates, marcador de acerto, tabela (Tab), nomes, vida e morte. */
export class OnlineHud {
  private readonly root: HTMLDivElement;
  private readonly scorebar: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private readonly tags: HTMLDivElement;
  private readonly hp: HTMLDivElement;
  private readonly death: HTMLDivElement;
  private readonly tagEls = new Map<string, HTMLDivElement>();
  private match: MatchInfo | null = null;
  private matchAt = 0;
  private hitTimer = 0;
  private myTeam: TeamId = 'blue';
  ping = 0;
  /** Modo por times (placar Verde × Azul) ou cada um por si (líder × você). */
  teams = true;
  gungame = false;
  myId = '';
  /** Valor do jogador local (abates ou nível) para o placar. */
  myValue = 0;
  private readonly gg: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'online-hud';
    this.root.innerHTML = `
      <div class="ol-scorebar"></div>
      <div class="ol-feed"></div>
      <div class="ol-hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="ol-tags"></div>
      <div class="ol-hp"><span></span><b></b></div>
      <div class="ol-death hidden"></div>
      <div class="ol-board hidden"></div>
      <div class="ol-gg hidden"></div>
      <div class="ol-result"></div>
      <div class="ol-protect"></div>`;
    container.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.scorebar = q('.ol-scorebar');
    this.feed = q('.ol-feed');
    this.hitmarker = q('.ol-hitmarker');
    this.board = q('.ol-board');
    this.tags = q('.ol-tags');
    this.hp = q('.ol-hp');
    this.death = q('.ol-death');
    this.gg = q('.ol-gg');
    this.result = q('.ol-result');
    this.protect = q('.ol-protect');
  }

  private readonly result: HTMLDivElement;
  private readonly protect: HTMLDivElement;
  private resultKey = '';
  /** "VALENDO!" depois do 3-2-1 (s restantes). */
  private goTimer = 0;
  private lastPhase = '';
  /** Fim da proteção do jogador local (performance.now em s). */
  private protectedUntil = 0;

  /** Jogador local renasceu protegido por `seconds`. */
  setProtected(seconds: number): void {
    this.protectedUntil = performance.now() / 1000 + seconds;
  }

  /**
   * Letreiro grande no centro: VITÓRIA/DERROTA/EMPATE no fim, 3-2-1 na contagem e
   * "VALENDO!" quando começa.
   */
  private updateResult(m: MatchInfo, left: number, dt: number): void {
    if (this.lastPhase === 'countdown' && m.phase === 'playing') this.goTimer = 0.9;
    this.lastPhase = m.phase;
    this.goTimer = Math.max(0, this.goTimer - dt);
    let kind = '';
    let title = '';
    let sub = '';
    if (m.phase === 'ended') {
      const won = this.teams ? m.winner !== 'draw' && m.winner === this.myTeam : m.winnerId === this.myId;
      const draw = this.teams ? m.winner === 'draw' : !m.winnerId;
      kind = draw ? 'draw' : won ? 'win' : 'lose';
      title = draw ? 'EMPATE' : won ? 'VITÓRIA' : 'DERROTA';
      sub = this.teams
        ? `${TEAM_LABEL.green} ${m.score.green} × ${m.score.blue} ${TEAM_LABEL.blue}`
        : !won && m.winnerName
          ? `${esc(m.winnerName)} venceu`
          : 'você venceu a partida';
      sub += ` · nova partida em ${Math.ceil(left)} s`;
    } else if (m.phase === 'countdown') {
      kind = 'count';
      title = String(Math.max(1, Math.ceil(left)));
      sub = 'mapa restaurado · prepare-se';
    } else if (this.goTimer > 0) {
      kind = 'go';
      title = 'VALENDO!';
    }
    const key = `${kind}|${title}|${sub}`;
    if (key !== this.resultKey) {
      this.resultKey = key;
      this.result.className = `ol-result ${kind ? `on ${kind}` : ''}`;
      // a cada número/título novo a animação recomeça
      this.result.innerHTML = kind ? `<b>${title}</b>${sub ? `<small>${sub}</small>` : ''}` : '';
    }
    const p = this.protectedUntil - performance.now() / 1000;
    this.protect.classList.toggle('on', p > 0 && m.phase === 'playing');
    if (p > 0) this.protect.textContent = `PROTEGIDO · ${Math.ceil(p)}`;
  }

  /** Gun Game: arma atual e próxima. */
  setGunGame(level: number, weapon: string, next: string | null): void {
    const name = (id: string | null) => (id ? (findWeapon(id)?.name ?? id) : '');
    this.myValue = level + 1;
    this.gg.classList.remove('hidden');
    this.gg.innerHTML = `Nível <b>${level + 1}/${GUNGAME_LADDER.length}</b> · ${esc(name(weapon))}${next ? ` <span>→ ${esc(name(next))}</span>` : ' <span>— última etapa!</span>'}`;
  }

  setTeam(team: TeamId): void {
    this.myTeam = team;
    this.root.dataset.team = team;
  }

  setMatch(m: MatchInfo): void {
    this.match = m;
    this.matchAt = performance.now() / 1000;
  }

  /** Atualiza o placar/tempo (chamado a cada quadro). */
  update(dt: number): void {
    const m = this.match;
    if (m) {
      const left = Math.max(0, m.timeLeft - (performance.now() / 1000 - this.matchAt));
      this.updateResult(m, left, dt);
      let center = fmtTime(left);
      let note = `primeiro a ${m.scoreLimit}`;
      if (!this.teams) {
        // cada um por si: líder × você
        const unit = this.gungame ? 'nível' : 'abates';
        note = this.gungame ? `termine com a faca (${m.scoreLimit} níveis)` : `primeiro a ${m.scoreLimit}`;
        if (m.phase === 'warmup') {
          center = 'AQUECIMENTO';
          note = 'aguardando mais jogadores';
        } else if (m.phase === 'countdown') {
          center = 'COMEÇANDO';
          note = 'mapa restaurado';
        } else if (m.phase === 'ended') {
          center = m.winnerId === this.myId ? 'VITÓRIA' : m.winnerName ? `${esc(m.winnerName).toUpperCase()} VENCEU` : 'FIM';
          note = `próxima partida em ${Math.ceil(left)} s`;
        }
        const lead = m.leader;
        this.scorebar.innerHTML = `
          <span class="team lead">${lead ? `${esc(lead.name)} <b>${lead.value}</b>` : '—'}<small>líder · ${unit}</small></span>
          <span class="clock">${center}<small>${note}</small></span>
          <span class="team you"><b>${this.myValue}</b> Você<small>${unit}</small></span>`;
        this.hitTimer = Math.max(0, this.hitTimer - dt);
        this.hitmarker.style.opacity = String(Math.min(1, this.hitTimer / 0.12));
        return;
      }
      if (m.phase === 'warmup') {
        center = 'AQUECIMENTO';
        note = 'aguardando o time adversário';
      } else if (m.phase === 'countdown') {
        center = 'COMEÇANDO';
        note = 'mapa restaurado';
      } else if (m.phase === 'ended') {
        center = m.winner === 'draw' ? 'EMPATE' : m.winner === this.myTeam ? 'VITÓRIA' : 'DERROTA';
        note = `próxima partida em ${Math.ceil(left)} s`;
      }
      this.scorebar.innerHTML = `
        <span class="team green">${TEAM_LABEL.green} <b>${m.score.green}</b></span>
        <span class="clock">${center}<small>${note}</small></span>
        <span class="team blue"><b>${m.score.blue}</b> ${TEAM_LABEL.blue}</span>`;
    }
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.hitmarker.style.opacity = String(Math.min(1, this.hitTimer / 0.12));
  }

  setHealth(hp: number): void {
    const v = Math.max(0, Math.round(hp));
    this.hp.querySelector('span')!.textContent = String(v);
    (this.hp.querySelector('b') as HTMLElement).style.width = `${v}%`;
    this.hp.classList.toggle('low', v <= 30);
  }

  /** Marcador de acerto; `kill` e `head` mudam a cor/tamanho. */
  hit(head: boolean, kill: boolean): void {
    this.hitTimer = kill ? 0.45 : 0.22;
    this.hitmarker.className = `ol-hitmarker${head ? ' head' : ''}${kill ? ' kill' : ''}`;
  }

  kill(killer: PlayerInfo | undefined, victim: PlayerInfo | undefined, weapon: string, zone: string, mine: boolean): void {
    const row = document.createElement('div');
    row.className = `ol-kill${mine ? ' mine' : ''}`;
    const name = (p?: PlayerInfo) => (p ? `<b class="${p.team}">${esc(p.name)}</b>` : '<b>?</b>');
    const wname = findWeapon(weapon)?.name ?? weapon;
    const head = zone === 'head' ? ' <em>na cabeça</em>' : '';
    row.innerHTML = killer?.id === victim?.id ? `${name(victim)} <span>se matou</span>` : `${name(killer)} <span>[${esc(wname)}]</span> ${name(victim)}${head}`;
    this.feed.prepend(row);
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 5600);
    while (this.feed.children.length > 6) this.feed.lastElementChild!.remove();
  }

  /** Tela de morte com contagem regressiva. */
  showDeath(by: PlayerInfo | undefined, weapon: string, zone: string, seconds: number): void {
    const wname = findWeapon(weapon)?.name ?? weapon;
    const where = PLAYER_ZONE_LABEL[zone as PlayerZone] ?? zone;
    this.death.innerHTML = `<b>ABATIDO</b><span>${by ? `por <b class="${by.team}">${esc(by.name)}</b> · ${esc(wname)} · ${where}` : ''}</span><small>renascendo em <i>${seconds}</i></small>`;
    this.death.classList.remove('hidden');
    let left = seconds;
    const timer = setInterval(() => {
      left--;
      const i = this.death.querySelector('i');
      if (i) i.textContent = String(Math.max(0, left));
      if (left <= 0) clearInterval(timer);
    }, 1000);
  }

  hideDeath(): void {
    this.death.classList.add('hidden');
  }

  /** Tabela de jogadores (segurar Tab). */
  setBoard(open: boolean, players: PlayerInfo[], myId: string): void {
    this.board.classList.toggle('hidden', !open);
    if (!open) return;
    if (!this.teams) {
      // cada um por si: uma lista só, por nível (Gun Game) ou abates
      const list = [...players].sort((a, b) => (this.gungame ? (b.level ?? 0) - (a.level ?? 0) : 0) || b.kills - a.kills || a.deaths - b.deaths);
      const head = this.gungame ? '<th>Nível</th><th>A</th><th>M</th>' : '<th>A</th><th>M</th>';
      const rows = list
        .map(
          (p, i) =>
            `<tr class="${p.id === myId ? 'me' : ''}${p.alive ? '' : ' dead'}"><td>${i + 1}. ${esc(p.name)}</td>${this.gungame ? `<td>${(p.level ?? 0) + 1}</td>` : ''}<td>${p.kills}</td><td>${p.deaths}</td></tr>`,
        )
        .join('');
      this.board.innerHTML = `<div class="cols single"><div class="col"><h4>${this.gungame ? 'Gun Game' : '1 contra todos'}</h4><table><tr><th>Jogador</th>${head}</tr>${rows}</table></div></div><p>ping ${this.ping} ms</p>`;
      return;
    }
    const col = (team: TeamId) => {
      const list = players.filter((p) => p.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const rows = list
        .map((p) => `<tr class="${p.id === myId ? 'me' : ''}${p.alive ? '' : ' dead'}"><td>${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`)
        .join('');
      return `<div class="col ${team}"><h4>${TEAM_LABEL[team]} <b>${this.match?.score[team] ?? 0}</b></h4><table><tr><th>Jogador</th><th>A</th><th>M</th></tr>${rows}</table></div>`;
    };
    this.board.innerHTML = `<div class="cols">${col('green')}${col('blue')}</div><p>ping ${this.ping} ms</p>`;
  }

  /** Etiquetas de nome (posição de tela; null = esconder). */
  setTag(id: string, name: string, team: TeamId, screen: { x: number; y: number } | null): void {
    let el = this.tagEls.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'ol-tag';
      this.tags.appendChild(el);
      this.tagEls.set(id, el);
    }
    if (!screen) {
      el.style.display = 'none';
      return;
    }
    if (el.textContent !== name) el.textContent = name;
    el.dataset.team = team;
    el.style.display = '';
    el.style.transform = `translate(${screen.x.toFixed(0)}px, ${screen.y.toFixed(0)}px) translate(-50%, -100%)`;
  }

  removeTag(id: string): void {
    this.tagEls.get(id)?.remove();
    this.tagEls.delete(id);
  }
}
