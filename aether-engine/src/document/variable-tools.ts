import type { PartDocument } from "./part-document";
import type { DocumentVariable } from "./variables";

/** Parameter tools (SolidCraft's parameters.*): who uses a variable, the dependency
 *  graph, ordering, comments and favourites, CSV/JSON exchange and completion. All
 *  pure over the document; expressions stay the saved truth. */
const referencePattern = (name: string) => new RegExp(`#${name}(?![A-Za-z0-9_])`);
const mentions = (text: string, name: string) => referencePattern(name).test(text);

/** Every reference a text carries, as variable names. */
export function referencedVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/#([A-Za-z_][A-Za-z0-9_]{0,63})/g)].map((m) => m[1]))];
}

export interface VariableUsers { parameters: string[]; features: { id: string; name: string }[] }
/** Variables and features whose expressions mention #name. Feature fields are scanned
 *  as text (dimensions, feature inputs and sketch expressions all live there). */
export function variableUsers(doc: PartDocument, name: string): VariableUsers {
  const parameters = (doc.variables ?? []).filter((v) => v.name !== name && mentions(v.expression, name)).map((v) => v.name);
  const features = doc.features.filter((f) => mentions(JSON.stringify(f), name)).map((f) => ({ id: f.id, name: f.name }));
  return { parameters, features };
}

export interface VariableGraph { nodes: string[]; edges: [string, string][]; cycles: string[][]; errors: string[] }
/** The graph of user parameters: edges from a user to what it uses, with features as
 *  `Feature:<name>` nodes, the cycles and the unknown references. */
export function variableGraph(doc: PartDocument): VariableGraph {
  const variables = doc.variables ?? [], names = new Set(variables.map((v) => v.name));
  const nodes = variables.map((v) => v.name), edges: [string, string][] = [], errors: string[] = [];
  for (const v of variables) for (const used of referencedVariables(v.expression)) { if (!names.has(used)) errors.push(`#${v.name} uses unknown #${used}`); else edges.push([v.name, used]); }
  for (const f of doc.features) {
    const used = referencedVariables(JSON.stringify(f)).filter((n) => names.has(n));
    if (used.length) { nodes.push(`Feature:${f.name}`); for (const u of used) edges.push([`Feature:${f.name}`, u]); }
  }
  const cycles: string[][] = [];
  const visiting = new Set<string>(), done = new Set<string>();
  const walk = (node: string, path: string[]) => {
    if (done.has(node)) return;
    if (visiting.has(node)) { const at = path.indexOf(node); cycles.push(path.slice(at)); return; }
    visiting.add(node);
    for (const [from, to] of edges) if (from === node) walk(to, [...path, node]);
    visiting.delete(node); done.add(node);
  };
  for (const name of names) walk(name, []);
  return { nodes, edges, cycles, errors };
}

export function setVariableComment(doc: PartDocument, name: string, comment: string): PartDocument {
  return updateVariable(doc, name, (v) => ({ ...v, ...(comment.trim() ? { comment: comment.trim() } : { comment: undefined }) }));
}
export function setVariableFavorite(doc: PartDocument, name: string, favorite = true): PartDocument {
  return updateVariable(doc, name, (v) => ({ ...v, ...(favorite ? { favorite: true } : { favorite: undefined }) }));
}
function updateVariable(doc: PartDocument, name: string, change: (v: DocumentVariable) => DocumentVariable): PartDocument {
  const variables = doc.variables ?? [];
  if (!variables.some((v) => v.name === name)) throw new Error(`No variable named #${name}.`);
  return { ...doc, variables: variables.map((v) => (v.name === name ? strip(change(v)) : v)) };
}
const strip = (v: DocumentVariable): DocumentVariable => Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined)) as DocumentVariable;

