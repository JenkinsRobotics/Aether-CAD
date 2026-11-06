import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readAssemblyProjection } from './read-assembly-projection.mjs';
const selection = process.env.AETHER_EXAMPLE_MODELS?.split(',');
const out = resolve(process.env.AETHER_EXAMPLE_AUDIT_OUT ?? 'build/Example-Collection/' + (process.env.AETHER_EXAMPLES_FULL_HISTORY === '1' ? 'full-history-editability-audit' : selection ? 'new-editability-audit' : 'editability-audit'));
mkdirSync(out, { recursive: true });
const examples = JSON.parse(readFileSync('public/examples/catalog.json')).filter(e => !selection || selection.includes(e.id)).map(e => ({ id: e.id, ...readAssemblyProjection('public/examples/' + e.file, e.assemblyId) }));
writeFileSync(out + '/input.json', JSON.stringify(examples));
await build({ entryPoints: ['scripts/examples/collection/' + (process.env.AETHER_EXAMPLES_DRIVING_DIMENSIONS === '1' ? 'audit-dimensions-kernel.ts' : 'audit-editability-kernel.ts')], outfile: out + '/audit.mjs', bundle: true, platform: 'node', format: 'esm', nodePaths: [resolve('aether-engine/node_modules')], banner: { js: "import{createRequire as auditRequire}from'node:module';import{fileURLToPath as auditFileURL}from'node:url';import{dirname as auditDirname}from'node:path';const require=auditRequire(import.meta.url);const __filename=auditFileURL(import.meta.url),__dirname=auditDirname(__filename);" } });
// Exercise a persistent headless kernel as well as isolated-Part diagnosis.
if (process.env.AETHER_EXAMPLES_SINGLE_PROCESS === '1') {
  execFileSync(process.execPath, [out + '/audit.mjs', out], { stdio: 'inherit' });
  process.exit(0);
}
const results = process.env.AETHER_EXAMPLES_RESUME === '1' && existsSync(out + '/results.json') ? JSON.parse(readFileSync(out + '/results.json')) : [];
const timeout = Number(process.env.AETHER_EXAMPLE_AUDIT_TIMEOUT_MS ?? 600000);
if (!Number.isFinite(timeout) || timeout < 1000) throw Error('Audit timeout must be at least 1000 ms.');
for (const e of examples) for (const p of e.part_definitions) {
  if (results.some(result => result.example === e.id && result.part === p.name)) continue;
  // Bound native WASM lifetime to one Part; never let a failure poison later results.
  writeFileSync(out + '/input.json', JSON.stringify([{ ...e, part_definitions: [p] }]));
  rmSync(out + '/part-' + p.id + '.json', { force: true });
  rmSync(out + '/progress.json', { force: true });
  let failure;
  try { execFileSync(process.execPath, [out + '/audit.mjs', out, p.id], { stdio: 'inherit', timeout }); } catch (error) { failure = error; }
  const partFile = out + '/part-' + p.id + '.json';
  if (existsSync(partFile)) results.push(...JSON.parse(readFileSync(partFile)));
  else results.push({ example: e.id, partId: p.id, part: p.name, features: [], errors: [String(failure ?? 'Audit produced no result')],
    interruptedAt: existsSync(out + '/progress.json') ? JSON.parse(readFileSync(out + '/progress.json')) : undefined });
  writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
}
if (results.some(p => p.errors.length)) process.exitCode = 1;

