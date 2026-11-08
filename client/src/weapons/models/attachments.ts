import { findWeapon } from '@shared/weapons/catalog';
import type { WeaponAttachments } from '@shared/weapons/attachments';
import type { WeaponCategory } from '@shared/weapons/types';
import * as THREE from 'three';
import { type MatKey, getPalette } from './palette';
import type { AnchorName, WeaponModel } from './types';

/**
 * Monta os acessórios no modelo de uma arma, a partir das âncoras que todo
 * modelo já tem (mira, cano, mão de apoio, pente):
 * - mira: some a alça/massa (blocos marcados) e a âncora `sight` passa para a óptica;
 * - silenciador: prolonga o cano e move a âncora `muzzle` para a ponta;
 * - pente estendido: alonga a peça `mag`;
 * - lanterna/laser: módulo no trilho lateral (âncoras `light`/`laser`);
 * - empunhaduras: sob o guarda-mão; a âncora `support` (mão esquerda) vai para elas.
 */
const unit = new THREE.BoxGeometry(1, 1, 1);

function box(parent: THREE.Object3D, mat: MatKey, size: [number, number, number], pos: [number, number, number], rot?: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(unit, getPalette()[mat]);
  m.scale.set(...size);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.userData.attachment = true;
  parent.add(m);
  return m;
}

const plane = new THREE.PlaneGeometry(1, 1);

/**
 * Tubo de luneta: só as faces de fora (de dentro elas não aparecem), então pela
 * ocular a imagem preenche a abertura toda. `wall` desenha a borda das pontas.
 */
function tube(parent: THREE.Object3D, mat: MatKey, outer: number, len: number, pos: [number, number, number], wall = 0.0045): void {
  const [x, y, z] = pos;
  const h = outer / 2;
  const m = getPalette()[mat];
  const face = (w: number, l: number, p: [number, number, number], rot: [number, number, number]) => {
    const f = new THREE.Mesh(plane, m);
    f.scale.set(w, l, 1);
    f.position.set(...p);
    f.rotation.set(...rot);
    f.userData.attachment = true;
    parent.add(f);
  };
  // laterais (normais para fora)
  face(outer, len, [x, y + h, z], [-Math.PI / 2, 0, 0]);
  face(outer, len, [x, y - h, z], [Math.PI / 2, 0, 0]);
  face(len, outer, [x + h, y, z], [0, Math.PI / 2, 0]);
  face(len, outer, [x - h, y, z], [0, -Math.PI / 2, 0]);
  // bordas das pontas (molduras finas, também só para fora)
  for (const end of [1, -1]) {
    const ez = z + (end * len) / 2;
    const ry = end > 0 ? 0 : Math.PI;
    face(outer, wall, [x, y + h - wall / 2, ez], [0, ry, 0]);
    face(outer, wall, [x, y - h + wall / 2, ez], [0, ry, 0]);
    face(wall, outer - wall * 2, [x + h - wall / 2, y, ez], [0, ry, 0]);
    face(wall, outer - wall * 2, [x - h + wall / 2, y, ez], [0, ry, 0]);
  }
}

/**
 * Tubo sextavado (topo plano), só com as faces de fora: pela ocular não aparece
 * nenhuma borda interna, apenas o contorno do hexágono. `across` = distância entre faces opostas.
 * `rim` desenha um aro fino na ponta de trás (a ocular).
 */
function hexTube(parent: THREE.Object3D, mat: MatKey, across: number, len: number, pos: [number, number, number], rim = 0): void {
  const [x, y, z] = pos;
  const r = across / 2;
  const side = 2 * r * Math.tan(Math.PI / 6);
  const m = getPalette()[mat];
  const basis = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3; // normais: topo, cima-esq., …
    const n = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const t = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
    const f = new THREE.Mesh(plane, m);
    f.scale.set(side, len, 1);
    f.quaternion.setFromRotationMatrix(basis.makeBasis(t, new THREE.Vector3(0, 0, 1), n));
    f.position.set(x + n.x * r, y + n.y * r, z);
    f.userData.attachment = true;
    parent.add(f);
    if (rim > 0) {
      // aro da ocular: um trapézio fino por lado, de frente para o olho
      const e = new THREE.Mesh(plane, m);
      e.scale.set(side, rim, 1);
      e.rotation.set(0, 0, a - Math.PI / 2);
      e.position.set(x + n.x * (r - rim / 2), y + n.y * (r - rim / 2), z + len / 2 + 0.0005);
      e.userData.attachment = true;
      parent.add(e);
    }
  }
}

