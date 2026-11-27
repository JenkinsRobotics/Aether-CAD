/** Live viewport surface analysis shaders — Zebra, Draft angle, Curvature map,
 *  Tool accessibility, and Environment reflection map. Lives under Inspect › Surface. */
import { useState, useSyncExternalStore } from "react";
import { Button, FieldRow, InspectorActions, InspectorSection, NumberField, SegmentedControl, SelectField, Slider } from "@aether/ui";
import { cadAppearance, type CADDisplayStyle } from "../../core/stores/cad-appearance-store";
import "../CADInspector.css";

const AXIS_VECTORS: Record<string, [number, number, number]> = {
  "+Z": [0, 0, 1],
  "-Z": [0, 0, -1],
  "+X": [1, 0, 0],
  "-X": [-1, 0, 0],
  "+Y": [0, 1, 0],
  "-Y": [0, -1, 0],
};

const ANALYSIS_STYLES = new Set<CADDisplayStyle>([
  "zebra",
  "draft-analysis",
  "curvature-map",
  "accessibility",
  "environment-map",
]);

const OVERLAY_OPTIONS: { value: CADDisplayStyle; label: string }[] = [
  { value: "shaded-edges", label: "Off (Shaded with edges)" },
  { value: "zebra", label: "Zebra stripes (continuity)" },
  { value: "draft-analysis", label: "Draft angle analysis" },
  { value: "curvature-map", label: "Curvature map" },
  { value: "accessibility", label: "Tool accessibility" },
  { value: "environment-map", label: "Environment reflection map" },
];

export function SurfaceAnalysisPanel() {
  const appearance = useSyncExternalStore(cadAppearance.subscribe, cadAppearance.snapshot, cadAppearance.snapshot);
  const [pullAxis, setPullAxis] = useState<string>("+Z");

  const isOverlayActive = ANALYSIS_STYLES.has(appearance.displayStyle);
  const selectValue: CADDisplayStyle = isOverlayActive ? appearance.displayStyle : "shaded-edges";
  const stripes = appearance.analysisParams?.zebraStripes ?? 12;
  const draftDeg = appearance.analysisParams?.draftAngleDegrees ?? 2;

  const applyAxis = (axis: string) => {
    setPullAxis(axis);
    const dir = AXIS_VECTORS[axis] ?? [0, 0, 1];
    cadAppearance.dispatch({
      type: "set-analysis-params",
      params: appearance.displayStyle === "draft-analysis" ? { draftDirection: dir } : { accessibilityDirection: dir },
    });
  };

  return (
    <section className="cad-property-sheet" data-panel="surface-analysis" aria-label="Surface analysis shaders">
      <InspectorSection defaultOpen title="Diagnostic overlay">
        <FieldRow label="Mode" htmlFor="inspect-surface-mode">
          <SelectField
            id="inspect-surface-mode"
            aria-label="Surface analysis overlay mode"
            value={selectValue}
            options={OVERLAY_OPTIONS}
            onChange={(e) => cadAppearance.dispatch({ type: "set-display-style", style: e.target.value as CADDisplayStyle })}
          />
        </FieldRow>

        {appearance.displayStyle === "zebra" && (
          <>
            <FieldRow label="Stripes" htmlFor="inspect-zebra-stripes">
              <Slider
                ariaLabel="Zebra stripe count"
                min={4}
                max={40}
                step={2}
                value={stripes}
                onChange={(value) => cadAppearance.dispatch({ type: "set-analysis-params", params: { zebraStripes: value } })}
              />
            </FieldRow>
            <div className="cad-shader-legend">
              Smooth stripe flow = G2 curvature · kinked = G1 tangent · broken = G0 position.
            </div>
          </>
        )}

        {(appearance.displayStyle === "draft-analysis" || appearance.displayStyle === "accessibility") && (
          <>
            <FieldRow label="Pull / tool axis" layout="stacked">
              <SegmentedControl
                ariaLabel="Pull or tool axis"
                value={pullAxis}
                options={Object.keys(AXIS_VECTORS).map((axis) => ({ id: axis, label: axis }))}
                onChange={applyAxis}
              />
            </FieldRow>
            {appearance.displayStyle === "draft-analysis" && (
              <>
                <FieldRow label="Min draft" htmlFor="inspect-draft-angle">
                  <NumberField
                    id="inspect-draft-angle"
                    value={draftDeg}
                    min={0.5}
                    max={30}
                    step={0.5}
                    precision={1}
                    unit="°"
                    scrubLabel="Minimum draft angle"
                    onValueChange={(value) => cadAppearance.dispatch({ type: "set-analysis-params", params: { draftAngleDegrees: value ?? 2 } })}
                  />
                </FieldRow>
                <div className="cad-shader-legend" aria-label="Draft angle legend">
                  <span className="cad-shader-chip"><span className="cad-shader-swatch" style={{ background: "#2ea043" }} />Positive draft</span>
                  <span className="cad-shader-chip"><span className="cad-shader-swatch" style={{ background: "#e59c24" }} />Below min</span>
                  <span className="cad-shader-chip"><span className="cad-shader-swatch" style={{ background: "#e04f5f" }} />Undercut</span>
                </div>
              </>
            )}
            {appearance.displayStyle === "accessibility" && (
              <div className="cad-shader-legend" aria-label="Accessibility legend">
                <span className="cad-shader-chip"><span className="cad-shader-swatch" style={{ background: "#2ea043" }} />Accessible along {pullAxis}</span>
                <span className="cad-shader-chip"><span className="cad-shader-swatch" style={{ background: "#e04f5f" }} />Obstructed / overhang</span>
              </div>
            )}
          </>
        )}

        {appearance.displayStyle === "curvature-map" && (
          <div className="cad-shader-legend" aria-label="Curvature legend">
            <span className="cad-shader-chip"><span className="cad-shader-swatch" style={{ background: "#387acb" }} />Concave</span>
            <span className="cad-shader-chip"><span className="cad-shader-swatch" style={{ background: "#2ea043" }} />Planar</span>
            <span className="cad-shader-chip"><span className="cad-shader-swatch" style={{ background: "#e04f5f" }} />High convex</span>
          </div>
        )}

        {appearance.displayStyle === "environment-map" && (
          <div className="cad-shader-legend">
            Chrome-like studio reflection highlights subtle ripples and inflection lines on Class-A surfaces.
          </div>
        )}

        {isOverlayActive && (
          <InspectorActions>
            <Button onClick={() => cadAppearance.dispatch({ type: "set-display-style", style: "shaded-edges" })}>
              Turn off overlay
            </Button>
          </InspectorActions>
        )}
      </InspectorSection>
    </section>
  );
}
