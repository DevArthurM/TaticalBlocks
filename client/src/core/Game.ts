import type { Loadout } from '@shared/weapons/loadout';
import type { WeaponDef } from '@shared/weapons/types';
import * as THREE from 'three';
import { SoundEngine } from '../audio/SoundEngine';
import { Decals } from '../effects/Decals';
import { ParticleSystem } from '../effects/ParticleSystem';
import { ApiClient } from '../net/ApiClient';
import { Debris } from '../physics/Debris';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerBody } from '../player/PlayerBody';
import { PlayerController } from '../player/PlayerController';
import { HUD, type InspectView } from '../ui/HUD';
import { effectiveFov, SHADOW_MAP_SIZE, SettingsStore } from '../settings/Settings';
import { ArsenalWheel } from '../ui/arsenal/ArsenalWheel';
import { SettingsMenu } from '../ui/settings/SettingsMenu';
import { Explosions } from '../weapons/combat/Explosions';
import { Projectiles } from '../weapons/combat/Projectiles';
import { WeaponManager } from '../weapons/WeaponManager';
import { ZombieDirector } from '../enemies/ZombieDirector';
import { Barricades } from '../world/Barricades';
import { Crates } from '../world/Crates';
import { DestructionSystem } from '../world/destruction/DestructionSystem';
import { World } from '../world/World';
import { ZombieInstancer } from '../enemies/zombie/ZombieInstancer';
import { ZOMBIE_UNIT_BOX, zombieMaterials } from '../enemies/zombie/ZombieModel';
import { Input, KEYS } from './Input';
import { RendererSystem } from './RendererSystem';

/** Segundos parado mirando até o túnel de foco fechar por completo. */
const FOCUS_BUILD_TIME = 2.5;
/** Tempo máximo esperando a pré-compilação de shaders antes de começar. */
const WARMUP_TIMEOUT_MS = 6000;
/** Segundos segurando F por tábua pregada. */
const REPAIR_TIME = 0.55;

/** Orquestra os sistemas e o loop principal. */
export class Game {
  private readonly gfx: RendererSystem;
  private readonly input: Input;
  private readonly audio = new SoundEngine();
  private readonly api = new ApiClient();
  private readonly clock = new THREE.Clock();
  private player!: PlayerController;
  private body!: PlayerBody;
  private physics!: PhysicsWorld;
  private debris!: Debris;
  private crates!: Crates;
  private destruction!: DestructionSystem;
  private zombies!: ZombieDirector;
  private world!: World;
  private barricades: Barricades | null = null;
  private repairTimer = 0;
  private spawn = new THREE.Vector3();
  private weapons!: WeaponManager;
  private particles!: ParticleSystem;
  private explosions!: Explosions;
  private projectiles!: Projectiles;
  private hud!: HUD;
  private menu!: ArsenalWheel;
  private settingsMenu!: SettingsMenu;
  private readonly settings = new SettingsStore();
  private catalog: readonly WeaponDef[] = [];
  private time = 0;

  constructor(private readonly container: HTMLElement) {
    this.gfx = new RendererSystem(container);
    this.input = new Input(this.gfx.canvas);
  }

