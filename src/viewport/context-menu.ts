import { bodyIDsForFeature, createdBodyIDs, dependentFeatures, featureDependencies, offsetFaceBodies, rollbackPosition, type PartDocument, type PartFeature } from '@aether/core/document';
import type { MenuItem } from '@aether/ui';
import { cadCommands } from '../cad-command-registry';
import { sketchContextCommands } from '../sketch/context-commands';
import { cadCameraPresentation } from '../cad-camera-presentation-store';
import { cadPresentation, requestCADPropertyPanel } from '../cad-presentation-store';
import { cadSelection, selectionFilters, type CADSelectionItem } from '../cad-selection-store';
import { requestPartExport } from '../modeling/part-export';
import type { MateViewport } from '../viewer';
import type { PartDisplayOverride } from './part-display';

type Entry = Omit<MenuItem, 'children'> & { run?: () => void; children?: Entry[] };
export interface ViewportContextSnapshot {
  menu: { anchor: { x: number; y: number }; items: Entry[] } | null;
  detail: { kind: 'dependencies'; name: string; parents: string[]; children: string[] } |
    { kind: 'appearance'; id: string; name: string; value: PartDisplayOverride } | null;
}
class ViewportContextStore {
  private value: ViewportContextSnapshot = { menu: null, detail: null };
  private listeners = new Set<() => void>();
  open: (event: MouseEvent) => void = () => {};
  changeAppearance: (value: PartDisplayOverride) => void = () => {};
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  patch(value: Partial<ViewportContextSnapshot>) { this.value = { ...this.value, ...value }; this.listeners.forEach(fn => fn()); }
  closeMenu = () => this.patch({ menu: null });
  closeDetail = () => this.patch({ detail: null });
  select = (id: string) => {
    const find = (items: Entry[]): Entry | undefined => {
      for (const item of items) { if (item.id === id) return item; const child = item.children && find(item.children); if (child) return child; }
    };
    const item = find(this.value.menu?.items ?? []);
    this.closeMenu();
    if (item && !item.disabled) item.run?.();
  };
}
export const cadViewportContext = new ViewportContextStore();

/** Project the last effective feature for a body, including legacy implicit
 * targets. This does not claim face-level feature provenance. */
export function bodyContextFeatures(doc: PartDocument, bodyId: string): { feature?: PartFeature; sketches: PartFeature[] } {
  const last = new Map<string, PartFeature>();
  let implicitBody: string | undefined;
  for (const f of doc.features.slice(0, rollbackPosition(doc))) {
    if (f.suppressed || ['sketch', 'profile', 'plane'].includes(f.type)) continue;
    if(f.type==='transform'){
      const outputs=f.copyBodyIds?createdBodyIDs(doc,f):f.bodyIds;
      for(const id of outputs)last.set(id,f);
      if(f.copyBodyIds)implicitBody=outputs.at(-1);
      continue;
    }
    if ('operation' in f && f.operation === 'new') {
      for (const id of bodyIDsForFeature(doc, f)) { last.set(id, f); implicitBody = id; }
    } else {
      const target = 'targetBodyId' in f && f.targetBodyId ? f.targetBodyId : implicitBody;
      const targets = f.type === 'offset-face' ? offsetFaceBodies(f) : f.type === 'extrude' && f.targetBodyIds && f.operation !== 'add' ? f.targetBodyIds : [target];
      for (const id of targets) if (id) last.set(id, f);
    }
  }
  const feature = last.get(bodyId);
  const deps = featureDependencies(doc);
  const upstream = new Set<string>();
  const visit = (id: string) => { if (upstream.has(id)) return; upstream.add(id); for (const parent of deps.get(id) ?? []) visit(parent); };
  if (feature) visit(feature.id);
  return { feature, sketches: doc.features.filter(f => upstream.has(f.id) && (f.type === 'profile' || f.type === 'sketch')) };
}

