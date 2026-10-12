import * as THREE from 'three';
import type { RoadGraph, REdge, EdgePose } from '../roads';
import { Vehicle } from './vehicle';
import { BODY_COLORS, type ModelKind } from '../render/cars';
import { angDiff } from '../geom';

const SPEED: Record<string, number> = {
  trunk: 17, primary: 15, secondary: 14, tertiary: 13, residential: 11, unclassified: 10, living_street: 6, service: 6,
};

export interface AICar {
  v: Vehicle;
  edge: REdge;
  next: REdge | null;
  prev: REdge | null;
  s: number;
  lane: number;
  speed: number;
  cruise: number;
  stuck: number;
  ghost: number;
  stun: number;
  honk: number;
}

const tmpA: EdgePose = { x: 0, y: 0, a: 0 }, tmpB: EdgePose = { x: 0, y: 0, a: 0 }, tmpC: EdgePose = { x: 0, y: 0, a: 0 };

/** Tráfico que circula por el grafo de calles de OSM respetando los sentidos únicos. */
export class Traffic {
  cars: AICar[] = [];
  private mid: Float32Array;
  onHonk?: (x: number, y: number) => void;

  constructor(private graph: RoadGraph, private scene: THREE.Object3D, public max: number) {
    this.mid = new Float32Array(graph.edges.length * 2);
    graph.edges.forEach((e, i) => {
      const p = graph.pose(e, e.len / 2, 0, tmpA);
      this.mid[i * 2] = p.x;
      this.mid[i * 2 + 1] = p.y;
    });
  }

