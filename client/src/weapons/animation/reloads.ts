import { type Clip, type Cue, type Vec6, Z, add, h, k } from './Clip';

/**
 * Recargas personalizadas de cada arma.
 * Tempo normalizado 0..1 (escalado pela duração real da recarga).
 */

export type ReloadAnim =
  | { kind: 'magazine'; clip: Clip }
  | { kind: 'shell'; start: Clip; insert: Clip; end: Clip };

// ═════════════════════ PISTOLAS ═════════════════════
interface PistolReload {
  tilt: Vec6;
  drop: number;
  rack: 'overhand' | 'slingshot' | 'release';
  /** Tapa com a palma ao inserir o pente. */
  slap?: boolean;
}

function pistolReload(o: PistolReload): Clip {
  const travel = 0.032;
  const slap: Vec6 = o.slap ? [0, 0.018, 0, -0.12, 0, 0] : [0, 0.008, 0, -0.04, 0, 0];
  const rackPose: Vec6 = o.rack === 'slingshot' ? [0.02, 0.01, -0.02, 0.1, 0.2, -0.2] : [0, 0.01, 0.01, 0.06, 0.1, -0.1];
  const cues: Cue[] = [
    { t: 0.2, sound: 'magOut' },
    { t: 0.58, sound: 'magIn' },
    { t: 0.8, sound: 'slideBack', empty: true },
    { t: 0.86, sound: 'slideRelease', empty: true },
  ];
  return {
    pose: [
      k(0),
      k(0.14, o.tilt, 'out'),
      k(0.56, o.tilt),
      k(0.6, add(o.tilt, slap), 'out'),
      k(0.66, o.tilt),
      k(0.76, add(o.tilt, rackPose), 'inOut', true),
      k(0.86, add(o.tilt, [0, 0, 0.012, 0.08, 0, 0]), 'out', true),
      k(0.88, o.tilt, 'inOut'),
      k(1, Z, 'inOut'),
    ],
    parts: [
      {
        part: 'mag',
        keys: [k(0), k(0.18), k(0.36, [0, -o.drop, 0.02, 0.3, 0, 0], 'in'), k(0.42, [0, -0.14, 0.02, 0.15, 0, 0], 'linear'), k(0.6, Z, 'out')],
      },
      {
        part: 'slide',
        keys:
          o.rack === 'release'
            ? [k(0, [0, 0, travel, 0, 0, 0], 'linear', true), k(0.82, [0, 0, travel, 0, 0, 0], 'linear', true), k(0.85, Z, 'in', true)]
            : [
                k(0, [0, 0, travel, 0, 0, 0], 'linear', true),
                k(0.78, [0, 0, travel, 0, 0, 0], 'linear', true),
                k(0.83, [0, 0, travel + 0.004, 0, 0, 0], 'out', true),
                k(0.86, Z, 'in', true),
              ],
      },
    ],
    vis: [{ part: 'mag', hide: [[0.365, 0.42]] }],
    left: [
      h(0, 'support'),
      h(0.2, 'support'),
      h(0.33, 'low', 'inOut'),
      h(0.42, 'mag', 'inOut'),
      h(0.6, 'mag'),
      h(0.7, 'support', 'inOut'),
      ...(o.rack === 'release'
        ? []
        : [h(0.74, 'slide', 'inOut', true), h(0.82, 'slide', 'linear', true, [0, 0, 0.03]), h(0.92, 'support', 'inOut', true)]),
      h(1, 'support'),
    ],
    cues,
  };
}

