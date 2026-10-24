import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
await build({ configFile: false, publicDir: false, ssr: { noExternal: true }, build: {
  ssr: 'src/automation/runner.ts', outDir: 'service/aether_cad_service/runtime', emptyOutDir: true, minify: false,
  // The kernel's Emscripten glue is CommonJS and reads __dirname; the bundle is an ES module.
  rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'runner.mjs', banner: "import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __dirname_of } from 'node:path'; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __dirname_of(__filename);" } },
} });
// The kernel the runner loads at startup, beside the bundle.
copyFileSync('aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm', 'service/aether_cad_service/runtime/replicad_single.wasm');
copyFileSync('aether-engine/node_modules/opencascade.js/dist/opencascade.full.wasm', 'service/aether_cad_service/runtime/opencascade.wasm');
execFileSync(process.env.AETHER_BUILD_PYTHON || 'python3', ['scripts/build-native-automation.py'], { stdio: 'inherit' });