/** Duas caixas cruzadas: cilindro no estilo voxel. */
function rod(parent: THREE.Object3D, mat: MatKey, t: number, len: number, pos: [number, number, number]): void {
  box(parent, mat, [t, t, len], pos);
  box(parent, mat, [t, t, len], pos, [0, 0, Math.PI / 4]);
}

function setAnchor(model: WeaponModel, name: AnchorName, parent: THREE.Object3D, pos: THREE.Vector3): THREE.Object3D {
  model.anchors.get(name)?.removeFromParent();
  const o = new THREE.Object3D();
  o.name = `@${name}`;
  o.position.copy(pos);
  parent.add(o);
  model.anchors.set(name, o);
  return o;
}

/** Posição de uma âncora no espaço da raiz do modelo (sem a escala da raiz). */
function rootPos(model: WeaponModel, name: AnchorName): THREE.Vector3 | null {
  const a = model.anchors.get(name);
  if (!a) return null;
  model.root.updateMatrixWorld(true);
  return model.root.worldToLocal(a.getWorldPosition(new THREE.Vector3()));
}

export function applyAttachments(model: WeaponModel, att: WeaponAttachments): void {
  const def = findWeapon(model.id);
  if (!def || def.kind !== 'firearm') return;
  const cat = def.category;
  if (att.optic === 'holo' || att.optic === 'cog' || att.optic === 'x2') addOptic(model, att.optic, cat);
  if (att.muzzle === 'suppressor') addSuppressor(model, cat);
  if (att.magazine === 'extmag') extendMag(model);
  if (att.rail === 'flashlight' || att.rail === 'laser') addRail(model, att.rail, cat);
  if (att.grip === 'vgrip' || att.grip === 'agrip') addGrip(model, att.grip);
  model.root.updateMatrixWorld(true);
}

