import * as THREE from 'three';
import { createCarMesh, DIMENSIONS, wreckMesh, type ModelKind } from '../render/cars';
import type { WallGrid } from '../collision';
import { clamp } from '../geom';

export interface Controls { throttle: number; brake: number; steer: number; handbrake: boolean }

export interface Spec { maxSpeed: number; accel: number; brake: number; grip: number; steerLow: number; steerHigh: number; wheelBase: number }

/** Puntos de vida de cada modelo (balas, choques, explosiones). */
export const HEALTH: Record<ModelKind, number> = { player: 140, sedan: 100, taxi: 100, van: 130, bus: 260, police: 150, riot: 300 };

export const SPECS: Record<ModelKind, Spec> = {
  player: { maxSpeed: 62, accel: 11, brake: 22, grip: 9, steerLow: 0.62, steerHigh: 0.085, wheelBase: 2.6 },
  sedan: { maxSpeed: 44, accel: 7, brake: 16, grip: 8, steerLow: 0.6, steerHigh: 0.1, wheelBase: 2.6 },
  taxi: { maxSpeed: 46, accel: 7.5, brake: 16, grip: 8, steerLow: 0.6, steerHigh: 0.1, wheelBase: 2.6 },
  van: { maxSpeed: 36, accel: 5, brake: 13, grip: 7, steerLow: 0.55, steerHigh: 0.1, wheelBase: 3 },
  bus: { maxSpeed: 25, accel: 3, brake: 9, grip: 6, steerLow: 0.45, steerHigh: 0.1, wheelBase: 6 },
  police: { maxSpeed: 56, accel: 11, brake: 20, grip: 9, steerLow: 0.62, steerHigh: 0.1, wheelBase: 2.6 },
  riot: { maxSpeed: 42, accel: 7, brake: 15, grip: 7.5, steerLow: 0.55, steerHigh: 0.1, wheelBase: 3.2 },
};

/** Vehículo con física arcade (modelo bicicleta + deriva lateral). x este, y norte, a = rumbo. */
export class Vehicle {
  /** Altura del suelo en (x, y); la fija main.ts con el relieve de la ciudad. */
  static ground: (x: number, y: number) => number = () => 0;
  x = 0;
  y = 0;
  /** Altura sobre el nivel del mar (sigue al relieve). */
  z = 0;
  a = 0;
  vx = 0;
  vy = 0;
  yawRate = 0;
  steer = 0;
  readonly mesh: THREE.Group;
  readonly length: number;
  readonly width: number;
  readonly spec: Spec;
  lastImpact = 0;
  skid = 0;
  health: number;
  /** Calcinado tras explotar: ya no anda. */
  wrecked = false;
  /** Segundos que lleva ardiendo (explota al llegar a BURN_TIME); 0 = no arde. */
  burning = 0;

  constructor(readonly kind: ModelKind, readonly color: string) {
    this.mesh = createCarMesh(kind, color);
    this.length = DIMENSIONS[kind].length;
    this.width = DIMENSIONS[kind].width;
    this.spec = SPECS[kind];
    this.health = HEALTH[kind];
  }

  get maxHealth() {
    return HEALTH[this.kind];
  }

  damage(n: number) {
    if (this.wrecked) return;
    this.health = Math.max(0, this.health - n);
  }

  /** Luces de la sirena: `phase` alterna rojo/azul; off = apagadas. */
  setSiren(on: boolean, phase: number) {
    const a = this.mesh.getObjectByName('siren0'), b = this.mesh.getObjectByName('siren1');
    if (!a || !b) return;
    const k = Math.floor(phase * 6) % 2 === 0;
    a.visible = !on || k;
    b.visible = !on || !k;
  }

  /** Muestra u oculta al conductor (solo el descapotable lo tiene a la vista). */
  setDriver(on: boolean) {
    const d = this.mesh.getObjectByName('driver');
    if (d) d.visible = on;
  }

