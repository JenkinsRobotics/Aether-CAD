/** The Drawing workspace route. */
import { cadDrawingWorkspace } from "../../cad-drawing-workspace-store";
import { cadPresentation } from "../../cad-presentation-store";
import { DrawingWorkspace } from "../DrawingWorkspace";
import { useSyncExternalStore } from "react";

export function DrawingWorkspaceRoute({ active }: { active: boolean }) {
  const drawing = useSyncExternalStore(
    cadDrawingWorkspace.subscribe,
    cadDrawingWorkspace.snapshot,
    cadDrawingWorkspace.snapshot,
  );
  return <div
    className={`cad-drawing-route${active ? " active" : ""}`}
    aria-hidden={!active}
    inert={!active}
  >
    <DrawingWorkspace
      snapshot={drawing}
      onAction={(action) => cadDrawingWorkspace.dispatch(action)}
      onCommand={() => {}}
      commandsConnected={false}
      onExit={() => cadPresentation.dispatch({ type: "select-workspace-mode", mode: "modeling" })}
    />
  </div>;
}
