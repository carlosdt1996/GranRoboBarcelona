import * as THREE from 'three';
import type { WallGrid } from '../collision';
import { clamp } from '../geom';
import type { World } from '../map';
import type { RoadGraph } from '../roads';
import { Billboards } from '../render/billboards';
import type { Fx } from '../render/fx';
import { canvas, pixelTexture, type SpriteAtlas, type SpriteRect } from '../render/textures';
import type { Sound } from '../audio';
import type { SoftTarget } from './combat';
import { sidewalk } from './pickups';
import { CHARACTERS, type Character, type Look } from './story/characters';
import { Vehicle } from './vehicle';

const COLS = 10, CELL_W = 96, CELL_H = 48;
const GOON: Look = { skin: '#c89070', hair: '#1a1a1a', shirt: '#1a1a1a', pants: '#2a2a2a', hat: 'calvo', glasses: true };

function px(x: CanvasRenderingContext2D, a: number, b: number, w: number, h: number, c: string) {
  x.fillStyle = c;
  x.fillRect(a, b, w, h);
}

/** Un personaje (16×32) con su ropa, pelo y sombrero. */
function drawLook(x: CanvasRenderingContext2D, ox: number, oy: number, k: Look, back: boolean, step: number, aim: boolean) {
  const l = step ? 1 : 0;
  px(x, ox + 5, oy + 20, 2, 9 - l, k.pants);
  px(x, ox + 9, oy + 20, 2, 8 + l, k.pants);
  px(x, ox + 5, oy + 29 - l, 2, 2, '#1a1a1a');
  px(x, ox + 9, oy + 28 + l, 2, 2, '#1a1a1a');
  px(x, ox + 4, oy + 10, 8, 10, k.shirt);
  if (aim) {
    px(x, ox + 6, oy + 12, 4, 2, k.shirt);
    px(x, ox + 7, oy + 11, 2, 1, k.skin);
    px(x, ox + 7, oy + 9, 2, 2, '#2a2a30');
  } else {
    px(x, ox + 3, oy + 11 + l, 1, 7, k.shirt);
    px(x, ox + 12, oy + 12 - l, 1, 7, k.shirt);
    px(x, ox + 3, oy + 18 + l, 1, 2, k.skin);
    px(x, ox + 12, oy + 19 - l, 1, 2, k.skin);
  }
  px(x, ox + 5, oy + 3, 6, 7, k.skin);
  if (k.hat !== 'calvo') px(x, ox + 5, oy + 2, 6, 2, k.hair);
  if (k.hat === 'pelo-largo') { px(x, ox + 4, oy + 2, 1, 9, k.hair); px(x, ox + 11, oy + 2, 1, 9, k.hair); }
  if (back) px(x, ox + 5, oy + 3, 6, k.hat === 'pelo-largo' ? 8 : 5, k.hat === 'calvo' ? k.skin : k.hair);
  else {
    px(x, ox + 6, oy + 6, 1, 1, '#1a1a2a');
    px(x, ox + 9, oy + 6, 1, 1, '#1a1a2a');
    if (k.glasses) px(x, ox + 5, oy + 5, 6, 2, '#101018');
    if (k.beard) px(x, ox + 5, oy + 8, 6, 2, k.hair);
  }
  const hat: Record<string, () => void> = {
    gorra: () => { px(x, ox + 4, oy + 1, 8, 3, '#2a3a8a'); if (!back) px(x, ox + 4, oy + 3, 9, 1, '#1a2a6a'); },
    boina: () => px(x, ox + 4, oy + 1, 8, 2, '#2a2a2a'),
    barretina: () => { px(x, ox + 4, oy + 1, 8, 2, '#c81828'); px(x, ox + 10, oy, 3, 3, '#c81828'); },
    casco: () => px(x, ox + 4, oy, 8, 4, '#f4d020'),
    panuelo: () => px(x, ox + 4, oy + 1, 8, 3, '#c8c8d8'),
    sombrero: () => { px(x, ox + 3, oy + 2, 10, 1, '#2a2a2a'); px(x, ox + 5, oy, 6, 2, '#2a2a2a'); },
  };
  if (k.hat && hat[k.hat]) hat[k.hat]();
}

function drawDown(x: CanvasRenderingContext2D, ox: number, oy: number, k: Look) {
  px(x, ox + 2, oy + 9, 7, 5, k.skin);
  px(x, ox + 2, oy + 9, 2, 5, k.hat === 'calvo' ? k.skin : k.hair);
  px(x, ox + 9, oy + 8, 11, 7, k.shirt);
  px(x, ox + 20, oy + 9, 10, 2, k.pants);
  px(x, ox + 20, oy + 12, 9, 2, k.pants);
}

