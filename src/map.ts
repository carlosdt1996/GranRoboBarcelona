// Barcelona entera en teselas (generadas por tools/build_city.py) que se cargan alrededor del jugador.
// Coordenadas en metros: x = este, y = norte (origen en el centro de la ciudad).
import { Terrain } from './terrain';
import { fetchBytes } from './net';
import { view } from './view';

interface RawWorld {
  name: string;
  origin: [number, number];
  bounds: [number, number, number, number];
  tile: number;
  attribution: string;
  terrain: { nx: number; ny: number; res: number; x0: number; y0: number };
  boundary: number[];
  city: number[];
  districts: [string, number, number][];
  tiles: [number, number][];
  names: string[];
  roads: { c: string; w: number; o: number; d: number; n: number; p: number[] }[];
}

interface RawTile {
  b: { h: number; m: number; z: number; n: number; r: number[][] }[];
  a: { k: string; r: number[][] }[];
  w: { c: string; w: number; p: number[] }[];
  t: number[];
  /** Fachadas con foto: [edificio, arista, página, u, v, ancho, alto, z0 (dm), x, y]. */
  f?: number[][];
  fp?: number;
}

/** Rectángulo de una fachada fotográfica en el atlas de su tesela (píxeles). */
export interface Photo { page: number; u: number; v: number; w: number; h: number; z0: number }

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export interface Building extends BBox {
  height: number;
  minHeight: number;
  /** Cota del suelo de referencia (común a todas las partes de un edificio). */
  ground: number;
  name: number;
  rings: Float32Array[]; // [0] exterior CCW, resto huecos CW
  cx: number;
  cy: number;
  seed: number;
  /** Fotos de fachada por índice de arista del anillo exterior (tools/build_facades.py). */
  photos?: Map<number, Photo>;
}

export interface Road extends BBox {
  cls: string;
  width: number;
  oneway: boolean;
  drive: boolean;
  name: number;
  pts: Float32Array;
}

export interface Area extends BBox {
  kind: string;
  rings: Float32Array[];
}

export interface Tile extends BBox {
  key: string;
  tx: number;
  ty: number;
  buildings: Building[];
  areas: Area[];
  /** Aceras, caminos y carriles bici (solo se pintan en el suelo). */
  paths: Road[];
  trees: Float32Array;
  /** Páginas del atlas de fachadas (facades/X_Y_P.webp). */
  facadePages: number;
}

export interface TileListener {
  tileLoaded(t: Tile): void;
  tileUnloaded(t: Tile): void;
}

/** Coordenadas con deltas en decímetros → metros absolutos. */
function decode(a: number[], ox = 0, oy = 0): Float32Array {
  const out = new Float32Array(a.length);
  let x = 0, y = 0;
  for (let i = 0; i < a.length; i += 2) {
    x += a[i];
    y += a[i + 1];
    out[i] = ox + x / 10;
    out[i + 1] = oy + y / 10;
  }
  return out;
}

export function bboxOf(pts: Float32Array, pad = 0): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export const overlaps = (a: BBox, b: BBox) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

