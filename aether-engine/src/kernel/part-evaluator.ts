import { AETHER_CAD_EXTENSION } from "../document/file-types";
import { UnsupportedFeature, FeatureFailure } from "./feature-errors";
import { sub, add, scale, neg, cross, norm, unit, dot, type V3 } from "./vector";
import { buildEdgeFinish } from "./features/edge-finish";
import { applyBooleanFeature } from "./features/boolean";
import { applyPatternFeature } from "./features/pattern";
import { scopedRemoval } from './scoped-removal';
import { sketchRegionGroups } from "../sketch/regions/groups";
import { connectedSketchRegions, sketchFaceRegions } from "../sketch/reference/connected-sketch-regions";
import { matchesProfileRegion, profileRegionIdentity, type ProfileRegionSelection } from "../sketch/reference/profile-region-reference";
import { resolveProfileDrawing } from "../document/profile-projection";
import { canonicalPlaneXDirection, flipSketchFrame, principalFrame, resolvePlaneFrame } from "../document/construction-planes";
import { bendAllowanceMillimeters, type SheetMetalRule } from "../document/sheet-metal";
import type { ExtrusionPreviewAxis, PreviewHandle } from "../contracts/geometry";
import { constructionPlaneFrame } from "../document/solid-features";
import { threadSpecification, type ThreadSpecification } from "../document/hole-standards";
import { resolveAxisLine } from "../document/construction-axes";
import { sketchRegionOrder } from "../sketch/regions/order";
import { solveDrawingConstraints } from "../sketch/drawing-constraints";
import { contourClosed } from "../sketch/drawing";
import {
  assembleWire,
  basicFaceExtrusion,
  cast,
  draw,
  getOC,
  makeBaseBox,
  makeCylinder,
  makeHelix,
  genericSweep,
  loft,
  makeCircle,
  makeFace,
  makeNonPlanarFace,
  makeLine,
  makeSphere,
  makePolygon,
  revolution,
  Sketch,
  Vector,
  type Wire,
  makeOffset,
  makeSolid,
  Shell,
  measureArea,
  measureDistanceBetween,
  measureVolume,
  type Face,
  FaceFinder,
  Plane,
  isShape3D,
  drawCircle,
  Curve2D,
  type DrawingPen,
  drawRectangle,
  type Drawing,
  type Shape3D,
} from "replicad";
import { planeToolFace, splitFacesByTool } from "./general-fuse";
import { makeLine as makeLine3D, makeBSplineApproximation as approximateBSpline, makeCompound, makeVertex } from "replicad";

export { UnsupportedFeature, FeatureFailure } from "./feature-errors";
/** Every solid of a shape as its own body (what "separate bodies" means). */
export function solidsOf(shape: Shape3D): Shape3D[] {
  const oc = getOC();
  const explorer = new oc.TopExp_Explorer_2(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum);
  const solids: Shape3D[] = [];
  try {
    for (; explorer.More(); explorer.Next()) {
      const solid = cast(oc.TopoDS.Solid_1(explorer.Current()));
      if (isShape3D(solid)) solids.push(solid);
    }
  } finally { explorer.delete(); }
  return solids.length ? solids : [shape.clone()];
}

/** How far a through-all extrusion from `origin` along `direction` must go to pass every body. */
function throughAllDistance(bodies: Iterable<Shape3D>, origin: [number, number, number], direction: [number, number, number]): number {
  let farthest = 0;
  for (const body of bodies) {
    const box = body.boundingBox.bounds;
    for (const x of [box[0][0], box[1][0]]) for (const y of [box[0][1], box[1][1]]) for (const z of [box[0][2], box[1][2]])
      farthest = Math.max(farthest, (x - origin[0]) * direction[0] + (y - origin[1]) * direction[1] + (z - origin[2]) * direction[2]);
  }
  return farthest + 1;
}
function* corners(bounds: [ArrayLike<number>, ArrayLike<number>]): Generator<V3> {
  for (const x of [bounds[0][0], bounds[1][0]]) for (const y of [bounds[0][1], bounds[1][1]]) for (const z of [bounds[0][2], bounds[1][2]]) yield [x, y, z];
}
const diagonalOfShape = (shape: { boundingBox: { bounds: [ArrayLike<number>, ArrayLike<number>] } }) => { const b = shape.boundingBox.bounds; return norm(sub([b[1][0], b[1][1], b[1][2]], [b[0][0], b[0][1], b[0][2]])); };
/** A mesh reference: triangles the viewer draws, never feature geometry. */
interface MeshPart { vertices: Float32Array; normals: Float32Array; triangles: Uint32Array }
/** Same-domain faces merged (a glued fuse leaves coaxial cylinder faces split);
 *  the unifier can throw on such results, so the next-best form is kept. */
/** The untrimmed analytic surface of a face as a finite solid of its material
 *  side's shape: the primitive for cylinders, spheres and tori, a cone from its
 *  apex for cones. `near` is a point on the face, which picks the cone's nappe. */
type Quadric =
  | { kind: "CYLINDER"; at: V3; along: V3; r: number }
  | { kind: "SPHERE"; at: V3; r: number }
  | { kind: "CONE"; apex: V3; along: V3; tan: number }
  | { kind: "TORUS"; at: V3; along: V3; R: number; r: number };
export function quadricOf(face: Face, near: V3): Quadric {
  const oc = getOC(), adaptor = new oc.BRepAdaptor_Surface_2(face.wrapped, true);
  const kind = face.geomType === "CYLINDRE" ? "CYLINDER" : face.geomType;
  try {
    if (kind === "CYLINDER") { const c = adaptor.Cylinder(), axis = c.Axis(), l = axis.Location(), d = axis.Direction(); const q: Quadric = { kind, at: [l.X(), l.Y(), l.Z()], along: unit([d.X(), d.Y(), d.Z()]), r: c.Radius() }; l.delete(); d.delete(); axis.delete(); c.delete(); return q; }
    if (kind === "SPHERE") { const sph = adaptor.Sphere(), l = sph.Location(); const q: Quadric = { kind, at: [l.X(), l.Y(), l.Z()], r: sph.Radius() }; l.delete(); sph.delete(); return q; }
    // gp_Cone and gp_Torus are not bound in the stock wasm: the parameters are read
    // from the surface's own parametrisation (OCCT's conical and toroidal surfaces).
    const at = (u: number, v: number): V3 => { const point = adaptor.Value(u, v); const p: V3 = [point.X(), point.Y(), point.Z()]; point.delete(); return p; };
    if (kind === "CONE") {
      // P(u,v) = L + (R + v·sinα)(cosu·X + sinu·Y) + v·cosα·Z: the apex is at v = −R/sinα.
      const p0 = at(0, 0), p1 = at(Math.PI, 0), p2 = at(0, 1);
      const location = scale(add(p0, p1), 0.5), radial = sub(p0, location), R = norm(radial), X = unit(radial);
      const generatrix = sub(p2, p0), sin = dot(generatrix, X), axial = sub(generatrix, scale(X, sin)), cos = norm(axial), Z = unit(axial);
      const tan = Math.abs(sin / cos);
      if (!(tan > 1e-9) || !Number.isFinite(tan)) throw new Error("cone faces of this shape");
      const apex = sub(location, scale(Z, R * cos / sin));
      // The nappe the face lies on: the axis is oriented from the apex towards it.
      return { kind, apex, along: dot(sub(near, apex), Z) < 0 ? neg(Z) : Z, tan };
    }
    if (kind === "TORUS") {
      // P(u,v) = C + (R + r·cosv)(cosu·X + sinu·Y) + r·sinv·Z.
      const outer = at(0, 0), opposite = at(Math.PI, 0), inner = at(0, Math.PI), top = at(0, Math.PI / 2);
      const centre = scale(add(outer, opposite), 0.5), X = unit(sub(outer, centre));
      const outerRadius = dot(sub(outer, centre), X), innerRadius = dot(sub(inner, centre), X);
      const R = (outerRadius + innerRadius) / 2, r = (outerRadius - innerRadius) / 2;
      const along = unit(sub(sub(top, centre), scale(X, R)));
      return { kind, at: centre, along, R, r: Math.abs(r) };
    }
    throw new Error(`${kind.toLowerCase()} faces`);
  } finally { adaptor.delete(); }
}
const perpendicularTo = (u: V3): V3 => unit(Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]));
const quadricCentre = (q: Quadric): V3 => (q.kind === "CONE" ? q.apex : q.at);
/** The solid the surface encloses, `length` long for the open ones. */
export function quadricSolid(q: Quadric, length: number, own: <T>(shape: T) => T): Shape3D {
  if (q.kind === "SPHERE") return own(makeSphere(q.r).translate(q.at[0], q.at[1], q.at[2]));
  if (q.kind === "CYLINDER") return own(makeCylinder(q.r, length, sub(q.at, scale(q.along, length / 2)), q.along));
  const oc = getOC();
  if (q.kind === "TORUS") {
    const origin = new oc.gp_Pnt_3(q.at[0], q.at[1], q.at[2]), direction = new oc.gp_Dir_4(q.along[0], q.along[1], q.along[2]), axes = new oc.gp_Ax2_3(origin, direction);
    const maker = new oc.BRepPrimAPI_MakeTorus_5(axes, q.R, q.r);
    const solid = own(cast(maker.Shape()) as Shape3D);
    maker.delete(); axes.delete(); direction.delete(); origin.delete();
    return solid;
  }
  // A cone: the triangle apex – axis point – rim, revolved about the axis.
  const base = add(q.apex, scale(q.along, length)), rim = add(base, scale(perpendicularTo(q.along), length * q.tan));
  const triangle = own(makePolygon([q.apex, base, rim]));
  return own(revolution(triangle, q.apex, q.along, 360) as Shape3D);
}
/** Is a point inside the surface (within the cylinder, sphere, tube or cone)? */
export function insideQuadric(q: Quadric, p: V3): boolean {
  if (q.kind === "SPHERE") return norm(sub(p, q.at)) < q.r;
  const centre = quadricCentre(q), to = sub(p, centre), h = dot(to, q.along), rho = norm(sub(to, scale(q.along, h)));
  if (q.kind === "CYLINDER") return rho < q.r;
  if (q.kind === "TORUS") return Math.hypot(rho - q.R, h) < q.r;
  return h > 0 && rho < h * q.tan;
}
/** The direction the surface bulges towards at `p` on it (away from the axis, the
 *  centre or the tube's centre line): a face is convex when its outward normal agrees. */
function quadricRadial(q: Quadric, p: V3): V3 {
  if (q.kind === "SPHERE") return sub(p, q.at);
  const centre = quadricCentre(q), to = sub(p, centre), h = dot(to, q.along), radial = sub(to, scale(q.along, h));
  if (q.kind !== "TORUS") return radial;
  return sub(p, add(q.at, scale(unit(radial), q.R)));
}
/** The surface moved by `distance` along its own outward side (radius grown; a cone's apex pulled back). */
function offsetQuadric(q: Quadric, distance: number): Quadric {
  if (q.kind === "CONE") { const sin = q.tan / Math.hypot(1, q.tan); return { ...q, apex: sub(q.apex, scale(q.along, distance / sin)) }; }
  if (q.r + distance <= 1e-7) throw new Error("Offset collapses or inverts a curved face radius. Reduce the distance.");
  return { ...q, r: q.r + distance };
}
function moveQuadric(q: Quadric, movePoint: (p: V3) => V3, moveDirection: (d: V3) => V3): Quadric {
  if (q.kind === "SPHERE") return { ...q, at: movePoint(q.at) };
  if (q.kind === "CONE") return { ...q, apex: movePoint(q.apex), along: unit(moveDirection(q.along)) };
  return { ...q, at: movePoint(q.at), along: unit(moveDirection(q.along)) };
}

/** `shape` cut by a face's untrimmed surface patch (the full build's splitter: the stock
 *  wasm has no half-space for free-form surfaces), keeping the piece `probe` touches. With
 *  `mustSeparate`, a patch that does not cut the shape in two refuses the offset. */
function keepSideOf(f: FullOC, face: Face, shape: Shape3D, probe: V3, own: <T>(shape: T) => T, mustSeparate: boolean): Shape3D {
  if (measureVolume(shape) <= 1e-9) return shape;
  const faceX = toExtended(face), handle = f.BRep_Tool.Surface_2(f.TopoDS.Face_1(faceX));
  try { return keepSideOfSurface(f, handle, shape, probe, own, mustSeparate); } finally { handle.delete(); faceX.delete(); }
}
/** `shape` cut by an untrimmed surface of the full build (a `Handle_Geom_Surface`), keeping the piece `probe` touches. */
function keepSideOfSurface(f: FullOC, handle: FullOC, shape: Shape3D, probe: V3, own: <T>(shape: T) => T, mustSeparate: boolean, transform?: FullOC): Shape3D {
  if (measureVolume(shape) <= 1e-9) return shape;
  const shapeX = toExtended(shape);
  // The patch: the surface over its own domain (an unbounded direction clamped to the
  // shape's reach), as a B-spline extended past each edge by a quarter of the shape's
  // diagonal, so a surface that ends exactly at its face still cuts through the region.
  const diagonal = diagonalOfShape(shape), reach = 2 * diagonal, clamp = (value: number, fallback: number) => (Math.abs(value) > 1e99 ? fallback : value);
  const adaptor = new f.GeomAdaptor_Surface_2(handle);
  const u1 = clamp(adaptor.FirstUParameter(), -reach), u2 = clamp(adaptor.LastUParameter(), reach), v1 = clamp(adaptor.FirstVParameter(), -reach), v2 = clamp(adaptor.LastVParameter(), reach);
  adaptor.delete();
  const trimmed = new f.Geom_RectangularTrimmedSurface_1(handle, u1, u2, v1, v2, true, true);
  const trimmedHandle = new f.Handle_Geom_Surface_2(trimmed);
  const spline = f.GeomConvert.SurfaceToBSplineSurface(trimmedHandle);
  const bounded = new f.Handle_Geom_BoundedSurface_2(spline.get());
  for (const [inU, after] of [[true, true], [true, false], [false, true], [false, false]] as const) {
    try { f.GeomLib.ExtendSurfByLength(bounded, diagonal / 4, 1, inU, after); } catch { /* a degenerate edge keeps its end */ }
  }
  const extended = new f.Handle_Geom_Surface_2(bounded.get()), patchAdaptor = new f.GeomAdaptor_Surface_2(extended);
  const maker = new f.BRepBuilderAPI_MakeFace_14(extended, patchAdaptor.FirstUParameter(), patchAdaptor.LastUParameter(), patchAdaptor.FirstVParameter(), patchAdaptor.LastVParameter(), 1e-7);
  patchAdaptor.delete();
  let patch = maker.Face();
  if (transform) { const mover = new f.BRepBuilderAPI_Transform_2(patch, transform, true); patch = mover.Shape(); mover.delete(); }
  const progress = new f.Message_ProgressRange_1();
  const splitter = new f.BRepAlgoAPI_Splitter_1(), arguments_ = new f.TopTools_ListOfShape_1(), tools_ = new f.TopTools_ListOfShape_1();
  arguments_.Append_1(shapeX); tools_.Append_1(patch);
  // A patch exactly as wide as the column (an extruded curve between its end walls) still cuts it with a fuzzy value.
  splitter.SetArguments(arguments_); splitter.SetTools(tools_); splitter.SetFuzzyValue(1e-5);
  splitter.Build(progress);
  let pieces: Shape3D[];
  try { if (splitter.HasErrors()) throw new Error("split failed"); pieces = solidsOf(fromExtended(splitter.Shape())); }
  catch (error) { throw new Error("A neighbouring face's surface could not bound the offset. Reduce the distance or change the selection.", { cause: error }); }
  finally { splitter.delete(); arguments_.delete(); tools_.delete(); progress.delete(); maker.delete(); extended.delete(); bounded.delete(); spline.delete(); trimmedHandle.delete(); shapeX.delete(); }
  if (mustSeparate && pieces.length < 2) { pieces.forEach(release); throw new Error("A neighbouring face's surface does not reach the moved face. Reduce the distance or include the neighbour in the selection."); }
  const oc = getOC(), point = new oc.gp_Pnt_3(probe[0], probe[1], probe[2]), vertex = new oc.BRepBuilderAPI_MakeVertex(point);
  const distances = pieces.map((piece) => { const tool = new oc.BRepExtrema_DistShapeShape_1(), range = new oc.Message_ProgressRange_1(); tool.LoadS1(vertex.Shape()); tool.LoadS2(piece.wrapped); tool.Perform(range); const d = tool.IsDone() ? tool.Value() : Infinity; tool.delete(); range.delete(); return d; });
  vertex.delete(); point.delete();
  const nearest = distances.indexOf(Math.min(...distances));
  for (let i = 0; i < pieces.length; i++) if (i !== nearest) release(pieces[i]);
  if (!(distances[nearest] <= 1e-4)) { release(pieces[nearest]); throw new Error("A neighbouring face's surface does not reach the moved face. Reduce the distance or include the neighbour in the selection."); }
  return own(pieces[nearest]);
}
function tidy(shape: Shape3D): Shape3D {
  const oc = getOC();
  for (const unifyEdges of [true, false]) {
    try {
      const unifier = new oc.ShapeUpgrade_UnifySameDomain_2(shape.wrapped, unifyEdges, true, false);
      unifier.Build();
      const result = cast(unifier.Shape());
      unifier.delete();
      if (isShape3D(result)) return result;
      result.delete();
    } catch { /* try the next form */ }
  }
  return shape;
}
/** A fuse or cut with a fuzzy tolerance: coincident surfaces (a region sharing a
 *  cylinder with the part it joins) make the exact boolean throw. */
export function fuzzyBoolean(a: Shape3D, b: Shape3D, operation: "fuse" | "cut" | "common", options: { glue?: boolean; fuzzy?: number } = {}): Shape3D {
  const oc = getOC();
  const op = operation === "fuse" ? new oc.BRepAlgoAPI_Fuse_1() : operation === "cut" ? new oc.BRepAlgoAPI_Cut_1() : new oc.BRepAlgoAPI_Common_1();
  const arguments_ = new oc.TopTools_ListOfShape_1(), tools = new oc.TopTools_ListOfShape_1();
  arguments_.Append_1(a.wrapped); tools.Append_1(b.wrapped);
  // Glue mode treats the coincident faces as shared instead of intersecting them;
  // the fuzzy value lets tangent surfaces (a fillet's tube against its plane) meet.
  op.SetArguments(arguments_); op.SetTools(tools); if (options.glue ?? true) op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift as never); op.SetFuzzyValue(options.fuzzy ?? 1e-6);
  const progress = new oc.Message_ProgressRange_1();
  op.Build(progress);
  const result = cast(op.Shape());
  op.delete(); arguments_.delete(); tools.delete(); progress.delete();
  if (!isShape3D(result)) { result.delete(); throw new Error("The boolean operation left no solid."); }
  return result;
}
/** The part of face `a` inside shape `b` (BRepAlgoAPI_Common on a face), as faces. */
function commonFaces(a: Face, b: Face | Shape3D): Face[] {
  const oc = getOC();
  const progress = new oc.Message_ProgressRange_1();
  // The two-shape constructor already builds; a second Build would run it again.
  const op = new oc.BRepAlgoAPI_Common_3(a.wrapped, b.wrapped, progress);
  const result = cast(op.Shape());
  const faces = result.faces;
  result.delete(); op.delete(); progress.delete();
  return faces;
}
function commonArea(a: Face, b: Face | Shape3D): number {
  let area = 0;
  for (const piece of commonFaces(a, b)) { area += measureArea(piece); piece.delete(); }
  return area;
}
/** The planar caps of a prism whose outward normal is `sign * direction`. */
function capFaces(prism: Shape3D, direction: V3, sign: 1 | -1): Face[] {
  const caps: Face[] = [];
  for (const face of prism.faces) {
    let keep = false;
    if (face.geomType === "PLANE") {
      const center = deleteAfterVectorTuple(face.center);
      const normal = deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]));
      keep = dot([normal[0], normal[1], normal[2]], direction) * sign > 1 - 1e-7;
    }
    if (keep) caps.push(face); else face.delete();
  }
  return caps;
}
/** A solid filling the side of the plane through `point` that `keep` points into, out to `span`. */
function halfSpace(point: V3, keep: V3, span: number, own: <T>(shape: T) => T): Shape3D {
  // replicad's base box is centred in x and y and grows from z = 0 upward.
  // Transforms consume their receiver, so only the final shape is owned.
  const box = makeBaseBox(2 * span, 2 * span, 2 * span);
  const axis = cross([0, 0, 1], keep), sine = norm(axis), cosine = keep[2];
  const turned = sine < 1e-9 ? (cosine > 0 ? box : box.rotate(180, [0, 0, 0], [1, 0, 0])) : box.rotate(Math.atan2(sine, cosine) * 180 / Math.PI, [0, 0, 0], axis);
  return own(turned.translate(point[0], point[1], point[2]));
}
import type { ImportedModelData, PartGeometryData } from "../contracts/index";
import type { TopAbs_ShapeEnum } from "replicad-opencascadejs";
import { buildPartGeometry } from "./part-geometry";
import { facesOf } from "./exact-topology";
import { deleteAfterVectorTuple } from "../geometry/index";
import type { SketchContour, SketchFrame } from "../sketch/drawing";
import type { SolidVertexAnchor } from "../document/extrusion-point-reference";
import { importSolidShape, meshUnitScale } from "./import-shape";
import { binarySTL, flatNormals, meshIsClosed, parseMesh, type MeshFormat } from "./mesh-formats";
import { extendedKernel, extendedSolids, extendedStopSurfaces, fromExtended, toExtended, type FullOC } from "./extended-kernel";
import type { ExtrusionScopeResolution } from "../document/extrusion-scope";
import { sha256Hex } from "./sha256";
import {
  availableBodies,
  bodyIDForFeature,
  rollbackPosition,
  validatePartDocument,
  type ExtrudeFeature,
  type ExtrusionPointReference,
  type PartDocument,
} from "../document/index";
import { rectangleSketchRevision } from "../sketch/index";
import "./booleans";
import { vertexAnchorsOf } from "./part-geometry";
import { readBrep, writeBrep } from "./brep-bytes";
export function release(value: unknown) {
  try {
    (value as { delete?: () => void }).delete?.();
  } catch {
    /* OCCT may transfer ownership. */
  }
}
/** A sketch's closed regions, each with the key FreeCAD's body identities are
 *  derived from (the contour id, or the sketch id for a sole region). */
interface Region { key: string; drawing: Drawing; outer?: Drawing; holes?: Drawing[]; /** A region several open curves enclose together, by their contour ids. */ sourceContourIds?: string[]; insideContourIds?: string[]; ordinal?: number; boundary?: string[]; cell?: true }
interface Circle { key: string; center: [number, number]; radius: number }
/** An exact rho conic (FreeCAD's conic_wire): a rational quadratic B-spline whose
 *  middle pole is the endpoint tangents' intersection, weighted rho/(1−rho), so a
 *  parabola (rho ½), an ellipse arc or a hyperbola arc is the curve itself. */
function conicTo(pen: DrawingPen, control: [number, number], end: [number, number], rho: number): void {
  if (!(rho > 0 && rho < 1)) throw new Error("Conic rho must be greater than 0 and less than 1.");
  const oc = getOC();
  const inner = pen as unknown as { pointer: [number, number]; pendingCurves: Curve2D[]; _convertToUV(p: [number, number]): [number, number] };
  const poles = new oc.TColgp_Array1OfPnt2d_2(1, 3);
  [inner.pointer, control, end].forEach((p, i) => { const uv = inner._convertToUV([p[0], p[1]]), point = new oc.gp_Pnt2d_3(uv[0], uv[1]); poles.SetValue(i + 1, point); point.delete(); });
  const weights = new oc.TColStd_Array1OfReal_2(1, 3); [1, rho / (1 - rho), 1].forEach((w, i) => weights.SetValue(i + 1, w));
  const knots = new oc.TColStd_Array1OfReal_2(1, 2); knots.SetValue(1, 0); knots.SetValue(2, 1);
  const multiplicities = new oc.TColStd_Array1OfInteger_2(1, 2); multiplicities.SetValue(1, 3); multiplicities.SetValue(2, 3);
  const curve = new oc.Geom2d_BSplineCurve_2(poles, weights as never, knots as never, multiplicities, 2, false);
  inner.pendingCurves.push(new Curve2D(new oc.Handle_Geom2d_Curve_2(curve)));
  inner.pointer = [end[0], end[1]];
  poles.delete(); weights.delete(); knots.delete(); multiplicities.delete();
}
/** A sketch contour as a replicad drawing: closed ones become regions, open ones thin-wall paths. */
function contourDrawing(contour: SketchContour, _featureId: string): Drawing {
  if (contour.type === "circle") return drawCircle(contour.radius).translate(contour.center);
  const pen = draw(contour.start);
  for (const segment of contour.segments) {
    if (segment.type === "conic") { conicTo(pen, segment.control, segment.end, segment.rho); continue; }
    if (segment.type === "arc") pen.threePointsArcTo(segment.end, segment.middle);
    else if (segment.type === "ellipse") pen.ellipseTo(segment.end, segment.radiusX, segment.radiusY, segment.rotationDegrees, segment.largeArc, segment.sweep);
    else if (segment.type === "bezier") pen.bezierCurveTo(segment.end, segment.controls);
    else pen.lineTo(segment.end);
  }
  return pen.done();
}
type Profiles = Map<string, { drawing?: Drawing; plane: "XY" | "XZ" | "YZ" | Plane; offset: number; regions: Region[]; cells?: Region[]; circles: Circle[]; contours: SketchContour[] }>;
/** The engine state after one feature of a document's history, kept so the
 *  next evaluation replays only from the first feature that changed. */
interface Step { key: string; profiles: Profiles; tools: Map<string, Shape3D>; bodies: Map<string, Shape3D>; meshes: Map<string, MeshPart>; currentBodyID?: string; outputs: Record<string, string[]>; frames: Record<string, SketchFrame>; scopes: Record<string, ExtrusionScopeResolution>; owned: unknown[]; /** Read from a snapshot: exact shapes, no sketch profiles yet. */ restored?: true }
const steps = new Map<string, Step[]>();
const MAX_CACHED_DOCUMENTS = 3;
/** The mesh of a shape, built once; each caller gets its own buffers to transfer. */
const meshes = new WeakMap<object, PartGeometryData>();

function hashKey(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash.toString(36) + text.length.toString(36);
}
function dropSteps(list: Step[], from: number): void {
  for (const step of list.splice(from)) for (const shape of step.owned.reverse()) release(shape);
}
/** Forget every cached evaluation (tests; a worker restart). */
export function resetEvaluationCache(): void {
  for (const list of steps.values()) dropSteps(list, 0);
  steps.clear();
}
/** How many history steps the cache holds for a document. */
export function cachedSteps(documentId: string): number { return steps.get(documentId)?.length ?? 0; }

/** Each history step's key: its feature and every feature before it. */
function historyKeys(document: PartDocument): string[] {
  const keys: string[] = [];
  document.features.slice(0, rollbackPosition(document)).reduce((previous, feature) => { const key = hashKey(previous + JSON.stringify(feature)); keys.push(key); return key; }, "");
  return keys;
}

/** A document's replay cache as plain data, to outlive the worker. Each distinct exact shape
 *  is stored once as binary B-rep and steps name shapes by index. Sketch profiles are not
 *  kept: the replay after a restore re-solves sketches and adopts every other step's shapes. */
export interface EvaluationSnapshot { source: string; shapes: Uint8Array[]; steps: SnapshotStep[] }
interface SnapshotStep { key: string; bodies: [string, number][]; tools: [string, number][]; meshes: [string, MeshPart][]; currentBodyID?: string; outputs: Record<string, string[]>; frames: Record<string, SketchFrame>; scopes: Record<string, ExtrusionScopeResolution> }

/** Shapes never change once built, so after an edit only the replayed steps' shapes are written. */
const written = new WeakMap<Shape3D, Uint8Array>();
/** The cached steps that match this document, or nothing when none do. */
export function snapshotEvaluation(document: PartDocument): EvaluationSnapshot | undefined {
  const keys = historyKeys(document), list = steps.get(document.documentId) ?? [];
  let count = 0;
  while (count < list.length && count < keys.length && list[count].key === keys[count]) count++;
  if (!count) return undefined;
  const index = new Map<Shape3D, number>(), shapes: Uint8Array[] = [];
  const refer = (map: Map<string, Shape3D>) => [...map].map(([id, shape]): [string, number] => {
    let at = index.get(shape);
    if (at === undefined) {
      let bytes = written.get(shape);
      if (!bytes) { bytes = writeBrep(shape); written.set(shape, bytes); }
      at = shapes.push(bytes) - 1; index.set(shape, at);
    }
    return [id, at];
  });
  return { source: JSON.stringify(document), shapes, steps: list.slice(0, count).map((step) => ({
    key: step.key, bodies: refer(step.bodies), tools: refer(step.tools), meshes: [...step.meshes], currentBodyID: step.currentBodyID,
    outputs: step.outputs, frames: step.frames, scopes: step.scopes })) };
}

/** Seeds an empty replay cache from a snapshot, for the steps whose features are exactly this
 *  document's. Anything malformed or unreadable restores nothing; the next build replays fully.
 *  Returns how many steps were restored. */
export function restoreEvaluation(document: PartDocument, snapshot: EvaluationSnapshot): number {
  if (steps.get(document.documentId)?.length) return 0;
  const created: Shape3D[] = [];
  try {
    const saved = JSON.parse(snapshot.source) as PartDocument;
    if (saved.documentId !== document.documentId || !Array.isArray(snapshot.steps) || !Array.isArray(snapshot.shapes)) return 0;
    const keys = historyKeys(document), mine = document.features, theirs = saved.features.slice(0, rollbackPosition(saved));
    let count = 0;
    while (count < snapshot.steps.length && count < keys.length && count < theirs.length && snapshot.steps[count].key === keys[count]
      && JSON.stringify(theirs[count]) === JSON.stringify(mine[count])) count++;
    if (!count) return 0;
    const read = new Map<number, Shape3D>();
    const list = snapshot.steps.slice(0, count).map((step): Step => {
      const owned: Shape3D[] = [];
      const take = (pairs: [string, number][]) => new Map(pairs.map(([id, at]): [string, Shape3D] => {
        let shape = read.get(at);
        if (!shape) {
          if (!(snapshot.shapes[at] instanceof Uint8Array)) throw new Error("Missing shape data.");
          shape = readBrep(snapshot.shapes[at]); created.push(shape); owned.push(shape); read.set(at, shape);
        }
        return [id, shape];
      }));
      for (const [, mesh] of step.meshes) if (!(mesh.vertices instanceof Float32Array && mesh.normals instanceof Float32Array && mesh.triangles instanceof Uint32Array)) throw new Error("Damaged mesh data.");
      return { key: step.key, profiles: new Map(), tools: take(step.tools), bodies: take(step.bodies), meshes: new Map(step.meshes), currentBodyID: step.currentBodyID,
        outputs: { ...step.outputs }, frames: { ...step.frames }, scopes: { ...step.scopes }, owned, restored: true };
    });
    steps.set(document.documentId, list);
    return count;
  } catch {
    created.forEach(release);
    return 0;
  }
}

/** The groove of a 60° internal thread: a V section on the drilled wall swept along a helix of the
 *  standard's pitch, starting one pitch above the surface so the thread runs out cleanly. The hole
 *  (tap drill) is already cut; this removes the flanks out to the major diameter. */
