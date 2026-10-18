/** Chrome drawn over the 3D viewport. */
import { type CADBrowserPanel, cadPresentation } from "../../cad-presentation-store";
import { type CADSelectionFilter, cadSelection, normalizedSelectionBox } from "../../cad-selection-store";
import { Rail, SelectField } from "@aether/ui";
import { useSyncExternalStore } from "react";
import { FloatingCommand } from "./commands";

export function ViewportTools({
  activePanel,
}: {
  activePanel: CADBrowserPanel;
}) {
  return (
    <>
      <Rail className="viewport-mode-tools" aria-label="Workspace modes">
        <FloatingCommand icon="model" label="Modeling" panel="parameters" active={activePanel === "parameters"} />
        <FloatingCommand icon="items" label="Items" panel="items" active={activePanel === "items"} />
        <FloatingCommand icon="assembly" label="Assembly" panel="mates" active={activePanel === "mates"} />
        <FloatingCommand icon="sketch" label="Drawing" onActivate={() => cadPresentation.dispatch({ type: "select-workspace-mode", mode: "drawing" })} />
        <FloatingCommand icon="view" label="Inspect" panel="inspect" active={activePanel === "inspect"} />
        <FloatingCommand icon="view" label="Visualization" panel="visualization" active={activePanel === "visualization"} />
      </Rail>
      <Rail className="viewport-authoring-tools" aria-label="Modeling tools">
        <FloatingCommand icon="search" label="Search" onActivate={() => cadPresentation.dispatch({ type: "focus-items-filter" })} />
        <FloatingCommand icon="sketch" label="Sketch" command="sketch" />
        <FloatingCommand icon="step" label="Import CAD" command="insert-step" />
        <FloatingCommand icon="connector" label="Connector" command="connector" />
        <FloatingCommand icon="mate" label="Fastened" command="fastened" />
        <FloatingCommand icon="items" label="Cycle Selection Filter" command="selection-next-filter" />
      </Rail>
      <Rail className="viewport-bottom-tools" aria-label="Viewport navigation">
        <FloatingCommand icon="fit" label="Zoom to Fit" command="fit-view" />
      </Rail>
    </>
  );
}

export function SelectionControls() {
  const selection = useSyncExternalStore(
    cadSelection.subscribe,
    cadSelection.snapshot,
    cadSelection.snapshot,
  );
  const bounds = selection.box ? normalizedSelectionBox(selection.box) : null;
  if (selection.stroke) {
    const {mode,points}=selection.stroke;
    const last=points.at(-1);
    return <svg aria-hidden="true" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:5}}>
      {mode==='freeform' ? <polygon points={points.map(p=>`${p.x},${p.y}`).join(' ')} stroke="var(--aether-color-ok)" strokeDasharray="4 3" fill="color-mix(in srgb, var(--aether-color-ok) 12%, transparent)"/> : <>
        <polyline points={points.map(p=>`${p.x},${p.y}`).join(' ')} stroke="var(--aether-color-ok)" strokeWidth="12" strokeOpacity=".2" fill="none"/>
        {last && <circle cx={last.x} cy={last.y} r="8" stroke="var(--aether-color-ok)" fill="none"/>}
      </>}
    </svg>;
  }
  return selection.box && bounds ? <div
    className={`cad-selection-box ${selection.box.mode}`}
    style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
    aria-hidden="true"
  ><span>{selection.box.mode === "window" ? "Window" : "Crossing"}</span></div> : null;
}

/** The selection filter card; the shell places it in the right column. */
export function SelectionFilterHud() {
  const selection = useSyncExternalStore(
    cadSelection.subscribe,
    cadSelection.snapshot,
    cadSelection.snapshot,
  );
  return (
      <div className="selection-filter-hud" aria-label="Viewport selection tools">
        <span>Selection</span>
        <SelectField
          aria-label="Selection filter"
          value={selection.filter}
          options={[
            { value: "auto", label: "Auto" },
            { value: "component", label: "Component" },
            { value: "body", label: "Body" },
            { value: "face", label: "Face" },
            { value: "edge", label: "Edge" },
            { value: "vertex", label: "Vertex" },
          ]}
          onChange={(event) => cadSelection.dispatch({ type: "set-filter", filter: event.target.value as CADSelectionFilter })}
        />
        <small>{selection.items.length} selected · {selection.dragMode === "directional" ? "drag → Window · drag ← Crossing" : `${selection.dragMode[0].toUpperCase()}${selection.dragMode.slice(1)} selection`}</small>
      </div>
  );
}
