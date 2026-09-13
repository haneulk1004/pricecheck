import test from 'node:test';
import assert from 'node:assert/strict';
import { strengthenResellGroundingBody } from '../lib/resell-grounding.js';

const base = input => ({
  systemInstruction: { parts: [{ text: 'base prompt' }] },
  contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
  tools: [{ google_search: {} }]
});

test('resell mode strengthens the request with explicit current web search and size', () => {
  const input = { productName: '나이키 에어 포스 1 07', brand: '나이키', modelCode: 'CW2288-111', mode: 'resell', size: '260' };
  const result = strengthenResellGroundingBody(base(input));
  const systemText = result.systemInstruction.parts.map(part => part.text).join(' ');
  const userText = result.contents[0].parts[0].text;
  assert.match(systemText, /RESALE MODE/);
  assert.match(systemText, /Google Search is required/);
  assert.match(systemText, /KREAM/);
  assert.match(systemText, /SOLDOUT/);
  assert.match(userText, /Use Google Search now/);
  assert.match(userText, /CW2288-111/);
  assert.match(userText, /260/);
  assert.deepEqual(result.tools, [{ google_search: {} }]);
});

test('store mode request is left unchanged', () => {
  const request = base({ productName: '테스트', mode: 'store' });
  assert.equal(strengthenResellGroundingBody(request), request);
});

test('malformed content is left unchanged', () => {
  const request = { contents: [{ parts: [{ text: 'not-json' }] }] };
  assert.equal(strengthenResellGroundingBody(request), request);
});
