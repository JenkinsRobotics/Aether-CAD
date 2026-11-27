import { openCADFeatureWindow } from "../../modeling/features/feature-window-style";
import {
  addConfigurationColumn,
  addConfigurationRow,
  configurationColumnKey,
  configurationMatches,
  removeConfigurationColumn,
  removeConfigurationRow,
  rollbackPosition,
  setConfigurationValue,
  updatePartDocumentVariables,
  activateConfiguration,
  previewConfiguration,
  removeConfigRule,
  setConfigRule,
  type ConfigurationColumn,
  type ConfigRule,
  type PartDocument,
  type RuleOperator,
} from "@aether/core/document";
import { cadCommands } from "../../core/cad-command-registry";
import "../CADPopups.css";

/** Configurations (SolidCraft's config.*): a structured floating window over the document's
 *  configuration table. Rows are named value sets over variables, materials and suppressions;
 *  Activate writes a row into the design. Edits stay in a draft until Apply. */
export function openConfigurationsWindow(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
): void {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  const source = getDocument();
  if (!viewport || !source) return;
  if (viewport.querySelector(".cad-configurations-window")) return;
  let draft: PartDocument = structuredClone(source);
  let selectedRow = draft.configurations?.activeRow ?? draft.configurations?.rows[0]?.name ?? "";
  const win = openCADFeatureWindow({
    viewport,
    className: "cad-configurations-window",
    icon: "properties",
    title: "Configurations",
    acceptLabel: "Apply",
    discardLabel: "Cancel",
    onAccept: async () => {
      try {
        const regenerated = draft.variables?.length
          ? await updatePartDocumentVariables({ ...draft, variables: source.variables }, draft.variables)
          : draft;
        await apply(regenerated);
        win.close();
      } catch (error) { win.setError((error as Error).message); }
    },
    onDiscard: async () => { win.close(); },
  });

  const columnLabel = (column: ConfigurationColumn) =>
    column.kind === "param"
      ? column.name
      : column.kind === "material"
        ? `Material (${column.bodyId})`
        : `${draft.features.find((f) => f.id === column.featureId)?.name ?? column.featureId} (suppressed)`;

  // Section 1: Active row selection & quick activation
  const activeSection = win.section("Active configuration");
  const rowsBox = win.entitiesBox("Configurations");
  const rowSelect = document.createElement("select");
  rowSelect.setAttribute("aria-label", "Configuration row");
  const activate = document.createElement("button");
  activate.type = "button";
  activate.className = "aui-button aui-button--primary";
  activate.textContent = "Activate";
  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "aui-button";
  preview.textContent = "Preview";
  const previewNote = document.createElement("p");
  previewNote.className = "cad-form-note";
  previewNote.setAttribute("role", "status");
  const activeActions = document.createElement("div");
  activeActions.className = "cad-window-actions";
  activeActions.append(activate, preview);
  activeSection.body.append(rowsBox.element, win.row("Row", rowSelect), activeActions, previewNote);

  // Section 2: Selected row values
  const valuesSection = win.section("Row values");
  const valuesHost = document.createElement("div");
  valuesHost.className = "cad-configuration-values";
  valuesSection.body.append(valuesHost);

  // Section 3: Add rows & columns
  const structureSection = win.section("Rows & columns");
  const columnsBox = win.entitiesBox("Columns");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "New configuration name";
  nameInput.setAttribute("aria-label", "New configuration name");
  const addRow = document.createElement("button");
  addRow.type = "button";
  addRow.className = "aui-button";
  addRow.textContent = "Add row from current values";

  const variableSelect = document.createElement("select");
  variableSelect.setAttribute("aria-label", "Variable column");
  const addVariable = document.createElement("button");
  addVariable.type = "button";
  addVariable.className = "aui-button";
  addVariable.textContent = "Add variable";

  const featureSelect = document.createElement("select");
  featureSelect.setAttribute("aria-label", "Feature column");
  const addFeature = document.createElement("button");
  addFeature.type = "button";
  addFeature.className = "aui-button";
  addFeature.textContent = "Add feature";

  const addRowActions = document.createElement("div");
  addRowActions.className = "cad-window-actions";
  addRowActions.append(addRow);

  const addColActions = document.createElement("div");
  addColActions.className = "cad-window-actions";
  addColActions.append(addVariable, addFeature);

  structureSection.body.append(
    columnsBox.element,
    win.row("New row", nameInput),
    addRowActions,
    win.row("Variable", variableSelect),
    win.row("Feature", featureSelect),
    addColActions,
  );

  // Section 4: Ordered configuration rules
  const rulesSection = win.section("Rules");
  const rulesBox = win.entitiesBox("Rules");
  const select = (label: string) => { const el = document.createElement("select"); el.setAttribute("aria-label", label); return el; };
  const input = (label: string, placeholder: string) => { const el = document.createElement("input"); el.type = "text"; el.placeholder = placeholder; el.setAttribute("aria-label", label); return el; };
  const whenVariable = select("Rule condition variable");
  const whenOperator = select("Rule comparison");
  const whenValue = input("Rule condition value", "value");
  for (const [value, label] of [["always", "always"], ["eq", "="], ["ne", "≠"], ["lt", "<"], ["le", "≤"], ["gt", ">"], ["ge", "≥"]]) {
    whenOperator.add(new Option(label, value));
  }
  const effectKind = select("Rule effect");
  for (const [value, label] of [
    ["drive_parameter", "Set variable"],
    ["drive_suppression", "Suppress feature"],
    ["restore", "Restore feature"],
    ["parameter_range", "Keep variable in range"],
    ["allow_parameter_values", "Allow only values"],
  ]) {
    effectKind.add(new Option(label, value));
  }
  const effectTarget = select("Rule target");
  const effectValue = input("Rule value", "value, min..max, or a, b, c");
  const ruleName = input("Rule name", "Rule name");
  const addRule = document.createElement("button");
  addRule.type = "button";
  addRule.className = "aui-button";
  addRule.textContent = "Add rule";

  const condPair = document.createElement("div");
  condPair.className = "cad-window-pair";
  condPair.append(whenVariable, whenOperator);
  const effectPair = document.createElement("div");
  effectPair.className = "cad-window-pair";
  effectPair.append(effectKind, effectTarget);
  const ruleActions = document.createElement("div");
  ruleActions.className = "cad-window-actions";
  ruleActions.append(addRule);

  rulesSection.body.append(
    rulesBox.element,
    win.row("When", condPair),
    win.row("Matches", whenValue),
    win.row("Then", effectPair),
    win.row("Value", effectValue),
    win.row("Rule name", ruleName),
    ruleActions,
  );

  const ruleLabel = (r: ConfigRule) => {
    const c = r.condition, e = r.effect;
    const when = c.type === "always" ? "always" : c.type === "parameter" ? `${c.parameter} ${({ eq: "=", ne: "≠", lt: "<", le: "≤", gt: ">", ge: "≥" } as Record<string, string>)[c.operator]} ${c.expression}` : c.type;
    const feature = (id: string) => draft.features.find((f) => f.id === id)?.name ?? id;
    const then = e.type === "drive_parameter" ? `${e.parameter} = ${e.expression}` : e.type === "drive_suppression" ? `${e.value ? "suppress" : "restore"} ${feature(e.featureId)}` : e.type === "parameter_range" ? `${e.parameter} in ${e.minimum}..${e.maximum}` : `${e.parameter} ∈ {${e.expressions.join(", ")}}`;
    return `${r.enabled ? "" : "(off) "}${r.name}: when ${when}, ${then}`;
  };
  const buildRule = (): ConfigRule => {
    const kind = effectKind.value, target = effectTarget.value, value = effectValue.value.trim();
    const condition: ConfigRule["condition"] = whenOperator.value === "always" ? { type: "always" } : { type: "parameter", parameter: whenVariable.value, operator: whenOperator.value as RuleOperator, expression: whenValue.value.trim() };
    const effect: ConfigRule["effect"] = kind === "drive_suppression" || kind === "restore" ? { type: "drive_suppression", featureId: target, value: kind === "drive_suppression" }
      : kind === "parameter_range" ? (() => { const [minimum, maximum] = value.split("..").map((x) => x.trim()); if (!minimum || !maximum) throw new Error("Write the range as min..max."); return { type: "parameter_range" as const, parameter: target, minimum, maximum }; })()
      : kind === "allow_parameter_values" ? { type: "allow_parameter_values", parameter: target, expressions: value.split(",").map((x) => x.trim()).filter(Boolean) }
      : { type: "drive_parameter", parameter: target, expression: value };
    const ids = new Set((draft.configurations?.rules ?? []).map((r) => r.id));
    let n = ids.size + 1; while (ids.has(`rule-${n}`)) n++;
    return { id: `rule-${n}`, name: ruleName.value.trim() || `Rule ${n}`, enabled: true, condition, effect };
  };
  const renderRules = () => {
    const table = draft.configurations ?? { columns: [], rows: [] };
    rulesBox.render((table.rules ?? []).map((r) => ({ label: ruleLabel(r), onRemove: () => attempt(() => removeConfigRule(draft, r.id)) })));
    const params = table.columns.filter((c) => c.kind === "param").map((c) => (c as { name: string }).name);
    const suppressions = table.columns.filter((c) => c.kind === "suppress").map((c) => (c as { featureId: string }).featureId);
    whenVariable.replaceChildren(...(draft.variables ?? []).map((v) => new Option(v.name, v.name)));
    whenVariable.disabled = whenValue.disabled = whenOperator.value === "always";
    const featureTarget = effectKind.value === "drive_suppression" || effectKind.value === "restore";
    const keep = effectTarget.value;
    effectTarget.replaceChildren(...(featureTarget ? suppressions.map((id) => new Option(draft.features.find((f) => f.id === id)?.name ?? id, id)) : params.map((name) => new Option(name, name))));
    if ([...effectTarget.options].some((o) => o.value === keep)) effectTarget.value = keep;
    effectValue.disabled = featureTarget;
    addRule.disabled = !effectTarget.options.length;
  };
  whenOperator.onchange = renderRules;
  effectKind.onchange = renderRules;
  addRule.onclick = () => attempt(() => { const next = setConfigRule(draft, buildRule()); ruleName.value = ""; effectValue.value = ""; whenValue.value = ""; return next; });
  preview.onclick = () => {
    const result = previewConfiguration(draft, selectedRow);
    previewNote.textContent = !result.ok ? `${selectedRow} would fail: ${result.error}`
      : `${selectedRow}: ${result.changes.length ? result.changes.join("; ") : "no change"}${result.trace.length ? `. Rules matched: ${result.trace.filter((t) => t.matched).map((t) => t.name).join(", ") || "none"}` : ""}.`;
  };
  const attempt = (change: () => PartDocument) => { try { draft = change(); win.setError(null); } catch (error) { win.setError((error as Error).message); } render(); };
  const render = () => {
    const table = draft.configurations ?? { columns: [], rows: [] };
    rowSelect.replaceChildren(...table.rows.map((row) => { const o = document.createElement("option"); o.value = row.name; o.textContent = row.name + (row.name === table.activeRow ? " (active)" : ""); return o; }));
    if (!table.rows.some((r) => r.name === selectedRow)) selectedRow = table.rows[0]?.name ?? "";
    rowSelect.value = selectedRow;
    activate.disabled = !selectedRow;
    rowsBox.render(table.rows.map((row) => ({ label: row.name === table.activeRow ? `${row.name} · active${configurationMatches(draft) ? "" : " · design differs"}` : row.name, onRemove: () => attempt(() => removeConfigurationRow(draft, row.name)) })));
    columnsBox.render(table.columns.map((column) => ({ label: columnLabel(column), onRemove: () => attempt(() => removeConfigurationColumn(draft, configurationColumnKey(column))) })));
    const taken = new Set(table.columns.map(configurationColumnKey));
    variableSelect.replaceChildren(...(draft.variables ?? []).filter((v) => !taken.has(`param:${v.name}`)).map((v) => { const o = document.createElement("option"); o.value = v.name; o.textContent = v.name; return o; }));
    featureSelect.replaceChildren(...draft.features.slice(0, rollbackPosition(draft)).filter((f) => !taken.has(`suppress:${f.id}`)).map((f) => { const o = document.createElement("option"); o.value = f.id; o.textContent = f.name; return o; }));
    addVariable.disabled = !variableSelect.options.length;
    addFeature.disabled = !featureSelect.options.length;
    preview.disabled = !selectedRow;
    renderRules();
    const row = table.rows.find((r) => r.name === selectedRow);
    valuesHost.replaceChildren();
    if (row && table.columns.length) {
      for (const column of table.columns) {
        const key = configurationColumnKey(column), value = row.values[key];
        const control = document.createElement("input");
        if (column.kind === "param" || column.kind === "material") {
          control.type = "text";
          control.value = String(value ?? "");
          control.onchange = () => attempt(() => setConfigurationValue(draft, row.name, key, control.value));
        } else {
          control.type = "checkbox";
          control.checked = value === true;
          control.onchange = () => attempt(() => setConfigurationValue(draft, row.name, key, control.checked));
        }
        control.setAttribute("aria-label", `${row.name} · ${columnLabel(column)}`);
        valuesHost.append(win.row(columnLabel(column), control));
      }
    } else {
      const empty = document.createElement("p");
      empty.className = "cad-form-note";
      empty.textContent = "Add a row and at least one variable or feature column below to edit values.";
      valuesHost.append(empty);
    }
  };
  rowSelect.onchange = () => { selectedRow = rowSelect.value; render(); };
  activate.onclick = () => attempt(() => activateConfiguration(draft, selectedRow).document);
  addRow.onclick = () => {
    const name = nameInput.value.trim();
    attempt(() => addConfigurationRow(draft, name));
    if (!win.panel.querySelector(".aui-feature-error:not([hidden])")) { selectedRow = name; nameInput.value = ""; render(); }
  };
  addVariable.onclick = () => attempt(() => addConfigurationColumn(draft, { kind: "param", name: variableSelect.value }));
  addFeature.onclick = () => attempt(() => addConfigurationColumn(draft, { kind: "suppress", featureId: featureSelect.value }));
  render();
}

export function mountConfigurationCommands(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
) {
  const release = cadCommands.register("show-configurations", () => openConfigurationsWindow(getDocument, apply));
  cadCommands.setEnabled("show-configurations", true);
  return release;
}
