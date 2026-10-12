import * as THREE from 'three';
import { C, SUN_AZIMUTH } from '../palette';
import { canvas, pixelTexture } from './textures';
import { rng } from '../geom';

const W = 1024, H = 256;
const R = 800;
const TOP = (40 * Math.PI) / 180, BOTTOM = (-6 * Math.PI) / 180;
const yTop = R * Math.tan(TOP), yBot = R * Math.tan(BOTTOM);
const HORIZON = Math.round((yTop / (yTop - yBot)) * H); // fila del horizonte

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function bayer4(x: number, y: number) {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (m[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

const azToU = (deg: number) => Math.round((((deg % 360) + 360) % 360) / 360 * W);

/** Panorama cilíndrico: degradado del atardecer, sol synthwave, Collserola, Montjuïc y el mar. */
function panorama(): HTMLCanvasElement {
  const [c, x] = canvas(W, H);
  const img = x.createImageData(W, H);
  const bands = [C.skyTop, C.sky1, C.sky2, C.sky3, C.sky4, C.horizon].map(hex);
  const fog = hex(C.fog), sea = hex(C.sea);
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
        if (isSea && ((i * 7 + y * 13) % 23 === 0)) col = hex('#8a9ae8');
      }
      const o = (y * W + i) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);

  // Sol con franjas
  const su = azToU((SUN_AZIMUTH * 180) / Math.PI), sv = HORIZON - 34, sr = 46;
  const sunCols = [C.sunTop, C.sunTop, C.sunMid, C.sunMid, C.sunLow].map(hex);
  for (let dy = -sr; dy <= sr; dy++) {
    const yy = sv + dy;
    if (yy >= HORIZON) break;
    if (dy > 2) {
      const k = dy / sr;
      const gap = Math.round(k * 5);
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

  // Nubes alargadas
  const r = rng(42);
  for (let i = 0; i < 26; i++) {
    const cu = Math.floor(r() * W), cv = 20 + Math.floor(r() * (HORIZON - 70));
    const len = 30 + Math.floor(r() * 90);
    const near = Math.abs(((cu - su + W * 1.5) % W) - W / 2) < 140;
    x.fillStyle = near ? '#ff9a8a' : cv < 80 ? '#4a2a80' : '#a03a88';
    x.fillRect(cu, cv, len, 2);
    x.fillRect(cu + 8, cv - 1, len - 20, 1);
    x.fillStyle = near ? '#ffd0a0' : '#c05090';
    x.fillRect(cu + 4, cv + 2, len - 8, 1);
  }

  // Siluetas: Collserola (con Tibidabo y Torre de Collserola) y Montjuïc (con el castillo)
  const ridge = (from: number, to: number, base: number, amp: number, col: string, seed: number) => {
    const rr = rng(seed);
    const pts: number[] = [];
    let h = base;
    for (let az = from; az <= to; az += 0.35) {
      h += (rr() - 0.5) * 1.6;
      h = Math.max(base - amp, Math.min(base + amp, h));
      const edge = Math.min(az - from, to - az);
      pts.push(az, h * Math.min(1, edge / 14));
    }
    x.fillStyle = col;
    for (let i = 0; i < pts.length; i += 2) {
      const u = azToU(pts[i]), hh = Math.round(pts[i + 1]);
      x.fillRect(u, HORIZON - hh, 3, hh);
    }
    return pts;
  };
  ridge(258, 395, 14, 4, C.mountainFar, 9);
  const col = ridge(268, 385, 22, 6, C.mountain, 10);
  // Tibidabo
  const tib = azToU(328);
  x.fillStyle = C.mountain;
  for (let dx = -18; dx <= 18; dx++) {
    const hh = 34 - Math.abs(dx) * 0.6;
    x.fillRect(tib + dx, HORIZON - hh, 1, hh);
  }
  x.fillRect(tib - 3, HORIZON - 44, 7, 10);
  x.fillRect(tib - 1, HORIZON - 52, 3, 8);
  x.fillRect(tib, HORIZON - 57, 1, 5);
  // Torre de Collserola
  const tc = azToU(318);
  x.fillRect(tc, HORIZON - 62, 1, 36);
  x.fillRect(tc - 2, HORIZON - 46, 5, 2);
  x.fillStyle = '#ff4060';
  x.fillRect(tc, HORIZON - 63, 1, 1);
  // Montjuïc
  x.fillStyle = C.mountain;
  for (let az = 196; az < 240; az += 0.35) {
    const k = Math.sin(((az - 196) / 44) * Math.PI);
    const hh = Math.round(k * 16 + Math.sin(az) * 1.5);
    x.fillRect(azToU(az), HORIZON - hh, 3, hh);
  }
  x.fillRect(azToU(214), HORIZON - 21, 10, 5);
  x.fillRect(azToU(214) + 2, HORIZON - 23, 2, 2);
  x.fillRect(azToU(214) + 7, HORIZON - 23, 2, 2);
  void col;
  return c;
}

export function createSky(): THREE.Mesh {
  const tex = pixelTexture(panorama());
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapT = THREE.ClampToEdgeWrapping;
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
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, fog: false, side: THREE.DoubleSide, depthWrite: false }));
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
