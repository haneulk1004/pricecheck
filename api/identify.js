const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function extractJson(text='') {
  const cleaned = String(text).replace(/```json/gi,'').replace(/```/g,'').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(match[0]);
}

function clean(value, max=160) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/gu,' ').trim().slice(0,max) : '';
}

export function createIdentifyHandler({ env = process.env, fetchImpl = fetch, log = console.info } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control','no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow','POST');
      return res.status(405).json({ error:'POST 요청만 지원합니다.' });
    }
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error:'서버의 GEMINI_API_KEY가 설정되지 않았습니다.' });
    const query = clean(req.body?.query, 160);
    if (!query) return res.status(400).json({ error:'검색어를 확인해주세요.' });

    const prompt = `
You are the product-identification engine for PRICE_CHECK, a Korean shopping price verification service.
The user entered a manual product query. Normalize it into structured product data.
Use only information strongly implied by the query. Do not invent a brand or model code.
If the query is itself a model/style/SKU code and you can confidently identify the commercial product from your knowledge, return the likely brand/product/model. Otherwise preserve the query as productName and leave uncertain fields empty.
Return JSON ONLY in this exact shape:
{
  "brand":"",
  "productName":"",
  "modelCode":"",
  "category":"",
  "confidence":0,
  "searchQuery":""
}
Rules:
- confidence integer 0-100.
- modelCode must never be fabricated.
- searchQuery should be concise and prioritize brand + product + model code.
- Do not return prices.
Manual query: ${JSON.stringify(query)}
`;

    try {
      const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method:'POST',
        signal:AbortSignal.timeout(30000),
        headers:{'Content-Type':'application/json','x-goog-api-key':apiKey,'Api-Revision':'2026-05-20'},
        body:JSON.stringify({ model: env.GEMINI_MODEL || MODEL, store:false, input: prompt })
      });
      const data = await response.json();
      if (!response.ok) {
        log(JSON.stringify({event:'pricecheck_identify',outcome:'provider_error',status:response.status}));
        return res.status(502).json({ error:'제품 정보를 확인하지 못했습니다. 직접 수정해서 계속 진행할 수 있습니다.' });
      }
      const rawText = data?.output_text || data?.steps?.flatMap(step => step?.content || []).find(item => item?.type === 'text')?.text;
      if (!rawText) throw new Error('empty');
      const parsed = extractJson(rawText);
      const result = {
        brand: clean(parsed.brand,80),
        productName: clean(parsed.productName,160) || query,
        modelCode: clean(parsed.modelCode,80),
        category: clean(parsed.category,80),
        confidence: Math.max(0,Math.min(100,Math.round(Number(parsed.confidence)||0))),
        searchQuery: clean(parsed.searchQuery,200) || query
      };
      return res.status(200).json(result);
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      log(JSON.stringify({event:'pricecheck_identify',outcome:timeout?'TIMEOUT':'IDENTIFY_FAILED'}));
      return res.status(timeout?504:502).json({ error:'제품 정보를 자동 확인하지 못했습니다. 직접 수정해서 계속 진행할 수 있습니다.' });
    }
  };
}

export default createIdentifyHandler();
