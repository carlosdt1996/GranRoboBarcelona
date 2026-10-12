import * as THREE from 'three';
import type { WallGrid } from '../collision';
import { angDiff, clamp } from '../geom';
import { Vehicle } from './vehicle';

/** Lo que sigue la cámara: un coche o el protagonista a pie. */
export interface CamTarget { x: number; y: number; z: number; a: number; speed: number }

/** Cámara de persecución baja, detrás del coche, como en OutRun. */
export class ChaseCam {
  readonly camera: THREE.PerspectiveCamera;
  heading = 0;
  private shake = 0;
  private dist = 7;
  private z = 0;
  private lookZ = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.3, 1200);
  }

  bump(k: number) {
    this.shake = Math.min(1, this.shake + k);
  }

  snap(v: CamTarget) {
    this.heading = v.a;
    this.z = this.lookZ = v.z;
  }

  /**
   * `mode`: 'car' (baja, tras el coche), 'foot' (más cerca, por encima del hombro) o 'heli'
   * (lejos y por encima; `surface` = suelo o azotea bajo un punto, para no meterse en los edificios).
   */
  update(dt: number, v: CamTarget, walls: WallGrid, mode: 'car' | 'foot' | 'heli' = 'car', surface?: (x: number, y: number) => number) {
    if (mode === 'heli' && surface) return this.heli(dt, v, surface);
    const onFoot = mode === 'foot';
    // dentro de un interior (suelo fijo): cámara más cerca y más baja
    const indoor = onFoot && !!surface;
    const sp = v.speed;
    // la cámara sigue el rumbo con algo de retraso (se nota al derrapar)
    this.heading += angDiff(this.heading, v.a) * Math.min(1, dt * (3 + sp * 0.04));
    const fx = Math.sin(this.heading), fy = Math.cos(this.heading);
    const want = indoor ? 3.2 : onFoot ? 4.6 : 6.8 + sp * 0.035;
    const free = walls.raycast(v.x, v.y, v.x - fx * (want + 0.6), v.y - fy * (want + 0.6));
    const target = Math.max(indoor ? 1.4 : 2.2, free * (want + 0.6) - 0.6);
    this.dist += (target - this.dist) * Math.min(1, dt * (target < this.dist ? 14 : 3));
    const h = indoor ? 1.9 : (onFoot ? 2.6 : 2.5 + sp * 0.012) + (want - this.dist) * 0.25;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * 0.35;
    const c = this.camera;
    // altura: la del coche suavizada, pero nunca por debajo del suelo que hay detrás (bajadas)
    const px = v.x - fx * this.dist, py = v.y - fy * this.dist;
    const k = Math.min(1, dt * 8);
    this.z += (v.z - this.z) * k;
    const g = mode === 'foot' && surface ? surface : Vehicle.ground;
    this.lookZ += (g(v.x + fx * 7, v.y + fy * 7) - this.lookZ) * k;
    const cz = Math.max(this.z + h, g(px, py) + 1.2);
    c.position.set(px + (Math.random() - 0.5) * s, cz + (Math.random() - 0.5) * s, -py);
    c.lookAt(v.x + fx * 7, this.lookZ + 1.2, -(v.y + fy * 7));
    this.setFov(onFoot ? 56 : 58 + clamp(sp * 0.28, 0, 20));
  }

  private setFov(fov: number) {
    const c = this.camera;
    if (Math.abs(c.fov - fov) > 0.05) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }

  private heli(dt: number, v: CamTarget, surface: (x: number, y: number) => number) {
    const sp = v.speed;
    this.heading += angDiff(this.heading, v.a) * Math.min(1, dt * 2.2);
    const fx = Math.sin(this.heading), fy = Math.cos(this.heading);
    // se acerca si hay un edificio entre la cámara y el helicóptero
    let want = 16 + sp * 0.08;
    for (let d = 3; d < want; d += 2) {
      if (surface(v.x - fx * d, v.y - fy * d) > v.z + 3) { want = Math.max(5, d - 2); break; }
    }
    this.dist += (want - this.dist) * Math.min(1, dt * (want < this.dist ? 10 : 2));
    const px = v.x - fx * this.dist, py = v.y - fy * this.dist;
    const k = Math.min(1, dt * 5);
    this.z += (v.z - this.z) * k;
    const cz = Math.max(this.z + 4.5 + this.dist * 0.12, surface(px, py) + 2);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * 0.35;
    const c = this.camera;
    c.position.set(px + (Math.random() - 0.5) * s, cz + (Math.random() - 0.5) * s, -py);
    c.lookAt(v.x + fx * 8, this.z + 0.5, -(v.y + fy * 8));
    this.lookZ = this.z;
    this.setFov(62);
  }
}
