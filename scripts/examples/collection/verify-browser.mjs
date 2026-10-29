import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const records = JSON.parse(
  await readFile(join(root, "public/examples/catalog.json"), "utf8"),
);
const spaceIds = ["space-shuttle", "artemis-sls"];
const selected = records.filter((r) => {
  if (
    process.env.AETHER_EXAMPLE_MODELS &&
    !process.env.AETHER_EXAMPLE_MODELS.split(",").includes(r.id)
  )
    return false;
  const group = process.env.AETHER_EXAMPLES_GROUP;
  if (!group) return true;
  if (group === "space") return spaceIds.includes(r.id);
  return group === "reference"
    ? r.id.startsWith("reference-")
    : !r.id.startsWith("reference-") && !spaceIds.includes(r.id);
});
const thumbnailsOnly = process.env.AETHER_EXAMPLES_THUMBNAILS_ONLY === "1";
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
  page = await browser.newPage({ viewport: { width: 1800, height: 960 } });
const errors = [],
  writes = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/api/library/")) {
    const action = r.url().split("/").pop();
    if (
      ["create", "save", "project_part_save", "project_assembly_save"].includes(
        action,
      )
    )
      writes.push(action);
  }
});
const api = (action, data) =>
  page.evaluate(
    async ({ action, data }) => {
      const r = await fetch("/api/library/" + action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app: "cad", ...data }),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    },
    { action, data },
  );
