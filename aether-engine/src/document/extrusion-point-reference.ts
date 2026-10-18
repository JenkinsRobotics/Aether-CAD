/** Native incident geometry; never a transient display vertex index. */
export interface SolidVertexAnchor {
  positionMillimeters: [number, number, number];
  signature: string;
  /** Refusal guard against symmetric corner permutations, not a selector. */
  incidence: string;
  shapeFingerprint: string;
}
export type ExtrusionPointReference = {
  kind: 'sketch-point'; sourceFeatureId: string; contourId: string;
  point: 'vertex' | 'center'; vertexId?: string; label: string;
} | {
  kind: 'solid-vertex'; sourceFeatureId: string; bodyId: string;
  anchor: SolidVertexAnchor; label: string;
};

export function validateExtrusionPointReference(ref: ExtrusionPointReference | undefined,
  earlier: ReadonlyMap<string,string>, missing: (id:string)=>boolean) {
  const id=(v:unknown,max=128)=>typeof v==='string'&&!!v.trim()&&v.length<=max;
  if(!ref||!id(ref.sourceFeatureId)||!id(ref.label,512)||(!earlier.has(ref.sourceFeatureId)&&!missing(ref.sourceFeatureId)))
    throw Error('Up to vertex needs a point in earlier history.');
  if(ref.kind==='sketch-point'){
    if((!missing(ref.sourceFeatureId)&&earlier.get(ref.sourceFeatureId)!=='profile')||!id(ref.contourId)||
      !['vertex','center'].includes(ref.point)||(ref.point==='vertex'?!id(ref.vertexId):ref.vertexId!==undefined))
      throw Error('Invalid stopping sketch point reference.');
  } else if(ref.kind==='solid-vertex'){
    const a=ref.anchor;
    if(!id(ref.bodyId,256)||['profile','sketch','plane'].includes(earlier.get(ref.sourceFeatureId)??'')||!a||
      !Array.isArray(a.positionMillimeters)||a.positionMillimeters.length!==3||!a.positionMillimeters.every(Number.isFinite)||
      !id(a.signature,16384)||!id(a.incidence,16384)||typeof a.shapeFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(a.shapeFingerprint))
      throw Error('Invalid stopping solid vertex anchor.');
  } else throw Error('Unsupported stopping point reference.');
}
