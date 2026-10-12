#!/usr/bin/env python3
"""Tráfico real de Barcelona: tramos de la red viaria principal y su estado típico.

Descarga del Open Data BCN (Ajuntament de Barcelona, CC-BY 4.0):
  - transit_relacio_trams_format_long.csv: geometría de los ~530 tramos vigilados.
  - el CSV mensual más reciente del estado de esos tramos (cada 5 minutos).
Calcula, para cada tramo, el estado medio por tipo de día (laborable, sábado, festivo/domingo)
y hora, y lo guarda en public/data/bcn/traffic.json. El juego usa el dato en directo
(https://www.bcn.cat/transit/dades/dadestrams.dat) si puede y, si no, este perfil a la hora real.

Estados: 0 sin datos · 1 muy fluido · 2 fluido · 3 denso · 4 muy denso · 5 congestionado · 6 cortado

Uso: python3 tools/traffic_profile.py
"""
import csv, datetime as dt, io, json, math, os, sys
from collections import defaultdict
import requests

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "public", "data", "bcn", "traffic.json")
API = "https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show?id="
S = requests.Session()

world = json.load(open(os.path.join(ROOT, "public", "data", "bcn", "world.json"), encoding="utf-8"))
LON0, LAT0 = world["origin"]
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110574


def resources(pkg):
    return S.get(API + pkg, timeout=60).json()["result"]["resources"]


# ---------------------------------------------------------------- geometría
geo = next(r for r in resources("transit-relacio-trams") if r["name"].endswith("format_long.csv"))
rows = csv.DictReader(io.StringIO(S.get(geo["url"], timeout=120).content.decode("utf-8-sig")))
trams = defaultdict(list)
names = {}
for r in rows:
    t = int(r["Tram"])
    names[t] = r["Descripció"]
    trams[t].append((int(r["Tram_Components"]), float(r["Longitud"]), float(r["Latitud"])))
print(f"{len(trams)} tramos", file=sys.stderr)

# ------------------------------------------------- histórico: último mes publicado
months = [r for r in resources("trams") if r["name"].endswith("_TRAMS_TRAMS.csv") and r["name"][:4].isdigit()]
months.sort(key=lambda r: r["name"][:7] + ("%02d" % ["Gener", "Febrer", "Marc", "Abril", "Maig", "Juny", "Juliol", "Agost", "Setembre", "Octubre", "Novembre", "Desembre"].index(r["name"].split("_")[2])))
last = months[-2:]  # los dos últimos meses (el actual suele estar a medias)
print(f"histórico: {', '.join(m['name'] for m in last)}", file=sys.stderr)

FESTIUS = {(1, 1), (1, 6), (5, 1), (6, 24), (8, 15), (9, 11), (9, 24), (10, 12), (11, 1), (12, 6), (12, 8), (12, 25), (12, 26)}
acc = defaultdict(lambda: [0.0] * 72)
cnt = defaultdict(lambda: [0] * 72)
for r in (row for m in last for row in csv.DictReader(io.StringIO(S.get(m["url"], timeout=600).content.decode("utf-8-sig")))):
    st = int(r["estatActual"])
    if st == 0: continue
    d = dt.datetime.strptime(r["data"], "%Y%m%d%H%M%S")
    kind = 2 if d.weekday() == 6 or (d.month, d.day) in FESTIUS else 1 if d.weekday() == 5 else 0
    k = kind * 24 + d.hour
    t = int(r["idTram"])
    acc[t][k] += min(st, 5)
    cnt[t][k] += 1

out = []
for t, pts in sorted(trams.items()):
    pts.sort()
    line, px, py = [], 0, 0
    for _, lon, lat in pts:
        x, y = round((lon - LON0) * KX * 10), round((lat - LAT0) * KY * 10)
        line += [x - px, y - py]
        px, py = x, y
    # perfil: 72 valores (laborable, sábado, festivo × 24 h) en décimas de estado, -1 sin datos
    prof = [round(acc[t][k] / cnt[t][k] * 10) if cnt[t][k] else -1 for k in range(72)]
    out.append({"id": t, "n": names[t], "p": line, "h": prof})

json.dump({"source": "Open Data BCN · " + " + ".join(m["name"][:7] for m in last), "trams": out}, open(OUT, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
print(f"{OUT}: {os.path.getsize(OUT) / 1e3:.0f} kB", file=sys.stderr)
