import { isShape3D, type Shape3D, type Wire } from "replicad";
import type { PartFeature } from "../../document/index";
import type { PartTransform } from "../../document/part-transform";
import type { PreviewHandle } from "../../contracts/geometry";
import { UnsupportedFeature } from "../feature-errors";
import { add, sub, scale, unit, dot, cross, type V3 } from "../vector";
type PatternFeature = Extract<PartFeature, {
  type: "pattern";
}>;
export interface PatternContext {
  history: readonly PartFeature[];
  bodies: Map<string, Shape3D>;
  tools: Map<string, Shape3D>;
  bodyOutputs: Record<string, string[]>;
  currentBodyID?: string;
  own: <T>(value: T) => T;
  previewId?: string;
  publish: (feature: {
    id: string;
  }, handle: PreviewHandle) => void;
  resolveTransform: (transform: PartTransform) => PartTransform;
  pathSource: (id: string) => {
    contours: {
      id?: string;
    }[];
  } | undefined;
  sketchWire: (id: string, contourId: string | undefined, label: string, anyContour?: boolean) => Wire;
  axisFeatureLine: (id: string) => {
    origin: V3;
    axis: V3;
  };
}
/** Repeats the authored source tool or whole bodies, retaining source identity,
 * output identities and preview handles. The caller owns atomic cache commit. */
