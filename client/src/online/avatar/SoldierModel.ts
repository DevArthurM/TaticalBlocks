import type { TeamId } from '@shared/net/protocol';
import * as THREE from 'three';
import { registerZombieMesh } from '../../enemies/zombie/ZombieInstancer';
import { BODY, ZOMBIE_UNIT_BOX, type ZombieBones, type ZoneTag } from '../../enemies/zombie/ZombieModel';
import {
  createCamoTexture,
  createGearTexture,
  createGloveTexture,
  createHumanSkinTexture,
  createSoldierFaceTexture,
} from '../../textures/CharacterTextures';

/**
 * Soldado voxel dos outros jogadores no modo online. Mesmo esqueleto do zumbi
 * (ragdoll, zonas de dano e desenho instanciado reaproveitados), com uniforme
 * camuflado verde ou azul conforme o time.
 */

type Mat = THREE.Material | THREE.Material[];

/** Tons de pele humanos (escolhidos pelo id do jogador). */
const SKIN_TONES = [0xe0b48f, 0xc68d62, 0x8d5a3b, 0xf0c8a4, 0x6b4128];

interface TeamMats {
  camo: THREE.Material;
  vest: THREE.Material;
  band: THREE.Material;
}

let shared: { team: Record<TeamId, TeamMats>; dark: THREE.Material; skin: THREE.Material[]; head: THREE.Material[][] } | null = null;

function mats() {
  if (shared) return shared;
  const std = (map: THREE.Texture, roughness = 0.9) => new THREE.MeshStandardMaterial({ map, roughness });
  const team = (palette: TeamId, vest: number, band: number): TeamMats => ({
    camo: std(createCamoTexture(palette === 'green' ? 13 : 17, palette), 0.95),
    vest: std(createGearTexture(vest), 0.85),
    band: new THREE.MeshStandardMaterial({ color: band, roughness: 0.6, emissive: band, emissiveIntensity: 0.25 }),
  });
  const skin = SKIN_TONES.map((t) => std(createHumanSkinTexture(t), 0.75));
  shared = {
    team: { green: team('green', 0x3b4a2a, 0x5fd35a), blue: team('blue', 0x26334a, 0x3d8cff) },
    dark: std(createGloveTexture(31), 0.7),
    skin,
    // ordem das faces do BoxGeometry: +x, −x, +y, −y, +z, −z (rosto em −Z = frente)
    head: SKIN_TONES.map((t, i) => {
      const face = std(createSoldierFaceTexture(t), 0.75);
      return [skin[i], skin[i], skin[i], skin[i], skin[i], face];
    }),
  };
  return shared;
}

/** Materiais do soldado (para pré-criar os lotes instanciados e compilar os shaders). */
export function soldierMaterials(): Mat[] {
  const m = mats();
  return [...Object.values(m.team).flatMap((t) => [t.camo, t.vest, t.band]), m.dark, ...m.skin, ...m.head];
}

export interface Soldier {
  bones: ZombieBones;
  meshes: THREE.Mesh[];
  /** Pivô da arma (filho do peito). */
  weaponPivot: THREE.Group;
}

/** Tom de pele estável a partir do id do jogador. */
export function skinIndexFor(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % SKIN_TONES.length;
}

