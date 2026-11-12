/** Configurações do jogador (salvas no navegador). */

export type GraphicsPreset = 'minimo' | 'baixo' | 'medio' | 'alto' | 'ultra' | 'personalizado';
export type ShadowQuality = 'desligado' | 'baixa' | 'media' | 'alta';
export type AoQuality = 'desligado' | 'baixa' | 'alta';
export type CloudSetting = 'desligado' | 'simples' | 'volumosas';
export type AntialiasSetting = 'desligado' | 'fxaa' | 'msaa';
export type FpsLimit = 0 | 30 | 60 | 120;
export type AimMode = 'segurar' | 'alternar';
export type LeanMode = 'segurar' | 'alternar' | 'desativado';

export interface GameSettings {
  graphics: {
    preset: GraphicsPreset;
    /** Escala de resolução (0.5 = metade dos pixels por lado). */
    renderScale: number;
    shadows: ShadowQuality;
    /** Reduz a resolução sozinho quando o FPS cai. */
    dynamicResolution: boolean;
    /**
     * Shaders: pós-processamento em HDR (névoa volumétrica, gradação de cor e curva de
     * filme). Desligado, o jogo desenha direto na tela e os efeitos abaixo não rodam.
     */
    shaders: boolean;
    /** Oclusão de ambiente (sombra de contato em cantos e frestas). */
    ao: AoQuality;
    /** Brilho que vaza das áreas claras (sol, fogo, clarão do tiro). */
    bloom: boolean;
    /** Raios de sol entre os blocos. */
    godRays: boolean;
    clouds: CloudSetting;
    antialias: AntialiasSetting;
    /** Limite de quadros por segundo (0 = sem limite). Não faz parte das predefinições. */
    fpsLimit: FpsLimit;
  };
  /** Multiplicador da sensibilidade do mouse. */
  sensitivity: number;
  /** Multiplicador extra ao mirar. */
  adsSensitivity: number;
  aimMode: AimMode;
  leanMode: LeanMode;
  /** Campo de visão vertical (graus). */
  fov: number;
}

type PresetId = Exclude<GraphicsPreset, 'personalizado'>;
/** Campos que NÃO pertencem à predefinição (o jogador escolhe à parte). */
type PresetValues = Omit<GameSettings['graphics'], 'dynamicResolution' | 'fpsLimit'>;

/**
 * Predefinições, do computador mais fraco ao mais forte:
 *  - mínimo/baixo: sem pós-processamento (desenho direto, como um jogo sem shaders);
 *  - médio: shaders básicos (névoa, cor, bloom) — placas integradas recentes;
 *  - alto/ultra: tudo ligado (oclusão, raios de sol, nuvens volumosas).
 */
export const GRAPHICS_PRESETS: Record<PresetId, PresetValues> = {
  minimo: { preset: 'minimo', renderScale: 0.5, shadows: 'desligado', shaders: false, ao: 'desligado', bloom: false, godRays: false, clouds: 'desligado', antialias: 'desligado' },
  baixo: { preset: 'baixo', renderScale: 0.7, shadows: 'baixa', shaders: false, ao: 'desligado', bloom: false, godRays: false, clouds: 'simples', antialias: 'desligado' },
  medio: { preset: 'medio', renderScale: 0.85, shadows: 'baixa', shaders: true, ao: 'desligado', bloom: true, godRays: false, clouds: 'simples', antialias: 'fxaa' },
  alto: { preset: 'alto', renderScale: 1, shadows: 'media', shaders: true, ao: 'baixa', bloom: true, godRays: true, clouds: 'volumosas', antialias: 'fxaa' },
  ultra: { preset: 'ultra', renderScale: 1, shadows: 'alta', shaders: true, ao: 'alta', bloom: true, godRays: true, clouds: 'volumosas', antialias: 'msaa' },
};

const PRESET_KEYS = ['renderScale', 'shadows', 'shaders', 'ao', 'bloom', 'godRays', 'clouds', 'antialias'] as const;

