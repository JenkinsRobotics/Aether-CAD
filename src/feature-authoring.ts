import { mountConstructionCommands } from "./construction-commands";
import { mountEditHistory, featurePreviewDocument } from "./modeling/edit-history";
import { mountFeaturePreview } from "./modeling/feature-preview";
import { openProjectionEditor } from "./sketch/projection-editor";
import { assignItems, canNestFolder, createFolder, deleteFolder, emptyTreeOrganization, moveFolder, renameFolder } from "@aether/core/document";
import { rectangleSketchRevision } from "@aether/core/sketch";
import { openSketchWorkspace } from "./sketch-workspace";
import { openPlaneWindow } from "./plane-window";
import { openFeatureWindow } from "@aether/ui";
import { addFeatureViewControls } from './features/view-controls';
import { featureEditor } from "./features";
import { layoutParameterRows, type FeatureEditor, type FeatureEditorContext } from "./features/shared";
import { unitChoice } from "@aether/core/units";
import { documentUnits } from "./document-preferences";
import {
  rollbackPosition,
  insertFeature,
  setFeatureSuppressed,
  removeFeature,
  moveFeature,
  availableBodies,
  dependentFeatures,
} from "@aether/core/document";
import { cadCommands } from "./cad-command-registry";
import type { PartDocument, PartFeature } from "@aether/core/document";
import {
  activeProject,
  editHostedProject,
  listHostedParts,
  updateHostedLink,
} from "./host-library";
import "./feature-authoring.css";
/** Presentation only. Core validates and evaluates every submitted feature. */
export function mountFeatureAuthoring(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
) {
  mountConstructionCommands(getDocument, apply);
  const actions = document.createElement("div");
  const error = document.createElement("p");
  error.className = "feature-command-error";
  error.setAttribute("role", "alert");
  document.querySelector(".cad-studio-viewport")?.append(error);
  cadCommands.register("sketch-project",()=>{
    try { openProjectionEditor(getDocument,apply); error.textContent=""; }
    catch(e){error.textContent=(e as Error).message;}
  });
  cadCommands.setEnabled("sketch-project",true);
  const button = (
    label: string,
    run: () => void,
    parent: HTMLElement = actions,
  ) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.type = "button";
    b.onclick = run;
    parent.append(b);
    return b;
  };

/** Present dialog controls with the gallery's feature-window anatomy:
 * tab rows, entity chips, label-left parameter rows with unit suffixes.
 * Per-feature layout lives in `src/features/<feature>.ts`; anything a feature
 * does not lay out itself falls through to plain parameter rows.
 * Presentation only — inputs keep their form association and submit path. */
