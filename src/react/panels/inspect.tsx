import {useSyncExternalStore} from "react";
import {cadPresentation} from "../../cad-presentation-store";
import { AetherIcon, InspectorSection } from "@aether/ui";
import "../CADInspector.css";
/** Inspect — the exact model summary and solid analysis. Measuring picked
 *  entities is the Measure tool (bottom-right toolbar). */
import { CommandButton, ReadOnlyPropertyGrid } from "./shared";

export function InspectPanel({ active }: { active: boolean }) {
  const presentation=useSyncExternalStore(cadPresentation.subscribe,cadPresentation.snapshot,cadPresentation.snapshot);
  return (
    <section className="cad-property-sheet" hidden={!active} data-panel="inspect">
      <div className="inspect-panel-scroll">
        <InspectorSection defaultOpen title="Exact model summary">
          <ReadOnlyPropertyGrid
            ariaLabel="Exact model inspection"
            emptyState="Create or open a Part to inspect its document, features, sketch definition, and exact topology."
          />
          <CommandButton primary={false} id="inspect-fit-view" command="fit-view">Fit current model</CommandButton>
        </InspectorSection>
        <InspectorSection defaultOpen title="Solid analysis">
          <div className="cad-sidebar-analysis-actions">
          <CommandButton primary={false} disabled={!presentation.partOpen} command="part-properties"><AetherIcon name="sliders"/><span>Physical properties</span></CommandButton>
          <CommandButton primary={false} disabled={!presentation.partOpen} command="part-section"><AetherIcon name="layers"/><span>Section view</span></CommandButton>
          <CommandButton primary={false} disabled={!presentation.partOpen} command="part-interference"><AetherIcon name="cube"/><span>Check interference</span></CommandButton>
          <CommandButton primary={false} disabled={!presentation.partOpen} command="part-clearance"><AetherIcon name="ruler"/><span>Clearance</span></CommandButton>
          <CommandButton primary={false} disabled={!presentation.partOpen} command="part-compare"><AetherIcon name="columns"/><span>Compare bodies</span></CommandButton>
          </div>
        </InspectorSection>
      </div>
    </section>
  );
}
