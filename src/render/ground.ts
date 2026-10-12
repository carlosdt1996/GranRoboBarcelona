import * as THREE from 'three';
import type { Area, BBox, Building, Road, Tile, TileListener, World } from '../map';
import { hash } from '../map';
import type { RoadGraph, REdge } from '../roads';
import { C, SUN_DIR, SUN_ELEVATION } from '../palette';
import { canvas, pixelTexture } from './textures';
import { rng } from '../geom';
import { view } from '../view';
import { passAlpha } from '../daylight';

/** Índice de rejilla genérico: celda → elementos cuyo bbox la toca. */
class CellIndex<T> {
  private m = new Map<number, T[]>();
  constructor(readonly cell: number) {}
  add(b: BBox, item: T) {
    const c = this.cell;
    for (let x = Math.floor(b.minX / c); x <= Math.floor(b.maxX / c); x++)
      for (let y = Math.floor(b.minY / c); y <= Math.floor(b.maxY / c); y++) {
        const k = (x + 32768) * 65536 + y + 32768;
        let l = this.m.get(k);
        if (!l) this.m.set(k, (l = []));
        l.push(item);
      }
  }
  query(b: BBox): T[] {
    const c = this.cell, out = new Set<T>();
    for (let x = Math.floor(b.minX / c); x <= Math.floor((b.maxX - 1e-6) / c); x++)
      for (let y = Math.floor(b.minY / c); y <= Math.floor((b.maxY - 1e-6) / c); y++) {
        const l = this.m.get((x + 32768) * 65536 + y + 32768);
        if (l) for (const i of l) out.add(i);
      }
    return [...out];
  }
}

function tile(size: number, base: string, draw: (x: CanvasRenderingContext2D, r: () => number) => void) {
  const [c, x] = canvas(size, size);
  x.fillStyle = base;
  x.fillRect(0, 0, size, size);
  draw(x, rng(size * 31 + base.length));
  return c;
}

function speckle(x: CanvasRenderingContext2D, r: () => number, n: number, size: number, cols: string[]) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = cols[Math.floor(r() * cols.length)];
    x.fillRect(Math.floor(r() * size), Math.floor(r() * size), 1, 1);
  }
}

const NEAR = 64, NEAR_PX = 4, NEAR_R = 210, NEAR_DROP = 290;
const FAR = 256, FAR_PX = 1;
const SHADOW_K = 1 / Math.tan(SUN_ELEVATION);
const AREA_ORDER = ['farm', 'forest', 'grass', 'park', 'garden', 'grave', 'plaza', 'pitch', 'sand', 'sea', 'water', 'pool'];

interface Chunk { mesh: THREE.Mesh; tex: THREE.Texture }

/** Lo que el suelo necesita de cada tesela, indexado por celdas. */
interface TileIdx extends BBox {
  areas: CellIndex<Area>;
  paths: CellIndex<Road>;
  shadows: CellIndex<Building>;
  trees: CellIndex<number>;
  treePts: Float32Array;
}

/**
 * Suelo en trozos dibujados con Canvas 2D (aceras de panot, asfalto, pasos de cebra, parques,
 * mar y sombras) y extendidos sobre el relieve.
 */
export class Ground implements TileListener {
  readonly group = new THREE.Group();
  private tiles = new Map<string, TileIdx>();
  private roads = new CellIndex<number>(64);
  private edges = new CellIndex<number>(64);
  private nodeR: Float32Array;
  private near = new Map<string, Chunk>();
  private far = new Map<string, Chunk>();
  private tex: Record<string, HTMLCanvasElement>;
  private outside: THREE.Mesh;
  /** De noche (>0.5): sin sombras del sol y con farolas (los trozos nuevos se pintan así). */
  night = 0;

  constructor(private map: World, private graph: RoadGraph) {
    map.roads.forEach((r, i) => { if (!r.drive) this.roads.add(r, i); });
    graph.edges.forEach((e, i) => {
      if (e.twoWay && e.from > e.to) return; // cada tramo una vez
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < e.pts.length; k += 2) {
        minX = Math.min(minX, e.pts[k]); maxX = Math.max(maxX, e.pts[k]);
        minY = Math.min(minY, e.pts[k + 1]); maxY = Math.max(maxY, e.pts[k + 1]);
      }
      const p = e.road.width;
      this.edges.add({ minX: minX - p, minY: minY - p, maxX: maxX + p, maxY: maxY + p }, i);
    });
    // radio de la "plaza" asfaltada de cada cruce (los chaflanes del Eixample)
    this.nodeR = new Float32Array(graph.nodes.length);
    for (const e of graph.edges) {
      for (const n of [e.from, e.to])
        if (graph.nodes[n].degree >= 3) this.nodeR[n] = Math.max(this.nodeR[n], e.road.width * 0.72);
    }

