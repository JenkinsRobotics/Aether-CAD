import {build} from 'vite';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const kernelRequire=createRequire(new URL('../aether-engine/package.json',import.meta.url));
await build({configFile:false,publicDir:false,ssr:{noExternal:true},resolve:{alias:{replicad:kernelRequire.resolve('replicad')}},build:{
  ssr:'scripts/benchmarks/scoped-removal.ts',outDir:'build/kernel-scope-benchmark',emptyOutDir:true,minify:false,
  rollupOptions:{output:{inlineDynamicImports:true,entryFileNames:'profile.mjs',banner:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const __dirname=process.cwd();"}},
}});
const result=spawnSync(process.execPath,['build/kernel-scope-benchmark/profile.mjs'],{stdio:'inherit',env:process.env});
process.exitCode=result.status??1;
