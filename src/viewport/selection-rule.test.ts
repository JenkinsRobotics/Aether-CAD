import { expect, it } from 'vitest';
import type { ConnectorCandidate } from '../aether-core';
import { resolveSelection } from './selection-rule';

const candidate = (id: string, kind: ConnectorCandidate['kind']) => ({ id, kind, faceId: 1, label: id, origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] }) as unknown as ConnectorCandidate;
const edgeA = candidate('edge-a', 'edge-midpoint'), edgeB = candidate('edge-b', 'edge-midpoint'), vertex = candidate('vertex-a', 'vertex');
const all = [edgeA, edgeB, vertex];

it('Auto: a vertex within 6 px, else the nearest edge within 12 px, else the face', () => {
  const by = (d: Record<string, number>) => (c: ConnectorCandidate) => d[c.id] ?? Infinity;
  expect(resolveSelection('auto', all, by({ 'vertex-a': 5, 'edge-a': 2 }))).toMatchObject({ kind: 'vertex', candidate: { id: 'vertex-a' } });
  expect(resolveSelection('auto', all, by({ 'vertex-a': 7, 'edge-a': 9, 'edge-b': 4 }))).toMatchObject({ kind: 'edge', candidate: { id: 'edge-b' } });
  expect(resolveSelection('auto', all, by({ 'vertex-a': 30, 'edge-a': 13 }))).toEqual({ kind: 'face' });
});
it('a window restriction narrows: edges only, faces only, vertices only', () => {
  const by = (d: Record<string, number>) => (c: ConnectorCandidate) => d[c.id] ?? Infinity;
  expect(resolveSelection('edge', all, by({ 'vertex-a': 1, 'edge-a': 10 }))).toMatchObject({ kind: 'edge', candidate: { id: 'edge-a' } });
  expect(resolveSelection('edge', all, by({ 'edge-a': 13 }))).toBeNull();
  expect(resolveSelection('face', all, by({ 'edge-a': 1 }))).toEqual({ kind: 'face' });
  expect(resolveSelection('vertex', all, by({ 'vertex-a': 8 }))).toMatchObject({ kind: 'vertex' });
  expect(resolveSelection('body', all, by({}))).toBeNull();
});
