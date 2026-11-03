import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createElement } from "react";
import { AetherIcon } from "@aether/ui";
/** Shared plumbing for the feature editors. One file per feature lives beside
 *  this one, each owning that feature's controls, its window layout, and its
 *  serialization — the three things that used to be spread across three
 *  parallel if/else chains in feature-authoring.ts.
 *
 *  Layouts mirror `core/ui/gallery/features/` exactly: same control types
 *  (pickers, sub-settings, entity boxes), same order, same captions. Where the
 *  engine cannot yet honour a gallery control it stays visible but disabled
 *  with a "Planned" title — the gallery shows the target, this shows the truth. */
import type { openFeatureWindow } from "@aether/ui";
import type { PartDocument } from "@aether/core/document";
import type { FeatureLaunchOptions } from './toolbar-presets';

export type FeatureWindow = ReturnType<typeof openFeatureWindow>;
export type Control = HTMLInputElement | HTMLSelectElement;
export type Controls = Record<string, Control>;

export interface FeatureEditorContext extends FeatureLaunchOptions {
  win: FeatureWindow;
  form: HTMLFormElement;
  /** Unit-aware field factory. `(mm)`/`(degrees)` captions are rewritten to the
   *  document's configured unit and values converted on the way in and out. */
  field: (name: string, value: string, choices?: string[]) => Control;
  /** A `<select>` of earlier features of the given types, labelled by name. */
  reference: (label: string, types: string[], value?: string) => Control;
  /** The feature being edited, or undefined when adding. */
  feature: any;
  doc: PartDocument;
  lengthUnitLabel: string;
  angleUnitLabel: string;
}

export interface FeatureEditor {
  /** Feature `type` as stored in the document. */
  type: string;
  /** Viewport manipulators: `false` when the editor mounts its own; otherwise an optional
   *  map from a published handle parameter to the control key that holds it. */
  handles?: false | Record<string, string>;
  /** Build the form controls this feature needs. */
  controls(context: FeatureEditorContext): Controls;
  /** Lay the controls out in the window, gallery-exact. Optional: features
   *  without a bespoke layout fall back to plain label-left parameter rows. */
  layout?(context: FeatureEditorContext, controls: Controls): void;
  /** What this feature needs before it can be committed, checked live on every
   *  control change. Return an error message, or null when valid. The window
   *  disables its accept control while a message is showing, so an invalid
   *  feature cannot be submitted at all — the same discipline the plane window
   *  uses for its per-method reference count. */
  validate?(controls: Controls, context: FeatureEditorContext): string | null;
  /** Canonical (already unit-converted) values → the feature payload fields.
   *  Identity fields (id/type/name/suppressed) are added by the caller. */
  serialize(values: Record<string, string>, context: FeatureEditorContext): Record<string, unknown>;
}

