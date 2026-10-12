import * as THREE from 'three';
import type { Building, Tile, TileListener, World } from '../map';
import type { Terrain } from '../terrain';
import { FACADE_TINTS, ROOF_TINTS, SHADE, SUN_DIR, SUN_LIGHT } from '../palette';
import { VARIANTS, type FacadeSet } from './textures';
import { LOD_R, view } from '../view';
import { passAlpha } from '../daylight';

const CELL = 128;
const SAGRADA = 'Basílica de la Sagrada Família';
const SHOP_H = 4.5, FLOOR_H = 3.3, BAY_W = 3;
/** Lado de las páginas del atlas de fachadas (PAGE en tools/build_facades.py). */
const PHOTO_PAGE = 2048;

type Style = 'eixample' | 'modern' | 'plain' | 'shops' | 'roof';

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

interface Cell { tile: string; x: number; y: number; items: Building[]; meshes: THREE.Mesh[] | null; far: boolean }

/** Edificios extruidos a partir de las huellas de OSM, agrupados por celdas dentro de cada tesela. */
export class Buildings implements TileListener {
  readonly group = new THREE.Group();
  private cells = new Map<string, Cell>();
  private mats: Record<Style, THREE.MeshBasicMaterial>;
  private terrain: Terrain;
  /** Materiales de las fachadas fotográficas de cada tesela (uno por página del atlas). */
  private photoMats = new Map<string, THREE.MeshBasicMaterial[]>();
  private farMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private loader = new THREE.TextureLoader();

  constructor(private map: World, tex: FacadeSet) {
    this.terrain = map.terrain;
    // las ventanas encendidas de noche brillan (alfa de la textura): ver daylight.ts
    const m = (t: THREE.Texture) => passAlpha(new THREE.MeshBasicMaterial({ map: t, vertexColors: true }));
    this.mats = { eixample: m(tex.eixample), modern: m(tex.modern), plain: m(tex.plain), shops: m(tex.shops), roof: m(tex.roof) };
    map.listen(this);
  }

