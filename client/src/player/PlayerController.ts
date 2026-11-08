import * as THREE from 'three';
import { PLAYER } from '../config/constants';
import { KEYS, type Input } from '../core/Input';
import { clamp, damp } from '../core/math';
import type { Vec3 } from '../shared/types';
import { type CapsuleBox, intersects, moveAndCollide } from './Collision';
import { LedgeClimb, type LedgePhase } from './LedgeClimb';
import { Vault } from './Vault';

/** Inclinação lateral da cabeça. */
/**
 * Subida da câmera ao atirar: cada tiro empurra a mira para cima (e um pouco para
 * o lado) e ela FICA lá — o jogador compensa puxando o mouse para baixo.
 */
const CLIMB = {
  /** Velocidade com que o tiro "entra" na câmera (1/s) — sobe em ~50 ms, sem salto seco. */
  apply: 40,
  /** Tempo sem atirar até a câmera começar a devolver parte da subida. */
  recoverDelay: 0.25,
  /** Fração da subida não compensada que volta sozinha. */
  recoverFraction: 0.4,
  /** Velocidade da volta (1/s). */
  recoverRate: 6,
} as const;

/** Deslize: correndo + C. */
const SLIDE = {
  /** Impulso sobre a velocidade de corrida. */
  boost: 1.3,
  /** Duração máxima (s). */
  duration: 0.9,
  /** Desaceleração (1/s) — atrito do chão. */
  friction: 1.5,
  /** Quanto o jogador consegue corrigir a direção (1/s). */
  steer: 1.6,
  /** Abaixo desta velocidade o deslize acaba. */
  minSpeed: 2.2,
} as const;

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
  /** Velocidade pretendida antes das colisões (para empurrar objetos). */
  readonly pushVelocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = true;
  sprinting = false;
  /** Velocidade de impacto da última aterrissagem (0 se não aterrissou neste frame). */
  landingImpact = 0;
  /** Multiplicador de velocidade da arma em mãos. */
  speedMultiplier = 1;
  /** Configurações do jogador. */
  sensitivity = 1;
  adsSensitivity: number = PLAYER.adsSensitivityScale;
  leanMode: 'segurar' | 'alternar' | 'desativado' = 'segurar';
  private leanToggle = 0;

  private shakeAmount = 0;
  private shakeTime = 0;

  private recoilKick = 0;
  private lean = 0;
  private readonly ledge: LedgeClimb;
  private readonly vault: Vault;
  private vaultSpeed = 0;
  private crouched = false;
  private crouchT = 0;
  /** Deslize em andamento: tempo restante, direção e velocidade. */
  private slideTime = 0;
  private slideSpeed = 0;
  private readonly slideDir = new THREE.Vector3();
  /** 0..1 suavizado (câmera, arma, corpo, rede). */
  private slideT = 0;
  /** Após deslizar, só volta a correr depois de soltar Shift/W. */
  private slideLock = false;
  /** Disparou neste quadro (som/poeira). */
  slideStarted = false;
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
    this.ledge = new LedgeClimb(colliders, PLAYER.radius, PLAYER.height, PLAYER.eyeHeight);
    this.vault = new Vault(colliders, PLAYER.radius, PLAYER.height);
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

  /** Vida (0..100). Regenera alguns segundos depois do último dano. */
  health = 100;
  /** 0..1 — "pancada" do último dano (para a tela vermelha). */
  hurt = 0;
  private sinceHurt = 99;

  damage(amount: number): void {
    this.health = Math.max(0, this.health - amount);
    this.hurt = Math.min(1, this.hurt + amount / 25);
    this.sinceHurt = 0;
    this.shake(0.25);
  }

  /** Regeneração de vida (desligada no online: o servidor manda na vida). */
  regen = true;

  private updateHealth(dt: number): void {
    this.sinceHurt += dt;
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    if (this.regen && this.sinceHurt > 3.5 && this.health > 0) this.health = Math.min(100, this.health + 14 * dt);
  }

  /** Desvio de mira transferido para a câmera (luneta), em rad. */
  aimOffsetPitch = 0;
  aimOffsetYaw = 0;

  /** Tranco leve de câmera que volta sozinho (o recuo "real" fica no braço). */
  addRecoil(pitch: number, yaw: number): void {
    this.recoilKick += pitch;
    this.yawKick += yaw;
  }

  /** Subida a aplicar nos próximos quadros (rad). */
  private climbPending = { pitch: 0, yaw: 0 };
  /** Subida acumulada que o jogador ainda não compensou (parte volta sozinha). */
  private climbDebt = 0;
  private climbRecover = 0;
  private sinceShot = 99;

  /** Tiro: a câmera sobe `pitch` (e desvia `yaw`) e fica na nova posição. */
  addCameraClimb(pitch: number, yaw: number): void {
    this.climbPending.pitch += pitch;
    this.climbPending.yaw += yaw;
    this.sinceShot = 0;
    this.climbRecover = 0;
  }

  /** Aplica a subida aos poucos e, ao parar de atirar, devolve parte do que não foi compensado. */
  private updateClimb(dt: number, mouseDown: number): void {
    // puxar o mouse para baixo paga a "dívida" de subida (não volta o que já foi compensado)
    if (mouseDown > 0) this.climbDebt = Math.max(0, this.climbDebt - mouseDown);
    const k = 1 - Math.exp(-CLIMB.apply * dt);
    const dp = this.climbPending.pitch * k;
    const dy = this.climbPending.yaw * k;
    this.climbPending.pitch -= dp;
    this.climbPending.yaw -= dy;
    this.pitch = clamp(this.pitch + dp, -1.55, 1.55);
    this.yaw += dy;
    this.climbDebt += dp;

    this.sinceShot += dt;
    if (this.sinceShot > CLIMB.recoverDelay && this.climbDebt > 1e-4) {
      if (this.climbRecover === 0) this.climbRecover = this.climbDebt * CLIMB.recoverFraction;
      const back = Math.min(this.climbRecover, this.climbRecover * (1 - Math.exp(-CLIMB.recoverRate * dt)) + 1e-4);
      this.climbRecover -= back;
      this.climbDebt = Math.max(0, this.climbDebt - back);
      this.pitch = clamp(this.pitch - back, -1.55, 1.55);
      if (this.climbRecover <= 1e-4) this.climbDebt = 0;
    }
  }

  update(dt: number, input: Input, opts: PlayerUpdateOptions): void {
    const pitchBefore = this.pitch;
    this.updateLook(input, opts.aiming);
    this.updateClimb(dt, Math.max(0, pitchBefore - this.pitch));
    this.updateMovement(dt, input, opts);
    this.updateLean(dt, input);
    this.updateHealth(dt);
    this.recoilKick = damp(this.recoilKick, 0, 14, dt);
    this.yawKick = damp(this.yawKick, 0, 14, dt);
    this.shakeAmount = damp(this.shakeAmount, 0, 4, dt);
    this.shakeTime += dt;
    this.syncCamera();
  }

  private updateLook(input: Input, aiming: boolean): void {
    const sens = PLAYER.mouseSensitivity * this.sensitivity * (aiming ? this.adsSensitivity : 1);
    this.yaw -= input.mouseDX * sens;
    this.pitch = clamp(this.pitch - input.mouseDY * sens, -1.55, 1.55);
  }

  /** Pendurado: Espaço segura, W escala, soltar Espaço ou S cai. */
  private updateLedge(dt: number, input: Input): void {
    this.velocity.set(0, 0, 0);
    this.sprinting = false;
    this.landingImpact = 0;
    const ev = this.ledge.update(
      dt,
      { holdingJump: input.isDown(KEYS.jump), forward: input.isDown(KEYS.forward), back: input.isDown(KEYS.back) },
      this.position,
    );
    this.onGround = ev === 'done';
    if (ev === 'released') this.velocity.y = -1;
  }

  /**
   * Agachar (C alterna). Correr para frente ou pular levantam o jogador.
   * Só levanta se houver espaço acima da cabeça.
   */
  private startSlide(): void {
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > 0.5) this.slideDir.set(this.velocity.x / hs, 0, this.velocity.z / hs);
    else this.slideDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.slideSpeed = Math.max(hs, PLAYER.sprintSpeed * this.speedMultiplier) * SLIDE.boost;
    this.slideTime = SLIDE.duration;
    this.crouched = true;
    this.sprinting = false;
    this.slideLock = true;
    this.slideStarted = true;
  }

  /** Durante o deslize: desacelera, corrige pouco a direção; Espaço pula com o embalo. */
  private updateSlide(dt: number, input: Input): void {
    this.slideTime -= dt;
    this.slideSpeed = damp(this.slideSpeed, 0, SLIDE.friction, dt);
    if (this.wish.lengthSq() > 0) {
      this.slideDir.lerp(this.wish, Math.min(1, SLIDE.steer * dt)).setY(0).normalize();
    }
    this.velocity.x = this.slideDir.x * this.slideSpeed;
    this.velocity.z = this.slideDir.z * this.slideSpeed;
    this.speedCap = this.slideSpeed;
    this.sprinting = false;
    // agachado durante o deslize (o corpo abaixa já)
    this.crouchT = damp(this.crouchT, 1, 18, dt);
    this.body.height = PLAYER.height + (PLAYER.crouchHeight - PLAYER.height) * this.crouchT;
    const jump = this.onGround && input.wasPressed(KEYS.jump) && this.canStand();
    if (jump) {
      // pulo no deslize: levanta e conserva o embalo
      this.crouched = false;
      this.velocity.y = PLAYER.jumpVelocity;
      this.onGround = false;
    }
    if (jump || this.slideTime <= 0 || this.slideSpeed < SLIDE.minSpeed || !this.onGround) {
      this.slideTime = 0;
    }
  }

  /** 0..1: quanto o jogador está deslizando (câmera, arma, corpo e rede). */
  get slideAmount(): number {
    return this.slideT;
  }

  get sliding(): boolean {
    return this.slideTime > 0;
  }

  private updateCrouch(dt: number, input: Input, wantsSprintForward: boolean): void {
    if (input.wasPressed(KEYS.crouch)) {
      if (!this.crouched) this.crouched = true;
      else if (this.canStand()) this.crouched = false;
    } else if (this.crouched && (wantsSprintForward || input.wasPressed(KEYS.jump)) && this.canStand()) {
      this.crouched = false;
    }
    this.crouchT = damp(this.crouchT, this.crouched ? 1 : 0, 12, dt);
    this.body.height = PLAYER.height + (PLAYER.crouchHeight - PLAYER.height) * this.crouchT;
  }

  private canStand(): boolean {
    const probe: CapsuleBox = { position: this.position, radius: this.body.radius - 0.02, height: PLAYER.height };
    return !this.colliders.some((b) => intersects(probe, b) && b.min.y > this.position.y + 0.05);
  }

  /** 0 = em pé, 1 = agachado (suavizado). */
  get crouchAmount(): number {
    return this.crouchT;
  }

  private get eyeHeight(): number {
    // passando por cima de um obstáculo o corpo encolhe (olho mais baixo no meio do movimento)
    return PLAYER.eyeHeight + (PLAYER.crouchEyeHeight - PLAYER.eyeHeight) * this.crouchT - this.vault.cameraDip * 0.3;
  }

  /** Pendurado ou escalando uma quina (null = movimento normal). */
  get ledgePhase(): LedgePhase | null {
    return this.ledge.phase;
  }

  /** Mãos na quina (mundo). Retorna false se não estiver agarrado. */
  ledgeHands(left: THREE.Vector3, right: THREE.Vector3): boolean {
    return this.ledge.handPoints(left, right);
  }

  private updateMovement(dt: number, input: Input, opts: PlayerUpdateOptions): void {
    this.ledge.tick(dt);
    if (this.ledge.phase) {
      this.updateLedge(dt, input);
      return;
    }
    if (this.vault.active) {
      this.updateVault(dt);
      return;
    }
    const f = Number(input.isDown(KEYS.forward)) - Number(input.isDown(KEYS.back));
    const r = Number(input.isDown(KEYS.right)) - Number(input.isDown(KEYS.left));

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.wish.set(-sin * f + cos * r, 0, -cos * f - sin * r);
    if (this.wish.lengthSq() > 0) this.wish.normalize();

    // Espaço de frente para um obstáculo baixo (até 60% da altura): passa por cima
    if (this.onGround && this.slideTime <= 0 && input.wasPressed(KEYS.jump)) {
      const dir = this.wish.lengthSq() > 0 ? this.wish : this.tmpDir.set(-sin, 0, -cos);
      if (this.vault.tryStart(this.position, dir)) {
        this.vaultSpeed = Math.max(PLAYER.walkSpeed * 0.8, Math.hypot(this.velocity.x, this.velocity.z));
        this.crouched = false;
        this.sprinting = false;
        this.onGround = false;
        this.velocity.set(0, 0, 0);
        return;
      }
    }

    const wantsSprint = input.isDown(KEYS.sprint) || input.isDown('ShiftRight');
    if (this.slideLock && !(wantsSprint && f > 0)) this.slideLock = false;
    this.slideStarted = false;

    // correndo + C: desliza para a frente e termina agachado
    if (this.sprinting && this.onGround && this.slideTime <= 0 && input.wasPressed(KEYS.crouch)) this.startSlide();
    if (this.slideTime > 0) {
      this.updateSlide(dt, input);
    } else {
      this.updateCrouch(dt, input, wantsSprint && f > 0 && !this.slideLock);
      this.sprinting = opts.canSprint && !opts.aiming && !this.crouched && !this.slideLock && wantsSprint && f > 0 && (this.onGround || this.sprinting);

      let base: number = this.sprinting ? PLAYER.sprintSpeed : opts.aiming ? PLAYER.adsSpeed : PLAYER.walkSpeed;
      if (this.crouched) base = Math.min(base, PLAYER.crouchSpeed);
      const speed = base * this.speedMultiplier;
      this.speedCap = speed;
      const accel = this.onGround ? PLAYER.groundAccel : PLAYER.airAccel;
      this.velocity.x = damp(this.velocity.x, this.wish.x * speed, accel, dt);
      this.velocity.z = damp(this.velocity.z, this.wish.z * speed, accel, dt);
    }
    this.slideT = damp(this.slideT, this.slideTime > 0 ? 1 : 0, this.slideTime > 0 ? 14 : 7, dt);
    const speed = this.speedCap;

    if (this.onGround && input.wasPressed(KEYS.jump) && !this.crouched) {
      this.velocity.y = PLAYER.jumpVelocity;
      this.onGround = false;
    }
    this.velocity.y += PLAYER.gravity * dt;

    // o que o jogador QUER fazer (teclas): mesmo travado na caixa, continua empurrando
    this.pushVelocity.set(this.wish.x * speed, 0, this.wish.z * speed);
    if (moveAndCollide(this.body, 'x', this.velocity.x * dt, this.colliders)) {
      this.velocity.x = 0;
      if (this.slideTime > 0) this.slideSpeed *= 0.4; // bateu de lado/de frente: freia
    }
    if (moveAndCollide(this.body, 'z', this.velocity.z * dt, this.colliders)) {
      this.velocity.z = 0;
      if (this.slideTime > 0) this.slideSpeed *= 0.4;
    }

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

    // no ar segurando Espaço: tenta se agarrar a uma quina à frente
    if (!this.onGround && this.ledge.tryGrab(this.position, this.velocity, this.yaw, input.isDown(KEYS.jump))) {
      this.velocity.set(0, 0, 0);
      this.crouched = false;
      this.sprinting = false;
    }
  }

  private readonly tmpDir = new THREE.Vector3();

  /** Durante o salto sobre o obstáculo: movimento roteirizado, sem colisão. */
  private updateVault(dt: number): void {
    this.sprinting = false;
    this.landingImpact = 0;
    if (this.vault.update(dt, this.position)) {
      // sai andando na mesma direção
      this.velocity.set(this.vault.dir.x * this.vaultSpeed, 0, this.vault.dir.z * this.vaultSpeed);
      this.onGround = true;
      this.landingImpact = 2.5;
    }
  }

  /** Passando por cima de um obstáculo? */
  get vaulting(): boolean {
    return this.vault.active;
  }

  /**
   * Inclinar (Q/E): a cabeça desliza para o lado e gira em torno do olhar.
   * Não atravessa paredes: a distância é limitada por um raio a partir dos olhos.
   */
  private updateLean(dt: number, input: Input): void {
    let dir = 0;
    if (this.leanMode === 'segurar') {
      dir = Number(input.isDown(KEYS.leanRight)) - Number(input.isDown(KEYS.leanLeft));
    } else if (this.leanMode === 'alternar') {
      // toque inclina; tocar de novo no mesmo lado volta ao centro; o outro lado troca
      if (input.wasPressed(KEYS.leanLeft)) this.leanToggle = this.leanToggle === -1 ? 0 : -1;
      if (input.wasPressed(KEYS.leanRight)) this.leanToggle = this.leanToggle === 1 ? 0 : 1;
      if (this.sprinting) this.leanToggle = 0;
      dir = this.leanToggle;
    } else {
      this.leanToggle = 0;
    }
    const target = this.sprinting ? 0 : dir;
    this.lean = damp(this.lean, target, 10, dt);

    const side = Math.sign(this.lean);
    let maxOffset: number = LEAN.offset;
    if (side !== 0) {
      this.leanRay.origin.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
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

  /** Velocidade para a frente relativa à câmera em m/s (+ = frente, − = ré). */
  get forwardSpeed(): number {
    return -(this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw));
  }

  /** -1 (esquerda) .. 1 (direita). */
  get leanAmount(): number {
    return this.lean;
  }

  private syncCamera(): void {
    const off = Math.min(Math.abs(this.lean) * LEAN.offset, this.leanLimit) * Math.sign(this.lean);
    this.camera.position.set(
      this.position.x + Math.cos(this.yaw) * off,
      this.position.y + this.eyeHeight - Math.abs(this.lean) * LEAN.drop,
      this.position.z - Math.sin(this.yaw) * off,
    );
    const s = this.shakeAmount * 0.03;
    const t = this.shakeTime;
    this.camera.rotation.set(
      this.pitch + this.recoilKick + this.aimOffsetPitch - this.ledge.cameraDip - this.vault.cameraDip * 0.06 + Math.sin(t * 47) * s,
      this.yaw + this.yawKick + this.aimOffsetYaw + Math.sin(t * 39 + 1) * s,
      -this.lean * LEAN.roll + this.slideT * 0.07 + this.vault.cameraDip * 0.05 + Math.sin(t * 31 + 2) * s,
      'YXZ',
    );
  }
}
