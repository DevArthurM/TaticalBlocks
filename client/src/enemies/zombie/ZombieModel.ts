import * as THREE from 'three';
import {
  createClothTexture,
  createDenimTexture,
  createFootwearTexture,
  createLeatherTexture,
  createPlaidTexture,
  createZombieFaceToneTexture,
  createZombieSkinToneTexture,
} from '../../textures/CharacterTextures';
import { type Fabric, type SkinDef, SKINS, type ZombieVariant } from './variants';
import type { Severable, Side, Zone } from './zones';
import { registerZombieMesh } from './ZombieInstancer';

/** Ossos (grupos) do zumbi. Cada grupo tem origem na articulação; o membro sai em −Y. */
export interface ZombieBones {
  root: THREE.Group;
  pelvis: THREE.Group;
  waist: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  shoulderL: THREE.Group;
  elbowL: THREE.Group;
  wristL: THREE.Group;
  shoulderR: THREE.Group;
  elbowR: THREE.Group;
  wristR: THREE.Group;
  hipL: THREE.Group;
  kneeL: THREE.Group;
  ankleL: THREE.Group;
  hipR: THREE.Group;
  kneeR: THREE.Group;
  ankleR: THREE.Group;
}

export interface ZoneTag {
  zone: Zone;
  side: Side;
}

/** Medidas (m). Altura total ≈ 1,82. */
export const BODY = {
  pelvisY: 0.95,
  thigh: 0.42,
  shin: 0.4,
  foot: 0.09,
  upperArm: 0.3,
  forearm: 0.27,
  hand: 0.11,
  hipX: 0.1,
  shoulderX: 0.26,
  shoulderY: 0.36,
} as const;

/** Grupo a desprender para cada parte arrancável. */
export function severGroup(b: ZombieBones, part: Severable, side: Side): THREE.Group {
  const s = side === 'L' ? 'L' : 'R';
  switch (part) {
    case 'head':
      return b.neck;
    case 'upperArm':
      return b[`shoulder${s}`];
    case 'forearm':
      return b[`elbow${s}`];
    case 'hand':
      return b[`wrist${s}`];
    case 'thigh':
      return b[`hip${s}`];
    case 'shin':
      return b[`knee${s}`];
    case 'foot':
      return b[`ankle${s}`];
  }
}

/** Cubo unitário compartilhado por todas as partes (e pelos lotes instanciados). */
export const ZOMBIE_UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const unitBox = ZOMBIE_UNIT_BOX;

type Mat = THREE.Material | THREE.Material[];

interface SkinMats {
  skin: THREE.Material;
  head: THREE.Material[];
}

/** Materiais compartilhados por todos os zumbis (cor das roupas vem por instância). */
interface Mats {
  fabric: Record<Fabric, THREE.Material>;
  hair: THREE.Material;
  wound: THREE.Material;
}
let mats: Mats | null = null;
const skinMats = new Map<string, SkinMats>();

function materials(): Mats {
  if (mats) return mats;
  const fabric = (map: THREE.Texture, roughness: number) => new THREE.MeshStandardMaterial({ map, roughness });
  mats = {
    fabric: {
      cloth: fabric(createClothTexture(), 0.95),
      plaid: fabric(createPlaidTexture(), 0.95),
      denim: fabric(createDenimTexture(), 0.9),
      leather: fabric(createLeatherTexture(), 0.6),
      footwear: fabric(createFootwearTexture(), 0.55),
    },
    hair: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
    wound: new THREE.MeshStandardMaterial({ color: 0x6e1210, roughness: 0.6 }),
  };
  return mats;
}

/** Pele e rosto de um tom (um material por tom: o rosto tem olhos/boca com cores próprias). */
function skinMaterials(skin: SkinDef): SkinMats {
  let m = skinMats.get(skin.id);
  if (!m) {
    const body = new THREE.MeshStandardMaterial({ map: createZombieSkinToneTexture(skin.tone), roughness: 0.85 });
    const face = new THREE.MeshStandardMaterial({ map: createZombieFaceToneTexture(skin.tone), roughness: 0.85 });
    // ordem das faces do BoxGeometry: +x, −x, +y, −y, +z, −z (rosto em −Z = frente)
    m = { skin: body, head: [body, body, body, body, body, face] };
    skinMats.set(skin.id, m);
  }
  return m;
}

