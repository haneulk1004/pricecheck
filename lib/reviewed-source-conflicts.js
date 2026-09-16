// Temporary, evidence-backed exclusions apply to fresh and cached results.
// Remove only after the original product price and sales quantity can be verified.
// User mobile verification, IMG_0091.png (2026-09-16): this LotteON
// citation opens a beverage category, not the cited 340ml product.
export const REVIEWED_NON_PRODUCT_CITATIONS = new Set([
  'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGLsEJaxFwQAD6_eyPTP6DasFgKuynar3hfJztlB3T5qE-varo8l3_NX9gA6LFazjxs4TUQ9RI_jC1XdZW70n-LD4C_wR9HhlNtlPxJ92uWp9Cbdb7hAAUobli5e2zeKwPF3W-bzR1l-ztWAIoT3rJVbyc6'
]);
// Reviewed 2026-09-16: https://lottemartzetta.com/products/OS8801105915006/details
// Heading: 340ML, 920 KRW; statutory pack disclosure: 340ML*24.
export function hasReviewedSourceConflict(offer) {
  if ((offer.sources || []).some(source => REVIEWED_NON_PRODUCT_CITATIONS.has(source.url))) return true;
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
