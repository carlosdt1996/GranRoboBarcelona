#!/usr/bin/env python3
"""Descarga los edificios del Catastro (INSPIRE, datos abiertos) de Barcelona y
guarda los de una zona en data/catastro/<zona>.json.gz.

Por cada edificio: año de construcción, uso y nº de viviendas.
Por cada parte del edificio: huella y nº de plantas sobre/bajo rasante
(así salen los áticos retranqueados y los patios de manzana).

Uso:  python3 tools/catastro_fetch.py [zona]
Requiere: pip install requests lxml pyproj
Fuente: © Dirección General del Catastro (licencia CC BY 4.0).
"""
import gzip, io, json, os, re, sys, tempfile, zipfile
from collections import Counter
import requests
from lxml import etree
from pyproj import Transformer

sys.path.insert(0, os.path.dirname(__file__))
from zones import ZONES  # noqa: E402

ZONE = sys.argv[1] if len(sys.argv) > 1 else "eixample"
MINLON, MINLAT, MAXLON, MAXLAT = ZONES[ZONE]
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "catastro", f"{ZONE}.json.gz")
HOSTS = ["https://www.catastro.hacienda.gob.es", "http://www.catastro.hacienda.gob.es",
         "https://www.catastro.minhap.es", "http://www.catastro.minhap.es"]
ATOM = "/INSPIRE/buildings/08/ES.SDGC.bu.atom_08.xml"
S = requests.Session()
S.headers["User-Agent"] = "GranRoboBarcelona/0.1 (map builder)"


def get(path_or_url, **kw):
    urls = [path_or_url] if path_or_url.startswith("http") else [h + path_or_url for h in HOSTS]
    if path_or_url.startswith("http"):
        tail = re.sub(r"^https?://[^/]+", "", path_or_url)
        urls += [h + tail for h in HOSTS]
    last = None
    for u in urls:
        try:
            r = S.get(u, timeout=600, **kw)
            r.raise_for_status()
            print(f"GET {u} -> {r.status_code}", flush=True)
            return r
        except Exception as e:  # probamos el siguiente espejo
            print(f"GET {u} falló: {e}", flush=True)
            last = e
    raise last


def local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def text_of(el, name):
    for e in el.iter():
        if local(e.tag) == name and e.text and e.text.strip():
            return e.text.strip()
    return None


def polygons(el):
    """Lista de polígonos [[anillo_ext, huecos...]] con coordenadas planas."""
    out = []
    for p in el.iter():
        if local(p.tag) not in ("Polygon", "PolygonPatch"):
            continue
        rings = []
        for part in p:
            if local(part.tag) not in ("exterior", "interior"):
                continue
            for pl in part.iter():
                if local(pl.tag) == "posList" and pl.text:
                    dim = int(pl.get("srsDimension") or 2)
                    v = [float(t) for t in pl.text.split()]
                    rings.append([c for i in range(0, len(v), dim) for c in v[i:i + 2]])
        if rings:
            out.append(rings)
    return out


def find_epsg(path, member):
    with zipfile.ZipFile(path) as z, z.open(member) as f:
        head = f.read(200000).decode("utf-8", "ignore")
    m = re.search(r'srsName="[^"]*?(\d{4,5})"', head)
    print("Cabecera de", member, ":\n", head[:2500], "\n...", flush=True)
    return int(m.group(1)) if m else 25831


