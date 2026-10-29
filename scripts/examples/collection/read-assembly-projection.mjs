import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function readAssemblyProjection(path, assemblyID) {
  const runner = fileURLToPath(
    new URL(
      "../../../service/aether_cad_service/runtime/runner.pyz",
      import.meta.url,
    ),
  );
  const request = {
    service: "/api/cad/assembly",
    arguments: {
      operation: "workspace",
      method: "describe_assembly",
      params: { handle: "example-motion-proof", assembly_id: assemblyID },
      data_base64: readFileSync(path).toString("base64"),
    },
  };
  const output = JSON.parse(
    execFileSync(
      process.env.AETHER_PYTHON ??
        "/Users/jonathanjenkins/GITHUB/AetherStudio/.venv/bin/python",
      ["-I", "-S", runner, process.execPath],
      {
        input: JSON.stringify(request),
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    ),
  );
  assert.ok(output.result?.ok, JSON.stringify(output));
  return output.result.result;
}
