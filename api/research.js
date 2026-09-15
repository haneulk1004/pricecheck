import { createResearchHandler, cacheKey, hashClientIP, normalizeInput, redisCommand } from '../lib/price-research.js';
import { createPromptAwareFetch } from '../lib/resell-grounding.js';
import { parseAndCanonicalizeResearchBody } from '../lib/research-request.js';
import { dedupeResearchPayload } from '../lib/source-dedupe.js';

const researchHandler = createResearchHandler({ fetchImpl: createPromptAwareFetch() });
const QUOTA_PREFIX = 'pricecheck:{grounding}:v1';
const CACHE_MIGRATION_PREFIX = 'pricecheck:{grounding}:source-align:v4';
const REFUNDABLE_CODES = new Set(['PROVIDER_ERROR','INVALID_RESPONSE','NO_SOURCES','NO_VERIFIED_PRICES','OPTION_REQUIRED','RESEARCH_FAILED']);

const REFUND_SCRIPT = `
local now = tonumber(redis.call('TIME')[1])
local day = math.floor((now + 32400) / 86400)
local ipkey = KEYS[1] .. ':' .. day
local globalkey = KEYS[2] .. ':' .. day
local ip = tonumber(redis.call('GET', ipkey) or '0')
local total = tonumber(redis.call('GET', globalkey) or '0')
if ip > 0 then redis.call('DECR', ipkey) end
if total > 0 then redis.call('DECR', globalkey) end
return {math.max(ip - 1, 0), math.max(total - 1, 0)}
`;

const MIGRATE_CACHE_SCRIPT = `
local migrated = redis.call('GET', KEYS[2])
if migrated then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], '1', 'EX', 172800)
return 1
`;

// Put specific brands before broader parent-company aliases.
const SELLER_DOMAINS = [
  [/전자랜드/u, ['etlandmall.co.kr','etland.co.kr']],
  [/하이마트|himart/iu, ['e-himart.co.kr']],
  [/롯데/u, ['lotteon.com','lotte.com','ellotte.com','lotteimall.com']],
  [/쿠팡/u, ['coupang.com']],
  [/11번가|11st/iu, ['11st.co.kr']],
  [/다나와/u, ['danawa.com']],
  [/무신사/u, ['musinsa.com']],
  [/오늘의집/u, ['ohou.se']],
  [/제네시스/u, ['genesis.com']],
  [/신세계|ssg/iu, ['ssg.com']],
  [/g마켓|gmarket/iu, ['gmarket.co.kr']],
  [/네이버|naver/iu, ['naver.com']],
  [/kream/iu, ['kream.co.kr']],
  [/soldout/iu, ['soldout.co.kr']],
  [/logitech|로지텍/iu, ['logitech.com']],
  [/컴퓨존|compuzone/iu, ['compuzone.co.kr']],
  [/올리브영|oliveyoung/iu, ['oliveyoung.co.kr']],
  [/프리스비|frisbee/iu, ['frisbeekorea.com']]
];

function urlHost(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./,''); }
  catch { return ''; }
}

function domainFromCitationTitle(title) {
  const text = String(title || '').trim().toLowerCase();
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[\/:\s]|$)/iu);
  return match?.[1]?.replace(/^www\./, '') || '';
}

function sourceHost(source) {
  const host = urlHost(source?.url);
  // Google grounding may intentionally return a vertexaisearch redirect URI while
  // exposing the actual publisher domain in the citation title. Validate against
  // that publisher domain instead of treating Google's redirect host as the seller.
  if (host === 'vertexaisearch.cloud.google.com') {
    const publisherHost = domainFromCitationTitle(source?.title);
    if (publisherHost) return publisherHost;
  }
  return host;
}

function normalizeSellerToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/주식회사|㈜|공식|스토어|몰|마켓|온라인|쇼핑|백화점|store|shop|shopping|mall|market/giu, '')
    .replace(/[^a-z0-9가-힣]/giu, '');
}

function registrableLabel(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  const secondLevel = new Set(['co','or','go','ne','re','pe']);
  const tld = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  if (tld === 'kr' && secondLevel.has(second) && parts.length >= 3) return parts[parts.length - 3];
  return second;
}

function sourceMatchesSeller(source, seller) {
  const sellerText = String(seller || '');
  const rule = SELLER_DOMAINS.find(([pattern]) => pattern.test(sellerText));
  const host = sourceHost(source);
  if (!host) return false;
  if (rule) return rule[1].some(domain => host === domain || host.endsWith(`.${domain}`));

  const sellerToken = normalizeSellerToken(sellerText);
  const hostToken = normalizeSellerToken(registrableLabel(host));
  if (!sellerToken || !hostToken || sellerToken.length < 3 || hostToken.length < 3) return false;
  return sellerToken === hostToken || sellerToken.includes(hostToken) || hostToken.includes(sellerToken);
}

export function alignOfferSources(payload) {
  if (!payload || !Array.isArray(payload.offers)) return payload;
  const offers = payload.offers.flatMap(offer => {
    if (!offer || !Array.isArray(offer.sources)) return [];
    const sources = offer.sources.filter(source => sourceMatchesSeller(source, offer.seller));
    return sources.length ? [{ ...offer, sources }] : [];
  });
  return { ...payload, offers };
}

