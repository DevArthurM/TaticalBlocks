import { type Clip, type Cue, type Ease, type Key, type HandValue, type Vec6, Z, add, h, k, scale6 } from './Clip';

/**
 * Recargas personalizadas de cada arma.
 * Tempo normalizado 0..1 (escalado pela duração real da recarga).
 *
 * Linguagem dos movimentos (o que deixa a recarga "gostosa"):
 *  - antecipação: a arma recua um pouco para o lado oposto antes de inclinar;
 *  - encaixes com `slam` (aceleram até bater) e o tranco fica por conta das marcas
 *    de som — o Viewmodel dá um impulso numa mola a cada `magIn`, `chargeRelease` etc.;
 *  - o pente novo sobe até alinhar, PARA um instante e só então é empurrado;
 *  - a volta ao quadril passa um pouco do ponto e assenta;
 *  - nas armas de pente a arma sobe e rola com o alojamento do pente virado para a
 *    câmera (rz negativo): a troca do pente acontece à vista, não abaixo da tela.
 */

export type ReloadAnim =
  /** `tactical`: recarga com bala na câmara (sem manejo). Sem ela, usa `clip` com as chaves `empty` filtradas. */
  | { kind: 'magazine'; clip: Clip; tactical?: Clip }
  | { kind: 'shell'; start: Clip; insert: Clip; end: Clip };

type TimeMap = (t: number) => number;
const SAME: TimeMap = (t) => t;
/**
 * Recarga tática: pula o trecho [a, b] (manejo do ferrolho) e estica a troca do pente
 * até `to`; o fim do clipe ocupa o resto.
 */
const skip =
  (a: number, b: number, to = 0.8): TimeMap =>
  (t) =>
    t <= a ? (t * to) / a : to + ((t - b) / (1 - b)) * (1 - to);

/** Antecipação: leve recuo para o lado oposto antes de ir para `tilt`. */
const windup = (T: TimeMap, tilt: Vec6, t0: number, t1: number): Key<Vec6>[] => [k(0), k(T(t0), scale6(tilt, -0.1), 'out'), k(T(t1), tilt, 'back')];
/** Volta ao quadril: passa um pouco do ponto e assenta. */
const settle = (tilt: Vec6, t: number, e: Ease = 'inOut'): Key<Vec6>[] => [k(t, scale6(tilt, -0.07), e), k(1, Z, 'inOut')];
/** A arma "olha" para o pente enquanto a mão busca o novo. */
const PEEK: Vec6 = [0, 0.005, 0.006, 0.03, 0.02, 0.05];
/**
 * A recarga acontece DENTRO do quadro: a arma sobe e o cano levanta, trazendo o
 * alojamento do pente (e a mão que troca o pente) para a parte visível da tela.
 */
const LIFT: Vec6 = [-0.012, 0.05, 0.02, 0.1, 0, 0];
/** Sacudida que joga o pente vazio para fora. */
const FLICK: Vec6 = [0.012, 0.012, 0, 0.03, 0, 0.17];

// ═════════════════════ PISTOLAS ═════════════════════
interface PistolReload {
  tilt: Vec6;
  drop: number;
  rack: 'overhand' | 'slingshot' | 'release';
  /** Tapa com a palma ao inserir o pente. */
  slap?: boolean;
}

