import { cadFeatureTray } from './cad-feature-tray';
import { cadFeatureToolById } from '../tools/feature-library';
import { cadToolAvailability } from '../tools/availability';
import { selectionMenu } from "./cad-selection-menu";
import { toolHelpFor } from "../tools/tool-help";
import { useState, useSyncExternalStore } from "react";
import {
  ToolIcon, InspectionIcon, SelectionIcon, WorkspaceRibbon, WorkspaceSwitcher,
  type MenuItem, type WorkspaceRibbonCommand, type WorkspaceRibbonDensity, type WorkspaceRibbonTab, type WorkspaceRibbonGroup,
} from "@aether/ui";
import { cadAssemblyWorkspace } from "../cad-assembly-workspace-store";
import { cadCommands, isCADCommandID } from "../cad-command-registry";
import { type CADWorkspaceMode, cadPresentation } from "../cad-presentation-store";
import {
  type CADRibbonWorkspaceID,
  type CADToolActionID,
  type CADToolDefinition,
} from "../cad-tool-catalog";
import {
  fusionTabsFor,
  sketchContextTab,
  toolbarTabsFor,
  toolbarToolById,
  toolbarWorkspaceFor,
  toolbarMenuToolsFor,
  type CADDocumentType,
  type CADToolbarTab,
} from "../cad-toolbar-layouts";
import { useEffect } from "react";

/** The workspace switcher beside the tabs. Design, Assembly and Drawing are
 *  real workspaces and run; the rest name what Aether Studio plans and say
 *  why they are not here yet. Creating documents lives here rather than on
 *  the Design ribbon — a new Part is not a modelling operation. */
function workspaceModes(mode: CADWorkspaceMode) {
  return [
    { id: "design", label: "Design", kind: "radio" as const, checked: mode === "modeling" },
    { id: "assembly", label: "Assembly", kind: "radio" as const, checked: mode === "assembly" },
    { id: "drawing", label: "Drawing", kind: "radio" as const, checked: mode === "drawing" },
    { id: "generative", label: "Generative Design", disabled: true, separatorBefore: true, disabledReason: "Planned — generative studies are not implemented yet." },
    { id: "render", label: "Render", disabled: true, disabledReason: "Planned — the render workspace is not implemented yet." },
    { id: "animation", label: "Animation", disabled: true, disabledReason: "Opens in Aether Animation until suite routing is connected." },
    { id: "simulation", label: "Simulation", disabled: true, disabledReason: "Planned — simulation arrives with Aether Dynamics." },
    { id: "manufacture", label: "Manufacture", disabled: true, disabledReason: "Planned — CAM is not implemented yet." },
    { id: "electronics", label: "Electronics", disabled: true, disabledReason: "Planned — electronics is not implemented yet." },
  ];
}

/** The workspace a switcher choice opens. Switching is a mode change, not a
 *  file prompt: Assembly shows the assembly ribbon over the same viewport. */
const WORKSPACE_ACTIONS: Record<string, CADToolActionID> = {
  design: "show-design-workspace",
  assembly: "show-assembly-workspace",
  drawing: "open-drawing",
};


export interface CADTraditionalRibbonProps {
  suite?: boolean;
  /** Open document type; layouts refine the shared catalog per type. */
  documentType?: CADDocumentType;
  /** True while a sketch is being edited — shows the contextual Sketch tab. */
  sketchEditing?: boolean;
  /** Kept for callers; the document strip moved out of the ribbon. */
  documentName?: string;
  activeWorkspace: CADRibbonWorkspaceID;
  partOpen: boolean;
  onSelectWorkspace: (workspace: CADRibbonWorkspaceID) => void;
  onAction: (action: CADToolActionID) => void;
}

