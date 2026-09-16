import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareResearchPayload } from '../api/research.js';
import { createResearchHandler, parseGroundedPrices, normalizeInput, hashClientIP, cacheKey, ADMIT_SCRIPT, classifyProviderError, dailyLimits } from '../lib/price-research.js';

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
function harness({ admission = ['ALLOW', 4, 1900000000], provider = grounded(), providerStatus = 200, redisFails = false, overrides = {}, preparePayload } = {}) {
  const calls = [], logs = [];
  const fetchImpl = async(url, options) => {
    const request = JSON.parse(options.body); calls.push({url,request});
    if (url === env.UPSTASH_REDIS_REST_URL) {
      if (redisFails) throw new Error('error containing sensitive data');
      return { ok: true, json: async()=>({ result: request[0] === 'EVAL' ? admission : 'OK' }) };
    }
    return { ok: providerStatus === 200, status: providerStatus, json: async()=>provider };
  };
  return { calls, logs, handler: createResearchHandler({env:{...env,...overrides},fetchImpl,preparePayload,log:line=>logs.push(line)}) };
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
  assert.deepEqual(h.calls[0].request.slice(-2),['5','300']);
  assert.match(h.calls[1].url,/gemini-3\.8-flash:generateContent$/);
  assert.deepEqual(h.calls[1].request.tools,[{google_search:{}}]);
  assert.equal(h.calls[1].request.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON');
  assert.equal(h.calls[1].request.generationConfig.responseFormat.text.schema.type,'object');
  assert.equal(h.calls[1].request.generationConfig.responseMimeType,undefined);
  assert.deepEqual(h.calls[2].request.slice(-2),['EX','86400']);
  assert.ok(!JSON.stringify(h.calls).includes('203.0.113.42')); assert.ok(!JSON.stringify(h.logs).includes('203.0.113.42'));
  assert.match(h.calls[0].request[4],/:ip:[a-f0-9]{64}$/);
});

test('Preview/Production limits can be configured without code changes', async()=>{
  const h = harness({overrides:{PER_IP_DAILY_LIMIT:'10',GLOBAL_DAILY_LIMIT:'400'}}); const res = await run(h);
  assert.equal(res.statusCode,200);
  assert.deepEqual(h.calls[0].request.slice(-2),['10','400']);
  assert.deepEqual(res.data.limits,{ipDaily:10,globalDaily:400});
  assert.deepEqual(dailyLimits({...env,PER_IP_DAILY_LIMIT:'10',GLOBAL_DAILY_LIMIT:'400'}),{ipLimit:10,globalLimit:400});
});

test('invalid configured limits fail closed before network access', async()=>{
  for (const overrides of [{PER_IP_DAILY_LIMIT:'0'},{PER_IP_DAILY_LIMIT:'abc'},{PER_IP_DAILY_LIMIT:'101'},{GLOBAL_DAILY_LIMIT:'10001'}]) {
    const h = harness({overrides}); const res = await run(h);
    assert.equal(res.statusCode,503); assert.equal(res.data.code,'CONFIG_UNAVAILABLE'); assert.equal(h.calls.length,0);
  }
});

test('configured IP limit is reflected in the limit message', async()=>{
  const h = harness({admission:['IP_LIMIT',3600],overrides:{PER_IP_DAILY_LIMIT:'10'}}); const res = await run(h);
  assert.equal(res.statusCode,429); assert.match(res.data.error,/10회/); assert.equal(h.calls.length,1);
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
test('provider diagnostics log classification only, never messages, keys, metadata or IPs',async()=>{
  const h=harness({providerStatus:400,provider:{error:{code:400,status:'INVALID_ARGUMENT',message:'Invalid value at generation_config.response_format.text.mime_type (enum). SECRET 203.0.113.42',details:[{reason:'INVALID_ARGUMENT',metadata:{apiKey:'SECRET'},fieldViolations:[{field:'SECRET',description:'SECRET'}]},{reason:'secret with spaces'}]}}});
  const res=await run(h); const log=JSON.parse(h.logs.find(line=>line.includes('provider_error')));
  assert.equal(res.statusCode,502); assert.equal(h.calls.length,2);
  assert.deepEqual(log.error,{code:400,status:'INVALID_ARGUMENT',details:[{reason:'INVALID_ARGUMENT'}],classification:'INVALID_MIME_TYPE'});
  assert.ok(!JSON.stringify(h.logs).includes('SECRET')); assert.ok(!JSON.stringify(h.logs).includes('203.0.113.42'));
  assert.ok(!JSON.stringify(res.data).includes('INVALID_ARGUMENT'));
});
test('malformed provider error fields cannot inject arbitrary log content',()=>{
  assert.deepEqual(classifyProviderError({error:{code:'400 secret',status:{key:'secret'},details:{reason:'secret'},message:42}}),{code:undefined,status:undefined,details:[],classification:'UNCLASSIFIED'});
  assert.equal(classifyProviderError(null).classification,'UNCLASSIFIED');
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
  const positions=["redis.call('GET', KEYS[1])",'if ip >= ipLimit','if total >= globalLimit',"redis.call('INCR', ipkey)","redis.call('INCR', globalkey)"].map(s=>ADMIT_SCRIPT.indexOf(s));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions); assert.ok(positions.every(n=>n>=0));
});


test('seller validation rejects fresh prices before cache write', async () => {
  const h = harness({ preparePayload: prepareResearchPayload });
  const res = await run(h);
  assert.equal(res.statusCode, 422);
  assert.equal(res.data.code, 'NO_VERIFIED_PRICES');
  assert.equal(h.calls.filter(call => call.request[0] === 'SET').length, 0);
});

test('only final validated payload is cached and returned', async () => {
  const h = harness({ preparePayload: payload => ({ ...payload, offers: payload.offers.map(offer => ({ ...offer, note: 'validated' })) }) });
  const res = await run(h);
  assert.equal(res.statusCode, 200);
  const write = h.calls.find(call => call.request[0] === 'SET');
  assert.equal(JSON.parse(write.request[2]).offers[0].note, 'validated');
  assert.deepEqual(JSON.parse(write.request[2]).offers, res.data.offers);
});

test('cached validation failure does not mark an uncharged request for refund', async () => {
  const payload = { ...parseGroundedPrices(grounded()), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const h = harness({ admission: ['CACHE', JSON.stringify(payload)], preparePayload: prepareResearchPayload });
  const req = { method: 'POST', body, headers: { 'x-vercel-forwarded-for': '203.0.113.42' } };
  const res = resMock();
  await h.handler(req, res);
  assert.equal(res.statusCode, 422);
  assert.equal(req.researchAdmission, null);
  assert.equal(h.calls.length, 1);
});

test('charged failures retain their original admission reset for refund', async () => {
  const h = harness({ providerStatus: 503 });
  const req = { method: 'POST', body, headers: { 'x-vercel-forwarded-for': '203.0.113.42' } };
  await h.handler(req, resMock());
  assert.deepEqual(req.researchAdmission, { resetAt: 1900000000 });
});
