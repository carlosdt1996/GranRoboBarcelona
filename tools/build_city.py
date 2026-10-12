#!/usr/bin/env python3
"""Genera la Barcelona completa en teselas a partir de los datos de data/raw/.

Salida (public/data/bcn/):
  world.json        – metadatos, nombres, calles circulables (globales, para el grafo del tráfico),
                      límite municipal y lista de teselas.
  terrain.bin       – rejilla de elevaciones (Int16 en decímetros, fila 0 = sur).
  tiles/X_Y.json    – edificios, parques/agua, caminos peatonales y árboles de cada tesela.

Coordenadas en metros (x = este, y = norte) alrededor del centro de la ciudad. Dentro de cada
tesela las geometrías van en decímetros relativos a la esquina de la tesela, con deltas.

Uso: python3 tools/build_city.py
Requiere: pip install shapely numpy pillow (y haber ejecutado overture_fetch.py y terrain_fetch.py)
"""
import json, math, os, sys, hashlib, shutil, warnings
from collections import defaultdict
import numpy as np
import shapely
from shapely.geometry import shape, box, Polygon, MultiPolygon, LineString, Point
from shapely.geometry.polygon import orient
from shapely.prepared import prep

warnings.filterwarnings("ignore")
ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "data", "bcn")
TILE = 512          # lado de tesela en metros
MARGIN = 150        # se incluye lo que quede a menos de esto del término municipal
TERRAIN_RES = 16    # metros por celda de la rejilla de relieve

# Proyección local equirectangular centrada en la ciudad (la misma que usa el juego)
LON0, LAT0 = 2.1400, 41.3925
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574


def proj(g):
    return shapely.transform(g, lambda c: (c - (LON0, LAT0)) * (KX, KY))


def load(name):
    with open(os.path.join(RAW, name), encoding="utf-8") as f:
        return json.load(f)["features"]


def h01(s):
    return int(hashlib.md5(str(s).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def polys(g):
    if g is None or g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    if hasattr(g, "geoms"): return [p for x in g.geoms for p in polys(x)]
    return []


def lines(g):
    if g is None or g.is_empty: return []
    if isinstance(g, LineString): return [g]
    if hasattr(g, "geoms"): return [l for x in g.geoms for l in lines(x)]
    return []


# ------------------------------------------------------------- término municipal
city = None
for f in load("divisions.geojson"):
    p = f["properties"]
    if p["name"] == "Barcelona" and p["subtype"] == "locality":
        city = proj(shape(f["geometry"]))
assert city is not None, "No se encontró el límite de Barcelona en divisions.geojson"
city = max(polys(city.buffer(0)), key=lambda p: p.area)  # sin islotes sueltos
REGION = city.buffer(MARGIN, join_style=2).simplify(5)
minx, miny, maxx, maxy = REGION.bounds
BOUNDS = [math.floor(minx / TILE) * TILE, math.floor(miny / TILE) * TILE, math.ceil(maxx / TILE) * TILE, math.ceil(maxy / TILE) * TILE]
print(f"Barcelona: {city.area / 1e6:.1f} km² · región {BOUNDS}", file=sys.stderr)
prep_region = prep(REGION)

names, name_idx = [], {}


def nid(n):
    if not n: return -1
    if n not in name_idx:
        name_idx[n] = len(names); names.append(n)
    return name_idx[n]


def tkey(x, y): return (math.floor(x / TILE), math.floor(y / TILE))


tiles = defaultdict(lambda: {"b": [], "a": [], "w": [], "t": []})


def enc_ring(coords, ox, oy, closed=True):
    """Anillo/polilínea → [x0, y0, dx1, dy1, ...] en decímetros relativos a (ox, oy)."""
    pts = list(coords)
    if closed and len(pts) > 1 and pts[0] == pts[-1]: pts = pts[:-1]
    out, px, py = [], 0, 0
    for x, y in pts:
        qx, qy = int(round((x - ox) * 10)), int(round((y - oy) * 10))
        out += [qx - px, qy - py]
        px, py = qx, qy
    return out


def poly_rings(p, tol, ox, oy, min_hole=4):
    p = p.simplify(tol, preserve_topology=True)
    if p.is_empty or p.area < 1: return None
    p = polys(p.buffer(0))
    if not p: return None
    p = orient(max(p, key=lambda a: a.area), 1.0)  # exterior CCW, huecos CW
    r = [enc_ring(p.exterior.coords, ox, oy)]
    r += [enc_ring(i.coords, ox, oy) for i in p.interiors if Polygon(i).area > min_hole]
    return r if len(r[0]) >= 6 else None


# ------------------------------------------------------------------ relieve
t = np.load(os.path.join(RAW, "terrain.npz"))
elev, z, tx0, ty0 = t["elev"], int(t["z"]), int(t["x0"]), int(t["y0"])
# suavizado ligero (el DEM incluye algo de "ruido" urbano)
k = np.array([1, 4, 6, 4, 1], np.float32); k /= k.sum()
for ax in (0, 1):
    elev = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 2, mode="edge"), k, "valid"), ax, elev)
