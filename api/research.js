import { createResearchHandler } from '../lib/price-research.js';
import { createPromptAwareFetch } from '../lib/resell-grounding.js';

export default createResearchHandler({ fetchImpl: createPromptAwareFetch() });
