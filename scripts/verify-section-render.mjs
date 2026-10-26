/** Exercise the actual clipping shader before and after live parameter changes. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
const {chromium}=createRequire(new URL('../../AetherStudio/core/files/package.json',import.meta.url))('@playwright/test');
const evidence=process.env.AETHER_SECTION_RENDER_EVIDENCE??'.verification/section-live-2026-10-26/render'; await mkdir(evidence,{recursive:true});
const vite=await createServer({configFile:false,server:{host:'127.0.0.1',port:0},plugins:[{name:'section-check',configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/section-check'))return next();res.setHeader('content-type','text/html');res.end('<script type="module" src="/scripts/browser/section-scene.ts"></script>');});}}]});
await vite.listen();
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']}), errors=[], results=[];
try {
 for(const backend of ['webgpu','webgl']) {
  const page=await browser.newPage({viewport:{width:400,height:400}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/section-check${backend==='webgl'?'?webgl':''}`);
  await page.waitForFunction(()=>window.sectionCheck);
  const counts=[];
  for(const options of [{offset:null},{offset:0},{offset:-5},{offset:5},{offset:0,second:true},{offset:0,second:true,reversed:true},{offset:0,excluded:true},{offset:0,top:true},{offset:null},
   {offset:10,top:true},{offset:0,oblique:true},{offset:-3,oblique:true,tilted:true},{offset:2,oblique:true,tilted:true,second:true},{offset:0,oblique:true,tilted:true,reversed:true}]) {
   const renderer=await page.evaluate(options=>window.sectionCheck.render(options),options);assert.equal(renderer.backend,backend);
   const bytes=await page.screenshot({path:`${evidence}/${backend}-${counts.length}.png`});
   const count=await page.evaluate(async ({encoded,probes})=>{
    const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+encoded)).blob());
    const canvas=document.createElement('canvas');canvas.width=400;canvas.height=400;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const p=ctx.getImageData(0,0,400,400).data;
    let count=0,cap=0;for(let i=0;i<p.length;i+=4){if(p[i+2]>80)count++;if(p[i]>p[i+2]+25)cap++;}
    const wrong=probes.filter(({x,y,type})=>{const i=(y*400+x)*4;const actual=p[i]>p[i+2]+25?'cap':p[i+2]>80?'body':'background';return actual!==type;});
    return {count,cap,wrong:wrong.slice(0,8),failures:wrong.length,probes:probes.length};
   },{encoded:bytes.toString('base64'),probes:renderer.probes});
   assert.equal(count.failures,0,`${backend}: ray/solid cut mismatch ${JSON.stringify({options,...count})}`);
   counts.push(count.count);if(options.top && options.offset===0)assert.ok(count.cap>65000,"the cut must be filled by a cap at the cutting plane");
   if(options.top && options.offset===10)assert.equal(count.cap,0,'a touching plane must not hatch the original exterior face');
  }
  results.push({backend,counts});console.log(backend,counts);
  assert.ok(Math.abs(counts[1]/counts[0]-.5)<.03,'first live section halves visible geometry');
  assert.ok(counts[2]<counts[1]*.6&&counts[3]>counts[1]*1.4,'offset updates affect the rendered cut');
  assert.ok(Math.abs(counts[4]/counts[0]-.25)<.03&&Math.abs(counts[5]/counts[0]-.25)<.03,'both planes and reversed direction clip together');
  assert.equal(counts[6],counts[0],'excluded bodies remain whole');
  assert.equal(counts[8],counts[0],'turning the section off restores the model');
  await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(`${evidence}/result.json`,JSON.stringify({passed:true,results,errors},null,2));
} finally {await browser.close();await vite.close();}
