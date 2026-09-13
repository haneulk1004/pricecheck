import { cacheKey, createResearchHandler, normalizeInput, redisCommand } from '../lib/price-research.js';
import { createPromptAwareFetch } from '../lib/resell-grounding.js';
import { parseAndCanonicalizeResearchBody } from '../lib/research-request.js';
import { dedupeResearchPayload } from '../lib/source-dedupe.js';
import { validateResellSources } from '../lib/source-validation.js';

const researchHandler = createResearchHandler({ fetchImpl: createPromptAwareFetch() });

function parsedBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  if (typeof body !== 'string') return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function evictInvalidCache(canonicalBody) {
  try {
    const input = normalizeInput(canonicalBody);
    await redisCommand(['DEL', cacheKey(input)], process.env, fetch, console.info);
  } catch {
    // Source validation failure must not be hidden by a cache-eviction failure.
  }
}

export default async function handler(req, res) {
  const originalBody = parsedBody(req.body);
  req.body = parseAndCanonicalizeResearchBody(req.body);
  const validationBody = { ...req.body, ...originalBody, mode: req.body?.mode, size: req.body?.size };

  const originalJson = res.json.bind(res);
  let captured;
  res.json = data => {
    captured = data;
    return res;
  };

  await researchHandler(req, res);

  if (res.statusCode === 200 && captured?.offers?.length && req.body?.mode === 'resell') {
    const deduped = dedupeResearchPayload(captured);
    const validated = await validateResellSources(deduped, validationBody);
    if (!validated.offers.length) {
      await evictInvalidCache(req.body);
      res.statusCode = 422;
      return originalJson({
        error: '선택한 제품·사이즈·가격을 직접 확인할 수 있는 출처를 찾지 못했습니다. 잘못 연결된 스타일/게시물 출처는 제외했습니다.',
        code: 'NO_VERIFIED_PRICES'
      });
    }
    return originalJson(validated);
  }

  return originalJson(dedupeResearchPayload(captured));
}
