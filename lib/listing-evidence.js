import {matchesProductIdentity} from './product-identity.js';
import {matchesRetailVariants} from './retail-variants.js';
import {isEligibleRetailSource} from './retail-source-policy.js';
// Public publisher allowlist applies to every redirect hop, not citation titles.
const publishers=['danawa.com','ssg.com','lotteon.com','lottemartzetta.com','coupang.com','11st.co.kr','gmarket.co.kr','aesop.com','amoremall.com','logitech.com','compuzone.co.kr','kream.co.kr','soldout.co.kr'];
function allowed(raw) {
 try {const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(u.hostname==='vertexaisearch.cloud.google.com'||publishers.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)));}catch{return false;}
}
export function matchingListing(html,offer,input) {
 const nodes=[];
 function visit(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(visit);return;}if([n['@type']].flat().includes('Product'))nodes.push(n);if(n['@graph'])visit(n['@graph']);}
 for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(m[1]));}catch{}}
 for(const p of nodes){
   const brand=typeof p.brand==='string'?p.brand:p.brand?.name||'';
   const candidate={productName:`${brand} ${p.name||''}`,note:''};
   if(!matchesProductIdentity(candidate,input)||!matchesRetailVariants(candidate,input))continue;
   for(const o of [p.offers].flat().filter(Boolean)){
     // Aggregate/lowest prices cannot establish a particular purchasable variant.
     if(o['@type']!=='Offer'||o.priceCurrency!=='KRW'||Number(o.price)!==offer.priceKRW)continue;
     if(o.availability&&!/\/(?:InStock|LimitedAvailability)$/.test(o.availability))continue;
     if(o.priceValidUntil){const raw=String(o.priceValidUntil);const expires=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T23:59:59+09:00':raw);if(!Number.isFinite(expires)||expires<Date.now())continue;}
     return true;
   }
 }
 return false;
}
async function readListing(raw,signal,fetchImpl){
 let url=raw;
 for(let i=0;i<5;i++){
   if(!allowed(url))return null;
   const r=await fetchImpl(url,{redirect:'manual',signal,headers:{Accept:'text/html,application/xhtml+xml'}});
   if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next)return null;url=new URL(next,url).href;continue;}
   if(!r.ok||!r.headers.get('content-type')?.includes('text/html')){await r.body?.cancel();return null;}
   if(new URL(url).hostname==='vertexaisearch.cloud.google.com'){await r.body?.cancel();return null;}
   const reader=r.body.getReader();let bytes=0;const parts=[];
   for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1500000){await reader.cancel();return null;}parts.push(value);}
   return {url,html:Buffer.concat(parts).toString('utf8')};
 }
 return null;
}
export async function validateListingEvidence(payload,input,fetchImpl=fetch){
 const signal=AbortSignal.timeout(7000);
 const offers=await Promise.all(payload.offers.slice(0,5).map(async offer=>{
   for(const source of offer.sources.slice(0,2)){
     try{const page=await readListing(source.url,signal,fetchImpl);if(page&&isEligibleRetailSource({url:page.url})&&matchingListing(page.html,offer,input))return {...offer,evidenceStatus:'product_page_checked',sources:[{...source,url:page.url,originalCitationUrl:source.url}],sourceCheckedAt:new Date().toISOString()};}catch{}
   }
   return null;
 }));
 return {...payload,offers:offers.filter(Boolean)};
}
