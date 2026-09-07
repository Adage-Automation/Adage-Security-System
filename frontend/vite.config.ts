import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Adage Security System',
        short_name: 'Adage Security',
        description: 'Employee entry/exit movement recording for Adage',
        theme_color: '#0d828b',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // App shell is cached for install/offline load; movement writes
        // are queued separately via the app's own IndexedDB sync layer
        // (see src/offline/), not through workbox background sync, so
        // the guard's "pending sync" state stays explicit and visible
        // (spec §52, decided deliberately).
        runtimeCaching: [
          {
            urlPattern: /\/api\/employees\/search/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
