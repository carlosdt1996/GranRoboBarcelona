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

/** Luz propia: color con alfa bajo (el alfa marca lo que brilla; ver daylight.ts). */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, a = 0.25) {
  ctx.clearRect(x, y, w, h);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
  ctx.fillRect(x, y, w, h);
}

// Las texturas se tiñen con color de vértice: los tonos claros toman el color del edificio.
const BAY = 16; // píxeles por crujía (≈3 m)
const FLOOR = 18; // píxeles por planta (≈3.3 m)
export const VARIANTS = 4;

/** Fachada de piso del Eixample: balconeras con persianas y barandillas de hierro. */
function facadeEixample(night = false, cv?: HTMLCanvasElement) {
  const [c, x] = cv ? [cv, cv.getContext('2d')!] : canvas(BAY * VARIANTS, FLOOR);
  x.clearRect(0, 0, c.width, c.height);
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
    } else if (v === 3 && !night) {
      px(x, o + 6, 6, 4, 8, '#f0c070'); // luz encendida
      px(x, o + 6, 6, 4, 1, '#ffe0a0');
    }
    if (night && v !== 1) {
      // de noche: ventanas encendidas (la de persiana a medio bajar, solo por debajo)
      glow(x, o + 5, v === 2 ? 9 : 4, 6, v === 2 ? 6 : 11, v === 3 ? '#ffd890' : '#ffc870');
      px(x, o + 7, v === 2 ? 9 : 5, 1, v === 2 ? 6 : 10, '#a07040'); // marco
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
function facadeModern(night = false, cv?: HTMLCanvasElement) {
  const [c, x] = cv ? [cv, cv.getContext('2d')!] : canvas(BAY * VARIANTS, FLOOR);
  x.clearRect(0, 0, c.width, c.height);
  for (let v = 0; v < VARIANTS; v++) {
    const o = v * BAY;
    px(x, o, 0, BAY, FLOOR, '#d4d4dc');
    for (let y = 3; y < 16; y++) {
      const t = (y - 3) / 13;
      const col = night ? (t < 0.5 ? '#262a52' : '#1c1f40') : t < 0.3 ? '#e88aa0' : t < 0.55 ? '#9a6ab8' : '#43478a';
      px(x, o, y, BAY, 1, col);
    }
    px(x, o + 7 + (v % 2), 3, 1, 13, '#e6e6ee');
    px(x, o + 15, 3, 1, 13, '#e6e6ee');
    if (v === 2 && !night) px(x, o + 2, 9, 4, 5, '#f4c070');
    if (night && v !== 1) glow(x, o + (v === 3 ? 9 : 1), 4, 6, 11, v === 0 ? '#e8f0ff' : '#ffe0a0');
  }
  return c;
}

/** Edificio sencillo: ventanas pequeñas con persiana. */
function facadePlain(night = false, cv?: HTMLCanvasElement) {
  const [c, x] = cv ? [cv, cv.getContext('2d')!] : canvas(BAY * VARIANTS, FLOOR);
  x.clearRect(0, 0, c.width, c.height);
  const r = rng(7);
  for (let v = 0; v < VARIANTS; v++) {
    const o = v * BAY;
    px(x, o, 0, BAY, FLOOR, '#efe6da');
    for (let i = 0; i < 8; i++) px(x, o + Math.floor(r() * BAY), Math.floor(r() * FLOOR), 1, 1, '#e2d8ca');
    px(x, o + 5, 6, 6, 7, '#2e3256');
    px(x, o + 5, 6, 6, 1, '#7d6aa8');
    if (v % 2) px(x, o + 5, 6, 6, 4, '#c58a50');
    if (night && v !== 3) glow(x, o + 5, v % 2 ? 10 : 6, 6, v % 2 ? 3 : 7, '#ffc870');
    px(x, o + 4, 13, 8, 1, '#d6cab8');
  }
  return c;
}

/** Planta baja: comercios con escaparates y toldos. */
function shopfront(night = false, cv?: HTMLCanvasElement) {
  const H = 24;
  const [c, x] = cv ? [cv, cv.getContext('2d')!] : canvas(BAY * VARIANTS, H);
  x.clearRect(0, 0, c.width, c.height);
  const awn = [['#d8333a', '#f4f0e8'], ['#2f8a4a', '#f4f0e8'], ['#2a4fa0', '#f2d24a'], ['#7a2a7a', '#f4c0e0']];
  for (let v = 0; v < VARIANTS; v++) {
    const o = v * BAY;
    px(x, o, 0, BAY, H, '#d9ccb6');
    for (let y = 3; y < H; y += 4) px(x, o, y, BAY, 1, '#c6b8a0'); // almohadillado
    if (v === 3) {
      // portal de vecinos
      px(x, o + 4, 6, 8, 18, '#4a2e22');
      px(x, o + 5, 7, 6, 6, '#c89a50');
      if (night) glow(x, o + 5, 7, 6, 6, '#ffd890', 0.3);
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
    if (night) {
      // escaparate y rótulo iluminados
      glow(x, o + 1, 10, 14, 14, '#ffd27a', 0.3);
      px(x, o + 2, 16, 4, 8, '#e8a85a');
      px(x, o + 7, 10, 1, 14, '#5a4a40');
      glow(x, o + 2, 1, 12, 3, v === 0 ? '#ff4aa0' : v === 1 ? '#f4e9d0' : '#ff5a5a', 0.15);
    }
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
  night: boolean;
  setNight(on: boolean): void;
}

export function makeFacades(): FacadeSet {
  const draw: [keyof FacadeSet, (night: boolean, cv?: HTMLCanvasElement) => HTMLCanvasElement][] = [
    ['eixample', facadeEixample], ['modern', facadeModern], ['plain', facadePlain], ['shops', shopfront],
  ];
  const set = {
    eixample: pixelTexture(facadeEixample()),
    modern: pixelTexture(facadeModern()),
    plain: pixelTexture(facadePlain()),
    shops: pixelTexture(shopfront()),
    roof: pixelTexture(roof()),
    night: false,
    /** Ventanas y escaparates encendidos (de noche) o apagados. */
    setNight(on: boolean) {
      if (on === set.night) return;
      set.night = on;
      for (const [k, fn] of draw) {
        const t = set[k] as THREE.CanvasTexture;
        fn(on, t.image as HTMLCanvasElement);
        t.needsUpdate = true;
      }
    },
  };
  return set;
}

// ----------------------------------------------------------------- sprites

export interface SpriteRect { u: number; v: number; w: number; h: number }

export interface SpriteAtlas {
  texture: THREE.Texture;
  rects: Record<string, SpriteRect>;
}

const ATLAS = 256;

function drawPine(x: CanvasRenderingContext2D, ox: number, oy: number) {
  // Pino piñonero: copa en parasol sobre un tronco alto y torcido (Montjuïc, Collserola).
  const r = rng(33);
  px(x, ox + 23, oy + 28, 3, 36, '#7a5a48');
  px(x, ox + 22, oy + 40, 2, 10, '#8a6a52');
  px(x, ox + 25, oy + 30, 6, 2, '#7a5a48');
  px(x, ox + 17, oy + 33, 6, 2, '#7a5a48');
  const greens = ['#1e4626', '#2a5a2e', '#3a6e34', '#4f8a3e', '#6aa64a'];
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    const cx = 24 + Math.cos(a) * d * 23, cy = 20 + Math.sin(a) * d * 9 - (1 - d) * 4;
    const light = (24 - cx) * 0.02 + (20 - cy) * 0.12 + r() * 1.1;
    const g = greens[Math.max(0, Math.min(4, Math.floor(1.2 + light * 1.5)))];
    px(x, ox + Math.floor(cx), oy + Math.floor(cy), 2, 2, g);
  }
}

function drawOak(x: CanvasRenderingContext2D, ox: number, oy: number) {
  // Encina: copa redonda, densa y oscura.
  const r = rng(47);
  px(x, ox + 22, oy + 44, 4, 20, '#5e5048');
  const greens = ['#1a3a22', '#244a2a', '#305c32', '#3e703a', '#56884a'];
  for (let i = 0; i < 560; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    const cx = 24 + Math.cos(a) * d * 20, cy = 28 + Math.sin(a) * d * 18;
    const light = (24 - cx) * 0.03 + (28 - cy) * 0.05 + r() * 1.2;
    const g = greens[Math.max(0, Math.min(4, Math.floor(1.2 + light * 1.5)))];
    px(x, ox + Math.floor(cx), oy + Math.floor(cy), 2, 2, g);
  }
}

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

/** El protagonista: chupa roja, camiseta blanca, vaqueros y gafas de sol. */
function drawPlayer(x: CanvasRenderingContext2D, ox: number, oy: number, back: boolean, step: number, aim: boolean) {
  const skin = '#e8b890', jacket = '#d8202a', jacketD = '#9a1018', jeans = '#2a4a8a', hair = '#2a1a10';
  const l = step ? 1 : 0;
  px(x, ox + 5, oy + 20, 2, 9 - l, jeans);
  px(x, ox + 9, oy + 20, 2, 8 + l, jeans);
  px(x, ox + 5, oy + 29 - l, 2, 2, '#1a1a1a');
  px(x, ox + 9, oy + 28 + l, 2, 2, '#1a1a1a');
  px(x, ox + 4, oy + 10, 8, 10, jacket);
  if (!back) px(x, ox + 7, oy + 10, 2, 9, '#f4f4f4'); // camiseta
  px(x, ox + 4, oy + 18, 8, 2, jacketD);
  if (aim) {
    // brazos estirados con la pistola
    px(x, ox + 3, oy + 11, 1, 3, jacket);
    px(x, ox + 12, oy + 11, 1, 3, jacket);
    px(x, ox + 6, oy + 12, 4, 2, jacket);
    px(x, ox + 7, oy + 11, 2, 1, skin);
    px(x, ox + 7, oy + 9, 2, 2, '#2a2a30');
  } else {
    px(x, ox + 3, oy + 11 + l, 1, 7, jacket);
    px(x, ox + 12, oy + 12 - l, 1, 7, jacket);
    px(x, ox + 3, oy + 18 + l, 1, 2, skin);
    px(x, ox + 12, oy + 19 - l, 1, 2, skin);
    px(x, ox + 13, oy + 18 - l, 1, 3, '#2a2a30'); // pistola en la mano
  }
  px(x, ox + 5, oy + 3, 6, 7, skin);
  px(x, ox + 5, oy + 1, 6, 3, hair);
  if (back) px(x, ox + 5, oy + 3, 6, 5, hair);
  else px(x, ox + 5, oy + 5, 6, 2, '#101018'); // gafas de sol
}

/** Agente de policía: uniforme azul marino con franja roja, gorra y pistola. */
function drawCop(x: CanvasRenderingContext2D, ox: number, oy: number, back: boolean, step: number, aim: boolean) {
  const skin = '#e0b088', blue = '#1a2a5a', blueL = '#2a3e7a', red = '#d8202a', black = '#141418';
  const l = step ? 1 : 0;
  px(x, ox + 5, oy + 20, 2, 9 - l, blue);
  px(x, ox + 9, oy + 20, 2, 8 + l, blue);
  px(x, ox + 5, oy + 29 - l, 2, 2, black);
  px(x, ox + 9, oy + 28 + l, 2, 2, black);
  px(x, ox + 4, oy + 10, 8, 10, blueL);
  px(x, ox + 4, oy + 14, 8, 1, red);
  px(x, ox + 4, oy + 18, 8, 2, black); // cinturón
  if (aim) {
    px(x, ox + 6, oy + 12, 4, 2, blueL);
    px(x, ox + 7, oy + 11, 2, 1, skin);
    px(x, ox + 7, oy + 9, 2, 2, black);
  } else {
    px(x, ox + 3, oy + 11 + l, 1, 7, blueL);
    px(x, ox + 12, oy + 12 - l, 1, 7, blueL);
    px(x, ox + 3, oy + 18 + l, 1, 2, skin);
    px(x, ox + 12, oy + 19 - l, 1, 2, skin);
  }
  px(x, ox + 5, oy + 3, 6, 7, skin);
  px(x, ox + 4, oy + 1, 8, 3, blue); // gorra
  px(x, ox + 4, oy + 3, 8, 1, back ? blue : black);
  if (back) px(x, ox + 5, oy + 4, 6, 3, '#3a2a1a');
  else { px(x, ox + 6, oy + 6, 1, 1, '#1a1a2a'); px(x, ox + 9, oy + 6, 1, 1, '#1a1a2a'); }
}

/** Peatón tendido en el suelo (sprite apaisado). */
function drawLying(x: CanvasRenderingContext2D, ox: number, oy: number, shirt: string, pants: string) {
  px(x, ox + 2, oy + 9, 7, 5, '#e8b890');
  px(x, ox + 9, oy + 8, 11, 7, shirt);
  px(x, ox + 20, oy + 9, 10, 2, pants);
  px(x, ox + 20, oy + 12, 9, 2, pants);
}

function blob(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, cols: string[], seed: number) {
  const rr = rng(seed);
  for (let i = 0; i < r * r * 3; i++) {
    const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * r;
    const k = d / r;
    px(x, Math.floor(cx + Math.cos(a) * d), Math.floor(cy + Math.sin(a) * d), 2, 2, cols[Math.min(cols.length - 1, Math.floor(k * cols.length + rr() * 0.6))]);
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
  drawPine(x, 96, 0);
  add('pine', 96, 0, 48, 64);
  drawOak(x, 144, 0);
  add('oak', 144, 0, 48, 64);
  // peatones: 8 variantes × (frente 0/1, espalda 0/1)
  for (let v = 0; v < 8; v++)
    for (let f = 0; f < 4; f++) {
      const ox = f * 16 + (v % 4) * 64, oy = 64 + Math.floor(v / 4) * 32;
      drawPed(x, ox, oy, v, f >= 2, f % 2);
      add(`ped${v}_${f}`, ox, oy, 16, 32);
    }
  // protagonista (fila 128)
  const pf: [string, boolean, number, boolean][] = [['front0', false, 0, false], ['front1', false, 1, false], ['back0', true, 0, false], ['back1', true, 1, false], ['backAim', true, 0, true], ['frontAim', false, 0, true]];
  pf.forEach(([n, back, st, aim], i) => { drawPlayer(x, i * 16, 128, back, st, aim); add(`hero_${n}`, i * 16, 128, 16, 32); });
  drawLying(x, 96, 128, '#d8202a', '#2a4a8a');
  add('hero_down', 96, 128, 32, 16);
  for (let v = 0; v < 8; v++) {
    drawLying(x, 128 + (v % 4) * 32, 128 + Math.floor(v / 4) * 16, SHIRTS[(v * 3) % 8], PANTS[(v * 5) % 4]);
    add(`ped${v}_down`, 128 + (v % 4) * 32, 128 + Math.floor(v / 4) * 16, 32, 16);
  }
  // policía (fila 224)
  pf.forEach(([n, back, st, aim], i) => { drawCop(x, i * 16, 224, back, st, aim); add(`cop_${n}`, i * 16, 224, 16, 32); });
  drawLying(x, 96, 224, '#2a3e7a', '#1a2a5a');
  add('cop_down', 96, 224, 32, 16);
  // objetos que se recogen (16×16, fila 224 desde x = 128)
  const heart = [[3, 2, 4, 2], [9, 2, 4, 2], [2, 4, 12, 4], [3, 8, 10, 2], [5, 10, 6, 2], [7, 12, 2, 2]];
  for (const [a, b, w, h] of heart) px(x, 128 + a, 224 + b, w, h, '#ff2a4a');
  px(x, 132, 228, 2, 2, '#ffb0c0');
  add('pk_health', 128, 224, 16, 16);
  px(x, 147, 226, 10, 12, '#3a4a6a'); px(x, 145, 226, 3, 4, '#3a4a6a'); px(x, 156, 226, 3, 4, '#3a4a6a');
  px(x, 150, 226, 4, 3, '#1a1e2a'); px(x, 148, 231, 8, 1, '#8a9ab8'); px(x, 148, 234, 8, 1, '#8a9ab8');
  add('pk_armor', 144, 224, 16, 16);
  px(x, 161, 229, 14, 8, '#2a8a3a'); px(x, 162, 230, 12, 6, '#5ac86a'); px(x, 166, 231, 4, 4, '#2a8a3a'); px(x, 167, 232, 2, 2, '#c8f0a0');
  add('pk_cash', 160, 224, 16, 16);
  px(x, 178, 228, 12, 10, '#a8783a'); px(x, 178, 228, 12, 2, '#c8985a'); px(x, 183, 228, 2, 10, '#e8d8a0'); px(x, 178, 232, 12, 2, '#e8d8a0');
  add('pk_package', 176, 224, 16, 16);
  px(x, 193, 230, 14, 8, '#4a5a3a'); px(x, 193, 230, 14, 1, '#6a7a4a'); px(x, 196, 232, 8, 3, '#2a2a30'); px(x, 197, 228, 6, 2, '#2a2a30');
  add('pk_weapon', 192, 224, 16, 16);

  // efectos (fila 160): fogonazo, chispa, sangre, humo, fuego y explosión
  blob(x, 8, 168, 6, ['#ffffff', '#fff4a0', '#ffb020'], 3);
  add('fx_flash', 0, 160, 16, 16);
  blob(x, 20, 164, 3, ['#ffffff', '#ffe060'], 4);
  add('fx_spark', 16, 160, 8, 8);
  blob(x, 28, 164, 3, ['#c8102a', '#8a0818'], 5);
  add('fx_blood', 24, 160, 8, 8);
  blob(x, 40, 168, 7, ['#8a7a90', '#6a5a72', '#4a3a52'], 6);
  add('fx_smoke', 32, 160, 16, 16);
  for (let f = 0; f < 2; f++) {
    blob(x, 56 + f * 16, 174 - f, 6, ['#fff4a0', '#ffb020', '#ff5a20', '#c82018'], 7 + f);
    blob(x, 56 + f * 16, 168 + f, 4, ['#fff4a0', '#ffb020', '#ff5a20'], 9 + f);
    add(`fx_fire${f}`, 48 + f * 16, 160, 16, 24);
  }
  // granada (8×8) y cohete (16×8)
  px(x, 81, 162, 6, 5, '#3a4a2a');
  px(x, 82, 161, 4, 1, '#5a6a3a');
  px(x, 83, 160, 2, 1, '#8a8a8a');
  px(x, 82, 163, 1, 2, '#6a7a4a');
  add('fx_grenade', 80, 160, 8, 8);
  px(x, 88, 163, 3, 2, '#ffb020');
  px(x, 91, 162, 9, 4, '#6a6a5a');
  px(x, 100, 162, 3, 4, '#c82018');
  px(x, 92, 161, 2, 1, '#4a4a3a');
  px(x, 92, 166, 2, 1, '#4a4a3a');
  add('fx_rocket', 88, 160, 16, 8);
  for (let f = 0; f < 4; f++) {
    const r = 6 + f * 3;
    const cols = f < 2 ? ['#ffffff', '#fff4a0', '#ffb020', '#ff5a20'] : ['#ffb020', '#ff5a20', '#8a3040', '#4a3a52'];
    blob(x, 16 + f * 32, 208, r, cols, 20 + f);
    add(`fx_boom${f}`, f * 32, 192, 32, 32);
  }
  const t = pixelTexture(c, false);
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return { texture: t, rects };
}
