import * as THREE from 'three';
import type { World } from '../map';
import type { RoadGraph } from '../roads';
import { Billboards } from '../render/billboards';
import type { SpriteAtlas } from '../render/textures';
import { glowBlend } from '../daylight';
import type { WeaponId } from './combat';
import { ITEMS, PACKAGES } from './places';
import { Vehicle } from './vehicle';

export type PickupKind = 'health' | 'armor' | 'cash' | 'package' | WeaponId;

export interface Pickup { kind: PickupKind; x: number; y: number; amount: number; hidden: number; ttl: number; pkg: number; name: string }

const RESPAWN = 90;

/** Pone un punto en la acera más cercana a lon/lat (para que no quede dentro de un edificio). */
export function sidewalk(world: World, graph: RoadGraph, lon: number, lat: number, extra = 2): [number, number, number] {
  const [x, y] = world.toLocal(lon, lat);
  const ne = graph.nearestEdge(x, y);
  if (!ne) return [x, y, 0];
  const p = graph.pose(ne.edge, ne.s, ne.edge.road.width / 2 + extra, { x: 0, y: 0, a: 0 });
  return [p.x, p.y, p.a];
}

/**
 * Objetos que se recogen pasando por encima: vida, chalecos, armas, dinero (lo que sueltan los
 * peatones abatidos) y los 20 paquetes ocultos. Brillan y flotan, como en Vice City.
 */
export class Pickups {
  list: Pickup[] = [];
  readonly sprites: Billboards;
  private t = 0;

  constructor(world: World, graph: RoadGraph, private atlas: SpriteAtlas, found: Set<number>) {
    this.sprites = new Billboards(atlas, 80, true, true);
    for (const [name, lon, lat, kind] of ITEMS) {
      const [x, y] = sidewalk(world, graph, lon, lat);
      this.list.push({ kind, x, y, amount: kind === 'health' || kind === 'armor' ? 100 : 0, hidden: 0, ttl: Infinity, pkg: -1, name });
    }
    PACKAGES.forEach(([name, lon, lat], i) => {
      if (found.has(i)) return;
      const [x, y] = sidewalk(world, graph, lon, lat, 3.5);
      this.list.push({ kind: 'package', x, y, amount: 1000, hidden: 0, ttl: Infinity, pkg: i, name });
    });
  }

  /** Dinero que suelta un peatón abatido. */
  dropCash(x: number, y: number, amount: number) {
    this.list.push({ kind: 'cash', x, y, amount, hidden: 0, ttl: 30, pkg: -1, name: '' });
  }

  /** Recoge lo que haya a menos de `r` de (x, y). `take` decide si lo quiere (p. ej. vida llena = no). */
  update(dt: number, x: number, y: number, r: number, take: (p: Pickup) => boolean, camX: number, camY: number) {
    this.t += dt;
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.hidden > 0) { p.hidden -= dt; continue; }
      p.ttl -= dt;
      if (p.ttl <= 0) { this.list.splice(i, 1); continue; }
      if (Math.hypot(p.x - x, p.y - y) < r && take(p)) {
        if (p.kind === 'cash' || p.kind === 'package') this.list.splice(i, 1);
        else p.hidden = RESPAWN;
        continue;
      }
      if (n >= this.sprites.capacity || Math.abs(p.x - camX) > 250 || Math.abs(p.y - camY) > 250) continue;
      const bob = Math.sin(this.t * 3 + i) * 0.15;
      const name = p.kind === 'health' ? 'pk_health' : p.kind === 'armor' ? 'pk_armor' : p.kind === 'cash' ? 'pk_cash' : p.kind === 'package' ? 'pk_package' : 'pk_weapon';
      this.sprites.set(n++, p.x, p.y, Vehicle.ground(p.x, p.y) + 0.4 + bob, 0.9, 0.9, this.atlas.rects[name], Math.floor(this.t * 2 + i) % 2 === 0);
    }
    this.sprites.commit(n);
  }
}

export interface Marker { x: number; y: number; a: number; kind: 'shop' | 'paint' | 'mission'; name: string; index: number; color: string; mesh: THREE.Mesh }

/** Marcadores en el suelo: cilindros de luz de las armerías, talleres de pintura e inicios de misión. */
export class Markers {
  list: Marker[] = [];
  readonly group = new THREE.Group();
  private geo = new THREE.CylinderGeometry(1.6, 1.6, 2.2, 16, 1, true).translate(0, 1.1, 0);
  private t = 0;

  add(x: number, y: number, a: number, kind: Marker['kind'], name: string, index: number, color: string) {
    const mesh = new THREE.Mesh(this.geo, glowBlend(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })));
    mesh.position.set(x, Vehicle.ground(x, y), -y);
    if (kind === 'paint') mesh.scale.set(2.2, 1.4, 2.2);
    this.group.add(mesh);
    const m = { x, y, a, kind, name, index, color, mesh };
    this.list.push(m);
    return m;
  }

  remove(m: Marker) {
    this.group.remove(m.mesh);
    this.list = this.list.filter((o) => o !== m);
  }

  /** El marcador de un tipo a menos de `r` de (x, y). */
  near(x: number, y: number, r: number, kind?: Marker['kind']) {
    return this.list.find((m) => (!kind || m.kind === kind) && m.mesh.visible && Math.hypot(m.x - x, m.y - y) < r * (m.kind === 'paint' ? 2 : 1)) ?? null;
  }

  update(dt: number, x: number, y: number) {
    this.t += dt;
    for (const m of this.list) {
      const d = Math.hypot(m.x - x, m.y - y);
      m.mesh.visible = d < 400 && m.mesh.userData.off !== true;
      m.mesh.position.y = m.x > 30000 ? 1000 : Vehicle.ground(m.x, m.y); // los de los interiores están a 1000 m
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(this.t * 4) * 0.12;
    }
  }
}