function pistolClip(o: PistolReload, empty: boolean): Clip {
  const T = empty ? SAME : skip(0.66, 0.88, 0.82);
  const travel = 0.032;
  // pistola: vem para perto do centro, com a base do punho virada para a mão que traz o pente
  const tilt = add(o.tilt, [-0.035, 0.06, 0.03, 0.14, 0, 0]);
  const back: Vec6 = [0, 0, travel, 0, 0, 0];
  const pulling = empty && o.rack !== 'release';
  // manejo do ferrolho: a pistola volta a ficar quase em pé
  const rackPose: Vec6 = o.rack === 'slingshot' ? [0.02, 0.012, -0.02, 0.1, -0.2, 0.3] : o.rack === 'overhand' ? [0, 0.012, 0.01, 0.07, -0.1, 0.25] : [0, 0.006, 0, 0.04, -0.05, 0.14];
  // pente novo alinhado logo abaixo do punho, esperando o empurrão
  const aligned: Vec6 = [0, -0.07, 0.012, 0.1, 0, 0];

  const left: Key<HandValue>[] = [
    h(0, 'support'),
    h(T(0.1), 'support'),
    h(T(0.28), 'low', 'inOut'),
    h(T(0.42), 'low'),
    h(T(0.53), 'mag', 'out'),
    h(T(0.62), 'mag'),
  ];
  if (pulling) left.push(h(0.745, 'slide', 'inOut'), h(0.8, 'slide'), h(0.835, 'slide', 'out', false, [0.01, 0.012, 0.055]));
  left.push(h(T(0.94), 'support', 'inOut'), h(1, 'support'));

  const cues: Cue[] = [
    { t: T(0.16), sound: 'magOut' },
    { t: T(0.58), sound: 'magIn', kick: o.slap ? [0, 0.024, 0, -0.11, 0, 0.04] : undefined },
    { t: T(0.94), kick: [0, 0.003, 0.003, 0.014, 0, -0.01] },
  ];
  if (pulling) cues.push({ t: 0.78, sound: 'slideBack' }, { t: 0.825, sound: 'slideRelease' });
  else if (empty) cues.push({ t: 0.825, sound: 'slideRelease' });

  return {
    pose: [
      ...windup(T, tilt, 0.04, 0.15),
      ...(empty ? [k(0.19, add(tilt, FLICK), 'snap'), k(0.27, tilt)] : []),
      k(T(0.42), add(tilt, PEEK)),
      k(T(0.55), tilt),
      k(T(0.66), tilt),
      ...(empty ? [k(0.745, add(tilt, rackPose)), k(0.84, add(tilt, rackPose))] : []),
      ...settle(tilt, T(0.95)),
    ],
    parts: [
      {
        part: 'mag',
        keys: [
          k(0),
          k(T(0.15)),
          k(T(0.33), [0, -o.drop, 0.02, 0.3, 0, 0], 'in'),
          k(T(0.42), [0, -0.3, 0.05, 0.35, 0, 0], 'linear'),
          k(T(0.53), aligned, 'out'),
          k(T(0.555), aligned),
          k(T(0.58), Z, 'slam'),
        ],
      },
      ...(empty
        ? [
            {
              part: 'slide' as const,
              keys: pulling
                ? [k(0, back), k(0.77, back), k(0.805, [0, 0, travel + 0.005, 0, 0, 0], 'out'), k(0.825, Z, 'slam')]
                : [k(0, back), k(0.81, back), k(0.825, Z, 'slam')],
            },
          ]
        : []),
    ],
    vis: [{ part: 'mag', hide: [[T(0.335), T(0.42)]] }],
    left,
    cues,
  };
}

// ═════════════════════ REVÓLVER ═════════════════════
/**
 * Revólver: abre o tambor, aponta para cima e as cápsulas caem no chão;
 * depois a mão leva bala a bala até a câmara (um ciclo por bala faltante) e fecha.
 */
function revolverShellReload(): Omit<Extract<ReloadAnim, { kind: 'shell' }>, 'kind'> {
  const open: Vec6 = [-0.01, 0, 0, 0, 0, 1.3];
  // arma trazida para o centro e para cima, com o tambor virado para o jogador
  const up: Vec6 = [-0.06, 0.1, 0.05, 0.95, -0.1, 0.5];
  const load: Vec6 = [-0.07, 0.085, 0.06, 0.28, -0.25, 0.65];
  return {
    start: {
      pose: [
        k(0),
        k(0.25, [-0.06, 0.07, 0.05, 0.25, -0.15, 0.55], 'out'),
        k(0.45, up, 'inOut'),
        // tranco: a vareta empurra o extrator e as cápsulas caem
        k(0.55, add(up, [0, 0.025, 0, 0.2, 0, 0]), 'out'),
        k(0.65, up, 'inOut'),
        k(1, load, 'inOut'),
      ],
      parts: [{ part: 'cylinder', keys: [k(0), k(0.2), k(0.32, open, 'out'), k(1, open)] }],
      left: [h(0, 'support'), h(0.18, 'cylinder', 'inOut'), h(0.6, 'cylinder'), h(1, 'low', 'inOut')],
      cues: [
        { t: 0.26, sound: 'cylinderOpen' },
        { t: 0.55, sound: 'casings', event: 'ejectAll' },
      ],
    },
    insert: {
      pose: [k(0, load), k(0.45, add(load, [0, 0.003, 0, 0.015, 0, 0.03])), k(0.72, load), k(1, load)],
      parts: [
        { part: 'cylinder', keys: [k(0, open)] },
        // bala sobe do bolso, alinha atrás da câmara e entra
        { part: 'shell', keys: [k(0, [-0.07, -0.16, 0.1, 0.6, 0, 0]), k(0.5, [0, 0, 0.035, 0, 0, 0], 'out'), k(0.6, [0, 0, 0.035, 0, 0, 0]), k(0.75, Z, 'slam')] },
      ],
      vis: [{ part: 'shell', show: [[0, 0.78]] }],
      left: [h(0, 'low'), h(0.15, 'shell', 'inOut'), h(0.75, 'shell'), h(1, 'low', 'inOut')],
      cues: [{ t: 0.74, sound: 'shellInsert' }],
    },
    end: {
      pose: [k(0, load), k(0.35, up, 'inOut'), k(0.5, add(up, [0, 0, 0, 0, 0, -0.25]), 'snap'), ...settle(up, 0.9)],
      parts: [{ part: 'cylinder', keys: [k(0, open), k(0.35, open), k(0.5, Z, 'slam')] }],
      left: [h(0, 'low'), h(0.3, 'cylinder', 'inOut'), h(0.5, 'cylinder'), h(0.9, 'support', 'inOut'), h(1, 'support')],
      cues: [{ t: 0.5, sound: 'cylinderClose' }],
    },
  };
}

