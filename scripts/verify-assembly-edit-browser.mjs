/** Real Assembly editor and MCP broker on a disposable authenticated Studio. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ?? fileURLToPath(new URL('../../AetherStudio/core/files/package.json', import.meta.url)))('@playwright/test');
const origin=process.env.AETHER_TEST_ORIGIN,evidence=process.env.AETHER_FRONTEND_EVIDENCE;
const copyOnly=process.env.AETHER_ASSEMBLY_BROWSER_COPY_ONLY==='1';
const contactOnly=process.env.AETHER_ASSEMBLY_BROWSER_CONTACT_ONLY==='1';
// Split long qualification into bounded fixtures without weakening assertions.
const coreOnly=process.env.AETHER_ASSEMBLY_BROWSER_CORE_ONLY==='1';
assert.ok(!(coreOnly && (copyOnly || contactOnly || process.env.AETHER_ASSEMBLY_BROWSER_POSE_ONLY==='1')), 'Choose one Assembly browser group');
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'8780');
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],steps=[];
page.on('pageerror',e=>errors.push(e.message));
const legacyRPC=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/cad/rpc')legacyRPC.push(r.url());});
const button=name=>page.getByRole('button',{name,exact:true});
const step=async(name,run)=>{console.log('Begin '+name);await run();steps.push(name);console.log('Passed '+name);await page.screenshot({path:join(evidence,`${steps.length}-${name}.png`)});};
const call=(action,args)=>page.evaluate(async({action,args})=>{const r=await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value;},{action,args});
let key,editor,file,assemblyID,state,angle,slide,rest,connectionName,contactsVerified=false;
const mcp=async(method,params)=>{
  const r=await fetch(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method,params})});const data=await r.json();assert.equal(r.ok,true,JSON.stringify(data));return data;
};
const tool=async(name,args,allowError=false)=>{const r=await mcp('tools/call',{name,arguments:args});if(!allowError)assert.equal(r.result?.isError,false,JSON.stringify(r));return r.result.structuredContent;};
const share=async(create=false)=>{
  if(!await page.getByRole('textbox',{name:/^Ask /}).isVisible())await button('AI advisor').click();
  await button('Agent connections').click();await page.getByRole('radio',{name:'MCP agents',exact:true}).click();
  if(create){
    connectionName=`Assembly fixture ${randomUUID().slice(0,8)}`;
    await page.getByText('Use a connection key',{exact:true}).click();await page.getByRole('textbox',{name:'Agent connection name',exact:true}).fill(connectionName);assert.equal(await page.getByRole('textbox',{name:'Agent connection name',exact:true}).inputValue(),connectionName);await button('Create connection key').click();
    key=await page.getByRole('textbox',{name:'Connection key',exact:true}).inputValue();
    await mcp('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'assembly-fixture',version:'1'}});
  }
  await button('Share this editor').click();await button('Stop sharing editor').waitFor();editor=undefined;
  for(let i=0;i<100&&!editor;i++){editor=(await tool('editor_list',{})).editors.find(e=>e.document===file.id&&e.app==='cad')?.editor;if(!editor)await page.waitForTimeout(100);}
  assert.ok(editor,'Assembly editor registered');const catalog=(await tool('editor_inspect',{editor})).editor.tools;assert.ok(catalog.some(t=>t.name==='aether_cad_assembly_edit'));await button('Done').click();
};
const invoke=async(name,args={},success=true)=>{
  const operation=randomUUID(),accepted=await mcp('tools/call',{name:'editor_invoke',arguments:{editor,name,arguments:args,operation},_meta:{'aether/operationId':operation}});assert.equal(accepted.result?.isError,false,JSON.stringify(accepted));
  for(let i=0;i<900;i++){
    const r=(await tool('editor_result',{editor,operation},!success)).live_editor;
    if(r.state==='completed'){assert.equal(r.reply.ok,success,JSON.stringify(r));return r.reply.value;}
    assert.ok(['queued','running'].includes(r.state),JSON.stringify(r));await page.waitForTimeout(100);
  }throw Error('Assembly agent operation timed out');
};
const inspect=(section='summary')=>invoke('aether_cad_assembly_inspect',{section});
const edit=async(command,success=true)=>{
  const before=await inspect();const result=await invoke('aether_cad_assembly_edit',{expected_revision:before.revision,command_json:JSON.stringify(command)},success);
  if(success)state=result;else assert.equal((await inspect()).revision,before.revision);return result;
};
const graph=async()=>{
  const saved=await call('library/read',{app:'cad',id:file.id});
  return JSON.parse(execFileSync('python3',['-c','import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(z.read("state/graph.json").decode())'],{input:Buffer.from(saved.data_base64,'base64'),encoding:'utf8'}));
};
const unshare=async(revoke=false)=>{await button('Agent connections').click();await page.getByRole('radio',{name:'MCP agents',exact:true}).click();await button('Stop sharing editor').click();if(revoke)await page.locator('.aui-agent-connection-card').filter({has:page.getByText(connectionName,{exact:true})}).getByRole('button',{name:'Revoke',exact:true}).click();await button('Done').click();};
try{
  if(process.env.AETHER_TEST_TOKEN) await page.context().addCookies([{name:'aether_native_session',value:process.env.AETHER_TEST_TOKEN,url:origin}]);
  await page.goto(origin+'/cad/');
  if(!process.env.AETHER_TEST_TOKEN){await page.locator('input[name="username"]').fill('editor');await page.locator('input[name="password"]').fill('account-test-password-2026');await button('Sign in').click();}
  await page.getByText('A space for your next idea.',{exact:false}).waitFor({timeout:30000});
  if(!contactOnly&&!copyOnly&&process.env.AETHER_ASSEMBLY_BROWSER_POSE_ONLY!=='1'){
  file=await call('library/project_create',{app:'cad',name:'Assembly agent baseline',operation_id:randomUUID(),packaging:'assembly',scope:'personal'});assemblyID=file.project.assemblies[0].id;
  const url=`${origin}/cad/index.html?document=${file.id}&assembly=${assemblyID}`;await page.goto(url);await page.locator('.aui-studio-document-title').filter({hasText:'Assembly agent baseline'}).waitFor({timeout:90000});
  await step('compose-and-inspect',async()=>{
    await share(true);state=await inspect();const recipe=state.example;delete recipe.patterns;
    recipe.instances=[{key:'base',part:'block',grounded:true},{key:'arm',part:'block',position_mm:[20,0,0]},{key:'slider',part:'block',position_mm:[0,20,0]}];
    recipe.mates=[{key:'pivot',kind:'revolute',a:{instance:'base'},b:{instance:'arm'}},{key:'slide',kind:'prismatic',a:{instance:'base'},b:{instance:'slider'}}];
    await invoke('aether_cad_assembly_compose',{expected_revision:state.revision,recipe_json:JSON.stringify(recipe)});state=await inspect();assert.equal(state.counts.instances,3);assert.equal(state.counts.mates,2);
    const mates=(await inspect('mates')).items;angle=mates.find(m=>m.type_id==='revolute').dofs[0].id;slide=mates.find(m=>m.type_id==='prismatic').dofs[0].id;
    rest=(await inspect('instances')).items.map(i=>[i.id,i.rest_transform]);
    assert.equal((await inspect('bom')).items.reduce((n,r)=>n+r.quantity,0),3);
  });
  await step('dof-limits-history-and-stale-refusal',async()=>{
    await edit({type:'dof-limits',id:angle,minimum:-90,maximum:90,unit:'deg'});
    const old=state.revision;await edit({type:'dof-value',id:angle,value:45,unit:'deg'});
    const value=async()=>(await inspect('mates')).items.flatMap(m=>m.dofs).find(d=>d.id===angle).value_rad;
    assert.ok(Math.abs(await value()-Math.PI/4)<1e-9);
    await invoke('aether_cad_assembly_edit',{expected_revision:old,command_json:JSON.stringify({type:'dof-value',id:angle,value:60,unit:'deg'})},false);
    const oldValue=state;
    state=await invoke('aether_cad_assembly_undo',{expected_revision:state.revision});assert.ok(Math.abs(await value())<1e-9);
    state=await invoke('aether_cad_assembly_undo',{expected_revision:state.revision});
    assert.equal((await inspect('mates')).items.flatMap(m=>m.dofs).find(d=>d.id===angle).limit_min_rad,null);
    state=await invoke('aether_cad_assembly_undo',{expected_revision:state.revision});assert.equal(state.counts.instances,0);
    assert.equal(state.can_undo,false);
    state=await invoke('aether_cad_assembly_redo',{expected_revision:state.revision});assert.equal(state.counts.instances,3);
    state=await invoke('aether_cad_assembly_redo',{expected_revision:state.revision});
    state=await invoke('aether_cad_assembly_redo',{expected_revision:state.revision});assert.ok(Math.abs(await value()-Math.PI/4)<1e-9);
    // Undo, then branch to another value with the same archive counter. An
    // editor token from the earlier branch must still be refused.
    state=await invoke('aether_cad_assembly_undo',{expected_revision:state.revision});
    await edit({type:'dof-value',id:angle,value:30,unit:'deg'});
    assert.equal(state.source_revision,oldValue.source_revision);assert.notEqual(state.revision,oldValue.revision);
    await invoke('aether_cad_assembly_edit',{expected_revision:oldValue.revision,command_json:JSON.stringify({type:'dof-value',id:angle,value:60,unit:'deg'})},false);
    assert.ok(Math.abs(await value()-Math.PI/6)<1e-9);
    await edit({type:'dof-value',id:angle,value:45,unit:'deg'});
    await edit({type:'dof-value',id:angle,value:200,unit:'deg'},false);
    await edit({type:'dof-value',id:slide,value:25,unit:'mm'});
    assert.deepEqual((await inspect('instances')).items.map(i=>[i.id,i.rest_transform]),rest);
  });
  await step('relation-and-explicit-instance-edit',async()=>{
    await edit({type:'relation-add',kind:'rack_pinion',driver_dof_id:angle,driven_dof_id:slide,ratio:0.005,offset:1,unit:'mm'});
    const relation=(await inspect('relations')).items[0];assert.equal(relation.offset_m,0.001);
    const solved=(await inspect('solution')).solution.dof_values.find(d=>d.dof_id===slide).value_m;assert.ok(Math.abs(solved-(Math.PI/4*0.005+0.001))<1e-9);
    await edit({type:'dof-value',id:slide,value:500,unit:'mm'},false);
    await edit({type:'relation-update',id:relation.id,kind:'rack_pinion',driver_dof_id:angle,driven_dof_id:slide,ratio:0.005,offset:2,unit:'mm'});
    await edit({type:'remove',entity:'relation',id:relation.id});assert.equal((await inspect('relations')).total,0);
    const arm=(await inspect('instances')).items.find(i=>!i.grounded);await edit({type:'instance-update',id:arm.id,name:'Driven arm'});
    assert.equal((await inspect('instances')).items.find(i=>i.id===arm.id).name,'Driven arm');assert.deepEqual((await inspect('instances')).items.map(i=>[i.id,i.rest_transform]),rest);
  });
  await step('mate-create-edit-remove-and-instance-visibility',async()=>{
    const old=(await inspect('mates')).items.find(m=>m.type_id==='prismatic');
    await edit({type:'remove',entity:'mate',id:old.id});
    await edit({type:'mate-add',kind:'prismatic',name:'New slide',
      a:{instance_id:old.endpoint_a.instance_id,connector_id:old.endpoint_a.connector_definition_id},
      b:{instance_id:old.endpoint_b.instance_id,connector_id:old.endpoint_b.connector_definition_id}});
    const added=(await inspect('mates')).items.find(m=>m.type_id==='prismatic');
    assert.notEqual(added.id,old.id);slide=added.dofs[0].id;
    await edit({type:'mate-update',id:added.id,name:'Travel',suppressed:true});
    await edit({type:'dof-value',id:slide,value:25,unit:'mm'},false);
    await edit({type:'mate-update',id:added.id,suppressed:false});
    await edit({type:'dof-value',id:slide,value:25,unit:'mm'});
    const arm=(await inspect('instances')).items.find(i=>i.name==='Driven arm');
    await edit({type:'instance-update',id:arm.id,visible:false});
    assert.equal((await inspect('instances')).items.find(i=>i.id===arm.id).visible,false);
    await edit({type:'instance-update',id:arm.id,visible:true});
  });
  await step('connector-dependencies-and-contact-capability',async()=>{
    const before=(await inspect('connectors')).items;
    await edit({type:'remove',entity:'connector',id:before[0].id},false);
    await edit({type:'connector-add',part_id:state.parts[0].id,name:'Auxiliary axis',origin_mm:[1,2,3]});
    const added=(await inspect('connectors')).items.find(c=>!before.some(old=>old.id===c.id));assert.deepEqual(added.frame_part_local.origin_m,[0.001,0.002,0.003]);
    await edit({type:'remove',entity:'connector',id:added.id});
    const command={type:'contact-add',name:'Pair',instance_ids:state.instances.slice(0,2).map(i=>i.id)};
    assert.equal(state.capabilities.can_edit_contacts,true,'CAD owns the packaged contact codec');
    await edit(command);const contact=(await inspect('contacts')).items[0];
    // The mated base/arm overlap: enabling checks must reject without changing state.
    await edit({type:'contacts-enabled',enabled:true},false);assert.equal((await inspect()).contacts_enabled,false);
    await edit({...command,type:'contact-update',id:contact.id,suppressed:true});
    await edit({type:'contacts-enabled',enabled:true});assert.equal((await inspect()).contacts_enabled,true);
    await edit({...command,type:'contact-update',id:contact.id,suppressed:false},false);
    // Check a clear, movable pair. Moving the slider into the base must be refused.
    const instances=(await inspect('instances')).items;
    const base=instances.find(i=>i.grounded),slider=instances.find(i=>i.id===(state.mates??[]).find(m=>m.type_id==='prismatic')?.endpoint_b.instance_id)
      ?? instances.find(i=>i.name==='slider');
    assert.ok(slider,'slider occurrence');
    await edit({...command,type:'contact-update',id:contact.id,instance_ids:[base.id,slider.id],suppressed:false});
    await edit({type:'dof-value',id:slide,value:0,unit:'mm'},false);
    assert.equal((await inspect('mates')).items.flatMap(m=>m.dofs).find(d=>d.id===slide).value_m,0.025);
    await edit({type:'dof-value',id:slide,value:30,unit:'mm'});
    contactsVerified=true;
  });
  await step('save-reopen-and-inspect',async()=>{
    const final=await inspect();let saved;
    for(let i=0;i<120;i++){saved=await graph();if(String(saved.revision)===final.source_revision)break;await page.waitForTimeout(100);}
    assert.equal(String(saved.revision),final.source_revision);assert.equal(saved.instances.length,3);assert.equal(saved.mates.length,2);assert.equal(saved.schema_version,2);assert.equal(saved.contacts_enabled,true);assert.equal(saved.contact_sets.length,1);
    await unshare();await page.reload();await page.locator('.aui-studio-document-title').filter({hasText:'Assembly agent baseline'}).waitFor({timeout:90000});await share();
    const reopened=await inspect();assert.equal(reopened.contacts_enabled,true);assert.equal((await inspect('contacts')).items.length,1);assert.equal(reopened.source_revision,final.source_revision);assert.notEqual(reopened.revision,final.revision);assert.equal(reopened.counts.instances,3);assert.deepEqual((await inspect('instances')).items.map(i=>[i.id,i.rest_transform]),rest);
    await invoke('aether_cad_assembly_edit',{expected_revision:final.revision,command_json:JSON.stringify({type:'dof-value',id:angle,value:60,unit:'deg'})},false);
    const reopenedAngle=(await inspect('mates')).items.flatMap(m=>m.dofs).find(d=>d.id===angle);assert.ok(Math.abs(reopenedAngle.value_rad-Math.PI/4)<1e-9);assert.ok(Math.abs(reopenedAngle.limit_max_rad-Math.PI/2)<1e-9);
    await unshare(true);await button('AI advisor').click();
  });
  }
  for (const kind of (coreOnly||contactOnly||copyOnly?[]:['ball','pin_slot'])) await step(`${kind}-nonzero-contact-checked-save-reopen`,async()=>{
    file=await call('library/project_create',{app:'cad',name:`Pose ${kind}`,operation_id:randomUUID(),packaging:'assembly',scope:'personal'});assemblyID=file.project.assemblies[0].id;
    await page.goto(`${origin}/cad/index.html?document=${file.id}&assembly=${assemblyID}`);
    await page.locator('.aui-studio-document-title').filter({hasText:`Pose ${kind}`}).waitFor({timeout:90000});
    await share(true);state=await inspect();const recipe=state.example;delete recipe.patterns;
    recipe.instances=[{key:'base',part:'block',grounded:true},{key:'moving',part:'block',position_mm:[0,0,50]}];
    recipe.mates=[{key:'joint',kind,a:{instance:'base',origin_mm:[0,0,50]},b:{instance:'moving'}}];
    await invoke('aether_cad_assembly_compose',{expected_revision:state.revision,recipe_json:JSON.stringify(recipe)});
    const mate=(await inspect('mates')).items[0];
    // Every edit now crosses the actual browser solver and exact OCCT contact
    // validator, not only the workspace's metadata projection.
    await edit({type:'contacts-enabled',enabled:true});
    for (const [i,dof] of mate.dofs.entries()) await edit({type:'dof-value',id:dof.id,value:kind==='ball'?[20,110,-40][i]:dof.kind==='rotation'?35:25,unit:dof.kind==='rotation'?'deg':'mm'});
    const components=page.getByRole('tree',{name:'CAD assembly components'});
    await expect(components.getByRole('treeitem')).toHaveCount(2);
    const coordinate=kind==='ball'?mate.dofs[0]:mate.dofs.find(d=>d.kind==='translation');
    await page.getByRole('listbox',{name:'Canonical mates'}).getByRole('option').click();
    await button('Mate actions').click();await page.getByRole('menuitem',{name:'Set Selected Mate Value…',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Set mate DOF value',exact:true});
    await dialog.locator('#assembly-mate-coordinate').selectOption(coordinate.id);
    await dialog.locator('#assembly-mate-dof-value').fill('30');await dialog.getByRole('button',{name:'Set Value',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const coordinateValue=async()=>{const dof=(await inspect('mates')).items[0].dofs.find(d=>d.id===coordinate.id);return coordinate.kind==='rotation'?dof.value_rad*180/Math.PI:dof.value_m*1000;};
    assert.ok(Math.abs(await coordinateValue()-30)<1e-8);
    await page.locator('body').click({position:{x:1100,y:400}});await page.keyboard.press('Control+z');
    await expect.poll(async()=>Math.abs(await coordinateValue()-(kind==='ball'?20:25)),{timeout:30000}).toBeLessThan(1e-8);
    state=await inspect();state=await invoke('aether_cad_assembly_redo',{expected_revision:state.revision});assert.ok(Math.abs(await coordinateValue()-30)<1e-8);
    await page.getByRole('listbox',{name:'Canonical mates'}).getByRole('option').click();
    await button('Mate actions').click();await page.getByRole('menuitem',{name:'Edit Selected Mate Limits…',exact:true}).click();
    const limits=page.getByRole('dialog',{name:'Edit mate DOF limits',exact:true});
    await limits.locator('#assembly-mate-coordinate').selectOption(coordinate.id);
    await limits.getByRole('checkbox',{name:/^Enable authored limits/}).check();
    await limits.locator('#assembly-mate-dof-minimum').fill(kind==='ball'?'-60':'0');
    await limits.locator('#assembly-mate-dof-maximum').fill(kind==='ball'?'60':'40');
    await limits.getByRole('button',{name:'Apply Limits',exact:true}).click();await limits.waitFor({state:'hidden'});
    const values=dofs=>dofs.map(d=>[d.name,d.value_rad,d.value_m,d.limit_min_rad,d.limit_max_rad,d.limit_min_m,d.limit_max_m]);
    const expected=values((await inspect('mates')).items[0].dofs);
    const changed=(await inspect('mates')).items[0].dofs.find(d=>d.id===coordinate.id);
    assert.ok(Math.abs((coordinate.kind==='rotation'?changed.limit_max_rad*180/Math.PI:changed.limit_max_m*1000)-(kind==='ball'?60:40))<1e-8);
    const final=await inspect();let saved;
    for(let i=0;i<120;i++){saved=await graph();if(String(saved.revision)===final.source_revision)break;await page.waitForTimeout(100);}
    assert.equal(String(saved.revision),final.source_revision);assert.equal(saved.contacts_enabled,true);
    await unshare();await page.reload();await page.locator('.aui-studio-document-title').filter({hasText:`Pose ${kind}`}).waitFor({timeout:90000});await share();
    assert.deepEqual(values((await inspect('mates')).items[0].dofs),expected);
    assert.equal((await inspect()).can_undo,false,'Saved reopen starts a new local edit history');
    assert.equal((await inspect()).contacts_enabled,true);
    // Trigger a post-reopen validation as well, then leave the true viewport visible.
    await edit({type:'mate-update',id:mate.id,name:`Checked ${kind}`});contactsVerified=true;
    await unshare(true);await button('AI advisor').click();
  });
  if(!coreOnly&&!contactOnly)await step('compound-ui-copy-history-and-reopen',async()=>{
    if(copyOnly){
      file=await call('library/project_create',{app:'cad',name:'Copy continuity',operation_id:randomUUID(),packaging:'assembly',scope:'personal'});assemblyID=file.project.assemblies[0].id;
      await page.goto(`${origin}/cad/index.html?document=${file.id}&assembly=${assemblyID}`);
      await page.locator('.aui-studio-document-title').filter({hasText:'Copy continuity'}).waitFor({timeout:90000});
    }
    await share(true);
    if(copyOnly){
      state=await inspect();const recipe=state.example;delete recipe.patterns;
      recipe.instances=[{key:'base',part:'block',grounded:true},{key:'moving',part:'block',position_mm:[0,0,50]}];recipe.mates=[];
      await invoke('aether_cad_assembly_compose',{expected_revision:state.revision,recipe_json:JSON.stringify(recipe)});
    }
    await edit({type:'contacts-enabled',enabled:false});
    const before=await inspect();assert.equal(before.counts.instances,2);assert.equal(before.parts.length,1);
    const components=page.getByRole('tree',{name:'CAD assembly components'});
    await components.getByRole('treeitem').filter({hasText:'base'}).click();
    await page.keyboard.press('Control+k');
    const palette=page.getByRole('dialog',{name:'CAD commands',exact:true});
    await palette.getByRole('combobox',{name:'Search CAD commands',exact:true}).fill('Make Independent');
    await palette.getByRole('option').filter({hasText:'Make Independent'}).click();
    await palette.waitFor({state:'hidden'});
    await expect(components.getByRole('treeitem')).toHaveCount(3,{timeout:60000});
    state=await inspect();assert.equal(state.parts.length,2);assert.equal(state.counts.instances,3);
    await button('Undo').click();
    await expect(components.getByRole('treeitem')).toHaveCount(2,{timeout:60000});state=await inspect();
    assert.equal(state.counts.instances,2);assert.equal(state.parts.length,1,'One common-button undo removes both copied definition and occurrence');
    await button('Redo').click();
    await expect(components.getByRole('treeitem')).toHaveCount(3,{timeout:60000});state=await inspect();
    assert.equal(state.counts.instances,3);assert.equal(state.parts.length,2);
    let saved;for(let i=0;i<120;i++){saved=await graph();if(String(saved.revision)===state.source_revision)break;await page.waitForTimeout(100);}
    assert.equal(String(saved.revision),state.source_revision);
    assert.equal(saved.part_definitions.length,2);
    for(const part of saved.part_definitions)assert.equal(part.feature_document.documentId,part.id);
    assert.deepEqual(saved.part_definitions[0].feature_document.features,saved.part_definitions[1].feature_document.features);
    await unshare();await page.reload();await page.locator('.aui-studio-document-title').filter({hasText:copyOnly?'Copy continuity':'Pose pin_slot'}).waitFor({timeout:90000});await share();
    const reopened=await inspect();assert.equal(reopened.counts.instances,3);assert.equal(reopened.parts.length,2);assert.equal(reopened.can_undo,false);
    await expect(button('Undo')).toBeDisabled();await expect(button('Redo')).toBeDisabled();
    await expect(components.getByRole('treeitem')).toHaveCount(3);
    await unshare(true);await button('AI advisor').click();
  });
  if(!coreOnly&&!copyOnly)await step('contact-panel-management-and-collision-refusal',async()=>{
    file=await call('library/project_create',{app:'cad',name:'Contact management',operation_id:randomUUID(),packaging:'assembly',scope:'personal'});assemblyID=file.project.assemblies[0].id;
    await page.goto(`${origin}/cad/index.html?document=${file.id}&assembly=${assemblyID}`);
    await page.locator('.aui-studio-document-title').filter({hasText:'Contact management'}).waitFor({timeout:90000});
    await share(true);state=await inspect();const recipe=state.example;delete recipe.patterns;
    recipe.instances=[{key:'base',part:'block',grounded:true},{key:'moving',part:'block',position_mm:[0,0,50]},{key:'third',part:'block',position_mm:[50,0,0]}];recipe.mates=[];
    await invoke('aether_cad_assembly_compose',{expected_revision:state.revision,recipe_json:JSON.stringify(recipe)});
    const instances=(await inspect('instances')).items,third=instances.find(instance=>instance.name==='third'),moving=instances.find(instance=>instance.name==='moving');
    const action=async name=>{await button('Contact actions').click();await page.getByRole('menuitem',{name,exact:true}).click();};
    const list=page.getByRole('listbox',{name:'Contact sets',exact:true});
    await action('Create Contact Set…');let dialog=page.getByRole('dialog',{name:'Create contact set',exact:true});
    await dialog.locator('#assembly-contact-name').fill('Clearance');
    await dialog.getByRole('checkbox',{name:'base',exact:true}).check();await dialog.getByRole('checkbox',{name:'moving',exact:true}).check();
    await dialog.getByRole('button',{name:'Create Contact Set',exact:true}).click();await dialog.waitFor({state:'hidden'});
    await expect(list.getByRole('option')).toHaveCount(1);await list.getByRole('option').click();
    await action('Enable Contact Checks');await expect.poll(async()=>(await inspect()).contacts_enabled,{timeout:60000}).toBe(true);
    await action('Edit Selected Contact Set…');dialog=page.getByRole('dialog',{name:'Edit contact set',exact:true});
    await dialog.locator('#assembly-contact-name').fill('Adjusted clearance');
    await dialog.getByRole('checkbox',{name:'base',exact:true}).uncheck();await dialog.getByRole('checkbox',{name:'third',exact:true}).check();
    await dialog.getByRole('button',{name:'Save Contact Set',exact:true}).click();await dialog.waitFor({state:'hidden'});
    let contact=(await inspect('contacts')).items[0];assert.equal(contact.name,'Adjusted clearance');assert.deepEqual(new Set(contact.instance_ids),new Set([moving.id,third.id]));
    await action('Suppress Selected Contact Set');await expect.poll(async()=>(await inspect('contacts')).items[0].suppressed,{timeout:60000}).toBe(true);
    await edit({type:'instance-suppressed',id:third.id,suppressed:true});
    await action('Edit Selected Contact Set…');dialog=page.getByRole('dialog',{name:'Edit contact set',exact:true});
    await expect(dialog.getByRole('checkbox',{name:'third (suppressed)',exact:true})).toBeChecked();
    await dialog.getByRole('button',{name:'Save Contact Set',exact:true}).click();await dialog.waitFor({state:'hidden'});
    assert.ok((await inspect('contacts')).items[0].instance_ids.includes(third.id));
    await edit({type:'instance-suppressed',id:third.id,suppressed:false});await edit({type:'instance-update',id:third.id,position_mm:[0,0,50]});
    const before=await inspect();await action('Restore Selected Contact Set');
    await expect(page.getByText(/^Contact set update failed:/)).toBeVisible({timeout:60000});
    assert.equal((await inspect()).revision,before.revision);assert.equal((await inspect('contacts')).items[0].suppressed,true);
    await button('Dismiss').click();await edit({type:'instance-update',id:third.id,position_mm:[50,0,0]});
    await action('Restore Selected Contact Set');await expect.poll(async()=>(await inspect('contacts')).items[0].suppressed,{timeout:60000}).toBe(false);
    await action('Remove Selected Contact Set');await expect(list.getByRole('option')).toHaveCount(0,{timeout:60000});
    state=await inspect();await invoke('aether_cad_assembly_undo',{expected_revision:state.revision});
    await expect(list.getByRole('option')).toHaveCount(1);contact=(await inspect('contacts')).items[0];assert.equal(contact.name,'Adjusted clearance');
    const final=await inspect();let saved;for(let i=0;i<120;i++){saved=await graph();if(String(saved.revision)===final.source_revision)break;await page.waitForTimeout(100);}
    assert.equal(String(saved.revision),final.source_revision);
    await unshare();await page.reload();await page.locator('.aui-studio-document-title').filter({hasText:'Contact management'}).waitFor({timeout:90000});await share();
    assert.deepEqual((await inspect('contacts')).items,[contact]);assert.equal((await inspect()).contacts_enabled,true);
    await expect(list.getByRole('option')).toHaveCount(1);contactsVerified=true;
    await unshare(true);await button('AI advisor').click();
  });
  assert.deepEqual(errors,[]);assert.deepEqual(legacyRPC,[],'CAD must not use Studio Animation RPC');await writeFile(join(evidence,'results.json'),JSON.stringify({status:'passed',steps,contactsVerified,errors},null,2));
}catch(error){await page.screenshot({path:join(evidence,'failure.png')});await writeFile(join(evidence,'failure.txt'),String(error.stack)+'\n'+await page.locator('body').innerText());throw error;}
finally{await browser.close();}
