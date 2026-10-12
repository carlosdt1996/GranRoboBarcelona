import type { RoofMap } from '../../heights';
import type { World } from '../../map';
import type { Actor, Actors } from '../actors';
import type { Economy } from '../economy';
import type { Gps } from '../gps';
import type { Heli } from '../heli';
import type { Interiors, Room } from '../interiors';
import type { Marker, Markers } from '../pickups';
import type { Police } from '../police';
import type { Traffic, AICar } from '../traffic';
import { Vehicle } from '../vehicle';
import { MISSIONS, type Line, type Mission, type Pt, type Step } from './missions';

export interface Player {
  x: number; y: number; z: number; a: number; speed: number;
  car: Vehicle | null; heli: Heli | null; onFoot: boolean; inside: Room | null; dead: boolean;
}

/** Lo que el motor necesita del juego (lo monta main.ts). */
export interface StoryCtx {
  world: World;
  roofs: RoofMap;
  traffic: Traffic;
  police: Police;
  actors: Actors;
  economy: Economy;
  gps: Gps;
  markers: Markers;
  interiors: Interiors;
  player(): Player;
  /** Coche aparcado en la acera más cercana a (x, y). */
  parkCar(kind: Vehicle['kind'], color: string, x: number, y: number): Vehicle;
  say(text: string): void;
  objective(text: string | null): void;
  timer(seconds: number | null): void;
  big(title: string, sub?: string): void;
  dialog(lines: Line[], onDone: () => void): void;
  /** Plano de presentación del objetivo (si está cerca). */
  reveal(x: number, y: number, caption: string): void;
  /** Giro de cámara alrededor del jugador al superar la misión. */
  celebrate(): void;
  jingle(win: boolean): void;
  save(): void;
}

interface Run {
  m: Mission;
  step: number;
  t: number;
  /** Estado del paso actual. */
  car: Vehicle | null;
  ais: AICar[];
  targets: Actor[];
  marker: Marker | null;
  gotIn: boolean;
  checkpoint: number;
  collected: Set<Actor>;
  passenger: Actor | null;
  talking: boolean;
}

/**
 * Motor de la historia: las misiones se encargan dentro de los locales de los jefes (marcador en el
 * interior), empiezan con un diálogo y encadenan pasos con objetivos, GPS, marcadores y tiempo límite.
 */
export class Story {
  run: Run | null = null;
  private giverMarker: Marker | null = null;
  private giverActor: Actor | null = null;
  private msgT = 0;

  constructor(private c: StoryCtx) {}

  /** La siguiente misión de la historia (o null si ya se ha acabado). */
  get next(): Mission | null {
    return MISSIONS[this.c.economy.missions] ?? null;
  }

  /** Local del jefe de la siguiente misión (para el mapa). */
  giverRoom(): Room | null {
    const m = this.next;
    return m ? this.c.interiors.rooms.find((r) => r.id === `jefe:${m.giver}`) ?? null : null;
  }

  private local(p: Pt): [number, number] {
    return this.c.world.toLocal(p[0], p[1]);
  }

  /** Marcador de inicio dentro del local del jefe, con el jefe esperando. */
  private updateGiver(p: Player) {
    const room = this.giverRoom();
    const inRoom = !!room && p.inside === room && !this.run;
    if (inRoom && !this.giverMarker) {
      const [gx, gy] = room!.giver;
      this.giverActor = this.c.actors.spawn(this.next!.giver, gx, gy, 'idle');
      this.giverActor.a = Math.PI;
      this.giverMarker = this.c.markers.add(gx, gy - 1.6, 0, 'mission', this.next!.title, 0, '#ffd020');
      this.giverMarker.mesh.position.y = 1000;
      this.giverMarker.mesh.scale.set(0.5, 0.55, 0.5);
    }
    if (!inRoom && this.giverMarker) {
      this.c.markers.remove(this.giverMarker);
      this.giverMarker = null;
      if (this.giverActor && !this.run) { this.giverActor.mission = false; this.giverActor.x = 1e9; }
      this.giverActor = null;
    }
    if (inRoom && this.giverMarker && Math.hypot(p.x - this.giverMarker.x, p.y - this.giverMarker.y) < 1.4) this.start(this.next!);
  }

