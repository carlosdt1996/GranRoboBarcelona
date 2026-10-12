import * as THREE from 'three';
import './style.css';
import { World } from './map';
import { RoadGraph, StreetIndex, type REdge } from './roads';
import { WallGrid } from './collision';
import { C, SUN_DIR, SUN_ELEVATION } from './palette';
import { makeFacades, makeSprites } from './render/textures';
import { carGeometry, BODY_COLORS } from './render/cars';
import { Sky } from './render/sky';
import { paletteFor, sunPosition } from './daylight';
import { Ground } from './render/ground';
import { Buildings } from './render/buildings';
import { Billboards } from './render/billboards';
import { Trees } from './render/trees';
import { Fx } from './render/fx';
import { Pixelator } from './render/post';
import { Vehicle, type Controls } from './game/vehicle';
import { Walker } from './game/walker';
import { Traffic } from './game/traffic';
import { Peds } from './game/peds';
import { Combat, WEAPONS, type WeaponId } from './game/combat';
import { ChaseCam } from './game/camera';
import { Input } from './input';
import { Sound } from './audio';
import { Hud } from './ui/hud';
import { CityMap } from './ui/citymap';
import { RoofMap } from './heights';
import { Heli } from './game/heli';
import { Helis } from './game/helis';
import { view } from './view';
import { Gps, guidance } from './game/gps';
import { WeaponWheel, weaponIcon } from './ui/wheel';
import { Police } from './game/police';
import { RealTraffic, bcnTime } from './game/realtraffic';
import { Economy } from './game/economy';
import { Pickups, Markers, type Pickup } from './game/pickups';
import { GUN_SHOPS, HOSPITALS, PAINT_SHOPS, POLICE_STATIONS } from './game/places';
import { ShopMenu } from './ui/shop';
import { Cutscene } from './game/cutscene';
import { PauseMenu, loadOptions } from './ui/menu';
import { Aim, type AimTarget } from './game/aim';
import { Actors } from './game/actors';
import { FLOOR, Interiors, type Room } from './game/interiors';
import { Story } from './game/story/engine';
import { CHARACTERS } from './game/story/characters';
import { Director, type Cast } from './game/director';
import type { Line } from './game/story/missions';

THREE.ColorManagement.enabled = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mobile = matchMedia('(pointer: coarse)').matches;
if (mobile) document.body.classList.add('coarse');

// Inicio de la demo de Barcelona: Passeig de Gràcia a la altura de la Casa Batlló
const START = { lon: 2.16725, lat: 41.38975, street: 'Passeig de Gràcia' };
// Piso franco de Pau Rovira: Rambleta del Pare Alegre, Terrassa
const SAFEHOUSE = { lon: 2.0068, lat: 41.5628 };
const IDLE: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
/** Jefes de la historia y su local. */
const BOSSES: [string, Room['kind']][] = [['tete', 'piso'], ['remei', 'bar'], ['biel', 'nave'], ['enric', 'mansion'], ['mascarell', 'taller'], ['montse', 'bar']];
/** Trucos de Vice City. */
const CHEATS = ['THUGSTOOLS', 'PROFESSIONALTOOLS', 'NUTTERTOOLS', 'ASPIRINE', 'PRECIOUSPROTECTION', 'LEAVEMEALONE', 'YOUWONTTAKEMEALIVE', 'BIGBANG', 'PANZER', 'GETTHEREFAST', 'ICANTTAKEITANYMORE', 'PELAS'];

