import type { Loadout } from '@shared/weapons/loadout';
import type { FirearmDef, MeleeDef, ThrowableDef, WeaponCategory } from '@shared/weapons/types';
import * as THREE from 'three';
import type { SoundEngine } from '../audio/SoundEngine';
import { CAMERA } from '../config/constants';
import { KEYS, type Input } from '../core/Input';
import { approach, damp, lerp } from '../core/math';
import type { Decals } from '../effects/Decals';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { PlayerController } from '../player/PlayerController';
import { boltCycle, DRAW_CLIP, inspectClip, MELEE_CLIPS, pumpCycle, throwClip } from './animation/actions';
import { ammoGifId, WEAPON_AMMO } from './models/ammo';
import type { Clip, Cue } from './animation/Clip';
import { RELOADS } from './animation/reloads';
import type { Explosions } from './combat/Explosions';
import type { Projectiles } from './combat/Projectiles';
import { ArmRecoil } from './logic/ArmRecoil';
import type { Firearm } from './logic/Firearm';
import { type EquipSlot, type HeldItem, Inventory, SLOT_ORDER } from './logic/Inventory';
import { Viewmodel } from './view/Viewmodel';

export interface WeaponManagerDeps {
  loadout: Loadout;
  camera: THREE.PerspectiveCamera;
  viewmodelScene: THREE.Scene;
  worldScene: THREE.Scene;
  hitTargets: THREE.Object3D[];
  player: PlayerController;
  audio: SoundEngine;
  particles: ParticleSystem;
  decals: Decals;
  explosions: Explosions;
  projectiles: Projectiles;
  /**
   * Algo foi atingido (tiro/golpe). Retorna true se o alvo tratou o impacto
   * (bloco destrutível ou caixa com física) — aí não se coloca marca de bala.
   */
  onHit?: (hit: THREE.Intersection, dir: THREE.Vector3, damage: number) => boolean;
  /** Inimigos: testa o raio até `far` (antes do cenário). Retorna o acerto, se houver. */
  enemies?: { shoot(origin: THREE.Vector3, dir: THREE.Vector3, far: number, damage: number): { distance: number } | null };
}

const DRAW_TIME: Record<WeaponCategory, number> = {
  pistol: 0.35,
  smg: 0.45,
  rifle: 0.55,
  shotgun: 0.55,
  sniper: 0.65,
  heavy: 0.85,
  melee: 0.35,
  throwable: 0.35,
};

const THROW_TIME = 0.95;
const INSPECT_TIME = 2.6;
/** Intensidade do giro da inspeção por categoria (armas longas giram menos). */
const INSPECT_SCALE: Record<WeaponCategory, number> = {
  pistol: 1,
  smg: 0.85,
  rifle: 0.65,
  shotgun: 0.65,
  sniper: 0.55,
  heavy: 0.4,
  melee: 1,
  throwable: 1,
};

/** Liga entrada → inventário → lógica da arma → viewmodel, disparo, golpes e arremessos. */
/** Fração do recuo de cada arma que vira subida permanente da câmera. */
const CAMERA_CLIMB = { hip: 0.55, ads: 0.4 } as const;

export class WeaponManager {
  readonly inventory: Inventory;
  readonly viewmodel: Viewmodel;
  activeSlot: EquipSlot | null = null;
  /** 0..1 — quanto está mirando. */
  adsT = 0;
  /** Dispersão atual (rad), para a mira do HUD. */
  spread = 0;
  /** FOV base (configuração do jogador). */
  baseFov: number = CAMERA.fov;
  /** Tempo restante da inspeção (V). */
  inspectTime = 0;
  /** Mirar segurando o botão direito ou alternando com um clique. */
  aimMode: 'segurar' | 'alternar' = 'segurar';
  private aimToggled = false;
  /** Tensão do braço (recuo que volta à posição inicial). */
  readonly armRecoil = new ArmRecoil();
  /** Parte do desvio que fica na arma/mira (o resto vai para a câmera com luneta). */
  readonly aimOffset = { pitch: 0, yaw: 0 };

