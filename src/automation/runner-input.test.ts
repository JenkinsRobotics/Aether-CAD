import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
const runner=fileURLToPath(new URL('../../service/aether_cad_service/runtime/runner.mjs',import.meta.url));
async function request(chunks:string[]){
 const child=spawn(process.execPath,[runner],{stdio:['pipe','pipe','pipe']});let output='';let errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
 const complete=new Promise<string>((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code?reject(Error(errors)):resolve(output));});
 for(const chunk of chunks){child.stdin.write(chunk);await new Promise(resolve=>setTimeout(resolve,40));}child.stdin.end();return JSON.parse(await complete);
}
it('reads a complete request even when piped JSON arrives in delayed chunks',async()=>{const json=JSON.stringify({command:'cad.part.docs',arguments:{query:'extrude'}});const result=await request([json.slice(0,3),json.slice(3,20),json.slice(20)]);expect(result.error).toBeUndefined();expect(result.result.tools.some((tool:{name:string})=>tool.name==='aether_cad_extrude')).toBe(true);});
it('reports malformed completed input as a failure',async()=>{expect((await request(['{"command":'])).error).toBeTruthy();});
