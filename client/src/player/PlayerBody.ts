import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import { createCamoTexture, createGloveTexture } from '../textures/CharacterTextures';

/** Medidas da perna (m). */
const LEG = {
  thigh: 0.44,
  shin: 0.42,
  /** Altura do tornozelo até a sola. */
  ankle: 0.09,
  /** Distância lateral de cada quadril ao centro. */
  hipX: 0.1,
  /**
   * Quadril um pouco atrás dos olhos e pés à frente: olhando para baixo,
   * as coxas ficam fora de vista e aparecem canelas e coturnos.
   */
  back: 0.18,
  footForward: 0.3,
} as const;

/** Medidas do tronco (m). */
const TORSO = {
  width: 0.4,
  depth: 0.24,
  height: 0.5,
  /** Altura da parte do tronco visível ao jogador (barriga/bolsos). */
  visible: 0.24,
} as const;

const STAND_HIP = LEG.thigh + LEG.shin + LEG.ankle - 0.025;
const CROUCH_HIP = 0.52;

export interface BodyState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  onGround: boolean;
  /** 0 = em pé, 1 = agachado. */
  crouch: number;
  /** -1 (esquerda) .. 1 (direita) — inclinação Q/E. */
  lean: number;
}

interface Leg {
  side: 1 | -1;
  thigh: THREE.Group;
  shin: THREE.Group;
  ankle: THREE.Group;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
/** Camada vista só pela câmera de sombra (não pela câmera do jogador). */
export const SHADOW_ONLY_LAYER = 1;
const FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * Pernas voxel do jogador (só da cintura para baixo, para não bloquear a câmera).
 * Os pés são posicionados por IK de dois ossos: passos alternados na direção do
 * movimento (inclusive lateral e para trás), joelhos que dobram e agachamento.
 */
export class PlayerBody {
  readonly root = new THREE.Group();
  private readonly pelvis: THREE.Mesh;
  /** Tronco articulado no quadril (colete + cabeça/braços só na sombra). */
  private readonly torso = new THREE.Group();
  private readonly legs: Leg[];
  private phase = 0;
  private stride = 0;
  private airborne = 0;
  private readonly dir = new THREE.Vector2();

  // temporários
  private readonly hip = new THREE.Vector3();
  private readonly foot = new THREE.Vector3();
  private readonly knee = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly x = new THREE.Vector3();
  private readonly y = new THREE.Vector3();
  private readonly z = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly qThigh = new THREE.Quaternion();
  private readonly qShin = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    const pants = new THREE.MeshStandardMaterial({ map: createCamoTexture(23), roughness: 0.95 });
    const boots = new THREE.MeshStandardMaterial({ map: createGloveTexture(31), roughness: 0.75 });
    const belt = new THREE.MeshStandardMaterial({ color: 0x2b2a22, roughness: 0.8 });

    this.root.name = 'player-body';
    this.pelvis = this.box(this.root, pants, [0.34, 0.16, 0.2], [0, 0, 0]);
    this.box(this.pelvis, belt, [1.04, 0.22, 1.06], [0, 0.42, 0]); // cinto (escala relativa à pelve)

    this.buildTorso(pants);

    this.legs = ([-1, 1] as const).map((side) => {
      const thigh = new THREE.Group();
      this.root.add(thigh);
      this.box(thigh, pants, [0.15, LEG.thigh, 0.16], [0, -LEG.thigh / 2, 0]);
      const shin = new THREE.Group();
      shin.position.y = -LEG.thigh;
      thigh.add(shin);
      this.box(shin, pants, [0.135, LEG.shin, 0.145], [0, -LEG.shin / 2, 0]);
      this.box(shin, boots, [0.15, 0.12, 0.16], [0, -LEG.shin + 0.04, 0]); // cano do coturno
      const ankle = new THREE.Group();
      ankle.position.y = -LEG.shin;
      shin.add(ankle);
      this.box(ankle, boots, [0.15, LEG.ankle, 0.27], [0, -LEG.ankle / 2, -0.05]);
      this.box(ankle, boots, [0.155, 0.025, 0.28], [0, -LEG.ankle + 0.012, -0.05]); // sola
      return { side, thigh, shin, ankle };
    });

    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    // a pelve bloquearia a visão dos pés ao olhar para baixo: só aparece na sombra
    this.pelvis.traverse((o) => o.layers.set(SHADOW_ONLY_LAYER));
    this.shadowOnly.forEach((o) => o.traverse((c) => c.layers.set(SHADOW_ONLY_LAYER)));
    scene.add(this.root);
  }

