import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const {chromium,webkit}=createRequire(new URL('../../AetherStudio/core/files/package.json',import.meta.url))('@playwright/test');
const destination=process.argv[2]??'build/picking-performance.json';
const vite=await createServer({configFile:false,server:{host:'127.0.0.1',port:0},plugins:[{name:'picking-profile',configureServer(server){
  server.middlewares.use((req,res,next)=>{if(req.url!=='/picking-profile')return next();res.setHeader('content-type','text/html');res.end('<script type="module" src="/scripts/browser/picking-performance.ts"></script>');});
}}]});
await vite.listen();
const results=[];
try {
  for(const [name,launcher] of [['chromium',chromium],['webkit',webkit]]){
    const browser=await launcher.launch({headless:true});
    try{
      const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/picking-profile`);
      await page.waitForFunction(()=>window.pickingPerformance);
      for(const args of [[1,256,160],[65,48,32]]){
        const result=await page.evaluate(args=>window.pickingPerformance(...args),args);
        assert.equal(result.mismatches,0); results.push({browser:name,...result}); console.log(JSON.stringify(results.at(-1)));
      }
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  }
  await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(results,null,2));
}finally{await vite.close();}
