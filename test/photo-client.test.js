import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('  const handleFile ='),html.indexOf('  const confirmProduct ='))+'\n globalThis.handleFile=handleFile;';
function client(){
 const state={calls:[],error:'',canvases:[],revoked:0};
 class Image {naturalWidth=4000;naturalHeight=3000;set src(v){queueMicrotask(()=>this.onload());}}
 const context={Image,queueMicrotask,Blob,AbortController,setTimeout,clearTimeout,
 URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>state.revoked++},
 document:{createElement:()=>{const canvas={getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,YWJj'};state.canvases.push(canvas);return canvas;}},
 setIsLoading:v=>state.busy=v,setErrorMsg:v=>state.error=v,setPreviewImg:v=>state.preview=v,setView:v=>state.view=v,setProduct:v=>state.product=v,
 fetch:async(url,options)=>{state.calls.push({url,options});return {ok:true,json:async()=>({productName:'테스트 신발'})};}};
 vm.runInNewContext(code,context);return {state,run:file=>context.handleFile({target:{files:[file],value:'file'}})};
}
test('large photo is resized before the analysis request and reaches confirmation',async()=>{
 const c=client();await c.run({type:'image/jpeg',size:7*1024*1024});
 assert.equal(c.state.canvases[0].width,2000);assert.equal(c.state.canvases[0].height,1500);
 assert.equal(c.state.calls.length,1);assert.equal(c.state.view,'confirm');assert.equal(c.state.revoked,1);assert.equal(c.state.busy,false);
 assert.ok(Buffer.byteLength(c.state.calls[0].options.body)<4100000);
});
test('unsupported formats and originals over 8 MiB are rejected before analysis',async()=>{
 for(const file of [{type:'image/heic',size:100},{type:'image/jpeg',size:9*1024*1024}]){
 const c=client();await c.run(file);assert.equal(c.state.calls.length,0);assert.ok(c.state.error);}
});