// ═════════════════════ REVÓLVER ═════════════════════
function revolverReload(): Clip {
  const up: Vec6 = [-0.03, 0.05, 0.03, 0.9, -0.1, 0.5];
  return {
    pose: [
      k(0),
      k(0.12, up, 'out'),
      k(0.24, up),
      k(0.27, add(up, [0, 0.03, 0, 0.25, 0, 0]), 'out'),
      k(0.33, up, 'inOut'),
      k(0.4, [-0.04, 0.02, 0.03, 0.2, -0.15, 0.6]),
      k(0.66, [-0.04, 0.02, 0.03, 0.2, -0.15, 0.6]),
      k(0.73, up),
      k(0.78, [-0.01, 0.02, 0.01, 0.15, -0.05, -0.1], 'out'),
      k(1, Z),
    ],
    parts: [
      {
        part: 'cylinder',
        keys: [k(0), k(0.12), k(0.18, [-0.01, 0, 0, 0, 0, 1.3], 'out'), k(0.73, [-0.01, 0, 0, 0, 0, 1.3]), k(0.77, Z, 'in')],
      },
      {
        part: 'speedloader',
        keys: [k(0, [-0.05, -0.25, 0.12, 0, 0, 0]), k(0.36, [-0.05, -0.25, 0.12, 0, 0, 0]), k(0.52, [0, 0, 0.03, 0, 0, 0], 'out'), k(0.58, Z, 'in'), k(0.62, [0, 0, 0, 0, 0, 0.8])],
      },
    ],
    vis: [{ part: 'speedloader', show: [[0.36, 0.66]] }],
    left: [
      h(0, 'support'),
      h(0.1, 'cylinder', 'inOut'),
      h(0.3, 'cylinder'),
      h(0.4, 'low', 'inOut'),
      h(0.5, 'speedloader', 'inOut'),
      h(0.66, 'speedloader'),
      h(0.72, 'cylinder', 'inOut'),
      h(0.85, 'support', 'inOut'),
      h(1, 'support'),
    ],
    cues: [
      { t: 0.16, sound: 'cylinderOpen' },
      { t: 0.26, sound: 'casings', event: 'ejectAll' },
      { t: 0.56, sound: 'magIn' },
      { t: 0.76, sound: 'cylinderClose' },
    ],
  };
}

// ═════════════════════ PENTES (SMG / FUZIL) ═════════════════════
interface BoxMagReload {
  tilt: Vec6;
  /** Para onde o pente velho vai. */
  magOut: Vec6;
  /** De onde o pente novo vem. */
  magIn: Vec6;
  /** A mão puxa o pente (true) ou ele cai sozinho (false). */
  grab: boolean;
  charge: 'pull' | 'slap' | 'catch' | 'none';
  chargeTravel?: Vec6;
  /** Manejo só quando vazia. */
  chargeEmptyOnly?: boolean;
  insertJolt?: Vec6;
}

function boxMagReload(o: BoxMagReload): Clip {
  const jolt = add(o.tilt, o.insertJolt ?? [0, 0.012, 0.0, -0.05, 0, 0]);
  const travel = o.chargeTravel ?? [0, 0, 0.06, 0, 0, 0];
  const e = o.chargeEmptyOnly ?? true;
  const chargeKeys =
    o.charge === 'pull'
      ? [k(0), k(0.74, Z, 'linear', e), k(0.79, travel, 'out', e), k(0.83, Z, 'in', e)]
      : o.charge === 'slap'
        ? [k(0, travel, 'linear', e), k(0.72, travel, 'linear', e), k(0.75, Z, 'in', e)]
        : [];
  const chargeHand =
    o.charge === 'pull'
      ? [h(0.72, 'charging', 'inOut', e), h(0.79, 'charging', 'out', e), h(0.83, 'charging', 'linear', e)]
      : o.charge === 'slap'
        ? [h(0.68, 'charging', 'inOut', e, [0, 0.03, 0]), h(0.74, 'charging', 'in', e)]
        : [];
  return {
    pose: [
      k(0),
      k(0.12, o.tilt, 'out'),
      k(0.58, o.tilt),
      k(0.62, jolt, 'out'),
      k(0.66, o.tilt),
      ...(o.charge === 'catch'
        ? [k(0.74, add(o.tilt, [0, 0.0, 0.0, 0, 0.1, -0.1]), 'inOut', true), k(0.77, add(o.tilt, [0, 0.01, 0.012, 0.06, 0, 0]), 'out', true)]
        : [k(0.79, add(o.tilt, [0, 0, 0.01, 0.04, 0.05, -0.05]), 'inOut', e)]),
      k(0.86, o.tilt),
      k(1, Z),
    ],
    parts: [
      { part: 'mag', keys: [k(0), k(0.16), k(0.32, o.magOut, o.grab ? 'inOut' : 'in'), k(0.42, o.magIn, 'linear'), k(0.58, Z, 'out')] },
      { part: 'charging', keys: chargeKeys },
    ],
    vis: [{ part: 'mag', hide: [[0.33, 0.42]] }],
    left: [
      h(0, 'support'),
      h(o.grab ? 0.16 : 0.22, o.grab ? 'mag' : 'support', 'inOut'),
      h(0.32, o.grab ? 'mag' : 'low', 'inOut'),
      h(0.38, 'low', 'inOut'),
      h(0.44, 'mag', 'inOut'),
      h(0.6, 'mag'),
      ...chargeHand,
      h(0.9, 'support', 'inOut'),
      h(1, 'support'),
    ],
    cues: [
      { t: 0.2, sound: 'magOut' },
      { t: 0.58, sound: 'magIn' },
      ...(o.charge === 'pull'
        ? [
            { t: 0.77, sound: 'chargeBack' as const, empty: e },
            { t: 0.82, sound: 'chargeRelease' as const, empty: e },
          ]
        : o.charge === 'slap'
          ? [{ t: 0.74, sound: 'chargeRelease' as const, empty: e }]
          : o.charge === 'catch'
            ? [{ t: 0.76, sound: 'slideRelease' as const, empty: true }]
            : []),
    ],
  };
}

