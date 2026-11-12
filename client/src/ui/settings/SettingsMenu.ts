import {
  detectPreset,
  type GameSettings,
  gpuName,
  GRAPHICS_PRESETS,
  LIMITS,
  matchPreset,
  presetGraphics,
  type SettingsStore,
} from '../../settings/Settings';
import './settings.css';

type Path = 'sensitivity' | 'adsSensitivity' | 'fov' | 'renderScale';
type Graphics = GameSettings['graphics'];
type PresetId = keyof typeof GRAPHICS_PRESETS;

const SLIDERS: Record<Path, { label: string; hint: string; fmt: (v: number) => string }> = {
  renderScale: { label: 'Resolução', hint: 'Menor = mais desempenho', fmt: (v) => `${Math.round(v * 100)}%` },
  fov: { label: 'Campo de visão (FOV)', hint: 'Ângulo vertical da câmera', fmt: (v) => `${Math.round(v)}°` },
  sensitivity: { label: 'Sensibilidade', hint: 'Velocidade da câmera com o mouse', fmt: (v) => v.toFixed(2) },
  adsSensitivity: { label: 'Sensibilidade mirando', hint: 'Multiplicador ao mirar', fmt: (v) => `${Math.round(v * 100)}%` },
};

interface Choice {
  label: string;
  hint: string;
  options: readonly (readonly [value: string, text: string])[];
  get(s: GameSettings): string;
  set(d: GameSettings, value: string): void;
  /** Só tem efeito com os shaders ligados (a linha fica apagada sem eles). */
  needsShaders?: boolean;
}

const ON_OFF = [
  ['off', 'Desligado'],
  ['on', 'Ligado'],
] as const;

/** Opção de gráficos: grava o campo e recalcula qual predefinição bate. */
const gfx = <K extends keyof Graphics>(
  key: K,
  label: string,
  hint: string,
  options: Choice['options'],
  needsShaders = false,
): Choice => ({
  label,
  hint,
  options,
  needsShaders,
  get: (s) => {
    const v = s.graphics[key];
    return typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v);
  },
  set: (d, value) => {
    const g = d.graphics as Record<string, unknown>;
    g[key] = typeof d.graphics[key] === 'boolean' ? value === 'on' : typeof d.graphics[key] === 'number' ? Number(value) : value;
    d.graphics.preset = matchPreset(d.graphics);
  },
});

const CHOICES = {
  preset: {
    label: 'Qualidade',
    hint: 'Predefinição geral',
    options: [
      ['minimo', 'Mínimo'],
      ['baixo', 'Baixo'],
      ['medio', 'Médio'],
      ['alto', 'Alto'],
      ['ultra', 'Ultra'],
    ],
    get: (s) => s.graphics.preset,
    set: (d, v) => {
      d.graphics = presetGraphics(v as PresetId, d.graphics);
    },
  },
  dynamicResolution: gfx('dynamicResolution', 'Resolução dinâmica', 'Reduz a resolução sozinho quando o FPS cai', ON_OFF),
  fpsLimit: gfx('fpsLimit', 'Limite de FPS', 'Menos calor e bateria em notebooks', [
    ['30', '30'],
    ['60', '60'],
    ['120', '120'],
    ['0', 'Sem limite'],
  ]),
  shadows: gfx('shadows', 'Sombras', 'Resolução do mapa de sombras do sol', [
    ['desligado', 'Desligadas'],
    ['baixa', 'Baixa'],
    ['media', 'Média'],
    ['alta', 'Alta'],
  ]),
  clouds: gfx('clouds', 'Nuvens', 'Volumosas recebem luz e sombra do sol', [
    ['desligado', 'Céu limpo'],
    ['simples', 'Simples'],
    ['volumosas', 'Volumosas'],
  ]),
  shaders: gfx('shaders', 'Shaders', 'Luz em HDR, névoa volumétrica e cores de cinema', ON_OFF),
  ao: gfx('ao', 'Oclusão de ambiente', 'Sombra suave em cantos, frestas e no pé dos blocos', [
    ['desligado', 'Desligada'],
    ['baixa', 'Baixa'],
    ['alta', 'Alta'],
  ], true),
  godRays: gfx('godRays', 'Raios de sol', 'Feixes de luz passando entre os blocos', ON_OFF, true),
  bloom: gfx('bloom', 'Brilho (bloom)', 'Sol, fogo e tiros irradiam luz', ON_OFF, true),
  antialias: gfx('antialias', 'Suavização de serrilhado', 'FXAA é leve; MSAA 4× é mais nítido e mais pesado', [
    ['desligado', 'Desligada'],
    ['fxaa', 'FXAA'],
    ['msaa', 'MSAA 4×'],
  ], true),
  aimMode: {
    label: 'Mira (botão direito)',
    hint: 'Segurar para mirar ou clicar para alternar',
    options: [
      ['segurar', 'Segurar'],
      ['alternar', 'Clicar (alternar)'],
    ],
    get: (s) => s.aimMode,
    set: (d, v) => {
      d.aimMode = v as GameSettings['aimMode'];
    },
  },
  leanMode: {
    label: 'Inclinar (Q / E)',
    hint: 'Segurar, clicar para alternar ou desligar',
    options: [
      ['segurar', 'Segurar'],
      ['alternar', 'Clicar (alternar)'],
      ['desativado', 'Desativado'],
    ],
    get: (s) => s.leanMode,
    set: (d, v) => {
      d.leanMode = v as GameSettings['leanMode'];
    },
  },
} satisfies Record<string, Choice>;
type ChoiceKey = keyof typeof CHOICES;

