import type { WallGrid } from '../collision';
import { angDiff } from '../geom';
import type { RoofMap } from '../heights';
import type { Fx } from '../render/fx';
import type { Sound } from '../audio';
import type { Peds } from './peds';
import type { Traffic, AICar } from './traffic';
import type { Vehicle } from './vehicle';
import type { Walker } from './walker';

export type WeaponId = 'fists' | 'pistol' | 'smg' | 'shotgun' | 'rocket' | 'grenade';

export interface Weapon { id: WeaponId; name: string; rate: number; dmg: number; range: number; pellets: number; spread: number }

/** La rueda de armas, en orden. */
export const WEAPONS: Weapon[] = [
  { id: 'fists', name: 'PUÑOS', rate: 0.45, dmg: 4, range: 1.7, pellets: 1, spread: 0 },
  { id: 'pistol', name: 'PISTOLA', rate: 0.22, dmg: 12, range: 60, pellets: 1, spread: 0.01 },
  { id: 'smg', name: 'SUBFUSIL', rate: 0.075, dmg: 7, range: 50, pellets: 1, spread: 0.07 },
  { id: 'shotgun', name: 'ESCOPETA', rate: 0.85, dmg: 9, range: 28, pellets: 7, spread: 0.14 },
  { id: 'rocket', name: 'LANZACOHETES', rate: 1.3, dmg: 0, range: 120, pellets: 1, spread: 0 },
  { id: 'grenade', name: 'GRANADAS', rate: 0.9, dmg: 0, range: 40, pellets: 1, spread: 0 },
];

const AIM_CONE = 0.38;
const BLAST_R = 7.5, BURN_TIME = 3.5;
const ROCKET_SPEED = 48, GRENADE_FUSE = 2.2;

/** Algo que recibe balas y no es un coche ni un peatón: agentes a pie, helicóptero policial... */
export interface SoftTarget { x: number; y: number; r: number; alive: boolean; hurt(dmg: number, dx: number, dy: number): void }

interface Projectile { kind: 'rocket' | 'grenade'; x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number }

/**
 * Armas (con apuntado automático), proyectiles, daños, coches que humean, arden y explotan
 * (en cadena) y el pánico de la gente. Todo lo que puede recibir balas vive aquí.
 */
export class Combat {
  weapon = 1;
  /** Apuntado automático al disparar sin apuntar (opción). */
  assist = true;
  private cool = 0;
  private smokeT = 0;
  private shots: Projectile[] = [];
  /** El jugador ha muerto (a pie o dentro de un coche que explota). */
  onPlayerDown?: () => void;
  /** Para lo que no gestiona Combat (helicópteros, policía...). */
  onBlast?: (x: number, y: number, r: number) => void;
  /** Delitos (para el nivel de búsqueda): 'shot' disparo, 'ped' herir a alguien, 'car' dañar un coche, 'boom' explosión. */
  onCrime?: (kind: 'shot' | 'ped' | 'car' | 'boom', x: number, y: number) => void;
  /** Más vehículos que pueden recibir balas (coches de policía). */
  extraTargets?: () => Iterable<Vehicle>;
  softTargets?: () => Iterable<SoftTarget>;
  /** Coche del jugador (si conduce) y el jugador a pie (si anda). */
  playerCar: Vehicle | null = null;
  walker: Walker | null = null;

  constructor(private traffic: Traffic, private peds: Peds, private fx: Fx, private sound: Sound, private walls: WallGrid, private roofs: RoofMap) {}

  get current() {
    return WEAPONS[this.weapon];
  }

  private *targets(): Iterable<Vehicle> {
    yield* this.traffic.vehicles();
    if (this.extraTargets) yield* this.extraTargets();
    if (this.playerCar) yield this.playerCar;
  }

