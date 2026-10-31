/** The Assembly BOM tab: FreeCAD's columns, the total mass and the CSV export. */
import {createRequire} from 'node:module';
import React,{act} from 'react';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,root,container,store,blobs=[];
const rows=[
 {row_id:'instance:a',parent_row_id:null,part_definition_id:'p1',quantity:1,part_number:'BR-100',name:'Bracket',description:'Bent, zinc',material_name:'steel',unit_mass_kg:0.5,extended_mass_kg:0.5,source_label:'bracket.acpart',custom_properties:[{key:'Vendor',value:'Acme'}]},
 {row_id:'instance:b',parent_row_id:'instance:a',part_definition_id:'p2',quantity:1,part_number:null,name:'Pin',description:null,material_name:null,unit_mass_kg:0.02,extended_mass_kg:0.02,source_label:'pin.acpart',custom_properties:[]},
];
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
 for(const key of ['window','document','navigator','HTMLElement','Element','Node','HTMLInputElement','Event','MouseEvent','KeyboardEvent','localStorage','location','crypto'])vi.stubGlobal(key,dom.window[key]);
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{blobs.push(blob);return 'blob:bom';});vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 dom.window.HTMLAnchorElement.prototype.click=function(){this.dataset.clicked=this.download;};
 store=(await import('../../cad-assembly-workspace-store')).cadAssemblyWorkspace;
 store.setReady({revision:'r1',treeNodes:[{id:'asm',label:'Drive Assembly',children:[]}],connectorItems:[],mateItems:[],relationItems:[],problemItems:[],mateEndpointOptions:[],selectedMateDOF:null,relationDOFOptions:[],inspectorSections:[],bomRows:rows,bomTotalMassKg:0.52,commandAvailability:[],summary:{instanceCount:2,connectorCount:0,mateCount:0,remainingFreeDOFCount:0,solveStatus:'solved',bomMode:'hierarchical'}});
 store.dispatch({type:'select-tab',tab:'bom'});
 const {MatesPanel}=await import('./mates');
 container=document.createElement('div');document.body.append(container);root=(await import('react-dom/client')).createRoot(container);await act(async()=>root.render(<MatesPanel active/>));
});
afterAll(async()=>{await act(async()=>root.unmount());container.remove();store.setUnavailable();dom.window.close();vi.unstubAllGlobals();});
it('lists item numbers, description and mass with the total, and exports the CSV',async()=>{
 const table=container.querySelector('[aria-label="Assembly bill of materials"]');
 expect(table.textContent).toContain('Bracket');expect(table.textContent).toContain('1.1');expect(table.textContent).toContain('Bent, zinc');expect(table.textContent).toContain('0.02 kg');
 expect(container.querySelector('[aria-label="BOM total mass"]').textContent).toBe('2 rows · 0.52 kg');
 await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Export CSV').click());
 expect(blobs).toHaveLength(1);const csv=await blobs[0].text();
 expect(csv.split('\r\n').slice(0,4)).toEqual(['Item,Part number,Name,Description,Quantity,Material,Unit mass (kg),Mass (kg),Source,Vendor','1,BR-100,Bracket,"Bent, zinc",1,steel,0.5,0.5,bracket.acpart,Acme','1.1,,Pin,,1,,0.02,0.02,pin.acpart,','Total,,,,,,,0.52,']);
});
