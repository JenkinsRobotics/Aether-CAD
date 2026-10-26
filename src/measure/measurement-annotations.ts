import { Vector3 } from 'three';
import type { SelectedTopologyMeasurement } from '../viewport/topology-measurement';
import type { MeasurementAnnotation } from './measurement-overlay';

/** Radius/diameter witnesses lie in the actual analytic circular plane. */
export function radiusAnnotation(m: SelectedTopologyMeasurement, diameter = false): MeasurementAnnotation | undefined {
  if (!m.radiusMillimeters || !m.centerMillimeters || !m.axisDirection) return undefined;
  const center = new Vector3(...m.centerMillimeters), normal = new Vector3(...m.axisDirection).normalize();
  const radial = m.endpoints ? new Vector3(...m.endpoints[0]).sub(center) : Math.abs(normal.x) < .9 ? new Vector3(1,0,0) : new Vector3(0,1,0);
  radial.addScaledVector(normal,-radial.dot(normal));
  if (radial.length() < 1e-9) return undefined;
  radial.normalize().multiplyScalar(m.radiusMillimeters);
  return { points: [center.clone().addScaledVector(radial,diameter ? -1 : 0).toArray(),center.add(radial).toArray()] };
}
