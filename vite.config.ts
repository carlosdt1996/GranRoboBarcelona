import { defineConfig } from 'vite';

// El estado del tráfico en directo del Ayuntamiento no admite peticiones desde otra web (CORS):
// el servidor de desarrollo hace de intermediario. Publicado sin servidor, el juego usa el perfil habitual.
const proxy = {
  '/bcn-transit': {
    target: 'https://www.bcn.cat',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/bcn-transit/, '/transit/dades'),
  },
};

// base relativa para poder publicar en GitHub Pages o cualquier subcarpeta
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 1000 }, server: { proxy }, preview: { proxy } });
