import { cadSnapping } from './cad-snapping-store';
import { paintSurfaceFace, setSurfaceGroups } from './viewport/surface-groups';
import { samePartGeometry } from './viewport/assembly-geometry';
import { projectSelectionManipulator, transformMatrix, type Point3 } from './viewport/selection-manipulator-math';
import type { NumericPartTransform } from '@aether/core/document';
import { TransparentViewportOutput } from './viewport/transparent-output';
import { modelStudioCamera } from '@aether/ui';
import { modelStudioEnvironment as studioLook } from '@aether/assets/themes/rendering/model-studio';
import { createStudioReflectionMap, rotateStudioReflectionMap } from './viewport/studio-reflections';
import { renderPixelRatio } from './viewport/render-resolution';
import { cadObjectAppearance } from './cad-object-appearance';
import {selectionCandidateDistance} from "./viewport/selection-proximity";
import {ImageCanvasLayer} from "./viewport/image-canvases";
import { StageRig } from "./viewport/stage-rig";
import { styledLines } from "./viewport/styled-lines";
import { gradientBackground } from "./viewport/environment-background";
import { updateSketchEnvironment } from "./sketch/environment-appearance";
import type { PlaneTheme } from "./viewport/appearance-themes";
import type { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js";
import { TopologyAnchorPicker, anchorSelection, anchorWorldPoint, type AnchorFace } from './viewport/topology-anchors';
import { TopologyAnchorOverlay } from './viewport/topology-anchor-overlay';
import { selectedCandidateId } from "./viewport/topology-selection";
import {anchorForPlanarFace,planarFaceCandidates,planarFaceCenter} from './viewport/planar-face-reference';
import {pickHistoryFace} from './viewport/history-face-picking';
import type {PlanarFaceAnchor} from '@aether/core/document';
import { extrusionAxisDepth } from "./viewport/extrusion-axis";
import {projectTransformGizmo,type TransformGizmoRequest} from './viewport/transform-gizmo';
import { SectionLayer } from "./viewport/section-layer";
import { projectSection } from "./section/section-projection";
import { inspectGeometry } from "./measure/inspection-geometry";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { sectionClipPlane, type SectionCut, type SectionView } from "./section/section-view-store";
import {changeCameraProjection, cameraAspect, setOrthographicSpan, resizeModelingCamera, type ModelingCamera, type CameraProjection} from "./viewport/camera-projection";
import { CameraRotationMotion } from "./viewport/camera-rotation";
import { OrientationPreviewMotion, visiblePreviewBounds } from "./viewport/orientation-preview";
import { bindSketchCameraInput, isSketchCameraGesture } from "./viewport/sketch-surface-input";
import { createOriginMarker } from "./viewport/origin-marker";
import type { ImportedModelData } from "./domain";
import { FeaturePreviewLayer } from "./modeling/feature-preview-layer";
import { RegionPicker } from "./modeling/region-picker";
import { createPlaneVisual, tintPlane, updatePlaneVisual } from "./plane-visual";
import type { SketchPlane } from "@aether/core/document";
/** Orange is the app-wide "selected" colour, matching Onshape: whatever a
 *  feature is currently using reads orange in the viewport. */
const SELECTION_COLOR = 0xf59f42;
/** Principal sketch plane -> the reference geometry that draws it. Inverse of
 *  sketchPlaneForReference, so highlighting and picking agree. */
const REFERENCE_FOR_PLANE: Record<SketchPlane, ReferenceGeometryId> = {
  XY: "top-plane",
  XZ: "front-plane",
  YZ: "right-plane",
};
import { canonicalPlaneXDirection, principalFrame, resolveAxisLine, resolvePointPosition } from "@aether/core/document";
import { sketchPlaneForReference } from "./reference-geometry";
import { cadViewportMetrics } from "./cad-viewport-metrics-store";
import { accelerateSurfacePicking } from './viewport/surface-picking';
import { viewportRendererOptions } from './viewport/renderer-backend';
import { constructionPlaneFrame, rollbackPosition } from "@aether/core/document";
import type { PartDocument as PlaneDocument } from "@aether/core/document";
import * as THREE from "three/webgpu";
// The picking arithmetic lives in ./viewport/picking-math, where it can be
// tested without a renderer.
import { applySurfaceAppearance } from "./viewport/surface-appearance";
import { resolvePartDisplay, type PartDisplayOverride } from "./viewport/part-display";
import { resolveAppearance } from "./viewport/appearance-themes";
import { readViewportThemeOverride } from "./viewport/suite-viewport-theme";
import {
  buildOrientationCube,
  orientationCubeFraming,
  disposeOrientationCube,
  paintOrientationHover,
  plateCameraAction,
  plateUnderRay,
  type OrientationCube,
} from "./viewport/orientation-cube";
import {
  faceIdForTriangle,
  hoverKey,
  localBounds,
  projectScreenPoint,
} from "./viewport/picking-math";
import { itemsInsideLasso } from "./viewport/freeform-selection";
import { SelectionStroke } from "./viewport/selection-stroke";
import { itemsInsideSelectionBox } from "./viewport/box-selection";
import { type ViewportUpAxis } from "@aether/ui";
import { createCADCameraControls, type CADCameraControls } from "./viewport/camera-controls";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import type { AssemblyPartRow } from "./assembly-tree";
import {
  connectorMatrix,
  FastenedMateDraft,
  MateConnectorRegistry,
  MateConstraintTracker,
  solveFastenedMate,
  type AppliedMate,
  type ConnectorCandidate,
  type ConnectorKind,
  type FaceRangeData,
  type FaceTopologyData,
  type MateConnector,
  type PartGeometryData,
} from "./aether-core";
import {
  createConnectorGizmo,
  disposeTransientGeometry,
  type ConnectorMarker,
} from "./connector-visuals";
import {
  cadDisplayStylePolicy,
  viewportMaterials,
} from "./viewport-appearance";
import {
  cameraViewDefinition,
  cameraUpForDirection,
  nudgeCameraBasis,
  rollCameraBasis,
  type CameraQuaternion,
  type StandardCameraView,
} from "./camera-view";
import type { ReferenceGeometryId } from "./reference-geometry";
import type { CADAppearanceSnapshot } from "./cad-appearance-store";
import {
  effectiveSelectionKind,
  boxSelectionMode,
  cadSelection,
  normalizedSelectionBox,
  selectedPartIDs,
  type CADBoxSelectionMode,
  type CADSelectionItem,
  type CADScreenRect,
} from "./cad-selection-store";

interface RenderPart {
  data: PartGeometryData;
  visible: boolean;
  group: THREE.Group;
  surface: THREE.Mesh;
  edges: LineSegments2;
  topology: Map<number, FaceTopologyData>;
  faceRanges: FaceRangeData[];
}

interface CandidateHover {
  kind: "candidate";
  part: RenderPart;
  faceId: number;
  candidate: ConnectorCandidate;
}

interface ConnectorHover {
  kind: "connector";
  connector: MateConnector;
}

type HoverTarget = CandidateHover | ConnectorHover;
interface SelectionHover {
  item: CADSelectionItem;
  part: RenderPart;
  faceId?: number;
}

export type AuthoringTool = "none" | "connector" | "fastened";

export interface HoverPresentation {
  partName: string;
  label: string;
  detail: string;
}

export interface ViewerCallbacks {
  onHover(target: HoverPresentation | null): void;
  onStatus(message: string, tone?: "normal" | "error" | "success"): void;
  onStateChanged(): void;
  onMateApplied(mate: AppliedMate): void;
  onCameraChanged(orientation: CameraQuaternion): void;
}

export interface TopologyInferenceSummary {
  faceCount: number;
  candidateCount: number;
  candidatesByKind: Record<ConnectorKind, number>;
}

const emptyCandidateCounts = (): Record<ConnectorKind, number> => ({
  "face-center": 0,
  "edge-midpoint": 0,
  vertex: 0,
  "circle-center": 0,
  "ellipse-center": 0,
  "cylinder-axis": 0,
  "cone-axis": 0,
  "sphere-center": 0,
  "torus-center": 0,
});

export class MateViewport {
  private readonly renderer: THREE.WebGPURenderer;
  private readonly output: TransparentViewportOutput;
  private readonly scene = new THREE.Scene();
  private readonly imageCanvases = new ImageCanvasLayer();
  setImageCanvases(canvases:import("@aether/core/document").ImageCanvas[] = []) { this.scene.add(this.imageCanvases.group); this.imageCanvases.set(canvases,this.parts); }
  private camera: ModelingCamera = new THREE.PerspectiveCamera(studioLook.camera.fieldOfViewDegrees, 1, 0.1, 1_000_000);
  private controls: CADCameraControls;
  private workspaceUpAxis: ViewportUpAxis = "z";
  private readonly featurePreview = new FeaturePreviewLayer();
  private readonly historyPreview = new FeaturePreviewLayer();
  private historyEditing = false;
  private sourceGeometryPicking: 'face'|'body'|'vertex'|'edge'|null = null;
  setSourceFacePicking(active: boolean) { this.sourceGeometryPicking = active?'face':null; }
  setSourceEdgePicking(active: boolean) { this.sourceGeometryPicking = active?'edge':null; }
  setSourceVertexPicking(active: boolean) { this.sourceGeometryPicking = active?'vertex':null; }
  setSourceBodyPicking(active: boolean) { this.sourceGeometryPicking = active?'body':null; }
  /** While Measure is open, each click adds or removes an entity, like Onshape. */
  private measurePicking = false;
  private measurePointPicking = false;
  private readonly anchorPicker = new TopologyAnchorPicker();
  private anchorOverlay!: TopologyAnchorOverlay;
  private anchorFace: AnchorFace | null = null;
  private anchorPointer: { clientX: number; clientY: number } | null = null;

  setMeasurePicking(active: boolean, points = false): void {
    if (active && this.tool !== "none") this.setTool("none");
    this.measurePicking = active;
    this.measurePointPicking = active && points;
    this.clearAnchors();
    this.selectionHover = null;
    cadSelection.dispatch({ type: 'set-hovered', item: null });
    this.callbacks.onHover(null);
    this.resetFaceMaterials();
  }

  private clearAnchors(): void {
    this.anchorPointer = null;
    this.anchorPicker.clear();
    this.anchorOverlay?.set(null);
    this.anchorFace = null;
  }

  private pickAnchors(event: { clientX: number; clientY: number }) {
    this.anchorPointer = { clientX: event.clientX, clientY: event.clientY };
    const rect = this.renderer.domElement.getBoundingClientRect();
    const snapping = cadSnapping.snapshot();
    const anchorParts = [...this.parts.values()].flatMap(part => {
      const cap = this.measurePicking ? this.section.inspectionPart(part.group) : null;
      return cap ? [part, cap] : [part];
    });
    const pick = this.anchorPicker.pick(this.modelRoot.visible && snapping.enabled && snapping.geometry ? anchorParts : [], this.camera, rect,
      { x: event.clientX - rect.left, y: event.clientY - rect.top }, (id, point) => this.section.hides(id, point));
    this.anchorFace = pick.face;
    this.anchorOverlay.set(pick);
    this.anchorOverlay.render(point => this.projectScreenPoint(point));
    this.resetFaceMaterials();
    return pick;
  }

  private anchorSelectionHit(event: { clientX: number; clientY: number }): SelectionHover | null {
    const anchor = this.pickAnchors(event).snapped;
    const part = anchor && this.parts.get(anchor.part.data.id);
    return anchor && part ? { part, faceId: anchor.faceId, item: anchorSelection(anchor) } : null;
  }
  private canPickSourceGeometry() { return this.sourceGeometryPicking!==null && cadSelection.snapshot().filter === this.sourceGeometryPicking; }
  private historyModel: ImportedModelData | null = null;
  setHistoryPreview(model: ImportedModelData | null, active: boolean): void {
    if (!this.historyPreview.group.parent) this.scene.add(this.historyPreview.group);
    this.historyEditing = active;
    this.historyModel = active ? model : null;
    this.historyPreview.set(model, false);
    this.updatePreviewVisibility();
  }
  private updatePreviewVisibility(): void {
    this.featurePreview.setVisibility(id=>this.parts.get(id)?.group.visible??true);
    this.modelRoot.visible = !this.historyEditing && !this.featurePreview.active;
    this.historyPreview.group.visible = this.historyEditing && !this.featurePreview.active;
  }
  setFeaturePreview(model: ImportedModelData | null): void {
    if (!this.featurePreview.group.parent) this.scene.add(this.featurePreview.group);
    this.featurePreview.set(model);
    this.updatePreviewVisibility();
  }
  private readonly modelRoot = new THREE.Group();
  private readonly overlayRoot = new THREE.Group();
  private readonly referenceRoot = new THREE.Group();
  private readonly section = new SectionLayer(this.modelRoot, this.overlayRoot);
  private sketchPlaneSelection = false;
  setSketchPlaneSelection(active:boolean) { this.sketchPlaneSelection=active; }

  private readonly referenceObjects = new Map<ReferenceGeometryId, THREE.Object3D>();
  private readonly stage: StageRig;
  private backgroundTexture: THREE.DataTexture | null = null;
  private backgroundKey = "";
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly parts = new Map<string, RenderPart>();
  private readonly studioReflectionMap = createStudioReflectionMap();
  private readonly partDisplay = new Map<string, PartDisplayOverride>();
  private readonly documentPartDisplay = new Map<string, PartDisplayOverride>();
  private isolation: string | null = null;
  private readonly constraints = new MateConstraintTracker();
  private readonly connectorRegistry = new MateConnectorRegistry();
  private readonly mateDraft = new FastenedMateDraft();
  private readonly connectorMarkers = new Map<string, ConnectorMarker>();
  private readonly usedConnectorIds = new Set<string>();
  private readonly initialMatrices = new Map<string, THREE.Matrix4>();
  private hover: HoverTarget | null = null;
  private selectionHover: SelectionHover | null = null;
  private tool: AuthoringTool = "none";
  private markerScale = 10;
  private selectionStroke: SelectionStroke | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private appearance: CADAppearanceSnapshot | null = null;
  private frameSample = { frames: 0, renderMs: 0, since: 0, last: 0 };
  private appliedPlaneTheme = "";
  private planeTheme: PlaneTheme | null = null;
  private cssRenderer: CSS3DRenderer | null = null;
  private readonly cssScene = new THREE.Scene();
  private orientationBox: OrientationCube | null = null;
  private readonly orientationMotion = new OrientationPreviewMotion();
  private readonly cameraRotation = new CameraRotationMotion();
  private fieldOfViewDegrees: number = studioLook.camera.fieldOfViewDegrees;
  private orientationCamera: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; near: number; far: number; orthographicSpan?: number } | null = null;
  private sketchSurface: {
    object: CSS3DObject;
    disposeInput: () => void;
    svg: SVGSVGElement;
    origin: THREE.Vector3;
    xDir: THREE.Vector3;
    yDir: THREE.Vector3;
    normal: THREE.Vector3;
  } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ViewerCallbacks,
  ) {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true,
      ...viewportRendererOptions(navigator.userAgent, navigator.vendor) });
    this.output = new TransparentViewportOutput(this.renderer, this.scene, this.camera);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.setAnimationLoop(() => this.render());
    this.renderer.domElement.className = "viewport-canvas";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "3D CAD model");
    this.container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x151718);
    this.scene.add(this.referenceRoot, this.modelRoot, this.overlayRoot);
    const initial = modelStudioCamera.views.perspective;
    this.camera.position.set(initial[0]*25, -initial[2]*25, initial[1]*25);
    this.camera.up.set(0, 0, 1);

    this.controls = createCADCameraControls(this.camera, this.renderer.domElement, () => this.publishCameraOrientation());
    this.controls.target.set(0, 0, modelStudioCamera.target[1]*25);
    this.controls.update();
    window.addEventListener("aether-sketch-normal-view", () => {
      const surface = this.sketchSurface;
      if (!surface) return;
      this.cameraRotation.cancel();
      this.orientationMotion.cancel();
      this.controls.update();
      const distance = Math.max(100, this.camera.position.distanceTo(this.controls.target));
      this.controls.target.copy(surface.origin);
      this.camera.position.copy(surface.origin).addScaledVector(surface.normal, distance);
      this.camera.up.copy(surface.yDir);
      this.camera.lookAt(surface.origin);
      this.controls.update();
      this.publishCameraOrientation();
    });


    this.anchorOverlay = new TopologyAnchorOverlay(this.container);
    this.stage = new StageRig(this.scene);
    this.updateWorkspaceGround();
    this.buildReferenceGeometry();

    this.renderer.domElement.addEventListener("pointermove", (event) => {
      if (this.forwardToSketch(event)) return;
      this.pointerMoved(event);
    });
    this.renderer.domElement.addEventListener("wheel", () => { this.orientationMotion.cancel(); this.cameraRotation.cancel(); }, { passive: true });
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      this.orientationMotion.cancel();
      this.cameraRotation.cancel();
      if (this.forwardToSketch(event)) return;
      if (event.button === 0) {
        this.pointerDown = { x: event.clientX, y: event.clientY };
        if (this.tool === "none" && !this.historyEditing && !this.featurePreview.active && !this.sketchPlaneSelection && !this.regionPicker.group.children.length) {
          this.renderer.domElement.setPointerCapture(event.pointerId);
          const mode = cadSelection.snapshot().dragMode;
          if (mode === "freeform" || mode === "paint") {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.selectionStroke = new SelectionStroke(mode, {x:event.clientX-rect.left,y:event.clientY-rect.top},
              p => this.selectionHit({clientX:p.x+rect.left,clientY:p.y+rect.top})?.item ?? null);
            cadSelection.dispatch({type:"set-stroke",stroke:this.selectionStroke.snapshot()});
          }
        }
      }
    });
    this.renderer.domElement.addEventListener("pointerup", (event) => {
      if (this.forwardToSketch(event)) return;
      this.pointerUp(event);
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    });
    this.renderer.domElement.addEventListener("pointercancel", (event) => {
      this.forwardToSketch(event);
      this.cancelSelectionGesture();
    });
    window.addEventListener("keydown", event => { if (event.key === "Escape") this.cancelSelectionGesture(); });
    window.addEventListener("blur", () => this.cancelSelectionGesture());
    this.renderer.domElement.addEventListener("click", (event) => {
      this.forwardToSketch(event);
    });
    this.renderer.domElement.addEventListener("dblclick", (event) => {
      this.forwardToSketch(event);
    });
    this.renderer.domElement.addEventListener("pointerleave", (event) => {
      if (this.forwardToSketch(event)) return;
      if (this.pointerDown) return;
      this.clearAnchors();
      if (this.tool !== "none") { this.setHover(null); return; }
      this.selectionHover = null;
      cadSelection.dispatch({ type: "set-hovered", item: null });
      cadSelection.dispatch({ type: "set-box", box: null });
      this.resetFaceMaterials();
      this.callbacks.onHover(null);
    });
    this.renderer.domElement.addEventListener("contextmenu", (event) =>
      event.preventDefault(),
    );
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
    this.publishCameraOrientation();
  }

  get backendLabel(): string {
    const backend = this.renderer.backend as unknown as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
    return backend.isWebGLBackend ? 'Three.js WebGL2' : backend.isWebGPUBackend ? 'Three.js WebGPU' : 'Three.js initializing';
  }

  get activeTool(): AuthoringTool {
    return this.tool;
  }

  get firstMateConnector(): MateConnector | null {
    return this.mateDraft.movingConnector;
  }

  setAppearance(appearance: CADAppearanceSnapshot): void {
    this.appearance = appearance;
    // What each render environment looks like lives in ./viewport/appearance-themes.
    // A suite viewport theme, if one is chosen, restyles the stage; CAD's
    // environment still owns lighting, finish and display style.
    const resolved = resolveAppearance(appearance, readViewportThemeOverride());
    this.planeTheme = resolved.planeTheme;
    const planeKey = JSON.stringify(resolved.planeTheme);
    if (this.appliedPlaneTheme !== planeKey) {
      this.appliedPlaneTheme = planeKey;
      this.rebuildReferencePlanes(resolved.planeTheme);
      for (const group of this.constructionPlanes.children) if (!group.userData.axisLine) updatePlaneVisual(group as THREE.Group, resolved.planeTheme.colors.custom, resolved.planeTheme.style);
    }
    for (const child of this.sketchCurveGroup.children) {
      const line = child as LineSegments2;
      line.material.color.setHex(resolved.sketchStroke); line.material.linewidth = resolved.sketchLineWidth;
    }
    if (this.sketchSurface) updateSketchEnvironment(this.sketchSurface.svg, resolved);
    const background = resolved.background;
    const policy = cadDisplayStylePolicy(appearance.displayStyle, appearance.edgesVisible);
    const backgroundKey = JSON.stringify([resolved.backgroundMode, background, resolved.backgroundBottom]);
    if (backgroundKey !== this.backgroundKey) {
      this.backgroundKey = backgroundKey;
      this.backgroundTexture?.dispose();
      this.backgroundTexture = resolved.backgroundMode === "gradient" ? gradientBackground(background, resolved.backgroundBottom) : null;
      this.scene.background = this.backgroundTexture;
      // Keep the solid stage in CSS so it matches the surrounding workspace
      // independently of the renderer's lighting and output color transform.
      this.renderer.domElement.style.backgroundColor = `#${background.toString(16).padStart(6, "0")}`;
      this.renderer.setClearColor(0x000000, 0);
    }
    const pixelRatio = renderPixelRatio(appearance.renderScale, window.devicePixelRatio);
    if (this.renderer.getPixelRatio() !== pixelRatio) { this.renderer.setPixelRatio(pixelRatio); this.resize(); }
    this.renderer.toneMapping = resolved.colorTransform === "standard" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = resolved.exposure;
    this.scene.environment = appearance.studioReflections === false ? null : this.studioReflectionMap;
    this.scene.environmentIntensity = (appearance.reflectionIntensityPercent ?? 45) / 100 * appearance.environmentPercent / 100 * (resolved.colorTransform === "standard" ? resolved.exposure : 1);
    rotateStudioReflectionMap(this.studioReflectionMap, appearance.reflectionRotationDegrees ?? 0);
    this.scene.environmentRotation.set(this.workspaceUpAxis === "z" ? Math.PI / 2 : 0, 0, 0);
    this.stage.apply(resolved, appearance);
    const surfaceMaterials = [
      viewportMaterials.part,
      viewportMaterials.hoveredFace,
      viewportMaterials.selectedFace,
    ];
    viewportMaterials.hoveredFace.color.setHex(resolved.hoverColor);
    viewportMaterials.selectedFace.color.setHex(resolved.selectionColor);
    applySurfaceAppearance(surfaceMaterials, policy, resolved);
    const applyReflections = (materials: THREE.MeshStandardMaterial[]) => {
      for (const material of materials) {
        material.envMap = this.scene.environment;
        material.envMapIntensity = policy.masksSurfaceWithBackground ? 0 : this.scene.environmentIntensity;
        material.envMapRotation.copy(this.scene.environmentRotation);
        material.needsUpdate = true;
      }
    };
    applyReflections(surfaceMaterials);
    this.parts.forEach((part) => {
      const materials = part.surface.material as THREE.MeshStandardMaterial[];
      materials[1].color.setHex(resolved.hoverColor); materials[2].color.setHex(resolved.selectionColor);
      const override = this.getPartDisplay(part.data.id), partAppearance = resolvePartDisplay(resolved, override);
      applySurfaceAppearance(materials, policy, partAppearance);
      applyReflections(materials);
      part.edges.visible = policy.edgesVisible && override.edgesVisible !== false;
      const material = part.edges.material;
      material.linewidth = partAppearance.edgeWidth;
      material.color.setHex(partAppearance.edgeColor);
      material.opacity = appearance.displayStyle === "hidden-line" ? 1 : partAppearance.edgeOpacity;
      material.transparent = material.opacity < 1;
      material.needsUpdate = true;
    });
  }

  /** Exact topology candidates behind the current vertex selections, in world
   *  space. Three of these define a plane. */
  projectMeasurementPoints(points: readonly (readonly [number, number, number])[]) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return points.map(point => {
      const projected = this.projectScreenPoint(new THREE.Vector3(...point));
      return projected ? { x: projected.x + rect.left, y: projected.y + rect.top } : null;
    });
  }

  selectedPoints(items = cadSelection.snapshot().items): { selectionId: string; partId: string; candidateId: string; label: string; positionMillimeters: [number, number, number] }[] {
    const picked: ReturnType<MateViewport["selectedPoints"]> = [];
    for (const item of items) {
      if (item.kind !== "vertex") continue;
      const found = this.candidateFor(item);
      if (!found) continue;
      const { matrix, candidate } = found;
      const origin = new THREE.Vector3(...candidate.origin).applyMatrix4(matrix);
      picked.push({
        selectionId: item.id,
        partId: item.partId,
        candidateId: candidate.id,
        label: item.label,
        positionMillimeters: [origin.x, origin.y, origin.z],
      });
    }
    return picked;
  }

  selectedExtrusionVertex(documentId:string) {
    const items=cadSelection.snapshot().items,item=items[0];
    if(items.length!==1||item.kind!=='vertex')return null;
    const part=this.historyEditing?this.historyModel?.parts.find(p=>p.id===item.partId):this.parts.get(item.partId)?.data;
    if(!part||part.sourceDocumentId!==documentId||part.geometryKind==='mesh')return null;
    const candidate=this.candidateFor(item)?.candidate;
    return candidate?.vertexAnchor?{bodyId:item.partId,anchor:structuredClone(candidate.vertexAnchor),label:item.label}:null;
  }

  selectedTransformEdge(documentId:string) {
    const items=cadSelection.snapshot().items,item=items[0];
    if(items.length!==1||item.kind!=='edge')return null;
    const part=this.historyEditing?this.historyModel?.parts.find(p=>p.id===item.partId):this.parts.get(item.partId)?.data;
    if(!part||part.sourceDocumentId!==documentId||part.geometryKind==='mesh')return null;
    const candidate=this.candidateFor(item)?.candidate;
    return candidate?.edgeAnchor&&candidate.measurements?.linearDirection?{bodyId:item.partId,anchor:structuredClone(candidate.edgeAnchor),label:item.label}:null;
  }

  /** Every selected edge on this document's parts, as a finish reference: a straight
   *  edge by its vertex anchors, any other by midpoint and length (native coordinates). */
  selectedFinishEdges(documentId:string):Array<{bodyId:string;label:string}&({kind:'solid-edge';anchor:import("@aether/core/document").SolidEdgeAnchor}|{kind:'curved-edge';midpointMillimeters:[number,number,number];lengthMillimeters:number;radiusMillimeters?:number})>|null {
    const items=cadSelection.snapshot().items.filter(item=>item.kind==='edge');
    if(!items.length)return null;
    const out=[] as NonNullable<ReturnType<MateViewport['selectedFinishEdges']>>;
    for(const item of items){
      const part=this.historyEditing?this.historyModel?.parts.find(p=>p.id===item.partId):this.parts.get(item.partId)?.data;
      const candidate=this.candidateFor(item)?.candidate;
      if(!part||part.sourceDocumentId!==documentId||part.geometryKind==='mesh'||!candidate)return null;
      if(candidate.edgeAnchor&&candidate.measurements?.linearDirection)out.push({kind:'solid-edge',bodyId:item.partId,anchor:structuredClone(candidate.edgeAnchor),label:item.label});
      else if(candidate.measurements?.lengthMillimeters)out.push({kind:'curved-edge',bodyId:item.partId,midpointMillimeters:[...candidate.origin] as [number,number,number],lengthMillimeters:candidate.measurements.lengthMillimeters,...(candidate.measurements.radiusMillimeters?{radiusMillimeters:candidate.measurements.radiusMillimeters}:{}),label:item.label});
      else return null;
    }
    return out;
  }

  /** The selected edge as an origin and direction, for an angled plane. */
  selectedAxis(): { partId: string; candidateId: string; label: string; originMillimeters: [number, number, number]; directionMillimeters: [number, number, number] } | null {
    const item = cadSelection.snapshot().items.find((entry) => entry.kind === "edge");
    if (!item) return null;
    const found = this.candidateFor(item);
    if (!found) return null;
    const { matrix, candidate } = found;
    // A straight edge is its own axis; a circular edge gives the circle's axis through
    // its centre (SolidCraft's axis through a cylinder, cone or torus by a rim pick).
    const m = candidate.measurements;
    const circular = !m?.linearDirection && m?.centerMillimeters && m.axisDirection;
    if (!m?.linearDirection && !circular) return null;
    const origin = new THREE.Vector3(...(circular ? m!.centerMillimeters! : candidate.origin)).applyMatrix4(matrix);
    const direction = new THREE.Vector3(...(circular ? m!.axisDirection! : m!.linearDirection!)).transformDirection(matrix);
    return {
      partId: item.partId,
      candidateId: candidate.id,
      label: item.label,
      originMillimeters: [origin.x, origin.y, origin.z],
      directionMillimeters: [direction.x, direction.y, direction.z],
      ...(m!.linearDirection && m!.lengthMillimeters ? { lengthMillimeters: m!.lengthMillimeters } : {}),
    };
  }

  /** Where the last face click landed, with the surface normal there (world): what a
   *  tangent plane needs from a curved face. Null until a face is clicked. */
  private lastSurfaceHit: { partId: string; faceId: number; point: THREE.Vector3; normal: THREE.Vector3 } | null = null;
  selectedSurfacePoint(): { partId: string; faceId: number; label: string; pointMillimeters: [number, number, number]; normalMillimeters: [number, number, number] } | null {
    const item = cadSelection.snapshot().items.find((entry) => entry.kind === "face");
    const hit = this.lastSurfaceHit;
    if (!item || !hit || hit.partId !== item.partId || hit.faceId !== item.faceId) return null;
    return { partId: item.partId, faceId: hit.faceId, label: item.label, pointMillimeters: [hit.point.x, hit.point.y, hit.point.z], normalMillimeters: [hit.normal.x, hit.normal.y, hit.normal.z] };
  }

  /** The raycast under the pointer for the part just picked: its point and smooth normal, in world. */
  private rememberSurfaceHit(part: RenderPart, faceId: number): void {
    const hit = this.raycaster.intersectObject(part.surface, false)[0];
    if (!hit) { this.lastSurfaceHit = null; return; }
    const normal = (hit.face?.normal ?? new THREE.Vector3(0, 0, 1)).clone().transformDirection(part.group.matrixWorld).normalize();
    this.lastSurfaceHit = { partId: part.data.id, faceId, point: hit.point.clone(), normal };
  }

  /** Selection ids are `kind:partId:candidateId`; recover the candidate. */
  private candidateFor(item: { id: string; partId: string }) {
    const rendered = this.parts.get(item.partId);
    const data = this.historyEditing ? this.historyModel?.parts.find(p => p.id === item.partId) : rendered?.data;
    if (!data) return null;
    rendered?.group.updateWorldMatrix(true, false);
    const matrix = this.historyEditing ? new THREE.Matrix4() : rendered!.group.matrixWorld;
    const candidateId = selectedCandidateId(item);
    const cap = rendered ? this.section.inspectionPart(rendered.group) : null;
    for (const face of [...data.topology,...(cap?.data.topology ?? [])]) {
      const candidate = face.candidates.find((entry) => entry.id === candidateId);
      if (candidate) return { matrix, candidate };
    }
    return null;
  }

  selectedTopologyMeasurements(items = cadSelection.snapshot().items) {
    return items.flatMap(item => {
      const rendered = this.parts.get(item.partId);
      const cap = rendered && (item.id.startsWith('section-face:') || item.id.includes(':section-section-plane-')) ? this.section.inspectionPart(rendered.group) : null;
      const data = this.historyEditing ? this.historyModel?.parts.find(part => part.id === item.partId) : cap?.data ?? rendered?.data;
      if (!data) return [];
      rendered?.group.updateWorldMatrix(true, false);
      const result = inspectGeometry(data, this.historyEditing ? new THREE.Matrix4() : rendered!.group.matrixWorld, item);
      return result ? [result] : [];
    });
  }

  measurementPlacement(partId: string): number[] | null {
    const part = this.parts.get(partId);
    if (!part) return null;
    part.group.updateWorldMatrix(true, false);
    return part.group.matrixWorld.toArray();
  }

  /** Which face is selected, for features that store the reference rather than
   *  just its geometry. Null when the selection is not a single face. */
  selectedFaceIdentity(): { partId: string; faceId: number; label: string } | null {
    const data = this.selectedFaceData();
    if (!data) return null;
    const {part,selected} = data;
    return {
      partId: selected.partId,
      faceId: selected.faceId!,
      label: `Face ${part.faceRanges.findIndex(r=>r.faceId===selected.faceId)+1}`,
    };
  }

  private selectedFaceData(selection?:CADSelectionItem) {
    const items=cadSelection.snapshot().items,selected=selection??items[0];
    if((!selection&&items.length!==1)||!selected||selected.kind!=='face'||selected.faceId===undefined)return null;
    const rendered=this.parts.get(selected.partId);
    const part=this.historyEditing?this.historyModel?.parts.find(p=>p.id===selected.partId):rendered?.data;
    const topology=part?.topology.find(f=>f.id===selected.faceId);
    if(!part||!topology)return null;
    rendered?.group.updateWorldMatrix(true,false);
    return {selected,part,topology,matrix:this.historyEditing?new THREE.Matrix4():rendered!.group.matrixWorld};
  }

  selectedImageFace(documentId?:string):import("@aether/core/document").ImageCanvas['face'] {
    const data=this.selectedFaceData();if(!data||!documentId||data.part.sourceDocumentId!==documentId||data.topology.surfaceType!=="PLANE")return undefined;
    const center=planarFaceCenter(data.topology),anchor=this.selectedFaceAnchor();
    if(!center||anchor===null)return undefined;
    return {bodyId:data.part.id,normal:[...center.zAxis],...(anchor?{anchor}: {})};
  }

  selectedStoppingFace(documentId:string) {
    const data=this.selectedFaceData();
    if(!data||data.part.sourceDocumentId!==documentId||data.part.geometryKind==='mesh')return null;
    return this.nativeFaceReference(data);
  }

  selectedOffsetFaces(documentId:string) {
    const selected=cadSelection.snapshot().items;
    if(!selected.length)return null;
    const faces=selected.map(item=>{
      const data=this.selectedFaceData(item);
      return data&&data.part.sourceDocumentId===documentId&&data.part.geometryKind!=='mesh'?this.nativeFaceReference(data):null;
    });
    return faces.every(face=>face!==null)?faces:null;
  }

  private nativeFaceReference(data:NonNullable<ReturnType<MateViewport['selectedFaceData']>>) {
    const {part,topology}=data;
    const label=`Face ${part.faceRanges.findIndex(range=>range.faceId===topology.id)+1}`;
    if(topology.surfaceReference)return {bodyId:part.id,label,...structuredClone(topology.surfaceReference)};
    if(topology.surfaceType!=='PLANE')return null;
    const center=planarFaceCenter(topology),faceAnchor=anchorForPlanarFace(part.topology,topology.id);
    if(!center||faceAnchor===null)return null;
    return {bodyId:part.id,label,normal:[...center.zAxis] as [number,number,number],...(faceAnchor?{faceAnchor}:{}),centerMillimeters:[...center.origin] as [number,number,number]};
  }

  selectedFaceAnchor():PlanarFaceAnchor|null|undefined {
    const data=this.selectedFaceData();
    return data?anchorForPlanarFace(data.part.topology,data.topology.id):null;
  }

  /** Where a face sits in its part, counting from one.
   *
   *  The id is a hash: it is what the engine matches on and what a saved
   *  reference stores, but "Face -1154006771" tells a reader nothing. The
   *  ordinal is what Onshape shows.
   */
  private faceOrdinal(part: RenderPart, faceId: number): number {
    const index = part.faceRanges.findIndex((range) => range.faceId === faceId);
    return index < 0 ? 1 : index + 1;
  }

  selectedSketchFrame(selection?: CADSelectionItem): import("@aether/core/sketch").SketchFrame | null {
    const data=this.selectedFaceData(selection);
    if(!data||data.topology.surfaceType!=="PLANE")return null;
    const {topology,matrix}=data;
    const candidate=planarFaceCenter(topology);
    if(!candidate) return null;
    const origin=new THREE.Vector3(...candidate.origin).applyMatrix4(matrix);
    const normal=new THREE.Vector3(...candidate.zAxis).transformDirection(matrix);
    // NOT the kernel's candidate.xAxis: that is the face's own surface
    // parameterization, so two coplanar faces can report different in-plane
    // rotations and a sketch on a face would sit rotated against the identical
    // sketch on a datum plane. Derive it from the normal instead — the same
    // rule principalFrame follows, so every plane in the document agrees.
    const x=canonicalPlaneXDirection([normal.x,normal.y,normal.z]);
    return {originMillimeters:[origin.x,origin.y,origin.z],xDirection:x,normal:[normal.x,normal.y,normal.z]};
  }

  getPartRows(): AssemblyPartRow[] {
    const selectedParts = selectedPartIDs(cadSelection.snapshot());
    return [...this.parts.values()].map((part) => ({
      id: part.data.id,
      name: part.data.name,
      sourceDocumentId: part.data.sourceDocumentId,
      sourceName: part.data.sourceName,
      constrained: this.constraints.isConstrained(part.data.id),
      visible: part.group.visible,
      selected: selectedParts.has(part.data.id),
    }));
  }

  selectPart(id: string): void {
    const part = this.parts.get(id);
    if (!part) return;
    cadSelection.dispatch({
      type: "toggle",
      items: [{ id: `body:${id}`, kind: "body", partId: id, label: part.data.name }],
    });
    this.resetFaceMaterials();
    this.callbacks.onStateChanged();
  }

  refreshSelectionAppearance(): void {
    if (this.selectionStroke && !cadSelection.snapshot().stroke) {
      this.selectionStroke=null;
      this.pointerDown=null;
    }
    if (cadSelection.snapshot().hovered === null && this.selectionHover !== null) {
      this.selectionHover = null;
      this.callbacks.onHover(null);
    }
    this.resetFaceMaterials();
  }

  setPartVisibility(id: string, visible: boolean): void {
    const part = this.parts.get(id);
    if (!part) return;
    this.clearAnchors();
    part.visible = visible;
    part.group.visible = visible && (!this.isolation || this.isolation === id);
    this.updatePreviewVisibility();
    if (!visible) {
      cadSelection.dispatch({
        type: "replace",
        items: cadSelection.snapshot().items.filter((item) => item.partId !== id),
      });
    }
    this.resetFaceMaterials();
    this.callbacks.onStateChanged();
    this.callbacks.onStatus(`${part.data.name} is now ${visible ? "visible" : "hidden"}.`);
  }

  getConnectorRows(): MateConnector[] {
    return this.connectorRegistry.list();
  }

  get isolatedPartId(): string | null { return this.isolation; }

  isolatePart(id: string | null): void {
    if (id && !this.parts.has(id)) return;
    this.clearAnchors();
    this.isolation = id;
    for (const [key, part] of this.parts) part.group.visible = part.visible && (!id || key === id);
    this.updatePreviewVisibility();
    cadSelection.dispatch({ type: "replace", items: cadSelection.snapshot().items.filter(item => this.parts.get(item.partId)?.group.visible) });
    this.callbacks.onStateChanged();
  }

  getPartDisplay(id: string): PartDisplayOverride {
    const part = this.parts.get(id);
    const key = JSON.stringify([part?.data.sourceDocumentId, id]);
    return part ? { ...this.documentPartDisplay.get(key), ...this.partDisplay.get(key) } : {};
  }
  setDocumentPartDisplay(id: string, value: PartDisplayOverride): void {
    const part = this.parts.get(id);
    if (!part) return;
    const key = JSON.stringify([part.data.sourceDocumentId, id]);
    this.documentPartDisplay.set(key, { ...value });
    this.setPartDisplay(id, this.partDisplay.get(key) ?? {});
  }
  setPartDisplay(id: string, value: PartDisplayOverride): void {
    const part = this.parts.get(id);
    if (!part || !this.appearance) return;
    this.partDisplay.set(JSON.stringify([part.data.sourceDocumentId, id]), { ...value });
    const effective = this.getPartDisplay(id);
    const resolved = resolvePartDisplay(resolveAppearance(this.appearance, readViewportThemeOverride()), effective);
    const policy = cadDisplayStylePolicy(this.appearance.displayStyle, this.appearance.edgesVisible);
    applySurfaceAppearance(part.surface.material as THREE.MeshStandardMaterial[], policy, resolved);
    part.edges.visible = policy.edgesVisible && effective.edgesVisible !== false;
    part.edges.material.color.setHex(resolved.edgeColor);
    part.edges.material.linewidth = resolved.edgeWidth;
    part.edges.material.opacity = this.appearance.displayStyle === "hidden-line" ? 1 : resolved.edgeOpacity;
    part.edges.material.transparent = part.edges.material.opacity < 1;
    part.edges.material.needsUpdate = true;
    cadObjectAppearance.refresh();
  }

  /** Context picking ignores the selection filter, but never hits hidden bodies
   * or the unrelated live model beneath a feature/history preview. */
  contextPartsAt(clientX: number, clientY: number): CADSelectionItem[] {
    if (!this.modelRoot.visible || this.sketchSurface || this.sketchPlaneSelection) return [];
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickableSurfaces(), false).filter(hit => !this.section.hides(String(hit.object.userData.partId), hit.point));
    const seen = new Set<string>();
    return hits.flatMap(hit => {
      const part = this.parts.get(String(hit.object.userData.partId));
      if (!part || seen.has(part.data.id)) return [];
      seen.add(part.data.id);
      return [{ id: `body:${part.data.id}`, kind: "body" as const, partId: part.data.id, label: part.data.name,
        faceId: hit.faceIndex == null ? undefined : this.faceIdForTriangle(part.faceRanges, hit.faceIndex) }];
    });
  }

  zoomToParts(ids?: readonly string[]): void { this.zoomToFit(ids); }

  getTopologyInferenceSummary(): TopologyInferenceSummary {
    const summary: TopologyInferenceSummary = {
      faceCount: 0,
      candidateCount: 0,
      candidatesByKind: emptyCandidateCounts(),
    };
    this.parts.forEach((part) => {
      part.topology.forEach((face) => {
        summary.faceCount += 1;
        summary.candidateCount += face.candidates.length;
        face.candidates.forEach((candidate) => {
          summary.candidatesByKind[candidate.kind] += 1;
        });
      });
    });
    return summary;
  }

  /** Adds one STEP document as an assembly while preserving all solid offsets. */
  addModel(parts: PartGeometryData[]): void {
    if (parts.length === 0) return;
    const batchBounds = new THREE.Box3();
    parts.forEach((part) => batchBounds.union(this.localBounds(part)));

    const placement = new THREE.Matrix4();
    if (this.parts.size > 0) {
      const existing = this.renderedPartBounds();
      const existingSize = existing.getSize(new THREE.Vector3());
      const batchSize = batchBounds.getSize(new THREE.Vector3());
      const gap = Math.max(existingSize.length(), batchSize.length()) * 0.08 + 10;
      placement.makeTranslation(existing.max.x - batchBounds.min.x + gap, 0, 0);
    }

    parts.forEach((part) => this.addPart(part, placement));
    this.callbacks.onStateChanged();
  }

  private assemblyPreviewIDs = new Set<string>();
  private geometryBatch = false;
  replaceAssemblyBodies(bodies: {data:PartGeometryData;positionMillimeters:readonly number[];quaternion:readonly number[];appearance?:PartDisplayOverride}[]): void {
    const started = performance.now();
    const nextIDs = new Set(bodies.map(body => body.data.id));
    if (nextIDs.size !== bodies.length) throw Error('Assembly contains duplicate body identities.');
    // A canonical upload supersedes transient placement, including edits from
    // another actor. Later cancellation must never restore an older pose over it.
    this.clearManipulatorPreview(false);
    const invalidated = new Set<string>();
    this.geometryBatch = true;
    try {
      for (const id of this.assemblyPreviewIDs) if (!nextIDs.has(id)) {
        const part = this.parts.get(id);
        if (part) this.removeRenderedPart(part);
        invalidated.add(id);
      }
      for (const body of bodies) {
        const placement = new THREE.Matrix4().compose(
          new THREE.Vector3(...body.positionMillimeters as [number,number,number]),
          new THREE.Quaternion(...body.quaternion as [number,number,number,number]), new THREE.Vector3(1,1,1));
        const existing = this.parts.get(body.data.id);
        if (existing && samePartGeometry(existing.data, body.data)) {
          existing.data = body.data;
          existing.group.name = body.data.name;
          if (!existing.group.matrix.equals(placement)) {
            if (this.anchorFace?.part === existing) this.clearAnchors();
            existing.group.matrix.copy(placement);
            existing.group.updateMatrixWorld(true);
            this.section.refreshPlacement(existing.group);
          }
          this.initialMatrices.set(body.data.id, placement.clone());
        } else {
          if (existing) { this.removeRenderedPart(existing); invalidated.add(body.data.id); }
          this.addPart(body.data, placement);
        }
        this.setDocumentPartDisplay(body.data.id, body.appearance ?? {});
      }
      this.assemblyPreviewIDs = nextIDs;
    } finally { this.geometryBatch = false; }
    if (invalidated.size) {
      if (this.selectionHover && invalidated.has(this.selectionHover.part.data.id)) this.selectionHover = null;
      cadSelection.dispatch({ type: 'replace', items: cadSelection.snapshot().items.filter(item => !invalidated.has(item.partId)) });
    }
    this.resetFaceMaterials();
    this.publishGeometryMetrics(performance.now() - started);
    this.callbacks.onStateChanged();
    window.dispatchEvent(new CustomEvent('aether-assembly-geometry-updated'));
  }
  removeAuthoredPart(id:string):void {const part=this.parts.get(id);if(part)this.removeRenderedPart(part);}

  /** Replaces one authored Body after feature-history evaluation. */
  async capturePrintImage(): Promise<string> {
    await this.output.renderAsync(this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  replaceAuthoredPart(data: PartGeometryData, replacingPartId?: string): void {
    const existing = this.parts.get(replacingPartId ?? data.id);
    const placement = existing?.group.matrix.clone() ?? new THREE.Matrix4();
    if (existing) this.removeRenderedPart(existing);
    this.addPart(data, placement);
    cadSelection.dispatch({
      type: "replace",
      items: [{ id: `body:${data.id}`, kind: "body", partId: data.id, label: data.name }],
    });
    this.callbacks.onStateChanged();
  }

  setTool(tool: AuthoringTool): void {
    this.cancelSelectionGesture();
    this.tool = tool;
    this.clearAnchors();
    this.selectionHover = null;
    cadSelection.dispatch({ type: "set-hovered", item: null });
    cadSelection.dispatch({ type: "set-box", box: null });
    this.mateDraft.clear();
    this.hover = null;
    this.clearTransientOverlay();
    this.resetFaceMaterials();
    this.refreshConnectorMaterials();
    const message =
      tool === "connector"
        ? "Place Connector: hover exact topology, then click an inferred anchor."
        : tool === "fastened"
          ? "Fastened Mate: choose the moving connector, then the target connector."
          : "Authoring tool cancelled.";
    this.callbacks.onStatus(message);
    this.callbacks.onHover(null);
    this.callbacks.onStateChanged();
  }

  selectConnectorForMate(id: string): void {
    if (this.tool !== "fastened") {
      this.callbacks.onStatus("Activate Fastened Mate before selecting connectors.", "error");
      return;
    }
    const connector = this.connectorRegistry.get(id);
    if (connector) this.acceptSavedConnector(connector);
  }

  removeConnector(id: string): void {
    if (this.usedConnectorIds.has(id)) {
      this.callbacks.onStatus("Clear the mate before deleting one of its connectors.", "error");
      return;
    }
    const marker = this.connectorMarkers.get(id);
    if (marker) {
      marker.root.removeFromParent();
      disposeTransientGeometry(marker.root);
      this.connectorMarkers.delete(id);
    }
    this.connectorRegistry.remove(id);
    if (this.mateDraft.movingConnector?.id === id) this.mateDraft.clear();
    this.callbacks.onStateChanged();
    this.callbacks.onStatus("Mate connector deleted.");
  }

  clearMates(): void {
    this.constraints.clear();
    this.mateDraft.clear();
    this.usedConnectorIds.clear();
    for (const [id, part] of this.parts) {
      part.group.matrix.copy(this.initialMatrices.get(id) ?? new THREE.Matrix4());
      part.group.updateMatrixWorld(true);
    }
    this.clearTransientOverlay();
    this.resetFaceMaterials();
    this.refreshConnectorMaterials();
    this.callbacks.onStateChanged();
    this.callbacks.onStatus(
      "All mates cleared; connector anchors remain attached to their Parts.",
    );
  }

  /** Fit the visible modeling result without changing viewing direction. */
  zoomToFit(ids?: readonly string[]): void {
    this.cameraRotation.cancel();
    this.hideOrientationBox();
    const bounds = this.featurePreview.active ? visiblePreviewBounds([this.featurePreview.group])
      : this.historyPreview.active ? new THREE.Box3().setFromObject(this.historyPreview.group) : this.renderedPartBounds(ids, true);
    if (bounds.isEmpty()) return;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const center = bounds.getCenter(new THREE.Vector3());
    const framing = orientationCubeFraming(bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5), this.fieldOfViewDegrees, cameraAspect(this.camera));
    this.controls.target.copy(center);
    if (this.camera instanceof THREE.OrthographicCamera) setOrthographicSpan(this.camera, bounds.getSize(new THREE.Vector3()).length()*1.2/Math.min(1,cameraAspect(this.camera)), cameraAspect(this.camera));
    this.camera.position.copy(center).addScaledVector(direction,framing.distance);
    this.camera.near=framing.near;this.camera.far=framing.far;this.camera.updateProjectionMatrix();
    this.stage.frame(bounds.getSize(new THREE.Vector3()).length(), framing.distance);
    this.controls.update();
  }

  frameAll(): void {
    this.cameraRotation.cancel();
    const bounds = this.featurePreview.active ? visiblePreviewBounds([this.featurePreview.group]) : this.renderedPartBounds();
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const diameter = Math.max(size.x, size.y, size.z, 1);
    this.markerScale = Math.max(diameter * 0.1, 2);
    // Frame the real geometry in the unobscured workspace, retaining the
    // current orbit direction just like the reference's Frame action.
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const width = this.container.clientWidth, height = Math.max(1,this.container.clientHeight);
    const usableWidth = Math.max(100,width-(width>1100?520:width>820?454:32));
    const usableHeight = Math.max(100,height-(width>820?160:220));
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.fieldOfViewDegrees/2));
    const angle = Math.atan(Math.min(tangent*usableHeight/height,tangent*usableWidth/height));
    const distance = Math.max(1,size.length()/2/Math.sin(angle)*1.08);
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction,distance);
    if (this.camera instanceof THREE.OrthographicCamera) setOrthographicSpan(this.camera, size.length()*1.2/Math.min(1,cameraAspect(this.camera)), cameraAspect(this.camera));
    this.camera.near = Math.max(diameter / 10_000, 0.01);
    this.camera.far = Math.max(diameter * 100, 10_000);
    this.camera.updateProjectionMatrix();
    this.stage.frame(size.length(), distance);
    this.controls.update();
  }

  /** The same beveled navigation cube as the corner widget, centered at world
   * origin. Its 26 facets select face, edge and corner camera directions. */
  toggleOrientationBox(): void {
    if (this.orientationBox) this.hideOrientationBox();
    else this.showOrientationBox();
  }

  showOrientationBox(): void {
    this.hideOrientationBox();
    this.orientationCamera = { position:this.camera.position.clone(), target:this.controls.target.clone(), up:this.camera.up.clone(), near:this.camera.near, far:this.camera.far, orthographicSpan:this.camera instanceof THREE.OrthographicCamera ? (this.camera.top-this.camera.bottom)/this.camera.zoom : undefined };
    const bounds = visiblePreviewBounds([this.modelRoot, this.referenceRoot, this.featurePreview.group, this.historyPreview.group, this.overlayRoot]);
    if (this.sketchSurface) {
      const { svg, origin, xDir, yDir } = this.sketchSurface;
      // Include the live sketch plane, its grid and labels as well as contours.
      const r = svg.viewBox.baseVal;
      for (const x of [r.x, r.x+r.width]) for (const y of [r.y, r.y+r.height])
        bounds.expandByPoint(origin.clone().addScaledVector(xDir,x).addScaledVector(yDir,-y));
    }
    const cube = buildOrientationCube(bounds, this.workspaceUpAxis);
    this.overlayRoot.add(cube.group);
    this.orientationBox = cube;
    this.frameOrientationBox(true);
    this.callbacks.onStatus("Choose a cube face, edge, or corner. Space or Esc closes.");
  }

  private frameOrientationBox(animate = false): void {
    const cube = this.orientationBox;
    if (!cube) return;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (direction.lengthSq() < 1e-6) direction.set(...cameraViewDefinition("isometric", this.workspaceUpAxis).direction).normalize();
    if (this.camera instanceof THREE.OrthographicCamera) setOrthographicSpan(this.camera,cube.outer.length()*2.4/Math.min(1,cameraAspect(this.camera)),cameraAspect(this.camera));
    const framing = orientationCubeFraming(cube.outer, this.fieldOfViewDegrees, cameraAspect(this.camera));
    const distance = Math.max(framing.distance, this.camera.position.distanceTo(this.controls.target));
    const position = cube.center.clone().addScaledVector(direction, distance);
    this.orientationMotion.cancel();
    if (animate) {
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420;
      this.orientationMotion.start(this.camera, this.controls.target, position, cube.center, performance.now(), duration);
    } else {
      this.controls.target.copy(cube.center);
      this.camera.position.copy(position);
    }
    // Enclose the whole path, including the starting pose during the animation.
    this.camera.near = Math.min(this.camera.near, framing.near);
    this.camera.far = Math.max(this.camera.far, distance + cube.outer.length() * 4);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  hideOrientationBox(): void {
    this.cameraRotation.cancel();
    this.orientationMotion.cancel();
    const box = this.orientationBox;
    if (!box) return;
    this.orientationBox = null;
    this.overlayRoot.remove(box.group);
    disposeOrientationCube(box);
    if (this.orientationCamera) {
      this.camera.position.copy(this.orientationCamera.position);
      this.camera.up.copy(this.orientationCamera.up);
      this.controls.target.copy(this.orientationCamera.target);
      this.camera.near = this.orientationCamera.near;
      this.camera.far = this.orientationCamera.far;
      if (this.camera instanceof THREE.OrthographicCamera && this.orientationCamera.orthographicSpan) setOrthographicSpan(this.camera,this.orientationCamera.orthographicSpan,cameraAspect(this.camera));
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.orientationCamera = null;
    }
    this.renderer.domElement.style.cursor = "";
  }

  private orientationFaceAt(event: PointerEvent): number {
    const box = this.orientationBox;
    if (!box) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    this.updatePointer(event);
    return plateUnderRay(box, this.raycaster);
  }

  private orientationHover(event: PointerEvent): void {
    const box = this.orientationBox;
    if (!box) return;
    const face = this.orientationFaceAt(event);
    if (face === box.hover) return;
    this.renderer.domElement.style.cursor = paintOrientationHover(box, face) ? "pointer" : "";
  }

  private orientationClick(event: PointerEvent): void {
    // Only a stationary LEFT click acts; orbit/pan/zoom releases keep the box.
    if (event.button !== 0) return;
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const box = this.orientationBox;
    const face = this.orientationFaceAt(event);
    const action = plateCameraAction(face >= 0 ? box?.plates[face] : undefined);
    this.hideOrientationBox();
    if (!action) return;
    if ("view" in action) this.setCameraView(action.view);
    else this.setCameraDirection(action.direction);
  }

  setWorkspaceUpAxis(upAxis: ViewportUpAxis): void {
    if (upAxis === this.workspaceUpAxis) return;
    const reopenCube = !!this.orientationBox;
    this.hideOrientationBox();
    const target = this.controls.target.clone();
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), upAxis === "z" ? Math.PI / 2 : -Math.PI / 2);
    this.camera.position.sub(target).applyQuaternion(rotation).add(target);
    this.camera.up.applyQuaternion(rotation);
    this.controls.dispose();
    this.workspaceUpAxis = upAxis;
    this.controls = createCADCameraControls(this.camera, this.renderer.domElement, () => this.publishCameraOrientation(), target);
    this.updateWorkspaceGround();
    if (this.appearance) this.setAppearance(this.appearance);
    this.publishCameraOrientation();
    if (reopenCube) this.showOrientationBox();
  }

  private updateWorkspaceGround(): void {
    this.stage.setUpAxis(this.workspaceUpAxis);
  }

  setCameraDirection(source: THREE.Vector3 | readonly [number, number, number]): void {
    this.hideOrientationBox();
    const direction = source instanceof THREE.Vector3 ? source.clone().normalize() : new THREE.Vector3(...source).normalize();
    const bounds = this.renderedPartBounds();
    const center = bounds.isEmpty() ? this.controls.target.clone() : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty() ? new THREE.Vector3(100, 100, 100) : bounds.getSize(new THREE.Vector3());
    const distance = Math.max(
      this.camera.position.distanceTo(this.controls.target),
      Math.max(size.x, size.y, size.z, 1) * 1.8,
    );
    this.camera.up.set(...cameraUpForDirection(direction.toArray(), this.workspaceUpAxis));
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.lookAt(center);
    this.controls.update();
    this.callbacks.onStatus("Oriented view.");
  }

  setCameraView(view: StandardCameraView): void {
    this.hideOrientationBox();
    const definition = cameraViewDefinition(view, this.workspaceUpAxis);
    const bounds = this.renderedPartBounds();
    const center = bounds.isEmpty()
      ? this.controls.target.clone()
      : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty()
      ? new THREE.Vector3(100, 100, 100)
      : bounds.getSize(new THREE.Vector3());
    const distance = Math.max(
      this.camera.position.distanceTo(this.controls.target),
      Math.max(size.x, size.y, size.z, 1) * 1.8,
    );
    const direction = new THREE.Vector3(...definition.direction).normalize();
    this.camera.up.set(...definition.up);
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.lookAt(center);
    this.controls.update();
    this.callbacks.onStatus(`${definition.label} view.`);
  }

  setProjection(projection: CameraProjection): void {
    this.hideOrientationBox();
    this.cameraRotation.cancel();
    this.orientationMotion.cancel();
    const target=this.controls.target.clone();
    const next=changeCameraProjection(this.camera,target,projection,this.fieldOfViewDegrees);
    if(next===this.camera)return;
    this.controls.dispose();
    this.camera=next;
    this.controls=createCADCameraControls(this.camera,this.renderer.domElement,()=>this.publishCameraOrientation(),target);
    this.publishCameraOrientation();
    this.callbacks.onStatus(`${projection === 'orthographic' ? 'Orthographic' : 'Perspective'} projection.`);
  }

  /** Perspective field of view in degrees (camera + display tool). */
  setFieldOfView(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    this.fieldOfViewDegrees = Math.min(120, Math.max(10, degrees));
    if (this.camera instanceof THREE.PerspectiveCamera) this.camera.fov = this.fieldOfViewDegrees;
    this.camera.updateProjectionMatrix();
    if (this.orientationBox) this.frameOrientationBox();
  }

  nudgeCamera(horizontalSteps: number, verticalSteps: number): void {
    const basis = nudgeCameraBasis(
      this.cameraRotation.basis(this.camera, this.controls.target),
      horizontalSteps * Math.PI / 12,
      verticalSteps * Math.PI / 12,
    );
    this.animateCameraRotation(basis);
    this.callbacks.onStatus("View nudged 15°.");
  }

  rollCamera(quarterTurns: number): void {
    const basis = rollCameraBasis(
      this.cameraRotation.basis(this.camera, this.controls.target),
      quarterTurns * Math.PI / 2,
    );
    this.animateCameraRotation(basis);
    this.callbacks.onStatus("View rolled 90°.");
  }

  private animateCameraRotation(basis: import("./camera-view").CameraOrientationBasis): void {
    this.orientationMotion.cancel();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300;
    this.cameraRotation.start(this.camera, this.controls.target, basis, performance.now(), duration);
  }

  setReferenceGeometryVisibility(id: ReferenceGeometryId, visible: boolean): void {
    const object = this.referenceObjects.get(id);
    if (!object) return;
    object.visible = visible;
    this.callbacks.onStatus(`${object.name} ${visible ? "shown" : "hidden"}.`);
  }

  private addPart(data: PartGeometryData, placement: THREE.Matrix4): void {
    const uploadStarted = performance.now();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.vertices, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1));
    setSurfaceGroups(geometry, data.faceRanges, () => 0);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const surface = new THREE.Mesh(geometry, [
      viewportMaterials.part.clone(),
      viewportMaterials.hoveredFace.clone(),
      viewportMaterials.selectedFace.clone(),
    ]);
    accelerateSurfacePicking(surface);
    surface.castShadow = true;
    // Contact shadows ground the model; self-shadowing sharp CAD faces adds acne.
    surface.receiveShadow = false;
    surface.userData.partId = data.id;
    const edges = styledLines(data.edgeLines, 0x14242d);
    const displayPolicy = cadDisplayStylePolicy(
      this.appearance?.displayStyle ?? "shaded-edges",
      this.appearance?.edgesVisible ?? true,
    );
    edges.visible = displayPolicy.edgesVisible;
    const edgeMaterial = edges.material;
    const edgeAppearance = this.appearance ? resolveAppearance(this.appearance) : null;
    if (edgeAppearance) { edgeMaterial.color.setHex(edgeAppearance.edgeColor); edgeMaterial.linewidth = edgeAppearance.edgeWidth; }
    edgeMaterial.opacity = this.appearance?.displayStyle === "hidden-line" ? 1 : edgeAppearance?.edgeOpacity ?? displayPolicy.edgeOpacity;
    edgeMaterial.transparent = edgeMaterial.opacity < 1;

    const group = new THREE.Group();
    group.name = data.name;
    group.matrixAutoUpdate = false;
    group.matrix.copy(placement);
    group.add(surface, edges);
    this.section.adopt(data.id, group, geometry, { positions: data.edgeLines, show: positions => {
      // A new geometry, not setPositions in place: the GPU renderer keeps drawing cached line buffers.
      const next = new LineSegmentsGeometry();
      next.setPositions(positions.length ? Float32Array.from(positions) : [0, 0, 0, 0, 0, 0]);
      edges.geometry.dispose();
      edges.geometry = next;
    } }, data);
    group.updateMatrixWorld(true);
    this.parts.set(data.id, {
      data,
      visible: true,
      group,
      surface,
      edges,
      topology: new Map(data.topology.map((face) => [face.id, face])),
      faceRanges: data.faceRanges,
    });
    this.initialMatrices.set(data.id, placement.clone());
    if (this.isolation) group.visible = data.id === this.isolation;
    this.setPartDisplay(data.id, this.partDisplay.get(JSON.stringify([data.sourceDocumentId, data.id])) ?? {});
    this.publishGeometryMetrics(performance.now() - uploadStarted);
  }

  private sketchCurveKey = "";
  private editingSketchID: string | null = null;
  /** The sketch open in the editor draws through its live surface, so its
   * persisted curves are suppressed to avoid a stale double image. */
  setEditingSketch(id: string | null): void {
    if (this.editingSketchID === id) return;
    this.editingSketchID = id;
    this.sketchCurveKey = "";
    this.applySketchCurves();
  }
  private readonly regionPicker = new RegionPicker();
  setRegionDocument(document: PlaneDocument | null): void {
    if (!this.regionPicker.group.parent) this.referenceRoot.add(this.regionPicker.group);
    this.regionPicker.setDocument(document);
  }
  private lastSketchCurves: readonly { id: string; frame: { originMillimeters: [number, number, number]; xDirection: [number, number, number]; normal: [number, number, number] }; polylines: readonly (readonly [number, number][])[] }[] = [];
  private applySketchCurves(): void {
    this.renderSketchCurves(this.lastSketchCurves.filter((sketch) => sketch.id !== this.editingSketchID));
  }
  private sketchCurveGroup = new THREE.Group();
  private spaceCurveGroup = new THREE.Group();
  private spaceCurveKey = "";
  private analysisCurveGroup = new THREE.Group();
  /** Analysis overlays (continuity, combs, isocurves): coloured world polylines, replaced whole. */
  setAnalysisCurves(curves: readonly { color: string; polylines: readonly (readonly [number, number, number])[][] }[]): void {
    for (const child of [...this.analysisCurveGroup.children]) {
      child.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
      this.analysisCurveGroup.remove(child);
    }
    if (!this.analysisCurveGroup.parent) this.referenceRoot.add(this.analysisCurveGroup);
    for (const curve of curves) for (const polyline of curve.polylines) {
      if (polyline.length < 2) continue;
      const segments: number[] = [];
      for (let i = 1; i < polyline.length; i++) segments.push(...polyline[i - 1], ...polyline[i]);
      this.analysisCurveGroup.add(styledLines(segments, new THREE.Color(curve.color).getHex(), 2.4));
    }
  }
  /** 3D sketches: world polylines (mm), drawn like finished sketches. */
  setSpaceCurves(curves: readonly { id: string; polylines: readonly (readonly [number, number, number])[][] }[]): void {
    const key = JSON.stringify(curves);
    if (key === this.spaceCurveKey) return;
    this.spaceCurveKey = key;
    for (const child of [...this.spaceCurveGroup.children]) {
      child.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
      this.spaceCurveGroup.remove(child);
    }
    if (!this.spaceCurveGroup.parent) this.referenceRoot.add(this.spaceCurveGroup);
    const resolved = this.appearance ? resolveAppearance(this.appearance, readViewportThemeOverride()) : null;
    for (const curve of curves) for (const polyline of curve.polylines) {
      if (polyline.length < 2) continue;
      const segments: number[] = [];
      for (let i = 1; i < polyline.length; i++) segments.push(...polyline[i - 1], ...polyline[i]);
      this.spaceCurveGroup.add(styledLines(segments, resolved?.sketchStroke ?? 0xd7e6f5, resolved?.sketchLineWidth ?? 2.1));
    }
  }
  /** Finished sketches drawn as world-anchored polylines (mm, y-up in-plane). */
  setSketchCurves(sketches: readonly { id: string; frame: { originMillimeters: [number, number, number]; xDirection: [number, number, number]; normal: [number, number, number] }; polylines: readonly (readonly [number, number][])[] }[]): void {
    this.lastSketchCurves = sketches;
    this.applySketchCurves();
  }

  /** Screen anchor and ray/axis drag mapping along the extrusion direction. */
  projectExtrusionHandle(featureId: string, depth: number, directionVector?: readonly [number,number,number]) {
    const sketch = this.lastSketchCurves.find(item => item.id === featureId);
    if (!sketch) return null;
    const normal = new THREE.Vector3(...sketch.frame.normal).normalize();
    const x = new THREE.Vector3(...sketch.frame.xDirection).normalize();
    const y = new THREE.Vector3().crossVectors(normal, x).normalize();
    const bounds = new THREE.Box3();
    for (const line of sketch.polylines) for (const [px, py] of line) bounds.expandByPoint(new THREE.Vector3(px,py,0));
    if (bounds.isEmpty()) return null;
    const center = bounds.getCenter(new THREE.Vector3());
    const origin = new THREE.Vector3(...sketch.frame.originMillimeters).addScaledVector(x,center.x).addScaledVector(y,center.y);
    const direction=directionVector?new THREE.Vector3(...directionVector).normalize():normal;
    if(Math.abs(direction.dot(normal))<1e-7)return null;
    return this.projectAxisHandle(origin,direction,depth);
  }

  projectFaceExtrusionHandle(bodyId:string, direction: readonly [number,number,number], depth:number,anchor?:PlanarFaceAnchor) {
    const normal=new THREE.Vector3(...direction).normalize();
    if(this.historyEditing){
      const data=this.historyModel?.parts.find(part=>part.id===bodyId);if(!data)return null;
      const candidates=planarFaceCandidates(data.topology,direction,anchor);
      if(candidates.length!==1)return null;
      return this.projectAxisHandle(new THREE.Vector3(...candidates[0].origin),normal,depth);
    }
    const part=this.parts.get(bodyId);if(!part)return null;
    part.group.updateWorldMatrix(true,false);
    const localNormal=normal.clone().transformDirection(part.group.matrixWorld.clone().invert());
    const candidates=planarFaceCandidates(part.data.topology,[localNormal.x,localNormal.y,localNormal.z],anchor);
    if(candidates.length!==1)return null;
    const origin=new THREE.Vector3(...candidates[0].origin).applyMatrix4(part.group.matrixWorld);
    return this.projectAxisHandle(origin,normal,depth);
  }

  projectEvaluatedExtrusionHandle(origin:readonly number[],direction:readonly number[],depth:number) {
    if(origin.length!==3||direction.length!==3||![...origin,...direction,depth].every(Number.isFinite)||Math.abs(Math.hypot(...direction)-1)>1e-6)return null;
    return this.projectAxisHandle(new THREE.Vector3(...origin),new THREE.Vector3(...direction),depth);
  }

  /** Visible part surfaces, plus the section faces of parts that are cut. */
  private pickableSurfaces(): THREE.Object3D[] {
    return [...this.parts.values()].filter(part => part.group.visible)
      .flatMap(part => [part.surface, ...[this.section.capOf(part.group)].filter((cap): cap is THREE.Mesh => Boolean(cap))]);
  }

  /** Apply Section view (display only); the plane is drawn while it is being edited. */
  setSection(view: SectionView | null, editing: boolean): void {
    this.clearAnchors();
    this.section.apply(view, [...this.parts.values()].map(part => part.group), this.renderedPartBounds(undefined, true), editing);
    this.resetFaceMaterials();
  }

  /** Screen geometry of the section handle: the arrow along the plane normal and
   *  the offset under the pointer. The camera is frozen so a drag stays stable. */
  projectSectionHandle(view: SectionCut) {
    if (!sectionClipPlane(view)) return null;
    return projectSection(view, this.camera, this.renderer.domElement.getBoundingClientRect(), this.renderedPartBounds(undefined, true));
  }

  measurementFrame(item: CADSelectionItem) {
    const face = item.kind === 'face' ? this.selectedFaceData(item) : null;
    const found = face ? { candidate: planarFaceCenter(face.topology) ?? face.topology.candidates[0], matrix: face.matrix } : this.candidateFor(item);
    if (!found?.candidate) return null;
    const {candidate, matrix} = found;
    return {label:item.label,origin:new THREE.Vector3(...candidate.origin).applyMatrix4(matrix).toArray(),
      xAxis:new THREE.Vector3(...candidate.xAxis).transformDirection(matrix).toArray(),
      yAxis:new THREE.Vector3(...candidate.yAxis).transformDirection(matrix).toArray(),
      zAxis:new THREE.Vector3(...candidate.zAxis).transformDirection(matrix).toArray()};
  }

  selectedSectionFrame(selection?: CADSelectionItem) {
    const planar = this.selectedSketchFrame(selection);
    if (planar) return planar;
    const data = this.selectedFaceData(selection);
    if (!data || !['CYLINDER', 'CONE'].includes(data.topology.surfaceType)) return null;
    const candidate = data.topology.candidates.find(item => item.kind === 'cylinder-axis' || item.kind === 'cone-axis');
    if (!candidate) return null;
    return { originMillimeters: new THREE.Vector3(...candidate.origin).applyMatrix4(data.matrix).toArray(),
      normal: new THREE.Vector3(...candidate.zAxis).transformDirection(data.matrix).toArray() };
  }

  /** A ring handle for an angle about an axis, through the transform gizmo's rotate math. */
  projectAngleHandle(origin:readonly number[],axis:readonly number[],angleDegrees:number) {
    if(origin.length!==3||axis.length!==3||![...origin,...axis,angleDegrees].every(Number.isFinite))return null;
    const handles=projectTransformGizmo(this.camera,this.renderer.domElement.getBoundingClientRect(),{frame:{centerMillimeters:[origin[0],origin[1],origin[2]],radiusMillimeters:1},transform:{kind:'rotate',axisOriginMillimeters:[origin[0],origin[1],origin[2]],axisDirection:[axis[0],axis[1],axis[2]],angleDegrees},uniform:false});
    const ring=handles.find(h=>h.key==='angle');
    return ring?{x:ring.x,y:ring.y,points:ring.points,valueAt:ring.valueAt}:null;
  }
  projectTransformHandles(request:TransformGizmoRequest) {
    return projectTransformGizmo(this.camera,this.renderer.domElement.getBoundingClientRect(),request);
  }

  private manipulatorPreview: { group: THREE.Group; original: THREE.Matrix4; ghost?: THREE.Group }[] = [];
  manipulatorFrame(ids: readonly string[]) {
    if (this.tool !== 'none' || this.measurePicking || this.sketchSurface || this.sketchPlaneSelection || !this.modelRoot.visible || this.historyEditing) return null;
    if (ids.some(id => !this.parts.get(id)?.group.visible)) return null;
    const bounds = this.renderedPartBounds(ids, true);
    return bounds.isEmpty() ? null : { centerMillimeters: bounds.getCenter(new THREE.Vector3()).toArray(), radiusMillimeters: bounds.getSize(new THREE.Vector3()).length()/2 };
  }
  projectSelectionManipulator(pivot: Point3) {
    return projectSelectionManipulator(this.camera, this.renderer.domElement.getBoundingClientRect(), pivot);
  }
  previewManipulatorTransform(ids: readonly string[], transform: NumericPartTransform, copy: boolean) {
    if (!this.manipulatorPreview.length) for (const id of ids) {
      const part = this.parts.get(id); if (!part) continue;
      if (part.group.matrixAutoUpdate) part.group.updateMatrix();
      const ghost = copy ? part.group.clone(true) : undefined;
      if (ghost) part.group.parent?.add(ghost);
      this.manipulatorPreview.push({group: part.group, original: part.group.matrix.clone(), ghost});
    }
    for (const item of this.manipulatorPreview) {
      const target = item.ghost ?? item.group;
      target.matrix.copy(transformMatrix(transform).multiply(item.original));
      target.matrix.decompose(target.position, target.quaternion, target.scale);
      target.updateMatrixWorld(true);
      this.section.refreshPlacement(target);
    }
  }
  clearManipulatorPreview(restore = true) {
    for (const item of this.manipulatorPreview) {
      if (item.ghost) item.ghost.removeFromParent();
      else if (restore) {
        item.group.matrix.copy(item.original);
        item.original.decompose(item.group.position, item.group.quaternion, item.group.scale);
        item.group.updateMatrixWorld(true);
        this.section.refreshPlacement(item.group);
      }
    }
    this.manipulatorPreview = [];
  }
  clearInteractionAnchors() { this.clearAnchors(); this.resetFaceMaterials(); }
  pickManipulatorPivot(event: {clientX:number;clientY:number}, origin: Point3): {point:Point3;label?:string}|null {
    const anchor = this.pickAnchors(event).snapped;
    if (anchor) return {point:anchorWorldPoint(anchor).toArray(), label:anchor.candidate.label};
    this.updatePointer(event);
    const hit = this.raycaster.intersectObjects(this.pickableSurfaces(), false).find(hit => !this.section.hides(String(hit.object.userData.partId), hit.point));
    if (hit) return {point:hit.point.toArray(),label:'surface'};
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    const point = this.raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal,new THREE.Vector3(...origin)),new THREE.Vector3());
    return point ? {point:point.toArray()} : null;
  }

  private projectAxisHandle(origin:THREE.Vector3,normal:THREE.Vector3,depth:number) {
    const point = origin.clone().addScaledVector(normal,depth);
    const local = this.projectScreenPoint(point);
    if (!local) return null;
    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const screen = {x: local.x + canvasRect.left, y: local.y + canvasRect.top};
    const depthAt = (clientX:number,clientY:number) => {
      const rect=this.renderer.domElement.getBoundingClientRect();
      const ray=new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),this.camera);
      return extrusionAxisDepth(ray.ray,origin,normal);
    };
    if (depthAt(screen.x,screen.y)===null) return null;
    return {...screen,depthAt};
  }

  private renderSketchCurves(sketches: readonly { id: string; frame: { originMillimeters: [number, number, number]; xDirection: [number, number, number]; normal: [number, number, number] }; polylines: readonly (readonly [number, number][])[] }[]): void {
    const key = JSON.stringify(sketches);
    if (key === this.sketchCurveKey) return;
    this.sketchCurveKey = key;
    for (const child of [...this.sketchCurveGroup.children]) {
      child.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
      this.sketchCurveGroup.remove(child);
    }
    if (!this.sketchCurveGroup.parent) this.referenceRoot.add(this.sketchCurveGroup);
    for (const sketch of sketches) {
      const origin = new THREE.Vector3(...sketch.frame.originMillimeters);
      const xDir = new THREE.Vector3(...sketch.frame.xDirection).normalize();
      const normal = new THREE.Vector3(...sketch.frame.normal).normalize();
      const yDir = new THREE.Vector3().crossVectors(normal, xDir).normalize();
      const lift = normal.clone().multiplyScalar(0.05);
      for (const polyline of sketch.polylines) {
        if (polyline.length < 2) continue;
        const points = polyline.map(([px, py]) =>
          origin.clone().addScaledVector(xDir, px).addScaledVector(yDir, py).add(lift),
        );
        const segments: number[] = [];
        for (let i = 1; i < points.length; i++) segments.push(...points[i-1].toArray(), ...points[i].toArray());
        const resolved = this.appearance ? resolveAppearance(this.appearance, readViewportThemeOverride()) : null;
        this.sketchCurveGroup.add(styledLines(segments, resolved?.sketchStroke ?? 0xd7e6f5, resolved?.sketchLineWidth ?? 2.1));
      }
    }
  }

  private constructionPlaneKey="";
  private constructionPlanes = new THREE.Group();
  setConstructionPlanes(document:PlaneDocument|null):void {
    const key=JSON.stringify(document?.features.slice(0,rollbackPosition(document)).filter(f=>f.type==="plane"||f.type==="axis"||f.type==="point")??[]);if(key===this.constructionPlaneKey)return;this.constructionPlaneKey=key;
    for(const child of [...this.constructionPlanes.children]){child.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.LineSegments){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials){if('map' in material)(material.map as THREE.Texture|null)?.dispose();material.dispose();}}});this.constructionPlanes.remove(child);}
    if(!this.constructionPlanes.parent)this.referenceRoot.add(this.constructionPlanes);
    const features = document?.features.slice(0,rollbackPosition(document)) ?? [];
    for(const feature of features){
      if(feature.type==='point'&&!feature.suppressed){
        // A point feature: a small marker, drawn on top.
        let at;try{at=resolvePointPosition(feature,features.slice(0,features.indexOf(feature)));}catch{continue;}
        const marker=new THREE.Mesh(new THREE.SphereGeometry(1.2,12,8),new THREE.MeshBasicMaterial({color:this.planeTheme?.colors?.custom ?? 0x89aaff,depthTest:false,transparent:true,opacity:0.95}));
        marker.position.set(at[0],at[1],at[2]);marker.renderOrder=31;
        const group=new THREE.Group();group.add(marker);group.name=feature.name;group.userData.featureId=feature.id;group.userData.axisLine={originMillimeters:at,directionMillimeters:[0,0,1]};
        this.constructionPlanes.add(group);continue;
      }
      if(feature.type==='axis'&&!feature.suppressed){
        // An axis feature: a dashed line through the model, long enough to read as infinite.
        let line;try{line=resolveAxisLine(feature,features.slice(0,features.indexOf(feature)));}catch{continue;}
        const bounds=this.renderedPartBounds(undefined,true),extent=Math.max(60,bounds?(bounds.max.distanceTo(bounds.min)):0);
        const o=new THREE.Vector3(...line.originMillimeters),d=new THREE.Vector3(...line.directionMillimeters).normalize();
        const geometry=new THREE.BufferGeometry().setFromPoints([o.clone().addScaledVector(d,-extent),o.clone().addScaledVector(d,extent)]);
        const material=new THREE.LineDashedMaterial({color:this.planeTheme?.colors?.custom ?? 0x89aaff,dashSize:3,gapSize:2,transparent:true,opacity:0.9,depthTest:false});
        const segment=new THREE.Line(geometry,material);segment.computeLineDistances();segment.renderOrder=30;
        const group=new THREE.Group();group.add(segment);group.name=feature.name;group.userData.featureId=feature.id;group.userData.axisLine=line;
        this.constructionPlanes.add(group);continue;
      }
      if(feature.type!=='plane'||feature.suppressed)continue;
      // Frames come from the engine's canonical resolver so plane visuals,
      // sketch surfaces, and built bodies always agree.
      const frame=constructionPlaneFrame(feature,features.slice(0,features.indexOf(feature)));
      const group=createPlaneVisual(feature.name,this.planeTheme?.colors?.custom ?? 0x89aaff,[0,0,0],this.planeTheme?.style ?? {});
      const x=new THREE.Vector3(...frame.xDirection),n=new THREE.Vector3(...frame.normal);
      const y=new THREE.Vector3().crossVectors(n,x);
      group.setRotationFromMatrix(new THREE.Matrix4().makeBasis(x,y,n));
      group.position.set(...frame.originMillimeters);
      group.updateMatrixWorld(true);
      group.userData.sketchFrame={originMillimeters:frame.originMillimeters,xDirection:frame.xDirection,normal:frame.normal};
      group.userData.featureId=feature.id;
      this.constructionPlanes.add(group);
    }
  }

  private buildReferenceGeometry(): void {
    const createPlane = (
      id: ReferenceGeometryId,
      name: string,
      color: number,
      rotation: readonly [number, number, number],
    ): void => {
      const group=createPlaneVisual(name,color,rotation);
      group.visible = false;
      this.referenceRoot.add(group);
      this.referenceObjects.set(id, group);
    };

    // The origin is a point in space; the coloured axis lines are separate
    // reference geometry, hidden until the camera/display tool owns them.
    const origin = createOriginMarker();
    this.referenceRoot.add(origin);
    this.referenceObjects.set("origin", origin);

    const axes = new THREE.AxesHelper(45);
    axes.name = "Axes";
    axes.visible = false;
    this.referenceRoot.add(axes);
    this.referenceObjects.set("axes", axes);
    createPlane("top-plane", "Top Plane", 0x4f8dff, [0, 0, 0]);
    createPlane("front-plane", "Front Plane", 0xef6976, [-Math.PI / 2, 0, 0]);
    createPlane("right-plane", "Right Plane", 0x4ccf8a, [0, Math.PI / 2, 0]);
  }

  /** Restyle existing principal datums without changing their visibility. */
  private rebuildReferencePlanes(theme: PlaneTheme): void {
    // Orientation comes from the engine's principalFrame, never a hand-written
    // Euler triple: the old table had Front flipped 180° and Right rotated 90°
    // in-plane against the frame a sketch on that plane actually uses, so a
    // sketch card and its datum plane disagreed about which way was up.
    const defaults: readonly { id: ReferenceGeometryId; name: string; color: number; key: "top" | "front" | "right" }[] = [
      { id: "top-plane", name: "Top Plane", color: 0x4f8dff, key: "top" },
      { id: "front-plane", name: "Front Plane", color: 0xef6976, key: "front" },
      { id: "right-plane", name: "Right Plane", color: 0x4ccf8a, key: "right" },
    ];
    for (const plane of defaults) {
      const existing = this.referenceObjects.get(plane.id);
      const visible = existing?.visible ?? false;
      const group = existing as THREE.Group | undefined ?? createPlaneVisual(plane.name, theme.colors[plane.key], [0,0,0], theme.style);
      updatePlaneVisual(group, theme.colors[plane.key], theme.style);
      // Same basis the sketch surface and custom plane features build.
      const sketchPlane = sketchPlaneForReference(plane.id);
      if (sketchPlane) {
        const frame = principalFrame(sketchPlane);
        const x = new THREE.Vector3(...frame.xDirection);
        const n = new THREE.Vector3(...frame.normal);
        const y = new THREE.Vector3().crossVectors(n, x);
        group.setRotationFromMatrix(new THREE.Matrix4().makeBasis(x, y, n));
      }
      group.visible = visible;
      this.referenceRoot.add(group);
      this.referenceObjects.set(plane.id, group);
    }
  }

  private publishCameraOrientation(): void {
    // Re-evaluate occlusion during camera glide as well as direct pointer moves.
    // Dots remain under the pointer while zoom settles, without leaking through
    // geometry that has turned toward the camera.
    if (this.anchorPointer) {
      const pointer = this.anchorPointer;
      if (this.tool === 'connector') this.updateCandidateHover(pointer);
      else if (this.measurePointPicking) this.updateSelectionHover(pointer);
    }
    const { x, y, z, w } = this.camera.quaternion;
    this.callbacks.onCameraChanged([x, y, z, w]);
  }

  private removeRenderedPart(part: RenderPart): void {
    if (this.anchorFace?.part === part) this.clearAnchors();
    const relatedConnectors = this.connectorRegistry
      .list()
      .filter((connector) => connector.partId === part.data.id);
    if (relatedConnectors.some((connector) => this.usedConnectorIds.has(connector.id))) {
      this.clearMates();
    }
    relatedConnectors.forEach((connector) => this.removeConnector(connector.id));
    part.group.removeFromParent();
    (part.surface.material as THREE.Material[]).forEach(material => material.dispose());
    (part.edges.material as THREE.Material).dispose();
    part.group.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
    });
    this.parts.delete(part.data.id);
    this.initialMatrices.delete(part.data.id);
    this.publishGeometryMetrics();
    if (!this.geometryBatch) cadSelection.dispatch({
      type: "replace",
      items: cadSelection.snapshot().items.filter((item) => item.partId !== part.data.id),
    });
  }

  private localBounds(data: PartGeometryData): THREE.Box3 {
    return localBounds(data);
  }

  private renderedPartBounds(ids?: readonly string[], visibleOnly = false): THREE.Box3 {
    const bounds = new THREE.Box3();
    this.parts.forEach((part, id) => {
      if ((!visibleOnly || part.group.visible) && (!ids || ids.includes(id))) bounds.expandByObject(part.surface, true);
    });
    return bounds;
  }

  /** While a sketch surface is active, route left-button/hover input to its
   * SVG (which is pointer-events:none inside the CSS3D layer) and swallow the
   * viewer's own picking. Middle/right/wheel stay with the camera controls. */
  private forwardToSketch(event: MouseEvent): boolean {
    const surface = this.sketchSurface;
    if (!surface || this.orientationBox) return false;
    if (isSketchCameraGesture(event)) return true;
    const positional = !["pointermove", "pointerleave", "pointercancel"].includes(event.type);
    if (positional && event.button !== 0) return true;
    const copy =
      typeof PointerEvent !== "undefined" && event instanceof PointerEvent
        ? new PointerEvent(event.type, event)
        : new MouseEvent(event.type, event);
    if (event.type === "pointerdown" && event instanceof PointerEvent)
      this.renderer.domElement.setPointerCapture(event.pointerId);
    surface.svg.dispatchEvent(copy);
    if (["pointerup", "pointercancel"].includes(event.type) && event instanceof PointerEvent && this.renderer.domElement.hasPointerCapture(event.pointerId))
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    return true;
  }

  /** Show a construction plane at a frame it does not yet have in the document,
   *  while its feature window is open. `frame: null` hides it — an incomplete
   *  definition must not leave a stale plane on screen. Committing the feature
   *  re-renders it from the document and supersedes this. */
  setConstructionPlanePreview(
    featureId: string,
    frame: { originMillimeters: [number, number, number]; xDirection: [number, number, number]; normal: [number, number, number] } | null,
  ): void {
    let group = this.constructionPlanes.children.find(
      (child) => child.userData.featureId === featureId,
    );
    if (!group && frame) {
      if (!this.constructionPlanes.parent) this.referenceRoot.add(this.constructionPlanes);
      group = createPlaneVisual("Plane", this.planeTheme?.colors?.custom ?? 0x89aaff, [0,0,0], this.planeTheme?.style ?? {});
      group.userData.featureId = featureId;
      this.constructionPlanes.add(group);
    }
    if (!group) return;
    if (!frame) {
      group.visible = false;
      tintPlane(group, null);
      return;
    }
    const x = new THREE.Vector3(...frame.xDirection);
    const n = new THREE.Vector3(...frame.normal);
    const y = new THREE.Vector3().crossVectors(n, x);
    group.setRotationFromMatrix(new THREE.Matrix4().makeBasis(x, y, n));
    group.position.set(...frame.originMillimeters);
    group.updateMatrixWorld(true);
    group.userData.sketchFrame = { ...frame };
    group.visible = true;
  }

  /** Restore saved frames after Apply or Cancel and dispose transient previews. */
  clearConstructionPlanePreview(document: PlaneDocument | null): void {
    this.constructionPlaneKey = "";
    this.setConstructionPlanes(document);
  }

  /** Highlight the planes a feature is currently referencing. Orange means
   *  "selected" everywhere in the app — the same signal Onshape uses — so the
   *  entity chips in a feature window and the geometry in the viewport always
   *  agree about what is being used. Passing an empty list clears it. */
  setHighlightedPlanes(
    references: readonly ({ kind: "principal"; plane: SketchPlane } | { kind: "feature"; featureId: string })[],
  ): void {
    const wanted = new Set<THREE.Object3D>();
    for (const reference of references) {
      const group =
        reference.kind === "feature"
          ? this.constructionPlanes.children.find((c) => c.userData.featureId === reference.featureId)
          : this.referenceObjects.get(REFERENCE_FOR_PLANE[reference.plane]);
      if (group) wanted.add(group);
    }
    for (const group of [...this.constructionPlanes.children, ...this.referenceObjects.values()])
      tintPlane(group, wanted.has(group) ? SELECTION_COLOR : null);
  }

  /** Recolour a plane visual's surface and outline, remembering the colour it
   *  had so clearing the highlight restores exactly what it was. */

  /** Add sketch guides at their world frame without changing the environment
   * or camera. Drawing space is y-up along normal×x. */
  beginSketchSurface(
    frame: {
      originMillimeters: [number, number, number];
      xDirection: [number, number, number];
      normal: [number, number, number];
    },
    svg: SVGSVGElement,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    this.endSketchSurface();
    if (!this.cssRenderer) {
      this.cssRenderer = new CSS3DRenderer();
      const el = this.cssRenderer.domElement;
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.pointerEvents = "none";
      this.container.append(el);
      this.resize();
    }
    const origin = new THREE.Vector3(...frame.originMillimeters);
    const xDir = new THREE.Vector3(...frame.xDirection).normalize();
    const normal = new THREE.Vector3(...frame.normal).normalize();
    const yDir = new THREE.Vector3().crossVectors(normal, xDir).normalize();
    svg.dataset.environmentPlane = Math.abs(normal.z) > .999999 ? 'top' : Math.abs(normal.y) > .999999 ? 'front' : Math.abs(normal.x) > .999999 ? 'right' : 'custom';
    updateSketchEnvironment(svg);
    svg.style.pointerEvents = "none";
    svg.style.display = "block";
    const holder = document.createElement("div");
    holder.style.display = "inline-block";
    holder.append(svg);
    const object = new CSS3DObject(holder);
    // CSS3DObject's constructor forces pointerEvents to "auto"; input must fall
    // through to the WebGL canvas, which forwards left input back to the svg.
    holder.style.pointerEvents = "none";
    object.setRotationFromMatrix(new THREE.Matrix4().makeBasis(xDir, yDir, normal));
    this.sketchSurface = { object, svg, origin, xDir, yDir, normal, disposeInput: bindSketchCameraInput(svg, this.renderer.domElement) };
    this.cssScene.add(object);
    this.updateSketchSurfaceBounds(bounds);
    // The camera is never moved when a sketch opens (Jonathan, 2026-09-11):
    // the plane appears in place and stays where you are looking, exactly
    // like Onshape. Use View → Normal to when square-on is wanted.
  }

  sketchClientFromPoint(point: [number, number]): [number, number] | null {
    const s = this.sketchSurface; if (!s) return null;
    const world = s.origin.clone().addScaledVector(s.xDir, point[0]).addScaledVector(s.yDir, point[1]);
    const projected = world.project(this.camera); if (projected.z < -1 || projected.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return [rect.left + (projected.x + 1) * rect.width / 2, rect.top + (1 - projected.y) * rect.height / 2];
  }

  updateSketchSurfaceBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    const s = this.sketchSurface;
    if (!s) return;
    // CSS3D rasterizes the SVG at its layout size (1px = 1mm) and the camera
    // magnifies that raster, which reads as heavy pixelation. Rasterize at a
    // higher internal resolution and scale the 3D object back down — vector
    // SVG stays crisp, input is unaffected (picking raycasts the plane).
    this.sketchBounds = bounds;
    this.applySketchResolution(Math.max(this.sketchResolution, Math.min(8, 4096 / Math.max(bounds.width, bounds.height, 1))));
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    // viewBox y runs down; drawing y (up) = -viewBox y.
    s.object.position.copy(s.origin).addScaledVector(s.xDir, cx).addScaledVector(s.yDir, -cy);
  }

  private sketchBounds: { x: number; y: number; width: number; height: number } | null = null;
  private sketchResolution = 1;
  private applySketchResolution(resolution: number): void {
    const s = this.sketchSurface, bounds = this.sketchBounds;
    if (!s || !bounds) return;
    this.sketchResolution = resolution;
    s.svg.style.width = `${bounds.width * resolution}px`;
    s.svg.style.height = `${bounds.height * resolution}px`;
    s.object.scale.setScalar(1 / resolution);
  }
  /** The raster follows the camera: zooming in re-rasterizes the SVG at the
   *  screen's pixels-per-millimetre so vectors never read as pixels
   *  (Jonathan, 2026-10-31). The cap keeps the layer under 8192 px a side. */
  private syncSketchResolution(): void {
    const s = this.sketchSurface, bounds = this.sketchBounds;
    if (!s || !bounds) return;
    const a = this.sketchClientFromPoint([bounds.x, bounds.y]), b = this.sketchClientFromPoint([bounds.x + 1, bounds.y]);
    if (!a || !b) return;
    const needed = Math.hypot(b[0] - a[0], b[1] - a[1]) * (window.devicePixelRatio || 1);
    const cap = 8192 / Math.max(bounds.width, bounds.height, 1);
    const target = Math.min(cap, Math.max(1, needed));
    if (target > this.sketchResolution * 1.25 || target < this.sketchResolution / 2) this.applySketchResolution(target);
  }

  endSketchSurface(): void {
    const s = this.sketchSurface;
    if (!s) return;
    this.sketchBounds = null; this.sketchResolution = 1;
    s.disposeInput();
    this.sketchSurface = null;
    this.cssScene.remove(s.object);
    s.object.element.remove();
    s.svg.remove();
    // Closing the editor must preserve the user's current camera roll.
    this.controls.update();
  }

  /** Ray through the client point intersected with the active sketch plane,
   * in drawing coordinates (mm, y-up). */
  sketchPointFromClient(clientX: number, clientY: number): [number, number] | null {
    const s = this.sketchSurface;
    if (!s) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(s.normal, s.origin);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    hit.sub(s.origin);
    return [hit.dot(s.xDir), hit.dot(s.yDir)];
  }

  /** Local mm-per-CSS-pixel of the sketch plane around a client point (viewport center by default). */
  sketchScaleAt(clientX?: number, clientY?: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const cx = clientX ?? rect.left + rect.width / 2;
    const cy = clientY ?? rect.top + rect.height / 2;
    const a = this.sketchPointFromClient(cx - 4, cy);
    const b = this.sketchPointFromClient(cx + 4, cy);
    return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) / 8 : null;
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.controls.handleResize();
    resizeModelingCamera(this.camera,width/height);
    this.cssRenderer?.setSize(width, height);
    if (this.orientationBox) this.frameOrientationBox();
  }

  /** Copy the product canvas in the render turn, before the GPU drawing buffer
   * may be cleared. Camera, selection and document remain unchanged. */
  captureViewport(maximumEdge=1024):HTMLCanvasElement {
    this.output.render(this.camera);
    const source=this.renderer.domElement;
    if(!source.width||!source.height)throw Error('The CAD viewport is not ready.');
    const edge=Math.max(1,Math.min(1024,maximumEdge));
    const scale=Math.min(1,edge/Math.max(source.width,source.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));
    const context=canvas.getContext('2d');
    if(!context)throw Error('Viewport capture is unavailable.');
    context.drawImage(source,0,0,canvas.width,canvas.height);
    return canvas;
  }

  private render(): void {
    const started = performance.now();
    this.orientationMotion.update(this.camera, this.controls.target, started);
    this.cameraRotation.update(this.camera, this.controls.target, started);
    this.controls.update();
    this.stage.beforeRender(this.camera, this.controls.target, [this.modelRoot, this.featurePreview.group, this.historyPreview.group, this.orientationBox?.group]);
    this.output.render(this.camera);
    this.anchorOverlay.render(point => this.projectScreenPoint(point));
    if (this.sketchSurface && this.cssRenderer) {
      this.syncSketchResolution();
      this.cssRenderer.render(this.cssScene, this.camera);
    }
    this.sampleFrame(started, performance.now());
  }

  /** Roll frame timings into the metrics store about twice a second. */
  private sampleFrame(started: number, finished: number): void {
    const sample = this.frameSample;
    if (!sample.since) sample.since = started;
    sample.frames += 1;
    sample.renderMs += finished - started;
    sample.last = finished;
    const elapsed = finished - sample.since;
    if (elapsed < 500) return;
    const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    cadViewportMetrics.publish({
      fps: Math.round((sample.frames / elapsed) * 1000 * 10) / 10,
      frameMilliseconds: Math.round((elapsed / sample.frames) * 100) / 100,
      frameBudgetPercent: Math.round((sample.renderMs / elapsed) * 1000) / 10,
      memoryMegabytes: memory ? Math.round((memory.usedJSHeapSize / 1_048_576) * 10) / 10 : null,
      backend: this.backendLabel,
    });
    sample.frames = 0;
    sample.renderMs = 0;
    sample.since = finished;
  }

  /** Publish geometry counts after parts change. */
  private publishGeometryMetrics(uploadMilliseconds?: number): void {
    if (this.geometryBatch) return;
    let faces = 0;
    let triangles = 0;
    let edgeSegments = 0;
    for (const part of this.parts.values()) {
      faces += part.topology.size;
      const index = part.surface.geometry.getIndex();
      triangles += index ? index.count / 3 : 0;
      edgeSegments += part.data.edgeLines.length / 6;
    }
    cadViewportMetrics.publish({
      bodies: this.parts.size,
      faces,
      triangles: Math.round(triangles),
      edgeSegments: Math.round(edgeSegments),
      ...(uploadMilliseconds === undefined ? {} : { lastUploadMilliseconds: Math.round(uploadMilliseconds * 10) / 10 }),
    });
  }

  private pointerMoved(event: PointerEvent): void {
    if (this.orientationBox) {
      this.orientationHover(event);
      return;
    }
    if (event.buttons !== 0 && this.anchorFace) { this.clearAnchors(); this.resetFaceMaterials(); }
    if (this.tool === "none") {
      if (event.buttons === 0) this.updateSelectionHover(event);
      else if ((event.buttons & 1) === 1) this.updateSelectionBox(event);
      return;
    }
    if (event.buttons !== 0) return;
    this.updatePointer(event);
    if (this.tool === "connector") this.updateCandidateHover(event);
    else this.updateConnectorHover();
  }

  private updateCandidateHover(event: { clientX: number; clientY: number }): void {
    const pick = this.pickAnchors(event);
    const anchor = pick.snapped;
    const part = anchor && this.parts.get(anchor.part.data.id);
    this.setHover(anchor && part ? { kind: 'candidate', part, faceId: anchor.faceId, candidate: anchor.candidate } : null);
  }

  private updateConnectorHover(): void {
    const hit = this.raycaster.intersectObjects(
      [...this.connectorMarkers.values()].map((marker) => marker.hitTarget),
      false,
    )[0];
    const id = hit ? String(hit.object.userData.connectorId ?? "") : "";
    const connector = id ? this.connectorRegistry.get(id) : undefined;
    this.setHover(connector ? { kind: "connector", connector } : null);
  }

  private pointerUp(event: PointerEvent): void {
    if (this.orientationBox) {
      this.orientationClick(event);
      return;
    }
    if (event.button !== 0) return;
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down) return;
    const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (this.tool === "none") {
      if (this.selectionStroke) {
        this.updateSelectionStroke(event);
        const stroke = this.selectionStroke;
        if (stroke.mode === "freeform" && stroke.snapshot().points.length < 3) this.commitSelectionClick(event);
        else {
          const items = stroke.mode === "paint" ? stroke.items() : this.modelRoot.visible
            ? itemsInsideLasso(this.parts.values(), effectiveSelectionKind(cadSelection.snapshot()), stroke.snapshot().points, p=>this.projectScreenPoint(p)) : [];
          cadSelection.dispatch({type:event.shiftKey||event.metaKey||event.ctrlKey?"add":"replace",items});
          this.callbacks.onStatus(`${stroke.mode === "paint" ? "Paint" : "Freeform"} selected ${items.length} items.`);
          this.callbacks.onStateChanged();
        }
        this.selectionStroke=null;
        cadSelection.dispatch({type:"set-stroke",stroke:null});
      }
      else if (distance > 4) this.completeBoxSelection(event);
      else this.commitSelectionClick(event);
      cadSelection.dispatch({ type: "set-box", box: null });
      return;
    }
    if (distance > 4) return;
    if (this.tool === "connector") this.updateCandidateHover(event);
    if (!this.hover) return;
    if (this.tool === "connector" && this.hover.kind === "candidate") {
      this.createConnector(this.hover);
    } else if (this.tool === "fastened" && this.hover.kind === "connector") {
      this.acceptSavedConnector(this.hover.connector);
    }
  }

  private historySelectionHit(event: {clientX:number;clientY:number}) {
    const filter = cadSelection.snapshot().filter;
    if ((this.featurePreview.active && !this.canPickSourceGeometry()) || (!this.sketchPlaneSelection && !this.canPickSourceGeometry() && !["face", "edge", "vertex"].includes(filter))) return null;
    this.updatePointer(event);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const hit = pickHistoryFace(this.raycaster, this.historyPreview.group, this.historyModel,
      filter === "edge" || filter === "vertex" ? {
        kind: filter, point: {x:event.clientX-rect.left,y:event.clientY-rect.top},
        project: point => this.projectScreenPoint(point),
      } : undefined, this.canPickSourceGeometry());
    return hit&&filter==='body'?{...hit,item:{id:`body:${hit.item.partId}`,kind:'body' as const,partId:hit.item.partId,label:hit.partName}}:hit;
  }

  private updateSelectionHover(event: { clientX: number; clientY: number }): void {
    if(this.historyEditing){
      const hit=this.historySelectionHit(event);
      cadSelection.dispatch({type:'set-hovered',item:hit?.item??null});
      this.callbacks.onHover(hit?{partName:hit.partName,label:hit.item.label,detail:hit.item.detail??'Face selection'}:null);
      return;
    }
    const next = this.measurePointPicking ? this.anchorSelectionHit(event) : this.selectionHit(event);
    if (next?.item.id === this.selectionHover?.item.id) return;
    this.selectionHover = next;
    cadSelection.dispatch({ type: "set-hovered", item: next?.item ?? null });
    this.resetFaceMaterials();
    this.callbacks.onHover(next ? {
      partName: next.part.data.name,
      label: next.item.label,
      detail: next.item.detail ?? `${next.item.kind} selection`,
    } : null);
  }

  private selectionHit(event: {clientX:number;clientY:number}): SelectionHover | null {
    if (!this.modelRoot.visible && !(this.featurePreview.active && this.canPickSourceGeometry() && !this.historyEditing)) return null;
    this.updatePointer(event);
    const hit = this.raycaster.intersectObjects(this.pickableSurfaces(), false)
      .filter(hit => !this.section.hides(String(hit.object.userData.partId), hit.point))[0];
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null;
    const part = this.parts.get(String(hit.object.userData.partId));
    if (!part) return null;
    // Cap topology is inspection-only; modeling commands never receive synthetic faces.
    const cap = hit.object.userData.sectionCap ? this.section.inspectionPart(part.group) : null;
    if (cap && !this.measurePicking && !['body','component'].includes(effectiveSelectionKind(cadSelection.snapshot()))) return null;
    const faceId = this.faceIdForTriangle(cap?.faceRanges ?? part.faceRanges, hit.faceIndex);
    const topology = faceId === undefined ? undefined : (cap?.topology ?? part.topology).get(faceId);
    let kind = effectiveSelectionKind(cadSelection.snapshot());
    const rect = this.renderer.domElement.getBoundingClientRect();
    const point = {x:event.clientX-rect.left,y:event.clientY-rect.top};
    const distance = (candidate:ConnectorCandidate)=>selectionCandidateDistance(candidate,part.group.matrixWorld,point,p=>this.projectScreenPoint(p));
    if (kind === "edge" && cadSelection.snapshot().filter === "auto" && topology &&
      !topology.candidates.some(candidate=>candidate.kind==='edge-midpoint'&&distance(candidate)<=12)) kind='face';
    if (kind === "component" || kind === "body") {
      return {
        part,
        item: {
          id: `${kind}:${part.data.id}`,
          kind,
          partId: part.data.id,
          label: part.data.name,
          detail: kind === "component" ? "Component occurrence" : part.data.geometryKind === "mesh" ? "Mesh reference" : "Exact Body",
        },
      };
    }
    if (!topology) return null;
    if (kind === "face") {
      return {
        part,
        faceId: topology.id,
        item: {
          id: `${cap ? "section-face" : "face"}:${part.data.id}:${topology.id}`,
          kind: "face",
          partId: part.data.id,
          faceId: topology.id,
          label: cap ? "Section face" : `Face ${this.faceOrdinal(part, topology.id)}`,
          partLabel: part.data.name,
          detail: topology.surfaceType,
        },
      };
    }
    const candidateKind = kind === "edge" ? "edge-midpoint" : "vertex";
    const candidates = topology.candidates.filter((candidate) => candidate.kind === candidateKind);
    if (candidates.length === 0) return null;
    const candidate = candidates.sort((a,b)=>distance(a)-distance(b))[0];
    if (distance(candidate)>12) return null;
    return {
      part,
      faceId: topology.id,
      item: {
        id: `${kind}:${part.data.id}:${candidate.id}`,
        kind,
        partId: part.data.id,
        faceId: topology.id,
        label: candidate.label,
        detail: cap ? 'Section mesh' : kind === "edge" ? "Exact edge" : "Exact vertex",
      },
    };
  }

  private commitSelectionClick(event: PointerEvent): void {
    this.updatePointer(event);
    if (this.regionPicker.pick(this.raycaster)) return;
    if (this.featurePreview.active && !this.canPickSourceGeometry()) return;
    if(this.historyEditing){
      if(!['face','edge','vertex'].includes(cadSelection.snapshot().filter)&&!this.sketchPlaneSelection&&!this.canPickSourceGeometry())return;
      const hit=this.historySelectionHit(event);
      if(hit){
        cadSelection.dispatch({type:'replace',items:[hit.item]});
        if(this.sketchPlaneSelection && hit.item.kind==='face')window.dispatchEvent(new CustomEvent('aether-sketch-face-request'));
        this.callbacks.onStatus(`${hit.item.label} selected.`);
        this.callbacks.onStateChanged();return;
      }
      if(!this.sketchPlaneSelection){cadSelection.dispatch({type:'clear'});this.callbacks.onStateChanged();return;}
      // A missed solid can still select a datum plane while repairing a sketch.
    }
    const hit = this.measurePointPicking ? this.anchorSelectionHit(event) : this.selectionHit(event);
    if (hit?.item.kind === "face" && hit.faceId !== undefined) this.rememberSurfaceHit(hit.part, hit.faceId);
    if(this.sketchPlaneSelection && !hit){
      this.updatePointer(event);
      const custom=this.raycaster.intersectObjects(this.constructionPlanes.children,true)[0];
      if(custom){let object:THREE.Object3D|null=custom.object;while(object&&!object.userData.sketchFrame)object=object.parent;if(object){window.dispatchEvent(new CustomEvent('aether-plane-feature-picked',{detail:{featureId:object.userData.featureId}}));window.dispatchEvent(new CustomEvent('aether-sketch-face',{detail:{frame:object.userData.sketchFrame}}));return;}}
      const surfaces=[...this.referenceObjects].filter(([id,o])=>id!=="origin"&&o.visible).flatMap(([id,o])=>o.children.filter(c=>c instanceof THREE.Mesh).map(mesh=>({id,mesh})));
      const picked=this.raycaster.intersectObjects(surfaces.map(s=>s.mesh),false)[0];
      const id=surfaces.find(s=>s.mesh===picked?.object)?.id;
      const plane=id==="top-plane"?"XY":id==="front-plane"?"XZ":id==="right-plane"?"YZ":null;
      if(plane){window.dispatchEvent(new CustomEvent("aether-sketch-plane",{detail:plane}));return;}
    }
    const extendsSelection = event.shiftKey || event.metaKey || event.ctrlKey || this.measurePicking;
    if (!hit) {
      if (!extendsSelection) cadSelection.dispatch({ type: "clear" });
      this.selectionHover = null;
      this.callbacks.onHover(null);
      this.callbacks.onStateChanged();
      return;
    }
    cadSelection.dispatch({
      type: extendsSelection ? "toggle" : "replace",
      items: [hit.item],
    });
    if(this.sketchPlaneSelection && hit.item.kind==="face") window.dispatchEvent(new CustomEvent("aether-sketch-face-request"));
    this.selectionHover = hit;
    this.callbacks.onStatus(`${hit.item.label} selected.`);
    this.callbacks.onStateChanged();
  }

  private cancelSelectionGesture(): void {
    this.pointerDown=null;
    this.selectionStroke=null;
    cadSelection.dispatch({type:"set-box",box:null});
    cadSelection.dispatch({type:"set-stroke",stroke:null});
  }

  private updateSelectionStroke(event: PointerEvent): void {
    if (!this.selectionStroke) return;
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.selectionStroke.append({x:event.clientX-rect.left,y:event.clientY-rect.top});
    cadSelection.dispatch({type:"set-stroke",stroke:this.selectionStroke.snapshot()});
  }

  private updateSelectionBox(event: PointerEvent): void {
    if (this.selectionStroke) { this.updateSelectionStroke(event); return; }
    if (this.historyEditing || this.featurePreview.active || this.sketchPlaneSelection) return;
    const down = this.pointerDown;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const startX = down.x - rect.left;
    const startY = down.y - rect.top;
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    cadSelection.dispatch({
      type: "set-box",
      box: {
        startX,
        startY,
        currentX,
        currentY,
        mode: boxSelectionMode(startX, currentX),
      },
    });
  }

  private completeBoxSelection(event: PointerEvent): void {
    const box = cadSelection.snapshot().box;
    if (!box) return;
    const items = this.itemsInsideSelectionBox(box.mode, normalizedSelectionBox(box));
    cadSelection.dispatch({
      type: event.shiftKey || event.metaKey || event.ctrlKey ? "add" : "replace",
      items,
    });
    this.selectionHover = null;
    this.callbacks.onHover(null);
    this.callbacks.onStateChanged();
    this.callbacks.onStatus(
      `${box.mode === "window" ? "Window" : "Crossing"} selected ${items.length} ${items.length === 1 ? "item" : "items"}.`,
    );
  }

  private itemsInsideSelectionBox(
    mode: CADBoxSelectionMode,
    selection: CADScreenRect,
  ): readonly CADSelectionItem[] {
    if (!this.modelRoot.visible) return [];
    return itemsInsideSelectionBox(
      this.parts.values(),
      effectiveSelectionKind(cadSelection.snapshot()),
      mode,
      selection,
      (world) => this.projectScreenPoint(world),
    );
  }

  private projectScreenPoint(world: THREE.Vector3): { x: number; y: number } | null {
    return projectScreenPoint(world, this.camera, this.renderer.domElement.getBoundingClientRect());
  }

  private updatePointer(event: {clientX:number;clientY:number}): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private faceIdForTriangle(
    ranges: FaceRangeData[],
    triangleIndex: number,
  ): number | undefined {
    return faceIdForTriangle(ranges, triangleIndex);
  }

  private setHover(target: HoverTarget | null): void {
    const oldKey = this.hoverKey(this.hover);
    const newKey = this.hoverKey(target);
    if (oldKey === newKey) return;
    this.hover = target;
    this.resetFaceMaterials();
    this.clearTransientOverlay();
    this.refreshConnectorMaterials();
    if (target?.kind === "candidate") {
      this.setFaceMaterial(target.part, target.faceId, 1);
      this.addTransientTriad(target.part.group.matrixWorld, target.candidate);
      this.callbacks.onHover({
        partName: target.part.data.name,
        label: target.candidate.label,
        detail: target.part.topology.get(target.faceId)?.surfaceType ?? "B-Rep",
      });
    } else if (target?.kind === "connector") {
      this.setConnectorMaterial(
        target.connector.id,
        viewportMaterials.hoveredConnector,
      );
      this.callbacks.onHover({
        partName: target.connector.partName,
        label: target.connector.name,
        detail: target.connector.candidate.label,
      });
    } else {
      this.callbacks.onHover(null);
    }
  }

  private hoverKey(target: HoverTarget | null): string {
    return hoverKey(target);
  }

  private addTransientTriad(partWorld: THREE.Matrix4, candidate: ConnectorCandidate): void {
    const marker = createConnectorGizmo(
      this.markerScale,
      viewportMaterials.hoveredConnector,
    );
    marker.root.matrixAutoUpdate = false;
    marker.root.matrix.copy(partWorld).multiply(connectorMatrix(candidate));
    marker.root.userData.transient = true;
    this.overlayRoot.add(marker.root);
  }

  private createConnector(target: CandidateHover): void {
    const connector = this.connectorRegistry.create(
      target.part.data.id,
      target.part.data.name,
      target.candidate,
    );
    const marker = createConnectorGizmo(
      this.markerScale,
      viewportMaterials.connector,
    );
    const root = marker.root;
    root.name = connector.name;
    root.matrixAutoUpdate = false;
    root.matrix.copy(connectorMatrix(connector.candidate));
    const hitTarget = marker.hitTarget;
    hitTarget.userData.connectorId = connector.id;
    hitTarget.userData.partId = connector.partId;
    target.part.group.add(root);
    this.connectorMarkers.set(connector.id, { root, hitTarget });
    this.callbacks.onStatus(
      `${connector.name} placed on ${connector.partName}. Place another connector or start a mate.`,
      "success",
    );
    this.callbacks.onStateChanged();
    this.setHover(null);
  }

  private acceptSavedConnector(connector: MateConnector): void {
    if (!this.mateDraft.movingConnector) {
      const decision = this.constraints.canUseAsMoving(connector.partId);
      if (!decision.allowed) {
        this.callbacks.onStatus(`${connector.partName}: ${decision.reason}`, "error");
        return;
      }
    }

    const result = this.mateDraft.choose(connector);
    if (result.kind === "rejected") {
      this.callbacks.onStatus(result.reason, "error");
      return;
    }
    if (result.kind === "first") {
      this.refreshConnectorMaterials();
      this.callbacks.onStatus(
        `Moving connector: ${connector.name} on ${connector.partName}. Choose the target connector.`,
      );
      this.callbacks.onStateChanged();
      return;
    }

    const moving = this.parts.get(result.moving.partId);
    const destination = this.parts.get(result.target.partId);
    if (!moving || !destination) return;
    destination.group.updateMatrixWorld(true);
    moving.group.matrix.copy(
      solveFastenedMate(
        result.moving.candidate,
        result.target.candidate,
        destination.group.matrixWorld,
      ),
    );
    moving.group.updateMatrixWorld(true);
    this.constraints.markMovingPart(moving.data.id);
    this.usedConnectorIds.add(result.moving.id);
    this.usedConnectorIds.add(result.target.id);
    const mate: AppliedMate = {
      id: crypto.randomUUID(),
      movingPartId: moving.data.id,
      targetPartId: destination.data.id,
      movingConnectorId: result.moving.id,
      targetConnectorId: result.target.id,
      movingConnector: result.moving.candidate,
      targetConnector: result.target.candidate,
    };
    this.callbacks.onMateApplied(mate);
    this.clearTransientOverlay();
    this.resetFaceMaterials();
    this.refreshConnectorMaterials();
    this.callbacks.onStateChanged();
    this.callbacks.onStatus(
      `Fastened mate applied: ${result.moving.name} → ${result.target.name}.`,
      "success",
    );
  }

  private setFaceMaterial(part: RenderPart, faceId: number, materialIndex: number): void {
    paintSurfaceFace(part.surface.geometry, part.faceRanges, faceId, materialIndex);
  }

  private resetFaceMaterials(): void {
    const selection = cadSelection.snapshot().items;
    this.parts.forEach((part) => {
      const selectsWholePart = selection.some(
        (item) => item.partId === part.data.id && (item.kind === "component" || item.kind === "body"),
      );
      const selectedFaces = new Set(
        selection
          .filter((item) => item.partId === part.data.id && item.faceId !== undefined)
          .map((item) => item.faceId),
      );
      const hover = this.tool === 'none' && this.selectionHover?.part === part ? this.selectionHover : null;
      setSurfaceGroups(part.surface.geometry, part.faceRanges, faceId =>
        selectsWholePart || selectedFaces.has(faceId) ? 2 : hover && (hover.faceId === undefined || hover.faceId === faceId) ? 1 : 0);
      const capHover = this.selectionHover?.part === part ? this.selectionHover.faceId : this.anchorFace?.part.data.id === part.data.id ? this.anchorFace.faceId : undefined;
      this.section.highlight(part.group, selectedFaces, capHover, selectsWholePart);
    });
    if (this.anchorFace) {
      const part = this.parts.get(this.anchorFace.part.data.id);
      if (part) this.setFaceMaterial(part, this.anchorFace.faceId, 1);
    }
  }

  private setConnectorMaterial(id: string, material: THREE.Material): void {
    const marker = this.connectorMarkers.get(id);
    if (marker) marker.hitTarget.material = material;
  }

  private refreshConnectorMaterials(): void {
    this.connectorMarkers.forEach((marker, id) => {
      marker.hitTarget.material =
        this.mateDraft.movingConnector?.id === id
          ? viewportMaterials.selectedConnector
          : viewportMaterials.connector;
    });
  }

  private clearTransientOverlay(): void {
    for (const child of [...this.overlayRoot.children]) {
      if (!child.userData.transient) continue;
      this.overlayRoot.remove(child);
      disposeTransientGeometry(child);
    }
  }
}
