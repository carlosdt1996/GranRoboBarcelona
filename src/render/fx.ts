import * as THREE from 'three';
import { Billboards } from './billboards';
import { passAlpha } from '../daylight';
import type { SpriteAtlas, SpriteRect } from './textures';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  t: number; life: number;
  size: number; grow: number;
  frames: string[];
  gravity: number;
}

const MAX = 400, MAX_TRACERS = 24;

/** Efectos: fogonazos, trazadoras, chispas, sangre, humo, fuego y explosiones (sprites del atlas). */
export class Fx {
  private sprites: Billboards;
  private parts: Particle[] = [];
  private tracerGeo: THREE.BufferGeometry;
  private tracerPos: Float32Array;
  private tracers: { a: number[]; b: number[]; t: number }[] = [];
  /** Sprites que solo se ven en el fotograma actual (proyectiles). */
  private once: { x: number; y: number; z: number; name: string; size: number }[] = [];
  readonly group = new THREE.Group();

  constructor(private atlas: SpriteAtlas) {
    this.sprites = new Billboards(atlas, MAX, true, true);
    this.group.add(this.sprites.mesh);
    this.tracerPos = new Float32Array(MAX_TRACERS * 6);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(this.tracerGeo, passAlpha(new THREE.LineBasicMaterial({ color: '#fff6a0', fog: false }), 0));
    lines.frustumCulled = false;
    this.group.add(lines);
  }

  private add(p: Partial<Particle> & { x: number; y: number; z: number; frames: string[]; life: number; size: number }) {
    if (this.parts.length >= MAX) this.parts.shift();
    this.parts.push({ vx: 0, vy: 0, vz: 0, t: 0, grow: 0, gravity: 0, ...p });
  }

  /** Dibuja un sprite solo en este fotograma (centrado en x, y, z). */
  sprite(x: number, y: number, z: number, name: string, size: number) {
    this.once.push({ x, y, z, name, size });
  }

  flash(x: number, y: number, z: number) {
    this.add({ x, y, z, frames: ['fx_flash'], life: 0.06, size: 0.7 });
  }

  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    this.tracers.push({ a: [ax, az, -ay], b: [bx, bz, -by], t: 0.05 });
  }

  sparks(x: number, y: number, z: number, n = 5) {
    for (let i = 0; i < n; i++)
      this.add({ x, y, z, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, vz: Math.random() * 4, gravity: 12, frames: ['fx_spark'], life: 0.25 + Math.random() * 0.2, size: 0.25 });
  }

  blood(x: number, y: number, z: number) {
    for (let i = 0; i < 6; i++)
      this.add({ x, y, z, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: Math.random() * 2.5, gravity: 10, frames: ['fx_blood'], life: 0.4 + Math.random() * 0.3, size: 0.3 });
  }

  smoke(x: number, y: number, z: number, big = false) {
    this.add({ x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.6, z, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, vz: 1.4 + Math.random(), frames: ['fx_smoke'], life: 1.6 + Math.random(), size: big ? 1.6 : 0.9, grow: big ? 1.6 : 1.1 });
  }

  fire(x: number, y: number, z: number) {
    this.add({ x: x + (Math.random() - 0.5) * 1.2, y: y + (Math.random() - 0.5) * 1.2, z, vz: 1.2, frames: ['fx_fire0', 'fx_fire1'], life: 0.45 + Math.random() * 0.25, size: 1.1, grow: -0.6 });
  }

  explosion(x: number, y: number, z: number) {
    this.add({ x, y, z, frames: ['fx_boom0', 'fx_boom1', 'fx_boom2', 'fx_boom3'], life: 0.7, size: 5, grow: 4 });
    for (let i = 0; i < 6; i++)
      this.add({ x: x + (Math.random() - 0.5) * 3, y: y + (Math.random() - 0.5) * 3, z: z + Math.random() * 2, frames: ['fx_boom1', 'fx_boom2', 'fx_boom3'], life: 0.5 + Math.random() * 0.4, size: 2.5, grow: 2.5 });
    for (let i = 0; i < 8; i++) this.smoke(x, y, z + 1, true);
    this.sparks(x, y, z + 1, 14);
  }

  update(dt: number) {
    let n = 0;
    const R = this.atlas.rects;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      p.vz -= p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.t / p.life;
      const size = Math.max(0.05, p.size + p.grow * p.t);
      const r: SpriteRect = R[p.frames[Math.min(p.frames.length - 1, Math.floor(k * p.frames.length))]];
      // los sprites se anclan por abajo: centrados en (x, y, z)
      this.sprites.set(n++, p.x, p.y, p.z - size / 2, size, size, r, (i & 1) === 1);
    }
    for (const o of this.once) if (n < MAX) this.sprites.set(n++, o.x, o.y, o.z - o.size / 4, o.size, o.size / 2, R[o.name]);
    this.once.length = 0;
    this.sprites.commit(n);

    let m = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) { this.tracers.splice(i, 1); continue; }
      this.tracerPos.set(t.a, m * 6);
      this.tracerPos.set(t.b, m * 6 + 3);
      m++;
    }
    this.tracerGeo.setDrawRange(0, m * 2);
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