  tileLoaded(t: Tile) {
    if (t.facadePages) {
      const mats: THREE.MeshBasicMaterial[] = [];
      for (let p = 0; p < t.facadePages; p++) {
        const tex = this.loader.load(`${this.map.base}facades/${t.tx}_${t.ty}_${p}.webp`);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        mats.push(new THREE.MeshBasicMaterial({ map: tex, vertexColors: true }));
      }
      this.photoMats.set(t.key, mats);
    }
    for (const b of t.buildings) {
      const x = Math.floor(b.cx / CELL), y = Math.floor(b.cy / CELL);
      const k = `${t.key}|${x},${y}`;
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = { tile: t.key, x, y, items: [], meshes: null, far: false }));
      c.items.push(b);
    }
  }

  tileUnloaded(t: Tile) {
    for (const [k, c] of this.cells) {
      if (c.tile !== t.key) continue;
      this.drop(c);
      this.cells.delete(k);
    }
    for (const m of this.photoMats.get(t.key) ?? []) { m.map?.dispose(); m.dispose(); }
    this.photoMats.delete(t.key);
  }

  private drop(c: Cell) {
    if (!c.meshes) return;
    for (const m of c.meshes) { this.group.remove(m); m.geometry.dispose(); }
    c.meshes = null;
  }

  /** Construye las celdas cercanas que falten (como mucho `budget`). Devuelve cuántas faltan. */
  update(x: number, y: number, budget = 3) {
    const want: [Cell, number][] = [];
    for (const c of this.cells.values()) {
      const d = Math.hypot((c.x + 0.5) * CELL - x, (c.y + 0.5) * CELL - y);
      // nivel de detalle: las celdas lejanas (vista desde el helicóptero) van simplificadas
      if (c.meshes && (d > view.r + 180 || (c.far && d < LOD_R - 40) || (!c.far && d > LOD_R + 40))) this.drop(c);
      if (!c.meshes && d < view.r) want.push([c, d]);
    }
    want.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < Math.min(budget, want.length); i++) this.buildCell(want[i][0], want[i][1] > LOD_R);
    return want.length;
  }

  private style(b: Building): Style {
    const name = b.name >= 0 ? this.map.names[b.name] : '';
    if (name === SAGRADA) return 'plain';
    if (b.height > 42) return 'modern';
    if (b.height < 7) return 'plain';
    return b.seed < 0.78 ? 'eixample' : 'plain';
  }

  private buildCell(cell: Cell, far: boolean) {
    const bufs: Record<string, Buf> = {};
    const get = (s: string) => (bufs[s] ||= new Buf());
    cell.far = far;
    for (const b of cell.items) far ? this.addFar(b, get('far')) : this.addBuilding(b, get);
    const meshes: THREE.Mesh[] = [];
    const photo = this.photoMats.get(cell.tile) ?? [];
    for (const s of Object.keys(bufs)) {
      const b = bufs[s];
      const mat = s === 'far' ? this.farMat : s.startsWith('photo') ? photo[Number(s.slice(5))] : this.mats[s as Style];
      if (!b.idx.length || !mat) continue;
      const mesh = new THREE.Mesh(b.geometry(), mat);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    cell.meshes = meshes;
  }

  /** Versión lejana: paredes lisas del tono medio de la fachada y azotea, sin texturas. */
  private addFar(b: Building, buf: Buf) {
    const name = b.name >= 0 ? this.map.names[b.name] : '';
    const style = this.style(b);
    let tint = FACADE_TINTS[Math.floor(b.seed * 997) % FACADE_TINTS.length];
    if (name === SAGRADA) tint = [0.86, 0.72, 0.56];
    if (style === 'modern') tint = [0.62, 0.7, 0.86];
    const k = style === 'modern' ? 1 : 0.78; // las ventanas oscurecen la fachada vista de lejos
    const zr = b.ground, top = zr + b.height, bottom = b.minHeight < 1 ? zr - 2 : zr + b.minHeight;
    const r = b.rings[0], n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = r[i * 2], y1 = r[i * 2 + 1], x2 = r[j * 2], y2 = r[j * 2 + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.05) continue;
      const kk = ((y2 - y1) / len) * SUN_DIR[0] + (-(x2 - x1) / len) * SUN_DIR[1];
      const c = mul(tint, mix(SHADE, SUN_LIGHT, Math.pow(Math.max(0, 0.45 + 0.55 * kk), 1.3)), k);
      const a = buf.vert(x1, y1, bottom, 0, 0, c), bb = buf.vert(x2, y2, bottom, 0, 0, c);
      const cc = buf.vert(x2, y2, top, 0, 0, c), d = buf.vert(x1, y1, top, 0, 0, c);
      buf.idx.push(a, bb, cc, a, cc, d);
    }
    const rt = mul(name === SAGRADA ? [0.8, 0.66, 0.5] : ROOF_TINTS[Math.floor(b.seed * 7919) % ROOF_TINTS.length], SUN_LIGHT, 0.85);
    const contour = ringToV2(r);
    const base = buf.pos.length / 3;
    for (const p of contour) buf.vert(p.x, p.y, top, 0, 0, rt);
    for (const [a, bb, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const pa = contour[a], pb = contour[bb], pc = contour[c];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (cross >= 0) buf.idx.push(base + a, base + bb, base + c);
      else buf.idx.push(base + a, base + c, base + bb);
    }
  }

  private addBuilding(b: Building, get: (s: string) => Buf) {
    const name = b.name >= 0 ? this.map.names[b.name] : '';
    const sagrada = name === SAGRADA;
    const style = this.style(b);
    let tint = FACADE_TINTS[Math.floor(b.seed * 997) % FACADE_TINTS.length];
    if (sagrada) tint = [0.86, 0.72, 0.56];
    if (style === 'modern') tint = [1, 1, 1];
    const zr = b.ground, z0 = b.minHeight, h = b.height;
    const top = zr + h;
    const onGround = z0 < 1;
    const shops = onGround && h > 7 && style !== 'modern' && !sagrada;
    const zUp = shops ? SHOP_H : z0;
    const floors = Math.max(1, Math.round((h - zUp) / FLOOR_H));
    const vk = floors / Math.max(0.5, h - zUp); // filas de ventanas por metro
    const walls = get(style);
    const shopBuf = shops ? get('shops') : null;
    const ter = this.terrain;

    for (const [ri, r] of b.rings.entries()) {
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
        // en cuesta, cada esquina baja hasta su suelo y la planta baja lo sigue
        let b1 = zr + z0, b2 = b1, s1 = zr + zUp, s2 = s1;
        if (onGround) {
          const g1 = ter.at(x1, y1), g2 = ter.at(x2, y2);
          b1 = Math.min(g1, zr) - 0.6;
          b2 = Math.min(g2, zr) - 0.6;
          if (shops) {
            s1 = Math.min(top, Math.max(g1, zr) + SHOP_H);
            s2 = Math.min(top, Math.max(g2, zr) + SHOP_H);
          }
        }
        // fachada real (foto de Mapillary rectificada): sustituye a la textura genérica
        const ph = ri === 0 ? b.photos?.get(i) : undefined;
        if (ph) {
          const pb = get(`photo${ph.page}`);
          const P = PHOTO_PAGE, pu0 = ph.u / P, pu1 = (ph.u + ph.w) / P;
          const vTop = 1 - ph.v / P, vBot = 1 - (ph.v + ph.h) / P;
          const vAt = (z: number) => vBot + (vTop - vBot) * Math.max(0, Math.min(1, (z - ph.z0) / (top - ph.z0)));
          const cp = mul(mix(light, [1, 1, 1], 0.45), [1.04, 0.97, 0.92]);
          const a = pb.vert(x1, y1, b1, pu0, vAt(b1), cp), bb = pb.vert(x2, y2, b2, pu1, vAt(b2), cp);
          const cc = pb.vert(x2, y2, top, pu1, vTop, cp), d = pb.vert(x1, y1, top, pu0, vTop, cp);
          pb.idx.push(a, bb, cc, a, cc, d);
          continue;
        }
        // planta baja (comercios)
        if (shopBuf) {
          const cs = mul([1, 1, 1], light), cb = mul(cs, [0.7, 0.68, 0.78]);
          const a = shopBuf.vert(x1, y1, b1, u0, 1 - (s1 - b1) / SHOP_H, cb), bb = shopBuf.vert(x2, y2, b2, u1, 1 - (s2 - b2) / SHOP_H, cb);
          const cc = shopBuf.vert(x2, y2, s2, u1, 1, cs), d = shopBuf.vert(x1, y1, s1, u0, 1, cs);
          shopBuf.idx.push(a, bb, cc, a, cc, d);
        }
        if (h - zUp < 0.3) continue;
        const w1 = shops ? s1 : b1, w2 = shops ? s2 : b2;
        const vBase = zr + zUp;
        const cl = onGround && !shops ? mul(c, [0.75, 0.72, 0.82]) : c;
        const a = walls.vert(x1, y1, w1, u0, (w1 - vBase) * vk, cl), bb = walls.vert(x2, y2, w2, u1, (w2 - vBase) * vk, cl);
        const cc = walls.vert(x2, y2, top, u1, floors, c), d = walls.vert(x1, y1, top, u0, floors, c);
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
    for (const p of all) roof.vert(p.x, p.y, top, p.x / 6, p.y / 6, rt);
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
