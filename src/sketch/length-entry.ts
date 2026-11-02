import type { SketchPoint } from "@aether/core/sketch";

/** Typed length while drawing (Onshape's value box): the first digit opens a box at the
 *  pointer, Enter places the next point that far along the current direction, Escape
 *  drops it. ponytail: length only; an angle box can join it when a design needs one. */
export function mountLengthEntry(root: HTMLElement, o: {
  anchor(): SketchPoint | null;
  cursor(): SketchPoint | null;
  place(point: SketchPoint): void;
}) {
  const input = document.createElement("input");
  input.type = "text"; input.inputMode = "decimal"; input.className = "cad-sketch-length-entry";
  input.setAttribute("aria-label", "Length (mm)"); input.hidden = true;
  root.append(input);
  const close = () => { input.hidden = true; input.value = ""; input.blur(); };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const length = Number(input.value), a = o.anchor(), c = o.cursor();
    if (!(length > 0) || !a) { close(); return; }
    const dx = (c?.[0] ?? a[0] + 1) - a[0], dy = (c?.[1] ?? a[1]) - a[1], n = Math.hypot(dx, dy) || 1;
    o.place([a[0] + (dx / n) * length, a[1] + (dy / n) * length]);
    close();
  });
  input.addEventListener("blur", close);
  return {
    /** Open with the typed first character at a client position. */
    open(first: string, at: { x: number; y: number }) {
      input.hidden = false;
      input.style.left = `${at.x + 14}px`; input.style.top = `${at.y + 14}px`;
      input.value = first; input.focus(); input.setSelectionRange(1, 1);
    },
    close,
    dispose: () => input.remove(),
  };
}
