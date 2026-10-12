import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ModelKind = 'player' | 'sedan' | 'taxi' | 'van' | 'bus';

interface Part { w: number; h: number; l: number; x: number; y: number; z: number; c: string; rx?: number }

const GLASS = '#232a48', WHEEL = '#16141c', LIGHT_F = '#fff2b0', LIGHT_R = '#ff2a3a';

function wheels(track: number, base: number, r = 0.33, w = 0.3): Part[] {
  const out: Part[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ w, h: r * 2, l: r * 2, x: sx * track, y: r, z: sz * base, c: WHEEL });
  return out;
}

function parts(kind: ModelKind, body: string): Part[] {
  switch (kind) {
    case 'player': // descapotable rojo de los 80
      return [
        ...wheels(0.86, 1.35, 0.33, 0.32),
        { w: 1.9, h: 0.5, l: 4.4, x: 0, y: 0.58, z: 0, c: body },
        { w: 1.92, h: 0.16, l: 1.7, x: 0, y: 0.6, z: -0.35, c: '#7a0c18' }, // tomas laterales
        { w: 1.82, h: 0.16, l: 1.5, x: 0, y: 0.9, z: 1.38, c: body },
        { w: 1.86, h: 0.3, l: 1.5, x: 0, y: 0.96, z: -1.4, c: body },
        { w: 1.6, h: 0.3, l: 1.4, x: 0, y: 0.86, z: -0.05, c: '#2a1418' }, // habitáculo
        { w: 0.5, h: 0.55, l: 0.22, x: -0.38, y: 1.12, z: -0.55, c: '#d8b070' }, // asientos
        { w: 0.5, h: 0.55, l: 0.22, x: 0.38, y: 1.12, z: -0.55, c: '#d8b070' },
        { w: 0.26, h: 0.3, l: 0.26, x: -0.38, y: 1.36, z: -0.25, c: '#5a361c' }, // conductor
        { w: 0.3, h: 0.34, l: 0.3, x: 0.38, y: 1.36, z: -0.3, c: '#f4d860' }, // copiloto rubia
        { w: 1.62, h: 0.42, l: 0.06, x: 0, y: 1.12, z: 0.62, c: '#a8d8f4', rx: -0.45 }, // parabrisas
        { w: 1.76, h: 0.14, l: 0.05, x: 0, y: 0.78, z: -2.2, c: LIGHT_R },
        { w: 1.5, h: 0.14, l: 0.05, x: 0, y: 0.6, z: -2.2, c: '#1a1018' },
        { w: 0.5, h: 0.12, l: 0.04, x: 0, y: 0.45, z: -2.21, c: '#f4f4f4' },
        { w: 0.42, h: 0.1, l: 0.05, x: -0.6, y: 0.72, z: 2.2, c: LIGHT_F },
        { w: 0.42, h: 0.1, l: 0.05, x: 0.6, y: 0.72, z: 2.2, c: LIGHT_F },
      ];
    case 'sedan':
    case 'taxi': {
      const p: Part[] = [
        ...wheels(0.8, 1.3),
        { w: 1.78, h: 0.6, l: 4.3, x: 0, y: 0.62, z: 0, c: body },
        { w: 1.58, h: 0.52, l: 2.1, x: 0, y: 1.17, z: -0.25, c: GLASS },
        { w: 1.54, h: 0.08, l: 1.8, x: 0, y: 1.46, z: -0.3, c: body },
        { w: 1.6, h: 0.12, l: 0.05, x: 0, y: 0.78, z: -2.16, c: LIGHT_R },
        { w: 0.38, h: 0.12, l: 0.05, x: -0.6, y: 0.76, z: 2.16, c: LIGHT_F },
        { w: 0.38, h: 0.12, l: 0.05, x: 0.6, y: 0.76, z: 2.16, c: LIGHT_F },
      ];
      if (kind === 'taxi') {
        p.push({ w: 1.82, h: 0.42, l: 2.0, x: 0, y: 0.66, z: -0.15, c: '#f4c418' }); // puertas amarillas
        p.push({ w: 0.36, h: 0.14, l: 0.2, x: 0.4, y: 1.56, z: 0.2, c: '#38ff70' }); // luz verde "lliure"
      }
      return p;
    }
    case 'van':
      return [
        ...wheels(0.86, 1.6, 0.36),
        { w: 1.95, h: 1.7, l: 4.9, x: 0, y: 1.15, z: -0.1, c: body },
        { w: 1.8, h: 0.6, l: 0.06, x: 0, y: 1.55, z: 2.35, c: GLASS },
        { w: 1.97, h: 0.5, l: 1.0, x: 0, y: 1.55, z: 1.6, c: GLASS },
        { w: 1.7, h: 0.14, l: 0.05, x: 0, y: 0.8, z: -2.56, c: LIGHT_R },
      ];
    case 'bus': // autobús de TMB
      return [
        ...wheels(1.1, 3.6, 0.5, 0.35),
        { w: 2.5, h: 2.6, l: 12, x: 0, y: 1.75, z: 0, c: body },
        { w: 2.52, h: 0.95, l: 10.4, x: 0, y: 2.25, z: -0.4, c: GLASS },
        { w: 2.3, h: 1.4, l: 0.06, x: 0, y: 2.0, z: 6.0, c: GLASS },
        { w: 2.4, h: 0.2, l: 11.8, x: 0, y: 3.12, z: 0, c: '#f2f2f2' },
        { w: 1.6, h: 0.3, l: 0.06, x: 0, y: 2.85, z: 6.02, c: '#ffb020' },
        { w: 2.2, h: 0.14, l: 0.05, x: 0, y: 0.8, z: -6.02, c: LIGHT_R },
      ];
  }
}

