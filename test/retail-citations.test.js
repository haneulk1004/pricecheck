import test from 'node:test';
import assert from 'node:assert/strict';
import { citedRetailBlock, buildResearchInteractionRequest, interactionToGenerateContent } from '../lib/resell-grounding.js';
import { parseGroundedPrices } from '../lib/price-research.js';
const line = '판매처: 롯데마트 | 제품: 해태 갈아만든 배 340ml 1개 | 가격: 920원 | 상태: 새 상품 | 비고: 배송비 별도';
function annotation(text, token, url = 'https://lottemartzetta.com/item/1', occurrence = 0) {
  let index = text.indexOf(token);
  for (let n = 0; n < occurrence; n++) index = text.indexOf(token, index + token.length);
  const start = Buffer.byteLength(text.slice(0,index));
  return {type:'url_citation',url,title:new URL(url).hostname,start_index:start,end_index:start+Buffer.byteLength(token)};
}
function converted(text, annotations) {
  return interactionToGenerateContent({status:'completed',steps:[{type:'model_output',content:[{type:'text',text,annotations}]}]}, {retailText:true});
}
test('retail prose maps a native price citation to the existing strict verifier', () => {
  const result = parseGroundedPrices(converted(line,[annotation(line,'920')]));
  assert.equal(result.offers[0].priceKRW,920);
  assert.equal(result.offers[0].productName,'해태 갈아만든 배 340ml 1개');
  assert.equal(result.offers[0].sources[0].url,'https://lottemartzetta.com/item/1');
});
test('absent, malformed, model-written and product-only citations cannot authorize a price', () => {
  for (const annotations of [[],[annotation(line,'340ml')],[{...annotation(line,'920'),end_index:99999}],[{...annotation(line,'920'),start_index:-1}]]) {
    assert.throws(()=>parseGroundedPrices(converted(line,annotations)),e=>e.code==='NO_SOURCES');
  }
  assert.throws(()=>parseGroundedPrices(converted(line+' https://lottemartzetta.com/item/1',[])),e=>e.code==='NO_SOURCES');
});
test('identical prices on different rows never borrow another rows citation', () => {
  const text = line+'\n'+line.replace('롯데마트','SSG');
  const result = parseGroundedPrices(converted(text,[annotation(text,'920')]));
  assert.equal(result.offers.length,1);
  assert.equal(result.offers[0].seller,'롯데마트');
});
test('thousands separators are parsed without moving the evidence to another amount', () => {
  const text = line.replace('920','1,920');
  const result = parseGroundedPrices(converted(text,[annotation(text,'1,920')]));
  assert.equal(result.offers[0].priceKRW,1920);
  assert.throws(()=>parseGroundedPrices(converted(text,[annotation(text,'920')])),e=>e.code==='NO_SOURCES');
});
test('negative, decimal, zero and incomplete price rows fail closed', () => {
  for (const price of ['-920','920.5','0','920~1200']) {
    const text = line.replace('920',price);
    assert.deepEqual(JSON.parse(citedRetailBlock({text,annotations:[annotation(text,price)]}).text).offers,[]);
  }
});
test('retail uses native cited text without JSON schema; resell retains proven profile', () => {
  const schema={type:'object'};const config={generationConfig:{responseFormat:{text:{schema}}}};
  const store=buildResearchInteractionRequest(config,{productName:'음료 340ml',mode:'store'},'gemini-3.8-flash');
  assert.deepEqual(store.response_format,{type:'text'});
  assert.match(store.input,/판매처:/);
  assert.match(store.input,/Never estimate/);
  const resell=buildResearchInteractionRequest(config,{mode:'resell',size:'260'},'gemini-3.8-flash');
  assert.equal(resell.response_format.mime_type,'application/json');
  assert.deepEqual(resell.response_format.schema,schema);
});
