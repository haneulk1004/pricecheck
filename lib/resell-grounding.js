const GEMINI_HOST = 'generativelanguage.googleapis.com';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

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

function parseResellInput(body) {
  if (!body || typeof body !== 'object') return null;
  const originalText = body.contents?.[0]?.parts?.[0]?.text;
  if (typeof originalText !== 'string') return null;
  try {
    const input = JSON.parse(originalText);
    return input?.mode === 'resell' ? inferModelCode(input) : null;
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

function resellPrompt(input, citationRetry = false) {
  return [
    'Research CURRENT Korean resale-market prices using Google Search.',
    'Do not answer from memory or prior knowledge.',
    'Search the exact product, model code, and selected Korean mm size before producing any offer.',
    'Prioritize publicly indexed KREAM and SOLDOUT pages, then other public Korean resale pages.',
    'Distinguish current asking prices from completed-sale prices and label the price type in condition or note.',
    'Every returned price must be supported by a URL citation that covers the exact numeric price in the output.',
    'Never estimate, invent, or infer a price. If citable evidence is unavailable, return an empty offers array.',
    citationRetry ? 'This is a citation retry: Google Search must be used again and every non-empty offer price must have an inline URL citation. Return exactly one compact JSON object and no Markdown.' : '',
    'The JSON shape is {"offers":[{"seller":"...","productName":"...","priceKRW":123000,"condition":"...","note":"..."}]}. Return at most 5 KRW offers. Use Korean descriptions.',
    `Product data: ${JSON.stringify(input)}`
  ].filter(Boolean).join(' ');
}

export function buildResellInteractionRequest(generateContentBody, input, model, { structured = true } = {}) {
  const schema = generateContentBody?.generationConfig?.responseFormat?.text?.schema;
  const maxOutputTokens = generateContentBody?.generationConfig?.maxOutputTokens ?? 4096;
  return {
    model,
    input: resellPrompt(input, !structured),
    system_instruction: 'Use the available Google Search tool for current resale price research. Return only evidence-backed prices with inline URL citations; otherwise return no offers.',
    tools: [{ type: 'google_search', search_types: ['web_search'] }],
    generation_config: { max_output_tokens: maxOutputTokens },
    ...(structured ? {
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        ...(schema ? { schema } : {})
      }
    } : {}),
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
  return { status: interaction?.status ?? null, stepCount: steps.length, stepTypes, annotationCount };
}

function shouldRetryForCitations(interaction) {
  const diagnostics = interactionDiagnostics(interaction);
  return diagnostics.status === 'completed' &&
    (diagnostics.stepTypes.google_search_call ?? 0) > 0 &&
    diagnostics.annotationCount === 0;
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

async function runInteraction(fetchImpl, options, body, logEvent) {
  let response;
  try {
    response = await fetchImpl(INTERACTIONS_URL, { ...options, body: JSON.stringify(body) });
  } catch (error) {
    console.info(JSON.stringify({ event: 'resell_grounding_transport_error', attempt: logEvent, name: error?.name ?? 'Error' }));
    throw error;
  }
  if (!response.ok) {
    console.info(JSON.stringify({ event: 'resell_grounding_provider_error', attempt: logEvent, status: response.status }));
    return { response, interaction: null };
  }
  const interaction = await response.json();
  console.info(JSON.stringify({ event: logEvent, ...interactionDiagnostics(interaction) }));
  return { response, interaction };
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

    console.info(JSON.stringify({ event: 'resell_grounding_request', model, hasSize: Boolean(input?.size), hasModelCode: Boolean(input?.modelCode), modelCode: input?.modelCode || null }));

    const first = await runInteraction(fetchImpl, options, buildResellInteractionRequest(generateContentBody, input, model), 'resell_grounding_interaction');
    if (!first.response.ok || !first.interaction) return first.response;

    if (!shouldRetryForCitations(first.interaction)) {
      return responseLike(first.response, interactionToGenerateContent(first.interaction));
    }

    console.info(JSON.stringify({ event: 'resell_grounding_citation_retry', reason: 'SEARCH_WITHOUT_ANNOTATIONS' }));
    const retry = await runInteraction(fetchImpl, options, buildResellInteractionRequest(generateContentBody, input, model, { structured: false }), 'resell_grounding_retry_interaction');
    if (!retry.response.ok || !retry.interaction) return retry.response;
    return responseLike(retry.response, interactionToGenerateContent(retry.interaction));
  };
}
