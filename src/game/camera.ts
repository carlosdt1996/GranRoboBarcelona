import * as THREE from 'three';
import type { WallGrid } from '../collision';
import { angDiff, clamp } from '../geom';
import type { Vehicle } from './vehicle';

/** Cámara de persecución baja, detrás del coche, como en OutRun. */
export class ChaseCam {
  readonly camera: THREE.PerspectiveCamera;
  heading = 0;
  private shake = 0;
  private dist = 7;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.3, 1200);
  }

  bump(k: number) {
    this.shake = Math.min(1, this.shake + k);
  }

  snap(v: Vehicle) {
    this.heading = v.a;
  }

  update(dt: number, v: Vehicle, walls: WallGrid) {
    const sp = v.speed;
    // la cámara sigue el rumbo con algo de retraso (se nota al derrapar)
    this.heading += angDiff(this.heading, v.a) * Math.min(1, dt * (3 + sp * 0.04));
    const fx = Math.sin(this.heading), fy = Math.cos(this.heading);
    const want = 6.8 + sp * 0.035;
    const free = walls.raycast(v.x, v.y, v.x - fx * (want + 0.6), v.y - fy * (want + 0.6));
    const target = Math.max(2.2, free * (want + 0.6) - 0.6);
    this.dist += (target - this.dist) * Math.min(1, dt * (target < this.dist ? 14 : 3));
    const h = 2.5 + sp * 0.012 + (want - this.dist) * 0.25;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * 0.35;
    const c = this.camera;
    c.position.set(v.x - fx * this.dist + (Math.random() - 0.5) * s, h + (Math.random() - 0.5) * s, -(v.y - fy * this.dist));
    c.lookAt(v.x + fx * 7, 1.2, -(v.y + fy * 7));
    const fov = 58 + clamp(sp * 0.28, 0, 20);
    if (Math.abs(c.fov - fov) > 0.05) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }
}
