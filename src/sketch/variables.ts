import {
  evaluateDocumentVariables,
  exportVariables,
  importVariables,
  expressionFunctions,
  expressionUnits,
  type DocumentVariable,
} from "@aether/core/document";
import {
  regenerateSketchTextExpressions,
  regenerateDimensionExpressions,
  type SketchDrawing,
} from "@aether/core/sketch";

/** Edits a sketch-local draft. The owner includes both outputs in one undo step. */
export function mountSketchVariables(
  parent: HTMLElement,
  state: () => { drawing: SketchDrawing; variables?: DocumentVariable[] },
  commit: (drawing: SketchDrawing, variables: DocumentVariable[]) => void,
) {
  const root = document.createElement("details"),
    title = document.createElement("summary");
  title.textContent = "Document variables";
  const rows = document.createElement("div"),
    add = document.createElement("button"),
    apply = document.createElement("button"),
    exportCsv = document.createElement("button"),
    importCsv = document.createElement("button"),
    importFile = document.createElement("input"),
    hints = document.createElement("datalist"),
    status = document.createElement("p");
  add.textContent = "Add variable";
  apply.textContent = "Apply variables to sketch";
  exportCsv.textContent = "Export CSV"; importCsv.textContent = "Import CSV";
  add.type = apply.type = exportCsv.type = importCsv.type = "button";
  importFile.type = "file"; importFile.accept = ".csv,.json,text/csv,application/json"; importFile.hidden = true; importFile.setAttribute("aria-label", "Variables file");
  hints.id = `variable-hints-${Math.random().toString(36).slice(2, 8)}`;
  status.setAttribute("role", "status");
  root.append(title, rows, add, apply, exportCsv, importCsv, importFile, hints, status);
  parent.append(root);
  let signature = "",
    disposed = false,
    generation = 0;
  const changed = () => {
    ++generation;
    apply.disabled = false;
  };
  /** Completion (SolidCraft's parameters.complete): every variable, the expression functions, units and constants. */
  const refreshHints = () => {
    hints.replaceChildren(...[
      ...readRows().map((v) => v.name).filter(Boolean).map((n) => `#${n}`),
      ...expressionFunctions.map((f) => `${f}(`), ...expressionUnits, "pi", "e",
    ].map((text) => { const option = document.createElement("option"); option.value = text; return option; }));
  };
  /** How many other variables and sketch expressions mention #name. */
  const usersOf = (name: string) => {
    if (!name) return 0;
    const pattern = new RegExp(`#${name}(?![A-Za-z0-9_])`);
    return readRows().filter((v) => v.name !== name && pattern.test(v.expression)).length + (pattern.test(JSON.stringify(state().drawing)) ? 1 : 0);
  };
  function row(value: DocumentVariable) {
    const group = document.createElement("fieldset"),
      name = document.createElement("input"),
      kind = document.createElement("select"),
      expression = document.createElement("input"),
      comment = document.createElement("input"),
      favorite = document.createElement("input"),
      users = document.createElement("span"),
      remove = document.createElement("button");
    comment.setAttribute("aria-label", "Variable comment"); comment.placeholder = "Comment"; comment.value = value.comment ?? "";
    favorite.type = "checkbox"; favorite.setAttribute("aria-label", "Favourite variable"); favorite.title = "Favourite"; favorite.checked = value.favorite === true;
    users.className = "sketch-variable-users"; users.textContent = `${usersOf(value.name)} users`; users.title = "Other variables and sketch expressions that use this variable";
    expression.setAttribute("list", hints.id);
    name.setAttribute("aria-label", "Variable name");
    name.value = value.name;
    kind.setAttribute("aria-label", "Variable type");
    for (const type of ["number", "length", "angle", "string"]) {
      const option = document.createElement("option");
      option.value = option.textContent = type;
      kind.append(option);
    }
    kind.value = value.kind;
    expression.setAttribute("aria-label", "Variable expression");
    expression.value = value.expression;
    remove.type = "button";
    remove.textContent = "Remove variable";
    remove.onclick = () => {
      group.remove();
      changed();
    };
    name.oninput = expression.oninput = kind.onchange = comment.oninput = favorite.onchange = changed;
    name.addEventListener("change", refreshHints);
    group.append(favorite, name, kind, expression, comment, users, remove);
    rows.append(group);
    refreshHints();
  }
  add.onclick = () => {
    row({ name: "", kind: "number", expression: "0" });
    changed();
  };
  function sync() {
    const current = JSON.stringify(state().variables);
    if (current === signature) return;
    signature = current;
    ++generation;
    apply.disabled = false;
    rows.replaceChildren();
    // Favourites first, the rest in document order.
    const list = state().variables ?? [];
    for (const value of [...list.filter((v) => v.favorite), ...list.filter((v) => !v.favorite)]) row(value);
  }
  function readRows(): DocumentVariable[] {
    return [...rows.children].map((group) => {
      const comment = group.querySelector<HTMLInputElement>('[aria-label="Variable comment"]')?.value.trim();
      const favorite = group.querySelector<HTMLInputElement>('[aria-label="Favourite variable"]')?.checked;
      return {
        name: group.querySelector<HTMLInputElement>('[aria-label="Variable name"]')!.value,
        kind: group.querySelector<HTMLSelectElement>("select")!.value as DocumentVariable["kind"],
        expression: group.querySelector<HTMLInputElement>('[aria-label="Variable expression"]')!.value,
        ...(comment ? { comment } : {}),
        ...(favorite ? { favorite: true } : {}),
      };
    });
  }
  exportCsv.onclick = () => {
    const url = URL.createObjectURL(new Blob([exportVariables({ variables: readRows() } as never, "csv")], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "variables.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Variables exported as CSV.";
  };
  importCsv.onclick = () => importFile.click();
  importFile.onchange = async () => {
    const file = importFile.files?.[0]; importFile.value = "";
    if (!file) return;
    try {
      const { document: next, added, replaced } = importVariables({ variables: readRows() } as never, await file.text());
      rows.replaceChildren(); for (const value of next.variables ?? []) row(value);
      changed(); status.textContent = `${added} variables added, ${replaced} replaced. Apply to keep them.`;
    } catch (error) { status.textContent = (error as Error).message; }
  };
  apply.onclick = async () => {
    const request = ++generation,
      source = structuredClone(state()),
      snapshot = JSON.stringify(source);
    apply.disabled = true;
    try {
      const variables = readRows();
      const resolved = evaluateDocumentVariables(variables);
      const drawing = regenerateDimensionExpressions(
        await regenerateSketchTextExpressions(source.drawing, resolved),
        resolved,
      );
      if (disposed || request !== generation) return;
      if (JSON.stringify(state()) !== snapshot)
        throw Error("The sketch changed. Review and apply variables again.");
      commit(drawing, variables);
      sync();
      status.textContent =
        "Variables applied to this draft. Apply saves all affected sketches; Cancel discards these changes.";
    } catch (error) {
      if (!disposed && request === generation)
        status.textContent = (error as Error).message;
    } finally {
      if (!disposed && request === generation) apply.disabled = false;
    }
  };
  sync();
  return {
    sync,
    pending: () =>
      JSON.stringify(readRows()) !== JSON.stringify(state().variables ?? []),
    dispose() {
      disposed = true;
      ++generation;
      root.remove();
    },
  };
}
