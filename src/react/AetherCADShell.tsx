import { RightSidebarPanel, rightSidebarGroup } from './panels/right-sidebar';
import { CADSaveGuard } from './CADSaveGuard';
import { CADShareDocument } from "./CADShareDocument";
import { CADDocumentControls } from "./CADDocumentControls";
import { useCADCenterTools } from "./CADStudioControls";
import { cadFeaturePalette } from './cad-feature-tray';
import type { CADToolContext } from '../tools/availability';
import { CADStatusNotice } from "./CADStatusNotice";
import {CADCanvasDialog} from "./CADCanvasDialog";
import { CADVectorInsertDialog } from "./CADVectorInsertDialog";
import {queueCADImport} from "../modeling/cad-import-service";
import { CADMcMasterDialog } from "./CADMcMasterDialog";
import {CADImportDialog} from "./CADImportDialog";
import {CAD_IMPORT_ACCEPT} from "../modeling/cad-import";
import { CADWorkspaceLayoutPopover } from "./CADWorkspaceLayoutPopover";
import { CADPluginsIcon, CADPluginsWindow } from "./CADPluginsWindow";
import { CADDocumentTabs } from "./CADDocumentTabs";
import { CADDrive } from "./CADFilesPanel";
import { useStudioApplications } from "@aether/session/applications";
import { useDocumentConnection } from "@aether/session/useDocumentConnection";
import "./CADViewportLayout.css";
import { ExportCenter } from "./CADPartExportDialog";
import { CADSettingsWindow } from "./CADSettingsWindow";
import { PartAppearancePanel } from "./panels/part-appearance";
import { ConfigurationsPanel } from "./panels/configurations";
import { CADViewPanel } from "./CADViewPanel";
import { CADMetricsOverlay, CADPerformancePanel } from "./CADPerformancePanel";
import type { CADDocumentType } from "../cad-toolbar-layouts";
import { CADHistoryPanel } from "./panels/history";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  AetherIcon,
  DocumentCreateDialog,
  StandardAppShell,
  STANDARD_OBJECT_TABS,
  type LayoutPreset,
  type MenuItem,
  type WorkspacePanelState,
  type CommandPaletteCommand,
} from "@aether/ui";
import { CadIcon } from "./CadIcon";
import { DrawingWorkspaceRoute, StartCenter, useCADEnvironment, useCADViewCube, ViewportSurface } from "./chrome";
import { useFileTrayPreference } from "./chrome/use-file-tray-preference";
import { AssemblyInstanceDialog } from "./dialogs/instance";
import { AssemblyComponentDialog, AssemblyConnectorDialog, AssemblyMateDOFDialog, AssemblyMateDialog, AssemblyRelationDialog, AssemblyContactSetDialog, PartPropertiesDialog, BodiesToComponentDialog, AsBuiltJointDialog, ReachPointDialog, StandardPartDialog } from "./dialogs";
import {
  AdvisorPanel,
  InspectPanel,
  InspectorPanel,
  ItemsPanel,
  MatesPanel,
  VisualizationPanel,
  WorkbenchBottomPanel,
} from "./panels";
import {
  cadCommands,
  type CADCommandID,
  type CADCommandState,
} from "../cad-command-registry";
import { cadAssemblyWorkspace } from "../cad-assembly-workspace-store";


import { CADHeaderControls, useCADToolbar } from "./CADTraditionalRibbon";
import type { CADRibbonWorkspaceID, CADToolActionID } from "../cad-tool-catalog";
import {
  cadPresentation,
  requestCADPropertyPanel,
  type CADBrowserPanel,
} from "../cad-presentation-store";


