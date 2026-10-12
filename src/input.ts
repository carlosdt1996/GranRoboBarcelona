import type { Controls } from './game/vehicle';
import { clamp } from './geom';

/** Teclado, pantalla táctil y mando. */
export class Input {
  private keys = new Set<string>();
  private touchSteer = 0;
  private steerPointer: number | null = null;
  private steerX0 = 0;
  private btn: Record<string, boolean> = {};
  private pressedOnce = new Set<string>();
  readonly touch = matchMedia('(pointer: coarse)').matches;

  constructor() {
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    const pad = document.getElementById('steer');
    if (pad) {
      pad.addEventListener('pointerdown', (e) => {
        this.steerPointer = e.pointerId;
        this.steerX0 = e.clientX;
        try { pad.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
        this.updateKnob(pad, 0);
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId !== this.steerPointer) return;
        this.touchSteer = clamp((e.clientX - this.steerX0) / 55, -1, 1);
        this.updateKnob(pad, this.touchSteer);
      });
      const end = (e: PointerEvent) => {
        if (e.pointerId !== this.steerPointer) return;
        this.steerPointer = null;
        this.touchSteer = 0;
        this.updateKnob(pad, 0);
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

  private updateKnob(pad: HTMLElement, v: number) {
    const knob = pad.querySelector<HTMLElement>('.knob');
    if (knob) knob.style.transform = `translateX(${v * 46}px)`;
  }

  /** true una sola vez por pulsación. */
  pressed(code: string) {
    const r = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return r;
  }

  controls(): Controls {
    const k = (...c: string[]) => c.some((x) => this.keys.has(x));
    let throttle = k('ArrowUp', 'KeyW') || this.btn.gas ? 1 : 0;
    let brake = k('ArrowDown', 'KeyS') || this.btn.brake ? 1 : 0;
    let steer = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0) + this.touchSteer;
    let handbrake = k('Space') || !!this.btn.drift;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer += ax;
      throttle = Math.max(throttle, gp.buttons[7]?.value || 0, gp.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, gp.buttons[6]?.value || 0, gp.buttons[1]?.pressed ? 1 : 0);
      handbrake ||= !!gp.buttons[2]?.pressed || !!gp.buttons[5]?.pressed;
    }
    return { throttle, brake, steer: clamp(steer, -1, 1), handbrake };
  }
}
