/// <reference types="vitest/config" />
import { env } from "node:process";
import { defineConfig } from "vite";
import { localCADTestRuntime } from "./scripts/test-window-runtime";

const studioServer = env.AETHER_DEV_SERVER || "http://localhost:8780";

export default defineConfig(({ mode }) => ({
  plugins: mode === "cad-test-window" ? [localCADTestRuntime()] : [],
  base: "./",
  build: {
    rollupOptions: {
      input: { app: 'index.html', gallery: 'gallery/index.html', 'test-window': 'gallery/test-window.html', 'create-document': 'src/create-document.ts', 'preview-document': 'src/preview-document.ts' },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: chunk => ['create-document', 'preview-document'].includes(chunk.name) ? `${chunk.name}.js` : 'assets/[name]-[hash].js' },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    exclude: ["replicad-opencascadejs", "harfbuzzjs"],
  },
  server: {
    host: "127.0.0.1", strictPort: true, port: 5173,
    fs: { allow: ["."] },
    proxy: {
      "/api": { target: studioServer, changeOrigin: true, headers: { Origin: studioServer } },
      "/icons": { target: studioServer, changeOrigin: true },
    },
  },
  worker: {
    format: "es",
  },
  test: { maxWorkers: 2, minWorkers: 1, server: { deps: { inline: [/@aether\//] } },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.test.jsx"],
  },
}));