  private lastSlot: EquipSlot | null = null;
  private drawLock = 0;
  private busyLock = 0;
  private bloom = 0;
  private throwPending = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly flashLight = new THREE.PointLight(0xffb36b, 0, 9, 2);
  private readonly ledgeL = new THREE.Vector3();
  private readonly ledgeR = new THREE.Vector3();
  private flashTimer = 0;

  constructor(private readonly d: WeaponManagerDeps) {
    this.inventory = new Inventory(d.loadout);
    this.viewmodel = new Viewmodel(d.viewmodelScene);
    this.viewmodel.onCue = (cue) => this.handleCue(cue);
    d.worldScene.add(this.flashLight);
    this.equip(this.inventory.firstAvailable());
  }

  get held(): HeldItem | undefined {
    return this.activeSlot ? this.inventory.get(this.activeSlot) : undefined;
  }

  get gun(): Firearm | null {
    const h = this.held;
    return h?.kind === 'firearm' ? h.gun : null;
  }

  get aiming(): boolean {
    return this.adsT > 0.5;
  }

  get scoped(): boolean {
    const h = this.held;
    return h?.kind === 'firearm' && h.def.sight === 'scope' && this.adsT > 0.85;
  }

  /** FOV da câmera do mundo considerando a mira da arma. */
  get fov(): number {
    const h = this.held;
    // zoom de miras de ferro/red-dot acompanha o FOV escolhido; lunetas mantêm o zoom fixo
    const scale = this.baseFov / CAMERA.fov;
    const ads = h?.kind === 'firearm' ? (h.def.sight === 'scope' ? h.def.adsFov : h.def.adsFov * scale) : CAMERA.adsFov * scale;
    return lerp(this.baseFov, ads, this.adsT);
  }

  setLoadout(loadout: Loadout): void {
    const before = this.held?.def.id;
    this.inventory.apply(loadout);
    for (const id of [loadout.primary, loadout.secondary, loadout.melee, loadout.grenade.type]) if (id) this.viewmodel.preload(id);
    const now = this.held?.def.id;
    if (!now) this.equip(this.inventory.firstAvailable(), true);
    else if (now !== before) this.equip(this.activeSlot, true);
  }

  equip(slot: EquipSlot | null, force = false): void {
    if (!force && slot === this.activeSlot) return;
    this.gun?.cancelReload();
    if (this.activeSlot && this.activeSlot !== slot) this.lastSlot = this.activeSlot;
    this.activeSlot = slot;
    this.throwPending = false;
    this.busyLock = 0;
    const item = slot ? this.inventory.get(slot) : undefined;
    const time = item ? DRAW_TIME[item.def.category] : 0;
    this.drawLock = time;
    this.adsT = 0;
    this.aimToggled = false;
    this.inspectTime = 0;
    this.armRecoil.reset();
    this.viewmodel.equip(item?.def ?? null, DRAW_CLIP, time);
    this.d.player.speedMultiplier = item?.def.moveSpeed ?? 1;
  }

