// Temporary, evidence-backed exclusions apply to fresh and cached results.
// Remove only after the publisher resolves the conflicting sales quantity.
// Reviewed 2026-09-16: https://lottemartzetta.com/products/OS8801105915006/details
// Heading: 340ML, 920 KRW; statutory pack disclosure: 340ML*24.
export function hasReviewedSourceConflict(offer) {
  const name = String(offer.productName || '').normalize('NFKC').replace(/\s/g, '');
  if (!name.includes('갈아만든배') || !/340ml/i.test(name)) return false;
  return (offer.sources || []).some(source => {
    try {
      const url = new URL(source.url);
      return url.hostname === 'lottemartzetta.com' && url.pathname === '/products/OS8801105915006/details'
        || url.hostname === 'vertexaisearch.cloud.google.com' && /^lottemartzetta\.com\/?$/i.test(String(source.title || '').trim());
    } catch { return false; }
  });
}
