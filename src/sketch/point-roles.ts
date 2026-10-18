import { contourClosed, type SketchDrawing, type SketchEntityRef } from '@aether/core/sketch';

const same = (a: SketchEntityRef | undefined, b: SketchEntityRef) => a?.contour === b.contour && a.kind === b.kind && a.index === b.index && a.control === b.control;

/** Presentation only: derive node names from the saved relationships, never IDs
 * or a second geometry model. Removing a relationship also removes its label. */
export function sketchPointRole(drawing: SketchDrawing, ref: SketchEntityRef): string | undefined {
  if (ref.kind !== 'point' || ref.control !== undefined || ref.projectedContourId) return;
  const contour = drawing.contours[ref.contour];
  if (!contour) return;
  if (contour.type === 'circle') return 'Center';
  if (contour.segments.length) return 'Endpoint';
  for (const c of drawing.constraints ?? []) {
    if (c.reference) continue;
    const other = same(c.a, ref) ? c.b : same(c.b, ref) ? c.a : undefined;
    if (!other) continue;
    if (c.kind === 'concentric' && ['arc', 'ellipse', 'circle'].includes(other.kind))
      return other.kind === 'arc' ? 'Arc center' : other.kind === 'ellipse' ? 'Ellipse center' : 'Center';
    if (c.kind !== 'midpoint' || other.kind !== 'line') continue;
    const diagonal = drawing.contours[other.contour];
    if (diagonal?.type !== 'path' || !diagonal.construction || diagonal.segments.length !== 1) return 'Midpoint';
    const links = [0, 1].map(index => {
      const endpoint: SketchEntityRef = { contour: other.contour, kind: 'point', index };
      return drawing.constraints?.flatMap(link => link.kind !== 'coincident' || link.reference ? [] : same(link.a, endpoint) && link.b ? [link.b] : same(link.b, endpoint) ? [link.a] : []) ?? [];
    });
    if (links[0].some(a => links[1].some(b => {
      const path = drawing.contours[a.contour];
      return a.kind === 'point' && b.kind === 'point' && a.contour === b.contour &&
        Math.abs((a.index ?? 0) - (b.index ?? 0)) === 2 && path?.type === 'path' &&
        path.segments.length === 4 && path.segments.every(s => s.type === 'line') && contourClosed(path);
    }))) return 'Rectangle center';
    return 'Midpoint';
  }
  return 'Point';
}

export function sketchNodeLabel(drawing: SketchDrawing, ref: SketchEntityRef, fallback: string) {
  const role = sketchPointRole(drawing, ref);
  return role && role !== 'Endpoint' ? `${ref.contour + 1}: ${role}` : fallback;
}