  update(dt: number, time: number, input: Input): void {
    this.handleSwitching(input);
    this.drawLock = Math.max(0, this.drawLock - dt);
    this.busyLock = Math.max(0, this.busyLock - dt);

    const item = this.held;
    this.updateInspect(dt, input, item);
    // pendurado/escalando: mãos ocupadas na quina
    const ledgeBusy = this.d.player.ledgePhase !== null;
    const fireHeld = input.isDown(KEYS.fire) && !ledgeBusy;
    const firePressed = input.wasPressed(KEYS.fire) && !ledgeBusy;
    const ready = this.drawLock <= 0;

    if (item?.kind === 'firearm') this.updateFirearm(dt, item.def, item.gun, input, firePressed && ready, fireHeld && ready);
    else this.adsT = approach(this.adsT, 0, dt / 0.14);

    if (item?.kind === 'melee' && ready && this.busyLock <= 0 && (firePressed || fireHeld)) this.swing(item.def);
    if (item?.kind === 'throwable' && ready && this.busyLock <= 0 && firePressed) this.startThrow(item.def);
    if (this.throwPending && this.busyLock <= 0) this.finishThrow();

    this.updateSpread(dt);
    this.updateFlashLight(dt);
    this.updateArmRecoil(dt, item);

    const gun = this.gun;
    const r = gun?.reloadState;
    const anim = item ? RELOADS[item.def.id] : undefined;
    let reload: { clip: Clip; t: number; key: string; fromEmpty: boolean } | null = null;
    if (r && anim) {
      const clip = anim.kind === 'magazine' ? anim.clip : anim[r.phase === 'full' ? 'start' : r.phase];
      reload = { clip, t: r.progress, key: `${r.phase}:${gun!.ammo}`, fromEmpty: r.fromEmpty };
    }

    this.viewmodel.update({
      dt,
      time,
      moveSpeed: this.d.player.horizontalSpeed,
      strafe: this.d.player.strafeRelative,
      sprinting: this.d.player.sprinting,
      onGround: this.d.player.onGround,
      adsT: this.adsT,
      lookDX: input.mouseDX,
      lookDY: input.mouseDY,
      landingImpact: this.d.player.landingImpact,
      reload,
      ledge: ledgeBusy && this.d.player.ledgeHands(this.ledgeL, this.ledgeR) ? this.toCamera() : null,
      armPitch: this.armRecoil.pitch,
      armYaw: this.armRecoil.yaw,
      ammo: gun?.ammo ?? 1,
      spin: gun?.spin ?? 0,
      hidden: this.scoped,
    });
  }

  /** Converte os pontos das mãos na quina para o espaço da câmera (= viewmodel). */
  private toCamera(): { left: THREE.Vector3; right: THREE.Vector3 } {
    const cam = this.d.camera;
    cam.updateMatrixWorld();
    this.ledgeL.applyMatrix4(cam.matrixWorldInverse);
    this.ledgeR.applyMatrix4(cam.matrixWorldInverse);
    return { left: this.ledgeL, right: this.ledgeR };
  }

  /**
   * O que mostrar durante a inspeção: GIF do cartucho (ou da granada) e a contagem.
   * `null` fora da inspeção ou com arma branca.
   */
  get inspection(): { gifId: string; count: number; reserve: number; t: number } | null {
    if (this.inspectTime <= 0) return null;
    const item = this.held;
    const t = 1 - this.inspectTime / INSPECT_TIME;
    if (item?.kind === 'firearm') {
      const ammo = WEAPON_AMMO[item.def.id];
      if (!ammo) return null;
      return { gifId: ammoGifId(ammo), count: item.gun.ammo, reserve: item.gun.reserve, t };
    }
    if (item?.kind === 'throwable') return { gifId: item.def.id, count: this.inventory.grenades, reserve: Number.NaN, t };
    return null;
  }

  /** V inspeciona; atirar, mirar, recarregar, correr ou pendurar cancelam. */
  private updateInspect(dt: number, input: Input, item: HeldItem | undefined): void {
    const gun = this.gun;
    const blocked = !item || this.drawLock > 0 || this.busyLock > 0 || gun?.reloading || this.d.player.ledgePhase !== null;
    if (input.wasPressed(KEYS.inspect) && !blocked) {
      if (this.inspectTime > 0) this.cancelInspect();
      else {
        this.inspectTime = INSPECT_TIME;
        this.viewmodel.play(inspectClip(INSPECT_SCALE[item!.def.category]), INSPECT_TIME);
      }
      return;
    }
    if (this.inspectTime <= 0) return;
    const interrupted =
      input.wasPressed(KEYS.fire) || input.isDown(KEYS.aim) || input.wasPressed(KEYS.reload) || this.d.player.sprinting || blocked;
    if (interrupted) this.cancelInspect();
    else this.inspectTime = Math.max(0, this.inspectTime - dt);
  }

