import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRetailVariants } from '../lib/retail-variants.js';
const input={productName:'갈아만든 배 340ml',mode:'store'};
test('retail prices require the requested volume and reject bundles and unknown volumes',()=>{
 for(const name of ['갈아만든 배 238ml','갈아만든 배','갈아만든 배 1340ml','갈아만든 배 340ml 24캔','갈아만든 배 340ml x24','갈아만든 배 340mlx24','갈아만든 배 340ml 6팩']) assert.equal(matchesRetailVariants({productName:name},input),false,name);
 assert.equal(matchesRetailVariants({productName:'갈아만든 배 340ml 1캔'},input),true);
 assert.equal(matchesRetailVariants({productName:'갈아만든 배 340ml',note:'24개 구매시 가격'},input),false);
});
test('explicit packs are preserved and equivalent physical units can match',()=>{
 assert.equal(matchesRetailVariants({productName:'제품 340ml 24캔'},{productName:'제품 340ml 24캔',mode:'store'}),true);
 assert.equal(matchesRetailVariants({productName:'제품 340ml'},{productName:'제품 340ml 24캔',mode:'store'}),false);
 assert.equal(matchesRetailVariants({productName:'제품 1kg'},{productName:'제품 1000g',mode:'store'}),true);
 assert.equal(matchesRetailVariants({productName:'제품 1g'},{productName:'제품 1000g',mode:'store'}),false);
});
test('unrelated electronic product and resell formats retain their existing validation',()=>{
 assert.equal(matchesRetailVariants({productName:'MX Keys Mini',note:'새 상품'},{productName:'MX Keys Mini',modelCode:'KX700',mode:'store'}),true);
 assert.equal(matchesRetailVariants({productName:'Air Force 1'},{productName:'Air Force 1',mode:'resell',size:'260'}),true);
});
