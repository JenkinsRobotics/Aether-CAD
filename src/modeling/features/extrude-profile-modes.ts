import type { SketchRegion } from '@aether/core/document';

export type ExtrudeProfilePick = { featureId: string; contourIndex: number };
type Mode = 'faces' | 'curves';
type Choices = (featureId: string, curves: boolean) => SketchRegion[];
const unique = (picks: ExtrudeProfilePick[]) => [...new Map(picks.map(p => [JSON.stringify([p.featureId, p.contourIndex]), p])).values()];

/** Faces and authored curves have different index spaces. Keep an exact return
 * selection until the user changes it; a manual edit retires the old handoff
 * and the other mode's snapshot, including when the new selection is empty. */
export class ExtrudeProfileModes {
  private mode: Mode;
  private snapshots = new Map<Mode, ExtrudeProfilePick[]>();
  private wholeSketch: string | undefined;

  constructor(curves: boolean, initial: ExtrudeProfilePick[], private choices: Choices) {
    this.mode = curves ? 'curves' : 'faces';
    this.snapshots.set(this.mode, initial);
  }

  replace(picks: ExtrudeProfilePick[]): ExtrudeProfilePick[] {
    this.wholeSketch = undefined;
    this.snapshots.clear();
    const selected = unique(picks);
    this.snapshots.set(this.mode, selected);
    return selected;
  }

  seedWholeSketch(featureId: string): ExtrudeProfilePick[] {
    this.wholeSketch = featureId;
    this.snapshots.clear();
    const selected = this.all(featureId, this.mode);
    this.snapshots.set(this.mode, selected);
    return selected;
  }

  switchTo(curves: boolean): ExtrudeProfilePick[] {
    const next: Mode = curves ? 'curves' : 'faces';
    const current = this.snapshots.get(this.mode) ?? [];
    if (next === this.mode) return current;
    const selected = this.wholeSketch ? this.all(this.wholeSketch, next)
      : this.snapshots.get(next) ?? this.convert(current, next);
    this.mode = next;
    this.snapshots.set(next, selected);
    return selected;
  }

  private all(featureId: string, mode: Mode): ExtrudeProfilePick[] {
    return this.choices(featureId, mode === 'curves').map(r => ({ featureId, contourIndex: r.contourIndex }));
  }

  private convert(selected: ExtrudeProfilePick[], next: Mode): ExtrudeProfilePick[] {
    const converted: ExtrudeProfilePick[] = [];
    for (const featureId of new Set(selected.map(p => p.featureId))) {
      const indices = new Set(selected.filter(p => p.featureId === featureId).map(p => p.contourIndex));
      const faces = this.choices(featureId, false);
      const curves = this.choices(featureId, true);
      for (const face of faces) {
        // An arrangement cell may contain only part of an authored curve. Do
        // not silently widen that region into the entire intersecting contour.
        // Its exact selection remains available when returning to Solid.
        if (face.cell) continue;
        const boundary = face.sourceContourIndices ?? [face.contourIndex];
        if (next === 'curves' && indices.has(face.contourIndex)) {
          converted.push(...curves.filter(r => boundary.includes(r.contourIndex)).map(r => ({ featureId, contourIndex: r.contourIndex })));
        } else if (next === 'faces' && boundary.every(i => indices.has(i))) {
          converted.push({ featureId, contourIndex: face.contourIndex });
        }
      }
    }
    return unique(converted);
  }
}
