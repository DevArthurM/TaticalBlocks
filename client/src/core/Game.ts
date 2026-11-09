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
import { DeathCam } from '../player/DeathCam';
import { FloorTiles } from '../world/FloorTiles';
import { BloodSystem } from '../effects/BloodSystem';
import { type GameMode, MODES } from '@shared/net/protocol';
import { MainMenu } from '../ui/main/MainMenu';
import { type AttachmentSlot, encodeAttachments } from '@shared/weapons/attachments';
import { Footsteps } from '../audio/Footsteps';
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
import { NetClient } from '../online/NetClient';
import { OnlineSession } from '../online/OnlineSession';
import { soldierMaterials } from '../online/avatar/SoldierModel';
import { OnlineHud } from '../ui/online/OnlineHud';
import { OnlineMenu } from '../ui/online/OnlineMenu';
import { AttachmentEditor } from '../ui/attachments/AttachmentEditor';
import { findWeapon } from '@shared/weapons/catalog';
import { ATTACHMENTS } from '@shared/weapons/attachments';
import { AMMO, ATTACHMENT_PRICE, killReward, MAX_SHOP_GRENADES, maxReserve, money, pvpAllowed } from '@shared/weapons/economy';
import { Economy } from '../weapons/Economy';
import { ShopMenu } from '../ui/shop/ShopMenu';
import { ZombieInstancer } from '../enemies/zombie/ZombieInstancer';
import { ZOMBIE_UNIT_BOX, zombieMaterials } from '../enemies/zombie/ZombieModel';
import { Input, KEYS } from './Input';
import { RendererSystem } from './RendererSystem';

/** Segundos parado mirando até o túnel de foco fechar por completo. */
const FOCUS_BUILD_TIME = 2.5;
/** Graus a mais de FOV no deslize. */
const SLIDE_FOV = 7;
/** Tempo máximo esperando a pré-compilação de shaders antes de começar. */
const WARMUP_TIMEOUT_MS = 6000;
/** Segundos segurando F por tábua pregada. */
const REPAIR_TIME = 0.55;
/** Offline: segundos caído no chão antes de renascer. */
/** Solo: segundos com a câmera caída antes de voltar ao menu. */
const GAME_OVER_DELAY = 5;

/** Orquestra os sistemas e o loop principal. */
/** sessionStorage: sala escolhida no menu principal, lida (e apagada) no próximo carregamento. */
const PENDING_JOIN_KEY = 'fps.pendingJoin';

