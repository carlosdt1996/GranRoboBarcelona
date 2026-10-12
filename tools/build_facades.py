#!/usr/bin/env python3
"""Fachadas reales: proyecta fotos de calle de Mapillary (CC-BY-SA) sobre las fachadas de los
edificios y las convierte en texturas pixel art, empaquetadas en un atlas por tesela.

Para cada fachada que da a la calle (arista exterior de un edificio con una calle delante y sin
otro edificio en medio) se buscan las fotos que la ven de frente, se proyecta la fachada en cada
una con la pose calculada por Mapillary (OpenSfM), se rectifica y se combinan las mejores
(la mediana borra coches y peatones). Se prefieren fotos de invierno: los plátanos sin hojas.

Uso:  python3 tools/build_facades.py [zona | minlon minlat maxlon maxlat]
      zonas: piloto (Passeig de Gràcia), eixample, ciutat-vella, ciutat (todo; tarda mucho)
Requiere: MAPILLARY_TOKEN en el entorno o en .env.local, y haber ejecutado build_city.py.
Salida: public/data/bcn/facades/X_Y_P.webp y el campo "f" de cada tiles/X_Y.json.
"""
import concurrent.futures as cf
import io, json, math, os, sys, time
from collections import defaultdict
import numpy as np
import requests
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from shapely.strtree import STRtree
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
BCN = os.path.join(ROOT, "public", "data", "bcn")
CACHE = os.path.join(ROOT, "data", "raw", "mapillary")
ZONES = {
    "piloto": (2.1585, 41.3880, 2.1720, 41.3975),
    "eixample": (2.1400, 41.3780, 2.1900, 41.4080),
    "ciutat-vella": (2.1650, 41.3740, 2.1900, 41.3900),
    "ciutat": (2.050, 41.315, 2.230, 41.470),
}
PPM = 4            # píxeles por metro de la textura final (pixel art)
SUPER = 3          # supermuestreo al rectificar
MAX_VIEWS = 3      # fotos que se combinan por fachada
PAGE = 2048        # lado de cada página del atlas
PAD = 2

# ------------------------------------------------------------------ entrada
args = sys.argv[1:]
if len(args) >= 4: ZB = tuple(map(float, args[:4]))
else: ZB = ZONES[args[0] if args else "piloto"]


def token():
    t = os.environ.get("MAPILLARY_TOKEN")
    p = os.path.join(ROOT, ".env.local")
    if not t and os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if line.strip().startswith("MAPILLARY_TOKEN="): t = line.split("=", 1)[1].strip().strip('"\'')
    if not t: sys.exit("Falta MAPILLARY_TOKEN (en el entorno o en .env.local). Ver README.")
    return t


world = json.load(open(os.path.join(BCN, "world.json"), encoding="utf-8"))
LON0, LAT0 = world["origin"]
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110574
TILE = world["tile"]
tm = world["terrain"]
H = np.fromfile(os.path.join(BCN, "terrain.bin"), dtype="<i2").astype(np.float32).reshape(tm["ny"], tm["nx"]) / 10


def to_xy(lon, lat): return ((lon - LON0) * KX, (lat - LAT0) * KY)


def ground(x, y):
    """Misma interpolación por triángulos que src/terrain.ts."""
    fx, fy = (x - tm["x0"]) / tm["res"], (y - tm["y0"]) / tm["res"]
    i, j = int(math.floor(fx)), int(math.floor(fy))
    u, v = fx - i, fy - j
    n = lambda a, b: float(H[min(max(b, 0), tm["ny"] - 1), min(max(a, 0), tm["nx"] - 1)])
    h00, h11 = n(i, j), n(i + 1, j + 1)
    if u >= v: return h00 + (n(i + 1, j) - h00) * u + (h11 - n(i + 1, j)) * v
    return h00 + (n(i, j + 1) - h00) * v + (h11 - n(i, j + 1)) * u


x0, y0 = to_xy(ZB[0], ZB[1])
x1, y1 = to_xy(ZB[2], ZB[3])
ZONE = box(x0, y0, x1, y1)
print(f"zona {ZB} → {x1 - x0:.0f}×{y1 - y0:.0f} m", file=sys.stderr)


def dec(a, ox, oy):
    out, x, y = [], 0, 0
    for i in range(0, len(a), 2):
        x += a[i]; y += a[i + 1]
        out.append((ox + x / 10, oy + y / 10))
    return out


