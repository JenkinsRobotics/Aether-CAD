import { describe, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, insertFeature, parsePartDocument, serializePartDocument, validatePartDocument, type PartDocument, type PartFeature } from '@aether/core/document';
import { solveDrawingConstraints, type SketchDrawing } from '@aether/core/sketch';
import { sketchRegions, translateDocument } from '../freecad-translate';
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

describe('connected region selection, persistence and feature translation', () => {
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
  it('writes Part19, reopens the same group and translates linked original native wires', () => {
    const doc = extruded(), saved = serializePartDocument(doc), reopened = parsePartDocument(saved);
    expect(JSON.parse(saved).formatVersion).toBe(21); expect(reopened).toEqual(doc);
    const translated = translateDocument(reopened);
    expect(translated.complete).toBe(true); expect(translated.features.map(f => f.kind)).toEqual(['sketch-wire', 'sketch-wire', 'sketch-wire', 'sketch-wire', 'sketch-region', 'pad']);
    expect(translated.features[4].parameters.profiles).toEqual(translated.features.slice(0, 4).map(f => f.id));
    expect(translated.features[5].parameters.profile).toBe(translated.features[4].id);
  });
  it('keeps the referenced face and output key after source reorder', () => {
    const doc = extruded(), before = translateDocument(doc).features.at(-1)!.parameters;
    const drawing = profile(doc).profile as SketchDrawing;
    drawing.contours.reverse();
    for (const c of drawing.constraints ?? []) for (const ref of [c.a, c.b]) if (ref) ref.contour = 3 - ref.contour;
    const rebuilt = translateDocument(parsePartDocument(serializePartDocument(doc)));
    expect(rebuilt.complete).toBe(true);
    expect(Object.values(rebuilt.features.at(-1)!.parameters.profile_keys as object)).toEqual(Object.values(before.profile_keys as object));
  });
  it('retains the connected face when a driving width changes through the canonical solver', () => {
    const doc = extruded(), sketch = profile(doc), drawing = structuredClone(sketch.profile) as SketchDrawing;
    const identities = [...(doc.features.at(-1) as any).profileRegion.contourIds];
    drawing.constraints!.find(c => c.id === 'width')!.value = 32;
    sketch.profile = solveDrawingConstraints(drawing);
    const rebuilt = translateDocument(parsePartDocument(serializePartDocument(doc)));
    expect(rebuilt.complete).toBe(true);
    const bottom = rebuilt.features[0].parameters.segments as {end: number[]}[];
    expect(bottom[0].end[0]).toBeCloseTo(32, 6);
    expect((doc.features.at(-1) as any).profileRegion.contourIds).toEqual(identities);
  });
  it.each(['missing', 'open', 'branch'] as const)('keeps a %s group as a repairable feature failure without selecting another loop', change => {
    const doc = extruded(), drawing = profile(doc).profile as SketchDrawing;
    drawing.constraints = [];
    if (change === 'missing') drawing.contours[1].id = 'replacement';
    if (change === 'open' && drawing.contours[1].type === 'path') drawing.contours[1].start = [21, 0];
    if (change === 'branch') drawing.contours.push({type:'path',start:[0,0],segments:[{type:'line',end:[-3,0]}]});
    const rebuilt = translateDocument(parsePartDocument(serializePartDocument(doc)));
    expect(rebuilt.complete).toBe(false); expect(rebuilt.untranslated).toContainEqual(expect.objectContaining({id:'e',reason:expect.stringMatching(/same closed region/)}));
    expect(rebuilt.features.some(f => f.kind === 'pad')).toBe(false);
  });
  it.each(['revolve', 'sweep', 'loft'] as const)('translates a persisted joined profile in %s', kind => {
    const { doc, reference } = selected();
    let feature: PartFeature;
    if (kind === 'revolve') feature = {id:'solid',type:kind,name:kind,suppressed:false,...reference,operation:'new',axis:'X',angleDegrees:90};
    else if (kind === 'sweep') {
      doc.features.push({id:'path',type:'profile',name:'Path',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'spine',type:'path',start:[0,0],segments:[{type:'line',end:[0,20]}]}]}});
      feature = {id:'solid',type:kind,name:kind,suppressed:false,...reference,operation:'new',pathFeatureId:'path',pathContourId:'spine'};
    } else {
      const top = structuredClone(doc.features[0]); top.id = 'top'; if (top.type === 'profile') top.offsetMillimeters = 20; doc.features.push(top);
      feature = {id:'solid',type:kind,name:kind,suppressed:false,operation:'new',ruled:false,sections:[reference,{...reference,profileFeatureId:'top'}]};
    }
    const result = translateDocument(parsePartDocument(serializePartDocument(insertFeature(doc, feature))));
    expect(result.complete).toBe(true); expect(result.features.at(-1)!.kind).toBe(kind);
  });
  it('keeps Thin selection on one raw curve even when that curve bounds a joined face', () => {
    const doc = sourceDocument(), context = {doc} as FeatureEditorContext;
    const [selection] = stampProfileSelections(context, [{featureId:'s',contourIndex:0}], true);
    expect(selection.profileRegion).toBeUndefined(); expect(selection.profileContourId).toBeTruthy();
    const part = insertFeature(doc, {id:'wall',type:'extrude',name:'Wall',suppressed:false,...selection,profileSelections:[selection],operation:'new',distanceMillimeters:6,regionMode:'faces',thin:{thickness1Millimeters:1,thickness2Millimeters:0}});
    const job = translateDocument(part); expect(job.complete).toBe(true);
    expect(job.features.at(-1)!.parameters.profile).toBe('s#0');
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
