/** Exercise actual Studio revisions on the disposable document, including a merge. */
import assert from 'node:assert/strict';
import {matchingRowMenus} from './panel-menu-checks.mjs';

export async function verifyHistoryMenus(page, expect) {
  const button = name => page.getByRole('button',{name,exact:true});
  await button('Version control').click();
  const panel = page.getByRole('region',{name:'Version control',exact:true});
  await expect(panel).toBeVisible();
  const create = async (kind,name) => {
    await panel.getByRole('button',{name:`Create ${kind}`,exact:true}).click();
    const dialog = page.getByRole('dialog',{name:new RegExp(`^Create ${kind} from`)});
    await dialog.getByRole('textbox',{name:'Name',exact:true}).fill(name);
    await dialog.getByRole('button',{name:`Create ${kind}`,exact:true}).click();
    await expect(dialog).toHaveCount(0,{timeout:90000});
  };
  await create('version','Baseline');
  await create('branch','Fit study');
  // A new branch must exist in the graph even before it contains an edit.
  await expect(panel.getByRole('button',{name:'Select Fit study',exact:true})).toBeVisible({timeout:30000});
  const checkout = async name => {
    await panel.getByRole('button',{name:'Choose version branch'}).click();
    await page.getByRole('menuitemradio',{name,exact:true}).click();
    await expect(panel.getByRole('button',{name:'Choose version branch'})).toContainText(name,{timeout:90000});
    await expect(page.getByRole('treeitem',{name:/^Extrude/}).first()).toBeVisible({timeout:90000});
  };
  await checkout('Fit study');
  page.once('dialog',dialog=>dialog.accept('Extrude fit study'));
  const feature=page.getByRole('treeitem',{name:/^Extrude/}).first();
  await feature.click();await feature.focus();await page.keyboard.press('F2');
  await expect(page.getByRole('treeitem',{name:/^Extrude fit study/})).toBeVisible();
  await create('version','Fit checkpoint');
  await checkout('Main');
  await panel.getByRole('button',{name:'Merge branches'}).click();
  await page.getByRole('combobox',{name:'Merge source',exact:true}).selectOption({label:'Fit study'});
  await button('Merge into Main').click();
  await expect(page.getByRole('combobox',{name:'Merge source'})).toHaveCount(0,{timeout:90000});
  await create('version','Merged fit');
  await expect(panel.locator('.aui-vc-entry[data-kind="merge"]')).not.toHaveCount(0);
  const merged = panel.locator('.aui-vc-entry').filter({has:page.getByRole('button',{name:'Select Merged fit',exact:true})});
  await matchingRowMenus(page,merged,merged.getByRole('button',{name:'Version actions: Merged fit',exact:true}));
  await expect(page.getByRole('button',{name:'Selected version actions',exact:true})).toHaveCount(0);
  const select=merged.getByRole('button',{name:'Select Merged fit',exact:true});
  if(await select.getAttribute('aria-expanded')==='true')await select.click();
  await select.click();await expect(select).toHaveAttribute('aria-expanded','true');
  await select.click();await expect(select).toHaveAttribute('aria-expanded','false');
  await expect(panel.locator('.aui-vc-entry[data-selected="true"]')).toHaveCount(0);
  // SVG markers must stay centered on the actual rows after card collapse.
  await expect.poll(async()=>panel.locator('.aui-vc-graph').evaluate(graph=>{
    const top=graph.getBoundingClientRect().top;
    return [...graph.querySelectorAll('circle[data-node]')].every(circle=>{
      const row=[...graph.querySelectorAll('[data-entry-id]')].find(e=>e.dataset.entryId===circle.dataset.node);
      const head=row?.querySelector('.aui-vc-entry-head')?.getBoundingClientRect();
      return head && Math.abs(Number(circle.getAttribute('cy'))-(head.top+head.height/2-top))<2;
    });
  }),{timeout:10000}).toBe(true);
  const lanes=await panel.locator('circle[data-lane]').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.lane))]);
  assert.ok(lanes.length>1,'Branch and merge graph retains distinct lanes');
  const toolbar=panel.getByRole('toolbar',{name:'Version actions'}), before=await toolbar.boundingBox();
  await panel.getByRole('button',{name:'Version filters'}).click();
  assert.deepEqual(await toolbar.boundingBox(),before,'Filtering does not push the history down');
  await page.getByRole('menuitemradio',{name:'Branches',exact:true}).click();
  await panel.getByRole('button',{name:'Version filters'}).click();
  await page.getByRole('menuitemradio',{name:'All versions',exact:true}).click();
  await panel.screenshot({path:`${process.env.AETHER_FRONTEND_EVIDENCE}/version-branch-merge-graph.png`});
}
