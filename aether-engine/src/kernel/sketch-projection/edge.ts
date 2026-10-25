import { getOC, type Edge } from "replicad";
import type { BRepAdaptor_Curve } from "replicad-opencascadejs";
import { sameSketchPoint, type SketchContour, type SketchFrame, type SketchPoint, type SketchSegment } from "../../sketch/drawing";
import { projectSketchDrawing } from "../../sketch/projection/drawing";
import { projectionFrame, takePoint } from "./frame";

type EdgeProjection = { contour: SketchContour; approximated: boolean };

/** Borrow the edge; own and release every adaptor and native accessor result.
 * Curves remain exact where the sketch format can represent them. */
export function projectModelEdge(edge: Edge, target: SketchFrame, tolerance: number): EdgeProjection {
  const oc = getOC();
  const adaptor = new oc.BRepAdaptor_Curve_2(edge.wrapped);
  const map = projectionFrame(target);
  try {
    const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
    if (![first, last].every(Number.isFinite) || last <= first)
      throw Error("The model edge has no finite parameter interval.");
    const at = (u: number) => map.point(takePoint(adaptor.Value(u)));
    const type = adaptor.GetType();
    if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
      const start = at(first), end = at(last);
      return { contour: { type: "path", start, segments: sameSketchPoint(start, end) ? [] : [{ type: "line", end }] }, approximated: false };
    }
    if (type === oc.GeomAbs_CurveType.GeomAbs_Circle || type === oc.GeomAbs_CurveType.GeomAbs_Ellipse) {
      const circle = type === oc.GeomAbs_CurveType.GeomAbs_Circle;
      const curve = circle ? adaptor.Circle() : adaptor.Ellipse();
      const position = curve.Position(), axis = curve.Axis();
      try {
        const sourceFrame: SketchFrame = {
          originMillimeters: takePoint(curve.Location()),
          xDirection: takePoint(position.XDirection()),
          normal: takePoint(axis.Direction()),
        };
        const radiusX = circle ? (curve as ReturnType<BRepAdaptor_Curve["Circle"]>).Radius() : (curve as ReturnType<BRepAdaptor_Curve["Ellipse"]>).MajorRadius();
        const radiusY = circle ? radiusX : (curve as ReturnType<BRepAdaptor_Curve["Ellipse"]>).MinorRadius();
        const span = last - first;
        if (span > 2 * Math.PI + 1e-7) throw Error("A projected conic cannot wind more than once.");
        const full = Math.abs(span - 2 * Math.PI) < 1e-8;
        const point = (u: number): SketchPoint => [radiusX * Math.cos(u), radiusY * Math.sin(u)];
        const start = point(first);
        let contour: SketchContour;
        if (circle && full) contour = { type: "circle", center: [0, 0], radius: radiusX };
        else if (circle) contour = { type: "path", start, segments: [{ type: "arc", middle: point((first + last) / 2), end: point(last) }] };
        else {
          // Split a closed ellipse so each SVG-style arc has distinct endpoints.
          const ends = full ? [first + Math.PI, first + 2 * Math.PI] : [last];
          contour = { type: "path", start, segments: ends.map(u => ({
            type: "ellipse", end: full && u === ends.at(-1) ? start : point(u),
            radiusX, radiusY, rotationDegrees: 0, largeArc: !full && span > Math.PI, sweep: true,
          })) };
        }
        return { contour: projectSketchDrawing({ type: "drawing", contours: [contour] }, sourceFrame, target).contours[0], approximated: false };
      } finally { axis.delete(); position.delete(); curve.delete(); }
    }
    if (type === oc.GeomAbs_CurveType.GeomAbs_BezierCurve && !adaptor.IsRational() && adaptor.Degree() <= 3)
      return { contour: projectCubic(adaptor, target, first, last), approximated: false };

    // Orthogonal projection cannot increase a 3D deflection. This sampler uses
    // geometric deflection rather than a fixed number of display samples.
    const sampler = new oc.GCPnts_TangentialDeflection_2(adaptor as never, 0.05, tolerance, 2, 1e-9, 1e-7);
    try {
      const count = sampler.NbPoints();
      if (count < 2 || count > 1001) throw Error("Projection exceeds the sketch's 1000-segment limit; choose a coarser tolerance or a shorter edge.");
      const points: SketchPoint[] = [];
      for (let i = 1; i <= count; i++) {
        const p = map.point(takePoint(sampler.Value(i)));
        if (!points.length || !sameSketchPoint(points.at(-1)!, p)) points.push(p);
      }
      return { contour: { type: "path", start: points[0], segments: points.slice(1).map(end => ({ type: "line", end })) }, approximated: true };
    } finally { sampler.delete(); }
  } finally { adaptor.delete(); }
}

/** A polynomial of degree <= 3 is exactly determined by endpoint derivatives.
 * Split closed projected curves rather than discarding loops with equal ends. */
function projectCubic(adaptor: BRepAdaptor_Curve, target: SketchFrame, first: number, last: number): SketchContour {
  const oc = getOC(), map = projectionFrame(target);
  const p = new oc.gp_Pnt_1(), d = new oc.gp_Vec_1();
  const at = (u: number) => {
    adaptor.D1(u, p, d);
    return { p: map.point([p.X(), p.Y(), p.Z()]), d: map.vector([d.X(), d.Y(), d.Z()]) };
  };
  try {
    const a = at(first), b = at(last);
    const stops = sameSketchPoint(a.p, b.p) ? [(first + last) / 2, last] : [last];
    let start = a, u = first;
    const segments: SketchSegment[] = [];
    for (const endU of stops) {
      const end = at(endU), dt = (endU - u) / 3;
      const controls: [SketchPoint, SketchPoint] = [
        [start.p[0] + start.d[0] * dt, start.p[1] + start.d[1] * dt],
        [end.p[0] - end.d[0] * dt, end.p[1] - end.d[1] * dt],
      ];
      if (!sameSketchPoint(start.p, end.p)) segments.push({ type: "bezier", end: end.p, controls });
      else if (controls.some(control => !sameSketchPoint(control, start.p)))
        throw Error("The projected cubic has coincident endpoints below sketch resolution.");
      start = end; u = endU;
    }
    return { type: "path", start: a.p, segments };
  } finally { p.delete(); d.delete(); }
}
