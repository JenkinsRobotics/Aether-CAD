import { createRequire } from 'node:module';
import { beforeAll,beforeEach,afterEach,afterAll,expect,it,vi } from 'vitest';
import { createEmptyPartDocument } from '@aether/core/document';
const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
let dom,openPlane,doc,apply;
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/cad/index.html'});
 for(const key of ['window','document','HTMLElement','HTMLTextAreaElement','CustomEvent','Event','KeyboardEvent','location'])vi.stubGlobal(key,dom.window[key]);
 openPlane=(await import('./plane-window')).openPlaneWindow;
});
beforeEach(()=>{document.body.innerHTML='<div class="cad-studio-viewport"></div>';doc=createEmptyPartDocument('Part');apply=vi.fn(async next=>{doc=next;});});
afterEach(()=>{document.querySelector('.cad-plane-window [aria-label="Discard plane"]')?.click();document.querySelector('.cad-plane-window [aria-label="Close plane window"]')?.click();});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});

it('authors a mid plane from viewport/tree picked references and commits on Enter',async()=>{
 doc.features.push({id:'base',type:'plane',name:'Plane 1',plane:'XY',offsetMillimeters:30,suppressed:false});
 await openPlane(()=>doc,apply);
 expect(doc.features).toHaveLength(1);
 const win=document.querySelector('.cad-plane-window');
 expect(win.classList.contains('aui-feature-window')).toBe(true);
 // The method is an anchored picker: open it and choose Mid plane.
 win.querySelector('[aria-label="Plane method"]').click();
 [...win.querySelectorAll('.aui-feature-picker-menu button')].find(b=>b.textContent==='Mid plane').click();
 // A new plane starts with nothing selected — no auto-populated reference.
 expect(win.querySelectorAll('.aui-feature-entity')).toHaveLength(0);
 // Entities arrive from clicks in the viewport/tree, not a picker widget.
 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XY'}));
 window.dispatchEvent(new CustomEvent('aether-plane-feature-picked',{detail:{featureId:'base'}}));
 expect([...win.querySelectorAll('.aui-feature-entity')].map(e=>e.textContent)).toEqual(['Top plane×','Plane 1×']);
 win.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
 expect(doc.features[1].definition).toEqual({method:'mid',references:[{kind:'principal',plane:'XY'},{kind:'feature',featureId:'base'}]});
});

it('starts empty and validates the reference count against the chosen method',async()=>{
 await openPlane(()=>doc,apply);
 expect(doc.features).toHaveLength(0);
 const win=document.querySelector('.cad-plane-window');
 const accept=win.querySelector('[aria-label="Apply plane"]');
 const status=()=>win.querySelector('.aui-feature-error')?.textContent ?? '';
 const pickMethod=name=>{
  win.querySelector('[aria-label="Plane method"]').click();
  [...win.querySelectorAll('.aui-feature-picker-menu button')].find(b=>b.textContent===name).click();
 };

 // Nothing is pre-selected, so Offset is short of its one reference and the
 // window refuses to commit until that is fixed.
 expect(win.querySelectorAll('.aui-feature-entity')).toHaveLength(0);
 expect(status()).toContain('exactly 1 reference plane');
 expect(accept.disabled).toBe(true);

 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XY'}));
 expect(win.querySelectorAll('.aui-feature-entity')).toHaveLength(1);
 expect(accept.disabled).toBe(false);

 // Switching method re-validates against the NEW arity: one is now too few.
 pickMethod('Mid plane');
 expect(status()).toContain('exactly 2 reference planes');
 expect(accept.disabled).toBe(true);

 win.querySelector('[aria-label="Remove Top plane"]').click();
 expect(win.querySelectorAll('.aui-feature-entity')).toHaveLength(0);
 expect(status()).toContain('0 selected');

 win.querySelector('[aria-label="Flip normal"]').click();
 // The opacity slider was removed from the standard feature window.
 expect(win.querySelector('input[type="range"]')).toBeNull();
});

