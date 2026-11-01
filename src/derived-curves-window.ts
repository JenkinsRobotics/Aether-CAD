import { openCADFeatureWindow } from "./features/feature-window-style";
import { insertFeature, profileFrame, rollbackPosition, type PartDocument, type PartFeature } from "@aether/core/document";
import { sketchProfilePolylines } from "@aether/core/sketch";
import { cadCommands } from "./cad-command-registry";
import { analyzePart } from "./modeling/part-analysis";
import type { MeasureReference } from "./measure/measure-reference";

type V3 = [number, number, number];
type Mode = "intersection_curve" | "isoparametric_curve" | "project_curve";
const titles: Record<Mode, string> = { intersection_curve: "Intersection curve", isoparametric_curve: "Isoparametric curve", project_curve: "Project to surface" };

/** A polyline as at most `max` points, ends kept. */
export function thinPolyline(points: V3[], max = 200): V3[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}
const straight = (points: V3[]) => {
  if (points.length < 3) return true;
  const [a, b] = [points[0], points[points.length - 1]], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.hypot(...d) || 1;
  return points.every((p) => { const w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], t = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / n; return Math.hypot(w[0] - d[0] * t / n, w[1] - d[1] * t / n, w[2] - d[2] * t / n) < 1e-6; });
};
/** 3D sketch features from model curves: a straight run as a line, anything else as a spline through its samples. */
export function curvesAsFeatures(polylines: V3[][], name: string, idFor: (i: number) => string): PartFeature[] {
  return polylines.filter((p) => p.length > 1).map((p, i) => {
    const points = thinPolyline(p).filter((q, k, all) => k === 0 || Math.hypot(q[0] - all[k - 1][0], q[1] - all[k - 1][1], q[2] - all[k - 1][2]) > 1e-6);
    const line = straight(points);
    return { id: idFor(i), type: "curve3d", name: polylines.length > 1 ? `${name} ${i + 1}` : name, suppressed: false, kind: line ? "line" : "spline", pointsMillimeters: line ? [points[0], points[points.length - 1]] : points } as PartFeature;
  });
}
/** World polylines of a finished sketch, as the viewport draws them. */
function sketchWorldPolylines(feature: PartFeature): { polylines: V3[][]; normal: V3 } {
  if (feature.type !== "sketch" && feature.type !== "profile") throw new Error("Choose a sketch.");
  const frame = profileFrame({ plane: ("plane" in feature ? feature.plane : "XY") as "XY" | "XZ" | "YZ", offsetMillimeters: "offsetMillimeters" in feature ? feature.offsetMillimeters : 0, frame: "frame" in feature ? feature.frame : undefined, flip: "flip" in feature ? feature.flip : undefined });
  const [o, x, n] = [frame.originMillimeters, frame.xDirection, frame.normal];
  const y: V3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const polylines = ("profile" in feature ? sketchProfilePolylines(feature.profile) : []).map((line) => line.map(([u, v]) => [o[0] + x[0] * u + y[0] * v, o[1] + x[1] * u + y[1] * v, o[2] + x[2] * u + y[2] * v] as V3));
  return { polylines, normal: [...n] as V3 };
}

/** Curves from the model (SolidCraft's sketch.intersection_curve, isoparametric_curve,
 *  project_to_surface): picks come from the current selection; Preview draws them, Apply adds
 *  them as 3D sketch features. Computed once, not linked to their sources. */
export function openDerivedCurveWindow(mode: Mode, deps: { getDocument: () => PartDocument | null; apply: (doc: PartDocument) => Promise<void>; selection: () => MeasureReference[]; showCurves: (curves: { label: string; color: string; polylines: V3[][] }[]) => void }): void {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  const source = deps.getDocument();
  if (!viewport || !source) return;
  viewport.querySelector(".cad-derived-curve-window")?.remove();
  let found: V3[][] = [];
  const close = () => { deps.showCurves([]); win.close(); };
  const win = openCADFeatureWindow({ viewport, className: "cad-derived-curve-window", icon: "sketch", title: titles[mode], acceptLabel: "Add curves", discardLabel: "Cancel",
    onAccept: async () => {
      if (!found.length) { win.setError("Preview the curves first."); return; }
      try {
        let doc = structuredClone(deps.getDocument() ?? source);
        for (const feature of curvesAsFeatures(found, titles[mode], () => crypto.randomUUID())) doc = insertFeature(doc, feature);
        await deps.apply(doc); close();
      } catch (error) { win.setError((error as Error).message); }
    },
    onDiscard: async () => close() });
  const sketches = source.features.slice(0, rollbackPosition(source)).filter((f) => (f.type === "sketch" || f.type === "profile") && !f.suppressed);
  const sketch = document.createElement("select"); sketch.setAttribute("aria-label", "Sketch to project");
  for (const f of sketches) sketch.add(new Option(f.name, f.id));
  const uv = document.createElement("select"); uv.setAttribute("aria-label", "Curve direction");
  uv.add(new Option("Along u", "u")); uv.add(new Option("Along v", "v"));
  const preview = document.createElement("button"); preview.type = "button"; preview.className = "aui-button"; preview.textContent = "Preview";
  const note = document.createElement("p"); note.className = "cad-form-note"; note.setAttribute("role", "status");
  if (mode === "project_curve") win.row("Sketch", sketch);
  if (mode === "isoparametric_curve") win.row("Direction", uv);
  win.row("", preview); win.body.append(note);
  note.textContent = mode === "intersection_curve" ? "Select two faces or bodies, then Preview." : mode === "isoparametric_curve" ? "Select a face, then Preview. The curve passes through the face's centre." : "Select the target face, choose the sketch, then Preview. Curves are projected along the sketch's normal.";
  preview.onclick = async () => {
    win.setError(null); found = []; deps.showCurves([]);
    try {
      const doc = deps.getDocument() ?? source, entities = deps.selection();
      const options: Parameters<typeof analyzePart>[1] = { kind: mode, entities };
      if (mode === "isoparametric_curve") Object.assign(options, { uv: uv.value });
      if (mode === "project_curve") { const f = doc.features.find((x) => x.id === sketch.value); if (!f) throw new Error("Choose a sketch."); const { polylines, normal } = sketchWorldPolylines(f); Object.assign(options, { polylines, direction: normal }); }
      const result = await analyzePart(doc, options);
      found = (result.curves ?? []).flatMap((c) => c.polylines as V3[][]);
      deps.showCurves((result.curves ?? []) as never);
      note.textContent = `${found.length} curve${found.length === 1 ? "" : "s"} found. Add them as 3D sketch features; they do not follow later edits.`;
    } catch (error) { win.setError((error as Error).message); }
  };
}
export function mountDerivedCurveCommands(deps: Parameters<typeof openDerivedCurveWindow>[1]) {
  const ids = { "sketch-intersection-curve": "intersection_curve", "sketch-isoparametric-curve": "isoparametric_curve", "sketch-project-to-surface": "project_curve" } as const;
  const releases = Object.entries(ids).map(([command, mode]) => { const r = cadCommands.register(command as never, () => openDerivedCurveWindow(mode, deps)); cadCommands.setEnabled(command as never, true); return r; });
  return () => releases.forEach((r) => r());
}
