import type { FeatureWindow } from '@aether/ui';
import { CADSelectionStore, cadSelection, type CADSelectionAction, type CADSelectionFilter, type CADSelectionSnapshot } from '../cad-selection-store';

interface Session {
  window: FeatureWindow | null;
  selection: Pick<CADSelectionStore, 'snapshot' | 'subscribe' | 'dispatch'>;
  changed(active: boolean): void;
  active(): boolean;
  activate(): void;
  attach(win: FeatureWindow): void;
  receive(action: CADSelectionAction): void;
  dispose(): void;
}
const sessions = new Set<Session>();
let active: Session | null = null;
let baseline: CADSelectionSnapshot | null = null;
let switching = false;
let lastItems = cadSelection.snapshot().items;
let stopSelection: (() => void) | null = null;

function activate(next: Session | null) {
  if (active === next) return;
  switching = true;
  const previous = active;
  active = next;
  previous?.changed(false);
  const state = next?.selection.snapshot() ?? baseline;
  if (state) {
    cadSelection.dispatch({ type: 'replace', items: state.items });
    cadSelection.dispatch({ type: 'set-filter', filter: state.filter });
  }
  lastItems = cadSelection.snapshot().items;
  switching = false;
  next?.changed(true);
}

function focused(event: Event) {
  const panel = (event as CustomEvent<{ panel: HTMLElement }>).detail.panel;
  activate([...sessions].find(session => session.window?.panel === panel) ?? null);
}

function suspend() { activate(null); }

/** Retained tool selections share the viewport only while their window is active. */
export function createInspectionSession(options: { filter?: CADSelectionFilter; inheritSelection?: boolean; changed(active: boolean): void }): Session {
  const local = new CADSelectionStore();
  const initial = baseline ?? cadSelection.snapshot();
  local.dispatch({ type: 'set-filter', filter: options.filter ?? initial.filter });
  if (options.inheritSelection && !sessions.size) local.dispatch({ type: 'replace', items: initial.items });
  const session: Session = {
    window: null as FeatureWindow | null,
    selection: {
      snapshot: local.snapshot,
      subscribe: local.subscribe,
      dispatch(action: CADSelectionAction) {
        if (active === session) cadSelection.dispatch(action);
        else local.dispatch(action);
      },
    },
    changed: options.changed,
    active: () => active === session,
    activate() { session.window?.focus(); activate(session); },
    attach(win: FeatureWindow) {
      session.window = win;
      if (!sessions.size) {
        baseline = cadSelection.snapshot();
        stopSelection = cadSelection.subscribe(() => {
          if (switching || !active) return;
          const state = cadSelection.snapshot();
          // Filters/hover must not re-deliver an already consumed model pick.
          if (lastItems !== state.items) { lastItems = state.items; active.receive({ type: 'replace', items: state.items }); }
          if (active.selection.snapshot().filter !== state.filter) active.receive({ type: 'set-filter', filter: state.filter });
        });
        document.addEventListener('aether-feature-window-focus', focused);
        window.addEventListener('aether-inspection-tool-open', suspend);
      }
      sessions.add(session);
      activate(session);
    },
    receive: local.dispatch.bind(local),
    dispose() {
      sessions.delete(session);
      if (active === session) activate(null);
      if (!sessions.size) {
        stopSelection?.(); stopSelection = null; baseline = null;
        document.removeEventListener('aether-feature-window-focus', focused);
        window.removeEventListener('aether-inspection-tool-open', suspend);
      }
    },
  };
  return session;
}
