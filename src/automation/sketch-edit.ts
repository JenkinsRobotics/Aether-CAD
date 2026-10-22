/** Existing-sketch adapters reuse the editor operations and retain feature IDs. */
import { validatePartDocument, type PartDocument } from '@aether/core/document';
import { moveSketchContours, similarityTransform, editDrawingDimension, rectangleSketchRevision, reviseCenterRectangleSketch } from '@aether/core/sketch';

function sketch(doc:PartDocument,id:unknown) {
  const feature=doc.features.find(feature=>feature.id===id);
  if(!feature||(feature.type!=='profile'&&feature.type!=='sketch'))throw Error('Inspect the Part and choose an existing sketch feature_id.');
  return feature;
}
const finite=(value:unknown,name:string)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e6)throw Error(`${name} must be finite and within 1000000.`);
  return value;
};
export function inspectSketch(doc:PartDocument,args:Record<string,unknown>) {
  const feature=sketch(doc,args.feature_id),offset=args.offset??0,limit=args.limit??10;
  if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>25)throw Error('Use offset >= 0 and limit 1–25.');
  const profile=feature.profile;
  const drawing=profile.type==='drawing'?profile:profile.type==='projection'?profile.authored:undefined;
  return {document_id:doc.documentId,feature_id:feature.id,name:feature.name,feature_type:feature.type,plane:feature.plane,suppressed:feature.suppressed,units:'millimeter',
    ...(feature.type==='profile'?{offset_mm:feature.offsetMillimeters,frame:feature.frame,support:feature.support}:{}),
    profile:drawing?{type:profile.type,total_contours:drawing.contours.length,total_constraints:drawing.constraints?.length??0,
      contours:drawing.contours.slice(offset,offset+limit).map((contour,i)=>({index:offset+i,...contour})),
      constraints:(drawing.constraints??[]).slice(offset,offset+limit),
      next_offset:offset+limit<Math.max(drawing.contours.length,drawing.constraints?.length??0)?offset+limit:null}:profile,
    ...(feature.type==='sketch'?{constraints:feature.constraints,dimensions:feature.dimensions}:{}),
    dependents:doc.features.filter(f=>'profileFeatureId' in f&&f.profileFeatureId===feature.id).map(f=>({id:f.id,name:f.name,type:f.type})),
    editing:profile.type==='projection'?'Projected geometry is read-only; edit its source sketch.':'Translate preserves constraints and identities; fixed or external anchors may reject. Dimension edits use the existing solver. Coordinates are local to the sketch plane; the plane is not moved.'};
}
export function editSketch(doc:PartDocument,name:string,args:Record<string,unknown>) {
  const next=structuredClone(doc),feature=sketch(next,args.feature_id);
  if(feature.suppressed)throw Error('Unsuppress this sketch before editing it.');
  const profile=feature.profile;
  if(name==='aether_cad_sketch_translate') {
    const dx=finite(args.dx_mm,'dx_mm'),dy=finite(args.dy_mm,'dy_mm');
    if(feature.type==='sketch') {
      if((dx!==0||dy!==0)&&feature.constraints.some(c=>c.type==='coincident-origin'))throw Error('The sketch center is constrained to the origin. It cannot translate without changing that constraint.');
      feature.profile.centerXMillimeters+=dx;feature.profile.centerYMillimeters+=dy;
    }else if(profile.type==='circle')profile.centerMillimeters=[profile.centerMillimeters[0]+dx,profile.centerMillimeters[1]+dy];
    else if(profile.type==='polygon')profile.pointsMillimeters=profile.pointsMillimeters.map(([x,y])=>[x+dx,y+dy]);
    else if(profile.type==='drawing')feature.profile=moveSketchContours(profile,profile.contours.map((_,i)=>i),similarityTransform([0,0],[dx,dy],0));
    else throw Error('This sketch type cannot translate directly. Projected geometry must be edited at its source.');
  }else {
    const value=finite(args.value,'value');
    if(typeof args.dimension_id!=='string')throw Error('Choose dimension_id from sketch_inspect.');
    if(feature.type==='sketch') {
      const dimension=feature.dimensions.find(d=>d.id===args.dimension_id);
      if(!dimension)throw Error('Choose an existing dimension_id.');
      feature.profile=reviseCenterRectangleSketch(feature,{...rectangleSketchRevision(feature),[dimension.type==='width'?'widthMillimeters':'heightMillimeters']:value}).profile;
      dimension.valueMillimeters=value;
    }else if(profile.type==='drawing') {
      const dimension=profile.constraints?.find(c=>c.id===args.dimension_id);
      if(!dimension||dimension.value===undefined||dimension.reference)throw Error('Choose an editable driving dimension from sketch_inspect.');
      feature.profile=editDrawingDimension(profile,args.dimension_id,value);
    }else throw Error('This sketch has no driving dimensions.');
  }
  validatePartDocument(next);
  return {document:next,featureID:feature.id};
}
