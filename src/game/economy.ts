import type { WeaponId } from './combat';

/** Precios de la armería. */
export const PRICES: { id: WeaponId | 'armor'; name: string; price: number }[] = [
  { id: 'smg', name: 'SUBFUSIL', price: 500 },
  { id: 'shotgun', name: 'ESCOPETA', price: 800 },
  { id: 'grenade', name: 'GRANADAS', price: 300 },
  { id: 'rocket', name: 'LANZACOHETES', price: 5000 },
  { id: 'armor', name: 'CHALECO ANTIBALAS', price: 200 },
];

const KEY = 'gran-robo-barcelona.save';

/** Dinero, armas, paquetes ocultos, misiones y estadísticas de la partida (se guarda en el navegador). */
export class Economy {
  money = 0;
  /** El contador del HUD sube poco a poco hasta `money`, como en Vice City. */
  shown = 0;
  owned = new Set<WeaponId>(['fists', 'pistol']);
  packages = new Set<number>();
  missions = 0;
  career = { km: 0, jacked: 0, runover: 0, kills: 0, cops: 0, booms: 0, maxStars: 0, deaths: 0, busted: 0, fares: 0, spent: 0 };

  earn(n: number) {
    this.money = Math.max(0, this.money + Math.round(n));
  }

  spend(n: number) {
    if (this.money < n) return false;
    this.money -= n;
    this.career.spent += n;
    return true;
  }

  /** Cuenta del HUD: $00001234 */
  tick(dt: number) {
    const d = this.money - this.shown;
    this.shown += Math.sign(d) * Math.min(Math.abs(d), Math.max(1, Math.abs(d) * dt * 4));
    return `$${String(Math.round(this.shown)).padStart(8, '0')}`;
  }

  save(extra: Record<string, unknown> = {}) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        money: this.money, owned: [...this.owned], packages: [...this.packages], missions: this.missions, career: this.career, ...extra,
      }));
      return true;
    } catch {
      return false;
    }
  }

  /** Carga la partida guardada (si hay). Devuelve los datos extra guardados (p. ej. la posición). */
  load(): Record<string, unknown> | null {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d) return null;
      this.money = this.shown = d.money ?? 0;
      this.owned = new Set(d.owned ?? ['fists', 'pistol']);
      this.packages = new Set(d.packages ?? []);
      this.missions = d.missions ?? 0;
      Object.assign(this.career, d.career ?? {});
      return d;
    } catch {
      return null;
    }
  }

  stats(): [string, string][] {
    const c = this.career;
    return [
      ['DINERO', `$${this.money}`],
      ['MISIONES COMPLETADAS', `${this.missions} DE 4`],
      ['PAQUETES OCULTOS', `${this.packages.size} DE 20`],
      ['KILÓMETROS RECORRIDOS', c.km.toFixed(1)],
      ['COCHES ROBADOS', String(c.jacked)],
      ['PEATONES ATROPELLADOS', String(c.runover)],
      ['PEATONES ABATIDOS', String(c.kills)],
      ['POLICÍAS ABATIDOS', String(c.cops)],
      ['EXPLOSIONES', String(c.booms)],
      ['CARRERAS DE TAXI', String(c.fares)],
      ['NIVEL MÁXIMO DE BÚSQUEDA', '★'.repeat(c.maxStars) || '-'],
      ['VECES HOSPITALIZADO', String(c.deaths)],
      ['VECES DETENIDO', String(c.busted)],
    ];
  }
}
