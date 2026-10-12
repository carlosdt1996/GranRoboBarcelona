import { angDiff, clamp } from '../geom';
import type { RoofMap } from '../heights';
import { createHeliMesh, type HeliMesh } from '../render/heli';

/** Mandos del helicóptero: adelante/atrás, giro, subir/bajar (0..1 salvo yaw -1..1). */
export interface HeliControls { fwd: number; back: number; yaw: number; up: number; down: number }

const MAX_SPEED = 52, CLIMB = 11, YAW = 1.6, CEILING = 900;

/**
 * Helicóptero arcade: se inclina hacia donde avanza, gira sobre sí mismo, sube y baja.
 * Choca con el terreno y los edificios (mapa de azoteas) y puede posarse en los tejados.
 */
export class Heli {
  x = 0;
  y = 0;
  z = 0;
  a = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yawRate = 0;
  pitch = 0;
  roll = 0;
  /** Revoluciones del rotor 0..1 (despega a partir de 0.85). */
  rpm = 0;
  health = 220;
  readonly maxHealth = 220;
  wrecked = false;
  /** Apoyado en el suelo o en una azotea. */
  landed = true;
  lastImpact = 0;
  readonly length = 11;
  readonly width = 2.4;
  readonly m: HeliMesh;

  constructor(body = '#f2f2f2', stripe = '#e01828') {
    this.m = createHeliMesh(body, stripe);
  }

  get mesh() {
    return this.m.group;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  /** `c` = null: sin piloto (el rotor se para y cae si está en el aire). */
  step(c: HeliControls | null, dt: number, roofs: RoofMap) {
    this.lastImpact = 0;
    const piloted = !!c && !this.wrecked;
    this.rpm = clamp(this.rpm + (piloted ? 0.45 : -0.25) * dt, 0, 1);
    const lift = piloted && this.rpm > 0.85;
    const fx = Math.sin(this.a), fy = Math.cos(this.a);
    let vf = this.vx * fx + this.vy * fy, vl = this.vx * fy - this.vy * fx;
    if (lift) {
      const want = (c!.fwd - c!.back * 0.5) * MAX_SPEED;
      vf += (want - vf) * Math.min(1, dt * (Math.abs(want) > Math.abs(vf) ? 0.55 : 0.9));
      vl *= Math.exp(-1.6 * dt);
      this.yawRate += (c!.yaw * YAW - this.yawRate) * Math.min(1, dt * 3);
      const vzWant = (c!.up - c!.down) * CLIMB;
      this.vz += (vzWant - this.vz) * Math.min(1, dt * 2.2);
      if (this.z > CEILING) this.vz = Math.min(this.vz, 0);
    } else {
      // sin sustentación: cae (menos cuanto más gira el rotor) y se frena en el suelo
      this.yawRate *= Math.exp(-2 * dt);
      this.vz -= 9.8 * (1 - this.rpm * 0.8) * dt;
      if (this.landed) { vf *= Math.exp(-5 * dt); vl *= Math.exp(-5 * dt); }
    }
    this.a += this.yawRate * dt;
    const nfx = Math.sin(this.a), nfy = Math.cos(this.a);
    this.vx = nfx * vf + nfy * vl;
    this.vy = nfy * vf - nfx * vl;

    // movimiento horizontal: no se puede atravesar un edificio (paredes = azoteas más altas que los patines)
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    const sp = this.speed;
    const probe = sp > 0.1 ? 3.5 : 0;
    const ahead = probe ? roofs.surface(nx + (this.vx / sp) * probe, ny + (this.vy / sp) * probe) : -Infinity;
    if (ahead > this.z + 0.8) {
      this.lastImpact = Math.max(this.lastImpact, sp);
      this.vx *= -0.3;
      this.vy *= -0.3;
    } else {
      this.x = nx;
      this.y = ny;
    }
    this.z += this.vz * dt;
    const floor = roofs.surface(this.x, this.y);
    if (this.z <= floor + 0.02) {
      if (this.vz < -1) this.lastImpact = Math.max(this.lastImpact, -this.vz * (lift ? 0.6 : 1.4));
      this.z = floor;
      this.vz = Math.max(0, this.vz);
      this.landed = true;
    } else this.landed = this.z - floor < 0.15;

    // inclinación visual: morro abajo al acelerar hacia delante, alabeo en los giros
    const accel = lift ? (c!.fwd - c!.back * 0.5) * MAX_SPEED - vf : 0;
    const pitchWant = this.landed ? 0 : clamp(-vf * 0.004 - accel * 0.006, -0.38, 0.3);
    const rollWant = this.landed ? 0 : clamp(this.yawRate * vf * 0.012 + vl * 0.02, -0.45, 0.45);
    this.pitch += (pitchWant - this.pitch) * Math.min(1, dt * 3);
    this.roll += (rollWant - this.roll) * Math.min(1, dt * 3);
  }

  damage(n: number) {
    this.health = Math.max(0, this.health - n);
  }

  syncMesh(roofs: RoofMap, dt: number) {
    const m = this.m;
    m.group.position.set(this.x, this.z, -this.y);
    m.group.rotation.set(0, -this.a, 0);
    m.body.rotation.set(this.pitch, 0, this.roll, 'XYZ');
    m.rotor.rotation.y += this.rpm * dt * 38;
    m.tail.rotation.x += this.rpm * dt * 60;
    // sombra: en la superficie de debajo, más grande y tenue cuanto más alto
    const g = roofs.surface(this.x, this.y), h = this.z - g;
    m.shadow.position.set(this.x + 0.6, g + 0.06, -this.y);
    const s = clamp(3.2 + h * 0.03, 3.2, 7);
    m.shadow.scale.set(s, 1, s * 1.4);
    m.shadow.rotation.y = -this.a;
    m.shadow.visible = h < 120;
  }

  /** ¿Se puede bajar aquí? (posado y en el suelo, no en una azotea) */
  canExit(roofs: RoofMap, terrainZ: number) {
    return this.landed && this.speed < 3 && roofs.roof(this.x, this.y) < terrainZ + 0.5;
  }

  /** Rumbo hacia un punto (para el piloto automático de la policía). */
  headingTo(x: number, y: number) {
    return angDiff(this.a, Math.atan2(x - this.x, y - this.y));
  }
}
