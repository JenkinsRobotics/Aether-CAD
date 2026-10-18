import{expect,it}from'vitest';
import{readTransformPreviewFrame}from'./transform-preview-frame';
it('decodes the optional native frame without retaining mutable payload arrays',()=>{
 const v={center_mm:[1,2,3],radius_mm:10};const frame=readTransformPreviewFrame(v);v.center_mm[0]=20;expect(frame).toEqual({centerMillimeters:[1,2,3],radiusMillimeters:10});
});
it.each([undefined,null,{},[],{center_mm:[1,2],radius_mm:10},{center_mm:[1,2,Infinity],radius_mm:10},{center_mm:[1,2,3],radius_mm:NaN},{center_mm:[1,2,3],radius_mm:0},{center_mm:[1,2,3],radius_mm:1e10}])('ignores missing or unusable optional frame %#',v=>expect(readTransformPreviewFrame(v)).toBeUndefined());
it('validates and clones resolved reference coordinates',()=>{
 const v={center_mm:[1,2,3],radius_mm:10,resolved_transform:{kind:'rotate',axisOriginMillimeters:[4,5,6],axisDirection:[0,0,1],angleDegrees:20},reference_direction:[.6,.8,0]};
 const f=readTransformPreviewFrame(v)!;v.resolved_transform.axisOriginMillimeters[0]=99;v.reference_direction[0]=99;
 expect(f.resolvedTransform).toMatchObject({axisOriginMillimeters:[4,5,6]});expect(f.referenceDirection).toEqual([.6,.8,0]);
});
it.each([{resolved_transform:{kind:'copy'}},{resolved_transform:{kind:'translate',translationMillimeters:[0,0,Infinity]}},{reference_direction:[1,1,0]},{reference_direction:[0,0,0]}])('rejects invalid transient reference metadata %#',extra=>{
 expect(readTransformPreviewFrame({center_mm:[1,2,3],radius_mm:10,...extra})).toBeUndefined();
});