// ═════════════════════ PENTES (SMG / FUZIL) ═════════════════════
interface BoxMagReload {
  tilt: Vec6;
  /** Para onde o pente velho vai. */
  magOut: Vec6;
  /** Onde o pente novo alinha antes de entrar. */
  magIn: Vec6;
  /** De onde o pente novo aparece (padrão: de baixo, vindo do colete). */
  fetch?: Vec6;
  /** A mão puxa o pente (true) ou ele cai sozinho (false). */
  grab: boolean;
  charge: 'pull' | 'slap' | 'catch' | 'none';
  chargeTravel?: Vec6;
  /** Manejo só quando vazia. */
  chargeEmptyOnly?: boolean;
  /** Quanto a arma sobe para a recarga caber no quadro (padrão: `LIFT`). */
  lift?: Vec6;
  /** Tranco ao encaixar o pente (pico; padrão = o do som `magIn`). */
  insertJolt?: Vec6;
}

function boxMagClip(o: BoxMagReload, empty: boolean): Clip {
  const charging = o.charge !== 'none' && (empty || o.chargeEmptyOnly === false);
  const T = charging ? SAME : skip(0.66, 0.86);
  const tilt = add(o.tilt, o.lift ?? LIFT);
  const travel = o.chargeTravel ?? [0, 0, 0.06, 0, 0, 0];
  const charge = charging ? o.charge : 'none';
  // "slap" (HK): a alavanca é travada atrás ANTES da troca e solta com um tapa no fim
  const slap = charge === 'slap';
  const outAt = o.grab ? 0.2 : 0.16;
  const fetch = o.fetch ?? add(o.magIn, [0, -0.2, 0.06, 0.3, 0, 0]);
  // manejo: a arma volta a ficar quase em pé para a mão alcançar a alavanca
  const look: Vec6 = charge === 'pull' ? [0.01, 0.008, 0, 0.03, -0.06, 0.22] : charge === 'slap' ? [0, 0.006, 0, 0.02, -0.04, 0.16] : [0, 0.004, 0, 0.02, -0.06, 0.12];

  const left: Key<HandValue>[] = [h(0, 'support')];
  if (slap) left.push(h(0.03, 'support'), h(0.085, 'charging', 'inOut'), h(0.135, 'charging'));
  if (o.grab) left.push(...(slap ? [] : [h(T(0.1), 'support')]), h(T(0.2), 'mag', 'inOut'), h(T(0.31), 'mag'), h(T(0.4), 'low', 'inOut'));
  else left.push(...(slap ? [] : [h(T(0.14), 'support')]), h(T(0.3), 'low', 'inOut'));
  left.push(h(T(0.42), 'low'), h(T(0.54), 'mag', 'out'), h(T(0.62), 'mag'));
  if (charge === 'pull') left.push(h(0.74, 'charging', 'inOut'), h(0.82, 'charging'));
  else if (slap) left.push(h(0.72, 'charging', 'inOut', false, [0, 0.05, 0.02]), h(0.755, 'charging', 'inOut', false, [0, 0.055, 0.02]), h(0.775, 'charging', 'slam'), h(0.81, 'charging', 'out', false, [0, -0.035, 0]));
  else if (charge === 'catch') left.push(h(0.74, 'mag', 'inOut', false, [-0.015, 0.08, 0.02]), h(0.78, 'mag', 'slam', false, [0, 0.06, 0]));
  left.push(h(T(0.94), 'support', 'inOut'), h(1, 'support'));

  const cues: Cue[] = [
    { t: T(outAt + 0.01), sound: 'magOut' },
    { t: T(0.6), sound: 'magIn', kick: o.insertJolt },
    { t: T(0.94), kick: [0, 0.003, 0.004, 0.014, 0, -0.012] },
  ];
  if (charge === 'pull') cues.push({ t: 0.765, sound: 'chargeBack' }, { t: 0.815, sound: 'chargeRelease' });
  else if (slap) cues.push({ t: 0.11, sound: 'chargeBack' }, { t: 0.775, sound: 'chargeRelease' });
  else if (charge === 'catch') cues.push({ t: 0.78, sound: 'slideRelease' });

  const chargeKeys =
    charge === 'pull'
      ? [k(0), k(0.75), k(0.79, travel, 'out'), k(0.815, Z, 'slam')]
      : slap
        ? [k(0), k(0.09), k(0.135, travel, 'out'), k(0.755, travel), k(0.775, Z, 'slam')]
        : [];

  return {
    pose: [
      ...windup(T, tilt, 0.05, 0.16),
      // pente solto pelo retém: uma sacudida joga o vazio para fora
      ...(!o.grab && empty && !slap ? [k(T(0.2), add(tilt, FLICK), 'snap'), k(T(0.28), tilt)] : []),
      k(T(0.42), add(tilt, PEEK)),
      k(T(0.56), tilt),
      k(T(0.66), tilt),
      ...(charging ? [k(0.735, add(tilt, look)), k(0.85, add(tilt, look))] : []),
      ...settle(tilt, T(0.96)),
    ],
    parts: [
      {
        part: 'mag',
        keys: [k(0), k(T(outAt)), k(T(0.31), o.magOut, o.grab ? 'inOut' : 'in'), k(T(0.42), fetch, 'linear'), k(T(0.54), o.magIn, 'out'), k(T(0.57), o.magIn), k(T(0.6), Z, 'slam')],
      },
      { part: 'charging', keys: chargeKeys },
    ],
    vis: [{ part: 'mag', hide: [[T(0.315), T(0.42)]] }],
    left,
    cues,
  };
}

