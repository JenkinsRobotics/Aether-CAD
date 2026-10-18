/** Presentation adapter shared by relationship views (sketches, mates, supports).
 * Participants remain references into the owning model; this never defines or
 * copies constraint, mate, or plane semantics. */
export interface Relationship<T> {
  id: string;
  label: string;
  participants: readonly T[];
}

export function relationshipInteraction<T>(show: (value: Relationship<T> | null) => void) {
  let hovered: Relationship<T> | null = null;
  let focused: Relationship<T> | null = null;
  const refresh = () => show(hovered ?? focused);
  return {
    hover(value: Relationship<T> | null) { hovered = value; refresh(); },
    bind(node: SVGElement, value: Relationship<T>) {
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", value.label);
      node.addEventListener("pointerenter", () => { hovered = value; refresh(); });
      node.addEventListener("pointerleave", () => { hovered = null; refresh(); });
      node.addEventListener("focus", () => { focused = value; refresh(); });
      node.addEventListener("blur", () => { focused = null; refresh(); });
      node.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { hovered = null; node.blur(); refresh(); event.stopPropagation(); }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.stopPropagation(); focused = value; refresh();
        }
      });
    },
  };
}