function centroid(r: Float32Array): [number, number] {
  let a = 0, cx = 0, cy = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = r[i * 2], y0 = r[i * 2 + 1], x1 = r[j * 2], y1 = r[j * 2 + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) return [r[0], r[1]];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Las teselas se cargan hasta 390 m más allá de la vista y se descartan 740 m más allá. */
const MAX_FETCH = 4;

export class World {
  readonly tiles = new Map<string, Tile>();
  readonly tileSize: number;
  readonly bounds: BBox;
  readonly origin: [number, number];
  readonly attribution: string;
  readonly names: string[];
  readonly roads: Road[];
  /** Límite jugable (término municipal con un margen) y el término municipal en sí. */
  readonly boundary: Float32Array;
  readonly city: Float32Array;
  /** Distritos: [nombre, x, y] para el mapa. */
  readonly districts: [string, number, number][];
  private exists = new Set<string>();
  private pending = new Map<string, Promise<void>>();
  private listeners: TileListener[] = [];

  constructor(raw: RawWorld, readonly terrain: Terrain, readonly base: string) {
    this.tileSize = raw.tile;
    const [x0, y0, x1, y1] = raw.bounds;
    this.bounds = { minX: x0, minY: y0, maxX: x1, maxY: y1 };
    this.origin = raw.origin;
    this.attribution = raw.attribution;
    this.names = raw.names;
    this.boundary = decode(raw.boundary);
    this.city = decode(raw.city);
    this.districts = raw.districts;
    for (const [tx, ty] of raw.tiles) this.exists.add(`${tx},${ty}`);
    this.roads = raw.roads.map((r) => {
      const pts = decode(r.p);
      return { ...bboxOf(pts, r.w), cls: r.c, width: r.w, oneway: !!r.o, drive: !!r.d, name: r.n, pts };
    });
  }

  static async load(base: string, onProgress?: (f: number) => void): Promise<World> {
    const raw: RawWorld = await fetchJson(`${base}world.json.gz`, onProgress);
    const terrain = await Terrain.load(`${base}terrain.bin.gz`, raw.terrain);
    return new World(raw, terrain, base);
  }

  listen(l: TileListener) {
    this.listeners.push(l);
    for (const t of this.tiles.values()) l.tileLoaded(t);
  }

  private tileKeysAround(x: number, y: number, r: number) {
    const S = this.tileSize, out: [string, number][] = [];
    for (let tx = Math.floor((x - r) / S); tx <= Math.floor((x + r) / S); tx++)
      for (let ty = Math.floor((y - r) / S); ty <= Math.floor((y + r) / S); ty++) {
        const k = `${tx},${ty}`;
        if (!this.exists.has(k)) continue;
        const d = Math.hypot(Math.max(0, Math.abs((tx + 0.5) * S - x) - S / 2), Math.max(0, Math.abs((ty + 0.5) * S - y) - S / 2));
        if (d <= r) out.push([k, d]);
      }
    return out.sort((a, b) => a[1] - b[1]);
  }

  /** Pide las teselas cercanas y suelta las lejanas. Devuelve cuántas faltan por llegar. */
  update(x: number, y: number) {
    const S = this.tileSize;
    for (const [k, t] of this.tiles) {
      const d = Math.hypot(Math.max(0, Math.abs((t.tx + 0.5) * S - x) - S / 2), Math.max(0, Math.abs((t.ty + 0.5) * S - y) - S / 2));
      if (d > view.r + 740) {
        this.tiles.delete(k);
        for (const l of this.listeners) l.tileUnloaded(t);
      }
    }
    let missing = 0;
    for (const [k] of this.tileKeysAround(x, y, view.r + 390)) {
      if (this.tiles.has(k)) continue;
      missing++;
      if (!this.pending.has(k) && this.pending.size < MAX_FETCH) this.fetchTile(k);
    }
    return missing;
  }

  /** Carga (y espera) todas las teselas en un radio. */
  async preload(x: number, y: number, r: number, onProgress?: (f: number) => void) {
    const keys = this.tileKeysAround(x, y, r).map((k) => k[0]);
    let done = 0;
    await Promise.all(keys.map(async (k) => {
      if (!this.tiles.has(k)) await (this.pending.get(k) ?? this.fetchTile(k));
      onProgress?.(++done / keys.length);
    }));
  }

  private fetchTile(k: string) {
    const p = (async () => {
      try {
        const raw: RawTile = await fetchJson(`${this.base}tiles/${k.replace(',', '_')}.json.gz`);
        if (this.tiles.has(k)) return;
        const t = this.decodeTile(k, raw);
        this.tiles.set(k, t);
        for (const l of this.listeners) l.tileLoaded(t);
      } catch (e) {
        console.warn(`tesela ${k}:`, e);
      } finally {
        this.pending.delete(k);
      }
    })();
    this.pending.set(k, p);
    return p;
  }

  private decodeTile(key: string, raw: RawTile): Tile {
    const [tx, ty] = key.split(',').map(Number);
    const S = this.tileSize, ox = tx * S, oy = ty * S;
    const box = { minX: ox, minY: oy, maxX: ox + S, maxY: oy + S };
    const buildings: Building[] = raw.b.map((b, i) => {
      const rings = b.r.map((r) => decode(r, ox, oy));
      const [cx, cy] = centroid(rings[0]);
      const bb = bboxOf(rings[0]);
      box.minX = Math.min(box.minX, bb.minX); box.maxX = Math.max(box.maxX, bb.maxX);
      box.minY = Math.min(box.minY, bb.minY); box.maxY = Math.max(box.maxY, bb.maxY);
      return { ...bb, height: b.h, minHeight: b.m, ground: b.z, name: b.n, rings, cx, cy, seed: hash(i * 7919 + Math.round(cx * 13) + Math.round(cy * 31) * 3) };
    });
    const areas: Area[] = raw.a.map((a) => {
      const rings = a.r.map((r) => decode(r, ox, oy));
      return { ...bboxOf(rings[0]), kind: a.k, rings };
    });
    const paths: Road[] = raw.w.map((w) => {
      const pts = decode(w.p, ox, oy);
      return { ...bboxOf(pts, w.w), cls: w.c, width: w.w, oneway: false, drive: false, name: -1, pts };
    });
    for (const [bi, ei, page, u, v, w, h, z0] of raw.f ?? []) {
      const b = buildings[bi];
      if (!b) continue;
      (b.photos ??= new Map()).set(ei, { page, u, v, w, h, z0: z0 / 10 });
    }
    const trees = new Float32Array(raw.t.length);
    for (let i = 0; i < raw.t.length; i += 2) {
      trees[i] = ox + raw.t[i] / 10;
      trees[i + 1] = oy + raw.t[i + 1] / 10;
    }
    return { key, tx, ty, ...box, buildings, areas, paths, trees, facadePages: raw.fp ?? 0 };
  }

  /** ¿Están cargadas todas las teselas que pueden tener algo dentro de `b` (más un margen)? */
  ready(b: BBox, pad = 160) {
    const S = this.tileSize;
    for (let tx = Math.floor((b.minX - pad) / S); tx <= Math.floor((b.maxX + pad) / S); tx++)
      for (let ty = Math.floor((b.minY - pad) / S); ty <= Math.floor((b.maxY + pad) / S); ty++) {
        const k = `${tx},${ty}`;
        if (this.exists.has(k) && !this.tiles.has(k)) return false;
      }
    return true;
  }

  /** Teselas cargadas cuyo contenido toca `b`. */
  *tilesIn(b: BBox): Iterable<Tile> {
    for (const t of this.tiles.values()) if (overlaps(t, b)) yield t;
  }

  /** Metros locales ← lon/lat. */
  toLocal(lon: number, lat: number): [number, number] {
    const [lon0, lat0] = this.origin;
    return [(lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * 110574];
  }
}

async function fetchJson<T>(url: string, onProgress?: (f: number) => void): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await fetchBytes(url, onProgress)));
}

/** Hash entero → [0,1) estable. */
export function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
