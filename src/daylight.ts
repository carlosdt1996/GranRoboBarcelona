import * as THREE from 'three';

const RAD = Math.PI / 180;
const LAT = 41.39, LON = 2.17; // Barcelona

/** Posición del sol (grados): azimut desde el norte en sentido horario y elevación sobre el horizonte. */
export function sunPosition(date: Date) {
  const d = date.getTime() / 86400000 - 10957.5; // días desde J2000
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + LON) * RAD - ra;
  const lat = LAT * RAD;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  let az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H)) / RAD;
  az = (az + 360) % 360;
  return { az, el: el / RAD };
}

export interface SkyPalette {
  skyTop: string; sky1: string; sky2: string; sky3: string; sky4: string; horizon: string;
  fog: string; sea: string; mountain: string; mountainFar: string;
  sunTop: string; sunMid: string; sunLow: string; cloud: string; cloudLit: string;
  /** Multiplicador de color de todo lo que no brilla por sí mismo. */
  grade: [number, number, number];
  /** 0 de día .. 1 de noche cerrada (estrellas, farolas, ventanas encendidas). */
  night: number;
}

type Key = Omit<SkyPalette, 'night'> & { el: number; night: number };

/** Paletas por elevación del sol; entre dos se interpola. */
const KEYS: Key[] = [
  {
    el: -12, night: 1, grade: [0.3, 0.33, 0.56],
    skyTop: '#05061a', sky1: '#0a0c28', sky2: '#11143a', sky3: '#181c4a', sky4: '#20265a', horizon: '#2c3070',
    fog: '#1c2048', sea: '#0a1236', mountain: '#0a0a22', mountainFar: '#12163a',
    sunTop: '#f0f0ff', sunMid: '#d8d8f0', sunLow: '#b8b8e0', cloud: '#141838', cloudLit: '#22285a',
  },
  {
    el: -4, night: 0.65, grade: [0.55, 0.5, 0.78],
    skyTop: '#140f44', sky1: '#251a60', sky2: '#4a2478', sky3: '#7a3080', sky4: '#a8407a', horizon: '#d86070',
    fog: '#7a4a7a', sea: '#1e2a78', mountain: '#2a1440', mountainFar: '#4a2458',
    sunTop: '#ffd0a0', sunMid: '#ff8a60', sunLow: '#ff4a6a', cloud: '#3a2060', cloudLit: '#a04a78',
  },
  {
    // la hora dorada: el atardecer OutRun original
    el: 5, night: 0, grade: [1, 1, 1],
    skyTop: '#1d1650', sky1: '#3a1f72', sky2: '#7a2b8c', sky3: '#c8457f', sky4: '#f4707a', horizon: '#ffa36c',
    fog: '#e9867f', sea: '#2f3f9a', mountain: '#5b2a6e', mountainFar: '#8a3f7c',
    sunTop: '#fff3a0', sunMid: '#ffb347', sunLow: '#ff5f7e', cloud: '#a03a88', cloudLit: '#ff9a8a',
  },
  {
    el: 20, night: 0, grade: [0.94, 1.0, 1.1],
    skyTop: '#2a58c8', sky1: '#3a70dc', sky2: '#4c88e8', sky3: '#68a2f0', sky4: '#8cbcf4', horizon: '#c4dcf4',
    fog: '#b8cce0', sea: '#2a62c0', mountain: '#4a6a8a', mountainFar: '#7a94b0',
    sunTop: '#ffffff', sunMid: '#fff8d0', sunLow: '#fff0a0', cloud: '#e8f0ff', cloudLit: '#ffffff',
  },
];

const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function mixHex(a: string, b: string, t: number) {
  return '#' + tmpA.set(a).lerp(tmpB.set(b), t).getHexString();
}

/** Paleta del cielo y la corrección de color para una elevación del sol. */
export function paletteFor(el: number): SkyPalette {
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (el - a.el) / (b.el - a.el)));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(a) as (keyof Key)[]) {
    if (k === 'el') continue;
    const va = a[k], vb = b[k];
    if (typeof va === 'string') out[k] = mixHex(va, vb as string, t);
    else if (typeof va === 'number') out[k] = va + ((vb as number) - va) * t;
    else out[k] = (va as number[]).map((v, j) => v + ((vb as number[])[j] - v) * t);
  }
  return out as unknown as SkyPalette;
}

/**
 * Blending que copia el alfa tal cual: en este juego el alfa de la imagen marca lo que brilla por sí
 * mismo (0 = luz propia: ventanas encendidas, faros, cielo, fuego) frente a lo que ilumina el sol (1).
 * La corrección de color de la noche (Pixelator) solo oscurece lo segundo.
 */
export function passAlpha<T extends THREE.Material>(m: T, opacity?: number): T {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.ZeroFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.ZeroFactor;
  if (opacity !== undefined) m.opacity = opacity;
  return m;
}

/** Igual, para materiales semitransparentes que deben brillar (GPS): mezcla el color y deja alfa 0. */
export function glowBlend<T extends THREE.Material>(m: T): T {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.ZeroFactor;
  return m;
}
