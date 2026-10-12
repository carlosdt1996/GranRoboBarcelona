// Paleta "atardecer OutRun" sobre Barcelona.

/** Sol al suroeste, sobre el Llobregat, bajo en el horizonte. */
export const SUN_AZIMUTH = (225 * Math.PI) / 180; // rumbo hacia el sol: al fondo de las calles del Eixample
export const SUN_ELEVATION = (32 * Math.PI) / 180;
export const SUN_DIR: [number, number] = [Math.sin(SUN_AZIMUTH), Math.cos(SUN_AZIMUTH)];

export const C = {
  skyTop: '#1d1650',
  sky1: '#3a1f72',
  sky2: '#7a2b8c',
  sky3: '#c8457f',
  sky4: '#f4707a',
  horizon: '#ffa36c',
  fog: '#e9867f',
  sunTop: '#fff3a0',
  sunMid: '#ffb347',
  sunLow: '#ff5f7e',
  mountain: '#5b2a6e',
  mountainFar: '#8a3f7c',
  sea: '#2f3f9a',

  sidewalk: '#b8aca4',
  sidewalkDot: '#a89c96',
  curb: '#d8d0c8',
  asphalt: '#3d3a52',
  asphaltDot: '#47445e',
  asphaltDark: '#34314a',
  marking: '#f2efe6',
  cycle: '#2f7d5c',
  grass: '#4f9a3a',
  grassDark: '#3f8030',
  grassLight: '#68b048',
  plaza: '#d8c39a',
  plazaDot: '#c8b088',
  pitch: '#3e8f50',
  water: '#3f9ad8',
  pool: '#52c8ee',
  sand: '#e9d295',
  shadow: 'rgba(52, 20, 92, 0.42)',
  under: '#4a3550',
};

/** Tonos de fachada típicos del Eixample (multiplican la textura). */
export const FACADE_TINTS = [
  [1.0, 0.93, 0.8],
  [0.98, 0.86, 0.7],
  [1.0, 0.82, 0.68],
  [0.93, 0.9, 0.86],
  [0.96, 0.78, 0.62],
  [0.9, 0.84, 0.76],
  [1.0, 0.9, 0.86],
  [0.86, 0.8, 0.74],
];

export const ROOF_TINTS = [
  [0.95, 0.78, 0.66],
  [0.86, 0.84, 0.82],
  [0.8, 0.62, 0.52],
  [0.94, 0.9, 0.86],
];

export const SUN_LIGHT = [1.18, 0.98, 0.82];
export const SHADE = [0.5, 0.42, 0.72];
