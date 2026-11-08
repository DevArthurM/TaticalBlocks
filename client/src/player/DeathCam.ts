import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/** Corpo da "cabeça" (caixa um pouco alongada: tomba e rola até parar de lado). */
const HEAD = { half: [0.1, 0.12, 0.13] as const, mass: 5, linearDamping: 0.08, angularDamping: 0.35 };
/** Paredes do mapa num raio deste tamanho viram colisão enquanto a câmera cai. */
const WALL_RADIUS = 6;
/** Altura mínima da câmera (plano near = 0.05). */
const MIN_EYE = 0.09;
/** Quanto o olho sobe depois de assentar. */
const REST_LIFT = 0.07;

/**
 * Câmera de morte: a câmera do jogador vira um corpo rígido que cai, quica e
 * rola pelo chão. Quando o corpo assenta, a visão se acomoda deitada de lado
 * olhando ao longo do chão (sem ficar encarando o piso).
 */
export class DeathCam {
  active = false;
  private body: CANNON.Body | null = null;
  /** Orientação da câmera no momento da morte (no referencial do corpo). */
  private readonly q0 = new THREE.Quaternion();
  private readonly qBody = new THREE.Quaternion();
  private readonly qView = new THREE.Quaternion();
  private readonly qRest = new THREE.Quaternion();
  private readonly fwd = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private settle = 0;
  private side = 1;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly walls: readonly THREE.Box3[],
  ) {}

  /**
   * Começa a queda.
   * @param velocity velocidade do jogador ao morrer
   * @param push direção do golpe/tiro que matou (empurra e faz girar)
   */
  start(velocity: THREE.Vector3, push: THREE.Vector3 | null): void {
    this.stop();
    const cam = this.camera;
    const dir = push && push.lengthSq() > 1e-6 ? push.clone().setY(0).normalize() : cam.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate();

    // paredes próximas entram na física só durante a queda
    const near = this.walls.filter((b) => b.distanceToPoint(cam.position) < WALL_RADIUS);
    this.physics.setStatic('deathcam-walls', near);

    const body = new CANNON.Body({
      mass: HEAD.mass,
      material: this.physics.material,
      shape: new CANNON.Box(new CANNON.Vec3(...HEAD.half)),
      linearDamping: HEAD.linearDamping,
      angularDamping: HEAD.angularDamping,
      allowSleep: true,
      sleepSpeedLimit: 0.15,
    });
    body.position.set(cam.position.x, cam.position.y, cam.position.z);
    const kick = 1.6 + Math.random() * 1.2;
    body.velocity.set(velocity.x * 0.8 + dir.x * kick, Math.max(0, velocity.y) + 0.6, velocity.z * 0.8 + dir.z * kick);
    // tomba para a frente do empurrão (eixo perpendicular) + um giro lateral aleatório
    const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    const spin = 4 + Math.random() * 3;
    this.side = Math.random() < 0.5 ? -1 : 1;
    body.angularVelocity.set(axis.x * spin + dir.x * this.side * 2.5, (Math.random() - 0.5) * 3, axis.z * spin + dir.z * this.side * 2.5);
    this.physics.world.addBody(body);
    this.body = body;

    this.q0.copy(cam.quaternion);
    this.settle = 0;
    this.active = true;
  }

  update(dt: number): void {
    const b = this.body;
    if (!this.active || !b) return;
    const cam = this.camera;

    this.qBody.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    this.qView.copy(this.qBody).multiply(this.q0);

    // quase parado no chão → acomoda a visão deitada de lado, olhando ao longo do piso
    const slow = b.velocity.length() < 0.8 && b.angularVelocity.length() < 2.5 && b.position.y < 0.4;
    this.settle = THREE.MathUtils.clamp(this.settle + (slow ? dt / 0.9 : -dt * 0.5), 0, 1);
    if (this.settle > 0) {
      this.fwd.set(0, 0, -1).applyQuaternion(this.qView);
      const yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
      this.euler.setFromQuaternion(this.qView, 'YXZ');
      const roll = Math.abs(this.euler.z) > 0.3 ? Math.sign(this.euler.z) * 1.35 : this.side * 1.35;
      this.qRest.setFromEuler(this.euler.set(-0.12, yaw, roll, 'YXZ'));
      const k = this.settle * this.settle * (3 - 2 * this.settle);
      this.qView.slerp(this.qRest, k);
    }
    cam.quaternion.copy(this.qView);
    // assentado: o olho sobe um pouco para o chão não tomar a tela
    cam.position.set(b.position.x, Math.max(MIN_EYE, b.position.y) + this.settle * REST_LIFT, b.position.z);
  }

  stop(): void {
    if (this.body) this.physics.world.removeBody(this.body);
    this.body = null;
    if (this.active) this.physics.setStatic('deathcam-walls', []);
    this.active = false;
  }
}