// ═════════════════════ CARTUCHO A CARTUCHO ═════════════════════
function pumpShellReload(): Omit<Extract<ReloadAnim, { kind: 'shell' }>, 'kind'> {
  const tilt: Vec6 = [-0.03, 0.03, 0.02, 0.18, -0.08, -0.55];
  return {
    start: {
      pose: [k(0), k(0.25, scale6(tilt, -0.1), 'out'), k(1, tilt, 'back')],
      left: [h(0, 'support'), h(0.3, 'support'), h(1, 'low', 'inOut')],
    },
    insert: {
      pose: [k(0, tilt), k(0.4, add(tilt, [0, 0.003, 0, 0.012, 0, -0.03])), k(0.7, tilt), k(1, tilt)],
      parts: [{ part: 'shell', keys: [k(0, [-0.06, -0.12, 0.08, 0, 0, 0]), k(0.5, Z, 'out'), k(0.6, Z), k(0.74, [0, 0.0, -0.06, 0, 0, 0], 'slam')] }],
      vis: [{ part: 'shell', show: [[0, 0.76]] }],
      left: [h(0, 'low'), h(0.15, 'shell', 'inOut'), h(0.75, 'shell'), h(1, 'low', 'inOut')],
      cues: [{ t: 0.72, sound: 'shellInsert' }],
    },
    end: {
      pose: [k(0, tilt), k(0.42, scale6(tilt, -0.07), 'inOut'), k(0.52, Z)],
      parts: [{ part: 'pump', keys: [k(0), k(0.48, Z, 'linear', true), k(0.6, [0, 0, 0.085, 0, 0, 0], 'snap', true), k(0.7, [0, 0, 0.085, 0, 0, 0], 'linear', true), k(0.8, Z, 'slam', true)] }],
      left: [h(0, 'low'), h(0.4, 'support', 'inOut'), h(1, 'support')],
      cues: [
        { t: 0.56, sound: 'pumpBack', empty: true },
        { t: 0.8, sound: 'pumpForward', empty: true },
      ],
    },
  };
}

const BOLT_OPEN: Vec6 = [0, 0, 0.08, 0, 0, 0];
const HANDLE_UP: Vec6 = [0, 0, 0, 0, 0, 1.1];