def main():
    atom = get(ATOM).text
    links = re.findall(r'href="([^"]+\.zip)"', atom)
    bcn = [l for l in links if "08900" in l] or [l for l in links if "BARCELONA" in l.upper() and "/08019" in l]
    print("Enlaces de Barcelona:", bcn[:5], flush=True)
    if not bcn:
        print(atom[:3000])
        sys.exit("No encuentro el ZIP de Barcelona en el feed ATOM")
    tmp = os.path.join(tempfile.gettempdir(), "catastro_bcn.zip")
    if not os.path.exists(tmp):
        r = get(bcn[0], stream=True)
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    print("ZIP:", os.path.getsize(tmp) // 1e6, "MB", flush=True)
    with zipfile.ZipFile(tmp) as z:
        names = z.namelist()
        print("Contenido:", names, flush=True)
    bfile = next(n for n in names if n.lower().endswith("building.gml"))
    pfile = next(n for n in names if n.lower().endswith("buildingpart.gml"))

    epsg = find_epsg(tmp, bfile)
    print("EPSG:", epsg, flush=True)
    to_utm = Transformer.from_crs(4326, epsg, always_xy=True)
    to_ll = Transformer.from_crs(epsg, 4326, always_xy=True)
    xs, ys = zip(*[to_utm.transform(x, y) for x in (MINLON, MAXLON) for y in (MINLAT, MAXLAT)])
    bx0, bx1, by0, by1 = min(xs) - 50, max(xs) + 50, min(ys) - 50, max(ys) + 50

    def inside(rings):
        r = rings[0]
        return any(bx0 <= r[i] <= bx1 and by0 <= r[i + 1] <= by1 for i in range(0, len(r), 2))

    def ll(r):
        lon, lat = to_ll.transform(r[0::2], r[1::2])
        return [v for a, b in zip(lon, lat) for v in (round(a, 7), round(b, 7))]

    buildings, sample = {}, 0
    with zipfile.ZipFile(tmp) as z, z.open(bfile) as f:
        for _, el in etree.iterparse(f, events=("end",), tag="{*}Building", huge_tree=True):
            if sample < 2:
                print(etree.tostring(el, pretty_print=True).decode()[:4000], flush=True)
                sample += 1
            polys = polygons(el)
            if polys and inside(polys[0]):
                lid = text_of(el, "localId")
                end = text_of(el, "end") or text_of(el, "beginning") or ""
                m = re.match(r"(\d{4})", end)
                buildings[lid] = {
                    "y": int(m.group(1)) if m else None,
                    "u": text_of(el, "currentUse"),
                    "d": int(text_of(el, "numberOfDwellings") or 0),
                    "s": text_of(el, "conditionOfConstruction"),
                }
            el.clear()
            while el.getprevious() is not None:
                del el.getparent()[0]
    print("Edificios en la zona:", len(buildings), flush=True)

    parts, sample = [], 0
    with zipfile.ZipFile(tmp) as z, z.open(pfile) as f:
        for _, el in etree.iterparse(f, events=("end",), tag="{*}BuildingPart", huge_tree=True):
            if sample < 2:
                print(etree.tostring(el, pretty_print=True).decode()[:4000], flush=True)
                sample += 1
            lid = text_of(el, "localId") or ""
            bid = lid.split("_part")[0]
            if bid in buildings:
                above = int(text_of(el, "numberOfFloorsAboveGround") or 0)
                below = int(text_of(el, "numberOfFloorsBelowGround") or 0)
                for rings in polygons(el):
                    parts.append({"b": bid, "f": above, "u": below, "r": [ll(r) for r in rings]})
            el.clear()
            while el.getprevious() is not None:
                del el.getparent()[0]
    print("Partes en la zona:", len(parts), flush=True)
    print("Plantas:", sorted(Counter(p["f"] for p in parts).items()), flush=True)
    dec = Counter((b["y"] // 10 * 10) if b["y"] else None for b in buildings.values())
    print("Décadas:", sorted(dec.items(), key=lambda kv: (kv[0] is None, kv[0] or 0)), flush=True)
    print("Usos:", Counter(b["u"] for b in buildings.values()).most_common(8), flush=True)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with gzip.open(OUT, "wt", encoding="utf-8") as f:
        json.dump({"zone": ZONE, "epsg": epsg,
                   "attribution": "© Dirección General del Catastro (CC BY 4.0)",
                   "buildings": buildings, "parts": parts}, f, separators=(",", ":"))
    print(OUT, os.path.getsize(OUT) // 1000, "kB", flush=True)


if __name__ == "__main__":
    main()
