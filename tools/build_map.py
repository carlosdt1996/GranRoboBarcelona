#!/usr/bin/env python3
"""Convierte los GeoJSON de data/raw/ en el mapa compacto que carga el juego.

- Recorta a la zona elegida (por defecto, el Eixample).
- Proyecta lon/lat a metros (x = este, y = norte) alrededor del centro.
- Simplifica geometrías y guarda coordenadas como enteros en decímetros.

Uso: python3 tools/build_map.py [zona]   (zonas en ZONES)
"""
import json, math, os, sys, hashlib, warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
from shapely.geometry import shape, box, Polygon, MultiPolygon, LineString, MultiLineString, Point
from shapely.ops import transform

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(ROOT, "data", "raw")
ZONES = {
    # De Gran Via a Diagonal, de Tarragona/Sants a la Sagrada Família
    "eixample": (2.1460, 41.3800, 2.1800, 41.4060),
}
zone = sys.argv[1] if len(sys.argv) > 1 else "eixample"
MINLON, MINLAT, MAXLON, MAXLAT = ZONES[zone]
LON0, LAT0 = (MINLON + MAXLON) / 2, (MINLAT + MAXLAT) / 2
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574


def proj(x, y, z=None):
    return ((x - LON0) * KX, (y - LAT0) * KY)


CLIP = transform(proj, box(MINLON, MINLAT, MAXLON, MAXLAT))
names, name_idx = [], {}


def nid(n):
    if not n: return -1
    if n not in name_idx:
        name_idx[n] = len(names); names.append(n)
    return name_idx[n]


def q(v): return int(round(v * 10))


def ring(coords):
    pts = list(coords)
    if len(pts) > 1 and pts[0] == pts[-1]: pts = pts[:-1]
    out = []
    for x, y in pts: out += [q(x), q(y)]
    return out


def polys(g):
    if g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    if isinstance(g, MultiPolygon): return list(g.geoms)
    if hasattr(g, "geoms"): return [p for x in g.geoms for p in polys(x)]
    return []


def lines(g):
    if g.is_empty: return []
    if isinstance(g, LineString): return [g]
    if hasattr(g, "geoms"): return [l for x in g.geoms for l in lines(x)]
    return []


def poly_rings(p, tol):
    p = p.simplify(tol, preserve_topology=True)
    if p.is_empty or p.area < 1: return None
    p = Polygon(p.exterior.coords, [i.coords for i in p.interiors]).buffer(0)
    p = polys(p)
    if not p: return None
    p = max(p, key=lambda a: a.area)
    from shapely.geometry.polygon import orient
    p = orient(p, 1.0)  # exterior CCW, huecos CW
    return [ring(p.exterior.coords)] + [ring(i.coords) for i in p.interiors if Polygon(i).area > 4]


def load(name):
    with open(os.path.join(RAW, name)) as f:
        return json.load(f)["features"]


