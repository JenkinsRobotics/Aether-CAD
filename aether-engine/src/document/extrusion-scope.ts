/** Native output projection; never an input to automatic scope evaluation. */
export interface ExtrusionScopeResolution {
 targets:string[];
 groups:{bodyId:string;sources:string[]}[];
}
export function validateExtrusionScopeResolution(value:ExtrusionScopeResolution):void {
 const ids=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=4096&&v.every(id=>typeof id==='string'&&!!id.trim()&&id.length<=512)&&new Set(v).size===v.length;
 if(!value||!ids(value.targets)||!value.targets.length||!Array.isArray(value.groups)||value.groups.length>value.targets.length)throw Error('Invalid automatic extrusion scope resolution.');
 const used=new Set<string>();
 for(const group of value.groups){
  if(!group||!ids(group.sources)||!group.sources.length||group.bodyId!==group.sources[0]||group.sources.some(id=>!value.targets.includes(id)||used.has(id)))throw Error('Invalid automatic extrusion scope group.');
  group.sources.forEach(id=>used.add(id));
 }
}
export function scopeConsumedBodies(resolution?:ExtrusionScopeResolution):string[]{
 return resolution?.targets.filter(id=>!resolution.groups.some(group=>group.bodyId===id))??[];
}
