import { openCADFeatureWindow } from "../../modeling/features/feature-window-style";
import {
  PLASTIC_RULE_LIBRARY,
  assignPlasticRule,
  availableBodies,
  plasticRuleFor,
  removePlasticRule,
  setActivePlasticRule,
  setPlasticRule,
  type PartDocument,
  type PlasticRule,
} from "@aether/core/document";
import { cadCommands } from "../../core/cad-command-registry";
import "../CADPopups.css";

/** Plastic rules (SolidCraft's plastic.rules / manage_rules / assign_rule): a structured
 *  floating window over the document's rule table. Edits stay in a draft until Apply. */
export function openPlasticRulesWindow(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
): void {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  const source = getDocument();
  if (!viewport || !source) return;
  if (viewport.querySelector(".cad-plastic-rules-window")) return;
  let draft: PartDocument = structuredClone(source);
  let selected = draft.plasticRules?.active ?? draft.plasticRules?.rules[0]?.name ?? "";
  const win = openCADFeatureWindow({
    viewport,
    className: "cad-plastic-rules-window",
    icon: "properties",
    title: "Plastic rules",
    acceptLabel: "Apply",
    discardLabel: "Cancel",
    onAccept: async () => {
      try { await apply(draft); win.close(); }
      catch (error) { win.setError((error as Error).message); }
    },
    onDiscard: async () => { win.close(); },
  });

  const rulesSection = win.section("Rules");
  const rulesBox = win.entitiesBox("Saved rules");
  const ruleSelect = document.createElement("select");
  ruleSelect.setAttribute("aria-label", "Plastic rule");
  const activate = document.createElement("button");
  activate.type = "button";
  activate.className = "aui-button";
  activate.textContent = "Make active";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "New rule name";
  nameInput.setAttribute("aria-label", "New rule name");
  const fromSelect = document.createElement("select");
  fromSelect.setAttribute("aria-label", "Start from");
  for (const rule of PLASTIC_RULE_LIBRARY) fromSelect.add(new Option(rule.name, rule.name));
  const addRule = document.createElement("button");
  addRule.type = "button";
  addRule.className = "aui-button";
  addRule.textContent = "Add rule";

  const ruleActionBar = document.createElement("div");
  ruleActionBar.className = "cad-window-actions";
  ruleActionBar.append(activate, addRule);

  rulesSection.body.append(
    rulesBox.element,
    win.row("Selected", ruleSelect),
    win.row("New name", nameInput),
    win.row("Template", fromSelect),
    ruleActionBar,
  );

  const propsSection = win.section("Rule parameters");
  const numeric = (label: string, key: keyof PlasticRule) => {
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.05";
    input.setAttribute("aria-label", label);
    input.onchange = () => attempt(() => setPlasticRule(draft, { name: selected, [key]: Number(input.value) }));
    return input;
  };
  const material = document.createElement("input");
  material.type = "text";
  material.setAttribute("aria-label", "Material");
  material.onchange = () => attempt(() => setPlasticRule(draft, { name: selected, material: material.value.trim() || undefined }));
  const thickness = numeric("Wall thickness (mm)", "thicknessMillimeters");
  const draftAngle = numeric("Draft (degrees)", "draftDegrees");
  const radius = numeric("Nominal radius (mm)", "nominalRadiusMillimeters");
  const clearance = numeric("Clearance (mm)", "clearanceMillimeters");
  propsSection.body.append(
    win.row("Material", material),
    win.row("Wall (mm)", thickness),
    win.row("Draft (°)", draftAngle),
    win.row("Radius (mm)", radius),
    win.row("Clearance (mm)", clearance),
  );

  const assignSection = win.section("Body assignment");
  const bodySelect = document.createElement("select");
  bodySelect.setAttribute("aria-label", "Body");
  const assignSelect = document.createElement("select");
  assignSelect.setAttribute("aria-label", "Rule for the body");
  const assign = document.createElement("button");
  assign.type = "button";
  assign.className = "aui-button";
  assign.textContent = "Assign to body";
  const assignActions = document.createElement("div");
  assignActions.className = "cad-window-actions";
  assignActions.append(assign);
  assignSection.body.append(
    win.row("Body", bodySelect),
    win.row("Rule", assignSelect),
    assignActions,
  );

  const note = document.createElement("p");
  note.className = "cad-form-note";
  note.textContent = "Boss, Rest, Lip and Snap Fit take their default draft, wall and clearance from the body's rule, else the active rule.";
  win.addHelp(note);

  const attempt = (change: () => PartDocument) => {
    try { draft = change(); win.setError(null); }
    catch (error) { win.setError((error as Error).message); }
    render();
  };
  const render = () => {
    const table = draft.plasticRules ?? { rules: [] };
    if (!table.rules.some((r) => r.name === selected)) selected = table.rules[0]?.name ?? "";
    ruleSelect.replaceChildren(...table.rules.map((r) => new Option(r.name + (r.name === table.active ? " (active)" : ""), r.name)));
    ruleSelect.value = selected;
    activate.disabled = !selected || table.active === selected;
    rulesBox.render(table.rules.map((r) => ({
      label: `${r.name} · ${r.thicknessMillimeters} mm · ${r.draftDegrees}°`,
      onRemove: () => attempt(() => removePlasticRule(draft, r.name)),
    })));
    const rule = table.rules.find((r) => r.name === selected);
    for (const input of [material, thickness, draftAngle, radius, clearance]) input.disabled = !rule;
    material.value = rule?.material ?? "";
    thickness.value = String(rule?.thicknessMillimeters ?? "");
    draftAngle.value = String(rule?.draftDegrees ?? "");
    radius.value = String(rule?.nominalRadiusMillimeters ?? "");
    clearance.value = String(rule?.clearanceMillimeters ?? "");
    const bodies = availableBodies(draft);
    bodySelect.replaceChildren(...bodies.map((b) => new Option(`${b.name}${plasticRuleFor(draft, b.id) ? ` · ${table.assignments?.[b.id] ?? "active rule"}` : ""}`, b.id)));
    assignSelect.replaceChildren(new Option("No rule (use active)", ""), ...table.rules.map((r) => new Option(r.name, r.name)));
    assign.disabled = !bodies.length;
  };
  ruleSelect.onchange = () => { selected = ruleSelect.value; render(); };
  activate.onclick = () => attempt(() => setActivePlasticRule(draft, selected));
  addRule.onclick = () => {
    const name = nameInput.value.trim();
    attempt(() => setPlasticRule(draft, { name }, fromSelect.value));
    if (!win.panel.querySelector(".aui-feature-error:not([hidden])")) {
      selected = name;
      nameInput.value = "";
      render();
    }
  };
  assign.onclick = () => attempt(() => assignPlasticRule(draft, [bodySelect.value], assignSelect.value || null));
  render();
}

export function mountPlasticRulesCommands(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
) {
  const release = cadCommands.register("show-plastic-rules", () => openPlasticRulesWindow(getDocument, apply));
  cadCommands.setEnabled("show-plastic-rules", true);
  return release;
}