  async start(): Promise<void> {
    const [map, catalog, loadout] = await Promise.all([this.api.loadMap(new URLSearchParams(location.search).get('mapa') ?? 'voxel'), this.api.loadCatalog(), this.api.loadLoadout()]);
    this.catalog = catalog.data;

    const world = new World(this.gfx.scene, map.data, this.gfx.maxAnisotropy);
    this.player = new PlayerController(this.gfx.camera, world.colliders, map.data.spawn);
    this.body = new PlayerBody(this.gfx.scene);
    this.particles = new ParticleSystem(this.gfx.scene);
    const decals = new Decals(this.gfx.scene);

    // física + caixas de madeira + blocos destrutíveis
    this.physics = new PhysicsWorld();
    this.debris = new Debris(this.gfx.scene, this.physics);
    this.crates = new Crates(this.gfx.scene, this.physics, world.colliders, map.data.crates);
    this.world = world;
    // janelas/portas com tábuas (mapa do hospital)
    if (map.data.barricades?.length) this.barricades = new Barricades(this.gfx.scene, map.data.barricades, this.audio);
    world.hitTargets.push(...this.crates.meshes);
    this.destruction = new DestructionSystem(world, this.physics, this.debris, this.particles, decals, this.audio, [
      ...this.crates.colliders,
      ...(this.barricades?.colliders ?? []),
    ]);

    this.hud = new HUD(this.container);
    this.explosions = new Explosions(this.gfx.scene, this.particles, decals, this.audio, this.gfx.camera, world.hitTargets, {
      shake: (a) => this.player.shake(a),
      blind: (a) => this.hud.addBlind(a),
      blast: (pos, radius) => {
        this.destruction.explode(pos, radius);
        this.crates.blast(pos, radius * 1.3, 9);
        this.debris.blast(pos, radius, 8);
        this.zombies.blast(pos, radius * 1.1, 160);
      },
    });
    this.projectiles = new Projectiles(this.gfx.scene, world.hitTargets, this.explosions, this.particles, this.audio);
    this.weapons = new WeaponManager({
      loadout: loadout.data,
      camera: this.gfx.camera,
      viewmodelScene: this.gfx.viewmodelScene,
      worldScene: this.gfx.scene,
      hitTargets: world.hitTargets,
      player: this.player,
      audio: this.audio,
      particles: this.particles,
      decals,
      explosions: this.explosions,
      projectiles: this.projectiles,
      onHit: (hit, dir, damage) => this.destruction.hit(hit, dir, damage) || this.crates.hit(hit, dir, damage),
      enemies: { shoot: (o, d, far, dmg) => this.zombies.shoot(o, d, far, dmg) },
    });

    // zumbis em ondas (1, 2, 4, 8, 16, 32)
    this.spawn.set(map.data.spawn.x, map.data.spawn.y, map.data.spawn.z);
    // todos os zumbis desenhados por instância (~7 draw calls no total)
    const zombieInstances = new ZombieInstancer(this.gfx.scene, ZOMBIE_UNIT_BOX);
    zombieInstances.prepare(zombieMaterials());
    this.gfx.beforeRender = () => zombieInstances.sync();
    this.zombies = new ZombieDirector(
      this.gfx.scene,
      this.physics,
      this.particles,
      decals,
      this.audio,
      world.colliders,
      this.player,
      {
        onPlayerHit: (dmg) => {
          this.player.damage(dmg);
          this.audio.play('playerHurt', 0.6);
        },
        onWave: (wave, count) => this.hud.announce(`ONDA ${wave}`, `${count} ${count === 1 ? 'zumbi' : 'zumbis'}`),
      },
      map.data.size,
      this.barricades,
    );
    this.weapons.viewmodel.setLightScale(world.env.viewmodelLight);
    this.hud.onSelectMap = (mode) => {
      const url = new URL(location.href);
      url.searchParams.set('mapa', mode);
      location.href = url.toString();
    };
    this.hud.setMapChoice(map.data.environment === 'hospital' ? 'hospital' : 'voxel');

    const online = map.source === 'server' && catalog.source === 'server';
    this.hud.setStatus(map.data.name, online ? 'server' : 'local');
    this.hud.setPaused(true);

    this.menu = new ArsenalWheel(this.container, this.catalog, loadout.data);
    this.menu.setStatus(loadout.source === 'server' ? 'Loadout salvo no servidor' : 'Loadout salvo localmente');
    this.menu.onChange = (l) => void this.applyLoadout(l);

    // configurações: aplicadas agora e a cada mudança
    this.settings.subscribe((s) => {
      this.gfx.setRenderScale(s.graphics.renderScale);
      this.gfx.setDynamicResolution(s.graphics.dynamicResolution);
      this.gfx.setShadows(world.sun, SHADOW_MAP_SIZE[s.graphics.shadows]);
      this.player.sensitivity = s.sensitivity;
      this.player.adsSensitivity = s.adsSensitivity;
      this.player.leanMode = s.leanMode;
      const fov = effectiveFov(s.fov);
      this.weapons.baseFov = fov;
      this.gfx.setViewmodelFovFor(fov);
      this.weapons.aimMode = s.aimMode;
    });
    this.settingsMenu = new SettingsMenu(this.container, this.settings);
    this.settingsMenu.onClose = () => this.setSettingsOpen(false);
    this.hud.onOpenSettings = () => this.setSettingsOpen(true);

    this.input.onLockChange((locked) => {
      if (locked) this.settingsMenu.setOpen(false);
      this.hud.setPaused(!locked && !this.menu.isOpen && !this.settingsMenu.isOpen);
      if (locked) {
        this.audio.unlock();
        this.menu.setOpen(false);
      }
    });
    // B também precisa funcionar com o menu aberto (sem pointer lock)
    window.addEventListener('keydown', (e) => {
      if ((e.code === KEYS.loadout || e.code === 'Escape') && this.menu.isOpen) this.toggleMenu();
      else if (e.code === 'Escape' && this.settingsMenu.isOpen) this.setSettingsOpen(false);
    });

    // compila os shaders antes do primeiro quadro (evita travadas no 1º tiro/explosão/zumbi)
    const t0 = performance.now();
    this.hud.setLoading('Preparando gráficos…');
    await Promise.race([
      this.gfx.warmUp().catch((e) => console.warn('pré-compilação de shaders falhou', e)),
      new Promise((r) => setTimeout(r, WARMUP_TIMEOUT_MS)),
    ]);
    this.hud.setStatus(map.data.name, online ? 'server' : 'local');
    if (import.meta.env.DEV) console.info(`[perf] shaders pré-compilados em ${Math.round(performance.now() - t0)} ms`);
    this.clock.getDelta(); // não conta o tempo de compilação como um quadro
    this.gfx.renderer.setAnimationLoop(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this;
  }

  private setSettingsOpen(open: boolean): void {
    this.settingsMenu.setOpen(open);
    // fechando, volta para a tela de pausa (clicar no jogo retoma)
    this.hud.setPaused(!open && !this.input.locked);
  }

  private toggleMenu(): void {
    const open = !this.menu.isOpen;
    if (open) this.menu.setLoadout(this.weapons.inventory.loadout);
    this.menu.setOpen(open);
    if (open) {
      document.exitPointerLock();
      this.hud.setPaused(false);
    } else {
      void this.gfx.canvas.requestPointerLock();
    }
  }

  private async applyLoadout(loadout: Loadout): Promise<void> {
    this.weapons.setLoadout(loadout);
    const saved = await this.api.saveLoadout(loadout);
    this.menu.setStatus(saved.source === 'server' ? 'Loadout salvo no servidor ✓' : 'Servidor offline — salvo localmente');
  }

  private readonly frame = (): void => {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 1 / 20);
    this.gfx.adaptResolution(rawDt);
    this.time += dt;

    if (this.input.wasPressed(KEYS.loadout)) this.toggleMenu();

    this.player.update(dt, this.input, { aiming: this.weapons.aiming, canSprint: true });
    this.body.update(dt, {
      position: this.player.position,
      velocity: this.player.velocity,
      yaw: this.player.yaw,
      onGround: this.player.onGround,
      crouch: this.player.crouchAmount,
      lean: this.player.leanAmount,
    });
    this.crates.push(this.player.position, 0.35, 1.7, this.player.pushVelocity);
    this.weapons.update(dt, this.time, this.input);
    this.zombies.update(dt);
    this.checkDeath();
    this.projectiles.update(dt);
    this.destruction.update();
    this.physics.step(dt);
    this.crates.update();
    this.debris.update(dt);
    this.explosions.update(dt, this.time);
    this.particles.update(dt);
    this.world.env.update(dt, this.time, this.gfx.camera.position);
    this.barricades?.update(dt);

    this.gfx.setFov(this.weapons.fov);
    this.updateFocus(dt);
    const repairPrompt = this.updateRepair(dt);
    this.hud.setPrompt(
      this.player.ledgePhase === 'hang' ? '<kbd>W</kbd> escalar · solte <kbd>Espaço</kbd> para cair' : repairPrompt,
    );
    this.updateHud(dt);
    this.gfx.render();
    this.input.endFrame();
  };

