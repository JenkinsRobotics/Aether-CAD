import { describe, expect, it } from "vitest";
import { bomCSV, numberedBOMRows } from "./bom-table";
import type { BOMRowProjection } from "../cad-assembly-bridge";

const row = (over: Partial<BOMRowProjection> & { row_id: string }): BOMRowProjection => ({
  parent_row_id: null, part_definition_id: `part-${over.row_id}`, quantity: 1, part_number: null, name: over.row_id,
  description: null, material_name: null, unit_mass_kg: null, extended_mass_kg: null, source_label: null, custom_properties: [], ...over,
});

describe("BOM table", () => {
  it("numbers hierarchical rows under their parent even when children arrive out of order", () => {
    const numbered = numberedBOMRows([
      row({ row_id: "a" }), row({ row_id: "b" }),
      row({ row_id: "b2", parent_row_id: "b" }), row({ row_id: "a1", parent_row_id: "a" }), row({ row_id: "b2x", parent_row_id: "b2" }),
      row({ row_id: "orphan", parent_row_id: "missing" }),
    ]);
    expect(numbered.map((item) => [item.row_id, item.item_number, item.depth])).toEqual([
      ["a", "1", 0], ["b", "2", 0], ["b2", "2.1", 1], ["a1", "1.1", 1], ["b2x", "2.1.1", 2], ["orphan", "3", 0],
    ]);
    const keys = numbered.map((item) => item.item_sort_key).sort();
    expect(keys.indexOf(numbered[2].item_sort_key)).toBeLessThan(keys.indexOf(numbered[4].item_sort_key));
  });

  it("writes FreeCAD's auto columns, custom property columns, quoted cells and the total mass", () => {
    const csv = bomCSV([
      row({ row_id: "flat:bolt", part_number: "M8-25", name: 'Bolt, hex "A"', description: "Zinc\nplated", quantity: 4, material_name: "steel",
        unit_mass_kg: 0.02, extended_mass_kg: 0.08, source_label: "bolt.acpart", custom_properties: [{ key: "Vendor", value: "Acme, Inc" }] }),
      row({ row_id: "flat:plate", name: "Plate", quantity: 1, custom_properties: [{ key: "Finish", value: "anodised" }] }),
    ], 0.08);
    expect(csv.split("\r\n")).toEqual([
      "Item,Part number,Name,Description,Quantity,Material,Unit mass (kg),Mass (kg),Source,Vendor,Finish",
      '1,M8-25,"Bolt, hex ""A""","Zinc\nplated",4,steel,0.02,0.08,bolt.acpart,"Acme, Inc",',
      "2,,Plate,,1,,,,,,anodised",
      "Total,,,,,,,0.08,",
      "",
    ]);
    expect(bomCSV([]).trim()).toBe(["Item", "Part number", "Name", "Description", "Quantity", "Material", "Unit mass (kg)", "Mass (kg)", "Source"].join(","));
  });
});
