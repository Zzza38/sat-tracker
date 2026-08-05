import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const wasmMultiThreadStub = path.resolve("src/shared/passes/wasm-multithread-stub.ts");
const nodeModuleBrowserStub = path.resolve("src/shared/passes/node-module-browser-stub.ts");

export default defineConfig({
  root: path.resolve("src/renderer"),
  publicDir: path.resolve("public"),
  resolve: {
    alias: {
      "@": path.resolve("src"),
      "#wasm-multi-thread": wasmMultiThreadStub,
      "node:module": nodeModuleBrowserStub
    }
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify("cesium")
  },
  worker: {
    format: "es"
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "sat-tracker-icon.svg",
        "sat-tracker-icon.ico",
        "sat-tracker-icon-192.png",
        "sat-tracker-icon-512.png",
        "world-map-equirectangular.svg"
      ],
      manifest: {
        name: "Sat Tracker",
        short_name: "Sat Tracker",
        description: "All-in-one satellite tracker for the web and desktop.",
        theme_color: "#0c0d10",
        background_color: "#0c0d10",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "sat-tracker-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "sat-tracker-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "sat-tracker-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "sat-tracker-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg,woff2,json,wasm,webmanifest}"],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/cesium/"),
            handler: "CacheFirst",
            options: {
              cacheName: "cesium-assets",
              expiration: {
                maxEntries: 250,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/celestrak\.org\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "celestrak-cache",
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 48,
                maxAgeSeconds: 60 * 60 * 24 * 7
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: path.resolve("dist-web"),
    emptyOutDir: true,
    target: "esnext",
    chunkSizeWarningLimit: 5000
  },
  server: {
    port: 5173,
    allowedHosts: true
  }
});
