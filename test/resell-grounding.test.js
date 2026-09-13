import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResellInteractionRequest, interactionToGenerateContent } from '../lib/resell-grounding.js';
import { parseGroundedPrices } from '../lib/price-research.js';

const input = { productName: 'Air Force 1', brand: 'Nike', modelCode: 'CW2288-111', mode: 'resell', size: '260' };
const legacy = {
  generationConfig: {
    maxOutputTokens: 4096,
    responseFormat: { text: { schema: { type: 'object', properties: { offers: { type: 'array' } } } } }
  }
};

test('resell request uses Interactions Google Search with supported request shape', () => {
  const request = buildResellInteractionRequest(legacy, input, 'gemini-3.8-flash');
  assert.equal(request.model, 'gemini-3.8-flash');
  assert.deepEqual(request.tools, [{ type: 'google_search', search_types: ['web_search'] }]);
  assert.equal(request.generation_config.max_output_tokens, 4096);
  assert.equal(request.generation_config.tool_choice, undefined);
  assert.match(request.system_instruction, /Google Search/);
  assert.match(request.input, /CW2288-111/);
  assert.match(request.input, /260/);
  assert.equal(request.response_format.mime_type, 'application/json');
  assert.equal(request.store, false);
});

test('Interactions citations are converted for the existing verifier', () => {
  const text = JSON.stringify({ offers: [{ seller: 'seller', productName: 'Air Force 1 CW2288-111 260', priceKRW: 120000, condition: 'asking', note: '260mm' }] });
  const token = '120000';
  const start = Buffer.byteLength(text.slice(0, text.indexOf(token)), 'utf8');
  const converted = interactionToGenerateContent({
    status: 'completed',
    steps: [
      { type: 'google_search_call', arguments: { queries: ['CW2288-111 260'] } },
      { type: 'model_output', content: [{ type: 'text', text, annotations: [{ type: 'url_citation', url: 'https://example.com/item', title: 'source', start_index: start, end_index: start + Buffer.byteLength(token) }] }] }
    ]
  });
  const result = parseGroundedPrices(converted);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].priceKRW, 120000);
  assert.equal(result.offers[0].sources.length, 1);
});

test('Korean output accepts UTF-8 byte citation offsets', () => {
  const text = JSON.stringify({ offers: [{ seller: '판매처', productName: '나이키 에어 포스 1 07 CW2288-111 260', priceKRW: 119200, condition: '판매가', note: '260mm' }] });
  const token = '119200';
  const charIndex = text.indexOf(token);
  const start = Buffer.byteLength(text.slice(0, charIndex), 'utf8');
  assert.ok(start > charIndex);
  const converted = interactionToGenerateContent({
    status: 'completed',
    steps: [
      { type: 'google_search_call', arguments: { queries: ['CW2288-111 260 리셀'] } },
      { type: 'google_search_result', result: [{ search_suggestions: '<div>search</div>' }] },
      { type: 'model_output', content: [{ type: 'text', text, annotations: [{ type: 'url_citation', url: 'https://example.com/korean-item', title: '판매처', start_index: start, end_index: start + Buffer.byteLength(token) }] }] }
    ]
  });
  const result = parseGroundedPrices(converted);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].priceKRW, 119200);
  assert.equal(result.offers[0].sources[0].url, 'https://example.com/korean-item');
});