type ContextViewer = Pick<MateViewport, 'contextPartsAt' | 'getPartRows' | 'setPartVisibility' | 'isolatePart' | 'isolatedPartId' | 'getPartDisplay' | 'setPartDisplay' | 'zoomToParts'>;
export function configureViewportContext(deps: {
  viewer: ContextViewer;
  document: () => PartDocument | null;
  apply: (doc: PartDocument) => Promise<void>;
  status: (message: string) => void;
}) {
  const { viewer } = deps;
  const unavailable = (id: string, label: string, reason: string): Entry => ({ id, label, disabled: true, disabledReason: reason });
  let documentId = deps.document()?.documentId;
  const invalidated = () => {
    const nextId = deps.document()?.documentId;
    if (viewer.isolatedPartId && (nextId !== documentId || !viewer.getPartRows().some(row => row.id === viewer.isolatedPartId))) viewer.isolatePart(null);
    documentId = nextId;
    cadViewportContext.patch({ menu: null, detail: null });
  };
  window.addEventListener('aether-part-updated', invalidated);
  const featureAction = (feature: PartFeature, actionID: string) => window.dispatchEvent(new CustomEvent('aether-feature-action', {
    detail: { type: 'item-action', id: `feature/${feature.type}/${feature.id}`, actionID },
  }));
  const selectPart = (item: CADSelectionItem) => cadSelection.dispatch({ type: 'replace', items: [item] });
  const visibility = async (ids: readonly string[], visible: boolean) => {
    viewer.isolatePart(null);
    const doc = deps.document();
    const authored = viewer.getPartRows().filter(row => ids.includes(row.id) && row.sourceDocumentId === doc?.documentId);
    try {
      if (doc && authored.length) {
        const next = { ...doc, bodyProperties: { ...doc.bodyProperties } };
        for (const row of authored) next.bodyProperties[row.id] = { ...next.bodyProperties[row.id], name: row.name, visible };
        await deps.apply(next);
      }
      if (deps.document()?.documentId !== doc?.documentId) return;
      for (const id of ids) viewer.setPartVisibility(id, visible);
    } catch (error) { deps.status(error instanceof Error ? error.message : String(error)); }
  };
  cadViewportContext.changeAppearance = value => {
    const detail = cadViewportContext.snapshot().detail;
    if (detail?.kind !== 'appearance' || !viewer.getPartRows().some(row => row.id === detail.id)) return;
    viewer.setPartDisplay(detail.id, value);
    cadViewportContext.patch({ detail: { ...detail, value } });
  };
  cadViewportContext.open = event => {
    const doc = deps.document();
    const rows = viewer.getPartRows();
    // Keyboard menu applies to the current selection, not an arbitrary screen ray.
    const hits = event.button === 0
      ? cadSelection.snapshot().items.filter(item => rows.some(row => row.id === item.partId && row.visible)).slice(0, 1)
      : viewer.contextPartsAt(event.clientX, event.clientY);
    const hit = hits[0];
    const row = rows.find(row => row.id === hit?.partId);
    if (hit) selectPart(hit); else cadSelection.dispatch({ type: 'clear' });
    const authored = !!row && !!doc && row.sourceDocumentId === doc.documentId;
    const { feature, sketches } = authored ? bodyContextFeatures(doc, row.id) : { feature: undefined, sketches: [] };
    const busy = !!document.querySelector('.cad-feature-dialog,.cad-sketch-workspace,.cad-plane-window,.cad-analysis-dialog') || !!cadPresentation.snapshot().loading;
    const edit = (f: PartFeature): Entry => ({ id: `edit:${f.id}`, label: `Edit ${f.name}…`,
      disabled: busy || f.type === 'import-cad' || f.type === 'import-step',
      disabledReason: busy ? 'Finish or cancel the current tool first.' : 'Imported geometry has no editable source feature parameters.',
      run: () => featureAction(f, 'edit-feature') });
    const selection: Entry = { id: 'select', label: 'Select', children: [
      ...selectionFilters.map(filter => ({ id: `filter:${filter}`, label: ({ auto: 'Automatic', component: 'Components', body: 'Parts', face: 'Faces', edge: 'Edges', vertex: 'Vertices' })[filter],
        kind: 'radio' as const, checked: cadSelection.snapshot().filter === filter, run: () => cadSelection.dispatch({ type: 'set-filter', filter }) })),
      { id: 'select-all', label: 'All visible parts', separatorBefore: true, disabled: !rows.some(r => r.visible), run: () => cadSelection.dispatch({ type: 'replace', items: viewer.getPartRows().filter(r => r.visible).map(r => ({ id: `body:${r.id}`, kind: 'body', partId: r.id, label: r.name })) }) },
      { id: 'deselect', label: 'Clear selection', run: () => cadSelection.dispatch({ type: 'clear' }) },
    ] };
    const fit: Entry = { id: 'fit', label: 'Zoom to fit', disabled: !rows.some(r => r.visible), run: () => viewer.zoomToParts() };
    const exitIsolation: Entry[] = viewer.isolatedPartId ? [{ id: 'exit-isolate', label: 'Exit isolation', run: () => viewer.isolatePart(null) }] : [];
    let items: Entry[];
    if (!hit || !row) {
      items = [
        { id: 'show-all', label: 'Show all', disabled: busy || !rows.length, run: () => { void visibility(rows.map(r => r.id), true); } },
        ...exitIsolation, selection, { ...fit, separatorBefore: true },
        { id: 'isometric', label: 'Isometric', run: () => cadCameraPresentation.dispatch({ type: 'select-view', view: 'isometric' }) },
      ];
    } else {
      const display = viewer.getPartDisplay(hit.partId);
      const section = cadCommands.snapshot()['part-section'];
      const offset = cadCommands.snapshot()['feature-offset-face'];
      const transform = cadCommands.snapshot()['feature-transform'];
      items = [
        ...(feature ? [edit(feature), ...sketches.map(edit)] : []),
        { id: 'offset-faces', label: 'Move faces…', disabled: busy || !authored || !offset.enabled || !offset.registered,
          disabledReason: 'Open an editable solid part and finish the current tool first.', run: () => { cadCommands.execute('feature-offset-face'); } },
        unavailable('dimensions', 'Show dimensions', 'Dimension overlays are available while editing a sketch. Use Edit sketch above.'),
        ...(feature ? [{ id: 'dependencies', label: `Show dependencies of ${feature.name}…`, run: () => {
          const names = new Map(doc!.features.map(f => [f.id, f.name]));
          cadViewportContext.patch({ detail: { kind: 'dependencies', name: feature.name,
            parents: (featureDependencies(doc!).get(feature.id) ?? []).map(id => names.get(id) ?? `Missing: ${id}`),
            children: [...dependentFeatures(doc!, feature.id)].filter(id => id !== feature.id).map(id => names.get(id) ?? id) } });
        } }] : []),
        { id: 'hide', label: `Hide ${row.name}`, separatorBefore: true, disabled: busy, run: () => { void visibility([row.id], false); } },
        unavailable('surface-analysis', 'Curve/surface analysis…', 'Curvature and continuity analysis are not implemented yet.'),
        { id: 'isolate', label: `Isolate ${row.name}`, disabled: busy, run: () => viewer.isolatePart(row.id) },
        ...exitIsolation,
        { id: 'transparent', label: (display.opacity ?? 1) < 1 ? 'Make opaque' : 'Make transparent',
          run: () => viewer.setPartDisplay(row.id, { ...display, opacity: (display.opacity ?? 1) < 1 ? 1 : 0.3 }) },
        { id: 'section', label: 'Section view…', disabled: busy || !authored || !section.enabled || !section.registered,
          disabledReason: 'Open an editable solid part and finish the current tool first.', run: () => { cadCommands.execute('part-section'); } },
        {id:'transform',label:`Transform ${row.name}…`,separatorBefore:true,disabled:busy||!authored||!transform.enabled||!transform.registered,run:()=>{cadCommands.execute('feature-transform');}},
        {id:'copy',label:`Copy ${row.name}`,disabled:busy||!authored||!cadCommands.snapshot()['transform-copy'].registered,run:()=>{cadCommands.execute('transform-copy');}},
        unavailable('drawing', `Create Drawing of ${row.name}…`, 'The drawing workbench is not implemented yet.'),
        { id: 'export', label: `Export ${row.name}…`, disabled: busy || !authored, disabledReason: 'Export is available for bodies in the active Part document.', run: () => requestPartExport(row.id) },
        { ...selection, separatorBefore: true },
        { id: 'select-other', label: 'Select other', disabled: hits.length < 2, disabledReason: 'No other visible part is under this point.', children: hits.map((item, i) => ({ id: `other:${i}`, label: item.label, run: () => selectPart(item) })) },
        { ...unavailable('comment', 'Add comment', 'Part-anchored comments are not implemented yet.'), separatorBefore: true },
        { ...fit, separatorBefore: true },
        { id: 'fit-selection', label: 'Zoom to selection', run: () => viewer.zoomToParts([row.id]) },
        { ...unavailable('delete-part', `Delete ${row.name}…`, 'A separate Delete part feature is not implemented. Delete the generating feature from its history instead.'), separatorBefore: true, danger: true },
        ...(feature ? [{ id: 'delete-feature', label: `Delete ${feature.name}…`, danger: true, disabled: busy, run: () => featureAction(feature, 'delete-feature') }] : []),
        { id: 'material', label: `Material properties for ${row.name}…`, separatorBefore: true, run: () => {
          selectPart(hit!); requestCADPropertyPanel('visualization');
        } },
        { id: 'appearance', label: `Edit appearance for ${row.name}…`, run: () => {
          cadSelection.dispatch({ type: 'clear' });
          cadViewportContext.patch({ detail: { kind: 'appearance', id: row.id, name: row.name, value: viewer.getPartDisplay(row.id) } });
        } },
        unavailable('face-appearance', 'Add appearance to face…', 'Saved per-face appearance is not implemented yet.'),
      ];
    }
    if (document.querySelector('.cad-sketch-workspace')) {
      const sketch = sketchContextCommands();
      if (sketch.length) items = [...sketch, ...items.map((item, index) => index ? item : { ...item, separatorBefore: true })];
    }
    // A stale menu must never mutate a newly loaded or rebuilt document.
    const guard = (entries: Entry[]): Entry[] => entries.map(entry => ({ ...entry,
      children: entry.children && guard(entry.children),
      run: entry.run && (() => {
        if (deps.document() !== doc || (hit && !viewer.getPartRows().some(r => r.id === hit.partId))) return;
        entry.run!();
      }),
    }));
    cadViewportContext.patch({ menu: { anchor: { x: event.clientX, y: event.clientY }, items: guard(items) } });
  };
  return () => { window.removeEventListener('aether-part-updated', invalidated); cadViewportContext.open = () => {}; cadViewportContext.changeAppearance = () => {}; invalidated(); };
}
