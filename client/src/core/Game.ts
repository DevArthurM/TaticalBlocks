import type { Loadout } from '@shared/weapons/loadout';
import type { WeaponDef } from '@shared/weapons/types';
import * as THREE from 'three';
import { SoundEngine } from '../audio/SoundEngine';
import { Decals } from '../effects/Decals';
import { ParticleSystem } from '../effects/ParticleSystem';
import { ApiClient } from '../net/ApiClient';
import { PlayerController } from '../player/PlayerController';
import { HUD, type SlotView } from '../ui/HUD';
import { ArsenalWheel } from '../ui/arsenal/ArsenalWheel';
import { FIRE_MODE_LABEL } from '../ui/weaponStats';
import { Explosions } from '../weapons/combat/Explosions';
import { Projectiles } from '../weapons/combat/Projectiles';
import { SLOT_ORDER } from '../weapons/logic/Inventory';
import { WeaponManager } from '../weapons/WeaponManager';
import { World } from '../world/World';
import { Input, KEYS } from './Input';
import { RendererSystem } from './RendererSystem';

/** Orquestra os sistemas e o loop principal. */
export class Game {
  private readonly gfx: RendererSystem;
  private readonly input: Input;
  private readonly audio = new SoundEngine();
  private readonly api = new ApiClient();
  private readonly clock = new THREE.Clock();
  private player!: PlayerController;
  private weapons!: WeaponManager;
  private particles!: ParticleSystem;
  private explosions!: Explosions;
  private projectiles!: Projectiles;
  private hud!: HUD;
  private menu!: ArsenalWheel;
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
    this.particles = new ParticleSystem(this.gfx.scene);
    const decals = new Decals(this.gfx.scene);

    this.hud = new HUD(this.container);
    this.explosions = new Explosions(this.gfx.scene, this.particles, decals, this.audio, this.gfx.camera, world.hitTargets, {
      shake: (a) => this.player.shake(a),
      blind: (a) => this.hud.addBlind(a),
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
    });

    const online = map.source === 'server' && catalog.source === 'server';
    this.hud.setStatus(map.data.name, online ? 'server' : 'local');
    this.hud.setPaused(true);

    this.menu = new ArsenalWheel(this.container, this.catalog, loadout.data);
    this.menu.setStatus(loadout.source === 'server' ? 'Loadout salvo no servidor' : 'Loadout salvo localmente');
    this.menu.onChange = (l) => void this.applyLoadout(l);

    this.input.onLockChange((locked) => {
      this.hud.setPaused(!locked && !this.menu.isOpen);
      if (locked) {
        this.audio.unlock();
        this.menu.setOpen(false);
      }
    });
    // B também precisa funcionar com o menu aberto (sem pointer lock)
    window.addEventListener('keydown', (e) => {
      if ((e.code === KEYS.loadout || e.code === 'Escape') && this.menu.isOpen) this.toggleMenu();
    });

    this.gfx.renderer.setAnimationLoop(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this;
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
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.time += dt;

    if (this.input.wasPressed(KEYS.loadout)) this.toggleMenu();

    this.player.update(dt, this.input, { aiming: this.weapons.aiming, canSprint: true });
    this.weapons.update(dt, this.time, this.input);
    this.projectiles.update(dt);
    this.explosions.update(dt, this.time);
    this.particles.update(dt);

    this.gfx.setFov(this.weapons.fov);
    this.updateHud(dt);
    this.gfx.render();
    this.input.endFrame();
  };

  private updateHud(dt: number): void {
    const w = this.weapons;
    const item = w.held;
    const gun = w.gun;
    const cam = this.gfx.camera;
    // px por unidade de tangente (mesmo valor na horizontal e na vertical em projeção perspectiva)
    const pxPerRad = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const inv = w.inventory;

    const slots: SlotView[] = SLOT_ORDER.map((slot, i) => {
      const id = slot === 'grenade' ? inv.loadout.grenade.type : inv.loadout[slot];
      const def = this.catalog.find((c) => c.id === id);
      return {
        key: i + 1,
        name: def?.name ?? null,
        tier: def?.tier ?? null,
        active: w.activeSlot === slot,
        extra: slot === 'grenade' && def ? `×${inv.grenades}` : undefined,
      };
    });

    let mode = '';
    let ammo: number | null = null;
    let mag = 0;
    if (item?.kind === 'firearm') {
      mode = FIRE_MODE_LABEL[item.def.fireMode];
      ammo = gun!.ammo;
      mag = item.def.magazineSize;
    } else if (item?.kind === 'throwable') {
      mode = 'ARREMESSO';
      ammo = inv.grenades;
      mag = 5;
    } else if (item?.kind === 'melee') {
      mode = 'CORPO A CORPO';
    }

    this.hud.update(
      {
        weaponName: item?.def.name ?? 'Desarmado',
        tier: item?.def.tier ?? null,
        mode,
        ammo,
        magazineSize: mag,
        reserve: item?.kind === 'throwable' ? 5 : (gun?.reserve ?? Infinity),
        reloading: gun?.reloading ?? false,
        reloadProgress: gun?.reloadProgress ?? 0,
        crosshairGap: 4 + w.spread * pxPerRad,
        aimOffset: [-Math.tan(w.aimOffset.yaw) * pxPerRad, -Math.tan(w.aimOffset.pitch) * pxPerRad],
        aiming: w.adsT > 0.3,
        sprinting: this.player.sprinting,
        scoped: w.scoped,
        spin: item?.kind === 'firearm' && item.def.spinUp ? gun!.spin : null,
        slots,
      },
      dt,
    );
  }
}
