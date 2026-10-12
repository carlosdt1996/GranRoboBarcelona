/**
 * Alcance de la vista en metros. A ras de suelo la niebla tapa a ~560 m; en helicóptero crece
 * con la altitud y con él lo que se carga y se dibuja (teselas, edificios y suelo).
 */
export const view = { r: 760 };

/** Más allá de esto los edificios se dibujan simplificados (sin texturas, un lote por celda). */
export const LOD_R = 800;