const cadCommandCatalog: readonly Omit<CommandPaletteCommand, "disabled" | "disabledReason">[] = [
  { id: "new-part", label: "New Part", category: "File", keywords: ["create workspace"], shortcut: "⌘N", recent: true, icon: <AetherIcon name="plus" /> },
  { id: "open-part", label: "Open document", category: "File", keywords: ["load aethercad"], shortcut: "⌘O", icon: <AetherIcon name="open-external" /> },
  { id: "save-part", label: "Save document", category: "File", keywords: ["write aethercad"], shortcut: "⌘S", recent: true, icon: <AetherIcon name="import" /> },
  { id: "commit-part", label: "Create version", category: "File", keywords: ["commit checkpoint version name message"], recent: true, icon: <AetherIcon name="circle-filled" /> },
  { id: "insert-step", label: "Import CAD", category: "Insert", keywords: ["import step stp iges brep stl obj ply off mesh geometry"], icon: <AetherIcon name="export" /> },
  { id: "sketch", label: "Create Sketch", category: "Create", keywords: ["plane profile"], shortcut: "R", icon: <AetherIcon name="sketch" /> },
  { id: "rebuild-part", label: "Rebuild Part", category: "Create", keywords: ["evaluate extrude"], icon: <AetherIcon name="revolute" /> },
  { id: "connector", label: "Place Mate Connector", category: "Assembly", keywords: ["anchor frame"], icon: <AetherIcon name="keyframe" /> },
  { id: "fastened", label: "Create Fastened Mate", category: "Assembly", keywords: ["constraint fixed"], icon: "⛓" },
  { id: "assembly-edit-component", label: "Component Properties", category: "Assembly", keywords: ["move position rotate rename placement"], icon: <AetherIcon name="sliders" /> },
  { id: "assembly-open-component-part", label: "Open Source Part", category: "Assembly", keywords: ["edit component sketch extrude"], icon: <AetherIcon name="part" /> },
  { id: "assembly-toggle-visible", label: "Hide or Show Component", category: "Assembly", keywords: ["visibility"], icon: <AetherIcon name="eye" /> },
  { id: "assembly-insert-component", label: "Insert Component", category: "Assembly", keywords: ["part definition instance"], icon: <AetherIcon name="plus" /> },
  { id: "assembly-add-connector", label: "Add Manual Mate Connector", category: "Assembly", keywords: ["part local frame axis"], icon: <AetherIcon name="keyframe" /> },
  { id: "assembly-create-mate", label: "Create Assembly Mate", category: "Assembly", keywords: ["preview fastened revolute prismatic"], icon: "⛓" },
  { id: "assembly-set-mate-dof-value", label: "Set Mate DOF Value", category: "Assembly", keywords: ["angle distance pose"], icon: <AetherIcon name="revolute" /> },
  { id: "assembly-edit-mate-dof-limits", label: "Edit Mate DOF Limits", category: "Assembly", keywords: ["minimum maximum range"], icon: "↔" },
  { id: "assembly-create-relation", label: "Create DOF Relation", category: "Assembly", keywords: ["gear rack pinion screw linear drive"], icon: "⚙" },
  { id: "assembly-toggle-mate-suppressed", label: "Suppress or Restore Mate", category: "Assembly", keywords: ["constraint disable enable"], icon: "◌" },
  { id: "assembly-remove-mate", label: "Remove Mate", category: "Assembly", keywords: ["delete constraint"], icon: <AetherIcon name="close" /> },
  { id: "assembly-toggle-grounded", label: "Ground or Float Component", category: "Assembly", keywords: ["instance fixed free"], icon: <AetherIcon name="fit" /> },
  { id: "assembly-toggle-suppressed", label: "Suppress or Restore Component", category: "Assembly", keywords: ["instance configuration"], icon: "◌" },
  { id: "assembly-remove-instance", label: "Remove Component", category: "Assembly", keywords: ["delete instance"], icon: <AetherIcon name="minus" /> },
  { id: "assembly-make-independent", label: "Make Independent", category: "Assembly", keywords: ["paste new copy component"], icon: <AetherIcon name="copy" /> },
  { id: "assembly-linked-copy", label: "Linked Copy", category: "Assembly", keywords: ["another occurrence instance"], icon: <AetherIcon name="link" /> },
  { id: "assembly-part-properties", label: "Part Properties", category: "Assembly", keywords: ["part number description metadata"], icon: <AetherIcon name="settings" /> },
  { id: "assembly-bodies-to-component", label: "Bodies to Component", category: "Assembly", keywords: ["from bodies move sketches"], icon: <AetherIcon name="part" /> },
  { id: "assembly-as-built-joint", label: "As-Built Joint", category: "Assembly", keywords: ["joint where they are"], icon: <AetherIcon name="link" /> },
  { id: "assembly-unlock", label: "Unlock Contents", category: "Assembly", keywords: ["unlock rigid group fastened"], icon: <AetherIcon name="link" /> },
  { id: "assembly-rigid-group", label: "Rigid Group", category: "Assembly", keywords: ["move together fastened"], icon: <AetherIcon name="link" /> },
  { id: "assembly-insert-standard-part", label: "Insert Standard Part", category: "Assembly", keywords: ["fastener bolt screw nut washer bearing dowel"], icon: <AetherIcon name="plus" /> },
  { id: "assembly-resize-standard-part", label: "Change Part Size", category: "Assembly", keywords: ["resize fastener standard part"], icon: <AetherIcon name="sliders" /> },
  { id: "assembly-reach-point", label: "Reach Point", category: "Assembly", keywords: ["move occurrence to point"], icon: <AetherIcon name="fit" /> },
  { id: "clear-mates", label: "Clear Session Mates", category: "Assembly", keywords: ["remove constraints"], icon: <AetherIcon name="close" /> },
  { id: "fit-view", label: "Fit View", category: "View", keywords: ["zoom frame all"], shortcut: "F", recent: true, icon: <AetherIcon name="fit" /> },
  { id: "view-top", label: "Top View", category: "View", keywords: ["camera orientation"], icon: "T" },
  { id: "view-bottom", label: "Bottom View", category: "View", keywords: ["camera orientation"], icon: <AetherIcon name="chevron-down" /> },
  { id: "view-front", label: "Front View", category: "View", keywords: ["camera orientation"], icon: "F" },
  { id: "view-back", label: "Back View", category: "View", keywords: ["camera orientation"], icon: "B" },
  { id: "view-right", label: "Right View", category: "View", keywords: ["camera orientation"], icon: "R" },
  { id: "view-left", label: "Left View", category: "View", keywords: ["camera orientation"], icon: "L" },
  { id: "view-isometric", label: "Isometric View", category: "View", keywords: ["camera home orientation"], shortcut: "0", recent: true, icon: <AetherIcon name="keyframe" /> },
  { id: "display-shaded", label: "Shaded", category: "Display", keywords: ["solid faces"], icon: <AetherIcon name="square-dashed" /> },
  { id: "display-shaded-edges", label: "Shaded with Edges", category: "Display", keywords: ["solid outline"], recent: true, icon: "▧" },
  { id: "display-wireframe", label: "Wireframe", category: "Display", keywords: ["mesh lines"], icon: <AetherIcon name="keyframe" /> },
  { id: "display-hidden-line", label: "Hidden Line", category: "Display", keywords: ["technical outline"], icon: "▱" },
  { id: "display-ghost", label: "Ghost", category: "Display", keywords: ["transparent xray"], icon: "◌" },
  { id: "display-zebra", label: "Zebra analysis", category: "Display", keywords: ["stripes continuity surface"], icon: "▤" },
  { id: "display-draft-analysis", label: "Draft analysis", category: "Display", keywords: ["mould pull angle"], icon: "◭" },
  { id: "display-curvature-map", label: "Curvature map", category: "Display", keywords: ["inspect radius surface"], icon: "◭" },
  { id: "display-accessibility", label: "Accessibility", category: "Display", keywords: ["inspect tool reach undercut"], icon: "◭" },
  { id: "lighting-studio", label: "Studio Lighting", category: "Scene", keywords: ["environment balanced"], recent: true, icon: "☼" },
  { id: "lighting-softbox", label: "Softbox Lighting", category: "Scene", keywords: ["environment soft"], icon: <AetherIcon name="contrast" /> },
  { id: "lighting-daylight", label: "Daylight", category: "Scene", keywords: ["environment sun"], icon: "☀" },
  { id: "lighting-dark-room", label: "Dark Room", category: "Scene", keywords: ["environment contrast"], icon: "◑" },
  { id: "toggle-contact-shadows", label: "Toggle Contact Shadows", category: "Scene", keywords: ["floor depth"], icon: <AetherIcon name="appearance-light" /> },
  { id: "background-graphite", label: "Graphite Background", category: "Appearance", keywords: ["viewport backdrop"], icon: <AetherIcon name="circle-filled" /> },
  { id: "background-midnight", label: "Midnight Background", category: "Appearance", keywords: ["viewport backdrop blue"], icon: <AetherIcon name="contrast" /> },
  { id: "background-cad-light", label: "CAD Light Theme", category: "Appearance", keywords: ["viewport backdrop light paper"], icon: <AetherIcon name="appearance-light" /> },
  { id: "background-blueprint", label: "Blueprint Theme", category: "Appearance", keywords: ["viewport backdrop cyan drafting"], icon: <AetherIcon name="appearance-light" /> },
  { id: "finish-matte", label: "Matte Body Finish", category: "Appearance", keywords: ["material rough"], icon: <AetherIcon name="rectangle" /> },
  { id: "finish-satin", label: "Satin Body Finish", category: "Appearance", keywords: ["material balanced"], icon: "▧" },
  { id: "finish-gloss", label: "Gloss Body Finish", category: "Appearance", keywords: ["material shiny"], icon: <AetherIcon name="square-dashed" /> },
  { id: "ground-none", label: "Hide Ground", category: "Scene", keywords: ["floor grid none"], icon: <AetherIcon name="close" /> },
  { id: "ground-grid", label: "Show Grid", category: "Scene", keywords: ["ground reference"], icon: "#" },
  { id: "ground-floor", label: "Show Floor", category: "Scene", keywords: ["ground plane"], icon: <AetherIcon name="cube" /> },
  { id: "ground-both", label: "Show Grid and Floor", category: "Scene", keywords: ["ground reference plane"], icon: "▦" },
  { id: "toggle-feature-edges", label: "Toggle Feature Edges", category: "Appearance", keywords: ["exact outline"], icon: <AetherIcon name="keyframe" /> },
  { id: "reset-appearance", label: "Reset Viewport Appearance", category: "Appearance", keywords: ["defaults display scene"], icon: "↶" },
  { id: "selection-auto", label: "Selection Filter: Auto", category: "Selection", keywords: ["pick any"], recent: true, icon: "↖" },
  { id: "selection-component", label: "Selection Filter: Component", category: "Selection", keywords: ["occurrence assembly"], icon: "▦" },
  { id: "selection-next-filter", label: "Cycle Selection Filter", category: "Selection", keywords: ["next F6"], shortcut: "F6", icon: "⇥" },
];

