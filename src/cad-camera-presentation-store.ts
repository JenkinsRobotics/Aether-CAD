import type { StandardCameraView } from "./camera-view";
import type {
  ViewportOrientation,
  ViewportUpAxis,
} from "@aether/ui";

export interface CADCameraPresentationSnapshot {
  orientation: ViewportOrientation;
  fieldOfViewDegrees: number;
  projection: "perspective" | "orthographic";
  upAxis: ViewportUpAxis;
}

export type CADCameraPresentationAction =
  | { type: "set-projection"; projection: "perspective" | "orthographic" }
  | { type: "select-view"; view: StandardCameraView }
  | { type: "set-up-axis"; upAxis: ViewportUpAxis }
  | { type: "select-direction"; direction: readonly [number, number, number] }
  | { type: "fit-isometric" }
  | { type: "zoom-to-fit" }
  | { type: "nudge"; horizontalSteps: number; verticalSteps: number }
  | { type: "roll"; quarterTurns: number }
  | { type: "set-field-of-view"; degrees: number };

type Listener = () => void;
type ActionHandler = (action: CADCameraPresentationAction) => void;

const initialSnapshot: CADCameraPresentationSnapshot = Object.freeze({
  orientation: Object.freeze([0, 0, 0, 1]) as ViewportOrientation,
  fieldOfViewDegrees: 42,
  projection: "perspective",
  upAxis: "z",
});

/** Isolated renderer-to-React camera projection. Camera behavior stays in the
 * viewer; this store only publishes orientation and forwards typed UI intent. */
export class CADCameraPresentationStore {
  private current = initialSnapshot;
  private listeners = new Set<Listener>();
  private actionHandler: ActionHandler | null = null;

  snapshot = (): CADCameraPresentationSnapshot => this.current;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setOrientation(orientation: ViewportOrientation): void {
    const next = Object.freeze([...orientation]) as ViewportOrientation;
    if (next.every((value, index) => value === this.current.orientation[index])) {
      return;
    }
    this.current = Object.freeze({ ...this.current, orientation: next });
    this.listeners.forEach((listener) => listener());
  }

  setProjection(projection: "perspective" | "orthographic"): void {
    if (projection === this.current.projection) return;
    this.current=Object.freeze({...this.current,projection});
    this.listeners.forEach(listener=>listener());
  }

  setFieldOfView(degrees: number): void {
    if (degrees === this.current.fieldOfViewDegrees) return;
    this.current = Object.freeze({ ...this.current, fieldOfViewDegrees: degrees });
    this.listeners.forEach((listener) => listener());
  }

  setUpAxis(upAxis: ViewportUpAxis): void {
    if (upAxis === this.current.upAxis) return;
    this.current = Object.freeze({ ...this.current, upAxis });
    this.listeners.forEach((listener) => listener());
  }

  registerActionHandler(handler: ActionHandler): () => void {
    this.actionHandler = handler;
    return () => {
      if (this.actionHandler === handler) this.actionHandler = null;
    };
  }

  dispatch(action: CADCameraPresentationAction): boolean {
    if (!this.actionHandler) return false;
    this.actionHandler(action);
    return true;
  }
}

export const cadCameraPresentation = new CADCameraPresentationStore();
