import * as THREE from 'three';
import type { WallGrid } from '../collision';
import type { World } from '../map';
import type { RoadGraph } from '../roads';
import { passAlpha } from '../daylight';
import { canvas, pixelTexture } from '../render/textures';
import { createCarMesh } from '../render/cars';
import { rng } from '../geom';
import { sidewalk } from './pickups';

export type RoomKind = 'piso' | 'bar' | 'nave' | 'mansion' | 'taller' | 'oficina' | 'armeria' | 'hospital' | 'comisaria';

export interface Room {
  id: string;
  kind: RoomKind;
  name: string;
  /** Puerta en la calle (x, y, rumbo hacia fuera). */
  door: [number, number, number];
  /** Esquina del interior (lejos de la ciudad, a 1000 m de altura) y tamaño. */
  ox: number;
  oy: number;
  w: number;
  d: number;
  /** Puntos de interés en coordenadas absolutas: salida, dónde está el jefe, cama/mostrador... */
  exit: [number, number];
  giver: [number, number];
  action: [number, number];
  group: THREE.Group;
}

export const FLOOR = 1000;
const SIZE: Record<RoomKind, [number, number]> = {
  piso: [10, 8], bar: [14, 10], nave: [22, 16], mansion: [16, 12], taller: [18, 12], oficina: [14, 10], armeria: [10, 8], hospital: [16, 10], comisaria: [14, 10],
};
const WALLS: Record<RoomKind, [string, string]> = {
  piso: ['#e8d8c0', '#b8a888'], bar: ['#8a3a3a', '#5a2a2a'], nave: ['#8a8a92', '#5a5a62'], mansion: ['#6a4a3a', '#3a2a22'], taller: ['#7a7a6a', '#4a4a3a'],
  oficina: ['#c8ccd8', '#8a90a0'], armeria: ['#5a5a4a', '#3a3a2a'], hospital: ['#e8f0f4', '#a8c0d0'], comisaria: ['#c8ccd8', '#2a3a6a'],
};
const FLOORS: Record<RoomKind, [string, string]> = {
  piso: ['#c8a070', '#b08858'], bar: ['#d8ccb0', '#a8987a'], nave: ['#6a6a6a', '#5a5a5a'], mansion: ['#8a2a2a', '#6a1a1a'], taller: ['#5a5a5a', '#4a4a4a'],
  oficina: ['#9a9aa8', '#8a8a98'], armeria: ['#7a6a5a', '#6a5a4a'], hospital: ['#e8e8e8', '#c8d8e0'], comisaria: ['#9a9aa8', '#8a8a98'],
};

/** Caja con color por vértice en coordenadas del juego (x este, y norte, z arriba). */
function box(g: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, d: number, h: number, c: string, glow = false) {
  const b = new THREE.BoxGeometry(w, h, d);
  b.translate(x, z + h / 2, -y);
  const col = new THREE.Color(c), n = b.attributes.position.count, a = new Float32Array(n * 4);
  const pos = b.attributes.position;
  for (let i = 0; i < n; i++) {
    // un poco de sombreado: más oscuro abajo
    const k = 0.75 + 0.25 * ((pos.getY(i) - z) / (h || 1));
    a[i * 4] = col.r * k; a[i * 4 + 1] = col.g * k; a[i * 4 + 2] = col.b * k; a[i * 4 + 3] = glow ? 0 : 0.15; // casi todo con luz propia: los interiores están iluminados
  }
  b.setAttribute('color', new THREE.BufferAttribute(a, 4));
  b.deleteAttribute('uv');
  b.deleteAttribute('normal');
  g.push(b);
}

/** Baldosas del suelo (panot, parquet, moqueta...). */
function floorTexture(kind: RoomKind) {
  const [a, b] = FLOORS[kind];
  const [c, x] = canvas(16, 16);
  x.fillStyle = a; x.fillRect(0, 0, 16, 16);
  x.fillStyle = b;
  if (kind === 'piso') for (let i = 0; i < 16; i += 4) x.fillRect(0, i, 16, 1);
  else if (kind === 'mansion') { x.fillRect(0, 0, 16, 2); x.fillRect(0, 14, 16, 2); }
  else { x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8); }
  const t = pixelTexture(c);
  return t;
}

const mat = passAlpha(new THREE.MeshBasicMaterial({ vertexColors: true }));

/**
 * Interiores de los sitios importantes: piso franco, bares de los jefes, nave del Poblenou, mansión,
 * taller del puerto, armerías, hospitales y comisarías. Están lejos de la ciudad (a 1000 m de altura)
 * y se entra por una puerta en la calle con un fundido.
 */
export class Interiors {
  rooms: Room[] = [];
  readonly group = new THREE.Group();
  current: Room | null = null;

