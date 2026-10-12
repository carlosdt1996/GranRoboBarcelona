import type { RoadGraph } from '../roads';

/** Hora de Barcelona (Europe/Madrid), sea cual sea la zona horaria del jugador. */
export function bcnTime(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  return { h: Number(p.hour) % 24, m: Number(p.minute), weekday, day: Number(p.day), month: Number(p.month), year: Number(p.year) };
}

const FESTIUS = new Set(['1-1', '1-6', '5-1', '6-24', '8-15', '9-11', '9-24', '10-12', '11-1', '12-6', '12-8', '12-25', '12-26']);
const DAYS = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];

interface RawTraffic { source: string; trams: { id: number; n: string; p: number[]; h: number[] }[] }

/**
 * Tráfico real: el estado de los ~530 tramos que vigila el Ayuntamiento (en directo si se puede;
 * si no, el habitual a esta hora y este día) llevado a cada calle del grafo del juego.
 */
export class RealTraffic {
  /** Congestión 0 (muy fluido) .. 1 (atasco) por arista del grafo; -1 = cortada. */
  congestion: Float32Array;
  /** Cuánto tráfico hay en la ciudad ahora (0.3 de madrugada .. 1 en hora punta). */
  density = 0.7;
  live = false;
  label = '';

  private constructor(private graph: RoadGraph, private raw: RawTraffic) {
    this.congestion = new Float32Array(graph.edges.length).fill(0.3);
  }

  static async load(base: string, graph: RoadGraph): Promise<RealTraffic | null> {
    try {
      const res = await fetch(`${base}traffic.json`);
      if (!res.ok) return null;
      const t = new RealTraffic(graph, await res.json());
      await t.refresh();
      return t;
    } catch (e) {
      console.warn('tráfico real:', e);
      return null;
    }
  }

  /** Dato en directo (a través del proxy de Vite: el servidor del Ayuntamiento no admite CORS). */
  private async fetchLive(): Promise<Map<number, number> | null> {
    try {
      const res = await fetch('/bcn-transit/dadestrams.dat', { cache: 'no-store' });
      if (!res.ok) return null;
      const txt = await res.text();
      const out = new Map<number, number>();
      let newest = '';
      for (const line of txt.split('\n')) {
        const m = /^(\d+)#(\d{14})#(\d)#/.exec(line.trim());
        if (!m) continue;
        out.set(Number(m[1]), Number(m[3]));
        if (m[2] > newest) newest = m[2];
      }
      if (out.size < 50) return null;
      // descartar datos de hace más de una hora
      const now = bcnTime();
      const stamp = `${now.year}${String(now.month).padStart(2, '0')}${String(now.day).padStart(2, '0')}`;
      if (!newest.startsWith(stamp) || Math.abs(Number(newest.slice(8, 10)) - now.h) > 1) return null;
      return out;
    } catch {
      return null;
    }
  }

  /** Vuelve a calcular el estado de todas las calles (al arrancar y cada 5 minutos). */
  async refresh() {
    const now = bcnTime();
    const live = await this.fetchLive();
    this.live = !!live;
    const kind = now.weekday === 6 || FESTIUS.has(`${now.month}-${now.day}`) ? 2 : now.weekday === 5 ? 1 : 0;
    const hh = String(now.h).padStart(2, '0') + ':' + String(now.m).padStart(2, '0');
    this.label = live ? `TRÁFICO EN DIRECTO · ${hh}` : `TRÁFICO HABITUAL · ${DAYS[now.weekday]} ${hh}`;

    // estado 1..5 de cada tramo (o 6 = cortado), en directo o según el perfil
    const states: { pts: Float32Array; s: number }[] = [];
    for (const t of this.raw.trams) {
      let s = live?.get(t.id) ?? 0;
      if (!live || !s) {
        const v = t.h[kind * 24 + now.h];
        s = v >= 0 ? v / 10 : 0;
      }
      if (!s) continue;
      const pts = new Float32Array(t.p.length);
      let x = 0, y = 0;
      for (let i = 0; i < t.p.length; i += 2) { x += t.p[i]; y += t.p[i + 1]; pts[i] = x / 10; pts[i + 1] = y / 10; }
      states.push({ pts, s });
    }
    if (!states.length) return;
    const mean = states.reduce((a, b) => a + Math.min(5, b.s), 0) / states.length;
    this.density = 0.3 + 0.7 * Math.min(1, Math.max(0, (mean - 1.1) / 1.4));

    // rejilla de segmentos de tramo (64 m) y media por zonas (256 m) para las calles sin medidor
    const C = 64, Z = 256;
    const grid = new Map<number, number[]>(), zone = new Map<number, [number, number]>();
    const segs: number[] = []; // ax, ay, bx, by, estado
    for (const { pts, s } of states) {
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const id = segs.length / 5;
        segs.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], s);
        for (let cx = Math.floor((Math.min(pts[i], pts[i + 2]) - 20) / C); cx <= Math.floor((Math.max(pts[i], pts[i + 2]) + 20) / C); cx++)
          for (let cy = Math.floor((Math.min(pts[i + 1], pts[i + 3]) - 20) / C); cy <= Math.floor((Math.max(pts[i + 1], pts[i + 3]) + 20) / C); cy++) {
            const k = cx * 65536 + cy;
            let l = grid.get(k);
            if (!l) grid.set(k, (l = []));
            l.push(id);
          }
        const zk = Math.floor(pts[i] / Z) * 65536 + Math.floor(pts[i + 1] / Z);
        const z = zone.get(zk) ?? [0, 0];
        z[0] += Math.min(s, 5); z[1]++;
        zone.set(zk, z);
      }
    }
    const cong = (s: number) => (s >= 6 ? -1 : Math.min(1, Math.max(0, (s - 1) / 3.5)));
    const tmp = { x: 0, y: 0, a: 0 };
    for (const e of this.graph.edges) {
      const p = this.graph.pose(e, e.len / 2, 0, tmp);
      const fx = Math.sin(p.a), fy = Math.cos(p.a);
      let best = 18, st = 0;
      for (const id of grid.get(Math.floor(p.x / C) * 65536 + Math.floor(p.y / C)) ?? []) {
        const ax = segs[id * 5], ay = segs[id * 5 + 1], dx = segs[id * 5 + 2] - ax, dy = segs[id * 5 + 3] - ay;
        const L = Math.hypot(dx, dy) || 1;
        // mismo sentido de circulación que el tramo medido
        if ((dx * fx + dy * fy) / L < 0.5) continue;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (L * L)));
        const d = Math.hypot(ax + dx * t - p.x, ay + dy * t - p.y);
        if (d < best) { best = d; st = segs[id * 5 + 4]; }
      }
      if (st) { this.congestion[e.id] = cong(st); continue; }
      // calle sin medidor: la mitad de lo que hay en su zona
      let sum = 0, n = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const z = zone.get((Math.floor(p.x / Z) + dx) * 65536 + Math.floor(p.y / Z) + dy);
          if (z) { sum += z[0]; n += z[1]; }
        }
      this.congestion[e.id] = n ? cong(sum / n) * 0.5 : cong(mean) * 0.4;
    }
  }
}