  /** Apuntado automático: el blanco más centrado del cono que esté a la vista. */
  private autoAim(x: number, y: number, a: number, range: number) {
    let best = Infinity, aim = a;
    const consider = (tx: number, ty: number) => {
      const d = Math.hypot(tx - x, ty - y);
      if (d < 0.8 || d > range * 0.8) return;
      const ta = Math.atan2(tx - x, ty - y), off = Math.abs(angDiff(a, ta));
      if (off > AIM_CONE) return;
      const score = off + d / 150;
      if (score >= best || this.walls.raycast(x, y, tx, ty) < 0.98) return;
      best = score;
      aim = ta;
    };
    for (const p of this.peds.peds) if (!p.hit) consider(p.x, p.y);
    for (const v of this.targets()) if (!v.wrecked && v !== this.playerCar) consider(v.x, v.y);
    for (const t of this.softTargets?.() ?? []) if (t.alive) consider(t.x, t.y);
    return aim;
  }

  /**
   * Dispara el arma actual desde (x, y, z) mirando a `a` (hacia `at` si hay un blanco fijado).
   * Devuelve el rumbo final o null si aún recarga.
   */
  shoot(x: number, y: number, z: number, a: number, at?: [number, number] | null): number | null {
    if (this.cool > 0) return null;
    const w = this.current;
    this.cool = w.rate;
    const aim = at ? Math.atan2(at[0] - x, at[1] - y) : w.id === 'fists' || !this.assist ? a : this.autoAim(x, y, a, w.range);
    const mz = z + 1.3;
    if (w.id === 'fists') { this.punch(x, y, aim); return aim; }
    if (w.id === 'rocket' || w.id === 'grenade') {
      const dx = Math.sin(aim), dy = Math.cos(aim);
      const p: Projectile = w.id === 'rocket'
        ? { kind: 'rocket', x: x + dx * 0.8, y: y + dy * 0.8, z: mz, vx: dx * ROCKET_SPEED, vy: dy * ROCKET_SPEED, vz: 0, t: 0 }
        : { kind: 'grenade', x: x + dx * 0.5, y: y + dy * 0.5, z: mz + 0.3, vx: dx * 13, vy: dy * 13, vz: 6, t: 0 };
      this.shots.push(p);
      if (w.id === 'rocket') { this.fx.flash(p.x, p.y, mz); this.sound.rocket(); this.peds.panic(x, y, 45); }
      else this.sound.throw();
      this.onCrime?.('shot', x, y);
      return aim;
    }
    this.fx.flash(x + Math.sin(aim) * 0.6, y + Math.cos(aim) * 0.6, mz);
    this.sound.gunshot(w.id);
    this.peds.panic(x, y, 45);
    this.onCrime?.('shot', x, y);
    for (let i = 0; i < w.pellets; i++) this.hitscan(x, y, mz, aim + (Math.random() - 0.5) * 2 * w.spread, w.dmg, w.range, i === 0 || Math.random() < 0.4);
    return aim;
  }

  /** Bala instantánea: el primer peatón, coche o pared que cruza. */
  private hitscan(x: number, y: number, mz: number, aim: number, dmg: number, range: number, tracer: boolean) {
    const dx = Math.sin(aim), dy = Math.cos(aim);
    const wall = this.walls.raycast(x, y, x + dx * range, y + dy * range) * range;
    let hitT = wall, hitPed = this.peds.raycast(x, y, dx, dy, wall), hitCar: Vehicle | null = null;
    if (hitPed) hitT = hitPed.t;
    const circ: number[] = [];
    for (const v of this.targets()) {
      if (v === this.playerCar || Math.abs(v.x - x) > range + 8 || Math.abs(v.y - y) > range + 8) continue;
      v.circles(circ);
      for (let i = 0; i < circ.length; i += 3) {
        const rx = circ[i] - x, ry = circ[i + 1] - y, r = circ[i + 2];
        const t = rx * dx + ry * dy, lat = Math.abs(rx * dy - ry * dx);
        if (t < 0 || lat > r) continue;
        const tt = t - Math.sqrt(r * r - lat * lat);
        if (tt < hitT) { hitT = tt; hitCar = v; hitPed = null; }
      }
    }
    let hitSoft: SoftTarget | null = null;
    for (const s of this.softTargets?.() ?? []) {
      if (!s.alive) continue;
      const rx = s.x - x, ry = s.y - y, t = rx * dx + ry * dy;
      if (t < 0 || t > hitT || Math.abs(rx * dy - ry * dx) > s.r) continue;
      hitT = t; hitSoft = s; hitPed = null; hitCar = null;
    }
    const hx = x + dx * hitT, hy = y + dy * hitT;
    if (tracer) this.fx.tracer(x + dx * 0.6, y + dy * 0.6, mz, hx, hy, mz - 0.2);
    if (hitSoft) {
      this.fx.sparks(hx, hy, mz - 0.3, 3);
      hitSoft.hurt(dmg, dx, dy);
    } else if (hitPed) {
      this.fx.blood(hx, hy, mz - 0.3);
      this.peds.knock(hitPed.p, dx, dy, 3);
      this.onCrime?.('ped', hx, hy);
    } else if (hitCar) {
      this.fx.sparks(hx, hy, mz - 0.5, 3);
      this.sound.ping();
      this.hurtCar(hitCar, dmg, x, y);
      this.onCrime?.('car', hx, hy);
    } else if (wall < range - 0.5) {
      this.fx.sparks(hx, hy, mz - 0.2, 3);
    }
  }

