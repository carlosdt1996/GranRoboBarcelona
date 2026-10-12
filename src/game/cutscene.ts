import * as THREE from 'three';

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Pequeñas cinemáticas: la cámara viaja de un plano a otro con bandas negras y un rótulo
 * (al salir del hospital o de la comisaría, al empezar una misión...).
 */
export class Cutscene {
  active = false;
  private t = 0;
  private dur = 4;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private lookFrom = new THREE.Vector3();
  private lookTo = new THREE.Vector3();
  private look = new THREE.Vector3();
  private el: HTMLDivElement;
  private cap: HTMLDivElement;
  onDone?: () => void;
  /** Punto al que mira (coordenadas del juego): el mundo se carga a su alrededor. */
  focus: [number, number] = [0, 0];

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'lbox';
    this.el.hidden = true;
    this.cap = document.createElement('div');
    this.cap.className = 'lb-cap';
    this.el.appendChild(this.cap);
    document.body.appendChild(this.el);
  }

  /** Posiciones en coordenadas del juego (x este, y norte, z arriba). */
  play(from: [number, number, number], to: [number, number, number], lookFrom: [number, number, number], lookTo: [number, number, number], caption: string, dur = 4.5) {
    const v = (p: [number, number, number], o: THREE.Vector3) => o.set(p[0], p[2], -p[1]);
    v(from, this.from); v(to, this.to); v(lookFrom, this.lookFrom); v(lookTo, this.lookTo);
    this.focus = [lookTo[0], lookTo[1]];
    this.t = 0;
    this.dur = dur;
    this.active = true;
    this.cap.textContent = caption;
    this.el.hidden = false;
    this.el.classList.remove('out');
  }

  /** Mueve la cámara; devuelve true al terminar. Se puede saltar (skip). */
  update(dt: number, camera: THREE.PerspectiveCamera, skip = false) {
    if (!this.active) return false;
    this.t += dt;
    const k = ease(Math.min(1, this.t / this.dur));
    camera.position.lerpVectors(this.from, this.to, k);
    this.look.lerpVectors(this.lookFrom, this.lookTo, k);
    camera.lookAt(this.look);
    if (this.t > this.dur - 0.6) this.el.classList.add('out');
    if (this.t >= this.dur || skip) {
      this.active = false;
      this.el.hidden = true;
      this.onDone?.();
      return true;
    }
    return false;
  }
}
