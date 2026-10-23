/** Configuration rules (SolidCraft's config.rule / config.rules / config.preview):
 *  ordered rules on the configuration table. Each has a condition tree over variable
 *  values and feature suppressions and one effect: drive a variable, drive a
 *  suppression, or restrict a variable to a range or to listed values. Activating a
 *  row writes its values, then runs the rules in order; restrictions are checked last.
 *  Preview runs the same thing on a copy and reports, changing nothing. */
import type { PartDocument } from "./part-document";
import { applyConfigurationRow, configurationColumnKey } from "./configurations";
import { setFeatureSuppressed } from "./feature-history";
import { evaluateDocumentVariables } from "./variables";
import { evaluateExpression } from "../expressions/evaluate";
import { numeric, type ExpressionValue } from "../expressions/values";

export type RuleOperator = "eq" | "ne" | "lt" | "le" | "gt" | "ge";
export type RuleCondition =
  | { type: "always" }
  | { type: "all"; conditions: RuleCondition[] }
  | { type: "any"; conditions: RuleCondition[] }
  | { type: "not"; condition: RuleCondition }
  | { type: "parameter"; parameter: string; operator: RuleOperator; expression: string }
  | { type: "suppression"; featureId: string; value: boolean };
export type RuleEffect =
  | { type: "drive_parameter"; parameter: string; expression: string }
  | { type: "drive_suppression"; featureId: string; value: boolean }
  | { type: "parameter_range"; parameter: string; minimum: string; maximum: string }
  | { type: "allow_parameter_values"; parameter: string; expressions: string[] };
export interface ConfigRule { id: string; name: string; enabled: boolean; condition: RuleCondition; effect: RuleEffect }
export interface RuleTrace { id: string; name: string; matched: boolean; effect: RuleEffect }

const MAX_RULES = 128, MAX_NODES = 64, MAX_DEPTH = 8;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export function validateConfigRules(rules: unknown, doc: Pick<PartDocument, "features" | "variables" | "configurations">): void {
  if (rules === undefined) return;
  if (!Array.isArray(rules) || rules.length > MAX_RULES) throw new Error(`Configuration rules are a list of at most ${MAX_RULES}.`);
  const ids = new Set<string>();
  const variable = (name: unknown) => { if (typeof name !== "string" || !doc.variables?.some((v) => v.name === name)) throw new Error(`Rule references unknown variable ${String(name)}.`); };
  const feature = (id: unknown) => { if (typeof id !== "string" || !doc.features.some((f) => f.id === id)) throw new Error("Rule references a feature that is gone."); };
  const text = (value: unknown) => { if (typeof value !== "string" || !value.trim() || value.length > 512) throw new Error("Rule expressions must be text."); };
  for (const rule of rules as ConfigRule[]) {
    if (!rule || typeof rule.id !== "string" || !rule.id.trim() || typeof rule.name !== "string" || !rule.name.trim()) throw new Error("A rule needs an id and a name.");
    if (ids.has(rule.id)) throw new Error("Rule ids must be unique."); ids.add(rule.id);
    if (typeof rule.enabled !== "boolean") throw new Error(`Rule ${rule.name} needs enabled true or false.`);
    let nodes = 0;
    const visit = (c: RuleCondition, depth: number): void => {
      if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error(`Rule ${rule.name}: the condition is too large or too deep.`);
      if (!c || typeof c !== "object") throw new Error(`Rule ${rule.name}: a condition is missing.`);
      if (c.type === "always") return;
      if (c.type === "all" || c.type === "any") { if (!Array.isArray(c.conditions) || !c.conditions.length) throw new Error(`Rule ${rule.name}: an empty condition group.`); c.conditions.forEach((x) => visit(x, depth + 1)); return; }
      if (c.type === "not") { visit(c.condition, depth + 1); return; }
      if (c.type === "parameter") { variable(c.parameter); text(c.expression); if (!["eq", "ne", "lt", "le", "gt", "ge"].includes(c.operator)) throw new Error(`Rule ${rule.name}: unknown comparison.`); return; }
      if (c.type === "suppression") { feature(c.featureId); if (typeof c.value !== "boolean") throw new Error(`Rule ${rule.name}: suppression is true or false.`); return; }
      throw new Error(`Rule ${rule.name}: unknown condition.`);
    };
    visit(rule.condition, 1);
    const e = rule.effect;
    const columns = new Set((doc.configurations?.columns ?? []).map(configurationColumnKey));
    if (!e || typeof e !== "object") throw new Error(`Rule ${rule.name} needs an effect.`);
    if (e.type === "drive_suppression") { feature(e.featureId); if (!columns.has(`suppress:${e.featureId}`)) throw new Error(`Rule ${rule.name}: its feature is not a configuration column.`); continue; }
    variable(e.parameter);
    if (!columns.has(`param:${e.parameter}`)) throw new Error(`Rule ${rule.name}: ${e.parameter} is not a configuration column.`);
    if (e.type === "drive_parameter") text(e.expression);
    else if (e.type === "parameter_range") { text(e.minimum); text(e.maximum); }
    else if (e.type === "allow_parameter_values") { if (!Array.isArray(e.expressions) || !e.expressions.length || e.expressions.length > 128) throw new Error(`Rule ${rule.name}: list one to 128 allowed values.`); e.expressions.forEach(text); }
    else throw new Error(`Rule ${rule.name}: unknown effect.`);
  }
}

