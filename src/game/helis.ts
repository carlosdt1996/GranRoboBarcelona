import type * as THREE from 'three';
import type { RoofMap } from '../heights';
import type { World } from '../map';
import { Heli, type HeliControls } from './heli';

/** Helicópteros esperando en sitios abiertos de la ciudad (lon, lat, rumbo en grados). */
const SPOTS: [string, number, number, number][] = [
  ['Plaça de Catalunya', 2.17005, 41.38701, 135],
  ['Anella Olímpica', 2.1527, 41.3652, 45],
  ['Parc de la Ciutadella', 2.1868, 41.3886, 225],
  ['Platja de la Barceloneta', 2.1931, 41.3792, 45],
  ['Parc del Fòrum', 2.2268, 41.4103, 45],
  ['Parc de Collserola (Tibidabo)', 2.1175, 41.4217, 90],
  ['Aeroport de Sabadell', 2.1035, 41.5215, 0],
  ['Parc de Vallparadís (Terrassa)', 2.0172, 41.5662, 45],
  ['Granollers · Parc Torras Villà', 2.2860, 41.6050, 90],
];

/** Todos los helicópteros: el que pilota el jugador y los que esperan aparcados. */
export class Helis {
  list: Heli[] = [];
  /** El que acude al pulsar H (se reutiliza). */
  private summoned: Heli | null = null;

  constructor(private world: World, private roofs: RoofMap, private scene: THREE.Object3D) {
    for (const [, lon, lat, deg] of SPOTS) {
      const [x, y] = world.toLocal(lon, lat);
      this.add(x, y, (deg * Math.PI) / 180);
    }
  }

  private add(x: number, y: number, a: number, body?: string, stripe?: string) {
    const h = new Heli(body, stripe);
    h.x = x; h.y = y; h.a = a;
    h.z = this.world.terrain.at(x, y);
    this.list.push(h);
    this.scene.add(h.mesh, h.m.shadow);
    return h;
  }

  remove(h: Heli) {
    this.list = this.list.filter((o) => o !== h);
    this.scene.remove(h.mesh, h.m.shadow);
    if (this.summoned === h) this.summoned = null;
  }

  /** Trae un helicóptero junto a (x, y), en un sitio despejado a ras de suelo. */
  summon(x: number, y: number, a: number): Heli | null {
    const T = this.world.terrain;
    for (const d of [10, 14, 18, 24]) {
      for (const da of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
        const hx = x + Math.sin(a + da) * d, hy = y + Math.cos(a + da) * d;
        // hueco libre de edificios para el rotor
        let free = true;
        for (let k = 0; k < 8 && free; k++) {
          const px = hx + Math.sin((k / 8) * Math.PI * 2) * 5.5, py = hy + Math.cos((k / 8) * Math.PI * 2) * 5.5;
          if (this.roofs.roof(px, py) > T.at(px, py) + 0.5) free = false;
        }
        if (!free || this.roofs.roof(hx, hy) > T.at(hx, hy) + 0.5) continue;
        const h = this.summoned ?? (this.summoned = this.add(hx, hy, a, '#2a2a3a', '#ffd020'));
        h.x = hx; h.y = hy; h.a = a; h.z = T.at(hx, hy);
        h.vx = h.vy = h.vz = 0; h.rpm = 0; h.health = h.maxHealth; h.wrecked = false;
        return h;
      }
    }
    return null;
  }

  /** El más cercano a (x, y) a menos de `r` metros. */
  nearest(x: number, y: number, r: number) {
    let best: Heli | null = null, bd = r;
    for (const h of this.list) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd && !h.wrecked) { best = h; bd = d; }
    }
    return best;
  }

  /** Simula los que no pilota nadie (caen si se quedan en el aire) y actualiza sus mallas. */
  update(dt: number, piloted: Heli | null, ctl: HeliControls | null, fx: number, fy: number) {
    for (const h of this.list) {
      const d = Math.hypot(h.x - fx, h.y - fy);
      if (h === piloted) h.step(ctl, dt, this.roofs);
      else if (d < 900 && (!h.landed || h.rpm > 0 || h.vz !== 0)) h.step(null, dt, this.roofs);
      else if (d < 900 && h.landed) h.z = Math.max(h.z, this.roofs.surface(h.x, h.y));
      h.mesh.visible = h.m.shadow.visible = d < 1600;
      if (d < 1600) h.syncMesh(this.roofs, dt);
    }
  }

  /** Volumen del rotor que se oye desde (x, y): el más fuerte. */
  rotorLevel(x: number, y: number, z: number): [number, number] {
    let lv = 0, rpm = 0;
    for (const h of this.list) {
      if (h.rpm <= 0.01) continue;
      const l = Math.max(0, 1 - Math.hypot(h.x - x, h.y - y, h.z - z) / 260);
      if (l > lv) { lv = l; rpm = h.rpm; }
    }
    return [lv, rpm];
  }
}
