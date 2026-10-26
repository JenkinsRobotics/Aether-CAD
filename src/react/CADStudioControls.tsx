import { useState, useSyncExternalStore } from "react";
import { AetherIcon, FloatingToolbar, IconButton, Menu, Popover } from "@aether/ui";
import { sectionView } from "../section/section-view-store";
import { openSectionView, sectionEditorOpen, subscribeSectionEditor, turnOffSectionView } from "../section/SectionViewWindow";
import { cadCommands } from "../cad-command-registry";
import { measureWindowOpen, subscribeMeasureWindow } from "../measure/MeasureWindow";
import { cadWorkspace } from "../cad-workspace-store";
import { CADWorkspaceSwitcher } from "./CADTraditionalRibbon";
import { SelectionFilterHud } from "./chrome/viewport";
import { findTreeNode } from "./panels/shared";
import type { CADToolActionID } from "../cad-tool-catalog";

export function CADStudioWorkspaceControls({ documentType, onAction }: { documentType: string; onAction: (id: CADToolActionID) => void }) {
  const workspace = useSyncExternalStore(cadWorkspace.subscribe, cadWorkspace.snapshot, cadWorkspace.snapshot);
  const plane = findTreeNode(workspace.itemNodes, "reference/top-plane");
  return <div className="cad-studio-workspace-controls">
    <CADWorkspaceSwitcher documentType={documentType} onAction={onAction}/>
    <span className="cad-studio-control-divider"/>
    <IconButton size="small" appearance="glyph" label="Top construction plane" aria-pressed={!!plane && !plane.dimmed} onClick={() => cadWorkspace.dispatch({type:"item-action",id:"reference/top-plane",actionID:"toggle-visibility"})}><AetherIcon name="planes-axes"/></IconButton>
  </div>;
}

export function CADStudioViewTools({partTray}:{partTray?:{shown:boolean;onToggle:()=>void}}={}) {
  const commands = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  const [anchor, setAnchor] = useState<HTMLElement|null>(null);
  const measuring = useSyncExternalStore(subscribeMeasureWindow, measureWindowOpen, measureWindowOpen);
  const sectioned = useSyncExternalStore(sectionView.subscribe, () => sectionView.snapshot() !== null, () => false);
  const editingSection = useSyncExternalStore(subscribeSectionEditor, sectionEditorOpen, sectionEditorOpen);
  const [sectionMenu, setSectionMenu] = useState<{x:number;y:number}|null>(null);
  return <div className="cad-studio-view-tools">
    <FloatingToolbar variant="document" ariaLabel="View tools" groups={[{id:"view",label:"View",actions:[
      {id:"fit",label:"Fit view",icon:<AetherIcon name="fit"/>,disabled:!commands["fit-view"].enabled},
      {id:"selection",label:"Selection tools",icon:<AetherIcon name="cursor"/>,pressed:!!anchor},
      {id:"measure",label:"Measure",icon:<AetherIcon name="ruler"/>,pressed:measuring,disabled:!commands.measure.enabled},
      {id:"section",label:"Section view",icon:<AetherIcon name="section-view"/>,pressed:sectioned||editingSection,disabled:!commands["section-view"].enabled},
      ...(partTray?[{id:"part-tray",label:"Part tray",icon:<AetherIcon name="part-manager"/>,pressed:partTray.shown}]:[]),
    ]}]} onAction={id => {
      if(id==="part-tray"){partTray?.onToggle();return;}
      if(id==="fit")cadCommands.execute("fit-view");
      else if(id==="measure")cadCommands.execute("measure");
      else if(id==="section"){
        // An active section offers Onshape's two actions; otherwise start one.
        const button=document.querySelector<HTMLElement>('.cad-studio-view-tools button[aria-label="Section view"]');
        if(sectioned&&!editingSection&&button){const r=button.getBoundingClientRect();setSectionMenu({x:r.left,y:r.top-4});}
        else cadCommands.execute("section-view");
      }
      else setAnchor(anchor?null:document.querySelector<HTMLElement>('.cad-studio-view-tools button[aria-label="Selection tools"]'));
    }}/>
    <Menu open={!!sectionMenu} anchor={sectionMenu} placement="top-start" applicationCommands={false} ariaLabel="Section view actions"
      items={[{id:"edit",label:"Edit section view…"},{id:"off",label:"Turn off section view"}]}
      onSelect={action=>{setSectionMenu(null);if(action==="edit")openSectionView();else turnOffSectionView();}} onClose={()=>setSectionMenu(null)}/>
    <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} placement="top-end" ariaLabel="Selection tools"><SelectionFilterHud/></Popover>
  </div>;
}
