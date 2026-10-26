import { Matrix4, Vector3 } from 'three';
import type { SectionCut, Vec3 } from './section-view-store';
/** Rotation is relative to the selected reference plane, never the camera. */
export function sectionFrame(cut: SectionCut) {
    const normal = new Vector3(...cut.plane.normal).normalize();
    const seed = Math.abs(normal.x) < .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const x = seed.addScaledVector(normal, -seed.dot(normal)).normalize();
    const y = normal.clone().cross(x).normalize();
    const basis = new Matrix4().makeBasis(x, y, normal);
    const [rx, ry] = cut.rotationDegrees ?? [0, 0];
    const rotation = new Matrix4().makeRotationY(ry * Math.PI / 180).multiply(new Matrix4().makeRotationX(rx * Math.PI / 180));
    const rotated = basis.clone().multiply(rotation);
    const n = new Vector3(0, 0, 1).transformDirection(rotated);
    const origin = new Vector3(...(cut.pivotMillimeters ?? cut.plane.originMillimeters));
    const point = origin.clone().addScaledVector(n, cut.offsetMillimeters);
    return { normal: n.toArray() as Vec3, origin: origin.toArray() as Vec3, point: point.toArray() as Vec3,
        x: new Vector3(1, 0, 0).transformDirection(rotated).toArray() as Vec3,
        y: new Vector3(0, 1, 0).transformDirection(rotated).toArray() as Vec3,
        rotationAxes: [new Vector3(1, 0, 0).transformDirection(basis.clone().multiply(new Matrix4().makeRotationY(ry * Math.PI / 180))).toArray(), y.toArray()] as [
            Vec3,
            Vec3
        ] };
}
export function moveSectionTo(_cut: SectionCut, point: Vec3): Partial<SectionCut> {
    if (!point.every(Number.isFinite))
        return {};
    return { pivotMillimeters: point, offsetMillimeters: 0 };
}
/** Keep the displayed origin fixed while changing the plane's orientation. */
export function rotateSection(cut: SectionCut, rotationDegrees: readonly [
    number,
    number
], pivot = sectionFrame(cut).point): Partial<SectionCut> {
    const normal = sectionFrame({ ...cut, rotationDegrees }).normal;
    return {
        rotationDegrees,
        pivotMillimeters: new Vector3(...pivot).addScaledVector(new Vector3(...normal), -cut.offsetMillimeters).toArray(),
    };
}
