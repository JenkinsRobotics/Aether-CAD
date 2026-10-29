import { expect, it, vi } from 'vitest';
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, Vector3, Matrix4 } from 'three/webgpu';
import { MateViewport } from '../viewer';
function fixture() {
  const viewer = Object.create(MateViewport.prototype) as any;
  const root = new Group(), group = new Group(), geometry = new BoxGeometry(10, 20, 5), material = new MeshBasicMaterial();
  group.add(new Mesh(geometry, material));
  // Matches addPart: placement is stored directly in matrix, not position.
  group.matrixAutoUpdate = false;
  group.matrix.makeRotationZ(Math.PI / 2).setPosition(3, 4, 5);
  root.add(group); root.updateMatrixWorld(true);
  viewer.parts = new Map([['part', { group }]]); viewer.manipulatorPreview = [];
  viewer.section = { refreshPlacement: vi.fn() };
  return { viewer: viewer as MateViewport, root, group, geometry, material, original: group.matrix.clone() };
}
const world = (group: Group) => new Vector3(1, 0, 0).applyMatrix4(group.matrixWorld);
it('updates the actual render matrix each frame from the captured pose and restores it on cancel', () => {
  const f = fixture();
  f.viewer.previewManipulatorTransform(['part'], { kind: 'translate', translationMillimeters: [5, 0, 0] }, false);
  expect(world(f.group).distanceTo(new Vector3(8, 5, 5))).toBeLessThan(1e-8);
  f.viewer.previewManipulatorTransform(['part'], { kind: 'translate', translationMillimeters: [7, 0, 0] }, false);
  expect(world(f.group).distanceTo(new Vector3(10, 5, 5))).toBeLessThan(1e-8);
  f.viewer.clearManipulatorPreview(); expect(f.group.matrix).toEqual(f.original);
  expect(world(f.group).distanceTo(new Vector3(3, 5, 5))).toBeLessThan(1e-8);
});
it('Copy preview leaves the source matrix intact and releases only its temporary node', () => {
  const f = fixture(), dispose = vi.spyOn(f.geometry, 'dispose');
  f.viewer.previewManipulatorTransform(['part'], { kind: 'translate', translationMillimeters: [5, 0, 0] }, true);
  expect(f.root.children).toHaveLength(2); expect(f.group.matrix).toEqual(f.original);
  expect(world(f.root.children[1] as Group).distanceTo(new Vector3(8, 5, 5))).toBeLessThan(1e-8);
  f.viewer.clearManipulatorPreview(); expect(f.root.children).toEqual([f.group]); expect(dispose).not.toHaveBeenCalled();
});
it('rotates the original oriented geometry around the chosen world pivot', () => {
  const f = fixture();
  f.viewer.previewManipulatorTransform(['part'], { kind: 'rotate', axisOriginMillimeters: [3, 4, 0], axisDirection: [0, 1, 0], angleDegrees: 90 }, false);
  expect(world(f.group).distanceTo(new Vector3(8, 5, 0))).toBeLessThan(1e-8);
  f.viewer.clearManipulatorPreview(); expect(f.group.matrix).toEqual(f.original);
});
it('accepting a preview preserves the newly uploaded canonical placement', () => {
  const f = fixture();
  f.viewer.previewManipulatorTransform(['part'], { kind: 'translate', translationMillimeters: [5, 0, 0] }, false);
  const canonical = new Matrix4().makeTranslation(8, 4, 5).multiply(new Matrix4().makeRotationZ(Math.PI / 2));
  f.group.matrix.copy(canonical); f.group.updateMatrixWorld(true);
  f.viewer.clearManipulatorPreview(false);
  expect(f.group.matrix).toEqual(canonical);
  expect(world(f.group).distanceTo(new Vector3(8, 5, 5))).toBeLessThan(1e-8);
});

it('a canonical update supersedes a drag; later cancellation cannot restore stale geometry', () => {
  const f = fixture(), viewer = f.viewer as any;
  const data = { id: 'part', name: 'Part', sourceDocumentId: 'definition' };
  viewer.parts.get('part').data = data;
  viewer.assemblyPreviewIDs = new Set(['part']);
  viewer.initialMatrices = new Map();
  viewer.resetFaceMaterials = vi.fn(); viewer.publishGeometryMetrics = vi.fn(); viewer.callbacks = { onStateChanged: vi.fn() };
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  try {
    f.viewer.previewManipulatorTransform(['part'], { kind: 'translate', translationMillimeters: [5, 0, 0] }, false);
    f.viewer.replaceAssemblyBodies([{ data: data as any, positionMillimeters: [100, 0, 0], quaternion: [0, 0, 0, 1] }]);
    f.viewer.clearManipulatorPreview();
    expect(world(f.group).distanceTo(new Vector3(101, 0, 0))).toBeLessThan(1e-8);
    expect(viewer.initialMatrices.get('part')).toEqual(f.group.matrix);
  } finally { vi.unstubAllGlobals(); }
});
