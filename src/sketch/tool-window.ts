import { openFeatureWindow, type FeatureWindow } from "@aether/ui";
import { cadCommands, type CADCommandID } from "../cad-command-registry";
import "./tool-window.css";

type Editor = "coordinates" | "modify" | "constraints" | "variables" | "clipboard" | "text" | "import" | "vector";
/** One visible, ribbon-launched editor at a time. Inactive drafts are detached,
 * not an offscreen UI used as a command bus. */
export function createSketchToolWindow(root: HTMLElement, enabled: () => boolean, select: () => void, onClose?: () => void) {
  const sections = new Map<Editor, { title: string; element: HTMLElement }>();
  let window: FeatureWindow | undefined;
  let active: Editor | undefined;
  const styleControls = () => {
    for (const button of root.querySelectorAll(".sketch-tool-fields button")) button.classList.add("aui-button");
  };
  const observer = new globalThis.window.MutationObserver(styleControls);
  observer.observe(root, { childList: true, subtree: true });
  const close = () => {
    if (active) onClose?.();
    if (active) sections.get(active)?.element.remove();
    window?.close(); window = undefined; active = undefined;
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
    window = openFeatureWindow({
      viewport: root, className: "cad-sketch-tool-window", title: section.title,
      acceptLabel: "Close tool editor", discardLabel: "Close tool editor",
      onAccept: () => { select(); close(); }, onDiscard: () => { select(); close(); },
    });
    const picker = document.createElement("select");
    picker.setAttribute("aria-label", "Sketch editor");
    for (const [value, { title }] of sections) {
      const option = document.createElement("option");
      option.value = value; option.textContent = title; picker.append(option);
    }
    picker.value = id; picker.onchange = () => show(picker.value as Editor);
    window.body.append(picker, section.element);
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
    show, close, refresh,
    dispose() {
      observer.disconnect(); close(); disposeCommands.forEach(dispose => dispose());
      globalThis.window.removeEventListener("aether-sketch-text", text, true);
      globalThis.window.removeEventListener("aether-sketch-import-dxf", dxf, true);
      sections.clear();
    },
  };
}
