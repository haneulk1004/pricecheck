// Domain alignment alone cannot establish that a link opens the cited product.
// User mobile checks showed LotteON and Lotte Mart grounding redirects opening
// category/unrelated lists (IMG_0091, IMG_0131). Quarantine opaque redirects for
// these publishers until their destinations can be validated independently.
export function isEligibleRetailSource(source) {
  try {
    const url = new URL(source.url);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:') return false;
    if (host === 'vertexaisearch.cloud.google.com') {
      const title = String(source.title || '').trim().toLowerCase();
      return !/(?:^|[^a-z0-9-])(?:[a-z0-9-]+\.)*(?:lotteon\.com|lottemartzetta\.com)(?:$|[\s/:])/i.test(title);
    }
    if (host === 'lottemartzetta.com') return /^\/products\/[^/]+\/details\/?$/.test(url.pathname);
    if (host === 'lotteon.com' || host.endsWith('.lotteon.com')) return /^\/(?:p|m)\/product\/[^/]+\/?$/.test(url.pathname);
    return !/(?:^|\/)(?:search|category|categories|brand-shop)(?:\/|\.|$)/i.test(url.pathname);
  } catch { return false; }
}
