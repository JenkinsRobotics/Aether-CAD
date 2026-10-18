import { InspectorSection } from "@aether/ui";
import "../CADInspector.css";
/** Parameters — document variables and their expressions. */
import { cadPresentation } from "../../cad-presentation-store";
import { CADQuantityField } from "../CADQuantityField";
import { FieldRow, TextField } from "@aether/ui";
import { useSyncExternalStore } from "react";
import { CommandButton } from "./shared";

export function ParametersPanel({ active }: { active: boolean }) {
  const presentation = useSyncExternalStore(
    cadPresentation.subscribe,
    cadPresentation.snapshot,
    cadPresentation.snapshot,
  );
  return (
    <section className="cad-property-sheet" hidden={!active} data-panel="parameters">
      <InspectorSection title="Modeling">
        <FieldRow label="Part name" htmlFor="part-name">
          <TextField id="part-name" defaultValue="Part 1" />
        </FieldRow>
        <div className="parameter-grid">
          <FieldRow label="Width" htmlFor="part-width">
            <CADQuantityField family="length" canonicalFactor={0.001} id="part-width" defaultValue={60} min={0.001} step={1}  scrubLabel="Width" />
          </FieldRow>
          <FieldRow label="Height" htmlFor="part-height">
            <CADQuantityField family="length" canonicalFactor={0.001} id="part-height" defaultValue={40} min={0.001} step={1}  scrubLabel="Height" />
          </FieldRow>
          <FieldRow label="Extrude" htmlFor="part-depth">
            <CADQuantityField family="length" canonicalFactor={0.001} id="part-depth" defaultValue={20} min={0.001} step={1}  scrubLabel="Extrude" />
          </FieldRow>
        </div>
        <CommandButton id="rebuild-part" className="author-button" command="rebuild-part">{presentation.partOpen ? "Rebuild Part" : "Create Rectangle Part"}</CommandButton>
      </InspectorSection>
      <div className="feature-help"><b>Feature history</b><span>Sketch 1 defines the center rectangle. Extrude 1 rebuilds the exact OCCT solid.</span></div>
    </section>
  );
}
