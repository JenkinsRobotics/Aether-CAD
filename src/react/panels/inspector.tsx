import { CADDocumentSettings } from "../CADDocumentSettings";
import { cadWorkspace } from "../../cad-workspace-store";
/** Inspector — the right-hand sidebar. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPanelPlacement } from "../../cad-presentation-store";
import { Button, InspectorActions, InspectorSection } from "@aether/ui";
import { useState, useSyncExternalStore } from "react";
import { findTreeNode, ReadOnlyPropertyGrid, ReadOnlyPropertySections } from "./shared";

export function InspectorPanel(_props: { placement: CADPanelPlacement }) {
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
    <InspectorSection defaultOpen title={canonicalAssembly ? "Assembly selection" : "Selection"}>
        {canonicalAssembly ? <ReadOnlyPropertySections
          sections={assembly.data!.inspectorSections}
          ariaLabel="Assembly inspector"
          emptyState="Select an Assembly entity to inspect Core-projected values."
        /> : <ReadOnlyPropertyGrid
            ariaLabel="Part inspector"
            emptyState="Create or open a Part to inspect document, feature, and exact-topology values."
          />}
    </InspectorSection>
    <InspectorSection defaultOpen title="Editing and units">
      <InspectorActions>
      <Button disabled={!editable} onClick={()=>{if(selected)cadWorkspace.dispatch({type:'item-action',id:selected.id,actionID:'edit-feature'});}}>Edit selected feature</Button>
      <Button disabled={!saved} onClick={()=>setUnitsOpen(true)}>Units and precision…</Button>
      </InspectorActions>
    </InspectorSection>
    {unitsOpen && <CADDocumentSettings action="units" onClose={()=>setUnitsOpen(false)}/>}
    </>
  );
}
