import type { DrawingConstraintKind, SketchDrawing, SketchEntityRef } from '@aether/core/sketch';
import { constrainSketchSelection, selectedConstraintReady } from './constraint-selection';
import { sketchConstraintEntry } from './constraint-catalog';

/** Transient tool-first picking. Geometry and relationships still belong to the
 * canonical drawing; one successful set is one ordinary sketch transaction. */
export function createConstraintTool(o: {
  drawing(): SketchDrawing;
  options(): Parameters<typeof constrainSketchSelection>[3];
  commit(drawing: SketchDrawing): void;
  select(refs: readonly SketchEntityRef[]): void;
  report(text: string): void;
  changed(kind: DrawingConstraintKind | null): void;
}) {
  let kind: DrawingConstraintKind | null = null;
  let targets: SketchEntityRef[] = [];
  const label = () => sketchConstraintEntry(kind ?? '')?.label ?? kind;
  const prompt = () => {
    if (!kind) return '';
    const next = kind === 'symmetric'
      ? ['Select the first entity.', 'Select its matching entity.', 'Select the symmetry line.'][targets.length]
      : kind === 'horizontal' || kind === 'vertical'
        ? targets.length ? 'Select another point.' : 'Select a line or two points.'
        : kind === 'fix' ? 'Select a point or curve to fix its position and size.'
          : targets.length ? 'Select the second entity.' : 'Select the first entity.';
    return `${label()}: ${next} Escape or the same tool exits.`;
  };
  const clear = () => { targets = []; o.select(targets); };
  const cancel = () => {
    if (!kind) return;
    kind = null; clear(); o.changed(null);
  };
  return {
    active: () => kind !== null,
    kind: () => kind,
    prompt,
    begin(next: DrawingConstraintKind, initial: readonly SketchEntityRef[] = []) {
      kind = next; targets = [...initial]; o.changed(kind);
      o.select(targets); o.report(prompt());
    },
    cancel,
    reset() { if (kind) { clear(); o.report(prompt()); } },
    pick(ref: SketchEntityRef | null) {
      if (!kind) return false;
      if (!ref) { clear(); o.report(prompt()); return true; }
      const key = JSON.stringify(ref);
      const duplicate = targets.findIndex(target => JSON.stringify(target) === key);
      if (duplicate >= 0) {
        targets.splice(duplicate, 1); o.select(targets); o.report(prompt()); return true;
      }
      const candidate = [...targets, ref];
      if (!selectedConstraintReady(kind, candidate)) {
        targets = candidate; o.select(targets); o.report(prompt()); return true;
      }
      try {
        const result = constrainSketchSelection(o.drawing(), kind, candidate, o.options());
        if (result.added) o.commit(result.drawing);
        clear();
        o.report(`${label()} ${result.added ? 'applied.' : 'already exists.'} ${prompt()}`);
      } catch (error) {
        // Keep the preceding picks so another second entity/axis can replace
        // the rejected pick. Never retain a partially solved candidate.
        o.select(targets); o.report(`${(error as Error).message} ${prompt()}`);
      }
      return true;
    },
  };
}
