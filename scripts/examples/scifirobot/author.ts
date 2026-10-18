/** CAD-owned, dimensioned reconstruction of Aether's original Scifirobot artwork.
 * Millimetres; +Y is up to match the authored studio asset. No UI evaluator.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PART_DOCUMENT_VERSION, validatePartDocument, type PartDocument, type PartFeature, type ProfileFeature } from '../../../aether-engine/src/document/part-document';
import { translateDocument } from '../../../src/freecad-translate';

const features: PartFeature[] = [];
const bodies: {id:string; name:string; color:string}[] = [];
const ownership: Record<string,string> = {};
const add = (body:string, feature:PartFeature) => { features.push(feature); ownership[feature.id]=body; return feature.id; };
function profile(body:string, name:string, geometry:ProfileFeature['profile'], plane:'XY'|'XZ'|'YZ'='XY', offset=0, frame?:ProfileFeature['frame']) {
  return add(body,{id:`${body}-sketch-${features.length+1}`,type:'profile',name:`Sketch · ${name}`,plane,offsetMillimeters:offset,suppressed:false,profile:geometry,...(frame?{frame}:{})});
}
function body(id:string,name:string,color='#c6c9c7') { bodies.push({id,name,color});return id; }
function circle(id:string,name:string,radius:number,center:[number,number],offset:number,depth:number,plane:'XY'|'XZ'|'YZ'='XY',inner=0,operation:'new'|'add'='new') {
  const sketch=profile(id,name,{type:'circle',radiusMillimeters:radius,centerMillimeters:center},plane,offset);
  add(id,{id:`${id}-extrude-${features.length+1}`,type:'extrude',name:`Extrude · ${name}`,profileFeatureId:sketch,distanceMillimeters:depth,operation,...(operation==='new'?{bodyId:id}:{targetBodyId:id}),suppressed:false});
  if(inner) { const bore=profile(id,`${name} bore`,{type:'circle',radiusMillimeters:inner,centerMillimeters:center},plane,offset+depth); add(id,{id:`${id}-cut-${features.length+1}`,type:'extrude',name:`Extrude cut · ${name}`,profileFeatureId:bore,distanceMillimeters:depth,operation:'cut',targetBodyId:id,suppressed:false}); }
}
function revolve(id:string,name:string,geometry:ProfileFeature['profile']) {
  const sketch=profile(id,name,geometry,'XZ');
  add(id,{id:`${id}-revolve`,type:'revolve',name:`Revolve · ${name}`,profileFeatureId:sketch,axis:'Z',angleDegrees:360,operation:'new',bodyId:id,suppressed:false});
}
function finish(id:string,type:'fillet'|'chamfer',radius:number,plane:'XY'|'XZ'|'YZ',offset:number) {
  add(id,{id:`${id}-${type}`,type,name:`${type==='fillet'?'Fillet':'Chamfer'} · ${bodies.find(b=>b.id===id)!.name}`,targetBodyId:id,radiusMillimeters:radius,edgePlane:{plane,offsetMillimeters:offset},suppressed:false});
}
// Closed meridian with two exact circular arcs: a hollow shell with an optical opening.
const polar=(r:number,a:number):[number,number]=>[r*Math.sin(a),r*Math.cos(a)];
const a=.72, mid=(a+Math.PI)/2;
revolve(body('shell','Outer shell'),'Shell section',{type:'drawing',contours:[{type:'path',start:polar(1420,a),segments:[
  {type:'arc',middle:polar(1420,mid),end:[0,-1420]}, {type:'line',end:[0,-1392]},
  {type:'arc',middle:polar(1392,mid),end:polar(1392,a)}, {type:'line',end:polar(1420,a)},
]}]});
circle(body('lens','Optical housing','#151a1c'),'Optical housing',940,[0,0],1055,150);
circle('lens','Optical seat',690,[0,0],1205,100,'XY',0,'add');
circle(body('bezel','Lens bezel','#aebbbd'),'Lens bezel',950,[0,0],1195,75,'XY',895);
finish('bezel','fillet',20,'XY',1270);
revolve(body('glass','Optical glass','#192125'),'Lens crown',{type:'drawing',contours:[{type:'path',start:[0,1460],segments:[{type:'arc',middle:[325,1418],end:[460,1310]},{type:'line',end:[0,1310]},{type:'line',end:[0,1460]}]}]});
circle(body('lens-trim','Lens retaining ring','#aebbbd'),'Lens retaining ring',465,[0,0],1320,35,'XY',438);
for(let i=0;i<8;i++) { const angle=i*Math.PI/4;circle(body(`optic-bolt-${i+1}`,`Optical fastener ${i+1}`,'#aebbbd'),'Optical fastener',25,[Math.cos(angle)*810,Math.sin(angle)*810],1200,55); }
for(const side of [-1,1]) {
  const id=body(side<0?'hub':'hub-right',`${side<0?'Left':'Right'} drive`);
  // A stepped profile revolved around X would need a placement transform; stepped pads
  // retain the same solid and expose directly editable radii and lengths instead.
  const start=side<0?-1350:1110;
  circle(id,'Drive housing',690,[-60,0],start,240,'YZ');
  circle(id,'Drive cap',590,[-60,0],side<0?start-160:start+240,160,'YZ',0,'add');
  circle(id,'Drive face',440,[-60,0],side<0?start-240:start+400,80,'YZ',0,'add');
}
for(const side of [-1,1]) for(let i=0;i<3;i++) {
  const id=body(side<0&&i===0?'vents':`tube-${side<0?'left':'right'}-${i+1}`,`${side<0?'Left':'Right'} cooling tube ${i+1}`,'#737e80');
  circle(id,'Tube section',90,[side*1050,-250+i*230],595,630,'XY',62);
  finish(id,'chamfer',5,'XY',1225);
}
for(const x of [-630,630]) for(const y of [-960,960]) {
  const id=body(`sensor-${x}-${y}`,`${y>0?'Upper':'Lower'} ${x<0?'left':'right'} sensor`,'#192125');
  circle(id,'Sensor lens',150,[x,y],770,100);
  finish(id,'fillet',40,'XY',870);
}
circle(body('seams','Equatorial seam','#303739'),'Equatorial seam',1427,[0,0],-8,16,'YZ',1417);
circle(body('grille','Top vent surround','#aebbbd'),'Vent surround',320,[0,-50],-1420,40,'XZ',285);
circle(body('grille-insert','Top vent insert','#192125'),'Vent insert',285,[0,-50],-1415,20,'XZ');
for(let i=-4;i<=4;i++) {
  const x=i*60, half=Math.sqrt(280**2-x**2),id=body(`grille-bar-${i+4}`,`Grille slat ${i+5}`);
  const sketch=profile(id,'Grille slat',{type:'polygon',pointsMillimeters:[[x-13,-50-half],[x+13,-50-half],[x+13,-50+half],[x-13,-50+half]]},'XZ',-1435);
  add(id,{id:`${id}-extrude`,type:'extrude',name:'Extrude · Grille slat',profileFeatureId:sketch,distanceMillimeters:25,operation:'new',bodyId:id,suppressed:false});
}
circle(body('antenna','Antenna mast','#aebbbd'),'Antenna mast',35,[-780,-250],-1530,550,'XZ');
circle(body('antenna-cap','Antenna cap','#192125'),'Antenna cap',75,[-780,-250],-1605,110,'XZ');
finish('antenna-cap','fillet',40,'XZ',1605);

const counts:Record<string,number>={};
for(const feature of features){const label=feature.type==='profile'?'Sketch':feature.type==='extrude'&&feature.operation==='cut'?'Pocket':feature.type[0].toUpperCase()+feature.type.slice(1);counts[label]=(counts[label]??0)+1;feature.name=`${label} ${counts[label]} · ${feature.name.split(' · ').at(-1)}`;}
const document:PartDocument={format:'aether-part',formatVersion:PART_DOCUMENT_VERSION,documentId:'scifirobot-feature-study',name:'Scifirobot',units:'millimeter',features,bodyProperties:Object.fromEntries(bodies.map(b=>[b.id,{name:b.name,visible:true,color:b.color}]))};
validatePartDocument(document);
const translated=translateDocument(document);
if(!translated.complete)throw Error(JSON.stringify(translated.untranslated));
const output=resolve(process.argv[2]??'scripts/examples/scifirobot/generated');mkdirSync(output,{recursive:true});
writeFileSync(`${output}/Scifirobot.acpart`,JSON.stringify(document,null,2));
writeFileSync(`${output}/build.json`,JSON.stringify({features:translated.features}));
writeFileSync(`${output}/presentation.json`,JSON.stringify({bodies,features:features.map(f=>({id:f.id,label:f.name,type:f.type==='profile'?'sketch':f.type,bodyID:ownership[f.id]}))}));
console.log(`${features.length} authored features; ${bodies.length} individual bodies`);