# ------------------------------------------------------- edificios y calles
tiles = {}
for tx in range(math.floor((x0 - 60) / TILE), math.floor((x1 + 60) / TILE) + 1):
    for ty in range(math.floor((y0 - 60) / TILE), math.floor((y1 + 60) / TILE) + 1):
        p = os.path.join(BCN, "tiles", f"{tx}_{ty}.json")
        if os.path.exists(p): tiles[(tx, ty)] = json.load(open(p, encoding="utf-8"))

polys, owner = [], []  # huellas a ras de suelo (para oclusiones y para saber qué hay delante)
for (tx, ty), t in tiles.items():
    for bi, b in enumerate(t["b"]):
        if b["m"] >= 2.5: continue
        ring = dec(b["r"][0], tx * TILE, ty * TILE)
        if len(ring) < 3: continue
        polys.append(Polygon(ring).buffer(0)); owner.append((tx, ty, bi))
tree = STRtree(polys)

roads = []
for r in world["roads"]:
    pts = dec(r["p"], 0, 0)
    if len(pts) > 1: roads.append(LineString(pts))
road_tree = STRtree(roads)

# ------------------------------------------------------- fachadas a la calle
facades = []  # dict(tile, bi, ei, a, b, n, z0, z1)
for (tx, ty), t in tiles.items():
    for bi, b in enumerate(t["b"]):
        if b["m"] >= 2.5 or b["h"] < 4: continue
        ring = dec(b["r"][0], tx * TILE, ty * TILE)
        n_ = len(ring)
        for ei in range(n_):
            (ax, ay), (bx, by) = ring[ei], ring[(ei + 1) % n_]
            L = math.hypot(bx - ax, by - ay)
            if L < 2.5: continue
            mx, my = (ax + bx) / 2, (ay + by) / 2
            if not ZONE.contains(Point(mx, my)): continue
            nx, ny = (by - ay) / L, -(bx - ax) / L  # normal hacia fuera (anillo CCW)
            # ¿hay calle delante, a menos de 40 m, sin otro edificio en medio?
            ray = LineString([(mx + nx * 0.4, my + ny * 0.4), (mx + nx * 40, my + ny * 40)])
            hit = [roads[i] for i in road_tree.query(ray, predicate="intersects")]
            if not hit: continue
            d_road = min(ray.intersection(r).distance(Point(mx, my)) for r in hit)
            seg = LineString([(mx + nx * 0.4, my + ny * 0.4), (mx + nx * max(1, d_road), my + ny * max(1, d_road))])
            if any(polys[i].intersects(seg) for i in tree.query(seg)): continue
            z0 = min(ground(ax, ay), ground(bx, by), b["z"])
            facades.append({"tile": (tx, ty), "bi": bi, "ei": ei, "a": (ax, ay), "b": (bx, by), "n": (nx, ny),
                            "len": L, "z0": z0, "z1": b["z"] + b["h"]})
print(f"{len(facades)} fachadas a la calle", file=sys.stderr)

# ------------------------------------------------------- fotos de Mapillary
S = requests.Session()
TOKEN = token()
FIELDS = "id,computed_geometry,computed_rotation,computed_altitude,camera_type,camera_parameters,captured_at,is_pano,thumb_1024_url,thumb_2048_url,width,height,sequence"
os.makedirs(os.path.join(CACHE, "img"), exist_ok=True)


def get(url, params=None, tries=5):
    for k in range(tries):
        try:
            r = S.get(url, params=params, timeout=60)
            if r.status_code == 200: return r
            if r.status_code in (429, 500, 502, 503, 504): time.sleep(2 ** k); continue
            r.raise_for_status()
        except requests.RequestException:
            if k == tries - 1: raise
            time.sleep(2 ** k)
    raise RuntimeError(f"{url}: sin respuesta")


def search_cell(c):
    lo0, la0, lo1, la1 = c
    p = os.path.join(CACHE, f"meta_{lo0:.4f}_{la0:.4f}.json")
    if os.path.exists(p): return json.load(open(p))
    r = get("https://graph.mapillary.com/images", {"access_token": TOKEN, "fields": FIELDS, "bbox": f"{lo0},{la0},{lo1},{la1}", "limit": 2000})
    data = r.json().get("data", [])
    json.dump(data, open(p, "w"))
    return data