// Preview is transient until Apply; an incomplete draft never enters history.
it('previews the plane live as references and offset change',async()=>{
 doc.features.push({id:'base',type:'plane',name:'Plane 1',plane:'XY',offsetMillimeters:30,suppressed:false});
 const previews=[];
 const onPreview=e=>previews.push(e.detail);
 window.addEventListener('aether-plane-preview',onPreview);
 try{
  await openPlane(()=>doc,apply);
  expect(doc.features).toHaveLength(1);
  const win=document.querySelector('.cad-plane-window');
  const id=previews.at(-1).featureId;

  // Nothing selected yet: the plane is hidden rather than showing the seed.
  expect(previews.at(-1)).toMatchObject({featureId:id,frame:null});

  window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XY'}));
  const offset=win.querySelector('[aria-label="Offset distance"]');
  offset.value='40';
  offset.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  // One reference plus a finite distance resolves to a real frame.
  expect(previews.at(-1).frame).toMatchObject({normal:[0,0,1],originMillimeters:[0,0,40]});

  // Removing the reference takes the plane back off screen.
  win.querySelector('[aria-label="Remove Top plane"]').click();
  expect(previews.at(-1).frame).toBeNull();

  // Closing the window clears the preview too.
  win.querySelector('[aria-label="Discard plane"]').click();
  await vi.waitFor(()=>expect(previews.at(-1).frame).toBeNull());
 }finally{window.removeEventListener('aether-plane-preview',onPreview);}
});

// Orange means "selected" everywhere: the references a feature is using must be
// reported to the viewport so the entity chips and the geometry agree.
it('reports the referenced planes so the viewport can highlight them',async()=>{
 doc.features.push({id:'base',type:'plane',name:'Plane 1',plane:'XY',offsetMillimeters:30,suppressed:false});
 const highlights=[];
 const onHighlight=e=>highlights.push(e.detail.references);
 window.addEventListener('aether-plane-highlight',onHighlight);
 try{
  await openPlane(()=>doc,apply);
  expect(doc.features).toHaveLength(1);
  const win=document.querySelector('.cad-plane-window');
  expect(highlights.at(-1)).toEqual([]);

  window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XZ'}));
  expect(highlights.at(-1)).toEqual([{kind:'principal',plane:'XZ'}]);

  // A second reference joins the highlight, matching the entity chips.
  win.querySelector('[aria-label="Plane method"]').click();
  [...win.querySelectorAll('.aui-feature-picker-menu button')].find(b=>b.textContent==='Mid plane').click();
  window.dispatchEvent(new CustomEvent('aether-plane-feature-picked',{detail:{featureId:'base'}}));
  expect(highlights.at(-1)).toEqual([{kind:'principal',plane:'XZ'},{kind:'feature',featureId:'base'}]);

  // Removing a chip clears that plane's highlight.
  win.querySelector('[aria-label="Remove Front plane"]').click();
  expect(highlights.at(-1)).toEqual([{kind:'feature',featureId:'base'}]);

  // Closing releases every highlight.
  win.querySelector('[aria-label="Discard plane"]').click();
  await vi.waitFor(()=>expect(highlights.at(-1)).toEqual([]));
 }finally{window.removeEventListener('aether-plane-highlight',onHighlight);}
});

for (const definition of [
 {method:'angle',reference:{kind:'principal',plane:'XY'},axis:{kind:'axis',partId:'body',candidateId:'edge',originMillimeters:[0,0,0],directionMillimeters:[1,0,0]},angleDegrees:27},
 {method:'three-point',points:[[0,0,0],[10,0,0],[0,10,0]].map(positionMillimeters=>({kind:'point',partId:'body',candidateId:String(positionMillimeters),positionMillimeters}))},
]) it(`preserves ${definition.method} when reopening and accepting a saved plane`,async()=>{
 const feature={id:'saved',type:'plane',name:'Saved plane',plane:'XY',offsetMillimeters:0,suppressed:false,definition};
 doc.features.push(feature);
 await openPlane(()=>doc,apply,feature);
 const win=document.querySelector('.cad-plane-window');
 expect(win.querySelector('[aria-label="Plane method"]').textContent).toContain(definition.method==='angle'?'Angle':'Three point');
 if(definition.method==='angle')expect(win.querySelector('[aria-label="Plane angle"]').value).toBe('27');
 win.querySelector('[aria-label="Apply plane"]').click();
 await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
 expect(doc.features[0].definition).toEqual(definition);
});

for(const [method,label] of [['mid','Mid plane'],['angle','Angle'],['three-point','Three point']]) it(`opens the requested ${method} construction workflow`,async()=>{
 await openPlane(()=>doc,apply,undefined,method);
 const win=document.querySelector('.cad-plane-window');
 expect(win.querySelector('[aria-label="Plane method"]').textContent).toContain(label);
 expect(win.querySelector('[aria-label="Apply plane"]').disabled).toBe(true);
 win.querySelector('[aria-label="Discard plane"]').click();
 await vi.waitFor(()=>expect(document.querySelector('.cad-plane-window')).toBeNull());
 expect(doc.features).toHaveLength(0);
});