NX = int(math.ceil((BOUNDS[2] - BOUNDS[0]) / TERRAIN_RES)) + 1
NY = int(math.ceil((BOUNDS[3] - BOUNDS[1]) / TERRAIN_RES)) + 1
gx = BOUNDS[0] + np.arange(NX) * TERRAIN_RES
gy = BOUNDS[1] + np.arange(NY) * TERRAIN_RES
X, Y = np.meshgrid(gx, gy)  # fila 0 = sur
lon = LON0 + X / KX
lat = LAT0 + Y / KY
px = ((lon + 180) / 360 * 2 ** z - tx0) * 256 - 0.5
py = ((1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / math.pi) / 2 * 2 ** z - ty0) * 256 - 0.5
i0, j0 = np.floor(px).astype(int), np.floor(py).astype(int)
fx, fy = px - i0, py - j0
i0 = np.clip(i0, 0, elev.shape[1] - 2); j0 = np.clip(j0, 0, elev.shape[0] - 2)
H = (elev[j0, i0] * (1 - fx) * (1 - fy) + elev[j0, i0 + 1] * fx * (1 - fy) +
     elev[j0 + 1, i0] * (1 - fx) * fy + elev[j0 + 1, i0 + 1] * fx * fy)
H = np.maximum(H, 0.0)  # nada por debajo del nivel del mar


def ground_range(g):
    """Cota mínima y máxima del terreno bajo los vértices de una geometría."""
    c = shapely.get_coordinates(g)
    fx = np.clip((c[:, 0] - BOUNDS[0]) / TERRAIN_RES, 0, NX - 1.001)
    fy = np.clip((c[:, 1] - BOUNDS[1]) / TERRAIN_RES, 0, NY - 1.001)
    i, j = fx.astype(int), fy.astype(int)
    u, v = fx - i, fy - j
    z = H[j, i] * (1 - u) * (1 - v) + H[j, i + 1] * u * (1 - v) + H[j + 1, i] * (1 - u) * v + H[j + 1, i + 1] * u * v
    return float(z.min()), float(z.max())


print(f"relieve: {NX}×{NY} a {TERRAIN_RES} m · {H.min():.0f}–{H.max():.0f} m", file=sys.stderr)

# ------------------------------------------------------------------ edificios
FLOOR, GROUND = 3.2, 1.2
GUESS = {"house": 7, "detached": 7, "semidetached_house": 7, "terrace": 8, "garage": 3.5, "garages": 3.5, "shed": 3,
         "roof": 4.5, "industrial": 9, "warehouse": 9, "retail": 7, "commercial": 12, "school": 11, "church": 16,
         "hospital": 20, "office": 22, "hotel": 25, "kiosk": 3, "service": 4, "hut": 3, "greenhouse": 3,
         "construction": 6, "ruins": 4, "transportation": 8, "train_station": 14, "parking": 9, "stadium": 25}


def height_of(p, seed):
    h, lv = p.get("height"), p.get("levels")
    if h and h > 0.5: return float(h)
    if lv is not None and lv > 0: return lv * FLOOR + GROUND
    if lv == 0: return 0.0
    g = GUESS.get(p.get("class"))
    return g if g else 10 + 9 * h01(seed)  # sin datos: entre PB+2 y PB+5


