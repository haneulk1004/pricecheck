import test from 'node:test';
import assert from 'node:assert/strict';
import { isEligibleRetailSource } from '../lib/retail-source-policy.js';
import { prepareResearchPayload } from '../api/research.js';
const redirect=title=>({url:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/new-token',title});
test('unverified Lotte redirect quarantine also covers newly minted tokens',()=>{
 for(const title of ['lottemartzetta.com','lotteon.com','www.lotteon.com','https://lottemartzetta.com/']) assert.equal(isEligibleRetailSource(redirect(title)),false,title);
 assert.equal(isEligibleRetailSource(redirect('danawa.com')),true);
});
test('direct listing routes are distinguished from category/search routes',()=>{
 for(const url of ['https://lottemartzetta.com/categories/1','https://lotteon.com/p/display/category/1','https://shop.example/search?q=lip']) assert.equal(isEligibleRetailSource({url}),false);
 assert.equal(isEligibleRetailSource({url:'https://lottemartzetta.com/products/OS123/details'}),true);
 assert.equal(isEligibleRetailSource({url:'https://prod.danawa.com/info/?pcode=123'}),true);
});
test('fresh and cached Laneige result cannot retain the reported publisher-only evidence',()=>{
 const bad={seller:'롯데마트 제타',productName:'라네즈 립슬리핑마스크 거미베어 20G',priceKRW:18000,sources:[redirect('lottemartzetta.com')]};
 const input={mode:'store',productName:'Lip Sleeping Mask Gummy Bear 20g'};
 assert.throws(()=>prepareResearchPayload({offers:[bad]},input),e=>e.code==='NO_VERIFIED_PRICES');
 const good={...bad,seller:'다나와',sources:[redirect('danawa.com')]};
 assert.deepEqual(prepareResearchPayload({offers:[bad,good]},input).offers,[good]);
});

test('SSG promotion evidence is rejected in both redirects and direct links',()=>{
 for(const title of ['ssg.com','event.ssg.com','https://www.ssg.com/']) assert.equal(isEligibleRetailSource(redirect(title)),false);
 for(const url of ['https://event.ssg.com/eventDetail.ssg?eventId=123','https://www.ssg.com/event/eventDetail.ssg','https://shop.example/promotion/beauty','https://event.example.com/beauty']) assert.equal(isEligibleRetailSource({url}),false);
 assert.equal(isEligibleRetailSource({url:'https://www.ssg.com/item/itemView.ssg?itemId=123456'}),true);
 assert.equal(isEligibleRetailSource({url:'https://www.ssg.com/item/itemView.ssg'}),false);
 const offer={seller:'SSG.COM',productName:'레저렉션 아로마틱 핸드 밤 75mL',priceKRW:37050,sources:[redirect('ssg.com')]};
 assert.throws(()=>prepareResearchPayload({offers:[offer]},{mode:'store',productName:'레저렉션 아로마틱 핸드 밤 75mL'}),e=>e.code==='NO_VERIFIED_PRICES');
});
