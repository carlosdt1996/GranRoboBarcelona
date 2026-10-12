import type { RoadGraph, REdge, EdgePose } from '../roads';
import type { Billboards } from '../render/billboards';
import type { SpriteRect } from '../render/textures';
import { Vehicle } from './vehicle';
import type { WallGrid } from '../collision';

interface Ped {
  edge: REdge;
  dir: 1 | -1;
  s: number;
  side: number; // metros a la derecha del sentido de la marcha
  speed: number;
  variant: number;
  x: number;
  y: number;
  a: number;
  phase: number;
  // atropellado
  hit: boolean;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  t: number;
  /** Fuera de la acera, corriendo a campo través (pánico o conductor que huye). */
  loose: boolean;
  /** Segundos de pánico que le quedan. */
  fear: number;
  fvx: number;
  fvy: number;
}

const tmp: EdgePose = { x: 0, y: 0, a: 0 };

/** Peatones paseando por las aceras (sprites escalados). */
export class Peds {
  peds: Ped[] = [];
  private incident: number[][];
  private near: number[] = [];
  private nearAt = { x: Infinity, y: Infinity };
  onHit?: (x: number, y: number, speed: number, car: Vehicle) => void;

  private push: [number, number] = [0, 0];

  constructor(private graph: RoadGraph, private sprites: Billboards, private rects: Record<string, SpriteRect>, public max: number, private walls: WallGrid) {
    this.incident = graph.nodes.map(() => []);
    graph.edges.forEach((e) => {
      if (e.twoWay && e.from > e.to) return;
      this.incident[e.from].push(e.id);
      this.incident[e.to].push(e.id);
    });
  }

  private spawn(px: number, py: number) {
    const E = this.graph.edges;
    if (Math.hypot(px - this.nearAt.x, py - this.nearAt.y) > 30) {
      this.near = this.graph.edgesNear(px, py, 190);
      this.nearAt = { x: px, y: py };
    }
    if (!this.near.length) return;
    for (let t = 0; t < 20; t++) {
      const e = E[this.near[Math.floor(Math.random() * this.near.length)]];
      if (e.twoWay && e.from > e.to) continue;
      const n = this.graph.nodes[e.from];
      const d = Math.hypot(n.x - px, n.y - py);
      if (d < 40 || d > 170 || e.road.cls === 'service') continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const ped: Ped = {
        edge: e, dir, s: Math.random() * e.len, side: (Math.random() < 0.5 ? 1 : -1) * (e.road.width / 2 + 1.6 + Math.random() * 1.6),
        speed: 1.1 + Math.random() * 0.6, variant: Math.floor(Math.random() * 8), x: 0, y: 0, a: 0, phase: Math.random(),
        hit: false, vx: 0, vy: 0, z: 0, vz: 0, t: 0, loose: false, fear: 0, fvx: 0, fvy: 0,
      };
      this.place(ped);
      this.peds.push(ped);
      return;
    }
  }

  /** Todos los que estén a menos de `r` de (x, y) salen corriendo en dirección contraria. */
  panic(x: number, y: number, r: number) {
    for (const p of this.peds) {
      if (p.hit) continue;
      const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
      if (d > r) continue;
      this.scare(p, dx / (d || 1), dy / (d || 1));
    }
  }

  private scare(p: Ped, dx: number, dy: number) {
    const a = Math.atan2(dx, dy) + (Math.random() - 0.5) * 1.2;
    p.loose = true;
    p.fear = 5 + Math.random() * 4;
    p.fvx = Math.sin(a);
    p.fvy = Math.cos(a);
  }

  /** Un conductor al que le roban el coche (o que lo abandona): sale corriendo. */
  spawnFleeing(x: number, y: number, fromX: number, fromY: number) {
    const p: Ped = {
      edge: this.graph.edges[0], dir: 1, s: 0, side: 0, speed: 1.2 + Math.random() * 0.4, variant: Math.floor(Math.random() * 8),
      x, y, a: 0, phase: 0, hit: false, vx: 0, vy: 0, z: 0, vz: 0, t: 0, loose: true, fear: 0, fvx: 0, fvy: 0,
    };
    const dx = x - fromX, dy = y - fromY, d = Math.hypot(dx, dy) || 1;
    this.scare(p, dx / d, dy / d);
    this.peds.push(p);
  }

  /** Primer peatón (en pie) que cruza el rayo; t = distancia. */
  raycast(ox: number, oy: number, dx: number, dy: number, range: number): { p: Ped; t: number } | null {
    let best: { p: Ped; t: number } | null = null;
    for (const p of this.peds) {
      if (p.hit) continue;
      const rx = p.x - ox, ry = p.y - oy;
      const t = rx * dx + ry * dy;
      if (t < 0 || t > range || Math.abs(rx * dy - ry * dx) > 0.5) continue;
      if (!best || t < best.t) best = { p, t };
    }
    return best;
  }

  /** Lo tumba (bala o explosión) con un empujón en la dirección (dx, dy). */
  knock(p: Ped, dx: number, dy: number, k: number) {
    p.hit = true;
    p.vx = dx * k;
    p.vy = dy * k;
    p.vz = 1.5 + k * 0.3;
    p.z = 0.01;
    p.t = 0;
  }

