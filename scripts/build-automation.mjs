import { build } from 'vite';
import { execFileSync } from 'node:child_process';
await build({ configFile: false, publicDir: false, ssr: { noExternal: true }, build: {
  ssr: 'src/automation/runner.ts', outDir: 'service/aether_cad_service/runtime', emptyOutDir: true, minify: false,
  rollupOptions: { output: { entryFileNames: 'runner.mjs' } },
} });
execFileSync(process.env.AETHER_BUILD_PYTHON || 'python3', ['scripts/build-native-automation.py'], { stdio: 'inherit' });
