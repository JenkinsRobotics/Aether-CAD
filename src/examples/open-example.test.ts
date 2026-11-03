import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), describe: vi.fn(), release: vi.fn(), read: vi.fn() }));
vi.mock('../cad-assembly-bridge', () => ({ AssemblyBridgeClient: class {
  openWorkspace = mocks.open; describeAssembly = mocks.describe; release = mocks.release;
} }));
vi.mock('./catalog', () => ({ cadExample: () => ({assemblyId: 'main'}), readExample: mocks.read, base64: () => 'bytes' }));
import { openExample } from './open-example';
import { readAetherCAD } from '../document/aethercad-archive';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(Object.assign(new Blob(['archive']), {name: 'Example.aethercad'}));
  mocks.open.mockResolvedValue({handle: 'temporary'});
  mocks.describe.mockResolvedValue({workspace_id: 'workspace', part_definitions: [{id: 'part', name: 'Editable part', feature_document: {features: [{type: 'sketch'}]}}], assemblies: [{id: 'main', name: 'Main'}]});
});
it('lets the canonical controller open an assembly without a throwaway archive', async () => {
  const query = new URLSearchParams('example=test');
  const result = await openExample(query);
  expect(result.file.name).toBe('Example.aethercad');
  expect(result.project).toBeNull();
  expect(query.get('assembly')).toBe('main');
  expect(mocks.open).not.toHaveBeenCalled();
});
it('still resolves the exact native source for a direct Part link and releases its temporary archive', async () => {
  const result = await openExample(new URLSearchParams('example=test&part=part&assembly=configuration'));
  expect(result.file.name).toBe('Editable part.aethercad');
  const opened = readAetherCAD(new Uint8Array(await result.file.arrayBuffer()));
  expect(opened.kind).toBe('part');
  expect((opened.graph.part_definitions[0].feature_document as {features: unknown[]}).features).toEqual([{type: 'sketch'}]);
  expect(mocks.describe).toHaveBeenCalledWith('temporary', 'configuration');
  expect(mocks.release).toHaveBeenCalledWith('temporary');
});
