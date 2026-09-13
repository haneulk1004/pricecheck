import { createResearchHandler } from '../lib/price-research.js';
import { createPromptAwareFetch } from '../lib/resell-grounding.js';
import { parseAndCanonicalizeResearchBody } from '../lib/research-request.js';
import { dedupeResearchPayload } from '../lib/source-dedupe.js';

const researchHandler = createResearchHandler({ fetchImpl: createPromptAwareFetch() });

export default async function handler(req, res) {
  req.body = parseAndCanonicalizeResearchBody(req.body);

  const originalJson = res.json.bind(res);
  res.json = data => originalJson(dedupeResearchPayload(data));

  return researchHandler(req, res);
}
