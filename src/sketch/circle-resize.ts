import { solveDrawingConstraints, validateSketchDrawing, type SketchDrawing, type SketchPoint } from '@aether/core/sketch';
/** A perimeter gesture supplies temporary solver targets; authored relations stay intact. */
export function resizeCircleFromPointer(source: SketchDrawing, contour: number, start: SketchPoint, pointer: SketchPoint): SketchDrawing {
  const circle = source.contours[contour];
  if (circle?.type !== 'circle') throw Error('Select a circle perimeter.');
  const distance = (p: SketchPoint) => Math.hypot(p[0] - circle.center[0], p[1] - circle.center[1]);
  const radius = circle.radius + distance(pointer) - distance(start);
  if (!Number.isFinite(radius) || radius <= 1e-6) throw Error('The circle radius must remain positive.');
  const next = structuredClone(source);
  (next.contours[contour] as typeof circle).radius = radius;
  const radiusId = crypto.randomUUID(), centerId = crypto.randomUUID();
  next.constraints = [...(next.constraints ?? []),
    { id: radiusId, kind: 'radius', a: { contour, kind: 'circle' }, value: radius },
    { id: centerId, kind: 'fix', a: { contour, kind: 'point', index: 0 }, point: [...circle.center] },
  ];
  const solved = solveDrawingConstraints(next);
  const actual = solved.contours[contour];
  if (actual.type !== 'circle' || Math.abs(actual.radius - radius) > 1e-5 || Math.hypot(actual.center[0] - circle.center[0], actual.center[1] - circle.center[1]) > 1e-5)
    throw Error('Existing constraints control this circle. Edit or remove its dimension to resize it.');
  solved.constraints = source.constraints === undefined ? undefined : solved.constraints?.filter(c => c.id !== radiusId && c.id !== centerId);
  validateSketchDrawing(solved);
  return solved;
}
