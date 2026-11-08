/**
 * Protocolo do modo online (WebSocket em `/server`, mesma porta da API).
 * Mensagens em JSON no formato `{ event, data }` (padrão do WsAdapter do Nest).
 */

export const NET = {
  /** Caminho do WebSocket. */
  path: '/server',
  /** Snapshots do servidor por segundo. */
  tickRate: 20,
  /** Estados enviados pelo cliente por segundo. */
  sendRate: 20,
  /** Atraso de interpolação dos outros jogadores (s). */
  interpDelay: 0.1,
  /** Tempo até renascer (s). */
  respawnTime: 3,
  /** Invulnerável (e semitransparente para os outros) logo após nascer (s): evita spawn kill. */
  spawnProtection: 3,
  /** Contagem antes de cada partida (s): o mapa é restaurado e ninguém se mexe. */
  countdown: 3,
  /** Duração de uma partida (s). */
  matchTime: 600,
  /** Placar final na tela antes da próxima partida (s). */
  endTime: 10,
  maxNameLength: 16,
} as const;

export type GameMode = '1v1' | '5v5' | '10v10' | 'ffa' | 'gungame';
export type TeamId = 'green' | 'blue';

/**
 * Escada do Gun Game: cada abate passa para a próxima arma; a última etapa é a
 * faca — quem matar com ela vence. Abate de faca rebaixa a vítima um nível.
 */
export const GUNGAME_LADDER: readonly string[] = ['m4a1', 'ak47', 'hk416', 'mp7', 'p90', 'r870', 'aa12', 'sr25', 'awm', 'm249', 'revolver', 'g17', 'knife'];

/**
 * Modos: por times (1v1, 5v5, 10v10), "1 contra todos" (cada um por si) e
 * Gun Game (cada um por si, arma imposta pelo servidor).
 */
export const MODES: Record<GameMode, { teams: boolean; max: number; scoreLimit: number; label: string; short: string }> = {
  '1v1': { teams: true, max: 2, scoreLimit: 10, label: '1 contra 1', short: '1v1' },
  '5v5': { teams: true, max: 10, scoreLimit: 40, label: '5 contra 5', short: '5v5' },
  '10v10': { teams: true, max: 20, scoreLimit: 75, label: '10 contra 10', short: '10v10' },
  ffa: { teams: false, max: 12, scoreLimit: 20, label: '1 contra todos', short: '1×Todos' },
  gungame: { teams: false, max: 12, scoreLimit: GUNGAME_LADDER.length, label: 'Gun Game', short: 'Gun Game' },
};

export const TEAM_LABEL: Record<TeamId, string> = { green: 'Verde', blue: 'Azul' };

/** Bits de `PlayerState.flags`. */
export const FLAG = {
  crouch: 1,
  sprint: 2,
  aim: 4,
  ground: 8,
  reload: 16,
  slide: 32,
} as const;

export type Vec3Tuple = [number, number, number];

/** Estado que o cliente envia (~20×/s) e o servidor repassa nos snapshots. */
export interface PlayerState {
  /** Posição dos pés. */
  p: Vec3Tuple;
  /** Velocidade. */
  v: Vec3Tuple;
  yaw: number;
  pitch: number;
  /** −1..1 (Q/E). */
  lean: number;
  /** 0..1. */
  crouch: number;
  flags: number;
  /** Arma na mão (id do catálogo) ou null. */
  weapon: string | null;
  /** Acessórios da arma na mão ("holo,suppressor,..."). */
  att?: string;
}

/** `countdown`: 3-2-1 antes de começar (mapa restaurado, jogadores parados). */
export type MatchPhase = 'warmup' | 'countdown' | 'playing' | 'ended';

export interface PlayerInfo {
  id: string;
  name: string;
  /** Nos modos sem times só define a cor do uniforme. */
  team: TeamId;
  kills: number;
  deaths: number;
  alive: boolean;
  hp: number;
  /** Gun Game: índice na escada de armas. */
  level?: number;
}

