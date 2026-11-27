import { SHEET_METAL_RULE_LIBRARY, validateSheetMetalRule, type NamedSheetMetalRule } from "./sheet-metal";

/** Persisted Sheet Metal Rules table on a PartDocument (`sheet.rules` / `sheet.manage_rules`).
 *  Mirrors PlasticRulesTable so sheet features can inherit named gauge, bend radius, and K-factor rules. */
export interface SheetMetalRulesTable {
  rules: NamedSheetMetalRule[];
  /** Active default rule ID when a sheet body has no explicit assignment. */
  active?: string;
  /** body id -> rule id. */
  assignments?: Record<string, string>;
}

export function validateNamedSheetMetalRule(rule: NamedSheetMetalRule): void {
  if (!rule.id?.trim()) throw new Error("A sheet metal rule needs an ID.");
  if (!rule.name?.trim()) throw new Error("A sheet metal rule needs a name.");
  if (!rule.material?.trim()) throw new Error("A sheet metal rule needs a material.");
  if (!(typeof rule.densityKgPerM3 === "number" && Number.isFinite(rule.densityKgPerM3) && rule.densityKgPerM3 > 0)) {
    throw new Error("Sheet metal rule density must be positive.");
  }
  validateSheetMetalRule(rule, `Sheet metal rule ${rule.name}`);
}

export function validateSheetMetalRules(table: unknown): void {
  if (table === undefined) return;
  const t = table as SheetMetalRulesTable;
  if (!t || typeof t !== "object" || !Array.isArray(t.rules)) {
    throw new Error("Sheet metal rules must list rules.");
  }
  t.rules.forEach(validateNamedSheetMetalRule);
  if (new Set(t.rules.map((r) => r.id)).size !== t.rules.length) {
    throw new Error("Sheet metal rule IDs must be unique.");
  }
  if (t.active !== undefined && !t.rules.some((r) => r.id === t.active)) {
    throw new Error("The active sheet metal rule is not defined.");
  }
  for (const id of Object.values(t.assignments ?? {})) {
    if (!t.rules.some((r) => r.id === id)) {
      throw new Error(`Assigned sheet metal rule ${id} is not defined.`);
    }
  }
}

type Doc<T> = T & { sheetMetalRules?: SheetMetalRulesTable };

/** Resolve the active sheet metal rule for a body (document assignment -> active -> library fallback). */
export function sheetMetalRuleFor<T>(doc: Doc<T>, bodyId?: string, ruleId?: string): NamedSheetMetalRule | undefined {
  const table = doc.sheetMetalRules;
  if (ruleId) {
    const found = table?.rules.find((r) => r.id === ruleId) ?? SHEET_METAL_RULE_LIBRARY.find((r) => r.id === ruleId);
    if (found) return found;
  }
  if (!table) return undefined;
  const id = (bodyId && table.assignments?.[bodyId]) || table.active;
  return table.rules.find((r) => r.id === id);
}

/** Add or update a named sheet metal rule on the document. */
export function setSheetMetalRule<T>(
  doc: Doc<T>,
  rule: Partial<NamedSheetMetalRule> & { id: string },
  fromId?: string,
): Doc<T> {
  const table: SheetMetalRulesTable = structuredClone(doc.sheetMetalRules ?? { rules: [] });
  const base =
    table.rules.find((r) => r.id === rule.id) ??
    table.rules.find((r) => r.id === fromId) ??
    SHEET_METAL_RULE_LIBRARY.find((r) => r.id === fromId) ??
    SHEET_METAL_RULE_LIBRARY[1];
  const next: NamedSheetMetalRule = {
    ...base,
    ...Object.fromEntries(Object.entries(rule).filter(([, v]) => v !== undefined)),
    name: rule.name ?? base.name,
  } as NamedSheetMetalRule;
  validateNamedSheetMetalRule(next);
  const at = table.rules.findIndex((r) => r.id === rule.id);
  if (at >= 0) table.rules[at] = next;
  else table.rules.push(next);
  if (!table.active) table.active = next.id;
  return { ...doc, sheetMetalRules: table };
}

export function removeSheetMetalRule<T>(doc: Doc<T>, id: string): Doc<T> {
  const table: SheetMetalRulesTable = structuredClone(doc.sheetMetalRules ?? { rules: [] });
  table.rules = table.rules.filter((r) => r.id !== id);
  if (table.active === id) table.active = table.rules[0]?.id;
  table.assignments = Object.fromEntries(Object.entries(table.assignments ?? {}).filter(([, v]) => v !== id));
  if (!Object.keys(table.assignments).length) delete table.assignments;
  const next = { ...doc, sheetMetalRules: table.rules.length ? table : undefined };
  if (!next.sheetMetalRules) delete next.sheetMetalRules;
  return next;
}

export function setActiveSheetMetalRule<T>(doc: Doc<T>, id: string): Doc<T> {
  const table: SheetMetalRulesTable = structuredClone(doc.sheetMetalRules ?? { rules: [] });
  if (!table.rules.some((r) => r.id === id)) throw new Error(`No sheet metal rule ${id}.`);
  return { ...doc, sheetMetalRules: { ...table, active: id } };
}

export function assignSheetMetalRule<T>(doc: Doc<T>, bodyIds: readonly string[], id: string | null): Doc<T> {
  const table: SheetMetalRulesTable = structuredClone(doc.sheetMetalRules ?? { rules: [] });
  if (id && !table.rules.some((r) => r.id === id)) throw new Error(`No sheet metal rule ${id}.`);
  const assignments = { ...table.assignments };
  for (const bodyId of bodyIds) {
    if (id) assignments[bodyId] = id;
    else delete assignments[bodyId];
  }
  return {
    ...doc,
    sheetMetalRules: {
      ...table,
      ...(Object.keys(assignments).length ? { assignments } : { assignments: undefined }),
    },
  };
}