function helicalThreadGroove(center: V3, direction: V3, minorRadius: number, spec: ThreadSpecification, length: number, leftHand: boolean, own: <T>(shape: T) => T): Shape3D {
  const pitch = spec.pitchMillimeters, depth = spec.majorDiameterMillimeters / 2 - minorRadius;
  if (depth <= 1e-6) throw new Error(`A ${spec.designation} thread needs a hole drilled under ${spec.majorDiameterMillimeters} mm.`);
  const origin: V3 = [0, 1, 2].map((i) => center[i] - direction[i] * pitch) as V3;
  const helix = own(makeHelix(pitch, length + 2 * pitch, minorRadius, origin, direction, leftHand));
  const first = helix.edges[0], startPoint = deleteAfterVectorTuple(first.startPoint) as V3;
  helix.edges.forEach((edge) => edge.delete());
  const radial = unit(sub(startPoint, origin));
  const plane = own(new Plane(startPoint, radial, cross(radial, direction)));
  // Half the base width of the V on the minor diameter (ISO 60° flanks), kept under the pitch.
  const half = Math.min(depth * Math.tan(Math.PI / 6), pitch * 0.45), inset = Math.min(0.05, minorRadius / 10);
  const section = own(draw([-inset, -half]).lineTo([depth, 0]).lineTo([-inset, half]).close().sketchOnPlane(plane));
  const swept = genericSweep((section as unknown as { wire: import("replicad").Wire }).wire, helix, { frenet: true, transitionMode: "transformed" });
  if (!isShape3D(swept) || measureVolume(swept) <= 1e-9) throw new Error(`The ${spec.designation} thread could not be modelled on this hole.`);
  return own(swept);
}