  constructor(private world: World, private graph: RoadGraph, private walls: WallGrid) {}

  add(id: string, kind: RoomKind, name: string, lon: number, lat: number): Room {
    const [w, d] = SIZE[kind];
    const i = this.rooms.length;
    const ox = 90000 + (i % 10) * 60, oy = 90000 + Math.floor(i / 10) * 60;
    const [x, y, a] = sidewalk(this.world, this.graph, lon, lat, 2.4);
    const room: Room = {
      id, kind, name, door: [x, y, a + Math.PI / 2], ox, oy, w, d,
      exit: [ox + w / 2, oy + 1.4], giver: [ox + w / 2, oy + d - 2.2],
      // la cama del piso franco (guardar) o el mostrador de la armería (comprar)
      action: kind === 'piso' ? [ox + w - 2, oy + d - 3.2] : kind === 'armeria' ? [ox + w / 2, oy + d - 3.3] : [ox + w - 2, oy + d / 2],
      group: new THREE.Group(),
    };
    this.build(room);
    room.group.visible = false;
    this.group.add(room.group);
    // paredes del interior
    const segs = [ox, oy, ox + w, oy, ox + w, oy, ox + w, oy + d, ox + w, oy + d, ox, oy + d, ox, oy + d, ox, oy];
    this.walls.addPart(`interior:${id}`, segs);
    this.rooms.push(room);
    return room;
  }

