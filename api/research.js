import { createResearchHandler, cacheKey, hashClientIP, normalizeInput, redisCommand } from '../lib/price-research.js';
import { createPromptAwareFetch } from '../lib/resell-grounding.js';
import { parseAndCanonicalizeResearchBody } from '../lib/research-request.js';
import { dedupeResearchPayload } from '../lib/source-dedupe.js';

const researchHandler = createResearchHandler({ fetchImpl: createPromptAwareFetch() });
const QUOTA_PREFIX = 'pricecheck:{grounding}:v1';
const CACHE_MIGRATION_PREFIX = 'pricecheck:{grounding}:source-align:v1';
const REFUNDABLE_CODES = new Set(['PROVIDER_ERROR','INVALID_RESPONSE','NO_SOURCES','NO_VERIFIED_PRICES','RESEARCH_FAILED']);

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

const SELLER_DOMAINS = [
  [/전자랜드/u, ['etlandmall.co.kr','etland.co.kr']],
  [/롯데/u, ['lotteon.com','lotte.com','ellotte.com']],
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
  [/logitech|로지텍/iu, ['logitech.com']]
];

function sourceHost(source) {
  try { return new URL(source?.url).hostname.toLowerCase().replace(/^www\./,''); }
  catch { return ''; }
}

function sourceMatchesSeller(source, seller) {
  const rule = SELLER_DOMAINS.find(([pattern]) => pattern.test(String(seller || '')));
  if (!rule) return true;
  const host = sourceHost(source);
  return rule[1].some(domain => host === domain || host.endsWith(`.${domain}`));
}

function alignOfferSources(payload) {
  if (!payload || !Array.isArray(payload.offers)) return payload;
  const offers = payload.offers.flatMap(offer => {
    if (!offer || !Array.isArray(offer.sources)) return [];
    const sources = offer.sources.filter(source => sourceMatchesSeller(source, offer.seller));
    return sources.length ? [{ ...offer, sources }] : [];
  });
  return { ...payload, offers };
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
      return originalJson({
        code: 'NO_VERIFIED_PRICES',
        error: '판매처와 직접 연결되는 출처를 확인하지 못해 가격 결과를 표시하지 않습니다. 아래 판매처에서 직접 확인해주세요.'
      });
    }

    return originalJson(aligned);
  };

  return researchHandler(req, res);
}
