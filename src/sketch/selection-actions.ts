import { removeDrawingConstraint, editSketchSelection, setSketchInfinite, constrainRegularPolygon, chainSketchSelection, autoConstrainDrawing, sketchDrawingToDXF, looseEnds, type SketchDrawing, type SketchEntityRef } from '@aether/core/sketch';
import { cadCommands } from '../cad-command-registry';
import { fixedConstraintMatches } from '@aether/core/sketch/reference/fixed-geometry';

export function mountSketchSelectionActions(o: {
  enabled(): boolean; drawing(): SketchDrawing; selected(): SketchEntityRef[];
  selectedConstraints?(): string[];
  construction(): boolean; setConstruction(value: boolean): void;
  commit(next: SketchDrawing): void; report(message: string): void; error(message: string): void;
  select?(refs: SketchEntityRef[]): void; changePlane?(): void;
}) {
  const remove = () => {
    const ids = o.selectedConstraints?.() ?? [];
    if (!o.enabled() || (!o.selected().length && !ids.length)) return;
    try {
      o.commit(ids.length ? ids.reduce((drawing, id) => removeDrawingConstraint(drawing, id), o.drawing()) : editSketchSelection(o.drawing(), o.selected()));
      o.report(ids.length ? 'Selected dimensions and constraints removed.' : 'Selected sketch geometry deleted.');
    }
    catch (error) { o.error((error as Error).message); }
  };
  const toggle = () => {
    if (!o.enabled()) return;
    const refs = o.selected();
    if (!refs.length) { o.setConstruction(!o.construction()); refresh(); return; }
    const value = refs.some(ref => !o.drawing().contours[ref.contour]?.construction);
    try { o.commit(editSketchSelection(o.drawing(), refs, value)); o.report(value ? 'Selected geometry made construction.' : 'Selected geometry made regular.'); }
    catch (error) { o.error((error as Error).message); }
  };
  const infinite = () => {
    if (!o.enabled()) return;
    const refs = o.selected();
    if (!refs.length) { o.error('Select one or more single lines to make infinite.'); return; }
    try {
      const { drawing, changed, skipped } = setSketchInfinite(o.drawing(), refs);
      o.commit(drawing);
      o.report(`${changed} line${changed === 1 ? '' : 's'} toggled infinite${skipped ? `; ${skipped} other item${skipped === 1 ? '' : 's'} left alone` : ''}.`);
    }
    catch (error) { o.error((error as Error).message); }
  };
  const polygon = () => {
    if (!o.enabled()) return;
    const refs = o.selected();
    if (!refs.length) { o.error('Select the lines of a closed chain to make a regular polygon.'); return; }
    try {
      const { drawing, sides } = constrainRegularPolygon(o.drawing(), refs);
      o.commit(drawing);
      o.report(`Regular ${sides}-sided polygon: equal sides on one construction circle.`);
    }
    catch (error) { o.error((error as Error).message); }
  };
  const chain = () => {
    if (!o.enabled() || !o.select) return;
    try {
      const refs = chainSketchSelection(o.drawing(), o.selected());
      o.select(refs);
      o.report(`${refs.length} edge${refs.length === 1 ? '' : 's'} joined end to end selected.`);
    }
    catch (error) { o.error((error as Error).message); }
  };
  const fixedSelection = () => {
    const ids = new Set(o.selectedConstraints?.() ?? []);
    return (o.drawing().constraints ?? []).filter(c => c.kind === 'fix' &&
      (ids.has(c.id) || o.selected().some(ref => fixedConstraintMatches(o.drawing(), c, ref))));
  };
  const unfix = () => {
    if (!o.enabled()) return;
    try {
      const ids = fixedSelection().map(c => c.id);
      if (!ids.length) return;
      o.commit(ids.reduce((drawing,id) => removeDrawingConstraint(drawing,id), o.drawing()));
      o.report(`${ids.length} Fix ${ids.length === 1 ? 'constraint' : 'constraints'} removed. Other dimensions and relationships are retained.`);
    } catch (error) { o.error((error as Error).message); }
  };
  const autoConstrain = () => {
    if (!o.enabled()) return;
    try { const { drawing, added } = autoConstrainDrawing(o.drawing()); if (added) o.commit(drawing); o.report(added ? `${added} relations added (horizontal, vertical, coincident within tolerance).` : 'Nothing to constrain within tolerance.'); }
    catch (error) { o.error((error as Error).message); }
  };
  /** SolidCraft's Finish with AutoConstrain: the relations, then the sketch's own Finish. */
  const finishAutoConstrain = () => {
    if (!o.enabled()) return;
    autoConstrain();
    window.dispatchEvent(new CustomEvent('aether-sketch-finish'));
  };
  const exportDxf = () => {
    if (!o.enabled()) return;
    try {
      const url = URL.createObjectURL(new Blob([sketchDrawingToDXF(o.drawing())], { type: 'application/dxf' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'sketch.dxf'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      o.report('Sketch saved as DXF.');
    } catch (error) { o.error((error as Error).message); }
  };
  const findLooseEnds = () => {
    if (!o.enabled()) return;
    const ends = looseEnds(o.drawing());
    o.select?.(ends.map(e => e.ref));
    o.report(ends.length ? `${ends.length} loose ${ends.length === 1 ? 'end' : 'ends'} selected. AutoConstrain ties ends that nearly meet.` : 'No loose ends: every open path end meets another or is tied.');
  };
  const registrations = [cadCommands.register('sketch-construction', toggle), cadCommands.register('sketch-infinite', infinite), cadCommands.register('sketch-polygon-constraint', polygon), cadCommands.register('sketch-chain', chain), cadCommands.register('sketch-finish-auto-constrain', finishAutoConstrain), cadCommands.register('sketch-delete', remove), cadCommands.register('sketch-unfix', unfix), cadCommands.register('sketch-auto-constrain', autoConstrain), cadCommands.register('sketch-export-dxf', exportDxf), cadCommands.register('sketch-loose-ends', findLooseEnds), cadCommands.register('sketch-change-plane', () => { if (o.enabled()) o.changePlane?.(); })];
  function refresh() {
    cadCommands.setEnabled('sketch-construction', o.enabled());
    cadCommands.setEnabled('sketch-delete', o.enabled() && (o.selected().length > 0 || (o.selectedConstraints?.().length ?? 0) > 0));
    cadCommands.setEnabled('sketch-unfix', o.enabled() && fixedSelection().length > 0);
    cadCommands.setEnabled('sketch-auto-constrain', o.enabled()); cadCommands.setEnabled('sketch-finish-auto-constrain', o.enabled()); cadCommands.setEnabled('sketch-infinite', o.enabled() && o.selected().length > 0); cadCommands.setEnabled('sketch-polygon-constraint', o.enabled() && o.selected().length > 0); cadCommands.setEnabled('sketch-chain', o.enabled() && o.selected().length > 0 && !!o.select); cadCommands.setEnabled('sketch-export-dxf', o.enabled()); cadCommands.setEnabled('sketch-loose-ends', o.enabled()); cadCommands.setEnabled('sketch-change-plane', o.enabled());
    const refs = o.selected();
    cadCommands.setActive('sketch-construction', refs.length ? refs.every(r => o.drawing().contours[r.contour]?.construction) : o.construction());
  }
  return { remove, toggle, refresh, dispose() {
    registrations.forEach(dispose => dispose());
    cadCommands.setEnabled('sketch-construction', false); cadCommands.setActive('sketch-construction', false); cadCommands.setEnabled('sketch-delete', false);
    cadCommands.setEnabled('sketch-unfix', false); cadCommands.setEnabled('sketch-auto-constrain', false); cadCommands.setEnabled('sketch-finish-auto-constrain', false); cadCommands.setEnabled('sketch-infinite', false); cadCommands.setEnabled('sketch-polygon-constraint', false); cadCommands.setEnabled('sketch-chain', false); cadCommands.setEnabled('sketch-export-dxf', false); cadCommands.setEnabled('sketch-loose-ends', false); cadCommands.setEnabled('sketch-change-plane', false);
  } };
}
