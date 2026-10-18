export type CADSelectionFilter = "auto" | "component" | "body" | "face" | "edge" | "vertex";
export type CADSelectionKind = Exclude<CADSelectionFilter, "auto">;
export type CADSelectionPriority = "body" | "face" | "edge";
export type CADSelectionDragMode = "directional" | "window" | "crossing" | "freeform" | "paint";
export interface CADScreenPoint { x: number; y: number }
export interface CADSelectionStroke { mode: "freeform" | "paint"; points: readonly CADScreenPoint[] }

export type CADBoxSelectionMode = "window" | "crossing";

export interface CADSelectionItem {
  id: string;
  kind: CADSelectionKind;
  partId: string;
  label: string;
  detail?: string;
  faceId?: number;
}

export interface CADSelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  mode: CADBoxSelectionMode;
}

export interface CADScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CADSelectionSnapshot {
  filter: CADSelectionFilter;
  dragMode: CADSelectionDragMode;
  priority: CADSelectionPriority;
  stroke: CADSelectionStroke | null;
  items: readonly CADSelectionItem[];
  hovered: CADSelectionItem | null;
  box: CADSelectionBox | null;
}

export type CADSelectionAction =
  | { type: "set-drag-mode"; mode: CADSelectionDragMode }
  | { type: "set-priority"; priority: CADSelectionPriority }
  | { type: "set-stroke"; stroke: CADSelectionStroke | null }
  | { type: "set-filter"; filter: CADSelectionFilter }
  | { type: "set-hovered"; item: CADSelectionItem | null }
  | { type: "replace"; items: readonly CADSelectionItem[] }
  | { type: "add"; items: readonly CADSelectionItem[] }
  | { type: "toggle"; items: readonly CADSelectionItem[] }
  | { type: "clear" }
  | { type: "set-box"; box: CADSelectionBox | null };

export const selectionFilters: readonly CADSelectionFilter[] = [
  "auto",
  "component",
  "body",
  "face",
  "edge",
  "vertex",
];

export const defaultCADSelection: CADSelectionSnapshot = Object.freeze({
  filter: "auto",
  dragMode: "directional",
  priority: "body",
  stroke: null,
  items: [],
  hovered: null,
  box: null,
});

export function boxSelectionMode(startX: number, currentX: number): CADBoxSelectionMode {
  return currentX >= startX ? "window" : "crossing";
}

export function normalizedSelectionBox(box: CADSelectionBox): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
} {
  const left = Math.min(box.startX, box.currentX);
  const right = Math.max(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const bottom = Math.max(box.startY, box.currentY);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function selectionRectangleMatches(
  mode: CADBoxSelectionMode,
  selection: CADScreenRect,
  candidate: CADScreenRect,
): boolean {
  return mode === "window"
    ? candidate.left >= selection.left && candidate.right <= selection.right &&
      candidate.top >= selection.top && candidate.bottom <= selection.bottom
    : candidate.right >= selection.left && candidate.left <= selection.right &&
      candidate.bottom >= selection.top && candidate.top <= selection.bottom;
}

function unique(items: readonly CADSelectionItem[]): readonly CADSelectionItem[] {
  return [...new Map(items.map((item) => [item.id, item] as const)).values()];
}

export function reduceCADSelection(
  current: CADSelectionSnapshot,
  action: CADSelectionAction,
): CADSelectionSnapshot {
  switch (action.type) {
    case "set-drag-mode":
      return { ...current, dragMode: action.mode, box: null, stroke: null };
    case "set-priority":
      return { ...current, priority: action.priority, filter: "auto", hovered: null, box: null, stroke: null };
    case "set-stroke":
      return { ...current, stroke: action.stroke };
    case "set-filter":
      return { ...current, filter: action.filter, hovered: null, box: null, stroke: null };
    case "set-hovered":
      return { ...current, hovered: action.item };
    case "replace":
      return { ...current, items: unique(action.items), box: null };
    case "add":
      return { ...current, items: unique([...current.items, ...action.items]), box: null };
    case "toggle": {
      const toggled = new Set(action.items.map((item) => item.id));
      const retained = current.items.filter((item) => !toggled.has(item.id));
      const existing = new Set(current.items.map((item) => item.id));
      return {
        ...current,
        items: unique([
          ...retained,
          ...action.items.filter((item) => !existing.has(item.id)),
        ]),
        box: null,
      };
    }
    case "clear":
      return { ...current, items: [], hovered: null, box: null, stroke: null };
    case "set-box":
      return { ...current, box: action.box && (current.dragMode === "window" || current.dragMode === "crossing") ? { ...action.box, mode: current.dragMode } : action.box };
  }
}

type Listener = () => void;

export class CADSelectionStore {
  private current: CADSelectionSnapshot = defaultCADSelection;
  private listeners = new Set<Listener>();

  snapshot = (): CADSelectionSnapshot => this.current;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(action: CADSelectionAction): void {
    this.current = Object.freeze(reduceCADSelection(this.current, action));
    this.listeners.forEach((listener) => listener());
  }
}

export function selectedPartIDs(snapshot: CADSelectionSnapshot): ReadonlySet<string> {
  return new Set(snapshot.items.map((item) => item.partId));
}

export const cadSelection = new CADSelectionStore();

/** Explicit filters win; Auto uses the user-selected priority. */
export function effectiveSelectionKind(snapshot: CADSelectionSnapshot): CADSelectionKind {
  return snapshot.filter === "auto" ? snapshot.priority : snapshot.filter;
}
