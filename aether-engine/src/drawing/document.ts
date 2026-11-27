import { dimensionChainAnnotations, type DimensionChain } from './dimension-chain';
import { validatePartDocument, type PartDocument } from "../document/part-document";
import { gdtCharacteristicCodes, type GdtCharacteristic } from "./standards-annotations";

export type DrawingPoint = [number, number];
export type DrawingOrientation = "front" | "back" | "top" | "bottom" | "left" | "right" | "isometric";
export const drawingOrientations: readonly DrawingOrientation[] = ["front", "back", "top", "bottom", "left", "right", "isometric"];

export interface DrawingRevisionEntry {
  rev: string;
  description: string;
  date: string;
  author?: string;
}

/** Optional tolerances & `{value}` display override supported on drawing dimensions (Format version 6). */
export interface DrawingDimensionOverrides {
  toleranceUpperMm?: number;
  toleranceLowerMm?: number;
  overrideText?: string;
}

/** A storage locator, interpreted by the app transport only. Geometry always
 * rebuilds from the embedded snapshot, including when this source is offline. */
export interface DrawingSourceReference {
  fileId: string;
  partId?: string;
  branch?: string;
  revision?: number;
}

/** Authoring intent only. Projected edges are disposable and never saved as truth.
 * The embedded Part snapshot makes a local drawing reproducible without Studio.
 * Refresh explicitly replaces that snapshot with the same document's new revision. */