/** A variable and an expression, both evaluated against the document's current values, in SI. */
function operands(values: Map<string, ExpressionValue>, parameter: string, expression: string): [number, number] {
  const a = values.get(parameter);
  if (a === undefined) throw new Error(`No variable ${parameter}.`);
  const b = evaluateExpression(expression, { resolveVariable: (name) => { const v = values.get(name); if (v === undefined) throw new Error(`No variable ${name}.`); return v; } });
  const qa = numeric(a), qb = numeric(b);
  // A bare number against a length or angle is read in that variable's display unit (mm, degrees).
  const scale = qb.lengthPower === 0 && qb.anglePower === 0 && (qa.lengthPower !== 0 || qa.anglePower !== 0) ? (qa.lengthPower !== 0 ? 0.001 : Math.PI / 180) : 1;
  const bSI = qb.magnitudeSI * scale;
  if (scale === 1 && (qa.lengthPower !== qb.lengthPower || qa.anglePower !== qb.anglePower)) throw new Error(`${parameter} and ${expression} have different units.`);
  if (!Number.isFinite(qa.magnitudeSI) || !Number.isFinite(bSI)) throw new Error("Comparisons need finite values.");
  return [qa.magnitudeSI, bSI];
}
function holds(doc: PartDocument, values: Map<string, ExpressionValue>, c: RuleCondition): boolean {
  switch (c.type) {
    case "always": return true;
    case "all": return c.conditions.every((x) => holds(doc, values, x));
    case "any": return c.conditions.some((x) => holds(doc, values, x));
    case "not": return !holds(doc, values, c.condition);
    case "suppression": { const f = doc.features.find((x) => x.id === c.featureId); if (!f) throw new Error("A rule's feature is gone."); return Boolean(f.suppressed) === c.value; }
    case "parameter": {
      const [a, b] = operands(values, c.parameter, c.expression);
      return c.operator === "eq" ? close(a, b) : c.operator === "ne" ? !close(a, b) : c.operator === "lt" ? a < b && !close(a, b) : c.operator === "le" ? a <= b || close(a, b) : c.operator === "gt" ? a > b && !close(a, b) : a >= b || close(a, b);
    }
  }
}