const PRESET_NAMES: Record<PresetId, string> = { minimo: 'Mínimo', baixo: 'Baixo', medio: 'Médio', alto: 'Alto', ultra: 'Ultra' };

const read = (s: GameSettings, p: Path): number => (p === 'renderScale' ? s.graphics.renderScale : s[p]);

/** Menu de configurações (gráficos, shaders, câmera e controles). */
export class SettingsMenu {
  onClose: () => void = () => {};
  private readonly root: HTMLElement;
  private openState = false;
  private readonly gpu = gpuName();
  private readonly suggested = detectPreset(this.gpu);

  constructor(
    container: HTMLElement,
    private readonly store: SettingsStore,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'settings-menu';
    this.root.innerHTML = this.template();
    container.appendChild(this.root);

    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    store.subscribe((s) => this.sync(s));
  }

  get isOpen(): boolean {
    return this.openState;
  }

  setOpen(open: boolean): void {
    this.openState = open;
    this.root.classList.toggle('open', open);
  }

  private template(): string {
    const slider = (p: Path) => {
      const l = LIMITS[p];
      const m = SLIDERS[p];
      return `<label class="st-row">
        <span class="st-label">${m.label}<small>${m.hint}</small></span>
        <input type="range" data-slider="${p}" min="${l.min}" max="${l.max}" step="${l.step}" />
        <output data-out="${p}"></output>
      </label>`;
    };
    const choice = (k: ChoiceKey) => {
      const c: Choice = CHOICES[k];
      return `<div class="st-row"${c.needsShaders ? ' data-needs-shaders' : ''}>
        <span class="st-label">${c.label}<small>${c.hint}</small></span>
        <div class="st-seg" role="radiogroup">${c.options
          .map(([v, t]) => `<button type="button" data-choice="${k}" data-value="${v}">${t}</button>`)
          .join('')}</div>
      </div>`;
    };
    const escape = (t: string) => t.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    return `<div class="st-panel" role="dialog" aria-label="Configurações">
      <header class="st-head"><h2>CONFIGURAÇÕES</h2><kbd>Esc</kbd></header>
      <div class="st-body">
        <section><h3>Gráficos</h3>
          ${choice('preset')}
          <div class="st-detect">
            <span>${this.gpu ? `Placa de vídeo: <b>${escape(this.gpu)}</b> · ` : ''}recomendado: <b>${PRESET_NAMES[this.suggested]}</b></span>
            <button type="button" class="st-link" data-action="detect">Usar recomendado</button>
          </div>
          ${slider('renderScale')}
          ${choice('dynamicResolution')}
          ${choice('fpsLimit')}
          ${choice('shadows')}
          ${choice('clouds')}
        </section>
        <section><h3>Shaders</h3>
          ${choice('shaders')}
          ${choice('ao')}
          ${choice('godRays')}
          ${choice('bloom')}
          ${choice('antialias')}
        </section>
        <section><h3>Câmera</h3>
          ${slider('fov')}
        </section>
        <section><h3>Controles</h3>
          ${slider('sensitivity')}
          ${slider('adsSensitivity')}
          ${choice('aimMode')}
          ${choice('leanMode')}
        </section>
      </div>
      <footer class="st-foot">
        <button type="button" class="st-btn ghost" data-action="reset">Restaurar padrões</button>
        <button type="button" class="st-btn" data-action="close">Voltar</button>
      </footer>
    </div>`;
  }

  /** Reflete o estado atual nos controles (sem recriar, para não perder o arraste). */
  private sync(s: GameSettings): void {
    this.root.querySelectorAll<HTMLInputElement>('[data-slider]').forEach((el) => {
      const p = el.dataset.slider as Path;
      if (document.activeElement !== el) el.value = String(read(s, p));
      const out = this.root.querySelector<HTMLOutputElement>(`[data-out="${p}"]`);
      if (out) out.textContent = SLIDERS[p].fmt(read(s, p));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => {
      const c: Choice = CHOICES[b.dataset.choice as ChoiceKey];
      const on = c.get(s) === b.dataset.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    // sem shaders os efeitos de pós-processamento não rodam: as linhas ficam apagadas
    this.root.querySelectorAll<HTMLElement>('[data-needs-shaders]').forEach((row) => {
      row.classList.toggle('disabled', !s.graphics.shaders);
      row.querySelectorAll('button').forEach((b) => (b.disabled = !s.graphics.shaders));
    });
  }

  private readonly onInput = (e: Event): void => {
    const el = e.target as HTMLInputElement;
    const p = el.dataset.slider as Path | undefined;
    if (!p) return;
    const v = Number(el.value);
    this.store.update((d) => {
      if (p === 'renderScale') {
        d.graphics.renderScale = v;
        d.graphics.preset = matchPreset(d.graphics);
      } else d[p] = v;
    });
  };

  private readonly onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-choice],[data-action]');
    if (!t) return;
    if (t.dataset.action === 'close') return this.onClose();
    if (t.dataset.action === 'reset') return this.store.reset();
    if (t.dataset.action === 'detect') {
      return this.store.update((d) => {
        d.graphics = presetGraphics(this.suggested, d.graphics);
      });
    }
    const c: Choice = CHOICES[t.dataset.choice as ChoiceKey];
    const value = t.dataset.value!;
    this.store.update((d) => c.set(d, value));
  };
}
