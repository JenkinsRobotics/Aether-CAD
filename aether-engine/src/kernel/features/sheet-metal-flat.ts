import { measureArea, type Shape3D, type Wire } from "replicad";
import type { BendTableRow, SheetMetalFeature, SheetMetalRule } from "../../document/sheet-metal";
import { sheetBendTable } from "../../document/sheet-metal";
import type { PartDocument } from "../../document/part-document";
import { projectHiddenLineView } from "../hidden-line";
import { canonicalPlaneXDirection, profileFrame } from "../../document/construction-planes";
import { dot, unit, type V3 } from "../vector";

export interface FlatPatternLine {
  layer: "OUTLINE" | "CUT" | "BEND_UP" | "BEND_DOWN";
  start: [number, number];
  end: [number, number];
}

export interface FlatPatternResult {
  bodyId: string;
  widthMillimeters: number;
  heightMillimeters: number;
  thicknessMillimeters: number;
  lines: FlatPatternLine[];
  bends: BendTableRow[];
}

function sampleWire2D(wire: Wire, project: (p: V3) => [number, number]): [number, number][][] {
  const polylines: [number, number][][] = [];
  const edges = wire.edges;
  for (const edge of edges) {
    const geom = edge.geomType;
    const steps = geom === "LINE" ? 1 : 24;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const p = edge.pointAt(i / steps);
      pts.push(project([p.x, p.y, p.z]));
      p.delete();
    }
    polylines.push(pts);
    edge.delete();
  }
  return polylines;
}

/** Resolve a sketch-line reference in 3D world coordinates for fold bend-line projection. */
function resolveFoldLineEndpoints(
  document: PartDocument,
  ref: { sourceFeatureId: string; contourId: string; segmentId: string },
): [V3, V3] | null {
  const source = document.features.find((f) => f.id === ref.sourceFeatureId);
  if (!source || source.type !== "profile" || source.profile.type !== "drawing") return null;
  const contour = source.profile.contours.find((c) => c.id === ref.contourId);
  if (!contour || contour.type !== "path") return null;
  let prev = contour.start;
  let start2: [number, number] | null = null;
  let end2: [number, number] | null = null;
  for (const seg of contour.segments) {
    if (seg.id === ref.segmentId && seg.type === "line") {
      start2 = prev;
      end2 = seg.end;
      break;
    }
    prev = seg.end;
  }
  if (!start2 || !end2) return null;
  const frame = profileFrame({
    plane: source.plane,
    offsetMillimeters: source.offsetMillimeters ?? 0,
    frame: source.frame,
    flip: source.flip,
  });
  const x = unit(frame.xDirection as V3);
  const n = unit(frame.normal as V3);
  const y: V3 = [
    n[1] * x[2] - n[2] * x[1],
    n[2] * x[0] - n[0] * x[2],
    n[0] * x[1] - n[1] * x[0],
  ];
  const o = frame.originMillimeters as V3;
  const map = ([u, v]: [number, number]): V3 => [
    o[0] + x[0] * u + y[0] * v,
    o[1] + x[1] * u + y[1] * v,
    o[2] + x[2] * u + y[2] * v,
  ];
  return [map(start2), map(end2)];
}

/** Non-destructive flat-pattern extraction (`sheet.flat_pattern` + layered `sheet.export_dxf`):
 *  extracts outer perimeter (`OUTLINE`), interior cutouts/holes (`CUT`), and bend centerlines
 *  (`BEND_UP` / `BEND_DOWN`) directly from the unfolded sheet body and its bend features. */
