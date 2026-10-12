import type { RoadGraph, REdge, EdgePose } from '../roads';
import type { Billboards } from '../render/billboards';
import type { SpriteRect } from '../render/textures';
import type { Vehicle } from './vehicle';

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
}

const tmp: EdgePose = { x: 0, y: 0, a: 0 };

/** Peatones paseando por las aceras (sprites escalados). */
export class Peds {
  peds: Ped[] = [];
  private incident: number[][];
  onHit?: (x: number, y: number, speed: number) => void;

  constructor(private graph: RoadGraph, private sprites: Billboards, private rects: Record<string, SpriteRect>, public max: number) {
    this.incident = graph.nodes.map(() => []);
    graph.edges.forEach((e) => {
      if (e.twoWay && e.from > e.to) return;
      this.incident[e.from].push(e.id);
      this.incident[e.to].push(e.id);
    });
  }

  private spawn(px: number, py: number) {
    const E = this.graph.edges;
    for (let t = 0; t < 20; t++) {
      const e = E[Math.floor(Math.random() * E.length)];
      if (e.twoWay && e.from > e.to) continue;
      const n = this.graph.nodes[e.from];
      const d = Math.hypot(n.x - px, n.y - py);
      if (d < 40 || d > 170 || e.road.cls === 'service') continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const ped: Ped = {
        edge: e, dir, s: Math.random() * e.len, side: (Math.random() < 0.5 ? 1 : -1) * (e.road.width / 2 + 1.6 + Math.random() * 1.6),
        speed: 1.1 + Math.random() * 0.6, variant: Math.floor(Math.random() * 8), x: 0, y: 0, a: 0, phase: Math.random(),
        hit: false, vx: 0, vy: 0, z: 0, vz: 0, t: 0,
      };
      this.place(ped);
      this.peds.push(ped);
      return;
    }
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
      if (Math.hypot(p.x - px, p.y - py) > 210 || (p.hit && p.t > 6)) this.peds.splice(i, 1);
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
          this.onHit?.(p.x, p.y, sp);
          break;
        }
        if (sp > 8 && along > -2 && along < 14 && Math.abs(lat) < 5) flee = Math.sign(lat) || 1;
      }
      if (p.hit) continue;
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
      if (p.hit && p.z === 0) this.sprites.set(n++, p.x, p.y, 0.05, 1.8, 0.6, r); // en el suelo
      else this.sprites.set(n++, p.x, p.y, p.z, 0.85, 1.75, r);
    }
    this.sprites.commit(n);
  }
}