function huntingShellReload(): Omit<Extract<ReloadAnim, { kind: 'shell' }>, 'kind'> {
  const tilt: Vec6 = [-0.02, 0.03, 0.02, 0.1, -0.05, -0.35];
  return {
    // 1) só a mão direita: levanta a alavanca e puxa o ferrolho — o estojo é ejetado.
    //    A mão de apoio continua no guarda-mão até o ferrolho estar todo aberto.
    start: {
      pose: [k(0), k(0.08, scale6(tilt, -0.1), 'out'), k(0.3, tilt, 'back'), k(1, tilt)],
      right: [h(0, 'grip'), h(0.28, 'bolt', 'inOut'), h(1, 'bolt')],
      parts: [
        { part: 'boltHandle', keys: [k(0), k(0.3), k(0.46, HANDLE_UP, 'snap'), k(1, HANDLE_UP)] },
        { part: 'bolt', keys: [k(0), k(0.52), k(0.76, BOLT_OPEN, 'slam'), k(1, BOLT_OPEN)] },
      ],
      left: [h(0, 'support'), h(1, 'support')],
      cues: [
        { t: 0.45, sound: 'boltUp' },
        { t: 0.74, sound: 'boltBack' },
        { t: 0.78, event: 'eject' },
      ],
    },
    // 2) com o ferrolho aberto: a mão de apoio vai ao bolso, pega o cartucho e o empurra na janela
    insert: {
      pose: [k(0, tilt), k(0.5, add(tilt, [0, 0.003, 0, 0.012, 0, 0.03])), k(0.74, tilt), k(1, tilt)],
      right: [h(0, 'bolt'), h(1, 'bolt')],
      parts: [
        { part: 'boltHandle', keys: [k(0, HANDLE_UP)] },
        { part: 'bolt', keys: [k(0, BOLT_OPEN)] },
        { part: 'shell', keys: [k(0, [-0.06, -0.08, 0.05, 0, 0, 0]), k(0.25, [-0.06, -0.08, 0.05, 0, 0, 0]), k(0.58, [0, 0.01, 0, 0, 0, 0], 'out'), k(0.66, [0, 0.01, 0, 0, 0, 0]), k(0.77, [0, -0.02, 0, 0, 0, 0], 'slam')] },
      ],
      vis: [{ part: 'shell', show: [[0.22, 0.8]] }],
      left: [h(0, 'support'), h(0.22, 'low', 'inOut'), h(0.3, 'shell', 'inOut'), h(0.78, 'shell'), h(1, 'support', 'inOut')],
      cues: [{ t: 0.75, sound: 'shellInsert' }],
    },
    end: {
      pose: [k(0, tilt), k(0.55, tilt), ...settle(tilt, 0.9)],
      right: [h(0, 'bolt'), h(0.55, 'bolt'), h(0.9, 'grip', 'inOut'), h(1, 'grip')],
      parts: [
        { part: 'bolt', keys: [k(0, BOLT_OPEN), k(0.06, BOLT_OPEN), k(0.29, Z, 'slam')] },
        { part: 'boltHandle', keys: [k(0, HANDLE_UP), k(0.33, HANDLE_UP), k(0.5, Z, 'slam')] },
      ],
      left: [h(0, 'support'), h(1, 'support')],
      cues: [
        { t: 0.28, sound: 'boltForward' },
        { t: 0.5, sound: 'boltDown' },
      ],
    },
  };
}

function launcherShellReload(): Omit<Extract<ReloadAnim, { kind: 'shell' }>, 'kind'> {
  const tilt: Vec6 = [-0.04, 0.04, 0.03, 0.15, -0.1, 0.55];
  const open: Vec6 = [-0.05, -0.015, 0, 0, 0, 0];
  return {
    start: {
      pose: [k(0), k(0.08, scale6(tilt, -0.1), 'out'), k(0.35, tilt, 'back'), k(1, tilt)],
      parts: [{ part: 'cylinder', keys: [k(0), k(0.3), k(0.6, open, 'back'), k(1, open)] }],
      left: [h(0, 'support'), h(0.3, 'cylinder', 'inOut'), h(0.6, 'cylinder'), h(1, 'low', 'inOut')],
      cues: [{ t: 0.5, sound: 'cylinderOpen' }],
    },
    insert: {
      pose: [k(0, tilt), k(0.7, tilt), k(0.8, add(tilt, [0, 0, 0, 0, 0, 0.06]), 'out'), k(1, tilt)],
      parts: [
        { part: 'cylinder', keys: [k(0, open), k(0.78, open), k(1, add(open, [0, 0, 0, 0, 0, 0.3]), 'out')] },
        { part: 'shell', keys: [k(0, [-0.12, -0.14, 0.12, 0, 0, 0]), k(0.5, [-0.05, -0.0, 0.04, 0, 0, 0], 'out'), k(0.58, [-0.05, -0.0, 0.04, 0, 0, 0]), k(0.71, [-0.05, -0.0, -0.02, 0, 0, 0], 'slam')] },
      ],
      vis: [{ part: 'shell', show: [[0, 0.74]] }],
      left: [h(0, 'low'), h(0.15, 'shell', 'inOut'), h(0.72, 'shell'), h(1, 'low', 'inOut')],
      cues: [{ t: 0.7, sound: 'shellInsert' }],
    },
    end: {
      pose: [k(0, tilt), k(0.42, tilt), k(0.52, add(tilt, [0, 0, 0, 0, 0, -0.2]), 'snap'), ...settle(tilt, 0.9)],
      parts: [{ part: 'cylinder', keys: [k(0, open), k(0.3, open), k(0.5, Z, 'slam')] }],
      left: [h(0, 'low'), h(0.3, 'cylinder', 'inOut'), h(0.5, 'cylinder'), h(0.9, 'support', 'inOut'), h(1, 'support')],
      cues: [{ t: 0.5, sound: 'cylinderClose' }],
    },
  };
}

