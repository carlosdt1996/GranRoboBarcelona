# Gran Robo Barcelona

Parodia de GTA en pixel art con estética **OutRun** sobre una Barcelona reconstruida a partir de
**OpenStreetMap**: edificios reales, relieve real, hora real de Barcelona y tráfico real del Ayuntamiento.

Eres **Pau Rovira, «l'Egarenc»**, un chaval de Terrassa que llega en Rodalies a Sants para pagar una deuda de su
prima y acaba metido en los negocios de media ciudad. Humor negro y caricatura: todo es ficción.

## El mundo

- **Barcelona entera**: los 10 distritos, de Collserola al mar, con unos 160.000 volúmenes de edificios reales con
  sus alturas (Catastro vía OSM), relieve (Montjuïc, el Tibidabo), mar, parques y bosques. Se carga por teselas
  alrededor del jugador.
- **Hora real** de Barcelona: el sol está donde está ahora mismo; de noche, estrellas, farolas y ventanas encendidas.
- **Tráfico real**: estado de los tramos del Ayuntamiento (en directo con `npm run dev`; si no, el habitual a esa
  hora y ese día) → más coches y más lentos donde hay atasco.
- **GPS**: marca un destino en el mapa (M) y sigue las flechas pintadas en el asfalto.

## Lo que hay que tener un GTA

- **A pie y en coche**: robar coches (sacas al conductor), taxis, furgonetas, autobuses; helicópteros (H para pedir
  uno) con los que se puede aterrizar en las azoteas.
- **Armas**: puños, pistola, subfusil, escopeta, lanzacohetes y granadas. Rueda de armas (Tab), apuntado al estilo
  GTA V (clic derecho: fija el blanco más cercano; suelta y vuelve a pulsar para cambiar) con círculo opcional.
- **Policía con estrellas**: Guardia Urbana, Mossos, furgones antidisturbios y helicópteros, cada vez más medios.
  Te pueden detener. Los talleres **Pinta y Listo** te quitan las estrellas.
- **Muerte**: reapareces en la puerta del hospital más cercano (cinemática y factura); si te detienen, en la comisaría.
- **Economía**: dinero, armerías, chalecos, vida, dinero que sueltan los caídos y **20 paquetes ocultos**.
- **Interiores**: piso franco (el de la Tete en Sants: guarda la partida), locales de los jefes, armerías,
  hospitales y comisarías.
- **Historia**: 16 misiones cinemáticas (diálogos con tiros de cámara, presentación de objetivos) y más de cien
  personajes de toda Barcelona que te encuentras por la calle.
- **Radio** en los vehículos (V): Flash BCN (synthwave), Ràdio Rumba y Wave 93.
- **Trucos** de Vice City: THUGSTOOLS, ASPIRINE, PRECIOUSPROTECTION, LEAVEMEALONE, BIGBANG, PANZER...
- **Pausa** (Esc o ⚙): opciones, guardar y estadísticas.

## Jugar en local

```bash
npm install
npm run dev          # http://localhost:5173
```

Para probar en el móvil en la misma red: `npm run dev -- --host` y abre la IP que muestra Vite (en horizontal).

Para que el mundo cargue en un segundo, usa la versión de producción (el servidor de desarrollo de Vite
puede ir lento sirviendo miles de teselas en Windows):

```bash
npm run build && npm run preview    # http://localhost:4173
```

| | Teclado | Mando |
|---|---|---|
| Conducir | ↑↓ acelerar/frenar · ←→ girar · Espacio derrape | RT/LT · stick · X |
| A pie | ↑↓ andar · ←→ girar · Espacio/Shift correr | |
| Subir/bajar, entrar en un local | F o Enter | Y |
| Disparar / apuntar | X o clic / clic derecho o Z | RB / LB |
| Armas | Tab (rueda) · rueda del ratón · 1-6 | |
| Helicóptero | ↑↓ avanzar · ←→ girar · Espacio subir · Shift bajar · H pedir uno | |
| Otros | M mapa · V radio · N música · R volver a la calzada · Esc pausa | |

En móvil: volante a la izquierda; GAS, FRENO, DRIFT y FUEGO a la derecha; botones MAPA, BAJAR, ⚙ y el icono del arma.

## Datos del mapa

`public/data/bcn/` ya viene generado. Para regenerarlo (solo Barcelona):

```bash
pip install pyarrow shapely requests numpy pillow
python3 tools/overture_fetch.py     # edificios, partes, calles, usos del suelo y límites (OSM vía Overture Maps)
python3 tools/terrain_fetch.py      # relieve (AWS Terrain Tiles)
python3 tools/build_city.py         # recorta al término municipal, proyecta a metros y trocea en teselas
python3 tools/traffic_profile.py    # tramos de tráfico y su estado habitual (Open Data BCN)
```

Salida (comprimida con gzip; el navegador la descomprime): `world.json.gz` (calles circulables, nombres, límites,
distritos y municipios), `terrain.bin.gz` (alturas cada 16 o 32 m),
`map.png` (mapa de la tecla M) y `tiles/X_Y.json.gz` (edificios, zonas verdes, caminos y árboles por teselas de 512 m).

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

Mapa © colaboradores de OpenStreetMap (ODbL), distribuido por Overture Maps Foundation. Tráfico: Open Data BCN,
Ajuntament de Barcelona (CC-BY 4.0). Relieve: AWS Terrain Tiles
(SRTM, EU-DEM y otras fuentes abiertas).
