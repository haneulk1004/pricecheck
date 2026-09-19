// Domain alignment alone cannot establish that a link opens the cited product.
// User mobile checks showed LotteON and Lotte Mart grounding redirects opening
// category/unrelated lists (IMG_0091, IMG_0131); SSG opened an expired
// promotion (IMG_0133). Quarantine opaque redirects for
// these publishers until their destinations can be validated independently.
export function isEligibleRetailSource(source) {
  try {
    const url = new URL(source.url);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:') return false;
    if (host === 'vertexaisearch.cloud.google.com') {
      const title = String(source.title || '').trim().toLowerCase();
      return !/(?:^|[^a-z0-9-])(?:[a-z0-9-]+\.)*(?:lotteon\.com|lottemartzetta\.com|ssg\.com)(?:$|[\s/:])/i.test(title);
    }
    if (/^(?:event|events|promotion|promotions)\./i.test(host)) return false;
    if (host === 'ssg.com' || host.endsWith('.ssg.com')) {
      return /^\/item\/itemView\.ssg$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('itemId') || '');
    }
    if (host === 'lottemartzetta.com') return /^\/products\/[^/]+\/details\/?$/.test(url.pathname);
    if (host === 'lotteon.com' || host.endsWith('.lotteon.com')) return /^\/(?:p|m)\/product\/[^/]+\/?$/.test(url.pathname);
    return !/(?:^|\/)(?:search|category|categories|brand-shop|event|events|promotion|promotions)(?:\/|\.|$)/i.test(url.pathname);
  } catch { return false; }
}
