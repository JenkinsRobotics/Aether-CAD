import {unitChoice, type UnitPreferences} from "@aether/core/units";
import {documentUnits} from "../document-preferences";
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

export function renderPhysicalProperties(items: PhysicalProperties[], names: Map<string,string>, units: UnitPreferences = documentUnits()): HTMLElement {
  const result = document.createElement('div');
  const number = (value:number) => value !== 0 && Math.abs(value) < 0.0001
    ? value.toExponential(5) : Number(value.toPrecision(7)).toString();
  const length = unitChoice(units, 'length');
  const mass = unitChoice(units, 'mass');
  const millimetersPerUnit = length.factor * 1000;
  const vector = (values:number[], divisor=1) => values.map(value=>number(value/divisor)).join(', ');
  for (const item of items) {
    const heading = document.createElement('h4');
    heading.textContent = names.get(item.body_id) ?? item.body_id;
    const table = document.createElement('table');
    table.style.width = '100%';
    table.setAttribute('aria-label',`${heading.textContent} physical properties`);
    const rows: [string,string][] = [
      [`Volume (${length.unit}³)`,number(item.volume_mm3/millimetersPerUnit**3)],
      [`Surface area (${length.unit}²)`,number(item.area_mm2/millimetersPerUnit**2)],
      [`Center of mass (${length.unit})`,vector(item.center_mm,millimetersPerUnit)],
      [`Bounds X, Y, Z (${length.unit})`,vector(item.bounds_mm,millimetersPerUnit)],
    ];
    if (item.mass_kg !== undefined) rows.push([`Mass (${mass.unit})`,number(item.mass_kg/mass.factor)]);
    if (item.inertia_kg_m2) {
      const m=item.inertia_kg_m2;
      rows.push(['Ixx, Iyy, Izz (kg·m²)',vector([m[0][0],m[1][1],m[2][2]])],
        ['Ixy, Ixz, Iyz (kg·m²)',vector([m[0][1],m[0][2],m[1][2]])]);
    }
    for (const [label,value] of rows) {
      const row=table.insertRow();
      const header=document.createElement('th'); header.scope='row';header.textContent=label; header.style.textAlign='left'; header.style.verticalAlign='top';
      row.append(header);row.insertCell().textContent=value;
    }
    result.append(heading,table);
  }
  return result;
}
