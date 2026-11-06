/** Actual open Drawing + explicit sharing + HTTP MCP broker. No model fixture. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function verifyDrawingAgent(page,origin, checkPDF) {
  const button=name=>page.getByRole('button',{name,exact:true});
  if(!await page.getByRole('textbox',{name:/^Ask /}).isVisible()) await button('AI advisor').click();
  await button('Agent connections').click(); await page.getByRole('radio',{name:'MCP agents',exact:true}).click();
  await page.getByText('Use a connection key',{exact:true}).click();
  await page.getByRole('textbox',{name:'Agent connection name',exact:true}).fill('Drawing fixture');
  await button('Create connection key').click();
  const key=await page.getByRole('textbox',{name:'Connection key',exact:true}).inputValue();
  const mcp=async(method,params)=>{
    const response=await fetch(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method,params})});
    const data=await response.json(); assert.equal(response.ok,true,JSON.stringify(data));return data;
  };
  await mcp('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'drawing-fixture',version:'1'}});
  const tool=async(name,args,allowError=false)=>{
    const r=await mcp('tools/call',{name,arguments:args}); if(!allowError)assert.equal(r.result?.isError,false,JSON.stringify(r));return r.result.structuredContent;
  };
  await button('Share this editor').click(); await button('Stop sharing editor').waitFor();
  const doc=new URL(page.url()).searchParams.get('document');let editor;
  for(let i=0;i<60&&!editor;i++){editor=(await tool('editor_list',{})).editors.find(e=>e.document===doc&&e.app==='cad')?.editor;if(!editor)await page.waitForTimeout(100);}
  assert.ok(editor,'Drawing editor registered');
  const catalog=(await tool('editor_inspect',{editor})).editor.tools;
  assert.ok(catalog.some(t=>t.name==='aether_cad_drawing_edit'));
  assert.ok(!catalog.some(t=>t.name==='aether_cad_run_program'));
  await button('Done').click();
  const invoke=async(name,args={},success=true)=>{
    const operation=randomUUID();
    const accepted=await mcp('tools/call',{name:'editor_invoke',arguments:{editor,name,arguments:args,operation},_meta:{'aether/operationId':operation}});
    assert.equal(accepted.result?.isError,false,JSON.stringify(accepted));
    for(let i=0;i<300;i++){
      const receipt=(await tool('editor_result',{editor,operation},!success)).live_editor;
      if(receipt.state==='completed'){assert.equal(receipt.reply.ok,success,JSON.stringify(receipt));return receipt.reply.value;}
      assert.ok(['queued','running'].includes(receipt.state),JSON.stringify(receipt));await page.waitForTimeout(100);
    }throw Error('Drawing agent operation timed out');
  };
  let state=await invoke('aether_cad_drawing_inspect');
  const point = state.sheet.annotations.find(a => a.kind === 'point-distance');
  assert.ok(point, 'UI-authored point dimension is visible to MCP');
  assert.ok(Math.abs(point.value_mm - Math.hypot(40, 20)) < 1e-8);
  const { value_mm, value_deg, text, ...pointIntent } = point;
  state = await invoke('aether_cad_drawing_edit', { expected_revision: state.revision, command_json: JSON.stringify({
    type: 'update-annotation', sheetId: state.active_sheet_id, annotation: { ...pointIntent, axis: 'x' }
  }) });
  assert.equal(state.sheet.annotations.find(a => a.id === point.id).value_mm, 40);
  state = await invoke('aether_cad_drawing_undo', { expected_revision: state.revision });
  assert.ok(Math.abs(state.sheet.annotations.find(a => a.id === point.id).value_mm - Math.hypot(40,20)) < 1e-8);
  state = await invoke('aether_cad_drawing_redo', { expected_revision: state.revision });
  assert.equal(state.sheet.annotations.find(a => a.id === point.id).value_mm, 40);
  const section=state.sheet.views.find(view=>view.section);assert.ok(section,'Inspect exposes section intent');assert.ok(section.hatch_lines>5);
  const revision=state.revision;
  await invoke('aether_cad_drawing_edit',{expected_revision:revision,command_json:JSON.stringify({type:'update-view',sheetId:state.active_sheet_id,viewId:section.id,changes:{section:{offsetMm:1000,hatchSpacingMm:2}}})},false);
  assert.equal((await invoke('aether_cad_drawing_inspect')).revision,revision);
  state=await invoke('aether_cad_drawing_edit',{expected_revision:revision,command_json:JSON.stringify({type:'update-view',sheetId:state.active_sheet_id,viewId:section.id,changes:{section:{offsetMm:7,hatchSpacingMm:2}}})});
  assert.equal(state.sheet.views.find(view=>view.id===section.id).section.offsetMm,7);
  state=await invoke('aether_cad_drawing_undo',{expected_revision:state.revision});
  assert.equal(state.sheet.views.find(view=>view.id===section.id).section.offsetMm,6);
  state=await invoke('aether_cad_drawing_redo',{expected_revision:state.revision});
  const oldRevision=state.revision;
  state=await invoke('aether_cad_drawing_edit',{expected_revision:state.revision,command_json:JSON.stringify({type:'add-annotation',sheetId:state.active_sheet_id,annotation:{id:'agent-note',kind:'note',text:'Agent-verified note',positionMm:[25,155]}})});
  await invoke('aether_cad_drawing_edit',{expected_revision:oldRevision,command_json:JSON.stringify({type:'remove-annotation',sheetId:state.active_sheet_id,annotationId:'agent-note'})},false);
  state=await invoke('aether_cad_drawing_undo',{expected_revision:state.revision});
  state=await invoke('aether_cad_drawing_redo',{expected_revision:state.revision});
  const exported=await invoke('aether_cad_drawing_export',{expected_revision:state.revision,format:'svg'});
  assert.ok(exported.text.includes('Agent-verified note'));assert.ok(exported.text.includes('data-layer="hatch"'));
  const pdf = await invoke('aether_cad_drawing_export', { expected_revision: state.revision, format: 'pdf', all_sheets: true });
  assert.equal(pdf.mime_type, 'application/pdf');
  assert.equal(pdf.changed, false);
  await checkPDF(Buffer.from(pdf.data_base64, 'base64'));
  await invoke('aether_cad_drawing_export', { expected_revision: state.revision, format: 'pdf', all_sheets: true, sheet_id: state.active_sheet_id }, false);
  assert.equal((await invoke('aether_cad_drawing_inspect')).revision, state.revision);
  await button('Agent connections').click(); await page.getByRole('radio',{name:'MCP agents',exact:true}).click();
  await button('Stop sharing editor').click();
  assert.ok(!(await tool('editor_list',{})).editors.some(e=>e.editor===editor));
  await page.locator('.aui-agent-connection-card').filter({has:page.getByText('Drawing fixture',{exact:true})}).getByRole('button',{name:'Revoke',exact:true}).click();
  await button('Done').click();
  await button('AI advisor').click();
}