// ═════════════════════ CARTUCHO A CARTUCHO ═════════════════════
function pumpShellReload(): Omit<Extract<ReloadAnim, { kind: 'shell' }>, 'kind'> {
  const tilt: Vec6 = [-0.03, 0.03, 0.02, 0.18, -0.08, -0.55];
  return {
    start: {
      pose: [k(0), k(1, tilt, 'out')],
      left: [h(0, 'support'), h(1, 'low', 'inOut')],
    },
    insert: {
      pose: [k(0, tilt), k(0.68, tilt), k(0.74, add(tilt, [0, 0.008, 0, -0.04, 0, 0]), 'out'), k(1, tilt)],
      parts: [{ part: 'shell', keys: [k(0, [-0.06, -0.12, 0.08, 0, 0, 0]), k(0.55, Z, 'out'), k(0.75, [0, 0.0, -0.06, 0, 0, 0], 'in')] }],
      vis: [{ part: 'shell', show: [[0, 0.76]] }],
      left: [h(0, 'low'), h(0.15, 'shell', 'inOut'), h(0.75, 'shell'), h(1, 'low', 'inOut')],
      cues: [{ t: 0.72, sound: 'shellInsert' }],
    },
    end: {
      pose: [k(0, tilt), k(0.45, Z, 'inOut'), k(0.62, [0, 0, 0.012, 0.05, 0, 0], 'out', true), k(0.8, Z, 'inOut', true)],
      parts: [{ part: 'pump', keys: [k(0), k(0.45, Z, 'linear', true), k(0.6, [0, 0, 0.085, 0, 0, 0], 'out', true), k(0.8, Z, 'in', true)] }],
      left: [h(0, 'low'), h(0.4, 'support', 'inOut'), h(1, 'support')],
      cues: [
        { t: 0.55, sound: 'pumpBack', empty: true },
        { t: 0.78, sound: 'pumpForward', empty: true },
      ],
    },
  };
}

const BOLT_OPEN: Vec6 = [0, 0, 0.08, 0, 0, 0];
const HANDLE_UP: Vec6 = [0, 0, 0, 0, 0, 1.1];

