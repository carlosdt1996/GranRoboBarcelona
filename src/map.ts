// Carga y decodifica el mapa generado por tools/build_map.py.
// Coordenadas en metros: x = este, y = norte (origen en el centro de la zona).

interface RawMap {
  zone: string;
  origin: [number, number];
  bounds: [number, number, number, number];
  attribution: string;
  names: string[];
  buildings: { h: number; m: number; n: number; r: number[][] }[];
  roads: { c: string; w: number; o: number; d: number; n: number; p: number[] }[];
  areas: { k: string; r: number[][] }[];
  trees: number[];
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export interface Building extends BBox {
  height: number;
  minHeight: number;
  name: number;
  rings: Float32Array[]; // [0] exterior CCW, resto huecos CW
  cx: number;
  cy: number;
  seed: number;
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

export interface GameMap {
  zone: string;
  origin: [number, number];
  bounds: BBox;
  attribution: string;
  names: string[];
  buildings: Building[];
  roads: Road[];
  areas: Area[];
  trees: Float32Array;
}

function decode(a: number[]): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] / 10;
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

export async function loadMap(url: string, onProgress?: (f: number) => void): Promise<GameMap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url}: ${res.status}`);
  let raw: RawMap;
  const total = Number(res.headers.get('content-length')) || 0;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    raw = JSON.parse(new TextDecoder().decode(buf));
  } else {
    raw = await res.json();
  }

  const buildings: Building[] = raw.buildings.map((b, i) => {
    const rings = b.r.map(decode);
    const [cx, cy] = centroid(rings[0]);
    return { ...bboxOf(rings[0]), height: b.h, minHeight: b.m, name: b.n, rings, cx, cy, seed: hash(i * 7919 + Math.round(cx * 13)) };
  });
  const roads: Road[] = raw.roads.map((r) => {
    const pts = decode(r.p);
    return { ...bboxOf(pts, r.w), cls: r.c, width: r.w, oneway: !!r.o, drive: !!r.d, name: r.n, pts };
  });
  const areas: Area[] = raw.areas.map((a) => {
    const rings = a.r.map(decode);
    return { ...bboxOf(rings[0]), kind: a.k, rings };
  });
  const [x0, y0, x1, y1] = raw.bounds;
  return {
    zone: raw.zone,
    origin: raw.origin,
    bounds: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    attribution: raw.attribution,
    names: raw.names,
    buildings,
    roads,
    areas,
    trees: decode(raw.trees),
  };
}

/** Hash entero → [0,1) estable. */
export function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Proyección inversa aproximada (metros → lon/lat) y directa. */
export function toLocal(map: GameMap, lon: number, lat: number): [number, number] {
  const [lon0, lat0] = map.origin;
  return [(lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * 110574];
}
