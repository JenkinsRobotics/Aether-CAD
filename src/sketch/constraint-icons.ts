import coincident from "@aether/assets/icons/relationships/coincident.svg?raw";
import concentric from "@aether/assets/icons/relationships/concentric.svg?raw";
import parallel from "@aether/assets/icons/relationships/parallel.svg?raw";
import tangent from "@aether/assets/icons/relationships/tangent.svg?raw";
import horizontal from "@aether/assets/icons/relationships/horizontal.svg?raw";
import vertical from "@aether/assets/icons/relationships/vertical.svg?raw";
import perpendicular from "@aether/assets/icons/relationships/perpendicular.svg?raw";
import equal from "@aether/assets/icons/relationships/equal.svg?raw";
import midpoint from "@aether/assets/icons/relationships/midpoint.svg?raw";
import normal from "@aether/assets/icons/relationships/normal.svg?raw";
import symmetric from "@aether/assets/icons/relationships/symmetric.svg?raw";
import fix from "@aether/assets/icons/relationships/fix.svg?raw";
import curvature from "@aether/assets/icons/relationships/curvature.svg?raw";
import pierce from "@aether/assets/icons/intersection.svg?raw";

/** Shared vector artwork; no font metrics, engine semantics or copied paths. */
/** Collinear: two dashes on one line (no shared asset yet; drawn here in the relationship icon style). */
const collinear = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="21" y2="12"/><line x1="2" y1="18" x2="22" y2="6" stroke-dasharray="2 3" opacity="0.5"/></svg>';
export const constraintIcons = {coincident, pierce, concentric, parallel, collinear, tangent, horizontal, vertical, perpendicular, equal, midpoint, normal, symmetric, fix, curvature} as const;
export type ConstraintIconName = keyof typeof constraintIcons;

export function constraintIcon(name: ConstraintIconName, owner: Document): SVGSVGElement {
  const host = owner.createElementNS("http://www.w3.org/2000/svg", "g");
  // Trusted, repository-owned SVG assets only.
  host.innerHTML = constraintIcons[name];
  const icon = host.firstElementChild as SVGSVGElement;
  icon.setAttribute("class", "constraint-symbol");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  return icon;
}
