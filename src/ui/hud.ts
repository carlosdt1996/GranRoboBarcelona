import { overlaps, type Tile, type TileListener, type World } from '../map';

/** Velocímetro, cartel con el nombre de la calle y radar. */
export class Hud implements TileListener {
  private speedEl = document.getElementById('speed')!;
  private tachoEl = document.getElementById('tacho')!;
  private streetEl = document.getElementById('street')!;
  private altEl = document.getElementById('alt')!;
  private gpsEl = document.getElementById('gpsinfo')!;
  private objEl = document.getElementById('objective')!;
  private timerEl = document.getElementById('timer')!;
  private bigEl = document.getElementById('big')!;
  private bigT = 0;
  private dlgEl = document.getElementById('dialog')!;
  private dlgLines: [string, string][] = [];
  private dlgDone: (() => void) | null = null;
  /** Cada línea de diálogo (para que el director cambie de plano). */
  onLine?: (id: string) => void;
  /** Retrato y nombre de quien habla en los diálogos. */
  speaker?: (id: string) => { name: string; portrait: HTMLCanvasElement };
  private radar = document.getElementById('radar') as HTMLCanvasElement;
  private rctx = this.radar.getContext('2d')!;
  private radarTiles = new Map<string, { x: number; y: number; img: HTMLCanvasElement }>();
  private street = -2;
  private pending = -2;
  private pendingT = 0;
  private hideT = 0;
  private static K = 0.5; // px por metro del mapa del radar

  constructor(private map: World) {
    const segs = 20;
    for (let i = 0; i < segs; i++) {
      const s = document.createElement('i');
      s.style.background = i < 12 ? '#3cff7a' : i < 16 ? '#ffe23c' : '#ff3c5a';
      this.tachoEl.appendChild(s);
    }
    map.listen(this);
  }

  tileUnloaded(t: Tile) {
    this.radarTiles.delete(t.key);
  }

