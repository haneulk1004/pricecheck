const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function extractJson(text='') {
  const cleaned = String(text).replace(/```json/gi,'').replace(/```/g,'').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(match[0]);
}

export function createAnalyzeHandler({ env = process.env, fetchImpl = fetch, log = console.info } = {}) {
return async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버의 GEMINI_API_KEY가 설정되지 않았습니다.' });
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};
    if (typeof imageBase64 !== 'string' || !imageBase64) return res.status(400).json({ error: '이미지 데이터를 확인해주세요.' });
    if (imageBase64.length > 4000000) return res.status(413).json({ error: '사진 용량이 너무 큽니다. 더 작은 사진으로 다시 시도해주세요.' });
    if (imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(imageBase64)) return res.status(400).json({ error: '이미지 데이터를 확인해주세요.' });
    if (!['image/jpeg','image/png','image/webp'].includes(mimeType)) return res.status(400).json({ error: 'JPG, PNG 또는 WebP 사진을 사용해주세요.' });

    const prompt = `
You are the product-identification engine for PRICE_CHECK, a Korean shopping price verification service.
Analyze the product image and identify the most likely commercial product.

Return JSON ONLY with this exact shape:
{
  "brand": "brand name or empty string",
  "productName": "specific product name",
  "modelCode": "model number, SKU, style code, product code, or empty string",
  "category": "one short category",
  "confidence": 0,
  "searchQuery": "best concise search query for Korean shopping/resell sites"
}

Rules:
- confidence must be an integer from 0 to 100.
- Never invent a model code if it is not reasonably visible or inferable.
- Prefer exact model/style/SKU codes when visible on labels, packaging, tags, or the product.
- searchQuery should prioritize brand + exact product name + model code when known.
- Do not estimate or return prices.
- If identification is uncertain, lower confidence instead of fabricating details.
`;

    const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: AbortSignal.timeout(45000),
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20'
      },
      body: JSON.stringify({
        model: env.GEMINI_MODEL || MODEL,
        store: false,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', data: imageBase64, mime_type: mimeType }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const code = Number.isInteger(data?.error?.code) ? data.error.code : undefined;
      const status = typeof data?.error?.status === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(data.error.status) ? data.error.status : undefined;
      log(JSON.stringify({event:'pricecheck_analyze',outcome:'provider_error',status:response.status,error:{code,status}}));
      return res.status(502).json({ error: '사진 분석 서비스가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    }

    const rawText = data?.output_text || data?.steps?.flatMap(step => step?.content || []).find(item => item?.type === 'text')?.text;
    if (!rawText) return res.status(502).json({ error: 'AI가 분석 결과를 반환하지 않았습니다.' });

    const parsed = extractJson(rawText);
    const result = {
      brand: typeof parsed.brand === 'string' ? parsed.brand.trim() : '',
      productName: typeof parsed.productName === 'string' ? parsed.productName.trim() : '',
      modelCode: typeof parsed.modelCode === 'string' ? parsed.modelCode.trim() : '',
      category: typeof parsed.category === 'string' ? parsed.category.trim() : '',
      confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0))),
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery.trim() : ''
    };

    if (!result.productName) return res.status(502).json({ error: '제품명을 식별하지 못했습니다.' });
    return res.status(200).json(result);
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    log(JSON.stringify({event:'pricecheck_analyze',outcome:timeout?'TIMEOUT':'ANALYZE_FAILED'}));
    return res.status(timeout?504:502).json({ error: timeout?'사진 분석 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.':'사진을 분석하지 못했습니다. 제품이 잘 보이는 사진으로 다시 시도해주세요.' });
  }
}

}
export default createAnalyzeHandler();
