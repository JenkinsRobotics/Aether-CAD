import { removeDrawingConstraint, editSketchSelection, type SketchDrawing, type SketchEntityRef } from '@aether/core/sketch';
import { cadCommands } from '../cad-command-registry';
import { fixedConstraintMatches } from '../../freecad-engine/browser/fixed-geometry';

export function mountSketchSelectionActions(o: {
  enabled(): boolean; drawing(): SketchDrawing; selected(): SketchEntityRef[];
  selectedConstraints?(): string[];
  construction(): boolean; setConstruction(value: boolean): void;
  commit(next: SketchDrawing): void; report(message: string): void; error(message: string): void;
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
  const registrations = [cadCommands.register('sketch-construction', toggle), cadCommands.register('sketch-delete', remove), cadCommands.register('sketch-unfix', unfix)];
  function refresh() {
    cadCommands.setEnabled('sketch-construction', o.enabled());
    cadCommands.setEnabled('sketch-delete', o.enabled() && (o.selected().length > 0 || (o.selectedConstraints?.().length ?? 0) > 0));
    cadCommands.setEnabled('sketch-unfix', o.enabled() && fixedSelection().length > 0);
    const refs = o.selected();
    cadCommands.setActive('sketch-construction', refs.length ? refs.every(r => o.drawing().contours[r.contour]?.construction) : o.construction());
  }
  return { remove, toggle, refresh, dispose() {
    registrations.forEach(dispose => dispose());
    cadCommands.setEnabled('sketch-construction', false); cadCommands.setActive('sketch-construction', false); cadCommands.setEnabled('sketch-delete', false);
    cadCommands.setEnabled('sketch-unfix', false);
  } };
}
