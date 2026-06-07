import path from "node:path";
import { defineConfig } from "vitest/config";

const wasmMultiThreadStub = path.resolve("src/shared/passes/wasm-multithread-stub.ts");
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve("src"),
      "#wasm-multi-thread": wasmMultiThreadStub
    }
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify("cesium")
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
