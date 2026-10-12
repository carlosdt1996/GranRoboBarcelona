# Gran Robo Barcelona

Juego web/móvil de conducción con estética **OutRun** (cámara tras el coche, atardecer synthwave, pixel art) en una Barcelona reconstruida a partir de **OpenStreetMap**.
**Barcelona entera**: los 10 distritos, de Collserola al mar y del Besòs a la Zona Franca, con los ~160.000 volúmenes
de edificios reales de OSM (alturas por plantas del Catastro, patios de manzana, torres y cúpulas), el relieve real
(Montjuïc, el Tibidabo a 500 m) y el mar. La ciudad se carga por teselas alrededor del coche.

## Jugar en local

```bash
npm install
npm run dev          # http://localhost:5173
```

Para probar en el móvil en la misma red: `npm run dev -- --host` y abre la IP que muestra Vite (en horizontal).

**Controles**: ↑/↓ acelerar/frenar · ←/→ girar · Espacio derrape · R volver a la calzada · M mapa · N música.
En móvil: volante a la izquierda; GAS, FRENO, DRIFT y FUEGO a la derecha; botones MAPA y BAJAR. También funciona con mando.

**A pie, como en GTA**: F (o Enter) para bajar del coche o subir al que tengas al lado; si tiene conductor, lo
sacas y sale corriendo (taxis, furgonetas, autobuses: cada uno con su manejo). A pie: ↑↓ andar, ←→ girar,
Espacio/Shift correr, X o clic para disparar (con apuntado automático). La gente huye en pánico; los coches
tiroteados echan humo, arden y explotan, y las explosiones arrastran a lo que haya cerca. Mando: Y subir/bajar,
LB/RB disparar.

**Mapa (M)**: toda la ciudad con los distritos y tu posición. Rueda o +/− para el zoom, arrastra para moverte
y haz clic en cualquier punto para ir allí.

## Datos del mapa

`public/data/bcn/` ya viene generado. Para regenerarlo:

```bash
pip install pyarrow shapely requests numpy pillow
python3 tools/overture_fetch.py     # edificios, partes, calles, usos del suelo y límites (OSM vía Overture Maps)
python3 tools/terrain_fetch.py      # relieve (AWS Terrain Tiles)
python3 tools/build_city.py         # recorta al término municipal, proyecta a metros y trocea en teselas
```

Salida: `world.json` (calles circulables, nombres, límites, distritos), `terrain.bin` (alturas cada 16 m),
`map.png` (mapa de la tecla M) y `tiles/X_Y.json` (edificios, zonas verdes, caminos y árboles por teselas de 512 m).

### Fachadas reales (fotos de Mapillary)

Las fachadas que dan a la calle pueden llevar la foto real del edificio: `tools/build_facades.py` busca en
[Mapillary](https://www.mapillary.com) (fotos de calle libres, CC-BY-SA) las fotos que ven cada fachada de frente,
la proyecta con la pose de la cámara, combina varias vistas (la mediana borra coches y peatones; se prefieren
fotos de invierno, con los plátanos sin hojas) y la convierte en pixel art en un atlas por tesela.

1. Crea un *Client Token* gratuito en https://www.mapillary.com/dashboard/developers (permiso de lectura).
2. Guárdalo en `.env.local` (no se sube a git): `MAPILLARY_TOKEN=MLY|...`
3. `python3 tools/build_facades.py piloto` (zonas: `piloto`, `eixample`, `ciutat-vella`, `ciutat` o un bbox).

Hay que repetirlo después de cada `build_city.py`, que regenera las teselas.

## Estructura

- `src/render/` – cielo, suelo por trozos en Canvas (aceras de panot, pasos de cebra, chaflanes, sombras), edificios extruidos con fachadas pixel art, sprites de árboles y peatones, coches low-poly, post-proceso de baja resolución con tramado.
- `src/game/` – física arcade del coche, tráfico sobre el grafo de calles (respeta los sentidos únicos), peatones y cámara.
- `src/map.ts` – carga de teselas en streaming alrededor del jugador; `src/terrain.ts` – relieve.
- `src/roads.ts`, `src/collision.ts` – grafo viario y colisiones con fachadas y árboles (por teselas).
- `src/ui/` – HUD con radar y mapa de la ciudad.

Mapa © colaboradores de OpenStreetMap (ODbL), distribuido por Overture Maps Foundation. Relieve: AWS Terrain Tiles
(SRTM, EU-DEM y otras fuentes abiertas).