  start(m: Mission) {
    if (this.giverMarker) { this.c.markers.remove(this.giverMarker); this.giverMarker = null; }
    this.c.big(m.title, m.act);
    this.run = { m, step: -1, t: m.time ?? 0, car: null, ais: [], targets: [], marker: null, gotIn: false, checkpoint: 0, collected: new Set(), passenger: null, talking: true };
    this.c.dialog(m.intro, () => { if (this.run) { this.run.talking = false; this.nextStep(); } });
  }

  private cleanStep() {
    const r = this.run!;
    if (r.marker) { this.c.markers.remove(r.marker); r.marker = null; }
    this.c.gps.clear();
  }

  private nextStep() {
    const r = this.run!;
    this.cleanStep();
    r.step++;
    if (r.step >= r.m.steps.length) { this.pass(); return; }
    const s = r.m.steps[r.step];
    this.begin(s);
  }

  private mark(x: number, y: number, color = '#ffd020') {
    const r = this.run!;
    if (r.marker) this.c.markers.remove(r.marker);
    r.marker = this.c.markers.add(x, y, 0, 'mission', '', 0, color);
    const p = this.c.player();
    // dentro de un local, la ruta sale de su puerta
    const [px, py] = p.inside ? [p.inside.door[0], p.inside.door[1]] : [p.x, p.y];
    this.c.gps.setTarget(x, y, px, py, p.a, p.onFoot);
  }

  private begin(s: Step) {
    const r = this.run!, c = this.c;
    r.gotIn = false;
    if (s.t === 'talk') {
      r.talking = true;
      c.objective(null);
      c.dialog(s.lines, () => { r.talking = false; this.nextStep(); });
      return;
    }
    c.objective(s.text);
    if (s.t === 'goto' || s.t === 'deliver') { const [x, y] = this.local(s.at); this.mark(x, y); }
    if (s.t === 'steal') {
      const [x, y] = this.local(s.at);
      r.car = c.parkCar(s.kind, s.color, x, y);
      c.traffic.keep.add(r.car);
      this.mark(r.car.x, r.car.y, '#3cff7a');
      c.reveal(r.car.x, r.car.y, s.text);
    }
    if (s.t === 'destroy') {
      const [x, y] = this.local(s.at);
      for (let i = 0; i < (s.count ?? 1); i++) {
        const ai = c.traffic.spawnAt(x + i * 18, y + i * 6, s.kind, s.color, 17);
        if (!ai) continue;
        ai.panic = 1e9;
        c.traffic.keep.add(ai.v);
        r.ais.push(ai);
      }
      this.mark(x, y, '#ff3c6a');
      if (r.ais[0]) c.reveal(r.ais[0].v.x, r.ais[0].v.y, s.text);
    }
    if (s.t === 'kill') {
      const [x, y] = this.local(s.at);
      for (const id of s.who) r.targets.push(c.actors.spawn(id, x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, s.guards ? 'hostile' : 'idle'));
      for (let i = 0; i < (s.guards ?? 0); i++) c.actors.spawn('goon', x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12, 'hostile');
      this.mark(x, y, '#ff3c6a');
      c.reveal(x, y, s.text);
    }
    if (s.t === 'pickup') { const [x, y] = this.local(s.at); this.mark(x, y, '#3cff7a'); c.reveal(x, y, s.text); }
    if (s.t === 'escape') { if (c.police.stars < s.stars) c.police.setStars(s.stars); c.gps.clear(); }
    if (s.t === 'escort') {
      const ch = c.actors.character(s.who)!;
      const [x, y] = this.local([ch.lon, ch.lat]);
      r.passenger = c.actors.spawn(s.who, x, y, 'idle');
      this.mark(x, y, '#3cff7a');
      c.reveal(x, y, s.text);
    }
    if (s.t === 'race') { r.checkpoint = 0; r.t = s.time; const [x, y] = this.local(s.pts[0]); this.mark(x, y, '#3ca8ff'); }
    if (s.t === 'collect') {
      for (const id of s.who) {
        const ch = c.actors.character(id)!;
        const [x, y] = this.local([ch.lon, ch.lat]);
        r.targets.push(c.actors.spawn(id, x, y, 'idle'));
      }
      const t = r.targets[0];
      this.mark(t.x, t.y);
    }
  }