// ───────────── mira ─────────────
function addOptic(model: WeaponModel, kind: 'holo' | 'cog' | 'x2', cat: WeaponCategory): void {
  const s = rootPos(model, 'sight');
  if (!s) return;
  // a mira de ferro sai do modelo
  model.root.traverse((o) => {
    if (o.userData.iron) o.visible = false;
  });
  const pistol = cat === 'pistol';
  // topo do receptor/ferrolho logo abaixo da mira (sem a alça de transporte, que saiu)
  const base = Math.min(s.y - 0.012, receiverTop(model, s.z) ?? Infinity);
  const g = new THREE.Group();
  g.name = 'optic';
  model.root.add(g);
  let h: number; // altura da linha de visada
  let rear: number; // z de onde o olho fica
  if (kind === 'holo') {
    const k = pistol ? 0.62 : 1;
    const z = s.z - (pistol ? 0.03 : 0.05);
    const w = 0.036 * k;
    h = base + 0.028 * k;
    box(g, 'black', [w, 0.012 * k, 0.07 * k], [0, base + 0.006 * k, z]); // base
    box(g, 'black', [0.006 * k, 0.034 * k, 0.05 * k], [-w / 2, h, z - 0.006 * k]); // laterais
    box(g, 'black', [0.006 * k, 0.034 * k, 0.05 * k], [w / 2, h, z - 0.006 * k]);
    box(g, 'black', [w + 0.006 * k, 0.006 * k, 0.05 * k], [0, h + 0.018 * k, z - 0.006 * k]); // capota
    box(g, 'black', [0.012 * k, 0.012 * k, 0.02 * k], [w / 2 + 0.006 * k, base + 0.012 * k, z + 0.02 * k]); // botões
    box(g, 'glass', [w - 0.002, 0.028 * k, 0.002], [0, h, z - 0.03 * k]);
    // retículo: anel (4 traços) + ponto
    const rz = z - 0.028 * k;
    const r = 0.0065 * k;
    box(g, 'redDot', [0.0022 * k, 0.0022 * k, 0.001], [0, h, rz]);
    box(g, 'redDot', [r * 1.2, 0.0012, 0.001], [0, h + r, rz]);
    box(g, 'redDot', [r * 1.2, 0.0012, 0.001], [0, h - r, rz]);
    box(g, 'redDot', [0.0012, r * 1.2, 0.001], [-r, h, rz]);
    box(g, 'redDot', [0.0012, r * 1.2, 0.001], [r, h, rz]);
    rear = z + 0.06 * k;
  } else {
    // COG (prismática 3,5x) ou luneta compacta 2x
    const cog = kind === 'cog';
    const len = cog ? 0.13 : 0.11;
    const t = cog ? 0.04 : 0.032;
    const z = s.z - 0.04;
    h = base + (cog ? 0.04 : 0.036);
    box(g, 'black', [0.026, h - base - t / 2 + 0.004, 0.05], [0, (base + h - t / 2) / 2, z]); // montagem
    // corpos ocos: olhando pela ocular, vê-se o cenário através da objetiva
    if (cog) {
      hexTube(g, 'gun', t, len, [0, h, z], 0.0035); // corpo sextavado
      box(g, 'gun', [t * 0.45, t * 0.2, len * 0.6], [0, h + t * 0.5 + t * 0.1 + 0.001, z]); // fibra óptica sobre o topo plano
      box(g, 'redDot', [t * 0.3, 0.003, len * 0.5], [0, h + t * 0.5 + t * 0.2 + 0.0025, z]);
      hexTube(g, 'gun', t + 0.01, 0.03, [0, h, z - len / 2 + 0.015]); // objetiva
    } else {
      tube(g, 'black', t, len, [0, h, z]);
      tube(g, 'black', t + 0.008, 0.024, [0, h, z - len / 2 + 0.012], 0.008);
      tube(g, 'black', t + 0.006, 0.02, [0, h, z + len / 2 - 0.01], 0.007);
      box(g, 'black', [0.012, 0.012, 0.014], [0, h + t / 2 + 0.004, z]); // torre
    }
    if (!cog) {
      box(g, 'glass', [t * 0.8, t * 0.8, 0.002], [0, h, z + len / 2 + 0.001]); // ocular (dá para ver através)
      box(g, 'glass', [t * 0.8, t * 0.8, 0.002], [0, h, z - len / 2 - 0.001]);
    }
    // retículo na ocular
    const rz = z + len / 2 - 0.004;
    if (cog) {
      // só o chevron vermelho, com a ponta exatamente no centro (sem moldura nem poste)
      box(g, 'redDot', [0.0011, 0.0045, 0.0005], [-0.0011, h - 0.0019, rz], [0, 0, -0.55]);
      box(g, 'redDot', [0.0011, 0.0045, 0.0005], [0.0011, h - 0.0019, rz], [0, 0, 0.55]);
    } else {
      box(g, 'black', [t * 0.7, 0.0007, 0.001], [0, h, rz]);
      box(g, 'black', [0.0007, t * 0.7, 0.001], [0, h, rz]);
    }
    // olho perto da ocular (a imagem aumentada ocupa boa parte da tela): a câmera
    // fica `adsDistance` atrás da âncora, então a âncora entra na luneta
    const eye = cog ? 0.065 : 0.075;
    rear = z + len / 2 - Math.max(0, model.view.adsDistance - eye) / model.view.scale;
  }
  setAnchor(model, 'sight', model.root, new THREE.Vector3(0, h, rear));
  // tampa articulada (M249): a mira vai montada nela e sobe junto na recarga
  const cover = model.parts.get('cover');
  if (cover) {
    model.root.updateMatrixWorld(true);
    cover.attach(g);
  }
}

/** Altura do bloco visível mais alto no eixo da arma, perto de `z` (espaço da raiz). */
function receiverTop(model: WeaponModel, z: number): number | null {
  model.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.root.matrixWorld).invert();
  const box = new THREE.Box3();
  let top: number | null = null;
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.iron || m.userData.attachment || !visible(m)) return;
    box.setFromObject(m, true).applyMatrix4(inv);
    // perto do eixo (sem laterais como alavancas) e na faixa onde a mira vai
    if (box.min.x > 0.015 || box.max.x < -0.015 || box.max.z < z - 0.12 || box.min.z > z + 0.04) return;
    if (top === null || box.max.y > top) top = box.max.y;
  });
  return top;
}

