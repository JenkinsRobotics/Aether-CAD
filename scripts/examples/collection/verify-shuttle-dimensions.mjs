// Check the native saved example, not authoring constants or display meshes.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readAssemblyProjection } from "./read-assembly-projection.mjs";
const root = process.cwd();
const folder = resolve(root, "build/Example-Collection/space-shuttle");
const report = JSON.parse(
  readFileSync(resolve(folder, "evidence/result.json")),
);
const archive = resolve(
  process.argv[2] ?? `${folder}/Space Shuttle — Launch and Orbiter.acad`,
);
const out = resolve(process.argv[3] ?? `${folder}/dimensions`);
mkdirSync(out, { recursive: true });
const graphs = report.configurations.map((c) =>
  readAssemblyProjection(archive, c.id),
);
writeFileSync(
  resolve(out, "source.json"),
  JSON.stringify({
    archive_sha256: createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex"),
    graphs,
  }),
);
await build({
  entryPoints: [
    resolve(
      root,
      "scripts/examples/collection/verify-shuttle-dimensions-kernel.ts",
    ),
  ],
  outfile: resolve(out, "check.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  nodePaths: [resolve(root, "aether-engine/node_modules")],
  banner: {
    js: "import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url'; import {dirname} from 'node:path'; const require=createRequire(import.meta.url); const __filename=fileURLToPath(import.meta.url); const __dirname=dirname(__filename);",
  },
});
execFileSync(process.execPath, [resolve(out, "check.mjs"), out], {
  stdio: "inherit",
});
