import {cadPresentation, requestCADPropertyPanel} from "../cad-presentation-store";
import { InspectorSection } from "@aether/ui";
import "./CADInspector.css";
import { useSyncExternalStore } from "react";
import { Button, Checkbox, FieldRow, IconButton, SelectField, AetherIcon } from "@aether/ui";
import { cadAppearance } from "../cad-appearance-store";
import type { CADDisplayStyle } from "../cad-appearance-store";
import { cadCameraPresentation } from "../cad-camera-presentation-store";
import { cadCommands } from "../cad-command-registry";

/** Camera + display tool, imported from the Anima Studio right rail's "View"
 *  panel. Camera and reference-display controls live here — deliberately
 *  separate from the render environment (Appearance) panel. */
export function CADViewPanel({ active }: { active: boolean }) {
  const presentation=useSyncExternalStore(cadPresentation.subscribe,cadPresentation.snapshot,cadPresentation.snapshot);
  const camera = useSyncExternalStore(
    cadCameraPresentation.subscribe,
    cadCameraPresentation.snapshot,
    cadCameraPresentation.snapshot,
  );
  const appearance = useSyncExternalStore(
    cadAppearance.subscribe,
    cadAppearance.snapshot,
    cadAppearance.snapshot,
  );
  const commands = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  return (
    <section className="cad-property-sheet" hidden={!active} data-panel="view">
      <div className="visualization-panel-scroll">
        <InspectorSection defaultOpen title="Camera">
          <div className="visualization-fields">
            <FieldRow label="Projection">
              <SelectField
                aria-label="Camera projection"
                value={camera.projection}
                options={[
                  { value: "perspective", label: "Perspective" },
                  { value: "orthographic", label: "Orthographic" },
                ]}
                onChange={event=>cadCameraPresentation.dispatch({type:"set-projection",projection:event.target.value as "perspective" | "orthographic"})}
              />
            </FieldRow>
            <FieldRow label="Field of view">
              <SelectField
                aria-label="Camera field of view"
                disabled={camera.projection === "orthographic"}
                value={String(camera.fieldOfViewDegrees)}
                options={[30, 42, 45, 60, 75, 90].map((degrees) => ({
                  value: String(degrees),
                  label: `${degrees}°`,
                }))}
                onChange={(event) =>
                  cadCameraPresentation.dispatch({
                    type: "set-field-of-view",
                    degrees: Number(event.target.value),
                  })
                }
              />
            </FieldRow>
            <FieldRow label="Views">
              <div className="cad-view-actions">
                <IconButton
                  label="Fit model"
                  disabled={!commands["fit-view"].enabled || !commands["fit-view"].registered}
                  title="Zoom to fit (F)"
                  onClick={() => cadCommands.execute("fit-view")}
                >
                  <AetherIcon name="search" />
                </IconButton>
                <IconButton
                  label="Isometric view"
                  title="Isometric (Space opens the orientation box)"
                  onClick={() => cadCommands.execute("view-isometric")}
                >
                  <AetherIcon name="cube" />
                </IconButton>
                <Button disabled title="Named views require saved camera bookmarks.">
                  Named views
                </Button>
              </div>
            </FieldRow>
            <p className="cad-form-note">
              Space opens the orientation envelope; click a face, edge, or corner to look from
              that side.
            </p>
          </div>
        </InspectorSection>
        <InspectorSection defaultOpen title="Display">
          <div className="visualization-fields">
            <FieldRow label="Surface">
              <SelectField
                aria-label="Surface display style"
                value={appearance.displayStyle}
                options={[
                  { value: "shaded-edges", label: "Shaded with edges" },
                  { value: "shaded", label: "Shaded" },
                  { value: "wireframe", label: "Wireframe" },
                  { value: "hidden-line", label: "Hidden line" },
                  { value: "ghost", label: "Translucent" },
                ]}
                onChange={(event) =>
                  cadAppearance.dispatch({
                    type: "set-display-style",
                    style: event.target.value as CADDisplayStyle,
                  })
                }
              />
            </FieldRow>
            <Checkbox
              checked={appearance.edgesVisible}
              onChange={(event) =>
                cadAppearance.dispatch({ type: "set-edges-visible", visible: event.target.checked })
              }
              label="Edges"
              description="Show OCCT-derived edge segments on every Body."
            />
            <Checkbox
              checked={commands["toggle-origin"].active}
              onChange={() => cadCommands.execute("toggle-origin")}
              label="Origin"
              description="Show the origin point in space."
            />
            <Checkbox
              disabled
              label="Axes"
              description="Axis display is not implemented yet; the origin stays a point."
            />
            <Button disabled={!presentation.partOpen || !commands["part-section"].enabled} onClick={()=>cadCommands.execute("part-section")}>
              Open section analysis
            </Button>
            <Button onClick={()=>requestCADPropertyPanel('rendering')}>Rendering quality and environment</Button>
          </div>
        </InspectorSection>
      </div>
    </section>
  );
}
