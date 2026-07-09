import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  define: {
    // Shown in Settings so a device's running version is verifiable.
    __BUILD_ID__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    ),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-96.png'],
      manifest: {
        name: 'iAny — Offline AI Knowledge Base',
        short_name: 'iAny',
        description:
          'Feed AI from anything. Offline RAG that runs 100% on your device.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The app shell only. Model weights are cached by Transformers.js
        // itself (browser Cache API) and the database lives in IndexedDB,
        // so the service worker must not try to handle those.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm,data,gz}'],
        // The ONNX runtime variants live in /ort/ and are cached at runtime
        // instead: each device only ever needs the one matching its
        // capabilities (WebGPU vs CPU), so precaching all of them would
        // waste ~75 MB per install. Same for the Vite-bundled copy.
        globIgnores: ['ort/**', '**/ort-wasm*'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ort-runtime',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // PGlite ships its own WASM assets; pre-bundling breaks their resolution.
    exclude: ['@electric-sql/pglite'],
  },
  build: {
    target: 'es2022',
  },
})
