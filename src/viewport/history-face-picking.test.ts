import {expect,it} from 'vitest';
import {Raycaster,Vector3} from 'three/webgpu';
import type {ImportedModelData,PartGeometryData} from '../domain';
import {FeaturePreviewLayer} from '../modeling/feature-preview-layer';
import type {ConnectorCandidate} from '../aether-core';
import {pickHistoryFace} from './history-face-picking';

it('picks exact face ranges on visible earlier geometry and refuses hidden history',()=>{
 const part:PartGeometryData={id:'part:before',name:'Earlier part',sourceDocumentId:'doc',sourceName:'Part',vertices:new Float32Array([0,0,10,2,0,10,0,2,10,0,0,15,2,0,15,0,2,15]),normals:new Float32Array(18).fill(0),triangles:new Uint32Array([0,1,2,3,4,5]),edgeLines:new Float32Array(),faceRanges:[{faceId:50,start:0,count:3},{faceId:-90,start:3,count:3}],topology:[{id:50,surfaceType:'PLANE',candidates:[]},{id:-90,surfaceType:'PLANE',candidates:[]}]};
 const model:ImportedModelData={sourceName:'Earlier',parseMilliseconds:0,parts:[part]};
 const layer=new FeaturePreviewLayer();layer.set(model,false);
 const ray=new Raycaster(new Vector3(.5,.5,20),new Vector3(0,0,-1));
 expect(pickHistoryFace(ray,layer.group,model)?.item).toMatchObject({id:'face:part:before:-90',partId:'part:before',faceId:-90,label:'Face 2 of Earlier part'});
 layer.group.visible=false;expect(pickHistoryFace(ray,layer.group,model)).toBeNull();
 expect(pickHistoryFace(ray,layer.group,model,undefined,true)?.item.faceId).toBe(-90);
 layer.group.visible=true;expect(pickHistoryFace(ray,layer.group,null)).toBeNull();
 layer.set(null);expect(pickHistoryFace(ray,layer.group,model)).toBeNull();
});

it('picks nearby exact edges and vertices on earlier history geometry',()=>{
 const candidate:ConnectorCandidate={faceId:1,id:'edge',kind:'edge-midpoint',label:'Straight edge',origin:[10,0,10],xAxis:[1,0,0],yAxis:[0,1,0],zAxis:[0,0,1],measurements:{linearDirection:[1,0,0],lengthMillimeters:20}};
 const vertex:ConnectorCandidate={...candidate,id:'vertex',kind:'vertex',label:'Vertex',origin:[0,0,10],measurements:undefined};
 const part={id:'p',name:'Earlier',sourceDocumentId:'doc',sourceName:'Part',vertices:new Float32Array([0,0,10,20,0,10,0,20,10]),normals:new Float32Array(9),triangles:new Uint32Array([0,1,2]),edgeLines:new Float32Array(),faceRanges:[{faceId:1,start:0,count:3}],topology:[{id:1,surfaceType:'PLANE',candidates:[candidate,vertex]}]} as PartGeometryData;
 const model:ImportedModelData={sourceName:'Earlier',parseMilliseconds:0,parts:[part]},layer=new FeaturePreviewLayer();layer.set(model,false);
 const ray=new Raycaster(new Vector3(.1,.1,20),new Vector3(0,0,-1));
 const project=(p:Vector3)=>({x:p.x*10,y:p.y*10});
 expect(pickHistoryFace(ray,layer.group,model,{kind:'edge',point:{x:1,y:1},project})?.item.id).toBe('edge:p:edge');
 expect(pickHistoryFace(ray,layer.group,model,{kind:'vertex',point:{x:1,y:1},project})?.item.id).toBe('vertex:p:vertex');
 expect(pickHistoryFace(ray,layer.group,model,{kind:'edge',point:{x:1,y:50},project})).toBeNull();
 layer.set(null);
});