const rendered = async () => {
  await page
    .getByRole("tree", { name: "CAD assembly components" })
    .waitFor({ timeout: 90000 });
  await page.waitForTimeout(3500);
  await page
    .locator(".cad-studio-view-tools")
    .getByRole("button", { name: "Fit view", exact: true })
    .click();
  await page.waitForTimeout(400);
};
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
  await page.goto(origin + "/cad/?examples=1");
  await expect(
    page.getByRole("heading", { name: "Examples", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cad-examples-grid article")).toHaveCount(
    records.length,
  );
  await page.getByRole("textbox", { name: "Search examples" }).fill("sweep");
  await expect(page.locator(".cad-examples-grid article")).toHaveCount(
    records.filter((r) => r.tags.join(" ").toLowerCase().includes("sweep"))
      .length,
  );
  await page.getByRole("textbox", { name: "Search examples" }).fill("");
  for (const example of selected) {
    console.log("Previewing " + example.name);
    const before = writes.length;
    await page
      .getByRole("link", { name: "Open " + example.name, exact: true })
      .click();
    await rendered();
    await expect(
      page.getByRole("complementary", { name: "Example file" }),
    ).toBeVisible();
    assert.equal(
      writes.length,
      before,
      "Preview must never create or save a personal file",
    );
    await page.screenshot({
      path: join(evidence, example.id + "-preview.png"),
    });
    // Capture the actual CAD viewport at a closer view for the built-in gallery.
    if (example.id === "artemis-sls") {
      await page.mouse.move(900, 450);
      for (let step = 0; step < 3; step++) await page.mouse.wheel(0, 150);
      await page.waitForTimeout(500);
    }
    await page.mouse.move(20, 20);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(root, "public/examples", example.thumbnail),
      clip: { x: 400, y: 130, width: 1000, height: 620 },
      style:
        ".cad-studio-camera-navigation,.view-cube,.aui-viewport-cube { visibility:hidden!important; }",
    });
    for (const configuration of example.configurations?.slice(1) ?? []) {
      await page
        .getByRole("combobox", { name: "Example assembly", exact: true })
        .selectOption(configuration.id);
      await page.waitForURL(
        (url) => url.searchParams.get("assembly") === configuration.id,
      );
      await rendered();
      if (example.id === "space-shuttle") {
        await page.screenshot({
          path: join(evidence, "shuttle-underside.png"),
        });
        await page.mouse.move(700, 450);
        await page.mouse.down({ button: "right" });
        await page.mouse.move(1100, 450, { steps: 25 });
        await page.mouse.up({ button: "right" });
        await page.waitForTimeout(800);
      }
      await page.screenshot({
        path: join(
          evidence,
          example.id + "-" + configuration.id + "-preview.png",
        ),
      });
      await page.screenshot({
        path: join(
          root,
          "public/examples",
          example.id + "-" + configuration.id + ".png",
        ),
        clip: { x: 400, y: 130, width: 1000, height: 620 },
        style:
          ".cad-studio-camera-navigation,.view-cube,.aui-viewport-cube {visibility:hidden!important;}",
      });
      assert.equal(
        writes.length,
        before,
        "Switching configurations must remain read only",
      );
    }
    const activeAssembly = new URL(page.url()).searchParams.get("assembly");
    if (thumbnailsOnly) {
      await page.goto(origin + "/cad/?examples=1");
      continue;
    }
    await page
      .getByRole("button", { name: "Save to My files", exact: true })
      .click();
    await page.waitForURL((url) => url.searchParams.has("document"), {
      timeout: 90000,
    });
    await rendered();
    assert.equal(
      writes.length,
      before + 1,
      "One explicit save must create exactly one independent copy",
    );
    assert.equal(
      new URL(page.url()).searchParams.get("assembly"),
      activeAssembly,
      "Save preserves the selected assembly",
    );
    const id = new URL(page.url()).searchParams.get("document");
    const file = await api("read", { id });
    assert.equal(file.scope, "personal");
    assert.equal(file.name, example.name + ".acad");
    const { project } = await api("project_read", { id });
    assert.equal(project.parts.length, example.parts);
    assert.equal(
      project.assemblies.length,
      example.configurations?.length ?? 1,
    );
    for (const part of project.parts) {
      assert.ok(part.document.features.length > 0);
      assert.ok(
        Object.values(part.document.bodyProperties).every(
          (p) => p.appearance?.color && p.material?.densityKgPerM3 > 0,
        ),
      );
    }
    await page.reload();
    await rendered();
    await page.screenshot({
      path: join(evidence, example.id + "-saved-reopened.png"),
    });
    await expect(
      page.getByRole("complementary", { name: "Example file" }),
    ).toHaveCount(0);
    for (const configuration of example.configurations ?? []) {
      await page.goto(
        origin +
          "/cad/index.html?document=" +
          id +
          "&assembly=" +
          configuration.id,
      );
      await rendered();
      await page.screenshot({
        path: join(
          evidence,
          example.id + "-" + configuration.id + "-saved.png",
        ),
      });
    }
    await page.goto(
      origin +
        "/cad/index.html?editor=1&example=" +
        example.id +
        "&part=" +
        project.parts[0].id,
    );
    await expect(
      page
        .getByRole("treeitem", {
          name: new RegExp(
            project.parts[0].document.features[0].name.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            ),
          ),
        })
        .first(),
    ).toBeVisible({ timeout: 90000 });
    assert.equal(
      writes.length,
      before + 1,
      "Browsing an embedded example Part must not autosave",
    );
    await page.goto(origin + "/cad/?examples=1");
  }
  assert.deepEqual(errors, []);
  for (const example of selected) {
    const thumbnail = page.getByRole("img", {
      name: example.name,
      exact: true,
    });
    await thumbnail.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        thumbnail.evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
  }
  await page.screenshot({ path: join(evidence, "examples-gallery.png") });
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      {
        models: selected.map((r) => r.id),
        previewCreatedNoFiles: true,
        saveCopies: thumbnailsOnly ? 0 : selected.length,
        nativePartsRetained: !thumbnailsOnly,
        savedReopen: !thumbnailsOnly,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Examples gallery, previews, copies and saved reopen passed.");
} catch (e) {
  await page
    .screenshot({ path: join(evidence, "failure.png") })
    .catch(() => {});
  await writeFile(
    join(evidence, "failure.txt"),
    String(e.stack) + "\n" + JSON.stringify(errors),
  );
  throw e;
} finally {
  await browser.close();
}