function capacityToken(value) {
  const text = String(value || '').normalize('NFKC').toUpperCase();
  const match = text.match(/(?:^|[^A-Z0-9])(\d+(?:\.\d+)?)\s*(TB|GB)(?:$|[^A-Z0-9])/u);
  if (!match) return '';
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${amount}${match[2]}`;
}

export function alignOfferCapacity(payload, requestBody = {}) {
  if (!payload || !Array.isArray(payload.offers) || payload.offers.length === 0) return { payload, optionRequired: false, variants: [] };
  const requested = capacityToken(`${requestBody.productName || ''} ${requestBody.modelCode || ''}`);
  const tagged = payload.offers.map(offer => ({ offer, capacity: capacityToken(`${offer.productName || ''} ${offer.note || ''}`) }));
  const variants = [...new Set(tagged.map(item => item.capacity).filter(Boolean))];

  if (requested) {
    const offers = tagged.filter(item => item.capacity === requested).map(item => item.offer);
    return { payload: { ...payload, offers }, optionRequired: false, variants };
  }

  if (variants.length > 1) {
    return { payload: { ...payload, offers: [] }, optionRequired: true, variants };
  }

  if (variants.length === 1) {
    // Once storage capacity appears in the evidence, keep only offers that explicitly
    // state that same capacity instead of mixing in ambiguous listings.
    const offers = tagged.filter(item => item.capacity === variants[0]).map(item => item.offer);
    return { payload: { ...payload, offers }, optionRequired: false, variants };
  }

  return { payload, optionRequired: false, variants };
}

async function migrateLegacyCache(req) {
  try {
    const input = normalizeInput(req.body);
    const key = cacheKey(input);
    const marker = `${CACHE_MIGRATION_PREFIX}:${key.split(':').pop()}`;
    const migrated = await redisCommand(
      ['EVAL', MIGRATE_CACHE_SCRIPT, '2', key, marker],
      process.env,
      fetch,
      console.info
    );
    if (Number(migrated) === 1) console.info(JSON.stringify({ event: 'price_research_cache_migration', outcome: 'invalidated' }));
  } catch (error) {
    console.info(JSON.stringify({ event: 'price_research_cache_migration', outcome: 'skipped' }));
  }
}

async function refundFailedAdmission(req, code) {
  if (!REFUNDABLE_CODES.has(code)) return;
  try {
    const ipHash = hashClientIP(req, process.env);
    await redisCommand(
      ['EVAL', REFUND_SCRIPT, '2', `${QUOTA_PREFIX}:ip:${ipHash}`, `${QUOTA_PREFIX}:global`],
      process.env,
      fetch,
      console.info
    );
    console.info(JSON.stringify({ event: 'price_research_quota_refund', code, outcome: 'success' }));
  } catch (error) {
    console.info(JSON.stringify({ event: 'price_research_quota_refund', code, outcome: 'failed' }));
  }
}

export default async function handler(req, res) {
  req.body = parseAndCanonicalizeResearchBody(req.body);

  if (req.method === 'POST') await migrateLegacyCache(req);

  const originalJson = res.json.bind(res);
  res.json = data => {
    const deduped = dedupeResearchPayload(data);

    if (typeof deduped?.code === 'string' && REFUNDABLE_CODES.has(deduped.code)) {
      return refundFailedAdmission(req, deduped.code).then(() => originalJson(deduped));
    }

    const aligned = alignOfferSources(deduped);
    if (Array.isArray(deduped?.offers) && deduped.offers.length > 0 && aligned.offers.length === 0) {
      res.status(422);
      return refundFailedAdmission(req, 'NO_VERIFIED_PRICES').then(() => originalJson({
        code: 'NO_VERIFIED_PRICES',
        error: '판매처와 직접 연결되는 출처를 확인하지 못해 가격 결과를 표시하지 않습니다. 아래 판매처에서 직접 확인해주세요.'
      }));
    }

    const capacityAligned = alignOfferCapacity(aligned, req.body);
    if (capacityAligned.optionRequired) {
      res.status(422);
      return refundFailedAdmission(req, 'OPTION_REQUIRED').then(() => originalJson({
        code: 'OPTION_REQUIRED',
        error: `서로 다른 저장용량(${capacityAligned.variants.join(', ')})의 가격이 함께 확인되어 결과를 표시하지 않습니다. 제품명에 원하는 용량(예: 256GB)을 입력한 뒤 다시 조사해주세요.`
      }));
    }
    if (aligned.offers?.length > 0 && capacityAligned.payload.offers.length === 0) {
      res.status(422);
      return refundFailedAdmission(req, 'NO_VERIFIED_PRICES').then(() => originalJson({
        code: 'NO_VERIFIED_PRICES',
        error: '요청한 저장용량과 정확히 일치하는 가격 출처를 확인하지 못해 결과를 표시하지 않습니다.'
      }));
    }

    return originalJson(capacityAligned.payload);
  };

  return researchHandler(req, res);
}