it('opens in a blank workspace and Cancel does not create a Part or undo entry',async()=>{
 doc=null;
 await openPlane(()=>doc,apply);
 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XY'}));
 expect(document.querySelector('[aria-label="Apply plane"]').disabled).toBe(false);
 document.querySelector('[aria-label="Discard plane"]').click();
 expect(apply).not.toHaveBeenCalled();expect(doc).toBeNull();
});

it('creates a plane on Apply in a blank workspace, with one history change',async()=>{
 doc=null;
 await openPlane(()=>doc,apply);
 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XY'}));
 document.querySelector('[aria-label="Apply plane"]').click();
 await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
 expect(doc.features).toHaveLength(1);
 expect(doc.features[0].definition).toMatchObject({method:'offset',distanceMillimeters:10});
});

it('rejects nonparallel Midplane references, including Enter submission',async()=>{
 await openPlane(()=>doc,apply,undefined,'mid');
 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XY'}));
 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XZ'}));
 expect(document.querySelector('[aria-label="Apply plane"]').disabled).toBe(true);
 expect(document.querySelector('.aui-feature-error').textContent).toContain('parallel');
 document.querySelector('.cad-plane-window').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 await Promise.resolve();expect(apply).not.toHaveBeenCalled();expect(doc.features).toHaveLength(0);
});

it('collects three individual vertex clicks, rejects collinearity, then permits a corrected point',async()=>{
 await openPlane(()=>doc,apply,undefined,'three-point');
 const pick=(id,position)=>window.dispatchEvent(new CustomEvent('aether-plane-geometry',{detail:{points:[{partId:'p',candidateId:id,positionMillimeters:position}]}}));
 pick('a',[0,0,0]);pick('b',[10,0,0]);pick('c',[20,0,0]);
 expect(document.querySelector('.aui-feature-error').textContent).toContain('non-collinear');
 expect(document.querySelector('[aria-label="Apply plane"]').disabled).toBe(true);
 document.querySelector('[aria-label="Remove Point 3"]').click();pick('d',[0,10,0]);
 expect(document.querySelector('[aria-label="Apply plane"]').disabled).toBe(false);
 document.querySelector('[aria-label="Apply plane"]').click();
 await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
 expect(doc.features[0].definition.points.map(p=>p.candidateId)).toEqual(['a','b','d']);
});

it('retains the angle edge when its reference plane is selected and rejects a nonparallel axis',async()=>{
 await openPlane(()=>doc,apply,undefined,'angle');
 const axis={partId:'p',candidateId:'edge',originMillimeters:[0,0,0],directionMillimeters:[0,0,1]};
 window.dispatchEvent(new CustomEvent('aether-plane-geometry',{detail:{axis}}));
 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XY'}));
 window.dispatchEvent(new CustomEvent('aether-plane-geometry',{detail:{axis:null,points:[]}}));
 expect(document.querySelector('.aui-feature-error').textContent).toContain('parallel');
 expect(document.querySelector('[aria-label="Apply plane"]').disabled).toBe(true);
 document.querySelector('[aria-label="Remove Top plane"]').click();
 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XZ'}));
 expect(document.querySelector('[aria-label="Apply plane"]').disabled).toBe(false);
 document.querySelector('[aria-label="Apply plane"]').click();
 await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
 expect(doc.features[0].definition.axis.directionMillimeters).toEqual([0,0,1]);
});

it('Cancel tells the viewport to restore a saved plane without changing it',async()=>{
 const feature={id:'saved',type:'plane',name:'Saved',plane:'XY',offsetMillimeters:15,suppressed:false};
 doc.features.push(feature);const frames=[];const listen=e=>frames.push(e.detail);
 window.addEventListener('aether-plane-preview',listen);
 try {
  await openPlane(()=>doc,apply,feature);
  const offset=document.querySelector('[aria-label="Offset distance"]');offset.value='35';offset.dispatchEvent(new Event('input'));
  expect(frames.at(-1).frame.originMillimeters).toEqual([0,0,35]);
  document.querySelector('[aria-label="Close plane window"]').click();
  expect(frames.at(-1)).toMatchObject({featureId:'saved',frame:null,finished:true});
  expect(apply).not.toHaveBeenCalled();expect(doc.features[0].offsetMillimeters).toBe(15);
 } finally {window.removeEventListener('aether-plane-preview',listen);}
});
