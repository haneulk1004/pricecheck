const GEMINI_HOST = 'generativelanguage.googleapis.com';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const RESEARCH_TIMEOUT_MS = 40000;

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
    'Use a focused search: prioritize the official Korean brand product page and one matching Korean price-comparison catalog. Stop once 1 to 3 eligible offers have evidence; do not exhaustively visit every retailer or repeat unsuccessful queries. Fewer verified offers are preferable to a broad slow search.',
    'Do not answer from memory or prior knowledge.',
    'First search the exact brand + exact product name in quotes where useful, preserving visible volume, weight, count, edition, flavor and model tokens.',
    'For everyday food, drinks, dairy, beauty and household goods, actively check official brand malls and major Korean retail/catalog pages such as Lotte Mart, SSG, Coupang, 11st, Gmarket and Danawa when relevant.',
    'For books, actively check exact title + publisher/series/edition at YES24, Kyobo and Aladin when relevant.',
    'Use only current publicly listed prices for NEW retail products from an exact product page or a directly matching shopping/catalog result.',
    'A scanned single item and a multipack are different variants: never substitute a 6-pack, 8-pack, 24-pack or bundle total for a single-unit product unless the requested product data itself specifies that pack count. Preserve pack count in productName and note.',
    'Likewise do not mix different volume, weight, count, edition, flavor, storage capacity or other price-defining variants.',
    'Do NOT use used, refurbished, resale, rental, accessory, bundle-only, coupon-only, membership-only or unrelated-variant prices.',
    'Prefer official brand stores and major Korean retailers, then reputable Korean comparison/catalog pages that show an exact matching current price.',
    'Every returned numeric price must be directly supported by an inline URL citation covering that exact price. If a search result has a price but the final numeric price cannot be cited, omit it.',
    'Return at most one offer per seller. Never estimate, average, infer, divide a multipack total into a unit price, or transform a price.',
    'If exact product + exact current KRW price cannot be supported, omit that offer. If no offer qualifies, reply NO_VERIFIED_OFFERS.',
    'Include the brand, full product identity, model and requested variant in each product field. Preserve the original product name when translating would lose identity.',
    'Write plain Korean text with native inline Google Search citations, NOT JSON or a code block. Each offer must occupy one line using exactly these labels and separators:',
    '판매처: <seller> | 제품: <exact product with variants> | 가격: <integer KRW>원 | 상태: <condition> | 비고: <shipping and conditions>.',
    'Attach a native citation covering the numeric price on EACH offer line. Do not type URLs or invent citations yourself. Do not include pipes inside field values. Return at most 5 offers and no other prose.',
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
      : 'Use Google Search for current Korean retail research. Search exact price-defining variants and broaden discovery across official stores, major Korean retailers and reputable catalog pages. Never convert multipack totals into unit prices. Return only exact citation-backed prices; otherwise return no offers.',
    tools: [{ type: 'google_search', search_types: ['web_search'] }],
    generation_config: { max_output_tokens: maxOutputTokens },
    response_format: resell ? {
      type: 'text',
      mime_type: 'application/json',
      ...(schema ? { schema } : {})
    } : { type: 'text' },
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

// Convert only prices covered by native provider annotations. Model-written URLs,
// citations on another line, and ungrounded numbers never become evidence.
export function citedRetailBlock(block) {
  const offers = [], citations = [];
  const original = typeof block?.text === 'string' ? block.text : '';
  const annotations = (block?.annotations || []).map(safeCitation).filter(Boolean);
  const pattern = /^[ \t]*(?:[-*] )?판매처:[ \t]*([^|\n]+)[ \t]*\|[ \t]*제품:[ \t]*([^|\n]+)[ \t]*\|[ \t]*가격:[ \t]*([0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)[ \t]*원[ \t]*\|[ \t]*상태:[ \t]*([^|\n]+)[ \t]*\|[ \t]*비고:[ \t]*([^\n]*)$/gm;
  for (const match of original.matchAll(pattern)) {
    if (offers.length >= 5) break;
    const price = Number(match[3].replace(/,/g, ''));
    if (!Number.isSafeInteger(price) || price <= 0 || price > 1e12) continue;
    const priceOffset = match.index + match[0].indexOf('가격:') + match[0].slice(match[0].indexOf('가격:')).indexOf(match[3]);
    const start = Buffer.byteLength(original.slice(0, priceOffset));
    const end = start + Buffer.byteLength(match[3]);
    const sources = annotations.filter(a => Number.isInteger(a.start) && Number.isInteger(a.end) && a.start >= 0 && a.start <= start && a.end >= end && a.end <= Buffer.byteLength(original));
    if (!sources.length) continue;
    const values = [match[1], match[2], match[4], match[5]].map(value => value.trim());
    if (values.some(value => value.length > 600) || !values[0] || !values[1]) continue;
    offers.push({seller:values[0],productName:values[1],priceKRW:price,condition:values[2],note:values[3]});
    citations.push(sources);
  }
  const text = JSON.stringify({offers});
  const outputAnnotations = [];
  for (const [index, match] of [...text.matchAll(/"priceKRW":(\d+)/g)].entries()) {
    const start = Buffer.byteLength(text.slice(0, match.index + match[0].lastIndexOf(match[1])));
    for (const source of citations[index]) outputAnnotations.push({type:'url_citation',url:source.url,title:source.title,start_index:start,end_index:start + match[1].length});
  }
  return { type: 'text', text, annotations: outputAnnotations };
}

export function interactionToGenerateContent(interaction, { retailText = false } = {}) {
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
    for (const rawBlock of step.content) {
      if (rawBlock?.type !== 'text' || typeof rawBlock.text !== 'string') continue;
      const block = retailText ? citedRetailBlock(rawBlock) : rawBlock;
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

    console.info(JSON.stringify({ event: 'research_grounding_request', mode: input.mode, model, hasSize: Boolean(input?.size), hasModelCode: Boolean(input?.modelCode), modelCode: input?.modelCode || null, citationProfile: input.mode === 'store' ? 'retail-cited-text-v5' : 'proven-v3', maxOutputTokens: 8192 }));

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
    return responseLike(interactionResponse, interactionToGenerateContent(interaction, { retailText: input.mode === 'store' }));
  };
}