/** Qual predefinição bate com os valores atuais (ou "personalizado"). */
export function matchPreset(g: GameSettings['graphics']): GraphicsPreset {
  const hit = Object.values(GRAPHICS_PRESETS).find((p) => PRESET_KEYS.every((k) => p[k] === g[k]));
  return hit ? hit.preset : 'personalizado';
}

/** Nome da placa de vídeo informado pelo navegador (vazio se ele esconder). */
export function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 ...)" → só o modelo
    return name.replace(/^ANGLE \((?:[^,]+, )?/, '').replace(/( Direct3D| OpenGL|, D3D|\(0x| vs_).*$/i, '').replace(/\)$/, '').trim();
  } catch {
    return '';
  }
}

/**
 * Chute da predefinição pela placa de vídeo. É só o ponto de partida: a resolução
 * dinâmica corrige o resto em jogo, e o jogador pode mudar tudo no menu.
 */
export function detectPreset(gpu = gpuName()): PresetId {
  const g = gpu.toLowerCase();
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'minimo';
  if (mobile || /mali|adreno|powervr/.test(g)) return 'baixo';
  if (/rtx|rx [5-9]\d{3}|radeon pro|arc |apple m[2-9]|m[1-9] (pro|max|ultra)/.test(g)) return /rtx [3-9]0[6-9]0|rx [6-9][7-9]\d0|(max|ultra)/.test(g) ? 'ultra' : 'alto';
  if (/gtx (1[06]|9[78])\d0|apple m1|apple gpu/.test(g)) return 'alto';
  if (/iris|xe graphics|radeon.*(vega|graphics)|gtx|geforce|radeon|quadro/.test(g)) return 'medio';
  if (/intel|hd graphics|uhd/.test(g)) return 'baixo';
  return 'medio';
}

/** Tamanho do mapa de sombra por qualidade. */
export const SHADOW_MAP_SIZE: Record<ShadowQuality, number> = {
  desligado: 0,
  baixa: 1024,
  media: 2048,
  alta: 4096,
};

/** Efeitos de pós-processamento por qualidade. */
export const AO_LEVEL: Record<AoQuality, 0 | 1 | 2> = { desligado: 0, baixa: 1, alta: 2 };
export const CLOUD_LEVEL: Record<CloudSetting, 0 | 1 | 2> = { desligado: 0, simples: 1, volumosas: 2 };
export const ANTIALIAS_MODE: Record<AntialiasSetting, 'off' | 'fxaa' | 'msaa'> = { desligado: 'off', fxaa: 'fxaa', msaa: 'msaa' };

/** Gráficos de uma predefinição (mantendo o que não pertence a ela). */
export const presetGraphics = (id: PresetId, keep?: GameSettings['graphics']): GameSettings['graphics'] => ({
  ...GRAPHICS_PRESETS[id],
  dynamicResolution: keep?.dynamicResolution ?? true,
  fpsLimit: keep?.fpsLimit ?? 0,
});

/** Padrões: a qualidade vem da detecção da placa de vídeo. */
export const DEFAULT_SETTINGS: GameSettings = {
  graphics: presetGraphics(typeof document === 'undefined' ? 'medio' : detectPreset()),
  sensitivity: 1,
  adsSensitivity: 0.6,
  aimMode: 'segurar',
  leanMode: 'segurar',
  fov: 75,
};

export const LIMITS = {
  sensitivity: { min: 0.1, max: 3, step: 0.05 },
  adsSensitivity: { min: 0.2, max: 1.5, step: 0.05 },
  fov: { min: 60, max: 110, step: 1 },
  renderScale: { min: 0.5, max: 1, step: 0.05 },
} as const;

/**
 * FOV exibido no controle (60–110) → FOV real da câmera.
 * Até 75° (padrão) é igual; acima disso é comprimido para que o máximo exibido (110)
 * corresponda a 85% do antigo máximo (110 × 0,85 = 93,5°).
 */
