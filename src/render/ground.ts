import * as THREE from 'three';
import type { BBox, GameMap } from '../map';
import { hash } from '../map';
import type { RoadGraph, REdge } from '../roads';
import { C, SUN_DIR, SUN_ELEVATION } from '../palette';
import { canvas, pixelTexture } from './textures';
import { rng } from '../geom';

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
const FAR = 256, FAR_PX = 1, FAR_R = 720, FAR_DROP = 900;
const SHADOW_K = 1 / Math.tan(SUN_ELEVATION);

interface Chunk { mesh: THREE.Mesh; tex: THREE.Texture }

/** Suelo en trozos dibujados con Canvas 2D: aceras de panot, asfalto, pasos de cebra, parques y sombras. */
export class Ground {
  readonly group = new THREE.Group();
  private areas = new CellIndex<number>(64);
  private roads = new CellIndex<number>(64);
  private edges = new CellIndex<number>(64);
  private shadows = new CellIndex<number>(64);
  private trees = new CellIndex<number>(64);
  private nodeR: Float32Array;
  private near = new Map<string, Chunk>();
  private far = new Map<string, Chunk>();
  private nearGeo = new THREE.PlaneGeometry(NEAR, NEAR).rotateX(-Math.PI / 2);
  private farGeo = new THREE.PlaneGeometry(FAR, FAR).rotateX(-Math.PI / 2);
  private tiles: Record<string, HTMLCanvasElement>;

  constructor(private map: GameMap, private graph: RoadGraph) {
    map.areas.forEach((a, i) => this.areas.add(a, i));
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
    map.buildings.forEach((b, i) => {
      const L = Math.min(70, b.height) * SHADOW_K;
      const sx = -SUN_DIR[0] * L, sy = -SUN_DIR[1] * L;
      this.shadows.add({
        minX: b.minX + Math.min(0, sx), maxX: b.maxX + Math.max(0, sx),
        minY: b.minY + Math.min(0, sy), maxY: b.maxY + Math.max(0, sy),
      }, i);
    });
    for (let i = 0; i < map.trees.length / 2; i++) {
      const x = map.trees[i * 2], y = map.trees[i * 2 + 1];
      this.trees.add({ minX: x - 12, minY: y - 12, maxX: x + 12, maxY: y + 12 }, i);
    }
    // radio de la "plaza" asfaltada de cada cruce (los chaflanes del Eixample)
    this.nodeR = new Float32Array(graph.nodes.length);
    for (const e of graph.edges) {
      for (const n of [e.from, e.to])
        if (graph.nodes[n].degree >= 3) this.nodeR[n] = Math.max(this.nodeR[n], e.road.width * 0.72);
    }

    this.tiles = {
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
      plaza: tile(32, C.plaza, (x, r) => speckle(x, r, 160, 32, [C.plazaDot, '#e4d2aa'])),
      water: tile(32, C.water, (x, r) => {
        for (let i = 0; i < 14; i++) { x.fillStyle = '#7fc8f0'; x.fillRect(Math.floor(r() * 30), Math.floor(r() * 32), 3, 1); }
      }),
    };

    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: C.sidewalk }),
    );
    outside.position.y = -0.15;
    this.group.add(outside);
  }

  /** Genera/descarta trozos alrededor de (x, y). `budget` = trozos nuevos máximos. */
  update(x: number, y: number, heading: number, budget = 2) {
    let made = 0;
    made += this.layer(this.far, FAR, FAR_PX, FAR_R, FAR_DROP, x, y, heading, Math.max(1, budget >> 1), true);
    this.layer(this.near, NEAR, NEAR_PX, NEAR_R, NEAR_DROP, x, y, heading, budget, false);
    return made;
  }

  private layer(store: Map<string, Chunk>, size: number, pxm: number, R: number, drop: number,
    x: number, y: number, heading: number, budget: number, far: boolean) {
    for (const [k, c] of store) {
      const [cx, cy] = k.split(',').map(Number);
      if (Math.hypot((cx + 0.5) * size - x, (cy + 0.5) * size - y) > drop) {
        this.group.remove(c.mesh);
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
        if (mx + size / 2 < b.minX - 40 || mx - size / 2 > b.maxX + 40 || my + size / 2 < b.minY - 40 || my - size / 2 > b.maxY + 40) continue;
        const d = Math.hypot(mx - x, my - y);
        if (d > R + size * 0.7 || store.has(`${cx},${cy}`)) continue;
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
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    if (!far) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
    }
    const mesh = new THREE.Mesh(far ? this.farGeo : this.nearGeo, mat);
    mesh.position.set(x0 + size / 2, far ? -0.06 : 0, -(y0 + size / 2));
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return { mesh, tex };
  }

  private pat(ctx: CanvasRenderingContext2D, name: string, pxm: number, flat: string): string | CanvasPattern {
    if (pxm < 2) return flat;
    const p = ctx.createPattern(this.tiles[name], 'repeat')!;
    p.setTransform(new DOMMatrix().scale(1 / pxm, -1 / pxm));
    return p;
  }

  private paint(ctx: CanvasRenderingContext2D, bb: BBox, pxm: number, far: boolean) {
    const map = this.map, g = this.graph;
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

    // 2. parques, plazas, agua
    const areaStyle: Record<string, () => string | CanvasPattern> = {
      grass: () => this.pat(ctx, 'grass', pxm, C.grass),
      park: () => this.pat(ctx, 'grass', pxm, C.grass),
      garden: () => this.pat(ctx, 'grass', pxm, C.grass),
      pitch: () => C.pitch,
      plaza: () => this.pat(ctx, 'plaza', pxm, C.plaza),
      sand: () => C.sand,
      water: () => this.pat(ctx, 'water', pxm, C.water),
      pool: () => C.pool,
    };
    for (const i of this.areas.query(bb).sort((a, b) => a - b)) {
      const a = map.areas[i];
      ctx.fillStyle = (areaStyle[a.kind] || (() => C.plaza))();
      fillRings(a.rings);
    }

    // 3. caminos peatonales, carriles bici
    for (const i of this.roads.query(bb).sort((a, b) => a - b)) {
      const r = map.roads[i];
      if (r.cls === 'cycleway') { ctx.strokeStyle = C.cycle; ctx.lineWidth = 2; }
      else if (r.cls === 'pedestrian' || r.cls === 'path' || r.cls === 'steps') { ctx.strokeStyle = this.pat(ctx, 'plaza', pxm, C.plaza); ctx.lineWidth = r.width; }
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

    // 5. sombras proyectadas por edificios y árboles (atardecer)
    const sh = canvas(ctx.canvas.width, ctx.canvas.height);
    const sctx = sh[1];
    sctx.setTransform(ctx.getTransform());
    sctx.fillStyle = '#000';
    for (const i of this.shadows.query(bb)) {
      const b = map.buildings[i];
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
    for (const i of this.trees.query(bb)) {
      const tx = this.map.trees[i * 2], ty = this.map.trees[i * 2 + 1];
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