export function extractSheetFlatPattern(
  document: PartDocument,
  bodyId: string,
  flatBody: Shape3D,
  base: SheetMetalRule,
  baseNormal: [number, number, number] = [0, 0, 1],
): FlatPatternResult {
  const bends = sheetBendTable(document, bodyId, base);
  const n = unit(baseNormal);
  const xDir = unit(canonicalPlaneXDirection(n) as V3);
  const up: V3 = [
    n[1] * xDir[2] - n[2] * xDir[1],
    n[2] * xDir[0] - n[0] * xDir[2],
    n[0] * xDir[1] - n[1] * xDir[0],
  ];
  const project = (p: V3): [number, number] => [dot(p, xDir), dot(p, up)];

  const lines: FlatPatternLine[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pushSegment = (layer: FlatPatternLine["layer"], a: [number, number], b: [number, number]) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return;
    minX = Math.min(minX, a[0], b[0]);
    maxX = Math.max(maxX, a[0], b[0]);
    minY = Math.min(minY, a[1], b[1]);
    maxY = Math.max(maxY, a[1], b[1]);
    lines.push({ layer, start: a, end: b });
  };

  // Prefer direct face boundary extraction on the largest planar face parallel to baseNormal
  // so outer perimeter -> OUTLINE and interior holes/perforations -> CUT cleanly.
  const faces = flatBody.faces;
  let mainFace: (typeof faces)[number] | undefined;
  let mainArea = 0;
  for (const f of faces) {
    if (f.geomType === "PLANE") {
      const c = f.center;
      const nv = f.normalAt(c);
      const align = Math.abs(dot(unit([nv.x, nv.y, nv.z]), n));
      c.delete();
      nv.delete();
      if (align > 0.999) {
        const area = measureArea(f);
        if (area > mainArea) {
          mainArea = area;
          mainFace = f;
        }
      }
    }
  }

  if (mainFace) {
    const outer = mainFace.clone().outerWire();
    for (const poly of sampleWire2D(outer, project)) {
      for (let i = 1; i < poly.length; i++) pushSegment("OUTLINE", poly[i - 1], poly[i]);
    }
    outer.delete();
    const inners = mainFace.clone().innerWires();
    for (const hole of inners) {
      for (const poly of sampleWire2D(hole, project)) {
        for (let i = 1; i < poly.length; i++) pushSegment("CUT", poly[i - 1], poly[i]);
      }
      hole.delete();
    }
    faces.forEach((f) => f.delete());
  } else {
    faces.forEach((f) => f.delete());
    const view = projectHiddenLineView(flatBody, {
      viewNormal: baseNormal,
      upDirection: up,
      chordalToleranceMillimeters: 0.05,
    });
    for (const poly of [...view.visible, ...view.visibleOutline]) {
      for (let i = 1; i < poly.length; i++) {
        pushSegment("OUTLINE", [poly[i - 1][0], poly[i - 1][1]], [poly[i][0], poly[i][1]]);
      }
    }
  }

  // Emit BEND_UP / BEND_DOWN centerlines from sheet-flange, sheet-hem, and sheet-fold features.
  const flatBounds2D = [minX, minY, maxX, maxY];
  const emitBendEdge = (layer: "BEND_UP" | "BEND_DOWN", edge: import("../../document/solid-edge-reference").EdgeFinishEdge) => {
    if (edge.kind === "solid-edge") {
      pushSegment(layer, project(edge.anchor.start.positionMillimeters as V3), project(edge.anchor.end.positionMillimeters as V3));
      return;
    }
    if (edge.kind === "curved-edge") {
      // Project midpoint and find the matching straight edge direction along the flat pattern outline (or span along the shorter local axis).
      const m2 = project(edge.midpointMillimeters as V3);
      const half = edge.lengthMillimeters / 2;
      // Match an outline segment direction perpendicular to the offset from flat center.
      const cx = (flatBounds2D[0] + flatBounds2D[2]) / 2;
      const cy = (flatBounds2D[1] + flatBounds2D[3]) / 2;
      const dx = m2[0] - cx, dy = m2[1] - cy;
      const dLen = Math.hypot(dx, dy);
      const dir: [number, number] = dLen > 1e-6 ? [-dy / dLen, dx / dLen] : [0, 1];
      pushSegment(layer, [m2[0] - dir[0] * half, m2[1] - dir[1] * half], [m2[0] + dir[0] * half, m2[1] + dir[1] * half]);
    }
  };
  for (const f of document.features as SheetMetalFeature[]) {
    if (f.suppressed) continue;
    if (f.type === "sheet-flange" || f.type === "sheet-hem") {
      if (f.bodyIds[0] !== bodyId) continue;
      const layer = f.inward ? "BEND_UP" : "BEND_DOWN";
      for (const edge of f.edges) emitBendEdge(layer, edge);
    } else if (f.type === "sheet-fold") {
      if (f.bodyIds[0] !== bodyId) continue;
      const layer = f.inward ? "BEND_UP" : "BEND_DOWN";
      const pts = resolveFoldLineEndpoints(document, f.line);
      if (pts) {
        pushSegment(layer, project(pts[0]), project(pts[1]));
      }
    }
  }

  if (!Number.isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
  return {
    bodyId,
    widthMillimeters: Math.max(0, maxX - minX),
    heightMillimeters: Math.max(0, maxY - minY),
    thicknessMillimeters: base.thicknessMillimeters,
    lines,
    bends,
  };
}

/** Serialize a sheet-metal flat pattern as AutoCAD R2000 ASCII DXF with dedicated layers
 *  (`OUTLINE`, `CUT`, `BEND_UP`, `BEND_DOWN`, `BEND_NOTES`). */
export function sheetFlatPatternToDXF(pattern: FlatPatternResult): string {
  const out: string[] = [
    "0", "SECTION", "2", "HEADER",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LAYER", "70", "5",
    "0", "LAYER", "2", "OUTLINE", "70", "0", "62", "7", "6", "CONTINUOUS",
    "0", "LAYER", "2", "CUT", "70", "0", "62", "3", "6", "CONTINUOUS",
    "0", "LAYER", "2", "BEND_UP", "70", "0", "62", "1", "6", "DASHED",
    "0", "LAYER", "2", "BEND_DOWN", "70", "0", "62", "5", "6", "DASHED",
    "0", "LAYER", "2", "BEND_NOTES", "70", "0", "62", "2", "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
  ];
  for (const seg of pattern.lines) {
    out.push(
      "0", "LINE",
      "8", seg.layer,
      "10", seg.start[0].toFixed(6),
      "20", seg.start[1].toFixed(6),
      "30", "0.0",
      "11", seg.end[0].toFixed(6),
      "21", seg.end[1].toFixed(6),
      "31", "0.0",
    );
  }
  pattern.bends.forEach((b, idx) => {
    const label = `${b.name}: ${b.direction.toUpperCase()} ${b.angle_deg.toFixed(1)} deg R${b.inner_radius_mm.toFixed(2)} BA=${b.bend_allowance_mm.toFixed(2)}`;
    out.push(
      "0", "TEXT",
      "8", "BEND_NOTES",
      "10", "0.0",
      "20", (-10 - idx * 6).toFixed(3),
      "30", "0.0",
      "40", "3.5",
      "1", label,
    );
  });
  out.push("0", "ENDSEC", "0", "EOF", "");
  return out.join("\n");
}
