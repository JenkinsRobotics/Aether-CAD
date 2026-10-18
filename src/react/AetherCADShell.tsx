import { cadFeaturePalette } from './cad-feature-tray';
import { sketchContextCommands } from '../sketch/context-commands';
import type { CADToolContext } from '../tools/availability';
import {CADPrimitiveDialog} from "./CADPrimitiveDialog";
import { CADStatusNotice } from "./CADStatusNotice";
import type {SolidPrimitive} from "../modeling/solid-primitives";
import {CADCanvasDialog} from "./CADCanvasDialog";
import { CADVectorInsertDialog } from "./CADVectorInsertDialog";
import {queueCADImport} from "../modeling/cad-import-service";
import { CADMcMasterDialog } from "./CADMcMasterDialog";
import {CADImportDialog} from "./CADImportDialog";
import {CAD_IMPORT_ACCEPT} from "../modeling/cad-import";
import { CADWorkspaceLayoutPopover } from "./CADWorkspaceLayoutPopover";
import { CADPluginsIcon, CADPluginsWindow } from "./CADPluginsWindow";
import { useContextCommands } from '@aether/ui';
import { CADDocumentTabs } from "./CADDocumentTabs";
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
import { CADVersionsPanel } from "./CADVersionsPanel";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  AetherIcon,
  CommandPalette,
  StudioDocumentBar as DocumentBar,
  StudioModeButton,
  WorkspaceWindowMenu,
  StudioWorkspace as WorkspaceShell,
  standardWorkspacePanels,
  type WorkspacePanelState,
  type WorkspacePanel,
  type CommandPaletteCommand,
  ToolIcon,
} from "@aether/ui";
import { CadIcon } from "./CadIcon";
import { DrawingWorkspaceRoute, SelectionFilterHud, StartCenter, ViewportCameraNavigation, ViewportSurface } from "./chrome";
import { AssemblyComponentDialog, AssemblyConnectorDialog, AssemblyMateDOFDialog, AssemblyMateDialog, AssemblyRelationDialog } from "./dialogs";
import {
  ActionItemsPanel,
  AdvisorPanel,
  CommentsPanel,
  CreateVersionPanel,
  DocumentNotesPanel,
  InspectPanel,
  InspectorPanel,
  ItemsPanel,
  MatesPanel,
  RemindersPanel,
  VisualizationPanel,
  WorkbenchBottomPanel,
} from "./panels";
import {
  cadCommands,
  type CADCommandID,
  type CADCommandState,
} from "../cad-command-registry";
import { cadAssemblyWorkspace } from "../cad-assembly-workspace-store";


import { CADTraditionalRibbon, CADWorkspaceSwitcher } from "./CADTraditionalRibbon";
import type { CADRibbonWorkspaceID, CADToolActionID } from "../cad-tool-catalog";
import {
  cadPresentation,
  requestCADPropertyPanel,
  type CADBrowserPanel,
} from "../cad-presentation-store";


