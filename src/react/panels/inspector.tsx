import { CADDocumentSettings } from "../CADDocumentSettings";
import { cadWorkspace } from "../../cad-workspace-store";
/** Inspector — the right-hand sidebar. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPanelPlacement } from "../../cad-presentation-store";
import { Button, InspectorSection } from "@aether/ui";
import { useState, useSyncExternalStore } from "react";
import { findTreeNode, CADPanelPlacementMenu, ReadOnlyPropertyGrid, ReadOnlyPropertySections } from "./shared";

export function InspectorPanel({ placement }: { placement: CADPanelPlacement }) {
  const [unitsOpen,setUnitsOpen]=useState(false);
  const workspace=useSyncExternalStore(cadWorkspace.subscribe,cadWorkspace.snapshot,cadWorkspace.snapshot);
  const selected=workspace.selectedItemIDs.size===1?findTreeNode(workspace.itemNodes,[...workspace.selectedItemIDs][0]):undefined;
  const editable=selected?.actions?.some(action=>action.id==='edit-feature');
  const saved=typeof location !== 'undefined' && new URLSearchParams(location.search).has('document');
  const assembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  const canonicalAssembly = assembly.loadState === "ready" && assembly.data !== null;
  return (
    <>
    <InspectorSection title={canonicalAssembly ? "Assembly properties" : "Properties"} actions={<CADPanelPlacementMenu panel="inspector" label="Properties" placement={placement} />}>
        {canonicalAssembly ? <ReadOnlyPropertySections
          sections={assembly.data!.inspectorSections}
          ariaLabel="Assembly inspector"
          emptyState="Select an Assembly entity to inspect Core-projected values."
        /> : <ReadOnlyPropertyGrid
            ariaLabel="Part inspector"
            emptyState="Create or open a Part to inspect document, feature, and exact-topology values."
          />}
    </InspectorSection>
    <InspectorSection title="Editing and units">
      <Button disabled={!editable} onClick={()=>{if(selected)cadWorkspace.dispatch({type:'item-action',id:selected.id,actionID:'edit-feature'});}}>Edit selected feature</Button>
      <Button disabled={!saved} onClick={()=>setUnitsOpen(true)}>Units and precision…</Button>
      <p>Properties are read-only. Select a feature to edit its dimensions; center spacing is controlled by its sketch constraints or assembly mate.</p>
    </InspectorSection>
    {unitsOpen && <CADDocumentSettings action="units" onClose={()=>setUnitsOpen(false)}/>}
    </>
  );
}
