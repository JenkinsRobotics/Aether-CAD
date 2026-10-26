import { expect, it } from 'vitest';
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { projectSection } from './section-projection';
import { orbitArrow } from './section-orbits';
import { sectionFrame, rotateSection } from './section-frame';
import type { SectionCut } from './section-view-store';

it.each(['perspective', 'orthographic'])('keeps the arrow tips on the same %s orbit used for dragging', kind => {
  const camera = kind === 'perspective' ? new PerspectiveCamera(45, 1, .1, 1000) : new OrthographicCamera(-35,35,35,-35,.1,1000);
  camera.position.set(60,-80,70); camera.up.set(0,0,1); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
  const cut: SectionCut = {id:'test',plane:{label:'Top',originMillimeters:[0,0,0],normal:[0,0,1]},offsetMillimeters:4,rotationDegrees:[23,31],pivotMillimeters:[2,3,4]};
  const projection = projectSection(cut,camera,{left:50,top:100,width:700,height:700} as DOMRect,new Box3())!;
  expect(projection.rotations.filter(Boolean)).toHaveLength(2);
  for (const ring of projection.rotations) {
    expect(ring).not.toBeNull();
    const orbit=ring!.orbit!, points=orbitArrow(orbit);
    // Both arrow tips are exact points on the projected circle (not tangent
    // approximations or a screen-facing glyph). A 35° drag yields 35°.
    for (const tip of [points[0],points[20]]) {
      const angle = ring!.valueAt(tip.x,tip.y)!;
      const back = orbit.pointAt(angle);
      expect(Math.hypot(back.x-tip.x,back.y-tip.y)).toBeLessThan(1e-7);
    }
    const a=orbit.pointAt(orbit.angle), b=orbit.pointAt(orbit.angle+35);
    const delta=((ring!.valueAt(b.x,b.y)!-ring!.valueAt(a.x,a.y)!+540)%360)-180;
    expect(delta).toBeCloseTo(35);
    const angles:[number,number]=[...cut.rotationDegrees!]; angles[ring!.index]+=delta;
    const next={...cut,...rotateSection(cut,angles,projection.point)};
    expect(new Vector3(...sectionFrame(next).point).distanceTo(new Vector3(...projection.point))).toBeLessThan(1e-9);
  }
});
