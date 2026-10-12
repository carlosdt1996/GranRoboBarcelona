import * as THREE from 'three';
import type { WallGrid } from '../collision';
import { angDiff } from '../geom';

/** Algo a lo que se puede apuntar: su posición (x, y, altura) y si sigue en pie. */
export interface AimTarget { pos(): [number, number, number]; alive(): boolean; key: unknown }

const CONE = 0.75, RANGE = 75, BREAK_PX = 70;

/**
 * Apuntado al estilo GTA V: al pulsar apuntar se fija en el blanco más cercano a donde miras;
 * si sueltas y vuelves a pulsar, vuelve a fijar. Moviendo el ratón se ajusta la dirección y, si te
 * alejas del blanco, salta al más cercano a la nueva dirección. El círculo es opcional.
 */
export class Aim {
  target: AimTarget | null = null;
  aiming = false;
  /** Rumbo al que apunta el jugador (con o sin blanco). */
  heading = 0;
  private drift = 0;
  private el: HTMLDivElement;
  private v = new THREE.Vector3();

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'reticle';
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  private pick(x: number, y: number, a: number, cands: AimTarget[], walls: WallGrid, exclude?: AimTarget | null) {
    let best: AimTarget | null = null, bs = Infinity;
    for (const c of cands) {
      if (!c.alive() || (exclude && c.key === exclude.key)) continue;
      const [tx, ty, tz] = c.pos();
      const d = Math.hypot(tx - x, ty - y);
      if (d < 0.8 || d > RANGE) continue;
      const off = Math.abs(angDiff(a, Math.atan2(tx - x, ty - y)));
      if (off > CONE) continue;
      if (tz - Vec.ground < 6 && walls.raycast(x, y, tx, ty) < 0.98) continue; // tapado (salvo en el aire)
      const s = off + d / 120;
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  }

  /**
   * `held`: botón de apuntar pulsado; `mouseDx`: movimiento horizontal del ratón (px) desde el último fotograma.
   * Devuelve el rumbo al que debe mirar el jugador (o null si no apunta).
   */
  update(held: boolean, mouseDx: number, x: number, y: number, z: number, a: number, cands: AimTarget[], walls: WallGrid) {
    Vec.ground = z;
    const pressed = held && !this.aiming;
    this.aiming = held;
    if (!held) { this.target = null; return null; }
    if (pressed) {
      // al pulsar (o volver a pulsar): el blanco más cercano a donde miras
      this.heading = a;
      this.drift = 0;
      this.target = this.pick(x, y, a, cands, walls);
    }
    this.drift += mouseDx;
    if (this.target && (!this.target.alive() || Math.abs(this.drift) > BREAK_PX)) {
      // el ratón se aleja del blanco (o cae): al más cercano en la nueva dirección
      const na = this.heading + this.drift * 0.006;
      const prev = this.target.alive() ? this.target : null;
      this.target = this.pick(x, y, na, cands, walls, Math.abs(this.drift) > BREAK_PX ? prev : null);
      if (!this.target) this.heading = na;
      this.drift = 0;
    }
    if (this.target) {
      const [tx, ty] = this.target.pos();
      this.heading = Math.atan2(tx - x, ty - y);
    } else {
      this.heading += mouseDx * 0.006; // apuntado libre
      this.drift = 0;
    }
    return this.heading;
  }

  /** Dibuja el círculo sobre el blanco (o delante del jugador) si la opción está activa. */
  draw(camera: THREE.Camera, show: boolean, x: number, y: number, z: number) {
    if (!show || !this.aiming) { this.el.hidden = true; return; }
    let tx: number, ty: number, tz: number;
    if (this.target) [tx, ty, tz] = this.target.pos();
    else { tx = x + Math.sin(this.heading) * 25; ty = y + Math.cos(this.heading) * 25; tz = z + 1.3; }
    this.v.set(tx, tz, -ty).project(camera);
    if (this.v.z > 1) { this.el.hidden = true; return; }
    this.el.hidden = false;
    this.el.classList.toggle('locked', !!this.target);
    this.el.style.transform = `translate(${((this.v.x + 1) / 2) * innerWidth}px, ${((1 - this.v.y) / 2) * innerHeight}px) translate(-50%, -50%)`;
  }
}

/** Cota del jugador (para no descartar blancos en el aire por las paredes). */
const Vec = { ground: 0 };
