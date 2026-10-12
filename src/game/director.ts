import * as THREE from 'three';

/** Posición de un personaje en escena (x este, y norte, z suelo). */
export interface Cast { x: number; y: number; z: number }

type Shot = 'wide' | 'ots' | 'close' | 'low';

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Director de las cinemáticas de los diálogos: plano general de situación, contraplanos por encima
 * del hombro, primeros planos y contrapicados, con un ligero travelling en cada plano y bandas negras.
 */
export class Director {
  active = false;
  private cast = new Map<string, Cast>();
  private speaker = '';
  private listener = '';
  private shot: Shot = 'wide';
  private t = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private look = new THREE.Vector3();
  private box: HTMLDivElement;
  private n = 0;

  constructor() {
    this.box = document.createElement('div');
    this.box.className = 'lbox';
    this.box.hidden = true;
    document.body.appendChild(this.box);
  }

  start(cast: Record<string, Cast>) {
    this.cast = new Map(Object.entries(cast));
    this.active = true;
    this.n = 0;
    this.box.hidden = false;
    this.box.classList.remove('out');
  }

  stop() {
    this.active = false;
    this.box.hidden = true;
  }

  /** Nueva línea de diálogo: elige el plano según quién habla. */
  line(speaker: string) {
    const ids = [...this.cast.keys()];
    const prev = this.speaker;
    this.speaker = this.cast.has(speaker) ? speaker : ids[0];
    this.listener = ids.find((i) => i !== this.speaker) ?? this.speaker;
    // primer plano: general; luego contraplanos alternando con primeros planos y algún contrapicado
    this.shot = this.n === 0 ? 'wide' : prev === this.speaker ? (this.n % 3 === 0 ? 'low' : 'close') : this.n % 4 === 3 ? 'wide' : 'ots';
    this.n++;
    this.t = 0;
    this.frame();
  }

  /** Calcula el encuadre (desde/hacia para el travelling) del plano actual. */
  private frame() {
    const a = this.cast.get(this.speaker)!, b = this.cast.get(this.listener)!;
    const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d; // de quien escucha hacia quien habla
    const rx = uy, ry = -ux; // a la derecha
    const v = (x: number, y: number, z: number, o: THREE.Vector3) => o.set(x, z, -y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
    switch (this.shot) {
      case 'wide':
        v(mx + rx * 7.5, my + ry * 7.5, mz + 3, this.from);
        v(mx + rx * 6, my + ry * 6, mz + 2.4, this.to);
        v(mx, my, mz + 1.3, this.look);
        break;
      case 'ots': // por encima del hombro de quien escucha
        v(b.x - ux * 1.4 + rx * 0.7, b.y - uy * 1.4 + ry * 0.7, b.z + 1.85, this.from);
        v(b.x - ux * 1.1 + rx * 0.6, b.y - uy * 1.1 + ry * 0.6, b.z + 1.8, this.to);
        v(a.x, a.y, a.z + 1.45, this.look);
        break;
      case 'close': // primer plano de quien habla
        v(a.x - ux * 2.6 - rx * 0.5, a.y - uy * 2.6 - ry * 0.5, a.z + 1.5, this.from);
        v(a.x - ux * 2.0 - rx * 0.4, a.y - uy * 2.0 - ry * 0.4, a.z + 1.5, this.to);
        v(a.x, a.y, a.z + 1.5, this.look);
        break;
      case 'low': // contrapicado: el jefe se ve poderoso
        v(a.x - ux * 3 + rx * 1.2, a.y - uy * 3 + ry * 1.2, a.z + 0.5, this.from);
        v(a.x - ux * 2.6 + rx * 1.0, a.y - uy * 2.6 + ry * 1.0, a.z + 0.6, this.to);
        v(a.x, a.y, a.z + 1.7, this.look);
        break;
    }
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    if (!this.active) return;
    this.t += dt;
    const k = ease(Math.min(1, this.t / 4));
    camera.position.lerpVectors(this.from, this.to, k);
    camera.lookAt(this.look);
    const fov = this.shot === 'close' ? 40 : this.shot === 'wide' ? 55 : 48;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
}