  private place(p: Ped) {
    const off = p.side * p.dir;
    this.graph.pose(p.edge, p.s, off, tmp);
    p.x = tmp.x;
    p.y = tmp.y;
    p.a = p.dir > 0 ? tmp.a : tmp.a + Math.PI;
  }

  update(dt: number, px: number, py: number, camA: number, cars: Vehicle[]) {
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (Math.hypot(p.x - px, p.y - py) > 210 || (p.hit && p.t > 20)) this.peds.splice(i, 1);
    }
    for (let n = 0; n < 2 && this.peds.length < this.max; n++) this.spawn(px, py);

    for (const p of this.peds) {
      if (p.hit) {
        p.t += dt;
        if (p.z > 0 || p.vz > 0) {
          p.vz -= 22 * dt;
          p.z = Math.max(0, p.z + p.vz * dt);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.z === 0) { p.vx *= 0.3; p.vy *= 0.3; p.vz = 0; }
        }
        continue;
      }
      // atropellos y sustos
      let flee = 0;
      for (const c of cars) {
        const dx = p.x - c.x, dy = p.y - c.y;
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) continue;
        const sp = c.speed;
        const fx = Math.sin(c.a), fy = Math.cos(c.a);
        const along = dx * fx + dy * fy, lat = dx * fy - dy * fx;
        if (Math.abs(along) < c.length / 2 + 0.3 && Math.abs(lat) < c.width / 2 + 0.3 && sp > 2.5) {
          p.hit = true;
          p.vx = c.vx * 0.9 + fy * Math.sign(lat) * 2;
          p.vy = c.vy * 0.9 - fx * Math.sign(lat) * 2;
          p.vz = 3 + sp * 0.18;
          p.z = 0.01;
          this.onHit?.(p.x, p.y, sp, c);
          break;
        }
        if (sp > 8 && along > -2 && along < 14 && Math.abs(lat) < 5) flee = Math.sign(lat) || 1;
      }
      if (p.hit) continue;
      if (p.loose) {
        // a campo través: corre mientras dura el miedo y luego sigue andando; rebota en las paredes
        const sp = p.fear > 0 ? 4.2 : p.speed;
        p.fear -= dt;
        p.phase += dt * sp * 1.6;
        p.x += p.fvx * sp * dt;
        p.y += p.fvy * sp * dt;
        if (this.walls.pushCircle(p.x, p.y, 0.3, this.push)) {
          p.x += this.push[0];
          p.y += this.push[1];
          const n = Math.hypot(this.push[0], this.push[1]) || 1, nx = this.push[0] / n, ny = this.push[1] / n;
          // se desliza a lo largo de la pared
          const dot = p.fvx * nx + p.fvy * ny;
          p.fvx -= nx * dot * 1.2;
          p.fvy -= ny * dot * 1.2;
          const m = Math.hypot(p.fvx, p.fvy) || 1;
          p.fvx /= m; p.fvy /= m;
        }
        p.a = Math.atan2(p.fvx, p.fvy);
        continue;
      }
      const speed = flee ? p.speed * 3 : p.speed;
      if (flee) p.side = Math.max(-1, Math.min(1, Math.sign(p.side))) * Math.min(Math.abs(p.side) + dt * 4, p.edge.road.width / 2 + 4.5);
      p.phase += dt * speed * 1.6;
      p.s += speed * dt * p.dir;
      if (p.s > p.edge.len || p.s < 0) {
        const node = p.dir > 0 ? p.edge.to : p.edge.from;
        const opts = this.incident[node].filter((i) => i !== p.edge.id);
        const e = this.graph.edges[opts.length ? opts[Math.floor(Math.random() * opts.length)] : p.edge.id];
        const keepSide = Math.abs(p.side);
        p.dir = e.from === node ? 1 : -1;
        p.edge = e;
        p.s = p.dir > 0 ? 0 : e.len;
        p.side = Math.sign(p.side) * Math.max(keepSide, e.road.width / 2 + 1.6);
      }
      this.place(p);
    }

    // sprites: de frente o de espaldas según hacia dónde camine respecto a la cámara
    const cfx = Math.sin(camA), cfy = Math.cos(camA);
    let n = 0;
    for (const p of this.peds) {
      if (n >= this.sprites.capacity) break;
      const away = Math.sin(p.a) * cfx + Math.cos(p.a) * cfy > 0;
      const frame = (away ? 2 : 0) + (p.hit ? 0 : Math.floor(p.phase) % 2);
      const r = this.rects[`ped${p.variant}_${frame}`];
      const gz = Vehicle.ground(p.x, p.y);
      if (p.hit && p.z === 0) this.sprites.set(n++, p.x, p.y, gz + 0.02, 1.8, 0.9, this.rects[`ped${p.variant}_down`]); // en el suelo
      else this.sprites.set(n++, p.x, p.y, gz + p.z, 0.85, 1.75, r);
    }
    this.sprites.commit(n);
  }
}
