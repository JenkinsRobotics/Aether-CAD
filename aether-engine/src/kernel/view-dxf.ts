/** Current-View 3D-to-2D DXF Export (SolidCraft's `file.export_view_dxf`):
 *  projects visible Part bodies from any arbitrary camera direction using exact OCCT HLR
 *  into layered AutoCAD R2000 ASCII DXF (`VISIBLE`, `HIDDEN`, `SKETCH`). */
import { makeCompound, type AnyShape, type Shape3D } from "replicad";
import type { PartDocument } from "../document/part-document";
import { evaluatePartDocument } from "./part-evaluator";
import { projectHiddenLineView } from "./hidden-line";

export interface CurrentViewDXFOptions {
  /** Unit direction from target toward camera (view normal). Default isometric [1, -1, 1]. */
  viewNormal?: [number, number, number];
  /** Camera up direction. */
  upDirection?: [number, number, number];
  /** Hidden edge handling: omit or dashed on HIDDEN layer. Default "dashed". */
  hiddenEdges?: "omit" | "dashed";
  /** Origin placement: "origin" keeps projected world origin, "center" centers bounding box at (0,0). */
  zero?: "origin" | "center";
  /** Optional subset of body IDs to project. */
  bodyIds?: string[];
  chordalToleranceMillimeters?: number;
}

export interface CurrentViewDXFResult {
  dxf: string;
  visibleSegments: number;
  hiddenSegments: number;
  bodyCount: number;
}

export function exportCurrentViewDXF(
  document: PartDocument,
  options: CurrentViewDXFOptions = {},
): CurrentViewDXFResult {
  let shapes = new Map<string, Shape3D>();
  evaluatePartDocument(document, { withBodies: (bodies) => { shapes = new Map(bodies); } });
  const ids = options.bodyIds ?? null;
  if (ids !== null && (!ids.length || ids.some((id) => !shapes.has(id)))) {
    throw new Error("A requested body for current-view DXF export is unavailable.");
  }
  const selected = [...shapes].filter(([id]) => ids === null || ids.includes(id)).map(([, s]) => s);
  if (!selected.length) throw new Error("Create or import solid geometry before exporting a view DXF.");

  const whole: AnyShape = selected.length === 1 ? selected[0] : makeCompound(selected.map((s) => s.clone()));
  let hlr;
  try {
    hlr = projectHiddenLineView(whole, {
      viewNormal: options.viewNormal ?? [1, -1, 1],
      upDirection: options.upDirection,
      chordalToleranceMillimeters: options.chordalToleranceMillimeters ?? 0.05,
    });
  } finally {
    if (whole !== selected[0]) whole.delete();
  }

  const visiblePolys = [...hlr.visible, ...hlr.visibleOutline];
  const hiddenPolys = options.hiddenEdges === "omit" ? [] : [...hlr.hidden, ...hlr.hiddenOutline];

  let ox = 0, oy = 0;
  if (options.zero === "center") {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const poly of [...visiblePolys, ...hiddenPolys]) {
      for (const [x, y] of poly) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (Number.isFinite(minX)) {
      ox = (minX + maxX) / 2;
      oy = (minY + maxY) / 2;
    }
  }

  const out: string[] = [
    "0", "SECTION", "2", "HEADER",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LTYPE", "70", "2",
    "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
    "0", "LTYPE", "2", "DASHED", "70", "0", "3", "Dashed", "72", "65", "73", "2", "40", "6.0", "49", "4.0", "49", "-2.0",
    "0", "ENDTAB",
    "0", "TABLE", "2", "LAYER", "70", "3",
    "0", "LAYER", "2", "VISIBLE", "70", "0", "62", "7", "6", "CONTINUOUS",
    "0", "LAYER", "2", "HIDDEN", "70", "0", "62", "8", "6", "DASHED",
    "0", "LAYER", "2", "SKETCH", "70", "0", "62", "5", "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
  ];

  let visibleSegments = 0;
  let hiddenSegments = 0;
  const emit = (polys: readonly (readonly (readonly [number, number])[])[], layer: "VISIBLE" | "HIDDEN") => {
    for (const poly of polys) {
      for (let i = 1; i < poly.length; i++) {
        const x1 = poly[i - 1][0] - ox, y1 = poly[i - 1][1] - oy;
        const x2 = poly[i][0] - ox, y2 = poly[i][1] - oy;
        if (Math.hypot(x2 - x1, y2 - y1) < 1e-7) continue;
        out.push(
          "0", "LINE",
          "8", layer,
          "10", x1.toFixed(6), "20", y1.toFixed(6), "30", "0.0",
          "11", x2.toFixed(6), "21", y2.toFixed(6), "31", "0.0",
        );
        if (layer === "VISIBLE") visibleSegments++;
        else hiddenSegments++;
      }
    }
  };
  emit(visiblePolys, "VISIBLE");
  emit(hiddenPolys, "HIDDEN");
  out.push("0", "ENDSEC", "0", "EOF", "");

  return { dxf: out.join("\n"), visibleSegments, hiddenSegments, bodyCount: selected.length };
}
