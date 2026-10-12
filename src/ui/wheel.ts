import { WEAPONS, type WeaponId } from '../game/combat';

/** Iconos pixel art de las armas (32×16, escalados sin suavizado). */
export function weaponIcon(id: WeaponId): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 16;
  const x = c.getContext('2d')!;
  const r = (a: number, b: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  const G = '#2a2a34', L = '#5a5a6a', W = '#8a5a3a';
  switch (id) {
    case 'fists':
      r(10, 4, 12, 9, '#e8b890'); r(10, 4, 12, 2, '#f4d0a8'); r(13, 6, 1, 6, '#b88860'); r(16, 6, 1, 6, '#b88860'); r(19, 6, 1, 6, '#b88860'); r(8, 7, 3, 5, '#e8b890');
      break;
    case 'pistol':
      r(8, 4, 16, 4, G); r(9, 3, 14, 1, L); r(9, 8, 5, 6, G); r(14, 8, 3, 2, L);
      break;
    case 'smg':
      r(4, 5, 22, 4, G); r(5, 4, 20, 1, L); r(13, 9, 3, 6, G); r(7, 9, 3, 4, G); r(26, 6, 3, 2, G); r(2, 6, 2, 2, L);
      break;
    case 'shotgun':
      r(1, 5, 28, 3, G); r(1, 4, 20, 1, L); r(18, 8, 12, 4, W); r(21, 12, 8, 2, W); r(10, 8, 6, 2, W);
      break;
    case 'rocket':
      r(2, 5, 28, 6, '#4a5a3a'); r(2, 4, 28, 1, '#6a7a4a'); r(0, 4, 3, 8, G); r(12, 11, 3, 4, G); r(18, 11, 3, 3, G); r(29, 6, 3, 4, '#c82018');
      break;
    case 'grenade':
      r(11, 4, 10, 11, '#3a4a2a'); r(12, 3, 8, 1, '#5a6a3a'); r(14, 1, 4, 2, L); r(18, 0, 4, 1, L); r(13, 6, 1, 8, '#5a6a3a'); r(17, 6, 1, 8, '#2a3a1a');
      break;
  }
  return c;
}

/**
 * Rueda de armas: se abre manteniendo Tab (o tocando el icono del arma), se elige con el ratón,
 * con ←/→ o tocando, y se confirma al soltar (o al tocar). Mientras está abierta el tiempo va lento.
 */
export class WeaponWheel {
  open = false;
  sel = 0;
  /** Abierta desde la pantalla táctil: se cierra al elegir, no al soltar. */
  touch = false;
  onPick?: (i: number) => void;
  /** ¿Tiene el jugador este arma? (las demás salen bloqueadas) */
  owned: (i: number) => boolean = () => true;
  private root: HTMLDivElement;
  private items: HTMLElement[] = [];
  private label: HTMLElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'wheel';
    this.root.hidden = true;
    this.label = document.createElement('div');
    this.label.className = 'wl';
    this.root.appendChild(this.label);
    WEAPONS.forEach((w, i) => {
      const it = document.createElement('div');
      it.className = 'wi';
      const a = (i / WEAPONS.length) * Math.PI * 2;
      it.style.left = `calc(50% + ${Math.sin(a) * 120}px)`;
      it.style.top = `calc(50% - ${Math.cos(a) * 120}px)`;
      it.appendChild(weaponIcon(w.id));
      it.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.sel = i; this.refresh(); if (this.touch) this.close(); });
      this.root.appendChild(it);
      this.items.push(it);
    });
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root && this.touch) this.close(); });
    addEventListener('mousemove', (e) => {
      if (!this.open || this.touch) return;
      const dx = e.clientX - innerWidth / 2, dy = e.clientY - innerHeight / 2;
      if (Math.hypot(dx, dy) < 40) return;
      const a = Math.atan2(dx, -dy);
      this.sel = ((Math.round((a / (Math.PI * 2)) * WEAPONS.length) % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
      this.refresh();
    });
    document.body.appendChild(this.root);
  }

  show(current: number, touch = false) {
    this.open = true;
    this.touch = touch;
    this.sel = current;
    this.root.hidden = false;
    this.refresh();
  }

  step(d: number) {
    this.sel = (this.sel + d + WEAPONS.length) % WEAPONS.length;
    this.refresh();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    if (this.owned(this.sel)) this.onPick?.(this.sel);
  }

  private refresh() {
    this.items.forEach((it, i) => { it.classList.toggle('on', i === this.sel); it.classList.toggle('locked', !this.owned(i)); });
    this.label.textContent = this.owned(this.sel) ? WEAPONS[this.sel].name : `${WEAPONS[this.sel].name} · NO LA TIENES`;
  }
}
