import type * as THREE from 'three';
import type { WallGrid } from '../collision';
import { angDiff, clamp } from '../geom';
import type { RoofMap } from '../heights';
import type { RoadGraph } from '../roads';
import type { Sound } from '../audio';
import type { Billboards } from '../render/billboards';
import type { Fx } from '../render/fx';
import type { SpriteRect } from '../render/textures';
import type { SoftTarget } from './combat';
import { findRoute, lookAhead } from './gps';
import { Heli, type HeliControls } from './heli';
import { Vehicle, collidePair } from './vehicle';
import type { Traffic } from './traffic';

/** Calor que suma cada delito. Estrellas: 0.6, 3, 7, 14 y 24 de calor. */
const HEAT = { shot: 0.12, ped: 1.2, car: 0.25, boom: 1.6, jack: 1.2, runover: 1.2, cop: 4, copcar: 0.5 };
const STAR_HEAT = [0.6, 3, 7, 14, 24];
/** Medios por nivel de búsqueda: coches patrulla, furgones antidisturbios y helicópteros. */
const CARS = [0, 1, 2, 4, 5, 7];
const VANS = [0, 0, 0, 0, 2, 3];
const HELIS = [0, 0, 0, 1, 1, 2];
const DESPAWN = 460;

export type Crime = keyof typeof HEAT;

interface CopCar {
  v: Vehicle;
  route: Float32Array | null;
  repath: number;
  stuckT: number;
  reverseT: number;
  deployed: boolean;
  lastHealth: number;
}

class FootCop implements SoftTarget {
  vx = 0;
  vy = 0;
  a = 0;
  health = 35;
  shootT = 1 + Math.random();
  phase = Math.random();
  deadT = 0;
  aimT = 0;
  readonly r = 0.45;
  constructor(public x: number, public y: number) {}
  get alive() { return this.health > 0; }
  hurt(dmg: number, dx: number, dy: number) {
    if (!this.alive) return;
    this.health -= dmg;
    if (this.health <= 0) { this.vx = dx * 3; this.vy = dy * 3; this.onDown?.(); }
  }
  onDown?: () => void;
}

class CopHeli implements SoftTarget {
  shootT = 2;
  orbit = Math.random() * Math.PI * 2;
  readonly r = 3;
  constructor(public h: Heli) {}
  get x() { return this.h.x; }
  get y() { return this.h.y; }
  get alive() { return !this.h.wrecked && this.h.health > 0; }
  hurt(dmg: number) { this.h.damage(dmg * 0.6); }
}

/** El objetivo de la policía: el jugador, vaya como vaya. */
export interface Suspect { x: number; y: number; z: number; vx: number; vy: number; speed: number; mode: 'car' | 'foot' | 'heli' }

/**
 * Nivel de búsqueda (estrellas) y la policía que te persigue: patrullas de la Guardia Urbana,
 * de los Mossos, furgones antidisturbios y helicópteros, más y más agresivos con cada estrella.
 */
export class Police {
  heat = 0;
  stars = 0;
  /** Segundos desde la última vez que un agente te vio. */
  unseen = 0;
  cars: CopCar[] = [];
  cops: FootCop[] = [];
  helis: CopHeli[] = [];
  private spawnT = 0;
  private bustT = 0;
  private t = 0;
  onBusted?: () => void;
  /** Disparo de la policía que te alcanza (daño). */
  onHitPlayer?: (dmg: number) => void;
  /** Un vehículo policial que hay que dejar en la calle (calcinado). */
  onWreck?: (v: Vehicle) => void;
  onHeliDown?: (h: Heli) => void;
  /** Para chocar con el tráfico y los coches aparcados (no atraviesan nada). */
  traffic?: Traffic;
  playerCar: Vehicle | null = null;

  constructor(
    private graph: RoadGraph, private scene: THREE.Object3D, private walls: WallGrid, private roofs: RoofMap,
    private fx: Fx, private sound: Sound, private sprites: Billboards, private rects: Record<string, SpriteRect>,
  ) {}

  crime(kind: Crime) {
    this.heat += HEAT[kind];
    let s = 0;
    while (s < 5 && this.heat >= STAR_HEAT[s]) s++;
    if (s > this.stars) { this.stars = s; this.unseen = 0; }
  }

  /** Fija el nivel de búsqueda (misiones, trucos). */
  setStars(n: number) {
    this.heat = n > 0 ? STAR_HEAT[n - 1] : 0;
    this.stars = n;
    this.unseen = 0;
  }

  /** Te han perdido o te han pillado: sin estrellas. */
  clear() {
    this.heat = 0;
    this.stars = 0;
    this.unseen = 0;
  }

