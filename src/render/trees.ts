import * as THREE from 'three';
import { hash, type Area, type Tile, type TileListener, type World } from '../map';
import { pointInRing, rng } from '../geom';
import type { RoadGraph } from '../roads';
import { Billboards } from './billboards';
import type { SpriteAtlas } from './textures';

/** Árboles por m² que se siembran dentro de cada tipo de zona verde (OSM solo tiene los de la calle). */
const DENSITY: Record<string, number> = { forest: 1 / 110, park: 1 / 380, garden: 1 / 700, grave: 1 / 500 };
const MAX_SOWN = 6000;

function inArea(a: Area, x: number, y: number) {
  if (!pointInRing(x, y, a.rings[0])) return false;
  for (let i = 1; i < a.rings.length; i++) if (pointInRing(x, y, a.rings[i])) return false;
  return true;
}

/**
 * Árboles: los de la calle de OSM (plátanos de sombra y alguna palmera, que esto es OutRun) y
 * pinos y encinas sembrados en parques y bosques (Montjuïc, Collserola). Un lote por tesela.
 */
export class Trees implements TileListener {
  readonly group = new THREE.Group();
  private byTile = new Map<string, Billboards>();

  constructor(private world: World, private atlas: SpriteAtlas, private graph: RoadGraph) {
    world.listen(this);
  }

  tileLoaded(t: Tile) {
    const T = this.world.terrain, R = this.atlas.rects;
    const items: [number, number, number, number, string, boolean][] = []; // x, y, w, h, sprite, espejo
    for (let i = 0; i < t.trees.length; i += 2) {
      const x = t.trees[i], y = t.trees[i + 1];
      const id = Math.round(x * 10) * 31 + Math.round(y * 10);
      const palm = hash(id * 31 + 7) < 0.07;
      const s = 0.8 + hash(id * 17 + 3) * 0.45;
      items.push([x, y, (palm ? 6 : 8) * s, (palm ? 11 : 10.5) * s, palm ? 'palm' : 'platan', hash(id) < 0.5]);
    }
    const r = rng(t.tx * 7919 + t.ty * 104729);
    const clear = this.roadMask(t);
    for (const a of t.areas) {
      const dens = DENSITY[a.kind];
      if (!dens) continue;
      const w = a.maxX - a.minX, h = a.maxY - a.minY;
      const n = Math.min(MAX_SOWN, Math.round(w * h * dens));
      for (let k = 0; k < n && items.length < MAX_SOWN + t.trees.length / 2; k++) {
        const x = a.minX + r() * w, y = a.minY + r() * h;
        if (!inArea(a, x, y) || clear(x, y)) continue;
        const s = 0.75 + r() * 0.55, kind = r() < (a.kind === 'forest' ? 0.55 : 0.7) ? 'pine' : 'oak';
        items.push([x, y, 8.5 * s, (kind === 'pine' ? 11.5 : 9.5) * s, kind, r() < 0.5]);
      }
    }
    if (!items.length) return;
    const bb = new Billboards(this.atlas, items.length);
    items.forEach(([x, y, w, h, kind, flip], i) => bb.set(i, x, y, T.at(x, y), w, h, R[kind], flip));
    bb.commit(items.length);
    this.byTile.set(t.key, bb);
    this.group.add(bb.mesh);
  }

  /** ¿(x, y) cae sobre una calle o camino? (para no sembrar árboles en la calzada) */
  private roadMask(t: Tile) {
    const C = 16, grid = new Map<number, number[]>(), segs: number[] = [];
    const add = (p: Float32Array, half: number) => {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const id = segs.length / 5;
        segs.push(p[i], p[i + 1], p[i + 2], p[i + 3], half);
        for (let cx = Math.floor((Math.min(p[i], p[i + 2]) - half) / C); cx <= Math.floor((Math.max(p[i], p[i + 2]) + half) / C); cx++)
          for (let cy = Math.floor((Math.min(p[i + 1], p[i + 3]) - half) / C); cy <= Math.floor((Math.max(p[i + 1], p[i + 3]) + half) / C); cy++) {
            const k = cx * 65536 + cy;
            let l = grid.get(k);
            if (!l) grid.set(k, (l = []));
            l.push(id);
          }
      }
    };
    const S = this.world.tileSize;
    for (const i of this.graph.edgesNear((t.tx + 0.5) * S, (t.ty + 0.5) * S, S * 0.75)) {
      const e = this.graph.edges[i];
      add(e.pts, e.road.width / 2 + 2.5);
    }
    for (const w of t.paths) add(w.pts, w.width / 2 + 1);
    return (x: number, y: number) => {
      const l = grid.get(Math.floor(x / C) * 65536 + Math.floor(y / C));
      if (l) for (const id of l) {
        const ax = segs[id * 5], ay = segs[id * 5 + 1], dx = segs[id * 5 + 2] - ax, dy = segs[id * 5 + 3] - ay;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(ax + dx * u - x, ay + dy * u - y) < segs[id * 5 + 4]) return true;
      }
      return false;
    };
  }

  tileUnloaded(t: Tile) {
    const bb = this.byTile.get(t.key);
    if (!bb) return;
    this.group.remove(bb.mesh);
    bb.dispose();
    this.byTile.delete(t.key);
  }
}
