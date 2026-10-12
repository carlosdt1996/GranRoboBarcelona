import * as THREE from 'three';
import { canvas, pixelTexture } from './textures';
import { rng } from '../geom';
import { passAlpha, type SkyPalette } from '../daylight';

const W = 1024, H = 256;
const R = 800;
const TOP = (40 * Math.PI) / 180, BOTTOM = (-6 * Math.PI) / 180;
const yTop = R * Math.tan(TOP), yBot = R * Math.tan(BOTTOM);
const HORIZON = Math.round((yTop / (yTop - yBot)) * H); // fila del horizonte
/** Fila del panorama para una elevación (grados). */
const rowOf = (deg: number) => Math.round(((yTop - R * Math.tan((deg * Math.PI) / 180)) / (yTop - yBot)) * H);

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function bayer4(x: number, y: number) {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (m[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

const azToU = (deg: number) => Math.round((((deg % 360) + 360) % 360) / 360 * W);

/**
 * Panorama cilíndrico: degradado del cielo según la hora, sol (o luna y estrellas), nubes,
 * Collserola con el Tibidabo y la Torre de Collserola, Montjuïc y el mar.
 */
function panorama(x: CanvasRenderingContext2D, P: SkyPalette, sunAz: number, sunEl: number) {
  const img = x.createImageData(W, H);
  const bands = [P.skyTop, P.sky1, P.sky2, P.sky3, P.sky4, P.horizon].map(hex);
  const fog = hex(P.fog), sea = hex(P.sea), wave = hex(P.sky4);
  for (let y = 0; y < H; y++) {
    const t = Math.pow(Math.min(1, y / HORIZON), 1.6) * (bands.length - 1);
    for (let i = 0; i < W; i++) {
      let col: [number, number, number];
      if (y < HORIZON) {
        const b = Math.floor(t), f = t - b;
        col = bands[Math.min(bands.length - 1, b + (f > bayer4(i, y) ? 1 : 0))];
      } else {
        const az = (i / W) * 360;
        const isSea = az > 95 && az < 175;
        col = isSea ? sea : fog;
        if (isSea && ((i * 7 + y * 13) % 23 === 0)) col = wave;
      }
      const o = (y * W + i) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);

  // estrellas y luna de noche
  const r = rng(42);
  if (P.night > 0.2) {
    for (let i = 0; i < 260 * P.night; i++) {
      const sx = Math.floor(r() * W), sy = Math.floor(r() * (HORIZON - 30));
      x.fillStyle = r() < 0.15 ? '#ffffff' : r() < 0.5 ? '#c8c8f0' : '#8888c0';
      x.fillRect(sx, sy, 1, 1);
    }
    const mu = azToU(sunAz + 180), mv = rowOf(Math.min(55, Math.max(12, -sunEl)));
    for (let dy = -9; dy <= 9; dy++) {
      const half = Math.floor(Math.sqrt(81 - dy * dy));
      for (let dx = -half; dx <= half; dx++) {
        x.fillStyle = dx + dy > 6 ? '#b8b8d8' : '#f0f0ff';
        x.fillRect((mu + dx + W) % W, mv + dy, 1, 1);
      }
    }
    x.fillStyle = '#c8c8e0';
    x.fillRect(mu - 3, mv - 2, 2, 2);
    x.fillRect(mu + 2, mv + 1, 3, 2);
  }

  // sol con franjas (más pequeño y sin franjas a pleno día)
  if (sunEl > -4) {
    const su = azToU(sunAz), sv = rowOf(Math.max(-3, sunEl)) - 10;
    const k = Math.min(1, Math.max(0, sunEl / 25));
    const sr = Math.round(46 - k * 22);
    const sunCols = [P.sunTop, P.sunTop, P.sunMid, P.sunMid, P.sunLow].map(hex);
    for (let dy = -sr; dy <= sr; dy++) {
      const yy = sv + dy;
      if (yy >= HORIZON || yy < 0) continue;
      if (dy > 2 && k < 0.6) {
        const gap = Math.round((dy / sr) * 5);
        if ((dy % 7) < gap) continue;
      }
      const half = Math.floor(Math.sqrt(sr * sr - dy * dy));
      const t = ((dy + sr) / (2 * sr)) * (sunCols.length - 1);
      for (let dx = -half; dx <= half; dx++) {
        const b = Math.floor(t), f = t - b;
        const col = sunCols[Math.min(sunCols.length - 1, b + (f > bayer4(dx + 100, yy) ? 1 : 0))];
        x.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        x.fillRect((su + dx + W) % W, yy, 1, 1);
      }
    }
  }

  // nubes alargadas (las cercanas al sol, iluminadas)
  const su = azToU(sunAz);
  for (let i = 0; i < 26; i++) {
    const cu = Math.floor(r() * W), cv = 20 + Math.floor(r() * (HORIZON - 70));
    const len = 30 + Math.floor(r() * 90);
    const near = sunEl > -6 && Math.abs(((cu - su + W * 1.5) % W) - W / 2) < 140;
    x.fillStyle = near ? P.cloudLit : P.cloud;
    x.fillRect(cu, cv, len, 2);
    x.fillRect(cu + 8, cv - 1, len - 20, 1);
    x.fillRect(cu + 4, cv + 2, len - 8, 1);
  }

  // siluetas: Collserola (con Tibidabo y Torre de Collserola) y Montjuïc (con el castillo)
  const ridge = (from: number, to: number, base: number, amp: number, col: string, seed: number) => {
    const rr = rng(seed);
    let h = base;
    x.fillStyle = col;
    for (let az = from; az <= to; az += 0.35) {
      h += (rr() - 0.5) * 1.6;
      h = Math.max(base - amp, Math.min(base + amp, h));
      const edge = Math.min(az - from, to - az);
      const hh = Math.round(h * Math.min(1, edge / 14));
      x.fillRect(azToU(az), HORIZON - hh, 3, hh);
    }
  };
  ridge(258, 395, 14, 4, P.mountainFar, 9);
  ridge(268, 385, 22, 6, P.mountain, 10);
  const tib = azToU(328);
  x.fillStyle = P.mountain;
  for (let dx = -18; dx <= 18; dx++) {
    const hh = 34 - Math.abs(dx) * 0.6;
    x.fillRect(tib + dx, HORIZON - hh, 1, hh);
  }
  x.fillRect(tib - 3, HORIZON - 44, 7, 10);
  x.fillRect(tib - 1, HORIZON - 52, 3, 8);
  x.fillRect(tib, HORIZON - 57, 1, 5);
  const tc = azToU(318);
  x.fillRect(tc, HORIZON - 62, 1, 36);
  x.fillRect(tc - 2, HORIZON - 46, 5, 2);
  x.fillStyle = '#ff4060';
  x.fillRect(tc, HORIZON - 63, 1, 1);
  x.fillStyle = P.mountain;
  for (let az = 196; az < 240; az += 0.35) {
    const k = Math.sin(((az - 196) / 44) * Math.PI);
    const hh = Math.round(k * 16 + Math.sin(az) * 1.5);
    x.fillRect(azToU(az), HORIZON - hh, 3, hh);
  }
  x.fillRect(azToU(214), HORIZON - 21, 10, 5);
  x.fillRect(azToU(214) + 2, HORIZON - 23, 2, 2);
  x.fillRect(azToU(214) + 7, HORIZON - 23, 2, 2);
}

/** Cúpula del cielo que se repinta cuando cambia la hora. Brilla por sí misma (alfa 0). */
export class Sky {
  readonly mesh: THREE.Mesh;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;

  constructor() {
    [this.cv, this.ctx] = canvas(W, H);
    this.tex = pixelTexture(this.cv);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.wrapT = THREE.ClampToEdgeWrapping;
    const seg = 96;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const az = (i / seg) * Math.PI * 2;
      const sx = Math.sin(az) * R, sz = -Math.cos(az) * R;
      pos.push(sx, yBot, sz, sx, yTop, sz);
      uv.push(i / seg, 0, i / seg, 1);
      if (i < seg) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = passAlpha(new THREE.MeshBasicMaterial({ map: this.tex, fog: false, side: THREE.DoubleSide, depthWrite: false }), 0);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  update(P: SkyPalette, sunAz: number, sunEl: number) {
    panorama(this.ctx, P, sunAz, sunEl);
    this.tex.needsUpdate = true;
  }
}
