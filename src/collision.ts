import { overlaps, type BBox, type Tile, type TileListener, type World } from './map';

/** Rejilla espacial de segmentos de un trozo del mundo (una tesela o el límite del mapa). */
class SegGrid implements BBox {
  readonly cell = 16;
  segs: number[] = [];
  private grid = new Map<number, number[]>();
  stamp = new Uint32Array(0);
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  private key(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  add(x1: number, y1: number, x2: number, y2: number) {
    const id = this.segs.length / 4;
    this.segs.push(x1, y1, x2, y2);
    this.minX = Math.min(this.minX, x1, x2); this.maxX = Math.max(this.maxX, x1, x2);
    this.minY = Math.min(this.minY, y1, y2); this.maxY = Math.max(this.maxY, y1, y2);
    const c = this.cell;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len / (c / 2)));
    let last = NaN;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const k = this.key(Math.floor((x1 + (x2 - x1) * t) / c), Math.floor((y1 + (y2 - y1) * t) / c));
      if (k === last) continue;
      last = k;
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      if (l[l.length - 1] !== id) l.push(id);
    }
  }

  ring(r: Float32Array) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.add(r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1]);
    }
  }

  done() {
    this.stamp = new Uint32Array(this.segs.length / 4);
    return this;
  }

  forEachNear(minX: number, minY: number, maxX: number, maxY: number, tick: number, fn: (s: number[], i: number) => void) {
    const c = this.cell;
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++)
      for (let cy = Math.floor(minY / c); cy <= Math.floor(maxY / c); cy++) {
        const l = this.grid.get(this.key(cx, cy));
        if (!l) continue;
        for (const i of l) {
          if (this.stamp[i] === tick) continue;
          this.stamp[i] = tick;
          fn(this.segs, i);
        }
      }
  }
}

/**
 * Paredes del mundo: fachadas de los edificios cargados, troncos de árboles y el límite del mapa.
 * Se usa para colisiones círculo-pared y para que la cámara no atraviese edificios.
 */
export class WallGrid implements TileListener {
  private parts = new Map<string, SegGrid>();
  private tick = 0;

  constructor(world: World) {
    const edge = new SegGrid();
    edge.ring(world.boundary);
    this.parts.set('limite', edge.done());
    world.listen(this);
  }

  tileLoaded(t: Tile) {
    const g = new SegGrid();
    for (const b of t.buildings) {
      if (b.minHeight > 2.5) continue; // partes elevadas (voladizos, torres sobre otra base)
      for (const r of b.rings) g.ring(r);
    }
    for (let i = 0; i < t.trees.length; i += 2) {
      const x = t.trees[i], y = t.trees[i + 1], r = 0.3;
      g.add(x - r, y - r, x + r, y - r);
      g.add(x + r, y - r, x + r, y + r);
      g.add(x + r, y + r, x - r, y + r);
      g.add(x - r, y + r, x - r, y - r);
    }
    this.parts.set(t.key, g.done());
  }

  tileUnloaded(t: Tile) {
    this.parts.delete(t.key);
  }

  /** Paredes extra (interiores): segmentos x1, y1, x2, y2, ... */
  addPart(key: string, segs: number[]) {
    const g = new SegGrid();
    for (let i = 0; i + 3 < segs.length; i += 4) g.add(segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
    this.parts.set(key, g.done());
  }

  private forEachNear(minX: number, minY: number, maxX: number, maxY: number, fn: (s: number[], i: number) => void) {
    this.tick++;
    if (this.tick === 0xffffffff) { for (const p of this.parts.values()) p.stamp.fill(0); this.tick = 1; }
    const q = { minX, minY, maxX, maxY };
    for (const p of this.parts.values()) if (overlaps(p, q)) p.forEachNear(minX, minY, maxX, maxY, this.tick, fn);
  }

  /** Empuja un círculo fuera de las paredes. Devuelve [px, py] acumulado (0,0 si no toca). */
  pushCircle(x: number, y: number, r: number, out: [number, number]) {
    out[0] = 0;
    out[1] = 0;
    this.forEachNear(x - r, y - r, x + r, y + r, (s, i) => {
      const ax = s[i * 4], ay = s[i * 4 + 1], bx = s[i * 4 + 2], by = s[i * 4 + 3];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy || 1e-9;
      let t = ((x + out[0] - ax) * dx + (y + out[1] - ay) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t, qy = ay + dy * t;
      let nx = x + out[0] - qx, ny = y + out[1] - qy;
      const d = Math.hypot(nx, ny);
      if (d >= r) return;
      if (d < 1e-6) { nx = -dy; ny = dx; } // en la línea: normal del segmento
      const k = (r - d) / (Math.hypot(nx, ny) || 1);
      out[0] += nx * k;
      out[1] += ny * k;
    });
    return out[0] !== 0 || out[1] !== 0;
  }

  /** Fracción [0,1] del rayo libre hasta la primera pared. */
  raycast(x0: number, y0: number, x1: number, y1: number): number {
    let best = 1;
    const rx = x1 - x0, ry = y1 - y0;
    this.forEachNear(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), (s, i) => {
      const ax = s[i * 4], ay = s[i * 4 + 1];
      const sx = s[i * 4 + 2] - ax, sy = s[i * 4 + 3] - ay;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) return;
      const t = ((ax - x0) * sy - (ay - y0) * sx) / den;
      const u = ((ax - x0) * ry - (ay - y0) * rx) / den;
      if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
    });
    return best;
  }
}
