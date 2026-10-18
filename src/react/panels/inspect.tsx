import {SelectedTopologyMeasurement} from "./selected-topology-measurement";
import {useSyncExternalStore} from "react";
import {cadPresentation} from "../../cad-presentation-store";
import { SelectedPointMeasurement } from "./selected-point-measurement";
import { InspectorSection } from "@aether/ui";
import "../CADInspector.css";
/** Inspect — read-only measurements of the current selection. */
import { CommandButton, ReadOnlyPropertyGrid } from "./shared";

export function InspectPanel({ active }: { active: boolean }) {
  const presentation=useSyncExternalStore(cadPresentation.subscribe,cadPresentation.snapshot,cadPresentation.snapshot);
  return (
    <section className="cad-property-sheet" hidden={!active} data-panel="inspect">
      <div className="inspect-panel-scroll">
        <SelectedPointMeasurement />
        <SelectedTopologyMeasurement />
        <InspectorSection title="Exact model summary">
          <ReadOnlyPropertyGrid
            ariaLabel="Exact model inspection"
            emptyState="Create or open a Part to inspect its document, features, sketch definition, and exact topology."
          />
          <CommandButton id="inspect-fit-view" command="fit-view">Fit current model</CommandButton>
        </InspectorSection>
        <InspectorSection title="Solid analysis">
          <CommandButton disabled={!presentation.partOpen} command="part-properties">Physical properties</CommandButton>
          <CommandButton disabled={!presentation.partOpen} command="part-section">Section view</CommandButton>
          <CommandButton disabled={!presentation.partOpen} command="part-interference">Check interference</CommandButton>
          <p className="cad-form-note">These tools use the existing part-analysis service. Measurement readouts do not modify geometry; edit a sketch dimension or assembly mate to change spacing.</p>
        </InspectorSection>
      </div>
    </section>
  );
}
