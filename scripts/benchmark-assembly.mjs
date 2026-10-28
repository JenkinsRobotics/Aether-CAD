/** Same real browser, kernel and viewport for before/after assembly measurements. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = createRequire(new URL('../../AetherStudio/core/files/package.json',import.meta.url))('@playwright/test');
const evidence = process.env.AETHER_ASSEMBLY_PERFORMANCE_EVIDENCE ?? '.verification/assembly-performance-2026-10-28/candidate';
await mkdir(evidence, {recursive:true});
const vite = await createServer({configFile:false, worker:{format:'es'},
  optimizeDeps:{exclude:['replicad-opencascadejs','harfbuzzjs']},
  server:{host:'127.0.0.1',port:0}, plugins:[{name:'assembly-benchmark',configureServer(server){
    server.middlewares.use((req,res,next)=>{
      if(req.url !== '/assembly-benchmark') return next();
      res.setHeader('content-type','text/html');
      res.end('<script type="module" src="/scripts/browser/assembly-performance.ts"></script>');
    });
  }}]});
await vite.listen();
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
const errors=[], results=[];
try {
  const page = await browser.newPage({viewport:{width:1200,height:800}});
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/assembly-benchmark`);
  await page.waitForFunction(()=>window.assemblyPerformance, undefined, {timeout:120000});
  const cases = JSON.parse(process.env.AETHER_ASSEMBLY_PERFORMANCE_CASES ?? '[[100,10],[1000,10],[1000,1000]]');
  for(const [count,definitions] of cases) {
    const result = await page.evaluate(async ([count,definitions])=>window.assemblyPerformance.run(count,definitions),[count,definitions]);
    results.push(result); console.log(JSON.stringify(result));
    assert.match(result.backend,/WebGPU/);
    for(const phase of ['cold','warm','edit']) assert.equal(result[phase].bodies,count);
    assert.equal(result.cold.evaluations,definitions);
    assert.equal(result.warm.evaluations,0);
    assert.equal(result.edit.evaluations,1);
    assert.equal(result.retainedOnMove,count);
    assert.equal(result.retainedOnEdit,count-Math.ceil(count/definitions));
    assert.equal(result.faceHighlight,true);
    assert.equal(result.independentHighlight,true);
    await page.screenshot({path:`${evidence}/${count}-${definitions}.png`});
    await writeFile(`${evidence}/results.json`,JSON.stringify({results,errors},null,2));
  }
  assert.deepEqual(errors,[]);
} finally { await browser.close(); await vite.close(); }