  /** Puñetazo: al peatón o coche que tengas justo delante. */
  private punch(x: number, y: number, a: number) {
    const dx = Math.sin(a), dy = Math.cos(a);
    for (const p of this.peds.peds) {
      if (p.hit) continue;
      const rx = p.x - x, ry = p.y - y, t = rx * dx + ry * dy;
      if (t > 0 && t < 1.7 && Math.abs(rx * dy - ry * dx) < 0.7) {
        this.peds.knock(p, dx, dy, 2.5);
        this.sound.thud();
        this.onCrime?.('ped', p.x, p.y);
        return;
      }
    }
    for (const s of this.softTargets?.() ?? []) {
      if (!s.alive || Math.hypot(s.x - x, s.y - y) > s.r + 1.3) continue;
      s.hurt(this.current.dmg * 2, dx, dy);
      this.sound.thud();
      return;
    }
    for (const v of this.targets()) {
      if (v === this.playerCar || Math.hypot(v.x - x, v.y - y) > v.length / 2 + 1.5) continue;
      this.hurtCar(v, 3, x, y);
      this.sound.thud();
      return;
    }
  }

  /** Daño a un coche; los conductores del tráfico huyen o abandonan el coche. */
  hurtCar(v: Vehicle, n: number, fromX: number, fromY: number) {
    if (v.wrecked) return;
    v.damage(n);
    const c = this.aiOf(v);
    if (!c) return;
    if (Math.random() < 0.45 && v.speed < 9) this.bail(c, fromX, fromY);
    else { c.panic = 6; c.stun = 0; }
  }

  private aiOf(v: Vehicle): AICar | undefined {
    return this.traffic.cars.find((c) => c.v === v);
  }

  /** El conductor sale del coche y echa a correr; el coche se queda tirado. */
  bail(c: AICar, fromX: number, fromY: number) {
    const v = this.traffic.take(c);
    this.traffic.park(v);
    const lx = -Math.cos(v.a), ly = Math.sin(v.a); // lado izquierdo (puerta del conductor)
    this.peds.spawnFleeing(v.x + lx * (v.width / 2 + 0.6), v.y + ly * (v.width / 2 + 0.6), fromX, fromY);
  }

  explode(v: Vehicle) {
    if (v.wrecked) return;
    const c = this.aiOf(v);
    if (c) this.traffic.park(this.traffic.take(c));
    v.wreck();
    v.vx *= 0.3;
    v.vy *= 0.3;
    this.blast(v.x, v.y, v.z, v);
    if (v === this.playerCar) this.onPlayerDown?.();
  }

