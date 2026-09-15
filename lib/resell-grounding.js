const GEMINI_HOST = 'generativelanguage.googleapis.com';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const RESEARCH_TIMEOUT_MS = 55000;

function inferModelCode(input) {
  if (!input || typeof input !== 'object') return input;
  if (typeof input.modelCode === 'string' && input.modelCode.trim()) return input;
  const haystack = [input.productName, input.brand]
    .filter(value => typeof value === 'string')
    .join(' ')
    .normalize('NFKC')
    .toUpperCase();
  const match = haystack.match(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+\b/u);
  return match ? { ...input, modelCode: match[0] } : input;
}

function parseResearchInput(body) {
  if (!body || typeof body !== 'object') return null;
  const originalText = body.contents?.[0]?.parts?.[0]?.text;
  if (typeof originalText !== 'string') return null;
  try {
    const input = inferModelCode(JSON.parse(originalText));
    return ['store', 'resell'].includes(input?.mode) ? input : null;
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

function researchPrompt(input) {
  if (input.mode === 'resell') {
    return [
      'Research CURRENT Korean resale-market prices using Google Search.',
      'Do not answer from memory or prior knowledge.',
      'Search the exact product, exact model code, and selected Korean mm size before producing any offer.',
      'For KREAM or similar marketplaces, use ONLY a price that is explicitly tied to the requested size in a transaction row, size-specific bid/ask row, or equivalent size-specific evidence.',
      'Do NOT use the product-page headline price, lowest overall price, another size price, STYLE/social/community post price, accessory price, or a generic platform price as the requested-size price.',
      'Prefer completed-sale rows for the exact size when available. If using a current ask/bid instead, label that price type explicitly in condition or note.',
      'Prioritize canonical direct product pages from KREAM and SOLDOUT, then other public Korean resale marketplaces.',
      'Every returned numeric price must be supported by an inline URL citation from the exact product page used as evidence.',
      'Return at most one offer per seller for the requested size. Never estimate, average, infer, or transform a price.',
      'If exact product + exact model + exact selected size + exact KRW price cannot all be supported, omit that offer. If no offer qualifies, return an empty offers array.',
      'The JSON shape is {"offers":[{"seller":"...","productName":"...","priceKRW":123000,"condition":"...","note":"..."}]}. Return at most 5 KRW offers. Use Korean descriptions.',
      `Product data: ${JSON.stringify(input)}`
    ].join(' ');
  }

  return [
    'Research CURRENT Korean retail prices using Google Search.',
    'Do not answer from memory or prior knowledge.',
    'Search the exact brand, product name, and model code when present before producing any offer.',
    'Use only current publicly listed prices for NEW retail products from the exact product page or a directly matching shopping result.',
    'Do NOT use used, refurbished, resale, rental, accessory, bundle-only, coupon-only, membership-only, or unrelated variant prices unless that condition is explicit and the product still exactly matches.',
    'Prefer official brand stores and major Korean retailers, then other reputable Korean online stores.',
    'Every returned numeric price must be supported by an inline URL citation from the source used as evidence.',
    'Return at most one offer per seller. Never estimate, average, infer, or transform a price.',
    'If exact product + exact current KRW price cannot be supported, omit that offer. If no offer qualifies, return an empty offers array.',
    'The JSON shape is {"offers":[{"seller":"...","productName":"...","priceKRW":123000,"condition":"...","note":"..."}]}. Return at most 5 KRW offers. Use Korean descriptions.',
    `Product data: ${JSON.stringify(input)}`
  ].join(' ');
}

export function buildResearchInteractionRequest(generateContentBody, input, model) {
  const schema = generateContentBody?.generationConfig?.responseFormat?.text?.schema;
  const requestedMax = generateContentBody?.generationConfig?.maxOutputTokens;
  const maxOutputTokens = Number.isInteger(requestedMax) ? Math.max(8192, requestedMax) : 8192;
  const resell = input.mode === 'resell';
  return {
    model,
    input: researchPrompt(input),
    system_instruction: resell
      ? 'Use Google Search for current resale research. Enforce exact product, exact model code, and exact selected-size evidence. Reject headline/overall prices and other-size prices. Return only citation-backed offers; otherwise return no offers.'
      : 'Use Google Search for current Korean retail research. Enforce exact product matching and current new-retail evidence. Return only citation-backed offers; otherwise return no offers.',
    tools: [{ type: 'google_search', search_types: ['web_search'] }],
    generation_config: { max_output_tokens: maxOutputTokens },
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      ...(schema ? { schema } : {})
    },
    store: false
  };
}

export function buildResellInteractionRequest(generateContentBody, input, model) {
  return buildResearchInteractionRequest(generateContentBody, input, model);
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

function interactionDiagnostics(interaction) {
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  const stepTypes = {};
  let annotationCount = 0;
  for (const step of steps) {
    const type = typeof step?.type === 'string' ? step.type : 'unknown';
    stepTypes[type] = (stepTypes[type] ?? 0) + 1;
    if (type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const block of step.content) annotationCount += Array.isArray(block?.annotations) ? block.annotations.length : 0;
  }
  return {
    status: interaction?.status ?? null,
    stepCount: steps.length,
    stepTypes,
    annotationCount,
    outputTokens: Number.isInteger(interaction?.usage?.total_output_tokens) ? interaction.usage.total_output_tokens : null,
    thoughtTokens: Number.isInteger(interaction?.usage?.total_thought_tokens) ? interaction.usage.total_thought_tokens : null
  };
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
        groundingSupports.push({
          segment: { partIndex, startIndex: annotation.start, endIndex: annotation.end },
          groundingChunkIndices: [chunkIndex]
        });
      }
    }
  }

  const hasGrounding = searchQueries.length > 0 || groundingChunks.length > 0 || groundingSupports.length > 0 || suggestions.length > 0;
  const completed = interaction?.status === 'completed';
  return {
    candidates: [{
      finishReason: completed ? 'STOP' : 'OTHER',
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

    const input = parseResearchInput(generateContentBody);
    if (!input) return fetchImpl(url, options);

    const model = modelFromGenerateContentUrl(url);
    if (!model) return fetchImpl(url, options);

    console.info(JSON.stringify({ event: 'research_grounding_request', mode: input.mode, model, hasSize: Boolean(input?.size), hasModelCode: Boolean(input?.modelCode), modelCode: input?.modelCode || null, citationProfile: 'proven-v3', maxOutputTokens: 8192 }));

    let interactionResponse;
    try {
      interactionResponse = await fetchImpl(INTERACTIONS_URL, {
        ...options,
        signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
        body: JSON.stringify(buildResearchInteractionRequest(generateContentBody, input, model))
      });
    } catch (error) {
      console.info(JSON.stringify({ event: 'research_grounding_transport_error', mode: input.mode, name: error?.name ?? 'Error' }));
      throw error;
    }

    if (!interactionResponse.ok) {
      console.info(JSON.stringify({ event: 'research_grounding_provider_error', mode: input.mode, status: interactionResponse.status }));
      return interactionResponse;
    }

    const interaction = await interactionResponse.json();
    console.info(JSON.stringify({ event: 'research_grounding_interaction', mode: input.mode, ...interactionDiagnostics(interaction) }));
    return responseLike(interactionResponse, interactionToGenerateContent(interaction));
  };
}
