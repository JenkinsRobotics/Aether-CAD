import { openCADFeatureWindow } from "../features/feature-window-style";
import type { FeatureWindow } from "@aether/ui";
import { cadCommands, type CADCommandID } from "../cad-command-registry";
import "./tool-window.css";

type Editor = "coordinates" | "modify" | "constraints" | "variables" | "clipboard" | "text" | "import" | "vector";
/** One visible, ribbon-launched editor at a time. Inactive drafts are detached,
 * not an offscreen UI used as a command bus. */
export function createSketchToolWindow(root: HTMLElement, enabled: () => boolean, select: () => void, onClose?: () => void) {
  const sections = new Map<Editor, { title: string; element: HTMLElement }>();
  let window: FeatureWindow | undefined;
  let strip: HTMLElement | undefined;
  let active: Editor | undefined;
  const helpNotes = new Map<HTMLElement, Comment>();
  const styleControls = () => {
    for (const [note, placeholder] of helpNotes) {
      if (!window?.body.contains(placeholder)) { note.remove(); helpNotes.delete(note); }
    }
    if (window) for (const note of window.body.querySelectorAll<HTMLElement>("[data-feature-help]")) {
      const placeholder = document.createComment("Feature instructions are in Help");
      note.replaceWith(placeholder);
      helpNotes.set(note, placeholder);
      window.addHelp(note);
    }
    for (const button of root.querySelectorAll(".sketch-tool-fields button")) button.classList.add("aui-button");
  };
  const observer = new globalThis.window.MutationObserver(styleControls);
  observer.observe(root, { childList: true, subtree: true });
  const close = () => {
    if (active) onClose?.();
    for (const [note, placeholder] of helpNotes) placeholder.replaceWith(note);
    helpNotes.clear();
    if (active) sections.get(active)?.element.remove();
    window?.close(); window = undefined; strip?.remove(); strip = undefined; active = undefined;
    refresh();
  };
  const show = (id: Editor) => {
    if (!enabled()) return;
    if (active === id) return;
    if (!active) onClose?.();
    close();
    const section = sections.get(id);
    if (!section) return;
    active = id;
    refresh();
    // Drawing tools are not features (Jonathan, 2026-10-31): their typed entry
    // sits in a strip inside the sketch, not in a window with Done and Cancel.
    if (id === "coordinates") {
      strip = document.createElement("div");
      strip.className = "cad-sketch-tool-strip";
      strip.append(section.element);
      root.append(strip);
      styleControls();
      return;
    }
    window = openCADFeatureWindow({
      viewport: root, className: "cad-sketch-tool-window", title: section.title, icon: "sketch", acceptLabel: "Done",
      onAccept: () => { select(); close(); }, onDiscard: () => { select(); close(); },
    });
    const picker = document.createElement("select");
    picker.setAttribute("aria-label", "Sketch editor");
    for (const [value, { title }] of sections) {
      const option = document.createElement("option");
      option.value = value; option.textContent = title; picker.append(option);
    }
    picker.value = id; picker.onchange = () => show(picker.value as Editor);
    window.body.append(picker);
    window.body.append(section.element);
    styleControls();
    // These editors already group their fields with standard disclosures.
    for (const details of section.element.querySelectorAll(":scope > details, :scope > section > details"))
      (details as HTMLDetailsElement).open = true;
  };
  const commands: [CADCommandID, Editor][] = [
    ["sketch-coordinates", "coordinates"], ["sketch-constraints", "constraints"],
    ["sketch-vector", "vector"], ["sketch-variables", "variables"], ["sketch-clipboard", "clipboard"],
  ];
  function refresh() {
    // A tool temporarily owns the editor surface. Restore the sketch settings
    // when it closes instead of stacking two windows with duplicate footers.
    const sketchWindow = root.querySelector<HTMLElement>(".cad-sketch-window");
    // The sketch feature window stays up while drawing (Jonathan, 2026-11-01); only a real editor window replaces it.
    if (sketchWindow) sketchWindow.hidden = Boolean(active) && active !== "coordinates";
    for (const [command, editor] of commands) {
      cadCommands.setEnabled(command, enabled());
      cadCommands.setActive(command, active === editor);
    }
  }
  const disposeCommands = commands.map(([command, editor]) => cadCommands.register(command, () => show(editor)));
  const text = () => { if (active !== "text") select(); show("text"); };
  const dxf = () => { if (active !== "import") select(); show("import"); };
  // Capture opens the real editor before its existing field/focus handlers run.
  globalThis.window.addEventListener("aether-sketch-text", text, true);
  globalThis.window.addEventListener("aether-sketch-import-dxf", dxf, true);
  return {
    section(id: Editor, title: string) {
      const element = document.createElement("div");
      element.className = "sketch-tool-fields";
      element.dataset.editor = id;
      sections.set(id, { title, element });
      return element;
    },
    show, close, refresh, active: () => active,
    setTitle(id: Editor, title: string) {
      const section = sections.get(id); if (!section) return;
      section.title = title;
      if (active === id && window) {
        const heading = window.panel.querySelector<HTMLElement>('.aui-float-panel-title');
        if (heading) { heading.textContent = title; heading.title = title; }
      }
    },
    dispose() {
      observer.disconnect(); close(); disposeCommands.forEach(dispose => dispose());
      globalThis.window.removeEventListener("aether-sketch-text", text, true);
      globalThis.window.removeEventListener("aether-sketch-import-dxf", dxf, true);
      sections.clear();
    },
  };
}
