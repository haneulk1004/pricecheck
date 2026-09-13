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

test('resell request uses Interactions with forced Google Search', () => {
  const request = buildResellInteractionRequest(legacy, input, 'gemini-3.8-flash');
  assert.equal(request.model, 'gemini-3.8-flash');
  assert.deepEqual(request.tools, [{ type: 'google_search' }]);
  assert.equal(request.generation_config.tool_choice, 'any');
  assert.equal(request.response_format.mime_type, 'application/json');
  assert.equal(request.store, false);
});

test('Interactions citations are converted for the existing verifier', () => {
  const text = JSON.stringify({ offers: [{ seller: 'seller', productName: 'Air Force 1 CW2288-111 260', priceKRW: 120000, condition: 'asking', note: '260mm' }] });
  const token = '120000';
  const start = text.indexOf(token);
  const converted = interactionToGenerateContent({
    status: 'completed',
    steps: [
      { type: 'google_search_call', arguments: { queries: ['CW2288-111 260'] } },
      { type: 'model_output', content: [{ type: 'text', text, annotations: [{ type: 'url_citation', url: 'https://example.com/item', title: 'source', start_index: start, end_index: start + token.length }] }] }
    ]
  });
  const result = parseGroundedPrices(converted);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].priceKRW, 120000);
  assert.equal(result.offers[0].sources.length, 1);
});