// ═════════════════════ ESPECIAIS ═════════════════════
function awmReload(): Clip {
  const tilt: Vec6 = [-0.04, 0.07, 0.04, 0.18, 0.08, -0.4];
  return {
    pose: [k(0), k(0.03, scale6(tilt, -0.1), 'out'), k(0.11, tilt, 'back'), k(0.34, add(tilt, PEEK)), k(0.5, tilt), k(0.62, [0, 0.01, 0, 0.05, 0, -0.15]), k(0.9, [0, 0.01, 0, 0.05, 0, -0.15]), k(0.97, [0, -0.002, 0, -0.008, 0, 0.012]), k(1, Z)],
    parts: [
      { part: 'mag', keys: [k(0), k(0.14), k(0.28, [0, -0.2, 0.02, 0.1, 0, 0], 'inOut'), k(0.36, [0, -0.3, 0.05, 0.2, 0, 0], 'linear'), k(0.45, [0, -0.07, 0, 0, 0, 0], 'out'), k(0.475, [0, -0.07, 0, 0, 0, 0]), k(0.5, Z, 'slam')] },
      { part: 'boltHandle', keys: [k(0), k(0.66), k(0.7, HANDLE_UP, 'snap'), k(0.85, HANDLE_UP), k(0.89, Z, 'slam')] },
      { part: 'bolt', keys: [k(0), k(0.71), k(0.765, BOLT_OPEN, 'slam'), k(0.79, BOLT_OPEN), k(0.835, Z, 'slam')] },
    ],
    vis: [{ part: 'mag', hide: [[0.29, 0.36]] }],
    left: [h(0, 'support'), h(0.14, 'mag', 'inOut'), h(0.28, 'mag'), h(0.34, 'low', 'inOut'), h(0.36, 'low'), h(0.45, 'mag', 'out'), h(0.53, 'mag'), h(0.62, 'support', 'inOut'), h(1, 'support')],
    right: [h(0, 'grip'), h(0.6, 'grip'), h(0.66, 'bolt', 'inOut'), h(0.89, 'bolt'), h(0.96, 'grip', 'inOut')],
    cues: [
      { t: 0.18, sound: 'magOut' },
      { t: 0.5, sound: 'magIn' },
      { t: 0.7, sound: 'boltUp' },
      { t: 0.76, sound: 'boltBack', event: 'eject' },
      { t: 0.83, sound: 'boltForward' },
      { t: 0.88, sound: 'boltDown' },
    ],
  };
}

function m249Reload(): Clip {
  const tilt: Vec6 = [-0.03, 0.04, 0.02, 0.05, -0.05, 0.25];
  const open: Vec6 = [0, 0, 0, 0.95, 0, 0];
  return {
    pose: [k(0), k(0.025, scale6(tilt, -0.1), 'out'), k(0.08, tilt, 'back'), k(0.4, add(tilt, PEEK)), k(0.6, tilt), k(0.9, tilt), ...settle(tilt, 0.97)],
    parts: [
      { part: 'cover', keys: [k(0), k(0.08), k(0.16, open, 'back'), k(0.74, open), k(0.8, Z, 'slam')] },
      { part: 'mag', keys: [k(0), k(0.2), k(0.34, [-0.06, -0.3, 0.04, 0, 0, 0.3], 'inOut'), k(0.46, [-0.12, -0.25, 0.05, 0, 0, 0.3], 'linear'), k(0.56, [-0.02, -0.05, 0, 0, 0, 0.08], 'out'), k(0.575, [-0.02, -0.05, 0, 0, 0, 0.08]), k(0.6, Z, 'slam')] },
      { part: 'belt', keys: [k(0), k(0.6, [0, -0.04, 0, 0, 0, 0]), k(0.7, Z, 'out')] },
      { part: 'charging', keys: [k(0), k(0.86), k(0.895, [0, 0, 0.08, 0, 0, 0], 'out'), k(0.92, Z, 'slam')] },
    ],
    vis: [{ part: 'mag', hide: [[0.35, 0.46]] }],
    left: [
      h(0, 'support'),
      h(0.07, 'cover', 'inOut'),
      h(0.16, 'cover'),
      h(0.22, 'mag', 'inOut'),
      h(0.34, 'mag'),
      h(0.42, 'low'),
      h(0.48, 'mag', 'inOut'),
      h(0.6, 'mag'),
      h(0.66, 'cover', 'inOut', false, [0, -0.02, 0.06]),
      h(0.72, 'cover', 'inOut'),
      h(0.8, 'cover', 'in'),
      h(0.85, 'charging', 'inOut'),
      h(0.92, 'charging'),
      h(1, 'support', 'inOut'),
    ],
    cues: [
      { t: 0.12, sound: 'coverOpen' },
      { t: 0.26, sound: 'magOut' },
      { t: 0.58, sound: 'magIn' },
      { t: 0.68, sound: 'beltIn' },
      { t: 0.8, sound: 'coverClose' },
      { t: 0.88, sound: 'chargeBack' },
      { t: 0.92, sound: 'chargeRelease' },
    ],
  };
}

