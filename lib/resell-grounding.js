const GEMINI_HOST = 'generativelanguage.googleapis.com';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

function parseResellInput(body) {
  if (!body || typeof body !== 'object') return null;
  const originalText = body.contents?.[0]?.parts?.[0]?.text;
  if (typeof originalText !== 'string') return null;
  try {
    const input = JSON.parse(originalText);
    return input?.mode === 'resell' ? input : null;
  } catch {
    return null;
  }
}

function modelFromGenerateContentUrl(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/models\/([^/:]+):generateContent$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function discoverPrompt(input) {
  return [
    'Search the current Korean resale market for the exact requested product and size.',
    'Return only evidence from direct product/market pages, not STYLE/social/community/editorial pages.',
    'Prioritize KREAM and SOLDOUT, then other Korean resale marketplaces.',
    'Do not estimate prices. The purpose of this first step is discovery only.',
    `Product data: ${JSON.stringify(input)}`
  ].join(' ');
}

function verifyPrompt(input, urls) {
  return [
    'Verify current Korean resale prices using ONLY the supplied URLs via URL Context.',
    'For each returned offer, the same page must support the exact requested product/model, selected Korean mm size, and exact KRW price.',
    'Reject unrelated products, STYLE/social/community/editorial pages, search result pages, and prices for other sizes.',
    'Distinguish asking/instant-buy prices from completed-sale prices in condition or note.',
    'Every returned price must have an inline URL citation. Never estimate or infer a price.',
    'If the supplied URLs do not provide exact citable evidence, return an empty offers array.',
    'Return at most 5 offers with Korean descriptions.',
    `Product data: ${JSON.stringify(input)}`,
    `Candidate URLs: ${JSON.stringify(urls)}`
  ].join(' ');
}

function responseSchema(generateContentBody) {
  return generateContentBody?.generationConfig?.responseFormat?.text?.schema;
}

function maxTokens(generateContentBody) {
  return generateContentBody?.generationConfig?.maxOutputTokens ?? 4096;
}

function searchRequest(generateContentBody, input, model) {
  return {
    model,
    input: discoverPrompt(input),
    system_instruction: 'Use Google Search only to discover relevant current direct resale product pages. Do not invent prices.',
    tools: [{ type: 'google_search', search_types: ['web_search'] }],
    generation_config: { max_output_tokens: maxTokens(generateContentBody) },
    response_format: { type: 'text' },
    store: false
  };
}

function verificationRequest(generateContentBody, input, model, urls) {
  const schema = responseSchema(generateContentBody);
  return {
    model,
    input: verifyPrompt(input, urls),
    system_instruction: 'Use URL Context only. Return only exact evidence-backed resale prices with inline URL citations; otherwise return no offers.',
    tools: [{ type: 'url_context' }],
    generation_config: { max_output_tokens: maxTokens(generateContentBody) },
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      ...(schema ? { schema } : {})
    },
    store: false
  };
}

function normalizeCandidateUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === 'kream.co.kr' && !/^\/products\/[^/]+\/?$/u.test(path)) return null;
    if ((host === 'bunjang.co.kr' || host === 'm.bunjang.co.kr') && !/^\/products\/[^/]+\/?$/u.test(path)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function candidateUrlsFromInteraction(interaction, limit = 8) {
  const urls = [];
  const seen = new Set();
  for (const step of Array.isArray(interaction?.steps) ? interaction.steps : []) {
    if (step?.type === 'google_search_result') {
      for (const item of Array.isArray(step.result) ? step.result : step?.result ? [step.result] : []) {
        for (const raw of [item?.url, item?.uri]) {
          const url = normalizeCandidateUrl(raw);
          if (url && !seen.has(url)) { seen.add(url); urls.push(url); }
        }
      }
    }
    if (step?.type === 'model_output') {
      for (const block of Array.isArray(step.content) ? step.content : []) {
        for (const annotation of Array.isArray(block?.annotations) ? block.annotations : []) {
          const url = normalizeCandidateUrl(annotation?.url ?? annotation?.source);
          if (url && !seen.has(url)) { seen.add(url); urls.push(url); }
        }
      }
    }
    if (urls.length >= limit) break;
  }
  return urls.slice(0, limit);
}

function safeCitation(annotation) {
  if ((annotation?.type !== 'url_citation' && !annotation?.source) || typeof (annotation.url ?? annotation.source) !== 'string') return null;
  try {
    const url = new URL(annotation.url ?? annotation.source);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return {
      url: url.href,
      title: typeof annotation.title === 'string' ? annotation.title.slice(0, 200) : url.hostname,
      start: Number.isInteger(annotation.start_index) ? annotation.start_index : annotation.startIndex,
      end: Number.isInteger(annotation.end_index) ? annotation.end_index : annotation.endIndex
    };
  } catch {
    return null;
  }
}

export function interactionToGenerateContent(interaction) {
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  const searchQueries = steps.filter(step => step?.type === 'google_search_call').flatMap(step => Array.isArray(step?.arguments?.queries) ? step.arguments.queries : []).filter(query => typeof query === 'string');
  const suggestions = steps.filter(step => step?.type === 'google_search_result').flatMap(step => Array.isArray(step?.result) ? step.result : step?.result ? [step.result] : []).map(item => item?.search_suggestions ?? item?.searchSuggestions).filter(value => typeof value === 'string');
  const parts = [];
  const groundingChunks = [];
  const groundingSupports = [];
  const chunkByUrl = new Map();

  for (const step of steps) {
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue;
      const partIndex = parts.length;
      parts.push({ text: block.text });
      const textByteLength = Buffer.byteLength(block.text, 'utf8');
      for (const rawAnnotation of Array.isArray(block.annotations) ? block.annotations : []) {
        const annotation = safeCitation(rawAnnotation);
        if (!annotation || !Number.isInteger(annotation.start) || !Number.isInteger(annotation.end) || annotation.start < 0 || annotation.end <= annotation.start || annotation.end > textByteLength) continue;
        let chunkIndex = chunkByUrl.get(annotation.url);
        if (chunkIndex === undefined) {
          chunkIndex = groundingChunks.length;
          chunkByUrl.set(annotation.url, chunkIndex);
          groundingChunks.push({ web: { uri: annotation.url, title: annotation.title } });
        }
        groundingSupports.push({ segment: { partIndex, startIndex: annotation.start, endIndex: annotation.end }, groundingChunkIndices: [chunkIndex] });
      }
    }
  }

  const hasGrounding = searchQueries.length > 0 || groundingChunks.length > 0 || groundingSupports.length > 0 || suggestions.length > 0;
  return {
    candidates: [{
      finishReason: interaction?.status === 'completed' ? 'STOP' : 'OTHER',
      content: { parts },
      ...(hasGrounding ? { groundingMetadata: { webSearchQueries: searchQueries, groundingChunks, groundingSupports, ...(suggestions.length ? { searchEntryPoint: { renderedContent: suggestions.join('\n') } } : {}) } } : {})
    }]
  };
}

function responseLike(response, data) {
  return { ok: response.ok, status: response.status, statusText: response.statusText, headers: response.headers, json: async () => data };
}

export function createPromptAwareFetch(fetchImpl = fetch) {
  return async function promptAwareFetch(url, options = {}) {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { return fetchImpl(url, options); }
    if (parsedUrl.hostname !== GEMINI_HOST || options.method !== 'POST' || typeof options.body !== 'string' || !parsedUrl.pathname.endsWith(':generateContent')) return fetchImpl(url, options);

    let generateContentBody;
    try { generateContentBody = JSON.parse(options.body); } catch { return fetchImpl(url, options); }
    const input = parseResellInput(generateContentBody);
    if (!input) return fetchImpl(url, options);
    const model = modelFromGenerateContentUrl(url);
    if (!model) return fetchImpl(url, options);

    const searchResponse = await fetchImpl(INTERACTIONS_URL, { ...options, body: JSON.stringify(searchRequest(generateContentBody, input, model)) });
    if (!searchResponse.ok) return searchResponse;
    const searchInteraction = await searchResponse.json();
    const urls = candidateUrlsFromInteraction(searchInteraction);
    if (!urls.length) return responseLike(searchResponse, interactionToGenerateContent(searchInteraction));

    const verifyResponse = await fetchImpl(INTERACTIONS_URL, { ...options, body: JSON.stringify(verificationRequest(generateContentBody, input, model, urls)) });
    if (!verifyResponse.ok) return verifyResponse;
    const verifyInteraction = await verifyResponse.json();
    const converted = interactionToGenerateContent(verifyInteraction);
    const metadata = converted?.candidates?.[0]?.groundingMetadata;
    if (metadata) metadata.webSearchQueries = Array.isArray(searchInteraction?.steps)
      ? searchInteraction.steps.filter(step => step?.type === 'google_search_call').flatMap(step => Array.isArray(step?.arguments?.queries) ? step.arguments.queries : []).filter(query => typeof query === 'string')
      : [];
    return responseLike(verifyResponse, converted);
  };
}