  update(dt: number, s: BodyState): void {
    this.root.position.copy(s.position);
    this.root.rotation.y = s.yaw;

    // velocidade no espaço do corpo (x = direita, z = trás)
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    const lx = s.velocity.x * cos - s.velocity.z * sin;
    const lz = s.velocity.x * sin + s.velocity.z * cos;
    const speed = Math.hypot(lx, lz);
    if (speed > 0.05) this.dir.set(lx / speed, lz / speed);

    // amplitude do passo e cadência (passos mais curtos agachado)
    const stepLen = lerp(0.9, 0.55, s.crouch);
    const targetStride = s.onGround ? clamp(speed / 4.6, 0, 1.7) * lerp(0.26, 0.16, s.crouch) : 0;
    this.stride = damp(this.stride, targetStride, 10, dt);
    if (s.onGround) this.phase += (speed * dt * Math.PI) / stepLen;
    this.airborne = damp(this.airborne, s.onGround ? 0 : 1, 10, dt);

    const hipH = lerp(STAND_HIP, CROUCH_HIP, s.crouch) - this.airborne * 0.02;
    this.pelvis.position.set(0, hipH + 0.04, LEG.back);
    // tronco: inclina para a frente agachado, de lado com Q/E e balança de leve ao andar
    // tronco um pouco atrás do quadril: olhando para baixo, a barriga não esconde os pés
    this.torso.position.set(0, hipH + 0.1, LEG.back + 0.08);
    this.torso.rotation.set(
      -lerp(0.04, 0.18, s.crouch) - this.stride * 0.15,
      Math.sin(this.phase) * this.stride * 0.25,
      -s.lean * 0.3,
    );
    const lift = clamp(speed / 2, 0, 1) * lerp(0.13, 0.08, s.crouch);

    for (const [i, leg] of this.legs.entries()) {
      const phi = this.phase + i * Math.PI;
      const swing = Math.sin(phi) * this.stride;
      const raise = Math.max(0, Math.cos(phi)) * lift;
      // postura agachada: um pé à frente, o outro atrás e mais abertos
      const stanceZ = s.crouch * (leg.side > 0 ? -0.12 : 0.1);
      const stanceX = s.crouch * 0.05 * leg.side;

      this.hip.set(leg.side * LEG.hipX, hipH, LEG.back);
      this.foot.set(
        leg.side * (LEG.hipX + 0.01) + stanceX + this.dir.x * swing,
        LEG.ankle + raise + this.airborne * 0.16,
        LEG.back - LEG.footForward + stanceZ + this.dir.y * swing - this.airborne * 0.08,
      );
      this.solveLeg(leg);
    }
  }

  /** IK de dois ossos no plano que contém quadril, pé e a frente do corpo. */
  private solveLeg(leg: Leg): void {
    const L1 = LEG.thigh;
    const L2 = LEG.shin;
    this.v.subVectors(this.foot, this.hip);
    const d = clamp(this.v.length(), 0.05, L1 + L2 - 0.001);
    this.v.normalize();
    this.foot.copy(this.hip).addScaledVector(this.v, d);

    // joelho dobra para a frente (perpendicular à linha quadril→pé)
    this.n.copy(FORWARD).addScaledVector(this.v, -FORWARD.dot(this.v)).normalize();
    const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    this.knee.copy(this.hip).addScaledVector(this.v, L1 * cosA).addScaledVector(this.n, L1 * sinA);

    leg.thigh.position.copy(this.hip);
    this.boneBasis(this.hip, this.knee, this.qThigh);
    this.boneBasis(this.knee, this.foot, this.qShin);

    leg.thigh.quaternion.copy(this.qThigh);
    leg.shin.quaternion.copy(this.qThigh).invert().multiply(this.qShin);
    // coturno sempre reto no chão (alinhado ao corpo)
    leg.ankle.quaternion.copy(this.qShin).invert();
  }

