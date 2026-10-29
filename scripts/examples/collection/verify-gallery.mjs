import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium,expect}=createRequire(fileURLToPath(new URL('../../../../AetherStudio/core/files/package.json',import.meta.url)))('@playwright/test');
const origin=process.env.AETHER_TEST_ORIGIN,evidence=process.env.AETHER_FRONTEND_EVIDENCE;
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'8780');
await mkdir(evidence,{recursive:true});const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(origin+'/cad/');await page.locator('input[name="username"]').fill('editor');await page.locator('input[name="password"]').fill('account-test-password-2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('input[name="password"]')).toHaveCount(0,{timeout:30000});await page.waitForLoadState('networkidle');
 await page.goto(origin+'/cad/?examples=1');await expect(page.locator('.cad-examples-grid article')).toHaveCount(10);
 await page.locator('.cad-example-image img').evaluateAll(images=>images.forEach(i=>i.loading='eager'));
 await expect.poll(()=>page.locator('.cad-example-image img').evaluateAll(images=>images.filter(i=>i.complete&&i.naturalWidth>0).length)).toBe(10);
 await page.screenshot({path:join(evidence,'gallery-dark.png')});
 await page.getByRole('textbox',{name:'Search examples'}).fill('reference');await expect(page.locator('.cad-examples-grid article')).toHaveCount(5);
 await page.screenshot({path:join(evidence,'gallery-references.png')});
 await page.evaluate(()=>document.documentElement.classList.add('aether-light-theme'));await page.screenshot({path:join(evidence,'gallery-light.png')});
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'result.json'),JSON.stringify({cards:10,images:10,referenceSearch:5,errors},null,2));
}finally{await browser.close();}
