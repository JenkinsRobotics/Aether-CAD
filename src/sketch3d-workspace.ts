import { curve3dPolylines, insertFeature, type Curve3DFeature, type PartDocument } from "@aether/core/document";
import { openDerivedCurveWindow } from "./derived-curves-window";
import { closeOpenFeatureWindows } from "./features/feature-window-style";
import type { MeasureReference } from "./measure/measure-reference";
import "./sketch3d-workspace.css";

type V3 = [number, number, number];
type Kind = Curve3DFeature["kind"];
interface Curve { kind: Kind; points: V3[] }

export interface Sketch3DDeps {
  getDocument: () => PartDocument | null;
  apply: (doc: PartDocument) => Promise<void>;
  /** A world point under the pointer: snapped geometry, a surface, or a view plane through `origin`. */
  pickPoint: (event: { clientX: number; clientY: number }, origin: V3) => { point: V3; label?: string } | null;
  showCurves: (curves: { label: string; color: string; polylines: V3[][] }[]) => void;
  selection: () => MeasureReference[];
}
let deps: Sketch3DDeps | null = null;
export function mountSketch3DWorkspace(next: Sketch3DDeps): void { deps = next; }

/** "x y z" (commas allowed) as a point, or null. */
const parsePoint = (text: string): V3 | null => {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as V3) : null;
};
const needed = (kind: Kind) => (kind === "point" ? 1 : 2);
const polylines = (curve: Curve): V3[][] =>
  curve.points.length >= needed(curve.kind) ? curve3dPolylines({ id: "", type: "curve3d", name: "", suppressed: false, kind: curve.kind, pointsMillimeters: curve.points }) : [curve.points];

/** The 3D sketch: a strip over the viewport, the same sketch gesture as the 2D sketch but
 *  with no plane. Points come from clicks on the model (vertices, edge midpoints and
 *  centres snap; faces take the hit point; empty space takes the view plane through the
 *  last point) or typed as x y z. Lines, splines and points, plus the model-curve tools
 *  (intersection, isoparametric, projection). Done writes one `curve3d` feature per curve;
 *  Cancel writes nothing. Editing an existing 3D sketch reopens it with its points.
 *  ponytail: no 3D constraints or dimensions yet; add a solver when a design needs them. */
