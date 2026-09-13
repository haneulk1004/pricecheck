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

function resellPrompt(input) {
  return [
    'You are researching CURRENT Korean resale-market prices.',
    'You MUST use Google Search before returning any offer. Do not answer from memory or prior knowledge.',
    'Search the exact product, model code, and selected Korean mm size.',
    'Prioritize publicly indexed KREAM and SOLDOUT pages, then other public Korean resale pages.',
    'Distinguish current asking prices from completed-sale prices and label the price type in condition or note.',
    'Every returned price must be supported by a URL citation that covers that price in the output.',
    'Never estimate, invent, or infer a price. If citable evidence is unavailable, return an empty offers array.',
    'Return at most 5 KRW offers. Use Korean descriptions.',
    `Product data: ${JSON.stringify(input)}`
  ].join(' ');
}

export function buildResellInteractionRequest(generateContentBody, input, model) {
  const schema = generateContentBody?.generationConfig?.responseFormat?.text?.schema;
  const maxOutputTokens = generateContentBody?.generationConfig?.maxOutputTokens ?? 4096;
  return {
    model,
    input: resellPrompt(input),
    tools: [{ type: 'google_search', search_types: ['web_search'] }],
    generation_config: {
      max_output_tokens: maxOutputTokens,
      tool_choice: {
        allowed_tools: {
          mode: 'any',
          tools: ['google_search']
        }
      }
    },
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      ...(schema ? { schema } : {})
    },
    store: false
  };
}

function safeCitation(annotation) {
  if (annotation?.type !== 'url_citation' || typeof annotation.url !== 'string') return null;
  try {
    const url = new URL(annotation.url);
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
  const searchQueries = steps
    .filter(step => step?.type === 'google_search_call')
    .flatMap(step => Array.isArray(step?.arguments?.queries) ? step.arguments.queries : [])
    .filter(query => typeof query === 'string');

  const suggestions = steps
    .filter(step => step?.type === 'google_search_result')
    .flatMap(step => Array.isArray(step?.result) ? step.result : step?.result ? [step.result] : [])
    .map(item => item?.search_suggestions ?? item?.searchSuggestions)
    .filter(value => typeof value === 'string');

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
      for (const rawAnnotation of Array.isArray(block.annotations) ? block.annotations : []) {
        const annotation = safeCitation(rawAnnotation);
        if (!annotation || !Number.isInteger(annotation.start) || !Number.isInteger(annotation.end) || annotation.start < 0 || annotation.end <= annotation.start || annotation.end > block.text.length) continue;
        let chunkIndex = chunkByUrl.get(annotation.url);
        if (chunkIndex === undefined) {
          chunkIndex = groundingChunks.length;
          chunkByUrl.set(annotation.url, chunkIndex);
          groundingChunks.push({ web: { uri: annotation.url, title: annotation.title } });
        }
        groundingSupports.push({
          segment: {
            partIndex,
            startIndex: Buffer.byteLength(block.text.slice(0, annotation.start)),
            endIndex: Buffer.byteLength(block.text.slice(0, annotation.end))
          },
          groundingChunkIndices: [chunkIndex]
        });
      }
    }
  }

  const hasGrounding = searchQueries.length > 0 || groundingChunks.length > 0 || groundingSupports.length > 0 || suggestions.length > 0;
  return {
    candidates: [{
      finishReason: interaction?.status === 'completed' ? 'STOP' : 'OTHER',
      content: { parts },
      ...(hasGrounding ? {
        groundingMetadata: {
          webSearchQueries: searchQueries,
          groundingChunks,
          groundingSupports,
          ...(suggestions.length ? { searchEntryPoint: { renderedContent: suggestions.join('\n') } } : {})
        }
      } : {})
    }]
  };
}

function responseLike(response, data) {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    json: async () => data
  };
}

export function createPromptAwareFetch(fetchImpl = fetch) {
  return async function promptAwareFetch(url, options = {}) {
    let parsedUrl;
    try { parsedUrl = new URL(url); }
    catch { return fetchImpl(url, options); }

    if (parsedUrl.hostname !== GEMINI_HOST || options.method !== 'POST' || typeof options.body !== 'string' || !parsedUrl.pathname.endsWith(':generateContent')) {
      return fetchImpl(url, options);
    }

    let generateContentBody;
    try { generateContentBody = JSON.parse(options.body); }
    catch { return fetchImpl(url, options); }

    const input = parseResellInput(generateContentBody);
    if (!input) return fetchImpl(url, options);

    const model = modelFromGenerateContentUrl(url);
    if (!model) return fetchImpl(url, options);

    const interactionResponse = await fetchImpl(INTERACTIONS_URL, {
      ...options,
      body: JSON.stringify(buildResellInteractionRequest(generateContentBody, input, model))
    });
    if (!interactionResponse.ok) return interactionResponse;

    const interaction = await interactionResponse.json();
    return responseLike(interactionResponse, interactionToGenerateContent(interaction));
  };
}