export interface DrawingDocument {
  format: "aether-drawing";
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6;
  documentId: string;
  name: string;
  source: PartDocument;
  sourceReference?: DrawingSourceReference;
  activeSheetId: string;
  sheets: DrawingSheet[];
}
export interface DrawingSheet {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  projection: "first_angle" | "third_angle";
  views: DrawingView[];
  annotations: DrawingAnnotation[];
  /** Editable title-block rows printed beside the fixed title and units. Format version 4. */
  titleBlock?: { label: string; value: string }[];
  /** A parts list (BOM table) of the source's parts at `originMm` (top-left, sheet mm): item, part,
   *  quantity, material; rows come from the source on every build. Format version 4. */
  partsList?: { originMm: DrawingPoint; widthMm?: number };
  /** Revision history entries for the sheet. Format version 6. */
  revisions?: DrawingRevisionEntry[];
  /** Placed revision table origin & width (mm). Format version 6. */
  revisionTable?: { originMm: DrawingPoint; widthMm?: number };
}
export type DrawingDirection = [number, number, number];
export interface DrawingDetail {
  /** The view this detail enlarges; its circle is authored in that view's sheet mm. */
  parentId: string;
  centerMm: DrawingPoint;
  radiusMm: number;
  /** Marker letter printed beside the circle on the parent, e.g. "A". */
  label: string;
}
export interface DrawingSection {
  /** World X (left/right), Y (front/back), or Z (top/bottom), in model mm.
   * Material nearest the viewer is removed. */
  offsetMm: number;
  /** Spacing on paper, independent of model scale. Defaults to 2 mm. */
  hatchSpacingMm?: number;
}
export interface DrawingView {
  id: string;
  name: string;
  orientation: DrawingOrientation;
  originMm: DrawingPoint;
  scale: number;
  hiddenLines: boolean;
  /** A projected view inherits its parent's scale and aligned coordinate. */
  parentId?: string;
  bodyIds?: string[];
  section?: DrawingSection | null;
  /** Auxiliary view: model-space direction toward the viewer; replaces the orientation frame. Format version 4. */
  direction?: DrawingDirection | null;
  /** Detail view: an enlarged circular region of another view on the sheet. Format version 4. */
  detail?: DrawingDetail | null;
  /** Sheet metal flat-pattern view with bend lines. Format version 6. */
  flatPattern?: boolean;
}
export type DrawingAnnotation = {
  id: string;
  positionMm: DrawingPoint;
} & ({ kind: "note"; text: string } | ({
  /** Overall dimensions reference the view's exact projected extents, not mesh
   * vertices or transient HLR edge indices. Values regenerate on every rebuild. */
  kind: "width" | "height";
  viewId: string;
  decimals: number;
} & DrawingDimensionOverrides) | ({
  /** Attached to the visible circle or arc nearest `atMm` (sheet mm) when the view
   * is rebuilt, so the reference survives edge renumbering. Format version 3. */
  kind: "diameter" | "radius";
  viewId: string;
  decimals: number;
  atMm: DrawingPoint;
} & DrawingDimensionOverrides) | ({
  /** The model length of the visible straight edge nearest `atMm`; the dimension line
   * runs parallel to the edge through the label. Format version 4. */
  kind: "length";
  viewId: string;
  decimals: number;
  atMm: DrawingPoint;
} & DrawingDimensionOverrides) | ({
  /** The angle between the visible straight edges nearest `atMm` and `toMm`,
   * measured in the sector that contains those two points. Format version 3. */
  kind: "angle";
  viewId: string;
  decimals: number;
  atMm: DrawingPoint;
  toMm: DrawingPoint;
} & DrawingDimensionOverrides) | ({
  /** Native projected endpoints or circle centres, selected by sheet-space picks.
   * Point-distance uses two points; point-angle uses endpoint, vertex, endpoint. */
  kind: "point-distance" | "point-angle";
  viewId: string;
  decimals: number;
  pointsMm: DrawingPoint[];
  axis?: "x" | "y";
} & DrawingDimensionOverrides) | {
  /** Circled item text with a leader to `leaderMm`. Format version 4. */
  kind: "balloon";
  text: string;
  leaderMm: DrawingPoint;
} | {
  /** Centre lines through the circle or arc nearest `atMm`. Format version 4. */
  kind: "center-mark";
  viewId: string;
  atMm: DrawingPoint;
} | ({
  /** Ordinate X or Y dimension from a datum point in sheet mm. Format version 6. */
  kind: "ordinate";
  viewId: string;
  axis: "x" | "y";
  datumMm: DrawingPoint;
  targetMm: DrawingPoint;
  decimals: number;
} & DrawingDimensionOverrides) | {
  /** Dashed ISO 128 centerline between two sheet points. Format version 6. */
  kind: "centerline";
  viewId: string;
  startMm: DrawingPoint;
  endMm: DrawingPoint;
} | {
  /** Leader note supporting `{{name}}`, `{{sheet}}`, `{{projection}}` dynamic fields. Format version 6. */
  kind: "leader-note";
  text: string;
  leaderPointsMm: DrawingPoint[];
  viewId?: string;
} | {
  /** Hole callout attached to the circle/arc nearest `atMm`. Format version 6. */
  kind: "hole-callout";
  viewId: string;
  atMm: DrawingPoint;
  decimals: number;
  text?: string;
} | {
  /** Chamfer callout with leader arrow. Format version 6. */
  kind: "chamfer-note";
  viewId: string;
  atMm: DrawingPoint;
  text: string;
} | {
  /** GD&T Feature Control Frame. Format version 6. */
  kind: "gdt";
  characteristic: GdtCharacteristic;
  tolerance: string;
  datums?: string[];
  leaderMm?: DrawingPoint;
  viewId?: string;
} | {
  /** Datum Feature Symbol. Format version 6. */
  kind: "datum";
  label: string;
  leaderMm: DrawingPoint;
  viewId?: string;
} | {
  /** ISO 1302 Surface Texture / Roughness symbol. Format version 6. */
  kind: "surface-texture";
  ra: string;
  process?: "machined" | "unmachined" | "any";
  leaderMm?: DrawingPoint;
  viewId?: string;
} | {
  /** Weld Symbol. Format version 6. */
  kind: "weld-symbol";
  weldType: "fillet" | "butt" | "groove" | "plug" | "spot";
  size?: string;
  allAround?: boolean;
  leaderMm: DrawingPoint;
  viewId?: string;
} | {
  /** Triangular Revision Callout Tag. Format version 6. */
  kind: "revision-tag";
  revision: string;
});
export const drawingDimensionKinds = ["width", "height", "diameter", "radius", "angle", "length", "point-distance", "point-angle"] as const;
const drawingV6AnnotationKinds = ["ordinate", "centerline", "leader-note", "hole-callout", "chamfer-note", "gdt", "datum", "surface-texture", "weld-symbol", "revision-tag"] as const;

