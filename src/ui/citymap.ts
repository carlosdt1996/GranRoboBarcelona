import type { World } from '../map';

/**
 * Mapa de toda Barcelona (tecla M): imagen pregenerada por tools/build_city.py con los
 * edificios, parques, mar y calles, más los distritos y la posición del coche.
 * Rueda o +/− para hacer zoom, arrastrar para moverse, clic para ir a ese punto.
 */
export class CityMap {
  open = false;
  /** Shift+clic: ir allí directamente. */
  onPick?: (x: number, y: number) => void;
  /** Clic: marcar destino para el GPS; clic derecho: quitarlo. */
  onWaypoint?: (x: number, y: number) => void;
  onClearWaypoint?: () => void;
  /** Lo que se dibuja encima: ruta del GPS, destino y marcas (helicópteros, policía...). */
  route: Float32Array | null = null;
  target: { x: number; y: number } | null = null;
  marks: { x: number; y: number; c: string; label?: string }[] = [];
  private root: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: HTMLImageElement | null = null;
  /** Centro de la vista (metros) y escala (píxeles de pantalla por metro). */
  private cx = 0;
  private cy = 0;
  private s = 0.05;
  private drag: { id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private t = 0;

  constructor(private world: World, private base: string) {
    this.root = document.createElement('div');
    this.root.id = 'citymap';
    this.root.hidden = true;
    this.root.innerHTML = `
      <canvas></canvas>
      <div class="cm-title">BARCELONA</div>
      <div class="cm-btns"><button data-z="1.5">+</button><button data-z="0.667">−</button><button data-close>✕</button></div>
      <div class="cm-help">CLIC: DESTINO GPS · CLIC DCHO: QUITARLO · MAYÚS+CLIC: IR AHÍ · RUEDA: ZOOM · M: CERRAR</div>`;
    document.body.appendChild(this.root);
    this.cv = this.root.querySelector('canvas')!;
    this.ctx = this.cv.getContext('2d')!;

    this.root.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) =>
      b.addEventListener('click', () => this.zoomAt(Number(b.dataset.z), innerWidth / 2, innerHeight / 2)));
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.toggle(0, 0));
    this.cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY);
    }, { passive: false });
    this.cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onClearWaypoint?.(); });
    this.cv.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false };
      try { this.cv.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
    });
    this.cv.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 6) d.moved = true;
      if (d.moved) {
        this.cx = d.cx - dx / this.s;
        this.cy = d.cy + dy / this.s;
      }
    });
    this.cv.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.id !== e.pointerId || d.moved) return;
      const [x, y] = this.toWorld(e.clientX, e.clientY);
      const b = this.world.bounds;
      if (!(x > b.minX && x < b.maxX && y > b.minY && y < b.maxY)) return;
      if (e.shiftKey) this.onPick?.(x, y);
      else this.onWaypoint?.(x, y);
    });
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return [this.cx + (sx - innerWidth / 2) / this.s, this.cy - (sy - innerHeight / 2) / this.s];
  }

  private zoomAt(k: number, sx: number, sy: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    const b = this.world.bounds;
    const fit = Math.min(innerWidth / (b.maxX - b.minX), innerHeight / (b.maxY - b.minY));
    this.s = Math.max(fit * 0.8, Math.min(2, this.s * k));
    // el punto bajo el cursor no se mueve
    this.cx = wx - (sx - innerWidth / 2) / this.s;
    this.cy = wy + (sy - innerHeight / 2) / this.s;
  }

  /** Abre (centrado en el coche, a escala de barrio) o cierra el mapa. */
  toggle(px: number, py: number) {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (!this.open) return;
    if (!this.img) {
      this.img = new Image();
      this.img.src = `${this.base}map.png`;
    }
    const b = this.world.bounds;
    const fit = Math.min(innerWidth / (b.maxX - b.minX), innerHeight / (b.maxY - b.minY));
    this.s = fit * 2.5;
    this.cx = px;
    this.cy = py;
  }

  draw(dt: number, px: number, py: number, a: number) {
    this.t += dt;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = innerWidth, H = innerHeight;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) {
      this.cv.width = Math.round(W * dpr);
      this.cv.height = Math.round(H * dpr);
    }
    const c = this.ctx, b = this.world.bounds, s = this.s;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#1a0e2a';
    c.fillRect(0, 0, W, H);
    const sx = (x: number) => (x - this.cx) * s + W / 2, sy = (y: number) => (this.cy - y) * s + H / 2;
    if (this.img?.complete && this.img.naturalWidth) {
      c.imageSmoothingEnabled = s * (b.maxX - b.minX) < this.img.naturalWidth;
      c.drawImage(this.img, sx(b.minX), sy(b.maxY), (b.maxX - b.minX) * s, (b.maxY - b.minY) * s);
    } else {
      c.fillStyle = '#fff';
      c.font = "10px 'Press Start 2P', monospace";
      c.textAlign = 'center';
      c.fillText('CARGANDO MAPA...', W / 2, H / 2);
    }

    // distritos
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `${s > 0.12 ? 12 : 9}px 'Press Start 2P', monospace`;
    for (const [name, x, y] of this.world.districts) {
      const tx = sx(x), ty = sy(y);
      if (tx < -200 || tx > W + 200 || ty < -20 || ty > H + 20) continue;
      c.fillStyle = '#1a0e2a';
      c.fillText(name.toUpperCase(), tx + 2, ty + 2);
      c.fillStyle = '#ffe7a0';
      c.fillText(name.toUpperCase(), tx, ty);
    }

    // ruta del GPS, destino y marcas
    if (this.route) {
      const r = this.route;
      c.strokeStyle = '#1a0e2a';
      c.lineWidth = 7;
      c.lineJoin = c.lineCap = 'round';
      for (const [col, w] of [['#1a0e2a', 7], ['#ff3cf0', 4]] as const) {
        c.strokeStyle = col;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(sx(r[0]), sy(r[1]));
        for (let i = 2; i < r.length; i += 2) c.lineTo(sx(r[i]), sy(r[i + 1]));
        c.stroke();
      }
    }
    for (const m of this.marks) {
      const mx = sx(m.x), my = sy(m.y);
      c.fillStyle = '#1a0e2a';
      c.fillRect(mx - 7, my - 7, 14, 14);
      c.fillStyle = m.c;
      c.fillRect(mx - 5, my - 5, 10, 10);
      if (m.label) {
        c.fillStyle = '#1a0e2a';
        c.font = "8px 'Press Start 2P', monospace";
        c.fillText(m.label, mx, my + 1);
      }
    }
    if (this.target) {
      const tx = sx(this.target.x), ty = sy(this.target.y);
      c.fillStyle = '#ff3cf0';
      c.strokeStyle = '#1a0e2a';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(tx, ty);
      c.lineTo(tx - 8, ty - 14);
      c.arc(tx, ty - 16, 8, Math.PI * 0.85, Math.PI * 2.15);
      c.closePath();
      c.stroke();
      c.fill();
    }

    // el coche (parpadea)
    const x = sx(px), y = sy(py);
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = Math.floor(this.t * 3) % 2 ? '#ffffff' : '#ff3c6a';
    c.strokeStyle = '#1a0e2a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
  }
}
