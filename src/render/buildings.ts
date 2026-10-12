import * as THREE from 'three';
import type { Building, GameMap } from '../map';
import { FACADE_TINTS, ROOF_TINTS, SHADE, SUN_DIR, SUN_LIGHT } from '../palette';
import { VARIANTS, type FacadeSet } from './textures';

const CELL = 128;
const BUILD_R = 760, DROP_R = 940;
const SHOP_H = 4.5, FLOOR_H = 3.3, BAY_W = 3;

type Style = 'eixample' | 'modern' | 'plain' | 'shops' | 'roof';
const STYLES: Style[] = ['eixample', 'modern', 'plain', 'shops', 'roof'];

class Buf {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, u: number, v: number, c: number[]) {
    this.pos.push(x, z, -y);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const mul = (a: number[], b: number[], k = 1) => a.map((v, i) => v * b[i] * k);

/** Edificios extruidos a partir de las huellas de OSM, agrupados por celdas. */
export class Buildings {
  readonly group = new THREE.Group();
  private cells = new Map<string, number[]>();
  private built = new Map<string, THREE.Mesh[]>();
  private mats: Record<Style, THREE.MeshBasicMaterial>;

  constructor(private map: GameMap, tex: FacadeSet) {
    map.buildings.forEach((b, i) => {
      const k = `${Math.floor(b.cx / CELL)},${Math.floor(b.cy / CELL)}`;
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(i);
    });
    const m = (t: THREE.Texture) => new THREE.MeshBasicMaterial({ map: t, vertexColors: true });
    this.mats = { eixample: m(tex.eixample), modern: m(tex.modern), plain: m(tex.plain), shops: m(tex.shops), roof: m(tex.roof) };
  }

  update(x: number, y: number, budget = 3) {
    for (const [k, meshes] of this.built) {
      const [cx, cy] = k.split(',').map(Number);
      if (Math.hypot((cx + 0.5) * CELL - x, (cy + 0.5) * CELL - y) > DROP_R) {
        for (const m of meshes) { this.group.remove(m); m.geometry.dispose(); }
        this.built.delete(k);
      }
    }
    const want: [string, number][] = [];
    for (const k of this.cells.keys()) {
      if (this.built.has(k)) continue;
      const [cx, cy] = k.split(',').map(Number);
      const d = Math.hypot((cx + 0.5) * CELL - x, (cy + 0.5) * CELL - y);
      if (d < BUILD_R) want.push([k, d]);
    }
    want.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < Math.min(budget, want.length); i++) this.buildCell(want[i][0]);
    return want.length;
  }

  private style(b: Building): Style {
    const name = b.name >= 0 ? this.map.names[b.name] : '';
    if (name.includes('Sagrada')) return 'plain';
    if (b.height > 42) return 'modern';
    if (b.height < 7) return 'plain';
    return b.seed < 0.78 ? 'eixample' : 'plain';
  }

  private buildCell(k: string) {
    const bufs: Partial<Record<Style, Buf>> = {};
    const get = (s: Style) => (bufs[s] ||= new Buf());
    for (const i of this.cells.get(k)!) this.addBuilding(this.map.buildings[i], get);
    const meshes: THREE.Mesh[] = [];
    for (const s of STYLES) {
      const b = bufs[s];
      if (!b || !b.idx.length) continue;
      const mesh = new THREE.Mesh(b.geometry(), this.mats[s]);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    this.built.set(k, meshes);
  }

  private addBuilding(b: Building, get: (s: Style) => Buf) {
    const name = b.name >= 0 ? this.map.names[b.name] : '';
    const sagrada = name.includes('Sagrada');
    const style = this.style(b);
    let tint = FACADE_TINTS[Math.floor(b.seed * 997) % FACADE_TINTS.length];
    if (sagrada) tint = [0.86, 0.72, 0.56];
    if (style === 'modern') tint = [1, 1, 1];
    const h = b.height, z0 = b.minHeight;
    const shops = z0 < 1 && h > 7 && style !== 'modern' && !sagrada;
    const zUp = shops ? SHOP_H : z0;
    const floors = Math.max(1, Math.round((h - zUp) / FLOOR_H));
    const walls = get(style);
    const shopBuf = shops ? get('shops') : null;

    for (const r of b.rings) {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x1 = r[i * 2], y1 = r[i * 2 + 1], x2 = r[j * 2], y2 = r[j * 2 + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 0.05) continue;
        const nx = (y2 - y1) / len, ny = -(x2 - x1) / len;
        const k = nx * SUN_DIR[0] + ny * SUN_DIR[1];
        const light = mix(SHADE, SUN_LIGHT, Math.pow(Math.max(0, 0.45 + 0.55 * k), 1.3));
        const c = mul(tint, light);
        const bays = Math.max(1, Math.round(len / BAY_W));
        const u0 = Math.floor(((x1 * 7.13 + y1 * 3.71) % 4 + 4) % 4) / VARIANTS;
        const u1 = u0 + bays / VARIANTS;
        // planta baja (comercios)
        if (shopBuf) {
          const cs = mul([1, 1, 1], light), cb = mul(cs, [0.7, 0.68, 0.78]);
          const a = shopBuf.vert(x1, y1, 0, u0, 0, cb), bb = shopBuf.vert(x2, y2, 0, u1, 0, cb);
          const cc = shopBuf.vert(x2, y2, SHOP_H, u1, 1, cs), d = shopBuf.vert(x1, y1, SHOP_H, u0, 1, cs);
          shopBuf.idx.push(a, bb, cc, a, cc, d);
        }
        if (h - zUp < 0.3) continue;
        const cl = z0 < 1 && !shops ? mul(c, [0.75, 0.72, 0.82]) : c;
        const a = walls.vert(x1, y1, zUp, u0, 0, cl), bb = walls.vert(x2, y2, zUp, u1, 0, cl);
        const cc = walls.vert(x2, y2, h, u1, floors, c), d = walls.vert(x1, y1, h, u0, floors, c);
        walls.idx.push(a, bb, cc, a, cc, d);
      }
    }

    // azotea
    const roof = get('roof');
    const rt = mul(sagrada ? [0.8, 0.66, 0.5] : ROOF_TINTS[Math.floor(b.seed * 7919) % ROOF_TINTS.length], SUN_LIGHT, 0.92);
    const contour = ringToV2(b.rings[0]);
    const holes = b.rings.slice(1).map(ringToV2);
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = contour.concat(...holes);
    const base = roof.pos.length / 3;
    for (const p of all) roof.vert(p.x, p.y, h, p.x / 6, p.y / 6, rt);
    for (const t of tris) {
      const [a, bb, c] = t;
      const pa = all[a], pb = all[bb], pc = all[c];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (cross >= 0) roof.idx.push(base + a, base + bb, base + c);
      else roof.idx.push(base + a, base + c, base + bb);
    }
  }
}

function ringToV2(r: Float32Array) {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < r.length; i += 2) out.push(new THREE.Vector2(r[i], r[i + 1]));
  return out;
}