/** Atlas con todos los personajes (y el matón genérico). */
function buildAtlas(): SpriteAtlas & { slot: Map<string, number> } {
  const [c, x] = canvas(1024, 512);
  const rects: Record<string, SpriteRect> = {};
  const slot = new Map<string, number>();
  const looks: [string, Look][] = [...CHARACTERS.map((ch) => [ch.id, ch.look] as [string, Look]), ['goon', GOON]];
  looks.forEach(([id, look], i) => {
    const ox = (i % COLS) * CELL_W, oy = Math.floor(i / COLS) * CELL_H;
    slot.set(id, i);
    const frames: [string, boolean, number, boolean][] = [['front0', false, 0, false], ['front1', false, 1, false], ['back0', true, 0, false], ['back1', true, 1, false], ['backAim', true, 0, true], ['frontAim', false, 0, true]];
    frames.forEach(([n, back, st, aim], f) => {
      drawLook(x, ox + f * 16, oy, look, back, st, aim);
      rects[`${id}_${n}`] = { u: (ox + f * 16) / 1024, v: 1 - (oy + 32) / 512, w: 16 / 1024, h: 32 / 512 };
    });
    drawDown(x, ox, oy + 32, look);
    rects[`${id}_down`] = { u: ox / 1024, v: 1 - (oy + 48) / 512, w: 32 / 1024, h: 16 / 512 };
  });
  const t = pixelTexture(c, false);
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return { texture: t, rects, slot };
}

export type ActorMode = 'idle' | 'hostile' | 'flee' | 'passenger' | 'dead';

export class Actor implements SoftTarget {
  vx = 0;
  vy = 0;
  health = 40;
  shootT = 1.2 + Math.random();
  phase = Math.random();
  aimT = 0;
  deadT = 0;
  talkT = 0;
  readonly r = 0.45;
  /** Lo crea una misión (no desaparece por distancia hasta que acaba). */
  mission = false;
  /** Ya intentó escapar (cobros). */
  fled = false;
  onDown?: (a: Actor) => void;

  constructor(public id: string, public ch: Character | null, public x: number, public y: number, public a: number, public mode: ActorMode) {}

  get alive() { return this.mode !== 'dead' && this.mode !== 'passenger'; }
  get name() { return this.ch ? this.ch.alias : 'MATÓN'; }

  hurt(dmg: number, dx: number, dy: number) {
    if (this.mode === 'dead' || this.mode === 'passenger') return;
    this.health -= dmg;
    if (this.health <= 0) {
      this.mode = 'dead';
      this.vx = dx * 3;
      this.vy = dy * 3;
      this.onDown?.(this);
    } else if (this.mode === 'idle') this.mode = 'flee';
  }
}

/**
 * Los personajes de la historia por la ciudad: cada uno en su barrio (aparece al acercarte),
 * con su frase, y los que crean las misiones (objetivos, acompañantes y matones armados).
 */
export class Actors {
  list: Actor[] = [];
  readonly sprites: Billboards;
  private atlas: ReturnType<typeof buildAtlas>;
  private homes: { ch: Character; x: number; y: number; a: number }[] = [];
  private push: [number, number] = [0, 0];
  /** Te dice algo al pasar: (alias, frase). */
  onTalk?: (who: string, line: string) => void;
  onKilled?: (a: Actor) => void;
  onHitPlayer?: (dmg: number) => void;

  constructor(world: World, graph: RoadGraph, private walls: WallGrid, private fx: Fx, private sound: Sound) {
    this.atlas = buildAtlas();
    this.sprites = new Billboards(this.atlas, 64, true);
    for (const ch of CHARACTERS) {
      if (ch.role === 'protagonista') continue;
      const [x, y, a] = sidewalk(world, graph, ch.lon, ch.lat, 1.8);
      this.homes.push({ ch, x, y, a });
    }
  }

  get(id: string) {
    return this.list.find((a) => a.id === id) ?? null;
  }

  character(id: string) {
    return CHARACTERS.find((c) => c.id === id) ?? null;
  }

  /** Crea (o reutiliza) un actor de misión en (x, y). */
  spawn(id: string, x: number, y: number, mode: ActorMode): Actor {
    let a = this.list.find((o) => o.id === id && o.ch);
    if (a && id !== 'goon') { a.x = x; a.y = y; a.mode = mode; a.health = 40; a.mission = true; return a; }
    a = new Actor(id, id === 'goon' ? null : this.character(id), x, y, Math.random() * 6.28, mode);
    a.mission = true;
    a.onDown = (o) => this.onKilled?.(o);
    this.list.push(a);
    return a;
  }

  /** Quita los actores de misión (al acabar o fallar). */
  clearMission() {
    this.list = this.list.filter((a) => !a.mission || a.mode === 'dead');
    for (const a of this.list) a.mission = false;
  }

  *targets(): Iterable<SoftTarget> {
    for (const a of this.list) if (a.alive) yield a;
  }

