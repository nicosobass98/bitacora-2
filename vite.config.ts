import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Rutas relativas por defecto, para poder servir el `dist/` desde cualquier
  // sitio. En GitHub Pages la app cuelga de /<repo>/, y el workflow pasa
  // `--base=/bitacora-2/` para que el service worker coja ese ámbito.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      workbox: {
        // La app es local-first: todo el shell se precachea y funciona sin red.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',
        // Sin `runtimeCaching`: las llamadas a Google no se cachean nunca. O hay
        // red y se envían, o se quedan en la cola outbox.
        runtimeCaching: [],
      },
      manifest: {
        name: 'Bitácora',
        short_name: 'Bitácora',
        description: 'Registro de jornadas, notas y búsqueda histórica.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // §8.2 — pendiente de verificar el soporte real en Android.
        shortcuts: [
          {
            name: 'Abrir jornada',
            short_name: 'Abrir',
            url: './#/jornada/abrir',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Nueva nota',
            short_name: 'Nota',
            url: './#/notas/nueva',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
    }),
  ],
});
