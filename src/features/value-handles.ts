/** Every adjustable value in the viewport (an extrusion's depth, a revolve's angle, a fillet's
 *  radius) shows the same manipulator: Aether UI's value manipulator, one per viewport, that
 *  the section view already uses (Jonathan, 2026-11-02). Feature windows register providers;
 *  this composes their projections into axis and rotation handles, guide lines, orbit ribbons
 *  and one editable readout, and routes drags and typed values back to each provider. */
import { mountValueManipulator, type ManipulatorHandle, type ManipulatorOrbit, type ManipulatorPoint } from "@aether/ui";

type Point = ManipulatorPoint;
export type LinearProjection = import('../viewport/linear-axis-projection').LinearAxisProjection & { angle?: number; /** The handle's origin on screen (the sketch plane), for the guide. */ origin?: Point };
export type AngularProjection = { x: number; y: number; angle?: number; points: Point[]; arc?: Point[]; tangent?: number; pointAt?: (degrees: number) => Point; valueAt: (x: number, y: number) => number | null };
export interface ValueHandleProvider {
  id: string;
  kind: "axis" | "rotation";
  label: string;
  /** The window the handle belongs to: the provider leaves when it is unmounted. */
  panel: HTMLElement;
  /** Current projection, or null when the handle has nothing to stand on. */
  project(): LinearProjection | AngularProjection | null;
  /** The readout text, in document units. */
  text(): string;
  ready(): boolean;
  /** A drag began at the pointer; return false to refuse. */
  begin(event: PointerEvent, projection: LinearProjection | AngularProjection): boolean;
  move(event: PointerEvent): void;
  end(cancelled: boolean): void;
  key?(event: KeyboardEvent): void;
  /** The readout was typed and left. */
  commit(text: string): void | string;
}

type Manager = { widget: ReturnType<typeof mountValueManipulator>; providers: Map<string, ValueHandleProvider>; frame: number; dragging: string | null; active: string | null };
const managers = new WeakMap<HTMLElement, Manager>();
const handleId = (provider: ValueHandleProvider) => `${provider.id}`;

function manager(viewport: HTMLElement): Manager {
  let current = managers.get(viewport);
  if (current) return current;
  const state: Manager = { widget: null as never, providers: new Map(), frame: 0, dragging: null, active: null };
  const find = (handle: ManipulatorHandle) => state.providers.get(handle.id);
  state.widget = mountValueManipulator(viewport, {
    readoutLabel: "Value",
    onStart(handle, event) {
      const provider = find(handle); if (!provider || !provider.ready()) return false;
      const projection = provider.project(); if (!projection) return false;
      if (!provider.begin(event, projection)) return false;
      state.active = state.dragging = handle.id; document.body.dataset.cadHandleDrag = "1"; // the preview skips its debounce while a handle drags
      return true;
    },
    onMove(handle, event) { find(handle)?.move(event); },
    onEnd(handle, cancelled) { delete document.body.dataset.cadHandleDrag; state.dragging = null; find(handle)?.end(cancelled); },
    onKey(handle, event) { state.active = handle.id; find(handle)?.key?.(event); },
    onCommit(text) { const id = readoutFor(state); const provider = id ? state.providers.get(id) : undefined; if (provider?.ready()) return provider.commit(text); },
  });
  state.widget.element.setAttribute("aria-label", "Feature manipulator");
  managers.set(viewport, state);
  return state;
}
/** The readout follows the dragged handle, else the first handle that has a projection. */
function readoutFor(state: Manager): string | null {
  if (state.dragging) return state.dragging;
  if (state.active && state.providers.get(state.active)?.project()) return state.active;
  for (const provider of state.providers.values()) if (provider.project()) return provider.id;
  return null;
}
function draw(viewport: HTMLElement, state: Manager) {
  const rect = viewport.getBoundingClientRect(), local = (p: { x: number; y: number }): Point => ({ x: p.x - rect.left, y: p.y - rect.top });
  const handles: ManipulatorHandle[] = [], orbits: ManipulatorOrbit[] = [], guides: Point[][] = [];
  let readout: { x: number; y: number; text: string; id: string; label: string } | null = null;
  const readoutId = readoutFor(state);
  const endOnPositions: Point[] = [];
  for (const provider of state.providers.values()) {
    if (!provider.panel.isConnected) { state.providers.delete(provider.id); continue; }
    const projection = provider.project(); if (!projection) continue;
    const at = local(projection);
    if (provider.kind === "axis") {
      const p = projection as LinearProjection, origin = p.origin ? local(p.origin) : null;
      if (p.axisView) {
        // Coincident depth/offset/second-end controls get separate callouts;
        // their geometry anchor stays visible and pointer deltas stay native.
        const anchor = { ...at };
        at.x += 40;
        while (endOnPositions.some(other => Math.hypot(other.x - at.x, other.y - at.y) < 30)) at.y -= 34;
        endOnPositions.push({ ...at }); guides.push([anchor, { ...at }]);
      }
      const angle = p.angle ?? (origin ? Math.atan2(at.y - origin.y, at.x - origin.x) * 180 / Math.PI + 90 : 0);
      handles.push({ id: handleId(provider), kind: "axis", label: provider.label, x: at.x, y: at.y, angle: p.axisView ? 0 : angle, axisView: p.axisView });
      if (origin && !p.axisView) guides.push([origin, at]);
    } else {
      const p = projection as AngularProjection, points = p.points.map(local);
      if (p.pointAt) orbits.push({ id: handleId(provider), label: provider.label, angle: p.angle ?? 0, points, pointAt: (degrees) => local(p.pointAt!(degrees)) });
      else handles.push({ id: handleId(provider), kind: "rotation", label: provider.label, x: at.x, y: at.y, angle: p.tangent ?? 0 });
      if (p.arc) guides.push(p.arc.map(local));
    }
    if (provider.id === readoutId) readout = { x: at.x + 16, y: at.y + 14, text: provider.text(), id: provider.id, label: provider.label };
  }
  state.widget.update({ handles, orbits, guides, readout, disabled: !state.dragging && [...state.providers.values()].filter((p) => p.project()).some((p) => !p.ready()) });
}

/** Register a handle for the lifetime of its window. */
export function registerValueHandle(provider: ValueHandleProvider): () => void {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  if (!viewport || !window.requestAnimationFrame) return () => {};
  const state = manager(viewport);
  state.providers.set(provider.id, provider);
  const tick = () => {
    if (!state.providers.size) { state.frame = 0; state.widget.update({ handles: [], orbits: [], guides: [], readout: null }); return; }
    draw(viewport, state);
    state.frame = window.requestAnimationFrame(tick);
  };
  draw(viewport, state); // the handle shows at once; frames keep it on the geometry
  if (!state.frame) state.frame = window.requestAnimationFrame(tick);
  // A new preview redraws at once, so a handle appears with the geometry it stands on.
  const onPreview = () => draw(viewport, state);
  provider.panel.addEventListener("aether-feature-preview-state", onPreview);
  const observer = new window.MutationObserver(() => { if (provider.panel.isConnected) return; observer.disconnect(); dispose(); });
  observer.observe(document.body, { childList: true, subtree: true });
  const dispose = () => {
    observer.disconnect();
    if (state.dragging === provider.id) state.widget.cancel();
    provider.panel.removeEventListener("aether-feature-preview-state", onPreview);
    state.providers.delete(provider.id);
    draw(viewport, state); // the handle leaves with its window
  };
  return dispose;
}
