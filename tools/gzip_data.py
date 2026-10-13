#!/usr/bin/env python3
"""Comprime los datos generados (world.json, terrain.bin y las teselas) con gzip.

El juego los descomprime en el navegador (DecompressionStream), así pesan 3-5 veces menos
tanto en la descarga como en el repositorio. build_city.py ya lo llama al terminar.

Uso: python3 tools/gzip_data.py
"""
import glob, gzip, os, time

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "bcn")
before = after = 0
files = [os.path.join(OUT, "world.json"), os.path.join(OUT, "terrain.bin")] + glob.glob(os.path.join(OUT, "tiles", "*.json"))
for p in files:
    if not os.path.exists(p): continue
    raw = open(p, "rb").read()
    data = gzip.compress(raw, 9, mtime=0)
    for intento in range(10):  # en Windows el servidor o el antivirus pueden tenerlo abierto un momento
        try:
            with open(p + ".gz", "wb") as f:
                f.write(data)
            break
        except PermissionError:
            time.sleep(0.5)
    before += len(raw)
    after += os.path.getsize(p + ".gz")
    os.remove(p)
print(f"{len(files)} ficheros: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB")