function focusCommandSearch() {
  const field = document.querySelector<HTMLInputElement>('.aui-studio-document-bar .aui-command-search input');
  field?.focus(); field?.select();
}

export function buildCADCommandPaletteCommands(
  states: Readonly<Record<CADCommandID, CADCommandState>>,
  context: Omit<CADToolContext, "commands"> = { partOpen: false, assemblyReady: false },
): readonly CommandPaletteCommand[] {
  const legacy = cadCommandCatalog.map((command) => {
    // Guard against ids absent from the registry seed: a stale catalog entry
    // must degrade to a disabled command, never crash the shell at boot.
    const state = states[command.id as CADCommandID] as CADCommandState | undefined;
    const disabled = !state || !state.registered || !state.enabled;
    return {
      ...command,
      disabled,
      disabledReason: disabled
        ? state?.registered
          ? "Unavailable in the current workspace state."
          : "Command is not connected."
        : undefined,
    };
  });
  return cadFeaturePalette({ ...context, commands: states }, legacy);
}


// Shell chrome lives in ./chrome; the Assembly dialogs in ./dialogs.
// v2: the standard shell's panel ids (tree, five object tabs). v1 sessions are renamed on read.
const OPEN_PANELS_KEY = "aether-cad.open-panels.v2";
const LEGACY_OPEN_PANELS_KEY = "aether-cad.open-panels.v1";
const LEGACY_PANEL_IDS: Record<string, string> = { browser: "tree", inspector: "properties", inspect: "inspector", mates: "transform", view: "effects" };
export function readOpenPanels(): WorkspacePanelState {
  try {
    const own = sessionStorage.getItem(OPEN_PANELS_KEY);
    const saved: unknown = JSON.parse(own ?? sessionStorage.getItem(LEGACY_OPEN_PANELS_KEY) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return own ? saved as WorkspacePanelState : Object.fromEntries(Object.entries(saved).map(([id, state]) => [LEGACY_PANEL_IDS[id] ?? id, state]));
  } catch { return {}; }
}
const OBJECT_TAB_IDS: readonly string[] = STANDARD_OBJECT_TABS.map(tab => tab.id);
const panelSide = (id: string) => id === "tree" || id === "tree-toggle" ? null : OBJECT_TAB_IDS.includes(id) ? "right" : "left";
const shown = (state: WorkspacePanelState, id: string) => (state[id]?.placement ?? "hidden") !== "hidden";

export function AetherCADShell() {
  const applications = useStudioApplications();
  const presentation = useSyncExternalStore(
    cadPresentation.subscribe,
    cadPresentation.snapshot,
    cadPresentation.snapshot,
  );
  const commands = useSyncExternalStore(
    cadCommands.subscribe,
    cadCommands.snapshot,
    cadCommands.snapshot,
  );
  const [chromeTheme, setChromeTheme] = useState<"suite" | "classic">(() => {
    try { return localStorage.getItem("aether-cad.chrome.studio-v1") === "classic" ? "classic" : "suite"; } catch { return "suite"; }
  });
  const chooseChromeTheme = (theme: "suite" | "classic") => {
    setChromeTheme(theme);
    try { localStorage.setItem("aether-cad.chrome.studio-v1", theme); } catch { /* Session-only preference. */ }
  };
  const suite = chromeTheme === "suite";
  const [canvasOpen,setCanvasOpen]=useState<'canvas'|'decal'|null>(null);
  const [vectorInsert,setVectorInsert] = useState<'svg'|'dxf'|null>(null);
  const [mcMasterOpen,setMcMasterOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [layoutAnchor, setLayoutAnchor] = useState<HTMLElement | null>(null);
  const [ribbonWorkspace, setRibbonWorkspace] = useState<CADRibbonWorkspaceID>("solid");
  const [sketchEditing, setSketchEditing] = useState(false);
  useEffect(() => {
    const onSketchMode = (event: Event) => {
      const editing = Boolean((event as CustomEvent).detail);
      setSketchEditing(editing);
      setRibbonWorkspace(editing ? "sketch" : "solid");
    };
    window.addEventListener("aether-sketch-mode", onSketchMode);
    return () => window.removeEventListener("aether-sketch-mode", onSketchMode);
  }, []);
  const shellAssembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  // The Assembly workspace is a mode, not a file that has to be open: picking
  // it in the switcher shows the assembly ribbon over the same viewport.
  const documentType: CADDocumentType = presentation.workspaceMode === "drawing" ? "drawing" :
    presentation.workspaceMode === "assembly"
      || (shellAssembly.loadState === "ready" && shellAssembly.data !== null)
      ? "assembly"
      : presentation.partOpen
        ? "part"
        : "project";

  const runRibbonAction = (action: CADToolActionID) => {
    if (action in commands) {
      cadCommands.execute(action as CADCommandID);
      return;
    }
    switch (action) {
      case "insert-decal": setCanvasOpen('decal'); break;
      case "insert-canvas": setCanvasOpen('canvas'); break;
      case "insert-vector-svg": setVectorInsert('svg'); break;
      case "insert-vector-dxf": setVectorInsert('dxf'); break;
      case "insert-mesh": {
        const picker=document.createElement('input');picker.type='file';picker.accept='.stl,.obj,.ply,.off';picker.multiple=true;
        picker.onchange=()=>{if(picker.files?.length)queueCADImport([...picker.files]);};picker.click();break;
      }
      case "insert-mcmaster": setMcMasterOpen(true); break;
      case "new-assembly":
        cadPresentation.dispatch({ type: "create-assembly-workspace", name: "Assembly 1" });
        break;
      case "open-assembly":
        cadPresentation.dispatch({ type: "open-assembly-workspace" });
        break;
      case "save-assembly":
        cadPresentation.dispatch({ type: "save-assembly-workspace" });
        break;
      case "show-home":
        if (window.location.pathname.startsWith("/cad/")) window.location.assign("/cad/");
        else cadPresentation.dispatch({ type: "show-start-screen", screen: "home" });
        break;
      case "show-recovery":
        cadPresentation.dispatch({ type: "show-start-screen", screen: "recovery" });
        break;
      case "show-preferences":
        cadPresentation.dispatch({ type: "show-start-dialog", dialog: "preferences" });
        break;
      case "show-help":
        cadPresentation.dispatch({ type: "show-start-dialog", dialog: "help" });
        break;
      case "show-export":
        cadPresentation.dispatch({ type: "show-start-dialog", dialog: "export" });
        break;
      case "open-drawing":
        cadPresentation.dispatch({ type: "select-workspace-mode", mode: "drawing" });
        break;
      case "show-design-workspace":
        cadPresentation.dispatch({ type: "select-workspace-mode", mode: "modeling" });
        break;
      case "show-assembly-workspace":
        cadPresentation.dispatch({ type: "select-workspace-mode", mode: "assembly" });
        break;
      case "show-items":
        updateStudioPanels({ ...studioPanelState, tree: { ...studioPanelState.tree, placement: "docked" } });
        break;
      case "show-parameters":
      case "show-mates":
      case "show-inspect":
      case "show-visualization":
        openRightPanel(action.slice("show-".length));
        cadPresentation.dispatch({
          type: "select-panel",
          panel: action.slice("show-".length) as CADBrowserPanel,
        });
        break;
      case "show-history":
        cadPresentation.dispatch({ type: "set-bottom-panel-collapsed", collapsed: false });
        break;
      case "reset-panels":
        setPanelPositions({});
        cadPresentation.dispatch({ type: "reset-panel-placements" });
        break;
    }
  };

  // Per tab: the panel you work in (e.g. Version control) stays open when a
  // restore, merge, branch switch or refresh reloads the editor.
  const [panelPositions, setPanelPositions] = useState<WorkspacePanelState>(readOpenPanels);
  useEffect(() => { try { sessionStorage.setItem(OPEN_PANELS_KEY, JSON.stringify(panelPositions)); } catch { /* layout convenience only */ } }, [panelPositions]);

  const hostedConnection = useDocumentConnection({app:"cad",name:presentation.documentName,flush:async()=>{const {flushAutosaveNow}=await import("../host-library");await flushAutosaveNow();},saveCopy:async()=>{const {copyHostedSnapshot}=await import("../host-library");await copyHostedSnapshot();}});
  // "Create version" from any entry point (document menu, command palette, window menu) uses
  // the same dialog and validated operation as Version control.
  const [creatingVersion, setCreatingVersion] = useState(false);
  useEffect(() => {
    const open = () => setCreatingVersion(true);
    window.addEventListener("aether-create-version", open);
    return () => window.removeEventListener("aether-create-version", open);
  }, []);
  // Version snapshots use the same renderer as Drive's CAD file icons, so a
  // version's picture and the file's thumbnail always agree.
  const documentConnection = useMemo(() => hostedConnection && ({
    ...hostedConnection,
    previewRevision: async (revision: number) => {
      const saved = await hostedConnection.call<{ data_base64: string }>("read_revision", { revision });
      const bytes = Uint8Array.from(atob(saved.data_base64), char => char.charCodeAt(0));
      const { previewDocument } = await import("../preview-document");
      return previewDocument(new TextDecoder().decode(bytes));
    },
  }), [hostedConnection]);
  const documentID = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("document");

  const [rightRequest, setRightRequest] = useState({id: "inspector", sequence: 0});
  // The tree and the right tray's open/closed state persist in the presentation store (saved
  // layouts): `browser` is the item tree; `inspector` is whichever object tab is open.
  const rightOpen = OBJECT_TAB_IDS.some(id => shown(panelPositions, id));
  const studioPanelState: WorkspacePanelState = useMemo(() => ({
    ...panelPositions,
    tree: { ...panelPositions.tree, placement: presentation.panelPlacements.browser },
    ...(rightOpen ? {} : { properties: { ...panelPositions.properties, placement: presentation.panelPlacements.inspector } }),
  }), [panelPositions, rightOpen, presentation.panelPlacements.browser, presentation.panelPlacements.inspector]);
  const drawingMode = presentation.workspaceMode === "drawing";
  // Drawing owns its sheet tree and inspector. Keep the model panels mounted
  // and retain their layout so returning to the Part restores the same workspace.
  const drawingHiddenPanels = ["tree", ...OBJECT_TAB_IDS];
  const visiblePanelState: WorkspacePanelState = drawingMode
    ? { ...studioPanelState, ...Object.fromEntries(drawingHiddenPanels.map(id => [id, { ...studioPanelState[id], placement: "hidden" as const }])) }
    : studioPanelState;
  const updateStudioPanels = (state: WorkspacePanelState) => {
    const next = { ...state };
    // Each side tray shows one panel: opening one closes the others on its side. The item tree is pinned beside them.
    for (const side of ["left", "right"] as const) {
      const opened = Object.keys(state).find(id => panelSide(id) === side && shown(state, id) && !shown(studioPanelState, id));
      if (opened) for (const id of Object.keys(next)) if (panelSide(id) === side && id !== opened) next[id] = { ...next[id], placement: "hidden" };
    }
    setPanelPositions(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    const placements = {
      browser: next.tree?.placement ?? "hidden",
      inspector: OBJECT_TAB_IDS.map(id => next[id]?.placement).find(placement => placement && placement !== "hidden") ?? "hidden",
    } as const;
    for (const panel of ["browser", "inspector"] as const)
      if (placements[panel] !== presentation.panelPlacements[panel]) cadPresentation.dispatch({ type: "set-panel-placement", panel, placement: placements[panel] });
  };
  const openLeftPanel = (id: string) => updateStudioPanels({ ...studioPanelState, [id]: { ...studioPanelState[id], placement: "docked" } });
  const openRightPanel = (id: string) => {
    if (id === "material") id = "visualization";
    const requested = id;
    setRightRequest(previous => ({id: requested, sequence: previous.sequence + 1}));
    openLeftPanel(rightSidebarGroup(id));
  };
  // Authoring commands may request a property view; this never changes the model tree.
  useEffect(() => {
    if (presentation.activePanel !== "items") openRightPanel(presentation.activePanel);
  }, [presentation.activePanel, presentation.propertyPanelRequest]);

  // Docked and floating are whole workspaces: panels and tool bar move together.
  const layout: LayoutPreset = presentation.workspaceLayout === "expanded" ? "floating" : presentation.workspaceLayout;
  const switchLayout = (next: LayoutPreset) => {
    cadPresentation.dispatch({ type: "select-layout", layout: next === "floating" ? "expanded" : next });
    cadPresentation.dispatch({ type: "select-toolbar-mode", mode: next === "docked" ? "traditional" : "floating" });
    // Both layouts keep the feature tree in its column.
    if (presentation.panelPlacements.browser === "hidden") cadPresentation.dispatch({ type: "set-panel-placement", panel: "browser", placement: "docked" });
  };
  const searchCommands = buildCADCommandPaletteCommands(commands, { partOpen: presentation.partOpen, assemblyReady: shellAssembly.loadState === 'ready' });
  const runSearchCommand = (id: string) => {
    const command = searchCommands.find(item => item.id === id);
    if (command && !command.disabled && !id.startsWith('unavailable:')) runRibbonAction(id as CADToolActionID);
  };
  const openLayout = () => setLayoutAnchor(document.querySelector<HTMLElement>('.aui-workspace-ribbon-overflow'));
  const toolbar = useCADToolbar({ documentType, sketchEditing, activeWorkspace: ribbonWorkspace, partOpen: presentation.partOpen,
    onSelectWorkspace: setRibbonWorkspace, onAction: runRibbonAction, onOpenLayout: openLayout });
  const centerTools = useCADCenterTools();
  const { visible: showFileTabs, toggle: toggleFileTabs } = useFileTrayPreference();
  // The bottom tray shows one item at a time, like a side tray: File tabs or the history editor.
  const fileTabsOn = showFileTabs && !!documentConnection;
  const historyOn = !drawingMode && !presentation.bottomPanelCollapsed && !fileTabsOn;
  const viewCube = useCADViewCube();
  const environment = useCADEnvironment();
  const commandOff = (id: string) => !(commands as Record<string, CADCommandState | undefined>)[id]?.enabled;
  const windowCommands: MenuItem[] = [
    { id: "open-part", label: "Open file…", icon: <AetherIcon name="open" />, disabled: commandOff("open-part") },
    { id: "insert-step", label: "Import…", icon: <AetherIcon name="import" />, disabled: commandOff("insert-step") },
    { id: "show-export", label: "Export…", icon: <AetherIcon name="export" /> },
    { id: "window:create-version", label: "Create version…", icon: <AetherIcon name="version-create" />, separatorBefore: true, disabled: !documentConnection },
    { id: "window:notes", label: "Document notes", icon: <AetherIcon name="notes" /> },
    { id: "window:reminders", label: "Reminders", icon: <AetherIcon name="stopwatch" /> },
    { id: "window:tasks", label: "Action items", icon: <AetherIcon name="tasks" /> },
    { id: "window:plugins", label: "Plugins…", icon: <CADPluginsIcon /> },
    { id: "window:layout", label: "Panel layout…", icon: <AetherIcon name="layout" /> },
  ];
  const runCenterTray = (id: string) => {
    if (centerTools.run(id)) return;
    if (id === "file-tabs") { if (!fileTabsOn) cadPresentation.dispatch({ type: "set-bottom-panel-collapsed", collapsed: true }); toggleFileTabs(); }
    else if (id === "history") { if (fileTabsOn) toggleFileTabs(); cadPresentation.dispatch({ type: "set-bottom-panel-collapsed", collapsed: historyOn }); }
    else if (id === "window:create-version") setCreatingVersion(true);
    else if (id === "window:plugins") setPluginsOpen(true);
    else if (id === "window:layout") openLayout();
    else if (id.startsWith("window:")) openLeftPanel(id.slice("window:".length));
    else runRibbonAction(id as CADToolActionID);
  };

  return (
    <main className={`shell shapr-shell studio-shell aui-studio-app chrome-${chromeTheme} toolbar-${suite ? "traditional" : presentation.toolbarMode}`}>
      {shareOpen && <CADShareDocument onClose={()=>setShareOpen(false)}/>}
      {creatingVersion && documentConnection && <DocumentCreateDialog connection={documentConnection} mode="version" onClose={() => setCreatingVersion(false)}/>}
      {pluginsOpen && <CADPluginsWindow onClose={() => setPluginsOpen(false)}/>}
      <CADWorkspaceLayoutPopover anchor={layoutAnchor} onClose={() => setLayoutAnchor(null)}
        panels={[
          {id:'tree',label:'Features and parts',placement:studioPanelState.tree.placement},
          {id:'properties',label:'Properties',placement:studioPanelState.properties?.placement ?? 'hidden'},
        ]}
        onPlacement={(id,placement)=>updateStudioPanels({...studioPanelState,[id]:{...studioPanelState[id],placement}})}
        onReset={()=>runRibbonAction('reset-panels')} />
      <input id="document-picker" type="file" accept=".aethercad,application/vnd.aether.workspace+zip" hidden />
      <input id="step-picker" type="file" accept={CAD_IMPORT_ACCEPT} multiple hidden />
      {centerTools.overlays}
      <section
        className="cad-studio-workspace"
        data-layout={presentation.workspaceLayout}
        data-toolbar-mode={suite ? "traditional" : presentation.toolbarMode}
        data-workspace-mode={presentation.workspaceMode}
        aria-label="CAD workspace"
      >
        <CADSaveGuard />
        <StandardAppShell
          application={{ apps: applications, id: "cad", name: "Aether CAD", onShare:()=>setShareOpen(true), onSettings: () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: "preferences" }),
            onHome: event => { if (!window.location.pathname.startsWith("/cad/")) { event.preventDefault(); cadPresentation.dispatch({type: "show-start-screen", screen: "home"}); } } }}
          documentName={presentation.documentName}
          documentMenu={<CADDocumentControls name={presentation.documentName} partOpen={presentation.partOpen} menuOnly/>}
          documentState={<CADDocumentControls name={presentation.documentName} partOpen={presentation.partOpen} workspaceOnly/>}
          headerTrailing={drawingMode ? undefined : <div className="cad-header-controls"><CADHeaderControls documentType={documentType} sketchEditing={sketchEditing} partOpen={presentation.partOpen}/></div>}
          commands={searchCommands} onCommand={runSearchCommand}
          layout={layout} onLayoutChange={switchLayout}
          toolbar={toolbar}
          tree={{ title: "Features and parts", icon: <AetherIcon name="features-parts" />, content: <ItemsPanel active onShowAppearance={() => requestCADPropertyPanel("visualization")} /> }}
          advisor={<AdvisorPanel connection={documentConnection} />}
          connection={documentConnection ?? undefined}
          history={<CADHistoryPanel key={documentConnection?.key ?? presentation.documentName}/>} historyTabStorageKey="aether-cad.history-tab"
          files={{ local: { label: "This design", icon: <AetherIcon name="cube" />, content: documentConnection ? <CADDocumentTabs connection={documentConnection} variant="browser"/> : null },
            drive: documentConnection ? <CADDrive documentID={documentID} connection={documentConnection}/> : null }}
          objectTabs={{
            inspector: <RightSidebarPanel label="Inspector" request={rightRequest} tabs={[
              {id:"inspect",label:"Analysis",content:<InspectPanel active/>},
              {id:"performance",label:"Performance",content:<CADPerformancePanel active/>},
            ]}/>,
            properties: <RightSidebarPanel label="Properties" request={rightRequest} tabs={[
              {id:"inspector",label:"Properties",content:<InspectorPanel placement={presentation.panelPlacements.inspector}/>},
              {id:"parameters",label:"Configurations",content:<ConfigurationsPanel/>},
            ]}/>,
            appearance: <RightSidebarPanel label="Materials and appearance" request={rightRequest} tabs={[{id:"visualization",label:"Material",content:<PartAppearancePanel/>}]}/>,
            transform: <RightSidebarPanel label="Transform" request={rightRequest} tabs={[{id:"mates",label:"Assembly",content:<MatesPanel active/>}]}/>,
            effects: <RightSidebarPanel label="Effects" request={rightRequest} tabs={[
              {id:"rendering",label:"Environment",content:<VisualizationPanel active/>},
              {id:"view",label:"Camera",content:<CADViewPanel active/>},
            ]}/>,
          }}
          centerTray={{ tools: centerTools.tools, onAction: runCenterTray, windowCommands,
            toggles: [
              { id: "history", label: "Feature history", icon: <CadIcon name="history" />, pressed: historyOn },
              // ponytail: the legacy document tab tray, kept beside History for now (Jonathan, 2026-11-12).
              ...(documentConnection ? [{ id: "file-tabs", label: "File tabs", icon: <AetherIcon name="part-manager" />, pressed: fileTabsOn }] : []),
            ] }}
          environment={drawingMode ? undefined : environment}
          cube={drawingMode ? undefined : viewCube}
          bottom={fileTabsOn ? <CADDocumentTabs connection={documentConnection!} docked={presentation.workspaceLayout === "docked"} />
            : historyOn ? <WorkbenchBottomPanel presentation={presentation} /> : undefined}
          panelState={visiblePanelState}
          onPanelStateChange={state => updateStudioPanels(drawingMode ? { ...state, ...Object.fromEntries(drawingHiddenPanels.map(id => [id, studioPanelState[id] ?? { placement: "hidden" as const }])) } : state)}
          sidebarSizing={{width:280,minWidth:240,maxWidth:520,minCenterWidth:240}}
        >
          <div className="cad-studio-viewport" aria-hidden={drawingMode} inert={drawingMode}>
            <ViewportSurface presentation={presentation} />
          </div>
          <DrawingWorkspaceRoute active={drawingMode} />
        </StandardAppShell>
      </section>
      <StartCenter presentation={presentation} />
      <AssemblyInstanceDialog presentation={presentation} />
      <AssemblyComponentDialog presentation={presentation} />
      <AssemblyConnectorDialog presentation={presentation} />
      <AssemblyMateDialog presentation={presentation} />
      <AssemblyMateDOFDialog presentation={presentation} />
      <AssemblyRelationDialog presentation={presentation} /><AssemblyContactSetDialog presentation={presentation} /><PartPropertiesDialog presentation={presentation} /><BodiesToComponentDialog presentation={presentation} /><AsBuiltJointDialog presentation={presentation} /><ReachPointDialog presentation={presentation} /><StandardPartDialog presentation={presentation} />
      <ExportCenter presentation={presentation} />
      <CADCanvasDialog open={canvasOpen!==null} decal={canvasOpen==='decal'} onClose={()=>setCanvasOpen(null)} />
      <CADVectorInsertDialog format={vectorInsert} onClose={()=>setVectorInsert(null)} />
      <CADMcMasterDialog open={mcMasterOpen} onClose={()=>setMcMasterOpen(false)} />
      <CADImportDialog presentation={presentation} />
      <CADMetricsOverlay />
      <CADSettingsWindow
        open={presentation.startDialog === "preferences" || presentation.startDialog === "graphics-preferences" || presentation.startDialog === "help"}
        initialPane={presentation.startDialog === "help" ? "help" : presentation.startDialog === "graphics-preferences" ? "appearance" : "workspace"}
        onClose={() => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null })}
        chromeTheme={chromeTheme}
        onChromeTheme={chooseChromeTheme}
        paletteCommands={buildCADCommandPaletteCommands(commands, { partOpen: presentation.partOpen, assemblyReady: shellAssembly.loadState === 'ready' })}
        onOpenCommandPalette={() => requestAnimationFrame(focusCommandSearch)}
      />
      {presentation.statusTone === "error" ? <CADStatusNotice message={presentation.statusMessage} onDismiss={() => cadPresentation.patch({ statusMessage: "", statusTone: "normal" })} /> :
        <span className="cad-screen-reader-status" id="status-message" role="status" aria-live="polite" aria-atomic="true">{presentation.statusMessage}</span>}
      {presentation.loading?.backgrounded && <button className="cad-background-task cad-task-resume" type="button" onClick={() => cadPresentation.dispatch({ type: "show-loading" })}>Show import task</button>}

    </main>
  );
}
