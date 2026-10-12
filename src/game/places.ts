import type { WeaponId } from './combat';

/** [nombre, lon, lat] */
export type Place = [string, number, number];

/** Donde reapareces al morir (con una pequeña cinemática). */
export const HOSPITALS: Place[] = [
  ['HOSPITAL CLÍNIC', 2.1527, 41.3897],
  ['HOSPITAL DE SANT PAU', 2.1745, 41.4126],
  ['HOSPITAL DE LA VALL D\'HEBRON', 2.1415, 41.4280],
  ['HOSPITAL DEL MAR', 2.1940, 41.3845],
  ['HOSPITAL DE BARCELONA', 2.1218, 41.3877],
  ['HOSPITAL DE L\'ESPERIT SANT', 2.2045, 41.4240],
];

/** Donde sales tras una detención. */
export const POLICE_STATIONS: Place[] = [
  ['COMISARIA DE CIUTAT VELLA', 2.1745, 41.3793],
  ['COMISARIA DE LES CORTS', 2.1337, 41.3842],
  ['COMISARIA DE SANT MARTÍ', 2.2012, 41.4035],
  ['COMISARIA DE NOU BARRIS', 2.1770, 41.4330],
  ['COMISARIA DE SANTS', 2.1395, 41.3760],
];

/** Armerías: se compran armas y chalecos. */
export const GUN_SHOPS: Place[] = [
  ['ARMERÍA DEL RAVAL', 2.1700, 41.3790],
  ['ARMERÍA DE SANTS', 2.1350, 41.3770],
  ['ARMERÍA DE SANT ANDREU', 2.1890, 41.4350],
];

/** Talleres de pintura: entras con el coche y sales sin estrellas, reparado y de otro color. */
export const PAINT_SHOPS: Place[] = [
  ['PINTA Y LISTO · POBLENOU', 2.1970, 41.4040],
  ['PINTA Y LISTO · SANTS', 2.1420, 41.3740],
  ['PINTA Y LISTO · SANT GERVASI', 2.1400, 41.4020],
  ['PINTA Y LISTO · HORTA', 2.1600, 41.4300],
];

/** Objetos fijos: armas, vida y chalecos (vuelven a aparecer al rato). */
export const ITEMS: [string, number, number, 'health' | 'armor' | WeaponId][] = [
  ['subfusil', 2.1690, 41.3800, 'smg'],
  ['escopeta', 2.1990, 41.4010, 'shotgun'],
  ['granadas', 2.1580, 41.4030, 'grenade'],
  ['lanzacohetes', 2.1665, 41.3640, 'rocket'],
  ['chaleco', 2.1890, 41.3800, 'armor'],
  ['chaleco', 2.1440, 41.4180, 'armor'],
  ...HOSPITALS.map(([n, lon, lat]) => [n, lon + 0.0004, lat, 'health'] as [string, number, number, 'health']),
];

/** Los 20 paquetes ocultos de Barcelona. */
export const PACKAGES: Place[] = [
  ['Park Güell', 2.1527, 41.4145], ['Bunkers del Carmel', 2.1619, 41.4192], ['Castell de Montjuïc', 2.1660, 41.3634],
  ['Platja de la Nova Icària', 2.2010, 41.3905], ['Arc de Triomf', 2.1806, 41.3910], ['Laberint d\'Horta', 2.1460, 41.4400],
  ['Camp Nou', 2.1228, 41.3809], ['Plaça d\'Espanya', 2.1490, 41.3751], ['Cementiri de Montjuïc', 2.1530, 41.3530],
  ['Cascada de la Ciutadella', 2.1867, 41.3894], ['Recinte de Sant Pau', 2.1752, 41.4120], ['Fòrum', 2.2210, 41.4105],
  ['Port Olímpic', 2.1990, 41.3860], ['Mirador de l\'Alcalde', 2.1700, 41.3680], ['Parc de l\'Oreneta', 2.1150, 41.4010],
  ['Tibidabo', 2.1190, 41.4215], ['Plaça Reial', 2.1755, 41.3801], ['Platja de Sant Sebastià', 2.1885, 41.3715],
  ['Parc del Clot', 2.1880, 41.4095], ['Parc Central de Nou Barris', 2.1770, 41.4380],
];

/** Donde empieza cada misión de la historia. */
export const MISSION_SPOTS: Place[] = [
  ['Plaça Reial', 2.1755, 41.3801],
  ['Francesc Macià', 2.1435, 41.3925],
  ['Plaça de Catalunya', 2.1712, 41.3866],
  ['Port Vell', 2.1820, 41.3770],
];