function minigunReload(): Clip {
  const tilt: Vec6 = [0.01, 0.05, 0.02, 0.08, 0.1, -0.2];
  return {
    pose: [k(0), k(0.03, scale6(tilt, -0.1), 'out'), k(0.1, tilt, 'back'), k(0.4, add(tilt, PEEK)), k(0.64, tilt), k(0.86, tilt), ...settle(tilt, 0.96)],
    parts: [
      { part: 'mag', keys: [k(0), k(0.15), k(0.34, [-0.05, -0.32, 0.05, 0, 0, 0.4], 'in'), k(0.48, [-0.15, -0.26, 0.06, 0, 0, 0.2], 'linear'), k(0.61, [-0.02, -0.05, 0, 0, 0, 0.05], 'out'), k(0.63, [-0.02, -0.05, 0, 0, 0, 0.05]), k(0.66, Z, 'slam')] },
      { part: 'belt', keys: [k(0), k(0.66, [0.01, -0.03, 0, 0, 0, 0]), k(0.74, Z, 'back')] },
      { part: 'barrels', keys: [k(0), k(0.78), k(1, [0, 0, 0, 0, 0, 2.5], 'out')] },
    ],
    vis: [{ part: 'mag', hide: [[0.35, 0.48]] }],
    left: [h(0, 'support'), h(0.15, 'mag', 'inOut'), h(0.3, 'mag'), h(0.42, 'low'), h(0.5, 'mag', 'inOut'), h(0.7, 'mag'), h(0.86, 'support', 'inOut'), h(1, 'support')],
    cues: [
      { t: 0.22, sound: 'magOut' },
      { t: 0.66, sound: 'magIn' },
      { t: 0.73, sound: 'beltIn' },
      { t: 0.8, sound: 'spinUp' },
    ],
  };
}

function rpgReload(): Clip {
  const tilt: Vec6 = [-0.07, 0.03, -0.04, 0.3, 0.12, 0.12];
  return {
    pose: [k(0), k(0.04, scale6(tilt, -0.1), 'out'), k(0.15, tilt, 'back'), k(0.8, tilt), ...settle(tilt, 0.95)],
    parts: [{ part: 'rocket', keys: [k(0, [0, -0.28, -0.1, 0.5, 0, 0]), k(0.3, [0, -0.28, -0.1, 0.5, 0, 0]), k(0.55, [0, 0.0, -0.14, 0, 0, 0], 'out'), k(0.6, [0, 0.0, -0.14, 0, 0, 0]), k(0.72, Z, 'slam')] }],
    vis: [{ part: 'rocket', show: [[0.3, 1]] }],
    left: [h(0, 'support'), h(0.22, 'low', 'inOut'), h(0.32, 'rocket', 'inOut'), h(0.74, 'rocket'), h(0.9, 'support', 'inOut'), h(1, 'support')],
    cues: [
      { t: 0.45, sound: 'rocketSlide' },
      { t: 0.72, sound: 'rocketLoad' },
    ],
  };
}

// ═════════════════════ REGISTRO ═════════════════════
const mag = (clip: Clip): ReloadAnim => ({ kind: 'magazine', clip });
const pistolReload = (o: PistolReload): ReloadAnim => ({ kind: 'magazine', clip: pistolClip(o, true), tactical: pistolClip(o, false) });
const boxMagReload = (o: BoxMagReload): ReloadAnim => ({ kind: 'magazine', clip: boxMagClip(o, true), tactical: boxMagClip(o, false) });

