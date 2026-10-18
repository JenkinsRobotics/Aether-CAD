import {bodyIDsForFeature,consumedBodyIDs,scopeConsumedBodies,rollbackPosition,validatePartDocument,validateExtrusionScopeResolution,type ExtrusionScopeResolution,type PartDocument} from '@aether/core/document';
/** Publish only a complete successful native scope evaluation. */
export function resolveExtrusionScopes(doc:PartDocument,scopes:Record<string,ExtrusionScopeResolution>={}):PartDocument {
 const active=new Set(doc.features.slice(0,rollbackPosition(doc)).filter(f=>f.type==='extrude'&&f.scopeMode==='all'&&!f.suppressed).map(f=>f.id));
 if(Object.keys(scopes).some(id=>!active.has(id)))throw Error('Rebuild returned an unknown automatic extrusion scope.');
 const available=new Set<string>();
 const next={...doc,features:doc.features.map(feature=>{
  // Body IDs are already resolved by the preceding output projection. Track
  // history here so a forged response cannot absorb a later or unrelated ID.
  if(!feature.suppressed&&'operation' in feature&&feature.operation==='new'){
   // IDs are collected through the existing canonical producer helper below.
   bodyIDsForFeature(doc,feature).forEach(id=>available.add(id));
  }
  if(!active.has(feature.id)){
   consumedBodyIDs(feature).forEach(id=>available.delete(id));return feature;
  }
  const resolution=scopes[feature.id];
  if(!resolution)throw Error(`${feature.name}: rebuild did not resolve the automatic scope.`);
  validateExtrusionScopeResolution(resolution);
  if(resolution.targets.some(id=>!available.has(id)))throw Error(`${feature.name}: rebuild returned an unavailable scope part.`);
  if(feature.type==='extrude'&&feature.operation==='add'&&resolution.groups.flatMap(g=>g.sources).length!==resolution.targets.length)throw Error('Add cannot discard source parts.');
  if(feature.type==='extrude'&&feature.operation!=='add'&&resolution.groups.some(g=>g.sources.length!==1))throw Error('Only Add can merge part identities.');
  if(feature.type==='extrude'&&feature.operation==='intersect'&&resolution.groups.length!==resolution.targets.length)throw Error('Intersect scope must retain overlapping parts.');
  scopeConsumedBodies(resolution).forEach(id=>available.delete(id));
  return {...feature,scopeResolution:structuredClone(resolution)};
 })};
 validatePartDocument(next);return next;
}
