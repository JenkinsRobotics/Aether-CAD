import { getOC, makeCompound, type Shape3D } from "replicad";
import type { TopoDS_Shape, TopAbs_ShapeEnum } from "replicad-opencascadejs";
import type { PartDocument } from "../document/part-document";
import { drawingViewFrame, type PartDrawingOptions, type PartDrawingProjection, type ProjectedDrawingCurve } from "../drawing/projection";
import { evaluatePartDocument } from "./part-evaluator";
import { withDrawingSection } from "./drawing-section";
import { withHiddenLineProjection } from "./hidden-line";

/** Projects all selected bodies together: nearer solids must occlude farther
 * ones. Source shapes remain owned by the evaluator cache. */
export function projectPartDrawing(document: PartDocument, options: PartDrawingOptions): PartDrawingProjection {
  const { normal, up } = drawingViewFrame(options.orientation);
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
