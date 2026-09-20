import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingListing,validateListingEvidence} from '../lib/listing-evidence.js';
const input={brand:'LANEIGE',productName:'Lip Sleeping Mask Gummy Bear 20g',mode:'store'};
const offer={priceKRW:18000};
const product={ '@type':'Product',brand:{name:'LANEIGE'},name:'Lip Sleeping Mask Gummy Bear 20g',offers:{'@type':'Offer',priceCurrency:'KRW',price:18000,availability:'https://schema.org/InStock'}};
const html=p=>`<script type="application/ld+json">${JSON.stringify(p)}</script>`;
test('independent product data must match identity, option and exact price',()=>{
 assert.equal(matchingListing(html(product),offer,input),true);
 for(const p of [{...product,name:'Lip Sleeping Mask Berry 20g'},{...product,brand:{name:'Other'}},{...product,name:'Lip Sleeping Mask Gummy Bear 10g'},{...product,offers:{...product.offers,price:19000}},{...product,offers:{...product.offers,'@type':'AggregateOffer'}},{...product,offers:{...product.offers,availability:'https://schema.org/OutOfStock'}}])assert.equal(matchingListing(html(p),offer,input),false);
 assert.equal(matchingListing('종료된 이벤트 18000',offer,input),false);
});
test('untrusted redirect destination is rejected before fetch and no source is invented',async()=>{
 let calls=0;const r=await validateListingEvidence({offers:[{...offer,sources:[{url:'https://vertexaisearch.cloud.google.com/test'}]}]},input,async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})});
 assert.equal(calls,1);assert.equal(r.offers.length,0);
});

test('resolved product URL is retained; category and expired structured offers fail closed',async()=>{
 const payload={offers:[{...offer,sources:[{url:'https://vertexaisearch.cloud.google.com/test'}]}]};
 const fake=path=>async url=>url.includes('google.com')?new Response(null,{status:302,headers:{location:'https://amoremall.com/'+path}}):new Response(html(product),{headers:{'content-type':'text/html'}});
 const valid=await validateListingEvidence(payload,input,fake('products/123'));
 assert.equal(valid.offers[0].sources[0].url,'https://amoremall.com/products/123');
 assert.equal((await validateListingEvidence(payload,input,fake('category/123'))).offers.length,0);
 for(const expiry of ['2000-01-01','2000-01-01T12:00:00Z','invalid']) assert.equal(matchingListing(html({...product,offers:{...product.offers,priceValidUntil:expiry}}),offer,input),false);
});
