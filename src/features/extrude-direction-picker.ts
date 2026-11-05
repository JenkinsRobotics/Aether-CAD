import type { ExtrusionDirectionReference } from '@aether/core/document';
import { cadSelection, type CADSelectionItem } from '../cad-selection-store';
import { cadWorkspace } from '../cad-workspace-store';
import { referencePickerLifecycle, activateAvailableReferencePicker } from './reference-picker-lifecycle';
import type { Control, FeatureEditorContext } from './shared';

/** Source edges use the common native reference provider; axes keep feature IDs. */
export function extrudeDirectionPicker(context: FeatureEditorContext, control: Control) {
  const { win, form, doc, feature } = context;
  control.closest('label')?.remove(); control.hidden = true;
  control.setAttribute('form', form.id); form.append(control);
  const box = win.entitiesBox('Extrusion axis or edge');
  box.element.tabIndex = 0;
  const end = feature ? doc.features.findIndex(f => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
  const axes = doc.features.slice(0, end).filter(f => f.type === 'axis' && !f.suppressed);
  let enabled = false, active = false, requesting = false, toggle = false;
  const read = (): ExtrusionDirectionReference | undefined => control.value ? JSON.parse(control.value) : undefined;
  const identity = (ref: ExtrusionDirectionReference) => ref.kind === 'axis' ? JSON.stringify([ref.kind, ref.sourceFeatureId])
    : ref.kind === 'solid-edge' ? JSON.stringify([ref.kind, ref.sourceFeatureId, ref.bodyId,
      [ref.anchor.start, ref.anchor.end].map(a => [a.signature, a.positionMillimeters]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]) : JSON.stringify(ref);
  const render = () => {
    const ref = read();
    box.render(ref ? [{ label: 'label' in ref ? ref.label : 'Sketch line', onRemove: () => set(undefined) }] : []);
  };
  const set = (ref: ExtrusionDirectionReference | undefined) => {
    const value = ref ? JSON.stringify(ref) : '';
    if (value === control.value) return;
    control.value = value; render(); control.dispatchEvent(new Event('change'));
  };
  const lifecycle = referencePickerLifecycle('edge', () => enabled && win.panel.isConnected, value => {
    active = value; box.element.dataset.picking = String(value);
    window.dispatchEvent(new CustomEvent('aether-source-edge-picking', { detail: value }));
  });
  const activate = () => { if (enabled) lifecycle.setActive(true); };
  box.element.addEventListener('pointerdown', activate); box.element.addEventListener('focusin', activate);
  const request = (items: readonly CADSelectionItem[], clicked = false) => {
    if (!enabled || !active || requesting || !win.panel.isConnected || items.length !== 1 || items[0].kind !== 'edge') return;
    requesting = true; toggle = clicked;
    try { window.dispatchEvent(new CustomEvent('aether-transform-edge-request', { detail: { beforeFeatureId: feature?.id, selection: items } })); }
    finally { requesting = false; toggle = false; }
  };
  const receive = (event: Event) => {
    if (!requesting || !enabled || !active) return;
    const reply = (event as CustomEvent).detail;
    if (!reply?.reference || reply.reference.kind !== 'solid-edge') { win.setError(reply?.error ?? 'Select a native straight edge or construction axis.'); return; }
    const current = read();
    set(toggle && current && identity(current) === identity(reply.reference) ? undefined : reply.reference);
  };
  window.addEventListener('aether-transform-edge', receive);
  const click = (event: Event) => {
    const item = (event as CustomEvent<{ item: CADSelectionItem }>).detail?.item;
    if (!enabled || !active || item?.kind !== 'edge') return;
    event.preventDefault(); request([item], true);
  };
  window.addEventListener('aether-feature-reference-click', click);
  let selection = cadSelection.snapshot().items;
  const unsubscribe = cadSelection.subscribe(() => {
    const next = cadSelection.snapshot().items;
    if (next === selection) return;
    selection = next; request(next);
  });
  let tree = new Set(cadWorkspace.snapshot().selectedItemIDs);
  const unsubscribeTree = cadWorkspace.subscribe(() => {
    const next = new Set(cadWorkspace.snapshot().selectedItemIDs), added = [...next].filter(id => !tree.has(id));
    tree = next;
    if (!enabled || !active || !win.panel.isConnected) return;
    const picked = axes.find(axis => added.includes(`feature/axis/${axis.id}`));
    if (picked) set({ kind: 'axis', sourceFeatureId: picked.id, label: picked.name });
  });
  const observer = new window.MutationObserver(() => {
    if (win.panel.isConnected) return;
    observer.disconnect(); unsubscribe(); unsubscribeTree(); lifecycle.dispose();
    window.removeEventListener('aether-transform-edge', receive);
    window.removeEventListener('aether-feature-reference-click', click);
  });
  observer.observe(document.body, { childList: true, subtree: true }); render();
  win.addHelp('Select a straight native edge in the viewport or a construction axis in the tree. The direction follows the reference at its history position. Changed or ambiguous references require reselection.');
  return { element: box.element, setEnabled: (value: boolean) => {
    box.element.hidden = !value;
    if (enabled !== value) { enabled = value; lifecycle.setActive(value); }
    activateAvailableReferencePicker();
  } };
}
