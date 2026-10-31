/** Bill-of-materials table helpers shared by the Assembly panel, the agent and CSV export:
 *  item numbers from the row tree and an RFC 4180 CSV with FreeCAD's BOM columns. */
import type { BOMRowProjection } from "../cad-assembly-bridge";

export interface BOMTableRow extends BOMRowProjection {
  /** "3" for a top-level row, "3.2" for the second child of row 3, and so on. */
  readonly item_number: string;
  /** Sorts "2" before "10" and keeps children under their parent. */
  readonly item_sort_key: string;
  readonly depth: number;
}

/** Numbers rows in source order: top-level rows 1..n, children 1.1, 1.2 under their parent. */
export function numberedBOMRows(rows: readonly BOMRowProjection[]): BOMTableRow[] {
  const byID = new Map(rows.map((row) => [row.row_id, row]));
  const numbers = new Map<string, string>();
  const counters = new Map<string | null, number>();
  const numberOf = (row: BOMRowProjection): string => {
    const known = numbers.get(row.row_id);
    if (known) return known;
    const parent = row.parent_row_id ? byID.get(row.parent_row_id) ?? null : null;
    const parentKey = parent?.row_id ?? null;
    const index = (counters.get(parentKey) ?? 0) + 1;
    counters.set(parentKey, index);
    const number = parent ? `${numberOf(parent)}.${index}` : String(index);
    numbers.set(row.row_id, number);
    return number;
  };
  return rows.map((row) => {
    const item_number = numberOf(row);
    const parts = item_number.split(".");
    return { ...row, item_number, item_sort_key: parts.map((part) => part.padStart(5, "0")).join("."), depth: parts.length - 1 };
  });
}

const FIXED_COLUMNS = ["Item", "Part number", "Name", "Description", "Quantity", "Material", "Unit mass (kg)", "Mass (kg)", "Source"] as const;

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** FreeCAD's auto columns plus every custom property key as its own column; a final total-mass row when known. */
export function bomCSV(rows: readonly BOMRowProjection[], totalMassKg: number | null = null): string {
  const numbered = numberedBOMRows(rows);
  const customKeys: string[] = [];
  for (const row of rows) for (const { key } of row.custom_properties) if (!customKeys.includes(key)) customKeys.push(key);
  const lines = [[...FIXED_COLUMNS, ...customKeys].map(cell).join(",")];
  for (const row of numbered) {
    const custom = customKeys.map((key) => row.custom_properties.find((item) => item.key === key)?.value ?? null);
    lines.push([row.item_number, row.part_number, row.name, row.description, row.quantity, row.material_name,
      row.unit_mass_kg, row.extended_mass_kg, row.source_label, ...custom].map(cell).join(","));
  }
  if (totalMassKg !== null) lines.push(["Total", "", "", "", "", "", "", totalMassKg, ""].map(cell).join(","));
  return lines.join("\r\n") + "\r\n";
}
