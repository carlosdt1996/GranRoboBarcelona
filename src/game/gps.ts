import * as THREE from 'three';
import type { RoadGraph, REdge } from '../roads';
import type { Terrain } from '../terrain';
import { canvas } from '../render/textures';
import { glowBlend } from '../daylight';

const SPEED: Record<string, number> = {
  motorway: 25, trunk: 22, primary: 16, secondary: 14, tertiary: 12, residential: 9, unclassified: 8, living_street: 4, service: 4,
};
const WIDTH = 3.2, LIFT = 0.18, ARRIVE = 22, OFF_ROUTE = 28;

/** Montículo binario mínimo para A*. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v, top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < k.length && k[l] < mk) { m = l; mk = k[l]; }
        if (r < k.length && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

/**
 * GPS: ruta por las calles hasta el destino marcado en el mapa (A* sobre el grafo de OSM, respetando
 * los sentidos únicos si vas en coche), pintada en el suelo con flechas, en el radar y en el mapa.
 */
export class Gps {
  target: { x: number; y: number } | null = null;
  /** Polilínea de la ruta (x, y, ...), del jugador al destino. */
  route: Float32Array | null = null;
  readonly group = new THREE.Group();
  private ribbon: THREE.Mesh | null = null;
  private beacon: THREE.Mesh;
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private checkT = 0;
  private onFoot = false;
  private incoming: number[][];
  onArrive?: () => void;

  constructor(private graph: RoadGraph, private terrain: Terrain) {
    // flechas (chevrons) que avanzan hacia el destino
    const [c, x] = canvas(32, 16);
    x.fillStyle = '#c018c8';
    x.fillRect(0, 0, 32, 16);
    x.fillStyle = '#ffe24a';
    for (let i = 0; i < 6; i++) {
      x.fillRect(8 + i, 2 + i, 3, 1);
      x.fillRect(8 + i, 13 - i, 3, 1);
    }
    x.fillRect(14, 7, 3, 2);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.wrapS = THREE.RepeatWrapping;
    this.mat = glowBlend(new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    // columna de luz sobre el destino (se ve desde el helicóptero)
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, 400, 8, 1, true).translate(0, 200, 0),
      glowBlend(new THREE.MeshBasicMaterial({ color: '#ff3cf0', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, fog: false })),
    );
    this.beacon.visible = false;
    this.group.add(this.beacon);
    // aristas que llegan a cada nodo (para ir a pie, en cualquier sentido)
    this.incoming = graph.nodes.map(() => []);
    for (const e of graph.edges) this.incoming[e.to].push(e.id);
  }

  private heading = 0;

  setTarget(x: number, y: number, px: number, py: number, heading: number, onFoot: boolean) {
    this.heading = heading;
    this.target = { x, y };
    this.beacon.position.set(x, this.terrain.at(x, y), -y);
    this.beacon.visible = true;
    this.onFoot = onFoot;
    this.reroute(px, py);
  }

  clear() {
    this.target = null;
    this.route = null;
    this.beacon.visible = false;
    this.setRibbon(null);
  }

  /** A* desde la calle donde estás hasta la calle más cercana al destino. */
  reroute(px: number, py: number) {
    const t = this.target;
    if (!t) return;
    this.route = findRoute(this.graph, this.incoming, px, py, this.heading, t.x, t.y, this.onFoot);
    if (this.route) this.buildRibbon();
    else this.setRibbon(null);
  }

  private setRibbon(m: THREE.Mesh | null) {
    if (this.ribbon) { this.group.remove(this.ribbon); this.ribbon.geometry.dispose(); }
    this.ribbon = m;
    if (m) this.group.add(m);
  }

  /** Cinta sobre el asfalto que sigue el relieve, con las flechas apuntando al destino. */
  private buildRibbon() {
    const r = this.route!;
    const pts: number[] = [];
    for (let i = 0; i + 3 < r.length; i += 2) {
      const ax = r[i], ay = r[i + 1], bx = r[i + 2], by = r[i + 3];
      const L = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(L / 6));
      for (let j = 0; j < k; j++) pts.push(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k);
    }
    pts.push(r[r.length - 2], r[r.length - 1]);
    const n = pts.length / 2;
    const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx: number[] = [];
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], y = pts[i * 2 + 1];
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      let dx = pts[i1 * 2] - pts[i0 * 2], dy = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      if (i > 0) dist += Math.hypot(x - pts[i * 2 - 2], y - pts[i * 2 - 1]);
      for (const [k, side] of [[0, -1], [1, 1]] as const) {
        const vx = x + dy * side * (WIDTH / 2), vy = y - dx * side * (WIDTH / 2);
        const o = (i * 2 + k) * 3;
        pos[o] = vx; pos[o + 1] = this.terrain.at(vx, vy) + LIFT; pos[o + 2] = -vy;
        uv[(i * 2 + k) * 2] = dist / 4;
        uv[(i * 2 + k) * 2 + 1] = k;
      }
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, this.mat);
    m.renderOrder = 2;
    m.frustumCulled = false;
    this.setRibbon(m);
  }

  /** Cada segundo: ¿has llegado? ¿te has salido de la ruta? */
  update(dt: number, px: number, py: number, heading: number, onFoot: boolean, flying: boolean) {
    this.heading = heading;
    this.tex.offset.x -= dt * 1.2;
    if (this.ribbon) this.ribbon.visible = !flying;
    const t = this.target;
    if (!t) return;
    if (Math.hypot(px - t.x, py - t.y) < ARRIVE) { this.clear(); this.onArrive?.(); return; }
    this.checkT -= dt;
    if (this.checkT > 0 || flying) return;
    this.checkT = 1;
    const r = this.route;
    if (onFoot !== this.onFoot || !r || distToPolyline(r, px, py) > OFF_ROUTE) {
      this.onFoot = onFoot;
      this.reroute(px, py);
    }
  }
}

