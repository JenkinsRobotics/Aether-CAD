import { unitChoice, type UnitPreferences } from "@aether/core/units";
import { documentUnits } from "../app/document-preferences";

/** Presentation of the native exact-shape properties; no client geometry math. */
export interface PhysicalProperties {
  body_id: string;
  volume_mm3: number;
  area_mm2: number;
  center_mm: number[];
  bounds_mm: number[];
  mass_kg?: number;
  inertia_kg_m2?: number[][];
}

export function renderPhysicalProperties(
  items: PhysicalProperties[],
  names: Map<string, string>,
  units: UnitPreferences = documentUnits(),
): HTMLElement {
  const result = document.createElement("div");
  result.style.display = "grid";
  result.style.gap = "8px";
  const formatNumber = (value: number) =>
    value !== 0 && Math.abs(value) < 0.0001
      ? value.toExponential(5)
      : Number(value.toPrecision(7)).toString();
  const length = unitChoice(units, "length");
  const mass = unitChoice(units, "mass");
  const millimetersPerUnit = length.factor * 1000;
  const vector = (values: number[], divisor = 1) =>
    values.map((value) => formatNumber(value / divisor)).join(", ");

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "cad-analysis-card";
    const heading = document.createElement("h4");
    heading.textContent = names.get(item.body_id) ?? item.body_id;
    const table = document.createElement("table");
    table.className = "cad-analysis-table";
    table.setAttribute("aria-label", `${heading.textContent} physical properties`);
    const rows: [string, string][] = [
      [`Volume (${length.unit}³)`, formatNumber(item.volume_mm3 / millimetersPerUnit ** 3)],
      [`Surface area (${length.unit}²)`, formatNumber(item.area_mm2 / millimetersPerUnit ** 2)],
      [`Center of mass (${length.unit})`, vector(item.center_mm, millimetersPerUnit)],
      [`Bounds X, Y, Z (${length.unit})`, vector(item.bounds_mm, millimetersPerUnit)],
    ];
    if (item.mass_kg !== undefined) {
      rows.push([`Mass (${mass.unit})`, formatNumber(item.mass_kg / mass.factor)]);
    }
    if (item.inertia_kg_m2) {
      const m = item.inertia_kg_m2;
      rows.push(
        ["Ixx, Iyy, Izz (kg·m²)", vector([m[0][0], m[1][1], m[2][2]])],
        ["Ixy, Ixz, Iyz (kg·m²)", vector([m[0][1], m[0][2], m[1][2]])],
      );
    }
    const tbody = table.createTBody();
    for (const [label, value] of rows) {
      const row = tbody.insertRow();
      const header = document.createElement("th");
      header.scope = "row";
      header.textContent = label;
      row.append(header);
      const cell = row.insertCell();
      cell.dataset.numeric = "true";
      cell.textContent = value;
    }
    card.append(heading, table);
    result.append(card);
  }
  return result;
}
