import type { Controls } from './game/vehicle';
import { clamp } from './geom';

/** Teclado, pantalla táctil y mando. */
export class Input {
  private keys = new Set<string>();
  /** Joystick analógico táctil: x a la derecha, y hacia abajo (−1..1). */
  readonly stick = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private btn: Record<string, boolean> = {};
  private pressedOnce = new Set<string>();
  private mouseFire = false;
  private scrollAcc = 0;
  private mouseAim = false;
  private mdx = 0;
  /** Últimas letras tecleadas (para los trucos). */
  private typed = '';
  private padY = false;
  readonly touch = matchMedia('(pointer: coarse)').matches;

  constructor() {
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      if (/^[a-zñ]$/i.test(e.key)) this.typed = (this.typed + e.key.toUpperCase()).slice(-24);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseFire = false; });
    // clic en la pantalla de juego = disparar
    const game = document.getElementById('game');
    game?.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseAim = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseAim = false;
    });
    game?.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.mouseAim) this.mdx += e.movementX; });
    game?.addEventListener('wheel', (e) => { this.scrollAcc += Math.sign(e.deltaY); }, { passive: true });

    document.getElementById('enterbtn')?.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.pressedOnce.add('tap:enter'); });
    // cualquier toque en la pantalla (para saltar cinemáticas)
    addEventListener('pointerdown', () => this.pressedOnce.add('tap:any'));
    // joystick analógico: el mando se mueve en todas direcciones desde el centro de la base
    const pad = document.getElementById('steer');
    if (pad) {
      const move = (e: PointerEvent) => {
        const r = pad.getBoundingClientRect(), R = r.width * 0.36;
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        this.stick.x = dx / R;
        this.stick.y = dy / R;
        this.updateKnob(pad, dx, dy);
      };
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.stickPointer = e.pointerId;
        try { pad.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
        move(e);
      });
      pad.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickPointer) move(e); });
      const end = (e: PointerEvent) => {
        if (e.pointerId !== this.stickPointer) return;
        this.stickPointer = null;
        this.stick.x = this.stick.y = 0;
        this.updateKnob(pad, 0, 0);
      };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
    }
    document.querySelectorAll<HTMLElement>('[data-btn]').forEach((el) => {
      const k = el.dataset.btn!;
      const on = (e: PointerEvent) => { e.preventDefault(); this.btn[k] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ } if (k.startsWith('tap:')) this.pressedOnce.add(k); };
      const off = () => { this.btn[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    });
  }

  private updateKnob(pad: HTMLElement, dx: number, dy: number) {
    const knob = pad.querySelector<HTMLElement>('.knob');
    if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** Inclinación del joystick (0..1) y su dirección en pantalla (0 = arriba, sentido horario). */
  stickPolar() {
    const m = Math.min(1, Math.hypot(this.stick.x, this.stick.y));
    return { mag: m < 0.15 ? 0 : m, ang: Math.atan2(this.stick.x, -this.stick.y) };
  }

  /** Rueda de armas: mantener Tab. */
  wheelHeld() {
    return this.keys.has('Tab');
  }

  /** Cambio de arma con la rueda del ratón (−1, 0, 1). */
  scroll() {
    const s = Math.sign(this.scrollAcc);
    this.scrollAcc = 0;
    return s;
  }

  /** Arma elegida con las teclas 1-6 (índice), o -1. */
  digit() {
    for (let i = 1; i <= 6; i++) if (this.pressed(`Digit${i}`)) return i - 1;
    return -1;
  }

  /** Truco tecleado (el primero de `codes` con el que acaba lo escrito), o null. */
  cheat(codes: string[]) {
    const c = codes.find((k) => this.typed.endsWith(k));
    if (c) this.typed = '';
    return c ?? null;
  }

  /** ¿Se ha tocado la pantalla desde la última vez? */
  tapped() {
    return this.pressed('tap:any');
  }

  /** Olvida las pulsaciones pendientes (p. ej. la tecla que cierra la pantalla de título). */
  flush() {
    this.pressedOnce.clear();
  }

  /** true una sola vez por pulsación. */
  pressed(code: string) {
    const r = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return r;
  }

  /** Subir/bajar del coche (F, Enter, botón táctil o Y del mando). */
  enterPressed() {
    let pad = false;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) if (gp?.buttons[3]?.pressed) pad = true;
    const edge = pad && !this.padY;
    this.padY = pad;
    return this.pressed('KeyF') || this.pressed('Enter') || this.pressed('tap:enter') || edge;
  }

  /** Apuntar: clic derecho, Z o LB del mando. */
  aimHeld() {
    let pad = false;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) if (gp?.buttons[4]?.pressed) pad = true;
    return this.mouseAim || this.keys.has('KeyZ') || !!this.btn.aim || pad;
  }

  /** Movimiento horizontal del ratón mientras apuntas (px desde la última llamada). */
  mouseDx() {
    const d = this.mdx;
    this.mdx = 0;
    return d;
  }

  /** Gatillo: X, clic, botón FUEGO o RB del mando (Ctrl no: Ctrl+W cerraría la pestaña). */
  firing() {
    let pad = false;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) if (gp?.buttons[5]?.pressed) pad = true;
    return this.keys.has('KeyX') || this.mouseFire || !!this.btn.fire || pad;
  }

  /** Helicóptero: ↑↓ avanzar/retroceder, ←→ girar, Espacio subir, Shift bajar (en móvil DRIFT sube y FUEGO baja). */
  heli() {
    const k = (...c: string[]) => c.some((x) => this.keys.has(x));
    let fwd = k('ArrowUp', 'KeyW') || this.btn.gas ? 1 : 0;
    let back = k('ArrowDown', 'KeyS') || this.btn.brake ? 1 : 0;
    let yaw = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0) + this.stick.x;
    if (-this.stick.y > 0.2) fwd = Math.max(fwd, -this.stick.y);
    if (this.stick.y > 0.3) back = Math.max(back, this.stick.y);
    let up = k('Space', 'KeyE', 'PageUp') || this.btn.drift ? 1 : 0;
    let down = k('ShiftLeft', 'ShiftRight', 'KeyQ', 'PageDown') || this.btn.fire ? 1 : 0;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!gp) continue;
      if (Math.abs(gp.axes[0] || 0) > 0.15) yaw += gp.axes[0];
      fwd = Math.max(fwd, gp.buttons[7]?.value || 0, -(gp.axes[1] || 0) > 0.2 ? -(gp.axes[1] || 0) : 0);
      back = Math.max(back, gp.buttons[6]?.value || 0, (gp.axes[1] || 0) > 0.2 ? gp.axes[1] : 0);
      up = Math.max(up, gp.buttons[0]?.pressed || gp.buttons[5]?.pressed ? 1 : 0);
      down = Math.max(down, gp.buttons[1]?.pressed || gp.buttons[4]?.pressed ? 1 : 0);
    }
    return { fwd, back, yaw: clamp(yaw, -1, 1), up, down };
  }

  controls(): Controls {
    const k = (...c: string[]) => c.some((x) => this.keys.has(x));
    let throttle = k('ArrowUp', 'KeyW') || this.btn.gas ? 1 : 0;
    let brake = k('ArrowDown', 'KeyS') || this.btn.brake ? 1 : 0;
    let steer = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0) + this.stick.x;
    if (-this.stick.y > 0.25) throttle = Math.max(throttle, Math.min(1, (-this.stick.y - 0.25) / 0.6));
    if (this.stick.y > 0.35) brake = Math.max(brake, Math.min(1, (this.stick.y - 0.35) / 0.5));
    let handbrake = k('Space', 'ShiftLeft', 'ShiftRight') || !!this.btn.drift;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer += ax;
      throttle = Math.max(throttle, gp.buttons[7]?.value || 0, gp.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, gp.buttons[6]?.value || 0, gp.buttons[1]?.pressed ? 1 : 0);
      handbrake ||= !!gp.buttons[2]?.pressed;
    }
    return { throttle, brake, steer: clamp(steer, -1, 1), handbrake };
  }
}
