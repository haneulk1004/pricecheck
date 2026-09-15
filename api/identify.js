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

function outputBlocks(data) {
  return (data?.steps || []).flatMap(step => step?.type === 'model_output' ? (step.content || []) : []).filter(item => item?.type === 'text');
}

function citationUrls(data) {
  const seen = new Set();
  return outputBlocks(data).flatMap(block => block.annotations || []).filter(annotation => annotation?.type === 'url_citation' && typeof annotation.url === 'string').map(annotation => annotation.url).filter(url => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0,3);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === '::1') return null;
    return url;
  } catch {
    return null;
  }
}

function decodeHtml(value='') {
  return String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

function metaImage(html='') {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const wanted of ['og:image','twitter:image','twitter:image:src']) {
    for (const tag of tags) {
      const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (key !== wanted) continue;
      const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
      if (content) return decodeHtml(content);
    }
  }
  return '';
}

async function groundedProductImage(data, fetchImpl) {
  for (const sourceUrl of citationUrls(data)) {
    const source = safeHttpsUrl(sourceUrl);
    if (!source) continue;
    try {
      const response = await fetchImpl(source.href, {
        method:'GET',
        redirect:'follow',
        signal:AbortSignal.timeout(4000),
        headers:{'User-Agent':'PRICE_CHECK/1.0 product-preview'}
      });
      if (!response?.ok || !String(response.headers?.get?.('content-type') || '').toLowerCase().includes('text/html') || typeof response.text !== 'function') continue;
      const finalUrl = safeHttpsUrl(response.url || source.href);
      if (!finalUrl) continue;
      const html = (await response.text()).slice(0,1500000);
      const candidate = metaImage(html);
      if (!candidate) continue;
      const image = safeHttpsUrl(new URL(candidate, finalUrl).href);
      if (!image) continue;
      return { imageUrl:image.href, imageSourceUrl:finalUrl.href };
    } catch {}
  }
  return { imageUrl:'', imageSourceUrl:'' };
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
Use Google Search only as needed to verify the exact commercial product and find its official manufacturer product page.
Prefer the official manufacturer product page as the citation source. Do not use community posts, blogs, or marketplace listings when an official product page exists.
Use only information strongly implied by the query or supported by the search source. Do not invent a brand or model code.
If the query is itself a model/style/SKU code and you can confidently identify the commercial product, return the verified brand/product/model. Otherwise preserve the query as productName and leave uncertain fields empty.
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
- Do not return prices or an image URL. PRICE_CHECK derives preview imagery only from cited web pages.
Manual query: ${JSON.stringify(query)}
`;

    try {
      const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method:'POST',
        signal:AbortSignal.timeout(30000),
        headers:{'Content-Type':'application/json','x-goog-api-key':apiKey,'Api-Revision':'2026-05-20'},
        body:JSON.stringify({
          model: env.GEMINI_MODEL || MODEL,
          store:false,
          input:prompt,
          tools:[{type:'google_search',search_types:['web_search']}],
          generation_config:{thinking_level:'low'}
        })
      });
      const data = await response.json();
      if (!response.ok) {
        log(JSON.stringify({event:'pricecheck_identify',outcome:'provider_error',status:response.status}));
        return res.status(502).json({ error:'제품 정보를 확인하지 못했습니다. 직접 수정해서 계속 진행할 수 있습니다.' });
      }
      const rawText = data?.output_text || outputBlocks(data)[0]?.text;
      if (!rawText) throw new Error('empty');
      const parsed = extractJson(rawText);
      const image = await groundedProductImage(data, fetchImpl);
      const result = {
        brand: clean(parsed.brand,80),
        productName: clean(parsed.productName,160) || query,
        modelCode: clean(parsed.modelCode,80),
        category: clean(parsed.category,80),
        confidence: Math.max(0,Math.min(100,Math.round(Number(parsed.confidence)||0))),
        searchQuery: clean(parsed.searchQuery,200) || query,
        imageUrl:image.imageUrl,
        imageSourceUrl:image.imageSourceUrl
      };
      log(JSON.stringify({event:'pricecheck_identify',outcome:'success',groundedImage:Boolean(result.imageUrl)}));
      return res.status(200).json(result);
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      log(JSON.stringify({event:'pricecheck_identify',outcome:timeout?'TIMEOUT':'IDENTIFY_FAILED'}));
      return res.status(timeout?504:502).json({ error:'제품 정보를 자동 확인하지 못했습니다. 직접 수정해서 계속 진행할 수 있습니다.' });
    }
  };
}

export default createIdentifyHandler();
