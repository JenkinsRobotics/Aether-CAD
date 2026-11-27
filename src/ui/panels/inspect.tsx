/** Inspect — live model health monitor, exact solid analysis, and dynamic assembly checks.
 *  Surface analysis shaders live on Inspect › Surface; Physical Material lives under Properties › Material. */
import { useSyncExternalStore } from "react";
import { AetherIcon, Button, InspectorActions, InspectorSection } from "@aether/ui";
import { cadAssemblyWorkspace } from "../../core/stores/cad-assembly-workspace-store";
import { cadPresentation, requestCADPropertyPanel } from "../../core/stores/cad-presentation-store";
import { cadViewportMetrics } from "../../core/stores/cad-viewport-metrics-store";
import { CommandButton } from "./shared";
import "../CADInspector.css";

export function InspectPanel({ active }: { active: boolean }) {
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  const metrics = useSyncExternalStore(cadViewportMetrics.subscribe, cadViewportMetrics.snapshot, cadViewportMetrics.snapshot);
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const assemblyReady = assembly.loadState === "ready" && assembly.data !== null;

  return (
    <section className="cad-property-sheet" hidden={!active} data-panel="inspect">
      <div className="inspect-panel-scroll">
        <InspectorSection defaultOpen title="Model monitor">
          <div className="cad-metric-grid" aria-label="Exact model inspection">
            <div className="cad-metric-tile">
              <span>Bodies</span>
              <strong>{metrics.bodies}</strong>
            </div>
            <div className="cad-metric-tile">
              <span>Faces</span>
              <strong>{metrics.faces.toLocaleString()}</strong>
            </div>
            <div className="cad-metric-tile">
              <span>Edges</span>
              <strong>{metrics.edgeSegments.toLocaleString()}</strong>
            </div>
            <div className="cad-metric-tile">
              <span>Triangles</span>
              <strong>{metrics.triangles.toLocaleString()}</strong>
            </div>
          </div>
          <InspectorActions>
            <CommandButton primary={false} id="inspect-fit-view" command="fit-view">
              <AetherIcon name="fit" />
              <span>Fit model</span>
            </CommandButton>
            <CommandButton primary={false} command="measure">
              <AetherIcon name="tape-measure" />
              <span>Measure</span>
            </CommandButton>
          </InspectorActions>
        </InspectorSection>

        <InspectorSection defaultOpen title="Solid analysis">
          <div className="cad-sidebar-analysis-actions">
            <CommandButton primary={false} disabled={!presentation.partOpen} command="part-properties">
              <AetherIcon name="gauge" />
              <span>Physical properties</span>
            </CommandButton>
            <CommandButton primary={false} disabled={!presentation.partOpen} command="part-section">
              <AetherIcon name="section-view" />
              <span>Section view</span>
            </CommandButton>
            <CommandButton primary={false} disabled={!presentation.partOpen} command="part-interference">
              <AetherIcon name="intersection" />
              <span>Check interference</span>
            </CommandButton>
            <CommandButton primary={false} disabled={!presentation.partOpen} command="part-clearance">
              <AetherIcon name="ruler" />
              <span>Clearance</span>
            </CommandButton>
            <CommandButton primary={false} disabled={!presentation.partOpen} command="part-compare">
              <AetherIcon name="compare" />
              <span>Compare bodies</span>
            </CommandButton>
            <CommandButton primary={false} disabled={!presentation.partOpen} command="part-mesh-inspect">
              <AetherIcon name="cube" />
              <span>Mesh inspect</span>
            </CommandButton>
            <CommandButton primary={false} disabled={!presentation.partOpen} command="part-silhouette">
              <AetherIcon name="curve" />
              <span>Silhouette</span>
            </CommandButton>
          </div>
        </InspectorSection>

        {assemblyReady && (
          <InspectorSection defaultOpen title="Assembly checks">
            <div className="cad-sidebar-analysis-actions">
              <CommandButton primary={false} command="assembly-mass">
                <AetherIcon name="gauge" />
                <span>Mass &amp; health</span>
              </CommandButton>
              <CommandButton primary={false} command="assembly-clearance">
                <AetherIcon name="ruler" />
                <span>Assembly clearance</span>
              </CommandButton>
              <CommandButton primary={false} command="assembly-interference">
                <AetherIcon name="intersection" />
                <span>Assembly interference</span>
              </CommandButton>
              <CommandButton primary={false} command="assembly-export-urdf">
                <AetherIcon name="export" />
                <span>Export URDF</span>
              </CommandButton>
            </div>
          </InspectorSection>
        )}

        <InspectorSection defaultOpen={false} title="Surface diagnostics">
          <p className="cad-form-note">
            Configure Zebra stripes, Draft angle pull direction, Curvature map, Accessibility, and Reflection shaders live on the viewport.
          </p>
          <InspectorActions>
            <Button onClick={() => requestCADPropertyPanel("surface-analysis")}>
              <AetherIcon name="surface-map" />
              <span>Open surface shaders</span>
            </Button>
          </InspectorActions>
        </InspectorSection>
      </div>
    </section>
  );
}
