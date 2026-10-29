import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Both configurations are ordinary saved assemblies sharing native Part IDs. */
export async function buildConfigurations({
  model,
  docs,
  api,
  call,
  evidence,
}) {
  let file = await api("project_create", {
    name: model.name,
    packaging: "assembly",
    scope: "personal",
    operation_id: crypto.randomUUID(),
  });
  const initial = await call("cad_assembly_inspect", {
    app: "cad",
    id: file.id,
    section: "parts",
  });
  const configurations = [];
  let partIDs;
  for (const [index, config] of [
    model,
    ...(model.alternates ?? []),
  ].entries()) {
    let assemblyID = initial.result.assembly_id;
    if (index) {
      file = await api("project_edit", {
        id: file.id,
        expected_revision: file.revision,
        operation_id: crypto.randomUUID(),
        operation: "add_assembly",
        name: config.name,
      });
      assemblyID = file.project.assemblies.find(
        (a) => a.name === config.name,
      ).id;
    }
    const recipe = config.recipe(docs);
    if (partIDs) {
      const used = new Set(recipe.instances.map((i) => i.part));
      recipe.parts = recipe.parts
        .filter((p) => used.has(p.key))
        .map((p) => ({ key: p.key, part_id: partIDs[p.key] }));
    }
    const snapshot = await api("read", { id: file.id });
    await writeFile(
      join(evidence, "configuration-" + index + "-input.json"),
      JSON.stringify({
        data_base64: snapshot.data_base64,
        assembly_id: assemblyID,
        recipe,
      }),
    );
    console.log(
      "Composing:",
      config.name,
      recipe.instances.length,
      "occurrences",
    );
    const composed = await call(
      "cad_assembly_compose",
      {
        app: "cad",
        id: file.id,
        expected_revision: file.revision,
        assembly_id: assemblyID,
        recipe_json: JSON.stringify(recipe),
      },
      true,
    );
    if (!partIDs) partIDs = composed.result.ids.parts;
    await writeFile(
      join(
        evidence,
        index ? "assembly-" + config.id + "-solve.json" : "assembly-solve.json",
      ),
      JSON.stringify(composed.result, null, 2),
    );
    const placed = [];
    for (let offset = 0; offset < recipe.instances.length; offset += 20) {
      placed.push(
        ...(
          await call("cad_assembly_inspect", {
            app: "cad",
            id: file.id,
            assembly_id: assemblyID,
            section: "instances",
            offset,
          })
        ).result.items,
      );
    }
    assert.equal(placed.length, recipe.instances.length);
    assert.equal(
      placed.filter((i) => i.grounded).length,
      1,
      "One fixed base per assembly",
    );
    for (const expected of recipe.instances) {
      const actual = placed.find((i) => i.name === expected.key);
      assert.ok(actual, expected.key);
      assert.ok(
        Math.max(
          ...actual.position_mm.map((x, k) =>
            Math.abs(x - expected.position_mm[k]),
          ),
        ) < 1e-4,
        expected.key + " placement",
      );
      assert.ok(
        Math.abs(
          Math.abs(
            actual.rotation_xyzw.reduce(
              (v, x, k) => v + x * expected.rotation_xyzw[k],
              0,
            ),
          ) - 1,
        ) < 1e-6,
        expected.key + " rotation",
      );
    }
    configurations.push({
      id: assemblyID,
      name: index ? config.name : (model.configurationName ?? "Main Assembly"),
      instances: placed.length,
      mates: recipe.mates.length,
      movable: recipe.mates.some((j) => j.kind !== "fastened"),
    });
    file = await api("read", { id: file.id });
  }
  const { project } = await api("project_read", { id: file.id });
  assert.equal(
    project.parts.length,
    model.parts.length,
    "Configurations must share Part definitions",
  );
  assert.equal(project.assemblies.length, configurations.length);
  return { file, configurations };
}