def min_height_of(p):
    mh, ml = p.get("min_height"), p.get("min_level")
    if mh: return float(mh)
    if ml: return ml * FLOOR + GROUND
    return 0.0


parts_by = defaultdict(list)
for f in load("building_parts.geojson"):
    b = f["properties"].get("building")
    if b: parts_by[b].append(f)

n_parts_used = 0


def emit_building(g, h, mh, name, z):
    if h - mh < 0.5: return
    for p in polys(g):
        c = p.representative_point()
        if not prep_region.contains(c): continue
        k = tkey(c.x, c.y)
        rr = poly_rings(p, 0.25, k[0] * TILE, k[1] * TILE)
        if rr:
            tiles[k]["b"].append({"h": round(h, 1), "m": round(mh, 1), "z": round(z, 1), "n": nid(name), "r": rr})
            if mh < 2.5: map_b.append(np.asarray(p.exterior.coords))


map_b, map_a = [], []  # para la imagen del mapa de la ciudad
feats = load("buildings.geojson")
geoms = proj(shapely.from_geojson([json.dumps(f["geometry"]) for f in feats]))
inside = shapely.intersects(geoms, REGION)
for f, g, ok in zip(feats, geoms, inside):
    if not ok: continue
    p = f["properties"]
    seed = p.get("id") or p.get("osm")
    h = height_of(p, seed)
    name = p.get("name")
    parts = parts_by.get(p.get("id"))
    # cota de la base común a todas las partes: el punto más bajo, salvo en cuestas fuertes
    # (que la azotea no quede enterrada por el lado de arriba)
    g0, g1 = ground_range(g)
    z = max(g0, g1 - max(h, 3) + 3)
    if parts:
        # Volúmenes del Catastro / modelos 3D: cada parte con su altura (patios de manzana, torres, cúpulas...)
        pg = [proj(shape(pf["geometry"])) for pf in parts]
        covered = sum(x.area for x in pg) / max(1.0, g.area)
        whole = covered < 0.85
        if whole: emit_building(g, h, 0.0, name, z)
        for pf, x in zip(parts, pg):
            pp = pf["properties"]
            ph = height_of(pp, seed) if (pp.get("height") or pp.get("levels") is not None) else h
            pmh = min_height_of(pp)
            if whole and ph <= h + 0.5 and pmh < 0.5: continue  # ya lo cubre el edificio entero
            emit_building(x, ph, pmh, name, z)
            n_parts_used += 1
        continue
    if h > 0: emit_building(g, h, 0.0, name, z)

print(f"edificios: {sum(len(t['b']) for t in tiles.values())} volúmenes ({n_parts_used} partes)", file=sys.stderr)

# ------------------------------------------------------------------ calles
ROAD_W = {"motorway": 20, "trunk": 20, "primary": 15, "secondary": 11, "tertiary": 10, "residential": 8,
          "unclassified": 7, "living_street": 6, "service": 4.5, "pedestrian": 6, "footway": 2.5, "cycleway": 2,
          "path": 2, "track": 3, "steps": 2.5, "unknown": 5}
DRIVE = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "living_street", "service"}
GLOBAL = DRIVE | {"pedestrian"}  # van en world.json (grafo del tráfico, peatones y nombres de calle)
roads = []
feats = [f for f in load("roads.geojson") if f["properties"]["kind"] == "road"]
geoms = proj(shapely.from_geojson([json.dumps(f["geometry"]) for f in feats]))
for f, g in zip(feats, geoms):
    p = f["properties"]
    c = p.get("class") or "unknown"
    if p.get("tunnel") or c not in ROAD_W: continue
    if c == "service" and not p.get("name"): continue
    if not prep_region.intersects(g): continue
    g = g.intersection(REGION)
    for l in lines(g):
        l = l.simplify(0.3)
        if l.length < 1: continue
        if c in GLOBAL:
            roads.append({"c": c, "w": ROAD_W[c], "o": 1 if p.get("oneway") else 0, "d": 1 if c in DRIVE else 0,
                          "n": nid(p.get("name")), "p": enc_ring(l.coords, 0, 0, closed=False)})
        else:
            # caminos, aceras y carriles bici: solo se pintan en el suelo → por teselas
            x0, y0, x1, y1 = l.bounds
            for tx in range(math.floor(x0 / TILE), math.floor(x1 / TILE) + 1):
                for ty in range(math.floor(y0 / TILE), math.floor(y1 / TILE) + 1):
                    for piece in lines(l.intersection(box(tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE))):
                        if piece.length > 0.5:
                            tiles[(tx, ty)]["w"].append({"c": c, "w": ROAD_W[c], "p": enc_ring(piece.coords, tx * TILE, ty * TILE, closed=False)})