  /** Explosión en (x, y, z): gente por los aires y vehículos dañados (explosiones en cadena). */
  blast(x: number, y: number, z: number, skip?: Vehicle, r = BLAST_R) {
    this.fx.explosion(x, y, z + 1);
    this.sound.explosion();
    this.peds.panic(x, y, 60);
    this.onCrime?.('boom', x, y);
    for (const p of this.peds.peds) {
      const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
      if (d < r && !p.hit) this.peds.knock(p, dx / (d || 1), dy / (d || 1), 9 * (1 - d / r) + 2);
    }
    for (const o of [...this.targets()]) {
      if (o === skip || o.wrecked) continue;
      const dx = o.x - x, dy = o.y - y, d = Math.hypot(dx, dy);
      if (d > r) continue;
      o.damage(90 * (1 - d / r));
      o.vx += (dx / (d || 1)) * 4;
      o.vy += (dy / (d || 1)) * 4;
    }
    for (const s of [...(this.softTargets?.() ?? [])]) {
      const dx = s.x - x, dy = s.y - y, d = Math.hypot(dx, dy);
      if (s.alive && d < r + s.r) s.hurt(160 * (1 - Math.min(1, d / (r + s.r))), dx / (d || 1), dy / (d || 1));
    }
    this.onBlast?.(x, y, r);
    const w = this.walker;
    if (w && w.health > 0) {
      const dx = w.x - x, dy = w.y - y, d = Math.hypot(dx, dy);
      if (d < r) {
        w.hurt(110 * (1 - d / r), (dx / (d || 1)) * 7, (dy / (d || 1)) * 7);
        if (w.health <= 0) this.onPlayerDown?.();
      }
    }
  }

  /** Cohetes y granadas en vuelo. */
  private flyShots(dt: number) {
    const circ: number[] = [];
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i];
      p.t += dt;
      const ox = p.x, oy = p.y;
      if (p.kind === 'grenade') p.vz -= 18 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const ground = this.roofs.surface(p.x, p.y);
      const wall = this.walls.raycast(ox, oy, p.x, p.y) < 1;
      let boom = p.kind === 'rocket' && (wall || p.z <= ground || p.t > 3);
      if (p.kind === 'rocket' && !boom) {
        for (const pd of this.peds.peds) if (!pd.hit && Math.hypot(pd.x - p.x, pd.y - p.y) < 0.8) boom = true;
        for (const s of this.softTargets?.() ?? []) if (s.alive && Math.hypot(s.x - p.x, s.y - p.y) < s.r + 0.3) boom = true;
        for (const v of this.targets()) {
          if (boom || v === this.playerCar || Math.abs(v.x - p.x) > 8 || Math.abs(v.y - p.y) > 8) continue;
          v.circles(circ);
          for (let k = 0; k < circ.length; k += 3) if (Math.hypot(circ[k] - p.x, circ[k + 1] - p.y) < circ[k + 2] + 0.2) boom = true;
        }
        if (Math.random() < 0.7) this.fx.smoke(p.x - p.vx * 0.02, p.y - p.vy * 0.02, p.z);
        this.fx.sprite(p.x, p.y, p.z, 'fx_rocket', 0.9);
      }
      if (p.kind === 'grenade') {
        // rebota en paredes y suelo
        if (wall) { p.x = ox; p.y = oy; p.vx *= -0.4; p.vy *= -0.4; }
        if (p.z <= ground) { p.z = ground; p.vz = Math.abs(p.vz) * 0.35; p.vx *= 0.6; p.vy *= 0.6; }
        this.fx.sprite(p.x, p.y, p.z + 0.1, 'fx_grenade', 0.45);
        boom = p.t > GRENADE_FUSE;
      }
      if (boom) {
        this.shots.splice(i, 1);
        this.blast(p.x, p.y, Math.max(ground, p.z - 1));
      }
    }
  }

  update(dt: number) {
    this.cool -= dt;
    this.flyShots(dt);
    this.smokeT -= dt;
    const puff = this.smokeT <= 0;
    if (puff) this.smokeT = 0.12;
    for (const v of [...this.targets()]) {
      if (v.wrecked) {
        if (puff && Math.random() < 0.25) this.fx.smoke(v.x, v.y, v.z + 1.2);
        continue;
      }
      const k = v.health / v.maxHealth;
      if (k <= 0.2 && !v.burning) v.burning = 0.001;
      const hx = v.x + Math.sin(v.a) * v.length * 0.3, hy = v.y + Math.cos(v.a) * v.length * 0.3;
      if (v.burning) {
        v.burning += dt;
        if (puff) { this.fx.fire(hx, hy, v.z + 0.9); this.fx.smoke(hx, hy, v.z + 1.5, true); }
        if (v.burning > BURN_TIME) this.explode(v);
      } else if (k < 0.45 && puff && Math.random() < 0.6) this.fx.smoke(hx, hy, v.z + 1.1);
    }
  }
}
