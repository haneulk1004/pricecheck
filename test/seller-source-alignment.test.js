import test from 'node:test';
import assert from 'node:assert/strict';
import { alignOfferSources, prepareResearchPayload } from '../api/research.js';

const source = (url, title = '') => ({ url, title });
const grounding = title => source('https://vertexaisearch.cloud.google.com/grounding-api-redirect/example', title);

test('known seller keeps only its own domain', () => {
  const result = alignOfferSources({ offers: [{ seller: '컴퓨존', sources: [source('https://www.compuzone.co.kr/a'), source('https://www.e-himart.co.kr/b'), source('https://www.genesis.com/c')] }] });
  assert.equal(result.offers.length, 1);
  assert.deepEqual(result.offers[0].sources.map(x => new URL(x.url).hostname), ['www.compuzone.co.kr']);
});

test('oliveyoung keeps only oliveyoung source', () => {
  const result = alignOfferSources({ offers: [{ seller: '올리브영', sources: [source('https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do'), source('https://www.lotteimall.com/a')] }] });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].sources.length, 1);
  assert.match(result.offers[0].sources[0].url, /oliveyoung\.co\.kr/);
});

test('unknown seller is fail closed when source domain does not resemble seller', () => {
  const result = alignOfferSources({ offers: [{ seller: '새로운판매처', sources: [source('https://www.example.com/a'), source('https://www.genesis.com/b')] }] });
  assert.equal(result.offers.length, 0);
});

test('unknown seller may pass when normalized seller matches registrable domain', () => {
  const result = alignOfferSources({ offers: [{ seller: 'Example Mall', sources: [source('https://shop.example.co.kr/item/1'), source('https://other.co.kr/item/2')] }] });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].sources.length, 1);
  assert.match(result.offers[0].sources[0].url, /example\.co\.kr/);
});

test('SSG alias filters unrelated citations', () => {
  const result = alignOfferSources({ offers: [{ seller: '신세계몰', sources: [source('https://www.ssg.com/item/1'), source('https://www.11st.co.kr/products/2'), source('https://www.musinsa.com/products/3')] }] });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].sources.length, 1);
  assert.match(result.offers[0].sources[0].url, /ssg\.com/);
});

test('Google grounding redirect uses publisher-domain citation title', () => {
  const result = alignOfferSources({ offers: [{ seller: '전자랜드', sources: [grounding('etlandmall.co.kr'), grounding('e-himart.co.kr'), grounding('11st.co.kr')] }] });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].sources.length, 1);
  assert.equal(result.offers[0].sources[0].title, 'etlandmall.co.kr');
});

test('specific Lotte Hi-Mart rule wins over generic Lotte rule', () => {
  const result = alignOfferSources({ offers: [{ seller: '롯데하이마트', sources: [grounding('e-himart.co.kr'), grounding('lotteon.com')] }] });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].sources.length, 1);
  assert.equal(result.offers[0].sources[0].title, 'e-himart.co.kr');
});

test('Frisbee grounding redirect is recognized', () => {
  const result = alignOfferSources({ offers: [{ seller: '프리스비', sources: [grounding('frisbeekorea.com')] }] });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].sources.length, 1);
});


test('capacity validation rejects mixed or wrong variants before caching', () => {
  const offer = capacity => ({ seller: '컴퓨존', productName: `제품 ${capacity}`, sources: [source('https://compuzone.co.kr/item/1')] });
  assert.throws(() => prepareResearchPayload({ offers: [offer('256GB'), offer('512GB')] }, { productName: '제품' }), error => error.code === 'OPTION_REQUIRED');
  assert.throws(() => prepareResearchPayload({ offers: [offer('256GB')] }, { productName: '제품 512GB' }), error => error.code === 'NO_VERIFIED_PRICES');
  const result = prepareResearchPayload({ offers: [offer('256GB'), offer('512GB')] }, { productName: '제품 512GB' });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].productName, '제품 512GB');
});
