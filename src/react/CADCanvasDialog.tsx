import {useEffect,useRef,useState} from 'react';
import {Button,Dialog} from '@aether/ui';
import {createEmptyPartDocument,validatePartDocument,type ImageCanvas} from '@aether/core/document';
import {currentInsertionDocument,editPartPresentation,selectedInsertionFace} from '../modeling/cad-import-service';
const defaults=():ImageCanvas=>({id:crypto.randomUUID(),name:'Canvas',dataUrl:'',plane:'XY',widthMillimeters:100,heightMillimeters:100,xMillimeters:0,yMillimeters:0,offsetMillimeters:0,rotationDegrees:0,opacity:.5,visible:true});
export function CADCanvasDialog({open,onClose,decal=false}:{open:boolean;onClose:()=>void;decal?:boolean}){
 const [canvas,setCanvas]=useState<ImageCanvas>(defaults),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const request=useRef<AbortController|null>(null),load=useRef(0),source=useRef(currentInsertionDocument());
 const saved=(currentInsertionDocument()?.imageCanvases??[]).filter(c=>Boolean(c.face)===decal);
 useEffect(()=>{if(open){source.current=currentInsertionDocument();setCanvas({...defaults(),name:decal?'Decal':'Canvas',...(decal?{face:selectedInsertionFace()}: {})});setError('');}return()=>{load.current++;};},[open,decal]);
 useEffect(()=>()=>request.current?.abort(),[]);
 const close=()=>{load.current++;request.current?.abort();onClose();};
 const save=async(remove=false)=>{const controller=new AbortController();request.current=controller;setBusy(true);setError('');try{editPartPresentation(source=>{const base=source??createEmptyPartDocument('Part');const next={...base,imageCanvases:[...(base.imageCanvases??[]).filter(c=>c.id!==canvas.id),...(remove?[]:[canvas])]};validatePartDocument(next);if(new TextEncoder().encode(JSON.stringify(next)).length>4*1024*1024)throw Error('The Part exceeds the 4 MiB document limit. Choose a smaller image.');return next;},source.current);onClose();}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{setBusy(false);request.current=null;}};
 const read=async(file:File)=>{const serial=++load.current;setError('');try{
  if(file.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose PNG, JPEG or WebP up to 2 MiB.');
  const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Could not read image.'));reader.readAsDataURL(file);});
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('The image cannot be decoded.'));image.src=dataUrl;});
  if(image.naturalWidth*image.naturalHeight>32_000_000)throw Error('Use an image below 32 megapixels.');
  if(serial===load.current)setCanvas(c=>({...c,name:file.name,dataUrl,heightMillimeters:c.widthMillimeters*image.naturalHeight/image.naturalWidth}));
 }catch(e){if(serial===load.current)setError((e as Error).message);}};
 const numeric=(key:keyof ImageCanvas,label:string)=><label key={key}>{label}<input aria-label={label} type="number" step="any" disabled={busy} value={String(canvas[key])} onChange={e=>setCanvas(c=>({...c,[key]:Number(e.target.value)}))}/></label>;
 return <Dialog open={open} title={decal?'Decal':'Canvas'} onClose={close} actions={<><Button onClick={close}>Cancel</Button>{saved.some(c=>c.id===canvas.id)&&<Button disabled={busy} onClick={()=>save(true)}>Remove</Button>}<Button primary disabled={busy||!canvas.dataUrl||(decal&&!canvas.face)} onClick={()=>save()}>{busy?'Saving…':'Save'}</Button></>}>
 {decal&&<p>Select a planar face before opening Decal. The image is clipped to that face and follows it on rebuild. Curved-face wrapping is not supported.</p>}
 {decal&&!canvas.face&&<p role="alert">Select one unambiguous planar face, then reopen Decal.</p>}
 <p>Place a reference image on a plane. Size and position are in millimeters. Images are embedded in the Part and restored when it opens.</p>
 <label>Canvas <select disabled={busy} value={saved.some(c=>c.id===canvas.id)?canvas.id:''} onChange={e=>{load.current++;setCanvas(saved.find(c=>c.id===e.target.value)??{...defaults(),...(decal?{face:selectedInsertionFace()}: {})});}}><option value="">New canvas</option>{saved.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Image <input disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{if(e.target.files?.[0])void read(e.target.files[0]);}}/></label>
 {canvas.dataUrl&&<img src={canvas.dataUrl} alt="Canvas preview" style={{maxWidth:'100%',maxHeight:140,objectFit:'contain'}}/>}
 <label>Name <input disabled={busy} value={canvas.name} onChange={e=>setCanvas(c=>({...c,name:e.target.value}))}/></label>
 {!decal&&<label>Plane <select disabled={busy} value={canvas.plane} onChange={e=>setCanvas(c=>({...c,plane:e.target.value as ImageCanvas['plane']}))}>{['XY','XZ','YZ'].map(p=><option key={p}>{p}</option>)}</select></label>}
 <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>{numeric('widthMillimeters','Width (mm)')}{numeric('heightMillimeters','Height (mm)')}{numeric('xMillimeters','X (mm)')}{numeric('yMillimeters','Y (mm)')}{!decal&&numeric('offsetMillimeters','Offset (mm)')}{numeric('rotationDegrees','Rotation (degrees)')}{numeric('opacity','Opacity (0–1)')}</div>
 <label><input type="checkbox" disabled={busy} checked={canvas.visible} onChange={e=>setCanvas(c=>({...c,visible:e.target.checked}))}/>Visible</label>
 {error&&<p role="alert">{error}</p>}
 </Dialog>;
}