export type DrawingCommand =
  | { type: "add-sheet"; sheet: DrawingSheet }
  | { type: "select-sheet"; sheetId: string }
  | { type: "remove-sheet"; sheetId: string }
  | { type: "reorder-sheets"; sheetIds: string[] }
  | { type: "update-sheet"; sheetId: string; name?: string; widthMm?: number; heightMm?: number; projection?: DrawingSheet["projection"]; titleBlock?: DrawingSheet["titleBlock"]; partsList?: DrawingSheet["partsList"] | null; revisions?: DrawingRevisionEntry[] | null; revisionTable?: DrawingSheet["revisionTable"] | null }
  | { type: "add-view"; sheetId: string; view: DrawingView }
  | { type: "update-view"; sheetId: string; viewId: string; changes: Partial<Omit<DrawingView, "id">> }
  | { type: "remove-view"; sheetId: string; viewId: string }
  | { type: "add-dimension-chain"; sheetId: string; chain: DimensionChain }
  | { type: "add-annotation"; sheetId: string; annotation: DrawingAnnotation }
  | { type: "update-annotation"; sheetId: string; annotation: DrawingAnnotation }
  | { type: "remove-annotation"; sheetId: string; annotationId: string }
  | { type: "refresh-source"; source: PartDocument };

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected a drawing object.");
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw Error("Drawing names and IDs must contain 1–1000 characters.");
}
function number(value: unknown, min: number, max: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw Error(`Drawing value must be between ${min} and ${max}.`);
}
function point(value: unknown): asserts value is DrawingPoint {
  if (!Array.isArray(value) || value.length !== 2) throw Error("Drawing positions need two millimeter coordinates.");
  value.forEach(v => number(v, -100000, 100000));
}
function list(value: unknown, limit: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw Error(`Drawing list exceeds ${limit} entries or is not an array.`);
}
function direction(value: unknown): asserts value is DrawingDirection {
  if (!Array.isArray(value) || value.length !== 3) throw Error("A view direction needs three model coordinates.");
  value.forEach(v => number(v, -1e6, 1e6));
  if (Math.hypot(...(value as number[])) < 1e-9) throw Error("A view direction cannot be zero.");
}
function atLeast(value: unknown, version: number, what: string): void {
  if ((value as number) < version) throw Error(`${what} require Drawing format version ${version}.`);
}

