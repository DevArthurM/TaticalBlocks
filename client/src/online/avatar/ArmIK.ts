import * as THREE from 'three';

const _d = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _u = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * IK analítico de dois ossos (ombro → cotovelo → mão) no espaço do pai do ombro.
 * Os ossos apontam para −Y; o cotovelo dobra no próprio eixo X.
 *
 * @param target ponto que a mão deve alcançar (espaço do pai do ombro)
 * @param pole direção para onde o cotovelo deve apontar (mesmo espaço)
 */
export function solveArmIK(
  shoulder: THREE.Object3D,
  elbow: THREE.Object3D,
  upper: number,
  lower: number,
  target: THREE.Vector3,
  pole: THREE.Vector3,
): void {
  const s = shoulder.position;
  _d.subVectors(target, s);
  const dist = THREE.MathUtils.clamp(_d.length(), Math.abs(upper - lower) + 0.01, upper + lower - 0.001);
  _d.normalize();
  // ângulo entre o braço e a reta ombro→alvo (lei dos cossenos)
  const cosA = THREE.MathUtils.clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _perp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_perp.lengthSq() < 1e-8) _perp.set(0, -1, 0).addScaledVector(_d, _d.y);
  _perp.normalize();
  _u.copy(_d).multiplyScalar(cosA).addScaledVector(_perp, sinA).normalize();
  _e.copy(s).addScaledVector(_u, upper);
  _f.copy(_d).multiplyScalar(dist).add(s).sub(_e).normalize();

  // base do ombro: Y = −braço, X = eixo de dobra do cotovelo
  _y.copy(_u).negate();
  _x.crossVectors(_f, _u);
  if (_x.lengthSq() < 1e-8) _x.crossVectors(_perp, _u);
  _x.normalize();
  _z.crossVectors(_x, _y).normalize();
  _m.makeBasis(_x, _y, _z);
  shoulder.quaternion.setFromRotationMatrix(_m);

  // antebraço no espaço do ombro → ângulo do cotovelo em X
  const fy = _f.dot(_y);
  const fz = _f.dot(_z);
  elbow.rotation.set(Math.atan2(-fz, -fy), 0, 0);
}
