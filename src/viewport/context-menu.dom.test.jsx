import {createRequire} from 'node:module';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {bodyContextFeatures,cadViewportContext,configureViewportContext} from './context-menu';
import {cadCommands} from '../cad-command-registry';
import {cadSelection} from '../cad-selection-store';
import {cadPresentation} from '../cad-presentation-store';
import {configurePartExport,consumeExportBody} from '../modeling/part-export';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,dispose,viewer,doc,apply,status;
const sketch={id:'s',name:'Sketch 1',type:'profile',plane:'XY',offsetMillimeters:0,profile:{type:'circle',radiusMillimeters:10,centerXMillimeters:0,centerYMillimeters:0}};
const extrude={id:'e',name:'Extrude 1',type:'extrude',profileFeatureId:'s',operation:'new',bodyId:'b1',distanceMillimeters:10};
const hit=(id='b1')=>({id:`body:${id}`,kind:'body',partId:id,label:id==='b1'?'Part 1':'Part 2'});
beforeEach(()=>{
 dom=new JSDOM('<body/>');for(const key of ['window','document','CustomEvent'])vi.stubGlobal(key,dom.window[key]);
 doc={schemaVersion:1,documentId:'d',name:'Test',features:[sketch,extrude],bodyProperties:{b1:{name:'Part 1',visible:true}}};
 const rows=[{id:'b1',name:'Part 1',sourceDocumentId:'d',visible:true},{id:'b2',name:'Part 2',sourceDocumentId:'other',visible:true}];
 viewer={contextPartsAt:vi.fn(()=>[hit()]),getPartRows:()=>rows,setPartVisibility:vi.fn(),isolatePart:vi.fn(),isolatedPartId:null,getPartDisplay:()=>({}),setPartDisplay:vi.fn(),zoomToParts:vi.fn()};
 apply=vi.fn(async next=>{doc=next;});status=vi.fn();
 configurePartExport(()=>doc);
 dispose=configureViewportContext({viewer,document:()=>doc,apply,status});
 cadSelection.dispatch({type:'clear'});cadPresentation.patch({loading:null,startDialog:null});
});
afterEach(()=>{dispose();dom.window.close();vi.unstubAllGlobals();});
const open=(button=2)=>cadViewportContext.open(new dom.window.MouseEvent('contextmenu',{button,clientX:300,clientY:200}));
const items=()=>cadViewportContext.snapshot().menu.items;
it('background uses its own controls and clears stale selection',()=>{
 cadSelection.dispatch({type:'replace',items:[hit('b2')]});viewer.contextPartsAt.mockReturnValue([]);open();
 expect(items().map(x=>x.id)).toEqual(['show-all','select','fit','isometric']);expect(cadSelection.snapshot().items).toEqual([]);
 cadViewportContext.select('fit');expect(viewer.zoomToParts).toHaveBeenCalledWith();
});
it('right click selects the hit part independently of filter or previous selection',()=>{
 cadSelection.dispatch({type:'replace',items:[hit('b2')]});cadSelection.dispatch({type:'set-filter',filter:'vertex'});open();
 expect(cadSelection.snapshot().items[0].partId).toBe('b1');
 expect(items().find(x=>x.id==='hide').label).toBe('Hide Part 1');
 expect(items().filter(x=>x.id.startsWith('edit:')).map(x=>x.label)).toEqual(['Edit Extrude 1…','Edit Sketch 1…']);
 cadViewportContext.select('fit-selection');expect(viewer.zoomToParts).toHaveBeenCalledWith(['b1']);
});
it('edits and deletes the clicked feature without inheriting tree multi-selection',()=>{
 const event=vi.fn();window.addEventListener('aether-feature-action',event);open();cadViewportContext.select('delete-feature');
 expect(event.mock.calls[0][0].detail).toEqual({type:'item-action',id:'feature/extrude/e',actionID:'delete-feature'});
 open();cadViewportContext.select('edit:s');expect(event.mock.calls[1][0].detail.id).toBe('feature/profile/s');
});
it('persists hide/show through the existing document path without removing geometry',async()=>{
 open();cadViewportContext.select('hide');await Promise.resolve();
 expect(doc.features).toHaveLength(2);expect(doc.bodyProperties.b1.visible).toBe(false);expect(viewer.setPartVisibility).toHaveBeenCalledWith('b1',false);
 viewer.contextPartsAt.mockReturnValue([]);open();cadViewportContext.select('show-all');await Promise.resolve();
 expect(doc.bodyProperties.b1.visible).toBe(true);expect(viewer.setPartVisibility).toHaveBeenCalledWith('b2',true);
});
it('keeps transparency and appearance scoped to the clicked part',()=>{
 open();cadViewportContext.select('transparent');expect(viewer.setPartDisplay).toHaveBeenCalledWith('b1',{opacity:.3});expect(apply).not.toHaveBeenCalled();
 open();cadViewportContext.select('appearance');cadViewportContext.changeAppearance({color:'#123456',roughness:.5});
 expect(viewer.setPartDisplay).toHaveBeenLastCalledWith('b1',{color:'#123456',roughness:.5});
});
it('select other exposes distinct bodies behind the hit',()=>{
 viewer.contextPartsAt.mockReturnValue([hit(),hit('b2')]);open();cadViewportContext.select('other:1');expect(cadSelection.snapshot().items[0].partId).toBe('b2');
});
it('keyboard context follows selected part and never rays through unrelated geometry',()=>{
 cadSelection.dispatch({type:'replace',items:[hit('b2')]});open(0);expect(viewer.contextPartsAt).not.toHaveBeenCalled();
 expect(items().find(x=>x.id==='hide').label).toBe('Hide Part 2');expect(items().find(x=>x.id==='export').disabled).toBe(true);
});
it('exports the hit body and consumes the request only once',()=>{
 open();cadViewportContext.select('export');expect(cadPresentation.snapshot().startDialog).toBe('export');expect(consumeExportBody()).toBe('b1');expect(consumeExportBody()).toBeUndefined();
});
it('reports real dependencies and explicit unsupported commands',()=>{
 open();for(const id of ['dimensions','surface-analysis','drawing','comment','delete-part','face-appearance']) {
  expect(items().find(x=>x.id===id)).toMatchObject({disabled:true,disabledReason:expect.any(String)});
 }
 cadViewportContext.select('dependencies');expect(cadViewportContext.snapshot().detail).toMatchObject({kind:'dependencies',parents:['Sketch 1'],children:[]});
});
it('closes on document changes and rejects stale menu actions',()=>{
 open();doc={...doc,name:'Another'};cadViewportContext.select('hide');expect(apply).not.toHaveBeenCalled();
 open();window.dispatchEvent(new dom.window.Event('aether-part-updated'));expect(cadViewportContext.snapshot().menu).toBeNull();
});
it('blocks document actions while authoring but preserves navigation',()=>{
 document.body.innerHTML='<div class="cad-sketch-workspace"/>';open();
 for(const id of ['hide','delete-feature','edit:e','export','isolate'])expect(items().find(x=>x.id===id).disabled).toBe(true);
 expect(items().find(x=>x.id==='fit').disabled).toBe(false);
});
it('resolves the latest effective body feature with multi-target and rollback history',()=>{
 const cut={...extrude,id:'cut',name:'Remove',operation:'cut',targetBodyId:'b1',targetBodyIds:['b1','b2']};
 const next={...doc,features:[sketch,extrude,{...extrude,id:'e2',bodyId:'b2'},cut]};
 expect(bodyContextFeatures(next,'b2').feature.id).toBe('cut');
 expect(bodyContextFeatures({...next,rollbackIndex:3},'b2').feature.id).toBe('e2');
 expect(bodyContextFeatures({...next,features:[...next.features.slice(0,3),{...cut,suppressed:true}]},'b1').feature.id).toBe('e');
});

