import { describe, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, insertFeature, validatePartDocument, type PartDocument } from '@aether/core/document';
import { type SketchDrawing } from '@aether/core/sketch';
import { sketchRegions } from '@aether/core/document';
import { stampProfileSelections } from '../features/regions';
import type { FeatureEditorContext } from '../features/shared';
import { pickSketchRegion } from '../sketch/picking';

export function connectedRectangle(): SketchDrawing {
  const points: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];
  return { type: 'drawing', contours: points.map((start, i) => ({ type: 'path', start, segments: [{ type: 'line', end: points[(i + 1) % 4] }] })), constraints: [
    ...points.map((_, i) => ({ id: `edge-${i}`, kind: i % 2 ? 'vertical' as const : 'horizontal' as const, a: { kind: 'line' as const, contour: i, index: 0 } })),
    ...points.map((_, i) => ({ id: `join-${i}`, kind: 'coincident' as const, a: { kind: 'point' as const, contour: i, index: 1 }, b: { kind: 'point' as const, contour: (i + 1) % 4, index: 0 } })),
    { id: 'anchor', kind: 'fix', a: { kind: 'point', contour: 0, index: 0 }, point: [0, 0] },
    { id: 'width', kind: 'length', a: { kind: 'line', contour: 0, index: 0 }, value: 20 },
    { id: 'height', kind: 'length', a: { kind: 'line', contour: 1, index: 0 }, value: 10 },
  ] };
}
function sourceDocument() {
  const doc = createEmptyPartDocument('Joined profiles');
  doc.features.push({ id: 's', type: 'profile', name: 'Sketch 1', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: connectedRectangle() });
  return doc;
}
function selected(doc = sourceDocument()) {
  const context = { doc } as FeatureEditorContext;
  const reference = stampProfileSelections(context, [{ featureId: 's', contourIndex: 0 }])[0];
  return { doc: context.doc, reference };
}
function extruded() {
  const { doc, reference } = selected();
  return insertFeature(doc, { id: 'e', type: 'extrude', name: 'Extrude', suppressed: false, ...reference,
    profileSelections: [reference], regionMode: 'faces', separateBodies: true, operation: 'new', distanceMillimeters: 6 });
}
const profile = (doc: PartDocument) => {
  const f = doc.features[0]; if (f.type !== 'profile' || f.profile.type !== 'drawing') throw Error(); return f;
};

describe('connected region selection and persistence', () => {
  it('offers one filled face and four individual curves, with one shared interior pick', () => {
    const doc = sourceDocument();
    expect(sketchRegions(doc.features[0])).toMatchObject([{ contourIndex: 0, sourceContourIndices: [0, 1, 2, 3] }]);
    expect(sketchRegions(doc.features[0], true)).toHaveLength(4);
    expect(sketchRegions(doc.features[0], true).every(r => !r.sourceContourIndices)).toBe(true);
    expect(pickSketchRegion(profile(doc).profile as SketchDrawing, [10, 5])).toBe(0);
    expect(pickSketchRegion(profile(doc).profile as SketchDrawing, [30, 5])).toBeNull();
  });
  it('stamps every contributor atomically, without replacing its geometry or constraints', () => {
    const doc = sourceDocument(), original = structuredClone(profile(doc).profile), { reference } = selected(doc);
    const current = profile(doc).profile as SketchDrawing;
    expect(reference.profileContourId).toBeUndefined(); expect(reference.profileRegion!.contourIds).toHaveLength(4);
    expect(new Set(current.contours.map(c => c.id))).toEqual(new Set(reference.profileRegion!.contourIds));
    expect(current.constraints).toEqual((original as SketchDrawing).constraints);
    current.contours.forEach((c, i) => expect(c).toMatchObject((original as SketchDrawing).contours[i]));
    expect(selected(doc).reference).toEqual(reference);
  });
  it('rolls back identity assignment when a later selection is invalid', () => {
    const doc = sourceDocument(), before = structuredClone(doc);
    expect(() => stampProfileSelections({doc} as FeatureEditorContext, [{ featureId: 's', contourIndex: 0 }, { featureId: 's', contourIndex: 99 }])).toThrow(/no longer/);
    expect(doc).toEqual(before);
  });
  it('rolls back malformed generated identities without changing any source', () => {
    const doc = sourceDocument(), before = structuredClone(doc), random = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000');
    try { expect(() => selected(doc)).toThrow(); expect(doc).toEqual(before); } finally { random.mockRestore(); }
  });
  it.each([{contourIds:['a']},{contourIds:['a','a']},{contourIds:['a',7]},{contourIds:['a','b'],unknown:true}])('rejects malformed saved group %j', invalid => {
    const doc = extruded(); (doc.features.at(-1) as any).profileRegion = invalid;
    expect(() => validatePartDocument(doc)).toThrow(/distinct/);
  });
  it('rejects duplicate selected groups independent of contributor order, and group/curve ambiguity', () => {
    const doc = extruded(), feature = doc.features.at(-1) as any;
    feature.profileSelections.push({...feature.profileSelections[0],profileRegion:{contourIds:[...feature.profileRegion.contourIds].reverse()}});
    expect(() => validatePartDocument(doc)).toThrow(/distinct/);
    feature.profileSelections.pop(); feature.profileContourId = feature.profileRegion.contourIds[0];
    expect(() => validatePartDocument(doc)).toThrow(/single-contour/);
  });
});
