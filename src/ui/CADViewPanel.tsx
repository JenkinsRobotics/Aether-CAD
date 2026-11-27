/** Camera & viewport display controls — lives under View › Camera. */
import { useSyncExternalStore } from "react";
import { AetherIcon, Button, Checkbox, FieldRow, InspectorActions, InspectorSection, SelectField } from "@aether/ui";
import { cadPresentation, requestCADPropertyPanel } from "../core/stores/cad-presentation-store";
import { cadAppearance, type CADDisplayStyle } from "../core/stores/cad-appearance-store";
import { cadCameraPresentation } from "../core/stores/cad-camera-presentation-store";
import { cadCommands } from "../core/cad-command-registry";
import "./CADInspector.css";

export function CADViewPanel({ active }: { active: boolean }) {
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
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
            <div className="cad-camera-strip" role="group" aria-label="Standard views">
              <Button
                disabled={!commands["fit-view"].enabled || !commands["fit-view"].registered}
                title="Zoom to fit (F)"
                onClick={() => cadCommands.execute("fit-view")}
              >
                Fit
              </Button>
              <Button title="Isometric view (0)" onClick={() => cadCommands.execute("view-isometric")}>Iso</Button>
              <Button title="Top view" onClick={() => cadCommands.execute("view-top")}>Top</Button>
              <Button title="Front view" onClick={() => cadCommands.execute("view-front")}>Front</Button>
              <Button title="Right view" onClick={() => cadCommands.execute("view-right")}>Right</Button>
            </div>
            <FieldRow label="Projection">
              <SelectField
                aria-label="Camera projection"
                value={camera.projection}
                options={[
                  { value: "perspective", label: "Perspective" },
                  { value: "orthographic", label: "Orthographic" },
                ]}
                onChange={(event) =>
                  cadCameraPresentation.dispatch({
                    type: "set-projection",
                    projection: event.target.value as "perspective" | "orthographic",
                  })
                }
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
            <p className="cad-form-note">
              Press Space to open the orientation cube; click any face, edge, or corner to snap.
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
                  { value: "zebra", label: "Zebra analysis" },
                  { value: "draft-analysis", label: "Draft analysis" },
                  { value: "curvature-map", label: "Curvature map" },
                  { value: "accessibility", label: "Accessibility" },
                  { value: "environment-map", label: "Environment map" },
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
              label="Model edges"
              description="Show exact OCCT edge curves on every body."
            />
            <Checkbox
              checked={commands["toggle-origin"].active}
              onChange={() => cadCommands.execute("toggle-origin")}
              label="Origin"
              description="Show the world origin point in space."
            />
            <Checkbox
              checked={appearance.contactShadowsVisible}
              onChange={(event) =>
                cadAppearance.dispatch({ type: "set-contact-shadows-visible", visible: event.target.checked })
              }
              label="Contact shadows"
              description="Soft ground shadows beneath solid bodies."
            />
            <InspectorActions>
              <Button
                disabled={!presentation.partOpen || !commands["part-section"].enabled}
                onClick={() => cadCommands.execute("part-section")}
              >
                <AetherIcon name="section-view" />
                <span>Section view</span>
              </Button>
              <Button onClick={() => requestCADPropertyPanel("surface-analysis")}>
                <AetherIcon name="surface-map" />
                <span>Surface shaders</span>
              </Button>
              <Button onClick={() => requestCADPropertyPanel("rendering")}>
                <AetherIcon name="lighting" />
                <span>Environment</span>
              </Button>
            </InspectorActions>
          </div>
        </InspectorSection>
      </div>
    </section>
  );
}
