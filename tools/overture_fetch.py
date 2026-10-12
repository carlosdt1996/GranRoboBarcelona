#!/usr/bin/env python3
"""Descarga datos de Overture Maps (derivados de OpenStreetMap) para un bbox
y los guarda como GeoJSON normalizado en data/raw/.

Overture publica en S3 los datos de OSM (edificios, calles...) en GeoParquet,
ordenados espacialmente. Leemos solo los row groups que intersectan el bbox
mediante peticiones HTTP Range, sin descargar los ficheros completos.

Uso:  python3 tools/overture_fetch.py [minlon minlat maxlon maxlat]
Requiere: pip install pyarrow shapely requests
Alternativa 100% OSM: node tools/osm_fetch.mjs (Overpass API).
"""
import io, json, os, re, sys, concurrent.futures as cf
import requests
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import mapping, box

BASE = "https://overturemaps-us-west-2.s3.amazonaws.com"
RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-09-23.1")
BBOX = tuple(map(float, sys.argv[1:5])) if len(sys.argv) >= 5 else (2.140, 41.368, 2.200, 41.410)
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
S = requests.Session()


class HttpFile(io.RawIOBase):
    """Fichero de solo lectura sobre HTTP con peticiones Range (con caché de bloques)."""
    BLOCK = 1 << 20

    def __init__(self, url, size):
        self.url, self.size, self.pos, self.cache = url, size, 0, {}

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i):
        if i not in self.cache:
            a = i * self.BLOCK
            b = min(self.size, a + self.BLOCK) - 1
            r = S.get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=120)
            r.raise_for_status()
            self.cache[i] = r.content
        return self.cache[i]

    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        n = min(n, self.size - self.pos)
        out = bytearray()
        while n > 0:
            i, o = divmod(self.pos, self.BLOCK)
            chunk = self._block(i)[o:o + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


def list_files(prefix):
    files, token = [], None
    while True:
        url = f"{BASE}/?list-type=2&prefix=release/{RELEASE}/{prefix}" + (f"&continuation-token={requests.utils.quote(token)}" if token else "")
        x = S.get(url, timeout=60).text
        files += [(k, int(s)) for k, s in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", x)]
        m = re.search(r"<NextContinuationToken>([^<]+)<", x)
        if not m: return files
        token = m.group(1)


def rg_bbox(md, i, names):
    rg = md.row_group(i)
    st = {}
    for c in range(rg.num_columns):
        col = rg.column(c)
        p = col.path_in_schema
        if p in names and col.statistics is not None and col.statistics.has_min_max:
            st[p] = (col.statistics.min, col.statistics.max)
    return st


def scan(prefix, columns):
    files = [f for f in list_files(prefix) if f[0].endswith(".parquet")]
    names = {"bbox.xmin", "bbox.xmax", "bbox.ymin", "bbox.ymax"}
    minx, miny, maxx, maxy = BBOX

    def hits(f):
        key, size = f
        hf = HttpFile(f"{BASE}/{key}", size)
        pf = pq.ParquetFile(hf)
        md = pf.metadata
        groups = []
        for i in range(md.num_row_groups):
            s = rg_bbox(md, i, names)
            if len(s) < 4: continue
            if s["bbox.xmin"][0] <= maxx and s["bbox.xmax"][1] >= minx and s["bbox.ymin"][0] <= maxy and s["bbox.ymax"][1] >= miny:
                groups.append(i)
        return f, groups

    with cf.ThreadPoolExecutor(16) as ex:
        found = [r for r in ex.map(hits, files) if r[1]]
    rows = []
    q = box(*BBOX)
    for (key, size), groups in found:
        print(f"  {key.split('/')[-1][:12]}: {len(groups)} row groups", file=sys.stderr)
        pf = pq.ParquetFile(HttpFile(f"{BASE}/{key}", size))
        t = pf.read_row_groups(groups, columns=columns + ["bbox"]).to_pylist()
        for r in t:
            b = r["bbox"]
            if b["xmin"] > maxx or b["xmax"] < minx or b["ymin"] > maxy or b["ymax"] < miny: continue
            g = wkb.loads(r["geometry"])
            if not g.intersects(q): continue
            r["geometry"] = g
            rows.append(r)
    return rows


def first_name(r):
    n = r.get("names")
    return n.get("primary") if n else None


def osm_source(r):
    for s in r.get("sources") or []:
        if s.get("dataset") == "OpenStreetMap": return s.get("record_id")
    return None


def save(name, feats):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    with open(p, "w") as f:
        json.dump({"type": "FeatureCollection", "bbox": BBOX, "features": feats}, f, separators=(",", ":"))
    print(f"{p}: {len(feats)} features", file=sys.stderr)


def main():
    print(f"bbox={BBOX} release={RELEASE}", file=sys.stderr)

    print("Edificios...", file=sys.stderr)
    rows = scan("theme=buildings/type=building/", ["id", "has_parts", "geometry", "names", "height", "num_floors", "class", "subtype", "sources", "roof_shape", "facade_color", "roof_color"])
    save("buildings.geojson", [{
        "type": "Feature", "geometry": mapping(r["geometry"]),
        "properties": {"kind": "building", "name": first_name(r), "height": r.get("height"), "levels": r.get("num_floors"),
                        "class": r.get("class") or r.get("subtype"), "id": r["id"], "has_parts": r.get("has_parts"),
                        "osm": osm_source(r)}} for r in rows])

    print("Partes de edificios (torres, cúpulas...)...", file=sys.stderr)
    rows = scan("theme=buildings/type=building_part/", ["id", "geometry", "names", "height", "min_height", "num_floors", "min_floor", "building_id", "sources"])
    save("building_parts.geojson", [{
        "type": "Feature", "geometry": mapping(r["geometry"]),
        "properties": {"kind": "building_part", "name": first_name(r), "height": r.get("height"), "min_height": r.get("min_height"),
                        "levels": r.get("num_floors"), "min_level": r.get("min_floor"), "building": r.get("building_id")}} for r in rows])

    print("Calles...", file=sys.stderr)
    rows = scan("theme=transportation/type=segment/", ["id", "geometry", "names", "class", "subtype", "subclass", "access_restrictions", "road_flags", "width_rules", "sources"])
    feats = []
    for r in rows:
        if r.get("subtype") not in ("road", "rail"): continue
        oneway = False
        for a in r.get("access_restrictions") or []:
            when = a.get("when") or {}
            if a.get("access_type") == "denied" and when.get("heading") == "backward" and not when.get("mode") and not when.get("using") and not when.get("recognized") and not when.get("during") and not when.get("vehicle"):
                if not a.get("between"): oneway = True
        flags = set()
        for f in r.get("road_flags") or []:
            if not f.get("between"): flags |= set(f.get("values") or [])
        feats.append({"type": "Feature", "geometry": mapping(r["geometry"]), "properties": {
            "kind": r["subtype"], "class": r.get("class"), "subclass": r.get("subclass"), "name": first_name(r),
            "oneway": oneway, "bridge": "is_bridge" in flags, "tunnel": "is_tunnel" in flags, "osm": osm_source(r)}})
    save("roads.geojson", feats)

    print("Usos del suelo...", file=sys.stderr)
    rows = scan("theme=base/type=land_use/", ["id", "geometry", "names", "class", "subtype"])
    rows += scan("theme=base/type=water/", ["id", "geometry", "names", "class", "subtype"])
    rows += scan("theme=base/type=land/", ["id", "geometry", "names", "class", "subtype"])
    save("areas.geojson", [{"type": "Feature", "geometry": mapping(r["geometry"]), "properties": {
        "kind": "area", "class": r.get("class"), "subtype": r.get("subtype"), "name": first_name(r)}}
        for r in rows if r["geometry"].geom_type in ("Polygon", "MultiPolygon", "LineString", "MultiLineString", "Point")])


if __name__ == "__main__":
    main()
