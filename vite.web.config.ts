import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const wasmMultiThreadStub = path.resolve("src/shared/passes/wasm-multithread-stub.ts");

export default defineConfig({
  root: path.resolve("src/renderer"),
  publicDir: path.resolve("public"),
  resolve: {
    alias: {
      "@": path.resolve("src"),
      "#wasm-multi-thread": wasmMultiThreadStub
    }
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify("cesium")
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve("dist-web"),
    emptyOutDir: true,
    target: "esnext"
  },
  server: {
    port: 5173
  }
});