it('offers direct face offsets only for an editable idle part',()=>{
 const action=vi.fn(),unregister=cadCommands.register('feature-offset-face',action);
 try{
  open();expect(items().find(x=>x.id==='offset-faces').disabled).toBe(false);
  cadViewportContext.select('offset-faces');expect(action).toHaveBeenCalledOnce();
  document.body.innerHTML='<div class="cad-feature-dialog"/>';open();
  expect(items().find(x=>x.id==='offset-faces').disabled).toBe(true);
  document.body.innerHTML='';viewer.contextPartsAt.mockReturnValue([hit('b2')]);open();
  expect(items().find(x=>x.id==='offset-faces').disabled).toBe(true);
 }finally{unregister();}
});
it('finds multi-part offset history on each selected body rather than the last body',()=>{
 const offset={id:'o',name:'Offset faces',type:'offset-face',distanceMillimeters:1,faces:[{bodyId:'b1',sourceFeatureId:'e',normal:[0,0,1],label:'Top'}]};
 const next={...doc,features:[sketch,extrude,{...extrude,id:'e2',bodyId:'b2'},offset]};
 expect(bodyContextFeatures(next,'b1').feature.id).toBe('o');
 expect(bodyContextFeatures(next,'b2').feature.id).toBe('e2');
});

