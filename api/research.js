import { createResearchHandler } from '../lib/price-research.js';
import { createPromptAwareFetch } from '../lib/resell-grounding.js';
import { parseAndCanonicalizeResearchBody } from '../lib/research-request.js';

const researchHandler = createResearchHandler({ fetchImpl: createPromptAwareFetch() });

export default async function handler(req, res) {
  req.body = parseAndCanonicalizeResearchBody(req.body);
  return researchHandler(req, res);
}
