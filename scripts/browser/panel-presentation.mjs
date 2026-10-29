import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Real app geometry and transport notices, in both token-based appearances. */
export async function verifyPanelPresentation(page, evidence) {
  await page.emulateMedia({reducedMotion:'reduce'});
  const rail = page.getByRole('toolbar', {name:'Aux toolbar'});
  const sidebar = page.locator('.aui-studio-aux-sidebar');
  const header = sidebar.locator('.aui-side-panel-header');
  const bell = () => header.getByRole('button', {name:'Panel notifications'});
  const geometry = () => sidebar.evaluate(el => {
    const box = el.getBoundingClientRect();
    const bounds = target => {const b=target.getBoundingClientRect();return {x:b.x-box.x,y:b.y-box.y,width:b.width,height:b.height};};
    const head=el.querySelector('.aui-side-panel-header'), title=head.querySelector('h2'), style=getComputedStyle(title);
    return {bounds:bounds(head),size:style.fontSize,weight:style.fontWeight,color:style.color,icon:bounds(head.querySelector('svg')),bell:bounds(head.querySelector('[aria-label="Panel notifications"]'))};
  });
  for (const theme of ['dark','light']) {
    await page.evaluate(theme => {document.documentElement.classList.toggle('aether-light-theme',theme==='light');document.documentElement.dataset.aetherTheme=theme;},theme);
    let expected;
    for (const [tab,title] of [['Comments','Comments & tasks'],['AI advisor','AI chat'],['Files','Files'],['Version control','History & versions']]) {
      await rail.getByRole('button',{name:tab,exact:true}).click();
      await header.getByRole('heading',{name:title,exact:true}).waitFor();
      const measured=await geometry();
      if(expected) assert.deepEqual(measured,expected,`${theme}: ${tab} header differs`); else expected=measured;
      assert.equal(await sidebar.locator('[data-icon-missing]').count(),0);
      await page.screenshot({path:join(evidence,`panels-${theme}-${tab.replaceAll(' ','-')}.png`)});
    }
    const before=await geometry();
    await sidebar.getByRole('radio',{name:'Version control',exact:true}).click();
    const search=sidebar.getByRole('searchbox');const beforeSearch=await search.boundingBox();
    // Exercise the shared session's actual offline handler; hold retries until measured.
    await page.route('**/api/status',route=>route.abort());
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    await page.waitForFunction(()=>document.querySelector('.aui-studio-aux-sidebar .aui-panel-notifications-dot'));
    assert.deepEqual(await geometry(),before);
    assert.deepEqual(await search.boundingBox(),beforeSearch);
    await bell().click();
    const notice=page.getByRole('dialog',{name:'Panel notifications'});
    await notice.getByText('Live updates are disconnected. Your draft is kept. Reconnecting…',{exact:true}).waitFor();
    assert.deepEqual(await geometry(),before);
    await page.screenshot({path:join(evidence,`panels-${theme}-notification.png`)});
    await page.keyboard.press('Escape');
    await page.unroute('**/api/status');
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForFunction(()=>!document.querySelector('.aui-studio-aux-sidebar .aui-panel-notifications-dot'));
  }
  await page.evaluate(()=>{document.documentElement.classList.remove('aether-light-theme');document.documentElement.dataset.aetherTheme='dark';});
  await rail.getByRole('button',{name:'Files',exact:true}).click();
}
