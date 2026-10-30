// Author candidate Parts through the same validated program adapter as UI/MCP.
// The HTTP builder must still verify them before composing a distributable file.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const model = (
  await import(`./models/${process.env.AETHER_EXAMPLE ?? "scifirobot"}.mjs`)
).default;
const out = resolve(
  root,
  "build/Example-Collection",
  model.id,
  "candidate-parts",
);
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "recipe.json"), JSON.stringify(model.parts));
await build({
  entryPoints: [
    resolve(root, "scripts/examples/collection/author-parts-kernel.ts"),
  ],
  outfile: resolve(out, "author.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  nodePaths: [resolve(root, "aether-engine/node_modules")],
  banner: {
    js: "import{createRequire}from'node:module';import{fileURLToPath}from'node:url';import{dirname}from'node:path';const require=createRequire(import.meta.url);const __filename=fileURLToPath(import.meta.url),__dirname=dirname(__filename);",
  },
});
execFileSync(process.execPath, [resolve(out, "author.mjs"), out], {
  cwd: root,
  stdio: "inherit",
});
