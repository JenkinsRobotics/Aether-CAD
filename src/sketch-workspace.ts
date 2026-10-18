import { isRectanglePlacement, squareCorner } from "./sketch/rectangle-placement";
import { sketchRegions } from "./freecad-translate";
import { mountVectorPanel } from "./sketch/vector-panel";
import { mountAnnotationSelection } from "./sketch/annotation-selection";
import { mountSketchCoordinates } from "./sketch/coordinate-controls";
import { mountSketchHistoryActions } from "./sketch/history-actions";
import { createSketchToolWindow } from "./sketch/tool-window";
import { constraintDisplayState } from "./sketch/constraint-display-state";
import { mountSketchSelectionActions } from "./sketch/selection-actions";
import { bindSketchBoxSelection } from "./sketch/box-selection";
import { mountDimensionTool } from "./sketch/dimension-tool";
import { mountEditHistory } from "./modeling/edit-history";
import { errorsForDocument } from "./modeling/feature-errors";
import { mountSketchWindowFields } from "./sketch/window-fields";
import { addFeatureViewControls } from "./features/view-controls";
import { addSketchNormalControl } from "./modeling/sketch-normal-control";
import { pickSketchRegion } from "./sketch/picking";
import { sketchFaceRegions } from '../freecad-engine/browser/connected-sketch-regions';
import { shortcuts } from "./shortcuts";
import { setPickedSketchRegion } from "./sketch-region-selection";
import { mountSketchClipboard } from "./sketch/clipboard";
import { mountSketchVariables } from "./sketch/variables";
import { mountTextPanel } from "./sketch/text-panel";
import { bindDimensionLabelUnits } from "./sketch/dimension-label-units";
import { snapSemicircle, snapEllipticalArcGuide } from "@aether/core/sketch";
import { pickSelectableSketchEntity, selectPickedReference } from "./sketch/projected-picking";
import {pickSketchEditEntity} from './sketch/edit-picking';
import { projectionAuthoring, backgroundSnappingContext } from "./sketch/projection-authoring";
import { isDirectModificationTool } from "./sketch/tool-instructions";
import { mountSelectionConstraintStatus } from "./sketch/selection-constraint-status";
import { mountDimensionLabelDrag } from "./sketch/dimension-label-drag";
import { mountFitSplineTool } from "./sketch/fit-spline-tool";
import { mountDxfImportPanel } from "./sketch/dxf-import-panel";
import { inferDrawingPlacement } from "./sketch/drawing-inference";
import { bindSelectionDrag } from "./sketch/selection-drag";
import { createSketchHistory } from "./sketch/history";
import { mountRecentCurveSizing } from "./sketch/recent-curve-sizing";
import { bindEndpointDragGesture } from "./sketch/endpoint-drag-gesture";
import { arcChordStart, arcChordPoints } from "./sketch/arc-chord-tool";
import { placeTangentArc } from "./sketch/tangent-arc-tool";
import { renderSketchSelection } from "./sketch/selection-renderer";
import { openFeatureWindow } from "@aether/ui";
import { cadCommands, isCADCommandID } from "./cad-command-registry";
import type { SketchEntityRef } from "@aether/core/sketch";
import { bindTrimGesture } from "./sketch/trim-gesture";
import { directModification } from "./sketch/direct-modification";
import { renderSketchCanvas } from "./sketch/canvas-renderer";
import { renderConstraintMarks, renderHoveredConstraints, hoverConstraintMark } from "./sketch/constraint-marks";
import { placeDrawingPoint } from "./sketch/drawing-tool";

import { mountConstraintPanel } from "./sketch/constraint-panel";
import { sketchConstraintCatalog } from "./sketch/constraint-catalog";
import { mountModificationPanel } from "./sketch/modification-panel";
import {
  modificationTools,
  type ModificationTool,
} from "./sketch/tool-instructions";
import { instructions } from "./sketch/tool-instructions";

