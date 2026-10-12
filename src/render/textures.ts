import * as THREE from 'three';
import { rng } from '../geom';

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function pixelTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 1;
  return t;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

// Las texturas se tiñen con color de vértice: los tonos claros toman el color del edificio.
const BAY = 16; // píxeles por crujía (≈3 m)
const FLOOR = 18; // píxeles por planta (≈3.3 m)
export const VARIANTS = 4;

/** Fachada de piso del Eixample: balconeras con persianas y barandillas de hierro. */
function facadeEixample() {
  const [c, x] = canvas(BAY * VARIANTS, FLOOR);
  const r = rng(11);
  for (let v = 0; v < VARIANTS; v++) {
    const o = v * BAY;
    px(x, o, 0, BAY, FLOOR, '#f4ead8');
    for (let i = 0; i < 10; i++) px(x, o + Math.floor(r() * BAY), Math.floor(r() * FLOOR), 1, 1, '#e8dcc6');
    px(x, o, 0, BAY, 1, '#d8c8ae'); // cornisa / línea de forjado
    const glass = '#2b2f55';
    // balconera
    px(x, o + 5, 4, 6, 11, glass);
    px(x, o + 5, 4, 6, 1, '#7d6aa8'); // reflejo del cielo
    px(x, o + 5, 5, 1, 4, '#5e4f8e');
    if (v === 1) {
      px(x, o + 5, 4, 6, 11, '#5f8a52'); // persiana cerrada
      for (let y = 5; y < 15; y += 2) px(x, o + 5, y, 6, 1, '#4c7444');
    } else if (v === 2) {
      px(x, o + 5, 4, 6, 5, '#5f8a52'); // persiana a medio bajar
      for (let y = 5; y < 9; y += 2) px(x, o + 5, y, 6, 1, '#4c7444');
    } else if (v === 3) {
      px(x, o + 6, 6, 4, 8, '#f0c070'); // luz encendida
      px(x, o + 6, 6, 4, 1, '#ffe0a0');
    }
    px(x, o + 4, 3, 8, 1, '#e0d2bc'); // dintel
    // balcón
    px(x, o + 3, 15, 10, 1, '#cdbfa8');
    px(x, o + 3, 16, 10, 1, '#8c8070');
    for (let i = 3; i < 13; i += 2) px(x, o + i, 12, 1, 3, '#2a2630');
    px(x, o + 3, 12, 10, 1, '#2a2630');
  }
  return c;
}

/** Torre moderna: muro cortina con reflejos del atardecer. */
function facadeModern() {
  const [c, x] = canvas(BAY * VARIANTS, FLOOR);
  for (let v = 0; v < VARIANTS; v++) {
    const o = v * BAY;
    px(x, o, 0, BAY, FLOOR, '#d4d4dc');
    for (let y = 3; y < 16; y++) {
      const t = (y - 3) / 13;
      const col = t < 0.3 ? '#e88aa0' : t < 0.55 ? '#9a6ab8' : '#43478a';
      px(x, o, y, BAY, 1, col);
    }
    px(x, o + 7 + (v % 2), 3, 1, 13, '#e6e6ee');
    px(x, o + 15, 3, 1, 13, '#e6e6ee');
    if (v === 2) px(x, o + 2, 9, 4, 5, '#f4c070');
  }
  return c;
}

/** Edificio sencillo: ventanas pequeñas con persiana. */
function facadePlain() {
  const [c, x] = canvas(BAY * VARIANTS, FLOOR);
  const r = rng(7);
  for (let v = 0; v < VARIANTS; v++) {
    const o = v * BAY;
    px(x, o, 0, BAY, FLOOR, '#efe6da');
    for (let i = 0; i < 8; i++) px(x, o + Math.floor(r() * BAY), Math.floor(r() * FLOOR), 1, 1, '#e2d8ca');
    px(x, o + 5, 6, 6, 7, '#2e3256');
    px(x, o + 5, 6, 6, 1, '#7d6aa8');
    if (v % 2) px(x, o + 5, 6, 6, 4, '#c58a50');
    px(x, o + 4, 13, 8, 1, '#d6cab8');
  }
  return c;
}