  private cancelInspect(): void {
    this.inspectTime = 0;
    this.viewmodel.cancelAction();
  }

  // ─────────────────────────── troca ───────────────────────────

  private handleSwitching(input: Input): void {
    const keys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    keys.forEach((code, i) => {
      const slot = SLOT_ORDER[i];
      if (input.wasPressed(code) && this.inventory.has(slot)) this.equip(slot);
    });
    if (input.wasPressed(KEYS.lastWeapon) && this.lastSlot && this.inventory.has(this.lastSlot)) this.equip(this.lastSlot);
    if (input.wheel !== 0) {
      const next = this.inventory.cycle(this.activeSlot, input.wheel > 0 ? 1 : -1);
      if (next) this.equip(next);
    }
  }

  // ─────────────────────────── armas de fogo ───────────────────────────

  private updateFirearm(dt: number, def: FirearmDef, gun: Firearm, input: Input, pressed: boolean, held: boolean): void {
    const sprinting = this.d.player.sprinting || this.d.player.ledgePhase !== null;
    const canAim = def.sight !== 'none' && !gun.reloading && !sprinting && this.drawLock <= 0;
    let wantsAim: boolean;
    if (this.aimMode === 'alternar') {
      if (input.wasPressed(KEYS.aim)) this.aimToggled = !this.aimToggled;
      if (!canAim) this.aimToggled = false; // recarga, corrida ou saque cancelam a mira
      wantsAim = this.aimToggled;
    } else {
      wantsAim = input.isDown(KEYS.aim);
    }
    this.adsT = approach(this.adsT, canAim && wantsAim ? 1 : 0, dt / (def.category === 'sniper' ? 0.22 : 0.14));

    const events = gun.update(dt, held && !sprinting);
    if (events.reloaded) this.viewmodel.onReloadComplete();

    if (input.wasPressed(KEYS.reload) && this.drawLock <= 0 && gun.startReload()) this.viewmodel.cancelAction();

    if (sprinting) return;
    const result = gun.trigger(pressed, held);
    for (let i = 0; i < result.shots; i++) this.fire(def, gun);
    if (result.dry) {
      this.d.audio.play('dryFire');
      this.viewmodel.onDryFire();
      if (gun.startReload()) this.viewmodel.cancelAction();
    }
  }

  private fire(def: FirearmDef, gun: Firearm): void {
    const { d } = this;
    d.camera.getWorldPosition(this.origin);

    if (def.projectile) {
      this.aimDirection(this.spread * 0.5);
      const start = this.origin.clone().addScaledVector(this.dir, 0.6).add(new THREE.Vector3(0, -0.08, 0));
      d.projectiles.launch(def.projectile, start, this.dir);
    } else {
      for (let i = 0; i < def.pellets; i++) {
        this.aimDirection(def.pellets > 1 ? this.spread + 0.035 : this.spread);
        this.hitscan(def.range, def.damage);
      }
    }

    // força no braço (a mola o traz de volta); a câmera só leva um tranco leve
    const steady = lerp(1, 0.7, this.adsT);
    this.armRecoil.kick(def.armSpring, def.recoil.yaw / Math.max(def.recoil.pitch, 1e-4), steady);
    const kick = lerp(1, 0.6, this.adsT) * 0.3;
    d.player.addRecoil(def.recoil.pitch * kick, (Math.random() - 0.5) * 2 * def.recoil.yaw * kick);
    // a mira sobe com os tiros e fica lá (o jogador compensa puxando o mouse)
    const climb = lerp(CAMERA_CLIMB.hip, CAMERA_CLIMB.ads, this.adsT);
    d.player.addCameraClimb(def.recoil.pitch * climb, (Math.random() - 0.35) * 2 * def.recoil.yaw * climb);
    this.bloom = Math.min(this.bloom + def.recoil.pitch * 0.5, 0.06);
    this.viewmodel.onFire(def.recoil.pitch, this.adsT, gun.ammo === 0, def.shell, !gun.manualAction);
    d.audio.shot(def.sound);

    if (gun.manualAction && gun.ammo > 0) {
      this.viewmodel.play(def.fireMode === 'pump' ? pumpCycle() : boltCycle(), gun.cycleTime);
    }
    this.flashLight.position.copy(this.origin).addScaledVector(this.dir, 0.8);
    this.flashLight.intensity = def.sound === 'minigun' ? 3 : 6;
    this.flashTimer = 0.06;
  }