function huntingShellReload(): Omit<Extract<ReloadAnim, { kind: 'shell' }>, 'kind'> {
  const tilt: Vec6 = [-0.02, 0.03, 0.02, 0.1, -0.05, -0.35];
  return {
    start: {
      pose: [k(0), k(0.4, tilt, 'out'), k(1, tilt)],
      right: [h(0, 'grip'), h(0.35, 'bolt', 'inOut'), h(1, 'bolt')],
      parts: [
        { part: 'boltHandle', keys: [k(0), k(0.35), k(0.6, HANDLE_UP, 'out'), k(1, HANDLE_UP)] },
        { part: 'bolt', keys: [k(0), k(0.6), k(0.9, BOLT_OPEN, 'out'), k(1, BOLT_OPEN)] },
      ],
      left: [h(0, 'support'), h(0.5, 'support'), h(1, 'low', 'inOut')],
      cues: [
        { t: 0.55, sound: 'boltUp' },
        { t: 0.85, sound: 'boltBack' },
      ],
    },
    insert: {
      pose: [k(0, tilt), k(0.7, tilt), k(0.76, add(tilt, [0, -0.006, 0, 0, 0, 0]), 'out'), k(1, tilt)],
      right: [h(0, 'bolt'), h(1, 'bolt')],
      parts: [
        { part: 'boltHandle', keys: [k(0, HANDLE_UP)] },
        { part: 'bolt', keys: [k(0, BOLT_OPEN)] },
        { part: 'shell', keys: [k(0, [-0.06, -0.08, 0.05, 0, 0, 0]), k(0.55, [0, 0.01, 0, 0, 0, 0], 'out'), k(0.75, [0, -0.02, 0, 0, 0, 0], 'in')] },
      ],
      vis: [{ part: 'shell', show: [[0, 0.76]] }],
      left: [h(0, 'low'), h(0.15, 'shell', 'inOut'), h(0.75, 'shell'), h(1, 'low', 'inOut')],
      cues: [{ t: 0.72, sound: 'shellInsert' }],
    },
    end: {
      pose: [k(0, tilt), k(0.6, tilt), k(1, Z)],
      right: [h(0, 'bolt'), h(0.55, 'bolt'), h(0.9, 'grip', 'inOut'), h(1, 'grip')],
      parts: [
        { part: 'bolt', keys: [k(0, BOLT_OPEN), k(0.3, Z, 'in')] },
        { part: 'boltHandle', keys: [k(0, HANDLE_UP), k(0.3, HANDLE_UP), k(0.5, Z, 'in')] },
      ],
      left: [h(0, 'low'), h(0.6, 'support', 'inOut'), h(1, 'support')],
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
      pose: [k(0), k(0.35, tilt, 'out'), k(1, tilt)],
      parts: [{ part: 'cylinder', keys: [k(0), k(0.3), k(0.6, open, 'back'), k(1, open)] }],
      left: [h(0, 'support'), h(0.3, 'cylinder', 'inOut'), h(0.6, 'cylinder'), h(1, 'low', 'inOut')],
      cues: [{ t: 0.5, sound: 'cylinderOpen' }],
    },
    insert: {
      pose: [k(0, tilt), k(0.7, tilt), k(0.76, add(tilt, [0, 0, 0, 0, 0, 0.08]), 'out'), k(1, tilt)],
      parts: [
        { part: 'cylinder', keys: [k(0, open), k(0.78, open), k(1, add(open, [0, 0, 0, 0, 0, 0.3]), 'out')] },
        { part: 'shell', keys: [k(0, [-0.12, -0.14, 0.12, 0, 0, 0]), k(0.55, [-0.05, -0.0, 0.04, 0, 0, 0], 'out'), k(0.72, [-0.05, -0.0, -0.02, 0, 0, 0], 'in')] },
      ],
      vis: [{ part: 'shell', show: [[0, 0.74]] }],
      left: [h(0, 'low'), h(0.15, 'shell', 'inOut'), h(0.72, 'shell'), h(1, 'low', 'inOut')],
      cues: [{ t: 0.7, sound: 'shellInsert' }],
    },
    end: {
      pose: [k(0, tilt), k(0.45, tilt), k(0.55, add(tilt, [0, 0, 0, 0, 0, -0.2]), 'out'), k(1, Z)],
      parts: [{ part: 'cylinder', keys: [k(0, open), k(0.3, open), k(0.5, Z, 'in')] }],
      left: [h(0, 'low'), h(0.3, 'cylinder', 'inOut'), h(0.5, 'cylinder'), h(0.9, 'support', 'inOut'), h(1, 'support')],
      cues: [{ t: 0.5, sound: 'cylinderClose' }],
    },
  };
}