/** Run the rules on a document whose row values are already written. Throws when a restriction fails. */
export function applyConfigRules(doc: PartDocument): { document: PartDocument; trace: RuleTrace[] } {
  const rules = doc.configurations?.rules ?? [];
  validateConfigRules(rules, doc);
  let next = doc;
  let values = evaluateDocumentVariables(next.variables);
  const trace: RuleTrace[] = [], restrictions: ConfigRule[] = [];
  for (const rule of rules) {
    let matched = false;
    try { matched = rule.enabled && holds(next, values, rule.condition); }
    catch (error) { throw new Error(`Rule ${rule.name}: ${(error as Error).message}`); }
    trace.push({ id: rule.id, name: rule.name, matched, effect: rule.effect });
    if (!matched) continue;
    const e = rule.effect;
    if (e.type === "drive_parameter") {
      next = { ...next, variables: next.variables?.map((v) => (v.name === e.parameter ? { ...v, expression: e.expression } : v)) };
      try { values = evaluateDocumentVariables(next.variables); } catch (error) { throw new Error(`Rule ${rule.name}: ${(error as Error).message}`); }
    } else if (e.type === "drive_suppression") {
      const f = next.features.find((x) => x.id === e.featureId);
      if (f && Boolean(f.suppressed) !== e.value) next = setFeatureSuppressed(next, e.featureId, e.value);
    } else restrictions.push(rule);
  }
  for (const rule of restrictions) {
    const e = rule.effect;
    if (e.type === "parameter_range") {
      const [value, min] = operands(values, e.parameter, e.minimum), [, max] = operands(values, e.parameter, e.maximum);
      if (!(min <= max && (value >= min || close(value, min)) && (value <= max || close(value, max)))) throw new Error(`Rule ${rule.name}: ${e.parameter} must lie between ${e.minimum} and ${e.maximum}.`);
    } else if (e.type === "allow_parameter_values") {
      if (!e.expressions.some((x) => { const [a, b] = operands(values, e.parameter, x); return close(a, b); })) throw new Error(`Rule ${rule.name}: ${e.parameter} must be one of ${e.expressions.join(", ")}.`);
    }
  }
  return { document: next, trace };
}

/** Activate a row and run the rules: the design the user gets. */
export function activateConfiguration(doc: PartDocument, row: string): { document: PartDocument; trace: RuleTrace[] } {
  return applyConfigRules(applyConfigurationRow(doc, row));
}
/** config.preview: what activating a row would do, without changing the document. */
export function previewConfiguration(doc: PartDocument, row: string): { ok: true; trace: RuleTrace[]; changes: string[] } | { ok: false; error: string } {
  try {
    const { document, trace } = activateConfiguration(structuredClone(doc), row);
    const changes: string[] = [];
    for (const v of document.variables ?? []) { const before = doc.variables?.find((x) => x.name === v.name)?.expression; if (before !== v.expression) changes.push(`${v.name}: ${before} → ${v.expression}`); }
    for (const f of document.features) { const before = doc.features.find((x) => x.id === f.id); if (before && Boolean(before.suppressed) !== Boolean(f.suppressed)) changes.push(`${f.name}: ${f.suppressed ? "suppressed" : "restored"}`); }
    return { ok: true, trace, changes };
  } catch (error) { return { ok: false, error: (error as Error).message }; }
}

export function setConfigRule(doc: PartDocument, rule: ConfigRule, index?: number): PartDocument {
  const table = structuredClone(doc.configurations ?? { columns: [], rows: [] });
  const rules = table.rules ?? [];
  const at = rules.findIndex((r) => r.id === rule.id);
  if (at >= 0) rules.splice(at, 1);
  rules.splice(index ?? (at >= 0 ? at : rules.length), 0, structuredClone(rule));
  const next = { ...doc, configurations: { ...table, rules } };
  validateConfigRules(rules, next);
  return next;
}
export function removeConfigRule(doc: PartDocument, id: string): PartDocument {
  const table = structuredClone(doc.configurations ?? { columns: [], rows: [] });
  const rules = (table.rules ?? []).filter((r) => r.id !== id);
  if (rules.length) table.rules = rules; else delete table.rules;
  return { ...doc, configurations: table };
}