/** Lê e apaga a sala pendente: recarregar de novo volta ao menu principal. */
function takePendingJoin(): { mode: GameMode; room?: string } | null {
  // endereços antigos (`/?online…`): tudo fica na rota `/`
  if (location.search) history.replaceState(null, '', location.pathname);
  try {
    const raw = sessionStorage.getItem(PENDING_JOIN_KEY);
    sessionStorage.removeItem(PENDING_JOIN_KEY);
    const v = raw ? (JSON.parse(raw) as { mode?: string; room?: string }) : null;
    return v?.mode && v.mode in MODES ? { mode: v.mode as GameMode, room: typeof v.room === 'string' ? v.room : undefined } : null;
  } catch {
    return null;
  }
}

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
  /**
   * Sala escolhida no menu principal: guardada só para o próximo carregamento da
   * página (mesma rota `/`, sem nada no endereço). Existe = modo online.
   */
  private readonly pendingJoin = takePendingJoin();
  /** Modo online: só o Pátio Voxel, sem zumbis, dano decidido pelo servidor. */
  private readonly onlineMode = this.pendingJoin !== null;
  private session: OnlineSession | null = null;
  private deathCam!: DeathCam;
  /** Menu principal (só no modo offline; o online tem o próprio menu de salas). */
  private mainMenu: MainMenu | null = null;
  private readonly footsteps = new Footsteps();
  /** Offline: segundos até renascer (> 0 = morto, câmera caída). */
  private respawnTimer = 0;
  /** Gun Game: arma imposta pelo servidor (sem menu de loadout). */
  private forcedLoadout = false;
  private attachMenu!: AttachmentEditor;
  private repairTimer = 0;
  private spawn = new THREE.Vector3();
  private weapons!: WeaponManager;
  private particles!: ParticleSystem;
  /** Piso de quadradinhos (cada um com cor própria) e sangue que mancha piso e voxels. */
  private floor!: FloorTiles;
  private blood!: BloodSystem;
  private explosions!: Explosions;
  private projectiles!: Projectiles;
  private hud!: HUD;
  private menu!: ArsenalWheel;
  /** Modo zumbis (solo ou online): dinheiro e loja no lugar do arsenal livre. */
  private economy: Economy | null = null;
  private shop: ShopMenu | null = null;
  private settingsMenu!: SettingsMenu;
  private readonly settings = new SettingsStore();
  private catalog: readonly WeaponDef[] = [];
  private time = 0;

  constructor(private readonly container: HTMLElement) {
    this.gfx = new RendererSystem(container);
    this.input = new Input(this.gfx.canvas);
  }

  async start(): Promise<void> {
    const [map, catalog, loadout] = await Promise.all([this.api.loadMap(), this.api.loadCatalog(), this.api.loadLoadout()]);
    this.catalog = catalog.data;

    const world = new World(this.gfx.scene, map.data, this.gfx.maxAnisotropy);
    this.player = new PlayerController(this.gfx.camera, world.colliders, map.data.spawn);
    this.body = new PlayerBody(this.gfx.scene);
    this.particles = new ParticleSystem(this.gfx.scene);
    const decals = new Decals(this.gfx.scene);

    // física + caixas de madeira + blocos destrutíveis
    this.physics = new PhysicsWorld();
    this.debris = new Debris(this.gfx.scene, this.physics);
    this.deathCam = new DeathCam(this.physics, this.gfx.camera, world.colliders);
    this.crates = new Crates(this.gfx.scene, this.physics, world.colliders, map.data.crates);
    this.world = world;
    // janelas/portas com tábuas (se o mapa tiver)
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
      detonated: (kind, pos, source) => this.session?.onDetonated(kind, pos, source),
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
      onHit: (hit, dir, damage) => {
        if (this.destruction.hit(hit, dir, damage)) {
          // online: os outros jogadores reproduzem a destruição
          this.session?.onWorldImpact(hit.point, dir, damage);
          return true;
        }
        return this.crates.hit(hit, dir, damage);
      },
      enemies: {
        shoot: (o, d, far, dmg, meta) => {
          // online PvP: só jogadores; modo zumbis: aliados bloqueiam o tiro (sem dano) e os zumbis levam
          if (this.session && !this.session.zombiesMode) return this.session.shoot(o, d, far, dmg, meta);
          const ally = this.session?.shoot(o, d, far, dmg, meta) ?? null;
          const hit = this.zombies.shoot(o, d, ally ? ally.distance : far, dmg);
          if (!hit) return ally;
          // acertou um zumbi vivo: marcador de acerto + estalo
          if (hit && !hit.corpse) {
            this.hud.hitMark(!!hit.head, !!hit.killed);
            this.audio.play('hitmarker', hit.killed ? 0.9 : 0.6);
          }
          return hit;
        },
      },
      onShot: (weapon, origin, dir, pellets) => this.session?.onShot(weapon, origin, dir, pellets),
    });

    // zumbis em ondas (1, 2, 4, 8, 16, 32)
    this.spawn.set(map.data.spawn.x, map.data.spawn.y, map.data.spawn.z);
    // todos os zumbis desenhados por instância (~7 draw calls no total)
    const zombieInstances = new ZombieInstancer(this.gfx.scene, ZOMBIE_UNIT_BOX);
    // online: soldados (e zumbis, no modo cooperativo)
    zombieInstances.prepare(this.onlineMode ? [...soldierMaterials(), ...zombieMaterials()] : zombieMaterials());
    this.gfx.beforeRender = () => zombieInstances.sync();
    this.floor = new FloorTiles(this.gfx.scene, map.data.size);
    this.blood = new BloodSystem(this.gfx.scene, this.floor, (p, k) => this.destruction.stainAt(p, k));
    this.zombies = new ZombieDirector(
      this.gfx.scene,
      this.physics,
      this.particles,
      decals,
      this.audio,
      world.colliders,
      this.player,
      {
        onPlayerHit: (dmg, from) => {
          if (this.respawnTimer > 0) return;
          this.player.damage(dmg);
          this.hud.damageFrom(from.x, from.z);
          this.audio.play('playerHurt', 0.6);
        },
        onWave: (wave, count) => this.hud.announce(`ONDA ${wave}`, `${count} ${count === 1 ? 'zumbi' : 'zumbis'}`),
        onKilled: (kind, head) => this.economy?.earn(killReward(kind, head)),
      },
      map.data.size,
      this.barricades,
    );
    this.zombies.blood = this.blood;
    this.weapons.viewmodel.setLightScale(world.env.viewmodelLight);
    this.hud.setOnlineMode(this.onlineMode);
    // sair da partida: volta ao menu principal (online: desconecta; solo: recomeça do zero)
    this.hud.onExitMatch = () => {
      location.href = location.pathname;
    };
    if (this.onlineMode) this.setupOnline(decals);

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
    // personalização da arma (T)
    this.attachMenu = new AttachmentEditor(this.container);
    this.attachMenu.onChange = (id, att) => this.weapons.setAttachments(id, att);
    this.attachMenu.onPreview = (att) => this.weapons.previewAttachments(att);
    this.attachMenu.onClose = () => this.setCustomizeOpen(false);
    this.weapons.onCustomizeRequest = () => this.setCustomizeOpen(true);
    // solo é sempre o modo zumbis: começa com $0 e só a faca
    if (!this.onlineMode) this.enableZombieEconomy();
    this.settingsMenu = new SettingsMenu(this.container, this.settings);
    this.settingsMenu.onClose = () => this.setSettingsOpen(false);
    this.hud.onOpenSettings = () => this.setSettingsOpen(true);

    // menu principal: nome, jogar online, zumbis solo, configurações + soldado 3D
    if (!this.onlineMode) {
      const main = new MainMenu(this.container, this.catalog);
      // sala escolhida na lista do menu: abre o jogo online já entrando nela
      main.onJoinOnline = (_name, mode, room) => {
        try {
          sessionStorage.setItem(PENDING_JOIN_KEY, JSON.stringify({ mode, room }));
        } catch {
          /* sem armazenamento: não há como levar a escolha */
        }
        location.reload();
      };
      main.onPlaySolo = () => {
        main.setOpen(false);
        this.audio.unlock();
        Promise.resolve(this.gfx.canvas.requestPointerLock()).catch(() => this.hud.setPaused(true));
      };
      main.onSettings = () => {
        main.setDimmed(true);
        this.setSettingsOpen(true);
      };
      this.mainMenu = main;
      main.setOpen(true);
      this.hud.setPaused(false);
    }
    this.hud.onMainMenu = () => {
      if (!this.mainMenu) {
        location.href = location.pathname; // online: sai da partida e volta ao menu principal
        return;
      }
      this.hud.setPaused(false);
      this.mainMenu.setOpen(true);
    };

    this.input.onLockChange((locked) => {
      if (locked) this.settingsMenu.setOpen(false);
      this.hud.setPaused(!locked && !this.menu.isOpen && !this.shop?.isOpen && !this.settingsMenu.isOpen && !this.attachMenu.isOpen && !this.mainMenu?.isOpen);
      if (locked) {
        this.audio.unlock();
        this.menu.setOpen(false);
        this.shop?.setOpen(false);
      }
    });
    // menu T aberto e o jogo perde o foco (troca de janela/aba): volta ao modo de combate
    const leaveCustomize = () => {
      if (!this.attachMenu.isOpen) return;
      this.setCustomizeOpen(false);
      // sem foco o pointer lock não volta sozinho: mostra a pausa (clicar retoma o jogo)
      if (!this.input.locked) this.hud.setPaused(true);
    };
    window.addEventListener('blur', leaveCustomize);
    document.addEventListener('visibilitychange', () => document.hidden && leaveCustomize());
    // B também precisa funcionar com o menu aberto (sem pointer lock)
    window.addEventListener('keydown', (e) => {
      if ((e.code === KEYS.customize || e.code === 'Escape') && this.attachMenu.isOpen) this.setCustomizeOpen(false);
      else if ((e.code === KEYS.loadout || e.code === 'Escape') && (this.menu.isOpen || this.shop?.isOpen)) this.toggleMenu();
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

  /** T: arma na frente da câmera, fundo desfocado e menu de acessórios (mouse livre). */
  private setCustomizeOpen(open: boolean): void {
    if (open === this.attachMenu.isOpen) return;
    this.weapons.setCustomizing(open);
    this.hud.setCustomizing(open);
    if (open) {
      const held = this.weapons.held;
      const def = held ? (findWeapon(held.def.id) ?? null) : null;
      this.attachMenu.open(def, held ? this.weapons.attachmentStore.get(held.def.id) : {});
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      this.attachMenu.close();
      // sem foco na janela o pedido falha: ignora (a tela de pausa cuida de retomar)
      Promise.resolve(this.gfx.canvas.requestPointerLock()).catch(() => {});
    }
  }

  private setSettingsOpen(open: boolean): void {
    this.settingsMenu.setOpen(open);
    // aberta pelo menu principal: fechando, volta para ele
    if (!open && this.mainMenu?.isOpen) {
      this.mainMenu.setDimmed(false);
      this.hud.setPaused(false);
      return;
    }
    // fechando, volta para a tela de pausa (clicar no jogo retoma)
    this.hud.setPaused(!open && !this.input.locked);
  }

  private toggleMenu(): void {
    if (this.shop) {
      const open = !this.shop.isOpen;
      this.shop.setOpen(open);
      if (open) {
        document.exitPointerLock();
        this.hud.setPaused(false);
      } else void this.gfx.canvas.requestPointerLock();
      return;
    }
    if (this.forcedLoadout && !this.menu.isOpen) {
      this.hud.announce('GUN GAME', 'a arma é definida pelo seu nível');
      return;
    }
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

    // no menu principal o jogo fica parado ao fundo (sem controles nem zumbis)
    // menu principal aberto ou contagem 3-2-1 do online: sem controles
    const inMenu = (this.mainMenu?.isOpen ?? false) || (this.session?.frozen ?? false);
    if (!inMenu && this.input.wasPressed(KEYS.loadout)) this.toggleMenu();

    const dead = this.session ? this.session.dead : this.respawnTimer > 0;
    this.updateDeathCam(dead);
    if (!dead && !inMenu) this.player.update(dt, this.input, { aiming: this.weapons.aiming, canSprint: true });
    this.body.update(dt, {
      position: this.player.position,
      velocity: this.player.velocity,
      yaw: this.player.yaw,
      onGround: this.player.onGround,
      crouch: this.player.crouchAmount,
      lean: this.player.leanAmount,
      slide: this.player.slideAmount,
      pitch: this.player.pitch,
    });
    const held = this.weapons.held;
    this.body.setWeapon(dead ? null : (held?.def.id ?? null), held?.kind === 'firearm' ? encodeAttachments(this.weapons.currentAttachments) : '');
    this.updateSlideFx(dt);
    this.audio.setListener(this.gfx.camera.position.x, this.gfx.camera.position.z, this.player.yaw);
    if (!dead) this.updateFootsteps(dt);
    this.crates.push(this.player.position, 0.35, 1.7, this.player.pushVelocity);
    if (!dead && !inMenu) this.weapons.update(dt, this.time, this.input);
    if (this.session) {
      this.session.update(dt, this.input.isDown('Tab'));
      if (this.session.zombiesMode) this.updateOnlineZombies(dt);
    } else if (!inMenu) {
      this.zombies.update(dt);
      this.checkDeath(dt);
    }
    this.projectiles.update(dt);
    this.destruction.update();
    this.physics.step(dt);
    this.crates.update();
    this.debris.update(dt);
    this.deathCam.update(dt);
    this.explosions.update(dt, this.time);
    this.particles.update(dt);
    this.blood.update(dt);
    this.world.env.update(dt, this.time, this.gfx.camera.position);
    this.barricades?.update(dt);

    // deslize: FOV abre um pouco (sensação de velocidade)
    this.gfx.setFov(this.weapons.fov + this.player.slideAmount * SLIDE_FOV);
    this.gfx.worldBlur = this.weapons.customizeT;
    this.updateFocus(dt);
    const repairPrompt = this.updateRepair(dt);
    this.hud.setPrompt(
      this.player.ledgePhase === 'hang' ? '<kbd>W</kbd> escalar · solte <kbd>Espaço</kbd> para cair' : repairPrompt,
    );
    this.updateHud(dt);
    if (this.economy) {
      // modo zumbis: munição limitada aparece no canto
      const item = this.weapons.held;
      this.hud.setAmmo(
        item?.kind === 'firearm' ? `${item.gun.ammo} / ${item.gun.reserve}` : item?.kind === 'throwable' ? `${this.weapons.inventory.grenades}×` : '',
      );
    }
    if (this.attachMenu.isOpen) this.updateAttachmentEditor();
    // com o menu principal aberto o jogo fica escondido: nem desenha
    if (!this.mainMenu?.isOpen) this.gfx.render();
    this.input.endFrame();
  };

  /** Modo zumbis online: o anfitrião simula; os outros espelham (o diretor decide pelo `net`). */
  private updateOnlineZombies(dt: number): void {
    const s = this.session!;
    // contagem 3-2-1 / aquecimento: sem zumbis
    if (s.frozen) return;
    this.zombies.update(dt);
    if (s.isHost) {
      this.onlineHud!.zombieWave = this.zombies.wave;
      this.onlineHud!.zombiesLeft = this.zombies.alive;
    }
  }

  private onlineHud: OnlineHud | null = null;

  /** Modo online: menu de salas, conexão e sessão de partida. */
  private setupOnline(decals: Decals): void {
    const net = new NetClient();
    const hud = new OnlineHud(this.container);
    this.onlineHud = hud;
    const menu = new OnlineMenu(this.container);
    this.player.regen = false;
    this.session = new OnlineSession({
      net,
      scene: this.gfx.scene,
      camera: this.gfx.camera,
      physics: this.physics,
      player: this.player,
      weapons: this.weapons,
      projectiles: this.projectiles,
      destruction: this.destruction,
      hitTargets: this.world.hitTargets,
      particles: this.particles,
      decals,
      audio: this.audio,
      hud,
    });
    // Gun Game: troca a arma na mão pela do nível (loadout só local, não é salvo)
    this.session.onHurtFrom = (x, z) => this.hud.damageFrom(x, z);
    // nova partida (3-2-1): o mapa volta inteiro, sem buracos nem detritos
    this.session.onRestart = () => {
      this.zombies.reset();
      this.destruction.reset();
      this.floor.reset();
      this.blood.clear();
    };
    // modo zumbis: o diretor passa a falar com a rede
    this.session.attachZombies(this.zombies);
    this.zombies.onKillBy = (by) => {
      if (by !== this.session?.myId) return;
      this.hud.hitMark(false, true);
      this.audio.play('hitmarker', 0.9);
    };
    this.session.onHitMark = (head, kill) => this.hud.hitMark(head, kill);
    // zumbis: todos morreram → fim de jogo e volta ao menu principal
    this.session.onGameOver = () => {
      this.shop?.setOpen(false);
      setTimeout(() => (location.href = location.pathname), 6000);
    };
    this.session.onBecameHost = () => this.hud.announce('ANFITRIÃO', 'você agora controla os zumbis da sala');
    this.session.onForcedWeapon = (weapon, level, demoted) => {
      this.forcedLoadout = true;
      const def = findWeapon(weapon);
      const slot = def?.kind === 'melee' ? 'melee' : def?.slot === 'secondary' ? 'secondary' : 'primary';
      this.weapons.setLoadout({
        primary: slot === 'primary' ? weapon : null,
        secondary: slot === 'secondary' ? weapon : null,
        melee: 'knife',
        grenade: { type: null, count: 0 },
      });
      this.weapons.equip(slot, true);
      if (level > 0 || demoted) this.hud.announce(demoted ? 'REBAIXADO' : `NÍVEL ${level + 1}`, def?.name ?? weapon);
    };
    net.on('rooms', ({ rooms }) => menu.setRooms(rooms));
    net.on('error', ({ message }) => menu.setStatus(message, true));
    net.on('joined', (j) => {
      this.session!.start(j);
      if (j.room.mode === 'zombies') {
        this.enableZombieEconomy();
        this.economy!.setMoney(j.you.money ?? 0);
      } else if (j.room.mode !== 'gungame') this.restrictPvp();
      menu.setOpen(false);
      menu.setStatus('');
      this.hud.setStatus(`${j.room.name} · ${j.room.mode}`, 'server');
      this.hud.setPaused(true);
    });
    net.onClose = () => {
      menu.setStatus('Conexão com o servidor perdida. Recarregue a página.', true);
      menu.setOpen(true);
      if (document.pointerLockElement) document.exitPointerLock();
    };
    const connect = () =>
      net.connect().catch((e: Error) => {
        menu.setStatus(e.message, true);
        throw e;
      });
    menu.onRefresh = () => void connect().then(() => net.send('rooms', {})).catch(() => {});
    menu.onJoin = (name, mode, room) => {
      menu.setStatus('Entrando…');
      void connect()
        .then(() => {
          net.send('hello', { name });
          net.send('join', { mode, room });
        })
        .catch(() => {});
    };
    menu.onOffline = () => {
      location.href = location.pathname;
    };
    setInterval(() => {
      if (menu.open && net.connected) net.send('rooms', {});
    }, 3000);
    // vindo da lista de servidores do menu principal: entra direto na sala escolhida
    const join = this.pendingJoin;
    if (join) {
      menu.setOpen(false);
      menu.onJoin(menu.playerName, join.mode, join.room);
      // falhou (sala cheia/sumiu, servidor fora): mostra o menu de salas
      net.on('error', () => menu.setOpen(true));
    } else menu.setOpen(true);
  }

  /** Deslize: som de atrito no início e poeira saindo dos pés. */
  private updateSlideFx(dt: number): void {
    const p = this.player;
    if (p.slideStarted) this.audio.play('slide', 0.8);
    if (!p.sliding || Math.random() > dt * 40) return;
    const v = p.velocity;
    const at = this.slideFxPos.set(p.position.x + (Math.random() - 0.5) * 0.3, 0.05, p.position.z + (Math.random() - 0.5) * 0.3);
    this.particles.emit('dust', at, this.slideFxVel.set(-v.x * 0.15 + (Math.random() - 0.5), 0.4 + Math.random() * 0.4, -v.z * 0.15 + (Math.random() - 0.5)), {
      life: 0.7,
      size: 0.14,
      grow: 2.2,
      drag: 2.5,
      color: 0xb9b6ad,
    });
  }

  private readonly slideFxPos = new THREE.Vector3();
  private readonly slideFxVel = new THREE.Vector3();

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

  /** Passos do próprio jogador (mais baixos que os dos outros; agachado quase mudo). */
  private updateFootsteps(dt: number): void {
    const p = this.player;
    const sound = this.footsteps.update(dt, p.sliding ? 0 : p.horizontalSpeed, p.onGround && p.ledgePhase === null, p.sprinting);
    if (sound) this.audio.play(sound, p.crouchAmount > 0.5 ? 0.07 : 0.22);
  }

  private readonly slotScreen = new THREE.Vector3();
  /** Editor do T: projeta cada encaixe da arma na tela (linhas e quadrados seguem o balanço). */
  private updateAttachmentEditor(): void {
    const cam = this.gfx.viewmodelCamera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const points: Partial<Record<AttachmentSlot, { x: number; y: number }>> = {};
    for (const [slot, p] of Object.entries(this.weapons.viewmodel.slotPoints()) as [AttachmentSlot, THREE.Vector3][]) {
      const v = this.slotScreen.copy(p).project(cam);
      if (v.z > 1) continue;
      points[slot] = { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    }
    this.attachMenu.update(points);
  }

  /** Liga/desliga a câmera de morte (cai com física) e esconde arma, pernas e mira. */
  private updateDeathCam(dead: boolean): void {
    if (dead === this.deathCam.active) return;
    if (dead) {
      // morreu com o editor do T aberto: fecha (a arma some na câmera de morte)
      if (this.attachMenu.isOpen) this.setCustomizeOpen(false);
      this.deathCam.start(this.player.velocity, this.session?.deathDir ?? null);
      // solta a mira/luneta/inspeção e cancela a recarga (renasce sacando a arma)
      this.weapons.equip(this.weapons.activeSlot, true);
    }
    else this.deathCam.stop();
    this.gfx.viewmodelScene.visible = !dead;
    this.body.root.visible = !dead;
    this.hud.setCustomizing(dead || this.weapons.customizing);
  }

  /** Morreu: a câmera cai no chão; depois renasce no spawn e as ondas recomeçam. */
  private checkDeath(dt: number): void {
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawnOffline();
      return;
    }
    if (this.player.health > 0) return;
    this.respawnTimer = GAME_OVER_DELAY;
    this.audio.play('playerHurt', 1);
    this.hud.announce('FIM DE JOGO', `você sobreviveu até a onda ${this.zombies.wave}`);
    this.shop?.setOpen(false);
  }

  /** Solo: morreu = fim de jogo; volta ao menu principal (partida nova do zero). */
  private respawnOffline(): void {
    location.href = location.pathname;
  }

  /**
   * Modo zumbis: começa com $0 e só a faca; matar zumbis dá dinheiro e o B abre a
   * loja (armas, munição, granadas e acessórios). Munição limitada por arma.
   */
  private enableZombieEconomy(): void {
    if (this.economy) return;
    const eco = new Economy();
    this.economy = eco;
    const w = this.weapons;
    w.enableZombieMode();
    w.setLoadout({ primary: null, secondary: null, melee: 'knife', grenade: { type: null, count: 0 } });
    w.equip('melee', true);
    // muda o loadout sem salvar (mantém a contagem atual de granadas)
    const setLo = (change: Partial<Loadout>) => {
      const lo = w.inventory.loadout;
      w.setLoadout({ ...lo, grenade: { type: lo.grenade.type, count: w.inventory.grenades }, ...change });
    };
    this.shop = new ShopMenu(this.container, this.catalog, {
      economy: eco,
      loadout: () => w.inventory.loadout,
      grenades: () => w.inventory.grenades,
      ammo: (def) => {
        const g = w.inventory.firearm(def);
        return { mag: g.ammo, reserve: g.reserve, max: maxReserve(def) };
      },
      attachments: (id) => w.attachmentStore.get(id),
      takeWeapon: async (def) => {
        if (!eco.ownsWeapon(def.id) && !(await eco.buy(`w:${def.id}`))) return;
        const slot = def.slot === 'secondary' ? 'secondary' : def.slot === 'melee' ? 'melee' : 'primary';
        setLo({ [slot]: def.id });
        w.equip(slot, true);
      },
      buyAmmo: async (def) => {
        if (await eco.buy(`m:${def.id}`)) w.addAmmo(def, AMMO.packMags);
      },
      buyGrenade: async (def) => {
        const lo = w.inventory.loadout;
        const count = lo.grenade.type === def.id ? w.inventory.grenades : 0;
        if (count >= MAX_SHOP_GRENADES || !(await eco.buy(`g:${def.id}`))) return;
        setLo({ grenade: { type: def.id, count: count + 1 } });
      },
      toggleAttachment: async (def, att) => {
        if (!eco.ownsAttachment(def.id, att) && !(await eco.buy(`a:${def.id}:${att}`))) return;
        const cur = { ...w.attachmentStore.get(def.id) };
        const slot = ATTACHMENTS[att].slot;
        if (cur[slot] === att) delete cur[slot];
        else cur[slot] = att;
        w.setAttachments(def.id, cur);
      },
    });
    eco.onChange = () => {
      this.hud.setMoney(money(eco.money));
      this.shop?.refresh();
    };
    eco.onEarn = (n) => this.hud.earn(`+${money(n)}`);
    this.hud.setMoney(money(eco.money));
    // T: acessório ainda não comprado mostra o preço e compra ao escolher
    this.attachMenu.priceOf = (wid, att) => (eco.ownsAttachment(wid, att) ? null : ATTACHMENT_PRICE[att]);
    this.attachMenu.onBuy = (wid, att) => eco.buy(`a:${wid}:${att}`);
    // online: o servidor guarda o saldo
    if (this.session) {
      const s = this.session;
      eco.remote = (item) => s.buy(item);
      s.onMoney = (m) => eco.setMoney(m);
    }
  }

  /** PvP: sem armas pesadas nem granadas (o Gun Game impõe a arma). */
  private restrictPvp(): void {
    const allowed = this.catalog.filter((d) => pvpAllowed(d));
    this.menu.setCatalog(allowed);
    const lo = this.weapons.inventory.loadout;
    const primary = lo.primary && pvpAllowed(findWeapon(lo.primary)) ? lo.primary : 'm4a1';
    const next: Loadout = { ...lo, primary, grenade: { type: null, count: 0 } };
    this.weapons.setLoadout(next);
    this.menu.setLoadout(next);
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
    // com mira acoplada a imagem fica toda nítida (o desfoque é da alça/massa de ferro)
    this.gfx.focus = this.weapons.hasOptic ? 0 : ads * (0.75 + 0.25 * this.stillT);
  }

  private updateHud(dt: number): void {
    const w = this.weapons;
    const cam = this.gfx.camera;
    this.hud.updateDamageDir(cam.position.x, cam.position.z, this.player.yaw, dt);
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
        tunnel: this.tunnel,
        hurt: Math.max(this.player.hurt, (1 - this.player.health / 100) * 0.7),
        round: w.held?.def.category === 'shotgun',
      },
      inspect,
      dt,
    );
  }
}
