/** Saved editor reference images. These do not participate in solid evaluation. */
export interface ImageCanvas {
 face?:{bodyId:string;normal:[number,number,number];anchor?:{centerMillimeters:[number,number,number];areaSquareMillimeters:number}};
 id:string;name:string;dataUrl:string;plane:'XY'|'XZ'|'YZ';
 widthMillimeters:number;heightMillimeters:number;xMillimeters:number;yMillimeters:number;offsetMillimeters:number;rotationDegrees:number;opacity:number;visible:boolean;
}
export function validateImageCanvases(value:unknown):void{
 if(value===undefined)return;
 if(!Array.isArray(value)||value.length>32)throw Error('A Part may contain at most 32 image canvases.');
 const ids=new Set<string>();
 for(const item of value){
  if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>255)throw Error('Invalid image canvas identity.');
  ids.add(item.id);
  if(item.face){
   const face=item.face,vec=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
   if(typeof face.bodyId!=='string'||!face.bodyId||!vec(face.normal)||Math.abs(Math.hypot(...face.normal)-1)>1e-6)throw Error('Invalid decal face reference.');
   if(face.anchor&&(!vec(face.anchor.centerMillimeters)||!Number.isFinite(face.anchor.areaSquareMillimeters)||face.anchor.areaSquareMillimeters<=0))throw Error('Invalid decal face anchor.');
  }
  if(typeof item.dataUrl!=='string'||item.dataUrl.length>3*1024*1024||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.dataUrl))throw Error('Canvas must contain an embedded PNG, JPEG or WebP image.');
  if(!['XY','XZ','YZ'].includes(item.plane)||typeof item.visible!=='boolean')throw Error('Invalid canvas plane or visibility.');
  for(const key of ['widthMillimeters','heightMillimeters','xMillimeters','yMillimeters','offsetMillimeters','rotationDegrees','opacity'])if(typeof item[key]!=='number'||!Number.isFinite(item[key]))throw Error('Canvas dimensions must be finite.');
  if(item.widthMillimeters<=0||item.heightMillimeters<=0||item.opacity<0||item.opacity>1)throw Error('Canvas dimensions must be positive and opacity between 0 and 1.');
 }
}
