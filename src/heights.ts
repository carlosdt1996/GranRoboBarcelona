import type { Building, Tile, TileListener, World } from './map';

const RES = 2; // metros por celda

interface Raster { ox: number; oy: number; n: number; top: Float32Array }

/**
 * Altura de las azoteas en una rejilla de 2 m por tesela (rasterizando las huellas de los edificios).
 * El helicóptero la usa para chocar con los edificios y posarse en los tejados.
 */
export class RoofMap implements TileListener {
  private rasters = new Map<string, Raster>();
  private tiles = new Map<string, Tile>();

  constructor(private world: World) {
    world.listen(this);
  }

  tileLoaded(t: Tile) {
    const S = this.world.tileSize, n = S / RES;
    const r: Raster = { ox: t.tx * S, oy: t.ty * S, n, top: new Float32Array(n * n) };
    this.tiles.set(t.key, t);
    this.rasters.set(t.key, r);
    // los edificios de esta tesela y los de las vecinas que asoman a ella
    for (const o of this.tiles.values()) {
      if (o.maxX < r.ox || o.minX > r.ox + S || o.maxY < r.oy || o.minY > r.oy + S) continue;
      for (const b of o.buildings) if (b.maxX >= r.ox && b.minX <= r.ox + S && b.maxY >= r.oy && b.minY <= r.oy + S) this.fill(b, r);
    }
    // y los de esta que asoman a las vecinas ya cargadas
    for (const [k, o] of this.rasters) {
      if (k === t.key) continue;
      for (const b of t.buildings) if (b.maxX >= o.ox && b.minX <= o.ox + S && b.maxY >= o.oy && b.minY <= o.oy + S) this.fill(b, o);
    }
  }

  tileUnloaded(t: Tile) {
    this.tiles.delete(t.key);
    this.rasters.delete(t.key);
  }

  /** Rellena la huella (par-impar, con patios) con la cota de la azotea. */
  private fill(b: Building, r: Raster) {
    const top = b.ground + b.height;
    const j0 = Math.max(0, Math.floor((b.minY - r.oy) / RES)), j1 = Math.min(r.n - 1, Math.floor((b.maxY - r.oy) / RES));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const y = r.oy + (j + 0.5) * RES;
      xs.length = 0;
      for (const ring of b.rings) {
        const n = ring.length / 2;
        for (let i = 0, k = n - 1; i < n; k = i++) {
          const yi = ring[i * 2 + 1], yk = ring[k * 2 + 1];
          if (yi > y === yk > y) continue;
          xs.push(ring[i * 2] + ((y - yi) / (yk - yi)) * (ring[k * 2] - ring[i * 2]));
        }
      }
      xs.sort((a, c) => a - c);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - r.ox) / RES - 0.5)), i1 = Math.min(r.n - 1, Math.floor((xs[q + 1] - r.ox) / RES - 0.5));
        for (let i = i0; i <= i1; i++) {
          const o = j * r.n + i;
          if (top > r.top[o]) r.top[o] = top;
        }
      }
    }
  }

  /** Cota de la azotea en (x, y), o 0 si no hay edificio. */
  roof(x: number, y: number) {
    const S = this.world.tileSize;
    const r = this.rasters.get(`${Math.floor(x / S)},${Math.floor(y / S)}`);
    if (!r) return 0;
    const i = Math.floor((x - r.ox) / RES), j = Math.floor((y - r.oy) / RES);
    return r.top[j * r.n + i] || 0;
  }

  /** Lo más alto bajo (x, y): el terreno o una azotea. */
  surface(x: number, y: number) {
    return Math.max(this.world.terrain.at(x, y), this.roof(x, y));
  }
}