export function CADTraditionalRibbon({
  suite = false,
  documentType = "project",
  sketchEditing = false,
  activeWorkspace,
  partOpen,
  onSelectWorkspace,
  onAction,
}: CADTraditionalRibbonProps) {
  const commands = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  const workspaceMode = useSyncExternalStore(
    cadPresentation.subscribe,
    cadPresentation.snapshot,
    cadPresentation.snapshot,
  ).workspaceMode;
  const assembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  const [variants,setVariants]=useState<Record<string,string>>({});
  // The tool bar's own three densities, the same menu the kit sidebar shows.
  // CAD stored two before the consolidation; "standard" meant icons, labels and
  // the workspace, which is what the widget calls "expanded".
  const [density, setDensity] = useState<WorkspaceRibbonDensity>(() => {
    try {
      const stored = localStorage.getItem("aether-cad.ribbon-density");
      if (stored === "compact" || stored === "standard" || stored === "expanded") {
        return stored === "standard" ? "expanded" : stored;
      }
    } catch { /* session-only */ }
    return "compact";
  });
  const chooseDensity = (next: WorkspaceRibbonDensity) => {
    setDensity(next);
    try { localStorage.setItem("aether-cad.ribbon-density", next); } catch { /* session-only */ }
  };
  const workspace = toolbarWorkspaceFor(documentType, activeWorkspace);
  const fusionTabs = fusionTabsFor(documentType);
  const defaultFusionTab = fusionTabs?.find(tab => tab.id === activeWorkspace)?.id ?? fusionTabs?.[0]?.id ?? "solid";
  const [fusionTab, setFusionTab] = useState<string>(() => (sketchEditing ? "sketch-context" : defaultFusionTab));
  useEffect(() => {
    if (sketchEditing) setFusionTab("sketch-context");
    else setFusionTab((current) => (current === "sketch-context" ? defaultFusionTab : current));
  }, [sketchEditing, defaultFusionTab]);

  const toolContext = { commands, partOpen, assemblyReady: assembly.loadState === 'ready' };
  const availability = (definition: CADToolDefinition) => cadToolAvailability(definition, toolContext);

  // An open assembly *is* the Assembly workspace, however you got there:
  // opening one resets workspaceMode to "modeling", so the mode alone would
  // leave the switcher reading Design over an assembly ribbon.
  const activeMode: CADWorkspaceMode = workspaceMode === "drawing"
    ? "drawing"
    : documentType === "assembly" ? "assembly" : workspaceMode;
  // The shared ribbon draws it; this app declares what the tools are, whether
  // each is available, and what it does. Anything the widget could not express
  // was added to the widget (per-tool variants), not forked here.
  const toolArtwork = (tool: CADToolDefinition) => {
    const kind = tool.action === "show-inspect" ? "measure" : tool.action === "part-section" ? "section" : tool.action === "part-interference" ? "interference" : null;
    return kind ? <InspectionIcon kind={kind}/> : <ToolIcon name={tool.icon}/>;
  };
  const toCommand = (id: string): WorkspaceRibbonCommand | null => {
    const definition = toolbarToolById(id);
    if (!definition) return null;
    const choices = [definition, ...(definition.variants ?? [])];
    // A tool and its variants share one button: the caret picks which, and the
    // button stays on the last one picked.
    const selected = choices.find((choice) => choice.id === variants[definition.id]) ?? definition;
    const state = availability(selected);
    return {
      // The button keeps the family's id, so it has one identity whichever
      // variant it is showing, and `data-tool-id` stays stable.
      id: definition.id,
      selectedVariantID: selected.id,
      label: selected.label,
      help: toolHelpFor(selected.action),
      icon: selected.id === "home-select-auto" ? <SelectionIcon/> : toolArtwork(selected),
      active: Boolean(selected.action && isCADCommandID(selected.action) && commands[selected.action].active),
      disabled: state.disabled,
      disabledReason: state.disabled ? state.reason : undefined,
      variants: definition.variants
        ? choices.map((choice) => {
            const choiceState = availability(choice);
            return {
              id: choice.id, label: choice.label, help: toolHelpFor(choice.action), icon: toolArtwork(choice),
              disabled: choiceState.disabled, disabledReason: choiceState.disabled ? choiceState.reason : undefined,
            };
          })
        : undefined,
    };
  };
  const flatMenuItemsFor = (ids: readonly string[]): MenuItem[] => toolbarMenuToolsFor(ids)
    .map((definition) => {
      const state = availability(definition);
      const isFilter = definition.action?.startsWith("selection-") && definition.action !== "selection-next-filter" && definition.action !== "selection-clear";
      return { id: definition.id, help: toolHelpFor(definition.action), label: definition.id === "home-select-auto" ? "Auto" : definition.label,
        ...(isFilter ? { kind: "radio" as const, checked: Boolean(definition.action && isCADCommandID(definition.action) && commands[definition.action].active) } : {}), icon: toolArtwork(definition), disabled: state.disabled, disabledReason: state.reason };
    });

  const menuItemsFor = (ids: readonly string[]): MenuItem[] => selectionMenu(flatMenuItemsFor(ids));

  // Preserve the navigation category without advertising an unimplemented
  // operation as a tool. Its menu explains why no commands are shown yet.
  const sectionMenu = (tabLabel: string, sectionLabel: string, ids: readonly string[]): MenuItem[] => {
    const items = menuItemsFor(ids);
    return items.length ? items : [{
      id: 'unavailable-category', label: 'No tools available yet', disabled: true,
      disabledReason: `${tabLabel} ${sectionLabel.toLowerCase()} tools are not available yet.`,
    }];
  };

  /** The button runs whichever variant the family currently means. */
  const runTool = (id: string) => {
    if (id === 'feature-library-open') { setDensity('standard'); setFusionTab('feature-library'); return; }
    if (id.startsWith('feature:')) {
      const tool = cadFeatureToolById(id.slice('feature:'.length));
      if (tool?.action && !availability(tool).disabled) onAction(tool.action);
      return;
    }
    const definition = toolbarToolById(id) ?? cadFeatureToolById(id);
    if (!definition) return;
    const chosen = definition.variants?.length
      ? definition.variants.find((choice) => choice.id === variants[definition.id]) ?? definition
      : definition;
    if (chosen.action && !availability(chosen).disabled) onAction(chosen.action);
  };

  /** The caret makes a variant the family's choice, then runs it. */
  const chooseVariant = (familyID: string, variantID: string) => {
    const choice = toolbarToolById(variantID);
    if (!choice) return;
    setVariants((current) => ({ ...current, [familyID]: variantID }));
    if (choice.action && !availability(choice).disabled) onAction(choice.action);
  };

  // The switcher's ids are the workspaces a person picks; `activeMode` is the
  // presentation store's own word for the same thing ("modeling" is Design).
  const WORKSPACE_IDS: Record<CADWorkspaceMode, string> = { modeling: "design", assembly: "assembly", drawing: "drawing" };
  const selectWorkspaceMode = (id: string) => { const action = WORKSPACE_ACTIONS[id]; if (action) onAction(action); };

  // Compact mode is a single context-aware strip, independent of the last tab.
  // The compact tray retains category navigation and each category's commands.
  const compactGroupsFor = (tabs: WorkspaceRibbonTab[], activeID: string): readonly WorkspaceRibbonGroup[] => {
    const active = tabs.find(tab => tab.id === activeID) ?? tabs[0];
    const featureTab = tabs.find(tab => tab.id === 'feature-library');
    if (!active) return [];
    if (!featureTab || active.id === featureTab.id) return active.groups;
    return [...active.groups, {
      id: 'all-features', label: 'Features',
      tools: [{id:'feature-library-open',label:'Features',icon:<ToolIcon name="list"/>}],
      menuItems: featureTab.groups.map(group=>({id:group.id,label:group.label,children:group.menuItems})),
    }];
  };

  if (fusionTabs) {
    const tabs: CADToolbarTab[] = sketchEditing ? [...fusionTabs, sketchContextTab()] : [...fusionTabs];
    const ribbonTabs: WorkspaceRibbonTab[] = tabs.map((tab) => ({
      id: tab.id, label: tab.label,
      groups: tab.sections.map((section) => ({
        id: section.id, label: section.label,
        tools: section.visible.map(toCommand).filter((tool): tool is WorkspaceRibbonCommand => tool !== null),
        menuItems: sectionMenu(tab.label, section.label, section.menu),
      })),
    }));
    ribbonTabs.push(cadFeatureTray(toolContext));
    const active = ribbonTabs.find(tab => tab.id === fusionTab) ?? ribbonTabs[0];
    return (
      <section className={`cad-traditional-ribbon cad-fusion-ribbon density-${density}${suite ? " cad-suite-ribbon" : ""}`}
        aria-label="Part tools" data-ribbon-workspace={active.id}>
        <WorkspaceRibbon compactTools
          workspaces={[]} workspaceID={WORKSPACE_IDS[activeMode]} onWorkspaceSelect={selectWorkspaceMode}
          tabs={ribbonTabs} compactGroups={compactGroupsFor(ribbonTabs, active.id)} activeTabID={active.id} onTabSelect={setFusionTab}
          onCommand={runTool} onVariantSelect={chooseVariant} workspaceLayout="column" appearance="glass"
          density={density} onDensityChange={chooseDensity}
          moreLabel="Tool bar options" />
      </section>
    );
  }

  const ribbonTabs: WorkspaceRibbonTab[] = toolbarTabsFor(documentType).map((tab) => {
    const definition = toolbarWorkspaceFor(documentType, tab.id as CADRibbonWorkspaceID);
    return {
      id: tab.id, label: tab.label,
      groups: definition.groups.map((group) => ({
        id: group.id, label: group.label,
        tools: group.tools.slice(0, group.visibleToolCount ?? (group.singleTool ? 1 : group.tools.length)).map((tool) => toCommand(tool.id)).filter((tool): tool is WorkspaceRibbonCommand => tool !== null),
        menuItems: (group.singleTool || group.visibleToolCount !== undefined || !group.tools.length)
          ? sectionMenu(tab.label, group.label, group.tools.map((tool) => tool.id)) : undefined,
      })),
    };
  });
  return (
    <section className={`cad-traditional-ribbon density-${density}${suite ? " cad-suite-ribbon" : ""}`}
      aria-label="Traditional CAD tools" data-ribbon-workspace={workspace.id}>
      <WorkspaceRibbon compactTools
        workspaces={[]} workspaceID={WORKSPACE_IDS[activeMode]} onWorkspaceSelect={selectWorkspaceMode}
        tabs={ribbonTabs} compactGroups={compactGroupsFor(ribbonTabs, workspace.id)} activeTabID={workspace.id} onTabSelect={(id) => onSelectWorkspace(id as CADRibbonWorkspaceID)}
        onCommand={runTool} onVariantSelect={chooseVariant} workspaceLayout="column" appearance="glass"
        density={density} onDensityChange={chooseDensity}
        moreLabel="Tool bar options" />
    </section>
  );
}

/**
 * The workspace switcher (Design, Assembly, Drawing…), shown in the document
 * header rather than the ribbon, since not every workspace has a ribbon.
 */
export function CADWorkspaceSwitcher({ documentType = "project", onAction }: { documentType?: string; onAction: (action: CADToolActionID) => void }) {
  const workspaceMode = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot).workspaceMode;
  const activeMode: CADWorkspaceMode = workspaceMode === "drawing" ? "drawing" : documentType === "assembly" ? "assembly" : workspaceMode;
  const ids: Record<CADWorkspaceMode, string> = { modeling: "design", assembly: "assembly", drawing: "drawing" };
  return <WorkspaceSwitcher workspaces={workspaceModes(activeMode).map((item) => ({ id: item.id, label: item.label, disabled: item.disabled, disabledReason: item.disabledReason }))}
    workspaceID={ids[activeMode]} onSelect={(id) => { const action = WORKSPACE_ACTIONS[id]; if (action) onAction(action); }} menuClassName="aui-tool-menu" />;
}