  /** Direção da câmera com dispersão aleatória em cone. */
  /** Direção da câmera + desvio do braço + dispersão aleatória em cone. */
  private aimDirection(spread: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    const { pitch, yaw } = this.aimOffset;
    this.dir
      .set(Math.cos(a) * r - Math.tan(yaw), Math.sin(a) * r + Math.tan(pitch), -1)
      .normalize()
      .applyQuaternion(this.d.camera.quaternion);
  }

  /**
   * Avança a mola do braço. Com luneta o desvio passa para a câmera
   * (o retículo fica no centro e acompanha o recuo); sem luneta ele fica na arma/mira.
   */
  private updateArmRecoil(dt: number, item: HeldItem | undefined): void {
    this.armRecoil.update(dt, item?.kind === 'firearm' ? item.def.armSpring : null);
    const scopeT = item?.kind === 'firearm' && item.def.sight === 'scope' ? Math.max(0, (this.adsT - 0.7) / 0.3) : 0;
    this.aimOffset.pitch = this.armRecoil.pitch * (1 - scopeT);
    this.aimOffset.yaw = this.armRecoil.yaw * (1 - scopeT);
    this.d.player.aimOffsetPitch = this.armRecoil.pitch * scopeT;
    this.d.player.aimOffsetYaw = this.armRecoil.yaw * scopeT;
  }

  private hitscan(range: number, damage: number): THREE.Intersection | undefined {
    this.raycaster.set(this.origin, this.dir);
    this.raycaster.far = range;
    const hit = this.raycaster.intersectObjects(this.d.hitTargets, false)[0];
    // inimigo na frente do cenário recebe o tiro
    if (this.d.enemies?.shoot(this.origin, this.dir, hit ? hit.distance : range, damage)) return hit;
    if (hit?.face) {
      this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      const handled = this.d.onHit?.(hit, this.dir, damage) ?? false;
      this.impact(hit.point, this.normal, 1, !handled);
    }
    return hit;
  }

  private impact(point: THREE.Vector3, normal: THREE.Vector3, power: number, decal = true): void {
    const { particles, decals } = this.d;
    if (decal) decals.place(point, normal, 0.1 * Math.sqrt(power));
    const p = this.origin.copy(point).addScaledVector(normal, 0.02);
    particles.burst('dust', Math.round(6 * power), p, normal, 1.6 * power, 0.9, { life: 0.5, size: 0.04 * Math.sqrt(power), grow: 0.3, gravity: -2, drag: 3, color: 0xdadcdf, colorJitter: 0.2 });
    particles.burst('spark', Math.round(4 * power), p, normal, 6, 1.2, { life: 0.18, size: 0.015, grow: 0.4, gravity: -9, drag: 1, color: 0xffc46b });
    this.d.camera.getWorldPosition(this.origin);
  }

  // ─────────────────────────── corpo a corpo ───────────────────────────

  private swing(def: MeleeDef): void {
    this.busyLock = def.swingTime;
    this.viewmodel.play(MELEE_CLIPS[def.style], def.swingTime);
  }

