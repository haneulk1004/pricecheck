function sourceKey(source) {
  if (!source || typeof source.url !== 'string') return '';
  try {
    const url = new URL(source.url);
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.href;
  } catch {
    return source.url.trim();
  }
}

export function dedupeSources(sources) {
  if (!Array.isArray(sources)) return [];
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    const key = sourceKey(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

export function dedupeResearchPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.offers)) return payload;
  return {
    ...payload,
    offers: payload.offers.map(offer => ({
      ...offer,
      sources: dedupeSources(offer?.sources)
    }))
  };
}