// ═════════════════════ ESPECIAIS ═════════════════════
function awmReload(): Clip {
  const tilt: Vec6 = [-0.03, 0.03, 0.02, 0.1, -0.08, 0.35];
  return {
    pose: [k(0), k(0.1, tilt, 'out'), k(0.48, tilt), k(0.52, add(tilt, [0, 0.015, 0, -0.06, 0, 0]), 'out'), k(0.6, [0, 0.01, 0, 0.05, 0, -0.15]), k(0.9, [0, 0.01, 0, 0.05, 0, -0.15]), k(1, Z)],
    parts: [
      { part: 'mag', keys: [k(0), k(0.14), k(0.28, [0, -0.2, 0.02, 0.1, 0, 0], 'inOut'), k(0.36, [0, -0.12, 0, 0, 0, 0], 'linear'), k(0.5, Z, 'out')] },
      { part: 'boltHandle', keys: [k(0), k(0.66), k(0.71, HANDLE_UP, 'out'), k(0.85, HANDLE_UP), k(0.89, Z, 'in')] },
      { part: 'bolt', keys: [k(0), k(0.71), k(0.77, BOLT_OPEN, 'out'), k(0.83, Z, 'in')] },
    ],
    vis: [{ part: 'mag', hide: [[0.29, 0.36]] }],
    left: [h(0, 'support'), h(0.14, 'mag', 'inOut'), h(0.28, 'mag'), h(0.33, 'low'), h(0.37, 'mag', 'inOut'), h(0.52, 'mag'), h(0.62, 'support', 'inOut'), h(1, 'support')],
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
    pose: [k(0), k(0.08, tilt, 'out'), k(0.78, tilt), k(0.81, add(tilt, [0, -0.015, 0, 0, 0, 0]), 'out'), k(0.86, tilt), k(0.9, add(tilt, [0, 0, 0.012, 0.05, 0, 0]), 'out'), k(1, Z)],
    parts: [
      { part: 'cover', keys: [k(0), k(0.08), k(0.16, open, 'out'), k(0.74, open), k(0.8, Z, 'in')] },
      { part: 'mag', keys: [k(0), k(0.2), k(0.34, [-0.06, -0.3, 0.04, 0, 0, 0.3], 'inOut'), k(0.46, [-0.12, -0.25, 0.05, 0, 0, 0.3], 'linear'), k(0.6, Z, 'out')] },
      { part: 'belt', keys: [k(0), k(0.6, [0, -0.04, 0, 0, 0, 0]), k(0.7, Z, 'out')] },
      { part: 'charging', keys: [k(0), k(0.86), k(0.89, [0, 0, 0.08, 0, 0, 0], 'out'), k(0.92, Z, 'in')] },
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
    pose: [k(0), k(0.1, tilt, 'out'), k(0.66, tilt), k(0.7, add(tilt, [0, 0.015, 0, 0, 0, 0.06]), 'out'), k(0.86, tilt), k(1, Z)],
    parts: [
      { part: 'mag', keys: [k(0), k(0.15), k(0.34, [-0.05, -0.32, 0.05, 0, 0, 0.4], 'in'), k(0.48, [-0.15, -0.26, 0.06, 0, 0, 0.2], 'linear'), k(0.66, Z, 'out')] },
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
    pose: [k(0), k(0.15, tilt, 'out'), k(0.7, tilt), k(0.74, add(tilt, [0, 0, 0.015, -0.04, 0, 0]), 'out'), k(0.8, tilt), k(1, Z)],
    parts: [{ part: 'rocket', keys: [k(0, [0, -0.28, -0.1, 0.5, 0, 0]), k(0.3, [0, -0.28, -0.1, 0.5, 0, 0]), k(0.55, [0, 0.0, -0.14, 0, 0, 0], 'out'), k(0.72, Z, 'inOut')] }],
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

export const RELOADS: Record<string, ReloadAnim> = {
  // pistolas — cada uma com inclinação e forma de manejar o ferrolho diferentes
  g17: mag(pistolReload({ tilt: [-0.03, 0.03, 0.01, 0.25, -0.1, 0.5], drop: 0.3, rack: 'overhand' })),
  g17_inox: mag(pistolReload({ tilt: [-0.02, 0.025, 0, 0.15, -0.3, 0.35], drop: 0.32, rack: 'release' })),
  g34: mag(pistolReload({ tilt: [-0.045, 0.04, 0.02, 0.35, -0.05, 0.75], drop: 0.34, rack: 'slingshot' })),
  g19_fde: mag(pistolReload({ tilt: [-0.05, 0.015, 0.01, -0.12, -0.18, 0.42], drop: 0.36, rack: 'overhand', slap: true })),
  revolver: mag(revolverReload()),

  // submetralhadoras
  mp7: mag(boxMagReload({ tilt: [-0.03, 0.03, 0.02, 0.2, -0.1, 0.45], magOut: [0, -0.25, 0.04, 0.2, 0, 0], magIn: [0, -0.12, 0.02, 0.1, 0, 0], grab: false, charge: 'pull', chargeTravel: [0, 0, 0.05, 0, 0, 0] })),
  mp5k: mag(boxMagReload({ tilt: [-0.04, 0.035, 0.02, 0.25, -0.15, 0.55], magOut: [0, -0.18, -0.05, 0.6, 0, 0], magIn: [0, -0.1, -0.06, 0.5, 0, 0], grab: true, charge: 'slap', chargeTravel: [0, 0.008, 0.07, 0, 0, 0], chargeEmptyOnly: false, insertJolt: [0, 0.02, 0, -0.1, 0, 0] })),
  tmp: mag(boxMagReload({ tilt: [-0.02, 0.03, 0.01, 0.15, -0.2, 0.3], magOut: [0, -0.22, 0.02, 0.0, 0, 0], magIn: [0, -0.12, 0.0, 0, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.05, 0, 0, 0] })),
  mac10: mag(boxMagReload({ tilt: [-0.05, 0.02, 0.02, -0.05, -0.15, 0.55], magOut: [0, -0.3, 0.0, 0.0, 0, 0], magIn: [0, -0.15, 0.0, 0, 0, 0], grab: false, charge: 'pull', chargeTravel: [0, 0, 0.07, 0, 0, 0], insertJolt: [0, 0.025, 0, -0.12, 0, 0] })),
  ump45: mag(boxMagReload({ tilt: [-0.04, 0.03, 0.02, 0.2, -0.1, 0.5], magOut: [0, -0.2, -0.02, 0.15, 0, 0], magIn: [0, -0.12, -0.02, 0.1, 0, 0], grab: true, charge: 'slap', chargeTravel: [0, 0.006, 0.06, 0, 0, 0] })),
  p90: mag(boxMagReload({ tilt: [0.02, 0.04, 0.03, 0.05, 0.25, -0.85], magOut: [0, 0.1, 0.12, -0.5, 0, 0], magIn: [0, 0.07, 0.02, 0, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.05, 0, 0, 0], insertJolt: [0, -0.015, 0, 0, 0, 0.08] })),

  // fuzis
  m4a1: mag(boxMagReload({ tilt: [-0.03, 0.03, 0.02, 0.12, -0.12, 0.45], magOut: [0, -0.3, 0.02, 0.15, 0, 0], magIn: [0, -0.14, 0.02, 0.08, 0, 0], grab: false, charge: 'pull', chargeTravel: [0, 0, 0.07, 0, 0, 0] })),
  ak47: mag(boxMagReload({ tilt: [-0.04, 0.04, 0.03, 0.18, -0.15, 0.6], magOut: [0, -0.12, -0.06, 0.9, 0, 0], magIn: [0, -0.06, -0.06, 0.7, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.09, 0, 0, 0], insertJolt: [0, 0.02, 0, -0.08, 0, 0.05] })),
  m16a4: mag(boxMagReload({ tilt: [-0.025, 0.035, 0.02, 0.08, -0.2, 0.35], magOut: [0, -0.2, 0.0, 0.1, 0, 0], magIn: [0, -0.14, 0.02, 0.05, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.07, 0, 0, 0] })),
  hk416: mag(boxMagReload({ tilt: [-0.035, 0.03, 0.02, 0.2, -0.08, 0.5], magOut: [0, -0.32, 0.03, 0.2, 0, 0], magIn: [0, -0.14, 0.02, 0.06, 0, 0], grab: false, charge: 'catch' })),

  // escopetas
  r870: { kind: 'shell', ...pumpShellReload() },
  m590s: { kind: 'shell', ...pumpShellReload() },
  aa12: mag(boxMagReload({ tilt: [-0.04, 0.05, 0.03, 0.2, -0.1, 0.4], magOut: [0, -0.24, 0.04, 0.3, 0, 0.2], magIn: [-0.04, -0.14, 0.03, 0.2, 0, 0.2], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.08, 0, 0, 0], insertJolt: [0, 0.025, 0, -0.06, 0, 0] })),

  // precisão
  hunting: { kind: 'shell', ...huntingShellReload() },
  awm: mag(awmReload()),
  sr25: mag(boxMagReload({ tilt: [-0.03, 0.03, 0.02, 0.1, -0.1, 0.4], magOut: [0, -0.24, 0.02, 0.1, 0, 0], magIn: [0, -0.12, 0.02, 0.05, 0, 0], grab: true, charge: 'pull', chargeTravel: [0, 0, 0.07, 0, 0, 0] })),

  // pesadas
  m249: mag(m249Reload()),
  minigun: mag(minigunReload()),
  rpg7: mag(rpgReload()),
  m32: { kind: 'shell', ...launcherShellReload() },
};