export const FOV_MAX_EFFECTIVE = LIMITS.fov.max * 0.85;
const FOV_KNEE = 75;

export function effectiveFov(displayed: number): number {
  if (displayed <= FOV_KNEE) return displayed;
  const t = (displayed - FOV_KNEE) / (LIMITS.fov.max - FOV_KNEE);
  return FOV_KNEE + t * (FOV_MAX_EFFECTIVE - FOV_KNEE);
}

const KEY = 'fps.settings';

/** Guarda as configurações, valida o que vem do armazenamento e avisa quem estiver ouvindo. */
export class SettingsStore {
  private value: GameSettings;
  private readonly listeners = new Set<(s: GameSettings) => void>();

  constructor() {
    this.value = SettingsStore.load();
  }

  get(): GameSettings {
    return this.value;
  }

  subscribe(fn: (s: GameSettings) => void): () => void {
    this.listeners.add(fn);
    fn(this.value);
    return () => this.listeners.delete(fn);
  }

  update(patch: (draft: GameSettings) => void): void {
    const next = structuredClone(this.value);
    patch(next);
    this.value = SettingsStore.sanitize(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* armazenamento indisponível: vale só nesta sessão */
    }
    this.listeners.forEach((fn) => fn(this.value));
  }

  reset(): void {
    this.update((d) => Object.assign(d, structuredClone(DEFAULT_SETTINGS)));
  }

  private static load(): GameSettings {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return SettingsStore.sanitize({ ...structuredClone(DEFAULT_SETTINGS), ...(JSON.parse(raw) as Partial<GameSettings>) });
    } catch {
      /* ignora dados inválidos */
    }
    return structuredClone(DEFAULT_SETTINGS);
  }

  private static sanitize(s: GameSettings): GameSettings {
    const clamp = (v: unknown, l: { min: number; max: number }, d: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(l.max, Math.max(l.min, v)) : d;
    const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
    const g = s.graphics ?? DEFAULT_SETTINGS.graphics;
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    // configuração salva antes dos shaders existirem: completa com a predefinição que o jogador tinha
    const known = g.preset in GRAPHICS_PRESETS;
    const base = GRAPHICS_PRESETS[known ? (g.preset as PresetId) : DEFAULT_SETTINGS.graphics.shaders ? 'alto' : 'baixo'];
    // (e quem estava numa predefinição continua nela, com os valores novos)
    const legacy = known && typeof g.shaders !== 'boolean';
    const graphics: GameSettings['graphics'] = {
      preset: 'personalizado',
      renderScale: legacy ? base.renderScale : clamp(g.renderScale, LIMITS.renderScale, 1),
      shadows: legacy ? base.shadows : oneOf(g.shadows, ['desligado', 'baixa', 'media', 'alta'], base.shadows),
      dynamicResolution: bool(g.dynamicResolution, true),
      shaders: bool(g.shaders, base.shaders),
      ao: oneOf(g.ao, ['desligado', 'baixa', 'alta'], base.ao),
      bloom: bool(g.bloom, base.bloom),
      godRays: bool(g.godRays, base.godRays),
      clouds: oneOf(g.clouds, ['desligado', 'simples', 'volumosas'], base.clouds),
      antialias: oneOf(g.antialias, ['desligado', 'fxaa', 'msaa'], base.antialias),
      fpsLimit: ([0, 30, 60, 120] as const).includes(g.fpsLimit) ? g.fpsLimit : 0,
    };
    graphics.preset = matchPreset(graphics);
    return {
      graphics,
      sensitivity: clamp(s.sensitivity, LIMITS.sensitivity, 1),
      adsSensitivity: clamp(s.adsSensitivity, LIMITS.adsSensitivity, 0.6),
      aimMode: oneOf(s.aimMode, ['segurar', 'alternar'], 'segurar'),
      leanMode: oneOf(s.leanMode, ['segurar', 'alternar', 'desativado'], 'segurar'),
      fov: clamp(s.fov, LIMITS.fov, 75),
    };
  }
}