def h01(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


# ---------------------------------------------------------------- edificios
LANDMARKS = ("Sagrada Família", "Casa Milà", "Casa Batlló", "Torre Glòries")
parts_by_building = {}
for f in load("building_parts.geojson"):
    b = f["properties"].get("building")
    if b: parts_by_building.setdefault(b, []).append(f)

buildings = []


def add_building(geom, props, name, fallback_seed, min_h=0.0):
    g = transform(proj, shape(geom))
    if not g.intersects(CLIP): return
    g = g.intersection(CLIP)
    h = props.get("height")
    lv = props.get("levels")
    if not h:
        h = lv * 3.3 + 1.5 if lv else 12 + 10 * h01(fallback_seed)  # Eixample típico: PB + 5-6 plantas
    mh = props.get("min_height") or (props.get("min_level") or 0) * 3.3 or min_h
    for p in polys(g):
        rr = poly_rings(p, 0.25)
        if rr: buildings.append({"h": round(h, 1), "m": round(mh, 1), "n": nid(name), "r": rr})


for f in load("buildings.geojson"):
    p = f["properties"]
    name = p.get("name")
    parts = parts_by_building.get(p.get("id"))
    if parts and name and any(k in name for k in LANDMARKS):
        # Monumento: usamos sus partes (torres, cúpulas) con alturas propias
        add_building(f["geometry"], {"height": 4}, name, p["id"])
        for pf in parts:
            pp = pf["properties"]
            if pp.get("height"): add_building(pf["geometry"], pp, name, p["id"])
        continue
    add_building(f["geometry"], p, name, p.get("id") or str(p.get("osm")))

# ------------------------------------------------------------------ calles
ROAD_W = {"motorway": 18, "trunk": 20, "primary": 15, "secondary": 11, "tertiary": 10, "residential": 8,
          "unclassified": 7, "living_street": 6, "service": 4.5, "pedestrian": 6, "footway": 2.5, "cycleway": 2,
          "path": 2, "steps": 2.5, "unknown": 5}
DRIVE = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "living_street", "service"}
roads = []
for f in load("roads.geojson"):
    p = f["properties"]
    c = p.get("class") or "unknown"
    if p["kind"] != "road" or p.get("tunnel") or c not in ROAD_W: continue
    if c == "service" and not p.get("name"): continue
    g = transform(proj, shape(f["geometry"]))
    if not g.intersects(CLIP.buffer(30)): continue
    g = g.intersection(CLIP.buffer(30))
    for l in lines(g):
        l = l.simplify(0.3)
        if l.length < 1: continue
        roads.append({"c": c, "w": ROAD_W[c], "o": 1 if p.get("oneway") else 0, "d": 1 if c in DRIVE else 0,
                      "n": nid(p.get("name")), "p": ring(l.coords) if False else [v for x, y in l.coords for v in (q(x), q(y))]})

# ------------------------------------------------------------------- áreas
AREA_KIND = {
    "park": "park", "garden": "garden", "grass": "grass", "village_green": "grass", "dog_park": "park",
    "flowerbed": "garden", "playground": "plaza", "pitch": "pitch", "plaza": "plaza", "pedestrian": "plaza",
    "water": "water", "pond": "water", "reflecting_pool": "water", "swimming_pool": "pool", "basin": "water",
    "sand": "sand", "beach": "sand", "heath": "garden", "scrub": "garden", "wood": "park", "forest": "park",
    "grassland": "grass", "meadow": "grass",
}
areas, trees = [], []
for f in load("areas.geojson"):
    p = f["properties"]
    g = transform(proj, shape(f["geometry"]))
    if not g.intersects(CLIP): continue
    if isinstance(g, Point):
        if p.get("class") == "tree": trees += [q(g.x), q(g.y)]
        continue
    k = AREA_KIND.get(p.get("class"))
    if not k: continue
    for poly in polys(g.intersection(CLIP)):
        rr = poly_rings(poly, 0.4)
        if rr: areas.append({"k": k, "r": rr})

ORDER = ["grass", "park", "garden", "plaza", "pitch", "sand", "water", "pool"]
areas.sort(key=lambda a: ORDER.index(a["k"]))
minx, miny, maxx, maxy = CLIP.bounds
out = {
    "zone": zone, "origin": [LON0, LAT0], "bounds": [round(minx), round(miny), round(maxx), round(maxy)],
    "attribution": "© OpenStreetMap contributors (ODbL), vía Overture Maps Foundation",
    "names": names, "buildings": buildings, "roads": roads, "areas": areas, "trees": trees,
}
path = os.path.join(ROOT, "public", "data", f"{zone}.json")
with open(path, "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
print(f"{path}: {os.path.getsize(path)/1e6:.1f} MB · {len(buildings)} edificios · {len(roads)} calles · "
      f"{len(areas)} áreas · {len(trees)//2} árboles · {len(names)} nombres · bounds {out['bounds']}")
