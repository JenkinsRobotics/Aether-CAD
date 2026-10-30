import { buildConfigurations } from "./build-configurations.mjs";
import { compareReference } from "./compare-reference.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const model = (
  await import("./models/" + (process.env.AETHER_EXAMPLE || "wrench") + ".mjs")
).default;
const { parts, instances } = model;
const selectedParts = process.env.AETHER_EXAMPLE_BUILD_PARTS?.split(",");
const batchSize = Number(process.env.AETHER_EXAMPLE_BATCH_SIZE ?? 8);
assert.ok(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 8);
const root = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../build/Example-Collection",
    model.id,
  ),
  evidence = join(root, "evidence");
const { chromium } = createRequire(
  "/Users/jonathanjenkins/GITHUB/AetherStudio/core/files/package.json",
)("@playwright/test");
const origin = process.env.AETHER_TEST_ORIGIN;
assert.equal(new URL(origin).hostname, "127.0.0.1");
assert.notEqual(new URL(origin).port, "8780");
await mkdir(evidence, { recursive: true });
await mkdir(join(root, "parts"), { recursive: true });
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1800, height: 1150 } });
let received;
const callback = createServer((req, res) => {
  received = new URL(req.url, "http://localhost");
  res.end("Connected");
});
await new Promise((r) => callback.listen(0, "127.0.0.1", r));
const redirect = `http://127.0.0.1:${callback.address().port}/callback`,
  verifier = randomUUID() + randomUUID();