/** Planta baja: comercios con escaparates y toldos. */
function shopfront() {
  const H = 24;
  const [c, x] = canvas(BAY * VARIANTS, H);
  const awn = [['#d8333a', '#f4f0e8'], ['#2f8a4a', '#f4f0e8'], ['#2a4fa0', '#f2d24a'], ['#7a2a7a', '#f4c0e0']];
  for (let v = 0; v < VARIANTS; v++) {
    const o = v * BAY;
    px(x, o, 0, BAY, H, '#d9ccb6');
    for (let y = 3; y < H; y += 4) px(x, o, y, BAY, 1, '#c6b8a0'); // almohadillado
    if (v === 3) {
      // portal de vecinos
      px(x, o + 4, 6, 8, 18, '#4a2e22');
      px(x, o + 5, 7, 6, 6, '#c89a50');
      continue;
    }
    px(x, o + 1, 10, 14, 14, '#ffd27a'); // escaparate iluminado
    px(x, o + 1, 10, 14, 2, '#ffe9b0');
    px(x, o + 2, 16, 4, 8, '#e8a85a');
    px(x, o + 9, 15, 5, 9, '#c47a48');
    px(x, o + 7, 10, 1, 14, '#5a4a40');
    const [a, b] = awn[v];
    for (let i = 0; i < BAY; i++) px(x, o + i, 5, 1, 4, i % 4 < 2 ? a : b);
    px(x, o, 9, BAY, 1, '#00000033');
    px(x, o + 2, 1, 12, 3, v === 0 ? '#2b2b3a' : v === 1 ? '#f4e9d0' : '#d84a4a'); // rótulo
  }
  return c;
}

/** Azoteas (terrats) con baldosa catalana. */
function roof() {
  const [c, x] = canvas(32, 32);
  const r = rng(3);
  px(x, 0, 0, 32, 32, '#d8c8b4');
  for (let i = 0; i < 32; i += 4) {
    px(x, i, 0, 1, 32, '#c4b29c');
    px(x, 0, i, 32, 1, '#c4b29c');
  }
  for (let i = 0; i < 40; i++) px(x, Math.floor(r() * 32), Math.floor(r() * 32), 1, 1, r() < 0.5 ? '#e6d8c6' : '#b8a690');
  px(x, 20, 6, 6, 4, '#9a8e88'); // chimenea / caseta
  px(x, 20, 10, 6, 1, '#6a5a60');
  px(x, 5, 22, 3, 3, '#8c8c96'); // depósito
  return c;
}

export interface FacadeSet {
  eixample: THREE.Texture;
  modern: THREE.Texture;
  plain: THREE.Texture;
  shops: THREE.Texture;
  roof: THREE.Texture;
}

export function makeFacades(): FacadeSet {
  return {
    eixample: pixelTexture(facadeEixample()),
    modern: pixelTexture(facadeModern()),
    plain: pixelTexture(facadePlain()),
    shops: pixelTexture(shopfront()),
    roof: pixelTexture(roof()),
  };
}

// ----------------------------------------------------------------- sprites

export interface SpriteRect { u: number; v: number; w: number; h: number }

export interface SpriteAtlas {
  texture: THREE.Texture;
  rects: Record<string, SpriteRect>;
}

const ATLAS = 256;

function drawPlatan(x: CanvasRenderingContext2D, ox: number, oy: number) {
  // Plátano de sombra, el árbol del Eixample.
  const r = rng(21);
  px(x, ox + 22, oy + 36, 4, 28, '#9c9a80');
  px(x, ox + 22, oy + 40, 2, 6, '#c8c4a0');
  px(x, ox + 24, oy + 50, 2, 5, '#7a7660');
  px(x, ox + 18, oy + 38, 4, 2, '#9c9a80');
  px(x, ox + 26, oy + 34, 5, 2, '#9c9a80');
  const greens = ['#2c5e2a', '#3a7a30', '#4f9636', '#68b040', '#8ccf5a'];
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    const cx = 24 + Math.cos(a) * d * 22, cy = 22 + Math.sin(a) * d * 18;
    const light = (24 - cx) * 0.03 + (22 - cy) * 0.05 + r() * 1.2;
    const g = greens[Math.max(0, Math.min(4, Math.floor(1.4 + light * 1.6)))];
    px(x, ox + Math.floor(cx), oy + Math.floor(cy), 2, 2, g);
  }
}

