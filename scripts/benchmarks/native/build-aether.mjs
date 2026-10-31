import { build } from 'vite';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../aether-engine/package.json', import.meta.url));
const variant = process.env.BENCH_VARIANT ?? (process.env.BENCH_OBB === '1' ? 'obb' : 'runner');
if (!['runner','obb','no-history'].includes(variant)) throw new Error('Unknown benchmark variant');
const experiment = variant === 'obb' ? 'op.SetUseOBB(true);' : variant === 'no-history' ? 'op.SetToFillHistory(false);' : '';
await build({plugins:experiment ? [{name:'benchmark-occt-obb',transform(code,id){if(id.endsWith('/kernel/booleans.ts')) { if (!code.includes('op.SetTools(tools);')) throw new Error('Boolean instrumentation point changed'); return code.replace('op.SetTools(tools);',`op.SetTools(tools); ${experiment}`); }}}] : [],configFile:false,publicDir:false,ssr:{noExternal:true},resolve:{alias:{replicad:require.resolve('replicad')}},build:{
  ssr:'scripts/benchmarks/native/aether.ts',outDir:`build/native-comparison/aether-${variant}`,emptyOutDir:true,minify:false,
  rollupOptions:{output:{inlineDynamicImports:true,entryFileNames:'run.mjs',banner:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const __dirname=process.cwd();"}},
}});