  private meleeHit(def: MeleeDef): void {
    const { d } = this;
    d.camera.getWorldPosition(this.origin);
    this.dir.set(0, 0, -1).applyQuaternion(d.camera.quaternion);
    this.raycaster.set(this.origin, this.dir);
    this.raycaster.far = def.range;
    const hit = this.raycaster.intersectObjects(d.hitTargets, false)[0];
    if (d.enemies?.shoot(this.origin, this.dir, hit ? hit.distance : def.range, def.damage * 1.4)) {
      d.audio.play('meleeHit', 0.8);
      d.player.shake(0.1);
      return;
    }
    if (!hit?.face) return;
    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    const power = def.damage / 40;
    const handled = d.onHit?.(hit, this.dir, def.damage * 1.4) ?? false;
    this.impact(hit.point, this.normal, power, !handled);
    d.audio.play('meleeHit', Math.min(1, 0.5 + power * 0.2));
    d.player.shake(0.12 * power);
  }

  // ─────────────────────────── arremesso ───────────────────────────

  private startThrow(def: ThrowableDef): void {
    this.busyLock = THROW_TIME;
    this.throwPending = true;
    this.viewmodel.play(throwClip(def.effect === 'fire' ? 'light' : 'pin'), THROW_TIME);
  }

  private release(): void {
    const item = this.held;
    if (item?.kind !== 'throwable') return;
    const { d } = this;
    d.camera.getWorldPosition(this.origin);
    this.dir.set(0, 0.12, -1).normalize().applyQuaternion(d.camera.quaternion);
    const start = this.origin.clone().addScaledVector(this.dir, 0.5).add(new THREE.Vector3(0, -0.1, 0));
    const vel = this.dir.clone().multiplyScalar(17).add(d.player.velocity);
    d.projectiles.throwItem(item.def.id, item.def.effect, item.def.fuse, start, vel);
    this.inventory.grenades = Math.max(0, this.inventory.grenades - 1);
    this.viewmodel.hideModel(true);
  }

  private finishThrow(): void {
    this.throwPending = false;
    if (this.inventory.grenades > 0) this.equip('grenade', true);
    else this.equip(this.lastSlot && this.inventory.has(this.lastSlot) ? this.lastSlot : this.inventory.firstAvailable(), true);
  }

  // ─────────────────────────── eventos dos clipes ───────────────────────────

  private handleCue(cue: Cue): void {
    if (cue.sound) this.d.audio.play(cue.sound);
    const item = this.held;
    switch (cue.event) {
      case 'eject':
        if (item?.kind === 'firearm') this.viewmodel.ejectShell(item.def.shell);
        break;
      case 'ejectAll':
        this.viewmodel.ejectShell('pistol', true);
        break;
      case 'hit':
        if (item?.kind === 'melee') this.meleeHit(item.def);
        break;
      case 'release':
        this.release();
        break;
    }
  }

  // ─────────────────────────── dispersão / luz ───────────────────────────

  private updateSpread(dt: number): void {
    const h = this.held;
    if (h?.kind !== 'firearm') {
      this.spread = 0.01;
      return;
    }
    const p = this.d.player;
    this.bloom = damp(this.bloom, 0, 6, dt);
    const movement = Math.min(p.horizontalSpeed / 4.6, 1.6) * 0.018;
    const air = p.onGround ? 0 : 0.03;
    const hip = h.def.hipSpread + movement + air;
    const ads = h.def.adsSpread + movement * 0.15 + air * 0.5;
    const crouch = lerp(1, 0.7, p.crouchAmount);
    this.spread = (lerp(hip, ads, this.adsT) + this.bloom * lerp(1, 0.35, this.adsT)) * crouch;
  }

  private updateFlashLight(dt: number): void {
    if (this.flashTimer <= 0) return;
    this.flashTimer -= dt;
    this.flashLight.intensity = this.flashTimer > 0 ? this.flashLight.intensity * 0.8 : 0;
  }
}
