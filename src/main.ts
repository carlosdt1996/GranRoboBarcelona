import * as THREE from 'three';
import './style.css';
import { loadMap, toLocal, hash, type GameMap } from './map';
import { RoadGraph, StreetIndex } from './roads';
import { WallGrid } from './collision';
import { C, SUN_DIR, SUN_ELEVATION } from './palette';
import { makeFacades, makeSprites } from './render/textures';
import { createSky } from './render/sky';
import { Ground } from './render/ground';
import { Buildings } from './render/buildings';
import { Billboards } from './render/billboards';
import { Pixelator } from './render/post';
import { Vehicle } from './game/vehicle';
import { Traffic } from './game/traffic';
import { Peds } from './game/peds';
import { ChaseCam } from './game/camera';
import { Input } from './input';
import { Sound } from './audio';
import { Hud } from './ui/hud';

THREE.ColorManagement.enabled = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mobile = matchMedia('(pointer: coarse)').matches;
if (mobile) document.body.classList.add('coarse');

// Inicio: Passeig de Gràcia a la altura de la Casa Batlló, rumbo a la montaña
const START = { lon: 2.16725, lat: 41.38975, street: 'Passeig de Gràcia' };

async function main() {
  const bar = $('loadbar').firstElementChild as HTMLElement;
  const progress = (f: number) => (bar.style.width = `${Math.round(f * 100)}%`);
  const map: GameMap = await loadMap(`${import.meta.env.BASE_URL}data/eixample.json`, (f) => progress(f * 0.6));
  await tick();

  const canvas = $<HTMLCanvasElement>('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.skyTop);
  scene.fog = new THREE.Fog(C.fog, 150, 560);
  const sunPos = new THREE.Vector3(SUN_DIR[0], Math.tan(SUN_ELEVATION), -SUN_DIR[1]).normalize();
  const sun = new THREE.DirectionalLight('#ffc89a', 2.2);
  sun.position.copy(sunPos);
  scene.add(sun, new THREE.HemisphereLight('#ff9ab8', '#4a2a7a', 1.3));

  const sky = createSky();
  scene.add(sky);

  const graph = new RoadGraph(map);
  const walls = new WallGrid(map);
  const streets = new StreetIndex(map);
  progress(0.7);
  await tick();

  const ground = new Ground(map, graph);
  scene.add(ground.group);
  const buildings = new Buildings(map, makeFacades());
  scene.add(buildings.group);
  const atlas = makeSprites();

  // árboles: plátanos de sombra (y alguna palmera, que esto es OutRun)
  const nTrees = map.trees.length / 2;
  const trees = new Billboards(atlas, nTrees);
  for (let i = 0; i < nTrees; i++) {
    const h = hash(i * 31 + 7);
    const palm = h < 0.07;
    const s = 0.8 + hash(i * 17 + 3) * 0.45;
    trees.set(i, map.trees[i * 2], map.trees[i * 2 + 1], 0, (palm ? 6 : 8) * s, (palm ? 11 : 10.5) * s, atlas.rects[palm ? 'palm' : 'platan'], hash(i) < 0.5);
  }
  trees.commit(nTrees);
  scene.add(trees.mesh);
  const pedSprites = new Billboards(atlas, 80, true);
  scene.add(pedSprites.mesh);

  // jugador
  const player = new Vehicle('player', '#e01828');
  scene.add(player.mesh);
  const [sx, sy] = toLocal(map, START.lon, START.lat);
  const startEdge = graph.nearestEdge(sx, sy, (e) => map.names[e.road.name] === START.street && Math.cos(graph.pose(e, 0, 0, { x: 0, y: 0, a: 0 }).a + Math.PI / 4) > 0.3)
    ?? graph.nearestEdge(sx, sy)!;
  const respawn = (edge = startEdge.edge, s = startEdge.s) => {
    const p = graph.pose(edge, s, graph.laneOffset(edge, edge.lanes - 1), { x: 0, y: 0, a: 0 });
    player.x = p.x; player.y = p.y; player.a = p.a;
    player.vx = player.vy = 0;
    player.syncMesh();
  };
  respawn();

  const cam = new ChaseCam(1);
  cam.snap(player);
  const traffic = new Traffic(graph, scene, mobile ? 28 : 42);
  const peds = new Peds(graph, pedSprites, atlas.rects, mobile ? 40 : 60);
  const input = new Input();
  const sound = new Sound();
  const hud = new Hud(map);
  traffic.onHonk = (x, y) => sound.horn(Math.hypot(x - player.x, y - player.y));
  peds.onHit = (_x, _y, sp) => { sound.thud(); cam.bump(0.15 + sp * 0.005); };

  // precarga alrededor del punto de salida
  const total = buildings.update(player.x, player.y, 0);
  for (let done = 0; done < total; done += 40) {
    buildings.update(player.x, player.y, 40);
    progress(0.72 + 0.18 * Math.min(1, done / total));
    await tick();
  }
  ground.update(player.x, player.y, player.a, 60);
  progress(1);

  const pixel = new Pixelator(320, 240);
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    const ih = Math.round(Math.min(270, Math.max(200, h / 3)));
    const iw = Math.round((ih * w) / h);
    renderer.setSize(iw, ih, false);
    pixel.setSize(iw, ih);
    cam.camera.aspect = w / h;
    cam.camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  // pantalla de título
  $('loadbar').hidden = true;
  $('start').hidden = false;
  if (mobile) $('help').innerHTML = 'VOLANTE A LA IZQUIERDA · GAS, FRENO Y DRIFT A LA DERECHA';
  await new Promise<void>((res) => {
    const go = () => { removeEventListener('pointerdown', go); removeEventListener('keydown', go); res(); };
    addEventListener('pointerdown', go);
    addEventListener('keydown', go);
  });
  sound.start();
  $('title').classList.add('hidden');
  $('hud').hidden = false;
  if (mobile) document.documentElement.requestFullscreen?.().catch(() => {});
  const musicBtn = $('musicbtn');
  const toggleMusic = () => (musicBtn.textContent = sound.toggleMusic() ? '♪ ON' : '♪ OFF');
  musicBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); toggleMusic(); });

  const circ: number[] = [], ocirc: number[] = [];
  let last = performance.now(), acc = 0;
  const DT = 1 / 120;
  const camRight = new THREE.Vector3();

  const stats = { logic: 0, render: 0, n: 0 };
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (input.pressed('KeyM')) toggleMusic();
    if (input.pressed('KeyR')) {
      const ne = graph.nearestEdge(player.x, player.y);
      if (ne) respawn(ne.edge, ne.s);
    }
    const ctl = input.controls();
    acc += dt;
    while (acc >= DT) {
      player.step(ctl, DT, walls);
      if (player.lastImpact > 4) { sound.crash(player.lastImpact); cam.bump(Math.min(0.8, player.lastImpact * 0.05)); }
      acc -= DT;
    }

    // choques con el tráfico
    player.circles(circ);
    for (const c of traffic.cars) {
      const o = c.v;
      if (Math.abs(o.x - player.x) > 10 || Math.abs(o.y - player.y) > 10) continue;
      o.circles(ocirc);
      for (let i = 0; i < circ.length; i += 3)
        for (let j = 0; j < ocirc.length; j += 3) {
          const dx = circ[i] - ocirc[j], dy = circ[i + 1] - ocirc[j + 1];
          const d = Math.hypot(dx, dy), min = circ[i + 2] + ocirc[j + 2];
          if (d >= min || d < 1e-4) continue;
          const nx = dx / d, ny = dy / d, push = min - d;
          player.x += nx * push;
          player.y += ny * push;
          const rvx = player.vx - o.vx, rvy = player.vy - o.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const k = o.kind === 'bus' ? 1.6 : 1.2;
            player.vx -= k * vn * nx;
            player.vy -= k * vn * ny;
            if (-vn > 3) { sound.crash(-vn); cam.bump(Math.min(0.6, -vn * 0.04)); c.stun = 2 + Math.random() * 2; }
          }
          player.circles(circ);
        }
    }
    player.syncMesh();

    traffic.update(dt, player, player.x, player.y, cam.heading);
    cam.update(dt, player, walls);
    const ccam = cam.camera;
    camRight.setFromMatrixColumn(ccam.matrixWorld, 0);
    camRight.y = 0;
    Billboards.camRight.value.copy(camRight.normalize());
    peds.update(dt, player.x, player.y, cam.heading, [player, ...traffic.cars.map((c) => c.v)]);
    sky.position.set(ccam.position.x, ccam.position.y, ccam.position.z);

    ground.update(player.x, player.y, cam.heading, 2);
    buildings.update(player.x, player.y, 2);

    const vf = player.forwardSpeed;
    const sp = Math.abs(vf);
    sound.setEngine(sp, ctl.throttle, player.skid * Math.min(1, player.speed / 10));
    const gears = [0, 12, 22, 33, 45, 70];
    let g = 1;
    while (g < 5 && sp > gears[g]) g++;
    const rpm = 0.2 + 0.8 * Math.min(1, (sp - gears[g - 1]) / (gears[g] - gears[g - 1]));
    hud.update(dt, sp * 3.6, rpm, player.x, player.y, player.a, streets.nearest(player.x, player.y, player.a), traffic.cars.map((c) => c.v));

    const t1 = performance.now();
    renderer.info.reset();
    pixel.render(renderer, scene, ccam);
    stats.logic += t1 - t0;
    stats.render += performance.now() - t1;
    stats.n++;
  };
  requestAnimationFrame(frame);
  (window as unknown as Record<string, unknown>).__game = {
    player, traffic, peds, map, cam, scene, renderer, stats, graph, buildings, ground, respawn,
    /** Depuración: colocar el coche en una calle cercana a lon/lat con un rumbo dado. */
    teleport(lon: number, lat: number, deg: number) {
      const [x, y] = toLocal(map, lon, lat);
      const a = (deg * Math.PI) / 180;
      const ne = graph.nearestEdge(x, y, (e) => Math.cos(graph.pose(e, e.len / 2, 0, { x: 0, y: 0, a: 0 }).a - a) > 0.8);
      if (ne) respawn(ne.edge, ne.s);
      cam.snap(player);
      buildings.update(player.x, player.y, 1000);
      ground.update(player.x, player.y, player.a, 100);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

main().catch((e) => {
  console.error(e);
  $('help').textContent = `Error: ${e.message}`;
});