    this.tex = {
      sidewalk: tile(16, C.sidewalk, (x) => {
        // panot de flor (simplificado): 4 px = 1 m
        for (let i = 0; i < 16; i += 4)
          for (let j = 0; j < 16; j += 4) {
            x.fillStyle = C.sidewalkDot;
            x.fillRect(i + 1, j + 1, 1, 1);
            x.fillRect(i + 2, j + 2, 1, 1);
          }
      }),
      asphalt: tile(32, C.asphalt, (x, r) => speckle(x, r, 120, 32, [C.asphaltDot, C.asphaltDark])),
      grass: tile(32, C.grass, (x, r) => speckle(x, r, 260, 32, [C.grassDark, C.grassLight, C.grassDark])),
      forest: tile(32, C.forest, (x, r) => speckle(x, r, 300, 32, [C.forestDark, C.grassDark, C.forestDark, C.dirt])),
      plaza: tile(32, C.plaza, (x, r) => speckle(x, r, 160, 32, [C.plazaDot, '#e4d2aa'])),
      water: tile(32, C.water, (x, r) => {
        for (let i = 0; i < 14; i++) { x.fillStyle = '#7fc8f0'; x.fillRect(Math.floor(r() * 30), Math.floor(r() * 32), 3, 1); }
      }),
      sea: tile(32, C.seaGround, (x, r) => {
        for (let i = 0; i < 10; i++) { x.fillStyle = C.seaFoam; x.fillRect(Math.floor(r() * 28), Math.floor(r() * 32), 5, 1); }
      }),
    };