  /** Imagen del radar de una tesela: parques, mar, edificios y calles. */
  tileLoaded(t: Tile) {
    const S = this.map.tileSize, K = Hud.K;
    const minX = t.tx * S, minY = t.ty * S, maxX = minX + S, maxY = minY + S;
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(S * K);
    const x = c.getContext('2d')!;
    x.setTransform(K, 0, 0, -K, -minX * K, maxY * K);
    x.fillStyle = '#2a1640';
    x.fillRect(minX, minY, S, S);
    const ring = (r: Float32Array) => {
      x.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) x.lineTo(r[i], r[i + 1]);
      x.closePath();
    };
    const fills: Record<string, string> = { park: '#2f7a4a', garden: '#2f7a4a', grass: '#2f7a4a', pitch: '#2f7a4a', forest: '#2a6a40', sea: '#2a3a8a', water: '#3a5ab0' };
    for (const a of t.areas) {
      if (!fills[a.kind]) continue;
      x.fillStyle = fills[a.kind];
      x.beginPath(); a.rings.forEach(ring); x.fill('evenodd');
    }
    x.fillStyle = '#5a3a78';
    x.beginPath();
    for (const b of t.buildings) if (b.minHeight < 2.5) ring(b.rings[0]);
    x.fill();
    x.lineCap = x.lineJoin = 'round';
    const box = { minX: minX - 20, minY: minY - 20, maxX: maxX + 20, maxY: maxY + 20 };
    for (const r of this.map.roads) {
      if (!r.drive || !overlaps(r, box)) continue;
      x.strokeStyle = r.cls === 'primary' || r.cls === 'trunk' ? '#ffd27a' : '#e8b8d8';
      x.lineWidth = r.width * 0.9;
      x.beginPath();
      x.moveTo(r.pts[0], r.pts[1]);
      for (let i = 2; i < r.pts.length; i += 2) x.lineTo(r.pts[i], r.pts[i + 1]);
      x.stroke();
    }
    this.radarTiles.set(t.key, { x: minX, y: maxY, img: c });
  }

  /** Mensaje breve en el cartel de arriba (p. ej. "ATERRIZA PARA BAJAR"). */
  say(text: string) {
    this.streetEl.textContent = text;
    this.streetEl.classList.remove('show');
    void this.streetEl.offsetWidth;
    this.streetEl.classList.add('show');
    this.hideT = 2.5;
    this.street = -3;
    this.pending = -3;
  }

  /** Indicador del GPS: flecha hacia dónde ir (rumbo relativo) y distancia que queda. */
  gps(info: { left: number; rel: number } | null) {
    this.gpsEl.hidden = !info;
    if (!info) return;
    (this.gpsEl.firstElementChild as HTMLElement).style.transform = `rotate(${info.rel}rad)`;
    const km = info.left / 1000;
    (this.gpsEl.lastElementChild as HTMLElement).textContent = km >= 1 ? `${km.toFixed(1).replace('.', ',')} KM` : `${Math.round(info.left / 10) * 10} M`;
  }

  /** Objetivo de la misión (abajo, como en GTA). */
  objective(text: string | null) {
    this.objEl.hidden = !text;
    if (text) this.objEl.textContent = text;
  }

  /** Cuenta atrás (null = oculta). */
  timer(s: number | null) {
    this.timerEl.hidden = s === null;
    if (s !== null) this.timerEl.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  /** Rótulo grande en el centro ("¡MISIÓN SUPERADA!"). */
  big(title: string, sub = '') {
    this.bigEl.hidden = false;
    this.bigEl.firstElementChild!.textContent = title;
    this.bigEl.lastElementChild!.textContent = sub;
    this.bigEl.style.animation = 'none';
    void this.bigEl.offsetWidth;
    this.bigEl.style.animation = '';
    this.bigT = 4;
  }

  get talking() {
    return this.dlgDone !== null;
  }

  /** Diálogo: líneas [quién, texto]; Enter, Espacio o clic para seguir. */
  dialog(lines: [string, string][], onDone: () => void) {
    this.dlgLines = [...lines];
    this.dlgDone = onDone;
    if (!this.dlgLines.length) { this.dlgDone = null; onDone(); return; }
    this.showLine();
    this.dlgEl.onclick = () => this.advance();
  }

  private showLine() {
    const [id, text] = this.dlgLines[0];
    this.onLine?.(id);
    const sp = this.speaker?.(id);
    this.dlgEl.hidden = false;
    const cv = this.dlgEl.querySelector('canvas')!;
    const cx = cv.getContext('2d')!;
    cx.clearRect(0, 0, 16, 32);
    if (sp) cx.drawImage(sp.portrait, 0, 0);
    this.dlgEl.querySelector('b')!.textContent = sp?.name ?? id;
    this.dlgEl.querySelector('span')!.textContent = text;
  }

  advance() {
    if (!this.dlgDone) return;
    this.dlgLines.shift();
    if (this.dlgLines.length) { this.showLine(); return; }
    this.dlgEl.hidden = true;
    const done = this.dlgDone;
    this.dlgDone = null;
    done();
  }

  /** Altímetro (null = oculto). */
  altitude(m: number | null) {
    this.altEl.hidden = m === null;
    if (m !== null) this.altEl.textContent = `ALT ${String(Math.round(m)).padStart(4, ' ')} m`;
  }

  /** Marcas extra en el radar: helicópteros, policía, destino del GPS... */
  marks: { x: number; y: number; c: string; s?: number }[] = [];
  /** Ruta del GPS (polilínea x, y...). */
  route: Float32Array | null = null;

  update(dt: number, kmh: number, rpm: number, x: number, y: number, a: number, streetName: number, others: { x: number; y: number }[]) {
    this.speedEl.textContent = String(Math.round(kmh)).padStart(3, ' ');
    const on = Math.round(rpm * this.tachoEl.children.length);
    for (let i = 0; i < this.tachoEl.children.length; i++) (this.tachoEl.children[i] as HTMLElement).style.opacity = i < on ? '1' : '0.15';

    // cartel de la calle: aparece al cambiar de calle (con un pequeño retardo)
    if (streetName !== this.pending) { this.pending = streetName; this.pendingT = 0; }
    this.pendingT += dt;
    if (this.pendingT > 0.5 && this.pending !== this.street && this.pending >= 0) {
      this.street = this.pending;
      this.streetEl.textContent = this.map.names[this.street];
      this.streetEl.classList.remove('show');
      void this.streetEl.offsetWidth;
      this.streetEl.classList.add('show');
      this.hideT = 4;
    }
    this.hideT -= dt;
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) this.bigEl.hidden = true; }
    if (this.hideT < 0) this.streetEl.classList.remove('show');

    // radar giratorio (el coche siempre apunta hacia arriba)
    const c = this.rctx, W = this.radar.width, H = this.radar.height, K = Hud.K;
    c.save();
    c.clearRect(0, 0, W, H);
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#1a0e2a';
    c.fillRect(0, 0, W, H);
    c.translate(W / 2, H / 2 + 14);
    c.rotate(-a);
    c.scale(0.9, 0.9);
    c.imageSmoothingEnabled = false;
    for (const t of this.radarTiles.values()) {
      const S = this.map.tileSize;
      if (t.x > x + 260 || t.x + S < x - 260 || t.y < y - 260 || t.y - S > y + 260) continue;
      c.drawImage(t.img, (t.x - x) * K, (y - t.y) * K);
    }
    c.fillStyle = '#7ad8ff';
    for (const o of others) c.fillRect((o.x - x) * K - 1.5, -(o.y - y) * K - 1.5, 3, 3);
    if (this.route) {
      const r = this.route;
      c.strokeStyle = '#ff3cf0';
      c.lineWidth = 3;
      c.lineJoin = c.lineCap = 'round';
      c.beginPath();
      c.moveTo((r[0] - x) * K, -(r[1] - y) * K);
      for (let i = 2; i < r.length; i += 2) c.lineTo((r[i] - x) * K, -(r[i + 1] - y) * K);
      c.stroke();
    }
    for (const m of this.marks) {
      const s = m.s ?? 5;
      // fuera del radio del radar se quedan pegadas al borde
      let mx = (m.x - x) * K, my = -(m.y - y) * K;
      const d = Math.hypot(mx, my), R = (W / 2 - 6) / 0.9;
      if (d > R) { mx *= R / d; my *= R / d; }
      c.fillStyle = '#1a0e2a';
      c.fillRect(mx - s / 2 - 1, my - s / 2 - 1, s + 2, s + 2);
      c.fillStyle = m.c;
      c.fillRect(mx - s / 2, my - s / 2, s, s);
    }
    c.restore();
    c.fillStyle = '#ff3c6a';
    c.beginPath();
    c.moveTo(W / 2, H / 2 + 6);
    c.lineTo(W / 2 - 5, H / 2 + 20);
    c.lineTo(W / 2 + 5, H / 2 + 20);
    c.fill();
  }
}
