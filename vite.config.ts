import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    // The shared brain (@iany/core) is consumed as TS source by both this PWA
    // and the mobile app — one place for types, chunking, prompt, pack format.
    alias: { '@iany/core': path.resolve(root, 'packages/core/src/index.ts') },
  },
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
        // The installed app opens the app itself (/app), not the marketing
        // landing page at /.
        start_url: '/app',
        scope: '/',
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
        globIgnores: ['ort/**', '**/ort-wasm*', 'og-image.png'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        // The offline shell is the APP (app.html, served at /app) — that's the
        // installable PWA. The marketing landing page at / is a real precached
        // document, so navigations to / still resolve to it, not this fallback.
        navigateFallback: 'app.html',
        // Separate pages that must NOT be answered with the app shell: the
        // landing page (/) and the standalone /voice, /scan, /braille, /sign apps.
        navigateFallbackDenylist: [
          /^\/$/,
          /^\/index\.html$/,
          /^\/contribute(\/|\.html|$)/,
          /^\/voice(\/|\.html|$)/,
          /^\/scan(\/|\.html|$)/,
          /^\/braille(\/|\.html|$)/,
          /^\/sign(\/|\.html|$)/,
          /^\/trace(\/|\.html|$)/,
          /^\/crop(\/|\.html|$)/,
          /^\/health(\/|\.html|$)/,
          /^\/health-test(\/|\.html|$)/,
          /^\/water(\/|\.html|$)/,
          /^\/waste(\/|\.html|$)/,
          /^\/species(\/|\.html|$)/,
          /^\/report(\/|\.html|$)/,
          /^\/traffic(\/|\.html|$)/,
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'runtime-engines',
              expiration: { maxEntries: 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // MediaPipe hand model (the /sign collector). Cache it the first
            // time it's fetched — whether by the Models-screen pre-download or
            // by MediaPipe itself on /sign — so /sign works offline afterwards.
            urlPattern: ({ url }) =>
              /\/models\/sengtha\/mediapipe-hand\//.test(url.pathname) ||
              url.pathname.endsWith('hand_landmarker.task'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'runtime-hand-model',
              expiration: { maxEntries: 2 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          {
            // Radio loop music (.mp3) and the pdf.js worker (.mjs) are bundled
            // but not precached — cache them the first time they're used, so
            // installs stay lean but the features work offline afterward.
            urlPattern: ({ url }) => /\.(mp3|mjs)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'runtime-media',
              expiration: { maxEntries: 20 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
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
    rollupOptions: {
      // Two HTML entries: the iAny app (index.html) and the standalone Khmer
      // Voice collection page (voice.html, served at /voice).
      input: {
        main: path.resolve(root, 'index.html'), // landing / front page (/)
        app: path.resolve(root, 'app.html'), // the PWA app (/app)
        contribute: path.resolve(root, 'contribute.html'), // contribute + build (/contribute)
        voice: path.resolve(root, 'voice.html'),
        scan: path.resolve(root, 'scan.html'),
        braille: path.resolve(root, 'braille.html'),
        sign: path.resolve(root, 'sign.html'),
        trace: path.resolve(root, 'trace.html'),
        crop: path.resolve(root, 'crop.html'),
        health: path.resolve(root, 'health.html'),
        healthTest: path.resolve(root, 'health-test.html'),
        water: path.resolve(root, 'water.html'),
        waste: path.resolve(root, 'waste.html'),
        species: path.resolve(root, 'species.html'),
        report: path.resolve(root, 'report.html'),
        traffic: path.resolve(root, 'traffic.html'),
      },
    },
  },
})