  private fail(why: string) {
    this.c.big('MISIÓN FALLIDA', why);
    this.c.jingle(false);
    this.end();
  }

  private pass() {
    const r = this.run!, c = this.c;
    const reward = r.m.reward;
    c.objective(null);
    c.dialog(r.m.outro, () => {
      c.economy.earn(reward);
      c.economy.missions++;
      c.celebrate();
      c.big('¡MISIÓN SUPERADA!', `$${reward}`);
      c.jingle(true);
      if (!this.next) setTimeout(() => c.big('FIN', 'PAU ROVIRA, L\'EGARENC · GRACIAS POR JUGAR'), 4500);
      c.save();
    });
    this.end();
  }

  private end() {
    const r = this.run;
    if (!r) return;
    this.cleanStep();
    for (const ai of r.ais) { ai.panic = 0; this.c.traffic.keep.delete(ai.v); }
    if (r.car) this.c.traffic.keep.delete(r.car);
    this.c.actors.clearMission();
    this.c.objective(null);
    this.c.timer(null);
    this.run = null;
  }

  /** El jugador ha muerto o le han detenido. */
  playerDown(busted: boolean) {
    if (this.run) this.fail(busted ? 'TE HAN DETENIDO' : 'HAS MUERTO');
  }

  update(dt: number) {
    const p = this.c.player();
    this.updateGiver(p);
    const r = this.run;
    if (!r || r.talking) return;
    if (p.dead) return;
    // tiempo de la misión (o de la carrera)
    const s = r.m.steps[r.step];
    if (r.m.time || s.t === 'race') {
      r.t -= dt;
      this.c.timer(Math.max(0, r.t));
      if (r.t <= 0) { this.fail('SE ACABÓ EL TIEMPO'); return; }
    }
    this.msgT -= dt;
    const c = this.c;
    switch (s.t) {
      case 'goto': {
        const [x, y] = this.local(s.at);
        if (r.marker) { r.marker.x = x; r.marker.y = y; }
        const near = Math.hypot(p.x - x, p.y - y) < (s.r ?? 8);
        let ok = near;
        if (s.heli) ok = ok && !!p.heli && p.heli.landed && (!s.roof || c.roofs.roof(p.x, p.y) > c.world.terrain.at(p.x, p.y) + 20);
        if (s.car) ok = ok && !!p.car;
        if (near && !ok && this.msgT <= 0) { c.say(s.heli ? (p.heli ? 'ATERRIZA AQUÍ' : 'NECESITAS UN HELICÓPTERO') : 'NECESITAS UN COCHE'); this.msgT = 4; }
        if (ok) this.nextStep();
        break;
      }
      case 'steal': {
        if (r.car!.wrecked) { this.fail('EL COCHE ESTÁ DESTROZADO'); return; }
        if (r.marker) { r.marker.x = r.car!.x; r.marker.y = r.car!.y; }
        if (p.car === r.car) this.nextStep();
        break;
      }
      case 'deliver': {
        const car = r.car ?? p.car;
        if (car?.wrecked) { this.fail('EL COCHE ESTÁ DESTROZADO'); return; }
        const [x, y] = this.local(s.at);
        if (r.car && p.car !== r.car && this.msgT <= 0) { c.say('VUELVE AL COCHE'); this.msgT = 5; }
        if (Math.hypot(p.x - x, p.y - y) < 8 && p.speed < 3 && (!r.car || p.car === r.car)) this.nextStep();
        break;
      }
      case 'destroy': {
        const alive = r.ais.filter((a) => !a.v.wrecked);
        if (!alive.length) { this.nextStep(); return; }
        if (alive.some((a) => Math.hypot(a.v.x - p.x, a.v.y - p.y) > 550)) { this.fail('SE HA ESCAPADO'); return; }
        const t = alive[0].v;
        if (r.marker) { r.marker.x = t.x; r.marker.y = t.y; }
        c.gps.target = { x: t.x, y: t.y };
        c.objective(`${s.text} (${(s.count ?? 1) - alive.length}/${s.count ?? 1})`);
        break;
      }
      case 'kill': {
        if (r.targets.every((t) => t.mode === 'dead')) { this.nextStep(); return; }
        const t = r.targets.find((o) => o.mode !== 'dead')!;
        if (r.marker) { r.marker.x = t.x; r.marker.y = t.y; }
        // los guardaespaldas atacan al verte
        if (Math.hypot(t.x - p.x, t.y - p.y) < 45 && t.mode === 'idle') t.mode = 'flee';
        break;
      }
      case 'pickup': {
        const [x, y] = this.local(s.at);
        if (Math.hypot(p.x - x, p.y - y) < 3) {
          if (s.stars && c.police.stars < s.stars) c.police.setStars(s.stars);
          this.nextStep();
        }
        break;
      }
      case 'escape':
        if (c.police.stars === 0) this.nextStep();
        break;
      case 'escort': {
        const a = r.passenger!;
        if (a.mode === 'dead') { this.fail(`${a.name} HA MUERTO`); return; }
        if (!r.gotIn) {
          if (r.marker) { r.marker.x = a.x; r.marker.y = a.y; }
          if (p.car && Math.hypot(p.x - a.x, p.y - a.y) < 7 && p.speed < 2) {
            r.gotIn = true;
            a.mode = 'passenger';
            c.say(`${a.name} SUBE AL COCHE`);
            const [x, y] = this.local(s.at);
            this.mark(x, y);
          } else if (!p.car && this.msgT <= 0 && Math.hypot(p.x - a.x, p.y - a.y) < 15) { c.say('NECESITAS UN COCHE'); this.msgT = 5; }
        } else {
          if (!p.car || p.car.wrecked) { this.fail(`HAS PERDIDO A ${a.name}`); return; }
          const [x, y] = this.local(s.at);
          if (Math.hypot(p.x - x, p.y - y) < 10 && p.speed < 3) {
            a.mode = 'idle';
            a.x = p.x + 2.5; a.y = p.y;
            this.nextStep();
          }
        }
        break;
      }
      case 'race': {
        const [x, y] = this.local(s.pts[r.checkpoint]);
        if (Math.hypot(p.x - x, p.y - y) < 14) {
          r.checkpoint++;
          if (r.checkpoint >= s.pts.length) { this.nextStep(); return; }
          c.say(`PUNTO ${r.checkpoint} DE ${s.pts.length}`);
          const [nx, ny] = this.local(s.pts[r.checkpoint]);
          this.mark(nx, ny, '#3ca8ff');
        }
        break;
      }
      case 'collect': {
        for (const t of r.targets) {
          if (r.collected.has(t)) continue;
          const d = Math.hypot(t.x - p.x, t.y - p.y);
          // unos pagan a la primera; otros salen corriendo y hay que pillarlos (o tumbarlos)
          if (t.mode === 'idle' && d < 3 && !t.fled) {
            t.fled = true; // se tira la moneda una sola vez
            if (Math.random() < 0.4) { t.mode = 'flee'; c.say(`${t.name} SALE CORRIENDO`); continue; }
          }
          if (t.mode === 'dead' || (d < (t.mode === 'flee' ? 1.8 : 3) && t.mode !== 'passenger')) {
            r.collected.add(t);
            c.say(`${t.name} PAGA (${r.collected.size}/${r.targets.length})`);
          }
        }
        const left = r.targets.filter((t) => !r.collected.has(t));
        if (!left.length) { this.nextStep(); return; }
        if (r.marker) { r.marker.x = left[0].x; r.marker.y = left[0].y; }
        c.gps.target = { x: left[0].x, y: left[0].y };
        break;
      }
    }
  }
}

export { MISSIONS };
