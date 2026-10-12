/**
 * Relieve de la ciudad: rejilla regular de alturas (metros) generada por tools/build_city.py.
 * La interpolación es por triángulos, partiendo cada celda por la misma diagonal que usa la
 * malla del suelo (render/ground.ts), para que coches, árboles y edificios apoyen exactamente.
 */
export class Terrain {
  constructor(
    readonly nx: number,
    readonly ny: number,
    readonly res: number,
    readonly x0: number,
    readonly y0: number,
    readonly h: Float32Array,
  ) {}

  static async load(url: string, meta: { nx: number; ny: number; res: number; x0: number; y0: number }) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo cargar ${url}: ${res.status}`);
    const raw = new Int16Array(await res.arrayBuffer());
    const h = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) h[i] = raw[i] / 10;
    return new Terrain(meta.nx, meta.ny, meta.res, meta.x0, meta.y0, h);
  }

  /** Altura de un vértice de la rejilla (con los bordes extendidos). */
  node(i: number, j: number) {
    i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
    j = j < 0 ? 0 : j >= this.ny ? this.ny - 1 : j;
    return this.h[j * this.nx + i];
  }

  /** Altura del suelo en (x, y). Diagonal de cada celda: de (i, j) a (i+1, j+1). */
  at(x: number, y: number) {
    const fx = (x - this.x0) / this.res, fy = (y - this.y0) / this.res;
    const i = Math.floor(fx), j = Math.floor(fy);
    const u = fx - i, v = fy - j;
    const h00 = this.node(i, j), h11 = this.node(i + 1, j + 1);
    if (u >= v) return h00 + (this.node(i + 1, j) - h00) * u + (h11 - this.node(i + 1, j)) * v;
    return h00 + (this.node(i, j + 1) - h00) * v + (h11 - this.node(i, j + 1)) * u;
  }
}
