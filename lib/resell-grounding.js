const GEMINI_HOST = 'generativelanguage.googleapis.com';

export function strengthenResellGroundingBody(body) {
  if (!body || typeof body !== 'object') return body;
  const originalText = body.contents?.[0]?.parts?.[0]?.text;
  if (typeof originalText !== 'string') return body;

  let input;
  try { input = JSON.parse(originalText); }
  catch { return body; }

  if (input?.mode !== 'resell') return body;

  const extraInstruction = [
    'RESALE MODE requires current web evidence.',
    'Use Google Search now before producing any offer.',
    'Do not answer from model memory or prior knowledge.',
    'Search for the exact product/model and the requested Korean mm size.',
    'Generate search queries that include brand, product name, model code when present, and the selected size.',
    'Prioritize KREAM and SOLDOUT when publicly indexed, then other publicly accessible Korean resale pages.',
    'Distinguish current asking prices from completed-sale prices.',
    'Every returned price must be grounded with citable web evidence.',
    'If no citable price evidence is found, return an empty offers array.'
  ].join(' ');

  const originalParts = Array.isArray(body.systemInstruction?.parts) ? body.systemInstruction.parts : [];
  return {
    ...body,
    systemInstruction: {
      ...(body.systemInstruction ?? {}),
      parts: [...originalParts, { text: extraInstruction }]
    },
    contents: [{
      role: 'user',
      parts: [{
        text: `Use Google Search now to find current Korean resale prices for the exact product and requested size. Do not answer from memory. Product data JSON: ${JSON.stringify(input)}`
      }]
    }]
  };
}

export function createPromptAwareFetch(fetchImpl = fetch) {
  return async function promptAwareFetch(url, options = {}) {
    let parsedUrl;
    try { parsedUrl = new URL(url); }
    catch { return fetchImpl(url, options); }

    if (parsedUrl.hostname !== GEMINI_HOST || options.method !== 'POST' || typeof options.body !== 'string') {
      return fetchImpl(url, options);
    }

    let requestBody;
    try { requestBody = JSON.parse(options.body); }
    catch { return fetchImpl(url, options); }

    const strengthened = strengthenResellGroundingBody(requestBody);
    if (strengthened === requestBody) return fetchImpl(url, options);

    return fetchImpl(url, { ...options, body: JSON.stringify(strengthened) });
  };
}
