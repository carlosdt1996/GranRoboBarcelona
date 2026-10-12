export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Diferencia angular normalizada a (-PI, PI]. */
export function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Generador pseudoaleatorio con semilla (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rumbo (0 = norte, sentido horario) → vector (x este, y norte). */
export function fwd(a: number): [number, number] {
  return [Math.sin(a), Math.cos(a)];
}

export function pointInRing(x: number, y: number, r: Float32Array) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
