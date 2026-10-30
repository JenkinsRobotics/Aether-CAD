import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { chromium, expect } = createRequire(
  fileURLToPath(
    new URL(
      "../../../../AetherStudio/core/files/package.json",
      import.meta.url,
    ),
  ),
)("@playwright/test");
const origin = process.env.AETHER_TEST_ORIGIN,
  evidence = process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname, "127.0.0.1");
assert.notEqual(new URL(origin).port, "8780");
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({
    viewport: { width: 1800, height: 1150 },
    acceptDownloads: true,
  }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(origin + "/cad/");
  await page.locator('input[name="username"]').fill("editor");
  await page
    .locator('input[name="password"]')
    .fill("account-test-password-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, {
    timeout: 30000,
  });
  await page.waitForLoadState("networkidle");
  const checks = [];
  const records = JSON.parse(
    await readFile(join(root, "public/examples/catalog.json"), "utf8"),
  );
  const cases =
    process.env.AETHER_EXAMPLES_GROUP === "space"
      ? records
          .filter((r) => ["space-shuttle", "artemis-sls"].includes(r.id))
          .flatMap((r) =>
            r.configurations
              .filter((c) => c.movable)
              .map((c) => ({ id: r.id, assembly: c.id })),
          )
      : ["roadster", "airplane", "wrench"].map((id) => ({ id }));
  for (const { id, assembly } of cases) {
    if (
      process.env.AETHER_EXAMPLE_MODELS &&
      !process.env.AETHER_EXAMPLE_MODELS.split(",").includes(id)
    )
      continue;
    await page.goto(
      origin +
        "/cad/index.html?editor=1&example=" +
        id +
        (assembly ? "&assembly=" + assembly : ""),
    );
    await page
      .getByRole("tree", { name: "CAD assembly components" })
      .waitFor({ timeout: 90000 });
    await page.waitForTimeout(3500);
    await page
      .getByRole("button", { name: "Motion study", exact: true })
      .click();
    const window = page.locator(".cad-motion-window");
    await expect(window).toBeVisible();
    await window.getByLabel("Steps", { exact: true }).fill("6");
    await window
      .getByLabel("End value", { exact: true })
      .fill(id === "wrench" ? "10" : "90");
    await window
      .getByRole("button", { name: "Run and play", exact: true })
      .click();
    await expect(page.getByText(/^Step 6 of 6/)).toBeVisible({
      timeout: 90000,
    });
    const downloadPromise = page.waitForEvent("download");
    await window
      .getByRole("button", { name: "Export CSV", exact: true })
      .click();
    const download = await downloadPromise,
      path = join(evidence, id + "-motion.csv");
    await download.saveAs(path);
    const rows = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((r) => r.split(","));
    assert.equal(rows.length, 8);
    assert.equal(Number(rows[1][1]), 0);
    assert.equal(Number(rows.at(-1)[1]), id === "wrench" ? 10 : 90);
    // The first occurrence is the grounded base in every packaged recipe.
    assert.deepEqual(rows[1].slice(2, 9), rows.at(-1).slice(2, 9));
    assert.notDeepEqual(
      rows[1].slice(9),
      rows.at(-1).slice(9),
      "Driven components must change pose",
    );
    await page.mouse.move(20, 20);
    await page.screenshot({ path: join(evidence, id + "-driven.png") });
    await window.getByRole("button", { name: "Close", exact: true }).click();
    await expect(window).toHaveCount(0);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(evidence, id + "-restored.png") });
    checks.push({
      id,
      frames: 7,
      groundedBaseUnchanged: true,
      componentMotion: true,
    });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(
    "Actual Motion study UI, grounded base, moving components and CSV passed.",
  );
} catch (e) {
  await page.screenshot({ path: join(evidence, "failure.png") });
  await writeFile(join(evidence, "failure.txt"), String(e.stack));
  throw e;
} finally {
  await browser.close();
}