const json = async (r) => {
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data;
};
const post = (path, body, headers = {}) =>
  fetch(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const api = (action, data) =>
  page.evaluate(
    async ({ action, data }) => {
      const r = await fetch("/api/library/" + action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const v = await r.json();
      if (!r.ok) throw Error(JSON.stringify(v));
      return v;
    },
    { action, data: { app: "cad", ...data } },
  );
let mcp;
async function call(name, args, write = false) {
  const request = {
    name,
    arguments: args,
    ...(write ? { _meta: { "aether/operationId": randomUUID() } } : {}),
  };
  const response = await mcp("tools/call", request);
  await appendFile(
    join(evidence, "mcp-transcript.jsonl"),
    JSON.stringify({ time: new Date().toISOString(), request, response }) +
      "\n",
  );
  assert.ok(
    !response.error && !response.result?.isError,
    JSON.stringify(response),
  );
  return response.result.structuredContent;
}
const read = async (id) => {
  const file = await api("read", { id });
  return {
    file,
    doc: JSON.parse(Buffer.from(file.data_base64, "base64").toString()),
  };
};
try {
  const reg = await json(
    await post("/oauth/register", {
      client_name: "Built-in CAD examples",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }),
  );
  const params = new URLSearchParams({
    client_id: reg.client_id,
    redirect_uri: redirect,
    response_type: "code",
    resource: origin + "/mcp",
    state: "scifirobot-build",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  await page.goto(origin + "/oauth/authorize?" + params);
  await page.locator('input[name="username"]').fill("editor");
  await page
    .locator('input[name="password"]')
    .fill("account-test-password-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Connect to Aether", exact: true })
    .waitFor({ timeout: 45000 });
  await page.getByRole("checkbox", { name: "Aether CAD", exact: true }).check();
  await page.getByLabel("Permission", { exact: true }).selectOption("content");
  await page
    .getByRole("button", { name: "Allow connection", exact: true })
    .click();
  await page.waitForURL(redirect + "?**");
  const grant = await json(
    await fetch(origin + "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: reg.client_id,
        redirect_uri: redirect,
        resource: origin + "/mcp",
        code: received.searchParams.get("code"),
        code_verifier: verifier,
      }),
    }),
  );
  mcp = async (method, params) =>
    json(
      await post(
        "/mcp",
        { jsonrpc: "2.0", id: randomUUID(), method, params },
        {
          authorization: "Bearer " + grant.access_token,
          "mcp-protocol-version": "2025-11-25",
        },
      ),
    );
  await mcp("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "CAD examples author", version: "1" },
  });
  const catalog = (await mcp("tools/list", {})).result.tools;
  await writeFile(
    join(evidence, "mcp-catalog.json"),
    JSON.stringify(catalog, null, 2),
  );
  await page.goto(origin + "/?account=1");
  const docs = {},
    proofs = [];
  for (const p of parts) {
    if (selectedParts && !selectedParts.includes(p.key)) continue;
    const path = join(root, "parts", p.name + ".acpart"),
      fingerprint = createHash("sha256")
        .update(JSON.stringify(p))
        .digest("hex");
    try {
      const proof = JSON.parse(
        await readFile(join(evidence, p.key + ".json"), "utf8"),
      );
      if (proof.fingerprint === fingerprint) {
        docs[p.key] = JSON.parse(await readFile(path, "utf8"));
        proofs.push(proof);
        console.log("Retained:", p.name);
        continue;
      }
    } catch {}
    let empty = {
      format: "aether-part",
      formatVersion: 22,
      documentId: randomUUID(),
      name: p.name,
      units: "millimeter",
      features: [],
    };
    let localCandidate;
    if (process.env.AETHER_EXAMPLE_LOCAL_PARTS === "1") {
      localCandidate = JSON.parse(
        await readFile(join(root, "candidate-parts", p.key + ".json"), "utf8"),
      );
      assert.equal(
        localCandidate.fingerprint,
        fingerprint,
        "Local candidate must match this exact recipe",
      );
      empty = localCandidate.document;
    }
    const file = await api("create", {
      kind: "file",
      scope: "personal",
      operation_id: randomUUID(),
      name: p.name + ".acpart",
      data_base64: Buffer.from(JSON.stringify(empty)).toString("base64"),
    });
    let revision = file.revision,
      refs = {},
      offset = 0;
    const holeChecks = localCandidate?.holeChecks ?? [];
    while (!localCandidate && offset < p.steps.length) {
      // Verify material removal immediately around every real Hole Wizard feature.
      const hole = p.steps[offset].arguments.feature_json?.type === "hole";
      let end = Math.min(offset + batchSize, p.steps.length);
      if (hole) end = offset + 1;
      else {
        const next = p.steps.findIndex(
          (s, i) => i > offset && s.arguments.feature_json?.type === "hole",
        );
        if (next >= 0) end = Math.min(end, next);
      }
      const before = hole
        ? (
            await call("cad_part_verify", { app: "cad", id: file.id })
          ).result.measurements.reduce((v, b) => v + b.volume_mm3, 0)
        : null;
      const steps = p.steps.slice(offset, end),
        current = new Set(steps.map((s) => s.id));
      const resolve = (v) =>
        Array.isArray(v)
          ? v.map(resolve)
          : v && typeof v === "object"
            ? "$ref" in v && !current.has(v.$ref.split(".")[0])
              ? refs[v.$ref.split(".")[0]][v.$ref.split(".")[1]]
              : Object.fromEntries(
                  Object.entries(v).map(([k, x]) => [k, resolve(x)]),
                )
            : v;
      console.log("Building:", model.id, p.name, offset, end);
      const built = await call(
        "cad_part_runprogram",
        {
          app: "cad",
          id: file.id,
          expected_revision: revision,
          program_json: JSON.stringify({ version: 1, steps: resolve(steps) }),
        },
        true,
      );
      refs = { ...refs, ...built.result.references };
      revision = (await read(file.id)).file.revision;
      if (hole) {
        const after = (
          await call("cad_part_verify", { app: "cad", id: file.id })
        ).result.measurements.reduce((v, b) => v + b.volume_mm3, 0);
        assert.ok(
          after < before - 1e-5,
          `Hole ${p.name}/${steps[0].id} did not remove material`,
        );
        holeChecks.push({
          feature: steps[0].arguments.feature_json.name,
          before,
          after,
          removedMm3: before - after,
        });
      }
      offset = end;
    }
    const verified = (
        await call("cad_part_verify", { app: "cad", id: file.id })
      ).result,
      saved = await read(file.id);
    assert.equal(saved.doc.features.length, p.steps.length);
    assert.equal(
      verified.measurements.length,
      1,
      `${p.name} must be one solid`,
    );
    assert.ok(verified.measurements[0].volume_mm3 > 0);
    const { name: materialName, densityKgPerM3, ...appearance } = p.material;
    saved.doc.bodyProperties = {
      [verified.measurements[0].body_id]: {
        name: p.name,
        visible: true,
        description: p.description,
        material: { name: materialName, densityKgPerM3 },
        appearance,
      },
    };
    docs[p.key] = saved.doc;
    const proof = {
      key: p.key,
      name: p.name,
      fingerprint,
      features: p.steps.length,
      featureTypes: [...new Set(saved.doc.features.map((f) => f.type))],
      holeChecks,
      verification: verified,
      material: p.material,
    };
    proofs.push(proof);
    await writeFile(path, JSON.stringify(saved.doc, null, 2) + "\n");
    await writeFile(
      join(evidence, p.key + ".json"),
      JSON.stringify(proof, null, 2),
    );
    console.log(
      "Verified:",
      p.name,
      verified.measurements[0].volume_mm3,
      "mm3",
    );
  }
  if (selectedParts) {
    assert.equal(
      proofs.length,
      selectedParts.length,
      "Every requested Part must be verified",
    );
    console.log("Selected Parts verified:", selectedParts.join(", "));
  } else {
    const comparison = compareReference(model, proofs);
    if (comparison)
      await writeFile(
        join(evidence, "comparison.json"),
        JSON.stringify(comparison, null, 2),
      );
    const { file: final, configurations } = await buildConfigurations({
      model,
      docs,
      api,
      call,
      evidence,
    });
    const bytes = Buffer.from(final.data_base64, "base64");
    await writeFile(join(root, model.name + ".acad"), bytes);
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          id: model.id,
          name: model.name,
          description: model.description,
          parts: parts.length,
          instances: configurations.reduce((n, c) => n + c.instances, 0),
          mates: configurations.reduce((n, c) => n + c.mates, 0),
          configurations,
          features: parts.reduce((n, p) => n + p.steps.length, 0),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          transport:
            process.env.AETHER_EXAMPLE_LOCAL_PARTS === "1"
              ? "CAD validated program adapter; HTTP MCP verification/composition in isolated Studio account"
              : "HTTP MCP, isolated Studio account",
          proofs,
        },
        null,
        2,
      ),
    );
    const reopened = await api("create", {
      kind: "file",
      scope: "personal",
      operation_id: randomUUID(),
      name: model.name + ".acad",
      data_base64: final.data_base64,
    });
    await page.goto(
      origin +
        "/cad/index.html?document=" +
        reopened.id +
        "&assembly=" +
        configurations[0].id,
    );
    await page
      .getByRole("tree", { name: "CAD assembly components" })
      .waitFor({ timeout: 90000 });
    await page.waitForTimeout(9000);
    await page
      .locator(".cad-studio-view-tools")
      .getByRole("button", { name: "Fit view", exact: true })
      .click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(root, "reopened.png") });
    await writeFile(
      join(evidence, "reopened.txt"),
      await page.locator("body").innerText(),
    );
    await rm(join(evidence, "failure.txt"), { force: true });
    console.log(
      "COMPLETE",
      model.name,
      parts.length,
      "Parts",
      instances.length,
      "instances",
    );
  }
} catch (e) {
  await writeFile(join(evidence, "failure.txt"), String(e.stack));
  await page
    .screenshot({ path: join(evidence, "failure.png") })
    .catch(() => {});
  throw e;
} finally {
  await browser.close();
  callback.close();
}
