const MAX_SOURCE_BYTES = 2_000_000;
const SOURCE_TIMEOUT_MS = 7000;

function normalizedHost(value) {
  return value.replace(/^www\./i, '').toLowerCase();
}

function isDirectListingUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = normalizedHost(url.hostname);
    const path = url.pathname.toLowerCase();

    // KREAM social/style/community pages can mention products and prices but are
    // not authoritative listing/market pages for the selected option.
    if (host === 'kream.co.kr') return /^\/products\/[^/]+\/?$/u.test(path);

    // Bunjang product pages are direct marketplace listings. Community/search
    // pages are not accepted as price evidence.
    if (host === 'bunjang.co.kr' || host === 'm.bunjang.co.kr') {
      return /^\/products\/[^/]+\/?$/u.test(path);
    }

    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function modelCodesFromRequest(body = {}) {
  const values = [body.modelCode, body.productName, body.brand]
    .filter(value => typeof value === 'string')
    .join(' ')
    .toUpperCase();
  const found = values.match(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+\b/gu) ?? [];
  if (typeof body.modelCode === 'string' && body.modelCode.trim()) found.push(body.modelCode.trim().toUpperCase());
  return [...new Set(found.map(value => value.replace(/\s+/gu, '')))].filter(Boolean);
}

function significantQueryTokens(body = {}) {
  const generic = new Set(['NIKE','ADIDAS','NEW','상품','제품','신발','운동화','리셀','정품','나이키','아디다스']);
  return [body.brand, body.productName]
    .filter(value => typeof value === 'string')
    .join(' ')
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .map(value => value.trim())
    .filter(value => value.length >= 3 && !generic.has(value.toUpperCase()))
    .slice(0, 8);
}

function includesDigits(text, number) {
  if (!Number.isFinite(Number(number))) return true;
  const needle = String(number).replace(/\D/gu, '');
  if (!needle) return true;
  const compact = text.replace(/[\s,_]/gu, '');
  return compact.includes(needle);
}

function sourceTextMatches(html, offer, requestBody) {
  const text = String(html ?? '').normalize('NFKC');
  const upper = text.toUpperCase().replace(/\s+/gu, ' ');
  const modelCodes = modelCodesFromRequest(requestBody);
  const modelMatched = modelCodes.length
    ? modelCodes.some(code => upper.includes(code))
    : significantQueryTokens(requestBody).filter(token => upper.includes(token.toUpperCase())).length >= 2;

  if (!modelMatched) return false;
  if (!includesDigits(text, offer?.priceKRW)) return false;

  const size = requestBody?.size;
  if (size !== undefined && size !== null && String(size).trim()) {
    const digits = String(size).replace(/\D/gu, '');
    if (digits && !new RegExp(`(^|\\D)${digits}(\\D|$)`, 'u').test(text.replace(/,/gu, ''))) return false;
  }
  return true;
}

async function fetchSourceText(source, fetchImpl) {
  if (!source || typeof source.url !== 'string' || !isDirectListingUrl(source.url)) return null;
  const response = await fetchImpl(source.url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PRICE_CHECK/1.0; +https://github.com/haneulk1004/pricecheck)',
      'Accept': 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  });
  if (!response.ok) return null;
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) return null;
  const text = await response.text();
  return text.slice(0, MAX_SOURCE_BYTES);
}

export async function validateResellSources(payload, requestBody, fetchImpl = fetch) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.offers)) return payload;
  if (requestBody?.mode !== 'resell') return payload;

  const offers = [];
  for (const offer of payload.offers) {
    const validSources = [];
    for (const source of Array.isArray(offer?.sources) ? offer.sources : []) {
      try {
        const html = await fetchSourceText(source, fetchImpl);
        if (html && sourceTextMatches(html, offer, requestBody)) validSources.push(source);
      } catch {
        // Fail closed: a source that cannot be fetched and checked is not shown
        // as verified evidence.
      }
    }
    if (validSources.length) offers.push({ ...offer, sources: validSources });
  }

  return { ...payload, offers };
}

export function sourceValidationInternals() {
  return { isDirectListingUrl, modelCodesFromRequest, sourceTextMatches };
}
