import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { openCompactFeatureWindow, openFeatureWindow, ToolIcon, toolIconNames, type CompactFeatureWindowOptions, type FeatureWindow } from "@aether/ui";

/** The two Aether UI feature-window designs (same content, different header and
 *  commit controls), chosen once in Settings › UI and used by every CAD editor
 *  (Jonathan, 2026-10-31). */
export type FeatureWindowStyle = "compact" | "standard";
const KEY = "aether-cad.feature-window-style";

export function featureWindowStyle(): FeatureWindowStyle {
  try { return localStorage.getItem(KEY) === "standard" ? "standard" : "compact"; } catch { return "compact"; }
}
export function setFeatureWindowStyle(style: FeatureWindowStyle): void {
  try { localStorage.setItem(KEY, style); } catch { /* session-only preference */ }
}

/** Every CAD feature window opens through here so the chosen style applies to all of them. */
export function openCADFeatureWindow(options: CompactFeatureWindowOptions): FeatureWindow {
  if (featureWindowStyle() === "compact") return openCompactFeatureWindow(options);
  const header = document.createElement("span");
  const root = createRoot(header);
  flushSync(() => root.render(<ToolIcon name={(toolIconNames as readonly string[]).includes(options.icon) ? options.icon as never : "properties"} />));
  const win = openFeatureWindow({ ...options, variant: "standard", headerIcon: header,
    acceptLabel: options.acceptLabel ?? "Apply", discardLabel: options.discardLabel ?? "Cancel" });
  const close = win.close;
  win.close = () => { root.unmount(); close(); };
  return win;
}

/** One feature at a time (Jonathan, 2026-11-01): opening a feature cancels the one that is
 *  open, in the viewport windows and the 3D sketch strip alike.
 *  ponytail: cancels rather than commits; committing first needs the apply awaited. */
export function closeOpenFeatureWindows(host?: ParentNode | null): void {
  if (typeof document === "undefined") return;
  const root = host ?? document.querySelector(".cad-studio-viewport") ?? document;
  for (const open of root.querySelectorAll<HTMLElement>(".cad-feature-dialog, .cad-plane-window, .cad-derived-curve-window, .cad-projection-window"))
    open.querySelector<HTMLButtonElement>('[data-feature-action="discard"]')?.click();
  for (const button of root.querySelectorAll<HTMLButtonElement>(".cad-sketch3d-strip button"))
    if (button.textContent === "Cancel") button.click();
}
