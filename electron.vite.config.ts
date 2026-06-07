import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const wasmMultiThreadStub = path.resolve("src/shared/passes/wasm-multithread-stub.ts");
const nodeModuleBrowserStub = path.resolve("src/shared/passes/node-module-browser-stub.ts");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["electron", ...builtinModules]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    base: "./",
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
    plugins: [react(), tailwindcss()],
    build: {
      chunkSizeWarningLimit: 11000
    }
  }
});