STEP = 0.0025  # celdas de búsqueda (la API devuelve como mucho 2000 fotos por consulta)
cells = [(lo, la, lo + STEP, la + STEP)
         for lo in np.arange(ZB[0] - 0.0005, ZB[2] + 0.0005, STEP) for la in np.arange(ZB[1] - 0.0005, ZB[3] + 0.0005, STEP)]
images = {}
with cf.ThreadPoolExecutor(8) as ex:
    for data in ex.map(search_cell, cells):
        for im in data:
            if im.get("computed_rotation") and im.get("computed_geometry"): images[im["id"]] = im
print(f"{len(images)} fotos con pose en la zona", file=sys.stderr)


def rot_matrix(v):
    """Vector eje-ángulo (Rodrigues) → matriz de rotación mundo→cámara."""
    v = np.asarray(v, float); th = np.linalg.norm(v)
    if th < 1e-12: return np.eye(3)
    k = v / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * K @ K


class Cam:
    def __init__(self, im):
        lon, lat = im["computed_geometry"]["coordinates"]
        self.id, self.im = im["id"], im
        self.x, self.y = to_xy(lon, lat)
        g = ground(self.x, self.y)
        alt = im.get("computed_altitude")
        # la altitud de Mapillary es ruidosa: si no cuadra con el terreno, cámara a 2 m del suelo
        self.z = alt if alt is not None and abs(alt - (g + 2)) < 6 else g + 2
        self.R = rot_matrix(im["computed_rotation"])
        self.type = "spherical" if im.get("is_pano") or im.get("camera_type") in ("spherical", "equirectangular") else im.get("camera_type") or "perspective"
        cp = im.get("camera_parameters") or [0.85, 0, 0]
        self.f, self.k1, self.k2 = (list(cp) + [0, 0])[:3]
        self.t = im.get("captured_at", 0) / 1000
        self.month = time.gmtime(self.t).tm_mon if self.t else 6
        self.w, self.h = im.get("width") or 4, im.get("height") or 3

    def project(self, P, W, Hh):
        """Puntos del mundo (N×3, x este, y norte, z arriba) → píxeles en una imagen de W×Hh; NaN si no se ve."""
        X = (P - np.array([self.x, self.y, self.z])) @ self.R.T
        x, y, z = X[:, 0], X[:, 1], X[:, 2]
        if self.type == "spherical":
            lon = np.arctan2(x, z)
            lat = np.arctan2(-y, np.hypot(x, z))
            return np.stack([W / 2 + lon / (2 * np.pi) * W, Hh / 2 - lat / (2 * np.pi) * W], 1)
        S_ = max(W, Hh)
        with np.errstate(divide="ignore", invalid="ignore"):
            xn, yn = x / z, y / z
            r2 = xn * xn + yn * yn
            if self.type == "fisheye":
                r = np.sqrt(r2); th = np.arctan(r)
                d = self.f * (1 + self.k1 * th ** 2 + self.k2 * th ** 4) * np.where(r > 1e-9, th / r, 1)
            else:
                d = self.f * (1 + self.k1 * r2 + self.k2 * r2 * r2)
        uv = np.stack([W / 2 + xn * d * S_, Hh / 2 + yn * d * S_], 1)
        uv[(z < 0.3) | ~np.isfinite(uv).all(1)] = np.nan
        return uv


cams = [Cam(im) for im in images.values()]
cam_xy = np.array([[c.x, c.y] for c in cams]) if cams else np.zeros((0, 2))
print(f"cámaras: {sum(c.type == 'spherical' for c in cams)} 360° · {sum(c.type == 'perspective' for c in cams)} normales · "
      f"{sum(c.type == 'fisheye' for c in cams)} ojo de pez", file=sys.stderr)


def facade_points(f, nu, nv):
    """Rejilla de puntos de la fachada: u a lo largo (a→b), v de abajo (z0) arriba (z1)."""
    (ax, ay), (bx, by) = f["a"], f["b"]
    u = (np.arange(nu) + 0.5) / nu
    v = (np.arange(nv) + 0.5) / nv
    U, V = np.meshgrid(u, v)
    return np.stack([ax + (bx - ax) * U, ay + (by - ay) * U, f["z0"] + (f["z1"] - f["z0"]) * V], -1).reshape(-1, 3)


def occluded(c, f):
    """¿Hay otro edificio entre la cámara y la fachada?"""
    (ax, ay), (bx, by) = f["a"], f["b"]
    nx, ny = f["n"]
    for s in (0.15, 0.5, 0.85):
        px, py = ax + (bx - ax) * s + nx * 0.3, ay + (by - ay) * s + ny * 0.3
        ln = LineString([(c.x, c.y), (px, py)])
        for i in tree.query(ln):
            if owner[i][:2] == f["tile"] and owner[i][2] == f["bi"]: continue
            if polys[i].intersects(ln): return True
    return False


