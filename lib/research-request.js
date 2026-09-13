function cleanPart(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
    : '';
}

export function canonicalizeResearchBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;

  const brand = cleanPart(body.brand);
  const productName = cleanPart(body.productName);
  const modelCode = cleanPart(body.modelCode);
  const combinedQuery = [brand, productName, modelCode].filter(Boolean).join(' ');

  // price-research.js limits productName to 160 characters. Keep the original
  // structured fields for unusually long valid inputs instead of turning them
  // into a new validation failure while canonicalizing the cache identity.
  if (!combinedQuery || combinedQuery.length > 160) return body;

  // The UI/search links operate on the combined visible query. Store that same
  // query as one canonical field so equivalent field partitions produce the
  // same server-side cache key. This prevents manual/AI-confirmed paths from
  // missing each other's 24-hour cache despite showing the same search query.
  return {
    ...body,
    brand: '',
    productName: combinedQuery,
    modelCode: ''
  };
}

export function parseAndCanonicalizeResearchBody(body) {
  if (typeof body !== 'string') return canonicalizeResearchBody(body);
  try {
    return canonicalizeResearchBody(JSON.parse(body));
  } catch {
    return body;
  }
}
