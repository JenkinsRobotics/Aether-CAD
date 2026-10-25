import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Real user-authorized sharing UI and authenticated MCP transport for fixtures.
 * Keys stay in this process; never written to evidence or console. */
export async function connectLiveAgent(page, origin, fileId, name) {
  const button = label => page.getByRole('button', { name: label, exact: true });
  if (!await page.getByRole('textbox', { name: /^Ask / }).isVisible()) await button('AI advisor').click();
  await button('Agent connections').click();
  await page.getByRole('radio', { name: 'MCP agents', exact: true }).click();
  await page.getByText('Use a connection key', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Agent connection name', exact: true }).fill(name);
  await button('Create connection key').click();
  const key = await page.getByRole('textbox', { name: 'Connection key', exact: true }).inputValue();
  const mcp = async (method, params) => {
    const response = await fetch(origin + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }) });
    const result = await response.json();
    assert.equal(response.ok, true, JSON.stringify(result));
    return result;
  };
  await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'cad-projection-fixture', version: '1' } });
  const tool = async (name, args, allowError = false) => {
    const response = await mcp('tools/call', { name, arguments: args });
    if (!allowError) assert.equal(response.result?.isError, false, JSON.stringify(response));
    return response.result.structuredContent;
  };
  await button('Share this editor').click();
  await button('Stop sharing editor').waitFor();
  let editor;
  for (let i = 0; i < 100 && !editor; i++) {
    editor = (await tool('editor_list', {})).editors.find(e => e.document === fileId && e.app === 'cad')?.editor;
    if (!editor) await page.waitForTimeout(100);
  }
  assert.ok(editor, 'CAD editor registered');
  const catalog = (await tool('editor_inspect', { editor })).editor.tools;
  await button('Done').click();
  return {
    catalog,
    async invoke(name, args = {}, success = true) {
      const operation = randomUUID();
      const accepted = await mcp('tools/call', { name: 'editor_invoke', arguments: { editor, name, arguments: args, operation }, _meta: { 'aether/operationId': operation } });
      assert.equal(accepted.result?.isError, false, JSON.stringify(accepted));
      for (let i = 0; i < 300; i++) {
        const receipt = (await tool('editor_result', { editor, operation }, !success)).live_editor;
        if (receipt.state === 'completed') {
          assert.equal(receipt.reply.ok, success, JSON.stringify(receipt));
          return receipt.reply.value;
        }
        assert.ok(['queued', 'running'].includes(receipt.state), JSON.stringify(receipt));
        await page.waitForTimeout(100);
      }
      throw Error('CAD agent operation timed out');
    },
    async dispose() {
      await button('Agent connections').click();
      await page.getByRole('radio', { name: 'MCP agents', exact: true }).click();
      await button('Stop sharing editor').click();
      assert.ok(!(await tool('editor_list', {})).editors.some(e => e.editor === editor));
      await page.locator('.aui-agent-connection-card').filter({ has: page.getByText(name, { exact: true }) }).getByRole('button', { name: 'Revoke', exact: true }).click();
      await button('Done').click();
    },
  };
}