/**
 * Indicaciones: distancia que queda por la ruta y rumbo relativo (radianes, 0 = recto) hacia
 * un punto ~35 m más adelante de la ruta.
 */
export function guidance(r: Float32Array, x: number, y: number, heading: number) {
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i + 3 < r.length; i += 2) {
    const ax = r[i], ay = r[i + 1], dx = r[i + 2] - ax, dy = r[i + 3] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  let left = 0, ahead = 35, lx = r[r.length - 2], ly = r[r.length - 1], found = false;
  for (let i = bi; i + 3 < r.length; i += 2) {
    const ax = r[i], ay = r[i + 1], bx = r[i + 2], by = r[i + 3];
    const L = Math.hypot(bx - ax, by - ay), from = i === bi ? bt * L : 0;
    left += L - from;
    if (!found && L - from >= ahead) {
      const k = (from + ahead) / (L || 1);
      lx = ax + (bx - ax) * k; ly = ay + (by - ay) * k; found = true;
    } else if (!found) ahead -= L - from;
  }
  let rel = Math.atan2(lx - x, ly - y) - heading;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  return { left, rel };
}

/**
 * Ruta por las calles de (px, py) a (tx, ty): A* sobre el grafo de OSM. En coche respeta los sentidos
 * únicos y prefiere las vías rápidas; a pie (`incoming` = aristas que llegan a cada nodo) va en cualquier sentido.
 */
export function findRoute(g: RoadGraph, incoming: number[][] | null, px: number, py: number, heading: number, tx: number, ty: number, onFoot: boolean): Float32Array | null {
  // la calle por la que vas, en el sentido en que vas
  const tmp = { x: 0, y: 0, a: 0 };
  const from = g.nearestEdge(px, py, (e) => Math.cos(g.pose(e, e.len / 2, 0, tmp).a - heading) > 0.2) ?? g.nearestEdge(px, py);
  const to = g.nearestEdge(tx, ty);
  if (!from || !to) return null;
  const n = g.nodes.length;
  const cost = new Float64Array(n).fill(Infinity), via = new Int32Array(n).fill(-1);
  const goal = to.edge.from, start = from.edge.to;
  const h = (i: number) => Math.hypot(g.nodes[i].x - g.nodes[goal].x, g.nodes[i].y - g.nodes[goal].y) / (onFoot ? 1 : 25);
  const edgeCost = (e: REdge) => onFoot ? e.len : e.len / (SPEED[e.road.cls] ?? 6);
  const heap = new Heap();
  cost[start] = 0;
  heap.push(h(start), start);
  let found = start === goal, steps = 0;
  while (heap.size && !found && steps++ < 200000) {
    const u = heap.pop();
    const nexts = onFoot && incoming ? [...g.nodes[u].out, ...incoming[u]] : g.nodes[u].out;
    for (const ei of nexts) {
      const e = g.edges[ei];
      const v = e.from === u ? e.to : e.from;
      const c = cost[u] + edgeCost(e);
      if (c < cost[v]) {
        cost[v] = c;
        via[v] = ei;
        if (v === goal) found = true;
        heap.push(c + h(v), v);
      }
    }
  }
  if (!found) return null;
  // reconstruir: tramo actual + aristas + tramo final
  const chain: number[][] = [];
  for (let v = goal; v !== start;) {
    const e = g.edges[via[v]];
    const fwd = e.to === v;
    const pts = Array.from(e.pts);
    chain.push(fwd ? pts : reversePts(pts));
    v = fwd ? e.from : e.to;
  }
  chain.reverse();
  const out: number[] = [px, py, ...slice(from.edge, from.s, from.edge.len)];
  for (const c of chain) out.push(...c);
  out.push(...slice(to.edge, 0, to.s), tx, ty);
  return dedupe(out);
}

/** Punto de la ruta `ahead` metros por delante del punto más cercano a (x, y). */
export function lookAhead(r: Float32Array, x: number, y: number, ahead: number): [number, number] {
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i + 3 < r.length; i += 2) {
    const ax = r[i], ay = r[i + 1], dx = r[i + 2] - ax, dy = r[i + 3] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  for (let i = bi; i + 3 < r.length; i += 2) {
    const ax = r[i], ay = r[i + 1], bx = r[i + 2], by = r[i + 3];
    const L = Math.hypot(bx - ax, by - ay), from = i === bi ? bt * L : 0;
    if (L - from >= ahead) { const k = (from + ahead) / (L || 1); return [ax + (bx - ax) * k, ay + (by - ay) * k]; }
    ahead -= L - from;
  }
  return [r[r.length - 2], r[r.length - 1]];
}

function reversePts(p: number[]) {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

/** Puntos de la arista entre las distancias s0 y s1 desde su inicio. */
function slice(e: REdge, s0: number, s1: number) {
  const out: number[] = [];
  for (let i = 0; i < e.cum.length; i++) if (e.cum[i] > s0 && e.cum[i] < s1) out.push(e.pts[i * 2], e.pts[i * 2 + 1]);
  return out;
}

function dedupe(a: number[]) {
  const out: number[] = [];
  for (let i = 0; i < a.length; i += 2) {
    const n = out.length;
    if (n && Math.hypot(a[i] - out[n - 2], a[i + 1] - out[n - 1]) < 0.5) continue;
    out.push(a[i], a[i + 1]);
  }
  return new Float32Array(out);
}

export function distToPolyline(r: Float32Array, x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i + 3 < r.length; i += 2) {
    const ax = r[i], ay = r[i + 1], dx = r[i + 2] - ax, dy = r[i + 3] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}