  /** Tras la explosión: carrocería negra, sin motor. */
  wreck() {
    this.wrecked = true;
    this.health = 0;
    this.burning = 0;
    wreckMesh(this.mesh);
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  /** Velocidad en la dirección de la marcha (negativa marcha atrás). */
  get forwardSpeed() {
    return this.vx * Math.sin(this.a) + this.vy * Math.cos(this.a);
  }

  /** Círculos que aproximan la carrocería (para colisiones). */
  circles(out: number[] = []): number[] {
    out.length = 0;
    const r = this.width / 2;
    const n = Math.max(2, Math.round(this.length / (r * 1.6)));
    const fx = Math.sin(this.a), fy = Math.cos(this.a);
    for (let i = 0; i < n; i++) {
      const o = (i / (n - 1) - 0.5) * (this.length - r * 2);
      out.push(this.x + fx * o, this.y + fy * o, r);
    }
    return out;
  }

  step(c: Controls, dt: number, walls: WallGrid) {
    const s = this.spec;
    const fx = Math.sin(this.a), fy = Math.cos(this.a);
    const rx = fy, ry = -fx;
    let vf = this.vx * fx + this.vy * fy;
    let vl = this.vx * rx + this.vy * ry;

    // motor y frenos
    if (c.throttle > 0) {
      if (vf < -0.5) vf += s.brake * c.throttle * dt;
      else vf += s.accel * c.throttle * (1 - Math.pow(Math.max(0, vf) / s.maxSpeed, 2)) * dt;
    }
    if (c.brake > 0) {
      if (vf > 0.5) vf -= s.brake * c.brake * dt;
      else vf = Math.max(-s.maxSpeed * 0.25, vf - s.accel * 0.7 * c.brake * dt);
    }
    if (!c.throttle && !c.brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * dt);
    if (c.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 6 * dt);
    // cuestas (Montjuïc, el Tibidabo...): la gravedad empuja a lo largo de la pendiente
    const half = this.length / 2;
    const slope = (Vehicle.ground(this.x + fx * half, this.y + fy * half) - Vehicle.ground(this.x - fx * half, this.y - fy * half)) / this.length;
    vf -= 9.8 * 0.75 * (slope / Math.sqrt(1 + slope * slope)) * dt;
    vf -= vf * Math.abs(vf) * 0.0012 * dt; // aerodinámica

    // dirección: menos ángulo de giro cuanto más rápido
    this.steer += clamp(c.steer - this.steer, -dt * 5, dt * 5);
    const k = clamp(Math.abs(vf) / s.maxSpeed, 0, 1);
    const ang = this.steer * (s.steerLow + (s.steerHigh - s.steerLow) * Math.sqrt(k));
    let yaw = (vf / s.wheelBase) * Math.tan(ang);
    if (c.handbrake && Math.abs(vf) > 6) yaw *= 1.6;
    this.yawRate = yaw;
    this.a += yaw * dt;

    // agarre lateral: derrapes con freno de mano
    const grip = c.handbrake ? 1.6 : s.grip;
    const slip = vl;
    vl *= Math.exp(-grip * dt);
    this.skid = Math.abs(slip) > 3 ? Math.min(1, Math.abs(slip) / 10) : 0;

    const nfx = Math.sin(this.a), nfy = Math.cos(this.a);
    this.vx = nfx * vf + nfy * vl;
    this.vy = nfy * vf - nfx * vl;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.collideWalls(walls);
  }

  private tmp: [number, number] = [0, 0];
  private circ: number[] = [];

  collideWalls(walls: WallGrid) {
    const cs = this.circles(this.circ);
    let impact = 0;
    for (let i = 0; i < cs.length; i += 3) {
      if (!walls.pushCircle(cs[i], cs[i + 1], cs[i + 2], this.tmp)) continue;
      const [px, py] = this.tmp;
      const d = Math.hypot(px, py);
      this.x += px;
      this.y += py;
      for (let j = 0; j < cs.length; j += 3) { cs[j] += px; cs[j + 1] += py; }
      const nx = px / d, ny = py / d;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        this.vx -= 1.3 * vn * nx;
        this.vy -= 1.3 * vn * ny;
        impact = Math.max(impact, -vn);
        // el golpe hace girar el coche hacia la pared (morro o cola)
        const fx = Math.sin(this.a), fy = Math.cos(this.a);
        const along = (cs[i] - this.x) * fx + (cs[i + 1] - this.y) * fy;
        const side = nx * fy - ny * fx;
        this.a += clamp(-vn * 0.004 * Math.sign(along) * side, -0.08, 0.08);
      }
      this.vx *= 0.992;
      this.vy *= 0.992;
    }
    this.lastImpact = impact;
  }

  syncMesh() {
    const g = Vehicle.ground, fx = Math.sin(this.a), fy = Math.cos(this.a);
    const hl = this.length * 0.4, hw = this.width * 0.45;
    const zf = g(this.x + fx * hl, this.y + fy * hl), zb = g(this.x - fx * hl, this.y - fy * hl);
    const zr = g(this.x + fy * hw, this.y - fx * hw), zl = g(this.x - fy * hw, this.y + fx * hw);
    this.z = (zf + zb + zr + zl) / 4;
    this.mesh.position.set(this.x, this.z, -this.y);
    this.mesh.rotation.set(Math.atan2(zf - zb, hl * 2), -this.a, Math.atan2(zr - zl, hw * 2), 'YXZ');
  }
}

const ca: number[] = [], cb: number[] = [];

/**
 * Choque entre dos vehículos (círculos de la carrocería): los separa y reparte el impulso.
 * `wa`/`wb`: qué parte del empujón se lleva cada uno (0 = no se mueve). Devuelve la velocidad del impacto.
 */
export function collidePair(a: Vehicle, b: Vehicle, wa: number, wb: number): number {
  if (Math.abs(a.x - b.x) > (a.length + b.length) / 2 + 1 || Math.abs(a.y - b.y) > (a.length + b.length) / 2 + 1) return 0;
  a.circles(ca);
  b.circles(cb);
  let impact = 0;
  for (let i = 0; i < ca.length; i += 3)
    for (let j = 0; j < cb.length; j += 3) {
      const dx = ca[i] - cb[j], dy = ca[i + 1] - cb[j + 1];
      const d = Math.hypot(dx, dy), min = ca[i + 2] + cb[j + 2];
      if (d >= min || d < 1e-4) continue;
      const nx = dx / d, ny = dy / d, push = min - d;
      a.x += nx * push * wa; a.y += ny * push * wa;
      b.x -= nx * push * wb; b.y -= ny * push * wb;
      for (let k = 0; k < ca.length; k += 3) { ca[k] += nx * push * wa; ca[k + 1] += ny * push * wa; }
      for (let k = 0; k < cb.length; k += 3) { cb[k] -= nx * push * wb; cb[k + 1] -= ny * push * wb; }
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vn < 0) {
        const j2 = -vn * 1.1;
        a.vx += nx * j2 * wa; a.vy += ny * j2 * wa;
        b.vx -= nx * j2 * wb; b.vy -= ny * j2 * wb;
        impact = Math.max(impact, -vn);
      }
    }
  return impact;
}
