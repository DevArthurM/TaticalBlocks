import * as THREE from 'three';
import { PLAYER } from '../config/constants';
import { KEYS, type Input } from '../core/Input';
import { clamp, damp } from '../core/math';
import type { Vec3 } from '../shared/types';
import { type CapsuleBox, moveAndCollide } from './Collision';

/** Inclinação lateral da cabeça. */
const LEAN = {
  /** Deslocamento lateral máximo dos olhos (m). */
  offset: 0.42,
  /** Quanto a cabeça abaixa ao inclinar (m). */
  drop: 0.06,
  /** Rotação máxima da câmera (rad ≈ 14°). */
  roll: 0.24,
  /** Distância mínima entre os olhos e a parede. */
  wallGap: 0.2,
} as const;

export interface PlayerUpdateOptions {
  aiming: boolean;
  /** Arma permite correr (ex.: não está recarregando com ADS). */
  canSprint: boolean;
}

/** Movimento em primeira pessoa: andar, correr, pular, colisão e câmera. */
export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = true;
  sprinting = false;
  /** Velocidade de impacto da última aterrissagem (0 se não aterrissou neste frame). */
  landingImpact = 0;
  /** Multiplicador de velocidade da arma em mãos. */
  speedMultiplier = 1;

  private shakeAmount = 0;
  private shakeTime = 0;

  private recoilKick = 0;
  private lean = 0;
  private speedCap: number = PLAYER.walkSpeed;
  private leanLimit: number = LEAN.offset;
  private readonly leanRay = new THREE.Ray();
  private readonly leanHit = new THREE.Vector3();
  private yawKick = 0;
  private readonly body: CapsuleBox;
  private readonly wish = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly colliders: readonly THREE.Box3[],
    spawn: Vec3,
  ) {
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.body = { position: this.position, radius: PLAYER.radius, height: PLAYER.height };
    this.syncCamera();
  }

  /** Velocidade lateral relativa à câmera em m/s (+ = direita). */
  get strafeSpeed(): number {
    return this.velocity.x * Math.cos(this.yaw) - this.velocity.z * Math.sin(this.yaw);
  }

  /** Velocidade horizontal em m/s. */
  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Tremor de câmera (explosões, golpes). */
  shake(amount: number): void {
    this.shakeAmount = Math.min(1.5, this.shakeAmount + amount);
  }

  /** Desvio de mira transferido para a câmera (luneta), em rad. */
  aimOffsetPitch = 0;
  aimOffsetYaw = 0;

  /** Tranco leve de câmera que volta sozinho (o recuo "real" fica no braço). */
  addRecoil(pitch: number, yaw: number): void {
    this.recoilKick += pitch;
    this.yawKick += yaw;
  }

  update(dt: number, input: Input, opts: PlayerUpdateOptions): void {
    this.updateLook(input, opts.aiming);
    this.updateMovement(dt, input, opts);
    this.updateLean(dt, input);
    this.recoilKick = damp(this.recoilKick, 0, 14, dt);
    this.yawKick = damp(this.yawKick, 0, 14, dt);
    this.shakeAmount = damp(this.shakeAmount, 0, 4, dt);
    this.shakeTime += dt;
    this.syncCamera();
  }

  private updateLook(input: Input, aiming: boolean): void {
    const sens = PLAYER.mouseSensitivity * (aiming ? PLAYER.adsSensitivityScale : 1);
    this.yaw -= input.mouseDX * sens;
    this.pitch = clamp(this.pitch - input.mouseDY * sens, -1.55, 1.55);
  }

  private updateMovement(dt: number, input: Input, opts: PlayerUpdateOptions): void {
    const f = Number(input.isDown(KEYS.forward)) - Number(input.isDown(KEYS.back));
    const r = Number(input.isDown(KEYS.right)) - Number(input.isDown(KEYS.left));

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.wish.set(-sin * f + cos * r, 0, -cos * f - sin * r);
    if (this.wish.lengthSq() > 0) this.wish.normalize();

    const wantsSprint = input.isDown(KEYS.sprint) || input.isDown('ShiftRight');
    this.sprinting = opts.canSprint && !opts.aiming && wantsSprint && f > 0 && (this.onGround || this.sprinting);

    const speed = (this.sprinting ? PLAYER.sprintSpeed : opts.aiming ? PLAYER.adsSpeed : PLAYER.walkSpeed) * this.speedMultiplier;
    this.speedCap = speed;
    const accel = this.onGround ? PLAYER.groundAccel : PLAYER.airAccel;
    this.velocity.x = damp(this.velocity.x, this.wish.x * speed, accel, dt);
    this.velocity.z = damp(this.velocity.z, this.wish.z * speed, accel, dt);

    if (this.onGround && input.wasPressed(KEYS.jump)) {
      this.velocity.y = PLAYER.jumpVelocity;
      this.onGround = false;
    }
    this.velocity.y += PLAYER.gravity * dt;

    if (moveAndCollide(this.body, 'x', this.velocity.x * dt, this.colliders)) this.velocity.x = 0;
    if (moveAndCollide(this.body, 'z', this.velocity.z * dt, this.colliders)) this.velocity.z = 0;

    const wasGrounded = this.onGround;
    const fallSpeed = this.velocity.y;
    this.onGround = false;
    if (moveAndCollide(this.body, 'y', this.velocity.y * dt, this.colliders)) {
      if (this.velocity.y < 0) this.onGround = true;
      this.velocity.y = 0;
    }
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

    this.landingImpact = !wasGrounded && this.onGround ? Math.abs(fallSpeed) : 0;
  }

  /**
   * Inclinar (Q/E): a cabeça desliza para o lado e gira em torno do olhar.
   * Não atravessa paredes: a distância é limitada por um raio a partir dos olhos.
   */
  private updateLean(dt: number, input: Input): void {
    const dir = Number(input.isDown(KEYS.leanRight)) - Number(input.isDown(KEYS.leanLeft));
    const target = this.sprinting ? 0 : dir;
    this.lean = damp(this.lean, target, 10, dt);

    const side = Math.sign(this.lean);
    let maxOffset: number = LEAN.offset;
    if (side !== 0) {
      this.leanRay.origin.set(this.position.x, this.position.y + PLAYER.eyeHeight, this.position.z);
      this.leanRay.direction.set(Math.cos(this.yaw) * side, 0, -Math.sin(this.yaw) * side);
      for (const box of this.colliders) {
        const hit = this.leanRay.intersectBox(box, this.leanHit);
        if (hit) maxOffset = Math.min(maxOffset, Math.max(0, hit.distanceTo(this.leanRay.origin) - LEAN.wallGap));
      }
    }
    // suaviza também o limite para não "estalar" ao encostar numa parede
    this.leanLimit = damp(this.leanLimit, maxOffset, 18, dt);
  }

  /**
   * Velocidade lateral relativa ao máximo atual, em "m/s equivalentes de caminhada":
   * andar de lado mirando (mais lento) produz o mesmo valor que andando normal.
   */
  get strafeRelative(): number {
    return (this.strafeSpeed / Math.max(this.speedCap, 0.1)) * PLAYER.walkSpeed;
  }

  /** -1 (esquerda) .. 1 (direita). */
  get leanAmount(): number {
    return this.lean;
  }

  private syncCamera(): void {
    const off = Math.min(Math.abs(this.lean) * LEAN.offset, this.leanLimit) * Math.sign(this.lean);
    this.camera.position.set(
      this.position.x + Math.cos(this.yaw) * off,
      this.position.y + PLAYER.eyeHeight - Math.abs(this.lean) * LEAN.drop,
      this.position.z - Math.sin(this.yaw) * off,
    );
    const s = this.shakeAmount * 0.03;
    const t = this.shakeTime;
    this.camera.rotation.set(
      this.pitch + this.recoilKick + this.aimOffsetPitch + Math.sin(t * 47) * s,
      this.yaw + this.yawKick + this.aimOffsetYaw + Math.sin(t * 39 + 1) * s,
      -this.lean * LEAN.roll + Math.sin(t * 31 + 2) * s,
      'YXZ',
    );
  }
}
