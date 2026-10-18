import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const scratch=mkdtempSync(join(tmpdir(),'aether-scifirobot-'));
try {
  const bundle=join(scratch,'author.mjs');
  await build({entryPoints:[join(here,'author.ts')],bundle:true,platform:'node',format:'esm',outfile:bundle});
  execFileSync(process.execPath,[bundle,join(here,'generated')],{stdio:'inherit'});
  execFileSync(process.env.AETHER_BUILD_PYTHON || 'python3',[join(here,'export.py'),...(process.argv[2]?[process.argv[2]]:[])],{stdio:'inherit'});
} finally { rmSync(scratch,{recursive:true,force:true}); }
