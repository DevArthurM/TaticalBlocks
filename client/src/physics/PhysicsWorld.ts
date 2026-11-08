import * as CANNON from 'cannon-es';
import type * as THREE from 'three';

/** Mundo físico (cannon-es): chão, estruturas estáticas, caixas e detritos. */
export class PhysicsWorld {
  readonly world: CANNON.World;
  readonly material = new CANNON.Material('default');
  private readonly statics = new Map<string, CANNON.Body>();

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0), allowSleep: true });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.45;
    this.world.defaultContactMaterial.restitution = 0.15;
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.material, this.material, { friction: 0.5, restitution: 0.12 }));

    const ground = new CANNON.Body({ mass: 0, material: this.material, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
  }

  /** Substitui o corpo estático `key` por caixas (cuboides) alinhadas aos eixos. */
  setStatic(key: string, boxes: readonly THREE.Box3[]): void {
    const old = this.statics.get(key);
    if (old) this.world.removeBody(old);
    if (boxes.length === 0) {
      this.statics.delete(key);
      return;
    }
    const body = new CANNON.Body({ mass: 0, material: this.material });
    for (const b of boxes) {
      const half = new CANNON.Vec3((b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2, (b.max.z - b.min.z) / 2);
      body.addShape(new CANNON.Box(half), new CANNON.Vec3((b.max.x + b.min.x) / 2, (b.max.y + b.min.y) / 2, (b.max.z + b.min.z) / 2));
    }
    this.world.addBody(body);
    this.statics.set(key, body);
    // acorda quem estava dormindo apoiado aqui (ex.: caixa em cima de bloco destruído)
    for (const other of this.world.bodies) if (other.mass > 0) other.wakeUp();
  }

  step(dt: number): void {
    this.world.step(1 / 60, dt, 4);
  }
}
