import type { ViewportUpAxis } from "@aether/ui";
const preferenceKey = "aether-cad.workspace-up-axis.v1";

/** Presentation preference only: never transforms document geometry. */
export function readWorkspaceUpAxis(): ViewportUpAxis {
  try { return localStorage.getItem(preferenceKey) === "y" ? "y" : "z"; }
  catch { return "z"; }
}
export function saveWorkspaceUpAxis(upAxis: ViewportUpAxis): void {
  try { localStorage.setItem(preferenceKey, upAxis); }
  catch { /* Navigation still works when browser storage is unavailable. */ }
}