import { renderSketchPreview } from "./sketch/preview";
import { constructionPlaneFrame } from "@aether/core/document";
import { snapSketchPoint } from "./sketch-snapping";
import { solveDrawingConstraints, type SketchContour } from "@aether/core/sketch";
import { preparePierceDraft,type PierceIssue } from '../freecad-engine/browser/pierce-draft';
import { stageSketchPierce } from '../freecad-engine/browser/pierce-authoring';
import { mountPierceTool } from './sketch/pierce-tool';
import {
  sketchConstraintState,
  contourClosed,
  validateSketchDrawing,
  type SketchDrawing,
  type SketchPoint,
  type SketchFrame,
} from "@aether/core/sketch";
import { featureReferenceErrors, updatePartDocumentVariables, type PartDocument, type ProfileFeature } from "@aether/core/document";
import { cadSelection } from "./cad-selection-store";
import { contourPath } from "./sketch/svg-geometry";
import "./sketch-workspace.css";
/** A key pressed into a field is text, not a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('[contenteditable="true"], [contenteditable=""]') !== null ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function openSketchWorkspace(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
  existing?: ProfileFeature,
) {
  if (document.querySelector(".cad-sketch-workspace")) return;
  const source = getDocument();
  if (!source) return;
  // A feature is created the moment the tool is clicked: it gets its id and
  // name immediately, appears in the tree, and is invalid (red) until it has
  // a plane — matching Onshape.
  const featureID = existing?.id ?? crypto.randomUUID();
  const featureName =
    existing?.name ??
    `Sketch ${source.features.filter((f) => f.type === "profile" || f.type === "sketch").length + 1}`;
  const announceDraft = (hasPlane: boolean) =>
    window.dispatchEvent(
      new CustomEvent("aether-sketch-editing", {
        detail: { id: featureID, name: featureName, hasPlane, existing: Boolean(existing) },
      }),
    );
  let variables = structuredClone(source.variables);
  let sourceProfiles:ProfileFeature[]=[];
  const workingSource=():PartDocument=>({...source,features:source.features.map(f=>sourceProfiles.find(p=>p.id===f.id)??f)});
  const projected = projectionAuthoring(source, existing);
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  if (!viewport) return;
  const root = document.createElement("section");
  root.className = "cad-sketch-workspace choosing-plane";
  root.setAttribute("aria-label", "Sketch workspace");
  // The sketch window IS the shared gallery feature widget — the whole point
  // of the gallery is that products pull these, never re-build them.
  let commitSketch = () => {};
  let discardSketch = () => {};
  const win = openFeatureWindow({
    viewport,
    className: "cad-sketch-window",
    title: featureName,
    acceptLabel: "Finish sketch",
    discardLabel: "Cancel sketch",
    onAccept: () => commitSketch(),
    onDiscard: () => discardSketch(),
  });
  addFeatureViewControls(win);
  addSketchNormalControl(win);
  const sidebar = win.body;
  // Keep the window inside the workspace section so sketch chrome lives and
  // dies together (and stays queryable as one unit).
  root.append(win.panel);
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.className = "sketch-tool-status";
  root.prepend(message);
  const toolWindow = createSketchToolWindow(root, () => started && !busy, () => chooseTool("select"), () => constraints.tool.cancel());
  /** A real failure: shown in the window's error block and disables commit. */
  const fail = (text: string) => {
    message.textContent = text;
    win.setError(text || null);
    // A rejected edit leaves the valid draft intact; Finish validates again.
    win.panel.querySelector<HTMLButtonElement>(".aui-feature-accept")!.disabled = !started || busy || !!supportIssue || pierceIssues.length>0;
  };
  const constraintStatus = document.createElement("p");
  constraintStatus.className = "sketch-constraint-state";
  constraintStatus.setAttribute("aria-label", "Sketch constraint state");
  let updateSelectionConstraintStatus: ReturnType<typeof mountSelectionConstraintStatus>;
  let plane: "XY" | "XZ" | "YZ" = existing?.plane ?? "XY",
    frame: SketchFrame | undefined = existing?.frame;
  let support = existing?.support;
  const existingError = support && existing ? errorsForDocument(source).get(existing.id) : undefined;
  // The plane dependency and authored external relationships are independent.
  // A missing Pierce source must be repairable without reattaching a valid face.
  const supportReferenceError = support && existing ? featureReferenceErrors({...source,features:source.features.map(f=>f.id===featureID?{...existing,profile:{type:'drawing' as const,contours:[]}}:f)}).get(featureID) : undefined;
  let supportIssue = existingError && /sketch support/i.test(existingError) ? existingError : supportReferenceError??null;
  let offsetMillimeters = existing?.offsetMillimeters ?? 0;
  let backgroundContext: SketchContour[] | undefined;
  let started = false,
    // Placing the plane must not arm a drawing tool — the first viewport click
    // belongs to selection until a tool is picked from the ribbon.
    tool = "select",
    pending: SketchPoint[] = [],
    activePath = -1,
    busy = false;
  let cursor: SketchPoint | null = null;
  let selectedEntities: SketchEntityRef[] = [];
  let selectionSignature = "";
  let selectedEntity: SketchEntityRef | null = null,
    activeTool = "";
  /** A closed region, picked by clicking inside it. Kept apart from
   *  `selectedEntity` because a region is not a constraint target — it is the
   *  thing a solid feature gets built on. */
  let selectedRegion: number | null = null;
  let construction = false;
  let showErrors = true;
  let annotationSelection: ReturnType<typeof mountAnnotationSelection> | undefined;
  let selectionActions: ReturnType<typeof mountSketchSelectionActions> | undefined;
  /** Onshape draws the applied relationships on the geometry; the Show
   *  constraints row turns them off. Dimensions are separate annotations. */
  let showConstraints = true;
  /** The entity under the pointer, for the hover constraint readout. */
  let hoveredEntity: SketchEntityRef | null = null;
  let rectangleStartedWithPointer = false;
  let snapLabel = "",
    gridSnap = true,
    geometrySnap = true,
    pickEntityB = false;
  const previousFilter = cadSelection.snapshot().filter;
  const initial=existing?.profile.type==='drawing'?preparePierceDraft(source.features,existing.id,existing.profile):projected;
  let pierceIssues:PierceIssue[]=initial?.issues??[];
  let drawing: SketchDrawing = initial?.drawing ?? { type: "drawing", contours: [] };
  if (existing?.profile.type === "circle")
    drawing.contours.push({
      type: "circle",
      center: existing.profile.centerMillimeters,
      radius: existing.profile.radiusMillimeters,
    });
  if (existing?.profile.type === "polygon") {
    const p = existing.profile.pointsMillimeters;
    drawing.contours.push({
      type: "path",
      start: p[0],
      segments: [...p.slice(1), p[0]].map((end) => ({ type: "line", end })),
    });
  }
  let dimensionPositions: Record<string,SketchPoint> = structuredClone(existing ? source.sketchPresentation?.[existing.id]?.dimensionLabelPositionsMillimeters ?? {} : {});
  const history = createSketchHistory();
  const checkpoint = () => { recentSizing.clear(); history.checkpoint({ drawing, activePath, dimensionPositions, variables,sourceProfiles }); };
  const draftDocument=():PartDocument=>{
    const doc=structuredClone(workingSource()),saved=structuredClone(drawing);delete saved.pierceContext;delete saved.projectionContext;
    const feature:ProfileFeature={...existing,id:featureID,name:featureName,type:'profile',plane,frame,offsetMillimeters,support,suppressed:false,profile:projected?.save(saved)??saved};
    const index=doc.features.findIndex(f=>f.id===featureID);if(index<0)doc.features.splice(doc.rollbackIndex??doc.features.length,0,feature);else doc.features[index]=feature;
    doc.variables=structuredClone(variables);return doc;
  };
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-label", "2D sketch canvas");
  svg.setAttribute("tabindex", "0");
  svg.classList.add("cad-sketch-canvas");
  // The renderer draws the Onshape-style plane card and needs the sketch name;
  // carried on the element so it survives being reparented into the CSS3D layer.
  svg.dataset.sketchName = featureName;
  root.prepend(svg);
  // The view opens framed on the whole sketch-plane square with a margin, so the
  // plane reads as a drawn object you can see the edges of.
  let bounds = { x: -100, y: -100, width: 200, height: 200 };
  // In-world mode: the 3D viewer hosts the svg on the sketch plane and owns
  // navigation; this bridge supplies plane raycasts and scale. Null = legacy
  // flat overlay (tests, gallery, no viewer present).
  type SurfaceBridge = {
    toSketch(clientX: number, clientY: number): SketchPoint | null;
    toClient?(point: SketchPoint): SketchPoint | null;
    scaleAt(clientX?: number, clientY?: number): number | null;
    updateBounds(next: typeof bounds): void;
  };
  let surface: SurfaceBridge | null = null;
  // Grow (never shrink) the viewBox to hold the drawing; keeps the in-world
  // plane card under the whole sketch. ponytail: arc bulges/ellipse extremes
  // beyond their control points can still clip visually; widen per-type if it
  // shows up in practice.
  const fitBoundsToContent = (): boolean => {
    const pts: SketchPoint[] = [...pending];
    for (const c of drawing.contours) {
      if (c.type === "circle")
        pts.push(
          [c.center[0] - c.radius, c.center[1] - c.radius],
          [c.center[0] + c.radius, c.center[1] + c.radius],
        );
      else if (c.type === "path") {
        pts.push(c.start);
        for (const s of c.segments) {
          pts.push(s.end);
          const extra = s as { controls?: SketchPoint[]; through?: SketchPoint; center?: SketchPoint };
          if (extra.controls) pts.push(...extra.controls);
          if (extra.through) pts.push(extra.through);
          if (extra.center) pts.push(extra.center);
          if (s.type === 'conic') pts.push(s.control);
        }
      }
    }
    if (!pts.length) return false;
    const pad = 25;
    const xs = pts.map((p) => p[0]);
    const vys = pts.map((p) => -p[1]);
    const minX = Math.min(bounds.x, Math.min(...xs) - pad);
    const maxX = Math.max(bounds.x + bounds.width, Math.max(...xs) + pad);
    const minY = Math.min(bounds.y, Math.min(...vys) - pad);
    const maxY = Math.max(bounds.y + bounds.height, Math.max(...vys) + pad);
    if (minX === bounds.x && minY === bounds.y && maxX === bounds.x + bounds.width && maxY === bounds.y + bounds.height)
      return false;
    bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    return true;
  };
  const controls = toolWindow.section("coordinates", "Coordinates");
  const modificationControls = toolWindow.section("modify", "Modify geometry");
  const constraintControls = toolWindow.section("constraints", "Constraints");
  const variableControls = toolWindow.section("variables", "Variables");
  const clipboardControls = toolWindow.section("clipboard", "Clipboard");
  const textControls = toolWindow.section("text", "Text");
  const vectorControls = toolWindow.section("vector", "Vector tools");
  const importControls = toolWindow.section("import", "Import DXF");
  // "Is the sketch asking for a plane?" — one switch, because the class and the
  // event must always move together. They lived at six separate sites, and the
  // one that cleared the plane moved the class without the event, so the viewer
  // stayed out of picking mode and only the first pick ever committed.
  const setChoosingPlane = (choosing: boolean) => {
    root.classList.toggle("choosing-plane", choosing);
    window.dispatchEvent(
      new CustomEvent("aether-sketch-plane-selection", { detail: choosing }),
    );
  };
  /** What the reference-geometry tree calls the principal planes, so the chip
   *  and the tree name the same thing the same way. */
  const PRINCIPAL_PLANE_LABELS = {
    XY: "Top Plane", XZ: "Front Plane", YZ: "Right Plane",
  } as const;
  let renderSketchPlaneChip: ((label: string) => void) | undefined;
  const resolvePierceOnPlane = (input:SketchDrawing,p:typeof plane,f?:SketchFrame,allowRepair=true):SketchDrawing => {
    if(!input.constraints?.some(c=>c.kind==='pierce')){pierceIssues=[];return input;}
    const draft = {id:featureID,name:featureName,type:'profile' as const,plane:p,frame:f,offsetMillimeters,suppressed:false,profile:input};
    const doc=workingSource(),features=[...doc.features],index=features.findIndex(feature=>feature.id===featureID);
    if(index<0)features.splice(doc.rollbackIndex??features.length,0,draft);else features[index]=draft;
    const prepared=preparePierceDraft(features,featureID,input);
    if(!allowRepair&&prepared.issues.length)throw Error(prepared.issues[0].message);
    pierceIssues=prepared.issues;return prepared.drawing;
  };
  const start = (p: typeof plane, f?: SketchFrame, reference?: string,allowRepair=false) => {
    // Plane selection changes the actual source intersections. Resolve before
    // changing editor state so a missing branch cannot leave stale constraints.
    try { drawing=resolvePierceOnPlane(drawing,p,f,allowRepair); }
    catch(error) { fail(error instanceof Error?error.message:String(error));return; }
    setChoosingPlane(false);
    plane = p;
    frame = f;
    started = true;
    // Name the thing that was picked — "Plane 1", "Top Plane", "Face of
    // Extrude 1" — rather than describing it. A reference is an identity, and
    // "Selected plane" tells a reader nothing about which one.
    renderSketchPlaneChip?.(reference ?? PRINCIPAL_PLANE_LABELS[p]);
    pending = [];
    if (!projected) {
      backgroundContext = backgroundSnappingContext(workingSource(), {
        id: featureID,
        name: featureName,
        type: "profile",
        plane: p,
        offsetMillimeters,
        frame: f,
        suppressed: false,
        profile: { type: "drawing", contours: [] },
      });
      drawing.projectionContext = structuredClone(backgroundContext);
    }
    window.dispatchEvent(
      new CustomEvent("aether-sketch-mode", { detail: true }),
    );
    announceDraft(true);
    setActiveTool("select");
    window.addEventListener("keydown", globalKey);
    win.panel.removeAttribute("data-feature-state");
    fitBoundsToContent();
    window.dispatchEvent(
      new CustomEvent("aether-sketch-surface", {
        detail: {
          svg,
          frame:
            f ??
            constructionPlaneFrame({
              id: "",
              name: "",
              type: "plane",
              plane: p,
              offsetMillimeters,
              suppressed: false,
            }),
          bounds,
          connect: (bridge: SurfaceBridge) => {
            surface = bridge;
            root.classList.add("in-world");
          },
        },
      }),
    );
    render();
  };
  const face = (event: Event) => {
    if (started) return;
    const detail = (event as CustomEvent).detail;
    if (detail?.frame) {
      const datum = source.features.find((feature, index) => feature.type === "plane" &&
        JSON.stringify(constructionPlaneFrame(feature, source.features.slice(0, index))) === JSON.stringify(detail.frame));
      support = detail.support;
      supportIssue = null;
      offsetMillimeters = 0;
      start(datum?.type === "plane" ? datum.plane : "XY", detail.frame, support?.label ?? detail.label ?? datum?.name ?? "Selected face");
    }
    else
      message.textContent =
        detail?.error ?? "Select a flat face in the model first.";
  };
  window.addEventListener("aether-sketch-face", face);
  const reference = (event: Event) => {
    if (!started) {support=undefined;supportIssue=null;offsetMillimeters=0;start((event as CustomEvent).detail);}
  };
  window.addEventListener("aether-sketch-plane", reference);
  const setActiveTool = (name: string) => {
    const previous = `sketch-${activeTool}`,
      next = `sketch-${name}`;
    if (isCADCommandID(previous)) cadCommands.setActive(previous, false);
    activeTool = name;
    if (isCADCommandID(next)) cadCommands.setActive(next, true);
  };
  const chooseTool = (name: string, preserveSelection = false) => {
    const retainedEntities = preserveSelection ? [...selectedEntities] : [];
    const retainedEntity = preserveSelection ? selectedEntity : null;
    constraints.tool.cancel();
    recentSizing.clear();
    textPanel.cancel();
    dxfImport.cancel();
    endpointGesture.cancel();
    selectionDrag.cancel();
    dimensionTool.cancel();
    boxSelection.cancel();
    annotationSelection?.clear();
    // Clearing annotations notifies its selection owner; restore the captured
    // geometry afterwards when a constraint command consumes that selection.
    selectedEntities = retainedEntities;
    selectedEntity = retainedEntity;
    selectedRegion = null;
    setActiveTool(name);
    modifications.close();
    pickEntityB = false;
    tool = name;
    pending = [];
    cursor = null;
    if (name !== "line" && name !== "arc") activePath = -1;
    render();
    if (name !== "select" && name !== "dimension" && name !== "fit-spline") toolWindow.show("coordinates");
    else toolWindow.close();
  };
  const toolEvent = (event: Event) => {
    if (started) {
      const name = (event as CustomEvent).detail;
      if (name === activeTool && name !== "select") {
        chooseTool("select");
        return;
      }
      if (modificationTools.includes(name)) {
        chooseTool("select");
        toolWindow.show("modify");
        modifications.open(name as ModificationTool);
        setActiveTool(name);
      } else chooseTool(name);
    }
  };
  window.addEventListener("aether-sketch-tool", toolEvent);
  const historyActions = mountSketchHistoryActions({
    history,
    pending: { undo: () => fitSpline.undo(), redo: () => fitSpline.redo(), canUndo: () => fitSpline.canUndo(), canRedo: () => fitSpline.canRedo() },
    enabled: () => started && !busy,
    current: () => ({ drawing, activePath, dimensionPositions, variables,sourceProfiles }),
    cancelGesture: () => { recentSizing.clear(); endpointGesture.cancel(); selectionDrag.cancel(); dimensionTool.cancel(); boxSelection.cancel(); constraints.tool.reset(); },
    restore: snapshot => {
      sourceProfiles=snapshot.sourceProfiles??[];
      drawing = resolvePierceOnPlane(snapshot.drawing,plane,frame); variables = snapshot.variables;
      if(!projected)drawing.projectionContext=structuredClone(backgroundContext);
      dimensionPositions = snapshot.dimensionPositions ?? {}; activePath = snapshot.activePath;
      annotationSelection?.clear();
      pending = []; cursor = null; selectedEntities = []; selectedEntity = null; selectedRegion = null;
      setPickedSketchRegion(null); render();
    },
  });
  const modifications = mountModificationPanel({
    finished: () => setActiveTool("select"),
    parent: modificationControls,
    svg,
    drawing: () => drawing,
    commit: (next) => {
      checkpoint();
      drawing = next;
      pending = [];
      cursor = null;
      activePath = -1;
      render();
    },
    report: (text) => {
      message.textContent = text;
    },
  });
  const recentSizing = mountRecentCurveSizing({
    parent: controls,
    drawing: () => drawing,
    commit: (next, positions) => { checkpoint(); drawing = next; if (positions) dimensionPositions = { ...dimensionPositions, ...positions }; render(); },
    report: text => { message.textContent = text; },
    focusCanvas: () => svg.focus(),
  });
  const coordinates = mountSketchCoordinates(controls, {
    preview: point => { cursor = point; renderPreview(); },
    changed: () => renderPreview(),
    place,
    newContour: () => { recentSizing.clear(); endpointGesture.cancel(); activePath = -1; pending = []; render(); },
    closeContour: () => {
      const contour = drawing.contours[activePath];
      if (contour?.type !== "path" || !contour.segments.length || contourClosed(contour)) return;
      checkpoint(); contour.segments.push({ type: "line", end: [...contour.start] });
      activePath = -1; pending = []; render();
    },
    geometrySnap: value => { geometrySnap = value; },
    gridSnap: value => { gridSnap = value; },
    variables: () => variables,
    confirmConic: () => {
      if (tool === 'conic' && pending.length === 3) place(pending[2]);
      svg.focus();
    },
  });
  const { ellipseRadius, arcDirection } = coordinates;
  selectionActions = mountSketchSelectionActions({
    enabled: () => started && !busy,
    drawing: () => drawing,
    selectedConstraints: () => annotationSelection?.selected() ?? [],
    selected: () => selectedEntities.length ? selectedEntities : selectedEntity ? [selectedEntity] : selectedRegion !== null ? (sketchFaceRegions(drawing).find(region => region.contourIndex === selectedRegion)?.sourceContourIndices ?? []).map(contour => ({ contour, kind: 'contour' as const })) : [],
    construction: () => construction,
    setConstruction: value => { construction = value; activePath = -1; pending = []; renderPreview(); message.textContent = value ? "Construction geometry on — new geometry will be dashed." : "Construction geometry off."; },
    commit: next => { checkpoint(); drawing = next; dimensionPositions = Object.fromEntries(Object.entries(dimensionPositions).filter(([id]) => next.constraints?.some(c => c.id === id))); annotationSelection?.clear(); activePath = -1; pending = []; cursor = null; selectedEntities = []; selectedEntity = null; selectedRegion = null; setPickedSketchRegion(null); render(); },
    report: text => { message.textContent = text; },
    error: text => { constraintStatus.hidden = false; constraintStatus.dataset.state = "invalid"; constraintStatus.textContent = text; },
  });
  const fitSpline = mountFitSplineTool(controls,svg,{
    state:()=>({tool,pending,drawing,construction,busy}),
    changePending:points=>{pending=points;cursor=null;render();},
    commit:next=>{checkpoint();drawing=next;pending=[];cursor=null;activePath=-1;render();},
    error:text=>{fail(text);},
  });
  const variablePanel = mountSketchVariables(variableControls,()=>({drawing,variables}),(next,definitions)=>{
    checkpoint();drawing=next;variables=definitions;pending=[];cursor=null;activePath=-1;render();
  });
  const clipboard = mountSketchClipboard(clipboardControls,svg,()=>({drawing,variables}),()=>selectedEntities.length ? [...new Set(selectedEntities.map(ref=>ref.contour))] : selectedEntity?.contour,()=>started&&!busy,(next,definitions)=>{
    checkpoint();drawing=next;variables=definitions;pending=[];cursor=null;activePath=-1;render();
  },()=>{ chooseTool("select"); toolWindow.show("clipboard"); });
  const textPanel = mountTextPanel(textControls,svg,()=>drawing,next=>{
    checkpoint();drawing=next;pending=[];cursor=null;activePath=-1;render();
  },()=>variables);
  const vectorPanel=mountVectorPanel(vectorControls,()=>drawing,()=>selectedEntities.filter(ref=>ref.projectedContourId===undefined).map(ref=>ref.contour),next=>{checkpoint();drawing=next;pending=[];cursor=null;activePath=-1;render();});
  const dxfImport = mountDxfImportPanel(importControls,svg,()=>drawing,next=>{
    checkpoint();drawing=next;pending=[];cursor=null;activePath=-1;render();
  });
  const pierce=mountPierceTool({
    parent:constraintControls,svg,targetId:featureID,document:draftDocument,drawing:()=>drawing,
    reveal:()=>toolWindow.show('constraints'),select:refs=>{selectedEntities=[...refs];selectedEntity=refs.at(-1)??null;selectedRegion=null;setPickedSketchRegion(null);renderSelection();},
    report:text=>{message.textContent=text;},
    apply:(target,choice,hit,replaceId)=>{
      const next=stageSketchPierce(draftDocument(),featureID,target,choice.sourceId,choice.contourIndex,choice.segmentIndex,hit,replaceId);
      if(!next.added)return false;
      const feature=next.document.features.find(f=>f.id===featureID) as ProfileFeature;
      const authored=feature.profile.type==='drawing'?feature.profile:feature.profile.type==='projection'?feature.profile.authored:undefined;
      if(!authored)throw Error('The active sketch is unavailable.');
      const prepared=preparePierceDraft(next.document.features,featureID,{...authored,projectionContext:drawing.projectionContext});
      checkpoint();sourceProfiles=next.document.features.filter((f):f is ProfileFeature=>f.type==='profile'&&f.id!==featureID&&JSON.stringify(f)!==JSON.stringify(source.features.find(s=>s.id===f.id)));
      drawing=prepared.drawing;pierceIssues=prepared.issues;pending=[];cursor=null;render();return true;
    },
  });
  const constraints = mountConstraintPanel({
    pierce,pierceIssue:id=>pierceIssues.find(issue=>issue.id===id)?.message,
    removePierce:id=>{const next=structuredClone(drawing);next.constraints=next.constraints?.filter(c=>c.id!==id);const prepared=preparePierceDraft(draftDocument().features,featureID,next);checkpoint();drawing=prepared.drawing;pierceIssues=prepared.issues;render();},
    startDimension: () => dimensionTool.begin(),
    reveal: () => toolWindow.show("constraints"),
    selection: () => selectedEntities,
    select: refs => {
      annotationSelection?.clear();
      selectedEntities = [...refs]; selectedEntity = refs.at(-1) ?? null;
      selectedRegion = null; setPickedSketchRegion(null); renderSelection();
    },
    toolChanged: kind => {
      for (const entry of sketchConstraintCatalog) cadCommands.setActive(`sketch-constraint-${entry.kind}`, entry.kind === kind);
      svg.dataset.constraintTool = kind ?? "";
    },
    getVariables: () => variables,
    parent: constraintControls,
    svg,
    getDrawing: () => drawing,
    commit: (next) => {
      checkpoint();
      drawing = next;
      pending = [];
      cursor = null;
      render();
    },
    coordinates: coordinates.point,
    chooseTool,
    message,
  });
  const { entityA, entityB, kind, hints } = constraints;
  const disposeDimensionUnits = bindDimensionLabelUnits(svg);
  const cleanup = () => {
    historyActions.dispose();
    toolWindow.dispose();
    annotationSelection?.dispose();
    selectionActions?.dispose();
    selectionDrag.cancel();
    dimensionTool.dispose();
    boxSelection.dispose();
    disposeDimensionUnits();
    recentSizing.dispose();
    modifications.close();
    constraints.dispose();
    pierce.dispose();
    dimensionLabelDrag.dispose();
    vectorPanel.dispose();
    dxfImport.dispose();
    textPanel.dispose();
    variablePanel.dispose();
    clipboard.dispose();
    fitSpline.dispose();
    setChoosingPlane(false);
    if (surface) {
      surface = null;
      window.dispatchEvent(new CustomEvent("aether-sketch-surface-end"));
    }
    window.removeEventListener("keydown", globalKey);
    window.removeEventListener("aether-sketch-finish", finishEvent);
    win.close();
    root.remove();
    window.removeEventListener("aether-sketch-tool", toolEvent);
    window.removeEventListener("aether-sketch-plane", reference);
    window.removeEventListener("aether-sketch-face", face);
    cadSelection.dispatch({ type: "set-filter", filter: previousFilter });
    window.dispatchEvent(
      new CustomEvent("aether-sketch-mode", { detail: false }),
    );
    window.dispatchEvent(new CustomEvent("aether-sketch-editing", { detail: null }));
  };
  const finish = async () => {
      if (!started || busy) return false;
      if (supportIssue) {fail(supportIssue);return false;}
      if (pierceIssues.length) {fail('Repair or remove the broken Pierce source before finishing.');return false;}
      try {
        if (clipboard.pending()) throw Error("Apply or cancel the paste preview before finishing the sketch.");
        if (variablePanel.pending()) throw Error("Apply pending variable edits before finishing the sketch.");
        if(tool === "fit-spline" && pending.length) throw Error("Finish spline or cancel the unfinished curve before finishing the sketch.");
        drawing = solveDrawingConstraints(drawing);
        validateSketchDrawing(drawing);
        // An empty sketch is valid — the plane choice alone defines it, and
        // Core keeps sketches without contours (they just can't drive solids).
        if (getDocument() !== source)
          throw new Error(
            "The document changed while sketching. Cancel and reopen to avoid overwriting it.",
          );
        busy = true;
        planeControls.setBusy(true);
        win.panel.querySelector<HTMLButtonElement>(".aui-feature-accept")!.disabled = true;
        const savedDrawing = structuredClone(drawing);
        delete savedDrawing.projectionContext;
        delete savedDrawing.pierceContext;
        const feature: ProfileFeature = {
          id: featureID,
          type: "profile",
          name: featureName,
          suppressed: existing?.suppressed ?? false,
          plane,
          offsetMillimeters,
          profile: projected?.save(drawing) ?? savedDrawing,
          ...(frame ? { frame } : {}),
          ...(support ? { support } : {}),
        };
        const draftSnapshot = JSON.stringify({drawing,variables,dimensionPositions,plane,frame,support,offsetMillimeters,sourceProfiles});
        const next = await updatePartDocumentVariables(workingSource(), variables, feature);
        if (draftSnapshot !== JSON.stringify({drawing,variables,dimensionPositions,plane,frame,support,offsetMillimeters,sourceProfiles}) || variablePanel.pending() || clipboard.pending()) throw Error("The sketch changed while preparing it. Review and finish again.");
        if (getDocument() !== source) throw Error("The document changed while preparing the sketch. Cancel and reopen.");
        next.sketchPresentation = {...source.sketchPresentation, [feature.id]: {dimensionLabelPositionsMillimeters: Object.fromEntries(Object.entries(dimensionPositions).filter(([id])=>drawing.constraints?.some(c=>c.id===id)))}};
        const curves = sketchRegions(feature, true, next.features);
        const closed = sketchRegions(feature, false, next.features);
        const regions = closed.length ? closed : curves;
        const pick = selectedRegion !== null ? regions.find(r => r.contourIndex === selectedRegion) : regions.length === 1 ? regions[0] : undefined;
        await apply(next);
        cleanup();
        // Tool cleanup clears transient canvas selection. Publish the handoff
        // afterwards so an active constraint/dimension tool cannot erase it.
        setPickedSketchRegion(pick ? {featureId: featureID, contourIndex: pick.contourIndex}
          : regions.length ? {featureId: featureID, contourIndex: regions[0].contourIndex, contourIndices: regions.map(r => r.contourIndex)} : null);
        return true;
      } catch (error) {
        fail((error as Error).message);
        return false;
      } finally {
        busy = false;
        planeControls.setBusy(false);
        win.panel.querySelector<HTMLButtonElement>(".aui-feature-accept")!.disabled = !started || !!supportIssue || pierceIssues.length>0;
      }
  };
  commitSketch = () => { void finish(); };
  discardSketch = () => { if (!busy) cleanup(); };
  const planeControls = mountSketchWindowFields(win, { changePlane: () => {
    if(busy)return;
    if(projected){fail('Change the projection plane in the projected sketch editor.');return;}
    if(clipboard.pending()||variablePanel.pending()){fail('Apply or cancel pending paste and variable edits before changing the sketch plane.');return;}
    chooseTool('select');
    support=undefined;supportIssue=null;frame=undefined;offsetMillimeters=0;started=false;
    setPickedSketchRegion(null);
    cadSelection.dispatch({type:'clear'});
    win.panel.setAttribute('data-feature-state','invalid');
    planeControls.render();
    if(surface){surface=null;window.dispatchEvent(new CustomEvent('aether-sketch-surface-end'));}
    root.classList.remove('in-world');
    setChoosingPlane(true);announceDraft(false);render();
  },
    onConstraintsChange: checked => { showConstraints = checked; render(); },
    onExpressionsChange: checked => { svg.dataset.showExpressions = String(checked); render(); },
    onErrorsChange: checked => { showErrors = checked; render(); },
  });
  sidebar.append(constraintStatus);
  updateSelectionConstraintStatus = mountSelectionConstraintStatus(constraintControls);
  renderSketchPlaneChip = planeControls.render;
  if (!existing) {
    win.panel.setAttribute("data-feature-state", "invalid");
    announceDraft(false);
  }
  
  // Preview is presentation-only: no feature/undo mutation until a point is placed.
  const effectivePoint = (p: SketchPoint): SketchPoint => {
    const c = drawing.contours[activePath];
    if (
      (tool === "line" || (tool === "arc" && pending.length < 2)) &&
      c?.type === "path" &&
      !contourClosed(c) &&
      Math.hypot(c.start[0] - p[0], c.start[1] - p[1]) < bounds.width / 100
    )
      return [...c.start];
    return p;
  };
  function renderPreview() {
    ellipseRadius.observe(tool, pending, cursor ? effectivePoint(cursor) : null);
    coordinates.conicRho.observe(tool, pending, cursor ? effectivePoint(cursor) : null);
    renderSketchPreview(svg, {
      started,
      busy,
      cursor,
      tool,
      drawing,
      activePath,
      pending,
      bounds,
      snapLabel,
      sides: coordinates.sides(),
      clockwise: arcDirection.clockwise(),
      secondaryRadiusMillimeters: ellipseRadius.value(),
      rememberedRadiusMillimeters: ellipseRadius.remembered(),
      conicRho: () => cursor ? coordinates.conicRho.read() : coordinates.conicRho.previewValue(),
      effectivePoint,
    });
  }
  function renderSelection() {
    annotationSelection?.paint();
    selectionActions?.refresh();
    constraints.refreshSelection();
    const refs = selectedEntities.length ? selectedEntities : selectedEntity ? [selectedEntity] : [];
    const signature = JSON.stringify(refs);
    if (started && signature !== selectionSignature) {
      selectionSignature = signature;
      cadSelection.dispatch({ type: "replace", items: refs.map(ref => ({ id: `sketch:${featureID}:${JSON.stringify(ref)}`, kind: ref.kind === "point" ? "vertex" : "edge", partId: featureID, label: `${featureName}: ${ref.kind}` })) });
    }
    renderSketchSelection(svg, drawing, selectedEntities.length ? selectedEntities : selectedEntity, bounds.width / 150);
    updateSelectionConstraintStatus(drawing, selectedEntity);
    // The contour paths are already in the DOM and already carry their index,
    // so highlighting a region is a class on the one that was picked.
    for (const shape of svg.querySelectorAll<SVGElement>("[data-contour-index], [data-region-index]"))
      shape.classList.toggle(
        "sketch-region-selected",
        selectedRegion !== null &&
          (shape.dataset.regionIndex ?? shape.dataset.contourIndex) === String(selectedRegion) &&
          shape.classList.contains("sketch-region-fill"),
      );
  }
  /** Nothing under the cursor, or a region under it. Clicking inside a shaded
   *  area is how a profile gets chosen for an extrude. */
  function selectRegionAt(p: SketchPoint) {
    const region = pickSketchRegion(drawing, p);
    if (region === null || region === selectedRegion) {
      selectedRegion = null;
      setPickedSketchRegion(null);
      renderSelection();
      message.textContent = "Selection cleared.";
      return;
    }
    selectedRegion = region;
    setPickedSketchRegion({ featureId: featureID, contourIndex: region });
    renderSelection();
    message.textContent = `Region ${region + 1} selected — pick a solid tool to build on it.`;
  }
  function render() {
    win.setError(supportIssue??(pierceIssues.length?`Pierce: ${pierceIssues[0].message} Open Constraints to repair or remove the source.`:null));
    if (surface && fitBoundsToContent()) surface.updateBounds(bounds);
    variablePanel.sync();
    textPanel.sync();
    vectorPanel.sync();
    win.panel.querySelector<HTMLButtonElement>(".aui-feature-accept")!.disabled = !started || busy || !!supportIssue || pierceIssues.length>0;
    historyActions.refresh();
    toolWindow.refresh();
    svg.style.visibility = started ? "visible" : "hidden";
    if (!started) {
      // No prompt text: the empty "Sketch plane" box is the instruction, exactly
      // as in the gallery's Sketch window.
      message.textContent = "";
      return;
    }
    coordinates.update(tool);
    arcDirection.update(tool);
    ellipseRadius.update(tool);
    const state = constraintDisplayState(sketchConstraintState(drawing));
    constraintStatus.hidden = !showErrors || (!state.redundantEquations && !["over-constrained", "invalid"].includes(state.state));
    constraintStatus.dataset.state = state.state;
    svg.dataset.constraintState = state.state;
    const labels = {
      empty: "Empty sketch",
      "under-constrained": "Under-constrained",
      "fully-constrained": "Fully constrained",
      "over-constrained": "Over-constrained",
      invalid: "Constraint analysis unavailable",
    };
    constraintStatus.textContent =
      labels[state.state] +
      (state.degreesOfFreedom !== null
        ? ` · ${state.degreesOfFreedom} degrees of freedom`
        : "") +
      (state.redundantEquations
        ? ` · ${state.redundantEquations} redundant equations (geometry is consistent)`
        : "") +
      (state.message ? ` · ${state.message}` : "");
    const profiles = drawing.contours.filter(c => !c.construction);
    const closed = profiles.filter(contourClosed).length;
    message.textContent = constraints.tool.active() ? constraints.tool.prompt() : `${frame ? "Planar face" : plane} · ${tool} · ${closed} closed / ${profiles.length - closed} open profiles. ${instructions[tool] ?? ""}`;
    renderSketchCanvas(svg, drawing, bounds, pending, dimensionPositions);
    if (showConstraints) renderConstraintMarks(svg, drawing, bounds,
      surface ? 18 * (surface.scaleAt() ?? bounds.width / 800) : bounds.width / 60);
    renderHoveredConstraints(svg, drawing, hoveredEntity);
    const renderProjectedBackground = (svg: SVGSVGElement, contours?: SketchContour[]) => {
      const existingGroup = svg.querySelector(".sketch-projected-background");
      if (existingGroup) existingGroup.remove();
      if (!contours || contours.length === 0) return;
      const ns = "http://www.w3.org/2000/svg",
        group = document.createElementNS(ns, "g");
      group.setAttribute("class", "sketch-projected-background");
      group.setAttribute("aria-label", "Live projected geometry (read-only)");
      group.setAttribute("pointer-events", "none");
      for (const c of contours) {
        const node = document.createElementNS(ns, c.type === "circle" ? "circle" : "path");
        if (c.type === "circle") {
          node.setAttribute("cx", String(c.center[0]));
          node.setAttribute("cy", String(-c.center[1]));
          node.setAttribute("r", String(c.radius));
        } else node.setAttribute("d", contourPath(c));
        node.setAttribute("vector-effect", "non-scaling-stroke");
        group.append(node);
      }
      svg.prepend(group);
    };
    renderProjectedBackground(svg, drawing.projectionContext);
    renderPreview();
    renderSelection();
    fitSpline.refresh();
    modifications.refresh();
    constraints.refresh();
    pierce.refresh();pierce.render(bounds.width/100);
    clipboard.sync();
  }
  function place(p: SketchPoint, inferPoints = false, extendSelection = false, square = false) {
    if (!started || busy) return;
    recentSizing.clear();
    if (modifications.pickCorner(p, bounds.width / 60)) return;
    if (isDirectModificationTool(tool)) {
      try {
        const result = directModification(
          drawing,
          tool,
          p,
          pending,
          bounds.width / 60,
        );
        if (!result.drawing) {
          pending = result.pending;
          cursor = null;
          render();
          message.textContent = result.message ?? "";
          return;
        }
        const next = result.drawing;
        checkpoint();
        drawing = next;
        pending = [];
        cursor = null;
        activePath = -1;
        render();
        if (result.message) message.textContent = result.message;
      } catch (error) {
        fail((error as Error).message);
      }
      return;
    }
    if (tool === "sketch-project-geometry") {
      const picked = pickSelectableSketchEntity(drawing, p);
      if (picked && picked.d < bounds.width / 60 && picked.ref.projectedContourId !== undefined) {
        const bg = drawing.projectionContext?.find(c => c.id === picked.ref.projectedContourId);
        if (bg) {
          checkpoint();
          const clone = structuredClone(bg);
          clone.id = undefined;
          clone.construction = construction;
          drawing.contours.push(clone);
          render();
          message.textContent = `Projected ${bg.type}.`;
        }
      } else {
        message.textContent = "Click a background geometry to project it into the sketch.";
      }
      return;
    }
    if (tool === "select") {
      if (constraints.tool.active()) {
        if(pierce.pickPoint(p,bounds.width/60))return;
        const picked = pickSelectableSketchEntity(drawing, p);
        constraints.tool.pick(picked && picked.d < bounds.width / 60 ? picked.ref : null);
        return;
      }
      annotationSelection?.clear();
      if (!extendSelection) selectedEntities = [];
      const picked = pickSketchEditEntity(drawing, p, svg);
      if (picked && picked.d < bounds.width / 60) {
        if (!extendSelection && JSON.stringify(selectedEntity) === JSON.stringify(picked.ref)) {
          selectedEntity = null;
          selectedEntities = [];
          pickEntityB = false;
          renderSelection();
          message.textContent = "Selection cleared.";
          return;
        }
        selectedEntity = picked.ref;
        if (extendSelection) {
          const key = JSON.stringify(picked.ref);
          selectedEntities = selectedEntities.some(ref => JSON.stringify(ref) === key) ? selectedEntities.filter(ref => JSON.stringify(ref) !== key) : [...selectedEntities, picked.ref];
          selectedEntity = selectedEntities.at(-1) ?? null;
        } else selectedEntities = [picked.ref];
        // An edge and a region are different answers to the same click.
        selectedRegion = null;
        setPickedSketchRegion(null);
        renderSelection();
        const selector = pickEntityB ? entityB : entityA;
        selectPickedReference(selector, picked);
        selector.closest("details")?.toggleAttribute("open", true);
        message.textContent = `${pickEntityB ? "Entity B" : "Entity A"}: ${picked.label}. ${hints[kind.value]}`;
        pickEntityB = !pickEntityB;
      } else {
        selectedEntity = null;
        pickEntityB = false;
        selectRegionAt(p);
      }
      return;
    }
    try {
      const previousContourCount = drawing.contours.length;
      if (isRectanglePlacement(tool) && pending.length === 0) rectangleStartedWithPointer = inferPoints;
      const result = placeDrawingPoint(
        { drawing, pending, activePath },
        effectivePoint(p),
        {
          tool,
          square,
          sides: coordinates.sides(),
          inferQuadrants: geometrySnap,
          inferSemicircles: geometrySnap,
          clockwise: arcDirection.clockwise(),
          secondaryRadiusMillimeters: ellipseRadius.value(),
          rememberedRadiusMillimeters: ellipseRadius.remembered(),
          conicRho: tool === 'conic' ? coordinates.conicRho.read() : undefined,
          construction,
          closeTolerance: bounds.width / 100,
        },
      );
      const inferred = result.committed && geometrySnap
        ? inferDrawingPlacement(drawing, result.drawing, {pointer: inferPoints || (isRectanglePlacement(tool) && rectangleStartedWithPointer), tool, placedPoints: [...pending,effectivePoint(p)]})
        : result.drawing;
      if (result.committed) checkpoint();
      drawing = inferred;
      if (result.committed && tool === 'conic') coordinates.conicRho.reset();
      pending = result.pending;
      activePath = result.activePath;
      cursor = null;
      render();
      if (result.committed) recentSizing.offer(tool, previousContourCount, activePath);
      else if (tool === 'conic' && pending.length === 3) coordinates.conicRho.offer();
    } catch (error) {
      fail((error as Error).message);
    }
  }
  const pointerPoint = (e: MouseEvent, snap = true, placementAnchor?: SketchPoint): SketchPoint | null => {
    let raw: SketchPoint;
    if (surface) {
      const hit = surface.toSketch(e.clientX, e.clientY);
      if (!hit) return null;
      raw = hit;
    } else {
      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const p = point.matrixTransform(matrix.inverse());
      raw = [p.x, -p.y];
    }
    if (!snap || isDirectModificationTool(tool)) return raw;
    const contour = drawing.contours[activePath];
    const anchor =
      pending[0] ?? placementAnchor ??
      (contour?.type === "path" ? contour.segments.at(-1)?.end : undefined);
    const tolerance = surface
      ? 8 * (surface.scaleAt(e.clientX, e.clientY) ?? bounds.width / 100)
      : (bounds.width * 8) / Math.max(svg.getBoundingClientRect().width, 800);
    const snapped = geometrySnap
      ? snapSketchPoint(raw, drawing, anchor, tolerance, gridSnap)
      : {
          point: gridSnap
            ? ([Math.round(raw[0]), Math.round(raw[1])] as SketchPoint)
            : raw,
          label: gridSnap ? "Grid · 1 mm" : "",
        };
    if (geometrySnap && tool === "arc" && pending.length === 2) {
      const semicircle = snapSemicircle(pending[0], pending[1], raw, tolerance);
      if (semicircle) { snapLabel = "Semicircle"; return semicircle; }
    }
    if (geometrySnap && tool === "elliptical-arc") {
      const guide = snapEllipticalArcGuide(pending, raw, tolerance, {secondaryRadiusMillimeters:ellipseRadius.value(),rememberedRadiusMillimeters:ellipseRadius.remembered()});
      if (guide) { snapLabel = "Ellipse quadrant"; return guide.point; }
    }
    if (e.altKey && isRectanglePlacement(tool) && anchor) {
      snapLabel = "Equal";
      return squareCorner(anchor, snapped.point);
    }
    snapLabel = snapped.label;
    return snapped.point;
  };
  annotationSelection = mountAnnotationSelection({
    svg, enabled: () => started && !busy && activeTool === "select" && !dimensionTool.active() && !constraints.tool.active(),
    drawing: () => drawing, point: e => pointerPoint(e, false),
    changed: () => { selectedEntities = []; selectedEntity = null; selectedRegion = null; setPickedSketchRegion(null); renderSelection(); message.textContent = `${annotationSelection?.selected().length ?? 0} annotations selected. Delete removes the selected dimensions or constraints.`; },
  });
  const dimensionLabelDrag = mountDimensionLabelDrag(svg,(id,point)=>{
    if(busy)return;checkpoint();dimensionPositions={...dimensionPositions,[id]:point};render();
  }, e => pointerPoint(e, false), () => !constraints.tool.active());
  const dimensionTool = mountDimensionTool({
    svg, enabled: () => started && !busy && !constraints.tool.active(), drawing: () => drawing,
    point: e => pointerPoint(e, false),
    tolerance: () => surface ? 8 * (surface.scaleAt() ?? bounds.width / 800) : bounds.width / 100,
    chooseTool,
    selected: () => selectedEntities.length ? selectedEntities : selectedEntity ? [selectedEntity] : [],
    select: refs => { selectedEntities = [...refs]; selectedEntity = refs[0] ?? null; renderSelection(); },
    report: text => { message.textContent = text; },
    commit: (next, id, position) => {
      checkpoint(); drawing = next; dimensionPositions = { ...dimensionPositions, [id]: position };
      pending = []; cursor = null; render();
    },
  });
  const boxSelection = bindSketchBoxSelection({
    svg, enabled: () => started && !busy && activeTool === "select" && !dimensionTool.active() && !constraints.tool.active(),
    drawing: () => drawing, point: e => pointerPoint(e, false),
    tolerance: () => surface ? 8 * (surface.scaleAt() ?? bounds.width / 800) : bounds.width / 100,
    project: point => {
      if (surface?.toClient) return surface.toClient(point);
      const matrix = svg.getScreenCTM(); if (!matrix) return null;
      const p = svg.createSVGPoint(); p.x = point[0]; p.y = -point[1];
      const result = p.matrixTransform(matrix); return [result.x, result.y];
    },
    preview: (refs, add) => {
      if (refs === null) { renderSelection(); return; }
      const shown = [...new Map([...(add ? selectedEntities : []), ...refs].map(ref => [JSON.stringify(ref), ref])).values()];
      renderSketchSelection(svg, drawing, shown, bounds.width / 150);
    },
    select: (refs, add) => {
      annotationSelection?.clear();
      selectedEntities = [...new Map([...(add ? selectedEntities : []), ...refs].map(ref => [JSON.stringify(ref), ref])).values()];
      selectedEntity = selectedEntities[0] ?? null; selectedRegion = null; setPickedSketchRegion(null);
      renderSelection(); message.textContent = `${selectedEntities.length} sketch entities selected.`;
    },
  });
  const endpointGesture = bindEndpointDragGesture({
    svg,
    enabled: () => started && !busy && (tool === "tangent-arc" || tool === "arc" || isRectanglePlacement(tool)),
    hasPending: () => pending.length > 0,
    point: (e, start) => pointerPoint(e, true, start),
    begin: p => isRectanglePlacement(tool) ? p : tool === "arc" ? arcChordStart(drawing, activePath, p, bounds.width / 100)
      : placeTangentArc(drawing, [], p, bounds.width / 100, construction).pending[0],
    preview: (start, end) => { recentSizing.clear(); pending = [start]; cursor = end; renderPreview(); },
    clear: () => { pending = []; cursor = null; renderPreview(); },
    commit: (start, end, event) => {
      if (isRectanglePlacement(tool)) {
        place(start, true);
        place(end, true, false, event.altKey);
        return;
      }
      if (tool === "arc") {
        pending = arcChordPoints(start, end); cursor = null; render();
        return;
      }
      const result = placeTangentArc(drawing, [start], end, bounds.width / 100, construction);
      const previousContourCount = drawing.contours.length;
      checkpoint(); drawing = result.drawing; activePath = result.activePath;
      pending = []; cursor = null; render();
      recentSizing.offer(tool, previousContourCount, activePath);
    },
    report: text => { message.textContent = text; },
  });
  const trimGesture = bindTrimGesture(svg, {
    enabled: () => started && !busy && tool === "trim",
    point: pointerPoint,
    drawing: () => drawing,
    pointTolerance: () => {
      if (surface) {
        const scale = surface.scaleAt();
        if (scale) return 6 * scale;
      }
      const matrix = svg.getScreenCTM();
      const scale = matrix ? Math.hypot(matrix.a, matrix.b) : NaN;
      return Number.isFinite(scale) && scale > 0
        ? 6 / scale
        : (bounds.width * 6) / (svg.getBoundingClientRect().width || 800);
    },
    preview: (next) => {
      drawing = next;
      cursor = null;
      render();
    },
    commit: (original, next) => {
      drawing = next;
      if (next !== original) {
        history.checkpoint({ drawing: original, activePath, dimensionPositions, variables,sourceProfiles });
      }
      cursor = null;
      render();
    },
    error: (text) => {
      message.textContent = text;
    },
  });
  const selectionDrag = bindSelectionDrag({
    svg,
    enabled: () => started && !busy && activeTool === "select" && !dimensionTool.active() && !constraints.tool.active(),
    point: e => pointerPoint(e, false),
    snapping: () => geometrySnap,
    snapTolerance: () => surface
      ? 8 * (surface.scaleAt() ?? bounds.width / 800)
      : (bounds.width * 8) / Math.max(svg.getBoundingClientRect().width, 800),
    drawing: () => drawing,
    tolerance: () => bounds.width / 60,
    select: (ref) => {
      annotationSelection?.clear();
      selectedEntities = [ref]; selectedEntity = ref;
    },
    preview: (next) => {
      drawing = next;
      cursor = null;
      snapLabel = "";
      render();
    },
    commit: (before, next) => {
      drawing = next;
      cursor = null;
      snapLabel = "";
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        history.checkpoint({ drawing: before, activePath, dimensionPositions, variables,sourceProfiles });
      }
      render();
    },
    report: (text) => {
      message.textContent = text;
    },
  });
  svg.addEventListener("pointermove", (e) => {
    if (endpointGesture.active() || trimGesture.active() || selectionDrag.active()) return;
    if (activeTool === "select" && hoverConstraintMark(svg, pointerPoint(e, false))) {
      cursor = null;
      hoveredEntity = null;
      renderHoveredConstraints(svg, drawing, null);
      renderPreview();
      return;
    }
    cursor = pointerPoint(e);
    // Onshape reveals what constrains an entity as soon as you point at it,
    // whether or not constraint display is switched on.
    const hovered = cursor ? activeTool==='select' && !constraints.tool.active() ? pickSketchEditEntity(drawing,cursor,svg) : pickSelectableSketchEntity(drawing, cursor) : null;
    hoveredEntity = hovered && hovered.d < bounds.width / 60 ? hovered.ref : null;
    renderHoveredConstraints(svg, drawing, hoveredEntity);
    renderPreview();
  });
  svg.addEventListener("pointerleave", () => {
    cursor = null;
    hoveredEntity = null;
    hoverConstraintMark(svg, null);
    renderHoveredConstraints(svg, drawing, null);
    renderPreview();
  });
  svg.addEventListener("click", (e) => {
    if (boxSelection.consumeClick() || endpointGesture.consumeClick() || trimGesture.consumeClick() || selectionDrag.consumeClick()) return;
    if (activeTool === "select" && !constraints.tool.active() && hoverConstraintMark(svg, pointerPoint(e, false), true)) return;
    const p = pointerPoint(e, !constraints.tool.active());
    if (p) place(p, true, e.shiftKey || e.metaKey || e.ctrlKey, e.altKey);
  });
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      if (bounds.width * factor < 5 || bounds.width * factor > 10000) return;
      bounds = {
        x: bounds.x + (bounds.width * (1 - factor)) / 2,
        y: bounds.y + (bounds.height * (1 - factor)) / 2,
        width: bounds.width * factor,
        height: bounds.height * factor,
      };
      render();
    },
    { passive: false },
  );
  const workspaceKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.repeat || !started || busy) return;
    if (!isTypingTarget(e.target) && fitSpline.key(e)) return;
    if (!isTypingTarget(e.target) && tool === 'conic' && pending.length >= 2 && coordinates.conicRho.key(e)) return;
    recentSizing.key(e);
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !isTypingTarget(e.target) && ["z", "y"].includes(e.key.toLowerCase())) {
      e.preventDefault(); e.stopPropagation();
      (e.shiftKey || e.key.toLowerCase() === "y" ? historyActions.redo : historyActions.undo)();
      return;
    }
    if (["Delete", "Backspace"].includes(e.key) && !isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); selectionActions?.remove(); return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      chooseTool("select");
      message.textContent =
        "Select sketch edges or vertices. Click empty space to deselect.";
      return;
    }
    // The central keyboard map has always declared Onshape's single-letter
    // sketch bindings (shortcuts.ts). Nothing ever consulted it, so pressing
    // "l" or "r" in a sketch did nothing at all. A field that has focus still
    // types, and a modifier means the key belongs to the browser or the OS.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
      const command = shortcuts.commandFor(e);
      if (command && isCADCommandID(command) && cadCommands.snapshot()[command]?.registered) {
        e.preventDefault();
        cadCommands.execute(command);
        return;
      }
    }
    if (!surface && e.target !== svg) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      if (surface) return; // in-world: the 3D camera owns panning
      e.preventDefault();
      bounds.x +=
        ((e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) *
          bounds.width) /
        10;
      bounds.y +=
        ((e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0) *
          bounds.height) /
        10;
      render();
    }
  };
  const finishEvent = (event: Event) => {
    event.preventDefault();
    const complete = (event as CustomEvent<{complete?: (success: boolean) => void}>).detail?.complete;
    void finish().then(success => complete?.(success));
  };
  window.addEventListener("aether-sketch-finish", finishEvent);
  root.addEventListener("keydown", workspaceKey);
  svg.addEventListener("keydown", (e) => {
    if (!e.bubbles) workspaceKey(e);
  });
  // In-world mode the svg cannot take focus (pointer-events:none in the CSS3D
  // layer), so keyboard shortcuts listen globally, skipping sidebar-focused events
  // that the root listener already handles.
  const globalKey = (e: KeyboardEvent) => {
    if (e.target instanceof window.Node && root.contains(e.target)) return;
    workspaceKey(e);
  };
  cadSelection.dispatch({ type: "set-filter", filter: "face" });
  viewport.append(root);
  mountEditHistory(root, source, existing?.id);
  // Reopening: a face knows the feature that made it. A datum plane does not
  // leave a reference behind, so the plane it lies on is the honest answer.
  if (existing) start(plane, frame, support?.label,true);
  else {
    setChoosingPlane(true);
    render();
  }
}
