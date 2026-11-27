import { getOC, makeCompound, type Shape3D } from "replicad";
import type { TopoDS_Shape, TopAbs_ShapeEnum } from "replicad-opencascadejs";
import type { PartDocument, ProfileFeature } from "../document/part-document";
import { bodyIDForFeature, rollbackPosition } from "../document/feature-history";
import { profileFrame } from "../document/construction-planes";
import type { SheetBaseFeature } from "../document/sheet-metal";
import { drawingViewFrame, type PartDrawingOptions, type PartDrawingProjection, type ProjectedDrawingCurve } from "../drawing/projection";
import { evaluatePartDocument } from "./part-evaluator";
import { withDrawingSection } from "./drawing-section";
import { withHiddenLineProjection } from "./hidden-line";
import { extractSheetFlatPattern } from "./features/sheet-metal-flat";

/** Projects all selected bodies together: nearer solids must occlude farther
 * ones. Source shapes remain owned by the evaluator cache. */
export function projectPartDrawing(document: PartDocument, options: PartDrawingOptions): PartDrawingProjection {
  if (options.flatPattern) {
    const active = document.features.slice(0, rollbackPosition(document));
    const bases = active.filter((f): f is SheetBaseFeature => f.type === "sheet-base" && !f.suppressed);
    const targetBodyId = options.bodyIds?.[0];
    const base = targetBodyId ? bases.find((f) => bodyIDForFeature(document, f) === targetBodyId) : bases[0];
    if (!base) throw Error("A flat-pattern view requires an unsuppressed sheet-metal base feature.");
    const bodyId = bodyIDForFeature(document, base);
    const profile = active.find((f): f is ProfileFeature => f.type === "profile" && f.id === base.profileFeatureId);
    const baseNormal: [number, number, number] = profile ? profileFrame(profile).normal : [0, 0, 1];
    let hasBends = false;
    let unfolded = false;
    for (const f of active) {
      if (f.suppressed) continue;
      if ((f.type === "sheet-flange" || f.type === "sheet-hem") && f.bodyIds[0] === bodyId) { hasBends = true; unfolded = false; }
      else if (f.type === "sheet-refold" && f.bodyIds[0] === bodyId) unfolded = false;
      else if (f.type === "sheet-unfold" && f.bodyIds[0] === bodyId) unfolded = true;
    }
    const evalDoc: PartDocument = hasBends && !unfolded
      ? {
          ...document,
          rollbackIndex: undefined,
          features: [
            ...active,
            { id: "__flat_pattern_unfold__", type: "sheet-unfold", name: "Flat Pattern Unfold", suppressed: false, bodyIds: [bodyId] },
          ],
        }
      : document;
    let flatResult: PartDrawingProjection | undefined;
    evaluatePartDocument(evalDoc, {
      withBodies: (bodies) => {
        const flatBody = bodies.get(bodyId);
        if (!flatBody) throw Error(`Flat pattern body ${bodyId} is unavailable.`);
        const flat = extractSheetFlatPattern(document, bodyId, flatBody, base, baseNormal);
        const visible: ProjectedDrawingCurve[] = [];
        const hidden: ProjectedDrawingCurve[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const seg of flat.lines) {
          const curve: ProjectedDrawingCurve = { kind: "line", start: seg.start, end: seg.end };
          if (seg.layer === "BEND_UP" || seg.layer === "BEND_DOWN") hidden.push(curve);
          else visible.push(curve);
          for (const [x, y] of [seg.start, seg.end]) {
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
        }
        if (!Number.isFinite(minX)) throw Error("Flat pattern has no projectable lines.");
        flatResult = { visible, hidden, bounds: [minX, minY, maxX, maxY], bodyIds: [flat.bodyId] };
      },
    });
    if (!flatResult) throw Error("Flat pattern could not be extracted.");
    return flatResult;
  }
  const { normal, up } = drawingViewFrame(options.orientation, options.direction);
  let result: PartDrawingProjection | undefined;
  evaluatePartDocument(document, { withBodies: bodies => {
    const ids = options.bodyIds ?? [...bodies.keys()];
    if (!ids.length || new Set(ids).size !== ids.length) throw Error("A drawing view requires distinct exact bodies.");
    const shapes = ids.map(id => { const shape = bodies.get(id); if (!shape) throw Error(`Drawing body ${id} no longer exists.`); return shape; });
    result = withDrawingSection(shapes, options, (sectionShapes, hatch) => {
      // Replicad consumes its inputs when assembling a compound.
      const compound = makeCompound(sectionShapes.map(shape => shape.clone()) as Shape3D[]);
      try {
        return withHiddenLineProjection(compound, { viewNormal: normal, upDirection: up }, projected => {
          const visible = [projected.visible, projected.visibleOutline];
          const hidden = [projected.hidden, projected.hiddenOutline];
          const all = [...visible, ...hidden].filter(s => s && !s.IsNull());
          if (!all.length) throw Error("The model has no projectable edges.");
          const oc = getOC(), box = new oc.Bnd_Box_1();
          try {
            // Exact curve extrema, independent of display tessellation.
            all.forEach(shape => oc.BRepBndLib.AddOptimal(shape, box, false, false));
            const lo = box.CornerMin(), hi = box.CornerMax();
            try { return { visible: visible.flatMap(readCurves), hidden: hidden.flatMap(readCurves), bounds: [lo.X(), lo.Y(), hi.X(), hi.Y()], bodyIds: ids, ...(options.section ? { hatch } : {}) } as PartDrawingProjection; }
            finally { lo.delete(); hi.delete(); }
          } finally { box.delete(); }
        });
      } finally { compound.delete(); }
    });
  } });
  if (!result) throw Error("Create an exact solid before making a drawing.");
  return result;
}

function readCurves(shape: TopoDS_Shape): ProjectedDrawingCurve[] {
  if (!shape || shape.IsNull()) return [];
  const oc = getOC(), curves: ProjectedDrawingCurve[] = [];
  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum);
  try {
    for (; explorer.More(); explorer.Next()) {
      const current = explorer.Current(), edge = oc.TopoDS.Edge_1(current), adaptor = new oc.BRepAdaptor_Curve_2(edge);
      try {
        const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
        const start = adaptor.Value(first), end = adaptor.Value(last);
        try {
          const type = adaptor.GetType();
          if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
            curves.push({ kind: "line", start: [start.X(), start.Y()], end: [end.X(), end.Y()] });
          } else if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
            const circle = adaptor.Circle(), center = circle.Location(), axis = circle.Axis(), direction = axis.Direction();
            try {
              const c: [number, number] = [center.X(), center.Y()], radius = circle.Radius();
              if (Math.abs(last - first) >= 2 * Math.PI - 1e-8) curves.push({ kind: "circle", center: c, radius });
              else curves.push({ kind: "arc", center: c, radius, start: Math.atan2(start.Y() - c[1], start.X() - c[0]), end: Math.atan2(end.Y() - c[1], end.X() - c[0]), ccw: direction.Z() > 0 });
            } finally { direction.delete(); axis.delete(); center.delete(); circle.delete(); }
          } else {
            const toleranceMm = 0.01, sampler = new oc.GCPnts_TangentialDeflection_2(adaptor as never, 0.05, toleranceMm, 2, 1e-9, 1e-7);
            try {
              const points: [number, number][] = [];
              for (let i = 1; i <= sampler.NbPoints(); i++) { const p = sampler.Value(i); try { points.push([p.X(), p.Y()]); } finally { p.delete(); } }
              if (points.length > 1) curves.push({ kind: "polyline", points, toleranceMm });
            } finally { sampler.delete(); }
          }
        } finally { start.delete(); end.delete(); }
      } finally { adaptor.delete(); edge.delete(); current.delete(); }
    }
  } finally { explorer.delete(); }
  return curves;
}
