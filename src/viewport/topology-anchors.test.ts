import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { ConnectorCandidate } from '../aether-core';
import { anchorSelection, anchorWorldPoint, TopologyAnchorPicker, type AnchorPart } from './topology-anchors';
import { projectScreenPoint } from './picking-math';
import { selectedCandidateId } from './topology-selection';
const size = { width: 800, height: 800 };
const candidate = (id: string, kind: ConnectorCandidate['kind'], origin: [number, number, number]): ConnectorCandidate => ({
  id, kind, origin, faceId: 4, label: id, xAxis: [1,0,0], yAxis: [0,1,0], zAxis: [0,0,1],
});
function box(id = 'part:body'): AnchorPart {
  const surface = new Mesh(new BoxGeometry(2,2,2), new MeshBasicMaterial());
  surface.userData.partId = id;
  const group = new Group(); group.add(surface);
  return { data: { id, name: id }, group, surface,
    faceRanges: Array.from({ length: 6 }, (_, faceId) => ({ start: faceId * 6, count: 6, faceId })),
    topology: new Map([[4, { id: 4, surfaceType: 'PLANE', candidates: [
      candidate('corner', 'vertex', [1,1,1]), candidate('midpoint','edge-midpoint',[1,0,1]),
      candidate('center','face-center',[0,0,1]),
    ] }]]) };
}
function camera() {
  const camera = new OrthographicCamera(-4,4,4,-4,.1,100);
  camera.position.set(0,0,10); camera.lookAt(0,0,0); camera.updateMatrixWorld(); return camera;
}

it('reveals a face cloud and snaps exact corners and midpoints even outside the silhouette', () => {
  const part = box(), view = camera(), picker = new TopologyAnchorPicker();
  const hover = picker.pick([part], view, size, { x:450,y:450 });
  expect(hover.anchors.map(a => a.candidate.kind)).toEqual(['vertex','edge-midpoint','face-center']);
  expect(hover.snapped).toBeNull();
  expect(picker.pick([part],view,size,{x:506,y:294}).snapped?.candidate.id).toBe('corner');
  expect(picker.pick([part],view,size,{x:506,y:400}).snapped?.candidate.id).toBe('midpoint');
  expect(picker.pick([part],view,size,{x:400,y:400}).snapped?.candidate.id).toBe('center');
  expect(picker.pick([part],view,size,{x:525,y:400}).anchors).toEqual([]);
  picker.clear();
  expect(picker.pick([part],view,size,{x:506,y:294}).snapped?.candidate.id).toBe('corner');
});

it('uses a pixel tolerance across zoom levels and perspective, not a model-space radius', () => {
  const part = box(), view = new PerspectiveCamera(50,1,.1,1000);
  for (const z of [8,24,80]) {
    view.position.set(0,0,z); view.lookAt(0,0,0); view.updateMatrixWorld();
    const at = projectScreenPoint(new Vector3(1,1,1),view,size)!;
    const picker = new TopologyAnchorPicker();
    expect(picker.pick([part],view,size,{x:at.x+7,y:at.y-7}).snapped?.candidate.id).toBe('corner');
    expect(picker.pick([part],view,size,{x:at.x+16,y:at.y-16}).snapped).toBeNull();
  }
});

it('measures transformed assembly occurrences and keeps shared-corner identity across faces', () => {
  const part = box(), view = camera();
  part.group.rotation.z = Math.PI/2; part.group.position.set(2,0,1);
  const duplicate = { ...candidate('other-face-corner','vertex',[1,1,1]), faceId: 0 };
  part.topology.set(0, { id:0, surfaceType:'PLANE', candidates:[duplicate] });
  const anchor = { part, faceId:4, candidate:part.topology.get(4)!.candidates[0] };
  const world = anchorWorldPoint(anchor);
  expect(world.toArray().map(value=>Math.round(value))).toEqual([1,1,2]);
  const at = projectScreenPoint(world,view,size)!;
  const picked = new TopologyAnchorPicker().pick([part],view,size,{x:at.x+2,y:at.y+2}).snapped!;
  expect(anchorWorldPoint(picked).distanceTo(world)).toBeLessThan(1e-8);
  expect(anchorSelection(anchor).id).toBe(anchorSelection({part,faceId:0,candidate:duplicate}).id);
  expect(selectedCandidateId(anchorSelection(anchor))).toBe('corner');
  const second = box('second');
  expect(anchorSelection({...anchor,part:second}).id).not.toBe(anchorSelection(anchor).id);
});

it('excludes hidden, section-clipped and occluded points, including unrelated analytic centers', () => {
  const part = box(), view = camera(), picker = new TopologyAnchorPicker();
  part.group.visible = false;
  expect(picker.pick([part],view,size,{x:400,y:400}).anchors).toEqual([]);
  part.group.visible = true;
  expect(picker.pick([part],view,size,{x:400,y:400},()=>true).anchors).toEqual([]);
  const cover = box('cover'); cover.group.position.z = 4; cover.topology.clear();
  expect(picker.pick([part,cover],view,size,{x:400,y:400}).snapped).toBeNull();
  part.topology.get(4)!.candidates = [candidate('axis','cylinder-axis',[0,0,0])];
  expect(picker.pick([part,cover],view,size,{x:400,y:400}).anchors).toEqual([]);
  expect(picker.pick([part],view,size,{x:400,y:400}).snapped?.candidate.kind).toBe('cylinder-axis');
  part.topology.get(4)!.candidates = [candidate('back-corner','vertex',[0,0,-1])];
  expect(picker.pick([part],view,size,{x:400,y:400}).anchors).toEqual([]);
});

it('preserves the analytic frame for connector/mate placement while measurement uses its origin', () => {
  const part = box(), view = camera();
  for (const kind of ['circle-center','ellipse-center','cylinder-axis','cone-axis','sphere-center','torus-center'] as const) {
    const exact = candidate('analytic',kind,[0,0,0]);
    exact.xAxis = [0,1,0]; exact.yAxis = [0,0,1]; exact.zAxis = [1,0,0];
    part.topology.get(4)!.candidates = [exact];
    const pick = new TopologyAnchorPicker().pick([part],view,size,{x:400,y:400});
    expect(pick.snapped?.candidate).toBe(exact);
    expect(anchorWorldPoint(pick.snapped!).toArray()).toEqual([0,0,0]);
  }
});
