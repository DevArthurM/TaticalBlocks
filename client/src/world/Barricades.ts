import type { BarricadeData } from '@shared/map/types';
import * as THREE from 'three';
import type { SoundEngine } from '../audio/SoundEngine';
import { seededRandom } from '../core/math';

const BOARDS = 5;
const FLY_TIME = 0.28;

interface Board {
  mesh: THREE.Mesh;
  restPos: THREE.Vector3;
  restRot: THREE.Euler;
  on: boolean;
  /** Animação: tábua arrancada caindo / tábua sendo pregada. */
  anim: { kind: 'out' | 'in'; t: number; from: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3 } | null;
}

/** Uma abertura (janela/porta) com tábuas. */
export class Barricade {
  readonly boards: Board[] = [];
  /** Colisão da abertura enquanto houver pelo menos uma tábua. */
  readonly collider = new THREE.Box3();
  readonly center: THREE.Vector3;
  /** Onde o zumbi fica para arrancar as tábuas (fora) e onde cai ao entrar (dentro). */
  readonly outside: THREE.Vector3;
  readonly inside: THREE.Vector3;
  private readonly full: THREE.Box3;

  constructor(readonly data: BarricadeData) {
    const { position: p, outward: o, width, height } = data;
    this.center = new THREE.Vector3(p.x, p.y + height / 2, p.z);
    this.outside = new THREE.Vector3(p.x + o.x * 0.75, 0, p.z + o.z * 0.75);
    this.inside = new THREE.Vector3(p.x - o.x * 0.95, 0, p.z - o.z * 0.95);
    // abertura (eixos alinhados) com ~0,4 m de espessura
    const alongX = Math.abs(o.z) > Math.abs(o.x);
    const hw = width / 2;
    this.full = new THREE.Box3(
      new THREE.Vector3(p.x - (alongX ? hw : 0.2), p.y, p.z - (alongX ? 0.2 : hw)),
      new THREE.Vector3(p.x + (alongX ? hw : 0.2), p.y + height, p.z + (alongX ? 0.2 : hw)),
    );
    this.collider.copy(this.full);
  }

  get count(): number {
    return this.boards.filter((b) => b.on).length;
  }

  get max(): number {
    return this.boards.length;
  }

  updateCollider(): void {
    if (this.count > 0) this.collider.copy(this.full);
    else this.collider.makeEmpty();
  }
}

/**
 * Barricadas de tábuas nas janelas e portas. Zumbis arrancam as tábuas uma a uma;
 * o jogador segura F perto da abertura para pregá-las de volta.
 */
export class Barricades {
  readonly list: Barricade[];
  /** Colisores (um por abertura) — vazios quando não sobra tábua. */
  readonly colliders: THREE.Box3[];
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0x8a6236, roughness: 0.85 });
  private readonly matDark = new THREE.MeshStandardMaterial({ color: 0x6e4c2a, roughness: 0.9 });
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    data: readonly BarricadeData[],
    private readonly audio: SoundEngine,
  ) {
    const rnd = seededRandom(7);
    this.list = data.map((d) => {
      const b = new Barricade(d);
      const alongX = Math.abs(d.outward.z) > Math.abs(d.outward.x);
      const yaw = alongX ? 0 : Math.PI / 2;
      // tábuas do lado de dentro, espalhadas na altura da abertura
      const inset = -0.17;
      for (let i = 0; i < BOARDS; i++) {
        const y = d.position.y + ((i + 0.5) / BOARDS) * d.height;
        const pos = new THREE.Vector3(d.position.x + d.outward.x * inset, y, d.position.z + d.outward.z * inset);
        const rot = new THREE.Euler(0, yaw, (rnd() - 0.5) * 0.35);
        const mesh = new THREE.Mesh(this.geo, i % 2 ? this.matDark : this.mat);
        mesh.scale.set(d.width + 0.35, Math.min(0.2, d.height / BOARDS - 0.04), 0.05);
        mesh.position.copy(pos);
        mesh.rotation.copy(rot);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; // só recalcula enquanto anima
        mesh.updateMatrix();
        scene.add(mesh);
        b.boards.push({ mesh, restPos: pos, restRot: rot, on: true, anim: null });
      }
      return b;
    });
    this.colliders = this.list.map((b) => b.collider);
  }

  /** Zumbi arrancou uma tábua: ela voa para fora e cai. */
  removeBoard(b: Barricade): boolean {
    const board = [...b.boards].reverse().find((x) => x.on);
    if (!board) return false;
    board.on = false;
    const o = b.data.outward;
    board.anim = {
      kind: 'out',
      t: 0,
      from: board.mesh.position.clone(),
      vel: new THREE.Vector3(o.x * 2.2 + (Math.random() - 0.5), 1.5 + Math.random(), o.z * 2.2 + (Math.random() - 0.5)),
      spin: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8),
    };
    b.updateCollider();
    this.audio.play('boardBreak', 0.8);
    return true;
  }

  /** Jogador pregou uma tábua de volta (vem da mão do jogador). */
  repair(b: Barricade, from: THREE.Vector3): boolean {
    const board = b.boards.find((x) => !x.on);
    if (!board) return false;
    board.on = true;
    board.mesh.visible = true;
    board.anim = { kind: 'in', t: 0, from: from.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3() };
    b.updateCollider();
    this.audio.play('hammer', 0.8);
    return true;
  }

  /** Barricada danificada mais próxima, ao alcance do jogador. */
  nearestRepairable(pos: THREE.Vector3, maxDist: number): Barricade | null {
    let best: Barricade | null = null;
    let bestD = maxDist;
    for (const b of this.list) {
      if (b.count >= b.max) continue;
      this.tmp.set(b.center.x, pos.y, b.center.z);
      const d = this.tmp.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Repõe todas as tábuas (recomeço). */
  reset(): void {
    for (const b of this.list) {
      for (const board of b.boards) {
        board.on = true;
        board.anim = null;
        board.mesh.visible = true;
        board.mesh.position.copy(board.restPos);
        board.mesh.rotation.copy(board.restRot);
        board.mesh.updateMatrix();
      }
      b.updateCollider();
    }
  }

  update(dt: number): void {
    for (const b of this.list)
      for (const board of b.boards) {
        const a = board.anim;
        if (!a) continue;
        a.t += dt;
        const m = board.mesh;
        if (a.kind === 'out') {
          // cai com gravidade e some depois de assentar
          m.position.set(a.from.x + a.vel.x * a.t, Math.max(0.03, a.from.y + a.vel.y * a.t - 4.9 * a.t * a.t), a.from.z + a.vel.z * a.t);
          if (m.position.y > 0.04) {
            m.rotation.x += a.spin.x * dt;
            m.rotation.y += a.spin.y * dt;
            m.rotation.z += a.spin.z * dt;
          }
          if (a.t > 6) {
            m.visible = false;
            board.anim = null;
          }
        } else {
          const k = Math.min(1, a.t / FLY_TIME);
          const e = 1 - (1 - k) * (1 - k);
          m.position.lerpVectors(a.from, board.restPos, e);
          m.rotation.set(board.restRot.x, board.restRot.y, board.restRot.z + (1 - e) * 1.2);
          if (k >= 1) {
            m.position.copy(board.restPos);
            m.rotation.copy(board.restRot);
            board.anim = null;
          }
        }
        m.updateMatrix();
      }
  }
}
