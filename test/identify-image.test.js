import test from 'node:test';
import assert from 'node:assert/strict';
import { readableGroundedImage, resolveProductImage, createIdentifyHandler } from '../api/identify.js';
const uri = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/example';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9V8AAAAASUVORK5CYII=', 'base64');
const imageResponse = () => new Response(png, {headers:{'content-type':'image/png'}});

test('grounded raster bytes are embedded without a browser redirect', async () => {
  const value = await readableGroundedImage(uri, async () => imageResponse());
  assert.equal(value, `data:image/png;base64,${png.toString('base64')}`);
});

test('unreadable, oversized, forged or non-image responses are rejected', async () => {
  for (const response of [
    new Response('<html>error</html>', {headers:{'content-type':'text/html'}}),
    new Response('<svg/>', {headers:{'content-type':'image/svg+xml'}}),
    new Response('not a PNG', {headers:{'content-type':'image/png'}}),
    new Response(png, {headers:{'content-type':'image/png','content-length':'1500001'}}),
    new Response(new Uint8Array(1500001), {headers:{'content-type':'image/png'}}),
    new Response('error', {status:502})
  ]) assert.equal(await readableGroundedImage(uri, async () => response), null);
  assert.equal(await readableGroundedImage(uri, async () => { throw new Error('network'); }), null);
  let called = false;
  assert.equal(await readableGroundedImage('https://example.com/image.png', async () => { called = true; }), null);
  assert.equal(called, false);
});

test('exact volume image keeps attribution and skips wrong-volume evidence', async () => {
  const fetchImpl = async url => {
    if (url.includes('wikidata') || url.includes('wikimedia')) return new Response('{}');
    if (url.includes('generateContent')) return Response.json({candidates:[{groundingMetadata:{
      groundingChunks:[
        {image:{title:'해태 갈아만든 배 238ml', imageUri:uri+'/wrong', sourceUri:'https://shop.example/wrong'}},
        {image:{title:'해태 갈아만든 배 340ml', imageUri:uri, sourceUri:'https://shop.example/product'}}
      ], searchEntryPoint:{renderedContent:'<div>Search suggestions</div>'}
    }}]});
    assert.equal(url, uri);
    return imageResponse();
  };
  const result = await resolveProductImage('갈아만든 배 340ml', fetchImpl, {brand:'해태',query:'해태 갈아만든 배 340ml',apiKey:'test'});
  assert.match(result.imageUrl, /^data:image\/png;base64,/);
  assert.equal(result.imageSourceUrl, 'https://shop.example/product');
  assert.equal(result.imageProvider, 'google-image-search');
  assert.ok(result.imageSearchSuggestionsHtml);
});

test('image failure preserves identified product and never fabricates a preview', async () => {
  const fetchImpl = async url => url.includes('/interactions')
    ? Response.json({output_text:JSON.stringify({brand:'해태',productName:'갈아만든 배 340ml',confidence:95})})
    : new Response('{}', {status:502});
  const res = {setHeader(){}, status(code){this.code=code;return this;}, json(data){this.data=data;return this;}};
  await createIdentifyHandler({env:{GEMINI_API_KEY:'test'},fetchImpl,log(){}})({method:'POST',body:{query:'해태 갈아만든 배 340ml'}}, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.productName, '갈아만든 배 340ml');
  assert.equal(res.data.imageUrl, '');
});
