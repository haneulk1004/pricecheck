import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchHandler, parseGroundedPrices, normalizeInput, hashClientIP, cacheKey, ADMIT_SCRIPT } from '../lib/price-research.js';

const env = { GEMINI_API_KEY: 'test-key', UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: 'test-token', IP_HASH_SECRET: 's'.repeat(32), VERCEL: '1' };
const body = { productName: '테스트 운동화', brand: '브랜드', modelCode: 'MODEL-1', mode: 'store' };
function grounded({ sources = true, supported = true, price = 120000 } = {}) {
  const text = JSON.stringify({ offers: [{ seller: '공식몰', productName: '테스트 운동화 MODEL-1', priceKRW: price, condition: '새 상품', note: '배송 별도' }] });
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] }, groundingMetadata: {
    groundingChunks: sources ? [{ web: { uri: 'https://shop.example/product/1', title: '공식몰' } }] : [],
    groundingSupports: supported ? [{ segment: { startIndex: 0, endIndex: Buffer.byteLength(text), text }, groundingChunkIndices: [0] }] : [],
    searchEntryPoint: { renderedContent: '<div>Google</div>' }
  } }] };
}
function resMock() { return { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(data) { this.data = data; return this; } }; }
function harness({ admission = ['ALLOW', 4, 1900000000], provider = grounded(), providerStatus = 200, redisFails = false, overrides = {} } = {}) {
  const calls = [], logs = [];
  const fetchImpl = async(url, options) => {
    const request = JSON.parse(options.body); calls.push({url,request});
    if (url === env.UPSTASH_REDIS_REST_URL) {
      if (redisFails) throw new Error('error containing sensitive data');
      return { ok: true, json: async()=>({ result: request[0] === 'EVAL' ? admission : 'OK' }) };
    }
    return { ok: providerStatus === 200, status: providerStatus, json: async()=>provider };
  };
  return { calls, logs, handler: createResearchHandler({env:{...env,...overrides},fetchImpl,log:line=>logs.push(line)}) };
}
async function run(h, changes = {}) {
  const res = resMock();
  await h.handler({method:'POST',body,headers:{'x-vercel-forwarded-for':'203.0.113.42'},...changes}, res);
  return res;
}

test('new research checks Redis before exactly one grounded call, then caches 24 hours', async()=>{
  const h = harness(); const res = await run(h);
  assert.equal(res.statusCode,200); assert.equal(res.data.remaining,4); assert.equal(res.data.cached,false);
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(h.calls.length,3); assert.equal(h.calls[0].request[0],'EVAL');
  assert.match(h.calls[1].url,/gemini-3\.8-flash:generateContent$/);
  assert.deepEqual(h.calls[1].request.tools,[{google_search:{}}]);
  assert.equal(h.calls[1].request.generationConfig.responseFormat.text.mimeType,'application/json');
  assert.deepEqual(h.calls[2].request.slice(-2),['EX','86400']);
  assert.ok(!JSON.stringify(h.calls).includes('203.0.113.42')); assert.ok(!JSON.stringify(h.logs).includes('203.0.113.42'));
  assert.match(h.calls[0].request[4],/:ip:[a-f0-9]{64}$/);
});

