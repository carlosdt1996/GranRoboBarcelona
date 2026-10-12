import type { WallGrid } from '../collision';
import { angDiff, clamp } from '../geom';
import type { Billboards } from '../render/billboards';
import type { SpriteRect } from '../render/textures';
import { Vehicle, type Controls } from './vehicle';

const WALK = 1.9, RUN = 5.6, BACK = 1.4, TURN = 3.2, R = 0.32;

/** El protagonista a pie: controles de tanque (↑↓ andar, ←→ girar, Espacio correr). */
export class Walker {
  x = 0;
  y = 0;
  z = 0;
  a = 0;
  vx = 0;
  vy = 0;
  health = 100;
  /** Chaleco antibalas: absorbe el daño antes que la salud. */
  armor = 0;
  /** Suelo fijo (dentro de un interior); null = el terreno. */
  floor: number | null = null;
  readonly length = 0.6;
  readonly width = 0.6;
  /** Animación de los pasos, tiempo apuntando y tumbado (atropello o explosión). */
  private phase = 0;
  aimT = 0;
  down = 0;
  private push: [number, number] = [0, 0];

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  /** `aimA`: apuntando (mira a ese rumbo; ←→ se desplaza de lado en vez de girar). */
  step(c: Controls, dt: number, walls: WallGrid, others: Iterable<{ x: number; y: number; a: number; length: number; width: number }>, aimA: number | null = null) {
    if (this.down > 0) {
      // por los suelos: se desliza hasta pararse y se levanta
      this.down -= dt;
      this.vx *= Math.exp(-4 * dt);
      this.vy *= Math.exp(-4 * dt);
    } else {
      let side = 0;
      if (aimA !== null) { this.face(aimA, dt); side = c.steer * WALK; }
      else this.a += c.steer * TURN * dt * (c.handbrake ? 0.8 : 1);
      const run = c.handbrake && aimA === null;
      const want = c.throttle > 0 ? (run ? RUN : WALK) : c.brake > 0 ? -BACK : 0;
      const fx = Math.sin(this.a), fy = Math.cos(this.a);
      const k = Math.min(1, dt * 12);
      this.vx += (fx * want + fy * side - this.vx) * k;
      this.vy += (fy * want - fx * side - this.vy) * k;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.phase += dt * this.speed * 1.9;
    this.aimT = Math.max(0, this.aimT - dt);

    // paredes y coches (no se puede atravesar nada)
    if (walls.pushCircle(this.x, this.y, R, this.push)) { this.x += this.push[0]; this.y += this.push[1]; }
    for (const v of others) {
      if (Math.abs(v.x - this.x) > 8 || Math.abs(v.y - this.y) > 8) continue;
      const fx = Math.sin(v.a), fy = Math.cos(v.a);
      const dx = this.x - v.x, dy = this.y - v.y;
      // caja orientada del coche
      const along = clamp(dx * fx + dy * fy, -v.length / 2, v.length / 2);
      const lat = clamp(dx * fy - dy * fx, -v.width / 2, v.width / 2);
      const qx = v.x + fx * along + fy * lat, qy = v.y + fy * along - fx * lat;
      const ex = this.x - qx, ey = this.y - qy, d = Math.hypot(ex, ey);
      if (d >= R) continue;
      const nx = d > 1e-4 ? ex / d : fy, ny = d > 1e-4 ? ey / d : -fx;
      this.x = qx + nx * R;
      this.y = qy + ny * R;
    }
    this.z = this.floor ?? Vehicle.ground(this.x, this.y);
  }

  /** Atropello o explosión: daño y por los suelos un momento. */
  hurt(n: number, pushX = 0, pushY = 0) {
    const a = Math.min(this.armor, n * 0.8);
    this.armor -= a;
    this.health = Math.max(0, this.health - (n - a));
    if (pushX || pushY) {
      this.vx = pushX;
      this.vy = pushY;
      this.down = Math.max(this.down, 1.2);
    }
  }

  /** Girar suavemente hacia un objetivo (apuntado automático). */
  face(a: number, dt: number) {
    this.a += angDiff(this.a, a) * Math.min(1, dt * 20);
  }

  draw(sprites: Billboards, slot: number, rects: Record<string, SpriteRect>, camA: number) {
    if (this.down > 0 || this.health <= 0) {
      sprites.set(slot, this.x, this.y, this.z + 0.02, 1.8, 0.9, rects.hero_down);
      return;
    }
    const away = Math.sin(this.a) * Math.sin(camA) + Math.cos(this.a) * Math.cos(camA) > 0;
    const moving = this.speed > 0.3;
    const name = this.aimT > 0 ? (away ? 'backAim' : 'frontAim') : `${away ? 'back' : 'front'}${moving ? Math.floor(this.phase) % 2 : 0}`;
    sprites.set(slot, this.x, this.y, this.z, 0.85, 1.75, rects[`hero_${name}`]);
  }
}