const cadCommandCatalog: readonly Omit<CommandPaletteCommand, "disabled" | "disabledReason">[] = [
  { id: "new-part", label: "New Part", category: "File", keywords: ["create workspace"], shortcut: "⌘N", recent: true, icon: <AetherIcon name="plus" /> },
  { id: "open-part", label: "Open Part", category: "File", keywords: ["load cadpart"], shortcut: "⌘O", icon: <AetherIcon name="open-external" /> },
  { id: "save-part", label: "Save Part", category: "File", keywords: ["write cadpart"], shortcut: "⌘S", recent: true, icon: <AetherIcon name="import" /> },
  { id: "commit-part", label: "Commit", category: "File", keywords: ["checkpoint version name message"], recent: true, icon: <AetherIcon name="circle-filled" /> },
  { id: "insert-step", label: "Import CAD", category: "Insert", keywords: ["import step stp iges brep stl obj ply off mesh geometry"], icon: <AetherIcon name="export" /> },
  { id: "sketch", label: "Create Sketch", category: "Create", keywords: ["plane profile"], shortcut: "R", icon: <AetherIcon name="sketch" /> },
  { id: "rebuild-part", label: "Rebuild Part", category: "Create", keywords: ["evaluate extrude"], icon: <AetherIcon name="revolute" /> },
  { id: "connector", label: "Place Mate Connector", category: "Assembly", keywords: ["anchor frame"], icon: <AetherIcon name="keyframe" /> },
  { id: "fastened", label: "Create Fastened Mate", category: "Assembly", keywords: ["constraint fixed"], icon: "⛓" },
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
  { id: "selection-body", label: "Selection Filter: Body", category: "Selection", keywords: ["solid"], icon: <AetherIcon name="keyframe" /> },
  { id: "selection-face", label: "Selection Filter: Face", category: "Selection", keywords: ["surface topology"], icon: "▱" },
  { id: "selection-edge", label: "Selection Filter: Edge", category: "Selection", keywords: ["curve topology"], icon: "╱" },
  { id: "selection-vertex", label: "Selection Filter: Vertex", category: "Selection", keywords: ["point topology"], icon: "·" },
  { id: "selection-next-filter", label: "Cycle Selection Filter", category: "Selection", keywords: ["next F6"], shortcut: "F6", icon: "⇥" },
];

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
  useContextCommands([
    ...sketchContextCommands(),
    { id:'undo', label:'Undo sketch', heading:'Edit', disabled:!commands['sketch-undo']?.enabled, run:() => { cadCommands.execute('sketch-undo'); } },
    { id:'redo', label:'Redo sketch', disabled:!commands['sketch-redo']?.enabled, run:() => { cadCommands.execute('sketch-redo'); } },
    { id:'zoom-fit', label:'Fit view', heading:'View', separatorBefore:true, disabled:!commands['fit-view']?.enabled, run:() => { cadCommands.execute('fit-view'); } },
  ]);
  const [chromeTheme, setChromeTheme] = useState<"suite" | "classic">(() => {
    try { return localStorage.getItem("aether-cad-chrome-theme") === "classic" ? "classic" : "suite"; } catch { return "suite"; }
  });
  const chooseChromeTheme = (theme: "suite" | "classic") => {
    setChromeTheme(theme);
    try { localStorage.setItem("aether-cad-chrome-theme", theme); } catch { /* Session-only preference. */ }
  };
  const suite = chromeTheme === "suite";
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [canvasOpen,setCanvasOpen]=useState<'canvas'|'decal'|null>(null);
  const [primitive,setPrimitive] = useState<SolidPrimitive|null>(null);
  const [vectorInsert,setVectorInsert] = useState<'svg'|'dxf'|null>(null);
  const [mcMasterOpen,setMcMasterOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [layoutAnchor, setLayoutAnchor] = useState<HTMLElement | null>(null);
  const [ribbonWorkspace, setRibbonWorkspace] = useState<CADRibbonWorkspaceID>("solid");
  const [sketchEditing, setSketchEditing] = useState(false);
  useEffect(() => {
    const onSketchMode = (event: Event) => setSketchEditing(Boolean((event as CustomEvent).detail));
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
  const documentType: CADDocumentType =
    presentation.workspaceMode === "assembly"
      || (shellAssembly.loadState === "ready" && shellAssembly.data !== null)
      ? "assembly"
      : presentation.partOpen
        ? "part"
        : "project";
  useEffect(() => {
    const onSketchMode=(event:Event)=>setRibbonWorkspace((event as CustomEvent).detail ? "sketch" : "solid");
    window.addEventListener("aether-sketch-mode",onSketchMode);
    return ()=>window.removeEventListener("aether-sketch-mode",onSketchMode);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "k") return;
      event.preventDefault();
      setCommandPaletteOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const runRibbonAction = (action: CADToolActionID) => {
    if (action in commands) {
      cadCommands.execute(action as CADCommandID);
      return;
    }
    switch (action) {
      case "insert-decal": setCanvasOpen('decal'); break;
      case "create-box": case "create-cylinder": case "create-cone": case "create-sphere": case "create-torus": setPrimitive(action.slice(7) as SolidPrimitive); break;
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
        openLeftPanel("browser");
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
        if (suite) openLeftPanel("history");
        else cadPresentation.dispatch({ type: "toggle-history" });
        break;
      case "reset-panels":
        setPanelPositions({});
        cadPresentation.dispatch({ type: "reset-panel-placements" });
        break;
    }
  };

  const selectRibbonWorkspace = (workspace: CADRibbonWorkspaceID) => {
    setRibbonWorkspace(workspace);

  };

  const [panelPositions, setPanelPositions] = useState<WorkspacePanelState>({});
  const previousHistoryCollapsed = useRef(presentation.bottomPanelCollapsed);
  useEffect(() => {
    if (suite && previousHistoryCollapsed.current !== presentation.bottomPanelCollapsed) {
      openLeftPanel("history");
    }
    previousHistoryCollapsed.current = presentation.bottomPanelCollapsed;
  }, [suite, presentation.bottomPanelCollapsed]);

  // The left rail, in the order Jonathan set (2026-10-02): Features and parts,
  // Version control, Create version, Comments, Document notes, Reminders,
  // AI advisor and Action items. File management lives beside the bottom tabs. History is the suite
  // theme's only route to the rollback bar, so it keeps a seat before the end.
  const documentConnection = useDocumentConnection({app:"cad",name:presentation.documentName,flush:async()=>{const {flushAutosaveNow}=await import("../host-library");await flushAutosaveNow();},saveCopy:async()=>{const {copyHostedSnapshot}=await import("../host-library");await copyHostedSnapshot();}});
  const hasDeviceReminders=(()=>{try{return typeof location!=="undefined"&&Array.isArray(JSON.parse(localStorage.getItem(`aether-cad.reminders.${new URLSearchParams(location.search).get('document')??'draft'}`)??'null'));}catch{return false;}})();
  const leftPanels: WorkspacePanel[] = standardWorkspacePanels([
    { id: "browser", title: "Features and parts", icon: <AetherIcon name="features-parts" />, chromeless: true, content: <ItemsPanel active onShowAppearance={() => requestCADPropertyPanel("visualization")} /> },
    { id: "versions", title: "Version control", icon: <AetherIcon name="version-control" />, content: <CADVersionsPanel documentName={presentation.documentName} /> },
    { id: "create-version", title: "Create version", icon: <AetherIcon name="version-create" />, floatingHeight: "content", content: <CreateVersionPanel /> },
    { id: "comments", title: "Comments", icon: <AetherIcon name="comment" />, content: <CommentsPanel /> },
    { id: "notes", title: "Document notes", icon: <AetherIcon name="notes" />, content: <DocumentNotesPanel /> },
    { id: "reminders", title: "Reminders", icon: <AetherIcon name="stopwatch" />, content: <RemindersPanel /> },
    { id: "advisor", title: "AI advisor", icon: <AetherIcon name="advisor" />, content: <AdvisorPanel /> },
    { id: "tasks", title: "Action items", icon: <AetherIcon name="tasks" />, content: <ActionItemsPanel /> },
    ...(hasDeviceReminders?[{id:'device-reminders',title:'Device reminders',icon:<AetherIcon name="stopwatch"/>,content:<RemindersPanel/>}]:[]),
    ...(suite ? [{ id: "history", title: "History", icon: <CadIcon name="history" />, content: <WorkbenchBottomPanel presentation={presentation} sidebar /> }] : []),
  ], { features: "browser" }, documentConnection).filter(panel => panel.id !== "part-manager");
  const rightPanels: WorkspacePanel[] = [
    { id: "inspector", title: "Properties", icon: <ToolIcon name="properties" />, content: <InspectorPanel placement={presentation.panelPlacements.inspector} /> },
    { id: "parameters", title: "Configurations", icon: <AetherIcon name="columns" />, content: <ConfigurationsPanel /> },
    { id: "mates", title: "Assembly", icon: <ToolIcon name="assembly" />, content: <MatesPanel active /> },
    { id: "inspect", title: "Measure and inspect", icon: <ToolIcon name="measure" />, content: <InspectPanel active /> },
    { id: "visualization", title: "Material properties", icon: <AetherIcon name="appearance-system" />, separatorBefore: true, content: <PartAppearancePanel /> },
    { id: "rendering", title: "Rendering environment", icon: <ToolIcon name="light" />, content: <VisualizationPanel active /> },
    { id: "view", title: "Camera and display", icon: <ToolIcon name="view-top" />, content: <CADViewPanel active /> },
    { id: "performance", title: "Performance", icon: <AetherIcon name="gauge" />, content: <CADPerformancePanel active /> },
  ];

  const studioPanelState: WorkspacePanelState = useMemo(() => ({
    ...panelPositions,
    browser: { ...panelPositions.browser, placement: presentation.panelPlacements.browser },
    inspector: { ...panelPositions.inspector, placement: presentation.panelPlacements.inspector },
  }), [panelPositions, presentation.panelPlacements.browser, presentation.panelPlacements.inspector]);
  // Derive routing groups from the actual rails so new panels cannot bypass
  // same-side exclusivity (Comments/Notes/Tasks and View/Performance did).
  // Features and parts is pinned (Onshape): it keeps its column while the
  // rail's other panels open beside it, so it is outside this exclusivity.
  const leftPanelIDs = leftPanels.map(panel => panel.id).filter(id => id !== "browser");
  const rightPanelIDs = rightPanels.map(panel => panel.id);
  const openLeftPanel = (id: string) => {
    const next = { ...studioPanelState };
    for (const key of leftPanelIDs) next[key] = { ...next[key], placement: key === id ? "docked" : "hidden" };
    updateStudioPanels(next);
  };
  const openRightPanel = (id: string) => {
    if (id === "material") id = "visualization";
    const next = { ...studioPanelState };
    for (const key of rightPanelIDs) next[key] = { ...next[key], placement: key === id ? "docked" : "hidden" };
    updateStudioPanels(next);
  };
  const updateStudioPanels = (state: WorkspacePanelState) => {
    const next = { ...state };
    // Rails select a view within their side, rather than stacking competing views.
    for (const ids of [leftPanelIDs, rightPanelIDs]) {
      const opened = ids.find(id => state[id]?.placement && state[id].placement !== "hidden"
        && (!studioPanelState[id] || studioPanelState[id].placement === "hidden"));
      if (opened) for (const id of ids) if (id !== opened) next[id] = { ...next[id], placement: "hidden" };
    }
    setPanelPositions(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    for (const panel of ["browser", "inspector"] as const) {
      const placement = next[panel]?.placement ?? "hidden";
      if (placement !== presentation.panelPlacements[panel]) {
        cadPresentation.dispatch({ type: "set-panel-placement", panel, placement });
      }
    }
  };
  // Authoring commands may request a property view; this never changes the model tree.
  useEffect(() => {
    if (presentation.activePanel !== "items") openRightPanel(presentation.activePanel);
  }, [presentation.activePanel, presentation.propertyPanelRequest]);

  return (
    <main className={`shell shapr-shell studio-shell aui-studio-app chrome-${chromeTheme} toolbar-${suite ? "traditional" : presentation.toolbarMode}`}>
      {pluginsOpen && <CADPluginsWindow onClose={() => setPluginsOpen(false)}/>}
      <CADWorkspaceLayoutPopover anchor={layoutAnchor} onClose={() => setLayoutAnchor(null)}
        toolbarMode={presentation.toolbarMode}
        onToolbarMode={mode => cadPresentation.dispatch({type:'select-toolbar-mode',mode})}
        panels={[
          {id:'browser',label:'Features and parts',placement:studioPanelState.browser.placement},
          {id:'inspector',label:'Properties',placement:studioPanelState.inspector.placement},
          ...(suite ? [{id:'history',label:'Feature history',placement:studioPanelState.history?.placement ?? 'hidden' as const}] : []),
        ]}
        onPlacement={(id,placement)=>updateStudioPanels({...studioPanelState,[id]:{...studioPanelState[id],placement}})}
        onReset={()=>runRibbonAction('reset-panels')} />
      <DocumentBar
        className="cad-document-bar"
        documentName={presentation.documentName}
        application={{ apps: applications, id: "cad", name: "Aether CAD", onSettings: () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: "preferences" }),
          onHome: event => { if (!window.location.pathname.startsWith("/cad/")) { event.preventDefault(); cadPresentation.dispatch({type: "show-start-screen", screen: "home"}); } } }}
        leading={
          <>
            
            {/* Application and workspace controls. Document controls live with the bottom tabs. */}
            <input id="part-picker" type="file" accept=".acpart,.cadpart,application/json" hidden />
            <input id="assembly-picker" type="file" accept=".acad,.acasm,.aether,application/vnd.acad.workspace+zip,application/zip" hidden />
            <input id="step-picker" type="file" accept={CAD_IMPORT_ACCEPT} multiple hidden />
          </>
        }
        viewControls={
            <div className="aui-studio-chrome-group">
              <StudioModeButton
                preset={presentation.workspaceLayout === "expanded" ? "floating" : presentation.workspaceLayout}
                onChange={(preset) => cadPresentation.dispatch({ type: "select-layout", layout: preset === "floating" ? "expanded" : preset })}
                extraItems={[
                  { id: "toolbar-traditional", label: "Traditional ribbon", kind: "radio", checked: presentation.toolbarMode === "traditional", separatorBefore: true },
                  { id: "toolbar-floating", label: "Floating tools", kind: "radio", checked: presentation.toolbarMode === "floating" },
                  { id: "reset-panels", label: "Reset panel placements", separatorBefore: true },
                ]}
                onExtraSelect={(id) => {
                  if (id === "reset-panels") cadPresentation.dispatch({ type: "reset-panel-placements" });
                  else cadPresentation.dispatch({ type: "select-toolbar-mode", mode: id === "toolbar-traditional" ? "traditional" : "floating" });
                }}
              />
              <WorkspaceWindowMenu />
              <button className="aui-menu-trigger" aria-label="Plugins" title="Plugins" onClick={() => setPluginsOpen(true)}><CADPluginsIcon/></button>
              <button className="aui-menu-trigger" aria-label="Workspace layout" title="Workspace layout" aria-haspopup="dialog" aria-expanded={!!layoutAnchor} onClick={event=>setLayoutAnchor(layoutAnchor ? null : event.currentTarget)}><AetherIcon name="layout"/></button>
              <button className="aui-menu-trigger" aria-label="Comments" title="Comments" onClick={()=>openLeftPanel('comments')}><AetherIcon name="comment"/></button>
              <button className="aui-menu-trigger" aria-label="Reminders" title="Reminders" onClick={()=>openLeftPanel('reminders')}><AetherIcon name="stopwatch"/></button>
            </div>
        }
      />
      <section
        className={`cad-studio-workspace panel-bottom-${presentation.panelPlacements.bottom}`}
        data-layout={presentation.workspaceLayout}
        data-toolbar-mode={suite ? "traditional" : presentation.toolbarMode}
        data-workspace-mode={presentation.workspaceMode}
        aria-label="CAD workspace"
        aria-hidden={presentation.startScreen !== "workspace"}
        inert={presentation.startScreen !== "workspace"}
      >
        <WorkspaceShell
          workspaceControls={<CADWorkspaceSwitcher documentType={documentType} onAction={runRibbonAction} />}
          contentPresentation={presentation.workspaceMode === "drawing" ? "framed" : "canvas"}
          preset={presentation.workspaceLayout === "expanded" ? "floating" : presentation.workspaceLayout}
          preservePanelContent
          toolbarSpan="center"
          pinnedPanels={["browser"]}
          sideBottom={{ right: sketchEditing ? null : <SelectionFilterHud /> }}
          style={{ height: "100%" }}
          panelState={studioPanelState}
          onPanelStateChange={updateStudioPanels}
          toolbar={<CADTraditionalRibbon
            suite={suite}
            documentType={documentType}
            sketchEditing={sketchEditing}
            activeWorkspace={ribbonWorkspace}
            partOpen={presentation.partOpen}
            onSelectWorkspace={selectRibbonWorkspace}
            onAction={runRibbonAction}
          />}
          leftPanels={leftPanels}
          rightPanels={rightPanels}
          bottom={<>{suite ? null : <WorkbenchBottomPanel presentation={presentation} />}<CADDocumentTabs connection={documentConnection} /></>}
        >
          <div className="cad-studio-viewport" aria-hidden={presentation.workspaceMode === "drawing"} inert={presentation.workspaceMode === "drawing"}>
            <ViewportSurface presentation={presentation} />
          </div>
          <DrawingWorkspaceRoute active={presentation.workspaceMode === "drawing"} />
          {presentation.workspaceMode !== "drawing" && <div className="cad-studio-camera-navigation"><ViewportCameraNavigation /></div>}
        </WorkspaceShell>
      </section>
      <StartCenter presentation={presentation} />
      <AssemblyComponentDialog presentation={presentation} />
      <AssemblyConnectorDialog presentation={presentation} />
      <AssemblyMateDialog presentation={presentation} />
      <AssemblyMateDOFDialog presentation={presentation} />
      <AssemblyRelationDialog presentation={presentation} />
      <ExportCenter presentation={presentation} />
      <CADCanvasDialog open={canvasOpen!==null} decal={canvasOpen==='decal'} onClose={()=>setCanvasOpen(null)} />
      <CADPrimitiveDialog kind={primitive} onClose={()=>setPrimitive(null)} />
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
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />
      <CommandPalette
        open={commandPaletteOpen}
        commands={buildCADCommandPaletteCommands(commands, { partOpen: presentation.partOpen, assemblyReady: shellAssembly.loadState === 'ready' })}
        title="CAD commands"
        placeholder="Search CAD commands"
        onClose={() => setCommandPaletteOpen(false)}
        onSelect={(id) => { if (!id.startsWith('unavailable:')) runRibbonAction(id as CADToolActionID); }}
      />
      {presentation.statusTone === "error" ? <CADStatusNotice message={presentation.statusMessage} onDismiss={() => cadPresentation.patch({ statusMessage: "", statusTone: "normal" })} /> :
        <span className="cad-screen-reader-status" id="status-message" role="status" aria-live="polite" aria-atomic="true">{presentation.statusMessage}</span>}
      {presentation.loading?.backgrounded && <button className="cad-background-task cad-task-resume" type="button" onClick={() => cadPresentation.dispatch({ type: "show-loading" })}>Show import task</button>}

    </main>
  );
}
