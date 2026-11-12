import { useState, useSyncExternalStore } from "react";
import { AetherIcon, Menu, Popover, type FloatingToolbarAction } from "@aether/ui";
import { sectionView } from "../section/section-view-store";
import { openSectionView, sectionEditorOpen, subscribeSectionEditor, turnOffSectionView } from "../section/SectionViewWindow";
import { cadCommands } from "../cad-command-registry";
import { measureWindowOpen, subscribeMeasureWindow } from "../measure/MeasureWindow";
import { SelectionFilterHud } from "./chrome/viewport";

const trayButton = (label: string) => document.querySelector<HTMLElement>(`[aria-label="Center icon tray"] button[aria-label="${label}"]`);

/** The center icon tray's tools (selection, Measure, Section view) and the pop-ups they open. */
export function useCADCenterTools() {
  const commands = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  const [anchor, setAnchor] = useState<HTMLElement|null>(null);
  const measuring = useSyncExternalStore(subscribeMeasureWindow, measureWindowOpen, measureWindowOpen);
  const sectioned = useSyncExternalStore(sectionView.subscribe, () => sectionView.snapshot() !== null, () => false);
  const editingSection = useSyncExternalStore(subscribeSectionEditor, sectionEditorOpen, sectionEditorOpen);
  const [sectionMenu, setSectionMenu] = useState<{x:number;y:number}|null>(null);
  const tools: FloatingToolbarAction[] = [
    {id:"selection",label:"Selection tools",icon:<AetherIcon name="cursor"/>,pressed:!!anchor},
    {id:"measure",label:"Measure",icon:<AetherIcon name="tape-measure"/>,pressed:measuring,disabled:!commands.measure.enabled},
    {id:"section",label:"Section view",icon:<AetherIcon name="section-view"/>,pressed:sectioned||editingSection,disabled:!commands["section-view"].enabled},
  ];
  /** Runs a tool; false for ids that are not tools. */
  const run = (id: string) => {
    if(id==="measure")cadCommands.execute("measure");
    else if(id==="section"){
      // An active section offers Onshape's two actions; otherwise start one.
      const button=trayButton("Section view");
      if(sectioned&&!editingSection&&button){const r=button.getBoundingClientRect();setSectionMenu({x:r.left,y:r.top-4});}
      else cadCommands.execute("section-view");
    }
    else if(id==="selection")setAnchor(anchor?null:trayButton("Selection tools"));
    else return false;
    return true;
  };
  const overlays = <>
    <Menu open={!!sectionMenu} anchor={sectionMenu} placement="top-start" applicationCommands={false} ariaLabel="Section view actions"
      items={[{id:"edit",label:"Edit section view…"},{id:"off",label:"Turn off section view"}]}
      onSelect={action=>{setSectionMenu(null);if(action==="edit")openSectionView();else turnOffSectionView();}} onClose={()=>setSectionMenu(null)}/>
    <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} placement="top-end" ariaLabel="Selection tools"><SelectionFilterHud/></Popover>
  </>;
  return { tools, run, overlays };
}