/** Evaluates persisted features into an exact OCCT solid; meshes are disposable. */
export function evaluatePartDocument(
  document: PartDocument,
  options: { preview?: boolean; withBodies?: (bodies: ReadonlyMap<string, Shape3D>) => void; withMeshes?: (meshes: ReadonlyMap<string, MeshPart>) => void; observe?: import('./evaluation-timing').EvaluationObserver } = {},
): ImportedModelData {
  validatePartDocument(document);
  const started = performance.now();
  const bodyOutputs: Record<string, string[]> = {};
  const sketchFrames: Record<string, SketchFrame> = {};
  const scopeResolutions: Record<string, ExtrusionScopeResolution> = {};
  const geometry = (shape: Shape3D, id: string, name: string, index: number, preview = false) => {
    const displayStarted = options.observe ? performance.now() : 0;
    let cached = meshes.get(shape);
    const wasCached = Boolean(cached);
    // A preview's own tool body is drawn once as an overlay: a coarser mesh, no topology, not kept.
    if (!cached && preview) {
      const result = buildPartGeometry(shape, document.documentId, document.name + AETHER_CAD_EXTENSION, index, { id, name, preview: true });
      options.observe?.({ phase: 'display', id, cached: false, milliseconds: performance.now() - displayStarted });
      return result;
    }
    if (!cached) { cached = buildPartGeometry(shape, document.documentId, document.name + AETHER_CAD_EXTENSION, index, { id, name }); meshes.set(shape, cached); }
    const result = { ...cached, id, name, vertices: cached.vertices.slice(), normals: cached.normals.slice(), triangles: cached.triangles.slice(), edgeLines: cached.edgeLines.slice() };
    options.observe?.({ phase: 'display', id, cached: wasCached, milliseconds: performance.now() - displayStarted });
    return result;
  };
  // The feature previewed: the last unsuppressed solid feature before the rollback bar.
  const history = document.features.slice(0, rollbackPosition(document));
  const last = history[history.length - 1];
  const previewId = options.preview && last && !last.suppressed && !["sketch", "profile", "plane", "axis", "point", "thread", "curve3d"].includes(last.type) ? last.id : undefined;
  // Manipulators the previewed feature publishes as its branch runs: one per draggable
  // parameter, placed on the geometry it changes. Extrude also keeps its axes contract.
  const previewHandles: PreviewHandle[] = [], previewAxes: ExtrusionPreviewAxis[] = [];
  const publish = (feature: { id: string }, handle: PreviewHandle) => { if (feature.id === previewId) previewHandles.push(handle); };
  const perpendicular = (d: V3): V3 => { const seed: V3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const c = cross(d, seed); const l = norm(c) || 1; return [c[0] / l, c[1] / l, c[2] / l]; };
  // Replay only from the first feature whose inputs changed: every step's state
  // is kept (shapes included) until a later evaluation diverges there.
  const keys = historyKeys(document);
  const cached = steps.get(document.documentId) ?? [];
  steps.delete(document.documentId); steps.set(document.documentId, cached);
  if (steps.size > MAX_CACHED_DOCUMENTS) { const oldest = steps.keys().next().value!; dropSteps(steps.get(oldest)!, 0); steps.delete(oldest); }
  let reuse = 0;
  while (reuse < cached.length && reuse < keys.length && cached[reuse].key === keys[reuse]) reuse++;
  // The previewed feature always runs, so its manipulators are published even when nothing changed yet.
  if (previewId !== undefined) { const at = history.findIndex((f) => f.id === previewId); if (at >= 0 && reuse > at) reuse = at; }
  // Steps past a rollback bar stay cached; only a changed feature discards what follows it.
  if (reuse < cached.length && reuse < keys.length) dropSteps(cached, reuse);
  // Restored steps have exact shapes but no sketch profiles: replay from the first of them,
  // re-solving sketches and adopting every other feature's saved state.
  const thawFrom = cached.findIndex((step, index) => index < reuse && step.restored);
  let thawed: Step[] = [], adopted = 0;
  if (thawFrom >= 0) { dropSteps(cached, reuse); thawed = cached.splice(thawFrom); reuse = thawFrom; }
  const resume = cached[reuse - 1];
  const profiles: Profiles = new Map(resume?.profiles);
  const tools = new Map<string, Shape3D>(resume?.tools);
  const bodies = new Map<string, Shape3D>(resume?.bodies);
  const meshParts = new Map<string, MeshPart>(resume?.meshes);
  let currentBodyID: string | undefined = resume?.currentBodyID;
  Object.assign(bodyOutputs, resume?.outputs);
  Object.assign(sketchFrames, resume?.frames);
  Object.assign(scopeResolutions, resume?.scopes);
  let stepOwned: unknown[] = [];
  const own = <T>(shape: T): T => {
    stepOwned.push(shape);
    return shape;
  };
  const combine = (
    tool: Shape3D,
    operation: "new" | "add" | "cut" | "intersect",
    feature: import("../document/index").PartFeature,
    solidKeys?: string[],
  ) => {
    if (operation === "new") {
      const id = bodyIDForFeature(document, feature);
      if (feature.type === "extrude" && feature.separateBodies) {
        const ids = solidsOf(tool).map((solid, index) => { const solidId = `${id}:solid-${solidKeys?.[index] ?? index + 1}`; if (bodies.has(solidId)) throw new Error("Duplicate output body identity."); bodies.set(solidId, own(solid)); return solidId; });
        bodyOutputs[feature.id] = ids;
        currentBodyID = ids[ids.length - 1];
        return;
      }
      bodies.set(id, own(tool.clone()));
      currentBodyID = id;
    } else {
      const id =
        ("targetBodyId" in feature && feature.targetBodyId) || currentBodyID;
      const body = id && bodies.get(id);
      if (id && meshParts.has(id)) throw new Error("This operation requires a solid body. Edit the mesh import and choose solid conversion first.");
      if (!body || !id) throw new Error("Select an existing target body.");
      const result = operation === "add" ? body.fuse(tool) : operation === "intersect" ? body.intersect(tool) : body.cut(tool);
      if (!isShape3D(result)) throw new Error("The operation left no solid.");
      bodies.set(id, own(result));
    }
  };
  {
    for (let index = reuse; index < history.length; index++) {
      const feature = history[index];
      const featureStarted = options.observe ? performance.now() : 0;
      stepOwned = [];
      let failed = false;
      try {
      const saved = thawed[index - thawFrom];
      if (saved) {
        stepOwned = saved.owned;
        if (feature.suppressed || (feature.type !== "sketch" && feature.type !== "profile")) {
          const replace = <T>(target: Map<string, T>, source: Map<string, T>) => { target.clear(); source.forEach((value, id) => target.set(id, value)); };
          const assign = (target: Record<string, unknown>, source: Record<string, unknown>) => { for (const id of Object.keys(target)) delete target[id]; Object.assign(target, source); };
          replace(bodies, saved.bodies); replace(tools, saved.tools); replace(meshParts, saved.meshes);
          assign(bodyOutputs, saved.outputs); assign(sketchFrames, saved.frames); assign(scopeResolutions, saved.scopes);
          currentBodyID = saved.currentBodyID;
          adopted++;
          continue;
        }
      }
      if (feature.suppressed || feature.type === "plane" || feature.type === "axis" || feature.type === "point" || feature.type === "thread" || feature.type === "curve3d") continue;
      try {
        if (feature.type === "sketch") {
          const state = rectangleSketchRevision(feature);
          const drawing = own(
            drawRectangle(
              state.widthMillimeters,
              state.heightMillimeters,
            ).translate(
              feature.profile.centerXMillimeters,
              feature.profile.centerYMillimeters,
            ),
          );
          profiles.set(feature.id, { drawing, plane: state.plane, offset: 0, regions: [{ key: feature.id, drawing }], circles: [], contours: [] });
          continue;
        }
        // The body a reference names, as it was right after the feature that made it.
        const bodyAt = (sourceFeatureId: string, bodyId: string): Shape3D | undefined => {
          const sourceIndex = history.findIndex((f) => f.id === sourceFeatureId);
          return sourceIndex >= 0 && sourceIndex < index ? cached[sourceIndex]?.bodies.get(bodyId) : undefined;
        };
        // Faces of a body by FreeCAD's geometric references: a planar face by its
        // outward normal, a curved one by surface type; the anchored centre and
        // area decide when several match. Other faces are released.
        const anchored = (face: Face, anchor: { centerMillimeters: number[]; areaSquareMillimeters: number } | undefined) => {
          if (!anchor) return true;
          const center = deleteAfterVectorTuple(face.center);
          return Math.hypot(center[0] - anchor.centerMillimeters[0], center[1] - anchor.centerMillimeters[1], center[2] - anchor.centerMillimeters[2]) <= 1e-6
            && Math.abs(measureArea(face) - anchor.areaSquareMillimeters) <= Math.max(1e-6, anchor.areaSquareMillimeters * 1e-9);
        };
        const uniqueFace = (body: Shape3D, matches: (face: Face) => boolean, label: string, hasAnchor: boolean, fallback?: (face: Face) => boolean): Face => {
          const faces = facesOf(body).map(({ face }) => face);
          let found = faces.filter(matches);
          if (!found.length && fallback) found = faces.filter(fallback);
          const selected = found.length === 1 ? found[0] : undefined;
          faces.forEach((face) => { if (face !== selected) face.delete(); });
          if (!selected) throw new Error(`${label} ${hasAnchor ? "changed or is ambiguous" : "is missing or ambiguous"}. Reselect the face on the earlier geometry.`);
          return selected;
        };
        const planarFaceOf = (body: Shape3D, normal: V3, anchor: { centerMillimeters: number[]; areaSquareMillimeters: number } | undefined, label: string, followNormalTranslation = false): Face => {
          const aligned = (face: Face) => {
            if (face.geomType !== "PLANE") return false;
            const center = deleteAfterVectorTuple(face.center);
            const outward = deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]));
            return outward[0] * normal[0] + outward[1] * normal[1] + outward[2] * normal[2] > 1 - 1e-7;
          };
          // An upstream depth edit can move a sketch's supporting face along its
          // normal. Follow only a unique face with the same area and in-plane
          // centroid; lateral changes or multiple matches require reselection.
          const translated = followNormalTranslation && anchor ? (face: Face) => {
            if (!aligned(face) || Math.abs(measureArea(face) - anchor.areaSquareMillimeters) > Math.max(1e-6, anchor.areaSquareMillimeters * 1e-9)) return false;
            const center = deleteAfterVectorTuple(face.center);
            const delta = sub([...center] as V3, anchor.centerMillimeters as V3);
            const along = delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2];
            return norm(sub(delta, scale(normal, along))) <= 1e-6;
          } : undefined;
          return uniqueFace(body, (face) => aligned(face) && anchored(face, anchor), `${label} face`, Boolean(anchor), translated);
        };
        const surfaceKinds: Record<string, string[]> = { cylinder: ["CYLINDRE", "CYLINDER"], cone: ["CONE"], sphere: ["SPHERE"], torus: ["TORUS"], bspline: ["BSPLINE_SURFACE"], bezier: ["BEZIER_SURFACE"], extrusion: ["EXTRUSION_SURFACE"], revolution: ["REVOLUTION_SURFACE"] };
        const surfaceFaceOf = (body: Shape3D, surfaceType: string, anchor: { centerMillimeters: number[]; areaSquareMillimeters: number } | undefined, label: string): Face => {
          const kinds = surfaceKinds[surfaceType];
          if (!kinds) throw new Error(`${label} needs a supported native surface reference. Reselect the face.`);
          return uniqueFace(body, (face) => kinds.includes(face.geomType) && anchored(face, anchor), `${label} surface`, Boolean(anchor));
        };
        const faceByReference = (body: Shape3D, ref: { normal?: V3 | number[]; surfaceType?: string; faceAnchor?: { centerMillimeters: number[]; areaSquareMillimeters: number } }, label: string): Face =>
          ref.surfaceType ? surfaceFaceOf(body, ref.surfaceType, ref.faceAnchor, label) : planarFaceOf(body, unit(ref.normal as V3), ref.faceAnchor, label);
        // The centre of such a planar face on the body as it was right after the feature that made it.
        const planarFaceCenter = (sourceFeatureId: string, bodyId: string, normal: V3, anchor: { centerMillimeters: number[]; areaSquareMillimeters: number } | undefined, label: string, missing: string, followNormalTranslation = false): V3 => {
          const body = bodyAt(sourceFeatureId, bodyId);
          if (!body) throw new Error(missing);
          const face = planarFaceOf(body, normal, anchor, label, followNormalTranslation);
          const center = [...deleteAfterVectorTuple(face.center)] as V3;
          face.delete();
          return center;
        };
        // Points, lines and wires of earlier sketches, placed by those sketches' frames.
        const sketchFrameOf = (sourceId: string): SketchFrame => {
          const sketchProfile = profiles.get(sourceId);
          if (!sketchProfile) throw new Error("The referenced sketch is unavailable.");
          // The built plane first: it already carries a followed face, an explicit frame and the flip.
          return typeof sketchProfile.plane === "string" ? (sketchFrames[sourceId] ?? principalFrame(sketchProfile.plane, sketchProfile.offset))
            : { originMillimeters: [sketchProfile.plane.origin.x, sketchProfile.plane.origin.y, sketchProfile.plane.origin.z], normal: [sketchProfile.plane.zDir.x, sketchProfile.plane.zDir.y, sketchProfile.plane.zDir.z], xDirection: [sketchProfile.plane.xDir.x, sketchProfile.plane.xDir.y, sketchProfile.plane.xDir.z] };
        };
        /** Where a sketch's region sits in the world: the centre of its drawing's box on its plane. */
        const sketchCentroid = (sourceId: string): V3 => {
          const frame = sketchFrameOf(sourceId), p = profiles.get(sourceId);
          const box = p?.drawing ? (p.drawing as unknown as { boundingBox?: { center?: [number, number] } }).boundingBox : undefined;
          const [cx, cy] = box?.center ?? [0, 0];
          const x = unit(frame.xDirection as V3), n = unit(frame.normal as V3), y = cross(n, x);
          return [0, 1, 2].map((i) => frame.originMillimeters[i] + x[i] * cx + y[i] * cy) as V3;
        };
        const sketchContour = (sourceId: string, contourId: string, unavailable: string) => {
          const source = history.find((f) => f.id === sourceId);
          if (!source || source.type !== "profile" || !profiles.has(sourceId)) throw new Error(unavailable);
          return resolveProfileDrawing(history, source.id).contours.find((c) => c.id === contourId);
        };
        const sketchPoint = (sourceId: string, local: [number, number]): V3 => {
          const f = sketchFrameOf(sourceId), x = f.xDirection as V3, y = cross(f.normal as V3, x);
          return add(f.originMillimeters as V3, add(scale(x, local[0]), scale(y, local[1])));
        };
        const stopPoint = (ref: ExtrusionPointReference | undefined): V3 => {
          if (!ref) throw new Error("Select a stopping vertex.");
          if (ref.kind === "solid-vertex") {
            const body = bodyAt(ref.sourceFeatureId, ref.bodyId);
            if (!body) throw new Error("Stopping vertex source is unavailable. Reselect an earlier part vertex.");
            // The vertex at its recorded position; a vertex an upstream edit moved is followed
            // by its incident-geometry signature when that is unique on the body (FreeCAD's
            // vertex_reference: an ambiguous or changed source fails for repair, never nearest).
            const p = ref.anchor.positionMillimeters;
            const matches = [...vertexAnchorsOf(body).values()].filter((anchor) => anchor.signature === ref.anchor.signature);
            if (matches.length === 1) return [...matches[0].positionMillimeters] as V3;
            if (!matches.length) throw new Error("Stopping vertex changed or is missing. Reselect it on the earlier geometry.");
            // Several vertices look alike: only the unchanged shape at the recorded point is trusted.
            const exact = matches.find((anchor) => anchor.shapeFingerprint === ref.anchor.shapeFingerprint && Math.hypot(anchor.positionMillimeters[0] - p[0], anchor.positionMillimeters[1] - p[1], anchor.positionMillimeters[2] - p[2]) <= 1e-6);
            if (exact) return [...exact.positionMillimeters] as V3;
            throw new Error("Stopping vertex is ambiguous after an upstream change. Reselect it on the earlier geometry.");
          }
          const unavailable = "Stopping sketch point is unavailable. Reselect a point in an earlier sketch.";
          const contour = sketchContour(ref.sourceFeatureId, ref.contourId, unavailable);
          let local: [number, number] | undefined;
          if (!contour) local = undefined;
          else if (contour.type === "circle") { if (ref.point === "center") local = contour.center; }
          else if (ref.point === "vertex") local = contour.startVertexId === ref.vertexId ? contour.start : contour.segments.find((seg) => seg.endVertexId === ref.vertexId)?.end;
          if (!local) throw new Error(unavailable);
          return sketchPoint(ref.sourceFeatureId, local);
        };
        // A line of an earlier sketch: its two ends in the world.
        const sketchLine = (ref: { sourceFeatureId: string; contourId: string; segmentId: string }, unavailable: string): [V3, V3] => {
          const contour = sketchContour(ref.sourceFeatureId, ref.contourId, unavailable);
          if (!contour || contour.type === "circle") throw new Error(unavailable);
          const at = contour.segments.findIndex((segment) => segment.id === ref.segmentId);
          if (at < 0) throw new Error(unavailable);
          const from = at === 0 ? contour.start : contour.segments[at - 1].end, to = contour.segments[at].end;
          return [sketchPoint(ref.sourceFeatureId, from), sketchPoint(ref.sourceFeatureId, to)];
        };
        // A closed region (or any contour) of an earlier sketch as a wire on that sketch's plane.
        /** A 3D sketch stands in for a sketch profile where a path is expected: no contours, one curve. */
        const pathSource = (sourceId: string) => profiles.get(sourceId) ?? (history.some((f) => f.id === sourceId && f.type === "curve3d" && !f.suppressed) ? { contours: [{ id: sourceId }] } as unknown as NonNullable<ReturnType<typeof profiles.get>> : undefined);
        const sketchWire = (sourceId: string, contourId: string | undefined, label: string, anyContour = false, selection?: ProfileRegionSelection): Wire => {
          // A 3D sketch is already a world curve: lines end to end, or one smooth curve through the points.
          const curve3d = history.find((f) => f.id === sourceId && f.type === "curve3d" && !f.suppressed);
          if (curve3d && curve3d.type === "curve3d") {
            if (curve3d.kind === "point") throw new Error(`${label}: a 3D point is not a path.`);
            const pts = curve3d.pointsMillimeters;
            const edges = curve3d.kind === "line" ? pts.slice(1).map((p, i) => own(makeLine3D(pts[i], p))) : [own(approximateBSpline(pts, { tolerance: 1e-4 }))];
            return own(assembleWire(edges));
          }
          const sketchProfile = profiles.get(sourceId);
          if (!sketchProfile) throw new Error(`${label} needs an available sketch.`);
          let drawing: Drawing | undefined;
          if (selection?.profileRegion) {
            drawing = [...sketchProfile.regions, ...(sketchProfile.cells ?? [])].find((r) => r.sourceContourIds && matchesProfileRegion(selection, r))?.drawing;
            if (!drawing) throw new Error(`${label}: the referenced curves no longer form the same closed region. Repair the sketch or reselect the region.`);
          } else if (anyContour && (contourId !== undefined || sketchProfile.contours.length === 1)) {
            // A sole curve needs no id (saved sketches before contour ids).
            const contour = contourId === undefined ? sketchProfile.contours[0] : sketchProfile.contours.find((c) => c.id === contourId);
            if (!contour) throw new Error(`${label} curve is no longer in its sketch.`);
            drawing = own(contourDrawing(contour, sourceId));
          } else if (contourId !== undefined) {
            drawing = sketchProfile.regions.find((r) => r.key === contourId)?.drawing;
            if (!drawing) throw new Error(`${label} region is no longer in its sketch.`);
          } else {
            if (sketchProfile.regions.length !== 1) throw new Error(`${label} sketch has ${sketchProfile.regions.length} regions — choose which one to use.`);
            drawing = sketchProfile.regions[0].drawing;
          }
          const plane = typeof sketchProfile.plane === "string" ? own(new Plane(principalFrame(sketchProfile.plane, sketchProfile.offset).originMillimeters, principalFrame(sketchProfile.plane).xDirection, principalFrame(sketchProfile.plane).normal)) : sketchProfile.plane;
          // A lone circle is one full-circle edge, as FreeCAD's sketches carry it.
          const region = !anyContour ? sketchProfile.regions.find((r) => r.drawing === drawing) : undefined;
          const circle = region && !(region.holes?.length) ? sketchProfile.circles.find((c) => c.key === region.key) : undefined;
          if (circle) {
            const center = deleteAfterVectorTuple(plane.toWorldCoords(circle.center)), normal = deleteAfterVectorTuple(plane.zDir);
            return own(assembleWire([own(makeCircle(circle.radius, [center[0], center[1], center[2]], [normal[0], normal[1], normal[2]]))]));
          }
          const sketch = own(own(drawing.clone()).sketchOnPlane(plane)) as unknown as { wire?: Wire };
          if (!sketch.wire) throw new Error(`${label} needs one closed region without holes.`);
          return sketch.wire;
        };
        // Transforms by reference resolve to plain transforms (FreeCAD's rule).
        // An axis feature's line, resolved against the features before it.
        const axisFeatureLine = (featureId: string): { origin: V3; axis: V3 } => {
          const index = document.features.findIndex((f) => f.id === featureId), axisFeature = document.features[index];
          if (!axisFeature || axisFeature.type !== "axis") throw new Error("Axis feature is unavailable. Reselect an axis.");
          const line = resolveAxisLine(axisFeature, document.features.slice(0, index));
          return { origin: [...line.originMillimeters] as V3, axis: unit(line.directionMillimeters) };
        };
        const resolveTransform = (t: import("../document/part-transform").PartTransform): import("../document/part-transform").PartTransform => {
          if (t.kind === "align" || t.kind === "mirror") return t;
          if (t.kind === "scale-reference") return { kind: "scale", centerMillimeters: stopPoint(t.centerReference), scaleFactors: t.scaleFactors };
          if (t.kind !== "translate-reference" && t.kind !== "rotate-reference") return t;
          const ref = t.reference;
          let start: V3, end: V3;
          if (ref.kind === "solid-edge") {
            const at = (anchor: SolidVertexAnchor) => stopPoint({ kind: "solid-vertex", sourceFeatureId: ref.sourceFeatureId, bodyId: ref.bodyId, anchor, label: ref.label });
            start = at(ref.anchor.start); end = at(ref.anchor.end);
          } else if (ref.kind === "two-points") { start = stopPoint(ref.from); end = stopPoint(ref.to); }
          else if (ref.kind === "sketch-line") [start, end] = sketchLine(ref, "Transform line is unavailable. Reselect a sketch line.");
          else throw new Error("Select a straight sketch line, solid edge or two ordered points for the transform.");
          const vector = sub(end, start), length = norm(vector);
          if (!Number.isFinite(length) || length < 1e-9) throw new Error("Transform points must be distinct. Reselect a nonzero line or two different points.");
          const direction = scale(vector, 1 / length);
          if (t.kind === "rotate-reference") return { kind: "rotate", axisOriginMillimeters: start, axisDirection: direction, angleDegrees: t.angleDegrees };
          const distance = t.distanceMillimeters ?? length;
          if (!Number.isFinite(distance)) throw new Error("Enter a finite transform distance and valid direction.");
          return { kind: "translate", translationMillimeters: scale(t.reversed ? neg(direction) : direction, distance) };
        };
        if (feature.type === "profile") {
          // A sketch on a face: the frame comes from the unique planar face of the
          // body as it was right after the feature that made it. Normal and x
          // direction are the support's own.
          let supportFrame: SketchFrame | undefined;
          if (feature.support) {
            const support = feature.support;
            const center = planarFaceCenter(support.sourceFeatureId, support.bodyId, support.normal as V3, support.faceAnchor, "Sketch support", "Sketch support body is unavailable at its source feature. Edit the sketch and reselect a planar face.", true);
            supportFrame = { originMillimeters: center, normal: [...support.normal], xDirection: [...support.xDirection] };
            // Published unflipped: the UI writes it back as the sketch's frame and applies the flip itself.
            sketchFrames[feature.id] = supportFrame;
          }
          // One frame authority per sketch: a followed face, an explicit frame, or the
          // principal plane and offset — then the flip. The profile's plane carries it, so
          // extrude directions and direction lines read the frame the profile was built in.
          const sketchFrame = flipSketchFrame(
            supportFrame ?? feature.frame ?? principalFrame(feature.plane, feature.offsetMillimeters), feature.flip);
          // Open-only sketches register too: thin walls and direction lines use them.
          let drawing: Drawing | undefined;
          const regions: Region[] = [];
          const cells: Region[] = [];
          const circles: Circle[] = [];
          const contours: SketchContour[] = [];
          // Projected sketches and sketches with Pierce constraints are resolved in their
          // document (sources composed, pierce points found, constraints solved) as the editor does.
          const pierced = feature.profile.type === "drawing" && (feature.profile.constraints ?? []).some((c) => c.kind === "pierce");
          const profile = feature.profile.type === "projection" || pierced ? resolveProfileDrawing(document.features.slice(0,rollbackPosition(document)),feature.id) : feature.profile;
          if (profile.type === "drawing") {
            const solved = solveDrawingConstraints(profile);
            contours.push(...solved.contours.filter(c=>!c.construction));
            const closed = contours.filter(contourClosed);
            let combined: Drawing | undefined;
            const regionFor = (index: number): Drawing => {
              const contour = closed[index];
              if (contour.type === "circle") circles.push({ key: contour.id ?? feature.id, center: [...contour.center], radius: contour.radius });
              return own(contourDrawing(contour, feature.id));
            };
            const groups = sketchRegionGroups(closed);
            // One closed contour is keyed by the sketch; several by their ids, as FreeCAD does.
            const keyOf = (index: number) => closed[index].id ?? feature.id;
            if (groups) {
              for (const group of groups) {
                const outer = regionFor(group.solid), holes = group.holes.map(regionFor);
                let region = outer;
                for (const hole of holes) region = own(region.cut(hole));
                regions.push({ key: keyOf(group.solid), drawing: region, outer, holes });
                combined = combined ? own(combined.fuse(region)) : region;
              }
              if (!combined && closed.some(c => c.hole)) throw new Error("A hole needs an outer closed profile.");
            } else {
              for (const index of sketchRegionOrder(closed)) {
                const contour = closed[index], region = regionFor(index);
                if(contour.hole && !combined) throw new Error("A hole needs an outer closed profile.");
                if (!contour.hole) regions.push({ key: keyOf(index), drawing: region, outer: region, holes: [] });
                combined=combined ? own(contour.hole ? combined.cut(region) : combined.fuse(region)) : region;
              }
            }
            // Legacy joined references mean the entire closed degree-two group,
            // even when other curves split it into new arrangement cells.
            for (const boundary of connectedSketchRegions(solved).regions) {
              const ids = boundary.contourIds ?? boundary.contourIndices.map(String);
              const region = own(contourDrawing(boundary.contour, feature.id));
              regions.push({ key: `connected:${JSON.stringify([...ids].sort())}`, drawing: region, outer: region, holes: [], sourceContourIds: boundary.contourIds });
            }
            for (const boundary of sketchFaceRegions(solved)) {
              if (!boundary.cell) continue;
              const outer = own(contourDrawing(boundary.contour, feature.id));
              const holes = (boundary.holes ?? []).map(hole => own(contourDrawing(hole, feature.id)));
              const drawing = holes.reduce((shape, hole) => own(shape.cut(hole)), outer);
              const contourIds = boundary.sourceContourIds ?? boundary.sourceContourIndices.map(String);
              const inside = boundary.insideContourIds ?? boundary.insideContourIndices?.map(String);
              cells.push({ key: `cell:${profileRegionIdentity({ profileRegion: { contourIds, inside, ordinal: boundary.ordinal, boundary: boundary.boundary } })}`,
                drawing, outer, holes, sourceContourIds: boundary.sourceContourIds,
                insideContourIds: boundary.insideContourIds, ordinal: boundary.ordinal, boundary: boundary.boundary, cell: true });
            }
            // Open contours remain saved and editable, but cannot create a solid.
            drawing=combined;
          } else if (profile.type === "circle") {
            drawing = drawCircle(profile.radiusMillimeters).translate(
              profile.centerMillimeters,
            );
            circles.push({ key: feature.id, center: [...profile.centerMillimeters], radius: profile.radiusMillimeters });
          }
          else {
            const points = profile.pointsMillimeters;
            const pen = draw(points[0]);
            for (const point of points.slice(1)) pen.lineTo(point);
            drawing = pen.close();
          }
          profiles.set(feature.id, {
            drawing: drawing && own(drawing),
            regions: regions.length ? regions : drawing ? [{ key: feature.id, drawing }] : [],
            cells,
            circles,
            contours,
            // Always sketch on an explicit principalFrame plane: replicad's
            // named-plane table disagrees with the engine's frame authority
            // (XZ mirrored, YZ rotated), so plane strings must never reach
            // the kernel — what the UI displays is what gets built.
            plane: own(new Plane(sketchFrame.originMillimeters, sketchFrame.xDirection, sketchFrame.normal)),
            offset: 0,
          });
          continue;
        }
        if (feature.type === "fillet" || feature.type === "chamfer") {
          const id = feature.targetBodyId ?? currentBodyID;
          const body = id && bodies.get(id);
          if (!body || !id) throw new Error("Create a solid before finishing edges.");
          bodies.set(id, own(buildEdgeFinish(feature, id, body, { own, previewId, publish, faceByReference })));
          continue;
        }
        if (feature.type === "extrude") {
          // Named so a forced engine tells the user exactly what is missing.
        }
        if (feature.type === "boolean") {
          currentBodyID = applyBooleanFeature(feature, bodies, own);
          continue;
        }
        if (feature.type === "pattern") {
          currentBodyID = applyPatternFeature(feature, {
            history, bodies, tools, bodyOutputs, currentBodyID, own, previewId,
            publish, resolveTransform, pathSource, sketchWire, axisFeatureLine,
          });
          continue;
        }
        if (feature.type === "hole") {
          // PartDesign::Hole with a flat drill point: a cylinder from the sketch
          // plane into the part (Reversed drills the other way), optionally under
          // a counterbore cylinder or a countersink cone of the head diameter.
          const id = feature.targetBodyId ?? currentBodyID;
          const body = id && bodies.get(id);
          if (!body || !id) throw new Error("Choose an existing target body for the hole.");
          // Where each hole starts and which way it drills: circle centres of a sketch
          // (one, or every one), or a picked point on a planar face (into the part).
          const starts: { center: V3; n: V3; x: V3 }[] = [];
          if (feature.placement) {
            const face = faceByReference(body, feature.placement.face, "Hole face");
            try {
              const center = deleteAfterVectorTuple(face.center), outward = deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]));
              const n = unit([-outward[0], -outward[1], -outward[2]]);
              starts.push({ center: [...feature.placement.pointMillimeters] as V3, n, x: canonicalPlaneXDirection(n) });
            } finally { face.delete(); }
          } else {
            const profile = profiles.get(feature.profileFeatureId!);
            if (!profile) throw new Error("Choose one circular sketch region for the hole center.");
            const circles = feature.allCircles ? profile.circles : profile.circles.filter((c) => feature.profileContourId === undefined ? profile.circles.length === 1 : c.key === feature.profileContourId);
            if (!circles.length) throw new Error("Choose one circular sketch region for the hole center.");
            const frame = typeof profile.plane === "string" ? principalFrame(profile.plane, profile.offset) : { normal: [profile.plane.zDir.x, profile.plane.zDir.y, profile.plane.zDir.z] as V3, originMillimeters: [profile.plane.origin.x, profile.plane.origin.y, profile.plane.origin.z] as V3, xDirection: [profile.plane.xDir.x, profile.plane.xDir.y, profile.plane.xDir.z] as V3 };
            const n = frame.normal as V3, o = frame.originMillimeters as V3, x = frame.xDirection as V3;
            const y: V3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
            for (const circle of circles) starts.push({ center: [0, 1, 2].map((i) => o[i] + x[i] * circle.center[0] + y[i] * circle.center[1]) as V3, n: [-n[0], -n[1], -n[2]], x });
          }
          const positive = (value: number | undefined, label: string) => { if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) throw new Error(`${label} must be positive and finite.`); return value; };
          const diameter = positive(feature.diameterMillimeters, "diameter_mm"), depth = positive(feature.depthMillimeters, "depth_mm");
          const counterbored = feature.cutType === "counterbore" || feature.cutType === "counterdrill";
          const countersunk = feature.cutType === "countersink" || feature.cutType === "counterdrill";
          const head = feature.cutType !== "plain" ? positive(feature.counterDiameterMillimeters, "counter_diameter_mm") : diameter;
          if (feature.cutType !== "plain" && head <= diameter) throw new Error("Head diameter must exceed the hole diameter.");
          const headDepth = counterbored ? positive(feature.counterDepthMillimeters, "counter_depth_mm") : 0;
          if (counterbored && feature.depthType === "blind" && headDepth >= depth) throw new Error("Counterbore depth must be less than the blind hole depth.");
          const angle = countersunk ? positive(feature.countersinkAngleDegrees, "countersink_angle_deg") : 90;
          if (angle >= 180) throw new Error("Countersink angle must be less than 180 degrees.");
          // FreeCAD's Hole options: a tapered wall, a drill-point cone below a blind depth,
          // and a standard thread (tapped at the tap drill, cosmetic unless modelled).
          const taperTangent = Math.tan((feature.taperAngleDegrees ?? 0) * Math.PI / 180);
          const drillPointAngle = feature.drillPoint === "angled" ? positive(feature.drillPointAngleDegrees ?? 118, "drill_point_angle_deg") : undefined;
          if (drillPointAngle !== undefined && drillPointAngle >= 180) throw new Error("Drill point angle must be less than 180 degrees.");
          const thread = feature.thread?.tapped ? feature.thread : undefined;
          const threadSpec = thread ? threadSpecification(thread.standard, thread.designation) : undefined;
          if (thread && !threadSpec) throw new Error(`Unknown ${thread.standard} thread size "${thread.designation}".`);
          if (threadSpec && diameter >= threadSpec.majorDiameterMillimeters) throw new Error(`A ${threadSpec.designation} tapped hole must be drilled under ${threadSpec.majorDiameterMillimeters} mm.`);
          let tool: Shape3D | undefined, threadTool: Shape3D | undefined;
          for (const start of starts) {
            const direction: V3 = feature.direction ? (() => { const d = unit(feature.direction); return dot(d, start.n) < 0 ? unit([-d[0], -d[1], -d[2]]) : d; })() : feature.reversed ? [-start.n[0], -start.n[1], -start.n[2]] : start.n;
            const center = start.center;
            if (start === starts[0]) {
              publish(feature, { parameter: "depth", kind: "linear", originMillimeters: center, direction, label: "Hole depth" });
              publish(feature, { parameter: "diameter", kind: "linear", originMillimeters: [0, 1, 2].map((i) => center[i] + start.x[i] * feature.diameterMillimeters / 2) as V3, direction: start.x, scale: 2, label: "Hole diameter" });
            }
            const length = feature.depthType === "through-all" ? throughAllDistance([body], center, direction) : depth;
            const along = (offset: number): V3 => [0, 1, 2].map((i) => center[i] + direction[i] * offset) as V3;
            // Exact primitives at the start: cylinders along the drill direction, and revolved
            // frustums (or cones, when the lower radius is zero) whose top sits `offset` down the hole.
            const cylinder = (radius: number, extent: number) => own(makeCylinder(radius, extent, center, direction));
            const frustum = (topRadius: number, bottomRadius: number, height: number, offset = 0) => {
              let pen = draw([0, 0]).lineTo([topRadius, 0]).lineTo([bottomRadius, -height]);
              if (bottomRadius > 1e-9) pen = pen.lineTo([0, -height]);
              const section = own(pen.close());
              let cone = own(section.sketchOnPlane("XZ")).revolve([0, 0, 1], { origin: [0, 0, 0], angle: 360 });
              if (!isShape3D(cone)) throw new Error("The hole tool is not a valid solid.");
              cone = own(cone);
              const from: V3 = [0, 0, -1];
              const dotDir = from[0] * direction[0] + from[1] * direction[1] + from[2] * direction[2];
              if (dotDir < 1 - 1e-9) {
                const axis: V3 = dotDir <= -1 + 1e-9 ? [1, 0, 0] : [from[1] * direction[2] - from[2] * direction[1], from[2] * direction[0] - from[0] * direction[2], from[0] * direction[1] - from[1] * direction[0]];
                cone = own(cone.rotate(Math.acos(Math.max(-1, Math.min(1, dotDir))) * 180 / Math.PI, [0, 0, 0], axis));
              }
              const at = along(offset);
              return own(cone.translate(at[0], at[1], at[2]));
            };
            const bottomRadius = diameter / 2 - length * taperTangent;
            if (bottomRadius <= 1e-6) throw new Error("Hole taper closes the hole before its depth.");
            let one = taperTangent > 0 ? frustum(diameter / 2, bottomRadius, length) : cylinder(diameter / 2, length);
            if (counterbored) one = own(one.fuse(cylinder(head / 2, headDepth)));
            const coneHeight = (head - diameter) / 2 / Math.tan((angle / 2) * Math.PI / 180);
            if (feature.cutType === "countersink") one = own(one.fuse(frustum(head / 2, diameter / 2, coneHeight)));
            if (feature.cutType === "counterdrill") one = own(one.fuse(frustum(head / 2, diameter / 2, coneHeight, headDepth)));
            // A blind hole's drill point: the cone of the included angle under the depth (FreeCAD measures depth to the shoulder).
            if (drillPointAngle !== undefined && feature.depthType === "blind") one = own(one.fuse(frustum(bottomRadius, 0, bottomRadius / Math.tan((drillPointAngle / 2) * Math.PI / 180), length)));
            tool = tool ? own(tool.fuse(one)) : one;
            if (thread?.modeled && threadSpec) {
              const groove = helicalThreadGroove(center, direction, diameter / 2, threadSpec, Math.min(thread.depthMillimeters ?? length, length), Boolean(thread.leftHand), own);
              threadTool = threadTool ? own(threadTool.fuse(groove)) : groove;
            }
          }
          const before = measureVolume(body);
          let stock: Shape3D = body;
          if (threadTool) {
            // The groove goes in before the bore: this OCCT build cannot intersect a helical
            // sweep with a coaxial cylinder face, while the bore cuts through the grooved
            // wall fine. Cutting in that order gives the same solid.
            const grooved = body.cut(threadTool);
            if (!isShape3D(grooved) || measureVolume(grooved) >= before - 1e-8) throw new Error("The modelled thread removes no material. Check the thread depth.");
            stock = own(grooved);
            // ponytail: the recorded tool is the bore alone (fusing the groove in hits the same
            // intersection failure), so a pattern of this hole repeats an untapped bore.
          }
          const stockVolume = threadTool ? measureVolume(stock) : before;
          const result = stock.cut(tool!);
          if (!isShape3D(result) || Math.abs(measureVolume(result) - stockVolume) < 1e-8) throw new Error("Cut removes no material. Flip direction or check the selected target and depth.");
          bodies.set(id, own(result));
          tools.set(feature.id, tool!);
          currentBodyID = id;
          continue;
        }
        // A mirror plane: principal + offset, a plane feature's frame, or a picked planar face.
        const mirrorPlaneOf = (ref: import("../document/mirror-plane").MirrorPlaneReference): Plane => {
          if (ref.kind === "principal") { const f = principalFrame(ref.plane, ref.offsetMillimeters); return own(new Plane(f.originMillimeters, f.xDirection, f.normal)); }
          if (ref.kind === "feature") {
            const index = document.features.findIndex((f) => f.id === ref.featureId), planeFeature = document.features[index];
            if (!planeFeature || planeFeature.type !== "plane") throw new Error("Mirror plane feature is unavailable. Reselect a plane.");
            const f = constructionPlaneFrame(planeFeature, document.features.slice(0, index));
            return own(new Plane(f.originMillimeters, f.xDirection, f.normal));
          }
          if (ref.kind === "sketch-line") {
            const [a, b] = sketchLine(ref, "The plane's sketch line is unavailable. Reselect a straight sketch line.");
            const f = sketchFrameOf(ref.sourceFeatureId), along = unit(sub(b, a)), n = unit(cross(along, f.normal as V3));
            return own(new Plane(a, along, n));
          }
          const body = bodies.get(ref.bodyId);
          if (!body) throw new Error("Mirror face body is unavailable. Reselect a planar face.");
          const face = faceByReference(body, ref, "Mirror face");
          try {
            const center = deleteAfterVectorTuple(face.center), n = deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]));
            return own(new Plane([center[0], center[1], center[2]], canonicalPlaneXDirection([n[0], n[1], n[2]]), [n[0], n[1], n[2]]));
          } finally { face.delete(); }
        };
        if (feature.type === "boss" || feature.type === "rest") {
          // Plastic boss / rest: raised out of a planar face at a point, drafted by a frustum
          // (round) or a tapered box (rectangular); a boss may be bored from its top.
          const body = bodies.get(feature.targetBodyId);
          if (!body) throw new Error(`${feature.type === "boss" ? "Boss" : "Rest"} needs an available target part.`);
          const face = faceByReference(body, feature.face, feature.type === "boss" ? "Boss face" : "Rest face");
          let outward: V3, xDir: V3;
          try { const center = deleteAfterVectorTuple(face.center); const n = deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]])); outward = unit([n[0], n[1], n[2]]); xDir = canonicalPlaneXDirection(outward); } finally { face.delete(); }
          const base: V3 = [...feature.pointMillimeters] as V3, height = feature.heightMillimeters, draft = (feature.draftDegrees ?? 0) * Math.PI / 180;
          publish(feature, { parameter: "height", kind: "linear", originMillimeters: add(base, scale(outward, height)), direction: outward, label: `${feature.type === "boss" ? "Boss" : "Rest"} height` });
          if (feature.type === "boss") publish(feature, { parameter: "diameter", kind: "linear", originMillimeters: add(base, scale(xDir, feature.diameterMillimeters / 2)), direction: xDir, scale: 2, label: "Boss diameter" });
          const taper = (radius: number) => Math.max(radius - height * Math.tan(draft), radius * 0.05);
          const frustum = (bottomRadius: number, topRadius: number, h: number): Shape3D => {
            // Revolved about +Z from the origin, turned onto the outward normal, moved to the base point.
            const section = own(draw([0, 0]).lineTo([bottomRadius, 0]).lineTo([topRadius, h]).lineTo([0, h]).close());
            let cone = own(section.sketchOnPlane("XZ")).revolve([0, 0, 1], { origin: [0, 0, 0], angle: 360 });
            if (!isShape3D(cone)) throw new Error("The boss is not a valid solid.");
            cone = own(cone);
            const from: V3 = [0, 0, 1], d = dot(from, outward);
            if (d < 1 - 1e-9) { const axis = cross(from, outward); cone = own(cone.rotate(Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI, [0, 0, 0], Math.hypot(...axis) > 1e-9 ? unit(axis) : [1, 0, 0])); }
            return own(cone.translate(base[0], base[1], base[2]));
          };
          let tool: Shape3D;
          if (feature.type === "boss") {
            const r = feature.diameterMillimeters / 2;
            tool = frustum(r, taper(r), height);
            if (feature.holeDiameterMillimeters !== undefined && feature.holeDepthMillimeters !== undefined) {
              const topPoint = add(base, scale(outward, height));
              const bore = own(makeCylinder(feature.holeDiameterMillimeters / 2, feature.holeDepthMillimeters + 1e-3, add(topPoint, scale(outward, 1e-3)), [-outward[0], -outward[1], -outward[2]] as V3));
              const bored = tool.cut(bore); if (!isShape3D(bored)) throw new Error("The boss hole leaves no solid."); tool = own(bored);
            }
          } else if (feature.lengthMillimeters === undefined) {
            const r = feature.widthMillimeters / 2;
            tool = frustum(r, taper(r), height);
          } else {
            // A rectangular pad: lofted between its base and (drafted) top rectangle.
            const along = feature.alongMillimeters ? unit(feature.alongMillimeters) : xDir;
            const across = unit(cross(outward, along));
            const rect = (w: number, l: number, at: V3) => {
              const corners = [[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]].map(([a, b]) => add(add(at, scale(along, a)), scale(across, b)));
              return own(assembleWire(corners.map((p, i) => own(makeLine(p, corners[(i + 1) % 4])))));
            };
            const inset = height * Math.tan(draft);
            const topW = Math.max(feature.widthMillimeters - 2 * inset, feature.widthMillimeters * 0.05), topL = Math.max(feature.lengthMillimeters - 2 * inset, feature.lengthMillimeters * 0.05);
            const lofted = loft([rect(feature.widthMillimeters, feature.lengthMillimeters, base), rect(topW, topL, add(base, scale(outward, height)))], { ruled: true });
            if (!isShape3D(lofted) || measureVolume(lofted) <= 1e-9) throw new Error("The rest is not a valid solid.");
            tool = own(lofted);
          }
          const before = measureVolume(body);
          const joined = body.fuse(tool);
          if (!isShape3D(joined) || measureVolume(joined) <= before + 1e-9) throw new Error(`${feature.type === "boss" ? "Boss" : "Rest"} adds no material. Check that the point lies on the face.`);
          bodies.set(feature.targetBodyId, own(joined));
          tools.set(feature.id, tool);
          currentBodyID = feature.targetBodyId;
          continue;
        }
        if (feature.type === "lip" || feature.type === "snap-fit") {
          // Plastic lip/groove and snap fit: prisms built on the picked planar face.
          const body = bodies.get(feature.targetBodyId);
          if (!body) throw new Error(`${feature.type === "lip" ? "Lip" : "Snap fit"} needs an available target part.`);
          const face = faceByReference(body, feature.face, feature.type === "lip" ? "Lip face" : "Snap fit face");
          const prism = (f: Face, v: V3): Shape3D => {
            const o = getOC(), vec = new o.gp_Vec_4(v[0], v[1], v[2]);
            try { const s = cast(new o.BRepPrimAPI_MakePrism_1(f.wrapped, vec, false, true).Shape()); if (!isShape3D(s)) throw new Error("The plastic feature is not a solid."); return own(s); }
            finally { vec.delete(); }
          };
          let tool: Shape3D;
          if (feature.type === "lip") {
            const center = deleteAfterVectorTuple(face.center), n = unit([...deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]))] as V3);
            // replicad's outerWire() and innerWires() consume their face: ask clones, after the centre and normal.
            const outer = own(face.clone().outerWire()), inners = face.clone().innerWires(); inners.forEach((w) => own(w));
            const width = feature.widthMillimeters + (feature.shape === "groove" ? feature.gapMillimeters ?? 0 : 0);
            const areaOf = (w: Wire) => measureArea(own(makeFace(w)));
            // offset2D's sign follows the wire's winding; ask for the side by area.
            const offsetBy = (w: Wire, grow: boolean): Wire => { const a = own(w.clone().offset2D(width, "intersection")); return (areaOf(a) > areaOf(w)) === grow ? a : own(w.clone().offset2D(-width, "intersection")); };
            let bandOuter: Wire, bandInner: Wire;
            if (feature.side === "inside") { if (!inners.length) throw new Error("A lip inside needs a rim face with an inner edge: shell the body first."); bandInner = inners[0]; bandOuter = offsetBy(inners[0], true); }
            else { bandOuter = outer; bandInner = offsetBy(outer, false); }
            const along = scale(n, feature.shape === "groove" ? -feature.heightMillimeters : feature.heightMillimeters);
            const band = prism(own(makeFace(bandOuter)), along).cut(prism(own(makeFace(bandInner)), along));
            if (!isShape3D(band) || measureVolume(band) <= 1e-9) throw new Error("The lip band is empty. Check the width against the rim.");
            tool = own(band);
            const start = deleteAfterVectorTuple(bandOuter.startPoint);
            publish(feature, { parameter: "height", kind: "linear", originMillimeters: add([start[0], start[1], start[2]] as V3, along), direction: feature.shape === "groove" ? scale(n, -1) : n, label: feature.shape === "groove" ? "Groove depth" : "Lip height" });
          } else {
            const base = [...feature.pointMillimeters] as V3, n = unit([...deleteAfterVectorTuple(face.normalAt([base[0], base[1], base[2]]))] as V3);
            const raw = feature.hookDirectionMillimeters as V3, hook = unit(sub(raw, scale(n, dot(raw, n))));
            if (norm(hook) < 0.5) throw new Error("The hook direction must lie across the face, not along its normal.");
            const across = unit(cross(n, hook));
            const { lengthMillimeters: L, thicknessMillimeters: t, widthMillimeters: w, catchDepthMillimeters: cd, catchLengthMillimeters: cl } = feature;
            const at = (x: number, y: number): V3 => add(add(add(base, scale(hook, x)), scale(n, y)), scale(across, -w / 2));
            // Side profile: the arm, then a ledge out to the catch depth and a ramp back to the tip.
            const pts = [at(0, 0), at(t, 0), at(t, L - cl), at(t + cd, L - cl), at(t, L), at(0, L)];
            const wire = own(assembleWire(pts.map((p, i) => own(makeLine(p, pts[(i + 1) % pts.length])))));
            tool = prism(own(makeFace(wire)), scale(across, w));
            publish(feature, { parameter: "length", kind: "linear", originMillimeters: add(base, scale(n, L)), direction: n, label: "Arm length" });
            publish(feature, { parameter: "catchDepth", kind: "linear", originMillimeters: at(t + cd, L - cl), direction: hook, label: "Catch depth" });
          }
          const before = measureVolume(body);
          const result = feature.type === "lip" && feature.shape === "groove" ? body.cut(tool) : body.fuse(tool);
          if (!isShape3D(result) || Math.abs(measureVolume(result) - before) <= 1e-9) throw new Error(`${feature.type === "lip" ? (feature.shape === "groove" ? "Groove" : "Lip") : "Snap fit"} changes nothing. Check that it lies on the face.`);
          bodies.set(feature.targetBodyId, own(result));
          tools.set(feature.id, tool);
          currentBodyID = feature.targetBodyId;
          continue;
        }
        if (feature.type === "split-face") {
          // Each picked face split by a large face on the plane (general fuse); its pieces replace
          // it, and the part is sewn back into one solid of the same volume.
          const id = feature.targetBodyId, body = bodies.get(id);
          if (!body) throw new Error("Split face needs an available part.");
          const o = getOC() as any, plane = mirrorPlaneOf(feature.plane);
          const b = body.boundingBox.bounds, size = 4 * Math.max(1, Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]) + Math.hypot(plane.origin.x, plane.origin.y, plane.origin.z));
          const tool = own(planeToolFace([plane.origin.x, plane.origin.y, plane.origin.z], [plane.zDir.x, plane.zDir.y, plane.zDir.z], size));
          const picked = feature.faces.map((ref) => own(faceByReference(body, ref, "Face to split")));
          const split = splitFacesByTool(picked, tool);
          if (split.some((pieces) => pieces.length < 2)) throw new Error("The plane does not cross a picked face.");
          const sewing = new o.BRepBuilderAPI_Sewing(1e-4, true, true, true, false), progress = new o.Message_ProgressRange_1();
          try {
            for (const face of body.faces) { if (!picked.some((p) => p.isSame(face))) sewing.Add(face.wrapped); face.delete(); }
            for (const piece of split.flat()) { sewing.Add(piece.wrapped); own(piece); }
            sewing.Perform(progress);
            let result = cast(sewing.SewedShape()) as any;
            if ((result.wrapped as any).ShapeType().value === o.TopAbs_ShapeEnum.TopAbs_SHELL.value && o.BRep_Tool.IsClosed_1(result.wrapped)) {
              const solid = cast(new o.BRepBuilderAPI_MakeSolid_3(result.wrapped).Solid()) as Shape3D;
              result = measureVolume(solid) < 0 ? cast(solid.wrapped.Reversed()) : solid;
            }
            if (!isShape3D(result) || Math.abs(measureVolume(result) - measureVolume(body)) > 1e-6 * Math.max(1, measureVolume(body))) throw new Error("The split faces could not be sewn back into the part.");
            bodies.set(id, own(result as Shape3D)); currentBodyID = id;
          } finally { progress.delete(); sewing.delete(); }
          continue;
        }
        if (feature.type === "surface-fair") {
          // Fair: each picked (or every) untrimmed face's B-spline control net relaxed with its
          // border rows held, so the boundary stays put and the interior bends less; the faces
          // are rebuilt on the faired surfaces and sewn back.
          const id = feature.bodyIds[0], body = bodies.get(id);
          if (!body) throw new Error("Fair needs an available surface body.");
          const o = getOC() as any;
          const all = body.faces;
          const targets = feature.faces?.length ? feature.faces.map((ref) => faceByReference(body, ref, "Face to fair")) : all;
          const strength = feature.strength ?? 1, limit = feature.toleranceMillimeters;
          const rebuilt: any[] = [];
          for (const face of targets) {
            const handle = o.GeomConvert.SurfaceToBSplineSurface(o.BRep_Tool.Surface_2(face.wrapped)), s = handle.get();
            // Untrimmed: the face covers the surface's whole knot range and has no holes.
            const uv = face.UVBounds, holes = face.clone().innerWires();
            holes.forEach((w) => w.delete());
            const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
            if (holes.length || !near(uv.uMin, s.UKnot(s.FirstUKnotIndex())) || !near(uv.uMax, s.UKnot(s.LastUKnotIndex())) || !near(uv.vMin, s.VKnot(s.FirstVKnotIndex())) || !near(uv.vMax, s.VKnot(s.LastVKnotIndex())))
              throw new Error("Fair works on untrimmed faces (a loft, boundary or patch); this face is trimmed.");
            const nu = s.NbUPoles(), nv = s.NbVPoles();
            if (nu < 3 || nv < 3) throw new Error("This face has no interior control points to fair.");
            const P: V3[][] = [];
            for (let i = 1; i <= nu; i++) { const row: V3[] = []; for (let j = 1; j <= nv; j++) { const p = s.Pole(i, j); row.push([p.X(), p.Y(), p.Z()]); p.delete(); } P.push(row); }
            // ponytail: membrane (Laplace) relaxation of the net, not SolidCraft's thin-plate Gram solve; boundary rows are exact either way.
            const T = P.map((row) => row.map((p) => [...p] as V3));
            for (let sweep = 0; sweep < 400; sweep++)
              for (let i = 1; i < nu - 1; i++) for (let j = 1; j < nv - 1; j++)
                T[i][j] = [0, 1, 2].map((k) => (T[i - 1][j][k] + T[i + 1][j][k] + T[i][j - 1][k] + T[i][j + 1][k]) / 4) as V3;
            for (let i = 1; i < nu - 1; i++) for (let j = 1; j < nv - 1; j++) {
              let d = [0, 1, 2].map((k) => (T[i][j][k] - P[i][j][k]) * strength) as V3;
              const l = Math.hypot(...d);
              if (limit !== undefined && l > limit) d = d.map((x) => (x * limit) / l) as V3;
              const q = new o.gp_Pnt_3(P[i][j][0] + d[0], P[i][j][1] + d[1], P[i][j][2] + d[2]); s.SetPole_1(i + 1, j + 1, q); q.delete();
            }
            const maker = new o.BRepBuilderAPI_MakeFace_8(new o.Handle_Geom_Surface_2(s), 1e-6);
            if (!maker.IsDone()) throw new Error("The faired face could not be rebuilt.");
            rebuilt.push(maker.Face()); maker.delete();
          }
          const sewing = new o.BRepBuilderAPI_Sewing(1e-4, true, true, true, false), progress = new o.Message_ProgressRange_1();
          try {
            for (const face of all) if (!targets.some((t) => t.isSame(face))) sewing.Add(face.wrapped);
            for (const face of rebuilt) sewing.Add(face);
            sewing.Perform(progress);
            const raw = sewing.SewedShape(), shape = cast(raw) as any;
            let sheet: Shape3D;
            if (isShape3D(shape)) sheet = shape;
            else { const builder = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell(); builder.MakeShell(shell); builder.Add(shell, raw); sheet = cast(shell) as Shape3D; }
            bodies.set(id, own(sheet)); currentBodyID = id;
          } finally { progress.delete(); sewing.delete(); }
          continue;
        }
        if (feature.type === "surface-trim") {
          // Trim: the sheet's faces split by a large face on the plane; the pieces on the keep
          // point's side stay, sewn back into one sheet.
          const id = feature.bodyIds[0], body = bodies.get(id);
          if (!body) throw new Error("Trim needs an available surface body.");
          const o = getOC() as any, plane = mirrorPlaneOf(feature.plane);
          const origin: V3 = [plane.origin.x, plane.origin.y, plane.origin.z], normal: V3 = [plane.zDir.x, plane.zDir.y, plane.zDir.z];
          const b = body.boundingBox.bounds, size = 4 * Math.max(1, Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]) + Math.hypot(...origin));
          const side = (p: readonly number[]) => (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] + (p[2] - origin[2]) * normal[2];
          const keep = side(feature.keepPointMillimeters);
          if (Math.abs(keep) < 1e-9) throw new Error("The keep point lies on the trimming plane. Move it to the side to keep.");
          const tool = own(planeToolFace(origin, normal, size));
          const faces = body.faces.map((f) => own(f));
          const pieces = splitFacesByTool(faces, tool).flat().map((p) => own(p));
          // A piece's side: a point inside it, the centre of its parameter box (pieces are on one side or the other).
          const kept = pieces.filter((p) => { const q = p.pointOnSurface(0.5, 0.5); const s = side([q.x, q.y, q.z]); q.delete(); return s * keep > 0; });
          if (!kept.length) throw new Error("Nothing of the surface lies on the keep point's side.");
          if (kept.length === pieces.length) throw new Error("The plane does not cross the surface.");
          const sewing = new o.BRepBuilderAPI_Sewing(1e-4, true, true, true, false), progress = new o.Message_ProgressRange_1();
          try {
            for (const p of kept) sewing.Add(p.wrapped);
            sewing.Perform(progress);
            const raw = sewing.SewedShape(), shape = cast(raw) as any;
            let sheet: Shape3D;
            if (isShape3D(shape)) sheet = shape;
            else { const builder = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell(); builder.MakeShell(shell); builder.Add(shell, raw); sheet = cast(shell) as Shape3D; }
            bodies.set(id, own(sheet)); currentBodyID = id;
          } finally { progress.delete(); sewing.delete(); }
          continue;
        }
        if (feature.type === "remove-body") {
          for (const id of feature.bodyIds) { const shape = bodies.get(id); if (!shape) throw new Error("A part to remove is unavailable."); bodies.delete(id); }
          if (currentBodyID && !bodies.has(currentBodyID)) currentBodyID = [...bodies.keys()].at(-1);
          continue;
        }
        if (feature.type === "transform") {
          // FreeCAD's rule: translate / rotate / uniform scale keep the exact
          // geometry; copies take the identities the document recorded for them.
          const t = resolveTransform(feature.transform);
          const moved: [string, Shape3D][] = [];
          for (const id of feature.bodyIds) {
            const shape = bodies.get(id);
            if (!shape) throw new Error("Choose distinct solid parts to transform (up to 256).");
            let result: Shape3D, ratio = 1;
            if (t.kind === "translate") result = own(shape.clone().translate(t.translationMillimeters[0], t.translationMillimeters[1], t.translationMillimeters[2]));
            else if (t.kind === "rotate") {
              if (Math.abs(Math.hypot(...t.axisDirection) - 1) > 1e-6 || !Number.isFinite(t.angleDegrees)) throw new Error("Rotation needs a unit axis and a finite angle in degrees.");
              result = own(shape.clone().rotate(t.angleDegrees, t.axisOriginMillimeters, t.axisDirection));
            } else if (t.kind === "scale") {
              if (t.scaleFactors.some((v) => v <= 0)) throw new Error("Scale factors must be positive.");
              ratio = t.scaleFactors[0] * t.scaleFactors[1] * t.scaleFactors[2];
              if (new Set(t.scaleFactors).size === 1) result = own(shape.clone().scale(t.scaleFactors[0], t.centerMillimeters));
              else {
                // An affine scale (FreeCAD's transformGeometry): the full build's GTransform.
                const f = extendedKernel();
                if (!f) throw new UnsupportedFeature(feature.id, "non-uniform scaling");
                const [sx, sy, sz] = t.scaleFactors, [cx, cy, cz] = t.centerMillimeters;
                const source = toExtended(shape), g = new f.gp_GTrsf_1(), shift = new f.gp_XYZ_2(cx * (1 - sx), cy * (1 - sy), cz * (1 - sz));
                g.SetValue(1, 1, sx); g.SetValue(2, 2, sy); g.SetValue(3, 3, sz); g.SetTranslationPart(shift);
                const op = new f.BRepBuilderAPI_GTransform_2(source, g, true);
                try { result = own(fromExtended(op.Shape())); }
                catch (error) { throw new Error("This part cannot yet be scaled differently on each axis without invalid geometry. Use Uniform scale or revise the source feature dimensions.", { cause: error }); }
                finally { op.delete(); shift.delete(); g.delete(); source.delete(); }
              }
            } else if (t.kind === "copy") result = own(shape.clone());
            else if (t.kind === "align") {
              // Resolve each side to a point and, for a face, its outward normal; faces turn to
              // face each other (or the same way with flip), then the from point lands on the to point.
              const resolveTarget = (target: import("../document/part-transform").AlignTarget): { at: V3; normal?: V3 } => {
                if (target.kind === "point") return { at: stopPoint(target.point) };
                const host = bodies.get(target.bodyId);
                if (!host) throw new Error("Align face body is unavailable.");
                const face = faceByReference(host, target, "Align face");
                try { const center = deleteAfterVectorTuple(face.center), n = deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]])); return { at: [center[0], center[1], center[2]], normal: unit([n[0], n[1], n[2]]) }; }
                finally { face.delete(); }
              };
              const from = resolveTarget(t.from), to = resolveTarget(t.to);
              let turned: Shape3D = shape;
              let fromAt = from.at;
              if (from.normal && to.normal) {
                const target = t.flip ? to.normal : ([-to.normal[0], -to.normal[1], -to.normal[2]] as V3);
                const d = dot(from.normal, target), axis = cross(from.normal, target), l = Math.hypot(...axis);
                const angle = Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
                if (angle > 1e-9) {
                  const about: V3 = l > 1e-9 ? unit(axis) : unit(cross(from.normal, Math.abs(from.normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
                  turned = own(shape.clone().rotate(angle, from.at, about));
                  const rotated = own(turned.clone());
                  // The from centre does not move under a rotation about itself.
                  rotated.delete();
                }
              }
              const move = sub(to.at, fromAt);
              result = own(turned.clone().translate(move[0], move[1], move[2]));
            }
            else if (t.kind === "mirror") {
              result = own(shape.clone().mirror(mirrorPlaneOf(t.plane)));
              if (t.combine) { const joined = shape.fuse(result); if (!isShape3D(joined)) throw new Error("The mirrored part could not be joined with the original."); result = own(joined); ratio = measureVolume(result) / Math.max(measureVolume(shape), 1e-12); }
            }
            else throw new Error("Choose Translate, Rotate, Scale, Mirror or Copy in place.");
            const expected = measureVolume(shape) * ratio;
            if (!isShape3D(result) || Math.abs(measureVolume(result) - expected) > Math.max(1e-6, expected * 1e-7)) throw new Error("Transform did not preserve the expected solid volume. For curved parts, use Uniform scale or revise the source feature dimensions.");
            moved.push([id, result]);
          }
          if (feature.copyBodyIds) {
            const ids = feature.bodyIds.map((id) => feature.copyBodyIds![id]);
            for (const [id, result] of moved) { const copyId = feature.copyBodyIds[id]; if (bodies.has(copyId)) throw new Error("Duplicate output body identity."); bodies.set(copyId, result); }
            bodyOutputs[feature.id] = ids;
            currentBodyID = ids[ids.length - 1];
          } else {
            for (const [id, result] of moved) bodies.set(id, result);
          }
          continue;
        }
        if (feature.type === "shell") {
          const id = feature.targetBodyId ?? currentBodyID;
          const body = id && bodies.get(id);
          if (!body || !id) throw new Error("Shell requires a solid.");
          const thickness = feature.thicknessMillimeters;
          if (!(thickness > 0)) throw new Error("Shell thickness must be positive.");
          if (feature.id === previewId) { const f0 = body.faces[0]; if (f0) { const c = f0.center, nv = f0.normalAt(c); publish(feature, { parameter: "thickness", kind: "linear", originMillimeters: [c.x, c.y, c.z], direction: unit([-nv.x, -nv.y, -nv.z]), label: "Shell thickness" }); c.delete(); nv.delete(); f0.delete(); } }
          const before = measureVolume(body);
          let result: Shape3D;
          if (!feature.removedFaces?.length) {
            // A closed shell removes an inward offset solid from the original (FreeCAD).
            let inside: Shape3D;
            try {
              const offset = own(makeOffset(body as unknown as Face, -thickness, 0.0001));
              // OCCT returns the inward offset of a part with holes as a closed shell,
              // not a solid, and sometimes inside out: orient it by its volume.
              inside = offset instanceof Shell ? own(makeSolid([offset])) : offset;
              if (measureVolume(inside) < 0) inside = own(cast(inside.wrapped.Reversed()) as Shape3D);
            } catch { throw new Error("Thickness does not leave a valid inner cavity."); }
            const cut = body.cut(inside);
            if (!isShape3D(cut) || measureVolume(cut) >= before) throw new Error("Thickness does not leave a valid inner cavity.");
            result = own(cut);
          } else {
            // Open faces: a face reference resolves on the current solid by outward
            // normal or surface type (so it survives upstream edits); a plane entry
            // keeps the original fixed-coordinate match.
            const planes: Plane[] = [], referenced: Face[] = [];
            for (const open of feature.removedFaces) {
              if ("sourceFeatureId" in open) referenced.push(faceByReference(body, open, "Shell open"));
              else { const frame = principalFrame(open.plane, open.offsetMillimeters); planes.push(own(new Plane(frame.originMillimeters, frame.xDirection, frame.normal))); }
            }
            for (const plane of planes) { const found = new FaceFinder().inPlane(plane).find(body); const count = found.length; found.forEach((face) => face.delete()); if (!count) throw new Error("shell matched no face on that plane to open"); }
            if (feature.tangentChain && referenced.length) {
              // Faces joined smoothly to a chosen face (one hop: a round between a lid and a wall
              // is smooth to both, and following it onward would open the whole part) join the opening.
              const all = body.faces, chosen = new Set(referenced.map((face) => all.findIndex((f) => f.wrapped.IsSame(face.wrapped))).filter((i) => i >= 0));
              const edgeKeys = (face: Face) => { const edges = face.edges; try { return edges.map((edge) => { const m = edge.pointAt(0.5); const k = `${m.x.toFixed(5)},${m.y.toFixed(5)},${m.z.toFixed(5)}`; const n = face.normalAt([m.x, m.y, m.z]); const out: [string, V3] = [k, [n.x, n.y, n.z]]; m.delete(); n.delete(); return out; }); } finally { edges.forEach((edge) => edge.delete()); } };
              const keys = all.map(edgeKeys);
              for (const i of [...chosen]) for (const [k, n] of keys[i]) all.forEach((_, j) => {
                if (chosen.has(j)) return;
                const match = keys[j].find(([k2]) => k2 === k);
                if (match && dot(n, match[1]) > Math.cos(Math.PI / 180)) chosen.add(j);
              });
              all.forEach((face, i) => { if (chosen.has(i) && !referenced.some((r) => r.wrapped.IsSame(face.wrapped))) referenced.push(face); else if (!chosen.has(i)) face.delete(); });
            }
            const picks = [...planes.map((plane) => (f: FaceFinder) => f.inPlane(plane)), ...(referenced.length ? [(f: FaceFinder) => f.inList(referenced)] : [])];
            const open = (finder: FaceFinder) => picks.length === 1 ? picks[0](finder) : finder.either(picks);
            // Outward walls keep sharp corners (an intersection join); replicad's shell
            // rounds offset corners, which is what saved inward shells were built with.
            const outward = (wall: number): Shape3D => {
              const oc = getOC(); const faces = open(new FaceFinder()).find(body); const list = new oc.TopTools_ListOfShape_1();
              faces.forEach((face) => list.Append_1(face.wrapped));
              const builder = new oc.BRepOffsetAPI_MakeThickSolid(), progress = new oc.Message_ProgressRange_1();
              try {
                builder.MakeThickSolidByJoin(body.wrapped, list, wall, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin as never, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection as never, false, progress);
                const shape = cast(builder.Shape());
                if (!isShape3D(shape)) { shape.delete(); throw new Error("Shell could not grow outward from those faces."); }
                return own(shape);
              } finally { faces.forEach((face) => face.delete()); list.delete(); builder.delete(); progress.delete(); }
            };
            const direction = feature.direction ?? "inside";
            let shelled: Shape3D;
            if (direction === "inside") { const inward = body.shell(thickness, open); if (!isShape3D(inward)) throw new Error("shell matched no face on that plane to open"); shelled = own(inward); }
            else if (direction === "outside") shelled = outward(thickness);
            else { const inward = body.shell(thickness / 2, open); if (!isShape3D(inward)) throw new Error("shell matched no face on that plane to open"); shelled = own(own(inward).fuse(outward(thickness / 2))); }
            referenced.forEach((face) => face.delete());
            result = shelled;
          }
          if ((feature.direction ?? "inside") !== "outside" && measureVolume(result) >= before - 1e-6) throw new Error("Shell thickness leaves no wall cavity. Use a thinner wall than half the part's smallest size.");
          bodies.set(id, result);
          continue;
        }
        if (feature.type === "face-extrude") {
          // Push/Pull (FreeCAD's rule): the unique planar face by outward normal
          // and anchor, extruded along its normal; positive adds, negative removes.
          const distance = feature.distanceMillimeters;
          if (!Number.isFinite(distance) || Math.abs(distance) < 1e-6) throw new Error("Push/Pull distance must be finite and nonzero.");
          const normal = unit(feature.normal);
          planarFaceCenter(feature.sourceFeatureId, feature.targetBodyId, normal, feature.faceAnchor, "Push/Pull", "Push/Pull source body is unavailable. Repair the face reference.");
          const body = bodies.get(feature.targetBodyId);
          if (!body) throw new Error("Push/Pull target body is unavailable.");
          const face = planarFaceOf(body, normal, feature.faceAnchor, "Push/Pull");
          const sweep = new Vector(scale(normal, distance));
          const prism = own(basicFaceExtrusion(face, sweep));
          sweep.delete(); face.delete();
          const joined = own(distance > 0 ? body.fuse(prism) : body.cut(prism));
          const pieces = solidsOf(joined), one = pieces.length === 1; pieces.forEach(release);
          if (!one || measureVolume(joined) <= 1e-9) throw new Error("Push/Pull must leave one valid solid. Reduce the distance.");
          const delta = measureVolume(joined) - measureVolume(body);
          if ((distance > 0 && delta <= 1e-8) || (distance < 0 && delta >= -1e-8)) throw new Error("Push/Pull changes no material. Check the face and distance.");
          bodies.set(feature.targetBodyId, own(joined.simplify()));
          currentBodyID = feature.targetBodyId;
          continue;
        }
        if (feature.type === "draft") {
          // Draft (PartDesign::Draft): the one planar face lying in the face plane
          // is tilted by the angle about the neutral plane, pulled along its normal.
          const id = feature.targetBodyId ?? currentBodyID;
          const body = id ? bodies.get(id) : undefined;
          if (!body || !id) throw new Error("Choose an existing target body for Draft.");
          const angle = feature.angleDegrees;
          if (!Number.isFinite(angle) || !(angle > 0 && angle < 90)) throw new Error("Draft angle must be greater than 0 and less than 90 degrees.");
          if (!Number.isFinite(feature.facePlane.offsetMillimeters) || !Number.isFinite(feature.neutralPlane.offsetMillimeters)) throw new Error("Draft plane offsets must be finite.");
          const axisOf = (plane: "XY" | "XZ" | "YZ"): V3 => plane === "XY" ? [0, 0, 1] : plane === "XZ" ? [0, 1, 0] : [1, 0, 0];
          const faceAxis = axisOf(feature.facePlane.plane), faceOffset = feature.facePlane.offsetMillimeters;
          const matches: Face[] = [];
          if (feature.faces) {
            // Picked faces: each resolves on the current solid by its outward normal and anchor.
            for (const ref of feature.faces) {
              if (ref.bodyId !== id) { matches.forEach((face) => face.delete()); throw new Error(`${ref.label} is on another body. Reselect faces on the target body.`); }
              matches.push(faceByReference(body, ref, "Draft face"));
            }
          } else {
            for (const { face } of facesOf(body)) {
              let keep = false;
              if (face.geomType === "PLANE") {
                const center = deleteAfterVectorTuple(face.center);
                const outward = deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]));
                keep = Math.abs(Math.abs(dot([outward[0], outward[1], outward[2]], faceAxis)) - 1) < 1e-7 && Math.abs(dot([center[0], center[1], center[2]], faceAxis) - faceOffset) < 1e-6;
              }
              if (keep) matches.push(face); else face.delete();
            }
            if (!matches.length) throw new Error("Draft face is unavailable on the selected plane. Repair the face reference.");
            if (matches.length !== 1) { matches.forEach((face) => face.delete()); throw new Error("Several faces match the draft plane. Choose an unambiguous face reference."); }
          }
          let neutralAxis = axisOf(feature.neutralPlane.plane), neutralPoint = scale(neutralAxis, feature.neutralPlane.offsetMillimeters);
          if (feature.neutralFace) {
            // A picked planar face as the neutral plane: its centre, and the pull
            // direction pointing from it into the part (the bottom face of a box
            // drafts exactly as the XY plane at z = 0 does).
            const neutralFace = faceByReference(body, feature.neutralFace, "Draft neutral face");
            const center = deleteAfterVectorTuple(neutralFace.center);
            neutralPoint = [center[0], center[1], center[2]];
            const n = deleteAfterVectorTuple(neutralFace.normalAt([center[0], center[1], center[2]]));
            neutralAxis = unit([-n[0], -n[1], -n[2]]);
            neutralFace.delete();
          }
          const oc = getOC();
          const pull = feature.pullDirection ? unit(feature.pullDirection) : neutralAxis;
          const direction = new oc.gp_Dir_4(pull[0], pull[1], pull[2]);
          const point = new oc.gp_Pnt_3(neutralPoint[0], neutralPoint[1], neutralPoint[2]);
          const neutralDir = new oc.gp_Dir_4(neutralAxis[0], neutralAxis[1], neutralAxis[2]);
          const neutral = new oc.gp_Pln_3(point, neutralDir);
          const drafter = new oc.BRepOffsetAPI_DraftAngle_2(body.wrapped);
          const progress = new oc.Message_ProgressRange_1();
          let drafted: Shape3D;
          try {
            for (const face of matches) drafter.Add(face.wrapped, direction, (feature.reversed ? -angle : angle) * Math.PI / 180, neutral, true);
            drafter.Build(progress);
            const result = cast(drafter.Shape());
            if (!isShape3D(result)) { result.delete(); throw new Error("Draft could not be applied to that face."); }
            drafted = own(result);
          } catch (error) {
            throw new Error(error instanceof Error && error.message.startsWith("Draft") ? error.message : "Draft could not be applied to that face. Reduce the angle or choose another neutral plane.", { cause: error });
          } finally { matches.forEach((face) => face.delete()); drafter.delete(); progress.delete(); neutral.delete(); neutralDir.delete(); point.delete(); direction.delete(); }
          const pieces = solidsOf(drafted), one = pieces.length === 1; pieces.forEach(release);
          if (!one || measureVolume(drafted) <= 1e-9) throw new Error("Draft must leave one valid solid.");
          bodies.set(id, drafted);
          currentBodyID = id;
          continue;
        }
        if (feature.type === "split") {
          // Split Body: the plane's two half-spaces as boxes larger than the part; each
          // piece is the part within one of them. The negative piece keeps the target's
          // identity, the positive one takes the recorded copy identity.
          const id = feature.bodyIds[0], body = bodies.get(id);
          if (!body) throw new Error("Split needs an available solid part.");
          const plane = mirrorPlaneOf(feature.plane);
          const bounds = body.boundingBox.bounds, size = 4 * Math.max(1, Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]) + Math.hypot(plane.origin.x, plane.origin.y, plane.origin.z));
          const n: V3 = [plane.zDir.x, plane.zDir.y, plane.zDir.z], o: V3 = [plane.origin.x, plane.origin.y, plane.origin.z];
          const half = (sign: 1 | -1): Shape3D => {
            // A box of the half-space: built along +Z from the origin, turned onto the plane normal, moved to the plane.
            let box: Shape3D = own(makeBaseBox(size * 2, size * 2, size).translate(0, 0, sign > 0 ? 0 : -size));
            const d = n[2], axis = cross([0, 0, 1], n), l = Math.hypot(...axis);
            if (d < 1 - 1e-9) box = own(box.rotate(Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI, [0, 0, 0], l > 1e-9 ? axis : [1, 0, 0]));
            return own(box.translate(o[0], o[1], o[2]));
          };
          const pieceOf = (sign: 1 | -1): Shape3D | undefined => { const piece = body.intersect(half(sign)); if (!isShape3D(piece) || measureVolume(piece) < 1e-9) return undefined; return own(piece); };
          const negative = feature.keep !== "positive" ? pieceOf(-1) : undefined, positive = feature.keep !== "negative" ? pieceOf(1) : undefined;
          if (feature.keep === "both" && (!negative || !positive)) throw new Error("The plane does not cut the part. Move the plane into the part.");
          if (feature.keep === "positive" ? !positive : feature.keep === "negative" ? !negative : false) throw new Error("Nothing remains on that side of the plane.");
          if (feature.keep === "both") {
            const copyId = feature.copyBodyIds![id];
            if (bodies.has(copyId)) throw new Error("Duplicate output body identity.");
            bodies.set(id, negative!); bodies.set(copyId, positive!);
            bodyOutputs[feature.id] = [copyId];
          } else bodies.set(id, (feature.keep === "positive" ? positive : negative)!);
          currentBodyID = id;
          continue;
        }
        if (feature.type === "delete-face") {
          // Delete Face with heal (OCCT defeaturing in the full build): the faces go and the
          // neighbouring surfaces extend to close the gap.
          const body = bodies.get(feature.targetBodyId);
          if (!body) throw new Error("Delete face needs an available target part.");
          const f = extendedKernel();
          if (!f) throw new UnsupportedFeature(feature.id, "deleting faces", true);
          const targets = feature.faces.map((ref) => { const face = faceByReference(body, ref, "Face to delete"); try { const c = deleteAfterVectorTuple(face.center); return [c[0], c[1], c[2]] as V3; } finally { face.delete(); } });
          const shapeX = toExtended(body), op = new f.BRepAlgoAPI_Defeaturing();
          try {
            op.SetShape(shapeX);
            const explorer = new f.TopExp_Explorer_2(shapeX, f.TopAbs_ShapeEnum.TopAbs_FACE as never, f.TopAbs_ShapeEnum.TopAbs_SHAPE as never);
            let matched = 0;
            for (; explorer.More(); explorer.Next()) {
              const current = explorer.Current(), props = new f.GProp_GProps_1();
              f.BRepGProp.SurfaceProperties_1(current, props, false, false);
              const c = props.CentreOfMass(); const center: V3 = [c.X(), c.Y(), c.Z()]; c.delete(); props.delete();
              if (targets.some((t) => Math.hypot(t[0] - center[0], t[1] - center[1], t[2] - center[2]) < 1e-4)) { op.AddFaceToRemove(current); matched++; }
            }
            explorer.delete();
            if (matched !== targets.length) throw new Error("A face to delete could not be found on the part. Reselect the faces.");
            op.SetRunParallel(false);
            op.Build(new f.Message_ProgressRange_1());
            if (!op.IsDone() || op.HasErrors()) throw new Error("Those faces cannot be removed and healed. Remove fewer faces at a time.");
            const healed = own(fromExtended(op.Shape()));
            if (!isShape3D(healed) || measureVolume(healed) < 1e-9) throw new Error("Deleting those faces leaves no solid.");
            bodies.set(feature.targetBodyId, healed);
          } finally { op.delete(); shapeX.delete(); }
          currentBodyID = feature.targetBodyId;
          continue;
        }
        if (feature.type === "offset-face") {
          // Offset / Move face (FreeCAD's Solid.offsetFaces rule): the face moves to its
          // new plane and the neighbouring surfaces extend to meet it. With planar
          // neighbours that is exactly the region between the old and new planes
          // inside the neighbours' half-spaces: material added where the new plane
          // lies outside the old one, removed where it lies inside.
          const t = feature.transform ? resolveTransform(feature.transform) : undefined;
          if (t && t.kind !== "translate" && t.kind !== "rotate") throw new Error("Choose an offset distance or a face translation or rotation.");
          let distance = feature.distanceMillimeters;
          if (feature.replaceWith) {
            // Replace Face: the signed distance from the first face to the target plane along
            // the face's own normal; the faces must be parallel to the plane.
            const target = mirrorPlaneOf(feature.replaceWith);
            const first = feature.faces[0], body0 = bodies.get(first.bodyId);
            if (!body0) throw new Error("Replace face needs an available solid part.");
            const face0 = faceByReference(body0, first, "Replace face");
            try {
              const c0 = deleteAfterVectorTuple(face0.center), n0 = unit([...deleteAfterVectorTuple(face0.normalAt([c0[0], c0[1], c0[2]]))] as V3);
              const pn: V3 = [target.zDir.x, target.zDir.y, target.zDir.z], po: V3 = [target.origin.x, target.origin.y, target.origin.z];
              if (Math.abs(Math.abs(dot(n0, pn)) - 1) > 1e-6) throw new Error("Replace face needs a plane parallel to the faces.");
              distance = dot(sub(po, [c0[0], c0[1], c0[2]]), n0);
              if (Math.abs(distance) < 1e-6) throw new Error("The faces already lie on that plane.");
            } finally { face0.delete(); }
          }
          if (!t && (distance === undefined || !Number.isFinite(distance) || Math.abs(distance) < 1e-6)) throw new Error("Offset distance must be finite and nonzero.");
          const rotateVector = (v: V3, axis: V3, degrees: number): V3 => {
            const u = unit(axis), th = degrees * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), w = cross(u, v), d = dot(u, v);
            return [v[0] * c + w[0] * s + u[0] * d * (1 - c), v[1] * c + w[1] * s + u[1] * d * (1 - c), v[2] * c + w[2] * s + u[2] * d * (1 - c)];
          };
          const volumeOf = (shape: unknown) => { try { return isShape3D(shape as Shape3D) ? measureVolume(shape as Shape3D) : 0; } catch { return 0; } };
          for (const ref of feature.faces) {
            const body = bodies.get(ref.bodyId);
            if (!body) throw new Error("Offset faces need an available solid part.");
            const face = faceByReference(body, ref, "Offset faces");
            if (feature.id === previewId && ref === feature.faces[0]) {
              // Push/Pull's handle: the first face's centre along its normal, signed (push or pull).
              const c = face.center, nv = face.normalAt(c);
              publish(feature, { parameter: "distance", kind: "linear", originMillimeters: [c.x, c.y, c.z], direction: unit([nv.x, nv.y, nv.z]), signed: true, label: "Push/Pull distance" });
              c.delete(); nv.delete();
            }
            try {
              const kind = face.geomType === "CYLINDRE" ? "CYLINDER" : face.geomType;
              const analytic = ["PLANE", "CYLINDER", "SPHERE", "CONE", "TORUS"].includes(kind);
              // A free-form face moves only by an offset, and only where its surface and the
              // offset surface cut the column in two (surfaces of extrusion and revolution are
              // unbounded along one direction; a B-spline patch ends at the face and is refused).
              if (!analytic && !extendedKernel()) throw new UnsupportedFeature(feature.id, "offsets of free-form faces", true);
              // A planar face is placed by its centre; a curved one by a point on its surface
              // (its centre of mass lies off the surface, where the normal is undefined).
              const center = kind === "PLANE" ? [...deleteAfterVectorTuple(face.center)] as V3 : [...deleteAfterVectorTuple(face.pointOnSurface(0.5, 0.5))] as V3;
              const normal = unit([...deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]))] as V3);
              let point: V3 = center, turned: V3 = normal, travel = Math.abs(distance ?? 0);
              if (!t) point = add(center, scale(normal, distance!));
              else if (t.kind === "translate") { point = add(center, t.translationMillimeters as V3); travel = norm(t.translationMillimeters as V3); }
              else { const o = t.axisOriginMillimeters as V3; point = add(o, rotateVector(sub(center, o), t.axisDirection as V3, t.angleDegrees)); turned = unit(rotateVector(normal, t.axisDirection as V3, t.angleDegrees)); travel = norm(sub(point, center)) + diagonalOfShape(body); }
              // The neighbours: every face sharing an edge with this one, all planar.
              // The neighbours: every face sharing an edge with this one, all planar. Each
              // bounds the moved region on the side this face lies on: its material side
              // across a convex edge, the other side across a concave one (a boss on a plate).
              const faceEdges = face.edges;
              const span = 2 * diagonalOfShape(body) + travel + 1, step = Math.max(1e-4, diagonalOfShape(body) * 1e-4);
              // Is a point on this face? (a small cube around it meets the face)
              const onFace = (p: V3) => { const cube = own(makeBaseBox(2 * step, 2 * step, 2 * step).translate(p[0], p[1], p[2] - step)); return commonArea(face, cube) > 0; };
              // The point of this face nearest to `p`: a probe stepped along the edge's
              // tangent lands back on the face, so a neighbour tangent to it (a fillet
              // against its plane) still sees the probe on the face's side.
              const nearestOnFace = (p: V3): V3 => {
                const oc = getOC(), point = new oc.gp_Pnt_3(p[0], p[1], p[2]), vertex = new oc.BRepBuilderAPI_MakeVertex(point), progress = new oc.Message_ProgressRange_1();
                const distance = new oc.BRepExtrema_DistShapeShape_1();
                try {
                  distance.LoadS1(vertex.Shape()); distance.LoadS2(face.wrapped); distance.Perform(progress);
                  if (!distance.IsDone() || distance.NbSolution() < 1) return p;
                  const nearest = distance.PointOnShape2(1), q: V3 = [nearest.X(), nearest.Y(), nearest.Z()]; nearest.delete(); return q;
                } finally { distance.delete(); progress.delete(); vertex.delete(); point.delete(); }
              };
              const sides: Shape3D[] = [];
              /** Each neighbour's untrimmed surface as a solid (a half-space, a cylinder, a tube …), to check it reaches the moved face. */
              const surfaces: Shape3D[] = [];
              const bounds = own(makeBaseBox(2 * span, 2 * span, 2 * span).translate(center[0], center[1], center[2] - span));
              /** Free-form neighbours (splines, extrusions, revolutions) trim the moved regions afterwards, with the full build. */
              const freeform: { face: Face; probe: V3 }[] = [];
              for (const other of body.faces) {
                if (other.isSame(face)) { other.delete(); continue; }
                const otherEdges = other.edges;
                const shared = otherEdges.find((edge) => faceEdges.some((mine) => mine.isSame(edge)));
                const middle = shared ? [...deleteAfterVectorTuple(shared.pointAt(0.5))] as V3 : undefined;
                const tangent = shared ? unit([...deleteAfterVectorTuple(shared.tangentAt(0.5))] as V3) : undefined;
                otherEdges.forEach((edge) => edge.delete());
                if (!middle || !tangent) { other.delete(); continue; }
                // This face's inward direction at the shared edge: across the edge, within the face.
                const atEdge = unit([...deleteAfterVectorTuple(face.normalAt([middle[0], middle[1], middle[2]]))] as V3);
                const across = unit(cross(atEdge, tangent));
                const inward = onFace(add(middle, scale(across, 2 * step))) ? across : neg(across);
                const probe = nearestOnFace(add(middle, scale(inward, 20 * step)));
                const otherKind = other.geomType === "CYLINDRE" ? "CYLINDER" : other.geomType;
                if (otherKind === "PLANE") {
                  const c = [...deleteAfterVectorTuple(other.center)] as V3;
                  const outward = unit([...deleteAfterVectorTuple(other.normalAt([c[0], c[1], c[2]]))] as V3);
                  const side = halfSpace(c, dot(sub(probe, c), outward) > 0 ? outward : neg(outward), span, own);
                  surfaces.push(side); sides.push(side);
                } else if (["CYLINDER", "SPHERE", "CONE", "TORUS"].includes(otherKind)) {
                  // A round neighbour extends as its surface's solid: the side holding this face is kept.
                  const q = quadricOf(other, middle), length = 2 * span, solid = quadricSolid(q, length, own), c = quadricCentre(q);
                  surfaces.push(solid);
                  sides.push(insideQuadric(q, probe) ? solid : own(fuzzyBoolean(own(makeBaseBox(2 * length, 2 * length, 2 * length).translate(c[0], c[1], c[2] - length)), solid, "cut", { glue: false, fuzzy: 1e-5 })));
                } else {
                  // Any other surface (splines, extrusions, revolutions): the full build splits
                  // the body's bounds by the untrimmed surface patch; the piece holding the
                  // probe is this neighbour's side. The patch only reaches as far as the
                  // surface's own domain, which the reach check below enforces.
                  if (!extendedKernel()) { other.delete(); throw new UnsupportedFeature(feature.id, `offsets of faces with ${otherKind.toLowerCase()} neighbours`, true); }
                  freeform.push({ face: other, probe });
                  continue;
                }
                other.delete();
              }
              faceEdges.forEach((edge) => edge.delete());
              if (!sides.length && !freeform.length) throw new Error("Offset faces must leave valid solid geometry. Reduce the distance or change the selection.");
              // The sides and surfaces can be tangent (a fillet's tube against its plane and
              // cylinder): fuzzy booleans, without glue, keep those contacts from failing.
              const region = (operation: "common" | "cut", x: Shape3D, y: Shape3D) => own(fuzzyBoolean(x, y, operation, { glue: false, fuzzy: 1e-5 }));
              let column: Shape3D | undefined = sides.length ? undefined : bounds;
              for (const side of sides) column = column ? region("common", column, side) : side;
              let insideOld: Shape3D, insideNew: Shape3D;
              if (kind === "PLANE") { insideOld = halfSpace(center, neg(normal), span, own); insideNew = halfSpace(point, neg(turned), span, own); }
              else if (!analytic) {
                const f = extendedKernel(), faceX = toExtended(face), handle = f.BRep_Tool.Surface_2(f.TopoDS.Face_1(faceX));
                // The probe sits in the material deeper than the offset: on the material side of both surfaces.
                // The probe sits in the material deeper than the offset, or than the move's travel.
                const inside = sub(center, scale(normal, (t ? travel : Math.abs(distance!)) + 20 * step));
                try {
                  insideOld = keepSideOfSurface(f, handle, column!, inside, own, true);
                  if (t) {
                    // A move: the same surface patch, translated or rotated (the full build's
                    // BRepBuilderAPI_Transform on the extended patch), cuts the column again.
                    const move = new f.gp_Trsf_1();
                    if (t.kind === "translate") { const v = t.translationMillimeters as V3, vec = new f.gp_Vec_4(v[0], v[1], v[2]); move.SetTranslation_1(vec); vec.delete(); }
                    else { const o = t.axisOriginMillimeters as V3, d = unit(t.axisDirection as V3), origin = new f.gp_Pnt_3(o[0], o[1], o[2]), direction = new f.gp_Dir_4(d[0], d[1], d[2]), axis = new f.gp_Ax1_2(origin, direction); move.SetRotation_1(axis, t.angleDegrees * Math.PI / 180); axis.delete(); direction.delete(); origin.delete(); }
                    const movedInside = t.kind === "translate" ? add(inside, t.translationMillimeters as V3) : add(t.axisOriginMillimeters as V3, rotateVector(sub(inside, t.axisOriginMillimeters as V3), t.axisDirection as V3, t.angleDegrees));
                    try { insideNew = keepSideOfSurface(f, handle, column!, movedInside, own, true, move); } finally { move.delete(); }
                  } else {
                  const candidates = [distance!, -distance!].map((d) => new f.Geom_OffsetSurface(handle, d, false));
                  // The offset surface's own normal may oppose the face's: take the candidate displaced along the outward normal.
                  const sample = (surface: FullOC) => { const adaptor = new f.GeomAdaptor_Surface_2(surface), u = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2, v = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2; const uu = Number.isFinite(u) ? u : 0, vv = Number.isFinite(v) ? v : 0; const pt = adaptor.Value(uu, vv), q: V3 = [pt.X(), pt.Y(), pt.Z()]; pt.delete(); adaptor.delete(); return q; };
                  const handles = candidates.map((c) => new f.Handle_Geom_Surface_2(c));
                  const base = sample(handle), shifts = handles.map((h) => dot(sub(sample(h), base), normal) * Math.sign(distance!));
                  const chosen = shifts[0] >= shifts[1] ? 0 : 1;
                  insideNew = keepSideOfSurface(f, handles[chosen], column!, inside, own, true);
                  handles.forEach((h) => h.delete());
                  }
                } finally { handle.delete(); faceX.delete(); }
              }
              else {
                // A curved face moves as its surface's solid: an offset changes the radius (towards
                // the material for a hole, away from it for a boss) or pulls a cone's apex, a
                // transform moves the axis, centre or apex.
                const q = quadricOf(face, center), length = 2 * span;
                // The material side: the solid itself for a boss, everything outside it for a hole.
                const convex = dot(normal, quadricRadial(q, center)) > 0;
                const primitive = (shape: Quadric): Shape3D => {
                  const solid = quadricSolid(shape, length, own), c = quadricCentre(shape);
                  return convex ? solid : own(fuzzyBoolean(own(makeBaseBox(2 * length, 2 * length, 2 * length).translate(c[0], c[1], c[2] - length)), solid, "cut", { glue: false, fuzzy: 1e-5 }));
                };
                insideOld = primitive(q);
                if (!t) insideNew = primitive(offsetQuadric(q, convex ? distance! : -distance!));
                else if (t.kind === "translate") insideNew = primitive(moveQuadric(q, (p) => add(p, t.translationMillimeters as V3), (dir) => dir));
                else { const o = t.axisOriginMillimeters as V3; insideNew = primitive(moveQuadric(q, (p) => add(o, rotateVector(sub(p, o), t.axisDirection as V3, t.angleDegrees)), (dir) => rotateVector(dir, t.axisDirection as V3, t.angleDegrees))); }
              }
              // Every neighbour's surface must cross the moved face's new surface, or nothing
              // bounds the moved region: a face beside a tangent fillet cannot move away from
              // it, a chamfered boss top cannot rise past the cone's apex (FreeCAD: null shape).
              for (const surface of surfaces) {
                const reach = region("common", surface, bounds);
                const within = volumeOf(region("common", reach, insideNew)), beyond = volumeOf(region("cut", reach, insideNew));
                if (within <= 1e-6 || beyond <= 1e-6) throw new Error("A neighbouring face cannot be extended to meet the moved face. Reduce the distance or include the neighbour in the selection.");
              }
              let added = region("cut", region("common", column!, insideNew), insideOld);
              let removed = region("cut", region("common", column!, insideOld), insideNew);
              // A free-form neighbour's untrimmed surface cuts each moved region; the piece the
              // probe (on this face, beside their shared edge) touches is the one this face bounds.
              // A finite patch cannot bound a region it does not cut through, so material added
              // beside a free-form neighbour must be separated by its patch (else refused), while
              // material removed need only stay within the body, which the body itself bounds.
              if (freeform.length) removed = region("common", removed, body);
              for (const { face: other, probe } of freeform) {
                try { added = keepSideOf(extendedKernel(), other, added, probe, own, true); removed = keepSideOf(extendedKernel(), other, removed, probe, own, false); }
                finally { other.delete(); }
              }
              const before = measureVolume(body), piecesBefore = solidsOf(body), count = piecesBefore.length; piecesBefore.forEach(release);
              let result: Shape3D = body;
              const apply = (operation: "fuse" | "cut", region: Shape3D) => { try { return own(operation === "cut" ? result.cut(region) : result.fuse(region)); } catch { return own(fuzzyBoolean(result, region, operation)); } };
              if (volumeOf(removed) > 1e-9) result = apply("cut", removed);
              if (volumeOf(added) > 1e-9) result = apply("fuse", added);
              result = own(tidy(result));
              const pieces = solidsOf(result), valid = pieces.length === count && volumeOf(result) > 1e-9; pieces.forEach(release);
              if (!valid) throw new Error("Offset faces must leave valid solid geometry. Reduce the distance or change the selection.");
              const delta = measureVolume(result) - before, tolerance = Math.max(1e-7, before * 1e-9);
              // A move keeps the volume (a hole slides); it must still change the shape.
              if (!t ? delta * Math.sign(distance!) <= tolerance : volumeOf(added) + volumeOf(removed) <= tolerance) throw new Error("Offset faces changes no material. Check the selection and distance.");
              bodies.set(ref.bodyId, result);
              currentBodyID = ref.bodyId;
            } finally { face.delete(); }
          }
          continue;
        }
        // Surface bodies changed in place or re-published: Stitch sews several sheets into
        // the first (a solid when they close), Unstitch publishes one body per face, Reverse
        // turns a sheet over. Sheets are shells in the same body map as solids.
        /** The edges a feature picked on a body: straight ones by their vertex anchors, any
         *  edge by midpoint and length. A changed edge refuses rather than taking the nearest. */
        const pickedEdgesOf = (body: Shape3D, bodyId: string, picks: import("../document/solid-edge-reference").EdgeFinishEdge[], what: string) => {
          const anchors = [...vertexAnchorsOf(body).values()];
          const edges = body.edges;
          // A picked face stands for every edge of that face.
          const expanded = picks.flatMap((pick) => {
            if (pick.kind !== "face-edges") return [pick];
            const face = faceByReference(body, pick, what), faceEdges = face.edges;
            const refs = faceEdges.map((edge) => { const m = edge.pointAt(0.5); const ref = { kind: "curved-edge" as const, sourceFeatureId: pick.sourceFeatureId, bodyId: pick.bodyId, label: pick.label, midpointMillimeters: [m.x, m.y, m.z] as V3, lengthMillimeters: edge.length }; m.delete(); return ref; });
            faceEdges.forEach((edge) => edge.delete()); face.delete();
            return refs;
          });
          picks = expanded;
          const midpoints = picks.map((pick): V3 => {
            if (pick.bodyId !== bodyId) throw new Error(`${pick.label} is on another body. Reselect edges on the chosen body.`);
            if (pick.kind === "solid-edge") {
              const vertex = (anchor: typeof pick.anchor.start): V3 => {
                const matches = anchors.filter((a) => a.signature === anchor.signature);
                const found = matches.length === 1 ? matches[0] : matches.find((a) => a.shapeFingerprint === anchor.shapeFingerprint && Math.hypot(...a.positionMillimeters.map((v, i) => v - anchor.positionMillimeters[i])) < 1e-6);
                if (!found) throw new Error(`${pick.label} changed or is missing. Reselect the edges for ${what}.`);
                return [...found.positionMillimeters] as V3;
              };
              return scale(add(vertex(pick.anchor.start), vertex(pick.anchor.end)), 0.5);
            }
            if (pick.kind === "face-edges") throw new Error(`${pick.label} could not be expanded into edges.`);
            return pick.midpointMillimeters as V3;
          });
          return midpoints.map((target, index) => {
            const pick = picks[index];
            const hit = edges.find((edge) => {
              const m = edge.pointAt(0.5), d = Math.hypot(m.x - target[0], m.y - target[1], m.z - target[2]); m.delete();
              return d < 1e-3 && (pick.kind !== "curved-edge" || Math.abs(edge.length - pick.lengthMillimeters) <= Math.max(1e-3, pick.lengthMillimeters * 1e-6));
            });
            if (!hit) throw new Error(`${pick.label} changed or is missing. Reselect the edges for ${what}.`);
            return own(hit);
          });
        };
        /** Ruled strips: each picked edge lofted (ruled) to its own copy moved by the reach —
         *  square to the surface at the edge, continuing the surface away from it, or a given direction. */
        const ruledStrips = (body: Shape3D, bodyId: string, picks: import("../document/solid-edge-reference").EdgeFinishEdge[], distance: number, mode: "normal" | "tangent" | "direction", direction: V3 | undefined, what: string): any[] => {
          const o = getOC() as any;
          return pickedEdgesOf(body, bodyId, picks, what).map((edge) => {
            const m = edge.pointAt(0.5), mid: V3 = [m.x, m.y, m.z]; m.delete();
            let reach: V3;
            if (mode === "direction") reach = scale(unit(direction!), distance);
            else {
              const face = new FaceFinder().containsPoint(mid).find(body)[0];
              if (!face) throw new Error("The picked edge is not on a face of the body.");
              const nv = face.normalAt(mid), n: V3 = unit([nv.x, nv.y, nv.z]); nv.delete();
              if (mode === "normal") reach = scale(n, distance);
              else {
                const tv = edge.tangentAt(0.5), t: V3 = unit([tv.x, tv.y, tv.z]); tv.delete();
                let side = unit(cross(n, t));
                const c = face.center, away: V3 = sub(mid, [c.x, c.y, c.z]); c.delete();
                if (dot(side, away) < 0) side = neg(side);
                reach = scale(side, distance);
              }
            }
            // replicad consumes the shape it translates, so the copy is made from a clone.
            if (feature.id === previewId && !previewHandles.some((h) => h.parameter === "distance")) publish(feature, { parameter: "distance", kind: "linear", originMillimeters: mid, direction: unit(reach), label: "Reach" });
            const first = own(assembleWire([edge])), second = own(first.clone().translate(reach[0], reach[1], reach[2]));
            const maker = new o.BRepOffsetAPI_ThruSections(false, true, 1e-6);
            maker.AddWire(first.wrapped); maker.AddWire(second.wrapped); maker.Build(new o.Message_ProgressRange_1());
            return maker.Shape();
          });
        };
        /** Picked edges joined end to end into one wire, whatever order they were picked in. */
        const chainWire = (edges: ReturnType<typeof pickedEdgesOf>, what: string): Wire => {
          const ends = edges.map((edge) => { const a = edge.startPoint, b = edge.endPoint; const pts: [V3, V3] = [[a.x, a.y, a.z], [b.x, b.y, b.z]]; a.delete(); b.delete(); return pts; });
          const near = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-3;
          const order = [0]; let tail = ends[0][1]; const left = new Set(edges.map((_, i) => i).slice(1));
          while (left.size) {
            const next = [...left].find((i) => near(ends[i][0], tail) || near(ends[i][1], tail));
            if (next === undefined) throw new Error(`${what}: the picked edges do not meet end to end.`);
            left.delete(next); order.push(next); tail = near(ends[next][0], tail) ? ends[next][1] : ends[next][0];
          }
          return own(assembleWire(order.map((i) => edges[i])));
        };
        /** The sheet metal rule of a body: the base feature that made it carries it. */
        const sheetRuleOf = (bodyId: string): { base: import("../document/sheet-metal").SheetBaseFeature; index: number } => {
          const index = document.features.findIndex((f) => f.type === "sheet-base" && !f.suppressed && bodyIDForFeature(document, f) === bodyId);
          if (index < 0) throw new Error("This body is not a sheet metal body. Start with a sheet metal base.");
          return { base: document.features[index] as import("../document/sheet-metal").SheetBaseFeature, index };
        };
        /** A bend from an edge of a plate: the cross-section in the plane square to the edge
         *  (u out of the plate, v along the big face's normal; the material fills v ∈ [-t, 0]),
         *  extruded along the edge, fused into the body. `flat` lays the bend out instead:
         *  a straight strip of leg + bend allowance. */
        const bendFromEdges = (body: Shape3D, bodyId: string, picks: import("../document/solid-edge-reference").EdgeFinishEdge[], rule: SheetMetalRule, options: { leg: number; angleDegrees: number; innerRadius: number; inward?: boolean; flat?: boolean; what: string }): Shape3D => {
          const t = rule.thicknessMillimeters, r = options.innerRadius, alpha = options.angleDegrees * Math.PI / 180;
          let result = body;
          for (const edge of pickedEdgesOf(body, bodyId, picks, options.what)) {
            const m = edge.pointAt(0.5), mid: V3 = [m.x, m.y, m.z]; m.delete();
            const s = edge.startPoint, a: V3 = [s.x, s.y, s.z]; s.delete();
            const en = edge.endPoint, b: V3 = [en.x, en.y, en.z]; en.delete();
            const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            const tdir = unit(sub(b, a));
            // The big face the edge belongs to: the largest planar face containing its midpoint.
            const faces = new FaceFinder().containsPoint(mid).find(body).filter((f) => f.geomType === "PLANE");
            if (!faces.length) throw new Error(`${options.what}: the picked edge is not on a flat face of the sheet.`);
            const face = faces.reduce((big, f) => (measureArea(f) > measureArea(big) ? f : big));
            const nv = face.normalAt(mid); let n: V3 = unit([nv.x, nv.y, nv.z]); nv.delete();
            let o = unit(cross(n, tdir));
            const c = face.center, away: V3 = sub(mid, [c.x, c.y, c.z]); c.delete();
            if (dot(o, away) < 0) o = neg(o);
            if (feature.id === previewId && !previewHandles.length) {
              publish(feature, { parameter: feature.type === "sheet-hem" ? "length" : "distance", kind: "linear", originMillimeters: mid, direction: o, label: feature.type === "sheet-hem" ? "Hem length" : "Flange length" });
              if (feature.type === "sheet-flange") publish(feature, { parameter: "angle", kind: "angular", originMillimeters: mid, direction: tdir, label: "Flange angle" });
            }
            // Folding "inward" means toward the picked face: mirror the section about the sheet's middle.
            const v = (y: number) => (options.inward ? -t - y : y);
            const pen = draw([0, v(0)]);
            if (options.flat) {
              const reach = options.leg + bendAllowanceMillimeters(options.angleDegrees, r, rule);
              pen.lineTo([reach, v(0)]); pen.lineTo([reach, v(-t)]); pen.lineTo([0, v(-t)]);
            } else {
              const C: [number, number] = [0, -(t + r)];
              const at = (rho: number, theta: number): [number, number] => [C[0] + rho * Math.sin(theta), v(C[1] + rho * Math.cos(theta))];
              const d: [number, number] = [Math.cos(alpha), -Math.sin(alpha)];
              const outerEnd = at(r + t, alpha), innerEnd = at(r, alpha), L = options.leg;
              // The leg follows the bend's end tangent; a mirrored section mirrors its v component too.
              const dv = options.inward ? -d[1] : d[1];
              const lo: [number, number] = [outerEnd[0] + L * d[0], outerEnd[1] + L * dv], li: [number, number] = [innerEnd[0] + L * d[0], innerEnd[1] + L * dv];
              pen.threePointsArcTo(outerEnd, at(r + t, alpha / 2));
              pen.lineTo(lo); pen.lineTo(li); pen.lineTo(innerEnd);
              pen.threePointsArcTo(at(r, 0), at(r, alpha / 2));
            }
            const section = own(pen.close());
            // Plane: x = o (out of the plate); replicad's y = normal × x, so normal = o × n makes
            // y the face normal. That normal is ± the edge direction: the strip starts at whichever
            // end lets the extrusion run along it.
            const zdir = unit(cross(o, n)), from = dot(zdir, tdir) > 0 ? a : b;
            const plane = own(new Plane([from[0], from[1], from[2]], [o[0], o[1], o[2]], [zdir[0], zdir[1], zdir[2]]));
            const piece = own(section.sketchOnPlane(plane)).extrude(length);
            if (!isShape3D(piece) || !(measureVolume(piece) > 1e-9)) throw new Error(`${options.what} could not be built on that edge.`);
            const fused = result.fuse(own(piece));
            if (!isShape3D(fused)) throw new Error(`${options.what} did not join the sheet.`);
            result = own(fused);
            face.delete();
          }
          return result;
        };
        if (feature.type === "sheet-flange" || feature.type === "sheet-hem") {
          const id = feature.bodyIds[0], body = bodies.get(id);
          if (!body) throw new Error("The sheet metal body is unavailable.");
          const { base } = sheetRuleOf(id);
          const bent = feature.type === "sheet-flange"
            ? bendFromEdges(body, id, feature.edges, base, { leg: feature.distanceMillimeters, angleDegrees: feature.angleDegrees, innerRadius: feature.bendRadiusMillimeters ?? base.bendRadiusMillimeters, inward: feature.inward, what: "Flange" })
            : bendFromEdges(body, id, feature.edges, base, { leg: feature.lengthMillimeters, angleDegrees: 180, innerRadius: feature.gapMillimeters ?? base.bendRadiusMillimeters, inward: feature.inward, what: "Hem" });
          bodies.set(id, bent); currentBodyID = id;
          continue;
        }
        if (feature.type === "sheet-fold") {
          // Fold along a sketch line: the plate is split into the fixed side, a strip one
          // bend allowance wide that becomes the bend, and the moving side, which is slid
          // back to the line and turned about the bend's axis. A cut-out crossing the strip
          // is not carried into the bend (the bend is a plain sector over the strip's span).
          const id = feature.bodyIds[0], body = bodies.get(id);
          if (!body) throw new Error("The sheet metal body is unavailable.");
          const { base } = sheetRuleOf(id);
          const t = base.thicknessMillimeters, r = feature.bendRadiusMillimeters ?? base.bendRadiusMillimeters, alpha = feature.angleDegrees * Math.PI / 180;
          const ba = bendAllowanceMillimeters(feature.angleDegrees, r, base);
          const [p, q] = sketchLine(feature.line, "Fold line is unavailable. Reselect a sketch line on the sheet.");
          const tdir = unit(sub(q, p));
          publish(feature, { parameter: "angle", kind: "angular", originMillimeters: scale(add(p, q), 0.5), direction: tdir, label: "Fold angle" });
          // The big face the line lies in: the largest planar face whose plane contains it.
          const faces = body.faces.filter((f) => f.geomType === "PLANE");
          const onFace = faces.filter((f) => { const c = f.center, nv = f.normalAt(c); const n: V3 = [nv.x, nv.y, nv.z]; const dPlane = Math.abs(dot(n, sub(p, [c.x, c.y, c.z]))); c.delete(); nv.delete(); return dPlane < 1e-4; });
          if (!onFace.length) throw new Error("The fold line must lie on a flat face of the sheet.");
          const face = onFace.reduce((big, f) => (measureArea(f) > measureArea(big) ? f : big));
          const nv = face.normalAt(face.center); let n: V3 = unit([nv.x, nv.y, nv.z]); nv.delete();
          // The line lies on the face at v = 0 with the material below it (v ∈ [-t, 0]); a line on
          // the bottom face flips the frame so the bend sector is drawn the same way.
          let o = unit(cross(n, tdir));
          if (feature.otherSide) o = neg(o);
          const bounds = body.boundingBox.bounds, span = 4 * Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]);
          const slab = (from: number, to: number): Shape3D => {
            // The region from ·o = from to ·o = to, as a box across the whole part.
            const d = own(draw([from, -span]).lineTo([to, -span]).lineTo([to, span]).lineTo([from, span]).close());
            const plane = own(new Plane([p[0], p[1], p[2]], [o[0], o[1], o[2]], [-tdir[0], -tdir[1], -tdir[2]]));
            const piece = own(d.sketchOnPlane(plane)).extrude(span * 2) as Shape3D;
            return own(piece.translate(tdir[0] * span, tdir[1] * span, tdir[2] * span));
          };
          const fixed = own(body.intersect(slab(-span, 0))) as Shape3D, strip = own(body.intersect(slab(0, ba))) as Shape3D, moving = own(body.intersect(slab(ba, span))) as Shape3D;
          if (!isShape3D(fixed) || !isShape3D(moving) || !(measureVolume(moving) > 1e-9) || !(measureVolume(fixed) > 1e-9)) throw new Error("The fold line must cross the sheet, leaving material on both sides.");
          // The bend: an annular sector over the strip's extent along the line.
          const sb = strip.boundingBox.bounds;
          const along = (pt: V3) => dot(sub(pt, p), tdir);
          const corners: V3[] = [];
          for (const x of [sb[0][0], sb[1][0]]) for (const y of [sb[0][1], sb[1][1]]) for (const z of [sb[0][2], sb[1][2]]) corners.push([x, y, z]);
          const s0 = Math.min(...corners.map(along)), s1 = Math.max(...corners.map(along));
          const v = (y: number) => (feature.inward ? -t - y : y);
          const C: [number, number] = [0, -(t + r)];
          const at = (rho: number, theta: number): [number, number] => [C[0] + rho * Math.sin(theta), v(C[1] + rho * Math.cos(theta))];
          const pen = draw([0, v(0)]);
          pen.threePointsArcTo(at(r + t, alpha), at(r + t, alpha / 2)); pen.lineTo(at(r, alpha)); pen.threePointsArcTo(at(r, 0), at(r, alpha / 2));
          const section = own(pen.close());
          // As for a flange: normal = o × n so the section's y is the face normal; it runs ± along the line.
          const zdir = unit(cross(o, n));
          const start = add(p, scale(tdir, dot(zdir, tdir) > 0 ? s0 : s1));
          const sectionPlane = own(new Plane([start[0], start[1], start[2]], [o[0], o[1], o[2]], [zdir[0], zdir[1], zdir[2]]));
          const bend = own(own(section.sketchOnPlane(sectionPlane)).extrude(s1 - s0)) as Shape3D;
          // The moving side slides back by the strip's width, then turns about the bend axis
          // (through the arc's centre, along the line) by the fold angle, the way the arc turns.
          const axisOrigin = add(p, scale(n, feature.inward ? r : -(t + r)));
          const sign = feature.inward ? 1 : -1;
          const turned = own(own(moving.translate(-o[0] * ba, -o[1] * ba, -o[2] * ba)).rotate(sign * feature.angleDegrees, axisOrigin, tdir));
          const result = own(own(fixed.fuse(bend)).fuse(turned));
          if (!isShape3D(result)) throw new Error("Fold did not join the sheet.");
          face.delete();
          bodies.set(id, result); currentBodyID = id;
          continue;
        }
        /** Perforate: hole cylinders through a planar face of the sheet, with their axis points.
         *  Candidates on a square or 60° grid in the face's plane are kept when inside the outer
         *  boundary, outside every cut-out, and at least margin + radius from every boundary. */
        const perforations = (body: Shape3D, f: import("../document/sheet-metal").SheetPerforateFeature, thickness: number): { tools: Shape3D[]; points: V3[] } => {
          const face = faceByReference(body, f.face, "Perforate face");
          const c = [...deleteAfterVectorTuple(face.center)] as V3, n = unit([...deleteAfterVectorTuple(face.normalAt([c[0], c[1], c[2]]))] as V3);
          const x = unit(canonicalPlaneXDirection(n) as V3), y = unit(cross(n, x));
          const to2 = (p: V3): [number, number] => [dot(sub(p, c), x), dot(sub(p, c), y)];
          const polygon = (w: Wire): [number, number][] => {
            const pts: [number, number][] = [];
            for (const edge of w.edges) { own(edge); for (let i = 0; i < 24; i++) { const v = edge.pointAt(i / 24); pts.push(to2([v.x, v.y, v.z])); v.delete(); } }
            return pts;
          };
          // replicad's outerWire() and innerWires() consume their face.
          const outer = polygon(own(face.clone().outerWire())), holes = face.clone().innerWires().map((w) => polygon(own(w)));
          const inside = (poly: [number, number][], [px, py]: [number, number]) => { let hit = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit; } return hit; };
          const distance = (poly: [number, number][], [px, py]: [number, number]) => { let best = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[j], [bx, by] = poly[i], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy)); } return best; };
          const r = f.diameterMillimeters / 2, clear = (f.marginMillimeters ?? f.diameterMillimeters) + r, p = f.pitchMillimeters;
          const xs = outer.map((q) => q[0]), ys = outer.map((q) => q[1]);
          const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
          const rowStep = f.pattern === "square" ? p : p * Math.sqrt(3) / 2;
          // Centre the grid on the face's bounding box so the margins come out even.
          const cols = Math.floor((x1 - x0 - 2 * clear) / p), rows = Math.floor((y1 - y0 - 2 * clear) / rowStep);
          const startX = (x0 + x1) / 2 - (cols * p) / 2, startY = (y0 + y1) / 2 - (rows * rowStep) / 2;
          const points: V3[] = [];
          for (let j = 0; j <= rows; j++) for (let i = -1; i <= cols + 1; i++) {
            const q: [number, number] = [startX + i * p + (f.pattern !== "square" && j % 2 ? p / 2 : 0), startY + j * rowStep];
            if (!inside(outer, q) || holes.some((h) => inside(h, q)) || distance(outer, q) < clear - 1e-9 || holes.some((h) => distance(h, q) < clear - 1e-9)) continue;
            points.push(add(add(c, scale(x, q[0])), scale(y, q[1])));
            if (points.length > 5000) throw new Error("Perforate would make more than 5000 holes. Increase the pitch.");
          }
          if (!points.length) throw new Error("No hole fits inside the margin. Reduce the margin, the diameter or the pitch.");
          const depth = thickness + 0.02;
          return { points, tools: points.map((q) => own(makeCylinder(r, depth, add(q, scale(n, 0.01)), [-n[0], -n[1], -n[2]] as V3))) };
        };
        if (feature.type === "sheet-perforate") {
          const id = feature.bodyIds[0], body = bodies.get(id);
          if (!body) throw new Error("The sheet metal body is unavailable.");
          const { base } = sheetRuleOf(id);
          const { tools: holes } = perforations(body, feature, base.thicknessMillimeters);
          const before = measureVolume(body);
          const cut = body.cut(own(makeCompound(holes) as Shape3D));
          if (!isShape3D(cut) || measureVolume(cut) >= before - 1e-9) throw new Error("Perforate removed nothing. Check that the face belongs to the sheet.");
          bodies.set(id, own(cut)); currentBodyID = id;
          continue;
        }
        if (feature.type === "sheet-unfold") {
          // Unfold: the plate as the base made it, plus each bend laid flat (leg + bend
          // allowance) from the edge it was bent from. Bends on bends are not laid out yet.
          const id = feature.bodyIds[0];
          const { base, index: baseIndex } = sheetRuleOf(id);
          const plate = bodyAt(base.id, id);
          if (!plate) throw new Error("The sheet metal base is unavailable.");
          let flat: Shape3D = own(plate.clone());
          for (let k = baseIndex + 1; k < index; k++) {
            const f = document.features[k];
            // Perforations on the base plate are cut again where the plate lies flat; holes on
            // flanges are not laid out (the plate is the only face that keeps its place).
            if (f.type === "sheet-perforate" && !f.suppressed && f.bodyIds[0] === id) {
              const before = bodyAt(document.features[k - 1].id, id);
              if (!before) continue;
              const { tools, points } = perforations(before, f, base.thicknessMillimeters);
              const onPlate = tools.filter((_, i) => { const v = own(makeVertex(points[i])); return measureDistanceBetween(plate, v) < 1e-6; });
              if (onPlate.length) { const cut = flat.cut(own(makeCompound(onPlate) as Shape3D)); if (isShape3D(cut)) flat = own(cut); }
              continue;
            }
            if (f.suppressed || (f.type !== "sheet-flange" && f.type !== "sheet-hem") || f.bodyIds[0] !== id) continue;
            flat = f.type === "sheet-flange"
              ? bendFromEdges(flat, id, f.edges, base, { leg: f.distanceMillimeters, angleDegrees: f.angleDegrees, innerRadius: f.bendRadiusMillimeters ?? base.bendRadiusMillimeters, inward: f.inward, flat: true, what: "Unfold" })
              : bendFromEdges(flat, id, f.edges, base, { leg: f.lengthMillimeters, angleDegrees: 180, innerRadius: f.gapMillimeters ?? base.bendRadiusMillimeters, inward: f.inward, flat: true, what: "Unfold" });
          }
          bodies.set(id, flat); currentBodyID = id;
          continue;
        }
        if (feature.type === "sheet-refold") {
          const id = feature.bodyIds[0];
          const unfoldIndex = document.features.slice(0, index).map((f, i) => ({ f, i })).reverse().find(({ f }) => f.type === "sheet-unfold" && !f.suppressed && f.bodyIds[0] === id)?.i;
          if (unfoldIndex === undefined || unfoldIndex === 0) throw new Error("Refold needs an earlier Unfold of this body.");
          const folded = cached[unfoldIndex - 1]?.bodies.get(id);
          if (!folded) throw new Error("The folded sheet is unavailable.");
          bodies.set(id, own(folded.clone())); currentBodyID = id;
          continue;
        }
        if (feature.type === "surface-untrim") {
          // Untrim: the face rebuilt from its outer boundary, so its holes close; the body's
          // other faces are sewn back around it.
          const id = feature.bodyIds[0], body = bodies.get(id);
          if (!body) throw new Error("Untrim needs an available body.");
          const o = getOC() as any;
          // A one-face sheet (an unstitched face) is its own face whichever way it points.
          const faces = body.faces;
          const picked = faces.length === 1 ? faces[0] : faceByReference(body, feature.face, "Face to untrim");
          const pc = picked.center, centre: V3 = [pc.x, pc.y, pc.z]; pc.delete();
          const outer = cast(o.BRepTools.OuterWire(picked.wrapped)) as Wire;
          let rebuilt: Face;
          try { rebuilt = own(makeFace(outer)); }
          catch { const surface = o.BRep_Tool.Surface_2(picked.wrapped); rebuilt = own(cast(new o.BRepBuilderAPI_MakeFace_21(surface, outer.wrapped, true).Face()) as Face); }
          const sewing = new o.BRepBuilderAPI_Sewing(1e-3, true, true, true, false);
          for (const face of body.faces) { const c = face.center; const keep = Math.hypot(c.x - centre[0], c.y - centre[1], c.z - centre[2]) > 1e-6; c.delete(); if (keep) sewing.Add(face.wrapped); }
          sewing.Add(rebuilt.wrapped);
          sewing.Perform(new o.Message_ProgressRange_1());
          let result = cast(sewing.SewedShape()) as any;
          if (!isShape3D(result)) { const builder = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell(); builder.MakeShell(shell); builder.Add(shell, result.wrapped); result = cast(shell); }
          if ((result.wrapped as any).ShapeType().value === o.TopAbs_ShapeEnum.TopAbs_SHELL.value && o.BRep_Tool.IsClosed_1(result.wrapped)) {
            const solid = cast(new o.BRepBuilderAPI_MakeSolid_3(result.wrapped).Solid()) as Shape3D;
            result = measureVolume(solid) < 0 ? cast(solid.wrapped.Reversed()) : solid;
          }
          bodies.set(id, own(result as Shape3D)); currentBodyID = id;
          continue;
        }
        if (feature.type === "surface-extend") {
          // Extend: tangent strips past the picked edges, sewn onto the sheet in place.
          const id = feature.bodyIds[0], body = bodies.get(id);
          if (!body) throw new Error("Extend needs an available surface body.");
          const o = getOC() as any;
          const sewing = new o.BRepBuilderAPI_Sewing(1e-3, true, true, true, false);
          sewing.Add(body.wrapped);
          for (const strip of ruledStrips(body, id, feature.edges, feature.distanceMillimeters, "tangent", undefined, "Extend")) sewing.Add(strip);
          sewing.Perform(new o.Message_ProgressRange_1());
          const sewn = cast(sewing.SewedShape());
          if (!isShape3D(sewn)) throw new Error("Extend could not sew the strip onto the surface.");
          bodies.set(id, own(sewn)); currentBodyID = id;
          continue;
        }
        if (feature.type === "surface-stitch" || feature.type === "surface-unstitch" || feature.type === "surface-reverse-normal") {
          const o = getOC() as any;
          const sheetOf = (raw: any): Shape3D => {
            const shape = cast(raw) as any;
            if (isShape3D(shape)) return own(shape);
            // A lone face becomes a one-face shell so every body is a 3D shape.
            const builder = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell();
            builder.MakeShell(shell); builder.Add(shell, raw);
            return own(cast(shell) as Shape3D);
          };
          const surfaceBody = (id: string, what: string): Shape3D => {
            const body = bodies.get(id);
            if (!body) throw new Error(`${what} needs an available surface body.`);
            return body;
          };
          if (feature.type === "surface-stitch") {
            const sewing = new o.BRepBuilderAPI_Sewing(feature.toleranceMillimeters ?? 1e-3, true, true, true, false);
            for (const id of feature.bodyIds) sewing.Add(surfaceBody(id, "Stitch").wrapped);
            sewing.Perform(new o.Message_ProgressRange_1());
            let result = sheetOf(sewing.SewedShape());
            // A closed shell is a solid: give it volume and the right way out.
            if ((result.wrapped as any).ShapeType().value === o.TopAbs_ShapeEnum.TopAbs_SHELL.value && o.BRep_Tool.IsClosed_1(result.wrapped)) {
              const solid = cast(new o.BRepBuilderAPI_MakeSolid_3(result.wrapped).Solid()) as Shape3D;
              result = own(measureVolume(solid) < 0 ? (cast(solid.wrapped.Reversed()) as Shape3D) : solid);
            }
            const [first, ...rest] = feature.bodyIds;
            for (const id of rest) bodies.delete(id);
            bodies.set(first, result);
            currentBodyID = first;
          } else if (feature.type === "surface-unstitch") {
            const body = surfaceBody(feature.bodyIds[0], "Unstitch");
            const prefix = bodyIDForFeature(document, feature);
            const ids = body.faces.map((face, index) => { const id = `${prefix}:solid-${index + 1}`; if (bodies.has(id)) throw new Error("Duplicate output body identity."); bodies.set(id, sheetOf(face.wrapped)); return id; });
            if (!ids.length) throw new Error("Unstitch found no faces.");
            bodies.delete(feature.bodyIds[0]);
            bodyOutputs[feature.id] = ids;
            currentBodyID = ids[ids.length - 1];
          } else {
            const body = surfaceBody(feature.bodyIds[0], "Reverse normal");
            bodies.set(feature.bodyIds[0], own(cast(body.wrapped.Reversed()) as Shape3D));
            currentBodyID = feature.bodyIds[0];
          }
          continue;
        }
        let tool: Shape3D;
        if (feature.type === "mirror") {
          const source = tools.get(feature.sourceFeatureId);
          if (!source) throw new Error("Mirror source is unavailable.");
          tool = own(source.clone().mirror(mirrorPlaneOf(feature.mirrorPlane ?? { kind: "principal", plane: feature.plane, offsetMillimeters: feature.offsetMillimeters })));
        } else if (feature.type === "loft") {
          // Loft (PartDesign Loft): ordered closed sections, smooth or ruled.
          if (feature.sections.length + [feature.startPoint, feature.endPoint].filter(Boolean).length < 2) throw new Error("Loft requires at least two ordered sections.");
          const wires = feature.sections.map((section) => sketchWire(section.profileFeatureId, section.profileContourId, "Loft section", false, section.profileRegion ? section : undefined));
          const apex = (a: import("../document/loft").LoftApex | undefined): V3 | undefined => !a ? undefined : a.kind === "point" ? [...a.positionMillimeters] as V3 : stopPoint(a);
          const lofted = loft(wires, { ruled: Boolean(feature.ruled), startPoint: apex(feature.startPoint), endPoint: apex(feature.endPoint) });
          if (!isShape3D(lofted) || measureVolume(lofted) <= 1e-9) throw new Error("Every loft section must be an available closed sketch region.");
          tool = own(lofted);
        } else if (feature.type === "sweep") {
          // Sweep (PartDesign Pipe, standard mode, transformed transitions): a
          // closed profile region swept along a curve of another sketch.
          const profileWire = sketchWire(feature.profileFeatureId, feature.profileContourId, "Sweep profile", false, feature.profileRegion ? feature : undefined);
          const pathProfile = pathSource(feature.pathFeatureId);
          if (!pathProfile) throw new Error("Sweep requires a profile and a path.");
          const pathId = feature.pathContourId ?? (pathProfile.contours.length === 1 ? pathProfile.contours[0].id : undefined);
          if (pathId === undefined && pathProfile.contours.length !== 1) throw new Error("Sweep path sketch has several curves — choose which one to use.");
          const spine = sketchWire(feature.pathFeatureId, pathId, "Sweep path", true);
          let swept: unknown;
          const orientation = feature.orientation ?? "perpendicular";
          const custom = orientation !== "perpendicular" || feature.endScale !== undefined || feature.rail !== undefined;
          try {
            if (!custom) swept = genericSweep(profileWire, spine, { frenet: false, transitionMode: "transformed" });
            else {
              // SolidCraft's sweep options on OCCT's pipe shell: a fixed trihedron keeps the
              // profile as drawn, a binormal keeps one direction up, a rail is the auxiliary
              // spine, and the end scale is a linear law along the path.
              const oc = getOC();
              const builder = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped), progress = new oc.Message_ProgressRange_1(), owned: { delete(): void }[] = [builder, progress];
              try {
                if (orientation === "parallel") { const ax = new oc.gp_Ax2_1(); owned.push(ax); builder.SetMode_2(ax); }
                else if (typeof orientation === "object") { const u = unit(orientation.direction), dir = new oc.gp_Dir_4(u[0], u[1], u[2]); owned.push(dir); builder.SetMode_3(dir); }
                else builder.SetMode_1(false);
                if (feature.rail) {
                  const railProfile = pathSource(feature.rail.pathFeatureId);
                  if (!railProfile) throw new Error("Sweep rail sketch is unavailable.");
                  const railId = feature.rail.pathContourId ?? (railProfile.contours.length === 1 ? railProfile.contours[0].id : undefined);
                  if (railId === undefined) throw new Error("Sweep rail sketch has several curves — choose which one to use.");
                  const rail = sketchWire(feature.rail.pathFeatureId, railId, "Sweep rail", true);
                  builder.SetMode_5(rail.wrapped, true, oc.BRepFill_TypeOfContact.BRepFill_NoContact as never);
                }
                builder.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_Transformed as never);
                if (feature.endScale !== undefined && Math.abs(feature.endScale - 1) > 1e-9) {
                  const law = new oc.Law_Linear(); owned.push(law); law.Set(0, 1, 1, feature.endScale);
                  const handle = new oc.Handle_Law_Function_2(law); owned.push(handle);
                  builder.SetLaw_1(profileWire.wrapped, handle, false, false);
                } else builder.Add_1(profileWire.wrapped, false, false);
                builder.Build(progress);
                if (!builder.IsDone()) throw new Error("Sweep could not be built with those options.");
                builder.MakeSolid();
                swept = cast(builder.Shape());
              } finally { owned.reverse().forEach((o) => o.delete()); }
            }
          }
          catch (error) { throw new Error(error instanceof Error && error.message.startsWith("Sweep") ? error.message : "Sweep could not be built along that path. Check that the profile sits on the path and the path does not self-intersect.", { cause: error }); }
          if (!isShape3D(swept as Shape3D) || measureVolume(swept as Shape3D) <= 1e-9) throw new Error("Sweep did not produce a solid.");
          tool = own((swept as Shape3D).simplify());
        } else if (feature.type === "boundary-fill") {
          // Each picked point: inside the tools that contain it (distance zero), outside the rest.
          const tools = feature.toolBodyIds.map((id) => { const b = bodies.get(id); if (!b) throw new Error("A boundary fill tool body is unavailable."); return [id, b] as const; });
          const cells: Shape3D[] = [];
          for (const p of feature.cellPointsMillimeters) {
            const v = own(makeVertex(p as V3));
            const inside = tools.filter(([, b]) => measureDistanceBetween(b, v) < 1e-7), outside = tools.filter((t) => !inside.includes(t));
            if (!inside.length) throw new Error(`The point ${p.map((x) => Math.round(x * 1000) / 1000).join(", ")} is outside every tool: a cell must lie inside at least one.`);
            let cell: Shape3D = own(inside[0][1].clone());
            for (const [, b] of inside.slice(1)) { const r = cell.intersect(b); if (!isShape3D(r)) throw new Error("A cell is empty."); cell = own(r); }
            for (const [, b] of outside) { const r = cell.cut(b); if (!isShape3D(r)) throw new Error("A cell is empty."); cell = own(r); }
            if (measureVolume(cell) <= 1e-9) throw new Error("A picked cell has no volume.");
            cells.push(cell);
          }
          let filled = cells[0];
          for (const c of cells.slice(1)) { const r = filled.fuse(c); if (!isShape3D(r)) throw new Error("The cells could not be joined."); filled = own(r); }
          tool = filled;
          if (feature.removeTools) for (const [id] of tools) bodies.delete(id);
        } else if (feature.type === "coil") {
          // Coil: a round wire swept along a helix (Frenet frame keeps the section square to it).
          const center: V3 = feature.centerMillimeters ? [...feature.centerMillimeters] as V3 : [0, 0, 0];
          const dir: V3 = feature.axis === "X" ? [1, 0, 0] : feature.axis === "Y" ? [0, 1, 0] : [0, 0, 1];
          publish(feature, { parameter: "pitch", kind: "linear", originMillimeters: [0, 1, 2].map((i) => center[i] + dir[i] * feature.pitchMillimeters) as V3, direction: dir, label: "Coil pitch" });
          publish(feature, { parameter: "radius", kind: "linear", originMillimeters: [0, 1, 2].map((i) => center[i] + perpendicular(dir)[i] * feature.radiusMillimeters) as V3, direction: perpendicular(dir), label: "Coil radius" });
          const helix = own(makeHelix(feature.pitchMillimeters, feature.pitchMillimeters * feature.turns, feature.radiusMillimeters, center, dir, Boolean(feature.leftHand)));
          const first = helix.edges[0], start = deleteAfterVectorTuple(first.startPoint), tangent = unit([...deleteAfterVectorTuple(first.tangentAt(0))] as V3);
          helix.edges.forEach((edge) => edge.delete());
          const circle = own(assembleWire([own(makeCircle(feature.wireDiameterMillimeters / 2, [start[0], start[1], start[2]], tangent))]));
          const swept = genericSweep(circle, helix, { frenet: true, transitionMode: "transformed" });
          if (!isShape3D(swept) || measureVolume(swept) <= 1e-9) throw new Error("Coil could not be built. Check the pitch and wire diameter.");
          tool = own(swept);
        } else if (feature.type === "pipe") {
          // Pipe: a circle square to the path at its start, swept along it; a wall
          // thickness subtracts the same sweep of the inner radius.
          const pathProfile = pathSource(feature.pathFeatureId);
          if (!pathProfile) throw new Error("Pipe needs a path curve in an earlier sketch.");
          const pathId = feature.pathContourId ?? (pathProfile.contours.length === 1 ? pathProfile.contours[0].id : undefined);
          if (pathId === undefined) throw new Error("Pipe path sketch has several curves — choose which one to use.");
          const spine = sketchWire(feature.pathFeatureId, pathId, "Pipe path", true);
          const first = spine.edges[0], start = deleteAfterVectorTuple(first.startPoint), tangent = unit([...deleteAfterVectorTuple(first.tangentAt(0))] as V3);
          publish(feature, { parameter: "diameter", kind: "linear", originMillimeters: [0, 1, 2].map((i) => start[i] + perpendicular(tangent)[i] * feature.diameterMillimeters / 2) as V3, direction: perpendicular(tangent), scale: 2, label: "Pipe diameter" });
          const sweepCircle = (radius: number): Shape3D => {
            const circle = own(assembleWire([own(makeCircle(radius, [start[0], start[1], start[2]], tangent))]));
            const swept = genericSweep(circle, spine, { frenet: false, transitionMode: "transformed" });
            if (!isShape3D(swept) || measureVolume(swept) <= 1e-9) throw new Error("Pipe could not be built along that path.");
            return own(swept);
          };
          let pipe = sweepCircle(feature.diameterMillimeters / 2);
          if (feature.wallMillimeters) { const inner = sweepCircle(feature.diameterMillimeters / 2 - feature.wallMillimeters); const hollow = pipe.cut(inner); if (!isShape3D(hollow)) throw new Error("Pipe wall leaves no solid."); pipe = own(hollow); }
          spine.edges.forEach((edge) => edge.delete());
          tool = pipe;
        } else if (feature.type === "shape-binder") {
          // Shape binder: the source part (or its picked faces, as a shell) copied as a new part on every replay.
          const source = bodies.get(feature.sourceBodyId);
          if (!source) throw new Error("Shape binder needs an available source part.");
          if (feature.faces?.length) {
            const o = getOC() as any, builder = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell(); builder.MakeShell(shell);
            for (const ref of feature.faces) builder.Add(shell, faceByReference(source, ref, "Shape binder face").wrapped);
            tool = own(cast(shell) as Shape3D);
          } else tool = own(source.clone());
        } else if (feature.type === "bounding-solid") {
          // The axis-aligned box around the chosen parts, grown by the margin.
          const chosen = feature.bodyIds ?? [...bodies.keys()];
          const shapes = chosen.map((id) => bodies.get(id)).filter((b): b is Shape3D => Boolean(b));
          if (!shapes.length) throw new Error("Bounding solid needs at least one part.");
          const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
          for (const shape of shapes) { const b = shape.boundingBox.bounds; for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b[0][i]); max[i] = Math.max(max[i], b[1][i]); } }
          const m = feature.marginMillimeters;
          publish(feature, { parameter: "margin", kind: "linear", originMillimeters: [max[0] + m, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], direction: [1, 0, 0], label: "Margin" });
          tool = own(makeBaseBox(max[0] - min[0] + 2 * m, max[1] - min[1] + 2 * m, max[2] - min[2] + 2 * m).translate(min[0] - m, min[1] - m, min[2] - m));
        } else if (feature.type === "import-step" || feature.type === "import-cad") {
          // Saved sources become bodies as FreeCAD's base features did: STEP as is,
          // meshes (STL, OBJ, PLY, OFF) as faceted solids or as mesh references.
          const format = feature.type === "import-step" ? "step" : feature.format;
          const bytes = Uint8Array.from(atob(feature.dataBase64), (c) => c.charCodeAt(0));
          if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new Error("CAD source must be nonempty and at most 3 MiB.");
          const sewn = (shape: Shape3D) => {
            const solids = solidsOf(shape);
            const inSolids = solids.reduce((count, solid) => { const faces = solid.faces; count += faces.length; faces.forEach((f) => f.delete()); return count; }, 0);
            solids.forEach(release);
            const faces = shape.faces; const total = faces.length; faces.forEach((f) => f.delete());
            if (inSolids !== total) throw new Error("Import contains unsewn surfaces. Repair them before solid import.");
            return shape;
          };
          if (format === "step") {
            if (feature.type === "import-cad" && (feature.meshMode !== undefined || feature.meshUnits !== undefined)) throw new Error("Exact CAD imports use their embedded source units.");
            tool = sewn(own(importSolidShape(bytes, "step")));
          } else if (feature.type === "import-cad" && ["stl", "obj", "ply", "off"].includes(format)) {
            const scale = meshUnitScale[feature.meshUnits ?? ""], mode = feature.meshMode;
            if (!scale || (mode !== "reference" && mode !== "solid")) throw new Error("Choose mesh handling and explicit source units.");
            const mesh = parseMesh(bytes, format as MeshFormat);
            for (const v of mesh.vertices) if (Math.abs(v * scale) > 1e9) throw new Error("Mesh coordinates must be finite and within 1,000 km.");
            if (mode === "reference") {
              meshParts.set(feature.bodyId, { vertices: scale === 1 ? mesh.vertices : mesh.vertices.map((v) => v * scale), normals: flatNormals(mesh), triangles: mesh.triangles });
              currentBodyID = feature.bodyId;
              continue;
            }
            if (mesh.triangles.length / 3 > 10_000) throw new Error("Solid conversion supports at most 10,000 triangles. Import as a mesh reference or simplify the source mesh.");
            if (!meshIsClosed(mesh)) throw new Error("Solid conversion needs a closed mesh. Import as a mesh reference or repair the source mesh.");
            tool = sewn(own(importSolidShape(binarySTL(mesh, scale), "stl")));
          } else if (format === "iges") {
            if (feature.type === "import-cad" && (feature.meshMode !== undefined || feature.meshUnits !== undefined)) throw new Error("Exact CAD imports use their embedded source units.");
            const f = extendedKernel();
            if (!f) throw new UnsupportedFeature(feature.id, "IGES imports");
            const name = `/import-${Math.random().toString(36).slice(2)}.igs`;
            f.FS.writeFile(name, bytes);
            const reader = new f.IGESControl_Reader_1(), progress = new f.Message_ProgressRange_1();
            try {
              if (reader.ReadFile(name) !== f.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error("IGES could not be read.");
              reader.TransferRoots(progress);
              const shape = extendedSolids(reader.OneShape());
              tool = sewn(own(fromExtended(shape)));
            } finally { progress.delete(); reader.delete(); f.FS.unlink(name); }
          } else throw new UnsupportedFeature(feature.id, `${String(format).toUpperCase()} imports`);
        } else if (feature.type === "sheet-base") {
          // The plate: the sketch region extruded by the rule's thickness along the sketch normal.
          const frame = sketchFrameOf(feature.profileFeatureId);
          publish(feature, { parameter: "thickness", kind: "linear", originMillimeters: sketchCentroid(feature.profileFeatureId), direction: scale(unit(frame.normal as V3), feature.reversed ? -1 : 1), label: "Sheet thickness" });
          const face = own(makeFace(sketchWire(feature.profileFeatureId, feature.profileContourId, "Sheet metal base", false)));
          const along = scale(unit(frame.normal as V3), feature.thicknessMillimeters * (feature.reversed ? -1 : 1));
          const sweep = new Vector(along);
          try { tool = own(basicFaceExtrusion(face, sweep)); } finally { sweep.delete(); }
          if (!(measureVolume(tool) > 1e-9)) throw new Error("Sheet metal base needs a closed sketch region.");
        } else if (feature.type === "surface-boundary") {
          const body = bodies.get(feature.bodyIds[0]);
          if (!body) throw new Error("Boundary surface needs an available body.");
          const o = getOC() as any;
          const loop = chainWire(pickedEdgesOf(body, feature.bodyIds[0], feature.edges, "Boundary surface"), "Boundary surface");
          if (!o.BRep_Tool.IsClosed_1(loop.wrapped)) throw new Error("Boundary surface needs edges that close a loop.");
          const face = own(makeNonPlanarFace(loop));
          const builder = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell(); builder.MakeShell(shell); builder.Add(shell, face.wrapped);
          const sheet = cast(shell) as Shape3D;
          if (!(measureArea(sheet as never) > 1e-9)) throw new Error("The boundary surface has no area.");
          tool = own(sheet);
        } else if (feature.type === "surface-blend") {
          // Blend (position continuity): one face filled across chain A, a line to chain B's
          // end, chain B back, and a line to A's start — B taken the way round that keeps the lines apart.
          const bodyA = bodies.get(feature.from.bodyId), bodyB = bodies.get(feature.to.bodyId);
          if (!bodyA || !bodyB) throw new Error("Blend surface needs two available bodies.");
          const o = getOC() as any;
          const a = chainWire(pickedEdgesOf(bodyA, feature.from.bodyId, feature.from.edges, "Blend surface"), "Blend surface");
          const b = chainWire(pickedEdgesOf(bodyB, feature.to.bodyId, feature.to.edges, "Blend surface"), "Blend surface");
          const pt = (v: { x: number; y: number; z: number; delete(): void }): V3 => { const p: V3 = [v.x, v.y, v.z]; v.delete(); return p; };
          const a0 = pt(a.startPoint), a1 = pt(a.endPoint), b0 = pt(b.startPoint), b1 = pt(b.endPoint);
          const dist = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
          const straight = dist(a1, b1) + dist(a0, b0) <= dist(a1, b0) + dist(a0, b1);
          const [bEnd, bStart] = straight ? [b1, b0] : [b0, b1];
          const back = straight ? own(cast(b.wrapped.Reversed()) as Wire) : b;
          const loop = own(assembleWire([a, own(makeLine(a1, bEnd)), back, own(makeLine(bStart, a0))]));
          const face = own(makeNonPlanarFace(loop));
          const builder = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell(); builder.MakeShell(shell); builder.Add(shell, face.wrapped);
          const sheet = cast(shell) as Shape3D;
          if (!(measureArea(sheet as never) > 1e-9)) throw new Error("The blend surface has no area.");
          tool = own(sheet);
        } else if (feature.type === "surface-ruled") {
          const body = bodies.get(feature.bodyIds[0]);
          if (!body) throw new Error("Ruled surface needs an available body.");
          const o = getOC() as any;
          const strips = ruledStrips(body, feature.bodyIds[0], feature.edges, feature.distanceMillimeters, feature.mode, feature.direction as V3 | undefined, "Ruled surface");
          let raw = strips[0];
          if (strips.length > 1) { const sewing = new o.BRepBuilderAPI_Sewing(1e-3, true, true, true, false); for (const strip of strips) sewing.Add(strip); sewing.Perform(new o.Message_ProgressRange_1()); raw = sewing.SewedShape(); }
          const sheet = cast(raw);
          if (!isShape3D(sheet) || !(measureArea(sheet as never) > 1e-9)) throw new Error("The ruled surface has no area. Check the edges and distance.");
          tool = own(sheet);
        } else if (feature.type === "surface-extrude" || feature.type === "surface-revolve" || feature.type === "surface-loft" || feature.type === "surface-patch" || feature.type === "surface-sweep" || feature.type === "surface-offset" || feature.type === "surface-thicken") {
          // Surface creators (SolidCraft's surface.*): sheets built from sketch curves,
          // open or closed, with no caps; Thicken turns sheets into a solid.
          const o = getOC() as any;
          const progress = () => new o.Message_ProgressRange_1();
          const sheetOf = (raw: any): Shape3D => {
            const shape = cast(raw) as any;
            if (isShape3D(shape)) return own(shape);
            const builder = new o.TopoDS_Builder(), shell = new o.TopoDS_Shell();
            builder.MakeShell(shell); builder.Add(shell, raw);
            return own(cast(shell) as Shape3D);
          };
          /** Every chosen curve of a sketch as a wire: open chains are allowed, and a closed one is its boundary. */
          const curveWires = (sketchId: string, contourIds: string[] | undefined, what: string, closedOnly = false): Wire[] => {
            const sketchProfile = profiles.get(sketchId);
            if (!sketchProfile) throw new Error(`${what} needs an earlier sketch.`);
            // A circle or polygon profile has one closed region and no authored contours.
            if (!sketchProfile.contours.length && sketchProfile.regions.length) return [sketchWire(sketchId, undefined, what, false)];
            const chosen = sketchProfile.contours.filter((c) => (!contourIds || (c.id !== undefined && contourIds.includes(c.id))) && (!closedOnly || contourClosed(c)));
            if (!chosen.length) throw new Error(`${what}: the sketch has no ${closedOnly ? "closed " : ""}curves to use.`);
            return chosen.map((c) => sketchWire(sketchId, c.id, what, true));
          };
          /** One shell from several raw shapes: sewn when they touch, a compound otherwise. */
          const joined = (raws: any[]): Shape3D => {
            if (raws.length === 1) return sheetOf(raws[0]);
            const sewing = new o.BRepBuilderAPI_Sewing(1e-3, true, true, true, false);
            for (const raw of raws) sewing.Add(raw);
            sewing.Perform(progress());
            return sheetOf(sewing.SewedShape());
          };
          const sheetArea = (sheet: Shape3D) => { const a = measureArea(sheet as never); if (!(a > 1e-9)) throw new Error("The surface has no area. Check the curves and distances."); return sheet; };
          if (feature.type === "surface-extrude") {
            const frame = sketchFrameOf(feature.profileFeatureId);
            const d = feature.distanceMillimeters * (feature.reversed ? -1 : 1);
            publish(feature, { parameter: "distance", kind: "linear", originMillimeters: sketchCentroid(feature.profileFeatureId), direction: scale(unit(frame.normal as V3), feature.reversed ? -1 : 1), scale: feature.symmetric ? 0.5 : 1, label: "Surface extrude distance" });
            const along = scale(unit(frame.normal as V3), d);
            const wires = curveWires(feature.profileFeatureId, feature.contourIds, "Surface extrude");
            tool = sheetArea(joined(wires.map((wire) => {
              const start = feature.symmetric ? own(wire.clone().translate(-along[0] / 2, -along[1] / 2, -along[2] / 2)) : wire;
              const vec = new o.gp_Vec_4(along[0], along[1], along[2]);
              try { return new o.BRepPrimAPI_MakePrism_1(start.wrapped, vec, false, true).Shape(); } finally { vec.delete(); }
            })));
          } else if (feature.type === "surface-revolve") {
            let axis: V3 = feature.axis === "X" ? [1, 0, 0] : feature.axis === "Y" ? [0, 1, 0] : [0, 0, 1], origin: V3 = [0, 0, 0];
            if (feature.axisReference?.kind === "vector") { origin = [...feature.axisReference.origin] as V3; axis = unit(feature.axisReference.direction); }
            else if (feature.axisReference?.kind === "feature") ({ origin, axis } = axisFeatureLine(feature.axisReference.featureId));
            else if (feature.axisReference) {
              const t = resolveTransform({ kind: "rotate-reference", reference: feature.axisReference as never, angleDegrees: 0 }) as { axisOriginMillimeters: V3; axisDirection: V3 };
              origin = t.axisOriginMillimeters; axis = t.axisDirection;
            }
            if (feature.id === previewId) { const c = sketchCentroid(feature.profileFeatureId), t = dot(sub(c, origin), axis); publish(feature, { parameter: "angle", kind: "angular", originMillimeters: add(origin, scale(axis, t)), direction: axis, label: "Revolve angle" }); }
            const angle = feature.angleDegrees * Math.PI / 180 * (feature.reversed ? -1 : 1);
            const wires = curveWires(feature.profileFeatureId, feature.contourIds, "Surface revolve");
            const ax = new o.gp_Ax1_2(new o.gp_Pnt_3(origin[0], origin[1], origin[2]), new o.gp_Dir_4(axis[0], axis[1], axis[2]));
            try { tool = sheetArea(joined(wires.map((wire) => new o.BRepPrimAPI_MakeRevol_1(wire.wrapped, ax, angle, false).Shape()))); } finally { ax.delete(); }
          } else if (feature.type === "surface-loft") {
            const maker = new o.BRepOffsetAPI_ThruSections(false, Boolean(feature.ruled), 1e-6);
            for (const section of feature.sections) maker.AddWire(sketchWire(section.profileFeatureId, section.contourId, "Surface loft section", true).wrapped);
            maker.Build(progress());
            tool = sheetArea(sheetOf(maker.Shape()));
          } else if (feature.type === "surface-patch") {
            const wires = curveWires(feature.profileFeatureId, feature.contourIds, "Patch", true);
            tool = sheetArea(joined(wires.map((wire) => own(makeFace(wire)).wrapped)));
          } else if (feature.type === "surface-sweep") {
            const spine = sketchWire(feature.pathFeatureId, feature.pathContourId, "Surface sweep path", true);
            const wires = curveWires(feature.profileFeatureId, feature.contourIds, "Surface sweep profile");
            tool = sheetArea(joined(wires.map((wire) => (genericSweep(wire, spine, { frenet: false, transitionMode: "transformed" }) as any).wrapped)));
          } else if (feature.type === "surface-offset") {
            const body = bodies.get(feature.bodyIds[0]);
            if (!body) throw new Error("Offset surface needs an available surface body.");
            if (feature.id === previewId) { const f0 = body.faces[0]; if (f0) { const c = f0.center, nv = f0.normalAt(c); publish(feature, { parameter: "distance", kind: "linear", originMillimeters: [c.x, c.y, c.z], direction: unit([nv.x, nv.y, nv.z]), label: "Offset distance" }); c.delete(); nv.delete(); f0.delete(); } }
            if (feature.distanceMillimeters === 0) tool = own(body.clone());
            else {
              const maker = new o.BRepOffsetAPI_MakeOffsetShape();
              maker.PerformByJoin(body.wrapped, feature.distanceMillimeters, 1e-4, o.BRepOffset_Mode.BRepOffset_Skin, true, false, o.GeomAbs_JoinType.GeomAbs_Arc, false, progress());
              tool = sheetArea(sheetOf(maker.Shape()));
            }
          } else {
            // Thicken: each sheet offset into a solid (the simple offset: faces thickened
            // along their own normals; sharp corners between faces are not joined), the
            // solids fused, then new/add/cut like any tool.
            const pieces = feature.bodyIds.map((id) => {
              let sheet = bodies.get(id);
              if (!sheet) throw new Error("Thicken needs an available surface body.");
              if (feature.id === previewId && id === feature.bodyIds[0]) { const f0 = sheet.faces[0]; if (f0) { const c = f0.center, nv = f0.normalAt(c); publish(feature, { parameter: "thickness", kind: "linear", originMillimeters: [c.x, c.y, c.z], direction: unit([nv.x, nv.y, nv.z]), label: "Thickness" }); c.delete(); nv.delete(); f0.delete(); } }
              const t = feature.thicknessMillimeters;
              if (feature.symmetric) {
                const back = new o.BRepOffsetAPI_MakeOffsetShape();
                back.PerformByJoin(sheet.wrapped, -t / 2, 1e-4, o.BRepOffset_Mode.BRepOffset_Skin, true, false, o.GeomAbs_JoinType.GeomAbs_Arc, false, progress());
                sheet = sheetOf(back.Shape());
              }
              const maker = new o.BRepOffsetAPI_MakeThickSolid();
              maker.MakeThickSolidBySimple(sheet.wrapped, t);
              const made = cast(maker.Shape());
              if (!isShape3D(made)) throw new Error("Thicken did not produce a solid.");
              // Each solid fixed and turned the right way out, then fused into one.
              const solids = solidsOf(own(made)).map((piece) => {
                const fixer = new o.ShapeFix_Solid_2(piece.wrapped); fixer.Perform(progress());
                let solid = cast(fixer.Solid()) as Shape3D;
                if (measureVolume(solid) < 0) solid = cast(solid.wrapped.Reversed()) as Shape3D;
                return own(solid);
              });
              if (!solids.length) throw new Error("Thicken did not produce a solid.");
              const solid = solids.slice(1).reduce((all, piece) => own(all.fuse(piece)), solids[0]);
              if (!(measureVolume(solid) > 1e-9)) throw new Error("Thicken produced no volume. Check the thickness.");
              return solid;
            });
            tool = pieces.slice(1).reduce((all, piece) => own(all.fuse(piece)), pieces[0]);
          }
        } else {
          const profile = profiles.get(feature.profileFeatureId);
          if (!profile) throw new Error("Sketch needs a closed profile before creating a solid.");
          // The regions the feature chose (the way the UI records picks): contour
          // ids of this sketch, or the whole sketch when nothing was named.
          const picks: { profileFeatureId?: string; profileContourId?: string; profileRegion?: unknown }[] =
            ("profileSelections" in feature && feature.profileSelections?.length) ? feature.profileSelections
            : ("profileContourIds" in feature && feature.profileContourIds?.length) ? feature.profileContourIds.map((id) => ({ profileContourId: id }))
            : [{ profileContourId: ("profileContourId" in feature ? feature.profileContourId : undefined), profileRegion: ("profileRegion" in feature ? feature.profileRegion : undefined) }];
          if (picks.some((pick) => pick.profileFeatureId && pick.profileFeatureId !== feature.profileFeatureId)) throw new UnsupportedFeature(feature.id, "profiles from several sketches");
          const thinWalls = feature.type === "extrude" && Boolean(feature.thin);
          const chosen = picks.map((pick) => {
            // Nothing named: the whole sketch (every region), as saved text and legacy documents expect.
            if ((pick.profileContourId === undefined && !pick.profileRegion) || thinWalls) return null;
            const region = pick.profileRegion
              ? [...profile.regions, ...(profile.cells ?? [])].find((r) => r.sourceContourIds && matchesProfileRegion(pick as ProfileRegionSelection, r))
              : profile.regions.find((r) => r.key === pick.profileContourId);
            if (!region) throw new Error(pick.profileRegion ? "The referenced curves no longer form the same closed region. Repair the sketch or reselect the region." : "A selected region is no longer in its sketch.");
            return region;
          });
          const everyRegion = chosen.includes(null) || (chosen.length === profile.regions.length && profile.regions.every((region) => chosen.includes(region)));
          const regionsChosen = chosen.filter((region): region is Region => region !== null);
          // The whole sketch is its closed contours; a sketch whose only regions are
          // connected ones has no whole, so the chosen regions are fused instead.
          const planarDrawing: Drawing | undefined = thinWalls ? undefined : everyRegion && profile.drawing ? own(profile.drawing.clone())
            : regionsChosen.length ? own(regionsChosen.slice(1).reduce((all, region) => own(all.fuse(own(region.drawing.clone()))), own(regionsChosen[0].drawing.clone())))
            : undefined;
          const requireDrawing = (): Drawing => { if (!planarDrawing) throw new Error("Sketch needs a closed profile before creating a solid."); return planarDrawing; };
          const sketchOf = (drawing: Drawing) => own(typeof profile.plane === "string"
            ? own(drawing.clone()).sketchOnPlane(profile.plane, profile.offset)
            : own(drawing.clone()).sketchOnPlane(profile.plane));
          // One extrusion end: how far the tool goes along its direction, and its draft.
          type End = { endType: string; distance: number; endOffset: number; draft: number; point?: ExtrusionPointReference; partId?: string; face?: ExtrudeFeature["endReference"] };
          // What is extruded: a straight prism builder, and (for drafts) offset sections.
          type ProfileShape = { solid: (length: number, dir: V3) => Shape3D; sections?: () => { outer: Wire; holes: Wire[] }[] };
          const frame = typeof profile.plane === "string" ? principalFrame(profile.plane, profile.offset)
            : { normal: [profile.plane.zDir.x, profile.plane.zDir.y, profile.plane.zDir.z], originMillimeters: [profile.plane.origin.x, profile.plane.origin.y, profile.plane.origin.z], xDirection: [profile.plane.xDir.x, profile.plane.xDir.y, profile.plane.xDir.z] };
          const basePlane = typeof profile.plane === "string" ? own(new Plane(frame.originMillimeters as V3, frame.xDirection as V3, frame.normal as V3)) : profile.plane;
          const n = unit(frame.normal as V3), o = frame.originMillimeters as V3;
          // A lone circle is one full-circle edge (replicad draws circles as two
          // arcs, which an oblique or drafted extrusion keeps as two faces).
          const circleWire = (region: Region): Wire | undefined => {
            const circle = !(region.holes?.length) ? profile.circles.find((c) => c.key === region.key) : undefined;
            if (!circle) return undefined;
            const center = deleteAfterVectorTuple(basePlane.toWorldCoords(circle.center));
            return own(assembleWire([own(makeCircle(circle.radius, [center[0], center[1], center[2]], n))]));
          };
          const wireOf = (drawing: Drawing): Wire => (sketchOf(drawing) as unknown as { wire: Wire }).wire;
          const drawingShape = (drawing: Drawing, regions: Region[]): ProfileShape => {
            const lone = regions.length === 1 ? circleWire(regions[0]) : undefined;
            return {
              solid: (length, dir) => {
                const shape = lone ? own(new Sketch(own(lone.clone()), { defaultOrigin: o, defaultDirection: n })).extrude(length, { extrusionDirection: dir }) : sketchOf(drawing).extrude(length, { extrusionDirection: dir });
                if (!isShape3D(shape)) throw new Error("Feature did not produce a solid."); return shape;
              },
              sections: () => regions.map((region) => ({ outer: circleWire(region) ?? wireOf(region.outer ?? region.drawing), holes: (region.holes ?? []).map(wireOf) })),
            };
          };
          const extrudeWith = (shape: ProfileShape): Shape3D => {
            if (feature.type !== "extrude") throw new Error("not an extrude");
            // Direction: the sketch normal, a unit vector, or a line of an earlier
            // sketch. A pad grows along it, a cut goes into the material behind the
            // sketch (FreeCAD's rule, which saved documents assume); Reversed flips either.
            let direction: V3 = n, custom = false;
            if (feature.directionReference) {
              if (feature.directionVector) throw new Error("Choose either a sketch-line reference or a manual extrusion direction.");
              const ref = feature.directionReference;
              const [from, to] = sketchLine(ref, "Extrusion direction line is unavailable. Reselect a sketch line.");
              const along = sub(to, from);
              if (!along.every(Number.isFinite) || norm(along) < 1e-9) throw new Error("Extrusion direction line must have finite nonzero length.");
              direction = unit(along); custom = true;
            } else if (feature.directionVector) {
              const v = feature.directionVector;
              if (v.length !== 3 || !v.every(Number.isFinite) || Math.abs(norm(v) - 1) > 1e-6) throw new Error("Extrusion direction must be a finite unit vector.");
              direction = unit(v); custom = true;
            }
            if (custom && Math.abs(dot(direction, n)) < 1e-7) throw new Error("The extrusion direction is tangent to the sketch. Choose a direction that leaves its plane.");
            if ((feature.operation === "cut") !== Boolean(feature.reversed)) direction = neg(direction);
            // Start: a signed offset along the direction, from the sketch or from a
            // parallel face or plane named as the starting entity.
            let offset = feature.startingOffsetMillimeters ?? 0;
            if (feature.startingReference) {
              const start = feature.startingReference;
              let origin: V3, normal: V3;
              if (start.kind === "principal") { const f = principalFrame(start.plane, 0); origin = f.originMillimeters as V3; normal = f.normal as V3; }
              else if (start.kind === "plane") {
                const sourceIndex = history.findIndex((f) => f.id === start.sourceFeatureId);
                const plane = sourceIndex >= 0 && sourceIndex < index ? history[sourceIndex] : undefined;
                if (!plane || plane.type !== "plane") throw new Error("Starting plane is unavailable. Reselect an earlier reference plane.");
                const f = resolvePlaneFrame(plane, history.slice(0, sourceIndex)); origin = f.originMillimeters as V3; normal = f.normal as V3;
              } else { normal = unit(start.normal); origin = planarFaceCenter(start.sourceFeatureId, start.bodyId, normal, start.faceAnchor, "Starting face", "Starting face is unavailable. Reselect an earlier planar face."); }
              if (norm(cross(normal, n)) > 1e-7) throw new Error("Starting entity must be parallel to the sketch plane.");
              const alignment = dot(normal, direction);
              if (Math.abs(alignment) < 1e-7) throw new Error("Extrusion direction must leave the starting plane.");
              offset += dot(normal, sub(origin, o)) / alignment;
            }
            if (!Number.isFinite(offset)) throw new Error("Starting offset must be finite.");
            const draftOf = (angle: number | undefined) => {
              const value = angle ?? 0;
              if (!Number.isFinite(value) || Math.abs(value) >= 90) throw new Error("Extrusion draft must be finite and between -90 and 90 degrees.");
              return value;
            };
            const endType = feature.endType ?? "blind";
            const primary: End = { endType, distance: feature.distanceMillimeters, endOffset: feature.endOffsetMillimeters ?? 0, draft: draftOf(feature.draftAngleDegrees), point: feature.endPointReference, partId: feature.endPartId, face: feature.endReference };
            if (primary.endOffset && !["up-to-next", "up-to-face", "up-to-part", "up-to-vertex"].includes(endType)) throw new Error("End offset requires a supported stopping limit.");
            // The other side: an independent second end, the legacy opposite depth,
            // or the second half of a symmetric extrusion.
            let second: End | undefined;
            if (feature.secondEnd) {
              const s = feature.secondEnd;
              if (feature.secondDistanceMillimeters) throw new Error("Choose one second-end definition, not both legacy depth and independent end.");
              if (endType.startsWith("symmetric")) throw new Error("Symmetric and an independent second end are mutually exclusive.");
              if (!Number.isFinite(s.distanceMillimeters) || s.distanceMillimeters <= 0) throw new Error("Second-end depth must be finite and positive.");
              second = { endType: s.endType, distance: s.distanceMillimeters, endOffset: s.endOffsetMillimeters ?? 0, draft: draftOf(s.draftAngleDegrees), point: s.endPointReference, partId: s.endPartId, face: s.endReference };
            } else if (feature.secondDistanceMillimeters) {
              if (endType !== "blind") throw new Error("Legacy opposite depth requires Blind.");
              if (!Number.isFinite(feature.secondDistanceMillimeters) || feature.secondDistanceMillimeters < 0) throw new Error("Extrusion depths must be finite and positive.");
              second = { endType: "blind", distance: feature.secondDistanceMillimeters, endOffset: 0, draft: 0 };
            } else if (endType === "symmetric" || endType === "symmetric-through-all") {
              const mode = endType === "symmetric" ? "blind" : "through-all";
              primary.endType = mode; primary.distance = feature.distanceMillimeters / 2;
              second = { endType: mode, distance: feature.distanceMillimeters / 2, endOffset: 0, draft: primary.draft };
            }
            const drafted = Boolean(primary.draft || second?.draft);
            if (drafted && custom && Math.abs(dot(direction, n)) < 1 - 1e-7) throw new Error("Draft along an oblique direction is not supported yet. Disable Draft or use the sketch normal.");
            if (drafted && !shape.sections) throw new UnsupportedFeature(feature.id, "drafted thin extrusions");
            const prism = (low: number, high: number, dir: V3): Shape3D => {
              if (!(high - low > 0)) throw new Error("Extrusion depths must be finite and positive.");
              // A drawn circle is two arcs: merge same-domain faces so a cylinder is
              // one face with a seam, as FreeCAD builds it.
              const clean = own(shape.solid(high - low, dir)).simplify();
              return own(low ? clean.translate(dir[0] * low, dir[1] * low, dir[2] * low) : clean);
            };
            // A drafted prism (FreeCAD's PartDesign::Draft, checked there against the
            // same planar offsets): the sketch plane is neutral, every section at a
            // signed distance t from it is the profile offset by -t·tan(angle) (holes
            // the other way), and the solid is the ruled loft between the end sections.
            const draftedPrism = (low: number, high: number, dir: V3, angle: number): Shape3D => {
              if (!(high - low > 0)) throw new Error("Extrusion depths must be finite and positive.");
              const slope = Math.tan(angle * Math.PI / 180);
              const collapse = "Draft collapses or intersects the profile. Reduce the angle, depth or starting offset.";
              const sectionAt = (wire: Wire, delta: number, t: number): Wire => {
                try {
                  const offset = Math.abs(delta) < 1e-10 ? own(wire.clone()) : own(wire.clone().offset2D(delta, "intersection"));
                  return t ? own(offset.translate(dir[0] * t, dir[1] * t, dir[2] * t)) : offset;
                } catch (error) { throw new Error(collapse, { cause: error }); }
              };
              const ruled = (wire: Wire, sign: 1 | -1) => {
                const solid = loft([sectionAt(wire, -sign * low * slope, low), sectionAt(wire, -sign * high * slope, high)], { ruled: true });
                if (!isShape3D(solid)) throw new Error(collapse);
                return own(solid);
              };
              let result: Shape3D | undefined;
              for (const { outer, holes } of shape.sections!()) {
                let solid = ruled(outer, 1);
                for (const hole of holes) solid = own(solid.cut(ruled(hole, -1)));
                result = result ? own(result.fuse(solid)) : solid;
              }
              if (!result) throw new Error("Draft needs a closed planar region.");
              const pieces = solidsOf(result), ok = pieces.length >= 1 && pieces.every((piece) => measureVolume(piece) > 1e-9); pieces.forEach(release);
              if (!ok) throw new Error("Draft collapses or intersects the profile. Reduce the angle, depth or starting offset.");
              return own(result.simplify());
            };
            // Travel along `dir` per unit of axial movement (FreeCAD's profile axis).
            const axisOf = (dir: V3) => { const axis = dot(n, dir) < 0 ? neg(n) : n; return { axis, alignment: dot(axis, dir), origin: dot(o, axis) }; };
            const farthestAlong = (shapes: Iterable<Shape3D>, axis: V3) => { let m = -Infinity; for (const shape of shapes) for (const c of corners(shape.boundingBox.bounds)) m = Math.max(m, dot(c, axis)); return m; };
            const diagonalOf = (shape: Shape3D) => { const b = shape.boundingBox.bounds; return norm(sub([b[1][0], b[1][1], b[1][2]], [b[0][0], b[0][1], b[0][2]])); };
            // Ends that are a distance along the direction: the far end, null when
            // a through-all finds nothing on this side, undefined for the others.
            const intervalEnd = (dir: V3, start: number, end: End): number | null | undefined => {
              if (end.endType === "blind") { if (!Number.isFinite(end.distance) || end.distance <= 0) throw new Error("Extrusion depths must be finite and positive."); return start + end.distance; }
              if (end.endType === "through-all") {
                if (!["cut", "intersect"].includes(feature.operation) || !bodies.size) throw new Error("Through all requires Remove or Intersect and a target body.");
                const { axis, alignment, origin } = axisOf(dir);
                const maximum = (farthestAlong(bodies.values(), axis) - origin) / alignment;
                return maximum <= start ? null : maximum + 1;
              }
              if (end.endType === "up-to-vertex") {
                const { axis, alignment } = axisOf(dir);
                const depth = dot(axis, sub(stopPoint(end.point), o)) / alignment - end.endOffset;
                if (!Number.isFinite(depth) || depth <= start + 1e-7) throw new Error("The stopping point leaves no extrusion beyond its start. Flip direction or adjust the offset.");
                return depth;
              }
              return undefined;
            };
            // Up to face: a planar stop. Parallel to the sketch it is a plain prism;
            // tilted, the prism is kept on the near side of the plane.
            const toFace = (dir: V3, start: number, end: End): Shape3D => {
              const ref = end.face;
              if (!ref) throw new Error("Up to face needs an available stopping face.");
              if (ref.surfaceType) {
                // A curved stop (FreeCAD's extrusion_surface_limit): the untrimmed surface
                // splits space; the side holding the start is kept. Cylinders and spheres
                // are exact primitives here (the wasm has no half-space builder).
                const source = bodyAt(ref.sourceFeatureId, ref.bodyId);
                if (!source) throw new Error("Up to face reference is unavailable. Reselect the stopping face.");
                const stopFace = surfaceFaceOf(source, ref.surfaceType, ref.faceAnchor, "Up to face");
                if (extendedStopSurfaces.includes(ref.surfaceType)) {
                  // Any other surface: the full build makes a half-space from the face's
                  // untrimmed surface, the side holding a start vertex is kept.
                  const f = extendedKernel();
                  if (!f) { stopFace.delete(); throw new UnsupportedFeature(feature.id, `${ref.surfaceType} stopping faces`); }
                  const probe = prism(start, start + 1, dir);
                  const starts = capFaces(probe, dir, -1);
                  if (starts.length !== 1) { starts.forEach((cap) => cap.delete()); stopFace.delete(); throw new UnsupportedFeature(feature.id, "curved stops of several regions"); }
                  const startCap = starts[0], startArea = measureArea(startCap), tolerance = Math.max(1e-9, startArea * 1e-9);
                  const stopCenter = [...deleteAfterVectorTuple(stopFace.center)] as V3, startCenter = [...deleteAfterVectorTuple(startCap.center)] as V3;
                  const span = Math.max(1, norm(sub(stopCenter, startCenter)) + diagonalOfShape(stopFace) + diagonalOf(probe) + Math.abs(end.endOffset));
                  const tool = prism(start, start + 4 * span, dir), ends = capFaces(tool, dir, 1);
                  const surfaceContact = end.endOffset ? own(stopFace.clone().translate(-dir[0] * end.endOffset, -dir[1] * end.endOffset, -dir[2] * end.endOffset)) : stopFace;
                  const faceX = toExtended(stopFace), toolX = toExtended(tool);
                  const handle = f.BRep_Tool.Surface_2(f.TopoDS.Face_1(faceX));
                  // The untrimmed surface, its infinite parameters clamped to the tool's reach
                  // (an unbounded cone face does not split the prism).
                  const adaptor = new f.GeomAdaptor_Surface_2(handle);
                  const clamp = (value: number, fallback: number) => (Math.abs(value) > 1e99 ? fallback : value);
                  const reach = 4 * span + diagonalOfShape(stopFace);
                  const maker = new f.BRepBuilderAPI_MakeFace_14(handle, clamp(adaptor.FirstUParameter(), -reach), clamp(adaptor.LastUParameter(), reach), clamp(adaptor.FirstVParameter(), -reach), clamp(adaptor.LastVParameter(), reach), 1e-7);
                  adaptor.delete();
                  // Split the prism by the surface patch (moved by the end offset); the piece
                  // holding the whole start is the material before the surface.
                  let patchX = maker.Face();
                  if (end.endOffset) { const move = new f.gp_Trsf_1(), vec = new f.gp_Vec_4(-dir[0] * end.endOffset, -dir[1] * end.endOffset, -dir[2] * end.endOffset); move.SetTranslation_1(vec); const mover = new f.BRepBuilderAPI_Transform_2(patchX, move, true); patchX = mover.Shape(); mover.delete(); vec.delete(); move.delete(); }
                  const progress = new f.Message_ProgressRange_1();
                  const splitter = new f.BRepAlgoAPI_Splitter_1(), arguments_ = new f.TopTools_ListOfShape_1(), tools_ = new f.TopTools_ListOfShape_1();
                  arguments_.Append_1(toolX); tools_.Append_1(patchX);
                  splitter.SetArguments(arguments_); splitter.SetTools(tools_);
                  splitter.Build(progress);
                  let remainder: Shape3D;
                  try { if (splitter.HasErrors()) throw new Error("split failed"); remainder = own(fromExtended(splitter.Shape())); }
                  catch (error) { startCap.delete(); ends.forEach((cap) => cap.delete()); throw new Error("The stopping surface does not leave the complete extrusion start connected.", { cause: error }); }
                  finally { splitter.delete(); arguments_.delete(); tools_.delete(); progress.delete(); maker.delete(); handle.delete(); toolX.delete(); faceX.delete(); }
                  try {
                    // A double cone leaves disjoint lumps in one solid: every shell is its own piece.
                    const pieces = solidsOf(remainder).flatMap((solid) => {
                      const oc = getOC(), shells: Shell[] = [];
                      const explorer = new oc.TopExp_Explorer_2(solid.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SHELL as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never);
                      while (explorer.More()) { shells.push(cast(explorer.Current()) as Shell); explorer.Next(); }
                      explorer.delete();
                      if (shells.length < 2) { shells.forEach((shell) => shell.delete()); return [solid]; }
                      release(solid);
                      return shells.map((shell) => { const piece = makeSolid([shell]); shell.delete(); return measureVolume(piece) < 0 ? (cast(piece.wrapped.Reversed()) as Shape3D) : piece; });
                    });
                    const touching = pieces.filter((piece) => commonArea(startCap, piece) > tolerance);
                    const result = touching.length === 1 ? touching[0] : undefined;
                    for (const piece of pieces) if (piece !== result) release(piece);
                    if (!result || Math.abs(commonArea(startCap, result) - startArea) > tolerance) throw new Error("The stopping surface does not leave the complete extrusion start connected.");
                    own(result);
                    const escapes = ends.some((cap) => commonArea(cap, result) > Math.max(1e-12, measureArea(cap) * 1e-9));
                    // The result came back through STEP, so its boundary no longer shares the
                    // source face's representation: contact is a distance, not a common area.
                    const touchesSurface = measureDistanceBetween(surfaceContact, result) <= 1e-6;
                    if (escapes || !touchesSurface) throw new Error("The selected surface does not completely terminate the extrusion before the profile escapes or its draft collapses.");
                    if (measureVolume(result) <= 1e-9) throw new Error("The stopping surface does not produce a valid extrusion.");
                    return result;
                  } finally { startCap.delete(); ends.forEach((cap) => cap.delete()); if (surfaceContact === stopFace) stopFace.delete(); }
                }
                const oc = getOC();
                const adaptor = new oc.BRepAdaptor_Surface_2(stopFace.wrapped, true);
                let axisLocation: V3, axisDirection: V3 = [0, 0, 1], radius: number;
                if (ref.surfaceType === "cylinder") {
                  const cylinder = adaptor.Cylinder(), axis = cylinder.Axis(), l = axis.Location(), d = axis.Direction();
                  axisLocation = [l.X(), l.Y(), l.Z()]; axisDirection = unit([d.X(), d.Y(), d.Z()]); radius = cylinder.Radius();
                  l.delete(); d.delete(); axis.delete(); cylinder.delete();
                } else {
                  const sphere = adaptor.Sphere(), l = sphere.Location();
                  axisLocation = [l.X(), l.Y(), l.Z()]; radius = sphere.Radius();
                  l.delete(); sphere.delete();
                }
                adaptor.delete();
                const stopCenter = [...deleteAfterVectorTuple(stopFace.center)] as V3, stopDiagonal = diagonalOfShape(stopFace);
                stopFace.delete();
                const probe = prism(start, start + 1, dir);
                const startDiagonal = diagonalOf(probe), epsilon = Math.max(1e-6, startDiagonal * 1e-9);
                const starts = capFaces(probe, dir, -1);
                if (starts.length !== 1) { starts.forEach((cap) => cap.delete()); throw new UnsupportedFeature(feature.id, "curved stops of several regions"); }
                const startCap = starts[0], startArea = measureArea(startCap), tolerance = Math.max(1e-9, startArea * 1e-9);
                const startCenter = [...deleteAfterVectorTuple(startCap.center)] as V3;
                // A start vertex belongs to actual material (a ring's centre does not): it picks the side.
                const [firstEdge] = startCap.edges;
                const vertex = [...deleteAfterVectorTuple(firstEdge.startPoint)] as V3; firstEdge.delete();
                const sample = add(vertex, scale(dir, epsilon));
                const fromAxis = ref.surfaceType === "cylinder" ? norm(cross(sub(sample, axisLocation), axisDirection)) : norm(sub(sample, axisLocation));
                const inside = fromAxis < radius;
                const span = Math.max(1, norm(sub(stopCenter, startCenter)) + stopDiagonal + startDiagonal + Math.abs(end.endOffset));
                const size = 4 * span + 2 * radius;
                const primitive: Shape3D = ref.surfaceType === "cylinder"
                  ? own(makeCylinder(radius, size, sub(axisLocation, scale(axisDirection, size / 2)), axisDirection))
                  : own(makeSphere(radius).translate(axisLocation[0], axisLocation[1], axisLocation[2]));
                let half: Shape3D = primitive;
                if (!inside) { const box = own(makeBaseBox(size, size, size).translate(axisLocation[0], axisLocation[1], axisLocation[2] - size / 2)); half = own(box.cut(primitive)); }
                // An end offset moves the stopping surface along the extrusion, not radially.
                const surface = end.endOffset ? own(primitive.clone().translate(-dir[0] * end.endOffset, -dir[1] * end.endOffset, -dir[2] * end.endOffset)) : primitive;
                if (end.endOffset) half = own(half.translate(-dir[0] * end.endOffset, -dir[1] * end.endOffset, -dir[2] * end.endOffset));
                const shifted = own(startCap.clone().translate(dir[0] * epsilon, dir[1] * epsilon, dir[2] * epsilon));
                if (Math.abs(commonArea(shifted, half) - startArea) > tolerance) { startCap.delete(); throw new Error("The stopping surface crosses or lies behind the extrusion start. Adjust the start or end offset."); }
                const { axis, alignment, origin } = axisOf(dir);
                const high = (farthestAlong([half], axis) - origin) / alignment + 1;
                if (!(high > start + epsilon)) { startCap.delete(); throw new Error("The stopping surface lies behind the extrusion start. Flip direction or adjust its offset."); }
                const tool = prism(start, high, dir), ends = capFaces(tool, dir, 1);
                try {
                  const remainder = own(tool.intersect(half));
                  const pieces = solidsOf(remainder);
                  const touching = pieces.filter((piece) => commonArea(startCap, piece) > tolerance);
                  const result = touching.length === 1 ? touching[0] : undefined;
                  for (const piece of pieces) if (piece !== result) release(piece);
                  if (!result || Math.abs(commonArea(startCap, result) - startArea) > tolerance) throw new Error("The stopping surface does not leave the complete extrusion start connected.");
                  own(result);
                  const escapes = ends.some((cap) => commonArea(cap, result) > Math.max(1e-12, measureArea(cap) * 1e-9));
                  let contact = 0;
                  for (const face of surface.faces) { if (face.geomType !== "PLANE") contact += commonArea(face, result); face.delete(); }
                  if (escapes || contact <= tolerance) throw new Error("The selected surface does not completely terminate the extrusion before the profile escapes or its draft collapses.");
                  if (measureVolume(result) <= 1e-9) throw new Error("The stopping surface does not produce a valid extrusion.");
                  return result;
                } finally { startCap.delete(); ends.forEach((cap) => cap.delete()); }
              }
              if (!ref.normal) throw new Error("Up to face needs a valid unit normal.");
              const normal = unit(ref.normal);
              const center = planarFaceCenter(ref.sourceFeatureId, ref.bodyId, normal, ref.faceAnchor, "Up to face", "Up to face reference is unavailable. Reselect the stopping face.");
              const alignment = dot(normal, dir);
              if (Math.abs(alignment) < 1e-7) throw new Error("The stopping plane is parallel to the extrusion direction. Select another face.");
              const planePoint = sub(center, scale(dir, end.endOffset));
              const probe = prism(start, start + 1, dir);
              let maximum = -Infinity;
              for (const corner of corners(probe.boundingBox.bounds)) maximum = Math.max(maximum, dot(normal, sub(planePoint, corner)) / alignment);
              if (!Number.isFinite(maximum) || maximum <= 1e-7) throw new Error("The stopping plane leaves no extrusion beyond its start.");
              if (norm(cross(normal, n)) < 1e-10) return prism(start, start + maximum, dir);
              const full = prism(start, start + maximum + Math.max(1, diagonalOf(probe) * 0.01), dir);
              let span = 1; for (const corner of corners(full.boundingBox.bounds)) span = Math.max(span, norm(sub(corner, planePoint)) + 1);
              const half = halfSpace(planePoint, alignment > 0 ? neg(normal) : normal, span, own);
              // Nothing of the starting profile may lie behind the plane.
              for (const cap of capFaces(probe, dir, -1)) {
                const area = measureArea(cap);
                const shifted = own(cap.translate(dir[0] * 1e-6, dir[1] * 1e-6, dir[2] * 1e-6)); // consumes the cap
                if (area - commonArea(shifted, half) > Math.max(1e-10, area * 1e-10)) throw new Error("The stopping plane crosses or lies behind the extrusion start. Flip direction or adjust the offset.");
              }
              const tool = own(full.intersect(half));
              const before = solidsOf(full), after = solidsOf(tool);
              const valid = after.length === before.length && after.every((solid) => measureVolume(solid) > 1e-9);
              before.forEach(release); after.forEach(release);
              if (!valid) throw new Error("The selected plane does not produce a valid complete extrusion.");
              return tool;
            };
            // Up to next (FreeCAD's rule): every boundary patch the ray meets casts
            // a forward shadow; cutting the shadows away keeps only the material
            // before the first boundary, so stepped stops from several parts work.
            const toNext = (dir: V3, low: number, end: End): Shape3D => {
              const limits = [...bodies.values()];
              if (!limits.length) throw new Error("Up to next requires an existing part in the extrusion direction.");
              const { axis, alignment, origin } = axisOf(dir);
              const epsilon = Math.max(1e-6, diagonalOf(prism(low, low + 1, dir)) * 1e-9);
              let reach = (farthestAlong(limits, axis) - origin) / alignment - low;
              if (!Number.isFinite(reach) || reach <= epsilon) throw new Error("No next boundary lies beyond the extrusion start. Flip direction or adjust its offset.");
              reach += Math.max(1, Math.max(...limits.map(diagonalOf)) * 1e-6) / alignment;
              // The probe starts just past the sketch, so a coincident starting face
              // is ignored and a profile inside a part reaches its exit.
              const probe = prism(low + epsilon, low + epsilon + reach, dir);
              const length = reach + Math.abs(end.endOffset) + 1;
              const tool = prism(low, low + length, dir);
              const shadows: Shape3D[] = [];
              const sweep = new Vector(scale(dir, length + Math.abs(end.endOffset) + 1));
              for (const limit of limits) for (const face of limit.faces) {
                for (const patch of commonFaces(face, probe)) {
                  const shadow = basicFaceExtrusion(patch, sweep);
                  patch.delete();
                  let volume = 0; try { volume = measureVolume(shadow); } catch { volume = 0; }
                  if (Math.abs(volume) <= 1e-10) { shadow.delete(); continue; } // a tangential wall does not stop an axial ray
                  shadows.push(own(end.endOffset ? shadow.translate(-dir[0] * end.endOffset, -dir[1] * end.endOffset, -dir[2] * end.endOffset) : shadow));
                }
                face.delete();
              }
              sweep.delete();
              if (!shadows.length) throw new Error("No next face covers the selected profile. Flip direction or choose another limit.");
              let result: Shape3D = tool;
              for (const shadow of shadows) result = own(result.cut(shadow));
              const starts = capFaces(tool, dir, -1), ends = capFaces(tool, dir, 1);
              let complete = true;
              try {
                const pieces = solidsOf(result);
                complete = pieces.length === starts.length && pieces.every((piece) => measureVolume(piece) > 1e-9);
                pieces.forEach(release);
                for (const cap of starts) { const area = measureArea(cap); if (Math.abs(commonArea(cap, result) - area) > Math.max(1e-9, area * 1e-9)) complete = false; }
                for (const cap of ends) if (commonArea(cap, result) > Math.max(1e-9, measureArea(cap) * 1e-9)) complete = false;
              } finally { for (const cap of [...starts, ...ends]) cap.delete(); }
              if (!complete) throw new Error("The next boundary does not cover and completely terminate the profile beyond its start. Adjust the profile, direction or end offset.");
              return result;
            };
            // Up to part: the tool is trimmed by the chosen solid (curved boundaries
            // included); the one piece still touching the whole start is kept and
            // must stop at the part before the far cap.
            const toPart = (dir: V3, low: number, end: End): Shape3D => {
              const limit = end.partId ? bodies.get(end.partId) : undefined;
              if (!limit) throw new Error("The stopping part is unavailable. Reselect an earlier solid part.");
              const stop = end.endOffset ? own(limit.clone().translate(-dir[0] * end.endOffset, -dir[1] * end.endOffset, -dir[2] * end.endOffset)) : limit;
              const { axis, alignment, origin } = axisOf(dir);
              const epsilon = Math.max(1e-6, diagonalOf(prism(low, low + 1, dir)) * 1e-8);
              const bound = (farthestAlong([stop], axis) - origin) / alignment + epsilon * 10;
              if (!Number.isFinite(bound) || bound <= low + epsilon) throw new Error("The stopping part lies behind the extrusion start. Flip direction or adjust its offset.");
              const tool = prism(low, bound, dir);
              const starts = capFaces(tool, dir, -1), ends = capFaces(tool, dir, 1);
              try {
                if (starts.length !== 1) throw new UnsupportedFeature(feature.id, "up-to-part extrusions of several regions");
                const start = starts[0], startArea = measureArea(start), tolerance = Math.max(1e-8, startArea * 1e-8);
                // A profile inside the part stops at its exit, one outside at its entry.
                const shifted = own(start.clone().translate(dir[0] * epsilon, dir[1] * epsilon, dir[2] * epsilon));
                const overlap = commonArea(shifted, stop);
                const inside = Math.abs(overlap - startArea) <= tolerance;
                if (!inside && overlap > tolerance) throw new Error("The stopping part crosses the extrusion start. Move the start to one side of its boundary.");
                const remainder = own(inside ? tool.intersect(stop) : tool.cut(stop));
                const pieces = solidsOf(remainder);
                const touching = pieces.filter((piece) => commonArea(start, piece) > tolerance);
                const result = touching.length === 1 ? touching[0] : undefined;
                for (const piece of pieces) if (piece !== result) release(piece);
                if (!result || Math.abs(commonArea(start, result) - startArea) > tolerance) throw new Error("The stopping part does not leave the complete extrusion start connected.");
                own(result);
                let contact = 0;
                for (const face of stop.faces) { contact += commonArea(face, result) - commonArea(face, start); face.delete(); }
                const beyond = ends.reduce((sum, cap) => sum + commonArea(cap, result), 0), endArea = ends.reduce((sum, cap) => sum + measureArea(cap), 0);
                if (beyond > Math.max(1e-12, endArea * 1e-8) || contact <= tolerance) throw new Error("The selected part does not fully stop the extrusion before the profile passes beyond it.");
                if (measureVolume(result) <= 1e-9) throw new Error("The stopping part does not produce a valid extrusion.");
                return result;
              } finally { for (const cap of [...starts, ...ends]) cap.delete(); }
            };
            // Both sides share the start plane. Without drafts, distance-type ends on
            // either side merge into one prism; a drafted side is lofted on its own
            // (narrowing away from the sketch); face, next and part stops are their own tools.
            const sides: { dir: V3; sign: 1 | -1; start: number; end: End }[] = [{ dir: direction, sign: 1, start: offset, end: primary }];
            if (second) sides.push({ dir: neg(direction), sign: -1, start: -offset, end: second });
            const tools: Shape3D[] = [];
            let low = offset, high = offset, intervals = 0;
            for (const side of sides) {
              const far = intervalEnd(side.dir, side.start, side.end);
              if (far === null) continue;
              if (far !== undefined) {
                if (side.end.draft) { tools.push(draftedPrism(side.start, far, side.dir, side.end.draft)); continue; }
                const signed = far * side.sign; low = Math.min(low, signed); high = Math.max(high, signed); intervals++; continue;
              }
              if (side.end.draft) throw new UnsupportedFeature(feature.id, "drafted extrusions to a face, part or vertex");
              if (side.end.endType === "up-to-face") tools.push(toFace(side.dir, side.start, side.end));
              else if (side.end.endType === "up-to-next") tools.push(toNext(side.dir, side.start, side.end));
              else if (side.end.endType === "up-to-part") tools.push(toPart(side.dir, side.start, side.end));
              else throw new Error("Unknown extrusion end type.");
            }
            if (intervals) tools.push(prism(low, high, direction));
            if (!tools.length) throw new Error(sides.length > 1 ? "Neither extrusion end reaches the target part." : "The target lies behind the extrusion. Flip direction or adjust its offset.");
            return tools.length === 1 ? tools[0] : own(tools[0].fuse(tools[1]));
          };
          const extrudeDrawing = (drawing: Drawing, regions: Region[]) => extrudeWith(drawingShape(drawing, regions));
          // Thin: walls around the picked sketch curves (FreeCAD's rule). Thickness 1
          // is outside a closed loop or to the right of an open curve, thickness 2 the
          // other side; open ends are capped flat; a mid-plane wall is centred.
          const extrudeThin = (): Shape3D => {
            if (feature.type !== "extrude" || !feature.thin) throw new Error("not a thin extrude");
            const thin = feature.thin;
            let a = thin.thickness1Millimeters, b = thin.thickness2Millimeters;
            if (![a, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 1e6)) throw new Error("Wall thicknesses must be finite nonnegative distances up to 1000000 mm.");
            if (thin.midplane) {
              const total = thin.midplaneThicknessMillimeters ?? 0;
              if (!Number.isFinite(total) || !(total > 0) || total > 1e6) throw new Error("Mid plane thickness must be positive and at most 1000000 mm.");
              a = b = total / 2;
            }
            if (a + b <= 1e-7) throw new Error("The total wall thickness must be positive.");
            if (thin.flipped) [a, b] = [b, a];
            const named = picks.map((pick) => pick.profileContourId).filter((id): id is string => id !== undefined);
            if (!named.length) throw new Error("Select sketch curves for the thin wall.");
            const oc = getOC();
            const tools: Shape3D[] = [];
            for (const id of named) {
              const contour = profile.contours.find((c) => c.id === id);
              if (!contour) throw new Error("A selected curve is no longer in its sketch.");
              const base = own(contourDrawing(contour, feature.id));
              if (contourClosed(contour)) {
                let wall: Drawing;
                try {
                  const outer = a > 1e-12 ? own(base.offset(a, { lineJoinType: "miter" })) : base;
                  const inner = b > 1e-12 ? own(base.offset(-b, { lineJoinType: "miter" })) : base;
                  wall = own(outer.cut(inner));
                } catch (error) { throw new Error("The wall offset splits or collapses the closed contour. Reduce thickness.", { cause: error }); }
                tools.push(extrudeWith({ solid: (length, dir) => { const shape = sketchOf(wall).extrude(length, { extrusionDirection: dir }); if (!isShape3D(shape)) throw new Error("The thin wall self-intersects or collapses. Repair the sketch or reduce thickness."); return shape; } }));
                continue;
              }
              // An open curve: offset each side in the sketch plane (OCCT's open
              // result, intersection joins), then close the strip with straight caps.
              const sketch = sketchOf(base) as unknown as { wire: Wire };
              const wire = sketch.wire;
              const point = (v: { delete(): void; x: number; y: number; z: number }): V3 => deleteAfterVectorTuple(v as never) as unknown as V3;
              const start = point(wire.startPoint), end = point(wire.endPoint);
              const edges = wire.edges;
              const endTangent = (edge: typeof edges[number], at: V3, into: boolean): V3 => {
                const atStart = norm(sub(point(edge.startPoint), at)) < 1e-7;
                const tangent = unit(point(edge.tangentAt(atStart ? 0 : 1)));
                return atStart === into ? tangent : neg(tangent);
              };
              const nearest = (at: V3) => edges.find((edge) => norm(sub(point(edge.startPoint), at)) < 1e-7 || norm(sub(point(edge.endPoint), at)) < 1e-7) ?? edges[0];
              const first = endTangent(nearest(start), start, true), last = endTangent(nearest(end), end, false);
              const straight = edges.every((edge) => edge.geomType === "LINE") && edges.every((edge) => norm(cross(first, sub(point(edge.endPoint), start))) < 1e-7);
              const offsetOpen = (distance: number): { wire: Wire; start: V3; end: V3 } => {
                const startTarget = add(start, scale(cross(first, n), distance)), endTarget = add(end, scale(cross(last, n), distance));
                if (Math.abs(distance) < 1e-12) return { wire: own(wire.clone()), start, end };
                if (straight) { const shift = scale(cross(first, n), distance); return { wire: own(wire.clone().translate(shift[0], shift[1], shift[2])), start: startTarget, end: endTarget }; }
                const tolerance = Math.max(1e-6, Math.abs(distance) * 1e-6);
                for (const sign of [1, -1]) {
                  let candidate: Wire | undefined;
                  try {
                    const op = new oc.BRepOffsetAPI_MakeOffset_3(wire.wrapped, oc.GeomAbs_JoinType.GeomAbs_Intersection as never, true);
                    op.Perform(sign * distance, 0);
                    const result = cast(op.Shape());
                    op.delete();
                    const wires = result.wires;
                    if (wires.length === 1 && !wires[0].isClosed) candidate = wires[0]; else wires.forEach((w) => w.delete());
                    if (result !== candidate) result.delete();
                  } catch { candidate = undefined; }
                  if (!candidate) continue;
                  const p = point(candidate.startPoint), q = point(candidate.endPoint);
                  const forward = norm(sub(p, startTarget)) < tolerance && norm(sub(q, endTarget)) < tolerance;
                  const backward = norm(sub(q, startTarget)) < tolerance && norm(sub(p, endTarget)) < tolerance;
                  if (forward || backward) return { wire: own(candidate), start: forward ? p : q, end: forward ? q : p };
                  candidate.delete();
                }
                throw new Error("This wall offset collapses or changes the open contour. Reduce thickness or repair the sketch.");
              };
              const right = offsetOpen(a), left = offsetOpen(-b);
              // The wire builder takes edges in traversal order: chain each side from its start.
              const chain = (side: Wire, from: V3) => {
                const remaining = side.edges, ordered: typeof remaining = [];
                let at = from;
                while (remaining.length) {
                  const next = remaining.findIndex((edge) => norm(sub(point(edge.startPoint), at)) < 1e-6 || norm(sub(point(edge.endPoint), at)) < 1e-6);
                  if (next < 0) throw new Error("The wall offset does not form a complete capped boundary.");
                  const [edge] = remaining.splice(next, 1);
                  const s0 = point(edge.startPoint), s1 = point(edge.endPoint);
                  at = norm(sub(s0, at)) < 1e-6 ? s1 : s0;
                  ordered.push(edge);
                }
                return ordered;
              };
              let face: Face;
              try {
                const boundary = own(assembleWire([...chain(right.wire, right.start), own(makeLine(right.end, left.end)), ...chain(left.wire, left.end), own(makeLine(left.start, right.start))]));
                face = own(makeFace(boundary));
              } catch (error) { throw new Error("The wall offset does not form a complete capped boundary.", { cause: error }); }
              edges.forEach((edge) => edge.delete());
              if (!(measureArea(face) > 1e-9)) throw new Error("The thin wall self-intersects or collapses. Repair the sketch or reduce thickness.");
              tools.push(extrudeWith({ solid: (length, dir) => { const sweep = new Vector(scale(dir, length)); try { return basicFaceExtrusion(face, sweep); } finally { sweep.delete(); } } }));
            }
            return tools.slice(1).reduce((all, tool) => own(all.fuse(tool)), tools[0]);
          };
          const revolve = () => {
            if (feature.type !== "revolve") throw new Error("not a revolve");
            let axis: [number, number, number] = feature.axis === "X" ? [1, 0, 0] : feature.axis === "Y" ? [0, 1, 0] : [0, 0, 1], origin: V3 = [0, 0, 0];
            if (feature.axisReference?.kind === "vector") { origin = [...feature.axisReference.origin] as V3; axis = unit(feature.axisReference.direction); }
            else if (feature.axisReference?.kind === "feature") ({ origin, axis } = axisFeatureLine(feature.axisReference.featureId));
            else if (feature.axisReference) {
              const t = resolveTransform({ kind: "rotate-reference", reference: feature.axisReference, angleDegrees: 0 }) as { axisOriginMillimeters: V3; axisDirection: V3 };
              origin = t.axisOriginMillimeters; axis = t.axisDirection;
            }
            type RevolveEnd = { endType: string; angle?: number; face?: ExtrudeFeature["endReference"]; partId?: string; point?: ExtrusionPointReference };
            const primary: RevolveEnd = { endType: feature.endType ?? "blind", angle: feature.angleDegrees, face: feature.endReference, partId: feature.endPartId, point: feature.endPointReference };
            const second: RevolveEnd | undefined = feature.secondEnd ? { endType: feature.secondEnd.endType, angle: feature.secondEnd.angleDegrees, face: feature.secondEnd.endReference, partId: feature.secondEnd.endPartId, point: feature.secondEnd.endPointReference }
              : feature.secondAngleDegrees ? { endType: "blind", angle: feature.secondAngleDegrees } : undefined;
            if (feature.symmetric && (second || primary.endType !== "blind")) throw new Error("Symmetric revolve needs a Blind end and no second end.");
            const blind = (end: RevolveEnd) => { const a = end.angle ?? NaN; if (!(a > 0) || a > 360) throw new Error("Revolve angles must be finite, positive and at most 360 degrees."); return a; };
            if (primary.endType === "blind" && second?.endType === "blind" && blind(primary) + blind(second) > 360) throw new Error("Revolve angles must total at most 360 degrees.");
            // FreeCAD's Revolution flags: Reversed turns the other way, Midplane
            // centres the sweep on the sketch, a second end adds the other side.
            const sign = feature.reversed ? -1 : 1;
            if (feature.id === previewId) {
              // One ring per Blind end through the profile's centre, turning its own way.
              const c = sketchCentroid(feature.profileFeatureId), foot = add(origin, scale(axis, dot(sub(c, origin), axis)));
              const ring = (parameter: string, side: number, label: string) => publish(feature, { parameter, kind: "angular", originMillimeters: foot, direction: scale(axis, side), startMillimeters: c, label });
              if (primary.endType === "blind") ring("angle", sign, "Revolve angle");
              if (second?.endType === "blind") ring("second", -sign, "Opposite angle");
            }
            const turn = (angle: number) => {
              const shape = sketchOf(requireDrawing()).revolve(axis, { origin, angle });
              // A profile straddling its axis sweeps through itself: OCCT returns an
              // empty solid rather than failing, so say what is wrong instead.
              if (isShape3D(shape) && measureVolume(shape) < 1e-6) throw new Error("Revolve profile crosses its axis. Keep the profile on one side of the axis.");
              return shape;
            };
            const radial = (p: V3) => { const d = sub(p, origin); return sub(d, scale(axis, dot(d, axis))); };
            // One side of the revolve, turning `side` about the axis until its end is met.
            const sweep = (end: RevolveEnd, side: 1 | -1): Shape3D | ReturnType<typeof turn> => {
              if (end.endType === "blind") return turn(side * blind(end));
              if (end.endType === "up-to-vertex") {
                // The half-plane through the stopping point and the axis, measured from the profile's.
                const a = radial(sketchCentroid(feature.profileFeatureId)), b = radial(stopPoint(end.point));
                if (norm(b) < 1e-9) throw new Error("The stopping point lies on the revolve axis. Pick another point.");
                const angle = (((side * Math.atan2(dot(cross(a, b), axis), dot(a, b)) * 180 / Math.PI) % 360) + 360) % 360;
                if (angle < 1e-6) throw new Error("The stopping point lies in the profile's plane. Flip direction or pick another point.");
                return turn(side * angle);
              }
              const limits = end.endType === "up-to-part" ? [end.partId ? bodies.get(end.partId) : undefined]
                : end.endType === "up-to-face" ? [end.face && bodyAt(end.face.sourceFeatureId, end.face.bodyId)]
                : [...bodies.values()];
              if (!limits.length || limits.some((limit) => !limit)) throw new Error(end.endType === "up-to-next" ? "Up to next requires an earlier part." : "The stopping part is unavailable. Reselect an earlier solid part or face.");
              const stop = (limits as Shape3D[]).slice(1).reduce((all, limit) => own(all.fuse(limit)), limits[0] as Shape3D);
              // ponytail: a near-full turn trimmed by the stop, like Extrude's Up to part: the piece
              // still holding the whole profile is the revolve, and the stop must cut it off before
              // the far end. Up to face accepts the face the sweep meets first on its part.
              const full = turn(side * 359.99);
              if (!isShape3D(full)) throw new Error("Feature did not produce a solid.");
              own(full);
              const profileSketch = sketchOf(requireDrawing());
              const starts = "face" in profileSketch ? [own(profileSketch.face())] : (own(profileSketch.faces()) as Shape3D).faces.map(own);
              const area = (faces: Face[], of: Shape3D) => faces.reduce((sum, face) => sum + commonArea(face, of), 0);
              const startArea = starts.reduce((sum, face) => sum + measureArea(face), 0), tolerance = Math.max(1e-8, startArea * 1e-8);
              const turned = (degrees: number) => starts.map((face) => own(own(face.clone()).rotate(degrees, origin, axis)));
              const overlap = area(turned(side * 1e-3), stop), inside = Math.abs(overlap - startArea) <= tolerance;
              if (!inside && overlap > tolerance) throw new Error("The stop crosses the profile. Keep the profile on one side of it.");
              const pieces = solidsOf(own(inside ? full.intersect(stop) : full.cut(stop)));
              const touching = pieces.filter((piece) => area(starts, piece) > tolerance), result = touching.length === 1 ? touching[0] : undefined;
              for (const piece of pieces) if (piece !== result) release(piece);
              if (!result || Math.abs(area(starts, result) - startArea) > tolerance) throw new Error("The stop does not leave the whole profile connected to the revolve.");
              own(result);
              if (measureVolume(full) - measureVolume(result) <= tolerance) throw new Error("Nothing stops the revolve in this direction. Flip direction or choose another limit.");
              if (area(turned(side * 359.99), result) > tolerance) throw new Error("The limit does not completely stop the revolve before it comes round. Choose another limit.");
              if (end.endType === "up-to-face") {
                const face = faceByReference(stop, end.face!, "Up to face"), contact = commonArea(face, result);
                face.delete();
                if (contact <= tolerance) throw new Error("The revolve meets its part before the selected face. Choose the face it reaches first.");
              }
              return result;
            };
            let shape = sweep(primary, sign);
            if (feature.symmetric && isShape3D(shape)) shape = own(shape).rotate(-sign * blind(primary) / 2, origin, axis);
            if (second && isShape3D(shape)) {
              const other = sweep(second, -sign as 1 | -1);
              if (isShape3D(other)) shape = own(shape).fuse(own(other));
            }
            return isShape3D(shape) ? own(shape).simplify() : shape;
          };
          if (feature.type === "extrude" && feature.id === previewId) {
            // The extrude handles the dialog already drags: the primary extent along the sketch
            // normal from the profile's centre, and the opposite end when there is one.
            const frame = sketchFrameOf(feature.profileFeatureId), n = unit(frame.normal as V3), c = sketchCentroid(feature.profileFeatureId);
            const symmetric = feature.endType === "symmetric" || feature.endType === "symmetric-through-all";
            previewAxes.push({ side: "primary", parameter: "distance", originMillimeters: c, direction: n, scale: symmetric ? 0.5 : 1, reversed: Boolean(feature.reversed) });
            if (feature.secondEnd) previewAxes.push({ side: "opposite", parameter: "second", originMillimeters: c, direction: [-n[0], -n[1], -n[2]], scale: 1, reversed: Boolean(feature.reversed) });
          }
          const result = own(feature.type === "extrude" ? (feature.thin ? extrudeThin() : extrudeDrawing(requireDrawing(), everyRegion ? profile.regions : regionsChosen)) : revolve());
          if (!isShape3D(result))
            throw new Error("Feature did not produce a solid.");
          tool = result;
          if (feature.type === "extrude" && feature.targetBodyIds && feature.scopeMode !== "all") {
            // Explicit scope (FreeCAD's rule): Remove and Intersect meet each named
            // part on its own (a part the tool misses is kept unchanged); Add joins
            // every named part and the tool into one solid under the first identity.
            const ids = feature.targetBodyIds, operation = feature.operation;
            if (!["add", "cut", "intersect"].includes(operation) || !ids.length || ids.length > 256 || new Set(ids).size !== ids.length || (feature.targetBodyId && feature.targetBodyId !== ids[0])) throw new Error("Choose distinct target parts for Add, Remove or Intersect.");
            if (ids.some((id) => !bodies.has(id))) throw new Error("A selected target part is unavailable. Repair the extrusion scope.");
            const volumeOf = (shape: unknown) => { try { return isShape3D(shape as Shape3D) ? measureVolume(shape as Shape3D) : 0; } catch { return 0; } };
            if (operation === "add") {
              let joined: Shape3D = own(bodies.get(ids[0])!.fuse(tool));
              for (const id of ids.slice(1)) joined = own(joined.fuse(bodies.get(id)!));
              const pieces = solidsOf(joined), one = pieces.length === 1; pieces.forEach(release);
              if (!one || volumeOf(joined) <= 1e-9) throw new Error("Add must join all selected parts into one solid. Adjust the depth or merge scope.");
              bodies.set(ids[0], own(joined.simplify()));
              for (const id of ids.slice(1)) bodies.delete(id);
            } else {
              const pending: [string, Shape3D][] = [];
              let removed = 0;
              ids.forEach((id, index) => {
                const target = bodies.get(id)!;
                const { shape, volume, removed: removedVolume } = scopedRemoval(target, tool, operation as 'cut' | 'intersect', own);
                const pieces = solidsOf(shape), valid = pieces.length >= 1 && volume > 1e-9; pieces.forEach(release);
                if (!valid) throw new Error(`Extrusion leaves no valid solid in selected part ${index + 1}. Narrow the scope or adjust the depth.`);
                removed += removedVolume;
                pending.push([id, shape]);
              });
              if (operation === "cut" && removed < 1e-8) throw new Error("Cut removes no material from the selected parts. Check scope and direction.");
              for (const [id, shape] of pending) bodies.set(id, shape === bodies.get(id) ? shape : own(shape.simplify()));
            }
            tools.set(feature.id, tool);
            currentBodyID = ids[0];
            continue;
          }
          if (feature.type === "extrude" && feature.scopeMode === "all") {
            // Automatic scope (FreeCAD's rule): the tool meets every solid it
            // overlaps — removed from or intersected with each, or joined into the
            // parts it touches, which merge; parts a cut empties are consumed.
            const operation = feature.operation;
            if (!["add", "cut", "intersect"].includes(operation) || feature.targetBodyIds || feature.targetBodyId) throw new Error("Automatic extrusion scope cannot also specify target parts.");
            const solids = [...bodies];
            if (!solids.length) throw new Error("Automatic scope needs an earlier solid part.");
            const volumeOf = (shape: unknown) => { try { return isShape3D(shape as Shape3D) ? measureVolume(shape as Shape3D) : 0; } catch { return 0; } };
            const overlap = (a: Shape3D, b: Shape3D) => { const common = a.intersect(b); const volume = volumeOf(common); release(common); return volume; };
            const targets: string[] = [];
            const pending: { sources: string[]; shape: Shape3D }[] = [];
            if (operation === "add") {
              for (const [id, shape] of solids) if (measureDistanceBetween(shape, tool) <= 1e-7) targets.push(id);
              if (!targets.length) throw new Error("Add does not touch any solid part. Extend the extrusion or choose New.");
              let joined: Shape3D = own(bodies.get(targets[0])!.fuse(tool));
              for (const id of targets.slice(1)) joined = own(joined.fuse(bodies.get(id)!));
              const components = solidsOf(joined).map((solid) => ({ sources: new Set(targets.filter((id) => overlap(solid, bodies.get(id)!) > 1e-9)), shapes: [own(solid)] }));
              if (components.some((component) => !component.sources.size)) throw new Error("Each added region must join a solid part. Edge-only contact or a detached region cannot form a solid merge; choose New or adjust the sketch.");
              // A part already made of several solids keeps its one identity.
              const groups: { sources: Set<string>; shapes: Shape3D[] }[] = [];
              for (const component of components) {
                const matching = groups.filter((group) => [...group.sources].some((id) => component.sources.has(id)));
                for (const group of matching) { groups.splice(groups.indexOf(group), 1); group.sources.forEach((id) => component.sources.add(id)); component.shapes.push(...group.shapes); }
                groups.push(component);
              }
              for (const group of groups) {
                const ordered = targets.filter((id) => group.sources.has(id));
                const shape = group.shapes.length === 1 ? group.shapes[0] : own(group.shapes.slice(1).reduce((all, part) => own(all.fuse(part)), group.shapes[0]));
                pending.push({ sources: ordered, shape });
              }
              pending.sort((a, b) => targets.indexOf(a.sources[0]) - targets.indexOf(b.sources[0]));
            } else {
              // One boolean per part: a box test skips parts the tool cannot reach, and
              // the cut's own volume change says whether the tool met the part at all.
              const toolBox = tool.boundingBox.bounds;
              const boxesMeet = (box: [ArrayLike<number>, ArrayLike<number>]) => [0, 1, 2].every((i) => box[0][i] <= toolBox[1][i] + 1e-7 && toolBox[0][i] <= box[1][i] + 1e-7);
              for (const [id, shape] of solids) {
                if (!boxesMeet(shape.boundingBox.bounds)) continue;
                const before = volumeOf(shape);
                const result = operation === "cut" ? shape.cut(tool) : shape.intersect(tool);
                const after = volumeOf(result);
                if (operation === "cut" ? Math.abs(before - after) <= Math.max(1e-9, before * 1e-12) : after <= 1e-9) { release(result); if (operation === "intersect" && overlap(shape, tool) > 1e-9) throw new Error("Intersect did not produce a valid solid."); continue; }
                targets.push(id);
                if (!isShape3D(result) || after <= 1e-9) {
                  if (operation === "cut") continue; // a complete removal consumes the part
                  throw new Error("Intersect did not produce a valid solid.");
                }
                pending.push({ sources: [id], shape: own(result) });
              }
              if (!targets.length) throw new Error("The extrusion does not overlap any solid part. Adjust its depth or direction.");
            }
            const survivors = new Set<string>();
            const groups: { bodyId: string; sources: string[] }[] = [];
            for (const { sources, shape } of pending) { bodies.set(sources[0], shape); survivors.add(sources[0]); groups.push({ bodyId: sources[0], sources }); }
            for (const id of targets) if (!survivors.has(id)) bodies.delete(id);
            scopeResolutions[feature.id] = { targets, groups };
            tools.set(feature.id, tool);
            currentBodyID = groups[groups.length - 1]?.bodyId ?? currentBodyID;
            continue;
          }
          if (feature.type === "extrude" && feature.separateBodies && feature.operation === "new") {
            // FreeCAD names each output solid by the sketch regions it came from.
            const solids = solidsOf(tool);
            // One region: every solid is its own, no per-region prisms and booleans
            // (they cost more than the extrusion itself).
            const identityRegions = regionsChosen.some(region => region.cell) ? regionsChosen : profile.regions;
            const regionTools = identityRegions.length === 1 ? [] : identityRegions.map((region) => ({ key: region.key, tool: extrudeDrawing(region.drawing, [region]) }));
            const keys = solids.map((solid) => {
              const identities = identityRegions.length === 1 ? [identityRegions[0].key] : regionTools.filter(({ tool: regionTool }) => { const overlap = solid.intersect(regionTool); const volume = isShape3D(overlap) ? measureVolume(overlap) : 0; release(overlap); return volume > 1e-8; }).map((r) => r.key).sort();
              if (!identities.length) throw new Error("Could not identify an extrusion output body.");
              return sha256Hex(JSON.stringify(identities)).slice(0, 24);
            });
            solids.forEach(release); regionTools.forEach((r) => release(r.tool));
            if (new Set(keys).size !== keys.length) throw new Error("A region splits into ambiguous output bodies. Split the sketch into distinct contours first.");
            tools.set(feature.id, tool);
            combine(tool, feature.operation, feature, keys);
            continue;
          }
        }
        tools.set(feature.id, tool);
        // Preserve the legacy combine contract after the feature-kind branches.
        combine(tool, feature.operation, feature);
      } catch (error) {
        failed = true;
        if (error instanceof UnsupportedFeature) throw error;
        // A bare number is an uncaught OCCT exception: say what it means, not its address.
        throw new FeatureFailure(feature.id, feature.name, error instanceof Error ? error.message : typeof error === "number" ? "The kernel could not build this feature. Check its dimensions and references." : String(error));
      }
      } finally {
        if (failed) { for (const shape of stepOwned.reverse()) release(shape); for (const step of thawed.splice(index - thawFrom + 1)) step.owned.forEach(release); }
        else cached.push({ key: keys[index], profiles: new Map(profiles), tools: new Map(tools), bodies: new Map(bodies), meshes: new Map(meshParts), currentBodyID, outputs: { ...bodyOutputs }, frames: { ...sketchFrames }, scopes: { ...scopeResolutions }, owned: stepOwned });
        options.observe?.({ phase: 'feature', id: feature.id, name: feature.name, type: feature.type, failed, milliseconds: performance.now() - featureStarted });
      }
    }
    // Preview: the design before the feature, and the feature's own material
    // (blue when it adds, red when it removes) — what the viewer overlays.
    let featurePreview: ImportedModelData["featurePreview"];
    const tool = previewId && tools.get(previewId);
    const previewIndex = history.findIndex((feature) => feature.id === previewId);
    const previewBase = previewId ? [...(previewIndex > 0 ? cached[previewIndex - 1].bodies : new Map<string, Shape3D>())].map(([id, body], index) => geometry(body, `preview:base:${id}`, id, index)) : undefined;
    if (previewId && previewBase && tool && last && "operation" in last) {
      const target = ("targetBodyId" in last && last.targetBodyId) || currentBodyID || previewId;
      const removes = last.operation === "cut";
      const part = geometry(tool, `preview:${removes ? "removed" : "added"}:${target}`, target, 0, true);
      featurePreview = { featureId: previewId, base: previewBase, added: removes ? [] : [part], removed: removes ? [part] : [], ...(previewAxes.length ? { extrusionAxes: previewAxes } : {}) };
    }
    options.withBodies?.(bodies);
    options.withMeshes?.(meshParts);
    const names = availableBodies(document);
    return {
      sourceName: document.name + AETHER_CAD_EXTENSION,
      ...(Object.keys(bodyOutputs).length ? { bodyOutputs } : {}),
      ...(previewId && previewHandles.length ? { previewHandles, previewFeatureId: previewId } : {}),
      ...(Object.keys(sketchFrames).length ? { sketchFrames } : {}),
      ...(Object.keys(scopeResolutions).length ? { scopeResolutions } : {}),
      ...(featurePreview ? { featurePreview } : {}),
      // A preview is drawn from its base + delta overlay; the rolled-back result's
      // own mesh and topology would only be built to be ignored.
      parts: featurePreview ? [] : [
        ...[...bodies].map(([id, body], index) => geometry(body, id, names.find((b) => b.id === id)?.name ?? `Body ${index + 1}`, index)),
        ...[...meshParts].map(([id, mesh], index) => ({ geometryKind: "mesh" as const, id, name: names.find((b) => b.id === id)?.name ?? `Mesh ${index + 1}`, sourceDocumentId: document.documentId, sourceName: document.name, vertices: mesh.vertices, normals: mesh.normals, triangles: mesh.triangles, edgeLines: new Float32Array(0), faceRanges: [], topology: [] })),
      ],
      parseMilliseconds: performance.now() - started,
      replayedFeatures: history.length - reuse - adopted,
    };
  }
}