  *vehicles(): Iterable<Vehicle> {
    for (const c of this.cars) yield c.v;
  }

  *targets(): Iterable<SoftTarget> {
    yield* this.cops;
    yield* this.helis;
  }

  /** Aparece una patrulla en una calle a 110-220 m, mejor por detrás de la cámara. */
  private spawnCar(s: Suspect, camA: number, riot: boolean) {
    const g = this.graph, near = g.edgesNear(s.x, s.y, 230);
    const fx = Math.sin(camA), fy = Math.cos(camA), tmp = { x: 0, y: 0, a: 0 };
    for (let k = 0; k < 40 && near.length; k++) {
      const e = g.edges[near[Math.floor(Math.random() * near.length)]];
      if (e.len < 10 || !e.road.drive || e.road.cls === 'service') continue;
      const p = g.pose(e, e.len / 2, g.laneOffset(e, e.lanes - 1), tmp);
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
      if (d < 110 || d > 220 || (dx * fx + dy * fy) / d > 0.3) continue;
      const mossos = this.stars >= 3 && Math.random() < 0.7;
      const v = new Vehicle(riot ? 'riot' : 'police', riot ? '#1a2a6a' : mossos ? '#1a2a6a' : '#f2f2f2');
      v.x = p.x; v.y = p.y; v.a = p.a;
      v.syncMesh();
      this.scene.add(v.mesh);
      this.cars.push({ v, route: null, repath: 0, stuckT: 0, reverseT: 0, deployed: false, lastHealth: v.health });
      return;
    }
  }

  private spawnHeli(s: Suspect) {
    const h = new Heli('#1a2a6a', '#f2f2f2');
    const a = Math.random() * Math.PI * 2;
    h.x = s.x + Math.sin(a) * 260; h.y = s.y + Math.cos(a) * 260;
    h.z = Math.max(s.z, this.roofs.surface(h.x, h.y)) + 70;
    h.rpm = 1; h.landed = false;
    h.a = Math.atan2(s.x - h.x, s.y - h.y);
    this.scene.add(h.mesh, h.m.shadow);
    this.helis.push(new CopHeli(h));
  }

  /** Persecución en coche: ruta por las calles si estás lejos o tapado; a por ti si te ve (embiste). */
  private drive(c: CopCar, dt: number, s: Suspect, chasing: boolean) {
    const v = c.v;
    if (v.wrecked) return;
    const d = Math.hypot(s.x - v.x, s.y - v.y);
    let px = s.x + s.vx * Math.min(1.2, d / 30), py = s.y + s.vy * Math.min(1.2, d / 30);
    const los = d < 70 && this.walls.raycast(v.x, v.y, s.x, s.y) > 0.98;
    if (chasing && !los && d > 20) {
      c.repath -= dt;
      if (c.repath <= 0 || !c.route) {
        c.route = findRoute(this.graph, null, v.x, v.y, v.a, s.x, s.y, false);
        c.repath = 1.5 + Math.random();
      }
      if (c.route) [px, py] = lookAhead(c.route, v.x, v.y, 12 + v.speed * 0.5);
    }
    const diff = angDiff(v.a, Math.atan2(px - v.x, py - v.y));
    let steer = clamp(diff * 2.5, -1, 1), throttle = chasing ? 1 : 0, brake = chasing ? 0 : 1;
    const handbrake = chasing && Math.abs(diff) > 0.9 && v.speed > 14;
    if (Math.abs(diff) > 1.3 && v.speed > 10) { throttle = 0.3; brake = 0.5; }
    if (s.mode === 'foot' && d < 9) { throttle = 0; brake = 1; } // se para junto a ti
    if (c.reverseT > 0) { c.reverseT -= dt; throttle = 0; brake = 1; steer = -steer; }
    else if (chasing && v.speed < 1.2 && throttle > 0.5 && d > 10) {
      c.stuckT += dt;
      if (c.stuckT > 1) { c.reverseT = 1.1; c.stuckT = 0; }
    } else c.stuckT = 0;
    v.step({ throttle, brake, steer, handbrake }, dt, this.walls);
  }

  /** Las patrullas chocan entre sí, con el tráfico, con los aparcados y con el coche del jugador. */
  private collide(c: CopCar, i: number) {
    const v = c.v;
    for (let j = i + 1; j < this.cars.length; j++) collidePair(v, this.cars[j].v, 0.5, 0.5);
    if (this.playerCar) collidePair(v, this.playerCar, 1, 0);
    const t = this.traffic;
    if (!t) return;
    for (const ai of t.cars) {
      // los coches del tráfico van por raíles: la patrulla rebota y el otro se queda parado
      if (collidePair(v, ai.v, 1, 0) > 2) ai.stun = 1.5 + Math.random() * 1.5;
    }
    for (const p of t.parked) collidePair(v, p, 0.5, 0.5);
  }

