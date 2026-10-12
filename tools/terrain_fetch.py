#!/usr/bin/env python3
"""Descarga el relieve (modelo digital de elevaciones) para un bbox y lo guarda en data/raw/terrain.npz.

Usa las teselas públicas "Terrarium" de AWS Open Data (elevation-tiles-prod), que combinan
SRTM, EU-DEM y otras fuentes abiertas. A zoom 14 cada píxel mide ~7 m en Barcelona (TERRAIN_Z=13 para regiones grandes).

Uso: python3 tools/terrain_fetch.py [minlon minlat maxlon maxlat]
Requiere: pip install pillow numpy requests
"""
import io, math, os, sys, concurrent.futures as cf
import numpy as np
import requests
from PIL import Image

Z = int(os.environ.get("TERRAIN_Z", "14"))  # 13 para regiones grandes (~14 m por píxel)
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
BBOX = tuple(map(float, sys.argv[1:5])) if len(sys.argv) >= 5 else (2.050, 41.315, 2.230, 41.470)
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw")


def tx(lon): return (lon + 180) / 360 * 2 ** Z


def ty(lat):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** Z


def main():
    minlon, minlat, maxlon, maxlat = BBOX
    x0, x1 = int(tx(minlon)), int(tx(maxlon))
    y0, y1 = int(ty(maxlat)), int(ty(minlat))
    S = requests.Session()

    def get(xy):
        x, y = xy
        r = S.get(URL.format(z=Z, x=x, y=y), timeout=60)
        r.raise_for_status()
        a = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), dtype=np.float32)
        return xy, a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768

    keys = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    print(f"{len(keys)} teselas z{Z}", file=sys.stderr)
    full = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), np.float32)
    with cf.ThreadPoolExecutor(12) as ex:
        for (x, y), a in ex.map(get, keys):
            full[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = a
    os.makedirs(OUT, exist_ok=True)
    # origen de la rejilla en coordenadas de tesela (esquina noroeste) para reproyectar después
    np.savez_compressed(os.path.join(OUT, "terrain.npz"), elev=full, z=Z, x0=x0, y0=y0)
    print(f"terrain.npz: {full.shape} min {full.min():.1f} max {full.max():.1f} m", file=sys.stderr)


if __name__ == "__main__":
    main()
