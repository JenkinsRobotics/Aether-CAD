import type { PartDocument } from "./part-document";
import { setFeatureSuppressed } from "./feature-history";

/** Configurations (SolidCraft's `config.*`): a table whose columns are variables
 *  (their expressions) and features (suppressed or not), and whose rows are named
 *  sets of values. Activating a row writes its values into the document; the
 *  table remembers which row is active and whether the design still matches it. */
export type ConfigurationColumn = { kind: "param"; name: string } | { kind: "suppress"; featureId: string };
export interface ConfigurationRow { name: string; values: Record<string, string | boolean> }
export interface ConfigurationTable { columns: ConfigurationColumn[]; rows: ConfigurationRow[]; activeRow?: string }

export const configurationColumnKey = (column: ConfigurationColumn) => column.kind === "param" ? `param:${column.name}` : `suppress:${column.featureId}`;

/** The value the document holds today for a column. */
export function currentConfigurationValue(doc: PartDocument, column: ConfigurationColumn): string | boolean | undefined {
  if (column.kind === "param") return doc.variables?.find((v) => v.name === column.name)?.expression;
  return doc.features.find((f) => f.id === column.featureId)?.suppressed;
}
const table = (doc: PartDocument): ConfigurationTable => structuredClone(doc.configurations ?? { columns: [], rows: [] });

export function addConfigurationColumn(doc: PartDocument, column: ConfigurationColumn): PartDocument {
  const next = table(doc), key = configurationColumnKey(column);
  if (next.columns.some((c) => configurationColumnKey(c) === key)) throw new Error("That column is already in the table.");
  if (currentConfigurationValue(doc, column) === undefined) throw new Error(column.kind === "param" ? `No variable named ${column.name}.` : "That feature is not in the document.");
  next.columns.push(column);
  // Existing rows take the current value, so adding a column changes nothing yet.
  for (const row of next.rows) row.values[key] = currentConfigurationValue(doc, column)!;
  return { ...doc, configurations: next };
}
export function removeConfigurationColumn(doc: PartDocument, key: string): PartDocument {
  const next = table(doc);
  next.columns = next.columns.filter((c) => configurationColumnKey(c) !== key);
  for (const row of next.rows) delete row.values[key];
  return { ...doc, configurations: next };
}
/** A row from the document's current values (or copied from another row). */
export function addConfigurationRow(doc: PartDocument, name: string, from?: string): PartDocument {
  const next = table(doc);
  if (!name.trim()) throw new Error("A configuration needs a name.");
  if (next.rows.some((r) => r.name === name)) throw new Error(`A configuration named ${name} already exists.`);
  const source = from ? next.rows.find((r) => r.name === from) : undefined;
  if (from && !source) throw new Error(`No configuration named ${from}.`);
  const values: Record<string, string | boolean> = {};
  for (const column of next.columns) { const key = configurationColumnKey(column); values[key] = source ? source.values[key] : currentConfigurationValue(doc, column)!; }
  next.rows.push({ name, values });
  if (!next.activeRow && !source) next.activeRow = name;
  return { ...doc, configurations: next };
}
export function setConfigurationValue(doc: PartDocument, row: string, key: string, value: string | boolean): PartDocument {
  const next = table(doc), target = next.rows.find((r) => r.name === row);
  if (!target) throw new Error(`No configuration named ${row}.`);
  if (!next.columns.some((c) => configurationColumnKey(c) === key)) throw new Error("That column is not in the table.");
  target.values[key] = value;
  return { ...doc, configurations: next };
}
export function removeConfigurationRow(doc: PartDocument, name: string): PartDocument {
  const next = table(doc);
  next.rows = next.rows.filter((r) => r.name !== name);
  if (next.activeRow === name) delete next.activeRow;
  return { ...doc, configurations: next };
}
/** The document with a row's values written in: variable expressions and feature suppression. */
export function applyConfigurationRow(doc: PartDocument, name: string): PartDocument {
  const current = table(doc), row = current.rows.find((r) => r.name === name);
  if (!row) throw new Error(`No configuration named ${name}.`);
  let next: PartDocument = { ...doc, variables: doc.variables?.map((v) => ({ ...v })) };
  for (const column of current.columns) {
    const value = row.values[configurationColumnKey(column)];
    if (column.kind === "param") { const variable = next.variables?.find((v) => v.name === column.name); if (variable && typeof value === "string") variable.expression = value; }
    else if (typeof value === "boolean") { const feature = next.features.find((f) => f.id === column.featureId); if (feature && feature.suppressed !== value) next = setFeatureSuppressed(next, column.featureId, value); }
  }
  return { ...next, configurations: { ...current, activeRow: name } };
}
/** Does the design still hold the active row's values? */
export function configurationMatches(doc: PartDocument, name = doc.configurations?.activeRow): boolean {
  const current = doc.configurations, row = current?.rows.find((r) => r.name === name);
  if (!current || !row) return false;
  return current.columns.every((column) => currentConfigurationValue(doc, column) === row.values[configurationColumnKey(column)]);
}
export function validateConfigurations(value: unknown, doc: { features: { id: string }[]; variables?: { name: string }[] }): void {
  if (value === undefined) return;
  const t = value as ConfigurationTable;
  if (!t || typeof t !== "object" || !Array.isArray(t.columns) || !Array.isArray(t.rows)) throw new Error("Configurations must have columns and rows.");
  for (const c of t.columns) {
    if (c.kind === "param") { if (typeof c.name !== "string" || !doc.variables?.some((v) => v.name === c.name)) throw new Error(`Configuration column names an unknown variable.`); }
    else if (c.kind === "suppress") { if (typeof c.featureId !== "string" || !doc.features.some((f) => f.id === c.featureId)) throw new Error("Configuration column names an unknown feature."); }
    else throw new Error("Configuration columns are parameters or suppressions.");
  }
  const names = new Set<string>();
  for (const r of t.rows) { if (typeof r.name !== "string" || !r.name.trim() || names.has(r.name) || typeof r.values !== "object") throw new Error("Configuration rows need distinct names and values."); names.add(r.name); }
  if (t.activeRow !== undefined && !names.has(t.activeRow)) throw new Error("The active configuration is not a row.");
}
