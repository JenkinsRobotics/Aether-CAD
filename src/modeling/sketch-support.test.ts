import { describe, expect, it } from "vitest";
import { bodyIDsForFeature, createEmptyPartDocument, createRectanglePartDocument, insertFeature, dependentFeatures, parsePartDocument, serializePartDocument } from "@aether/core/document";
import { resolveSketchFrames, supportForFace } from "./sketch-support";
import { translateDocument } from "../freecad-translate";
const frame = {originMillimeters: [10,10,12] as [number,number,number], normal: [0,0,1] as [number,number,number], xDirection: [1,0,0] as [number,number,number]};
function fixture() {
  let doc = insertFeature(createEmptyPartDocument("Attached"), {id:"s",name:"Base sketch",type:"profile",plane:"XY",offsetMillimeters:0,suppressed:false,profile:{type:"polygon",pointsMillimeters:[[0,0],[20,0],[20,20],[0,20]]}});
  doc = insertFeature(doc,{id:"pad",name:"Base",type:"extrude",operation:"new",bodyId:"block",profileFeatureId:"s",distanceMillimeters:12,suppressed:false});
  const support = supportForFace(doc,"block",frame,"Body 1 · top face");
  expect(support?.sourceFeatureId).toBe("pad");
  return insertFeature(doc,{id:"hole",name:"Hole sketch",type:"profile",plane:"XY",offsetMillimeters:0,suppressed:false,frame,support,profile:{type:"circle",radiusMillimeters:2,centerMillimeters:[0,0]}});
}
it("saves support and resolves native frames without mutating the input", () => {
  const doc = parsePartDocument(serializePartDocument(fixture()));
  const next = resolveSketchFrames(doc,{hole:{...frame,originMillimeters:[10,10,42]}});
  expect(next.features[2]).toMatchObject({frame:{originMillimeters:[10,10,42]},support:{sourceFeatureId:"pad",bodyId:"block"}});
  expect(doc.features[2]).toMatchObject({frame});
  expect(dependentFeatures(doc,"pad").has("hole")).toBe(true);
  expect(translateDocument(doc).features.at(-1)?.parameters).toMatchObject({source_profile_id:"hole",support:{sourceFeatureId:"pad",bodyId:"block"}});
});
it("refuses absent or invalid native frames instead of retaining stale geometry", () => {
  const doc=fixture();
  expect(()=>resolveSketchFrames(doc)).toThrow(/not resolved/);
  expect(()=>resolveSketchFrames(doc,{unknown:frame})).toThrow(/unknown/);
  expect(()=>resolveSketchFrames(doc,{hole:{...frame,normal:[0,0,0]}})).toThrow(/frame/);
});
it('preserves exact support anchors through native serialization and rejects malformed anchors',()=>{
 const doc=fixture(),profile=doc.features[2] as import('@aether/core/document').ProfileFeature;
 const faceAnchor={centerMillimeters:[10,10,12] as [number,number,number],areaSquareMillimeters:400};
 profile.support!.faceAnchor=faceAnchor;
 const saved=parsePartDocument(serializePartDocument(doc));
 expect(translateDocument(saved).features.at(-1)?.parameters.support).toMatchObject({faceAnchor});
 profile.support!.faceAnchor={...faceAnchor,centerMillimeters:[0,NaN,0]};
 expect(()=>serializePartDocument(doc)).toThrow(/anchor/);
});

describe("what a face reference is called", () => {
  it("names the feature that made the face, the way Onshape does", () => {
    // "Face of Extrude 1" — not "Body 1 · planar face · attached". A
    // reference is an identity; describing it tells a reader nothing about
    // which face it points at.
    const document = createRectanglePartDocument("Bracket", {
      widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20,
    });
    const extrude = document.features.find((feature) => feature.type === "extrude")!;
    const bodyId = bodyIDsForFeature(document, extrude).at(-1)!;
    const support = supportForFace(
      document,
      bodyId,
      { originMillimeters: [0, 0, 20], xDirection: [1, 0, 0], normal: [0, 0, 1] },
      `Face 3 of ${extrude.name}`,
    );
    expect(support?.label).toBe(`Face of ${extrude.name}`);
    expect(support?.label).not.toMatch(/·/);
    expect(support?.label).not.toMatch(/attached|planar face/);
  });

  it("still carries the identity the engine matches on", () => {
    // The label is for reading; the source feature and body are what a saved
    // reference resolves against.
    const document = createRectanglePartDocument("Bracket", {
      widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20,
    });
    const extrude = document.features.find((feature) => feature.type === "extrude")!;
    const bodyId = bodyIDsForFeature(document, extrude).at(-1)!;
    const support = supportForFace(
      document, bodyId,
      { originMillimeters: [0, 0, 20], xDirection: [1, 0, 0], normal: [0, 0, 1] },
      "Face 3",
    );
    expect(support?.sourceFeatureId).toBe(extrude.id);
    expect(support?.bodyId).toBe(bodyId);
  });
});
