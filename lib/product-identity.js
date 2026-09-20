// Conservative identity check on the candidate title, separate from quantities.
// Unknown translations must not silently count as a match.
const aliases = [
 ['resurrection aromatique hand balm','레저렉션 아로마틱 핸드 밤'],
 ['lip sleeping mask','립 슬리핑 마스크'], ['gummy bear','거미베어'],
 ['aesop','이솝'],['laneige','라네즈'],['logitech','로지텍'],['nike','나이키']
];
function normalize(value) {
 let s=String(value||'').normalize('NFKC').toLowerCase();
 for(const [english,korean] of aliases) s=s.replaceAll(english,korean);
 return s.replace(/[^\p{L}\p{N}]/gu,'');
}
export function matchesProductIdentity(offer,input) {
 const title=normalize(offer.productName);
 const brand=normalize(input.brand);
 if(brand && !title.includes(brand)) return false;
 const model=normalize(input.modelCode);
 if(model && !title.includes(model)) return false;
 // Keep descriptive product/variant tokens; physical quantities are checked separately.
 const requested=String(input.productName||'').replace(/\d+(?:\.\d+)?\s*(?:ml|kg|mg|g|l|gb|tb)\b/gi,'');
 const name=normalize(requested);
 if(name && !title.includes(name)) return false;
 if(input.mode==='resell' && input.size) {
   const size=String(input.size).replace(/\D/g,'');
   if(!new RegExp(`(?:^|\\D)${size}(?:\\s*mm)?(?:$|\\D)`,'i').test(String(offer.productName))) return false;
 }
 return true;
}
