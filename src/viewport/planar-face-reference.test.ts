import {expect,it} from 'vitest';
import type {FaceTopologyData} from '@aether/core/contracts';
import {anchorForPlanarFace,nativeFaceReference,planarFaceCandidates} from './planar-face-reference';
const face=(id:number,center:[number,number,number],area=100):FaceTopologyData=>({id,surfaceType:'PLANE',measurements:{areaSquareMillimeters:area},candidates:[{id:`face-${id}-center`,faceId:id,kind:'face-center',label:'Center',origin:center,zAxis:[0,0,1],xAxis:[1,0,0],yAxis:[0,1,0]}]});

it('disambiguates parallel and coplanar faces using native centroid and area',()=>{
 const topology=[face(10,[2.5,10,15]),face(-7,[7.5,10,10]),face(31,[20,10,15])];
 const anchor=anchorForPlanarFace(topology,-7)!;
 expect(anchor).toEqual({centerMillimeters:[7.5,10,10],areaSquareMillimeters:100});
 expect(planarFaceCandidates(topology,[0,0,1],anchor).map(c=>c.faceId)).toEqual([-7]);
 expect(planarFaceCandidates([...topology].reverse(),[0,0,1],anchor).map(c=>c.faceId)).toEqual([-7]);
 expect(planarFaceCandidates([face(-7,[7.5,10,12])],[0,0,1],anchor)).toEqual([]);
 expect(planarFaceCandidates([face(-7,[7.5,10,10],120)],[0,0,1],anchor)).toEqual([]);
});
it('keeps unique directions parametric and refuses missing metrics, curved faces or ambiguous anchors',()=>{
 expect(anchorForPlanarFace([face(1,[2,3,4])],1)).toBeUndefined();
 expect(anchorForPlanarFace([face(1,[2,3,4]),face(2,[2,3,4])],1)).toBeNull();
 const missing=face(1,[2,3,4]);delete missing.measurements;
 expect(anchorForPlanarFace([missing,face(2,[4,5,6])],1)).toBeNull();
 expect(anchorForPlanarFace([{...face(1,[2,3,4]),surfaceType:'CYLINDRE'}],1)).toBeNull();
});

it('anchors the top of a pocket even when its floor center is represented by a circle marker',()=>{
 const floor:FaceTopologyData={id:2,surfaceType:'PLANE',measurements:{areaSquareMillimeters:Math.PI*4,centerMillimeters:[0,0,5],planarNormal:[0,0,1]},candidates:[{id:'circle',faceId:2,kind:'circle-center',label:'Circle',origin:[0,0,5],zAxis:[0,0,1],xAxis:[1,0,0],yAxis:[0,1,0]}]};
 const topology=[face(1,[0,0,10],100-Math.PI*4),floor];
 expect(planarFaceCandidates(topology,[0,0,1]).map(c=>c.faceId)).toEqual([1,2]);
 const anchor=anchorForPlanarFace(topology,1)!;
 expect(anchor).toEqual({centerMillimeters:[0,0,10],areaSquareMillimeters:100-Math.PI*4});
 expect(planarFaceCandidates(topology,[0,0,1],anchor).map(c=>c.faceId)).toEqual([1]);
 expect(anchorForPlanarFace(topology,2)).toEqual({centerMillimeters:[0,0,5],areaSquareMillimeters:Math.PI*4});
});

it('references a curved face by its surface type, centre and area, and a plane by its normal',()=>{
 const cylinder:FaceTopologyData={id:3,surfaceType:'CYLINDER',measurements:{centerMillimeters:[1,2,3],areaSquareMillimeters:50,radiusMillimeters:5},candidates:[]};
 expect(nativeFaceReference([cylinder],cylinder)).toEqual({surfaceType:'cylinder',faceAnchor:{centerMillimeters:[1,2,3],areaSquareMillimeters:50}});
 expect(nativeFaceReference([cylinder],{...cylinder,surfaceType:'TORUS'})?.surfaceType).toBe('torus');
 expect(nativeFaceReference([cylinder],{...cylinder,measurements:{centerMillimeters:[1,2,3]}})).toBeNull();
 expect(nativeFaceReference([cylinder],{...cylinder,surfaceType:'UNAVAILABLE'})).toBeNull();
 const plane=face(10,[2.5,10,15]);
 expect(nativeFaceReference([plane],plane)).toEqual({normal:[0,0,1],centerMillimeters:[2.5,10,15]});
});