def score(c, f):
    (ax, ay), (bx, by) = f["a"], f["b"]
    mx, my = (ax + bx) / 2, (ay + by) / 2
    dx, dy = c.x - mx, c.y - my
    d = math.hypot(dx, dy)
    if d < 4 or d > 55: return 0
    cos = (dx * f["n"][0] + dy * f["n"][1]) / d
    if cos < 0.4: return 0
    W, Hh = (2048, 1024) if c.type == "spherical" else (1024, round(1024 * c.h / c.w)) if c.w >= c.h else (round(1024 * c.w / c.h), 1024)
    uv = c.project(facade_points(f, 5, 5), W, Hh)
    ok = np.isfinite(uv).all(1) & (uv[:, 0] >= 0) & (uv[:, 0] < W) & (uv[:, 1] >= 0) & (uv[:, 1] < Hh)
    if ok.mean() < 0.96: return 0
    # resolución: píxeles de la foto por metro de fachada
    span = np.nanmax(uv[:, 0]) - np.nanmin(uv[:, 0])
    ppm = span / max(1.0, f["len"] * cos)
    if ppm < PPM * 1.2: return 0
    if occluded(c, f): return 0
    winter = 1.35 if c.month in (12, 1, 2, 3) else 1.0
    recent = 1 + 0.03 * max(0, (c.t - 1.45e9) / 3.15e7)  # un poco mejor cuanto más reciente
    return cos ** 1.5 * min(1, ppm / (PPM * 4)) * winter * recent / (1 + d / 35)


# --------------------------------------------- elegir fotos para cada fachada
choice = {}
for k, f in enumerate(facades):
    (ax, ay), (bx, by) = f["a"], f["b"]
    near = np.nonzero(np.hypot(cam_xy[:, 0] - (ax + bx) / 2, cam_xy[:, 1] - (ay + by) / 2) < 55)[0] if len(cams) else []
    sc = sorted(((score(cams[i], f), i) for i in near), reverse=True)
    sc = [(s, i) for s, i in sc if s > 0]
    # varias vistas parecidas; como mucho una por secuencia para que la mediana borre coches y gente
    pick, seqs = [], set()
    for s, i in sc:
        seq = cams[i].im.get("sequence")
        if seq in seqs or s < sc[0][0] * 0.6: continue
        pick.append(i); seqs.add(seq)
        if len(pick) == MAX_VIEWS: break
    if pick: choice[k] = pick
print(f"{len(choice)}/{len(facades)} fachadas con foto", file=sys.stderr)

# ------------------------------------------------------- descarga de fotos
need = sorted({i for v in choice.values() for i in v})


def fetch(i):
    c = cams[i]
    p = os.path.join(CACHE, "img", f"{c.id}.jpg")
    if not os.path.exists(p):
        url = c.im.get("thumb_2048_url" if c.type == "spherical" else "thumb_1024_url")
        if not url: return i, None
        data = get(url).content
        with open(p, "wb") as fh: fh.write(data)
    return i, p


paths = {}
with cf.ThreadPoolExecutor(12) as ex:
    for n, (i, p) in enumerate(ex.map(fetch, need)):
        if p: paths[i] = p
        if n % 200 == 0: print(f"  fotos {n}/{len(need)}", file=sys.stderr)

# ------------------------------------------------------- rectificar
img_cache = {}


def load_img(i):
    if i not in img_cache:
        if len(img_cache) > 64: img_cache.pop(next(iter(img_cache)))
        img_cache[i] = np.asarray(Image.open(paths[i]).convert("RGB"), np.float32)
    return img_cache[i]


def sample(img, uv):
    """Bilineal; NaN fuera."""
    Hh, W = img.shape[:2]
    out = np.full((len(uv), 3), np.nan, np.float32)
    ok = np.isfinite(uv).all(1) & (uv[:, 0] >= 0) & (uv[:, 0] < W - 1) & (uv[:, 1] >= 0) & (uv[:, 1] < Hh - 1)
    u, v = uv[ok, 0], uv[ok, 1]
    i0, j0 = u.astype(int), v.astype(int)
    fu, fv = (u - i0)[:, None], (v - j0)[:, None]
    out[ok] = (img[j0, i0] * (1 - fu) * (1 - fv) + img[j0, i0 + 1] * fu * (1 - fv) +
               img[j0 + 1, i0] * (1 - fu) * fv + img[j0 + 1, i0 + 1] * fu * fv)
    return out