export function validateDrawingDocument(value: unknown): asserts value is DrawingDocument {
  object(value);
  if (value.format !== "aether-drawing" || ![1, 2, 3, 4, 5, 6].includes(value.formatVersion as number)) throw Error("Unsupported Drawing file format or version.");
  text(value.documentId); text(value.name); text(value.activeSheetId);
  validatePartDocument(value.source);
  if (value.sourceReference !== undefined) {
    const ref = value.sourceReference; object(ref); text(ref.fileId);
    if (Object.keys(ref).some(key => !["fileId", "partId", "branch", "revision"].includes(key))) throw Error("Unknown drawing source reference field.");
    if (ref.partId !== undefined) text(ref.partId);
    if (ref.branch !== undefined) text(ref.branch);
    if (ref.revision !== undefined) { number(ref.revision, 1, Number.MAX_SAFE_INTEGER); if (!Number.isSafeInteger(ref.revision)) throw Error("Source revision must be an integer."); }
  }
  list(value.sheets, 100);
  const ids = new Set<string>();
  let totalViews = 0;
  const id = (value: unknown) => { text(value); if (ids.has(value)) throw Error(`Duplicate drawing ID: ${value}`); ids.add(value); };
  id(value.documentId);
  for (const sheet of value.sheets) {
    object(sheet); id(sheet.id); text(sheet.name);
    number(sheet.widthMm, 25, 2000); number(sheet.heightMm, 25, 2000);
    if (!["first_angle", "third_angle"].includes(sheet.projection as string)) throw Error("Choose first-angle or third-angle projection.");
    list(sheet.views, 100); list(sheet.annotations, 1000);
    if (sheet.titleBlock !== undefined) {
      atLeast(value.formatVersion, 4, "Title-block fields");
      list(sheet.titleBlock, 12);
      for (const row of sheet.titleBlock) { object(row); text(row.label); if (typeof row.value !== "string" || row.value.length > 200) throw Error("Title-block values are strings of at most 200 characters."); if (Object.keys(row).length !== 2) throw Error("Title-block rows have a label and a value only."); }
    }
    if (sheet.partsList !== undefined) {
      atLeast(value.formatVersion, 4, "Parts lists");
      object(sheet.partsList); point(sheet.partsList.originMm);
      if (sheet.partsList.widthMm !== undefined) number(sheet.partsList.widthMm, 40, 400);
      if (Object.keys(sheet.partsList).some(key => !["originMm", "widthMm"].includes(key))) throw Error("Unknown parts-list field.");
    }
    if (sheet.revisions !== undefined) {
      atLeast(value.formatVersion, 6, "Revision tables");
      list(sheet.revisions, 100);
      for (const row of sheet.revisions) {
        object(row); text(row.rev); text(row.description); text(row.date);
        if (row.author !== undefined && (typeof row.author !== "string" || row.author.length > 200)) throw Error("Revision author must be a string.");
      }
    }
    if (sheet.revisionTable !== undefined) {
      atLeast(value.formatVersion, 6, "Revision tables");
      object(sheet.revisionTable); point(sheet.revisionTable.originMm);
      if (sheet.revisionTable.widthMm !== undefined) number(sheet.revisionTable.widthMm, 40, 400);
      if (Object.keys(sheet.revisionTable).some(key => !["originMm", "widthMm"].includes(key))) throw Error("Unknown revision-table field.");
    }
    totalViews += sheet.views.length;
    if (totalViews > 100) throw Error("A drawing supports at most 100 views across its sheets.");
    const views = new Map<string, DrawingView>();
    for (const view of sheet.views) {
      object(view); id(view.id); text(view.name); point(view.originMm); number(view.scale, 0.001, 1000);
      if (!drawingOrientations.includes(view.orientation as DrawingOrientation)) throw Error("Unknown drawing view orientation.");
      if (typeof view.hiddenLines !== "boolean") throw Error("Hidden-line visibility must be a boolean.");
      if (view.parentId !== undefined) text(view.parentId);
      if (view.bodyIds !== undefined) { list(view.bodyIds, 500); view.bodyIds.forEach(text); if (!view.bodyIds.length || new Set(view.bodyIds).size !== view.bodyIds.length) throw Error("Choose distinct drawing bodies."); }
      if (view.direction != null) {
        atLeast(value.formatVersion, 4, "Auxiliary views");
        direction(view.direction);
        if (view.parentId || view.section != null || view.detail != null) throw Error("An auxiliary view is an independent view without a section.");
      }
      if (view.detail != null) {
        atLeast(value.formatVersion, 4, "Detail views");
        object(view.detail);
        if (Object.keys(view.detail).some(key => !["parentId", "centerMm", "radiusMm", "label"].includes(key))) throw Error("Unknown detail property.");
        text(view.detail.parentId); point(view.detail.centerMm); number(view.detail.radiusMm, 1, 1000); text(view.detail.label);
        if (view.parentId || view.section != null) throw Error("A detail view enlarges another view; it has no projection parent or section of its own.");
      }
      if (view.section != null) {
        atLeast(value.formatVersion, 2, "Section views");
        object(view.section);
        if (Object.keys(view.section).some(key => !["offsetMm", "hatchSpacingMm"].includes(key))) throw Error("Unknown section property.");
        number(view.section.offsetMm, -100000, 100000);
        if (view.section.hatchSpacingMm !== undefined) number(view.section.hatchSpacingMm, 0.5, 10);
        if (view.orientation === "isometric" || view.parentId) throw Error("A section requires an independent principal view.");
      }
      if (view.flatPattern !== undefined) {
        if (typeof view.flatPattern !== "boolean") throw Error("Flat-pattern flag must be boolean.");
        if (view.flatPattern) {
          atLeast(value.formatVersion, 6, "Flat-pattern views");
          if (view.parentId || view.section != null || view.detail != null || view.direction != null) {
            throw Error("A flat-pattern view must be an independent base view.");
          }
        }
      }
      views.set(view.id as string, view as unknown as DrawingView);
    }
    for (const view of views.values()) if (view.detail) {
      const parent = views.get(view.detail.parentId);
      if (!parent || parent.detail) throw Error("A detail view must reference a non-detail view on the same sheet.");
    }
    for (const view of views.values()) if (view.parentId) {
      const parent = views.get(view.parentId);
      if (!parent || parent.parentId || parent.section || parent.orientation !== "front" || !["top", "bottom", "left", "right"].includes(view.orientation)) {
        throw Error("A projected view must reference a base front view on the same sheet.");
      }
    }
    for (const annotation of sheet.annotations) {
      object(annotation); id(annotation.id); point(annotation.positionMm);
      if (annotation.kind === "note") text(annotation.text);
      else if (annotation.kind === "balloon") { atLeast(value.formatVersion, 4, "Balloons"); text(annotation.text); point(annotation.leaderMm); }
      else if (annotation.kind === "center-mark") {
        atLeast(value.formatVersion, 4, "Centre marks");
        text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The centre mark's view does not exist."); point(annotation.atMm);
      }
      else if (drawingDimensionKinds.includes(annotation.kind as never)) {
        text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The dimension's view does not exist.");
        number(annotation.decimals, 0, 6); if (!Number.isInteger(annotation.decimals)) throw Error("Dimension precision must be an integer.");
        if (annotation.toleranceUpperMm !== undefined || annotation.toleranceLowerMm !== undefined || annotation.overrideText !== undefined) {
          atLeast(value.formatVersion, 6, "Dimension tolerances and overrides");
          if (annotation.toleranceUpperMm !== undefined) number(annotation.toleranceUpperMm, -1000, 1000);
          if (annotation.toleranceLowerMm !== undefined) number(annotation.toleranceLowerMm, -1000, 1000);
          if (annotation.overrideText !== undefined) text(annotation.overrideText);
        }
        if (annotation.kind === "point-distance" || annotation.kind === "point-angle") {
          atLeast(value.formatVersion, 5, "Point dimensions");
          list(annotation.pointsMm, 3);
          if (annotation.pointsMm.length !== (annotation.kind === "point-angle" ? 3 : 2)) throw Error("Choose two distance points or three angle points.");
          annotation.pointsMm.forEach(point);
          if (annotation.axis !== undefined && (annotation.kind === "point-angle" || !["x", "y"].includes(annotation.axis as string))) throw Error("Point distance axis must be x or y; point angles have no axis.");
        }
        else if (annotation.kind === "length") { atLeast(value.formatVersion, 4, "Edge length dimensions"); point(annotation.atMm); }
        else if (annotation.kind === "diameter" || annotation.kind === "radius" || annotation.kind === "angle") {
          atLeast(value.formatVersion, 3, "Diameter, radius and angle dimensions");
          point(annotation.atMm);
          if (annotation.kind === "angle") point(annotation.toMm);
        }
      } else if (annotation.kind === "ordinate") {
        atLeast(value.formatVersion, 6, "Ordinate dimensions");
        text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The ordinate dimension's view does not exist.");
        if (!["x", "y"].includes(annotation.axis as string)) throw Error("Ordinate axis must be x or y.");
        point(annotation.datumMm); point(annotation.targetMm);
        number(annotation.decimals, 0, 6); if (!Number.isInteger(annotation.decimals)) throw Error("Dimension precision must be an integer.");
        if (annotation.toleranceUpperMm !== undefined) number(annotation.toleranceUpperMm, -1000, 1000);
        if (annotation.toleranceLowerMm !== undefined) number(annotation.toleranceLowerMm, -1000, 1000);
        if (annotation.overrideText !== undefined) text(annotation.overrideText);
      } else if (annotation.kind === "centerline") {
        atLeast(value.formatVersion, 6, "Centerlines");
        text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The centerline's view does not exist.");
        point(annotation.startMm); point(annotation.endMm);
      } else if (annotation.kind === "leader-note") {
        atLeast(value.formatVersion, 6, "Leader notes");
        text(annotation.text);
        list(annotation.leaderPointsMm, 16);
        if (!annotation.leaderPointsMm.length) throw Error("Leader notes require at least one leader point.");
        annotation.leaderPointsMm.forEach(point);
        if (annotation.viewId !== undefined) { text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The leader note's view does not exist."); }
      } else if (annotation.kind === "hole-callout") {
        atLeast(value.formatVersion, 6, "Hole callouts");
        text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The hole callout's view does not exist.");
        point(annotation.atMm); number(annotation.decimals, 0, 6); if (!Number.isInteger(annotation.decimals)) throw Error("Hole callout precision must be an integer.");
        if (annotation.text !== undefined) text(annotation.text);
      } else if (annotation.kind === "chamfer-note") {
        atLeast(value.formatVersion, 6, "Chamfer notes");
        text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The chamfer note's view does not exist.");
        point(annotation.atMm); text(annotation.text);
      } else if (annotation.kind === "gdt") {
        atLeast(value.formatVersion, 6, "GD&T feature control frames");
        if (typeof annotation.characteristic !== "string" || !(annotation.characteristic in gdtCharacteristicCodes)) throw Error("Unknown GD&T characteristic.");
        text(annotation.tolerance);
        if (annotation.datums !== undefined) { list(annotation.datums, 6); annotation.datums.forEach(text); }
        if (annotation.leaderMm !== undefined) point(annotation.leaderMm);
        if (annotation.viewId !== undefined) { text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The GD&T frame's view does not exist."); }
      } else if (annotation.kind === "datum") {
        atLeast(value.formatVersion, 6, "Datum symbols");
        text(annotation.label); point(annotation.leaderMm);
        if (annotation.viewId !== undefined) { text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The datum's view does not exist."); }
      } else if (annotation.kind === "surface-texture") {
        atLeast(value.formatVersion, 6, "Surface texture symbols");
        text(annotation.ra);
        if (annotation.process !== undefined && !["machined", "unmachined", "any"].includes(annotation.process as string)) throw Error("Unknown surface texture process.");
        if (annotation.leaderMm !== undefined) point(annotation.leaderMm);
        if (annotation.viewId !== undefined) { text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The surface texture's view does not exist."); }
      } else if (annotation.kind === "weld-symbol") {
        atLeast(value.formatVersion, 6, "Weld symbols");
        if (!["fillet", "butt", "groove", "plug", "spot"].includes(annotation.weldType as string)) throw Error("Unknown weld symbol type.");
        if (annotation.size !== undefined) text(annotation.size);
        if (annotation.allAround !== undefined && typeof annotation.allAround !== "boolean") throw Error("Weld allAround must be boolean.");
        point(annotation.leaderMm);
        if (annotation.viewId !== undefined) { text(annotation.viewId); if (!views.has(annotation.viewId)) throw Error("The weld symbol's view does not exist."); }
      } else if (annotation.kind === "revision-tag") {
        atLeast(value.formatVersion, 6, "Revision tags");
        text(annotation.revision);
      } else throw Error("Unsupported drawing annotation.");
    }
  }
  if (!value.sheets.some(s => (s as DrawingSheet).id === value.activeSheetId)) throw Error("The active drawing sheet does not exist.");
}

export function createDrawingDocument(source: PartDocument, id: string = crypto.randomUUID()): DrawingDocument {
  const doc: DrawingDocument = {
    format: "aether-drawing", formatVersion: 1, documentId: id, name: `${source.name} Drawing`, source: structuredClone(source), activeSheetId: `${id}/sheet1`,
    sheets: [{ id: `${id}/sheet1`, name: "Sheet 1", widthMm: 297, heightMm: 210, projection: "third_angle", views: [], annotations: [] }],
  };
  validateDrawingDocument(doc);
  return doc;
}
export function serializeDrawingDocument(doc: DrawingDocument): string { validateDrawingDocument(doc); return JSON.stringify(doc, null, 2); }
export function parseDrawingDocument(source: string): DrawingDocument {
  if (source.length > 32 * 1024 * 1024) throw Error("Drawing file exceeds 32 MiB.");
  const doc: unknown = JSON.parse(source); validateDrawingDocument(doc); return doc;
}
export function applyDrawingCommand(source: DrawingDocument, command: DrawingCommand): DrawingDocument {
  validateDrawingDocument(source);
  const doc = structuredClone(source);
  if (command.type === "refresh-source") {
    if (command.source.documentId !== doc.source.documentId) throw Error("Refresh requires the same source Part document.");
    doc.source = structuredClone(command.source);
  } else if (command.type === "add-sheet") {
    doc.sheets.push(structuredClone(command.sheet)); doc.activeSheetId = command.sheet.id;
  } else if (command.type === "reorder-sheets") {
    if (command.sheetIds.length !== doc.sheets.length || new Set(command.sheetIds).size !== command.sheetIds.length)
      throw Error("Provide every existing sheet ID once to reorder sheets.");
    const byId = new Map(doc.sheets.map(s => [s.id, s]));
    doc.sheets = command.sheetIds.map(id => {
      const found = byId.get(id);
      if (!found) throw Error(`Unknown sheet ID "${id}".`);
      return found;
    });
  } else {
    const sheet = doc.sheets.find(s => s.id === command.sheetId);
    if (!sheet) throw Error("Drawing sheet does not exist.");
    switch (command.type) {
      case "select-sheet": doc.activeSheetId = sheet.id; break;
      case "remove-sheet": {
        if (doc.sheets.length === 1) throw Error("Keep at least one drawing sheet.");
        doc.sheets = doc.sheets.filter(s => s.id !== sheet.id);
        if (doc.activeSheetId === sheet.id) doc.activeSheetId = doc.sheets[0].id;
        break;
      }
      case "update-sheet":
        for (const key of ["name", "widthMm", "heightMm", "projection", "titleBlock"] as const) if (command[key] !== undefined) Object.assign(sheet, { [key]: command[key] });
        if (command.partsList === null) delete sheet.partsList; else if (command.partsList !== undefined) sheet.partsList = command.partsList;
        if (command.revisions === null) delete sheet.revisions; else if (command.revisions !== undefined) sheet.revisions = structuredClone(command.revisions);
        if (command.revisionTable === null) delete sheet.revisionTable; else if (command.revisionTable !== undefined) sheet.revisionTable = structuredClone(command.revisionTable);
        break;
      case "add-view": sheet.views.push(structuredClone(command.view)); break;
      case "update-view": {
        const view = sheet.views.find(v => v.id === command.viewId); if (!view) throw Error("Drawing view does not exist.");
        if (Object.keys(command.changes).some(key => !["name", "orientation", "originMm", "scale", "hiddenLines", "parentId", "bodyIds", "section", "direction", "detail", "flatPattern"].includes(key))) throw Error("Unknown drawing view property.");
        Object.assign(view, structuredClone(command.changes)); break;
      }
      case "remove-view": {
        if (!sheet.views.some(v => v.id === command.viewId)) throw Error("Drawing view does not exist.");
        if (sheet.views.some(v => v.parentId === command.viewId || v.detail?.parentId === command.viewId) || sheet.annotations.some(a => "viewId" in a && a.viewId === command.viewId)) throw Error("Remove dependent views and dimensions first.");
        sheet.views = sheet.views.filter(v => v.id !== command.viewId); break;
      }
      case "add-dimension-chain": sheet.annotations.push(...structuredClone(dimensionChainAnnotations(command.chain))); break;
      case "add-annotation": sheet.annotations.push(structuredClone(command.annotation)); break;
      case "update-annotation": {
        const index = sheet.annotations.findIndex(a => a.id === command.annotation.id);
        if (index < 0) throw Error("Drawing annotation does not exist.");
        sheet.annotations[index] = structuredClone(command.annotation); break;
      }
      case "remove-annotation": {
        if (!sheet.annotations.some(a => a.id === command.annotationId)) throw Error("Drawing annotation does not exist.");
        sheet.annotations = sheet.annotations.filter(a => a.id !== command.annotationId); break;
      }
      default: throw Error("Unknown drawing command.");
    }
  }
  // Each feature pins the lowest version that can hold it; older readers refuse newer files.
  const previousVersion = doc.formatVersion;
  const usesV6 = doc.sheets.some(sheet =>
    sheet.revisions !== undefined || sheet.revisionTable !== undefined ||
    sheet.views.some(view => view.flatPattern === true) ||
    sheet.annotations.some(annotation =>
      (drawingV6AnnotationKinds as readonly string[]).includes(annotation.kind) ||
      ("toleranceUpperMm" in annotation && annotation.toleranceUpperMm !== undefined) ||
      ("toleranceLowerMm" in annotation && annotation.toleranceLowerMm !== undefined) ||
      ("overrideText" in annotation && annotation.overrideText !== undefined),
    ),
  );
  if (usesV6) doc.formatVersion = 6;
  else if (doc.sheets.some(sheet => sheet.annotations.some(annotation => annotation.kind === "point-distance" || annotation.kind === "point-angle"))) doc.formatVersion = 5;
  else if (doc.sheets.some(sheet => sheet.titleBlock || sheet.partsList || sheet.views.some(view => view.direction || view.detail) || sheet.annotations.some(annotation => annotation.kind === "balloon" || annotation.kind === "center-mark" || annotation.kind === "length"))) doc.formatVersion = 4;
  else if (doc.sheets.some(sheet => sheet.annotations.some(annotation => annotation.kind === "diameter" || annotation.kind === "radius" || annotation.kind === "angle"))) doc.formatVersion = 3;
  else if (doc.sheets.some(sheet => sheet.views.some(view => view.section))) doc.formatVersion = 2;
  doc.formatVersion = Math.max(previousVersion, doc.formatVersion) as DrawingDocument["formatVersion"];
  validateDrawingDocument(doc);
  return doc;
}

/** Alignment and handedness follow the selected engineering projection standard. */
export function resolvedDrawingView(sheet: DrawingSheet, view: DrawingView): DrawingView {
  if (view.detail) {
    // A detail shows the same projection as its parent at its own scale and position.
    const parent = resolvedDrawingView(sheet, sheet.views.find(v => v.id === view.detail!.parentId)!);
    return { ...view, orientation: parent.orientation, bodyIds: parent.bodyIds, section: parent.section, direction: parent.direction };
  }
  if (!view.parentId) return view;
  const parent = sheet.views.find(v => v.id === view.parentId)!;
  const vertical = view.orientation === "top" || view.orientation === "bottom";
  const negative = view.orientation === "top" || view.orientation === "left";
  const sign = (negative ? -1 : 1) * (sheet.projection === "third_angle" ? 1 : -1);
  const distance = Math.max(10, Math.abs(view.originMm[vertical ? 1 : 0] - parent.originMm[vertical ? 1 : 0]));
  return { ...view, scale: parent.scale, bodyIds: parent.bodyIds,
    originMm: vertical ? [parent.originMm[0], parent.originMm[1] + sign * distance] : [parent.originMm[0] + sign * distance, parent.originMm[1]] };
}