export const RELOADS: Record<string, ReloadAnim> = {
  // pistolas — cada uma com inclinação e forma de manejar o ferrolho diferentes
  g17: pistolReload({ tilt: [-0.03, 0.03, 0.01, 0.25, 0.1, -0.5], drop: 0.3, rack: 'overhand' }),
  g17_inox: pistolReload({ tilt: [-0.02, 0.025, 0, 0.15, 0.3, -0.35], drop: 0.32, rack: 'release' }),
  g34: pistolReload({ tilt: [-0.045, 0.04, 0.02, 0.35, 0.05, -0.75], drop: 0.34, rack: 'slingshot' }),
  g19_fde: pistolReload({ tilt: [-0.05, 0.015, 0.01, -0.12, 0.18, -0.42], drop: 0.36, rack: 'overhand', slap: true }),
  revolver: { kind: 'shell', ...revolverShellReload() },

  // submetralhadoras
  mp7: boxMagReload({ tilt: [-0.03, 0.03, 0.02, 0.2, 0.1, -0.45], magOut: [0, -0.25, 0.04, 0.2, 0, 0], magIn: [0, -0.12, 0.02, 0.1, 0, 0], grab: false, charge: 'pull', chargeTravel: [0, 0, 0.05, 0, 0, 0] }),
  mp5k: boxMagReload({ tilt: [-0.04, 0.035, 0.02, 0.25, 0.15, -0.55], magOut: [0, -0.18, -0.05, 0.6, 0, 0], magIn: [0, -0.1, -0.06, 0.5, 0, 0], grab: true, charge: 'slap', chargeTravel: [0, 0.008, 0.07, 0, 0, 0], chargeEmptyOnly: false, insertJolt: [0, 0.02, 0, -0.1, 0, 0] }),
  tmp: boxMagReload({ tilt: [-0.02, 0.03, 0.01, 0.15, 0.2, -0.3], magOut: [0, -0.22, 0.02, 0.0, 0, 0], magIn: [0, -0.12, 0.0, 0, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.05, 0, 0, 0] }),
  mac10: boxMagReload({ tilt: [-0.05, 0.02, 0.02, -0.05, 0.15, -0.55], magOut: [0, -0.3, 0.0, 0.0, 0, 0], magIn: [0, -0.15, 0.0, 0, 0, 0], grab: false, charge: 'pull', chargeTravel: [0, 0, 0.07, 0, 0, 0], insertJolt: [0, 0.025, 0, -0.12, 0, 0] }),
  ump45: boxMagReload({ tilt: [-0.04, 0.03, 0.02, 0.2, 0.1, -0.5], magOut: [0, -0.2, -0.02, 0.15, 0, 0], magIn: [0, -0.12, -0.02, 0.1, 0, 0], grab: true, charge: 'slap', chargeTravel: [0, 0.006, 0.06, 0, 0, 0] }),
  p90: boxMagReload({ tilt: [0.02, 0.04, 0.03, 0.05, 0.25, -0.85], magOut: [0, 0.1, 0.12, -0.5, 0, 0], magIn: [0, 0.07, 0.02, 0, 0, 0], fetch: [0, 0.1, 0.12, -0.5, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.05, 0, 0, 0], insertJolt: [0, -0.015, 0, 0, 0, 0.08] }),

  // fuzis
  m4a1: boxMagReload({ tilt: [-0.03, 0.03, 0.02, 0.12, 0.12, -0.45], magOut: [0, -0.3, 0.02, 0.15, 0, 0], magIn: [0, -0.14, 0.02, 0.08, 0, 0], grab: false, charge: 'pull', chargeTravel: [0, 0, 0.07, 0, 0, 0] }),
  ak47: boxMagReload({ tilt: [-0.04, 0.04, 0.03, 0.18, 0.15, -0.6], magOut: [0, -0.12, -0.06, 0.9, 0, 0], magIn: [0, -0.06, -0.06, 0.7, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.09, 0, 0, 0], insertJolt: [0, 0.02, 0, -0.08, 0, 0.05] }),
  m16a4: boxMagReload({ tilt: [-0.025, 0.035, 0.02, 0.08, 0.2, -0.35], magOut: [0, -0.2, 0.0, 0.1, 0, 0], magIn: [0, -0.14, 0.02, 0.05, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.07, 0, 0, 0] }),
  hk416: boxMagReload({ tilt: [-0.035, 0.03, 0.02, 0.2, 0.08, -0.5], magOut: [0, -0.32, 0.03, 0.2, 0, 0], magIn: [0, -0.14, 0.02, 0.06, 0, 0], grab: false, charge: 'catch' }),

  // escopetas
  r870: { kind: 'shell', ...pumpShellReload() },
  m590s: { kind: 'shell', ...pumpShellReload() },
  aa12: boxMagReload({ tilt: [-0.04, 0.05, 0.03, 0.2, 0.1, -0.4], magOut: [0, -0.24, 0.04, 0.3, 0, 0.2], magIn: [-0.04, -0.14, 0.03, 0.2, 0, 0.2], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.08, 0, 0, 0], insertJolt: [0, 0.025, 0, -0.06, 0, 0] }),

  // precisão
  hunting: { kind: 'shell', ...huntingShellReload() },
  awm: mag(awmReload()),
  sr25: boxMagReload({ tilt: [-0.03, 0.03, 0.02, 0.1, 0.1, -0.4], magOut: [0, -0.24, 0.02, 0.1, 0, 0], magIn: [0, -0.12, 0.02, 0.05, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.07, 0, 0, 0] }),

  // pesadas
  m249: mag(m249Reload()),
  minigun: mag(minigunReload()),
  rpg7: mag(rpgReload()),
  m32: { kind: 'shell', ...launcherShellReload() },
};