    // fondo bajo todo (por si aún falta algún trozo); sigue al jugador
    this.outside = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: C.sidewalk }),
    );
    this.outside.matrixAutoUpdate = false;
    this.group.add(this.outside);
    map.listen(this);
  }

  tileLoaded(t: Tile) {
    const idx: TileIdx = {
      minX: t.minX - 12, minY: t.minY - 12, maxX: t.maxX + 12, maxY: t.maxY + 12,
      areas: new CellIndex(64), paths: new CellIndex(64), shadows: new CellIndex(64), trees: new CellIndex(64), treePts: t.trees,
    };
    for (const a of t.areas) idx.areas.add(a, a);
    for (const r of t.paths) idx.paths.add(r, r);
    for (const b of t.buildings) {
      if (b.minHeight > 2.5) continue;
      const L = Math.min(70, b.height) * SHADOW_K;
      const sx = -SUN_DIR[0] * L, sy = -SUN_DIR[1] * L;
      const sb = {
        minX: b.minX + Math.min(0, sx), maxX: b.maxX + Math.max(0, sx),
        minY: b.minY + Math.min(0, sy), maxY: b.maxY + Math.max(0, sy),
      };
      idx.shadows.add(sb, b);
      idx.minX = Math.min(idx.minX, sb.minX); idx.maxX = Math.max(idx.maxX, sb.maxX);
      idx.minY = Math.min(idx.minY, sb.minY); idx.maxY = Math.max(idx.maxY, sb.maxY);
    }
    for (let i = 0; i < t.trees.length / 2; i++) {
      const x = t.trees[i * 2], y = t.trees[i * 2 + 1];
      idx.trees.add({ minX: x - 12, minY: y - 12, maxX: x + 12, maxY: y + 12 }, i);
    }
    this.tiles.set(t.key, idx);
  }

  tileUnloaded(t: Tile) {
    this.tiles.delete(t.key);
  }

  private *tilesIn(b: BBox) {
    for (const t of this.tiles.values()) if (t.minX <= b.maxX && t.maxX >= b.minX && t.minY <= b.maxY && t.maxY >= b.minY) yield t;
  }

  /** Genera/descarta trozos alrededor de (x, y). `budget` = trozos nuevos máximos. */
  update(x: number, y: number, heading: number, budget = 2) {
    this.outside.position.set(x, -3, -y);
    this.outside.updateMatrix();
    let made = 0;
    made += this.layer(this.far, FAR, FAR_PX, view.r - 40, view.r + 140, x, y, heading, Math.max(1, budget >> 1), true);
    made += this.layer(this.near, NEAR, NEAR_PX, NEAR_R, NEAR_DROP, x, y, heading, budget, false);
    return made;
  }

  private layer(store: Map<string, Chunk>, size: number, pxm: number, R: number, drop: number,
    x: number, y: number, heading: number, budget: number, far: boolean) {
    for (const [k, c] of store) {
      const [cx, cy] = k.split(',').map(Number);
      if (Math.hypot((cx + 0.5) * size - x, (cy + 0.5) * size - y) > drop) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.tex.dispose();
        (c.mesh.material as THREE.Material).dispose();
        store.delete(k);
      }
    }
    const want: [number, number, number][] = [];
    const b = this.map.bounds;
    const fx = Math.sin(heading), fy = Math.cos(heading);
    for (let cx = Math.floor((x - R) / size); cx <= Math.floor((x + R) / size); cx++)
      for (let cy = Math.floor((y - R) / size); cy <= Math.floor((y + R) / size); cy++) {
        const mx = (cx + 0.5) * size, my = (cy + 0.5) * size;
        if (mx + size / 2 <= b.minX || mx - size / 2 >= b.maxX || my + size / 2 <= b.minY || my - size / 2 >= b.maxY) continue;
        const d = Math.hypot(mx - x, my - y);
        if (d > R + size * 0.7 || store.has(`${cx},${cy}`)) continue;
        // solo cuando han llegado las teselas de alrededor (si no, faltarían sombras o parques)
        if (!this.map.ready({ minX: mx - size / 2, minY: my - size / 2, maxX: mx + size / 2, maxY: my + size / 2 }, far ? 40 : 100)) continue;
        const ahead = ((mx - x) * fx + (my - y) * fy) / (d || 1);
        want.push([cx, cy, d - ahead * size * 0.8]);
      }
    want.sort((a, b2) => a[2] - b2[2]);
    let n = 0;
    for (const [cx, cy] of want) {
      if (n >= budget) break;
      store.set(`${cx},${cy}`, this.build(cx, cy, size, pxm, far));
      n++;
    }
    return n;
  }

  private build(cx: number, cy: number, size: number, pxm: number, far: boolean): Chunk {
    const P = size * pxm;
    const [cv, ctx] = canvas(P, P);
    const x0 = cx * size, y0 = cy * size;
    ctx.setTransform(pxm, 0, 0, -pxm, -x0 * pxm, (y0 + size) * pxm);
    this.paint(ctx, { minX: x0, minY: y0, maxX: x0 + size, maxY: y0 + size }, pxm, far);
    const tex = pixelTexture(cv, false);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = passAlpha(new THREE.MeshBasicMaterial({ map: tex }));
    if (!far) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
    }
    const mesh = new THREE.Mesh(this.heightfield(x0, y0, size), mat);
    mesh.position.y = far ? -0.06 : 0;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return { mesh, tex };
  }

  /** Malla del trozo con los vértices en los nodos de la rejilla del relieve (misma diagonal que Terrain.at). */
  private heightfield(x0: number, y0: number, size: number) {
    const T = this.map.terrain, n = Math.max(1, Math.round(size / T.res)), st = size / n;
    const pos = new Float32Array((n + 1) * (n + 1) * 3), uv = new Float32Array((n + 1) * (n + 1) * 2);
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const k = j * (n + 1) + i, x = x0 + i * st, y = y0 + j * st;
        pos[k * 3] = x;
        pos[k * 3 + 1] = T.at(x, y);
        pos[k * 3 + 2] = -y;
        uv[k * 2] = i / n;
        uv[k * 2 + 1] = j / n;
      }
    const idx: number[] = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, c = d + 1;
        idx.push(a, b, c, a, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  private pat(ctx: CanvasRenderingContext2D, name: string, pxm: number, flat: string): string | CanvasPattern {
    if (pxm < 2) return flat;
    const p = ctx.createPattern(this.tex[name], 'repeat')!;
    p.setTransform(new DOMMatrix().scale(1 / pxm, -1 / pxm));
    return p;
  }

  private paint(ctx: CanvasRenderingContext2D, bb: BBox, pxm: number, far: boolean) {
    const map = this.map, g = this.graph;
    const tiles = [...this.tilesIn(bb)];
    const fillRings = (rings: Float32Array[]) => {
      ctx.beginPath();
      for (const r of rings) {
        ctx.moveTo(r[0], r[1]);
        for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]);
        ctx.closePath();
      }
      ctx.fill('evenodd');
    };
    const strokePts = (p: Float32Array) => {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. acera de panot como base
    ctx.fillStyle = this.pat(ctx, 'sidewalk', pxm, C.sidewalk);
    ctx.fillRect(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY);

    // 2. parques, bosque, plazas, agua y mar
    const areaStyle: Record<string, () => string | CanvasPattern> = {
      farm: () => C.farm,
      forest: () => this.pat(ctx, 'forest', pxm, C.forest),
      grass: () => this.pat(ctx, 'grass', pxm, C.grass),
      park: () => this.pat(ctx, 'grass', pxm, C.grass),
      garden: () => this.pat(ctx, 'grass', pxm, C.grass),
      grave: () => C.grave,
      pitch: () => C.pitch,
      plaza: () => this.pat(ctx, 'plaza', pxm, C.plaza),
      sand: () => C.sand,
      sea: () => this.pat(ctx, 'sea', pxm, C.seaGround),
      water: () => this.pat(ctx, 'water', pxm, C.water),
      pool: () => C.pool,
    };
    const areas = tiles.flatMap((t) => t.areas.query(bb));
    areas.sort((a, b) => AREA_ORDER.indexOf(a.kind) - AREA_ORDER.indexOf(b.kind));
    for (const a of areas) {
      ctx.fillStyle = (areaStyle[a.kind] || (() => C.plaza))();
      fillRings(a.rings);
    }

    // 3. calles peatonales, caminos, aceras y carriles bici
    const paths = this.roads.query(bb).sort((a, b) => a - b).map((i) => map.roads[i]);
    for (const t of tiles) paths.push(...t.paths.query(bb));
    for (const r of paths) {
      if (r.cls === 'cycleway') { ctx.strokeStyle = C.cycle; ctx.lineWidth = 2; }
      else if (r.cls === 'pedestrian' || r.cls === 'path' || r.cls === 'steps' || r.cls === 'track') { ctx.strokeStyle = this.pat(ctx, 'plaza', pxm, C.plaza); ctx.lineWidth = r.width; }
      else { ctx.strokeStyle = this.pat(ctx, 'sidewalk', pxm, C.sidewalk); ctx.lineWidth = r.width; }
      strokePts(r.pts);
    }

    // 4. calzadas: bordillo, asfalto y cruces achaflanados
    const edges = this.edges.query(bb).map((i) => g.edges[i]);
    const nodes = new Set<number>();
    for (const e of edges) { nodes.add(e.from); nodes.add(e.to); }
    const nodeDisc = (extra: number) => {
      for (const n of nodes) {
        const r = this.nodeR[n];
        if (!r) continue;
        const nd = g.nodes[n];
        ctx.beginPath();
        // octógono: los chaflanes de Cerdà
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + Math.PI / 8 + Math.PI / 4;
          ctx.lineTo(nd.x + Math.cos(a) * (r + extra) * 1.08, nd.y + Math.sin(a) * (r + extra) * 1.08);
        }
        ctx.closePath();
        ctx.fill();
      }
    };
    if (!far) {
      ctx.strokeStyle = C.curb;
      ctx.fillStyle = C.curb;
      for (const e of edges) { ctx.lineWidth = e.road.width + 0.7; strokePts(e.pts); }
      nodeDisc(0.35);
    }
    const asphalt = this.pat(ctx, 'asphalt', pxm, C.asphalt);
    ctx.strokeStyle = asphalt;
    ctx.fillStyle = asphalt;
    for (const e of edges) { ctx.lineWidth = e.road.width; strokePts(e.pts); }
    nodeDisc(0);

    if (!far) this.markings(ctx, edges);

    if (this.night > 0.5) { this.lamps(ctx, edges, far); return; }

    // 5. sombras proyectadas por edificios y árboles (atardecer)
    const sh = canvas(ctx.canvas.width, ctx.canvas.height);
    const sctx = sh[1];
    sctx.setTransform(ctx.getTransform());
    sctx.fillStyle = '#000';
    for (const t of tiles) for (const b of t.shadows.query(bb)) {
      const L = Math.min(70, b.height) * SHADOW_K;
      const sx = -SUN_DIR[0] * L, sy = -SUN_DIR[1] * L;
      const r = b.rings[0];
      const n = r.length / 2;
      // solo las caras de espaldas al sol + la huella desplazada (cada pieza por separado)
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const dx = r[j * 2] - r[k * 2], dy = r[j * 2 + 1] - r[k * 2 + 1];
        if (dy * sx - dx * sy <= 0) continue;
        sctx.beginPath();
        sctx.moveTo(r[k * 2], r[k * 2 + 1]);
        sctx.lineTo(r[j * 2], r[j * 2 + 1]);
        sctx.lineTo(r[j * 2] + sx, r[j * 2 + 1] + sy);
        sctx.lineTo(r[k * 2] + sx, r[k * 2 + 1] + sy);
        sctx.fill();
      }
      sctx.beginPath();
      for (let k = 0; k < n; k++) sctx.lineTo(r[k * 2] + sx, r[k * 2 + 1] + sy);
      sctx.fill();
    }
    for (const t of tiles) for (const i of t.trees.query(bb)) {
      const tx = t.treePts[i * 2], ty = t.treePts[i * 2 + 1];
      sctx.beginPath();
      sctx.ellipse(tx - SUN_DIR[0] * 5, ty - SUN_DIR[1] * 5, 3.6, 3.6, 0, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = C.shadow;
    sctx.fillRect(0, 0, sh[0].width, sh[0].height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sh[0], 0, 0);
    ctx.restore();
  }

  /** Farolas: charcos de luz cálida a ambos lados de la calzada; el alfa los marca como luz propia. */
  private lamps(ctx: CanvasRenderingContext2D, edges: REdge[], far: boolean) {
    const g = this.graph, R = far ? 9 : 7;
    const spots: number[] = [];
    for (const e of edges) {
      const off = e.road.width / 2 + 1.2;
      for (let s = 6; s < e.len - 4; s += 26)
        for (const side of [-1, 1]) {
          const p = g.pose(e, s + (side > 0 ? 13 : 0), off * side, { x: 0, y: 0, a: 0 });
          spots.push(p.x, p.y);
        }
    }
    for (const pass of [0, 1]) {
      ctx.globalCompositeOperation = pass ? 'destination-out' : 'source-over';
      for (let i = 0; i < spots.length; i += 2) {
        const x = spots[i], y = spots[i + 1];
        const gr = ctx.createRadialGradient(x, y, 0, x, y, R);
        if (pass) { gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); }
        else { gr.addColorStop(0, 'rgba(255,214,140,0.85)'); gr.addColorStop(0.5, 'rgba(255,190,110,0.35)'); gr.addColorStop(1, 'rgba(255,180,100,0)'); }
        ctx.fillStyle = gr;
        ctx.fillRect(x - R, y - R, R * 2, R * 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (!far) {
      ctx.fillStyle = '#2a2a34'; // el pie de la farola
      for (let i = 0; i < spots.length; i += 2) ctx.fillRect(spots[i] - 0.2, spots[i + 1] - 0.2, 0.4, 0.4);
    }
  }

  /** Repinta todo (al pasar del día a la noche o al revés). */
  repaint() {
    for (const store of [this.near, this.far])
      for (const [k, c] of store) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.tex.dispose();
        (c.mesh.material as THREE.Material).dispose();
        store.delete(k);
      }
  }

  private markings(ctx: CanvasRenderingContext2D, edges: REdge[]) {
    const g = this.graph;
    ctx.strokeStyle = C.marking;
    ctx.lineCap = 'butt';
    const along = (e: REdge, s: number, off: number) => g.pose(e, s, off, { x: 0, y: 0, a: 0 });
    for (const e of edges) {
      const w = e.road.width;
      const r0 = this.nodeR[e.from] + 1.5, r1 = this.nodeR[e.to] + 1.5;
      const L = e.len;
      // líneas de carril discontinuas
      const offs: number[] = [];
      if (e.twoWay && w >= 7) offs.push(0);
      if (!e.twoWay && e.lanes > 1) for (let k = 1; k < e.lanes; k++) offs.push(-w / 2 + (w / e.lanes) * k);
      if (e.twoWay && e.lanes > 1) for (let k = 1; k < e.lanes; k++) { const o = (w / 2) * (k / e.lanes); offs.push(o, -o); }
      ctx.lineWidth = 0.25;
      for (const off of offs) {
        for (let s = r0 + 2; s < L - r1 - 2; s += 7) {
          const a = along(e, s, off), b = along(e, Math.min(s + 3, L - r1), off);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      // pasos de cebra al llegar a los cruces
      if (L < 30) continue;
      for (const [node, s] of [[e.from, r0 + 1.5], [e.to, L - r1 - 1.5]] as const) {
        if (g.nodes[node].degree < 3 || hash(node) < 0.15) continue;
        const p = along(e, s, 0);
        const fx = Math.sin(p.a), fy = Math.cos(p.a);
        ctx.lineWidth = 0.5;
        for (let k = -w / 2 + 0.6; k <= w / 2 - 0.5; k += 1) {
          const qx = p.x + fy * k, qy = p.y - fx * k;
          ctx.beginPath(); ctx.moveTo(qx - fx * 1.5, qy - fy * 1.5); ctx.lineTo(qx + fx * 1.5, qy + fy * 1.5); ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'round';
  }
}