/** A parameter row inside a nested sub-setting body — the gallery's `rowIn`. */
export function rowIn(label: string, ...controls: HTMLElement[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "aui-feature-row";
  const caption = document.createElement("span");
  caption.textContent = label;
  const control = document.createElement("span");
  control.className = "aui-feature-row-control";
  control.append(...controls);
  row.append(caption, control);
  return row;
}

export function unitSuffix(text: string): HTMLElement {
  const unit = document.createElement("span");
  unit.className = "aui-feature-unit";
  unit.textContent = text;
  return unit;
}

/** A control the gallery shows live but this engine cannot honour yet. Visible
 *  and disabled beats quietly absent: the shape of the feature stays legible. */
export function planned<T extends HTMLElement>(control: T): T {
  (control as unknown as { disabled: boolean }).disabled = true;
  control.title = "Planned — not functional yet.";
  control.setAttribute("aria-disabled", "true");
  for (const child of control.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")) child.disabled = true;
  return control;
}



/** Body-type and boolean-operation tab rows. Every solid feature in the gallery
 *  opens with these two, in this order. `operation` is the live control; the
 *  tabs drive it and the select itself is hidden but form-associated. */
export function bodyAndOperationTabs(
  win: FeatureWindow,
  form: HTMLFormElement,
  operation: Control,
  operationValues: readonly string[],
  creationMode?: Control,
) {
  const solids = win.tabs(["Solid", "Surface", "Thin"], creationMode?.value === "thin" ? 2 : 0);
  [...solids.children].forEach((tab, index) => {
    if (index === 1 || (index === 2 && !creationMode)) planned(tab as HTMLButtonElement);
    else if (creationMode) (tab as HTMLButtonElement).onclick = () => {
      creationMode.value = index === 2 ? "thin" : "solid";
      [...solids.children].forEach((other, i) => other.classList.toggle("active", i === index));
      creationMode.dispatchEvent(new Event("change"));
    };
  });
  if (creationMode) {
    creationMode.closest("label")?.remove(); creationMode.hidden = true;
    creationMode.setAttribute("form", form.id); form.append(creationMode);
  }
  operationTabs(win, form, operation, operationValues, ["New", "Add", "Remove", "Intersect"]);
}

/** One tab row driving a hidden, form-associated operation select: the gallery's
 *  Union/Subtract/Intersect or New/Add/Remove/Intersect row. Labels past the
 *  values the feature supports show as planned. */
export function operationTabs(win: FeatureWindow, form: HTMLFormElement, operation: Control, values: readonly string[], labels: string[]): HTMLElement {
  const ops = win.tabs(labels, Math.max(0, values.indexOf(operation.value)));
  const buttons = [...ops.children] as HTMLButtonElement[];
  buttons.forEach((tab, index) => {
    if (index >= values.length) { planned(tab); return; }
    tab.onclick = () => {
      operation.value = values[index];
      operation.dispatchEvent(new Event("change"));
      buttons.forEach((other, i) => other.classList.toggle("active", i === index));
    };
  });
  operation.closest("label")?.remove();
  operation.setAttribute("form", form.id);
  operation.hidden = true;
  form.append(operation);
  return ops;
}

/** The gallery's Entities box, backed by a real `<select>` of document features:
 *  the current choice shows as a removable chip, and clearing it reveals the
 *  select so another can be picked. */
export function entityChips(win: FeatureWindow, caption: string, source: Control, form: HTMLFormElement) {
  const box = win.entitiesBox(caption);
  // The box and its hidden list must not share one accessible name.
  box.element.setAttribute("aria-label", `${caption} selection`);
  source.closest("label")?.remove();
  source.setAttribute("form", form.id);
  // The list stays in the DOM for the suite and agents but is never shown, and an empty
  // box shows nothing but its caption (Jonathan, 2026-11-02): picks in the viewport fill it.
  source.hidden = true;
  box.element.append(source);
  const render = () => {
    const selected = (source as HTMLSelectElement).selectedOptions?.[0];
    box.render(
      source.value && selected
        ? [{ label: source.dataset.selectionLabel || selected.textContent || source.value, onRemove: () => { source.value = ""; source.dispatchEvent(new Event("change")); } }]
        : [],
    );
  };
  source.addEventListener("change", render);
  source.addEventListener("aether-selection-label", render);
  render();
  return box;
}

/** The common case: named controls that must hold a selection. Nothing is
 *  pre-selected for the user, so "empty" always means "not yet chosen". */
export function requireSelections(
  controls: Controls,
  required: readonly { key: string; noun: string }[],
): string | null {
  const missing = required.filter(({ key }) => !controls[key]?.value);
  if (!missing.length) return null;
  const nouns = missing.map((m) => m.noun);
  const list =
    nouns.length === 1 ? nouns[0] : `${nouns.slice(0, -1).join(", ")} and ${nouns.at(-1)}`;
  return `Select ${list} to continue.`;
}

/** Standard parameter rows shared by the fallback and conditional editors. */
export function layoutParameterRows(
  {win,form}: FeatureEditorContext,
  custom?: (control: Control)=>boolean,
): Map<Control,HTMLElement> {
  const rows=new Map<Control,HTMLElement>();
  for(const label of [...form.querySelectorAll('label')]) {
    const input=label.querySelector<HTMLInputElement|HTMLSelectElement>('input,select');
    if(!input || custom?.(input))continue;
    let caption=(label.firstChild?.textContent ?? input.getAttribute('aria-label') ?? '').trim();
    // Only a unit in the trailing parenthesis becomes a suffix; "(optional)" is part of the caption.
    const match=caption.match(/\((mm|cm|m|in|ft|deg|rad|°|%)\)\s*$/i);
    if(match)caption=caption.slice(0,match.index).trim();
    input.setAttribute('form',form.id);
    rows.set(input,win.row(caption,input,...(match ? [unitSuffix(match[1])] : [])));
    label.remove();
  }
  return rows;
}

/** A checkbox row bound to a hidden yes/no or true/false field, as Onshape's option rows. */
export function checkRow(context: FeatureEditorContext, control: Control, label: string, onChange?: () => void): HTMLElement {
  const { win, form } = context;
  control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control);
  const yes = control.value === "yes" || control.value === "no";
  const box = document.createElement("input"); box.type = "checkbox"; box.setAttribute("aria-label", label); box.checked = control.value === "true" || control.value === "yes";
  box.onchange = () => { control.value = yes ? (box.checked ? "yes" : "no") : String(box.checked); onChange?.(); control.dispatchEvent(new Event("change")); };
  control.addEventListener("change", () => { box.checked = control.value === "true" || control.value === "yes"; });
  const row = win.row(label, box);
  return row;
}

/** Aether UI's glyph icon button (IconButton appearance "glyph", small) for vanilla windows:
 *  flips, reorders and the like. The icon comes from the shared assets pack. */
export function iconButton(icon: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button"; button.className = "aui-icon-button"; button.dataset.appearance = "glyph"; button.dataset.size = "small";
  button.title = label; button.setAttribute("aria-label", label);
  // Synchronous, as the window chrome renders: nothing left for React to schedule later.
  flushSync(() => createRoot(button).render(createElement(AetherIcon, { name: icon as never })));
  return button;
}