async function main() {
  const bar = $('loadbar').firstElementChild as HTMLElement;
  const progress = (f: number) => (bar.style.width = `${Math.round(f * 100)}%`);
  const base = `${import.meta.env.BASE_URL}data/bcn/`;
  const map = await World.load(base, (f) => progress(f * 0.25));
  Vehicle.ground = (x, y) => map.terrain.at(x, y);
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

  const sky = new Sky();
  scene.add(sky.mesh);
  // hora real de Barcelona: decide día o noche antes de pintar nada
  let sunNow = sunPosition(new Date());
  let pal = paletteFor(sunNow.el);

  const graph = new RoadGraph(map);
  const walls = new WallGrid(map);
  const roofs = new RoofMap(map);
  const streets = new StreetIndex(map);
  progress(0.3);
  await tick();

  const ground = new Ground(map, graph);
  ground.night = pal.night;
  scene.add(ground.group);
  const facades = makeFacades();
  facades.setNight(pal.night > 0.5);
  const buildings = new Buildings(map, facades);
  scene.add(buildings.group);
  const atlas = makeSprites();
  const trees = new Trees(map, atlas, graph);
  scene.add(trees.group);
  const pedSprites = new Billboards(atlas, 90, true);
  scene.add(pedSprites.mesh);
  const heroSprite = new Billboards(atlas, 1, true);
  scene.add(heroSprite.mesh);
  const fx = new Fx(atlas);
  scene.add(fx.group);
  const gps = new Gps(graph, map.terrain);
  scene.add(gps.group);
  const economy = new Economy();
  const saved = economy.load();
  const options = loadOptions();

  // el jugador: pilota `heli`, conduce `car` o va a pie (los dos a null)
  let car: Vehicle | null = null;
  let heli: Heli | null = null;
  const helis = new Helis(map, roofs, scene);
  const walker = new Walker();
  const focus = () => heli ?? car ?? walker;

  /** Pone un coche en el carril derecho de una calle. */
  const placeCar = (v: Vehicle, edge: REdge, s: number) => {
    const p = graph.pose(edge, s, graph.laneOffset(edge, edge.lanes - 1), { x: 0, y: 0, a: 0 });
    v.x = p.x; v.y = p.y; v.a = p.a;
    v.vx = v.vy = 0;
    v.syncMesh();
  };

  const cam = new ChaseCam(1);
  const trafficBase = mobile ? 28 : 42;
  const traffic = new Traffic(graph, scene, trafficBase);
  // tráfico real de Barcelona (en directo o el habitual a esta hora); se actualiza al arrancar y cada 5 min
  const real = await RealTraffic.load(base, graph);
  const applyReal = () => {
    if (!real) return;
    traffic.congestion = real.congestion;
    traffic.max = Math.round(trafficBase * real.density);
  };
  applyReal();
  if (real) setInterval(() => void real.refresh().then(applyReal), 5 * 60 * 1000);
  const peds = new Peds(graph, pedSprites, atlas.rects, mobile ? 40 : 60, walls);
  const input = new Input();
  const sound = new Sound();
  const hud = new Hud(map);
  const combat = new Combat(traffic, peds, fx, sound, walls, roofs);
  const copSprites = new Billboards(atlas, 40, true);
  scene.add(copSprites.mesh);
  const police = new Police(graph, scene, walls, roofs, fx, sound, copSprites, atlas.rects);
  police.traffic = traffic;
  const actors = new Actors(map, graph, walls, fx, sound);
  scene.add(actors.sprites.mesh);
  combat.extraTargets = () => police.vehicles();
  combat.softTargets = () => [...police.targets(), ...actors.targets()];
  police.onWreck = (v) => traffic.park(v);
  police.onHeliDown = (h) => { combat.blast(h.x, h.y, h.z); scene.remove(h.mesh, h.m.shadow); police.crime('cop'); economy.career.cops++; };
  traffic.onHonk = (x, y) => { const f = focus(); sound.horn(Math.hypot(x - f.x, y - f.y)); };

  // ------------------------------------------------------- dinero, objetos, tiendas e interiores
  const pickups = new Pickups(map, graph, atlas, economy.packages);
  scene.add(pickups.sprites.mesh);
  const markers = new Markers();
  scene.add(markers.group);
  PAINT_SHOPS.forEach(([name, lon, lat], i) => {
    const [x, y] = map.toLocal(lon, lat);
    const ne = graph.nearestEdge(x, y);
    if (!ne) return;
    const p = graph.pose(ne.edge, ne.s, 0, { x: 0, y: 0, a: 0 });
    markers.add(p.x, p.y, p.a, 'paint', name, i, '#ff8a20');
  });
  const interiors = new Interiors(map, graph, walls);
  scene.add(interiors.group);
  for (const [id, kind] of BOSSES) {
    const ch = CHARACTERS.find((c) => c.id === id)!;
    interiors.add(`jefe:${id}`, kind, id === 'tete' ? 'PISO FRANCO · RAMBLETA DEL PARE ALEGRE' : ch.barrio.toUpperCase(), ch.lon, ch.lat);
  }
  GUN_SHOPS.forEach(([n, lon, lat], i) => interiors.add(`armeria:${i}`, 'armeria', n, lon, lat));
  HOSPITALS.forEach(([n, lon, lat], i) => interiors.add(`hospital:${i}`, 'hospital', n, lon, lat));
  POLICE_STATIONS.forEach(([n, lon, lat], i) => interiors.add(`comisaria:${i}`, 'comisaria', n, lon, lat));
  const safehouse = interiors.rooms.find((r) => r.id === 'jefe:tete')!;
  // puertas: un pequeño marcador de luz en la acera
  for (const r of interiors.rooms) markers.add(r.door[0], r.door[1], r.door[2], 'mission', r.name, -1, r.id.startsWith('armeria') ? '#3cff7a' : r.id === safehouse.id ? '#5ac8f4' : '#ffe24a').mesh.scale.set(0.45, 0.6, 0.45);

  // ------------------------------------------------------- punto de partida
  const inWorld = (lon: number, lat: number) => {
    const [x, y] = map.toLocal(lon, lat), b = map.bounds;
    return x > b.minX && x < b.maxX && y > b.minY && y < b.maxY;
  };
  const terrassa = inWorld(SAFEHOUSE.lon, SAFEHOUSE.lat);
  // el coche de Pau: aparcado delante del piso franco (o, en la demo sin Terrassa, en Passeig de Gràcia)
  const own = new Vehicle('player', '#e01828');
  scene.add(own.mesh);
  let startX: number, startY: number;
  if (terrassa) {
    [startX, startY] = [safehouse.door[0], safehouse.door[1]];
    const ne = graph.nearestEdge(startX, startY);
    if (ne) placeCar(own, ne.edge, ne.s);
    traffic.park(own);
    own.setDriver(false);
  } else {
    const [sx, sy] = map.toLocal(START.lon, START.lat);
    const ne = graph.nearestEdge(sx, sy, (e) => map.names[e.road.name] === START.street && Math.cos(graph.pose(e, 0, 0, { x: 0, y: 0, a: 0 }).a + Math.PI / 4) > 0.3) ?? graph.nearestEdge(sx, sy)!;
    placeCar(own, ne.edge, ne.s);
    car = own;
    [startX, startY] = [own.x, own.y];
  }
  combat.playerCar = car;
  combat.walker = car ? null : walker;
  cam.snap(focus());

  // precarga alrededor del punto de salida: teselas, edificios y suelo
  await map.preload(startX, startY, 900, (f) => progress(0.3 + 0.4 * f));
  map.update(startX, startY);
  own.syncMesh();
  const total = buildings.update(startX, startY, 0);
  for (let done = 0; done < total; done += 40) {
    buildings.update(startX, startY, 40);
    progress(0.7 + 0.2 * Math.min(1, done / total));
    await tick();
  }
  for (let i = 0; i < 6 && ground.update(startX, startY, 0, 30); i++) {
    progress(0.9 + 0.017 * i);
    await tick();
  }
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

  // luz de la hora real: cielo, corrección de color, niebla, ventanas y farolas (cada minuto)
  const fogCol = new THREE.Color(), bgCol = new THREE.Color();
  const clockEl = $('clock');
  const applyTime = () => {
    sunNow = sunPosition(new Date());
    const wasNight = pal.night > 0.5;
    pal = paletteFor(sunNow.el);
    const [gr, gg, gb] = pal.grade;
    pixel.grade.set(gr, gg, gb);
    sky.update(pal, sunNow.az, sunNow.el);
    // la niebla y el fondo los oscurece luego la corrección: se compensan para que casen con el cielo
    fogCol.set(pal.fog);
    (scene.fog as THREE.Fog).color.setRGB(Math.min(1, fogCol.r / gr), Math.min(1, fogCol.g / gg), Math.min(1, fogCol.b / gb));
    bgCol.set(pal.skyTop);
    (scene.background as THREE.Color).setRGB(Math.min(1, bgCol.r / gr), Math.min(1, bgCol.g / gg), Math.min(1, bgCol.b / gb));
    facades.setNight(pal.night > 0.5);
    ground.night = pal.night;
    if (wasNight !== pal.night > 0.5) ground.repaint();
    sun.intensity = 2.2 * (1 - pal.night * 0.6);
    const t = bcnTime();
    clockEl.textContent = `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
  };
  applyTime();
  setInterval(applyTime, 60 * 1000);

  // pantalla de título
  $('loadbar').hidden = true;
  $('start').hidden = false;
  if (mobile) $('help').innerHTML = 'VOLANTE A LA IZQUIERDA · GAS, FRENO Y DRIFT A LA DERECHA · BAJAR Y FUEGO';
  await new Promise<void>((res) => {
    const go = () => { removeEventListener('pointerdown', go); removeEventListener('keydown', go); res(); };
    addEventListener('pointerdown', go);
    addEventListener('keydown', go);
  });
  sound.start();
  input.flush();
  $('title').classList.add('hidden');
  $('hud').hidden = false;
  if (mobile) document.documentElement.requestFullscreen?.().catch(() => {});
  const musicBtn = $('musicbtn');
  const toggleMusic = () => {
    const on = sound.toggleMusic();
    musicBtn.textContent = on ? '♪ ON' : '♪ OFF';
    pause.set('music', on);
  };
  musicBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); toggleMusic(); });

  // ------------------------------------------------------- fundidos y cinemáticas
  const fadeEl = $('fade');
  const fade = (mid: () => void) => {
    fadeEl.classList.add('on');
    setTimeout(() => { mid(); setTimeout(() => fadeEl.classList.remove('on'), 120); }, 380);
  };
  const cutscene = new Cutscene();
  const director = new Director();
  cutscene.onDone = () => cam.snap(focus());

  // ------------------------------------------------------- subir y bajar del coche
  const enterBtn = $('enterbtn');
  const setCar = (v: Vehicle | null) => {
    car?.setDriver(false);
    v?.setDriver(true);
    car = v;
    combat.playerCar = v;
    combat.walker = v ? null : walker;
    enterBtn.textContent = v ? 'BAJAR' : 'SUBIR';
  };
  const getOut = () => {
    const v = car!;
    if (v.speed > 7) return; // en marcha no
    // por la puerta del conductor (izquierda) o, si hay pared, por la derecha
    for (const side of [-1, 1]) {
      const rx = Math.cos(v.a) * side, ry = -Math.sin(v.a) * side;
      const x = v.x + rx * (v.width / 2 + 0.55), y = v.y + ry * (v.width / 2 + 0.55);
      if (walls.raycast(v.x, v.y, x + rx * 0.4, y + ry * 0.4) < 1) continue;
      walker.x = x; walker.y = y; walker.a = v.a; walker.vx = walker.vy = 0; walker.down = 0;
      walker.z = Vehicle.ground(x, y);
      traffic.park(v);
      setCar(null);
      sound.door();
      return;
    }
  };
  /** Sube al coche (o helicóptero) más cercano. Si tiene conductor, se lo saca a la fuerza (robo). */
  const getIn = () => {
    const h = helis.nearest(walker.x, walker.y, 5.5);
    if (h) {
      heli = h;
      setCar(null);
      combat.walker = null;
      enterBtn.textContent = 'BAJAR';
      hud.say('ESPACIO SUBIR · SHIFT BAJAR');
      sound.door();
      return;
    }
    let best: Vehicle | null = null, bestD = Infinity;
    for (const v of traffic.vehicles()) {
      if (v.wrecked || v.speed > 9) continue;
      const d = Math.hypot(v.x - walker.x, v.y - walker.y) - v.length / 2;
      if (d < 1.6 && d < bestD) { best = v; bestD = d; }
    }
    if (!best) return;
    const ai = traffic.cars.find((c) => c.v === best);
    if (ai) {
      traffic.take(ai);
      const lx = -Math.cos(best.a), ly = Math.sin(best.a);
      peds.spawnFleeing(best.x + lx * (best.width / 2 + 0.6), best.y + ly * (best.width / 2 + 0.6), walker.x, walker.y);
      peds.panic(best.x, best.y, 20);
      best.vx = best.vy = 0;
      police.crime('jack');
      economy.career.jacked++;
    } else traffic.unpark(best);
    setCar(best);
    cam.bump(0.1);
    sound.door();
  };
  enterBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  const leaveHeli = () => {
    const h = heli!;
    if (!h.canExit(roofs, map.terrain.at(h.x, h.y))) { hud.say(h.landed ? 'AQUÍ NO: ATERRIZA EN LA CALLE' : 'ATERRIZA PARA BAJAR'); return; }
    for (const side of [-1, 1]) {
      const rx = Math.cos(h.a) * side, ry = -Math.sin(h.a) * side;
      const x = h.x + rx * 2.4, y = h.y + ry * 2.4;
      if (walls.raycast(h.x, h.y, x + rx * 0.4, y + ry * 0.4) < 1) continue;
      walker.x = x; walker.y = y; walker.a = h.a; walker.vx = walker.vy = 0; walker.down = 0;
      heli = null;
      setCar(null);
      sound.door();
      return;
    }
  };
  /** El helicóptero del jugador revienta (choque o daños). */
  const crashHeli = (h: Heli) => {
    combat.blast(h.x, h.y, h.z);
    helis.remove(h);
    if (h === heli) {
      walker.x = h.x; walker.y = h.y; walker.a = h.a;
      heli = null;
      setCar(null);
      combat.onPlayerDown?.();
    }
  };
  combat.onBlast = (x, y, r) => {
    for (const h of [...helis.list]) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < r && d > 0.5) h.damage(120 * (1 - d / r));
    }
  };

  // ------------------------------------------------------- interiores (puertas con fundido)
  let inside: Room | null = null;
  const enterRoom = (r: Room) => fade(() => {
    const [x, y, a] = interiors.enter(r);
    inside = r;
    walker.x = x; walker.y = y; walker.a = a; walker.vx = walker.vy = 0;
    walker.floor = FLOOR;
    walker.z = FLOOR;
    cam.snap(walker);
    hud.say(r.name);
  });
  const leaveRoom = () => fade(() => {
    const out = interiors.leave();
    inside = null;
    walker.floor = null;
    if (out) { walker.x = out[0]; walker.y = out[1]; walker.a = out[2]; walker.z = Vehicle.ground(out[0], out[1]); }
    cam.snap(walker);
  });

  // ------------------------------------------------------- rueda de armas y apuntado
  const wheel = new WeaponWheel();
  wheel.owned = (i) => economy.owned.has(WEAPONS[i].id);
  const weaponBtn = $('weaponbtn');
  const showWeapon = () => {
    weaponBtn.replaceChildren(weaponIcon(combat.current.id), document.createTextNode(combat.current.name));
  };
  const selectWeapon = (i: number) => {
    if (!economy.owned.has(WEAPONS[i].id)) return;
    combat.weapon = i;
    showWeapon();
  };
  wheel.onPick = selectWeapon;
  weaponBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (!wheel.open) wheel.show(combat.weapon, true); });
  showWeapon();
  const aim = new Aim();
  combat.assist = options.autoAim;

  // ------------------------------------------------------- tiendas
  const shop = new ShopMenu(economy);
  shop.onBuy = (id) => {
    if (id === 'armor') walker.armor = 100;
    else { economy.owned.add(id); selectWeapon(WEAPONS.findIndex((w) => w.id === id)); }
    sound.door();
  };

  // ------------------------------------------------------- menú de pausa
  const pause = new PauseMenu(options, () => economy.stats());
  pause.onChange = (o) => {
    combat.assist = o.autoAim;
    if (sound.musicOn !== o.music) { sound.toggleMusic(); musicBtn.textContent = o.music ? '♪ ON' : '♪ OFF'; }
  };
  const saveGame = () => {
    const ok = economy.save({ armor: walker.armor });
    hud.big(ok ? 'PARTIDA GUARDADA' : 'NO SE HA PODIDO GUARDAR', ok ? `${economy.missions} MISIONES · $${economy.money}` : '');
  };
  pause.onSave = () => { pause.toggle(); saveGame(); };
  $('pausebtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); pause.toggle(); });
  if (!options.music && sound.musicOn) { sound.toggleMusic(); musicBtn.textContent = '♪ OFF'; }
  if (saved) {
    walker.armor = Number(saved.armor ?? 0);
    setTimeout(() => hud.big('PARTIDA CARGADA', `${economy.missions} MISIONES · $${economy.money}`), 600);
  }

  // ------------------------------------------------------- historia
  hud.speaker = (id) => ({ name: actors.character(id)?.alias ?? id.toUpperCase(), portrait: actors.portrait(id) });
  const story = new Story({
    world: map, roofs, traffic, police, actors, economy, gps, markers, interiors,
    player: () => {
      const f = focus();
      return { x: f.x, y: f.y, z: f.z, a: f.a, speed: f.speed, car, heli, onFoot: !car && !heli, inside, dead: dead > 0 };
    },
    parkCar: (kind, color, x, y) => {
      const v = new Vehicle(kind, color);
      const ne = graph.nearestEdge(x, y);
      if (ne) placeCar(v, ne.edge, ne.s);
      else { v.x = x; v.y = y; v.syncMesh(); }
      traffic.park(v);
      v.setDriver(false);
      return v;
    },
    say: (t) => hud.say(t),
    objective: (t) => hud.objective(t),
    timer: (s) => hud.timer(s),
    big: (t, s) => hud.big(t, s),
    dialog: (lines, done) => sceneDialog(lines, done),
    reveal: (x, y, caption) => {
      const f = focus();
      if (inside || cutscene.active || Math.hypot(x - f.x, y - f.y) > 600) return;
      // la cámara vuela hasta el objetivo, como en GTA
      const z = Vehicle.ground(x, y), a = Math.atan2(x - f.x, y - f.y);
      cutscene.play([x - Math.sin(a) * 40, y - Math.cos(a) * 40, z + 30], [x - Math.sin(a + 0.6) * 14, y - Math.cos(a + 0.6) * 14, z + 6],
        [x, y, z + 1], [x, y, z + 1], caption, 3);
    },
    celebrate: () => {
      const f = focus(), a = f.a;
      cutscene.play([f.x + Math.sin(a + 1.3) * 10, f.y + Math.cos(a + 1.3) * 10, f.z + 4], [f.x + Math.sin(a - 1.3) * 7, f.y + Math.cos(a - 1.3) * 7, f.z + 2.2],
        [f.x, f.y, f.z + 1.2], [f.x, f.y, f.z + 1.2], '', 3.2);
    },
    jingle: (win) => sound.jingle(win),
    save: () => economy.save({ armor: walker.armor }),
  });

  /**
   * Diálogo como cinemática: los que hablan se colocan frente al protagonista (si no están ya cerca)
   * y el director va cambiando de plano con cada línea.
   */
  function sceneDialog(lines: Line[], done: () => void) {
    const f = focus();
    const floorZ = inside ? FLOOR : Vehicle.ground(f.x, f.y);
    const cast: Record<string, Cast> = { pau: { x: f.x, y: f.y, z: car || heli ? f.z : floorZ } };
    const temp: string[] = [];
    const ids = [...new Set(lines.map((l) => l[0]).filter((id) => id !== 'pau'))];
    ids.forEach((id, i) => {
      let a = actors.get(id);
      if (!a || a.mode === 'dead' || Math.hypot(a.x - f.x, a.y - f.y) > 12) {
        // aparece delante del jugador (al lado de la puerta del coche si vas conduciendo)
        const ang = f.a + (i - (ids.length - 1) / 2) * 0.7;
        const dist = car || heli ? 3.4 : 2.4;
        a = actors.spawn(id, f.x + Math.sin(ang) * dist, f.y + Math.cos(ang) * dist, 'idle');
        temp.push(id);
      }
      a.a = Math.atan2(f.x - a.x, f.y - a.y);
      cast[id] = { x: a.x, y: a.y, z: inside ? FLOOR : Vehicle.ground(a.x, a.y) };
    });
    if (!car && !heli && ids.length) {
      const first = cast[ids[0]];
      walker.a = Math.atan2(first.x - walker.x, first.y - walker.y);
    }
    director.start(cast);
    hud.onLine = (id) => director.line(id);
    hud.dialog(lines, () => {
      director.stop();
      hud.onLine = undefined;
      // los que han venido solo a hablar se van (salvo los que necesita la misión)
      for (const id of temp) {
        const a = actors.get(id);
        if (a && !story.run?.targets.includes(a) && story.run?.passenger !== a) a.x = 1e9;
      }
      cam.snap(focus());
      done();
    });
  }

  // ------------------------------------------------------- delitos, muertes, dinero
  combat.onCrime = (k, x, y) => {
    police.crime(k);
    if (k === 'boom') economy.career.booms++;
    if (k === 'ped') {
      economy.career.kills++;
      if (Math.random() < 0.55) pickups.dropCash(x, y, 10 + Math.floor(Math.random() * 60));
    }
  };
  actors.onKilled = (a) => {
    police.crime(a.ch?.role === 'calle' ? 'ped' : 'ped');
    economy.career.kills++;
    pickups.dropCash(a.x, a.y, a.ch ? 100 + Math.floor(Math.random() * 200) : 40);
  };
  actors.onTalk = (who, line) => hud.say(`${who}: «${line}»`);
  peds.onHit = (x, y, sp, by) => {
    sound.thud();
    if (by === car) {
      cam.bump(0.15 + sp * 0.005);
      police.crime('runover');
      economy.career.runover++;
      if (Math.random() < 0.4) pickups.dropCash(x, y, 10 + Math.floor(Math.random() * 40));
    }
  };

  const wasted = $('wasted');
  let dead = 0, busted = false;
  combat.onPlayerDown = () => {
    if (dead > 0) return;
    dead = 3.5;
    busted = false;
    wasted.textContent = 'HAS MUERTO';
    wasted.hidden = false;
    if (car) {
      // sale despedido del coche en llamas
      walker.x = car.x; walker.y = car.y; walker.a = car.a;
      traffic.park(car);
      setCar(null);
    }
    walker.health = 0;
    walker.down = 4;
    story.playerDown(false);
  };
  police.onBusted = () => {
    if (dead > 0) return;
    dead = 3;
    busted = true;
    wasted.textContent = 'DETENIDO';
    wasted.hidden = false;
    walker.down = 3;
    story.playerDown(true);
  };
  const hitPlayer = (dmg: number) => {
    if (dead > 0) return;
    if (heli) heli.damage(dmg * 1.5);
    else if (car) car.damage(dmg * 0.8);
    else {
      walker.hurt(dmg);
      fx.blood(walker.x, walker.y, walker.z + 1.2);
      cam.bump(0.08);
      if (walker.health <= 0) combat.onPlayerDown?.();
    }
  };
  police.onHitPlayer = hitPlayer;
  actors.onHitPlayer = hitPlayer;

  /** Reaparición en la puerta del hospital (o de la comisaría) más cercano, con cinemática. */
  const revive = () => {
    dead = 0;
    heli = null;
    if (inside) { interiors.leave(); inside = null; walker.floor = null; }
    police.clear();
    wasted.hidden = true;
    walker.health = 100;
    walker.down = 0;
    const list = busted ? POLICE_STATIONS : HOSPITALS;
    const rooms = interiors.rooms.filter((r) => r.id.startsWith(busted ? 'comisaria:' : 'hospital:'));
    let best = rooms[0], bd = Infinity;
    for (const r of rooms) { const d = Math.hypot(r.door[0] - walker.x, r.door[1] - walker.y); if (d < bd) { bd = d; best = r; } }
    const [dx, dy, da] = best.door;
    walker.x = dx + Math.sin(da) * 1.2; walker.y = dy + Math.cos(da) * 1.2; walker.a = da;
    walker.z = Vehicle.ground(walker.x, walker.y);
    const fee = Math.min(economy.money, busted ? 500 : 100);
    economy.spend(fee);
    if (busted) {
      economy.career.busted++;
      economy.owned = new Set<WeaponId>(['fists', 'pistol']);
      selectWeapon(1);
    } else economy.career.deaths++;
    setCar(null);
    traffic.clear();
    // cámara: de lejos y alto frente a la puerta hasta detrás del jugador
    const fx2 = Math.sin(da), fy2 = Math.cos(da), gz = walker.z;
    cutscene.play(
      [dx + fx2 * 30 - fy2 * 10, dy + fy2 * 30 + fx2 * 10, gz + 16],
      [walker.x - fx2 * 5, walker.y - fy2 * 5, gz + 2.6],
      [dx, dy, gz + 4],
      [walker.x + fx2 * 7, walker.y + fy2 * 7, gz + 1.2],
      `${list[rooms.indexOf(best)]?.[0] ?? best.name}${fee ? ` · -$${fee}` : ''}`,
    );
  };

  // ------------------------------------------------------- recoger objetos
  const take = (p: Pickup): boolean => {
    switch (p.kind) {
      case 'health':
        if (walker.health >= 100 || car || heli) return false;
        walker.health = 100; hud.say('VIDA AL MÁXIMO'); return true;
      case 'armor':
        if (walker.armor >= 100 || car || heli) return false;
        walker.armor = 100; hud.say('CHALECO ANTIBALAS'); return true;
      case 'cash':
        economy.earn(p.amount); sound.ping(); return true;
      case 'package':
        economy.earn(p.amount);
        economy.packages.add(p.pkg);
        hud.big('PAQUETE OCULTO', `${economy.packages.size} DE 20 · ${p.name.toUpperCase()} · $${p.amount}`);
        sound.jingle(true);
        economy.save({ armor: walker.armor });
        return true;
      default: {
        if (car || heli) return false;
        const i = WEAPONS.findIndex((w) => w.id === p.kind);
        const isNew = !economy.owned.has(p.kind as WeaponId);
        economy.owned.add(p.kind as WeaponId);
        selectWeapon(i);
        hud.say(isNew ? `NUEVA ARMA: ${WEAPONS[i].name}` : WEAPONS[i].name);
        return true;
      }
    }
  };

  // ------------------------------------------------------- talleres de pintura
  let paintT = 0;
  const paintShop = () => {
    if (!car || paintT > 0) return;
    const m = markers.near(car.x, car.y, 4, 'paint');
    if (!m || car.speed > 4) return;
    paintT = 8;
    if (police.stars === 0 && car.health >= car.maxHealth) { hud.say('NO HACE FALTA: NI ESTRELLAS NI GOLPES'); return; }
    if (!economy.spend(100)) { hud.say('PINTA Y LISTO: $100 · NO TIENES DINERO'); return; }
    const v = car;
    fade(() => {
      const color = BODY_COLORS[Math.floor(Math.random() * BODY_COLORS.length)];
      const body = v.mesh.children.find((o) => o instanceof THREE.Mesh && o.name !== 'driver' && !o.name.startsWith('siren') && (o as THREE.Mesh).geometry.type !== 'PlaneGeometry') as THREE.Mesh | undefined;
      if (body) body.geometry = carGeometry(v.kind, color);
      v.health = v.maxHealth;
      v.burning = 0;
      police.clear();
      hud.big('PINTA Y LISTO', 'COCHE NUEVO, SIN ESTRELLAS · -$100');
    });
  };

  // ------------------------------------------------------- trucos de Vice City
  const cheat = (code: string) => {
    const f = focus();
    switch (code) {
      case 'THUGSTOOLS': case 'PROFESSIONALTOOLS': case 'NUTTERTOOLS':
        for (const w of WEAPONS) economy.owned.add(w.id);
        break;
      case 'ASPIRINE': walker.health = 100; if (car) { car.health = car.maxHealth; car.burning = 0; } break;
      case 'PRECIOUSPROTECTION': walker.armor = 100; break;
      case 'LEAVEMEALONE': police.clear(); break;
      case 'YOUWONTTAKEMEALIVE': police.setStars(Math.min(5, police.stars + 2)); break;
      case 'BIGBANG':
        for (const v of [...traffic.vehicles(), ...police.vehicles()]) if (Math.hypot(v.x - f.x, v.y - f.y) < 60) combat.explode(v);
        break;
      case 'PANZER': case 'GETTHEREFAST': {
        if (heli || inside) return;
        const v = new Vehicle(code === 'PANZER' ? 'riot' : 'player', code === 'PANZER' ? '#3a4a2a' : '#f4d020');
        v.x = f.x + Math.cos(f.a) * 4; v.y = f.y - Math.sin(f.a) * 4; v.a = f.a;
        v.syncMesh();
        v.setDriver(false);
        traffic.park(v);
        break;
      }
      case 'ICANTTAKEITANYMORE': if (!car && !heli) { walker.health = 0; combat.onPlayerDown?.(); } break;
      case 'PELAS': economy.earn(100000); break;
    }
    hud.big('TRUCO ACTIVADO', code);
  };

  // ------------------------------------------------------- mapa de la ciudad (M)
  const cityMap = new CityMap(map, base);
  const toggleMap = () => {
    const f = focus();
    cityMap.toggle(inside ? inside.door[0] : f.x, inside ? inside.door[1] : f.y);
    $('hud').classList.toggle('paused', cityMap.open);
    if (cityMap.open) sound.setEngine(0, 0, 0, false);
  };
  $('mapbtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); toggleMap(); });
  cityMap.onPick = (x, y) => {
    toggleMap();
    gps.clear();
    void teleportTo(x, y);
  };
  cityMap.onWaypoint = (x, y) => {
    const f = focus();
    gps.setTarget(x, y, f.x, f.y, f.a, !car && !heli);
  };
  cityMap.onClearWaypoint = () => gps.clear();
  gps.onArrive = () => hud.say('HAS LLEGADO');
  /** Lleva al jugador (en coche o a pie) a la calle más cercana a (x, y) y espera a que cargue la zona. */
  const teleportTo = async (x: number, y: number, a?: number) => {
    if (inside) { interiors.leave(); inside = null; walker.floor = null; }
    const ne = graph.nearestEdge(x, y, a === undefined ? undefined : (e) => Math.cos(graph.pose(e, e.len / 2, 0, { x: 0, y: 0, a: 0 }).a - a) > 0.8);
    if (!ne) return;
    if (heli) {
      heli.x = x; heli.y = y;
      heli.z = Math.max(heli.z, map.terrain.at(x, y) + 80);
      heli.vx = heli.vy = heli.vz = 0;
    } else if (car) placeCar(car, ne.edge, ne.s);
    else {
      const p = graph.pose(ne.edge, ne.s, ne.edge.road.width / 2 + 2, { x: 0, y: 0, a: 0 });
      walker.x = p.x; walker.y = p.y; walker.a = p.a;
    }
    const f = focus();
    cam.snap(f);
    traffic.clear(car ?? undefined);
    await map.preload(f.x, f.y, 700);
    buildings.update(f.x, f.y, 1000);
    ground.update(f.x, f.y, f.a, 100);
  };

  // ------------------------------------------------------- bucle principal
  const circ: number[] = [], ocirc: number[] = [];
  let last = performance.now(), acc = 0;
  const DT = 1 / 120;
  const camRight = new THREE.Vector3();
  const healthBar = $('health').querySelector('u') as HTMLElement;
  const armorBar = $('health').querySelector('.arm u') as HTMLElement;
  const moneyEl = $('money');
  const starsEl = $('stars'), starEls = [...starsEl.children] as HTMLElement[];
  let lastX = startX, lastY = startY, hintT = 0;

  /** Choques del coche del jugador con el resto de vehículos (con daños). */
  const collideCars = (me: Vehicle) => {
    me.circles(circ);
    for (const o of [...traffic.vehicles(), ...police.vehicles()]) {
      if (Math.abs(o.x - me.x) > 14 || Math.abs(o.y - me.y) > 14) continue;
      o.circles(ocirc);
      for (let i = 0; i < circ.length; i += 3)
        for (let j = 0; j < ocirc.length; j += 3) {
          const dx = circ[i] - ocirc[j], dy = circ[i + 1] - ocirc[j + 1];
          const d = Math.hypot(dx, dy), min = circ[i + 2] + ocirc[j + 2];
          if (d >= min || d < 1e-4) continue;
          const nx = dx / d, ny = dy / d, push = min - d;
          me.x += nx * push;
          me.y += ny * push;
          const rvx = me.vx - o.vx, rvy = me.vy - o.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const parked = traffic.parked.includes(o) || o.kind === 'police' || o.kind === 'riot';
            const k = o.kind === 'bus' ? 1.6 : parked ? 0.9 : 1.2;
            me.vx -= k * vn * nx;
            me.vy -= k * vn * ny;
            if (parked) { o.vx += vn * nx * 0.6; o.vy += vn * ny * 0.6; }
            if (-vn > 3) {
              sound.crash(-vn);
              cam.bump(Math.min(0.6, -vn * 0.04));
              const ai = traffic.cars.find((c) => c.v === o);
              if (ai) ai.stun = 2 + Math.random() * 2;
            }
            if (-vn > 6) { me.damage((-vn - 5) * 2); combat.hurtCar(o, (-vn - 5) * 2.5, me.x, me.y); }
          }
          me.circles(circ);
        }
    }
  };

  /** A pie: los coches en marcha te atropellan. */
  const runOver = () => {
    if (walker.down > 0 || dead || inside) return;
    for (const v of [...traffic.vehicles(), ...police.vehicles()]) {
      if (v.speed < 4 || Math.abs(v.x - walker.x) > 8 || Math.abs(v.y - walker.y) > 8) continue;
      const fx = Math.sin(v.a), fy = Math.cos(v.a);
      const dx = walker.x - v.x, dy = walker.y - v.y;
      if (Math.abs(dx * fx + dy * fy) < v.length / 2 + 0.4 && Math.abs(dx * fy - dy * fx) < v.width / 2 + 0.4) {
        walker.hurt(v.speed * 3.5, v.vx * 0.8, v.vy * 0.8);
        sound.thud();
        cam.bump(0.4);
        if (walker.health <= 0) combat.onPlayerDown?.();
        return;
      }
    }
  };

  /** Blancos para el apuntado: peatones, agentes, actores, coches y helicópteros. */
  const aimTargets = (): AimTarget[] => {
    const out: AimTarget[] = [];
    for (const p of peds.peds) out.push({ key: p, alive: () => !p.hit, pos: () => [p.x, p.y, Vehicle.ground(p.x, p.y) + 1.1] });
    for (const t of police.targets()) out.push({ key: t, alive: () => t.alive, pos: () => [t.x, t.y, Vehicle.ground(t.x, t.y) + (t.r > 1 ? 30 : 1.1)] });
    for (const a of actors.targets()) out.push({ key: a, alive: () => a.alive, pos: () => [a.x, a.y, Vehicle.ground(a.x, a.y) + 1.1] });
    for (const v of [...traffic.vehicles(), ...police.vehicles()]) if (!v.wrecked) out.push({ key: v, alive: () => !v.wrecked, pos: () => [v.x, v.y, v.z + 0.9] });
    return out;
  };

  const stats = { logic: 0, render: 0, n: 0 };
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // menús que paran el juego: pausa, tienda y mapa
    if (input.pressed('Escape')) {
      if (cityMap.open) toggleMap();
      else if (shop.open) shop.hide();
      else pause.toggle();
    }
    if (pause.open) return;
    if (shop.open) {
      for (let i = 0; i < 5; i++) if (input.pressed(`Digit${i + 1}`)) shop.buy(i);
      if (input.enterPressed()) shop.hide();
      return;
    }
    if (input.pressed('KeyM')) toggleMap();
    if (cityMap.open) {
      const f = focus();
      cityMap.route = gps.route;
      cityMap.target = gps.target;
      cityMap.marks = helis.list.filter((h) => h !== heli).map((h) => ({ x: h.x, y: h.y, c: '#ffd020', label: 'H' }));
      for (const v of police.vehicles()) cityMap.marks.push({ x: v.x, y: v.y, c: '#3060ff' });
      const gr = story.giverRoom();
      if (gr && !story.run) cityMap.marks.push({ x: gr.door[0], y: gr.door[1], c: '#ffd020', label: 'M' });
      cityMap.marks.push({ x: safehouse.door[0], y: safehouse.door[1], c: '#5ac8f4', label: 'S' });
      for (const r of interiors.rooms) if (r.id.startsWith('armeria')) cityMap.marks.push({ x: r.door[0], y: r.door[1], c: '#3cff7a', label: 'A' });
      for (const m of markers.list) if (m.kind === 'paint') cityMap.marks.push({ x: m.x, y: m.y, c: '#ff8a20', label: 'P' });
      for (const r of interiors.rooms) if (r.id.startsWith('hospital')) cityMap.marks.push({ x: r.door[0], y: r.door[1], c: '#ff3c6a', label: '+' });
      cityMap.draw(realDt, inside ? inside.door[0] : f.x, inside ? inside.door[1] : f.y, f.a);
      return;
    }

    // rueda de armas: mantener Tab (cámara lenta mientras está abierta)
    if (input.wheelHeld() && !wheel.open) wheel.show(combat.weapon);
    if (wheel.open && !wheel.touch) {
      if (!input.wheelHeld()) wheel.close();
      if (input.pressed('ArrowLeft') || input.pressed('KeyA')) wheel.step(-1);
      if (input.pressed('ArrowRight') || input.pressed('KeyD')) wheel.step(1);
    }
    const sc = input.scroll(), dg = input.digit();
    if (dg >= 0) selectWeapon(dg);
    else if (sc && !wheel.open) {
      for (let k = 1; k <= WEAPONS.length; k++) {
        const i = (combat.weapon + sc * k + WEAPONS.length * 6) % WEAPONS.length;
        if (economy.owned.has(WEAPONS[i].id)) { selectWeapon(i); break; }
      }
    }
    const dt = wheel.open ? realDt * 0.2 : realDt;

    const code = input.cheat(CHEATS);
    if (code) cheat(code);
    if (input.pressed('KeyN')) toggleMusic();
    if (input.pressed('KeyV') && (car || heli)) hud.say(sound.nextStation());

    // diálogos y cinemáticas: la acción se para
    if (hud.talking) {
      if (input.pressed('Enter') || input.pressed('Space') || input.pressed('KeyF')) hud.advance();
      input.enterPressed();
      director.update(realDt, cam.camera);
      const f = focus();
      if (!car && !heli) { walker.draw(heroSprite, 0, atlas.rects, cam.heading); heroSprite.commit(1); }
      actors.update(realDt, f.x, f.y, f.z, Math.atan2(f.x - cam.camera.position.x, -f.y + cam.camera.position.z), true, true);
      camRight.setFromMatrixColumn(cam.camera.matrixWorld, 0);
      camRight.y = 0;
      Billboards.camRight.value.copy(camRight.normalize());
      sky.mesh.position.copy(cam.camera.position);
      hud.update(dt, 0, 0, f.x, f.y, f.a, -1, []);
      renderer.info.reset();
      pixel.render(renderer, scene, cam.camera);
      return;
    }
    if (cutscene.active) {
      const skip = input.enterPressed() || input.pressed('Space');
      cutscene.update(dt, cam.camera, skip);
      const [cx, cy] = cutscene.focus;
      map.update(cx, cy);
      ground.update(cx, cy, walker.a, 3);
      buildings.update(cx, cy, 3);
      camRight.setFromMatrixColumn(cam.camera.matrixWorld, 0);
      camRight.y = 0;
      Billboards.camRight.value.copy(camRight.normalize());
      sky.mesh.position.copy(cam.camera.position);
      if (!car && !heli) { walker.draw(heroSprite, 0, atlas.rects, walker.a); heroSprite.commit(1); } else heroSprite.commit(0);
      actors.update(dt, walker.x, walker.y, walker.z, walker.a, true, true);
      fx.update(dt);
      renderer.info.reset();
      pixel.render(renderer, scene, cam.camera);
      return;
    }

    if (dead > 0) {
      dead -= dt;
      if (dead <= 0) revive();
    }
    paintT -= dt;
    if (!dead && input.enterPressed()) {
      const door = !car && !heli && walker.down <= 0 ? interiors.nearDoor(walker.x, walker.y) : null;
      if (door) { if (inside) leaveRoom(); else enterRoom(door); }
      else if (inside) {
        // dentro: guardar en la cama del piso franco, comprar en la armería
        if (Math.hypot(walker.x - inside.action[0], walker.y - inside.action[1]) < 2) {
          if (inside === safehouse) saveGame();
          else if (inside.kind === 'armeria') shop.show(inside.name);
        }
      } else if (heli) leaveHeli();
      else if (car) getOut();
      else if (walker.down <= 0) getIn();
    }
    if (input.pressed('KeyH') && !dead && !heli && !inside) {
      const f = focus();
      hud.say(helis.summon(f.x, f.y, f.a) ? 'HELICÓPTERO AL LADO' : 'NO HAY SITIO PARA ATERRIZAR');
    }
    if (input.pressed('KeyR') && car && !dead) {
      const ne = graph.nearestEdge(car.x, car.y);
      if (ne) placeCar(car, ne.edge, ne.s);
    }

    // apuntado (a pie)
    const onFoot = !car && !heli;
    const aimA = onFoot && !dead && walker.down <= 0
      ? aim.update(input.aimHeld(), input.mouseDx(), walker.x, walker.y, walker.z, walker.a, input.aimHeld() ? aimTargets() : [], walls)
      : aim.update(false, 0, 0, 0, 0, 0, [], walls);

    const ctl = dead || car?.wrecked ? IDLE : input.controls();
    const hctl = heli && !dead ? input.heli() : null;
    acc += dt;
    while (acc >= DT) {
      helis.update(DT, heli, hctl, focus().x, focus().y);
      if (heli) {
        if (heli.lastImpact > 5) {
          sound.crash(heli.lastImpact);
          cam.bump(Math.min(0.8, heli.lastImpact * 0.06));
          heli.damage((heli.lastImpact - 4) * 9);
        }
      } else if (car) {
        car.step(ctl, DT, walls);
        if (car.lastImpact > 4) { sound.crash(car.lastImpact); cam.bump(Math.min(0.8, car.lastImpact * 0.05)); }
        if (car.lastImpact > 7) car.damage((car.lastImpact - 6) * 2);
      } else walker.step(ctl, DT, walls, inside ? [] : [...traffic.vehicles(), ...police.vehicles(), ...helis.list], aimA);
      acc -= DT;
    }
    for (const h of [...helis.list]) if (h.health <= 0) crashHeli(h);
    if (heli) { /* el helicóptero no choca con el tráfico */ }
    else if (car) {
      collideCars(car);
      car.syncMesh();
      paintShop();
    } else {
      runOver();
      if (!dead && walker.down <= 0 && input.firing() && !inside) {
        const t = aim.target?.pos();
        const a = combat.shoot(walker.x, walker.y, walker.z, aimA ?? walker.a, t ? [t[0], t[1]] : null);
        if (a !== null) { walker.a = a; walker.aimT = 0.4; cam.bump(0.04); }
      }
    }
    combat.update(dt);

    const f = focus();
    // dentro de un interior, el mundo se sigue cargando alrededor de la puerta
    const sx = inside ? inside.door[0] : f.x, sy = inside ? inside.door[1] : f.y;
    if (!inside) {
      economy.career.km += Math.hypot(f.x - lastX, f.y - lastY) / 1000;
      lastX = f.x; lastY = f.y;
    }
    // alcance de la vista: crece con la altitud (desde el helicóptero se ve media ciudad)
    const alt = f.z - map.terrain.at(f.x, f.y);
    const wantR = heli ? Math.min(1500, 760 + Math.max(0, alt - 15) * 5) : 760;
    view.r += (wantR - view.r) * Math.min(1, dt * 1.5);
    const fog = scene.fog as THREE.Fog;
    fog.far = inside ? 1e5 : 560 + (view.r - 760) * 1.15;
    fog.near = inside ? 1e5 : 150 + (view.r - 760) * 0.55;
    if (Math.abs(cam.camera.far - (fog.far + 700)) > 20 && !inside) { cam.camera.far = fog.far + 700; cam.camera.updateProjectionMatrix(); }

    traffic.update(dt, [...(heli && alt > 3 ? [] : [heli ?? car ?? walker]), ...police.vehicles()], sx, sy, cam.heading, walls);
    police.playerCar = car;
    police.update(dt, { x: inside ? 1e9 : f.x, y: inside ? 1e9 : f.y, z: f.z, vx: f.vx, vy: f.vy, speed: f.speed, mode: heli ? 'heli' : car ? 'car' : 'foot' }, cam.heading, walker.down > 0 || dead > 0);
    actors.update(dt, f.x, f.y, f.z, cam.heading, dead === 0, onFoot);
    story.update(dt);
    sound.setInCar(!!car || !!heli);
    cam.update(dt, f, walls, heli ? 'heli' : car ? 'car' : 'foot', inside ? () => FLOOR : heli ? (x, y) => roofs.surface(x, y) : undefined);
    const ccam = cam.camera;
    camRight.setFromMatrixColumn(ccam.matrixWorld, 0);
    camRight.y = 0;
    Billboards.camRight.value.copy(camRight.normalize());
    peds.update(dt, sx, sy, cam.heading, [...(car ? [car] : []), ...traffic.vehicles(), ...police.vehicles()]);
    if (car || heli) heroSprite.commit(0);
    else { walker.draw(heroSprite, 0, atlas.rects, cam.heading); heroSprite.commit(1); }
    pickups.update(dt, f.x, f.y, car ? 3 : 1.5, take, f.x, f.y);
    markers.update(dt, f.x, f.y);
    fx.update(dt);
    aim.draw(ccam, options.reticle, walker.x, walker.y, walker.z);
    sky.mesh.position.set(ccam.position.x, ccam.position.y, ccam.position.z);

    map.update(sx, sy);
    ground.update(sx, sy, cam.heading, 2);
    buildings.update(sx, sy, 2);

    // pistas: puertas, cama, mostrador
    hintT -= dt;
    if (hintT <= 0 && onFoot && !dead) {
      const door = interiors.nearDoor(walker.x, walker.y);
      if (door) { hud.say(inside ? 'F: SALIR' : `F: ENTRAR · ${door.name}`); hintT = 4; }
      else if (inside && Math.hypot(walker.x - inside.action[0], walker.y - inside.action[1]) < 2 && (inside === safehouse || inside.kind === 'armeria')) {
        hud.say(inside === safehouse ? 'F: GUARDAR PARTIDA' : 'F: COMPRAR'); hintT = 4;
      }
    }

    const sp = heli ? heli.speed : car ? Math.abs(car.forwardSpeed) : walker.speed;
    sound.setEngine(sp, ctl.throttle, car ? car.skid * Math.min(1, car.speed / 10) : 0, !!car && !car.wrecked);
    const [rl, rr] = helis.rotorLevel(f.x, f.y, f.z);
    sound.setRotor(rl, rr);
    hud.altitude(heli ? alt : null);
    gps.update(dt, f.x, f.y, f.a, onFoot, !!heli);
    hud.route = inside ? null : gps.route;
    hud.gps(gps.target && !inside ? (gps.route && !heli ? guidance(gps.route, f.x, f.y, f.a)
      : { left: Math.hypot(gps.target.x - f.x, gps.target.y - f.y), rel: Math.atan2(Math.sin(Math.atan2(gps.target.x - f.x, gps.target.y - f.y) - f.a), Math.cos(Math.atan2(gps.target.x - f.x, gps.target.y - f.y) - f.a)) }) : null);
    hud.marks = helis.list.filter((h) => h !== heli).map((h) => ({ x: h.x, y: h.y, c: '#ffd020' }));
    if (gps.target) hud.marks.push({ x: gps.target.x, y: gps.target.y, c: '#ff3cf0', s: 7 });
    const gr = story.giverRoom();
    if (gr && !story.run) hud.marks.push({ x: gr.door[0], y: gr.door[1], c: '#ffd020', s: 8 });
    const blink = Math.floor(now / 250) % 2 ? '#3060ff' : '#ff2030';
    for (const v of police.vehicles()) hud.marks.push({ x: v.x, y: v.y, c: blink, s: 5 });
    for (const h of police.helis) hud.marks.push({ x: h.x, y: h.y, c: blink, s: 7 });
    starsEl.classList.toggle('flash', police.stars > 0 && police.unseen > 1.5);
    for (let i = 0; i < 5; i++) starEls[i].classList.toggle('on', i < police.stars);
    economy.career.maxStars = Math.max(economy.career.maxStars, police.stars);
    const gears = [0, 12, 22, 33, 45, 70];
    let g = 1;
    while (g < 5 && sp > gears[g]) g++;
    const rpm = car ? 0.2 + 0.8 * Math.min(1, (sp - gears[g - 1]) / (gears[g] - gears[g - 1])) : 0;
    hud.update(dt, sp * 3.6, rpm, inside ? inside.door[0] : f.x, inside ? inside.door[1] : f.y, f.a, inside ? -1 : streets.nearest(f.x, f.y, f.a), traffic.cars.map((c) => c.v));
    healthBar.style.width = `${walker.health}%`;
    armorBar.style.width = `${walker.armor}%`;
    moneyEl.textContent = economy.tick(dt);

    const t1 = performance.now();
    renderer.info.reset();
    pixel.render(renderer, scene, ccam);
    stats.logic += t1 - t0;
    stats.render += performance.now() - t1;
    stats.n++;
  };
  requestAnimationFrame(frame);

  // al empezar: dentro del piso franco de Terrassa (o, en la demo, al volante en Passeig de Gràcia)
  if (terrassa) {
    enterRoom(safehouse);
    setTimeout(() => hud.big('GRAN ROBO BARCELONA', economy.missions ? 'DE VUELTA EN EL PISO FRANCO' : 'DE TERRASSA A BARCELONA'), 900);
  } else if (real) setTimeout(() => hud.say(real.label), 1200);

  (window as unknown as Record<string, unknown>).__game = {
    get car() { return car; }, get heli() { return heli; }, get inside() { return inside; },
    helis, roofs, gps, police, walker, traffic, peds, combat, map, cam, scene, renderer, stats, graph, buildings, ground,
    economy, story, actors, interiors, pickups,
    /** Depuración: colocar al jugador en una calle cercana a lon/lat con un rumbo dado. */
    teleport(lon: number, lat: number, deg: number) {
      const [x, y] = map.toLocal(lon, lat);
      return teleportTo(x, y, (deg * Math.PI) / 180);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

main().catch((e) => {
  console.error(e);
  $('help').textContent = `Error: ${e.message}`;
});