  private pickNext(e: REdge): REdge | null {
    const node = this.graph.nodes[e.to];
    const opts = node.out.map((i) => this.graph.edges[i]).filter((n) => !(n.to === e.from && n.road === e.road));
    if (!opts.length) {
      const back = node.out.map((i) => this.graph.edges[i]);
      return back.length ? back[Math.floor(Math.random() * back.length)] : null;
    }
    // preferimos seguir recto
    const endA = this.graph.pose(e, e.len, 0, tmpA).a;
    const w = opts.map((n) => {
      const d = Math.abs(angDiff(endA, this.graph.pose(n, 0, 0, tmpB).a));
      return d < 0.4 ? 3 : d < 2.0 ? 1 : 0.2;
    });
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) if ((r -= w[i]) <= 0) return opts[i];
    return opts[0];
  }

  private spawn(px: number, py: number, fx: number, fy: number) {
    const E = this.graph.edges;
    for (let tries = 0; tries < 40; tries++) {
      const i = Math.floor(Math.random() * E.length);
      const dx = this.mid[i * 2] - px, dy = this.mid[i * 2 + 1] - py;
      const d = Math.hypot(dx, dy);
      if (d < 70 || d > 260) continue;
      if (d < 160 && (dx * fx + dy * fy) / d > 0.3) continue; // no aparecer delante de la cámara
      const e = E[i];
      if (!SPEED[e.road.cls] || e.len < 12) continue;
      const s = e.len / 2;
      if (this.cars.some((c) => c.edge === e && Math.abs(c.s - s) < 14)) continue;
      const big = e.road.cls === 'primary' || e.road.cls === 'secondary' || e.road.cls === 'tertiary';
      const r = Math.random();
      const kind: ModelKind = big && r < 0.08 ? 'bus' : r < 0.32 ? 'taxi' : r < 0.44 ? 'van' : 'sedan';
      const color = kind === 'taxi' ? '#18161e' : kind === 'bus' ? '#d8202a' : kind === 'van' ? (Math.random() < 0.7 ? '#eeeeee' : '#3a6ad8') : BODY_COLORS[Math.floor(Math.random() * BODY_COLORS.length)];
      const v = new Vehicle(kind, color);
      const cruise = SPEED[e.road.cls] * (0.85 + Math.random() * 0.3) * (kind === 'bus' ? 0.75 : 1);
      const car: AICar = { v, edge: e, next: null, prev: null, s, lane: Math.floor(Math.random() * e.lanes), speed: cruise * 0.8, cruise, stuck: 0, ghost: 0, stun: 0, honk: 0 };
      car.next = this.pickNext(e);
      this.place(car, 0);
      this.cars.push(car);
      this.scene.add(v.mesh);
      return;
    }
  }

  private remove(i: number) {
    this.scene.remove(this.cars[i].v.mesh);
    this.cars.splice(i, 1);
  }

  /** Posición con curvas suavizadas (Bézier) al pasar de un tramo al siguiente. */
  private place(c: AICar, dt: number) {
    const g = this.graph;
    const off = (e: REdge) => g.laneOffset(e, Math.min(c.lane, e.lanes - 1));
    const R = (a: REdge, b: REdge) => Math.min(9, a.len / 2, b.len / 2);
    let p: EdgePose;
    if (c.next && c.s > c.edge.len - R(c.edge, c.next)) {
      p = this.bezier(c.edge, c.next, R(c.edge, c.next), (c.s - (c.edge.len - R(c.edge, c.next))) / (2 * R(c.edge, c.next)), off);
    } else if (c.prev && c.s < R(c.prev, c.edge)) {
      p = this.bezier(c.prev, c.edge, R(c.prev, c.edge), 0.5 + c.s / (2 * R(c.prev, c.edge)), off);
    } else p = g.pose(c.edge, c.s, off(c.edge), tmpA);
    const v = c.v;
    const vx = (p.x - v.x) / (dt || 1), vy = (p.y - v.y) / (dt || 1);
    v.x = p.x;
    v.y = p.y;
    if (dt) { v.vx = vx; v.vy = vy; }
    v.a = p.a;
  }

  private bezier(a: REdge, b: REdge, R: number, t: number, off: (e: REdge) => number): EdgePose {
    const g = this.graph;
    const A = g.pose(a, a.len - R, off(a), tmpA);
    const ax = A.x, ay = A.y;
    const E1 = g.pose(a, a.len, off(a), tmpB);
    const e1x = E1.x, e1y = E1.y;
    const S2 = g.pose(b, 0, off(b), tmpB);
    const cx = (e1x + S2.x) / 2, cy = (e1y + S2.y) / 2;
    const B = g.pose(b, R, off(b), tmpC);
    const u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * B.x;
    const y = u * u * ay + 2 * u * t * cy + t * t * B.y;
    const dx = 2 * u * (cx - ax) + 2 * t * (B.x - cx);
    const dy = 2 * u * (cy - ay) + 2 * t * (B.y - cy);
    tmpA.x = x; tmpA.y = y; tmpA.a = Math.atan2(dx, dy);
    return tmpA;
  }

  update(dt: number, player: Vehicle | null, px: number, py: number, heading: number) {
    const fx = Math.sin(heading), fy = Math.cos(heading);
    for (let i = this.cars.length - 1; i >= 0; i--)
      if (Math.hypot(this.cars[i].v.x - px, this.cars[i].v.y - py) > 330) this.remove(i);
    for (let n = 0; n < 3 && this.cars.length < this.max; n++) this.spawn(px, py, fx, fy);

    for (const c of this.cars) {
      const v = c.v;
      if (c.stun > 0) { c.stun -= dt; c.speed = 0; c.honk -= dt; continue; }
      let target = c.cruise;
      // curvas: frenar antes de girar
      if (c.next) {
        const turn = Math.abs(angDiff(this.graph.pose(c.edge, c.edge.len, 0, tmpA).a, this.graph.pose(c.next, 0, 0, tmpB).a));
        const toEnd = c.edge.len - c.s;
        if (turn > 0.5 && toEnd < 25) target = Math.min(target, 5 + toEnd * 0.35);
      }
      // distancia de seguridad con el de delante (incluido el jugador)
      const vfx = Math.sin(v.a), vfy = Math.cos(v.a);
      const look = 6 + c.speed * 1.4 + v.length / 2;
      let blocked = false;
      const check = (o: Vehicle) => {
        if (o === v) return;
        const dx = o.x - v.x, dy = o.y - v.y;
        if (Math.abs(dx) > look + 8 || Math.abs(dy) > look + 8) return;
        const ahead = dx * vfx + dy * vfy;
        const lat = Math.abs(dx * vfy - dy * vfx);
        const gap = ahead - (v.length + o.length) / 2;
        if (ahead > 0 && gap < look && lat < 2.2) {
          target = Math.min(target, Math.max(0, (gap - 2) * 0.9));
          if (o === player && gap < 6) blocked = true;
        }
      };
      if (c.ghost <= 0) {
        for (const o of this.cars) check(o.v);
        if (player) check(player);
      } else c.ghost -= dt;
      c.speed += Math.max(-14 * dt, Math.min(4 * dt, target - c.speed));
      if (c.speed < 0.3) {
        c.stuck += dt;
        if (c.stuck > 5) { c.ghost = 2; c.stuck = 0; }
      } else c.stuck = 0;
      c.honk -= dt;
      if (blocked && c.speed < 1 && c.honk <= 0) {
        c.honk = 2.5 + Math.random() * 3;
        this.onHonk?.(v.x, v.y);
      }

      c.s += c.speed * dt;
      while (c.s > c.edge.len) {
        c.s -= c.edge.len;
        c.prev = c.edge;
        if (!c.next) { c.next = this.pickNext(c.edge); if (!c.next) { c.s = 0; break; } }
        c.edge = c.next;
        c.lane = Math.min(c.lane, c.edge.lanes - 1);
        c.next = this.pickNext(c.edge);
      }
      this.place(c, dt);
      v.syncMesh();
    }
  }
}
