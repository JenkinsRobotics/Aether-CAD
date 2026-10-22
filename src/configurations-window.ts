import { openCompactFeatureWindow } from "@aether/ui";
import { addConfigurationColumn, addConfigurationRow, applyConfigurationRow, configurationColumnKey, configurationMatches, removeConfigurationColumn, removeConfigurationRow, rollbackPosition, setConfigurationValue, type ConfigurationColumn, type PartDocument } from "@aether/core/document";
import { cadCommands } from "./cad-command-registry";

/** Configurations (SolidCraft's config.*): a compact window over the document's
 *  configuration table. Rows are named value sets over the chosen variables and
 *  feature suppressions; Activate writes a row into the design. Edits are kept
 *  in a draft and committed with ✓, like any feature window. */
export function openConfigurationsWindow(getDocument: () => PartDocument | null, apply: (doc: PartDocument) => Promise<void>): void {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  const source = getDocument();
  if (!viewport || !source) return;
  if (viewport.querySelector(".cad-configurations-window")) return;
  let draft: PartDocument = structuredClone(source);
  let selectedRow = draft.configurations?.activeRow ?? draft.configurations?.rows[0]?.name ?? "";
  const win = openCompactFeatureWindow({
    viewport, className: "cad-configurations-window", icon: "properties", title: "Configurations",
    acceptLabel: "Apply", discardLabel: "Cancel",
    onAccept: async () => { try { await apply(draft); win.close(); } catch (error) { win.setError((error as Error).message); } },
    onDiscard: async () => { win.close(); },
  });
  const columnLabel = (column: ConfigurationColumn) => column.kind === "param" ? column.name : `${draft.features.find((f) => f.id === column.featureId)?.name ?? column.featureId} (suppressed)`;
  const rowsBox = win.entitiesBox("Configurations"); win.body.append(rowsBox.element);
  const columnsBox = win.entitiesBox("Columns"); win.body.append(columnsBox.element);
  const valuesHost = document.createElement("div"); valuesHost.className = "cad-configuration-values"; win.body.append(valuesHost);
  const rowSelect = document.createElement("select"); rowSelect.setAttribute("aria-label", "Configuration row");
  const activate = document.createElement("button"); activate.type = "button"; activate.className = "aui-button"; activate.textContent = "Activate";
  const nameInput = document.createElement("input"); nameInput.type = "text"; nameInput.placeholder = "New configuration name"; nameInput.setAttribute("aria-label", "New configuration name");
  const addRow = document.createElement("button"); addRow.type = "button"; addRow.className = "aui-button"; addRow.textContent = "Add row from current values";
  const variableSelect = document.createElement("select"); variableSelect.setAttribute("aria-label", "Variable column");
  const addVariable = document.createElement("button"); addVariable.type = "button"; addVariable.className = "aui-button"; addVariable.textContent = "Add variable";
  const featureSelect = document.createElement("select"); featureSelect.setAttribute("aria-label", "Feature column");
  const addFeature = document.createElement("button"); addFeature.type = "button"; addFeature.className = "aui-button"; addFeature.textContent = "Add feature";
  win.row("Row", rowSelect, activate); win.row("New row", nameInput, addRow); win.row("Variable", variableSelect, addVariable); win.row("Feature", featureSelect, addFeature);
  const attempt = (change: () => PartDocument) => { try { draft = change(); win.setError(null); } catch (error) { win.setError((error as Error).message); } render(); };
  const render = () => {
    const table = draft.configurations ?? { columns: [], rows: [] };
    rowSelect.replaceChildren(...table.rows.map((row) => { const o = document.createElement("option"); o.value = row.name; o.textContent = row.name + (row.name === table.activeRow ? " (active)" : ""); return o; }));
    if (!table.rows.some((r) => r.name === selectedRow)) selectedRow = table.rows[0]?.name ?? "";
    rowSelect.value = selectedRow; activate.disabled = !selectedRow;
    rowsBox.render(table.rows.map((row) => ({ label: row.name === table.activeRow ? `${row.name} · active${configurationMatches(draft) ? "" : " · design differs"}` : row.name, onRemove: () => attempt(() => removeConfigurationRow(draft, row.name)) })));
    columnsBox.render(table.columns.map((column) => ({ label: columnLabel(column), onRemove: () => attempt(() => removeConfigurationColumn(draft, configurationColumnKey(column))) })));
    const taken = new Set(table.columns.map(configurationColumnKey));
    variableSelect.replaceChildren(...(draft.variables ?? []).filter((v) => !taken.has(`param:${v.name}`)).map((v) => { const o = document.createElement("option"); o.value = v.name; o.textContent = v.name; return o; }));
    featureSelect.replaceChildren(...draft.features.slice(0, rollbackPosition(draft)).filter((f) => !taken.has(`suppress:${f.id}`)).map((f) => { const o = document.createElement("option"); o.value = f.id; o.textContent = f.name; return o; }));
    addVariable.disabled = !variableSelect.options.length; addFeature.disabled = !featureSelect.options.length;
    const row = table.rows.find((r) => r.name === selectedRow);
    valuesHost.replaceChildren();
    if (row) for (const column of table.columns) {
      const key = configurationColumnKey(column), value = row.values[key];
      const control = document.createElement("input");
      if (column.kind === "param") { control.type = "text"; control.value = String(value ?? ""); control.onchange = () => attempt(() => setConfigurationValue(draft, row.name, key, control.value)); }
      else { control.type = "checkbox"; control.checked = value === true; control.onchange = () => attempt(() => setConfigurationValue(draft, row.name, key, control.checked)); }
      control.setAttribute("aria-label", `${row.name} · ${columnLabel(column)}`);
      valuesHost.append(win.row(columnLabel(column), control));
    }
  };
  rowSelect.onchange = () => { selectedRow = rowSelect.value; render(); };
  activate.onclick = () => attempt(() => applyConfigurationRow(draft, selectedRow));
  addRow.onclick = () => { const name = nameInput.value.trim(); attempt(() => addConfigurationRow(draft, name)); if (!win.panel.querySelector(".aui-feature-error:not([hidden])")) { selectedRow = name; nameInput.value = ""; render(); } };
  addVariable.onclick = () => attempt(() => addConfigurationColumn(draft, { kind: "param", name: variableSelect.value }));
  addFeature.onclick = () => attempt(() => addConfigurationColumn(draft, { kind: "suppress", featureId: featureSelect.value }));
  render();
}
export function mountConfigurationCommands(getDocument: () => PartDocument | null, apply: (doc: PartDocument) => Promise<void>) {
  const release = cadCommands.register("show-configurations", () => openConfigurationsWindow(getDocument, apply));
  cadCommands.setEnabled("show-configurations", true);
  return release;
}
