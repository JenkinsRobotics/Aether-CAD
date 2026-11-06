import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readAssemblyProjection } from './read-assembly-projection.mjs';
const selection = process.env.AETHER_EXAMPLE_MODELS?.split(',');
const out = resolve('build/Example-Collection/' + (selection ? 'new-editability-audit' : 'editability-audit'));
mkdirSync(out, { recursive: true });
const examples = JSON.parse(readFileSync('public/examples/catalog.json')).filter(e => !selection || selection.includes(e.id)).map(e => ({ id: e.id, ...readAssemblyProjection('public/examples/' + e.file, e.assemblyId) }));
writeFileSync(out + '/input.json', JSON.stringify(examples));
await build({ entryPoints: ['scripts/examples/collection/audit-editability-kernel.ts'], outfile: out + '/audit.mjs', bundle: true, platform: 'node', format: 'esm', nodePaths: [resolve('aether-engine/node_modules')], banner: { js: "import{createRequire as auditRequire}from'node:module';import{fileURLToPath as auditFileURL}from'node:url';import{dirname as auditDirname}from'node:path';const require=auditRequire(import.meta.url);const __filename=auditFileURL(import.meta.url),__dirname=auditDirname(__filename);" } });
// Exercise a persistent headless kernel as well as isolated-Part diagnosis.
if (process.env.AETHER_EXAMPLES_SINGLE_PROCESS === '1') {
  execFileSync(process.execPath, [out + '/audit.mjs', out], { stdio: 'inherit' });
  process.exit(0);
}
const results = [];
for (const e of examples) for (const p of e.part_definitions) {
  // Bound native WASM lifetime to one Part; never let a failure poison later results.
  writeFileSync(out + '/input.json', JSON.stringify([{ ...e, part_definitions: [p] }]));
  rmSync(out + '/part-' + p.id + '.json', { force: true });
  try { execFileSync(process.execPath, [out + '/audit.mjs', out, p.id], { stdio: 'inherit' }); } catch {}
  results.push(...JSON.parse(readFileSync(out + '/part-' + p.id + '.json')));
  writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
}
if (results.some(p => p.errors.length)) process.exitCode = 1;

