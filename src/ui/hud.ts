import type { GameMap } from '../map';

/** Velocímetro, cartel con el nombre de la calle y radar. */
export class Hud {
  private speedEl = document.getElementById('speed')!;
  private tachoEl = document.getElementById('tacho')!;
  private streetEl = document.getElementById('street')!;
  private radar = document.getElementById('radar') as HTMLCanvasElement;
  private rctx = this.radar.getContext('2d')!;
  private mapImg: HTMLCanvasElement;
  private street = -2;
  private pending = -2;
  private pendingT = 0;
  private hideT = 0;
  private static K = 0.5; // px por metro del mapa del radar

  constructor(private map: GameMap) {
    const segs = 20;
    for (let i = 0; i < segs; i++) {
      const s = document.createElement('i');
      s.style.background = i < 12 ? '#3cff7a' : i < 16 ? '#ffe23c' : '#ff3c5a';
      this.tachoEl.appendChild(s);
    }
    this.mapImg = this.renderMap();
  }

  private renderMap() {
    const { minX, minY, maxX, maxY } = this.map.bounds;
    const K = Hud.K;
    const c = document.createElement('canvas');
    c.width = Math.ceil((maxX - minX) * K);
    c.height = Math.ceil((maxY - minY) * K);
    const x = c.getContext('2d')!;
    x.fillStyle = '#2a1640';
    x.fillRect(0, 0, c.width, c.height);
    x.setTransform(K, 0, 0, -K, -minX * K, maxY * K);
    const ring = (r: Float32Array) => {
      x.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) x.lineTo(r[i], r[i + 1]);
      x.closePath();
    };
    x.fillStyle = '#2f7a4a';
    for (const a of this.map.areas) if (['park', 'garden', 'grass', 'pitch'].includes(a.kind)) { x.beginPath(); a.rings.forEach(ring); x.fill('evenodd'); }
    x.fillStyle = '#5a3a78';
    x.beginPath();
    for (const b of this.map.buildings) ring(b.rings[0]);
    x.fill();
    x.lineCap = x.lineJoin = 'round';
    for (const r of this.map.roads) {
      if (!r.drive) continue;
      x.strokeStyle = r.cls === 'primary' || r.cls === 'trunk' ? '#ffd27a' : '#e8b8d8';
      x.lineWidth = r.width * 0.9;
      x.beginPath();
      x.moveTo(r.pts[0], r.pts[1]);
      for (let i = 2; i < r.pts.length; i += 2) x.lineTo(r.pts[i], r.pts[i + 1]);
      x.stroke();
    }
    return c;
  }

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
    if (this.hideT < 0) this.streetEl.classList.remove('show');

    // radar giratorio (el coche siempre apunta hacia arriba)
    const c = this.rctx, W = this.radar.width, H = this.radar.height, K = Hud.K;
    const { minX, maxY } = this.map.bounds;
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
    c.drawImage(this.mapImg, -(x - minX) * K, -(maxY - y) * K);
    c.fillStyle = '#7ad8ff';
    for (const o of others) c.fillRect((o.x - x) * K - 1.5, -(o.y - y) * K - 1.5, 3, 3);
    c.restore();
    c.fillStyle = '#ff3c6a';
    c.beginPath();
    c.moveTo(W / 2, H / 2 + 6);
    c.lineTo(W / 2 - 5, H / 2 + 20);
    c.lineTo(W / 2 + 5, H / 2 + 20);
    c.fill();
  }
}