it('offers transforms and copies for idle editable parts and carries the clicked selection',()=>{
 const transform=vi.fn(),copy=vi.fn();const release=[cadCommands.register('feature-transform',transform),cadCommands.register('transform-copy',copy)];
 try{
  open();expect(items().find(x=>x.id==='transform').disabled).toBe(false);cadViewportContext.select('transform');
  expect(transform).toHaveBeenCalledOnce();expect(cadSelection.snapshot().items[0].partId).toBe('b1');
  open();expect(items().find(x=>x.id==='copy').disabled).toBe(false);cadViewportContext.select('copy');expect(copy).toHaveBeenCalledOnce();
  document.body.innerHTML='<div class="cad-feature-dialog"/>';open();for(const id of ['transform','copy'])expect(items().find(x=>x.id===id).disabled).toBe(true);
  document.body.innerHTML='';viewer.contextPartsAt.mockReturnValue([hit('b2')]);open();for(const id of ['transform','copy'])expect(items().find(x=>x.id===id).disabled).toBe(true);
 }finally{release.forEach(fn=>fn());}
});
it('resolves copied and in-place transform feature ownership without changing source history',()=>{
 const copy={id:'copy',name:'Copy',type:'transform',bodyIds:['b1'],transform:{kind:'copy'},copyBodyIds:{b1:'copy-body'}};
 const moved={id:'move',name:'Move',type:'transform',bodyIds:['copy-body'],transform:{kind:'translate',translationMillimeters:[0,0,10]}};
 const next={...doc,features:[sketch,extrude,copy,moved]};
 expect(bodyContextFeatures(next,'b1').feature.id).toBe('e');
 expect(bodyContextFeatures(next,'copy-body').feature.id).toBe('move');
 expect(bodyContextFeatures({...next,rollbackIndex:3},'copy-body').feature.id).toBe('copy');
});

it("opens material properties with the right-clicked body selected",()=>{
 open();cadViewportContext.select("material");expect(cadSelection.snapshot().items[0].partId).toBe("b1");
});

it('offers active spline confirm/removal on the actual viewport menu and guards stale or inactive commands',()=>{
 const confirm=vi.fn(),remove=vi.fn();
 const release=[cadCommands.register('sketch-finish-spline',confirm),cadCommands.register('sketch-remove-spline-point',remove)];
 try {
  document.body.innerHTML='<div class="cad-sketch-workspace"/>';
  open();expect(items().slice(0,2).map(x=>x.label)).toEqual(['Confirm spline','Remove last spline point']);
  cadViewportContext.select('sketch-finish-spline');expect(confirm).toHaveBeenCalledOnce();
  cadCommands.setEnabled('sketch-finish-spline',false);open();expect(items().some(x=>x.id==='sketch-finish-spline')).toBe(false);
  cadViewportContext.select('sketch-remove-spline-point');expect(remove).toHaveBeenCalledOnce();
  open();doc={...doc};cadViewportContext.select('sketch-remove-spline-point');expect(remove).toHaveBeenCalledOnce();
  document.body.innerHTML='';open();expect(items().some(x=>x.id==='sketch-remove-spline-point')).toBe(false);
 } finally {release.forEach(fn=>fn());}
});
it('offers Unfix only for a live selected lock and invokes the validated command',()=>{
 const unfix=vi.fn(),release=cadCommands.register('sketch-unfix',unfix);
 try {
  document.body.innerHTML='<div class="cad-sketch-workspace"/>';
  cadCommands.setEnabled('sketch-unfix',true);open();
  expect(items().find(x=>x.id==='sketch-unfix').label).toBe('Unfix selected geometry');
  cadViewportContext.select('sketch-unfix');expect(unfix).toHaveBeenCalledOnce();
  cadCommands.setEnabled('sketch-unfix',false);open();expect(items().some(x=>x.id==='sketch-unfix')).toBe(false);
  cadCommands.setEnabled('sketch-unfix',true);release();open();expect(items().some(x=>x.id==='sketch-unfix')).toBe(false);
 } finally {release();cadCommands.setEnabled('sketch-unfix',false);}
});
