import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesProductIdentity as match} from '../lib/product-identity.js';
test('different brands, flavours and models cannot pass solely by equal size',()=>{
 assert.equal(match({productName:'LANEIGE Lip Sleeping Mask Berry 20g'},{brand:'LANEIGE',productName:'Lip Sleeping Mask Gummy Bear 20g'}),false);
 assert.equal(match({productName:'Other Brand Resurrection Hand Balm 75ml'},{brand:'Aesop',productName:'Resurrection Hand Balm 75ml'}),false);
 assert.equal(match({productName:'Logitech MX Keys KX800'},{brand:'Logitech',productName:'MX Keys Mini',modelCode:'KX700'}),false);
 assert.equal(match({productName:'Nike Air Force 1 CW2288-111 280mm'},{brand:'Nike',productName:'Air Force 1',modelCode:'CW2288-111',mode:'resell',size:'260'}),false);
});
test('known aliases and original titles preserve exact identity',()=>{
 assert.equal(match({productName:'라네즈 립슬리핑마스크 거미베어 20g'},{brand:'LANEIGE',productName:'Lip Sleeping Mask Gummy Bear 20g'}),true);
 assert.equal(match({productName:'이솝 레저렉션 아로마틱 핸드 밤 75ml'},{brand:'Aesop',productName:'Resurrection Aromatique Hand Balm 75mL'}),true);
 assert.equal(match({productName:'해태htb 갈아만든배 340ml 캔 1개'},{brand:'해태',productName:'갈아만든 배 340ml'}),true);
});
