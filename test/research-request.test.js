import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeResearchBody, parseAndCanonicalizeResearchBody } from '../lib/research-request.js';

test('equivalent visible queries canonicalize to the same research body', () => {
  const manual = canonicalizeResearchBody({
    brand: '',
    productName: '나이키 에어 포스 1 07 CW2288-111',
    modelCode: '',
    mode: 'resell',
    size: '260'
  });
  const structured = canonicalizeResearchBody({
    brand: '나이키',
    productName: '에어 포스 1 07',
    modelCode: 'CW2288-111',
    mode: 'resell',
    size: '260'
  });
  assert.deepEqual(manual, structured);
  assert.equal(manual.productName, '나이키 에어 포스 1 07 CW2288-111');
  assert.equal(manual.brand, '');
  assert.equal(manual.modelCode, '');
});

test('canonicalization normalizes width and whitespace but preserves mode and size', () => {
  const result = parseAndCanonicalizeResearchBody(JSON.stringify({
    brand: '  NIKE  ',
    productName: 'Air   Force  1',
    modelCode: 'ＣＷ２２８８－１１１',
    mode: 'resell',
    size: '260'
  }));
  assert.equal(result.productName, 'NIKE Air Force 1 CW2288-111');
  assert.equal(result.mode, 'resell');
  assert.equal(result.size, '260');
});
