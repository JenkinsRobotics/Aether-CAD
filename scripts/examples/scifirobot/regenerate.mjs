import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const scratch=mkdtempSync(join(tmpdir(),'aether-scifirobot-'));
try {
  const banner="import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __dirname_of } from 'node:path'; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __dirname_of(__filename);";
  for (const [name,args] of [['author',[join(here,'generated')]],['export',process.argv[2]?[process.argv[2]]:[]]]) {
    const bundle=join(scratch,name+'.mjs');
    // The engine's Emscripten glue is CommonJS; the bundle is an ES module, hence the banner.
    await build({entryPoints:[join(here,name+'.ts')],bundle:true,platform:'node',format:'esm',outfile:bundle,banner:{js:banner},loader:{'.wasm':'file'}});
    execFileSync(process.execPath,[bundle,...args],{stdio:'inherit',env:{...process.env,AETHER_SCIFIROBOT_DIR:here}});
  }
} finally { rmSync(scratch,{recursive:true,force:true}); }
