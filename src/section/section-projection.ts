import { Box3, Raycaster, Vector2, Vector3, type Camera } from 'three/webgpu';
import { projectTransformGizmo } from '../viewport/transform-gizmo';
import { lineParameterNearestRay, type SectionCut } from './section-view-store';
import { sectionFrame } from './section-frame';
export function projectSection(cut: SectionCut, camera: Camera, rect: DOMRect, bounds: Box3) {
    if (!rect.width || !rect.height)
        return null;
    const frozen = camera.clone();
    frozen.updateMatrixWorld(true);
    const frame = sectionFrame(cut), normal = new Vector3(...frame.normal);
    const origin = new Vector3(...frame.origin);
    if (!cut.pivotMillimeters && !bounds.isEmpty()) {
        const center = bounds.getCenter(new Vector3());
        origin.copy(center).addScaledVector(normal, -center.clone().sub(new Vector3(...frame.origin)).dot(normal));
    }
    const at = origin.clone().addScaledVector(normal, cut.offsetMillimeters);
    const screen = (p: Vector3) => { const v = p.clone().project(frozen); return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2, z: v.z }; };
    const start = screen(at);
    if (start.z < -1 || start.z > 1)
        return null;
    const unit = screen(at.clone().add(normal)), pixels = Math.hypot(unit.x - start.x, unit.y - start.y);
    const end = screen(at.clone().addScaledVector(normal, pixels > 1e-6 ? 70 / pixels : 0));
    const ray = new Raycaster();
    const rotations = frame.rotationAxes.map((axis, index) => {
        const handles = projectTransformGizmo(frozen, rect, { frame: { centerMillimeters: at.toArray(), radiusMillimeters: 1 },
            transform: { kind: 'rotate', axisOriginMillimeters: at.toArray(), axisDirection: [...axis], angleDegrees: cut.rotationDegrees?.[index] ?? 0 }, uniform: false });
        const ring = handles.find(handle => handle.key === 'angle');
        return ring ? { ...ring, id: `rotate-${index}`, index } : null;
    });
    return { start, end, point: at.toArray(), rotations, valueAt: (x: number, y: number) => {
            ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), frozen);
            return lineParameterNearestRay(origin.toArray(), normal.toArray(), ray.ray.origin.toArray(), ray.ray.direction.toArray());
        } };
}
