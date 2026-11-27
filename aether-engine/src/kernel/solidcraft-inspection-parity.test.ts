import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "./node-kernel";
import { analyzePart } from "./analysis";
import { compareParameterVariants, runParameterSweep } from "./parameter-sweep";
import {
  PHYSICAL_MATERIAL_LIBRARY,
  assignBodyMaterial,
  validateMaterialCard,
  directionalElasticModulus,
  createEmptyPartDocument,
  updatePartDocumentVariables,
  renameVariable,
  safeDeleteVariable,
  addConfigurationColumn,
  addConfigurationRow,
  setConfigurationValue,
  applyConfigurationRow,
  updateConfigurationFromDesign,
  validatePartDocument,
} from "../document";

beforeAll(async () => {
  await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)));
}, 60_000);

describe("SolidCraft 0.47 inspection, materials, parameters, and configurations parity", () => {
  it("computes automatic material mass, filtered properties, combined center of mass, exact point classification, and clearance with closest points", () => {
    const doc = createEmptyPartDocument("MultiBodyInspect");
    const b1 = `${doc.documentId}:body-1`;
    const b2 = `${doc.documentId}:body-ex2`;
    doc.features.push(
      { id: "s1", type: "profile", name: "S1", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [10, 0], [10, 10], [0, 10]] } },
      { id: "ex1", type: "extrude", name: "Box1", profileFeatureId: "s1", distanceMillimeters: 10, operation: "new", suppressed: false },
      { id: "s2", type: "profile", name: "S2", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[20, 0], [30, 0], [30, 10], [20, 10]] } },
      { id: "ex2", type: "extrude", name: "Box2", profileFeatureId: "s2", distanceMillimeters: 10, operation: "new", bodyId: b2, suppressed: false },
    );
    // Assign Steel (7870 kg/m³) to Box1 and Aluminum (2700 kg/m³) to Box2.
    let matDoc = assignBodyMaterial(doc, b1, "steel-1018");
    matDoc = assignBodyMaterial(matDoc, b2, "aluminum-6061");

    // 1) Filtered properties (bodyIds fix!) + auto density lookup
    const onlyB1 = analyzePart(matDoc, { kind: "properties", bodyIds: [b1] });
    expect(onlyB1.measurements).toHaveLength(1);
    expect(onlyB1.measurements[0].material).toBe("Mild Steel 1018");
    expect(onlyB1.measurements[0].mass_kg).toBeCloseTo(1000 * 7870 * 1e-9, 8);

    // 2) Combined multi-body mass-weighted Center of Mass
    const com = analyzePart(matDoc, { kind: "center_of_mass" });
    const m1 = 7870, m2 = 2700;
    const expectedX = (m1 * 5 + m2 * 25) / (m1 + m2);
    expect((com.measurements[0].center_mm as number[])[0]).toBeCloseTo(expectedX, 4);
    expect(com.measurements[0].weighted_by).toBe("mass");
    expect(com.measurements[0].total_mass_kg).toBeCloseTo((m1 + m2) * 1000 * 1e-9, 8);

    // 3) Exact point classification (inside, on, outside)
    const cls = analyzePart(matDoc, {
      kind: "classify_points",
      points_mm: [[5, 5, 5], [10, 5, 5], [15, 5, 5]],
    });
    expect(cls.measurements.map((m) => m.classification)).toEqual(["inside", "on", "outside"]);

    // 4) Clearance with closest points & threshold
    const clr = analyzePart(matDoc, { kind: "clearance", bodyIds: [b1], againstBodyIds: [b2], clearance_mm: 15, nearest: 1 });
    expect(clr.measurements).toHaveLength(1);
    expect(clr.measurements[0].distance_mm).toBeCloseTo(10, 4);
    expect((clr.measurements[0].from_mm as number[])[0]).toBeCloseTo(10, 4);
    expect((clr.measurements[0].to_mm as number[])[0]).toBeCloseTo(20, 4);

    // 5) Material card validation & orthotropic directional Young's modulus
    const steelCard = PHYSICAL_MATERIAL_LIBRARY.find((m) => m.id === "steel-1018")!;
    const vReport = validateMaterialCard(steelCard);
    expect(vReport.valid).toBe(true);
    expect(vReport.derived?.shearModulusGPa).toBeCloseTo(205 / (2 * 1.29), 3);
    const oak = PHYSICAL_MATERIAL_LIBRARY.find((m) => m.id === "oak-wood")!;
    expect(directionalElasticModulus(oak, [1, 0, 0])).toBeCloseTo(12.3, 4);
    expect(directionalElasticModulus(oak, [0, 1, 0])).toBeCloseTo(1.1, 4);
  });

  it("drives 3D feature expressions, safely renames/deletes variables, sweeps parameters, and validates configurations", async () => {
    let doc = createEmptyPartDocument("ParametricBox");
    doc.variables = [
      { name: "depth", kind: "length", expression: "10 mm" },
      { name: "unused", kind: "length", expression: "5 mm" },
    ];
    doc.features.push(
      { id: "sk", type: "profile", name: "Base", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [10, 0], [10, 10], [0, 10]] } },
      { id: "ex", type: "extrude", name: "Block", profileFeatureId: "sk", distanceMillimeters: 20, operation: "new", suppressed: false, expressions: { distanceMillimeters: "#depth * 2" } } as never,
    );

    // Safe delete refuses referenced #depth, allows #unused
    expect(() => safeDeleteVariable(doc, "depth")).toThrow(/Cannot delete #depth/);
    doc = safeDeleteVariable(doc, "unused");
    expect(doc.variables?.map((v) => v.name)).toEqual(["depth"]);

    // Rename #depth -> #thickness updates feature expressions automatically
    doc = renameVariable(doc, "depth", "thickness");
    expect((doc.features[1] as unknown as { expressions?: Record<string, string> }).expressions?.distanceMillimeters).toBe("#thickness * 2");

    // Update variable to 15 mm => Extrude distance becomes 30 mm => volume 10*10*30 = 3000 mm^3
    doc = await updatePartDocumentVariables(doc, [{ name: "thickness", kind: "length", expression: "15 mm" }]);
    const props = analyzePart(doc, { kind: "properties" });
    expect(props.measurements[0].volume_mm3).toBeCloseTo(3000, 1);

    // Parameter sweep across 3 thicknesses (5, 10, 15 mm => volumes 1000, 2000, 3000 mm^3)
    const sweep = await runParameterSweep(doc, { parameter: "thickness", from: 5, to: 15, steps: 3, unit: "mm" });
    expect(sweep.passedCount).toBe(3);
    expect(sweep.steps.map((s) => Math.round(s.totalVolumeMm3 ?? 0))).toEqual([1000, 2000, 3000]);

    // Parameter variants comparison
    const cmp = await compareParameterVariants(doc, [
      { name: "Thin", values: { thickness: "5 mm" } },
      { name: "Tall", values: { thickness: "25 mm" } },
    ]);
    expect(cmp.variants[0].totalVolumeMm3).toBeCloseTo(1000, 1);
    expect(cmp.variants[1].volumeDeltaMm3).toBeCloseTo(2000, 1);

    // Configurations: material + param columns, update_from_design, validatePartDocument catches invalid configs
    const bodyId = `${doc.documentId}:body-1`;
    doc = assignBodyMaterial(doc, bodyId, "steel-1018");
    doc = addConfigurationColumn(doc, { kind: "param", name: "thickness" });
    doc = addConfigurationColumn(doc, { kind: "material", bodyId });
    doc = addConfigurationRow(doc, "Default");
    doc = addConfigurationRow(doc, "Light", "Default");
    doc = setConfigurationValue(doc, "Light", "param:thickness", "5 mm");
    doc = setConfigurationValue(doc, "Light", `material:${bodyId}`, "aluminum-6061");
    validatePartDocument(doc);
    const applied = applyConfigurationRow(doc, "Light");
    expect(applied.bodyProperties?.[bodyId]?.material?.name).toBe("Aluminum 6061-T6");
    const updatedRow = updateConfigurationFromDesign(applied, "Light");
    expect(updatedRow.configurations?.rows.find((r) => r.name === "Light")?.values[`material:${bodyId}`]).toBe("Aluminum 6061-T6");
  });
});
