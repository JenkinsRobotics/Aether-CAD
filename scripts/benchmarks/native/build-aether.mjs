import { build } from 'vite';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../aether-engine/package.json', import.meta.url));
const variant = process.env.BENCH_VARIANT ?? (process.env.BENCH_OBB === '1' ? 'obb' : 'runner');
// Benchmark-only edits at the OCCT boolean configuration: [anchor, replacement].
// no-simplify drops the per-boolean face unification, to measure its share.
const experiments = {
  runner: null,
  obb: ['op.SetTools(tools);', 'op.SetTools(tools); op.SetUseOBB(true);'],
  'no-history': ['op.SetTools(tools);', 'op.SetTools(tools); op.SetToFillHistory(false);'],
  'no-simplify': ['op.SimplifyResult(true, true, 1e-3);', ''],
};
if (!(variant in experiments)) throw new Error('Unknown benchmark variant');
const experiment = experiments[variant];
// BENCH_ENTRY=reopen-edit builds the reopen-then-edit runner instead.
const entry = process.env.BENCH_ENTRY ?? 'aether';
await build({plugins:experiment ? [{name:'benchmark-occt-variant',transform(code,id){if(id.endsWith('/kernel/booleans.ts')) { if (!code.includes(experiment[0])) throw new Error('Boolean instrumentation point changed'); return code.replace(experiment[0],experiment[1]); }}}] : [],configFile:false,publicDir:false,ssr:{noExternal:true},resolve:{alias:{replicad:require.resolve('replicad')}},build:{
  ssr:`scripts/benchmarks/native/${entry}.ts`,outDir:`build/native-comparison/${entry === 'aether' ? `aether-${variant}` : entry}`,emptyOutDir:true,minify:false,
  rollupOptions:{output:{inlineDynamicImports:true,entryFileNames:'run.mjs',banner:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const __dirname=process.cwd();"}},
}});