export function buildSoldier(team: TeamId, skinIndex: number): Soldier {
  const m = mats();
  const t = m.team[team];
  const skin = m.skin[skinIndex];
  const headMat = m.head[skinIndex];
  const meshes: THREE.Mesh[] = [];
  const group = (parent: THREE.Object3D, pos: [number, number, number], name: string) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...pos);
    parent.add(g);
    return g;
  };
  const box = (parent: THREE.Object3D, mat: Mat, size: [number, number, number], pos: [number, number, number], tag: ZoneTag, shadow = true) => {
    const mesh = new THREE.Mesh(ZOMBIE_UNIT_BOX, mat);
    mesh.scale.set(...size);
    mesh.position.set(...pos);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.userData.hit = tag;
    parent.add(mesh);
    meshes.push(mesh);
    registerZombieMesh(mesh);
    return mesh;
  };

  const root = new THREE.Group();
  root.name = 'soldier';
  const pelvis = group(root, [0, BODY.pelvisY, 0], 'pelvis');
  box(pelvis, t.camo, [0.34, 0.16, 0.2], [0, 0, 0], { zone: 'hip', side: 'C' });
  box(pelvis, m.dark, [0.36, 0.04, 0.22], [0, 0.07, 0], { zone: 'waist', side: 'C' }, false); // cinto
  box(pelvis, t.vest, [0.08, 0.1, 0.06], [0.15, 0.02, -0.08], { zone: 'hip', side: 'R' }, false); // bolsa de perna

  const waist = group(pelvis, [0, 0.08, 0], 'waist');
  box(waist, t.camo, [0.32, 0.14, 0.19], [0, 0.07, 0], { zone: 'waist', side: 'C' });
  const chest = group(waist, [0, 0.14, 0], 'chest');
  box(chest, t.camo, [0.4, 0.42, 0.22], [0, 0.21, 0], { zone: 'torso', side: 'C' });
  // colete com placas e porta-carregadores
  box(chest, t.vest, [0.42, 0.3, 0.27], [0, 0.2, 0], { zone: 'torso', side: 'C' });
  for (const x of [-0.11, 0, 0.11]) box(chest, t.vest, [0.09, 0.11, 0.05], [x, 0.12, -0.155], { zone: 'torso', side: 'C' }, false);
  box(chest, m.dark, [0.12, 0.16, 0.06], [-0.1, 0.24, 0.16], { zone: 'torso', side: 'C' }, false); // rádio

  const neck = group(chest, [0, 0.42, -0.01], 'neck');
  box(neck, skin, [0.12, 0.1, 0.12], [0, 0.05, 0], { zone: 'neck', side: 'C' }, false);
  const head = group(neck, [0, 0.1, 0], 'head');
  box(head, headMat, [0.26, 0.28, 0.26], [0, 0.14, 0], { zone: 'head', side: 'C' });
  // capacete com capa camuflada
  box(head, t.camo, [0.3, 0.11, 0.3], [0, 0.285, 0.005], { zone: 'head', side: 'C' });
  box(head, t.camo, [0.31, 0.05, 0.31], [0, 0.225, 0.005], { zone: 'head', side: 'C' }, false);
  box(head, m.dark, [0.14, 0.04, 0.03], [0, 0.29, -0.16], { zone: 'head', side: 'C' }, false); // suporte de NVG

  const arm = (side: 'L' | 'R') => {
    const sx = side === 'L' ? -1 : 1;
    const shoulder = group(chest, [sx * BODY.shoulderX, BODY.shoulderY, 0], `shoulder${side}`);
    box(shoulder, t.camo, [0.13, BODY.upperArm, 0.13], [0, -BODY.upperArm / 2, 0], { zone: 'shoulder', side });
    box(shoulder, t.band, [0.14, 0.05, 0.14], [0, -0.08, 0], { zone: 'shoulder', side }, false); // braçadeira do time
    const elbow = group(shoulder, [0, -BODY.upperArm, 0], `elbow${side}`);
    box(elbow, t.camo, [0.115, BODY.forearm, 0.115], [0, -BODY.forearm / 2, 0], { zone: 'forearm', side }, false);
    const wrist = group(elbow, [0, -BODY.forearm, 0], `wrist${side}`);
    box(wrist, m.dark, [0.11, BODY.hand, 0.08], [0, -BODY.hand / 2, 0], { zone: 'hand', side }, false);
    return { shoulder, elbow, wrist };
  };
  const leg = (side: 'L' | 'R') => {
    const sx = side === 'L' ? -1 : 1;
    const hip = group(pelvis, [sx * BODY.hipX, -0.04, 0], `hip${side}`);
    box(hip, t.camo, [0.15, BODY.thigh, 0.16], [0, -BODY.thigh / 2, 0], { zone: 'thigh', side });
    const knee = group(hip, [0, -BODY.thigh, 0], `knee${side}`);
    box(knee, m.dark, [0.16, 0.09, 0.17], [0, 0, -0.01], { zone: 'knee', side }, false); // joelheira
    box(knee, t.camo, [0.14, BODY.shin, 0.15], [0, -BODY.shin / 2 - 0.02, 0], { zone: 'leg', side });
    box(knee, m.dark, [0.155, 0.14, 0.165], [0, -BODY.shin + 0.05, 0], { zone: 'leg', side }, false); // cano da bota
    const ankle = group(knee, [0, -BODY.shin - 0.02, 0], `ankle${side}`);
    box(ankle, m.dark, [0.15, BODY.foot, 0.27], [0, -BODY.foot / 2 + 0.02, -0.05], { zone: 'foot', side });
    return { hip, knee, ankle };
  };
  const aL = arm('L');
  const aR = arm('R');
  const lL = leg('L');
  const lR = leg('R');
  const weaponPivot = group(chest, [0.1, 0.3, -0.2], 'weaponPivot');

  return {
    meshes,
    weaponPivot,
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