const presentFeatureWindow = (
  win: ReturnType<typeof openFeatureWindow>,
  form: HTMLFormElement,
  controls: Record<string, HTMLInputElement | HTMLSelectElement>,
  editor: FeatureEditor | undefined,
  context: FeatureEditorContext,
) => {
  form.id ||= "cad-feature-form";
  editor?.layout?.(context, controls);
  layoutParameterRows(context);
  win.body.append(form);
};

  let finishingSketch = false;
  const show = (type: string, existing?: PartFeature, initialOperation?: "cut", initialTransform?: "translate"|"rotate"|"scale"|"copy") => {
    // Reaching for a solid feature while the sketch editor is open means the
    // sketch is done: commit it and let the feature open on the result,
    // rather than leaving both windows up over each other.
    if (
      type !== "plane" &&
      type !== "profile" &&
      document.querySelector(".cad-sketch-workspace")
    ) {
      if (finishingSketch) return;
      finishingSketch = true;
      const event = new CustomEvent("aether-sketch-finish", {
        cancelable: true,
        detail: {complete: (success: boolean) => {
          finishingSketch = false;
          if (success) show(type, existing, initialOperation, initialTransform);
        }},
      });
      window.dispatchEvent(event);
      if (!event.defaultPrevented) finishingSketch = false;
      return;
    }
    if (type === "plane") {
      void openPlaneWindow(getDocument, apply, existing?.type === "plane" ? existing : undefined);
      return;
    }
    if (type === "profile") {
      if(existing?.type === "profile" && existing.profile.type === "projection") {
        try { openProjectionEditor(getDocument,apply,existing); } catch(e){error.textContent=(e as Error).message;}
        return;
      }
      openSketchWorkspace(getDocument, apply, existing?.type === "profile" ? existing : undefined);
      return;
    }
    const source = getDocument();
    if (!source) {
      error.textContent = "Create or open a Part first.";
      return;
    }
    const doc = structuredClone(source);
    const feature = existing as any;
    const form = document.createElement("form");
    const win = openFeatureWindow({
      viewport: document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body,
      className: "cad-feature-dialog",
      title: type === "offset-face" ? feature?.name ?? "Move faces" : type === "import-cad" ? "Edit CAD import" : type === "face-extrude" ? (feature?.name ?? "Push/Pull") : type === "extrude" ? feature?.name ?? `Extrude ${doc.features.length + 1}` : (existing ? "Edit " : "Add ") + type,
      acceptLabel: "Apply and rebuild",
      discardLabel: "Cancel",
      onAccept: () => form.requestSubmit(),
      onDiscard: () => win.close(),
    });
    win.body.append(form);
    addFeatureViewControls(win);
    const lengthUnit = unitChoice(documentUnits(), "length"),
      angleUnit = unitChoice(documentUnits(), "angle");
    const field = (name: string, value: string, choices?: string[]) => {
      const factor = name.includes("(mm)")
        ? lengthUnit.factor / 0.001
        : name.includes("(degrees)")
          ? angleUnit.factor / (Math.PI / 180)
          : 1;
      const original = value;
      if ((name.includes("(mm)") || name.includes("(degrees)")) && !choices)
        value = value.replace(
          /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g,
          (n) =>
            (Number(n) / factor).toFixed(
              name.includes("(mm)") ? lengthUnit.decimals : angleUnit.decimals,
            ),
        );
      name = name
        .replace("(mm)", `(${lengthUnit.unit})`)
        .replace("(degrees)", `(${angleUnit.unit})`);
      const label = document.createElement("label");
      label.textContent = name;
      const input = choices
        ? document.createElement("select")
        : document.createElement("input");
      // Shared field sizing/style selectors require an explicit text type.
      if (input instanceof window.HTMLInputElement) input.type = "text";
      if (choices)
        for (const value of choices) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          input.append(option);
        }
      input.value = value;
      input.name = name;
      input.dataset.canonicalFactor = String(factor);
      input.dataset.originalValue = original;
      input.dataset.displayValue = value;
      input.setAttribute("aria-label", name);
      label.append(input);
      form.append(label);
      return input;
    };
    const name = field(
      "Name",
      feature?.name ??
        (type === "offset-face" ? "Move faces" : type === "face-extrude" ? "Push/Pull" : type[0].toUpperCase() + type.slice(1)) + " " + (doc.features.length + 1),
    );
    if (type === "extrude") { name.closest("label")?.remove(); name.hidden = true; form.append(name); }
    const before = existing
      ? doc.features.slice(
          0,
          doc.features.findIndex((f) => f.id === existing.id),
        )
      : doc.features.slice(0, rollbackPosition(doc));
    // IDs stay canonical; option labels are human-readable feature names.
    const reference = (label: string, types: string[], value?: string) => {
      const choices = before.filter((f) => types.includes(f.type) && !f.suppressed);
      // Nothing is pre-selected. Auto-picking the last matching feature looked
      // like a choice the user had made, and hid the fact that the feature was
      // not yet valid. An empty select always means "not yet chosen".
      const select = field(label, value ?? "", ["", ...choices.map((f) => f.id)]);
      Array.from(select.children).forEach((option, index) => {
        option.textContent = index === 0 ? "" : choices[index - 1].name;
      });
      return select;
    };
    const editor = featureEditor(type);
    const context: FeatureEditorContext = {
      win,
      form,
      field,
      reference,
      feature,
      initialOperation,
      initialTransform,
      doc,
      lengthUnitLabel: lengthUnit.unit,
      angleUnitLabel: angleUnit.unit,
    };
    const controls: Record<string, HTMLInputElement | HTMLSelectElement> =
      editor?.controls(context) ?? {};
    // Target body is shared by every solid feature, so it stays here rather
    // than being repeated in each editor.
    const bodies = availableBodies({
      ...doc,
      features: before,
      rollbackIndex: undefined,
    });
    controls.target = field(
      "Target body",
      feature?.targetBodyId ?? bodies.at(-1)?.id ?? "",
      bodies.map((b) => b.id),
    );
    Array.from(controls.target.children).forEach(
      (o, i) => (o.textContent = bodies[i].name),
    );
    const targetVisibility = () => {
      // The window moves each control into its own row and drops the original
      // <label>, so the row has to be looked for first. `closest` is typed
      // Element, which carries no `hidden`.
      const row = (controls.target.closest(".aui-feature-row") ??
        controls.target.parentElement) as HTMLElement | null;
      if (row) row.hidden = ["offset-face","transform"].includes(type) || controls.operation?.value === "new" || controls.scopeMode?.value === "all";
    };
    controls.operation?.addEventListener("change", targetVisibility);
    controls.scopeMode?.addEventListener("change", targetVisibility);
    targetVisibility();
    const alert = document.createElement("p");
    alert.setAttribute("role", "alert");
    form.append(alert);
    // The window header ✓/✕ are the commit controls (gallery anatomy);
    // a hidden submit keeps native Enter submission working.
    const submit = button("Apply and rebuild", () => {}, form);
    submit.type = "submit";
    submit.hidden = true;
    presentFeatureWindow(win, form, controls, editor, context);
    targetVisibility();
    // Validate live, exactly like the plane window: the accept control stays
    // disabled while the feature is incomplete, so an invalid feature can never
    // be submitted and then rejected.
    const validate = () => win.setError(editor?.validate?.(controls, context) ?? null);
    for (const control of Object.values(controls)) {
      control.addEventListener("change", validate);
      control.addEventListener("input", validate);
    }
    validate();
    const draftId = existing?.id ?? crypto.randomUUID();
    win.panel.dataset.featureId = draftId;
    const candidateDocument = () => {
        const invalid = editor?.validate?.(controls, context);
        if (invalid) throw new Error(invalid);
        const values = Object.fromEntries(
          Object.entries(controls).map(([k, v]) => [
            k,
            v instanceof window.HTMLSelectElement && v.multiple ? Array.from(v.selectedOptions, option => option.value).join(",") :
            v.value === v.dataset.displayValue
              ? (v.dataset.originalValue ?? v.value)
              : Number(v.dataset.canonicalFactor ?? 1) === 1
                ? v.value
                : v.value.replace(
                    /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g,
                    (n) =>
                      String(Number(n) * Number(v.dataset.canonicalFactor)),
                  ),
          ]),
        );
        const next: any = {
          id: draftId,
          type,
          name: name.value,
          suppressed: feature?.suppressed ?? false,
          ...(editor?.serialize(values, context) ?? {}),
        };
        if (feature?.bodyId) next.bodyId = feature.bodyId;
        if (!["offset-face","transform"].includes(type) && values.target && values.operation !== "new" && next.scopeMode!=="all")
          next.targetBodyId = values.target;
        const candidate = structuredClone(doc);
        if (existing) candidate.features[candidate.features.findIndex(f => f.id === existing.id)] = next;
        return existing ? candidate : insertFeature(candidate, next);

    };
    mountEditHistory(win.panel, source, existing?.id);
    const preview = mountFeaturePreview(win.body, () => featurePreviewDocument(candidateDocument(), existing?.id), message => win.setError(message));
    for (const control of [...Object.values(controls), name]) {
      control.addEventListener("input", preview.update);
      control.addEventListener("change", preview.update);
    }
    preview.update();
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      alert.textContent = "";
      try {
        const candidate = candidateDocument();
        preview.pause();
        await apply(candidate);
        refresh();
        win.close();
      } catch (e) {
        alert.textContent = (e as Error).message;
      } finally {
        submit.disabled = false;
      }
    };
    if (existing && type !== "extrude") {
      button(
        "Move earlier",
        async () => {
          try {
            await apply(moveFeature(source, existing.id, -1));
            win.close();
          } catch (e) {
            alert.textContent = (e as Error).message;
          }
        },
        form,
      );
      button(
        "Move later",
        async () => {
          try {
            await apply(moveFeature(source, existing.id, 1));
            win.close();
          } catch (e) {
            alert.textContent = (e as Error).message;
          }
        },
        form,
      );
      button(
        "Delete feature",
        async () => {
          const affected = dependentFeatures(source, existing.id);
          if (
            !confirm(
              `Delete ${existing.name}${affected.size > 1 ? ` and ${affected.size - 1} dependent features` : ""}?`,
            )
          )
            return;
          try {
            await apply(removeFeature(source, existing.id));
            win.close();
          } catch (e) {
            alert.textContent = (e as Error).message;
          }
        },
        form,
      );
    }

  };
  let busy = false;
  const change = async (doc: PartDocument) => {
    if (busy) return;
    busy = true;
    error.textContent = "";
    try {
      await apply(doc);
    } catch (e) {
      error.textContent = (e as Error).message;
    } finally {
      busy = false;
      refresh();
    }
  };
  // The canonical apply path refreshes the shared Model tree.
  const refresh = () => {};
  /** The feature-tree selection the action arrived with, in history order, or
   *  just the clicked feature when it is not part of that selection. */
  const selectionWith = (
    doc: PartDocument,
    action: { selectedFeatureIDs?: readonly string[] },
    clicked: PartFeature,
  ): string[] => {
    const selected = new Set(action.selectedFeatureIDs ?? []);
    if (!selected.has(clicked.id)) return [clicked.id];
    return doc.features.filter((feature) => selected.has(feature.id)).map((feature) => feature.id);
  };
  window.addEventListener("aether-feature-action", (event) => {
    const action = (event as CustomEvent).detail;
    const doc = getDocument();
    if (!doc) return;
    if (action.type === "rollback-to") {
      const index = Math.max(0, Math.min(doc.features.length, action.index));
      void change({ ...doc, rollbackIndex: index >= doc.features.length ? undefined : index });
      return;
    }
    if (action.type === "create-folder") {
      const name = prompt("Folder name", `Folder ${(doc.organization?.folders.length ?? 0) + 1}`);
      if (!name?.trim()) return;
      const memberIDs = (action.memberIDs as readonly string[]).map((rowID) => rowID.split("/").slice(2).join("/")).filter(Boolean);
      void change({ ...doc, organization: createFolder(doc.organization ?? emptyTreeOrganization(), { id: crypto.randomUUID(), name }, memberIDs) });
      return;
    }
    const folderID = typeof action.id === "string" && action.id.startsWith("folder/") ? action.id.slice("folder/".length) : null;
    if (folderID && action.type === "item-action") {
      const organization = doc.organization ?? emptyTreeOrganization();
      if (action.actionID === "folder-rename" || action.actionID === "edit-feature") {
        const current = organization.folders.find((entry) => entry.id === folderID);
        const name = prompt("Folder name", current?.name ?? "Folder");
        if (name?.trim()) void change({ ...doc, organization: renameFolder(organization, folderID, name) });
      } else if (action.actionID === "folder-delete") {
        void change({ ...doc, organization: deleteFolder(organization, folderID) });
      } else if (action.actionID === "folder-unnest") {
        void change({ ...doc, organization: moveFolder(organization, folderID, null) });
      }
      return;
    }
    const id = action.id.split("/").slice(2).join("/");
    const f = doc.features.find((f) => f.id === id);
    if (action.type === "move-item") {
      if (folderID && action.targetID.startsWith("folder/") && action.position === "inside") {
        const organization = doc.organization ?? emptyTreeOrganization();
        const targetFolder = action.targetID.slice("folder/".length);
        if (canNestFolder(organization, folderID, targetFolder)) {
          void change({ ...doc, organization: moveFolder(organization, folderID, targetFolder) });
        }
        return;
      }
      if (f && action.targetID.startsWith("folder/") && action.position === "inside") {
        void change({ ...doc, organization: assignItems(doc.organization ?? emptyTreeOrganization(), [f.id], action.targetID.slice("folder/".length)) });
        return;
      }
      const target = action.targetID.split("/").slice(2).join("/");
      const targetIndex = doc.features.findIndex((f) => f.id === target);
      // A drop that lands on anything but a feature (past the end of the list,
      // a folder rule, the bar itself) means "the end" — never index -1.
      let position = targetIndex < 0
        ? doc.features.length
        : targetIndex + (action.position === "after" ? 1 : 0);
      if (action.id === "rollback-bar")
        void change({
          ...doc,
          rollbackIndex: Math.min(Math.max(position, 0), doc.features.length),
        });
      else if (f) {
        const index = doc.features.indexOf(f);
        if (index < position) position--;
        try {
          const moved = moveFeature(doc, f.id, position - index);
          // Reordering next to a foldered feature adopts that feature's folder.
          const organization = moved.organization;
          void change(organization ? { ...moved, organization: assignItems(organization, [f.id], organization.membership[target] ?? null) } : moved);
        } catch (e) {
          error.textContent = (e as Error).message;
        }
      }
      return;
    }
    if (action.actionID === "edit-feature" && f) {
      if (f.type === "sketch") {
        const state = rectangleSketchRevision(f);
        const x=f.profile.centerXMillimeters, y=f.profile.centerYMillimeters;
        const w=state.widthMillimeters/2, h=state.heightMillimeters/2;
        openSketchWorkspace(getDocument, apply, {id:f.id, name:f.name, type:"profile", suppressed:f.suppressed, plane:f.plane, offsetMillimeters:0,
          profile:{type:"polygon", pointsMillimeters:[[x-w,y-h],[x+w,y-h],[x+w,y+h],[x-w,y+h]]}});
        return;
      }
      show(f.type, f);
    } else if (action.actionID === "suppress-feature" && f) {
      const target = !f.suppressed;
      void change(selectionWith(doc, action, f).reduce(
        (next, id) => next.features.some((feature) => feature.id === id && feature.suppressed !== target)
          ? setFeatureSuppressed(next, id, target)
          : next,
        doc,
      ));
    } else if (action.actionID === "delete-feature" && f) {
      const ids = selectionWith(doc, action, f);
      const affected = new Set(ids.flatMap((id) => [...dependentFeatures(doc, id)]));
      const extra = affected.size - ids.length;
      const what = ids.length > 1 ? `${ids.length} features` : f.name;
      if (!confirm(`Delete ${what}?${extra > 0 ? ` ${extra} dependent feature${extra > 1 ? "s" : ""} will remain with missing-reference errors.` : ""}`)) return;
      try {
        void change(ids.reduce(
          (next, id) => next.features.some((feature) => feature.id === id) ? removeFeature(next, id) : next,
          doc,
        ));
      } catch (e) {
        window.alert((e as Error).message);
      }
    }
    else if (action.actionID === "rollback-before" && f)
      void change({ ...doc, rollbackIndex: doc.features.indexOf(f) });
    else if (action.actionID === "rollback-start")
      void change({ ...doc, rollbackIndex: 0 });
    else if (action.actionID === "rename-feature" && f) {
      const name = prompt("Feature name", f.name);
      if (name?.trim()) void change({ ...doc, features: doc.features.map((feature) => feature.id === f.id ? { ...feature, name } : feature) });
    }
    else if (action.actionID === "rollback-back" || action.actionID === "rollback-forward") {
      const current = doc.rollbackIndex ?? doc.features.length;
      const index = Math.max(0, Math.min(doc.features.length, current + (action.actionID === "rollback-back" ? -1 : 1)));
      void change({ ...doc, rollbackIndex: index >= doc.features.length ? undefined : index });
    }
    else if (action.actionID === "rollback-end")
      void change({ ...doc, rollbackIndex: undefined });
    else if (
      action.actionID === "body-visibility" ||
      action.actionID === "body-rename"
    ) {
      const body = availableBodies(doc).find((b) => b.id === id);
      if (!body) return;
      const name =
        action.actionID === "body-rename"
          ? prompt("Body name", body.name)
          : body.name;
      if (!name?.trim()) return;
      void change({
        ...doc,
        bodyProperties: {
          ...doc.bodyProperties,
          [id]: {
            ...doc.bodyProperties?.[id],
            name: name.trim(),
            visible:
              action.actionID === "body-visibility"
                ? !body.visible
                : body.visible,
          },
        },
      });
    }
  });
  for(const mode of ['translate','rotate','scale','copy'] as const)cadCommands.register(`transform-${mode}`,()=>show('transform',undefined,undefined,mode));
  cadCommands.register("feature-cut", () => show("extrude", undefined, "cut"));
  for (const type of [
    "plane",
    "profile",
    "extrude",
    "revolve",
    "mirror",
    "fillet",
    "chamfer",
    "sweep",
    "transform",
    "offset-face",
    "face-extrude",
    "shell",
    "hole",
    "loft",
    "draft",
    "pattern",
    "boolean",
  ] as const) {
    cadCommands.register(`feature-${type}`, () => show(type));
    cadCommands.setEnabled(`feature-${type}`, true);
  }
  return refresh;
}
export function mountProjectTabs() {
  const target = document.querySelector("[data-cad-project-commands]");
  if (!activeProject || !target) return;
  document.querySelector(".project-tabs")?.remove();
  const bar = document.createElement("nav");
  bar.className = "project-tabs";
  bar.setAttribute("aria-label", "Project items");
  const historical = new URLSearchParams(location.search).get("revision");
  if (historical) {
    const badge = document.createElement("strong");
    badge.textContent = "Read-only revision " + historical;
    bar.append(badge);
  }
  // Element tabs and adding Part Studios/Assemblies live in the React
  // DocumentTabBar (CADDocumentTabs); this bar keeps the linking commands.
  const choose = document.createElement("button");
  choose.textContent = "Link standalone Part";
  choose.onclick = async () => {
    try {
      const parts = await listHostedParts();
      const dialog = document.createElement("dialog");
      dialog.className = "feature-dialog";
      const form = document.createElement("form");
      const label = document.createElement("label");
      label.textContent = "Choose a Part (pins its current saved revision)";
      const select = document.createElement("select");
      for (const part of parts) {
        const o = document.createElement("option");
        o.value = part.id;
        o.textContent = part.name + " · r" + part.revision;
        select.append(o);
      }
      label.append(select);
      form.append(label);
      const submit = document.createElement("button");
      submit.textContent = "Link Part";
      submit.disabled = !parts.length;
      form.append(submit);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.onclick = () => dialog.remove();
      form.append(cancel);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const part = parts.find((p) => p.id === select.value)!;
        try {
          await editHostedProject("link_part", part.name, {
            source_id: part.id,
            source_revision: part.revision,
          });
          location.reload();
        } catch (e) {
          alert((e as Error).message);
        }
      };
      dialog.append(form);
      document.body.append(dialog);
      dialog.showModal();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  bar.append(choose);
  const assemblyId = new URLSearchParams(location.search).get("assembly");
  if (assemblyId) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Project Part to insert");
    for (const part of activeProject.parts) {
      const o = document.createElement("option");
      o.value = part.id;
      o.textContent = part.name;
      select.append(o);
    }
    bar.append(select);
    const insert = document.createElement("button");
    insert.textContent = "Insert project Part";
    insert.onclick = async () => {
      const part = activeProject!.parts.find((p) => p.id === select.value);
      if (!part) return;
      try {
        await editHostedProject("insert_part", part.name, {
          assembly_id: assemblyId,
          part_id: part.id,
        });
        location.reload();
      } catch (e) {
        alert((e as Error).message);
      }
    };
    bar.append(insert);
  }
  const activePart = new URLSearchParams(location.search).get("part");
  const linked = activeProject.parts.find(
    (p) => p.id === activePart && p.source?.kind === "linked",
  );
  if (linked) {
    const update = document.createElement("button");
    update.textContent = "Update linked Part to latest saved revision";
    update.onclick = async () => {
      try {
        await updateHostedLink(linked.id);
        location.reload();
      } catch (e) {
        alert((e as Error).message);
      }
    };
    bar.append(update);
  }
  const home = document.createElement("a");
  home.href = "/cad/";
  home.textContent = "Files & revision history";
  bar.append(home);
  // The status bar hosts these document commands; body is the fallback.
  target.append(bar);
}