export interface MatchInfo {
  phase: MatchPhase;
  score: Record<TeamId, number>;
  /** Segundos restantes na fase atual. */
  timeLeft: number;
  scoreLimit: number;
  winner?: TeamId | 'draw';
  /** Modos sem times: líder atual (abates ou nível) e o vencedor. */
  leader?: { id: string; name: string; value: number };
  winnerId?: string;
  winnerName?: string;
}

export interface RoomInfo {
  id: string;
  name: string;
  mode: GameMode;
  players: number;
  max: number;
  phase: MatchPhase;
}

// ───────────── cliente → servidor ─────────────
export interface ClientEvents {
  hello: { name: string };
  rooms: Record<string, never>;
  /** `room`: id de uma sala; 'new' cria; ausente = partida rápida no modo. */
  join: { mode: GameMode; room?: string };
  leave: Record<string, never>;
  state: PlayerState;
  /** Disparo (um por gatilho; `pellets` balins para escopetas). */
  shot: { id: number; weapon: string; origin: Vec3Tuple; dir: Vec3Tuple; pellets: number };
  /** Acerto de um disparo (`shot`) ou golpe corpo a corpo (`shot` = −1). */
  hit: { shot: number; weapon: string; target: string; zone: string; point: Vec3Tuple };
  /** Impacto no cenário destrutível (repassado para os outros reproduzirem). */
  impact: { point: Vec3Tuple; dir: Vec3Tuple; damage: number };
  /** Projétil lançado (foguete/granada 40 mm) ou arremessado (granadas). */
  projectile: { id: number; weapon: string; kind: 'launch' | 'throw'; origin: Vec3Tuple; vel: Vec3Tuple; fuse: number | null };
  /** O projétil do próprio jogador detonou (o servidor calcula o dano). */
  explode: { id: number; pos: Vec3Tuple };
  ping: { t: number };
}

// ───────────── servidor → cliente ─────────────
export interface ServerEvents {
  welcome: { id: string; name: string };
  rooms: { rooms: RoomInfo[] };
  joined: { room: RoomInfo; you: PlayerInfo; players: PlayerInfo[]; match: MatchInfo; spawn: { p: Vec3Tuple; yaw: number } };
  playerJoined: { player: PlayerInfo };
  playerLeft: { id: string };
  /** `t`: tempo do servidor (s). */
  snapshot: { t: number; players: { id: string; s: PlayerState }[] };
  shot: { by: string; weapon: string; origin: Vec3Tuple; dir: Vec3Tuple };
  impact: { by: string; point: Vec3Tuple; dir: Vec3Tuple; damage: number };
  projectile: { by: string; weapon: string; kind: 'launch' | 'throw'; origin: Vec3Tuple; vel: Vec3Tuple; fuse: number | null };
  damage: { target: string; by: string; zone: string; amount: number; hp: number; point: Vec3Tuple | null };
  kill: { killer: string; victim: string; weapon: string; zone: string; dir: Vec3Tuple };
  respawn: { id: string; p: Vec3Tuple; yaw: number };
  match: MatchInfo;
  scores: { players: PlayerInfo[] };
  pong: { t: number; server: number };
  /** Gun Game: nível e arma do jogador (o cliente troca a arma na mão). */
  gungame: { level: number; weapon: string; next: string | null; demoted?: boolean };
  error: { message: string };
}

export type ClientMessage = { [K in keyof ClientEvents]: { event: K; data: ClientEvents[K] } }[keyof ClientEvents];
export type ServerMessage = { [K in keyof ServerEvents]: { event: K; data: ServerEvents[K] } }[keyof ServerEvents];

/** Nome de jogador seguro: só letras, números, espaço e _-. (1–16). */
export function sanitizeName(raw: unknown): string {
  const s = String(raw ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NET.maxNameLength);
  return s || 'Jogador';
}
