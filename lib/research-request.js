function cleanPart(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
    : '';
}

export function canonicalResearchIdentity(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const brand = cleanPart(body.brand);
  const productName = cleanPart(body.productName);
  const modelCode = cleanPart(body.modelCode);
  const query = [brand, productName, modelCode].filter(Boolean).join(' ');
  return {
    query,
    mode: body.mode ?? 'store',
    size: (body.mode ?? 'store') === 'resell' ? cleanPart(String(body.size ?? '')) : ''
  };
}

// Kept for compatibility with existing imports. Canonicalization is now used
// only for cache identity; downstream research must receive structured fields.
export function canonicalizeResearchBody(body) {
  return body;
}

export function parseAndCanonicalizeResearchBody(body) {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
