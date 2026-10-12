import type { World, Road } from './map';

export interface RNode {
  x: number;
  y: number;
  out: number[]; // aristas salientes (dirigidas)
  degree: number; // nº de tramos que confluyen (sin contar sentido)
}

export interface REdge {
  id: number;
  from: number;
  to: number;
  pts: Float32Array; // polilínea en el sentido de circulación
  cum: Float32Array; // longitud acumulada por vértice
  len: number;
  road: Road;
  lanes: number;
  twoWay: boolean;
}

export interface EdgePose { x: number; y: number; a: number }

/** Grafo de calles para el tráfico, extraído de la red de OSM. */
export class RoadGraph {
  nodes: RNode[] = [];
  edges: REdge[] = [];
  /** Celdas de 128 m → aristas que pasan por ellas. */
  private grid = new Map<number, number[]>();
  private static CELL = 128;

  constructor(map: World) {
    const count = new Map<string, number>();
    const key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
    const drive = map.roads.filter((r) => r.drive);
    for (const r of drive) {
      const n = r.pts.length / 2;
      for (let i = 0; i < n; i++) {
        const k = key(r.pts[i * 2], r.pts[i * 2 + 1]);
        count.set(k, (count.get(k) || 0) + (i === 0 || i === n - 1 ? 2 : 1));
      }
    }
    const nodeId = new Map<string, number>();
    const getNode = (x: number, y: number) => {
      const k = key(x, y);
      let id = nodeId.get(k);
      if (id === undefined) {
        id = this.nodes.length;
        nodeId.set(k, id);
        this.nodes.push({ x, y, out: [], degree: 0 });
      }
      return id;
    };
    for (const r of drive) {
      const n = r.pts.length / 2;
      let start = 0;
      for (let i = 1; i < n; i++) {
        const k = key(r.pts[i * 2], r.pts[i * 2 + 1]);
        if (i === n - 1 || (count.get(k) || 0) >= 2) {
          const pts = r.pts.slice(start * 2, i * 2 + 2);
          this.addPiece(r, pts, getNode(pts[0], pts[1]), getNode(pts[pts.length - 2], pts[pts.length - 1]));
          start = i;
        }
      }
    }
    const C = RoadGraph.CELL;
    for (const e of this.edges) {
      const seen = new Set<number>();
      for (let k = 0; k < e.pts.length; k += 2) {
        const key = (Math.floor(e.pts[k] / C) + 32768) * 65536 + Math.floor(e.pts[k + 1] / C) + 32768;
        if (seen.has(key)) continue;
        seen.add(key);
        let l = this.grid.get(key);
        if (!l) this.grid.set(key, (l = []));
        l.push(e.id);
      }
    }
  }

