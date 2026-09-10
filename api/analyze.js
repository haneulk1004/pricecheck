const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function extractJson(text='') {
  const cleaned = String(text).replace(/```json/gi,'').replace(/```/g,'').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(match[0]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버의 GEMINI_API_KEY가 설정되지 않았습니다.' });
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: '이미지 데이터가 없습니다.' });

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

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20'
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', data: imageBase64, mime_type: mimeType }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || 'Gemini API 호출에 실패했습니다.';
      return res.status(response.status).json({ error: message });
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
    console.error('PRICE_CHECK analyze error:', error);
    return res.status(500).json({ error: '제품 분석 중 오류가 발생했습니다.' });
  }
}
