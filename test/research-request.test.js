import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalResearchIdentity, canonicalizeResearchBody, parseAndCanonicalizeResearchBody } from '../lib/research-request.js';

test('structured research fields are preserved for downstream grounding', () => {
  const input = {
    brand: 'Nike',
    productName: "Air Force 1 '07",
    modelCode: 'CW2288-111',
    mode: 'resell',
    size: '260'
  };
  assert.deepEqual(canonicalizeResearchBody(input), input);
  assert.deepEqual(parseAndCanonicalizeResearchBody(JSON.stringify(input)), input);
});

test('canonical cache identity normalizes query while preserving mode and size', () => {
  const identity = canonicalResearchIdentity({
    brand: '  NIKE  ',
    productName: 'Air   Force  1',
    modelCode: 'ＣＷ２２８８－１１１',
    mode: 'resell',
    size: '260'
  });
  assert.equal(identity.query, 'NIKE Air Force 1 CW2288-111');
  assert.equal(identity.mode, 'resell');
  assert.equal(identity.size, '260');
});
