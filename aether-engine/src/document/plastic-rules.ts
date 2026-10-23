/** Plastic rules (SolidCraft's plastic.rules / manage_rules / assign_rule): named
 *  moulding defaults a part carries. Plastic features read the rule of their body
 *  (or the active rule) for draft and clearance defaults. Stored on the document. */
export interface PlasticRule {
  name: string;
  material?: string;
  thicknessMillimeters: number;
  draftDegrees: number;
  nominalRadiusMillimeters: number;
  clearanceMillimeters: number;
  /** Thinnest allowed edge; default: a third of the thickness. */
  knifeEdgeMillimeters?: number;
}
export interface PlasticRulesTable {
  rules: PlasticRule[];
  /** The rule plastic features default to when their body has none. */
  active?: string;
  /** body id → rule name. */
  assignments?: Record<string, string>;
}
/** SolidCraft starts a new rule from ABS (1.5 mm); these are the library. */
export const PLASTIC_RULE_LIBRARY: readonly PlasticRule[] = Object.freeze([
  { name: "ABS (1.5mm)", material: "ABS", thicknessMillimeters: 1.5, draftDegrees: 1, nominalRadiusMillimeters: 0.75, clearanceMillimeters: 0.1 },
  { name: "PC (2mm)", material: "Polycarbonate", thicknessMillimeters: 2, draftDegrees: 1.5, nominalRadiusMillimeters: 1, clearanceMillimeters: 0.15 },
  { name: "Nylon (1.8mm)", material: "PA6", thicknessMillimeters: 1.8, draftDegrees: 1, nominalRadiusMillimeters: 0.9, clearanceMillimeters: 0.1 },
]);
const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
export function validatePlasticRule(rule: PlasticRule): void {
  if (!rule.name?.trim()) throw new Error("A plastic rule needs a name.");
  if (!pos(rule.thicknessMillimeters) || !pos(rule.nominalRadiusMillimeters)) throw new Error("Rule thickness and radius must be positive.");
  if (!(Number.isFinite(rule.draftDegrees) && rule.draftDegrees >= 0 && rule.draftDegrees < 45)) throw new Error("Rule draft must be between 0 and 45 degrees.");
  if (!(Number.isFinite(rule.clearanceMillimeters) && rule.clearanceMillimeters >= 0)) throw new Error("Rule clearance must be zero or more.");
  if (rule.knifeEdgeMillimeters !== undefined && !pos(rule.knifeEdgeMillimeters)) throw new Error("Rule knife edge must be positive.");
}
export function validatePlasticRules(table: unknown): void {
  if (table === undefined) return;
  const t = table as PlasticRulesTable;
  if (!t || typeof t !== "object" || !Array.isArray(t.rules)) throw new Error("Plastic rules must list rules.");
  t.rules.forEach(validatePlasticRule);
  if (new Set(t.rules.map((r) => r.name)).size !== t.rules.length) throw new Error("Plastic rule names must be unique.");
  if (t.active !== undefined && !t.rules.some((r) => r.name === t.active)) throw new Error("The active plastic rule is not defined.");
  for (const name of Object.values(t.assignments ?? {})) if (!t.rules.some((r) => r.name === name)) throw new Error(`Assigned plastic rule ${name} is not defined.`);
}
type Doc<T> = T & { plasticRules?: PlasticRulesTable };
/** The rule a body's plastic features default to: assigned, else active, else none. */
export function plasticRuleFor<T>(doc: Doc<T>, bodyId?: string): PlasticRule | undefined {
  const table = doc.plasticRules;
  if (!table) return undefined;
  const name = (bodyId && table.assignments?.[bodyId]) || table.active;
  return table.rules.find((r) => r.name === name);
}
/** Add or replace a rule (manage_rules); a new one starts from `from` or the library's ABS. */
export function setPlasticRule<T>(doc: Doc<T>, rule: Partial<PlasticRule> & { name: string }, from?: string): Doc<T> {
  const table: PlasticRulesTable = structuredClone(doc.plasticRules ?? { rules: [] });
  const base = table.rules.find((r) => r.name === rule.name) ?? table.rules.find((r) => r.name === from) ?? PLASTIC_RULE_LIBRARY.find((r) => r.name === from) ?? PLASTIC_RULE_LIBRARY[0];
  const next: PlasticRule = { ...base, ...Object.fromEntries(Object.entries(rule).filter(([, v]) => v !== undefined)) } as PlasticRule;
  validatePlasticRule(next);
  const at = table.rules.findIndex((r) => r.name === rule.name);
  if (at >= 0) table.rules[at] = next; else table.rules.push(next);
  if (!table.active) table.active = next.name;
  return { ...doc, plasticRules: table };
}
export function removePlasticRule<T>(doc: Doc<T>, name: string): Doc<T> {
  const table: PlasticRulesTable = structuredClone(doc.plasticRules ?? { rules: [] });
  table.rules = table.rules.filter((r) => r.name !== name);
  if (table.active === name) table.active = table.rules[0]?.name;
  table.assignments = Object.fromEntries(Object.entries(table.assignments ?? {}).filter(([, v]) => v !== name));
  if (!Object.keys(table.assignments).length) delete table.assignments;
  const next = { ...doc, plasticRules: table.rules.length ? table : undefined };
  if (!next.plasticRules) delete next.plasticRules;
  return next;
}
export function setActivePlasticRule<T>(doc: Doc<T>, name: string): Doc<T> {
  const table: PlasticRulesTable = structuredClone(doc.plasticRules ?? { rules: [] });
  if (!table.rules.some((r) => r.name === name)) throw new Error(`No plastic rule ${name}.`);
  return { ...doc, plasticRules: { ...table, active: name } };
}
/** assign_rule: bodies take a rule; an empty name clears theirs. */
export function assignPlasticRule<T>(doc: Doc<T>, bodyIds: readonly string[], name: string | null): Doc<T> {
  const table: PlasticRulesTable = structuredClone(doc.plasticRules ?? { rules: [] });
  if (name && !table.rules.some((r) => r.name === name)) throw new Error(`No plastic rule ${name}.`);
  const assignments = { ...table.assignments };
  for (const id of bodyIds) { if (name) assignments[id] = name; else delete assignments[id]; }
  return { ...doc, plasticRules: { ...table, ...(Object.keys(assignments).length ? { assignments } : {}), ...(Object.keys(assignments).length ? {} : { assignments: undefined }) } };
}
