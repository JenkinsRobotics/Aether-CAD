import { expect, it } from "vitest";
import { createEmptyPartDocument, validatePartDocument, type PartDocument } from "./part-document";
import { featureDependencies, removeFeature, moveFeature } from "./feature-history";
import { parsePartDocument, serializePartDocument } from "./part-serialization";

const document = (): PartDocument => ({...createEmptyPartDocument("Part"), features:[
  ...["a","b"].map(id=>({id,type:"profile" as const,name:id,plane:"XY" as const,offsetMillimeters:0,suppressed:false,profile:{type:"circle" as const,radiusMillimeters:2,centerMillimeters:[0,0] as [number,number]}})),
  {id:"e",type:"extrude",name:"Extrude",suppressed:false,profileFeatureId:"a",profileSelections:[{profileFeatureId:"a"},{profileFeatureId:"b"}],distanceMillimeters:5,operation:"new"},
]});
it("roundtrips all profile sources and treats each as a history prerequisite",()=>{
  const doc=document();
  expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
  expect(featureDependencies(doc).get("e")).toEqual(["a","b"]);
  expect(removeFeature(doc,"b").features.map(f=>f.id)).toEqual(["a", "e"]);
  expect(()=>moveFeature(doc,"e",-1)).toThrow();
});
it("rejects malformed, duplicate and empty source selections",()=>{
  for(const picks of [[],[{profileFeatureId:""}],[{profileFeatureId:"a"},{profileFeatureId:"a"}]]){
    const doc=document(); Object.assign(doc.features[2],{profileSelections:picks});
    expect(()=>validatePartDocument(doc)).toThrow();
  }
});
