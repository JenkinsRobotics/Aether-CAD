import {expect,it} from 'vitest';
import {cadVectorContour,cadVectorPath,importedVectorContours,vectorBooleanCopy} from './vector-adapter';
const rect=(x:number,y:number,w:number)=>({points:[[x,y],[x+w,y],[x+w,y+w],[x,y+w]] as [number,number][],closed:true});
it('creates independent Boolean copies without changing source identities/constraints',()=>{
 const contours=[cadVectorContour(rect(0,0,100)),cadVectorContour(rect(25,25,50))],drawing={type:'drawing' as const,contours},snapshot=structuredClone(drawing),result=vectorBooleanCopy(drawing,[0,1],'difference',.01);
 expect(drawing).toEqual(snapshot);expect(result.contours.slice(0,2)).toEqual(contours);expect(result.contours.slice(2).map(c=>c.hole)).toEqual([false,true]);expect(new Set(result.contours.map(c=>c.id)).size).toBe(4);
});
it('retains imported cubic contours and applies evenodd/nonzero nesting',()=>{
 const paths=[rect(0,0,100),rect(25,25,50)];expect(importedVectorContours(paths,'evenodd').map(c=>c.hole)).toEqual([false,true]);expect(importedVectorContours(paths,'nonzero')).toHaveLength(1);
 paths[1].points.reverse();expect(importedVectorContours(paths,'nonzero').map(c=>c.hole)).toEqual([false,true]);
 const curved={...rect(0,0,10),curves:[{c1:[1,2] as [number,number],c2:[9,2] as [number,number]},null,null,null]};expect(cadVectorPath(cadVectorContour(curved)).curves![0]).toEqual(curved.curves[0]);
});
it('does not polygonize native CAD conics or allow ambiguous compound imports',()=>{
 expect(()=>cadVectorPath({type:'circle',center:[0,0],radius:10})).toThrow(/analytic/);
 expect(()=>importedVectorContours([rect(0,0,10),rect(5,0,10)],'evenodd')).toThrow(/Touching|intersecting/);
});
