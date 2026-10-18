import { useCameraMenu } from "./camera-menu";
/** Camera navigation and the viewport surface itself. */
import { cadCameraPresentation } from "../../cad-camera-presentation-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { ProgressOverlay, ViewportNavigationCube } from "@aether/ui";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { bindViewportContextGesture } from "../../viewport/context-menu-gesture";
import { cadViewportContext } from "../../viewport/context-menu";
import { ViewportContextMenu } from "./viewport-context-menu";
import { SelectionControls } from "./viewport";
import { ViewportTools } from "./viewport";

export function ViewportCameraNavigation() {
  const menu = useCameraMenu();
  const camera = useSyncExternalStore(
    cadCameraPresentation.subscribe,
    cadCameraPresentation.snapshot,
    cadCameraPresentation.snapshot,
  );
  return (
    <ViewportNavigationCube
      id="view-cube"
      className="view-cube"
      orientation={camera.orientation}
      upAxis={camera.upAxis}
      homeMenuItems={menu.items}
      onHomeMenuSelect={menu.onSelect}
      onSelectView={(view) =>
        cadCameraPresentation.dispatch({ type: "select-view", view })
      }
      onFit={() => cadCameraPresentation.dispatch({ type: "fit-isometric" })}
      onSelectDirection={(direction) => cadCameraPresentation.dispatch({ type: "select-direction", direction })}
      onNudge={(horizontalSteps, verticalSteps) =>
        cadCameraPresentation.dispatch({
          type: "nudge",
          horizontalSteps,
          verticalSteps,
        })
      }
      onRoll={(quarterTurns) =>
        cadCameraPresentation.dispatch({ type: "roll", quarterTurns })
      }
    />
  );
}

export function ViewportSurface({
  presentation,
}: {
  presentation: CADPresentationSnapshot;
}) {
  const viewport = useRef<HTMLElement>(null);
  useEffect(() => viewport.current ? bindViewportContextGesture(viewport.current, event => cadViewportContext.open(event)) : undefined, []);
  return (
    <section ref={viewport} id="viewport" className="viewport" aria-label="3D CAD viewport">
      <div className="instructions"><strong>CAD authoring</strong><span>Sketch → Extrude · Connector → Fastened Mate</span><span>RMB orbit · MMB pan · wheel zoom</span></div>
      <ViewportTools activePanel={presentation.activePanel} />
      <SelectionControls />
      <ViewportContextMenu />
      {presentation.activeTool === "connector" ? <div id="connector-card" className="mate-card">
        <div className="mate-title"><span>Place Mate Connector</span><button type="button" aria-label="Cancel tool" onClick={() => cadPresentation.dispatch({ type: "cancel-tool" })}>×</button></div>
        <div className="single-step"><span className="step-dot active">+</span><div><b>Choose an exact anchor</b><span>Hover a face, edge, circle/ellipse, shaft/bore, cone, sphere, or vertex and click. The connector remains attached to that Part.</span></div></div>
        <p>Create as many connectors as needed. A connector is one half of a future mate.</p>
      </div> : null}
      {presentation.activeTool === "fastened" ? <div id="mate-card" className="mate-card">
        <div className="mate-title"><span>Fastened Mate</span><button type="button" aria-label="Cancel tool" onClick={() => cadPresentation.dispatch({ type: "cancel-tool" })}>×</button></div>
        <div className="mate-step"><span className="step-dot active">1</span><div><b>Moving connector</b><span>{presentation.movingPick}</span></div></div>
        <div className="mate-step"><span className={`step-dot${presentation.targetPick.startsWith("Choose") ? " active" : ""}`}>2</span><div><b>Target connector</b><span>{presentation.targetPick}</span></div></div>
        <p>Click visible connector anchors or use Pick in the connector list. Origins and X axes align; primary Z axes oppose.</p>
      </div> : null}
      {presentation.awaitingSketchPlane ? <div id="sketch-plane-card" className="sketch-plane-card">
        <header><div><b>Create Sketch</b><span>Select a plane</span></div><button type="button" title="Cancel" onClick={() => cadPresentation.dispatch({ type: "cancel-sketch-plane" })}>×</button></header>
        <p>Choose <b>Top</b>, <b>Front</b>, or <b>Right Plane</b> in the Items browser. The new sketch opens normal to that plane with its center anchored to the Origin.</p>
      </div> : null}
      <ProgressOverlay
        open={presentation.loading !== null && !presentation.loading.backgrounded}
        label={presentation.loading?.label ?? "Working"}
        detail={presentation.loading?.detail}
        phase={presentation.loading?.phase}
        value={presentation.loading?.value}
        max={presentation.loading?.max}
        onCancel={presentation.loading?.canCancel ? () => cadPresentation.dispatch({ type: "cancel-loading" }) : undefined}
        onBackground={presentation.loading?.canBackground ? () => cadPresentation.dispatch({ type: "background-loading" }) : undefined}
      />
    </section>
  );
}
