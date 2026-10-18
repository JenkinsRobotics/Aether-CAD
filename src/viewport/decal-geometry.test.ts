import {expect,it} from 'vitest';
import {decalGeometry} from './decal-geometry';
import type {PartGeometryData} from '../domain';
import type {ImageCanvas} from '@aether/core/document';
const part={vertices:new Float32Array([-10,-10,0,10,-10,0,10,10,0,-10,10,0]),triangles:new Uint32Array([0,1,2,0,2,3]),faceRanges:[{faceId:1,start:0,count:6}],topology:[{id:1,surfaceType:'PLANE',candidates:[{id:'center',kind:'face-center',origin:[0,0,0],zAxis:[0,0,1]}]}]} as unknown as PartGeometryData;
const canvas:ImageCanvas={id:'image',name:'Image',dataUrl:'data:image/png;base64,YQ==',plane:'XY',widthMillimeters:8,heightMillimeters:4,xMillimeters:0,yMillimeters:0,offsetMillimeters:0,rotationDegrees:0,opacity:1,visible:true,face:{bodyId:'body',normal:[0,0,1]}};
it('clips tessellated face geometry to the image rectangle with exact UVs',()=>{
 const geometry=decalGeometry(canvas,part)!;geometry.computeBoundingBox();expect(geometry.boundingBox!.min.toArray()).toEqual([-4,-2,0]);expect(geometry.boundingBox!.max.toArray()).toEqual([4,2,0]);
 const uv=geometry.getAttribute('uv');for(let i=0;i<uv.count;i++){expect(uv.getX(i)).toBeGreaterThanOrEqual(0);expect(uv.getX(i)).toBeLessThanOrEqual(1);expect(uv.getY(i)).toBeGreaterThanOrEqual(0);expect(uv.getY(i)).toBeLessThanOrEqual(1);}geometry.dispose();
});
it('moves and rotates placement on the real face',()=>{const geometry=decalGeometry({...canvas,xMillimeters:3,rotationDegrees:90},part)!;geometry.computeBoundingBox();expect(geometry.boundingBox!.min.x).toBeCloseTo(1);expect(geometry.boundingBox!.max.x).toBeCloseTo(5);expect(geometry.boundingBox!.max.y).toBeCloseTo(4);});
it('refuses missing or ambiguous face references rather than projecting onto a different face',()=>{expect(decalGeometry({...canvas,face:{bodyId:'body',normal:[1,0,0]}},part)).toBeNull();expect(decalGeometry(canvas,{...part,topology:[...part.topology,...part.topology]})).toBeNull();});