function visible(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

// ───────────── silenciador ─────────────
const SUPPRESSOR: Partial<Record<WeaponCategory, { t: number; len: number }>> = {
  pistol: { t: 0.024, len: 0.1 },
  smg: { t: 0.032, len: 0.14 },
  rifle: { t: 0.036, len: 0.17 },
  sniper: { t: 0.04, len: 0.2 },
};

function addSuppressor(model: WeaponModel, cat: WeaponCategory): void {
  const m = model.anchors.get('muzzle');
  if (!m?.parent) return;
  const s = SUPPRESSOR[cat] ?? SUPPRESSOR.rifle!;
  const p = m.position;
  const parent = m.parent;
  rod(parent, 'black', s.t, s.len, [p.x, p.y, p.z - s.len / 2 + 0.006]);
  for (const k of [0.15, 0.85]) box(parent, 'dark', [s.t + 0.003, s.t + 0.003, 0.006], [p.x, p.y, p.z - s.len * k]);
  setAnchor(model, 'muzzle', parent, new THREE.Vector3(p.x, p.y, p.z - s.len));
  model.root.userData.suppressed = true;
}

// ───────────── pente estendido ─────────────
function extendMag(model: WeaponModel): void {
  const mag = model.parts.get('mag');
  if (!mag) return;
  const size = new THREE.Box3().setFromObject(mag).getSize(new THREE.Vector3());
  // pente vertical cresce para baixo; tambor/carregador deitado cresce no comprimento
  if (size.y >= size.z * 0.8) mag.scale.y *= 1.45;
  else if (size.x > size.z) mag.scale.multiplyScalar(1.22);
  else mag.scale.z *= 1.35;
  const rest = model.rest.get(mag);
  if (rest) rest.pos.copy(mag.position);
}

// ───────────── trilho: lanterna / laser ─────────────
function addRail(model: WeaponModel, kind: 'flashlight' | 'laser', cat: WeaponCategory): void {
  const muzzle = rootPos(model, 'muzzle');
  const support = rootPos(model, 'support');
  if (!muzzle) return;
  const g = new THREE.Group();
  g.name = kind;
  model.root.add(g);
  let pos: THREE.Vector3;
  if (cat === 'pistol' || !support) {
    // sob o cano, no trilho da armação
    pos = new THREE.Vector3(0, muzzle.y - 0.028, muzzle.z + 0.045);
    box(g, 'black', [0.02, 0.008, 0.03], [pos.x, pos.y + 0.012, pos.z]); // trava
  } else {
    // lateral direita do guarda-mão
    const z = support.z + (muzzle.z - support.z) * 0.3;
    pos = new THREE.Vector3(0.034, support.y + 0.04, z);
    box(g, 'black', [0.012, 0.016, 0.03], [pos.x - 0.01, pos.y, pos.z]); // trava
  }
  if (kind === 'flashlight') {
    rod(g, 'black', 0.022, 0.07, [pos.x, pos.y, pos.z]);
    rod(g, 'black', 0.028, 0.018, [pos.x, pos.y, pos.z - 0.035]);
    box(g, 'lamp', [0.018, 0.018, 0.002], [pos.x, pos.y, pos.z - 0.045]);
    setAnchor(model, 'light', model.root, new THREE.Vector3(pos.x, pos.y, pos.z - 0.047));
  } else {
    box(g, 'black', [0.02, 0.02, 0.05], [pos.x, pos.y, pos.z]);
    box(g, 'dark', [0.021, 0.006, 0.02], [pos.x, pos.y + 0.008, pos.z + 0.01]);
    box(g, 'redDot', [0.006, 0.006, 0.002], [pos.x, pos.y - 0.002, pos.z - 0.026]);
    setAnchor(model, 'laser', model.root, new THREE.Vector3(pos.x, pos.y - 0.002, pos.z - 0.028));
  }
}

// ───────────── empunhaduras ─────────────
function addGrip(model: WeaponModel, kind: 'vgrip' | 'agrip'): void {
  const sup = rootPos(model, 'support');
  if (!sup) return;
  const g = new THREE.Group();
  g.name = kind;
  model.root.add(g);
  const top = sup.y + 0.01; // fundo do guarda-mão
  const z = sup.z;
  if (kind === 'vgrip') {
    box(g, 'black', [0.026, 0.01, 0.04], [0, top - 0.005, z]);
    box(g, 'grip', [0.024, 0.075, 0.026], [0, top - 0.045, z]);
    box(g, 'black', [0.028, 0.008, 0.03], [0, top - 0.085, z]);
    // mão esquerda fecha na empunhadura vertical (mais baixa)
    setAnchor(model, 'support', model.root, new THREE.Vector3(-0.016, top - 0.05, z + 0.004));
  } else {
    box(g, 'black', [0.026, 0.01, 0.07], [0, top - 0.005, z - 0.005]);
    box(g, 'grip', [0.024, 0.026, 0.07], [0, top - 0.022, z - 0.01], [-0.38, 0, 0]);
    // mão esquerda apoiada atrás da rampa angulada (um pouco mais baixa e recuada)
    setAnchor(model, 'support', model.root, new THREE.Vector3(-0.016, top - 0.03, z + 0.03));
  }
}
