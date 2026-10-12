import { defineConfig } from 'vite';

// base relativa para poder publicar en GitHub Pages o cualquier subcarpeta
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 1000 } });
