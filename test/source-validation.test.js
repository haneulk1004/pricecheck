import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResellSources, sourceValidationInternals } from '../lib/source-validation.js';

const requestBody = {
  mode: 'resell',
  brand: '나이키',
  productName: "나이키 에어포스 1 '07 로우 화이트 CW2288-111",
  modelCode: 'CW2288-111',
  size: '260'
};

const offer = {
  seller: 'KREAM',
  productName: "나이키 에어포스 1 '07 로우 화이트 (CW2288-111)",
  priceKRW: 104000,
  condition: '새상품',
  note: '260 기준',
  sources: [{ url: 'https://kream.co.kr/products/12831', title: 'kream.co.kr' }]
};

function response(html, { ok = true, contentType = 'text/html; charset=utf-8' } = {}) {
  return {
    ok,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    text: async () => html
  };
}

test('direct KREAM product page must contain model, exact price and selected size', async () => {
  const html = '<html>모델번호 CW2288-111 옵션 260 거래가 104,000원</html>';
  const result = await validateResellSources({ offers: [offer] }, requestBody, async () => response(html));
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].sources.length, 1);
});

test('KREAM style/social page is rejected before it can authorize a price', async () => {
  let calls = 0;
  const payload = { offers: [{ ...offer, sources: [{ url: 'https://kream.co.kr/social/users/test/posts/123', title: 'kream.co.kr' }] }] };
  const result = await validateResellSources(payload, requestBody, async () => { calls++; return response('CW2288-111 260 104000'); });
  assert.equal(result.offers.length, 0);
  assert.equal(calls, 0);
});

test('wrong product page is rejected even when size and price happen to appear', async () => {
  const html = '<html>모델번호 DR9503-200 사이즈 260 가격 104,000원</html>';
  const result = await validateResellSources({ offers: [offer] }, requestBody, async () => response(html));
  assert.equal(result.offers.length, 0);
});

test('page without the offered exact price is rejected', async () => {
  const html = '<html>모델번호 CW2288-111 사이즈 260 거래가 105,000원</html>';
  const result = await validateResellSources({ offers: [offer] }, requestBody, async () => response(html));
  assert.equal(result.offers.length, 0);
});

test('store mode is not changed by resell source validator', async () => {
  const payload = { offers: [{ ...offer, sources: [] }] };
  const result = await validateResellSources(payload, { ...requestBody, mode: 'store' }, async () => { throw new Error('must not fetch'); });
  assert.deepEqual(result, payload);
});

test('direct-listing URL policy rejects KREAM community pages', () => {
  const { isDirectListingUrl, modelCodesFromRequest } = sourceValidationInternals();
  assert.equal(isDirectListingUrl('https://kream.co.kr/products/12831'), true);
  assert.equal(isDirectListingUrl('https://kream.co.kr/social/users/a/posts/1'), false);
  assert.deepEqual(modelCodesFromRequest(requestBody), ['CW2288-111']);
});