  private build(r: Room) {
    const g: THREE.BufferGeometry[] = [];
    const { ox, oy, w, d, kind } = r;
    const [wall, base] = WALLS[kind];
    const H = 3.6, z = FLOOR, rr = rng(r.id.length * 97 + w);
    // paredes, zócalo y techo
    box(g, ox + w / 2, oy - 0.1, z, w + 0.4, 0.2, H, wall);
    box(g, ox + w / 2, oy + d + 0.1, z, w + 0.4, 0.2, H, wall);
    box(g, ox - 0.1, oy + d / 2, z, 0.2, d, H, wall);
    box(g, ox + w + 0.1, oy + d / 2, z, 0.2, d, H, wall);
    for (const [x, y, ww, dd] of [[ox + w / 2, oy + 0.02, w, 0.06], [ox + w / 2, oy + d - 0.02, w, 0.06], [ox + 0.02, oy + d / 2, 0.06, d], [ox + w - 0.02, oy + d / 2, 0.06, d]])
      box(g, x, y, z, ww, dd, 0.5, base);
    box(g, ox + w / 2, oy + d / 2, z + H, w + 0.4, d + 0.4, 0.15, '#3a3440');
    // puerta (salida) y lámparas
    box(g, ox + w / 2, oy + 0.05, z, 1.4, 0.1, 2.4, '#4a2e22');
    for (let i = 1; i < 3; i++) box(g, ox + (w * i) / 3, oy + d / 2, z + H - 0.3, 0.6, 0.6, 0.15, '#fff0c0', true);

    const F: Record<RoomKind, () => void> = {
      piso: () => {
        box(g, ox + 2, oy + d - 1.2, z, 3, 1, 0.8, '#5a3a6a'); // sofá
        box(g, ox + 2, oy + d - 0.6, z, 3, 0.3, 1.1, '#4a2a5a');
        box(g, ox + 2, oy + d - 3, z, 1.4, 0.8, 0.45, '#8a6a4a'); // mesita
        box(g, ox + 2, oy + 1.2, z, 1.6, 0.4, 0.6, '#2a2a2a'); // tele
        box(g, ox + 2, oy + 1.2, z + 0.6, 1.4, 0.1, 0.8, '#5ac8f4', true);
        box(g, ox + w - 2, oy + d - 1.5, z, 2, 2.4, 0.5, '#f4f0e8'); // cama (guardar partida)
        box(g, ox + w - 2, oy + d - 0.5, z, 2, 0.4, 0.9, '#6a4a3a');
        box(g, ox + w - 0.6, oy + 1.4, z, 0.8, 0.8, 1.9, '#e8e8e8'); // nevera
        box(g, ox + w - 3, oy + 0.5, z, 3, 0.6, 0.9, '#c8b8a0'); // cocina
        box(g, ox + w / 2, oy + d - 0.05, z + 1.2, 1.6, 0.05, 1.1, '#d8202a'); // póster del Terrassa FC
        box(g, ox + w / 2, oy + d - 0.06, z + 1.5, 1.0, 0.05, 0.5, '#f4f4f4');
      },
      bar: () => {
        box(g, ox + w / 2, oy + d - 2, z, w - 4, 0.8, 1.1, '#6a3a22'); // barra
        box(g, ox + w / 2, oy + d - 0.4, z, w - 3, 0.5, 2.2, '#3a2218'); // estantería
        for (let i = 0; i < 16; i++) box(g, ox + 2 + (i / 15) * (w - 4), oy + d - 0.4, z + 1.2 + (i % 2) * 0.5, 0.12, 0.12, 0.35, ['#3a8a3a', '#c8a050', '#8a2a2a', '#e8e8f0'][i % 4], true);
        for (let i = 0; i < 5; i++) box(g, ox + 3 + i * 2, oy + d - 3.2, z, 0.4, 0.4, 0.75, '#2a2a2a'); // taburetes
        for (const [x, y] of [[ox + 2.5, oy + 3], [ox + 6, oy + 3.5], [ox + w - 3, oy + 3]]) {
          box(g, x, y, z, 1.2, 1.2, 0.75, '#8a5a3a');
          box(g, x - 1, y, z, 0.5, 0.5, 0.45, '#5a3a2a');
          box(g, x + 1, y, z, 0.5, 0.5, 0.45, '#5a3a2a');
        }
        box(g, ox + w - 0.6, oy + 2, z, 0.8, 0.8, 1.7, '#c018c8', true); // tragaperras
        box(g, ox + w / 2, oy + d - 0.1, z + 2.7, 3, 0.1, 0.5, '#ff3cf0', true); // neón
      },
      nave: () => {
        for (let i = 0; i < 4; i++) box(g, ox + 3 + i * 5, oy + d - 1, z, 3.5, 1, 2.6, '#4a5a6a'); // estanterías
        for (let i = 0; i < 3; i++) {
          box(g, ox + 5 + i * 6, oy + d / 2, z, 3, 1.4, 0.9, '#c8c8d0'); // mesas con portátiles
          box(g, ox + 4.5 + i * 6, oy + d / 2, z + 0.9, 0.6, 0.4, 0.4, '#5af0c8', true);
          box(g, ox + 5.6 + i * 6, oy + d / 2, z + 0.9, 0.6, 0.4, 0.4, '#5af0c8', true);
        }
        for (let i = 0; i < 8; i++) box(g, ox + 1.5 + rr() * (w - 3), oy + 2 + rr() * 3, z, 1.2, 1.2, 1.2, '#a07a4a'); // cajas
        box(g, ox + w - 3, oy + 3, z, 2.4, 1.4, 1.4, '#f4b020'); // toro
        box(g, ox + 1, oy + d / 2, z + 1, 0.05, 6, 1.6, '#f4f4f4'); // pizarra con «growth hacking»
      },
      mansion: () => {
        box(g, ox + w / 2, oy + d / 2, z, w - 4, d - 4, 0.02, '#c8a050'); // alfombra
        box(g, ox + w / 2, oy + d - 2, z, 3, 1.2, 0.8, '#3a2214'); // escritorio
        box(g, ox + w / 2, oy + d - 0.8, z, 1, 0.8, 1.3, '#6a1a1a'); // sillón
        for (let i = 0; i < 4; i++) box(g, ox + 1.5 + i * 3.6, oy + d - 0.3, z, 3, 0.5, 3, '#4a2a1a'); // librerías
        box(g, ox + 0.3, oy + d / 2, z, 0.5, 2.4, 1.2, '#2a2a2a'); // chimenea
        box(g, ox + 0.5, oy + d / 2, z + 0.1, 0.3, 1.6, 0.6, '#ff8a20', true);
        for (const y of [oy + 3, oy + 6]) box(g, ox + w - 0.1, y, z + 1.4, 0.05, 1.8, 1.3, '#c8a050'); // cuadros
        box(g, ox + 4, oy + 3, z, 2, 1.4, 1, '#1a1a1a'); // piano
        for (const x of [ox + 8, ox + 10]) box(g, x, oy + 4, z, 1, 1, 0.9, '#8a2a2a'); // butacas
      },
      taller: () => {
        const car = createCarMesh('sedan', '#d8d0c0');
        car.position.set(ox + w / 2, z + 1.2, -(oy + d / 2));
        r.group.add(car);
        box(g, ox + w / 2 - 1.3, oy + d / 2, z, 0.3, 4, 1.1, '#f4d020'); // elevador
        box(g, ox + w / 2 + 1.3, oy + d / 2, z, 0.3, 4, 1.1, '#f4d020');
        for (let i = 0; i < 4; i++) box(g, ox + 1.2, oy + 2 + i * 1.2, z, 0.9, 0.9, 1.2, '#1a1a1a'); // neumáticos
        box(g, ox + w - 1, oy + d / 2, z, 1, 3, 1.1, '#c82018'); // banco de herramientas
        box(g, ox + w / 2, oy + d - 0.05, z + 1.5, 4, 0.05, 1.2, '#2a3a8a'); // «Mascarell & Fills»
      },
      oficina: () => F.comisaria(),
      comisaria: () => {
        for (let i = 0; i < 3; i++) {
          box(g, ox + 3 + i * 4, oy + 4, z, 2, 1, 0.8, '#6a6a7a');
          box(g, ox + 3 + i * 4, oy + 4.2, z + 0.8, 0.6, 0.3, 0.45, '#5ac8f4', true);
        }
        for (let i = 0; i < 3; i++) { // calabozos
          box(g, ox + 2 + i * 3.4, oy + d - 1.5, z, 0.1, 3, 2.6, '#2a2a2a');
          for (let k = 0; k < 6; k++) box(g, ox + 2.4 + i * 3.4 + k * 0.5, oy + d - 3, z, 0.06, 0.06, 2.6, '#4a4a5a');
        }
        box(g, ox + w - 0.1, oy + 3, z + 1.3, 0.05, 1.6, 1, '#1a2a6a');
      },
      armeria: () => {
        box(g, ox + w / 2, oy + d - 2.2, z, w - 3, 0.8, 1.0, '#5a4a3a'); // mostrador
        for (let i = 0; i < 6; i++) box(g, ox + 1.5 + i * 1.4, oy + d - 0.15, z + 1.2 + (i % 2) * 0.6, 1.1, 0.12, 0.25, '#2a2a30'); // armas en la pared
        for (let i = 0; i < 4; i++) box(g, ox + 1 + i * 1.1, oy + 1.5, z, 0.9, 0.9, 0.6, '#4a5a3a'); // cajas de munición
        box(g, ox + 0.1, oy + d / 2, z + 1, 0.05, 1, 1.4, '#f4f0e8'); // diana
      },
      hospital: () => {
        box(g, ox + w / 2, oy + 3, z, 4, 1, 1.1, '#d8e8f0'); // recepción
        for (let i = 0; i < 4; i++) {
          box(g, ox + 2 + i * 3.6, oy + d - 1.6, z, 1.2, 2.2, 0.7, '#f4f4f4'); // camas
          box(g, ox + 3.2 + i * 3.6, oy + d - 1.6, z, 0.05, 2.4, 2, '#9ac8e8'); // cortinas
        }
        for (let i = 0; i < 5; i++) box(g, ox + 1 + i * 0.8, oy + 1, z, 0.6, 0.6, 0.5, '#4a8ac8'); // sillas
        box(g, ox + w - 0.6, oy + 1.5, z, 0.6, 0.6, 1.4, '#3a8a3a'); // planta
      },
    };
    F[kind]();
    const merged = new THREE.Mesh(mergeAll(g), mat);
    // suelo con baldosas
    const tex = floorTexture(kind);
    tex.repeat.set(w / 2, d / 2);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), passAlpha(new THREE.MeshBasicMaterial({ map: tex }), 0.15));
    fl.position.set(ox + w / 2, z + 0.01, -(oy + d / 2));
    r.group.add(merged, fl);
  }

  /** La puerta (o la salida, si estás dentro) a menos de `r` metros. */
  nearDoor(x: number, y: number, r = 2.2): Room | null {
    if (this.current) return Math.hypot(x - this.current.exit[0], y - this.current.exit[1]) < r ? this.current : null;
    return this.rooms.find((o) => Math.hypot(x - o.door[0], y - o.door[1]) < r) ?? null;
  }

  /** Entrar: devuelve dónde aparece el jugador (x, y, rumbo). */
  enter(r: Room): [number, number, number] {
    this.current = r;
    for (const o of this.rooms) o.group.visible = o === r;
    return [r.exit[0], r.exit[1] + 1.2, 0];
  }

  /** Salir: devuelve dónde aparece en la calle (x, y, rumbo). */
  leave(): [number, number, number] | null {
    const r = this.current;
    if (!r) return null;
    this.current = null;
    r.group.visible = false;
    const [x, y, a] = r.door;
    return [x + Math.sin(a) * 1.2, y + Math.cos(a) * 1.2, a];
  }
}

function mergeAll(g: THREE.BufferGeometry[]) {
  // fusión simple (todas tienen posición y color RGBA)
  let n = 0, ni = 0;
  for (const b of g) { n += b.attributes.position.count; ni += b.index!.count; }
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const b of g) {
    pos.set(b.attributes.position.array as Float32Array, o * 3);
    col.set(b.attributes.color.array as Float32Array, o * 4);
    const ix = b.index!.array;
    for (let i = 0; i < ix.length; i++) idx[oi + i] = ix[i] + o;
    o += b.attributes.position.count;
    oi += ix.length;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 4));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  m.computeBoundingSphere();
  return m;
}
