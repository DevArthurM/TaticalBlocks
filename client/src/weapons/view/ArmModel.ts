import * as THREE from 'three';
import { boxPart } from './boxPart';
import type { ArmMaterials } from './materials';

const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpOffset = new THREE.Vector3();
const rollQuat = new THREE.Quaternion();
const tmpBend = new THREE.Vector3();
const tmpHint = new THREE.Vector3();
/** Lado convexo da dobra do cotovelo no espaço local do braço. */
const ELBOW_LOCAL = new THREE.Vector3(0, 0, -1);

/**
 * Braço voxel inspirado na referência: manga camuflada, barra dobrada,
 * antebraço com cotovelo levemente dobrado e luva preta.
 * A cadeia é construída ao longo de -Y; `aim` posiciona a mão num alvo.
 */
export class ArmModel {
  readonly root = new THREE.Group();
  private readonly handLocal = new THREE.Vector3();
  /** Braço de cima (manga + barra). */
  private readonly upper = new THREE.Group();

  constructor(m: ArmMaterials, side: 'left' | 'right', scale = 1) {
    const mirror = side === 'left' ? -1 : 1;
    this.root.name = `arm-${side}`;

    // braço de cima: manga longa (sai da tela) + barra dobrada
    this.upper.position.y = -0.24;
    this.root.add(this.upper);
    boxPart(this.upper, m.sleeve, [0.085, 0.7, 0.085], [0, 0.37, 0]);
    boxPart(this.upper, m.cuff, [0.1, 0.052, 0.1], [0, 0.025, 0]);

    const forearm = new THREE.Group();
    forearm.position.y = -0.24;
    this.root.add(forearm);
    boxPart(forearm, m.skin, [0.064, 0.1, 0.064], [0, -0.05, 0]);

    const lower = new THREE.Group();
    lower.position.y = -0.095;
    // dobra só num plano (local X) — a direção do cotovelo é controlada em `aim`
    lower.rotation.x = -0.32;
    forearm.add(lower);
    boxPart(lower, m.skin, [0.06, 0.12, 0.06], [0, -0.06, 0]);

    const glove = new THREE.Group();
    glove.position.y = -0.115;
    lower.add(glove);
    boxPart(glove, m.glove, [0.07, 0.032, 0.07], [0, -0.012, 0]);
    boxPart(glove, m.glove, [0.074, 0.068, 0.07], [0, -0.06, 0]);
    boxPart(glove, m.glove, [0.078, 0.024, 0.03], [0, -0.075, -0.034]);
    boxPart(glove, m.glove, [0.026, 0.04, 0.03], [-0.04 * mirror, -0.045, -0.02]);

    const hand = new THREE.Object3D();
    hand.position.y = -0.058;
    glove.add(hand);

    this.root.updateMatrixWorld(true);
    hand.getWorldPosition(this.handLocal);
    this.root.scale.setScalar(scale);
    this.handLocal.multiplyScalar(scale);
  }

  /**
   * Coloca a mão em `hand` vindo de `shoulder`. O cotovelo (lado convexo da dobra)
   * é girado para apontar o mais próximo possível de `elbowHint` (espaço da câmera),
   * evitando que ele "vire para fora".
   */
  aim(hand: THREE.Vector3, shoulder: THREE.Vector3, elbowHint: THREE.Vector3, roll = 0): void {
    tmpFrom.copy(this.handLocal).normalize();
    tmpTo.subVectors(hand, shoulder).normalize();
    this.root.quaternion.setFromUnitVectors(tmpFrom, tmpTo);

    // ângulo entre o cotovelo atual e o desejado, ambos projetados no plano ⟂ ao braço
    tmpBend.copy(ELBOW_LOCAL).applyQuaternion(this.root.quaternion).addScaledVector(tmpTo, -tmpBend.dot(tmpTo));
    tmpHint.copy(elbowHint).addScaledVector(tmpTo, -elbowHint.dot(tmpTo));
    if (tmpBend.lengthSq() > 1e-8 && tmpHint.lengthSq() > 1e-8) {
      tmpBend.normalize();
      tmpHint.normalize();
      const sign = Math.sign(tmpOffset.crossVectors(tmpBend, tmpHint).dot(tmpTo)) || 1;
      roll += sign * Math.acos(Math.min(1, Math.max(-1, tmpBend.dot(tmpHint))));
    }
    if (roll !== 0) this.root.quaternion.premultiply(rollQuat.setFromAxisAngle(tmpTo, roll));
    tmpOffset.copy(this.handLocal).applyQuaternion(this.root.quaternion);
    this.root.position.copy(hand).sub(tmpOffset);
  }
}