  /** Disparo de un agente: acierta según la distancia y lo rápido que vayas. */
  private fire(x: number, y: number, z: number, s: Suspect, accuracy: number, dmg: number) {
    const hit = Math.random() < accuracy * clamp(1 - s.speed * 0.02, 0.35, 1);
    const ox = hit ? 0 : (Math.random() - 0.5) * 4, oy = hit ? 0 : (Math.random() - 0.5) * 4;
    this.fx.flash(x, y, z);
    this.fx.tracer(x, y, z, s.x + ox, s.y + oy, s.z + 1.1);
    this.sound.gunshot('pistol');
    if (hit) this.onHitPlayer?.(dmg);
    else this.fx.sparks(s.x + ox, s.y + oy, s.z + 0.5, 2);
  }

  update(dt: number, s: Suspect, camA: number, onFootPlayerDown: boolean) {
    this.t += dt;
    const chasing = this.stars > 0;

    // ¿te ve alguien? Si no, al rato pierden la pista y se acaban las estrellas
    let seen = false;
    for (const c of this.cars) if (!seen && Math.hypot(c.v.x - s.x, c.v.y - s.y) < 90 && this.walls.raycast(c.v.x, c.v.y, s.x, s.y) > 0.98) seen = true;
    for (const p of this.cops) if (!seen && p.alive && Math.hypot(p.x - s.x, p.y - s.y) < 60 && this.walls.raycast(p.x, p.y, s.x, s.y) > 0.98) seen = true;
    for (const h of this.helis) if (!seen && h.alive && Math.hypot(h.x - s.x, h.y - s.y) < 170) seen = true;
    this.unseen = seen ? 0 : this.unseen + dt;
    if (chasing && this.unseen > 7 + this.stars * 2.5) this.clear();

    // refuerzos hasta completar los medios de este nivel
    this.spawnT -= dt;
    if (chasing && this.spawnT <= 0) {
      this.spawnT = 1.4;
      const vans = this.cars.filter((c) => c.v.kind === 'riot' && !c.v.wrecked).length;
      const cars = this.cars.filter((c) => c.v.kind === 'police' && !c.v.wrecked).length;
      if (vans < VANS[this.stars]) this.spawnCar(s, camA, true);
      else if (cars < CARS[this.stars]) this.spawnCar(s, camA, false);
      else if (this.helis.filter((h) => h.alive).length < HELIS[this.stars]) this.spawnHeli(s);
    }

    // patrullas
    const sub = Math.max(1, Math.ceil(dt / (1 / 120))), sdt = dt / sub;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i], v = c.v;
      const d = Math.hypot(v.x - s.x, v.y - s.y);
      if (d > DESPAWN || (!chasing && d > 160) || v.wrecked) {
        this.cars.splice(i, 1);
        if (v.wrecked && d < DESPAWN) this.onWreck?.(v);
        else this.scene.remove(v.mesh);
        continue;
      }
      for (let k = 0; k < sub; k++) this.drive(c, sdt, s, chasing);
      this.collide(c, i);
      v.syncMesh();
      v.setSiren(chasing, this.t + i * 0.37);
      if (v.health < c.lastHealth) { this.crime('copcar'); c.lastHealth = v.health; }
      // si vas a pie, los agentes bajan del coche
      if (chasing && !c.deployed && s.mode === 'foot' && d < 28 && v.speed < 3) {
        c.deployed = true;
        for (const side of [-1, 1]) {
          const cop = new FootCop(v.x + Math.cos(v.a) * side * 1.6, v.y - Math.sin(v.a) * side * 1.6);
          cop.onDown = () => this.crime('cop');
          this.cops.push(cop);
        }
      }
    }

    // agentes a pie: a 1 estrella intentan detenerte; con más, disparan
    let busting = false;
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const p = this.cops[i];
      const dx = s.x - p.x, dy = s.y - p.y, d = Math.hypot(dx, dy);
      if (!p.alive) {
        p.deadT += dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-4 * dt); p.vy *= Math.exp(-4 * dt);
        if (p.deadT > 20 || d > 200) this.cops.splice(i, 1);
        continue;
      }
      if (d > 160 || (!chasing && d > 60)) { this.cops.splice(i, 1); continue; }
      const los = this.walls.raycast(p.x, p.y, s.x, s.y) > 0.98;
      let want = 0;
      if (!chasing) want = 0;
      else if (this.stars <= 1 && s.mode === 'foot') want = d > 1.1 ? 4.6 : 0;
      else want = d > 13 || !los ? 4.4 : d < 5 ? -1.5 : 0;
      const ux = dx / (d || 1), uy = dy / (d || 1);
      p.vx += (ux * want - p.vx) * Math.min(1, dt * 8);
      p.vy += (uy * want - p.vy) * Math.min(1, dt * 8);
      p.x += p.vx * dt; p.y += p.vy * dt;
      const push: [number, number] = [0, 0];
      if (this.walls.pushCircle(p.x, p.y, 0.3, push)) { p.x += push[0]; p.y += push[1]; }
      p.a = Math.atan2(dx, dy);
      p.phase += dt * Math.hypot(p.vx, p.vy) * 1.6;
      p.aimT = Math.max(0, p.aimT - dt);
      if (chasing && this.stars >= 2 && los && d < 32) {
        p.shootT -= dt;
        if (p.shootT <= 0) { p.shootT = 0.9 + Math.random() * 0.6; p.aimT = 0.4; this.fire(p.x, p.y, Vehicle.ground(p.x, p.y) + 1.3, s, 0.42 - d * 0.006, 7); }
      }
      if (this.stars <= 1 && s.mode === 'foot' && d < 1.4 && s.speed < 2.5 && !onFootPlayerDown) busting = true;
    }
    this.bustT = busting ? this.bustT + dt : 0;
    if (this.bustT > 1.5) { this.bustT = 0; this.onBusted?.(); }

    // helicópteros: te siguen desde arriba y, con 4 estrellas, disparan
    for (let i = this.helis.length - 1; i >= 0; i--) {
      const c = this.helis[i], h = c.h;
      const d = Math.hypot(h.x - s.x, h.y - s.y);
      if (!c.alive) { this.helis.splice(i, 1); this.onHeliDown?.(h); continue; }
      if (d > DESPAWN + 200 || (!chasing && d > 300)) { this.helis.splice(i, 1); this.scene.remove(h.mesh, h.m.shadow); continue; }
      c.orbit += dt * 0.25;
      const tx = chasing ? s.x + Math.sin(c.orbit) * 28 : h.x + Math.sin(h.a) * 50;
      const ty = chasing ? s.y + Math.cos(c.orbit) * 28 : h.y + Math.cos(h.a) * 50;
      const alt = Math.max(this.roofs.surface(tx, ty), s.z) + (chasing ? 32 : 90);
      const td = Math.hypot(tx - h.x, ty - h.y);
      const face = td > 25 ? Math.atan2(tx - h.x, ty - h.y) : Math.atan2(s.x - h.x, s.y - h.y);
      const diff = angDiff(h.a, face);
      const ctl: HeliControls = {
        fwd: td > 12 && Math.abs(diff) < 0.8 ? clamp(td / 60, 0.15, 1) : 0, back: 0,
        yaw: clamp(diff * 1.8, -1, 1), up: clamp((alt - h.z) / 8, 0, 1), down: clamp((h.z - alt) / 8, 0, 1),
      };
      for (let k = 0; k < sub; k++) h.step(ctl, sdt, this.roofs);
      h.syncMesh(this.roofs, dt);
      if (chasing && this.stars >= 4 && d < 90) {
        c.shootT -= dt;
        if (c.shootT <= 0) { c.shootT = 0.18; this.fire(h.x, h.y, h.z + 0.5, s, 0.16, 4); }
      }
    }

    // sirena: la unidad más cercana
    let near = Infinity;
    for (const c of this.cars) near = Math.min(near, Math.hypot(c.v.x - s.x, c.v.y - s.y));
    this.sound.setSiren(chasing ? clamp(1 - near / 220, 0, 1) : 0);

    // sprites de los agentes
    let n = 0;
    for (const p of this.cops) {
      if (n >= this.sprites.capacity) break;
      const z = Vehicle.ground(p.x, p.y);
      if (!p.alive) { this.sprites.set(n++, p.x, p.y, z + 0.02, 1.8, 0.9, this.rects.cop_down); continue; }
      const away = Math.sin(p.a) * Math.sin(camA) + Math.cos(p.a) * Math.cos(camA) > 0;
      const moving = Math.hypot(p.vx, p.vy) > 0.3;
      const name = p.aimT > 0 ? (away ? 'backAim' : 'frontAim') : `${away ? 'back' : 'front'}${moving ? Math.floor(p.phase) % 2 : 0}`;
      this.sprites.set(n++, p.x, p.y, z, 0.85, 1.75, this.rects[`cop_${name}`]);
    }
    this.sprites.commit(n);
  }
}