  /** Aristas con algún vértice a menos de ~r de (x, y) (sin repetir). */
  edgesNear(x: number, y: number, r: number): number[] {
    const C = RoadGraph.CELL, out = new Set<number>();
    for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++)
      for (let cy = Math.floor((y - r) / C); cy <= Math.floor((y + r) / C); cy++) {
        const l = this.grid.get((cx + 32768) * 65536 + cy + 32768);
        if (l) for (const i of l) out.add(i);
      }
    return [...out];
  }

  private addPiece(road: Road, pts: Float32Array, a: number, b: number) {
    if (a === b) return;
    const lanes = Math.max(1, Math.floor(road.width / (road.oneway ? 3.2 : 6.4)));
    const mk = (p: Float32Array, from: number, to: number) => {
      const n = p.length / 2;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const e: REdge = { id: this.edges.length, from, to, pts: p, cum, len: cum[n - 1], road, lanes, twoWay: !road.oneway };
      if (e.len < 0.5) return;
      this.edges.push(e);
      this.nodes[from].out.push(e.id);
    };
    this.nodes[a].degree++;
    this.nodes[b].degree++;
    mk(pts, a, b);
    if (!road.oneway) {
      const rev = new Float32Array(pts.length);
      const n = pts.length / 2;
      for (let i = 0; i < n; i++) {
        rev[i * 2] = pts[(n - 1 - i) * 2];
        rev[i * 2 + 1] = pts[(n - 1 - i) * 2 + 1];
      }
      mk(rev, b, a);
    }
  }

  /** Posición a distancia s del inicio, desplazada `off` metros a la derecha. */
  pose(e: REdge, s: number, off: number, out: EdgePose): EdgePose {
    const p = e.pts, c = e.cum;
    const n = c.length;
    let i = 1;
    while (i < n - 1 && c[i] < s) i++;
    const seg = c[i] - c[i - 1] || 1e-6;
    const t = Math.max(0, Math.min(1, (s - c[i - 1]) / seg));
    const ax = p[i * 2 - 2], ay = p[i * 2 - 1], bx = p[i * 2], by = p[i * 2 + 1];
    const dx = (bx - ax) / seg, dy = (by - ay) / seg;
    out.x = ax + (bx - ax) * t + dy * off;
    out.y = ay + (by - ay) * t - dx * off;
    out.a = Math.atan2(dx, dy);
    return out;
  }

  /** Desplazamiento lateral (a la derecha del eje) del carril `lane`. */
  laneOffset(e: REdge, lane: number) {
    const w = e.road.width;
    if (e.twoWay) return (w / 2) * ((lane + 0.5) / e.lanes);
    return -w / 2 + (w / e.lanes) * (lane + 0.5);
  }

  /** Arista más cercana a un punto: primero en los alrededores y, si no hay, en toda la ciudad. */
  nearestEdge(x: number, y: number, filter?: (e: REdge) => boolean): { edge: REdge; s: number; d: number } | null {
    for (const r of [150, 600]) {
      const best = this.nearestIn(this.edgesNear(x, y, r).map((i) => this.edges[i]), x, y, filter);
      if (best && best.d < r) return best;
    }
    return this.nearestIn(this.edges, x, y, filter);
  }

  private nearestIn(edges: REdge[], x: number, y: number, filter?: (e: REdge) => boolean) {
    let best: { edge: REdge; s: number; d: number } | null = null;
    for (const e of edges) {
      if (filter && !filter(e)) continue;
      const p = e.pts;
      for (let i = 0; i < p.length / 2 - 1; i++) {
        const ax = p[i * 2], ay = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dy = p[i * 2 + 3] - ay;
        const l2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
        if (!best || d < best.d) best = { edge: e, s: e.cum[i] + Math.sqrt(l2) * t, d };
      }
    }
    return best;
  }
}

/** Índice para saber en qué calle estás (nombre más cercano). */
export class StreetIndex {
  private cell = 32;
  private grid = new Map<number, number[]>();
  private segs: number[] = []; // x1,y1,x2,y2,name

  constructor(map: World) {
    for (const r of map.roads) {
      if (r.name < 0 || r.cls === 'footway' || r.cls === 'cycleway' || r.cls === 'steps' || r.cls === 'path') continue;
      for (let i = 0; i < r.pts.length / 2 - 1; i++) {
        const id = this.segs.length / 5;
        const x1 = r.pts[i * 2], y1 = r.pts[i * 2 + 1], x2 = r.pts[i * 2 + 2], y2 = r.pts[i * 2 + 3];
        this.segs.push(x1, y1, x2, y2, r.name);
        const c = this.cell;
        for (let cx = Math.floor(Math.min(x1, x2) / c); cx <= Math.floor(Math.max(x1, x2) / c); cx++)
          for (let cy = Math.floor(Math.min(y1, y2) / c); cy <= Math.floor(Math.max(y1, y2) / c); cy++) {
            const k = (cx + 32768) * 65536 + cy + 32768;
            let l = this.grid.get(k);
            if (!l) this.grid.set(k, (l = []));
            l.push(id);
          }
      }
    }
  }

  /** Nombre de la calle más cercana (o -1). `heading` favorece la calle alineada con la marcha. */
  nearest(x: number, y: number, heading?: number, maxD = 22): number {
    const c = this.cell, s = this.segs;
    let best = -1, bestScore = Infinity;
    for (let cx = Math.floor((x - maxD) / c); cx <= Math.floor((x + maxD) / c); cx++)
      for (let cy = Math.floor((y - maxD) / c); cy <= Math.floor((y + maxD) / c); cy++) {
        const l = this.grid.get((cx + 32768) * 65536 + cy + 32768);
        if (!l) continue;
        for (const i of l) {
          const ax = s[i * 5], ay = s[i * 5 + 1], dx = s[i * 5 + 2] - ax, dy = s[i * 5 + 3] - ay;
          const l2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
          const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
          if (d > maxD) continue;
          let score = d;
          if (heading !== undefined) {
            const align = Math.abs((dx * Math.sin(heading) + dy * Math.cos(heading)) / Math.sqrt(l2));
            score += (1 - align) * 8;
          }
          if (score < bestScore) { bestScore = score; best = s[i * 5 + 4]; }
        }
      }
    return best;
  }
}