  /** Segurar F perto de uma janela/porta danificada prega as tábuas de volta. */
  private updateRepair(dt: number): string | null {
    if (!this.barricades || this.player.ledgePhase) return null;
    const b = this.barricades.nearestRepairable(this.player.position, 1.9);
    if (!b) {
      this.repairTimer = 0;
      return null;
    }
    if (this.input.isDown(KEYS.repair)) {
      this.repairTimer += dt;
      if (this.repairTimer >= REPAIR_TIME) {
        this.repairTimer = 0;
        const from = this.gfx.camera.position.clone().add(new THREE.Vector3(0, -0.4, 0));
        this.barricades.repair(b, from);
        this.player.shake(0.04);
      }
    } else this.repairTimer = 0;
    const label = b.data.kind === 'window' ? 'janela' : 'porta';
    return `<kbd>F</kbd> segure para pregar tábuas na ${label} · ${b.count}/${b.max}`;
  }

  /** Morreu: renasce no spawn e as ondas recomeçam. */
  private checkDeath(): void {
    if (this.player.health > 0) return;
    this.player.position.copy(this.spawn);
    this.player.velocity.set(0, 0, 0);
    this.player.health = 100;
    this.player.hurt = 1;
    this.zombies.reset();
    this.hud.announce('VOCÊ MORREU', 'as ondas recomeçam');
  }