/** Todos os materiais do zumbi (para criar os lotes instanciados de antemão). */
export function zombieMaterials(): Mat[] {
  const m = materials();
  const out: Mat[] = [...Object.values(m.fabric), m.hair, m.wound];
  for (const skin of SKINS) {
    const s = skinMaterials(skin);
    out.push(s.skin, s.head);
  }
  return out;
}

/** Material de "ferida" para cobrir os tocos de membros arrancados. */
export function woundMaterial(): THREE.Material {
  return materials().wound;
}

/** Monta um zumbi voxel na variação pedida. Todas as malhas recebem `userData` com zona e lado. */
export function buildZombie(variant: ZombieVariant): { bones: ZombieBones; meshes: THREE.Mesh[] } {
  const m = materials();
  const sk = skinMaterials(variant.skin);
  const { top, bottom, shoes } = variant;
  const topMat = m.fabric[top.fabric];
  const topTint = new THREE.Color(top.color);
  const pantsMat = m.fabric[bottom.fabric];
  const pantsTint = new THREE.Color(bottom.color);
  const shoeMat = shoes.barefoot ? sk.skin : m.fabric.footwear;
  const shoeTint = shoes.barefoot ? null : new THREE.Color(shoes.color);
  const hairTint = new THREE.Color(variant.skin.hair);
  const beltTint = new THREE.Color(0x222226);

  const meshes: THREE.Mesh[] = [];
  const group = (parent: THREE.Object3D, pos: [number, number, number], name: string) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...pos);
    parent.add(g);
    return g;
  };
  const box = (
    parent: THREE.Object3D,
    mat: Mat,
    size: [number, number, number],
    pos: [number, number, number],
    tag: ZoneTag,
    shadow = true,
    tint: THREE.Color | null = null,
  ) => {
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.scale.set(...size);
    mesh.position.set(...pos);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.userData.hit = tag;
    if (tint) mesh.userData.tint = tint;
    parent.add(mesh);
    meshes.push(mesh);
    registerZombieMesh(mesh);
    return mesh;
  };

  const root = new THREE.Group();
  root.name = 'zombie';
  const pelvis = group(root, [0, BODY.pelvisY, 0], 'pelvis');
  box(pelvis, pantsMat, [0.34, 0.16, 0.2], [0, 0, 0], { zone: 'hip', side: 'C' }, true, pantsTint);
  if (top.gown) {
    // avental hospitalar: cai por cima do quadril
    box(pelvis, topMat, [0.37, 0.24, 0.23], [0, -0.03, 0], { zone: 'hip', side: 'C' }, true, topTint);
  } else box(pelvis, m.fabric.footwear, [0.36, 0.035, 0.21], [0, 0.07, 0], { zone: 'waist', side: 'C' }, false, beltTint); // cinto

  const waist = group(pelvis, [0, 0.08, 0], 'waist');
  box(waist, topMat, [0.32, 0.14, 0.19], [0, 0.07, 0], { zone: 'waist', side: 'C' }, true, topTint);
  const chest = group(waist, [0, 0.14, 0], 'chest');
  box(chest, topMat, [0.4, 0.42, 0.22], [0, 0.21, 0], { zone: 'torso', side: 'C' }, true, topTint);
  if (top.fabric === 'leather') {
    // gola da jaqueta
    box(chest, topMat, [0.3, 0.06, 0.24], [0, 0.42, 0.01], { zone: 'torso', side: 'C' }, false, topTint);
  }

  const neck = group(chest, [0, 0.42, -0.01], 'neck');
  box(neck, sk.skin, [0.12, 0.1, 0.12], [0, 0.05, 0], { zone: 'neck', side: 'C' }, false);
  const head = group(neck, [0, 0.1, 0], 'head');
  box(head, sk.head, [0.26, 0.28, 0.26], [0, 0.14, 0], { zone: 'head', side: 'C' });
  box(head, m.hair, [0.27, 0.07, 0.27], [0, 0.29, 0.005], { zone: 'head', side: 'C' }, false, hairTint);
  box(head, m.hair, [0.27, 0.12, 0.06], [0, 0.22, 0.11], { zone: 'head', side: 'C' }, false, hairTint);

  const arm = (side: 'L' | 'R') => {
    const sx = side === 'L' ? -1 : 1;
    const shoulder = group(chest, [sx * BODY.shoulderX, BODY.shoulderY, 0], `shoulder${side}`);
    const sleeve = top.sleeves !== 'none';
    box(shoulder, sleeve ? topMat : sk.skin, [sleeve ? 0.13 : 0.11, BODY.upperArm, sleeve ? 0.13 : 0.11], [0, -BODY.upperArm / 2, 0], { zone: 'shoulder', side }, true, sleeve ? topTint : null);
    const elbow = group(shoulder, [0, -BODY.upperArm, 0], `elbow${side}`);
    const long = top.sleeves === 'long';
    box(elbow, long ? topMat : sk.skin, [long ? 0.115 : 0.1, BODY.forearm, long ? 0.115 : 0.1], [0, -BODY.forearm / 2, 0], { zone: 'forearm', side }, false, long ? topTint : null);
    const wrist = group(elbow, [0, -BODY.forearm, 0], `wrist${side}`);
    box(wrist, sk.skin, [0.11, BODY.hand, 0.07], [0, -BODY.hand / 2, 0], { zone: 'hand', side }, false);
    return { shoulder, elbow, wrist };
  };
  const leg = (side: 'L' | 'R') => {
    const sx = side === 'L' ? -1 : 1;
    const hip = group(pelvis, [sx * BODY.hipX, -0.04, 0], `hip${side}`);
    box(hip, pantsMat, [0.15, BODY.thigh, 0.16], [0, -BODY.thigh / 2, 0], { zone: 'thigh', side }, true, pantsTint);
    const knee = group(hip, [0, -BODY.thigh, 0], `knee${side}`);
    box(knee, pantsMat, [0.155, 0.08, 0.165], [0, 0, 0], { zone: 'knee', side }, false, pantsTint);
    const bare = bottom.shorts;
    box(knee, bare ? sk.skin : pantsMat, [bare ? 0.12 : 0.14, BODY.shin, bare ? 0.13 : 0.15], [0, -BODY.shin / 2 - 0.02, 0], { zone: 'leg', side }, true, bare ? null : pantsTint);
    if (shoes.boot) {
      // cano da bota por cima do fim da canela
      box(knee, shoeMat, [0.16, 0.17, 0.17], [0, -BODY.shin + 0.065, 0], { zone: 'leg', side }, false, shoeTint);
    }
    const ankle = group(knee, [0, -BODY.shin - 0.02, 0], `ankle${side}`);
    const foot = shoes.barefoot ? [0.13, BODY.foot, 0.24] : [0.15, BODY.foot, 0.27];
    box(ankle, shoeMat, foot as [number, number, number], [0, -BODY.foot / 2 + 0.02, shoes.barefoot ? -0.04 : -0.05], { zone: 'foot', side }, true, shoeTint);
    return { hip, knee, ankle };
  };
  const aL = arm('L');
  const aR = arm('R');
  const lL = leg('L');
  const lR = leg('R');

  return {
    meshes,
    bones: {
      root,
      pelvis,
      waist,
      chest,
      neck,
      head,
      shoulderL: aL.shoulder,
      elbowL: aL.elbow,
      wristL: aL.wrist,
      shoulderR: aR.shoulder,
      elbowR: aR.elbow,
      wristR: aR.wrist,
      hipL: lL.hip,
      kneeL: lL.knee,
      ankleL: lL.ankle,
      hipR: lR.hip,
      kneeR: lR.knee,
      ankleR: lR.ankle,
    },
  };
}