def rectify(f, views):
    nu = max(2, round(f["len"] * PPM)); nv = max(2, round((f["z1"] - f["z0"]) * PPM))
    P = facade_points(f, nu * SUPER, nv * SUPER)
    stack = []
    for i in views:
        if i not in paths: continue
        img = load_img(i)
        stack.append(sample(img, cams[i].project(P, img.shape[1], img.shape[0])))
    if not stack: return None
    with np.errstate(all="ignore"):
        px = np.nanmedian(np.stack(stack), 0) if len(stack) > 1 else stack[0]
    px = np.nan_to_num(px, nan=float(np.nanmean(px)) if np.isfinite(px).any() else 128)
    im = Image.fromarray(px.reshape(nv * SUPER, nu * SUPER, 3).clip(0, 255).astype(np.uint8)[::-1])  # fila 0 = arriba
    im = im.resize((nu, nv), Image.BOX)
    # aspecto pixel art: menos colores y algo más de contraste
    a = np.asarray(im, np.float32)
    a = (a - a.mean((0, 1))) * 1.12 + a.mean((0, 1))
    im = Image.fromarray(a.clip(0, 255).astype(np.uint8)).quantize(24, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    return im


# ------------------------------------------------------- atlas por tesela
by_tile = defaultdict(list)
done = 0
for k, views in choice.items():
    im = rectify(facades[k], views)
    done += 1
    if done % 250 == 0: print(f"  rectificadas {done}/{len(choice)}", file=sys.stderr)
    if im is not None: by_tile[facades[k]["tile"]].append((k, im))

os.makedirs(os.path.join(BCN, "facades"), exist_ok=True)
total = 0
for key, t in tiles.items():
    items = by_tile.get(key, [])
    t["f"] = [r for r in t.get("f", []) if not ZONE.contains(Point(*r[8:10]))] if t.get("f") else []
    if not items and not t["f"]: t.pop("f", None)
    if not items: continue
    # estantes: de más alto a más bajo
    items.sort(key=lambda it: -it[1].height)
    pages, page, cx, cy, row = [], None, 0, 0, 0
    recs = []
    for k, im in items:
        w, h = im.width + PAD * 2, im.height + PAD * 2
        if w > PAGE or h > PAGE: continue
        if page is None or cx + w > PAGE:
            cx, cy, row = 0, cy + row, 0
        if page is None or cy + h > PAGE:
            page = Image.new("RGB", (PAGE, PAGE)); pages.append(page); cx = cy = row = 0
        # borde repetido para que los mipmaps no mezclen fachadas vecinas
        page.paste(im.resize((im.width + PAD * 2, im.height + PAD * 2), Image.NEAREST), (cx, cy))
        page.paste(im, (cx + PAD, cy + PAD))
        f = facades[k]
        mx, my = (f["a"][0] + f["b"][0]) / 2, (f["a"][1] + f["b"][1]) / 2
        # [edificio, arista, página, u, v, ancho, alto (px), z0 (dm), x, y del centro (para rehacer zonas)]
        recs.append([f["bi"], f["ei"], len(pages) - 1, cx + PAD, cy + PAD, im.width, im.height, round(f["z0"] * 10), round(mx, 1), round(my, 1)])
        cx += w; row = max(row, h)
    # las páginas anteriores de esta tesela (de otras zonas) se conservan: se numeran a continuación
    old = t.get("fp", 0) if t["f"] else 0
    for r in recs: r[2] += old
    tx, ty = key
    for pi, pg in enumerate(pages):
        # la última página se recorta a lo usado
        p = os.path.join(BCN, "facades", f"{tx}_{ty}_{pi + old}.webp")
        pg.save(p, "WEBP", quality=82, method=6)
        total += os.path.getsize(p)
    t["f"] = (t["f"] or []) + recs
    t["fp"] = old + len(pages)
    with open(os.path.join(BCN, "tiles", f"{tx}_{ty}.json"), "w", encoding="utf-8") as fh:
        json.dump(t, fh, separators=(",", ":"), ensure_ascii=False)

print(f"fachadas: {sum(len(v) for v in by_tile.values())} texturas · {total / 1e6:.1f} MB de atlas", file=sys.stderr)