  /** Orientação de um osso: +Y aponta de `to` para `from`, +Z para trás (sem torção). */
  private boneBasis(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Quaternion): void {
    this.y.subVectors(from, to).normalize();
    this.z.set(0, 0, 1).addScaledVector(this.y, -this.y.z).normalize();
    this.x.crossVectors(this.y, this.z).normalize();
    this.m.makeBasis(this.x, this.y, this.z);
    out.setFromRotationMatrix(this.m);
  }

  private readonly shadowOnly: THREE.Object3D[] = [];

  /**
   * Tronco: camiseta camuflada + colete tático. Só a parte de baixo (barriga, bolsos e
   * cinto) aparece para o jogador ao olhar para baixo; peito, alças, cabeça e braços do
   * corpo ficam só na sombra — perto demais dos olhos, eles cobririam a tela.
   */
  private buildTorso(shirt: THREE.Material): void {
    const vest = new THREE.MeshStandardMaterial({ color: 0x4a5233, roughness: 0.9 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x2f3322, roughness: 0.85 });
    const t = this.torso;
    this.root.add(t);
    const { width: W, depth: D, height: H, visible: V } = TORSO;

    // parte visível: barriga, bolsos de carregador e cinto
    this.box(t, shirt, [W, V, D], [0, V / 2, 0]);
    this.box(t, vest, [W + 0.02, V * 0.55, 0.05], [0, V * 0.72, -D / 2 - 0.02]);
    for (let i = 0; i < 3; i++) {
      this.box(t, strap, [0.1, 0.12, 0.06], [-0.12 + i * 0.12, V * 0.68, -D / 2 - 0.07]);
      this.box(t, vest, [0.1, 0.03, 0.065], [-0.12 + i * 0.12, V * 0.68 + 0.055, -D / 2 - 0.07]);
    }
    this.box(t, strap, [W + 0.04, 0.05, D + 0.06], [0, 0.03, 0]); // cinto

    // só sombra: peito, colete superior, alças, cabeça e braços
    const upper = new THREE.Group();
    upper.position.y = V;
    t.add(upper);
    const U = H - V;
    this.box(upper, shirt, [W, U, D], [0, U / 2, 0]);
    this.box(upper, vest, [W + 0.02, U * 0.8, 0.05], [0, U * 0.4, -D / 2 - 0.02]);
    this.box(upper, vest, [W + 0.02, H * 0.62, 0.05], [0, U * 0.4, D / 2 + 0.02]);
    this.box(upper, strap, [0.06, 0.04, D + 0.1], [0.12, U - 0.02, 0]);
    this.box(upper, strap, [0.06, 0.04, D + 0.1], [-0.12, U - 0.02, 0]);
    const head = new THREE.Group();
    head.position.set(0, U, -0.02);
    upper.add(head);
    this.box(head, shirt, [0.12, 0.08, 0.12], [0, 0.04, 0]);
    this.box(head, vest, [0.26, 0.26, 0.26], [0, 0.2, 0]);
    this.box(head, strap, [0.3, 0.12, 0.3], [0, 0.3, 0]);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * (W / 2 + 0.05), U - 0.06, 0);
      arm.rotation.set(-1.1, 0, side * 0.25); // braços à frente segurando a arma
      upper.add(arm);
      this.box(arm, shirt, [0.11, 0.5, 0.11], [0, -0.25, 0]);
    }
    this.shadowOnly.push(upper);
  }

  private box(parent: THREE.Object3D, mat: THREE.Material, size: [number, number, number], pos: [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.scale.set(...size);
    mesh.position.set(...pos);
    parent.add(mesh);
    return mesh;
  }
}
