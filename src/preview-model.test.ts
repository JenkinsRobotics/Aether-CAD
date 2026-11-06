import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ evaluate: vi.fn(async () => ({ parts: [{ id: 'body' }] })), describe: vi.fn(), release: vi.fn(), bodies: vi.fn(async (_projection: unknown, _placements: unknown, _deps: unknown) => ['assembly']) }));
vi.mock('./engine/evaluate-part', () => ({ evaluatePart: mocks.evaluate }));
vi.mock('./cad-assembly-bridge', () => ({ AssemblyBridgeClient: class {
  openWorkspace = async () => ({ handle: 'isolated', root_assembly_id: 'root' });
  describeAssembly = mocks.describe; release = mocks.release;
} }));
vi.mock('./startup/assembly-solve', () => ({ bodiesForPlacements: mocks.bodies }));
import { previewBodies } from './preview-model';
import { emptyGraph, partGraph, writeAetherCAD } from './document/aethercad-archive';
import fixture from '../service/tests/fixtures/automation-part.part.json';
it('renders the same native Part from JSON and its archive', async () => {
  const json = JSON.stringify(fixture);
  const archive = new TextDecoder().decode(writeAetherCAD(partGraph(fixture)));
  expect(await previewBodies(json)).toEqual(await previewBodies(archive));
  expect(mocks.evaluate).toHaveBeenCalledTimes(2);
});
it('renders the requested assembly with canonical solved placements, never the first Part', async () => {
  const graph = emptyGraph('Design', 'design'); graph.assemblies = [{ id: 'root' }, { id: 'child' }]; graph.instances = [{}];
  mocks.describe.mockResolvedValue({ instances: [{ id: 'instance', solved_world_transform: { position_m: [1, 2, 3], rotation_quaternion_xyzw: [0, 0, 0, 1] } }] });
  expect(await previewBodies(JSON.stringify({ graph, previewAssemblyId: 'child' }))).toEqual(['assembly']);
  expect(mocks.describe).toHaveBeenLastCalledWith('isolated', 'child');
  expect(mocks.bodies.mock.calls.at(-1)?.[1]).toEqual([{ id: 'instance', placement_mm: [1000, 2000, 3000], rotation: [0, 0, 0, 1] }]);
  expect(mocks.release).toHaveBeenCalledWith('isolated');
  await previewBodies(new TextDecoder().decode(writeAetherCAD(graph)));
  expect(mocks.describe).toHaveBeenLastCalledWith('isolated', 'root');
});