/** List #name just before or after another variable. */
export function moveVariable(doc: PartDocument, name: string, position: { before: string } | { after: string }): PartDocument {
  const variables = [...(doc.variables ?? [])];
  const from = variables.findIndex((v) => v.name === name);
  if (from < 0) throw new Error(`No variable named #${name}.`);
  const [moved] = variables.splice(from, 1);
  const anchor = "before" in position ? position.before : position.after;
  const at = variables.findIndex((v) => v.name === anchor);
  if (at < 0) throw new Error(`No variable named #${anchor}.`);
  variables.splice("before" in position ? at : at + 1, 0, moved);
  return { ...doc, variables };
}

/** CSV (name, expression, kind, comment, favorite) or JSON of the variables. */
export function exportVariables(doc: PartDocument, format: "csv" | "json" = "csv"): string {
  const variables = doc.variables ?? [];
  if (format === "json") return JSON.stringify(variables, null, 2) + "\n";
  const cell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  return ["name,expression,kind,comment,favorite", ...variables.map((v) => [v.name, v.expression, v.kind, v.comment ?? "", v.favorite ? "true" : ""].map(cell).join(","))].join("\n") + "\n";
}
/** Variables from CSV (a header naming name and expression, kind/comment/favorite optional) or a JSON array; existing names are replaced. */
export function importVariables(doc: PartDocument, text: string): { document: PartDocument; added: number; replaced: number } {
  const rows: Partial<DocumentVariable>[] = text.trim().startsWith("[") ? JSON.parse(text) : parseCSV(text);
  const variables = [...(doc.variables ?? [])];
  let added = 0, replaced = 0;
  for (const row of rows) {
    if (typeof row.name !== "string" || typeof row.expression !== "string") throw new Error("Each row needs a name and an expression.");
    const kind = (row.kind ?? (/deg|rad/.test(row.expression) ? "angle" : /mm|cm|\bm\b|in|ft/.test(row.expression) ? "length" : /^".*"$/.test(row.expression.trim()) ? "string" : "number")) as DocumentVariable["kind"];
    const variable = strip({ name: row.name, expression: row.expression, kind, comment: row.comment || undefined, favorite: row.favorite === true || (row.favorite as unknown) === "true" ? true : undefined });
    const at = variables.findIndex((v) => v.name === row.name);
    if (at >= 0) { variables[at] = variable; replaced++; } else { variables.push(variable); added++; }
  }
  return { document: { ...doc, variables }, added, replaced };
}
function parseCSV(text: string): Partial<DocumentVariable>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const split = (line: string) => { const out: string[] = []; let cur = "", quoted = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; } else if (ch === '"') quoted = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const header = split(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => { const cells = split(line); const row: Record<string, unknown> = {}; header.forEach((h, i) => { row[h] = cells[i]?.trim() ?? ""; }); return row as Partial<DocumentVariable>; });
}

export interface CompletionSuggestion { text: string; kind: "parameter" | "function" | "unit" | "constant"; detail: string }
export const expressionFunctions = ["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "min", "max"];
export const expressionUnits = ["mm", "cm", "m", "in", "ft", "deg", "rad"];
/** What the text before the cursor could become: parameters, functions, units and constants. */
export function completeExpression(doc: PartDocument, prefix: string): { word: string; suggestions: CompletionSuggestion[] } {
  const match = /#?([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix) ?? [""];
  const word = match[0] ?? "", stem = (match[1] ?? "").toLowerCase(), wantsVariable = word.startsWith("#");
  const suggestions: CompletionSuggestion[] = [];
  for (const v of doc.variables ?? []) if (v.name.toLowerCase().startsWith(stem)) suggestions.push({ text: `#${v.name}`, kind: "parameter", detail: `${v.expression}${v.comment ? " · " + v.comment : ""}` });
  if (!wantsVariable) {
    for (const f of expressionFunctions) if (f.startsWith(stem)) suggestions.push({ text: `${f}(`, kind: "function", detail: "function" });
    for (const u of expressionUnits) if (u.startsWith(stem)) suggestions.push({ text: u, kind: "unit", detail: "unit" });
    for (const [c, detail] of [["pi", "3.14159…"], ["e", "2.71828…"]] as const) if (c.startsWith(stem)) suggestions.push({ text: c, kind: "constant", detail });
  }
  return { word, suggestions };
}
