import {
  cast, getOC, isShape3D, makeBaseBox, measureVolume,
  type AnyShape, type Face, type Shape3D,
} from "replicad";
import {
  drawingViewFrame, type PartDrawingOptions, type ProjectedDrawingCurve,
} from "../drawing/projection";

type V3 = [number, number, number];
type HatchLine = Extract<ProjectedDrawingCurve, { kind: "line" }>;
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

function bounds(shape: AnyShape): [V3, V3] {
  const oc = getOC();
  const box = new oc.Bnd_Box_1();
  try {
    oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false);
    const lo = box.CornerMin();
    const hi = box.CornerMax();
    try {
      return [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]];
    } finally {
      lo.delete();
      hi.delete();
    }
  } finally {
    box.delete();
  }
}

/** Owned cut solids exist only for the callback. Source/cache bodies are never
 * modified. Hatches are exact intersections of each cap face with parallel
 * planes, so holes and disconnected material require no polygon approximation. */
export function withDrawingSection<T>(
  shapes: Shape3D[],
  options: PartDrawingOptions,
  read: (shapes: Shape3D[], hatch: HatchLine[]) => T,
): T {
  const section = options.section;
  if (!section) return read(shapes, []);
  if (options.orientation === "isometric") throw Error("Section views require a principal orientation.");
  const { normal, up } = drawingViewFrame(options.orientation);
  const axis = normal.findIndex(value => value !== 0);
  const offset = section.offsetMm;
  if (!Number.isFinite(offset) || !Number.isFinite(section.modelSpacingMm) || section.modelSpacingMm <= 0) {
    throw Error("A section needs a finite cut position and positive hatch spacing.");
  }
  const right: V3 = [
    up[1] * normal[2] - up[2] * normal[1],
    up[2] * normal[0] - up[0] * normal[2],
    up[0] * normal[1] - up[1] * normal[0],
  ];
  const cutShapes: Shape3D[] = [];
  const hatch: HatchLine[] = [];
  let capCount = 0;
  let hatchBudget = 2048;
  try {
    for (const source of shapes) {
      const [originalLo, originalHi] = bounds(source);
      const crosses = offset > originalLo[axis] + 1e-7 && offset < originalHi[axis] - 1e-7;
      const lo = originalLo.map(n => n - 1) as V3;
      const hi = originalHi.map(n => n + 1) as V3;
      if (normal[axis] > 0) hi[axis] = Math.min(hi[axis], offset);
      else lo[axis] = Math.max(lo[axis], offset);
      if (lo.some((value, i) => value >= hi[i])) continue;
      const cutter = makeBaseBox(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
        .translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]);
      let cut: AnyShape | undefined;
      try {
        cut = source.intersect(cutter);
        if (!isShape3D(cut) || measureVolume(cut) <= 1e-9) {
          cut.delete();
          cut = undefined;
          continue;
        }
        cutShapes.push(cut);
        cut = undefined;
      } finally {
        cut?.delete();
        cutter.delete();
      }
      if (!crosses) continue;
      const faces = cutShapes.at(-1)!.faces;
      try {
        for (const face of faces) {
          const [a, b] = bounds(face);
          if (face.geomType !== "PLANE" || Math.abs(a[axis] - offset) > 1e-6 || Math.abs(b[axis] - offset) > 1e-6) continue;
          capCount++;
          hatchBudget -= hatchFace(face, right, up, section.modelSpacingMm, hatch, hatchBudget);
        }
      } finally {
        faces.forEach(face => face.delete());
      }
    }
    if (!capCount || !cutShapes.length) throw Error("The section plane does not cross solid material. Choose a cut inside the model.");
    return read(cutShapes, hatch);
  } finally {
    cutShapes.forEach(shape => shape.delete());
  }
}

function hatchFace(
  face: Face, right: V3, up: V3, spacing: number,
  out: HatchLine[], budget: number,
): number {
  const oc = getOC();
  const [lo, hi] = bounds(face);
  // Unit normal to 45-degree hatch lines, in the cut plane.
  const direction = right.map((n, i) => (n - up[i]) * Math.SQRT1_2) as V3;
  const corners = Array.from({ length: 8 }, (_, mask) => lo.map((n, i) => mask & (1 << i) ? hi[i] : n));
  const distances = corners.map(point => dot(point, direction));
  const first = Math.ceil(Math.min(...distances) / spacing);
  const last = Math.floor(Math.max(...distances) / spacing);
  const count = last - first + 1;
  if (count > budget) throw Error("Section hatching exceeds 2048 lines. Reduce the view scale or increase hatch spacing.");
  for (let index = first; index <= last; index++) {
    const distance = index * spacing;
    const origin = new oc.gp_Pnt_3(...direction.map(n => n * distance) as V3);
    const normal = new oc.gp_Dir_4(...direction);
    const plane = new oc.gp_Pln_3(origin, normal);
    const operation = new oc.BRepAlgoAPI_Section_1();
    const progress = new oc.Message_ProgressRange_1();
    try {
      operation.Init1_1(face.wrapped);
      operation.Init2_2(plane);
      operation.Build(progress);
      if (!operation.IsDone()) throw Error("The section hatch could not be computed.");
      const shape = cast(operation.Shape());
      try {
        const edges = shape.edges;
        try {
          for (const edge of edges) {
            const start = edge.startPoint;
            const end = edge.endPoint;
            try {
              const a = start.toTuple();
              const b = end.toTuple();
              if (Math.hypot(...a.map((n, i) => n - b[i])) > 1e-7) {
                out.push({ kind: "line", start: [dot(a, right), dot(a, up)], end: [dot(b, right), dot(b, up)] });
              }
            } finally {
              start.delete();
              end.delete();
            }
          }
        } finally {
          edges.forEach(edge => edge.delete());
        }
      } finally {
        shape.delete();
      }
    } finally {
      progress.delete();
      operation.delete();
      plane.delete();
      normal.delete();
      origin.delete();
    }
  }
  return Math.max(0, count);
}