  update(dt: number, px: number, py: number, pz: number, camA: number, playerAlive: boolean, onFoot: boolean) {
    // gente de la calle: aparece cerca de su casa cuando te acercas
    for (const h of this.homes) {
      const d = Math.hypot(h.x - px, h.y - py);
      const here = this.list.find((a) => a.ch === h.ch);
      if (d < 180 && !here) {
        const a = new Actor(h.ch.id, h.ch, h.x, h.y, h.a + Math.PI / 2, 'idle');
        a.onDown = (o) => this.onKilled?.(o);
        this.list.push(a);
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      const dx = px - a.x, dy = py - a.y, d = Math.hypot(dx, dy);
      if (!a.mission && (d > 230 || (a.mode === 'dead' && a.deadT > 25))) { this.list.splice(i, 1); continue; }
      if (a.mode === 'dead') {
        a.deadT += dt;
        a.x += a.vx * dt; a.y += a.vy * dt; a.vx *= Math.exp(-4 * dt); a.vy *= Math.exp(-4 * dt);
        continue;
      }
      if (a.mode === 'passenger') continue;
      let want = 0, ux = dx / (d || 1), uy = dy / (d || 1);
      if (a.mode === 'idle') {
        // mira al jugador y le suelta su frase
        if (d < 12) a.a = Math.atan2(dx, dy);
        a.talkT -= dt;
        if (d < 4.5 && a.talkT <= 0 && a.ch && onFoot) { a.talkT = 45; this.onTalk?.(a.ch.alias, a.ch.line); }
      } else if (a.mode === 'flee') {
        want = -4.2;
        if (d > 60) a.mode = 'idle';
      } else if (a.mode === 'hostile' && playerAlive) {
        const los = this.walls.raycast(a.x, a.y, px, py) > 0.98;
        want = d > 14 || !los ? 4 : d < 5 ? -1.5 : 0;
        a.a = Math.atan2(dx, dy);
        a.aimT = Math.max(0, a.aimT - dt);
        if (los && d < 35) {
          a.shootT -= dt;
          if (a.shootT <= 0) {
            a.shootT = 0.8 + Math.random() * 0.7;
            a.aimT = 0.4;
            const z = Vehicle.ground(a.x, a.y) + 1.3, hit = Math.random() < clamp(0.45 - d * 0.008, 0.12, 0.45);
            this.fx.flash(a.x + ux * 0.5, a.y + uy * 0.5, z);
            this.fx.tracer(a.x, a.y, z, px + (hit ? 0 : (Math.random() - 0.5) * 4), py + (hit ? 0 : (Math.random() - 0.5) * 4), pz + 1.1);
            this.sound.gunshot('pistol');
            if (hit) this.onHitPlayer?.(6);
          }
        }
      }
      if (want) {
        a.vx += (ux * want - a.vx) * Math.min(1, dt * 8);
        a.vy += (uy * want - a.vy) * Math.min(1, dt * 8);
        a.a = Math.atan2(want > 0 ? dx : -dx, want > 0 ? dy : -dy);
      } else { a.vx *= Math.exp(-8 * dt); a.vy *= Math.exp(-8 * dt); }
      a.x += a.vx * dt; a.y += a.vy * dt;
      if (this.walls.pushCircle(a.x, a.y, 0.3, this.push)) { a.x += this.push[0]; a.y += this.push[1]; }
      a.phase += dt * Math.hypot(a.vx, a.vy) * 1.6;
    }

    // sprites
    const R = this.atlas.rects;
    let n = 0;
    for (const a of this.list) {
      if (n >= this.sprites.capacity || a.mode === 'passenger') continue;
      if (Math.abs(a.x - px) > 200 || Math.abs(a.y - py) > 200) continue;
      const z = Vehicle.ground(a.x, a.y);
      if (a.mode === 'dead') { this.sprites.set(n++, a.x, a.y, z + 0.02, 1.8, 0.9, R[`${a.id}_down`]); continue; }
      const away = Math.sin(a.a) * Math.sin(camA) + Math.cos(a.a) * Math.cos(camA) > 0;
      const moving = Math.hypot(a.vx, a.vy) > 0.3;
      const f = a.aimT > 0 ? (away ? 'backAim' : 'frontAim') : `${away ? 'back' : 'front'}${moving ? Math.floor(a.phase) % 2 : 0}`;
      this.sprites.set(n++, a.x, a.y, z, 0.85, 1.75, R[`${a.id}_${f}`]);
    }
    this.sprites.commit(n);
  }

  /** Sprite de un personaje para el retrato del diálogo. */
  portrait(id: string): HTMLCanvasElement {
    const look = id === 'goon' ? GOON : this.character(id)?.look ?? GOON;
    const [c, x] = canvas(16, 32);
    drawLook(x, 0, 0, look, false, 0, false);
    return c;
  }
}