const cache = new Map<string, THREE.BufferGeometry>();
const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const shadowMat = new THREE.MeshBasicMaterial({ color: '#341450', transparent: true, opacity: 0.45, depthWrite: false });

export const DIMENSIONS: Record<ModelKind, { length: number; width: number }> = {
  player: { length: 4.4, width: 1.9 },
  sedan: { length: 4.3, width: 1.8 },
  taxi: { length: 4.3, width: 1.8 },
  van: { length: 4.9, width: 1.95 },
  bus: { length: 12, width: 2.5 },
};

export function carGeometry(kind: ModelKind, body: string) {
  const key = kind + body;
  let g = cache.get(key);
  if (g) return g;
  const geos = parts(kind, body).map((p) => {
    const b = new THREE.BoxGeometry(p.w, p.h, p.l);
    if (p.rx) b.rotateX(p.rx);
    b.translate(p.x, p.y, -p.z); // +z del modelo = hacia delante = -Z en three
    const c = new THREE.Color(p.c);
    const n = b.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    b.setAttribute('color', new THREE.BufferAttribute(col, 3));
    b.deleteAttribute('uv');
    return b;
  });
  g = mergeGeometries(geos)!;
  cache.set(key, g);
  return g;
}

/** Coche con sombra suave en el suelo. Rumbo: rotation.y = -heading. */
export function createCarMesh(kind: ModelKind, body: string): THREE.Group {
  const grp = new THREE.Group();
  const d = DIMENSIONS[kind];
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(d.width + 0.5, d.length + 0.6).rotateX(-Math.PI / 2), shadowMat);
  sh.position.set(0.35, 0.03, 0.2);
  sh.renderOrder = 1;
  grp.add(sh);
  grp.add(new THREE.Mesh(carGeometry(kind, body), material));
  return grp;
}

export const BODY_COLORS = ['#f2f2f2', '#b8bcc8', '#202028', '#2a5ad8', '#d82a3a', '#f4d020', '#20a8a0', '#8a3ad8', '#f08a20', '#5a8a3a'];