function drawPalm(x: CanvasRenderingContext2D, ox: number, oy: number) {
  const r = rng(5);
  for (let y = 18; y < 64; y++) {
    const bend = Math.round(Math.sin(y / 18) * 2);
    px(x, ox + 23 + bend, oy + y, 3, 1, y % 3 ? '#9a7048' : '#6e4c32');
  }
  const greens = ['#2e6a2c', '#3f8a34', '#5aa840', '#7cc44e'];
  for (let f = 0; f < 9; f++) {
    const a = (f / 9) * Math.PI * 2 + r() * 0.3;
    for (let t = 0; t < 22; t++) {
      const fx = 24 + Math.cos(a) * t;
      const fy = 18 + Math.sin(a) * t * 0.55 + (t * t) / 40;
      px(x, ox + Math.round(fx), oy + Math.round(fy), 2, 1, greens[(f + (t > 12 ? 1 : 0)) % 4]);
      if (t % 3 === 0) px(x, ox + Math.round(fx), oy + Math.round(fy) + 1, 1, 2, greens[(f + 2) % 4]);
    }
  }
  px(x, ox + 22, oy + 17, 5, 3, '#6a4a2a');
}

const SKIN = ['#f0c8a0', '#c89070', '#8a5a3a', '#f4d8b8'];
const SHIRTS = ['#e84a5f', '#2a8ad8', '#f4d24a', '#f0f0f0', '#4ac08a', '#9a4ad8', '#202030', '#ff8a3a'];
const PANTS = ['#2a3a6a', '#3a3a3a', '#c8b89a', '#5a3a2a'];
const HAIR = ['#2a1a10', '#6a3a1a', '#d8b050', '#1a1a1a', '#9a9a9a'];

function drawPed(x: CanvasRenderingContext2D, ox: number, oy: number, v: number, back: boolean, step: number) {
  const skin = SKIN[v % 4], shirt = SHIRTS[(v * 3) % 8], pants = PANTS[(v * 5) % 4], hair = HAIR[(v * 7) % 5];
  // piernas
  const l = step ? 1 : 0;
  px(x, ox + 5, oy + 20, 2, 9 - l, pants);
  px(x, ox + 9, oy + 20, 2, 8 + l, pants);
  px(x, ox + 5, oy + 29 - l, 2, 2, '#1a1a1a');
  px(x, ox + 9, oy + 28 + l, 2, 2, '#1a1a1a');
  // torso y brazos
  px(x, ox + 4, oy + 10, 8, 10, shirt);
  px(x, ox + 3, oy + 11 + l, 1, 7, shirt);
  px(x, ox + 12, oy + 12 - l, 1, 7, shirt);
  px(x, ox + 3, oy + 18 + l, 1, 2, skin);
  px(x, ox + 12, oy + 19 - l, 1, 2, skin);
  // cabeza
  px(x, ox + 5, oy + 3, 6, 7, skin);
  px(x, ox + 5, oy + 2, 6, 2, hair);
  if (back) px(x, ox + 5, oy + 3, 6, 5, hair);
  else {
    px(x, ox + 6, oy + 6, 1, 1, '#1a1a2a');
    px(x, ox + 9, oy + 6, 1, 1, '#1a1a2a');
    if (v % 3 === 0) px(x, ox + 4, oy + 3, 1, 5, hair);
  }
}

export function makeSprites(): SpriteAtlas {
  const [c, x] = canvas(ATLAS, ATLAS);
  const rects: Record<string, SpriteRect> = {};
  const add = (name: string, ox: number, oy: number, w: number, h: number) => {
    // v invertida: el canvas crece hacia abajo, la textura hacia arriba
    rects[name] = { u: ox / ATLAS, v: 1 - (oy + h) / ATLAS, w: w / ATLAS, h: h / ATLAS };
  };
  drawPlatan(x, 0, 0);
  add('platan', 0, 0, 48, 64);
  drawPalm(x, 48, 0);
  add('palm', 48, 0, 48, 64);
  // peatones: 8 variantes × (frente 0/1, espalda 0/1)
  for (let v = 0; v < 8; v++)
    for (let f = 0; f < 4; f++) {
      const ox = f * 16 + (v % 4) * 64, oy = 64 + Math.floor(v / 4) * 32;
      drawPed(x, ox, oy, v, f >= 2, f % 2);
      add(`ped${v}_${f}`, ox, oy, 16, 32);
    }
  const t = pixelTexture(c, false);
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return { texture: t, rects };
}
