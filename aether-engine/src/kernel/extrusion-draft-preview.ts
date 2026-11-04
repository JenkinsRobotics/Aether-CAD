import { makeFace, type Vector, type Wire } from 'replicad';
import type { PreviewHandle } from '../contracts/geometry';
import { add, cross, scale, unit, type V3 } from './vector';

function coordinates(vector: Vector): V3 {
  try { return [vector.x, vector.y, vector.z]; }
  finally { vector.delete(); }
}

/** Anchor draft at an actual profile boundary on the neutral sketch plane.
 * The oriented outer wire gives the material side even for concave profiles;
 * a centroid-to-edge estimate would point the wrong way in a concavity. */
export function extrusionDraftFrame(wire: Wire): { origin: V3; inward: V3 } {
  const face = makeFace(wire.clone());
  const outer = face.clone().outerWire();
  const edges = outer.edges;
  try {
    const edge = edges.reduce((longest, current) => current.length > longest.length ? current : longest);
    const origin = coordinates(edge.pointAt(.5));
    const tangent = scale(coordinates(edge.tangentAt(.5)), edge.orientation === 'forward' ? 1 : -1);
    return { origin, inward: unit(cross(coordinates(face.normalAt(origin)), tangent)) };
  } finally {
    edges.forEach(edge => edge.delete()); outer.delete(); face.delete();
  }
}

export function extrusionDraftHandle(frame: ReturnType<typeof extrusionDraftFrame>, options: {
  parameter: string; label: string; direction: V3; angle: number; radius: number;
}): PreviewHandle {
  // Dialog angles are magnitudes; widening is its separate reversal control.
  const intoMaterial = scale(frame.inward, options.angle < 0 ? -1 : 1);
  return {
    parameter: options.parameter, label: options.label, kind: 'angular',
    originMillimeters: frame.origin,
    direction: unit(cross(options.direction, intoMaterial)),
    startMillimeters: add(frame.origin, scale(options.direction, Math.max(1, options.radius))),
    stepDegrees: 1,
    screenRadius: true,
  };
}
