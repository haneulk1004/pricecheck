import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSources, dedupeResearchPayload } from '../lib/source-dedupe.js';

test('duplicate URLs within one offer are shown once', () => {
  const sources = [
    { url: 'https://kream.co.kr/products/123', title: 'kream.co.kr' },
    { url: 'https://kream.co.kr/products/123#price', title: 'kream.co.kr' },
    { url: 'https://kream.co.kr/products/123/', title: 'kream.co.kr' },
    { url: 'https://bunjang.co.kr/products/456', title: 'bunjang.co.kr' }
  ];
  const result = dedupeSources(sources);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'kream.co.kr');
  assert.equal(result[1].title, 'bunjang.co.kr');
});

test('cached and fresh research payloads are cleaned without changing offer data', () => {
  const payload = {
    cached: true,
    offers: [{ seller: 'KREAM', priceKRW: 99000, sources: [
      { url: 'https://kream.co.kr/products/123', title: 'kream.co.kr' },
      { url: 'https://kream.co.kr/products/123#again', title: 'kream.co.kr' }
    ] }]
  };
  const result = dedupeResearchPayload(payload);
  assert.equal(result.cached, true);
  assert.equal(result.offers[0].priceKRW, 99000);
  assert.equal(result.offers[0].sources.length, 1);
});