  /** 0..1 — quanto tempo o jogador está parado mirando (fecha o túnel de foco). */
  private stillT = 0;
  private tunnel = 0;

  /**
   * Foco ao mirar: túnel (vinheta) que fecha conforme o jogador fica parado e
   * desfoque leve da arma com a massa de mira nítida.
   */
  private updateFocus(dt: number): void {
    const w = this.weapons;
    const p = this.player;
    const aiming = w.adsT > 0.5 && !w.scoped;
    const moving = p.horizontalSpeed > 0.4 || !p.onGround || p.ledgePhase !== null;
    if (aiming && !moving) this.stillT = Math.min(1, this.stillT + dt / FOCUS_BUILD_TIME);
    else this.stillT = Math.max(0, this.stillT - dt * (moving ? 2.5 : 4));
    const ads = w.scoped ? 0 : w.adsT;
    this.tunnel = ads * (0.3 + 0.7 * this.stillT);
    this.gfx.focus = ads * (0.75 + 0.25 * this.stillT);
  }

  private updateHud(dt: number): void {
    const w = this.weapons;
    const cam = this.gfx.camera;
    // px por unidade de tangente (mesmo valor na horizontal e na vertical em projeção perspectiva)
    const pxPerRad = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));

    // inspeção (V): número flutuante à esquerda da arma (a arma fica à direita da tela)
    const ins = w.inspection;
    const inspect: InspectView | null = ins
      ? { ...ins, x: window.innerWidth * 0.5 - window.innerHeight * 0.62, y: window.innerHeight * 0.5 }
      : null;

    this.hud.update(
      {
        crosshairGap: 4 + w.spread * pxPerRad,
        aimOffset: [-Math.tan(w.aimOffset.yaw) * pxPerRad, -Math.tan(w.aimOffset.pitch) * pxPerRad],
        aiming: w.adsT > 0.3,
        sprinting: this.player.sprinting,
        scoped: w.scoped,
        // mirando e andando de lado: ponto central aparece conforme o braço inclina
        adsDot: w.scoped ? 0 : w.adsT * Math.min(1, w.viewmodel.strafeTilt / 0.6),
        tunnel: this.tunnel,
        hurt: Math.max(this.player.hurt, (1 - this.player.health / 100) * 0.7),
      },
      inspect,
      dt,
    );
  }
}