export function applyPatternFeature(feature: PatternFeature, context: PatternContext): string | undefined {
  const { history, bodies, tools, bodyOutputs, own, previewId, publish, resolveTransform, pathSource, sketchWire, axisFeatureLine } = context;
  let { currentBodyID } = context;
  // PartDesign patterns: the source feature's own tool, repeated along a
  // body axis (count includes the original) and applied the way the
  // source was — added or removed. A full polar turn spaces the copies
  // over 360°; a partial one spreads them from the original to the angle.
  const partPattern = Boolean(feature.bodyIds);
  const source = partPattern ? undefined : history.find((f) => f.id === feature.sourceFeatureId);
  const tool = partPattern ? undefined : tools.get(feature.sourceFeatureId);
  if (!partPattern) {
    if (!source || !tool || !("operation" in source))
      throw new Error("Choose a source feature in the selected target body.");
    if (!["extrude", "revolve"].includes(source.type))
      throw new Error("Choose an additive or subtractive profile feature to pattern.");
    if (source.operation === "intersect")
      throw new UnsupportedFeature(feature.id, "patterns of intersect features");
  }
  const count = feature.count;
  if (!Number.isInteger(count) || count < 2)
    throw new Error("Pattern needs at least two occurrences, including the original.");
  const principal = (axis: "X" | "Y" | "Z"): V3 => axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : [0, 0, 1];
  // A direction beyond the principal axes: a vector, or a picked straight edge
  // (resolved the way a transform's reference line is).
  const directionOf = (ref: import("../../document/pattern").PatternDirection | undefined, axis: "X" | "Y" | "Z"): V3 => {
    if (!ref)
      return principal(axis);
    if (ref.kind === "vector")
      return unit(ref.direction);
    const t = resolveTransform({ kind: "translate-reference", reference: ref, distanceMillimeters: 1 });
    return (t as {
      translationMillimeters: V3;
    }).translationMillimeters;
  };
  const id = partPattern ? feature.bodyIds![0] : (("targetBodyId" in feature && feature.targetBodyId) || currentBodyID);
  const target = id ? bodies.get(id) : undefined;
  if (!target || !id)
    throw new Error("Select an existing target body.");
  // Where the original sits in a row: index offsets for the copies.
  const offsets = (n: number, alignment: "left" | "center" | "right" | undefined): number[] => {
    const first = alignment === "left" ? -(n - 1) : alignment === "center" ? -Math.floor((n - 1) / 2) : 0;
    return Array.from({ length: n }, (_, i) => first + i);
  };
  let placements: ((shape: Shape3D) => Shape3D)[] = [];
  if (feature.patternType === "path") {
    // Along a sketch curve: copies at equal arc length, kept as drawn or turned to
    // follow the path's tangent (SolidCraft's identical | path).
    const pathProfile = pathSource(feature.pathFeatureId);
    if (!pathProfile)
      throw new Error("Pattern on path needs a curve of an earlier sketch.");
    const pathId = feature.pathContourId ?? (pathProfile.contours.length === 1 ? pathProfile.contours[0].id : undefined);
    if (pathId === undefined)
      throw new Error("Pattern path sketch has several curves — choose which one to use.");
    const spine = sketchWire(feature.pathFeatureId, pathId, "Pattern path", true);
    const samples: {
      at: V3;
      tangent: V3;
      s: number;
    }[] = [];
    let s = 0;
    for (const edge of spine.edges) {
      const steps = 64;
      let previous: V3 | undefined;
      for (let i = 0; i <= steps; i++) {
        const p = edge.pointAt(i / steps), d = edge.tangentAt(i / steps);
        const at: V3 = [p.x, p.y, p.z], tangent = unit([d.x, d.y, d.z]);
        p.delete();
        d.delete();
        if (previous)
          s += Math.hypot(at[0] - previous[0], at[1] - previous[1], at[2] - previous[2]);
        samples.push({ at, tangent, s });
        previous = at;
      }
      edge.delete();
    }
    const total = s, step = feature.spacingMillimeters ?? (feature.distanceMillimeters! / (count - 1));
    if (!(step > 0) || step * (count - 1) > total + 1e-6)
      throw new Error("The pattern does not fit along the path. Reduce the spacing or the count.");
    const at = (distance: number) => {
      let k = samples.findIndex((sample) => sample.s >= distance);
      if (k < 0)
        k = samples.length - 1;
      return samples[Math.max(0, k)];
    };
    const start = samples[0];
    for (let i = 1; i < count; i++) {
      const target = at(step * i), move = sub(target.at, start.at);
      placements.push((shape) => {
        let moved: Shape3D = own(shape.clone().translate(move[0], move[1], move[2]));
        if (feature.orientation === "path") {
          const axis = cross(start.tangent, target.tangent), angle = Math.acos(Math.max(-1, Math.min(1, dot(start.tangent, target.tangent)))) * 180 / Math.PI;
          if (Math.hypot(...axis) > 1e-9 && angle > 1e-9)
            moved = own(moved.rotate(angle, target.at, unit(axis)));
        }
        return moved;
      });
    }
  }
  else if (feature.patternType === "linear") {
    const extent = feature.spacingMillimeters * (count - 1);
    if (!Number.isFinite(extent) || extent <= 0)
      throw new Error("Pattern spacing must be positive and finite.");
    const rows: {
      direction: V3;
      step: number;
      offsets: number[];
    }[] = [
      { direction: scale(directionOf(feature.direction, feature.axis), feature.reversed ? -1 : 1), step: feature.spacingMillimeters, offsets: offsets(count, feature.alignment) },
    ];
    if (feature.second) {
      const s = feature.second;
      rows.push({ direction: scale(directionOf(s.direction, s.axis ?? "Y"), s.reversed ? -1 : 1), step: s.spacingMillimeters, offsets: offsets(s.count, s.alignment) });
    }
    if (feature.id === previewId) {
      const anchor = tools.get(feature.sourceFeatureId) ?? (feature.bodyIds ? bodies.get(feature.bodyIds[0]) : undefined);
      const c = anchor ? (anchor.boundingBox.center as number[]) : [0, 0, 0];
      publish(feature, { parameter: "spacing", kind: "linear", originMillimeters: [0, 1, 2].map((i) => c[i] + rows[0].direction[i] * feature.spacingMillimeters) as V3, direction: rows[0].direction, label: "Pattern spacing" });
    }
    for (const i of rows[0].offsets)
      for (const j of rows[1]?.offsets ?? [0]) {
        if (i === 0 && j === 0)
          continue;
        const move = add(scale(rows[0].direction, rows[0].step * i), rows[1] ? scale(rows[1].direction, rows[1].step * j) : [0, 0, 0]);
        placements.push((shape) => own(shape.clone().translate(move[0], move[1], move[2])));
      }
  }
  else {
    const extent = feature.angleDegrees;
    if (!Number.isFinite(extent) || !(extent > 0 && extent <= 360))
      throw new Error("Pattern angle must be greater than 0 and at most 360 degrees.");
    const step = extent === 360 ? 360 / count : extent / (count - 1), sign = feature.reversed ? -1 : 1;
    let origin: V3 = [0, 0, 0], axis: V3 = principal(feature.axis);
    if (feature.axisReference?.kind === "vector") {
      origin = [...feature.axisReference.origin] as V3;
      axis = unit(feature.axisReference.direction);
    }
    else if (feature.axisReference?.kind === "feature")
      ({ origin, axis } = axisFeatureLine(feature.axisReference.featureId));
    else if (feature.axisReference) {
      const t = resolveTransform({ kind: "rotate-reference", reference: feature.axisReference, angleDegrees: 0 }) as {
        axisOriginMillimeters: V3;
        axisDirection: V3;
      };
      origin = t.axisOriginMillimeters;
      axis = t.axisDirection;
    }
    publish(feature, { parameter: "angle", kind: "angular", originMillimeters: origin, direction: axis, label: "Pattern angle" });
    for (const i of offsets(count, feature.alignment))
      if (i !== 0)
        placements.push((shape) => own(shape.clone().rotate(step * i * sign, origin, axis)));
  }
  if (partPattern) {
    // Whole parts: every placement of every chosen part becomes a new part.
    const ids: string[] = [];
    for (const bodyId of feature.bodyIds!) {
      const shape = bodies.get(bodyId);
      if (!shape)
        throw new Error("A part to pattern is unavailable.");
      placements.forEach((place, index) => {
        const copyId = `${feature.copyBodyIds![bodyId]}:${index + 1}`;
        if (bodies.has(copyId))
          throw new Error("Duplicate output body identity.");
        bodies.set(copyId, place(shape));
        ids.push(copyId);
      });
    }
    bodyOutputs[feature.id] = ids;
    currentBodyID = ids[ids.length - 1] ?? currentBodyID;
    return currentBodyID;
  }
  let body: Shape3D = target;
  const copies: Shape3D[] = [];
  for (const place of placements) {
    const copy = place(tool!);
    copies.push(copy);
    const next = (source as {
      operation?: string;
    }).operation === "cut" ? body.cut(copy) : body.fuse(copy);
    if (!isShape3D(next))
      throw new Error("The operation left no solid.");
    body = own(next);
  }
  bodies.set(id, body);
  currentBodyID = id;
  // The copies together are what a mirror or later pattern of this feature repeats.
  tools.set(feature.id, copies.length === 1 ? copies[0] : own(copies.slice(1).reduce((all, copy) => own(all.fuse(copy)), copies[0])));
  return currentBodyID;
}