print(f"calles: {len(roads)} tramos globales", file=sys.stderr)

# ------------------------------------------------------------- áreas y árboles
AREA_KIND = {
    "park": "park", "garden": "garden", "grass": "grass", "village_green": "grass", "dog_park": "park",
    "flowerbed": "garden", "playground": "plaza", "pitch": "pitch", "plaza": "plaza", "pedestrian": "plaza",
    "water": "water", "pond": "water", "reflecting_pool": "water", "swimming_pool": "pool", "basin": "water",
    "reservoir": "water", "river": "water", "stream": "water", "canal": "water", "lake": "water", "fountain": "pool",
    "ocean": "sea", "dock": "water", "lagoon": "water", "shrubbery": "garden", "grave_yard": "grave",
    "sand": "sand", "beach": "sand", "heath": "forest", "scrub": "forest", "wood": "forest", "forest": "forest",
    "nature_reserve": "forest", "grassland": "grass", "meadow": "grass", "cemetery": "grave",
    "golf_course": "grass", "recreation_ground": "grass", "allotments": "garden", "orchard": "garden",
    "vineyard": "garden", "farmland": "farm", "track": "plaza",
}
ORDER = ["farm", "forest", "grass", "park", "garden", "grave", "plaza", "pitch", "sand", "sea", "water", "pool"]
n_areas = n_trees = 0
feats = load("areas.geojson")
geoms = proj(shapely.from_geojson([json.dumps(f["geometry"]) for f in feats]))
area_items = []
for f, g in zip(feats, geoms):
    p = f["properties"]
    if isinstance(g, Point):
        if p.get("class") == "tree" and prep_region.contains(g):
            tiles[tkey(g.x, g.y)]["t"] += [int(round((g.x - tkey(g.x, g.y)[0] * TILE) * 10)), int(round((g.y - tkey(g.x, g.y)[1] * TILE) * 10))]
            n_trees += 1
        continue
    k = AREA_KIND.get(p.get("class")) or AREA_KIND.get(p.get("subtype"))
    if not k or not (prep_region.intersects(g) or (k == "sea" and g.intersects(box(*BOUNDS)))): continue
    area_items.append((ORDER.index(k), k, g))

area_items.sort(key=lambda a: a[0])
WORLD_BOX = box(*BOUNDS)
for _, k, g in area_items:
    # el mar llega hasta el horizonte (todo el rectángulo del mundo); lo demás, solo la ciudad
    g = g.intersection(WORLD_BOX if k == "sea" else REGION)
    x0, y0, x1, y1 = g.bounds
    tol = 0.4 if g.area < 2e4 else 1.0
    for tx in range(math.floor(x0 / TILE), math.floor(x1 / TILE) + 1):
        for ty in range(math.floor(y0 / TILE), math.floor(y1 / TILE) + 1):
            # un poco de solape entre teselas para que no queden costuras al pintar
            cell = box(tx * TILE - 1, ty * TILE - 1, (tx + 1) * TILE + 1, (ty + 1) * TILE + 1)
            for poly in polys(g.intersection(cell)):
                map_a.append((k, poly))
                rr = poly_rings(poly, tol, tx * TILE, ty * TILE)
                if rr:
                    tiles[(tx, ty)]["a"].append({"k": k, "r": rr})
                    n_areas += 1
print(f"áreas: {n_areas} trozos · árboles: {n_trees}", file=sys.stderr)