export function openSketch3DWorkspace(existing?: Curve3DFeature): void {
  closeOpenFeatureWindows();
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  if (!deps || !viewport || viewport.querySelector(".cad-sketch3d-strip")) return;
  const source = deps.getDocument();
  if (!source) return;
  const { showCurves } = deps;
  const curves: Curve[] = [];
  let current: Curve = existing ? { kind: existing.kind, points: existing.pointsMillimeters.map((p) => [...p] as V3) } : { kind: "line", points: [] };
  const draftId = existing?.id ?? crypto.randomUUID();
  const announce = (detail: { id: string; name: string; kind: string } | null) => window.dispatchEvent(new CustomEvent("aether-feature-editing", { detail }));

  const strip = document.createElement("div");
  strip.className = "cad-sketch3d-strip";
  strip.setAttribute("role", "toolbar");
  strip.setAttribute("aria-label", "3D sketch");
  const button = (label: string, onClick: () => void, pressed?: () => boolean) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "aui-button"; b.textContent = label; b.onclick = onClick;
    if (pressed) b.dataset.kind = label;
    strip.append(b);
    return b;
  };
  const kinds: [Kind, string][] = [["line", "Line"], ["spline", "Spline"], ["point", "Point"]];
  for (const [kind, label] of kinds) button(label, () => { finishCurve(); current.kind = kind; render(); }, () => current.kind === kind);
  strip.append(Object.assign(document.createElement("span"), { className: "cad-sketch3d-gap" }));
  const coords = document.createElement("input");
  coords.type = "text"; coords.placeholder = "x y z"; coords.setAttribute("aria-label", "Point x y z");
  coords.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); addTyped(); } };
  strip.append(coords);
  button("Add", addTyped);
  button("Undo point", () => { current.points.pop(); render(); });
  button("Finish curve", finishCurve);
  strip.append(Object.assign(document.createElement("span"), { className: "cad-sketch3d-gap" }));
  // The model-curve window adds to this sketch, not to the document, so Cancel can drop them.
  const modelDeps = { ...deps, apply: async (doc: PartDocument) => {
    for (const f of doc.features) if (f.type === "curve3d" && !source.features.some((s) => s.id === f.id)) curves.push({ kind: f.kind, points: f.pointsMillimeters });
    render();
  } };
  for (const [mode, label] of [["intersection_curve", "Intersection"], ["isoparametric_curve", "Isoparametric"], ["project_curve", "Project"]] as const)
    button(label, () => { finishCurve(); openDerivedCurveWindow(mode, modelDeps); });
  const status = document.createElement("span");
  status.className = "cad-sketch3d-status"; status.setAttribute("role", "status");
  strip.append(status);
  const done = button("Done", () => void commit());
  done.classList.add("aui-button--primary");
  button("Cancel", close);
  viewport.append(strip);

  function addTyped() {
    const point = parsePoint(coords.value);
    if (!point) { status.textContent = "Type a point as x y z."; return; }
    coords.value = ""; addPoint(point);
  }
  function addPoint(point: V3) {
    const last = current.points.at(-1);
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1], last[2] - point[2]) < 1e-6) return;
    current.points.push(point);
    if (current.kind === "point") finishCurve(); else render();
  }
  function finishCurve() {
    if (current.points.length >= needed(current.kind)) curves.push(current);
    current = { kind: current.kind, points: [] };
    render();
  }
  function render() {
    for (const b of strip.querySelectorAll<HTMLButtonElement>("button[data-kind]")) b.setAttribute("aria-pressed", String(b.textContent === kinds.find(([k]) => k === current.kind)![1]));
    showCurves([
      ...curves.map((c, i) => ({ label: `3D sketch ${i + 1}`, color: "#33d0ff", polylines: polylines(c) })),
      ...(current.points.length ? [{ label: "drawing", color: "#ffac39", polylines: polylines(current) }] : []),
    ]);
    const total = curves.length + (current.points.length >= needed(current.kind) ? 1 : 0);
    status.textContent = current.points.length
      ? `${current.points.length} point${current.points.length === 1 ? "" : "s"} — click the model or type x y z; Finish curve starts another.`
      : `${total} curve${total === 1 ? "" : "s"} — click a vertex, edge, face or empty space to start a ${current.kind}.`;
    done.disabled = total === 0;
  }

  // A click is a pointer that did not drag: orbiting the camera must not add points.
  let downAt: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => { if (event.button === 0 && !strip.contains(event.target as Node) && !(event.target as HTMLElement).closest(".aui-feature-window")) downAt = { x: event.clientX, y: event.clientY }; };
  const onUp = (event: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4;
    downAt = null;
    if (moved || !deps) return;
    const hit = deps.pickPoint(event, current.points.at(-1) ?? curves.at(-1)?.points.at(-1) ?? [0, 0, 0]);
    if (hit) addPoint(hit.point);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "Escape") { event.preventDefault(); if (current.points.length) finishCurve(); else close(); }
  };
  viewport.addEventListener("pointerdown", onDown);
  viewport.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey);

  async function commit() {
    finishCurve();
    if (!deps) return;
    let doc: PartDocument = structuredClone(deps.getDocument() ?? source!);
    if (existing) {
      const first = curves[0];
      if (!first) { close(); return; }
      doc.features = doc.features.map((f) => (f.id === existing.id ? { ...existing, kind: first.kind, pointsMillimeters: first.points } : f));
      for (const c of curves.slice(1)) doc = insertFeature(doc, feature(c, doc));
    } else {
      for (const c of curves) doc = insertFeature(doc, feature(c, doc));
    }
    try { await deps.apply(doc); close(); } catch (error) { status.textContent = (error as Error).message; }
  }
  function feature(c: Curve, doc: PartDocument): Curve3DFeature {
    const n = doc.features.filter((f) => f.type === "curve3d").length + 1;
    return { id: crypto.randomUUID(), type: "curve3d", name: `3D Sketch ${n}`, suppressed: false, kind: c.kind, pointsMillimeters: c.points };
  }
  function close() {
    viewport!.removeEventListener("pointerdown", onDown);
    viewport!.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey);
    showCurves([]);
    strip.remove();
    announce(null);
  }
  announce({ id: draftId, name: existing?.name ?? "3D Sketch", kind: "curve3d" });
  render();
}