test('cached prices are returned even if limits have been exhausted, with no further calls', async()=>{
  const payload = {...parseGroundedPrices(grounded()),expiresAt:new Date(Date.now()+60000).toISOString()};
  const h = harness({admission:['CACHE',JSON.stringify(payload)]}); const res = await run(h);
  assert.equal(res.statusCode,200); assert.equal(res.data.cached,true); assert.equal(h.calls.length,1); assert.equal(res.data.remaining,undefined);
});
for (const code of ['IP_LIMIT','GLOBAL_LIMIT']) test(`${code} prevents all provider calls`, async()=>{
  const h = harness({admission:[code,3600]}); const res = await run(h);
  assert.equal(res.statusCode,429); assert.equal(res.data.code,code); assert.equal(res.headers['Retry-After'],'3600'); assert.equal(h.calls.length,1);
});
test('Redis outage fails closed', async()=>{
  const h=harness({redisFails:true}); const res=await run(h); assert.equal(res.statusCode,503); assert.equal(h.calls.length,1);
  assert.ok(!JSON.stringify(h.logs).includes('sensitive'));
});
for (const options of [{sources:false},{supported:false},{price:-1},{price:0}]) test(`unverified prices discarded: ${JSON.stringify(options)}`,async()=>{
  const h=harness({provider:grounded(options)}); const res=await run(h);
  assert.equal(res.statusCode,422); assert.equal(res.data.offers,undefined); assert.equal(h.calls.length,2);
});
test('provider errors are sanitized and never retried or cached',async()=>{
  const h=harness({providerStatus:429,provider:{error:{message:'secret'}}}); const res=await run(h);
  assert.equal(res.statusCode,502); assert.equal(h.calls.length,2); assert.ok(!JSON.stringify(res.data).includes('secret'));
});
test('missing secret fails closed before network access',async()=>{
  const h=harness({overrides:{IP_HASH_SECRET:''}}); const res=await run(h); assert.equal(res.statusCode,503); assert.equal(h.calls.length,0);
});
test('existing nonempty HMAC secret is accepted without an unrelated length policy',async()=>{
  const h=harness({overrides:{IP_HASH_SECRET:'existing-secret'}}); const res=await run(h); assert.equal(res.statusCode,200);
});
test('input and method validation prevents paid work',async()=>{
  for (const changes of [{method:'GET'},{body:{...body,productName:''}},{body:{...body,mode:'other'}},{body:'{broken'},{body:{...body,productName:'a'.repeat(161)}}]) {
    const h=harness(); const res=await run(h,changes); assert.ok([400,405].includes(res.statusCode)); assert.equal(h.calls.length,0);
  }
});
test('untrusted IP headers cannot supply identity in local or deployed mode',()=>{
  assert.throws(()=>hashClientIP({headers:{'x-forwarded-for':'203.0.113.1'}},env));
  assert.throws(()=>hashClientIP({headers:{'x-vercel-forwarded-for':'203.0.113.1, 203.0.113.2'}},env));
  const request=ip=>({headers:{'x-vercel-forwarded-for':ip}});
  assert.equal(hashClientIP(request('2001:db8::1'),env),hashClientIP(request('2001:0db8:0:0:0:0:0:1'),env));
  assert.equal(hashClientIP(request('203.0.113.42'),env),hashClientIP(request('::ffff:203.0.113.42'),env));
  assert.notEqual(hashClientIP(request('203.0.113.42'),env),hashClientIP(request('203.0.113.42'),{...env,IP_HASH_SECRET:'z'.repeat(32)}));
});
test('cache key normalizes whitespace/case and separates mode, size and model',()=>{
  const key = cacheKey(normalizeInput(body));
  assert.equal(key,cacheKey(normalizeInput({...body,modelCode:'  model-1  '})));
  for (const update of [{modelCode:'MODEL-2'},{mode:'resell',size:'270'},{mode:'resell',size:'280'}]) assert.notEqual(key,cacheKey(normalizeInput({...body,...update})));
  assert.notEqual(cacheKey(normalizeInput({...body,mode:'resell',size:'270'})),cacheKey(normalizeInput({...body,mode:'resell',size:'280'})));
});
test('product-only citations cannot authorize an unsupported price; non-HTTPS source removed',()=>{
  const data=grounded(); data.candidates[0].groundingMetadata.groundingSupports[0].segment.endIndex=10;
  assert.throws(()=>parseGroundedPrices(data),{code:'NO_VERIFIED_PRICES'});
  const unsafe=grounded(); unsafe.candidates[0].groundingMetadata.groundingChunks[0].web.uri='javascript:alert(1)';
  assert.throws(()=>parseGroundedPrices(unsafe),{code:'NO_SOURCES'});
});
test('missing finish or partial JSON is rejected',()=>{
  const data=grounded(); data.candidates[0].finishReason='MAX_TOKENS'; assert.throws(()=>parseGroundedPrices(data),{code:'INVALID_RESPONSE'});
});
test('Lua admission order is cache, IP, global, then counters',()=>{
  const positions=["redis.call('GET', KEYS[1])",'if ip >= 5','if total >= 300',"redis.call('INCR', ipkey)","redis.call('INCR', globalkey)"].map(s=>ADMIT_SCRIPT.indexOf(s));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions); assert.ok(positions.every(n=>n>=0));
});
