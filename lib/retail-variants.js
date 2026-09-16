// Price-defining quantities must survive identification and grounding unchanged.
function text(value) { return String(value || '').normalize('NFKC'); }
function measures(value) {
  return [...text(value).matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(ml|kg|mg|l|g)(?=$|[^a-z]|x\s*\d)/giu)]
    .map(([, amount, unit]) => {
      unit = unit.toLowerCase();
      return `${['ml','l'].includes(unit) ? 'volume' : 'weight'}:${Number(amount) * ({ml:1,l:1000,g:1000,kg:1000000,mg:1}[unit])}`;
    });
}
function counts(value) {
  return [...text(value).matchAll(/(?:(?:(?<![a-z])[x×*]|(?<=ml)x|(?<=kg)x|(?<=g)x|(?<=l)x)\s*(\d+)|(?:^|[^\d.])(\d+)\s*(?:개|입|캔|팩|병|packs?\b|pcs?\b|ea\b))/giu)]
    .map(match => Number(match[1] || match[2]));
}
export function matchesRetailVariants(offer, input) {
  if (input.mode === 'resell') return true;
  const request = `${input.productName || ''} ${input.modelCode || ''}`;
  const evidence = `${offer.productName || ''} ${offer.note || ''}`;
  const requiredMeasures = measures(request);
  const foundMeasures = measures(evidence);
  if (requiredMeasures.some(value => !foundMeasures.includes(value))) return false;
  if (requiredMeasures.length && foundMeasures.some(value => !requiredMeasures.includes(value))) return false;
  const requiredCounts = counts(request);
  const foundCounts = counts(evidence);
  if (requiredCounts.some(value => value > 1 && !foundCounts.includes(value))) return false;
  if (foundCounts.some(value => !requiredCounts.includes(value) && value > 1)) return false;
  return true;
}
