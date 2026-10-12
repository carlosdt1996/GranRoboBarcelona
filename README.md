# Gran Robo Barcelona

Juego web/móvil de conducción con estética **OutRun** (cámara tras el coche, atardecer synthwave, pixel art) en una Barcelona reconstruida a partir de **OpenStreetMap**.
Demo actual: **l'Eixample** (de Gran Via a Diagonal, de Tarragona a la Sagrada Família).

## Jugar en local

```bash
npm install
npm run dev          # http://localhost:5173
```

Para probar en el móvil en la misma red: `npm run dev -- --host` y abre la IP que muestra Vite (en horizontal).

**Controles**: ↑/↓ acelerar/frenar · ←/→ girar · Espacio derrape · R volver a la calzada · M música.
En móvil: volante a la izquierda; GAS, FRENO y DRIFT a la derecha. También funciona con mando.

## Datos del mapa

`public/data/eixample.json` ya viene generado. Para regenerarlo:

```bash
pip install pyarrow shapely requests
python3 tools/overture_fetch.py        # descarga edificios, calles, parques y árboles (datos OSM vía Overture Maps)
python3 tools/build_map.py eixample    # recorta, proyecta a metros y compacta
```

Las zonas se definen en `ZONES` dentro de `tools/build_map.py`.

## Estructura

- `src/render/` – cielo, suelo por trozos en Canvas (aceras de panot, pasos de cebra, chaflanes, sombras), edificios extruidos con fachadas pixel art, sprites de árboles y peatones, coches low-poly, post-proceso de baja resolución con tramado.
- `src/game/` – física arcade del coche, tráfico sobre el grafo de calles (respeta los sentidos únicos), peatones y cámara.
- `src/roads.ts`, `src/collision.ts` – grafo viario y colisiones con fachadas y árboles.

Mapa © colaboradores de OpenStreetMap (ODbL), distribuido por Overture Maps Foundation.
