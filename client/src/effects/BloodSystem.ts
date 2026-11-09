import * as THREE from 'three';
import type { FloorTiles } from '../world/FloorTiles';

/** Máximo de gotas no ar ao mesmo tempo (as mais antigas dão lugar às novas). */
const MAX_DROPS = 700;
const GRAVITY = -14;
/** Quanto cada gota avermelha o quadrado/voxel onde cai (0..1). */
const STAIN = { floor: 0.28, voxel: 0.32 };
const LIFETIME = 3;

interface Drop {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  size: number;
}

/** Fonte contínua de sangue presa a um ponto de um osso (ex.: membro atingido). */
interface Emitter {
  bone: THREE.Object3D;
  local: THREE.Vector3;
  /** Segundos restantes. */
  time: number;
  /** Gotas por segundo no começo (diminui com o tempo). */
  rate: number;
  acc: number;
}

/**
 * Sangue com física simples: gotas caem com gravidade e, ao encostar num quadrado
 * do piso ou num voxel do mapa, mancham a cor dele (cada gota satura mais o vermelho)
 * e somem. Uma única malha instanciada.
 */
export class BloodSystem {
  private readonly mesh: THREE.InstancedMesh;
  private readonly drops: Drop[] = [];
  private readonly emitters: Emitter[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly floor: FloorTiles,
    /** Mancha um voxel sólido em `p` (devolve true se havia voxel). */
    private readonly stainVoxel: (p: THREE.Vector3, amount: number) => boolean,
  ) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x8a0a08, roughness: 0.35, metalness: 0 }),
      MAX_DROPS,
    );
    this.mesh.name = 'blood-drops';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    scene.add(this.mesh);
  }

  /** Esguicho de `count` gotas a partir de `p` (direção opcional). */
  spray(p: THREE.Vector3, count: number, speed: number, dir?: THREE.Vector3): void {
    for (let i = 0; i < count; i++) {
      if (this.drops.length >= MAX_DROPS) this.drops.shift();
      const vel = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.4 + 0.2, (Math.random() - 0.5) * 2)
        .normalize()
        .multiplyScalar(speed * (0.35 + Math.random() * 0.8));
      if (dir) vel.addScaledVector(dir, speed * 0.5);
      this.drops.push({ pos: p.clone(), vel, life: LIFETIME, size: 0.025 + Math.random() * 0.03 });
    }
  }

  /**
   * O membro atingido continua sangrando por alguns segundos, de onde levou o
   * golpe (acompanha o osso enquanto o corpo cai).
   */
  bleedFrom(bone: THREE.Object3D, worldPoint: THREE.Vector3, seconds = 1.8, rate = 60): void {
    bone.updateWorldMatrix(true, false);
    this.emitters.push({ bone, local: bone.worldToLocal(worldPoint.clone()), time: seconds, rate, acc: 0 });
  }

  update(dt: number): void {
    // membros sangrando
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.time -= dt;
      if (e.time <= 0 || !e.bone.parent) {
        this.emitters.splice(i, 1);
        continue;
      }
      e.acc += e.rate * Math.min(1, e.time / 1.2) * dt;
      const n = Math.floor(e.acc);
      if (n <= 0) continue;
      e.acc -= n;
      e.bone.updateWorldMatrix(true, false);
      this.spray(e.bone.localToWorld(this.tmp.copy(e.local)), n, 1.6);
    }

    // gotas: cai, encosta e mancha
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      d.vel.y += GRAVITY * dt;
      d.pos.addScaledVector(d.vel, dt);
      let hit = false;
      if (d.pos.y <= this.floor.top) {
        hit = this.floor.stain(d.pos.x, d.pos.z, STAIN.floor) || d.pos.y < -0.5;
        if (!hit) continue; // fora do piso: segue caindo até sumir
      } else if (this.stainVoxel(d.pos, STAIN.voxel)) {
        hit = true;
      }
      if (hit || d.life <= 0) this.drops.splice(i, 1);
    }
    this.floor.update();

    // desenho
    const count = Math.min(this.drops.length, MAX_DROPS);
    for (let i = 0; i < count; i++) {
      const d = this.drops[i];
      const stretch = 1 + Math.min(2, d.vel.length() * 0.12); // gota alonga com a velocidade
      this.s.set(d.size, d.size * stretch, d.size);
      this.m.compose(d.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Some com tudo (mapa restaurado). */
  clear(): void {
    this.drops.length = 0;
    this.emitters.length = 0;
    this.mesh.count = 0;
  }
}
