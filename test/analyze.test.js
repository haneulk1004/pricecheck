import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalyzeHandler} from '../api/analyze.js';
function harness(response, thrown){
 const logs=[],calls=[];
 const handler=createAnalyzeHandler({env:{GEMINI_API_KEY:'test-key'},log:x=>logs.push(x),fetchImpl:async(url,options)=>{calls.push({url,options});if(thrown)throw thrown;return response;}});
 const run=async(body={imageBase64:'YWJj',mimeType:'image/jpeg'})=>{const res={setHeader(){},status(n){this.statusCode=n;return this;},json(d){this.data=d;return this;}};await handler({method:'POST',body},res);return res;};
 return {run,logs,calls};
}
test('photo errors do not expose provider bodies or exception messages',async()=>{
 const h=harness({ok:false,status:400,json:async()=>({error:{code:400,status:'INVALID_ARGUMENT',message:'SECRET_IMAGE SECRET_KEY'}})});
 const r=await h.run();assert.equal(r.statusCode,502);assert.ok(!JSON.stringify([h.logs,r.data]).includes('SECRET'));
 const e=harness(null,new Error('SECRET_EXCEPTION'));await e.run();assert.ok(!JSON.stringify(e.logs).includes('SECRET'));
});
test('oversized and invalid images never call Gemini',async()=>{
 const h=harness(null);
 for(const body of [{imageBase64:'A'.repeat(4000004)},{imageBase64:'????'},{imageBase64:'YWJj',mimeType:'image/svg+xml'}]){
 const r=await h.run(body);assert.ok([400,413].includes(r.statusCode));
 } assert.equal(h.calls.length,0);
});
test('photo timeout is classified safely',async()=>{
 const h=harness(null,Object.assign(new Error('SECRET'),{name:'TimeoutError'}));const r=await h.run();
 assert.equal(r.statusCode,504);assert.match(r.data.error,/시간/);assert.ok(!JSON.stringify(h.logs).includes('SECRET'));
});
test('photo success preserves identification contract and disables storage',async()=>{
 const h=harness({ok:true,json:async()=>({steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({brand:'브랜드',productName:'신발',modelCode:'ABC',confidence:85})}]}]})});
 const r=await h.run();assert.equal(r.statusCode,200);assert.equal(r.data.productName,'신발');
 const body=JSON.parse(h.calls[0].options.body);assert.equal(body.store,false);assert.equal(body.input[1].mime_type,'image/jpeg');assert.ok(h.calls[0].options.signal);
});