# ------------------------------------------------------------------ escritura
if os.path.isdir(OUT): shutil.rmtree(OUT)
os.makedirs(os.path.join(OUT, "tiles"))
(np.round(H * 10).astype("<i2")).tofile(os.path.join(OUT, "terrain.bin"))
tile_list, total = [], 0
for (tx, ty), d in sorted(tiles.items()):
    if not (d["b"] or d["a"] or d["w"] or d["t"]): continue
    p = os.path.join(OUT, "tiles", f"{tx}_{ty}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, separators=(",", ":"), ensure_ascii=False)
    total += os.path.getsize(p)
    tile_list.append([tx, ty])
# ------------------------------------------------------- mapa de la ciudad (tecla M)
from PIL import Image, ImageDraw
MPP = 4  # metros por píxel
W, Hh = (BOUNDS[2] - BOUNDS[0]) // MPP, (BOUNDS[3] - BOUNDS[1]) // MPP
img = Image.new("RGB", (W, Hh), "#1a0e2a")
dr = ImageDraw.Draw(img)
pix = lambda c: [((x - BOUNDS[0]) / MPP, (BOUNDS[3] - y) / MPP) for x, y in c]
dr.polygon(pix(REGION.exterior.coords), fill="#2a1640")
MAP_FILL = {"forest": "#24563a", "park": "#2f7a4a", "grass": "#2f7a4a", "garden": "#2f7a4a", "pitch": "#2f7a4a",
            "farm": "#4a6a3a", "grave": "#3a3050", "sand": "#a08a5a", "sea": "#26357e", "water": "#3a5ab0", "pool": "#3a5ab0"}
for k, poly in map_a:
    if k in MAP_FILL and poly.area > 30:
        dr.polygon(pix(poly.exterior.coords), fill=MAP_FILL[k])
for c in map_b:
    dr.polygon(pix(c), fill="#5a3a78")
ROAD_COL = {"motorway": "#ffd27a", "trunk": "#ffd27a", "primary": "#ffd27a", "secondary": "#f0c0e0"}
for r in sorted(roads, key=lambda r: r["c"] in ROAD_COL):
    if not r["d"] and r["c"] != "pedestrian": continue
    pts, x, y = [], 0, 0
    for i in range(0, len(r["p"]), 2):
        x += r["p"][i]; y += r["p"][i + 1]
        pts.append((x / 10, y / 10))
    dr.line(pix(pts), fill=ROAD_COL.get(r["c"], "#c8a0c0" if r["d"] else "#8a6a8a"), width=max(1, round(r["w"] / MPP)))
dr.line(pix(city.exterior.coords), fill="#ff3c6a", width=2)
img.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(OUT, "map.png"), optimize=True)

# nombres de los distritos para el mapa
districts = []
for f in load("divisions.geojson"):
    p = f["properties"]
    if p["subtype"] != "macrohood": continue
    g = proj(shape(f["geometry"]))
    inter = g.intersection(city)
    if inter.area < 0.6 * g.area: continue
    c = inter.representative_point() if not inter.centroid.within(inter) else inter.centroid
    districts.append([p["name"], round(c.x), round(c.y)])

ext = orient(city.simplify(4), 1.0)
world = {
    "name": "Barcelona", "origin": [LON0, LAT0], "bounds": BOUNDS, "tile": TILE,
    "attribution": "© OpenStreetMap contributors (ODbL), vía Overture Maps Foundation · Relieve: AWS Terrain Tiles",
    "terrain": {"nx": NX, "ny": NY, "res": TERRAIN_RES, "x0": BOUNDS[0], "y0": BOUNDS[1]},
    "boundary": enc_ring(REGION.exterior.coords, 0, 0),
    "city": enc_ring(ext.exterior.coords, 0, 0),
    "map": {"file": "map.png", "mpp": MPP}, "districts": districts,
    "tiles": tile_list, "names": names, "roads": roads,
}
with open(os.path.join(OUT, "world.json"), "w", encoding="utf-8") as f:
    json.dump(world, f, separators=(",", ":"), ensure_ascii=False)
print(f"{OUT}: world.json {os.path.getsize(os.path.join(OUT, 'world.json')) / 1e6:.1f} MB · "
      f"{len(tile_list)} teselas {total / 1e6:.1f} MB · terrain.bin {NX * NY * 2 / 1e6:.1f} MB", file=sys.stderr)
